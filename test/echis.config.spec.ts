import { expect } from 'chai';

import { Config } from '../src/lib/config';
import { Validation } from '../src/lib/validation';
import CsvReader from '../src/lib/csv-reader';

import fs from 'fs';
import _ from 'lodash';
import { describe, it } from 'node:test';

describe('echis.config csv validation', () => {
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
    expect(invalids.length).to.eq(33);
    const uniqueInvalidProperties = _.uniq(_.flatten(invalids.map(r => r.invalidProperties)));
    expect(uniqueInvalidProperties).to.deep.eq(['CHV Phone']);
  });
});

async function read(csvFilename : string, type: string): Promise<{ name: string, invalidProperties: string[] }[]> {
  const csvBuffer = fs.readFileSync(csvFilename);
  const contactType = Config.getContactType(type);
  const placeContactPairs = await CsvReader.fromBuffer(csvBuffer, 'workbookId', contactType);

  return placeContactPairs.map(({ place, contact }) => {
    const invalidProperties = Validation.getInvalidProperties(contactType, place, contact);
    const formatted = Validation.format(contactType, place, contact);
    return {
      name: formatted.place.properties.name,
      invalidProperties,
    };
  });
}
