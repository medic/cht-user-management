import { ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { ChtApi } from '../lib/cht-api';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import Place from '../services/place';
import { BullMQ } from '../queues/bullmq-queue';
import { ConnectionOptions } from 'bullmq';

import { env } from 'process';

const { MOVE_CONTACT_QUEUE, REDIS_HOST, REDIS_PORT } = env;
const connection: ConnectionOptions = {
  host: REDIS_HOST as string,
  port: +(REDIS_PORT as string)
};

export default class MoveLib {
  constructor() { }

  public static async move(formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
    const fromLineage = await resolve('from_', formData, contactType, sessionCache, chtApi);
    const toLineage = await resolve('to_', formData, contactType, sessionCache, chtApi);

    const toId = toLineage[1]?.id;
    const fromId = fromLineage[0]?.id;
    if (!toId || !fromId) {
      throw Error('Unexpected error: Move failed');
    }

    if (toId === fromLineage[1]?.id) {
      throw Error(`Place "${fromLineage[0]?.name}" already has "${toLineage[1]?.name}" as parent`);
    }

    const { authInfo } = chtApi.chtSession;
    const url = `http${authInfo.useHttp ? '' : 's'}://${chtApi.chtSession.username}:password@${authInfo.domain}`;

    // Add moving job to queue
    if (!MOVE_CONTACT_QUEUE) {
      console.error(`Please define MOVE_CONTACT_QUEUE`);
    } else {
      const jobName = `move_contact_job`;
      const movingJobData = {
        name: jobName,
        contactId: fromId,
        parentId: toId,
        instanceUrl: `http${authInfo.useHttp ? '' : 's'}://${authInfo.domain}`,
        sessionCookie: chtApi.chtSession.sessionToken,
      };

      console.log('sending moving data', movingJobData);
      new BullMQ(MOVE_CONTACT_QUEUE, { connection }).add(jobName, movingJobData);
    }

    return {
      command: `npx cht --url=${url} move-contacts upload-docs -- --contacts=${fromId} --parent=${toId}`,
      fromLineage,
      toLineage,
    };
  }
}

async function resolve(prefix: string, formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
  const place = new Place(contactType);
  place.setPropertiesFromFormData(formData, prefix);
  await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
  place.validate();

  const validationError = place.validationErrors && Object.keys(place.validationErrors).find(err => err.startsWith('hierarchy_'));
  if (validationError) {
    throw Error(place.validationErrors?.[validationError]);
  }

  return place.resolvedHierarchy;
}
