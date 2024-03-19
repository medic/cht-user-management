import { FastifyInstance } from 'fastify';

import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import ProgressModel from '../services/progress-model';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/', async (req, resp) => {
    const contactTypes = Config.contactTypes();
    const {
      op = 'table',
      type: placeTypeName = contactTypes[0].name,
    } = req.query as any;

    const contactType = Config.getContactType(placeTypeName);

    const sessionCache: SessionCache = req.sessionCache;
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: sessionCache.getPlaces({ type: item.name }),
        hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
        userRoleProperty: Config.getUserRoleConfig(item),
      };
    });

    const tmplData = {
      view: 'list',
      session: req.chtSession,
      logo: Config.getLogoBase64(),
      op,
      contactType,
      contactTypes: placeData,
      progress: new ProgressModel(sessionCache),
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/app/remove-all', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    sessionCache.removeAll();
    fastify.uploadManager.triggerRefresh(undefined);
  });

  fastify.post('/app/refresh-all', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    RemotePlaceCache.clear(chtApi);

    const places = sessionCache.getPlaces({ created: false });
    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    places.forEach(p => p.validate());

    fastify.uploadManager.triggerRefresh(undefined);
  });

  // initiates place creation via the job manager
  fastify.post('/app/apply-changes', async (req) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;

    const chtApi = new ChtApi(req.chtSession);
    uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
  });
}
