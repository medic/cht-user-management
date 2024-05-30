import * as fs from 'fs';

import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import Place from '../../src/services/place';

const username = 'kenn_sippell_medic_user_manager';
const password = '';
const authInfo = Config.getAuthenticationInfo('nairobi-echis.health.go.ke');
const contactType = Config.getContactType('d_community_health_volunteer_area');

(async () => {
  const session = await ChtSession.create(authInfo, username, password);
  const chtApi = new ChtApi(session);
  const sessionCache = SessionCache.getForSession(session);
  
  const file = fs.readFileSync('./nairobi.csv');
  const places = await PlaceFactory.createFromCsv(file, contactType, sessionCache, chtApi);
  const batch = places /*.slice(0, 20) */;
  const results:any[] = [];
  for (const place of batch) {
    let error = await doPlace(place, chtApi);
    console.log(error);
    results.push({
      originalName: place.hierarchyProperties.replacement,
      error,
    });
  }

  console.table(results);
})();

async function doPlace(place: Place, chtApi: ChtApi) {
  let error = Object.values(place.validationErrors || {}).join(';');
  if (error) {
    return error;
  }

  const newName = place.contact.name;
  const docId = place.resolvedHierarchy?.[0]?.id;
  if (!docId) {
    return 'wtf-place';
  }

  console.log(`Renaming ${place.hierarchyProperties.replacement} to ${newName} (${docId})`);

  const placeDoc = await chtApi.getDoc(docId);
  const newAreaName = `${newName} Area`;
  if (newAreaName === placeDoc.name) {
    return 'skipped';
  }

  placeDoc.name = newAreaName;

  const contactId = typeof placeDoc.contact === 'string' ? placeDoc.contact : placeDoc.contact?._id;
  let contactDoc;
  if (!contactId) {
    error = 'wtf-contact';
  } else {
    contactDoc = await chtApi.getDoc(contactId);
    contactDoc.name = newName;
  }

  const toWrite = [placeDoc, contactDoc].filter(Boolean);
  const response = await chtApi.axiosInstance.post('/medic/_bulk_docs', { docs: toWrite });
  error = response.data.map((d: any) => d.ok).join(',');

  return error;
}

