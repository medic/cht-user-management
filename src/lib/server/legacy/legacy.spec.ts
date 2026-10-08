import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Instance } from '../auth/instances';
import type { Session } from '../auth/session';
import { ChtError } from '../errors';
import { MemoryJobStore } from '../hierarchy/jobs';
import type { JobDeps } from '../hierarchy/service';
import type { OperationContext } from '../places/context';
import { clearPlaceCache } from '../places/lookup';
import type { Settings } from '../settings';
import { FakeCht } from '../testing/fake-cht';
import { MemoryUploadLog } from '../upload-log';
import { legacyInstance } from './auth';
import { readForm } from './form';
import { manageHierarchy } from './hierarchy';
import { ensureJsonObjectBody, legacyContactType, legacyHandler, readLegacyBody } from './http';
import { createUserAndPlace, legacyWarning, searchPlaces } from './places';
import { hierarchyErrors, hierarchyResolutionError, resolveHierarchy } from './resolver';

// Runs against Kenya's deployment (DEPLOYMENT_DIR in .env.test), as the previous version's tests did
const CHU = 'c_community_health_unit';
const CHV_AREA = 'd_community_health_volunteer_area';

const admin: Session = {
  instanceId: 'test',
  username: 'manager',
  facilityIds: ['*'],
  sessionCookie: 'AuthSession=abc',
  chtVersion: '4.18.0',
  isAdmin: true
};
const instance: Instance = { id: 'test', name: 'Migori', host: 'migori.echis.go.ke', useHttp: false, idpOrigins: [] };
const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);

let cht: FakeCht;
let context: OperationContext;

// Kisumu › Kisumu West › Kanyakwar CHU (Jane, CHA) › Mary Area (Mary); Kisumu › Seme; and a second
// "Seme" in Siaya, with its own CHU
beforeEach(() => {
  clearPlaceCache();
  cht = new FakeCht().seed(
    { _id: 'kisumu', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
    { _id: 'siaya', type: 'contact', contact_type: 'a_county', name: 'Siaya' },
    { _id: 'west', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: lineage('kisumu') },
    { _id: 'seme', type: 'contact', contact_type: 'b_sub_county', name: 'Seme', parent: lineage('kisumu') },
    { _id: 'seme-siaya', type: 'contact', contact_type: 'b_sub_county', name: 'Seme', parent: lineage('siaya') },
    {
      _id: 'chu',
      type: 'contact',
      contact_type: CHU,
      name: 'Kanyakwar',
      code: '123456',
      parent: lineage('west', 'kisumu'),
      contact: { _id: 'jane', parent: lineage('chu', 'west', 'kisumu') }
    },
    { _id: 'jane', type: 'person', name: 'Jane Achieng', parent: lineage('chu', 'west', 'kisumu') },
    { _id: 'chu-siaya', type: 'contact', contact_type: CHU, name: 'Ndori', parent: lineage('seme-siaya', 'siaya') },
    {
      _id: 'area',
      type: 'contact',
      contact_type: CHV_AREA,
      name: 'Mary Atieno Area',
      parent: lineage('chu', 'west', 'kisumu'),
      contact: { _id: 'mary', parent: lineage('area', 'chu', 'west', 'kisumu') }
    },
    { _id: 'mary', type: 'person', name: 'Mary Atieno', phone: '+254712345678', parent: lineage('area', 'chu', 'west', 'kisumu') }
  );
  cht.seedUser({ username: 'jane', place: ['chu'], contact: 'jane', roles: ['community_health_assistant'] });
  cht.seedUser({ username: 'mary', place: ['area'], contact: 'mary', roles: ['community_health_volunteer'] });
  context = { cht, session: admin, uploadLog: new MemoryUploadLog() };
});

describe("resolveHierarchy (the previous version's place resolver)", () => {
  const resolve = (type: string, names: Record<string, string>, session = admin) =>
    resolveHierarchy(cht, session, legacyContactType(type), names);

  it('finds each level by name, ignoring case and the formatting the type removes', async () => {
    const resolved = await resolve(CHV_AREA, {
      SUBCOUNTY: 'kisumu west',
      CHU: 'KANYAKWAR community health unit',
      replacement: 'Mary Atieno'
    });
    expect(resolved.map((place) => place?.id)).toEqual(['area', 'chu', 'west']);
  });

  it('reports a name that matches no place, and one that matches several', async () => {
    const missing = await resolve(CHU, { SUBCOUNTY: 'Nowhere' });
    expect(hierarchyResolutionError(missing)).toEqual({
      error: 'hierarchy cannot be resolved: index 1 - Place Not Found',
      isAmbiguous: false,
      parentMissing: true
    });

    const ambiguous = await resolve(CHU, { SUBCOUNTY: 'Seme' });
    expect(hierarchyResolutionError(ambiguous)).toEqual({
      error: 'hierarchy cannot be resolved: index 1 - multiple places',
      isAmbiguous: true,
      parentMissing: false
    });
    expect(ambiguous[1]?.ambiguities?.map((place) => place.id).sort()).toEqual(['seme', 'seme-siaya']);
  });

  it('tells two places of the same name apart by the level below them', async () => {
    const resolved = await resolve(CHV_AREA, { SUBCOUNTY: 'Seme', CHU: 'Ndori' });
    expect(resolved[2]?.id).toBe('seme-siaya');
    expect(resolved[1]?.id).toBe('chu-siaya');
  });

  it("doesn't find places outside the caller's facilities", async () => {
    const resolved = await resolve(CHU, { SUBCOUNTY: 'Kisumu West' }, { ...admin, isAdmin: false, facilityIds: ['siaya'] });
    expect(hierarchyResolutionError(resolved)?.parentMissing).toBe(true);
  });

  it('words missing and unresolved levels as before', async () => {
    const type = legacyContactType(CHV_AREA);
    const names = { SUBCOUNTY: 'Seme', replacement: 'Somebody' };
    expect(hierarchyErrors(type, names, await resolve(CHV_AREA, names), 'source_')).toEqual({
      source_replacement: "Cannot find 'Community Health Promoter' matching 'Somebody'",
      source_CHU: 'Cannot find Community Health Unit because the search string is empty',
      source_SUBCOUNTY: 'Found multiple b_sub_countys matching \'Seme\' ["seme","seme-siaya"]'
    });
  });
});

describe('POST /api/v1/search', () => {
  it('returns places of the type under the resolved parent, best match first', async () => {
    const result = await searchPlaces(context, { type: CHV_AREA, SUBCOUNTY: 'Kisumu West', CHU: 'Kanyakwar', replacement: 'atieno mary' });
    expect(result).toEqual({ hits: [{ place_id: 'area', name: 'Mary Atieno Area', score: expect.any(Number) }] });
  });

  it('returns the hierarchy error when the parent is missing or ambiguous', async () => {
    expect(await searchPlaces(context, { type: CHU, SUBCOUNTY: 'wrong', replacement: 'Kanyakwar' })).toMatchObject({ parentMissing: true });
    expect(await searchPlaces(context, { type: CHU, SUBCOUNTY: 'Seme', replacement: 'Kanyakwar' })).toMatchObject({ isAmbiguous: true });
  });

  it('returns nothing when no place of the type under the parent matches, or the parent has none', async () => {
    expect(await searchPlaces(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Somewhere Else' })).toEqual({ hits: [] });
    expect(await searchPlaces(context, { type: CHU, SUBCOUNTY: 'Seme', replacement: 'Kanyakwar' })).not.toHaveProperty('hits');
  });

  it('only reads the parent levels: the place itself, and other keys, are left out of resolution', async () => {
    const result = await searchPlaces(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Kanyakwar', UNRELATED: 'noise' });
    expect(result).toEqual({ hits: [{ place_id: 'chu', name: 'Kanyakwar', score: 0 }] });
  });

  it("reads the instance's places again with clear_cache, and only that instance's", async () => {
    const other = new FakeCht();
    Object.assign(other, { domain: 'other.cht' });
    other.seed({ _id: 'x', type: 'contact', contact_type: 'b_sub_county', name: 'Other' });
    await searchPlaces({ ...context, cht: other }, { type: CHU, SUBCOUNTY: 'Other', replacement: 'x' });
    await searchPlaces(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Kanyakwar' });
    cht.seed({ _id: 'chu-2', type: 'contact', contact_type: CHU, name: 'Kogony', parent: lineage('west', 'kisumu') });
    other.calls.length = 0;

    const body = { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Kogony' };
    expect(await searchPlaces(context, body)).toEqual({ hits: [] });
    expect(await searchPlaces(context, body, { clearCache: true })).toEqual({ hits: [{ place_id: 'chu-2', name: 'Kogony', score: 0 }] });
    await searchPlaces({ ...context, cht: other }, { type: CHU, SUBCOUNTY: 'Other', replacement: 'x' });
    expect(other.calls).not.toContain('placesOfType');
  });

  it('throws for an unknown type, which the endpoint answers with a 500', async () => {
    await expect(searchPlaces(context, { type: 'bogus' })).rejects.toThrow('unrecognized contact type: "bogus"');
  });
});

describe('POST /api/v1/create-user-and-place', () => {
  const chu = {
    type: CHU,
    SUBCOUNTY: 'Kisumu West',
    place_name: 'Kogony',
    place_code: '654321',
    place_link_facility_name: 'Kogony Dispensary',
    place_link_facility_code: '54321',
    contact_name: 'paul oduor',
    contact_phone: '0712000111'
  };

  it('creates the place, its person and login, and returns their ids and credentials', async () => {
    const result = await createUserAndPlace(context, chu);
    expect(result).toMatchObject({ username: 'paul_oduor', warnings: [] });
    const created = result as { place_id: string; contact_id: string; password: string };
    expect(created.password).toHaveLength(9);
    expect(cht.docs.get(created.place_id)).toMatchObject({
      name: 'Kogony Community Health Unit',
      contact_type: CHU,
      parent: { _id: 'west' }
    });
    expect(cht.docs.get(created.contact_id)).toMatchObject({ name: 'Paul Oduor', phone: '+254712000111' });
    expect(cht.users.get('paul_oduor')).toMatchObject({ place: [created.place_id], contact: created.contact_id });
  });

  it('creates despite duplicates, and reports them as before', async () => {
    const result = await createUserAndPlace(context, { ...chu, place_code: '123456' });
    expect(result).toMatchObject({ warnings: ['A place with the same "CHU Code" exists on the instance. ID "["chu"]"'] });
  });

  it('writes the external ownership attribute', async () => {
    const result = (await createUserAndPlace(context, { ...chu, chw_registry_link: 'registry/1' })) as { place_id: string };
    expect(cht.docs.get(result.place_id)?.chw_registry_link).toBe('registry/1');
  });

  it('returns the hierarchy error when the parent is missing or ambiguous, and writes nothing', async () => {
    const docs = cht.docs.size;
    expect(await createUserAndPlace(context, { ...chu, SUBCOUNTY: 'wrong' })).toMatchObject({ parentMissing: true });
    expect(await createUserAndPlace(context, { ...chu, SUBCOUNTY: 'Seme' })).toMatchObject({ isAmbiguous: true });
    expect(cht.docs.size).toBe(docs);
  });

  it('returns validation errors keyed as the form was', async () => {
    const result = await createUserAndPlace(context, { ...chu, place_code: '12', contact_phone: undefined });
    expect(result).toEqual({
      success: false,
      errors: { place_code: expect.any(String), contact_phone: 'Is Required' }
    });
  });

  it('includes a missing parent level with the property errors', async () => {
    const result = await createUserAndPlace(context, { ...chu, SUBCOUNTY: undefined, place_code: '12' });
    expect(result).toEqual({
      success: false,
      errors: { place_code: expect.any(String), SUBCOUNTY: 'Cannot find b_sub_county because the search string is empty' }
    });
  });

  it('returns the upload failure when CHT fails', async () => {
    cht.failNext('putDoc', new ChtError(400, 'something went wrong'));
    expect(await createUserAndPlace(context, chu)).toEqual({ success: false, errors: 'something went wrong' });
  });

  it('reports any other upload failure in the body, as before', async () => {
    // nothing in the name makes a username
    expect(await createUserAndPlace(context, { ...chu, contact_name: '日本' })).toEqual({
      success: false,
      errors: 'Error: username cannot be empty'
    });
  });

  it('with a replacement, hands the place to a new person, keeping the outgoing person', async () => {
    const result = await createUserAndPlace(context, {
      type: CHU,
      SUBCOUNTY: 'Kisumu West',
      replacement: 'Kanyakwar',
      contact_name: 'Grace Owino',
      contact_phone: '0722000222'
    });
    expect(result).toMatchObject({ place_id: 'chu', username: 'grace_owino', warnings: [] });
    const { contact_id } = result as { contact_id: string };
    expect(cht.docs.get('chu')?.contact?._id).toBe(contact_id);
    expect(cht.docs.get('jane')).toBeDefined();
    expect(cht.users.get('jane')?.inactive).toBe(true);
    expect(cht.users.get('grace_owino')?.place).toEqual(['chu']);
  });

  it('finds a replaced place by its new name straight away', async () => {
    await searchPlaces(context, { type: CHV_AREA, SUBCOUNTY: 'Kisumu West', CHU: 'Kanyakwar', replacement: 'Mary' });
    await createUserAndPlace(context, {
      type: CHV_AREA,
      SUBCOUNTY: 'Kisumu West',
      CHU: 'Kanyakwar',
      replacement: 'Mary Atieno',
      contact_name: 'Grace Owino',
      contact_phone: '0722000222'
    });
    const result = await searchPlaces(context, { type: CHV_AREA, SUBCOUNTY: 'Kisumu West', CHU: 'Kanyakwar', replacement: 'Grace Owino' });
    expect(result).toEqual({ hits: [expect.objectContaining({ place_id: 'area', name: 'Grace Owino Area' })] });
  });

  it('with a replacement, warns about its own unique values, as before', async () => {
    const result = await createUserAndPlace(context, {
      type: CHU,
      SUBCOUNTY: 'Kisumu West',
      replacement: 'Kanyakwar',
      place_code: '123456',
      contact_name: 'Grace Owino',
      contact_phone: '0722000222'
    });
    expect(result).toMatchObject({ warnings: ['A place with the same "CHU Code" exists on the instance. ID "["chu"]"'] });
  });

  it('returns the hierarchy error for a replacement that matches no place', async () => {
    const result = await createUserAndPlace(context, { ...chu, replacement: 'Nowhere' });
    expect(result).toEqual({ error: 'hierarchy cannot be resolved: index 0 - Place Not Found', isAmbiguous: false, parentMissing: true });
  });

  it('throws for an unknown type, which the endpoint answers with a 500', async () => {
    await expect(createUserAndPlace(context, { type: 'bogus' })).rejects.toThrow('unrecognized contact type: "bogus"');
  });
});

describe('POST /api/v1/manage-hierarchy', () => {
  let dir: string;
  let deps: JobDeps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cht-iam-legacy-'));
    deps = {
      cht,
      session: admin,
      store: new MemoryJobStore(),
      workerKey: 'w'.repeat(40),
      settings: {
        maxSentinelBacklog: 7000,
        recheckSeconds: 900,
        ttlSeconds: 86_400,
        workDir: join(dir, 'work'),
        archiveDir: join(dir, 'archives'),
        timeoutSeconds: 60,
        chtConfHeapMb: 256
      }
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('schedules a move to the new parent', async () => {
    const result = await manageHierarchy(deps, instance, {
      op: 'move',
      place_type: CHU,
      source_SUBCOUNTY: 'Kisumu West',
      source_replacement: 'Kanyakwar',
      destination_SUBCOUNTY: 'Seme'
    });
    // "Seme" names two sub counties: the move can't pick one
    expect(result).toEqual({ error: expect.stringContaining('Error: Found multiple') });

    const scheduled = await manageHierarchy(deps, instance, {
      op: 'move',
      place_type: CHV_AREA,
      source_SUBCOUNTY: 'Kisumu West',
      source_CHU: 'Kanyakwar',
      source_replacement: 'Mary Atieno',
      destination_SUBCOUNTY: 'Seme',
      destination_CHU: 'Ndori'
    });
    expect(scheduled).toEqual({
      jobName: 'move_[Kisumu West.Kanyakwar.Mary Atieno]_to_[Seme.Ndori]',
      action: 'move',
      instanceUrl: 'https://migori.echis.go.ke',
      sourceId: 'area',
      destinationId: 'chu-siaya'
    });
    const [job] = await deps.store.queue('test');
    expect(job).toMatchObject({ kind: 'move', request: { placeId: 'area', newParentId: 'chu-siaya' } });
  });

  it("schedules a delete, confirmed with the place's own name", async () => {
    const result = await manageHierarchy(deps, instance, {
      op: 'delete',
      place_type: CHV_AREA,
      source_SUBCOUNTY: 'Kisumu West',
      source_CHU: 'Kanyakwar',
      source_replacement: 'Mary Atieno'
    });
    expect(result).toMatchObject({
      jobName: 'delete_[Kisumu West.Kanyakwar.Mary Atieno]',
      action: 'delete',
      sourceId: 'area',
      destinationId: ''
    });
    const [job] = await deps.store.queue('test');
    expect(job).toMatchObject({ kind: 'delete', request: { placeId: 'area', confirmName: 'Mary Atieno Area' } });
  });

  it('refuses a merge into itself and a move to the current parent', async () => {
    const source = { place_type: CHU, source_SUBCOUNTY: 'Kisumu West', source_replacement: 'Kanyakwar' };
    expect(
      await manageHierarchy(deps, instance, {
        ...source,
        op: 'merge',
        destination_SUBCOUNTY: 'Kisumu West',
        destination_replacement: 'Kanyakwar'
      })
    ).toEqual({
      error: 'Error: Cannot merge place with self'
    });
    expect(await manageHierarchy(deps, instance, { ...source, op: 'move', destination_SUBCOUNTY: 'Kisumu West' })).toEqual({
      error: 'Error: Place "Kanyakwar" already has "Kisumu West" as parent'
    });
  });

  it('reports an unknown action or place in the body', async () => {
    expect(await manageHierarchy(deps, instance, { op: 'copy', place_type: CHU })).toEqual({ error: 'Error: invalid action: "copy"' });
    expect(
      await manageHierarchy(deps, instance, { op: 'delete', place_type: CHU, source_SUBCOUNTY: 'Kisumu West', source_replacement: 'Nope' })
    ).toEqual({
      error: "Error: Cannot find 'Community Health Unit' matching 'Nope' under 'Kisumu West'"
    });
  });

  it('throws for an unknown type, which the endpoint answers with a 500', async () => {
    await expect(manageHierarchy(deps, instance, { op: 'move', place_type: 'bogus' })).rejects.toThrow(
      'unrecognized contact type: "bogus"'
    );
  });
});

describe("the previous version's HTTP conventions", () => {
  const post = (body: string, contentType?: string) =>
    new Request('http://localhost/api/v1/search', { method: 'POST', body, headers: contentType ? { 'content-type': contentType } : {} });
  const call = (handler: RequestHandler, request: Request) =>
    handler({ request, url: new URL(request.url), locals: {} } as unknown as Parameters<RequestHandler>[0]) as Promise<Response>;

  it('reads JSON and form bodies', async () => {
    expect(await readLegacyBody(post('{"a":1}', 'application/json'))).toEqual({ a: 1 });
    expect(await readLegacyBody(post('a=1&b=2&b=3', 'application/x-www-form-urlencoded'))).toEqual({ a: '1', b: ['2', '3'] });
  });

  it('answers malformed bodies as Fastify did', async () => {
    const handler = legacyHandler(async ({ request }) => {
      const body = await readLegacyBody(request);
      ensureJsonObjectBody(body);
      return new Response('ok');
    });
    const invalid = await call(handler, post('{', 'application/json'));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY', error: 'Bad Request' });

    const array = await call(handler, post('["not","an","object"]', 'application/json'));
    expect(array.status).toBe(500);
    expect(await array.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'body expected as application/json' });

    expect((await call(handler, post('x', 'text/plain'))).status).toBe(415);
  });

  it('names instances by their display name, as "domain"', () => {
    const settings = { instances: [instance, { ...instance, id: 'dev', name: 'Development' }] } as Settings;
    expect(legacyInstance(settings, 'Migori').id).toBe('test');
    expect(legacyInstance(settings, '$Development').id).toBe('dev');
    expect(() => legacyInstance(settings, 'Nairobi')).toThrow('unrecognized domain: "Nairobi"');
  });

  it('reads flat bodies, ignoring generated properties and unknown keys', () => {
    const form = readForm(
      { CHU: 'x', place_name: 'ignored', contact_name: 'Mary', other: 'y', chw_registry_link: true },
      legacyContactType(CHV_AREA)
    );
    expect(form).toEqual({ hierarchy: { CHU: 'x' }, place: {}, contact: { name: 'Mary' }, roles: undefined, ownership: true });
  });

  it('words duplicate warnings as before', () => {
    expect(legacyWarning({ message: 'A place with the same "CHU Name" and same parent already exists', placeIds: ['a', 'b'] })).toBe(
      'A place with the same "CHU Name" and same parent exists on the instance. ID "["a","b"]"'
    );
  });
});
