import { FastifyInstance } from "fastify";
import { transform, stringify } from "csv/sync";
import { placeWithCreds } from "../services/models";
import { Config } from "../lib/config";

export default async function files(fastify: FastifyInstance) {
  const { cache } = fastify;

  fastify.get("/files/template/:placeType", async (req, resp) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const placeTypeConfig = Config.getContactType(placeType);
    const columns = [
      ...placeTypeConfig.place_properties,
      ...placeTypeConfig.contact_properties
    ].map(p => p.csv_name);

    return stringify([columns]);
  });

  fastify.get("/files/credentials", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const creds = cache.getUserCredentials(workbookId);
    const refinedRecords = transform(creds, function (data: placeWithCreds) {
      return [
        data.placeName,
        data.contactName,
        data.creds.user,
        data.creds.pass,
      ];
    });
    return stringify(refinedRecords);
  });
}
