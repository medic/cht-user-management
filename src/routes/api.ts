import _ from 'lodash';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import { FastifyInstance } from 'fastify';
import Fuse from 'fuse.js';
import Place from '../services/place';
import PlaceFactory from '../services/place-factory';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import WarningSystem from '../warnings';

const DEFAULT_THRESHOLD = 0.6;

type SearchResult = {
  uuid: string;
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
    const queryParams: any = req.query;
    const { type } = queryParams;

    const formBody: any = req.body;

    const contactType = Config.getContactType(type);
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
      return { errors: place.validationErrors };
    }

    await WarningSystem.setWarnings(contactType, chtApi, req.sessionCache);
    await fastify.uploadManager.doUpload([place], chtApi);

    return {
      place_id: place.id,
      contact_id: place.contact.id,
      warnings: place.warnings,
    };
  });

  fastify.post('/api/v1/search', async (req) => {
    const queryParams: any = req.query;
    const { type } = queryParams;
    const threshold = queryParams.threshold !== undefined
      ? parseFloat(queryParams.threshold)
      : DEFAULT_THRESHOLD;

    const formBody: any = req.body;

    const contactType = Config.getContactType(type);
    const [baseHierarchyLevel] = Config.getHierarchyWithReplacement(contactType);

    const chtApi = new ChtApi(req.chtSession);

    const { sessionCache } = req;
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
        uuid: item.id,
        score: score ?? 1,
      }))
      .sort((a, b) => a.score - b.score);

    return hits;
  });
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
