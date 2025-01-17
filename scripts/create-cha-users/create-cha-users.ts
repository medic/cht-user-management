import _ from 'lodash';
import fs from 'fs';

import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import Place from '../../src/services/place';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import { UserPayload } from '../../src/services/user-payload';

const authInfo = {
  friendly: 'Local Dev',
  domain: 'localhost:5988',
  useHttp: true,
};
const username = 'medic';
const password = 'password';
const csvFilePath = './Test CHAs.csv';

(async function() {
  const session = await ChtSession.create(authInfo, username, password);
  const chtApi = new ChtApi(session);
  const places: Place[] = await loadFromCsv(session, chtApi);
  
  assertAllPlacesValid(places);

  const chusByCha = _.groupBy(places, 'contact.name');
  const chaNames = Object.keys(chusByCha);

  const results: any[] = [];
  for (const chaName of chaNames) {
    const chus = chusByCha[chaName];
    const chuNames = chus.map(chu => chu.resolvedHierarchy[0]?.name.formatted);
    console.log(`CHA: ${chaName} has ${chus.length} CHUs: ${chuNames}`);
    
    const contactDocId = chus.find(chu => chu.resolvedHierarchy[0]?.contactId)?.resolvedHierarchy[0]?.contactId;
    if (!contactDocId) {
      throw Error(`Unresolved contact id`);
    }
      
    const chuIds = chus.map(chu => chu.resolvedHierarchy[0]?.id).filter(Boolean) as string[];
    const userPayload = new UserPayload(chus[0], chuIds, contactDocId);
    const result = await userPayload.create(chtApi);
    console.log(`Username: ${result.username} Password: ${result.password}`);
    results.push(_.pick(result, ['fullname', 'username', 'password']));
  }

  console.table(results);
})();

function loadFromCsv(session: ChtSession, chtApi: ChtApi): Promise<Place[]> {
  const csvBuffer = fs.readFileSync(csvFilePath);
  const chuType = Config.getContactType('c_community_health_unit');
  chuType.username_from_place = false;

  const sessionCache = SessionCache.getForSession(session);
  return PlaceFactory.createFromCsv(csvBuffer, chuType, sessionCache, chtApi);
}

function assertAllPlacesValid(places: Place[]) {
  const withErrors = places.filter(place => place.hasValidationErrors);
  for (const place of withErrors) {
    const placeDescription = `"${place.hierarchyProperties.replacement.original}" at "${place.hierarchyProperties.SUBCOUNTY.original}"`;
    console.log(`Place ${placeDescription} has validation errors:`);
    const validationErrors = Object.values(place.validationErrors || {});
    for (const validationError of validationErrors) {
      console.log(`* ${validationError}`);
    }
  }

  if (withErrors.length) {
    throw Error('Some places had validation errors. See logs.');
  }

  const notReplacement = places.find(place => !place.resolvedHierarchy[0]);
  if (notReplacement) {
    throw Error('Invalid CSV Format. Some rows are not CHU replacements');
  }
}
