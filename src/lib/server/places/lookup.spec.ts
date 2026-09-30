import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '../auth/session';
import { ApiError } from '../errors';
import { resolveHierarchy } from '../staged/csv';
import { getContactType } from '../config';
import { FakeCht } from '../testing/fake-cht';
import { searchPlaces } from './directory';
import { allPlaces, clearPlaceCache, DEFAULT_MAX_PLACES_LOADED, placeLookup, placesUnder, setMaxPlacesLoaded } from './lookup';

const session: Session = {
  instanceId: 'test',
  username: 'manager',
  facilityIds: ['*'],
  sessionCookie: 'AuthSession=abc',
  chtVersion: '4.18.0',
  isAdmin: true
};
const lineage = (...ids: string[]) => ids.reduceRight<any>((parent, id) => ({ _id: id, ...(parent ? { parent } : {}) }), undefined);
const HOUSEHOLD = 'e_household';

let cht: FakeCht;
// the types whose places were read whole
let loaded: string[];

// Kisumu › Kisumu West › Kanyakwar › Mary Area (2 households) and Ann Area (1 household)
beforeEach(() => {
  clearPlaceCache();
  // three households are "a lot" here
  setMaxPlacesLoaded(2);
  cht = new FakeCht().seed(
    { _id: 'county', type: 'contact', contact_type: 'a_county', name: 'Kisumu' },
    { _id: 'west', type: 'contact', contact_type: 'b_sub_county', name: 'Kisumu West', parent: lineage('county') },
    { _id: 'chu', type: 'contact', contact_type: 'c_community_health_unit', name: 'Kanyakwar', parent: lineage('west', 'county') },
    {
      _id: 'mary',
      type: 'contact',
      contact_type: 'd_community_health_volunteer_area',
      name: 'Mary Area',
      parent: lineage('chu', 'west', 'county')
    },
    {
      _id: 'ann',
      type: 'contact',
      contact_type: 'd_community_health_volunteer_area',
      name: 'Ann Area',
      parent: lineage('chu', 'west', 'county')
    },
    { _id: 'h1', type: 'contact', contact_type: HOUSEHOLD, name: 'Otieno Household', parent: lineage('mary', 'chu', 'west', 'county') },
    { _id: 'h2', type: 'contact', contact_type: HOUSEHOLD, name: 'Achieng Household', parent: lineage('mary', 'chu', 'west', 'county') },
    { _id: 'h3', type: 'contact', contact_type: HOUSEHOLD, name: 'Otieno Household', parent: lineage('ann', 'chu', 'west', 'county') },
    { _id: 'head', type: 'contact', contact_type: 'f_client', name: 'Otieno', parent: lineage('h1', 'mary', 'chu', 'west', 'county') }
  );
  loaded = [];
  const read = cht.placesOfType.bind(cht);
  cht.placesOfType = (type: string) => {
    loaded.push(type);
    return read(type);
  };
});

afterEach(() => {
  setMaxPlacesLoaded(DEFAULT_MAX_PLACES_LOADED);
  clearPlaceCache();
});

describe('a type small enough to read whole', () => {
  it('is read once, and its places under a parent come from that one read', async () => {
    expect((await allPlaces(cht, 'd_community_health_volunteer_area'))?.map((doc) => doc._id)).toEqual(['mary', 'ann']);
    expect((await placesUnder(cht, 'chu', 'd_community_health_volunteer_area')).map((doc) => doc._id)).toEqual(['mary', 'ann']);
    expect((await placesUnder(cht, 'west', 'd_community_health_volunteer_area', 2)).map((doc) => doc._id)).toEqual(['mary', 'ann']);
    expect(loaded).toEqual(['d_community_health_volunteer_area']);
  });
});

describe('a type with more places than MAX_PLACES_LOADED', () => {
  it('is never read whole: only one parent’s places, or deeper, at a time', async () => {
    expect(await allPlaces(cht, HOUSEHOLD)).toBeNull();
    expect((await placesUnder(cht, 'mary', HOUSEHOLD)).map((doc) => doc._id).sort()).toEqual(['h1', 'h2']);
    // two levels down: the unit's households, and nothing else found at that depth
    expect((await placesUnder(cht, 'chu', HOUSEHOLD, 2)).map((doc) => doc._id).sort()).toEqual(['h1', 'h2', 'h3']);
    expect(loaded).toEqual([]);
  });

  it('is counted once every few minutes, not on every lookup', async () => {
    await allPlaces(cht, HOUSEHOLD);
    await placesUnder(cht, 'mary', HOUSEHOLD);
    await placesUnder(cht, 'ann', HOUSEHOLD);
    expect(cht.calls.filter((call) => call === 'countPlacesOfType')).toHaveLength(1);
  });

  it('is searched under the chosen parent, and refused without one', async () => {
    const found = await searchPlaces(cht, session, { type: HOUSEHOLD, q: 'otieno', parentId: 'mary', limit: 20 });
    expect(found.map((place) => place.id)).toEqual(['h1']);

    const refused = await searchPlaces(cht, session, { type: HOUSEHOLD, q: 'otieno', limit: 20 }).catch((e) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 422, code: 'PARENT_REQUIRED', message: expect.stringContaining('too many Household places') });
    expect(loaded).toEqual([]);
  });

  it('reads each parent’s places once for a whole CSV file', async () => {
    const lookup = placeLookup(cht);
    await Promise.all([lookup.under('mary', HOUSEHOLD), lookup.under('mary', HOUSEHOLD), lookup.under('ann', HOUSEHOLD)]);
    expect(cht.calls.filter((call) => call === 'docsAtDepth')).toHaveLength(2);
  });

  it('is found by name in a CSV row under the level above it, and needs that level filled in', async () => {
    // a type whose own hierarchy starts at households, to show the top level can't be found alone
    const household = getContactType(HOUSEHOLD);
    const withinHousehold = {
      ...household,
      hierarchy: [
        { friendly_name: 'Household', property_name: 'HOUSEHOLD', contact_type: HOUSEHOLD, type: 'name' as const, required: true, level: 1 }
      ]
    };
    const alone = await resolveHierarchy(withinHousehold, { HOUSEHOLD: 'Otieno Household' }, placeLookup(cht), () => true);
    expect(alone.errors['hierarchy.HOUSEHOLD']).toMatch(/too many places to find Household "Otieno Household"/);

    const withLevels = {
      ...household,
      hierarchy: [
        {
          friendly_name: 'CHP Area',
          property_name: 'CHP_AREA',
          contact_type: 'd_community_health_volunteer_area',
          type: 'name' as const,
          required: true,
          level: 2
        },
        { friendly_name: 'Household', property_name: 'HOUSEHOLD', contact_type: HOUSEHOLD, type: 'name' as const, required: true, level: 1 }
      ]
    };
    const found = await resolveHierarchy(withLevels, { CHP_AREA: 'Ann Area', HOUSEHOLD: 'Otieno Household' }, placeLookup(cht), () => true);
    expect(found).toMatchObject({ errors: {}, parent: { _id: 'h3' } });
    expect(loaded).toEqual(['d_community_health_volunteer_area']);
  });
});
