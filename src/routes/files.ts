import { FastifyInstance } from "fastify";
import { transform, stringify } from "csv/sync";
import { placeWithCreds } from "../services/models";

export default async function files(fastify: FastifyInstance) {
  const { cache } = fastify;

  fastify.get("/files/template", async (req, resp) => {
    const columns = ["place", "contact", "sex", "phone"];
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
