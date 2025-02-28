import _ from 'lodash';
import { DateTime } from 'luxon';

import Auth from './authentication';
import { ChtApi } from './cht-api';
import { ChtConfJobData } from '../worker/cht-conf-worker';
import { ContactType } from '../config';
import { JobParams, IQueue, getChtConfQueue } from './queues';
import Place from '../services/place';
import RemotePlaceResolver from './remote-place-resolver';
import SessionCache from '../services/session-cache';
import { RemotePlace } from './remote-place-cache';

export const HIERARCHY_ACTIONS = ['move', 'merge', 'delete'];
export type HierarchyAction = typeof HIERARCHY_ACTIONS[number];

const ACTIVE_USER_THRESHOLD_DAYS = 60;
const LARGE_PLACE_THRESHOLD_PLACE_COUNT = 100;

export type WarningInformation = {
  affectedPlaceCount: number;
  lastSyncDescription: string;
  userIsActive: boolean;
  lotsOfPlaces: boolean;
};

export default class ManageHierarchyLib {
  private constructor() { }

  public static async scheduleJob(job: JobParams, queueName: IQueue = getChtConfQueue()) {
    await queueName.add(job);
  }

  public static parseHierarchyAction(action: string = ''): HierarchyAction {
    if (!HIERARCHY_ACTIONS.includes(action)) {
      throw Error(`invalid action: "${action}"`);
    }
  
    return action as HierarchyAction;
  }

  public static async getJobDetails(formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi): Promise<JobParams> {
    const hierarchyAction = ManageHierarchyLib.parseHierarchyAction(formData.op);
    const sourceLineage = await resolve('source_', formData, contactType, sessionCache, chtApi);
    const destinationLineage = hierarchyAction === 'delete' ? [] : await resolve('destination_', formData, contactType, sessionCache, chtApi);

    const { sourceId, destinationId } = getSourceAndDestinationIds(hierarchyAction, sourceLineage, destinationLineage);
    const jobData = getJobData(hierarchyAction, sourceId, destinationId, chtApi);
    const jobName = getJobName(jobData.action, sourceLineage, destinationLineage);
    const jobParam: JobParams = {
      jobName,
      jobData,
    };

    return jobParam;
  }

  public static async getWarningInfo(job: JobParams, chtApi: ChtApi): Promise<WarningInformation> {
    const { jobData: { sourceId } } = job;
    const affectedPlaceCount = await chtApi.countContactsUnderPlace(sourceId);
    const lastSyncTime = chtApi.chtSession.isAdmin ? await chtApi.lastSyncAtPlace(sourceId) : DateTime.invalid('must be admin');
    const syncBelowThreshold = diffNowInDays(lastSyncTime) < ACTIVE_USER_THRESHOLD_DAYS;
    const lastSyncDescription = describeDateTime(lastSyncTime);
    return {
      affectedPlaceCount,
      lastSyncDescription,
      userIsActive: syncBelowThreshold && lastSyncDescription !== '-',
      lotsOfPlaces: affectedPlaceCount > LARGE_PLACE_THRESHOLD_PLACE_COUNT,
    };
  }
}

function diffNowInDays(dateTime: DateTime): number {
  return -(dateTime?.diffNow('days')?.days || 0);
}

function describeDateTime(dateTime: DateTime): string {
  if (!dateTime || !dateTime.isValid) {
    return '-';
  }

  const diffNow = diffNowInDays(dateTime);
  if (diffNow > 365) {
    return 'over a year';
  }

  if (diffNow < 0) {
    return '-';
  }

  return dateTime.toRelativeCalendar() || '-';
}

function getSourceAndDestinationIds(
  hierarchyAction: HierarchyAction,
  sourceLineage: (RemotePlace | undefined)[], 
  destinationLineage: (RemotePlace | undefined)[]
) {
  const sourceId = sourceLineage[0]?.id;
  if (!sourceId) {
    throw Error('Unexpected error: Hierarchy operation failed due to missing source information');
  }

  if (hierarchyAction === 'delete') {
    return { sourceId, destinationId: '' };
  }

  const destinationIndex = hierarchyAction === 'move' ? 1 : 0;
  const destinationId = destinationLineage[destinationIndex]?.id;
  if (!destinationId) {
    throw Error('Unexpected error: Hierarchy operation failed due to missing destination information');
  }


  if (hierarchyAction === 'move') {
    if (destinationId === sourceLineage[1]?.id) {
      throw Error(`Place "${sourceLineage[0]?.name.original}" already has "${destinationLineage[1]?.name.original}" as parent`);
    }
  }
  
  if (hierarchyAction === 'merge') {
    if (destinationId === sourceId) {
      throw Error(`Cannot merge place with self`);
    }
  }

  return { sourceId, destinationId };
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

  const validationError = place.validationErrors && Object.keys(place.validationErrors).find(err => err.startsWith(prefix));
  if (validationError) {
    throw Error(place.validationErrors?.[validationError]);
  }

  return place.resolvedHierarchy;
}
