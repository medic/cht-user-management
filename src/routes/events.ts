import { FastifyInstance } from "fastify";

import { Config } from "../lib/config";
import { PlaceUploadState } from "../services/place";
import SessionCache, { SessionCacheUploadState } from "../services/session-cache";
import { JobState } from "../services/upload-manager";

export default async function events(fastify: FastifyInstance) {
  fastify.get("/events/places_list", async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: sessionCache.getPlaces({ type: item.name }),
      };
    });
    return resp.view("src/public/place/list.html", {
      contactTypes: placeData,
    });
  });

  fastify.get("/events/places_controls", async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const failed = sessionCache.getPlaces({ state: PlaceUploadState.FAILURE });
    const scheduledJobs = sessionCache.getPlaces({ state: PlaceUploadState.SCHEDULED });
    return resp.view("src/public/place/controls.html", {
      sessionState: sessionCache.state,
      scheduledJobCount: scheduledJobs.length,
      failedJobCount: failed.length,
      hasFailedJobs: failed.length > 0,
    });
  });

  fastify.get("/events/connection", async (req, resp) => {
    const { uploadManager } = fastify;

    resp.hijack();
    const placesChangeListener = (arg: PlaceUploadState) => {
      resp.sse({ event: "places_state_change", data: arg });
    };
    uploadManager.on("places_state_change", placesChangeListener);
    
    const sessionStateListener = (arg: SessionCacheUploadState) => {
      resp.sse({ event: "session_state_change", data: arg });
    };
    uploadManager.on("session_state_change", sessionStateListener);
    
    req.socket.on("close", () => {
      uploadManager.removeListener("places_state_change", placesChangeListener);
      uploadManager.removeListener("session_state_change", sessionStateListener);
    });
  });
}
