import _ from 'lodash';
import yesno from 'yesno';

import { ChtApi } from '../../src/lib/cht-api';
import Place from '../../src/services/place';
import { UserPayload } from '../../src/services/user-payload';

export type CreatedUser = {
  subcounty: string;
  name: string;
  username: string;
  password: string;
};

export default async function createMultiplaceUsers(places: Place[], chtApi: ChtApi): Promise<CreatedUser[]> {
  const chusByCha = _.groupBy(places, place => groupByKey(place));
  const chaKeys = Object.keys(chusByCha);
  if (!chaKeys.length) {
    return [];
  }

  await promptToCreate(chaKeys);

  const results: CreatedUser[] = [];
  for (const chaKey of chaKeys) {
    const chus = chusByCha[chaKey];
    const created = await createCha(chus, chtApi);
    results.push(created);
  }

  console.log(`Created users:`);
  console.table(results);
  return results;
}

function groupByKey(place: Place) {
  const subcounty = place.resolvedHierarchy[1]?.name.formatted;
  const contactName = place.contact.name;
  return `${contactName}@${subcounty}`;
}

async function createCha(chus: Place[], chtApi: ChtApi): Promise<CreatedUser> {
  const chaName = chus[0].contact.name;
  const chuNames = chus.map(chu => chu.resolvedHierarchy[0]?.name.formatted);
  console.log(`Creating CHA: ${chaName} with ${chus.length} CHUs: ${chuNames}`);

  const contactDocId = chus.find(chu => chu.resolvedHierarchy[0]?.contactId)?.resolvedHierarchy[0]?.contactId;
  if (!contactDocId) {
    throw Error(`Unresolved contact id`);
  }

  const chuIds = chus.map(chu => chu.resolvedHierarchy[0]?.id).filter(Boolean) as string[];
  const userPayload = new UserPayload(chus[0], chuIds, contactDocId);
  const payload = await userPayload.create(chtApi);
  console.log(`Username: ${payload.username} Password: ${payload.password}`);

  return {
    subcounty: chus[0]?.resolvedHierarchy[1]?.name.formatted || '?',
    name: chaName,
    username: payload.username,
    password: payload.password,
  };
}

async function promptToCreate(chaNames: string[]) {
  const proceed = await yesno({
    question: `Create ${chaNames.length} new users: ${chaNames}?`
  });
  if (!proceed) {
    console.error('Exiting...');
    process.exit(-1);
  }
}

