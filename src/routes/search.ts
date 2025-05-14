import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import RemotePlaceCache, { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';
import SearchLib from '../lib/search';

export default async function place(fastify: FastifyInstance) {
  // returns search results dropdown
  fastify.post('/search', async (req, resp) => {
    const queryParams: any = req.query;
    const { op, place_id: placeId, type, prefix: dataPrefix } = queryParams;
    const level = parseInt(queryParams.level);
    const bustcache = parseInt(queryParams.fresh) === 1;

    const data: any = req.body;

    const contactType = Config.getContactType(type);
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!place && op === 'edit') {
      throw Error('must have place_id when editing');
    }

    const chtApi = new ChtApi(req.chtSession);
    const hierarchyLevel = Config.getHierarchyWithReplacement(contactType).find(
      (hierarchy) => hierarchy.level === level
    );
    if (!hierarchyLevel) {
      throw Error(`not hierarchy constraint at ${level}`);
    }

    if (bustcache) {
      RemotePlaceCache.clear(chtApi, hierarchyLevel.contact_type);
    }

    const searchResults: RemotePlace[] = await SearchLib.search(
      contactType,
      data,
      dataPrefix,
      hierarchyLevel,
      chtApi,
      sessionCache
    );

    return resp.view('src/liquid/components/search_results.liquid', {
      op,
      place,
      div: `search_container_${dataPrefix}${hierarchyLevel.property_name}`,
      prefix: dataPrefix,
      searchResults,
      level,
    });
  });

  // when we select a place from search results
  fastify.post('/search/select', async (req, resp) => {
    const data: any = req.body;
    const queryParams: any = req.query;
    const {
      op,
      result_name: resultName,
      place_id,
      prefix: dataPrefix,
    } = queryParams;
    const level = parseInt(queryParams.level);
    const contactType = Config.getContactType(data.place_type);
    const hierarchyLevel = Config.getHierarchyWithReplacement(contactType).find(
      (hierarchy) => hierarchy.level === level
    );
    if (!hierarchyLevel) {
      throw Error(`not hierarchy constraint at ${level}`);
    }
    data[`${dataPrefix}${hierarchyLevel.property_name}`] = resultName;
    data[`${dataPrefix}${hierarchyLevel.property_name}_id`] = place_id;
    return resp.view('src/liquid/components/search_input.liquid', {
      op,
      type: contactType.name,
      prefix: dataPrefix,
      hierarchy: hierarchyLevel,
      data,
    });
  });
}
