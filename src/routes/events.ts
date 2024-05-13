import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { setRequestDataMetrics } from '../services/page-view';

export default async function events(fastify: FastifyInstance) {
  fastify.get('/events/places/all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);
    const placeData = contactTypes.map(item => ({
      ...item,
      places: sessionCache.getPlaces({
        type: item.name,
        filter: directiveModel.filter,
      }),
      hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
      userRoleProperty: Config.getUserRoleConfig(item),
    }));

    // Sending request and response data for page view
    setRequestDataMetrics(req, resp);

    return resp.view('src/liquid/place/list_event.html', {
      contactTypes: placeData,
      session: req.chtSession,
      directiveModel,
    });
  });

  fastify.get('/events/connection', async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;

    resp.hijack();
    const placesChangeListener = (arg: string = '*') => {
      resp.sse({ event: 'place_state_change', data: arg });
    };

    setRequestDataMetrics(req, resp);
    
    uploadManager.on('refresh_table', placesChangeListener);
    uploadManager.on('refresh_table_row', placesChangeListener);

    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table', placesChangeListener);
      uploadManager.removeListener('refresh_table_row', placesChangeListener);
    });
    
  });
}
