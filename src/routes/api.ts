import _ from 'lodash';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import { FastifyInstance } from 'fastify';
import Fuse from 'fuse.js';
import Place, { PlaceUploadState } from '../services/place';
import PlaceFactory from '../services/place-factory';
import ManageHierarchyLib from '../lib/manage-hierarchy';
import SessionCache from '../services/session-cache';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import WarningSystem from '../warnings';
import { DisableUsers } from '../lib/disable-users';

const DEFAULT_THRESHOLD = 0.6;

type SearchResult = {
  place_id: string;
  name: string;
  score: number;
};

type HierarchyResolutionError = {
  error: string;
  isAmbiguous: boolean;
  parentMissing: boolean;
};

export default async function api(fastify: FastifyInstance) {
  fastify.post('/api/v1/create', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const contactType = Config.getContactType(formBody.type);
    const chtApi = new ChtApi(req.chtSession);
    const sessionCache = req.sessionCache;

    // API requests are intended to be atomic and should not rely on the state of the session
    sessionCache.removeAll();

    const place = await PlaceFactory.createOne(formBody, contactType, sessionCache, chtApi, '');

    const hierarchyError = hierarchyResolutionError(place);
    if (hierarchyError) {
      return hierarchyError;
    }

    place.validate();
    if (place.hasValidationErrors) {
      return { success: false, errors: place.validationErrors };
    }

    await WarningSystem.setWarnings(contactType, chtApi, req.sessionCache);
    await fastify.uploadManager.doUpload([place], chtApi, true);

    if (place.state !== PlaceUploadState.SUCCESS) {
      return { success: false, errors: place.uploadError };
    }

    return {
      place_id: place.creationDetails.placeId,
      contact_id: place.creationDetails.contactId,
      username: place.creationDetails.username,
      password: place.creationDetails.password,
      warnings: place.warnings,
    };
  });

  fastify.post('/api/v1/search', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    const resolution = await resolvePlacesFromHierarchy(formBody, getThreshold(req.query), chtApi, req.sessionCache);
    if ('error' in resolution) {
      return resolution;
    }

    return resolution.hits;
  });

  fastify.post('/api/v1/deactivate-users', async (req) => {
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);

    const chtApi = new ChtApi(req.chtSession);
    const resolution = await resolvePlacesFromHierarchy(formBody, getThreshold(req.query), chtApi, req.sessionCache);
    if ('error' in resolution) {
      return resolution;
    }

    const [facility] = resolution.hits;
    if (!facility) {
      return { success: false, error: 'no facility found matching the provided hierarchy' };
    }

    const deactivated = await DisableUsers.deactivateUsersAt([facility.place_id], chtApi);
    return {
      place_id: facility.place_id,
      place_name: facility.name,
      deactivated,
    };
  });

  fastify.post('/api/v1/manage-hierarchy', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    
    const formBody: any = req.body;
    ensureJsonObjectBody(formBody);
    const contactType = Config.getContactType(formBody.place_type);

    try {
      const job = await ManageHierarchyLib.getJobDetails(
        formBody,
        contactType,
        sessionCache,
        chtApi
      );

      await ManageHierarchyLib.scheduleJob(job);

      return {
        jobName: job.jobName,
        action: job.jobData.action,
        instanceUrl: job.jobData.instanceUrl,
        sourceId: job.jobData.sourceId,
        destinationId: job.jobData.destinationId,
      };
    } catch (e: any) {
      return { error: e.toString() };
    }
  });
}

function ensureJsonObjectBody(body: unknown) {
  if (!_.isPlainObject(body)) {
    throw new Error('body expected as application/json');
  }
}

function getThreshold(query: unknown): number {
  const threshold = (query as any)?.threshold;
  return threshold !== undefined ? parseFloat(threshold) : DEFAULT_THRESHOLD;
}

// Resolves the parent hierarchy from form data and fuzzy-matches the base-level place by name,
// returning the candidate places ranked best-first. Shared by /search and /deactivate-users so
// both resolve a facility identically.
async function resolvePlacesFromHierarchy(
  formBody: any,
  threshold: number,
  chtApi: ChtApi,
  sessionCache: SessionCache,
): Promise<HierarchyResolutionError | { hits: SearchResult[] }> {
  const contactType = Config.getContactType(formBody.type);
  const [baseHierarchyLevel] = Config.getHierarchyWithReplacement(contactType);

  // API requests are intended to be atomic and should not rely on the state of the session
  sessionCache.removeAll();

  const data = _.pick(formBody, Config.getHierarchyWithReplacement(contactType).slice(1).map(l => l.property_name));
  const place = await PlaceFactory.createOne(data, contactType, sessionCache, chtApi, '');

  const hierarchyError = hierarchyResolutionError(place);
  if (hierarchyError) {
    return hierarchyError;
  }

  const parentId = place.resolvedHierarchy[1]?.id;
  const placesHavingParent = (await RemotePlaceCache.getRemotePlaces(chtApi, contactType, baseHierarchyLevel))
    .filter(remotePlace => remotePlace.lineage[0] === parentId);

  const fuse = new Fuse(placesHavingParent, {
    keys: ['name.formatted'],
    includeScore: true,
    threshold,
  });

  const hits: SearchResult[] = fuse
    .search(formBody[baseHierarchyLevel.property_name] ?? '')
    .map(({ item, score }) => ({
      name: item.name.original,
      place_id: item.id,
      score: score ?? 1,
    }))
    .sort((a, b) => a.score - b.score);

  return { hits };
}

function hierarchyResolutionError(place: Place): HierarchyResolutionError | null {
  const invalidIndex = place.resolvedHierarchy.findIndex(level => level?.type === 'invalid');
  if (invalidIndex === -1) {
    return null;
  }

  const invalid = place.resolvedHierarchy[invalidIndex];
  return {
    error: `hierarchy cannot be resolved: index ${invalidIndex} - ${invalid?.name.formatted}`,
    isAmbiguous: invalid?.id === RemotePlaceResolver.Multiple.id,
    parentMissing: invalid?.id === RemotePlaceResolver.NoResult.id,
  };
}
