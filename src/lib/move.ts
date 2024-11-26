import { ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { ChtApi } from './cht-api';
import RemotePlaceResolver from './remote-place-resolver';
import Place from '../services/place';

import { JobParams, IQueue, getMoveContactQueue } from '../lib/queues';
import Auth from './authentication';
import { ChtConfJobData } from '../worker/cht-conf-worker';

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
      throw Error(`Place "${fromLineage[0]?.name}" already has "${toLineage[1]?.name}" as parent`);
    }

    const jobData = this.getJobData(fromId, toId, chtApi);
    const jobName = this.getJobName(fromLineage[0]?.name, fromLineage[1]?.name, toLineage[1]?.name);
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

  private static getJobName(sourceChpName?: string, sourceChuName?: string, destinationChuName?: string): string {
    return `move_[${sourceChpName}]_from_[${sourceChuName}]_to_[${destinationChuName}]`;
  }

  private static getJobData(sourceId: string, destinationId: string, chtApi: ChtApi): ChtConfJobData {
    const { authInfo } = chtApi.chtSession;
    return {
      instanceUrl: `http${authInfo.useHttp ? '' : 's'}://${authInfo.domain}`,
      sessionToken: Auth.encodeTokenForWorker(chtApi.chtSession),
      action: 'move',
      sourceId,
      destinationId,
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
