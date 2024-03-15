import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import SessionCache from '../services/session-cache';
import ProgressModel from '../services/progress-model';

export default async function events(fastify: FastifyInstance) {
  fastify.get('/events/places/all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const placeData = contactTypes.map(item => ({
      ...item,
      places: sessionCache.getPlaces({ type: item.name }),
      hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
    }));

    return resp.view('src/liquid/place/list_event.html', {
      contactTypes: placeData,
      session: req.chtSession,
      progress: new ProgressModel(sessionCache),
    });
  });

  fastify.get('/events/connection', async (req, resp) => {
    const { uploadManager } = fastify;

    resp.hijack();
    const placesChangeListener = (arg: string = '*') => {
      resp.sse({ event: 'place_state_change', data: arg });
    };
    
    uploadManager.on('refresh_table', placesChangeListener);
    uploadManager.on('refresh_table_row', placesChangeListener);

    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table', placesChangeListener);
      uploadManager.removeListener('refresh_table_row', placesChangeListener);
    });
  });
}
