import { FastifyInstance } from "fastify";
import { uploadState } from "../services/models";
import { v4 as uuidv4 } from "uuid";
import { LOCALES } from "../services/cache";
import { Config } from "../lib/config";
import { ChtApi } from "../lib/cht";

export default async function workbook(fastify: FastifyInstance) {
  const { cache } = fastify;

  fastify.get("/", async (req, resp) => {
    const workbookId = uuidv4();
    cache.saveWorkbook(workbookId);
    resp.redirect(`/workbook/${workbookId}`);
  });

  fastify.get("/workbook/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;
    const queryParams: any = req.query;

    const contactTypes = Config.contactTypes();
    const placeTypeName = queryParams.type || contactTypes[0].name;
    const contactType = Config.getContactType(placeTypeName);
    const op = queryParams.op || "new";

    const failed = cache.getPlaceByUploadState(id, uploadState.FAILURE);
    const scheduledJobs = cache.getPlaceByUploadState(
      id,
      uploadState.SCHEDULED
    );

    const tmplData = {
      title: id,
      workbookId: id,
      hierarchy: contactTypes.map(t => t.name),
      contactTypes,
      places: cache.getPlacesForDisplay(id),
      workbookState: cache.getWorkbookState(id)?.state,
      hasFailedJobs: failed.length > 0,
      failedJobCount: failed.length,
      scheduledJobCount: scheduledJobs.length,
      userRoles: contactType.roles,
      locales: LOCALES,
      workbook_locale: cache.getWorkbook(id).locale,
      pagePlaceType: placeTypeName,
      op,
      hasParent: !!contactType.parent_type,
    };

    const isHxReq = req.headers["hx-request"];
    if (isHxReq) {
      const content = await fastify.view(
        "src/public/workbook/content.html",
        tmplData
      );
      const header = await fastify.view(
        "src/public/workbook/view_header.html",
        tmplData
      );
      return content + header;
    }

    return resp.view("src/public/workbook/view.html", tmplData);
  });

  fastify.get("/workbook/:id/add", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;
    const queryParams: any = req.query;

    const contactTypes = Config.contactTypes();
    const placeTypeName = queryParams.type || contactTypes[0].name;
    const contactType = Config.getContactType(placeTypeName);
    if (!contactType) {
      throw new Error(`unrecognized contact type: "${placeTypeName}"`);
    }
    const op = queryParams.op || "new";

    const tmplData = {
      view: "add",
      title: id,
      workbookId: id,
      locales: LOCALES,
      workbook_locale: cache.getWorkbook(id).locale,
      hierarchy: contactTypes.map(t => t.name),
      userRoles: contactType.roles,
      pagePlaceType: placeTypeName,
      op,
      hasParent: !!contactType.parent_type,
    };

    return resp.view("src/public/workbook/view.html", tmplData);
  });

  // set locale for workbook
  fastify.post("/workbook/locale", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;

    const body: any = req.body;
    cache.setLocale(workbookId, body.locale);

    return resp.view("src/public/components/locale_select.html", {
      workbookId: workbookId,
      workbook_locale: body.locale,
      locales: LOCALES,
    });
  });

  // initiates place creation via the job manager
  fastify.post("/workbook/:id/submit", async (req) => {
    const params: any = req.params;
    const workbookId = params.id!!;
    fastify.uploadManager.doUpload(workbookId, req.chtSession);
    return `<button class="button is-dark" hx-post="/workbook/${workbookId}/submit" hx-target="this" hx-swap="outerHTML">Apply Changes</button>`;
  });
}
