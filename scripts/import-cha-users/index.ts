import _ from 'lodash';
import fs from 'fs';

import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import Place from '../../src/services/place';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import createUsersFromPlaces from './create-user';
import UsernameDictionary from './cha-usernames';
import reassignUsersFromPlaces from './reassign-chu-to-cha';

const authInfo = {
  friendly: 'Local Dev',
  domain: 'localhost:5988',
  useHttp: true,
};
const username = 'medic';
const password = 'password';
const csvFilePath = './Import CHAs.csv';

(async function() {
  const session = await ChtSession.create(authInfo, username, password);
  const chtApi = new ChtApi(session);
  const places: Place[] = await loadFromCsv(session, chtApi);
  
  assertAllPlacesValid(places);

  const usernames = new UsernameDictionary();
  
  const {
    true: placesNeedingNewUser,
    false: placesNeedingReassign
  } = _.groupBy(places, place => usernames.needsNewUser(place));

  await createUsersFromPlaces(placesNeedingNewUser, chtApi);
  await reassignUsersFromPlaces(placesNeedingReassign, usernames, chtApi);
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
