import _ from "lodash";
import { FastifyInstance } from "fastify";
import { transform, stringify } from "csv/sync";
import { Config } from "../lib/config";
import SessionCache from "../services/session-cache";
import Place from "../services/place";

export default async function files(fastify: FastifyInstance) {
  fastify.get("/files/template/:placeType", async (req, resp) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const placeTypeConfig = Config.getContactType(placeType);
    const columns = _.uniq([
      'replacement',
      ...placeTypeConfig.place_properties.map(p => p.csv_name),
      ...placeTypeConfig.contact_properties.map(p => p.csv_name),
    ]);

    return stringify([columns]);
  });

  fastify.get("/files/credentials", async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const uploaded = sessionCache.getPlaces({ created: true });
    const refinedRecords = transform(uploaded, (place: Place) => {
      return [
        place.type.name,
        place.name,
        place.contact.name,
        place.parentDetails?.id,
        place.parentDetails?.name,
        place.creationDetails.placeId,
        place.creationDetails.contactId,
        place.creationDetails.username,
        place.creationDetails.password,
        place.creationDetails.disabledUsers,
      ];
    });

    return stringify(refinedRecords);
  });
}
