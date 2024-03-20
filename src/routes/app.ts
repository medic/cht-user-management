import { FastifyInstance } from 'fastify';

import Auth from '../lib/authentication';
import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
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
    const directiveModel = new DirectiveModel(sessionCache, req.cookies['filter']);
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: sessionCache.getPlaces({
          type: item.name,
          filter: directiveModel.filter,
        }),
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
      directiveModel,
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

  fastify.post('/app/set-filter/:filter', async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;

    const params: any = req.params;
    const filter = params.filter;
    resp.setCookie('filter', filter, {
      signed: false,
      httpOnly: true,
      expires: Auth.cookieExpiry(),
      path: '/',
      secure: true,
    });

    uploadManager.triggerRefresh(undefined);
  });
}
