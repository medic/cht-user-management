import { ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { ChtApi } from './cht-api';
import RemotePlaceResolver from './remote-place-resolver';
import Place from '../services/place';

import { JobParams, IQueue, getMoveContactQueue } from '../lib/queues';
import Auth from './authentication';
import { MoveContactData } from '../worker/move-contact-worker';

export default class MoveLib {
  constructor() { }

  public static async move(
    formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi, moveContactQueue: IQueue = getMoveContactQueue()
  ) {
    const fromLineage = await resolve('from_', formData, contactType, sessionCache, chtApi);
    const toLineage = await resolve('to_', formData, contactType, sessionCache, chtApi);

    const toId = toLineage[1]?.id;
    const fromId = fromLineage[0]?.id;
    if (!toId || !fromId) {
      throw Error('Unexpected error: Move failed');
    }

    if (toId === fromLineage[1]?.id) {
      throw Error(`Place "${fromLineage[0]?.name.original}" already has "${toLineage[1]?.name.original}" as parent`);
    }

    const jobName = this.getJobName(fromLineage, toLineage);
    const jobData = this.getJobData(fromId, toId, chtApi);
    const jobParam: JobParams = {
      jobName,
      jobData,
    };
    await moveContactQueue.add(jobParam);
    
    return {
      toLineage,
      fromLineage,
      success: true
    };
  }

  private static getJobName(fromLineage: any, toLineage: any): string {
    return `move_[${fromLineage[0]?.name}]_from_[${fromLineage[1]?.name}]_to_[${toLineage[1]?.name}]`;
  }

  private static getJobData(fromId: string, toId: string, chtApi: ChtApi):MoveContactData {
    const { authInfo } = chtApi.chtSession;
    return {
      contactId: fromId,
      parentId: toId,
      instanceUrl: `http${authInfo.useHttp ? '' : 's'}://${authInfo.domain}`,
      sessionToken: Auth.encodeTokenForWorker(chtApi.chtSession),
    };
  }
}

async function resolve(prefix: string, formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
  const place = new Place(contactType);
  place.setPropertiesFromFormData(formData, prefix);
  await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
  place.validate();

  const validationError = place.validationErrors && Object.keys(place.validationErrors).find(err => err.startsWith(prefix));
  if (validationError) {
    throw Error(place.validationErrors?.[validationError]);
  }

  return place.resolvedHierarchy;
}
