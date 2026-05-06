import _ from 'lodash';
import { FastifyInstance } from 'fastify';
import Fuse from 'fuse.js';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import SearchLib from '../lib/search';

const DEFAULT_THRESHOLD = 0.6;

type SearchResult = {
  name: string;
  threshold: number;
  uuid: string;
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
    const relevantFields = hierarchyLevels.map(level => level.property_name);
    const relevantData = _.pick(formBody, relevantFields);

    const hierarchyLevel = hierarchyLevels[0];
    if (!hierarchyLevel) {
      throw Error(`no hierarchy level configured for type "${type}"`);
    }

    const chtApi = new ChtApi(req.chtSession);

    const searchResults = await SearchLib.search(
      contactType,
      relevantData,
      '',
      hierarchyLevel,
      chtApi,
      req.sessionCache,
    );

    const candidates = searchResults
      .filter(r => r.type !== 'invalid')
      .map(r => ({ name: r.name.formatted, uuid: r.id }));

    const fuse = new Fuse(candidates, {
      keys: ['name'],
      includeScore: true,
      threshold: 1.0,
      ignoreLocation: true,
    });

    const hits: SearchResult[] = fuse
      .search(formBody[hierarchyLevel.property_name] ?? '')
      .map(({ item, score }) => ({
        name: item.name,
        uuid: item.uuid,
        // Fuse score: 0 = perfect, 1 = no match
        threshold: 1 - (score ?? 1),
      }))
      .filter(h => h.threshold >= threshold)
      .sort((a, b) => b.threshold - a.threshold);

    return hits;
  });
}
