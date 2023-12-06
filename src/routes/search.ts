import _ from "lodash";
import { FastifyInstance } from "fastify";

import { Config } from "../lib/config";
import { ChtApi } from "../lib/cht-api";
import SessionCache from "../services/session-cache";
import ParentComparator from "../lib/parent-comparator";

export default async function place(fastify: FastifyInstance) {
  // search for a place given its type and name
  // return search results dropdown
  fastify.post("/search/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const { type: placeType } = queryParams;
    const sessionCache: SessionCache = req.sessionCache;  

    const data: any = req.body;
    const searchString = data.place_PARENT;

    const chtApi = new ChtApi(req.chtSession);
    const results = await chtApi.searchPlace(placeType, searchString);
    sessionCache.saveKnownParents(...results);
    if (results.length === 0) {
      results.push(ParentComparator.NoResult);
    }

    return resp.view("src/public/components/replace_user_search_results.html", {
      results,
    });
  });

  // returns search results dropdown
  fastify.post("/search/parent", async (req, resp) => {
    const queryParams: any = req.query;
    const { op, place_id: placeId } = queryParams;

    const data: any = req.body;
    const searchString = data.place_PARENT;

    const contactType = Config.getContactType(queryParams.type);
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!place && op === 'edit') {
      throw Error('must have place_id when editing');
    }

    const localResults = await sessionCache.findKnownPlace(contactType.parent_type, searchString);
    const chtApi = new ChtApi(req.chtSession);
    const remoteResults = await chtApi.searchPlace(contactType.parent_type, searchString);
    sessionCache.saveKnownParents(...remoteResults);

    const results = _.uniqBy([...localResults, ...remoteResults], 'id');
    if (results.length === 0) {
      results.push(ParentComparator.NoResult);
    }

    return resp.view("src/public/components/search_results.html", {
      op,
      contactType,
      place,
      results,
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for the new place's parent
  fastify.post("/search/select", async (req, resp) => {
    const data: any = req.body;
    const params: any = req.query;
    const { op = 'new', place_id: placeId, parent_id: parentId } = params;

    const isEditing = op === 'edit';

    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!parentId) {
      throw new Error('placeId must be known');
    }

    const contactType = Config.getContactType(data.place_type);
    const parent = sessionCache.getKnownParent(parentId);
    data.place_parent = parent?.id;
    data.place_PARENT = parent?.name;

    const tmplData: any = {
      op,
      data,
      place,
      contactType,
    };

    if (isEditing) {
      if (!place) {
        throw new Error('unknown place while editing');
      }

      tmplData.backend = `/place/edit/${place.id}`;
      return resp.view("src/public/app/fragment_edit_form.html", tmplData);
    }

    return resp.view("src/public/components/place_create_form.html", tmplData);
  });
}
