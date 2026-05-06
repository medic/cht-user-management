import _ from 'lodash';
import { FastifyInstance } from 'fastify';
import Fuse from 'fuse.js';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import SearchLib from '../lib/search';
import PlaceFactory from '../services/place-factory';
import sessionCache from './app';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import RemotePlaceCache from '../lib/remote-place-cache';

const DEFAULT_THRESHOLD = 0.6;

type SearchResult = {
  uuid: string;
  name: string;
  score: number;
};

export default async function apiSearch(fastify: FastifyInstance) {
  fastify.post('/api/v1/search', async (req) => {
    const queryParams: any = req.query;
    const { type } = queryParams;
    const threshold = queryParams.threshold !== undefined
      ? parseFloat(queryParams.threshold)
      : DEFAULT_THRESHOLD;

    const formBody: any = req.body;

    const contactType = Config.getContactType(type);
    const hierarchyLevels = Config.getHierarchyWithReplacement(contactType);

    const relevantFields = hierarchyLevels.slice(1).map(level => level.property_name);
    const relevantData = _.pick(formBody, relevantFields);

    const [baseHierarchyLevel] = hierarchyLevels;
    const chtApi = new ChtApi(req.chtSession);
    const place = await PlaceFactory.createOne(relevantData, contactType, req.sessionCache, chtApi, '');
    await RemotePlaceResolver.resolveOne(place, req.sessionCache, chtApi, { fuzz: true });

    const invalidIndex = place.resolvedHierarchy.findIndex(level => level?.type === 'invalid');
    if (invalidIndex !== -1) {
      const invalid = place.resolvedHierarchy[invalidIndex];
      const isAmbiguous = invalid?.id === RemotePlaceResolver.Multiple.id;
      const parentMissing = invalid?.id === RemotePlaceResolver.NoResult.id;
      
      return {
        error: `hierarchy cannot be resolved: index ${invalidIndex} - ${invalid?.name.formatted}`,
        isAmbiguous,
        parentMissing,
      };
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
