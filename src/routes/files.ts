import _ from 'lodash';
import { FastifyInstance } from 'fastify';
import { transform, stringify } from 'csv/sync';
import { Config } from '../config';
import SessionCache from '../services/session-cache';
import Place from '../services/place';

export default async function files(fastify: FastifyInstance) {
  fastify.get('/plugin/user-management/files/template/:placeType', async (req) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const placeTypeConfig = Config.getContactType(placeType);
    const hierarchy = Config.getHierarchyWithReplacement(placeTypeConfig);
    const columns = _.uniq([
      ...hierarchy.map(p => p.friendly_name),
      ...placeTypeConfig.place_properties.map(p => p.friendly_name),
      ...placeTypeConfig.contact_properties.map(p => p.friendly_name),
    ]);

    return stringify([columns]);
  });

  fastify.get('/plugin/user-management/files/credentials', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    const places = sessionCache.getPlaces();
    const refinedRecords = transform(places, (place: Place) => {
      return [
        place.type.friendly,
        place.name,
        place.creationDetails.username,
        place.creationDetails.password,
        place.creationDetails.disabledUsers,
      ];
    });

    return stringify(refinedRecords);
  });
}
