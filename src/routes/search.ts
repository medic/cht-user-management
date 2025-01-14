import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import { RemotePlace } from '../lib/remote-place-cache';
import SessionCache from '../services/session-cache';
import SearchLib from '../lib/search';

import { HIERARCHY_ACTIONS } from '../lib/manage-hierarchy';
import { hierarchyViewModel } from '../services/hierarchy-view-model';

export default async function place(fastify: FastifyInstance) {
  // returns search results dropdown
  fastify.post('/search', async (req, resp) => {
    const queryParams: any = req.query;
    const {
      op,
      place_id: placeId,
      type,
      prefix: dataPrefix
    } = queryParams;
    const level = parseInt(queryParams.level);

    const data: any = req.body;

    const contactType = await Config.getContactType(type);
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!place && op === 'edit') {
      throw Error('must have place_id when editing');
    }

    const chtApi = new ChtApi(req.chtSession);
    const hierarchyLevel = Config.getHierarchyWithReplacement(contactType).find(hierarchy => hierarchy.level === level);
    if (!hierarchyLevel) {
      throw Error(`not hierarchy constraint at ${level}`);
    }
    const searchResults: RemotePlace[] = await SearchLib.search(contactType, data, dataPrefix, hierarchyLevel, chtApi, sessionCache);

    return resp.view('src/liquid/components/search_results.html', {
      op,
      place,
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
      op = 'new',
      place_id: placeId,
      result_name: resultName,
      prefix: dataPrefix,
    } = queryParams;
    const level = parseInt(queryParams.level);

    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!resultName) {
      throw new Error('result must be known');
    }

    const contactType = await Config.getContactType(data.place_type);
    let moveModel;
    if (HIERARCHY_ACTIONS.includes(op)) {
      moveModel = hierarchyViewModel(op, contactType);
    }

    const hierarchyLevel =  Config.getHierarchyWithReplacement(contactType).find(hierarchy => hierarchy.level === level);
    if (!hierarchyLevel) {
      throw Error(`not hierarchy constraint at ${level}`);
    }
    data[`${dataPrefix}${hierarchyLevel.property_name}`] = resultName;

    const tmplData: any = {
      op,
      data,
      place,
      contactType,
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      userRoleProperty: Config.getUserRoleConfig(contactType),
      ...moveModel,
    };

    if (op === 'edit') {
      if (!place) {
        throw new Error('unknown place while editing');
      }

      tmplData.backend = `/place/edit/${place.id}`;
    } else if (HIERARCHY_ACTIONS.includes(op)) {
      tmplData.backend = `/manage-hierarchy`;
    }

    return resp.view('src/liquid/app/form_switch.html', tmplData);
  });
}
