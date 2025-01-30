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

export default async function createUsersFromPlaces(places: Place[], chtApi: ChtApi): Promise<CreatedUser[]> {
  const chusByCha = _.groupBy(places, 'contact.name');
  const chaNames = Object.keys(chusByCha);
  if (!chaNames.length) {
    return [];
  }

  await promptToCreate(chaNames);

  const results: CreatedUser[] = [];
  for (const chaName of chaNames) {
    const chus = chusByCha[chaName];
    const created = await createCha(chus, chaName, chtApi);
    results.push(created);
  }

  console.log(`Created users:`);
  console.table(results);
  return results;
}

async function createCha(chus: Place[], chaName: string, chtApi: ChtApi): Promise<CreatedUser> {
  const chuNames = chus.map(chu => chu.resolvedHierarchy[0]?.name.formatted);
  console.log(`CHA: ${chaName} has ${chus.length} CHUs: ${chuNames}`);

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

