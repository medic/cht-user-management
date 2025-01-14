import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import Auth from '../lib/authentication';
import { ChtApi } from '../lib/cht-api';
import { Config, ConfigSystem } from '../config';
import DirectiveModel from '../services/directive-model';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import WarningSystem from '../warnings';
import { writeConfig } from '../config/config-factory';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/', async (req, resp) => {
    const contactTypes = await Config.contactTypes();
    const {
      op = 'table',
      type: placeTypeName = contactTypes[0].name,
    } = req.query as any;

    const contactType = Config.getContactType(placeTypeName);
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
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

  fastify.get('/app/list', async (req, resp) => {
    const contactTypes = await Config.contactTypes();
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);
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
      session: req.chtSession,
      contactTypes: placeData,
    };
    return resp.view('src/liquid/place/list.html', tmplData);
  });

  fastify.post('/app/remove-all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    sessionCache.removeAll();
    resp.header('HX-Redirect', '/');
  });

  fastify.post('/app/refresh-all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    RemotePlaceCache.clear(chtApi);

    const places = sessionCache.getPlaces({ created: false });
    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    places.forEach(p => p.validate());

    for (const contactType of await Config.contactTypes()) {
      await WarningSystem.setWarnings(contactType, chtApi, sessionCache);
    }

    resp.header('HX-Redirect', '/');
  });

  // initiates place creation via the job manager
  fastify.post('/app/apply-changes', async (req, resp) => {
    const { ignoreWarnings } = req.query as any;
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);

    const chtApi = new ChtApi(req.chtSession);
    uploadManager.doUpload(sessionCache.getPlaces(), chtApi, ignoreWarnings === 'true');

    return resp.view('src/liquid/place/directive.html', {
      directiveModel
    });
  });

  fastify.post('/app/set-filter/:filter', async (req, resp) => {
    const params: any = req.params;
    const filter = params.filter;
    resp.setCookie('filter', filter, {
      signed: false,
      httpOnly: true,
      expires: Auth.cookieExpiry(),
      path: '/',
      secure: true,

    });

    resp.header('HX-Redirect', '/');
  });

  fastify.get('/app/config', async (req: FastifyRequest, resp: FastifyReply) => {
    const contactTypes = await Config.contactTypes();
    const tmplData = {
      view: 'add',
      logo: Config.getLogoBase64(),
      session: req.chtSession,
      op: 'config',
      contactTypes,
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/app/config', async (req: FastifyRequest, res: FastifyReply) => {
    try {
      const data = await req.file();
      if (!data) {
        res.status(400).send('No file uploaded');
        throw new Error('No file uploaded');
      }

      if (data.mimetype !== 'application/json') {
        res.status(400).send('Invalid file type');
        throw new Error('Invalid file type');
      }

      const fileBuffer = await data.toBuffer();
      const config = JSON.parse(fileBuffer.toString('utf-8')) as ConfigSystem;

      await Config.assertValid({ config });
      await writeConfig(config);

      res.header('HX-Redirect', '/');
    } catch (error) {
      console.error('Route app/config: ', error);
      return fastify.view('src/liquid/app/config_upload.html', {
        errors: {
          message: error,
        },
      });
    }
  });
}
