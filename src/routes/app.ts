import { FastifyInstance } from "fastify";
import { Config } from "../lib/config";
import SessionCache from "../services/session-cache";
import { UploadManager } from '../services/upload-manager';
import { PlaceUploadState } from "../services/place";
import { ChtApi } from "../lib/cht-api";

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get("/", async (req, resp) => {
    const contactTypes = Config.contactTypes();
    const {
      op = 'new',
      type: placeTypeName = contactTypes[0].name,
    } = req.query as any;

    const contactType = Config.getContactType(placeTypeName);

    const sessionCache: SessionCache = req.sessionCache;
    const failed = sessionCache.getPlaces({ state: PlaceUploadState.FAILURE });
    const scheduledJobs = sessionCache.getPlaces({ state: PlaceUploadState.SCHEDULED });
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: sessionCache.getPlaces({ type: item.name }),
      };
    });

    const tmplData = {
      contactType,
      contactTypes: placeData,
      uniquePlaceNames: contactTypes.map((t) => t.name),
      sessionState: sessionCache.state,
      hasFailedJobs: failed.length > 0,
      failedJobCount: failed.length,
      scheduledJobCount: scheduledJobs.length,
      op,
    };

    const isHxReq = req.headers["hx-request"];
    if (isHxReq) {
      const content = await fastify.view("src/public/app/content.html", tmplData);
      const header = await fastify.view("src/public/app/view_header.html", tmplData);
      return content + header;
    }

    return resp.view("src/public/app/view.html", tmplData);
  });

  fastify.get("/app/add-place", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;
    const queryParams: any = req.query;

    const contactTypes = Config.contactTypes();
    const contactType = queryParams.type
      ? Config.getContactType(queryParams.type)
      : contactTypes[0];
    const op = queryParams.op || "new";
    const tmplData = {
      view: "add",
      title: id,
      uniquePlaceNames: contactTypes.map((type) => type.name),
      op,
      contactType,
    };

    return resp.view("src/public/app/view.html", tmplData);
  });

  // initiates place creation via the job manager
  fastify.post("/app/apply-changes", async (req) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;
    
    uploadManager.eventedSessionStateChange(sessionCache, 'in_progress');
    const chtApi = new ChtApi(req.chtSession);
    uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    uploadManager.eventedSessionStateChange(sessionCache, 'done');

    return `<button class="button is-dark" hx-post="/app/apply-changes" hx-target="this" hx-swap="outerHTML">Apply Changes</button>`;
  });
}
