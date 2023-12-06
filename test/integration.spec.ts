import _ from 'lodash';
import fs from 'fs';
import { expect } from 'chai';

import { Config } from '../src/lib/config';
import { Validation } from '../src/lib/validation';
import PlaceFactory from '../src/services/place-factory';
import SessionCache from '../src/services/session-cache';
import { ParentDetails } from '../src/lib/cht-api';
import Place from '../src/services/place';

describe('integration', () => {
  it('CHUs', async () => {
    const results = await read('./test/BOMET CHUs.csv', 'c_community_health_unit');
    console.table(results);
    expect(results.length).to.eq(246);
    const invalids = results.filter(r => r.invalidProperties.length > 0).map(r => r.name);
    expect(invalids).to.deep.eq([
      'Chepkeigei',
      'Chesoen',
      'Kaboson',
      'Kamongil',
      'Kanusin',
      'Kimoso',
      'Ngariet',
      'Nogirwet',
    ]);
  });

  it('CHPs', async () => {
    const results = await read('./test/BOMET CHPs.csv', 'd_community_health_volunteer_area');
    console.table(results);
    expect(results.length).to.eq(2331);
    const invalids = results.filter(r => r.invalidProperties.length > 0);
    expect(invalids.length).to.eq(31);
    const uniqueInvalidProperties = _.uniq(_.flatten(invalids.map(r => r.invalidProperties)));
    expect(uniqueInvalidProperties).to.deep.eq(['contact_phone']);

    const lastRow = results[results.length - 1].place;
    expect(lastRow).to.deep.nested.include({
      'properties.name': 'Naomy Rono\'s Area',
      'contact.properties.name': 'Naomy Rono',
      'properties.PARENT': 'Kiproroget',
      'parentDetails.id': 'parent-id',
      'parentDetails.name': 'Kiproroget',
      'type.name': 'd_community_health_volunteer_area',
      'invalidProperties': ['contact_phone'],
      'creationDetails': {},
      'state': 'pending',
    });
  });
});

async function read(csvFilename : string, type: string): Promise<{ name: string, place: Place, invalidProperties: string[] }[]> {
  const csvBuffer = fs.readFileSync(csvFilename);
  const contactType = Config.getContactType(type);
  const sessionCache = new SessionCache();
  const chtApi = {
    searchPlace: async (placeType: string, searchStr: string[]) : Promise<ParentDetails[]> => {
      return searchStr
        .map(name => ({
          id: 'parent-id',
          type: placeType,
          name,
        }));
    },
  };
  const placeContactPairs = await PlaceFactory.createBulk(csvBuffer, contactType, sessionCache, chtApi);

  return placeContactPairs.map(place => {
    const invalidProperties = Validation.getInvalidProperties(place);
    const formatted = Validation.cleanup(place);
    return {
      name: formatted.name,
      place,
      invalidProperties,
    };
  });
}
