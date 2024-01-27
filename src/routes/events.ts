import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import { PlaceUploadState } from '../services/place';
import SessionCache, { SessionCacheUploadState } from '../services/session-cache';

export default async function events(fastify: FastifyInstance) {
  fastify.get('/plugin/user-management/events/places_list', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: sessionCache.getPlaces({ type: item.name }),
        hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
      };
    });
    return resp.view('src/public/place/list.html', {
      contactTypes: placeData,
      session: req.chtSession,
    });
  });

  fastify.get('/plugin/user-management/events/connection', async (req, resp) => {
    const { uploadManager } = fastify;

    resp.hijack();
    const placesChangeListener = (arg: PlaceUploadState) => {
      resp.sse({ event: 'places_state_change', data: arg });
    };
    uploadManager.on('places_state_change', placesChangeListener);

    const sessionStateListener = (arg: SessionCacheUploadState) => {
      resp.sse({ event: 'session_state_change', data: arg });
    };
    uploadManager.on('session_state_change', sessionStateListener);

    req.socket.on('close', () => {
      uploadManager.removeListener('places_state_change', placesChangeListener);
      uploadManager.removeListener('session_state_change', sessionStateListener);
    });
  });
}
