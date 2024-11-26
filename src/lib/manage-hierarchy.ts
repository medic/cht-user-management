import { ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { ChtApi, RemotePlace } from './cht-api';
import RemotePlaceResolver from './remote-place-resolver';
import Place from '../services/place';

import { JobParams, IQueue, getChtConfQueue } from './queues';
import Auth from './authentication';
import { ChtConfJobData } from '../worker/cht-conf-worker';
import _ from 'lodash';

export const HIERARCHY_ACTIONS = ['move', 'merge', 'delete'];
export type HierarchyAction = typeof HIERARCHY_ACTIONS[number];

export default class ManageHierarchyLib {
  private constructor() { }

  public static async scheduleJob(
    formData: any,
    contactType: ContactType,
    sessionCache: SessionCache,
    chtApi: ChtApi,
    queueName: IQueue = getChtConfQueue()
  ) {
    const { sourceLineage, destinationLineage, jobParam } = await getJobDetails(formData, contactType, sessionCache, chtApi);

    await queueName.add(jobParam);
    
    return {
      destinationLineage,
      sourceLineage,
      success: true
    };
  }

  public static parseHierarchyAction(action: string = ''): HierarchyAction {
    if (!HIERARCHY_ACTIONS.includes(action)) {
      throw Error(`invalid action: "${action}"`);
    }
  
    return action as HierarchyAction;
  }
}

async function getJobDetails(formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
  const hierarchyAction = ManageHierarchyLib.parseHierarchyAction(formData.op);
  const sourceLineage = await resolve('source_', formData, contactType, sessionCache, chtApi);
  const destinationLineage = hierarchyAction === 'delete' ? [] : await resolve('destination_', formData, contactType, sessionCache, chtApi);
  
  const { sourceId, destinationId } = getSourceAndDestination();
  const jobData = getJobData(hierarchyAction, sourceId, destinationId, chtApi);
  const jobName = getJobName(jobData.action, sourceLineage, destinationLineage);
  const jobParam: JobParams = {
    jobName,
    jobData,
  };

  return {
    sourceLineage,
    destinationLineage,
    jobParam
  };

  function getSourceAndDestination() {
    if (hierarchyAction === 'move') {
      const sourceId = sourceLineage[0]?.id;
      const destinationId = destinationLineage[1]?.id;
      if (!destinationId || !sourceId) {
        throw Error('Unexpected error: Move failed due to missing information');
      }

      if (destinationId === sourceLineage[1]?.id) {
        throw Error(`Place "${sourceLineage[0]?.name}" already has "${destinationLineage[1]?.name}" as parent`);
      }

      return { sourceId, destinationId };
    }

    if (hierarchyAction === 'merge') {
      const sourceId = sourceLineage[0]?.id;
      const destinationId = destinationLineage[0]?.id;
      if (!destinationId || !sourceId) {
        throw Error('Unexpected error: Merge failed due to missing information');
      }

      if (destinationId === sourceId) {
        throw Error(`Cannot merge "${destinationId}" with self`);
      }

      return { sourceId, destinationId };
    }

    const sourceId = sourceLineage[0]?.id;
    if (!sourceId) {
      throw Error('Unexpected error: Delete failed due to missing information');
    }

    return { sourceId, destinationId: '' };
  }
}

function getJobName(action: string, sourceLineage: (RemotePlace | undefined)[], destinationLineage: (RemotePlace | undefined)[]): string {
  const sourceDescription = describeLineage(sourceLineage);
  const destinationDescription = describeLineage(destinationLineage);
  const formattedDestinationDescription = destinationDescription && `_to_[${destinationDescription}]`;
  return `${action}_[${sourceDescription}]${formattedDestinationDescription}`;

  function describeLineage(lineage: (RemotePlace | undefined)[]) : string | undefined {
    return _.reverse([...lineage])
      .map(element => element?.name)
      .filter(Boolean)
      .join('.');
  }
}

function getJobData(action: HierarchyAction, sourceId: string, destinationId: string, chtApi: ChtApi): ChtConfJobData {
  const { authInfo } = chtApi.chtSession;
  return {
    action,
    instanceUrl: `http${authInfo.useHttp ? '' : 's'}://${authInfo.domain}`,
    sessionToken: Auth.encodeTokenForWorker(chtApi.chtSession),
    sourceId,
    destinationId,
  };
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
