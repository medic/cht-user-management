import _ from "lodash";
import { FastifyInstance } from "fastify";

import { Config } from "../lib/config";
import { ChtApi, ParentDetails } from "../lib/cht-api";
import SessionCache from "../services/session-cache";
import PlaceResolver from "../lib/place-resolver";
import Place from "../services/place";

export default async function place(fastify: FastifyInstance) {
  // returns search results dropdown
  fastify.post('/search', async (req, resp) => {
    const queryParams: any = req.query;
    const { op, place_id: placeId, type, scenario } = queryParams;

    const data: any = req.body;
    
    if (!type) {
      throw Error('missing type');
    }
    const dataKey = getDataKeyFromScenario(scenario);
    const searchString: string = data[dataKey].toLowerCase();
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!place && op === 'edit') {
      throw Error('must have place_id when editing');
    }

    if (searchString.length < 3) {
      throw Error('search is too short');
    }

    const localResults = await sessionCache.getPlaces({
      type,
      nameIncludes: searchString,
      created: false,
    });
    const chtApi = new ChtApi(req.chtSession);
    const allPlacesWithType = await chtApi.getPlacesWithType(type, undefined);
    const remoteResults = allPlacesWithType.filter(place => place.name.includes(searchString));
    const searchResults: string[] = _.uniq([
      ...localResults.map(r => r.name),
      ...remoteResults.map(r => r.name),
    ]);
    if (searchResults.length === 0) {
      searchResults.push(PlaceResolver.NoResult.name);
    }

    return resp.view("src/public/components/search_results.html", {
      op,
      place,
      searchResults,
      scenario,
    });
  });

  // when we select a place from search results
  fastify.post("/search/select", async (req, resp) => {
    const data: any = req.body;
    const params: any = req.query;
    const { op = 'new', place_id: placeId, result_name: resultName, scenario } = params;

    const isEditing = op === 'edit';
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(placeId);
    if (!resultName) {
      throw new Error('result must be known');
    }

    const contactType = Config.getContactType(data.place_type);
    const dataKey = getDataKeyFromScenario(scenario);
    data[dataKey] = resultName;
    
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
    }

    return resp.view("src/public/components/form_switch.html", tmplData);
  });
}

const getDataKeyFromScenario = (scenario: string) => {
  if (['place_replacement', 'place_PARENT'].includes(scenario)) {
    return scenario;
  }

  throw new Error('unknown scenario');
};
