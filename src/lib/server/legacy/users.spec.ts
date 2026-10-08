import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../auth/session';
import { ChtError } from '../errors';
import type { OperationContext } from '../places/context';
import { clearPlaceCache } from '../places/lookup';
import { FakeCht } from '../testing/fake-cht';
import { MemoryUploadLog } from '../upload-log';
import { DISABLED_ROLE, disableUsersAt, setUserFacilities, unassignFacilitiesFromOthers, UserNotFoundError } from '../users/facilities';
import { sanitizeOidcUsername } from '../users/oidc';
import { createUser, disableUsersAtPlace, setFacilities, updatePlace } from './users';

// Runs against Kenya's deployment (DEPLOYMENT_DIR in .env.test), porting the previous version's tests
const CHU = 'c_community_health_unit';
const CHV_AREA = 'd_community_health_volunteer_area';
const CHA = 'community_health_assistant';

const admin: Session = {
  instanceId: 'test',
  username: 'manager',
  facilityIds: ['*'],
  sessionCookie: 'AuthSession=abc',
  chtVersion: '4.18.0',
  isAdmin: true
};
const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);

let cht: FakeCht;
let context: OperationContext;

// Kisumu West › CHUs a, b, c; Mary's area under a
beforeEach(() => {
  clearPlaceCache();
  cht = new FakeCht().seed(
    { _id: 'kisumu', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
    { _id: 'west', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: lineage('kisumu') },
    { _id: 'fac-a', type: 'contact', contact_type: CHU, name: 'Kanyakwar', parent: lineage('west', 'kisumu'), contact: { _id: 'old-a' } },
    { _id: 'fac-b', type: 'contact', contact_type: CHU, name: 'Kogony', parent: lineage('west', 'kisumu') },
    { _id: 'fac-c', type: 'contact', contact_type: CHU, name: 'Kisian', parent: lineage('west', 'kisumu') },
    {
      _id: 'area',
      type: 'contact',
      contact_type: CHV_AREA,
      name: 'Mary Atieno Area',
      parent: lineage('fac-a', 'west', 'kisumu'),
      contact: { _id: 'mary', parent: lineage('area', 'fac-a', 'west', 'kisumu') }
    },
    { _id: 'mary', type: 'person', name: 'Mary Atieno', phone: '0712345678', parent: lineage('area', 'fac-a', 'west', 'kisumu') }
  );
  context = { cht, session: admin, uploadLog: new MemoryUploadLog() };
});

describe("users/facilities (the previous version's SetUserFacilities and DisableUsers)", () => {
  beforeEach(() => {
    cht.seedUser({ username: 'target', place: ['fac-c'], contact: 't', roles: [DISABLED_ROLE] });
  });

  it('assigns the facilities to the user, replacing their list and re-applying the role', async () => {
    const result = await setUserFacilities(cht, 'target', ['fac-a', 'fac-b'], [CHA]);
    expect(result).toEqual({ username: 'target', facilityIds: ['fac-a', 'fac-b'], unassigned: [] });
    expect(cht.users.get('target')).toMatchObject({ place: ['fac-a', 'fac-b'], roles: [CHA] });
  });

  it('leaves the roles alone when none are given', async () => {
    await setUserFacilities(cht, 'target', ['fac-a'], []);
    expect(cht.users.get('target')?.roles).toEqual([DISABLED_ROLE]);
  });

  it('takes the facilities from other users, and disables one left with none, keeping one place', async () => {
    cht.seedUser({ username: 'shared', place: ['fac-a', 'fac-c'], contact: 's', roles: [CHA] });
    cht.seedUser({ username: 'only', place: ['fac-b', 'fac-a'], contact: 'o', roles: [CHA] });
    const result = await setUserFacilities(cht, 'target', ['fac-a', 'fac-b'], [CHA]);
    expect(result.unassigned).toEqual([
      { username: 'shared', remaining: ['fac-c'] },
      { username: 'only', remaining: [], disabled: true }
    ]);
    expect(cht.users.get('shared')?.place).toEqual(['fac-c']);
    expect(cht.users.get('only')).toMatchObject({ place: ['fac-b'], roles: [DISABLED_ROLE] });
  });

  it("doesn't unassign the user from facilities it already held", async () => {
    const result = await setUserFacilities(cht, 'target', ['fac-c', 'fac-a'], [CHA]);
    expect(result.unassigned).toEqual([]);
  });

  it("names a user that doesn't exist, and then takes nothing from anyone", async () => {
    cht.seedUser({ username: 'holder', place: ['fac-a'], contact: 'h', roles: [CHA] });
    await expect(setUserFacilities(cht, 'ghost', ['fac-a'], [CHA])).rejects.toBeInstanceOf(UserNotFoundError);
    expect(cht.users.get('holder')?.place).toEqual(['fac-a']);
  });

  it('passes any other failure through', async () => {
    cht.failNext('updateUser', new ChtError(500, 'boom'));
    await expect(setUserFacilities(cht, 'target', ['fac-a'], [CHA])).rejects.toThrow('boom');
  });

  it('unassigns from others without assigning, still trying the rest when one fails', async () => {
    cht.seedUser({ username: 'one', place: ['fac-a', 'fac-b'], contact: '1', roles: [CHA] });
    cht.seedUser({ username: 'two', place: ['fac-a'], contact: '2', roles: [CHA] });
    cht.failNext('updateUser', new ChtError(400, 'nope'));
    const result = await unassignFacilitiesFromOthers(cht, ['fac-a'], 'target');
    expect(result).toEqual([
      { username: 'one', remaining: ['fac-b'], error: 'nope' },
      { username: 'two', remaining: [], disabled: true }
    ]);
  });

  it('disables users left with no place, and updates the others', async () => {
    cht.seedUser({ username: 'one', place: ['fac-a', 'fac-b'], contact: '1', roles: [CHA] });
    cht.seedUser({ username: 'two', place: ['fac-a'], contact: '2', roles: [CHA] });
    expect(await disableUsersAt(cht, ['fac-a'])).toEqual(['one', 'two']);
    expect(cht.users.get('one')).toMatchObject({ place: ['fac-b'] });
    expect(cht.users.get('one')?.inactive).toBeUndefined();
    expect(cht.users.get('two')?.inactive).toBe(true);
  });
});

describe('POST /api/v1/create-user', () => {
  const body = {
    oidc_username: 'jane.doe@moh.go.ke',
    role: CHA,
    facility_ids: ['fac-a', 'fac-b'],
    contact: { name: 'Jane Doe', phone: '0712000000' }
  };

  it('creates a new person, makes them primary contact of every facility, and creates the SSO user', async () => {
    const result = await createUser(context, body, false);
    expect(result).toEqual({ success: true, username: 'jane_dot_doe_at_moh_dot_go_dot_ke' });

    const user = cht.users.get('jane_dot_doe_at_moh_dot_go_dot_ke')!;
    expect(user).toMatchObject({ oidc_username: 'jane.doe@moh.go.ke', roles: [CHA], place: ['fac-a', 'fac-b'] });
    expect(user).not.toHaveProperty('password');
    expect(cht.docs.get(user.contact)).toMatchObject({ type: 'person', name: 'Jane Doe', parent: { _id: 'fac-a' } });
    expect(cht.docs.get('fac-a')).toMatchObject({
      contact: { _id: user.contact },
      user_attribution: { previousPrimaryContacts: ['old-a'] }
    });
    expect(cht.docs.get('fac-b')?.contact).toEqual({ _id: user.contact });
  });

  it('takes the facilities from other users with exclusiveFacilities', async () => {
    cht.seedUser({ username: 'old', place: ['fac-a'], contact: 'old-a', roles: [CHA] });
    const result = await createUser(context, { ...body, roles: [CHA], role: undefined }, true);
    expect(result).toMatchObject({ success: true, unassigned: [{ username: 'old', remaining: [], disabled: true }] });
  });

  it.each([
    [{ oidc_username: '' }, 'oidc_username is required'],
    [{ role: undefined }, 'role is required'],
    [{ facility_ids: [] }, 'facility_ids must be a non-empty array of place ids'],
    [{ contact: undefined }, 'contact is required and must include a name'],
    [{ contact: { phone: '0712000000' } }, 'contact is required and must include a name']
  ])('rejects %o without creating anything', async (change, errors) => {
    const docs = cht.docs.size;
    expect(await createUser(context, { ...body, ...change }, false)).toEqual({ success: false, errors });
    expect(cht.docs.size).toBe(docs);
    expect(cht.users.size).toBe(0);
  });

  it("names a facility that doesn't exist", async () => {
    expect(await createUser(context, { ...body, facility_ids: ['nowhere'] }, false)).toEqual({
      error: 'Facility place "nowhere" was not found in this eCHIS instance'
    });
  });

  it("returns CHT's message when creating the user fails", async () => {
    cht.failNext('createOidcUser', new ChtError(400, 'Invalid role'));
    expect(await createUser(context, body, false)).toEqual({ error: 'Invalid role' });
  });

  it('derives the username as before', () => {
    expect(sanitizeOidcUsername('demo@email.com')).toBe('demo_at_email_dot_com');
    expect(sanitizeOidcUsername('a  b__c@x.org')).toBe('a_b_c_at_x_dot_org');
    expect(() => sanitizeOidcUsername('@')).not.toThrow();
    expect(() => sanitizeOidcUsername('!!!')).toThrow('username cannot be empty');
  });
});

describe('POST /api/v1/set-user-facilities', () => {
  beforeEach(() => {
    cht.seedUser({ username: 'demo_at_email_dot_com', place: ['fac-c'], contact: 'd', roles: [CHA] });
  });

  it('sets the facilities of the user named by oidc_username, as user creation names it', async () => {
    const result = await setFacilities(context, { oidc_username: 'demo@email.com', facility_ids: ['fac-a'], roles: [CHA] });
    expect(result).toEqual({ username: 'demo_at_email_dot_com', facilityIds: ['fac-a'], unassigned: [] });
  });

  it.each([
    [{ facility_ids: ['fac-a'], role: CHA }, 'username is required'],
    [{ username: 'jdoe', facility_ids: [], role: CHA }, 'facility_ids must be a non-empty array of place ids'],
    [{ username: 'jdoe', facility_ids: ['fac-a'] }, 'role is required']
  ])('rejects %o', async (body, errors) => {
    expect(await setFacilities(context, body)).toEqual({ success: false, errors });
  });

  it('flags a missing user, so the caller creates them rather than retrying', async () => {
    expect(await setFacilities(context, { username: 'ghost', facility_ids: ['fac-a'], role: CHA })).toEqual({
      success: false,
      error: 'User "ghost" was not found in this eCHIS instance',
      userNotFound: true
    });
  });

  it('returns the error envelope for other failures', async () => {
    cht.failNext('usersAtPlace', new ChtError(500, 'down'));
    expect(await setFacilities(context, { username: 'jdoe', facility_ids: ['fac-a'], role: CHA })).toEqual({ error: 'down' });
  });
});

describe('POST /api/v1/disable-users-at', () => {
  beforeEach(() => {
    cht.seedUser({ username: 'one', place: ['fac-a', 'fac-b'], contact: '1', roles: [CHA] });
    cht.seedUser({ username: 'two', place: ['fac-a'], contact: '2', roles: [CHA] });
  });

  it('disables the users at the best match', async () => {
    const result = await disableUsersAtPlace(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'kanyakwar' });
    expect(result).toEqual({ place_id: 'fac-a', place_name: 'Kanyakwar', disabled: ['one', 'two'] });
    expect(cht.users.get('two')?.inactive).toBe(true);
  });

  it('aborts when several places tie for the best match', async () => {
    cht.seed({ _id: 'fac-a2', type: 'contact', contact_type: CHU, name: 'Kanyakwar', parent: lineage('west', 'kisumu') });
    expect(await disableUsersAtPlace(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Kanyakwar' })).toEqual({
      success: false,
      isDuplicate: true,
      error: 'ambiguous match: 2 facilities tie for the best match (Kanyakwar, Kanyakwar)'
    });
    expect(cht.users.get('two')?.inactive).toBeUndefined();
  });

  it("reports no match, and a hierarchy that can't be resolved, disabling no one", async () => {
    expect(await disableUsersAtPlace(context, { type: CHU, SUBCOUNTY: 'Kisumu West', replacement: 'Elsewhere' })).toEqual({
      success: false,
      error: 'no facility found matching the provided hierarchy'
    });
    expect(await disableUsersAtPlace(context, { type: CHU, SUBCOUNTY: 'wrong', replacement: 'Kanyakwar' })).toMatchObject({
      parentMissing: true
    });
    expect(cht.users.get('two')?.inactive).toBeUndefined();
  });
});

describe('POST /api/v1/update-place', () => {
  const url = (query: string) => new URL(`http://localhost/api/v1/update-place?${query}`);
  const area = url(`place_id=area&type=${CHV_AREA}`);

  it('updates the contact and regenerates the place name, recording what changed', async () => {
    const result = await updatePlace(context, area, { contact_name: 'mary akinyi' });
    expect(result).toEqual({
      success: true,
      place_id: 'area',
      contact_id: 'mary',
      place: { name: { previous: 'Mary Atieno Area', current: 'Mary Akinyi Area' } },
      // the stored phone is formatted too, though it wasn't sent
      contact: { name: { previous: 'Mary Atieno', current: 'Mary Akinyi' }, phone: { previous: '0712345678', current: '+254712345678' } }
    });
    expect(cht.docs.get('mary')).toMatchObject({ name: 'Mary Akinyi', phone: '+254712345678' });
    expect(cht.docs.get('area')?.user_attribution.edits).toEqual([
      {
        tool: expect.stringMatching(/^cht-user-management/),
        username: 'manager',
        edited_time: expect.any(Number),
        changes: (result as { place: unknown }).place
      }
    ]);
  });

  it('writes nothing when the values match what is there', async () => {
    await updatePlace(context, area, {});
    const revs = [cht.docs.get('area')?._rev, cht.docs.get('mary')?._rev];
    expect(await updatePlace(context, area, { contact_phone: '+254712345678' })).toMatchObject({ success: true, place: {}, contact: {} });
    expect([cht.docs.get('area')?._rev, cht.docs.get('mary')?._rev]).toEqual(revs);
  });

  it('claims and releases the place for the external system', async () => {
    await updatePlace(context, area, { chw_registry_link: 'registry/7' });
    expect(cht.docs.get('area')?.chw_registry_link).toBe('registry/7');
    const released = await updatePlace(context, area, { chw_registry_link: false });
    expect(released).toMatchObject({ place: { chw_registry_link: { previous: 'registry/7', current: null } } });
    expect(cht.docs.get('area')).not.toHaveProperty('chw_registry_link');
    expect(await updatePlace(context, area, { chw_registry_link: 7 })).toEqual({
      error: '"chw_registry_link" must be true, a reference to the external record, or null to release'
    });
  });

  it('returns validation errors keyed as sent, writing nothing', async () => {
    const result = await updatePlace(context, area, { contact_phone: '12', contact_name: '' });
    expect(result).toEqual({ success: false, errors: { contact_phone: expect.any(String), contact_name: 'Is Required' } });
    expect(cht.docs.get('mary')?.name).toBe('Mary Atieno');
  });

  it('rejects every unrecognized key, including hierarchy and user ones', async () => {
    expect(await updatePlace(context, area, { contact_nmae: 'x', name: 'y', user_role: 'z', CHU: 'w' })).toEqual({
      success: false,
      errors: {
        contact_nmae: `is not a property of "${CHV_AREA}"`,
        name: `is not a property of "${CHV_AREA}"`,
        user_role: `is not a property of "${CHV_AREA}"`,
        CHU: `is not a property of "${CHV_AREA}"`
      }
    });
  });

  it('checks the query string and the body', async () => {
    expect(await updatePlace(context, url(`type=${CHU}`), {})).toEqual({ success: false, errors: 'place_id query parameter is required' });
    expect(await updatePlace(context, url('place_id=area'), {})).toEqual({ success: false, errors: 'type query parameter is required' });
    expect(await updatePlace(context, area, { place_id: 'area' })).toEqual({
      success: false,
      errors: 'place_id belongs on the query string, not in the body'
    });
    await expect(updatePlace(context, url('place_id=area&type=bogus'), {})).rejects.toThrow('unrecognized contact type: "bogus"');
  });

  it('refuses places that are missing, of another type, or without a contact', async () => {
    expect(await updatePlace(context, url(`place_id=ghost&type=${CHU}`), {})).toEqual({
      error: 'place "ghost" was not found on this instance'
    });
    expect(await updatePlace(context, url(`place_id=area&type=${CHU}`), {})).toEqual({
      error: `place "area" is of type "${CHV_AREA}", not "${CHU}"`
    });
    expect(await updatePlace(context, url(`place_id=fac-b&type=${CHU}`), {})).toEqual({
      error: 'place "fac-b" has no primary contact to update'
    });
  });

  it('says the contact was already written when the place write fails', async () => {
    const put = cht.putDoc.bind(cht);
    let writes = 0;
    cht.putDoc = async (doc) => {
      if (++writes === 2) throw new ChtError(500, 'down');
      return put(doc);
    };
    expect(await updatePlace(context, area, { contact_name: 'mary akinyi' })).toEqual({
      error: 'failed to update place "area": down (the contact "mary" was already updated)'
    });
  });
});
