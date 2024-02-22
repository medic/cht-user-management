import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { PlaceUploadState } from '../services/place';
import { ChtApi } from '../lib/cht-api';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import RemotePlaceCache from '../lib/remote-place-cache';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/', async (req, resp) => {
    const contactTypes = Config.contactTypes();
    const {
      op = 'table',
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
        hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
      };
    });

    const tmplData = {
      view: 'list',
      logo: Config.getLogoBase64(),
      contactType,
      contactTypes: placeData,
      sessionState: sessionCache.state,
      hasFailedJobs: failed.length > 0,
      failedJobCount: failed.length,
      scheduledJobCount: scheduledJobs.length,
      session: req.chtSession,
      op,
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/app/remove-all', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    sessionCache.removeAll();
    fastify.uploadManager.refresh(req.sessionCache);
  });

  fastify.post('/app/refresh-all', async (req) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    RemotePlaceCache.clear(chtApi);

    const places = sessionCache.getPlaces({ created: false });
    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    places.forEach(p => p.validate());

    fastify.uploadManager.refresh(req.sessionCache);
  });

  // initiates place creation via the job manager
  fastify.post('/app/apply-changes', async (req) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;

    uploadManager.eventedSessionStateChange(sessionCache, 'in_progress');
    const chtApi = new ChtApi(req.chtSession);
    uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    uploadManager.eventedSessionStateChange(sessionCache, 'done');
  });
}
