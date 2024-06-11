import { FastifyInstance } from 'fastify';

import Auth from '../lib/authentication';
import { ChtApi } from '../lib/cht-api';
import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import RemotePlaceCache from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import Pagination from '../services/pagination';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/', async (req, resp) => {
    const contactTypes = Config.contactTypes();
    const queryParams: any = req.query;
    const {
      op = 'table',
      type: placeTypeName = contactTypes[0].name,
    } = queryParams;

    const contactType = Config.getContactType(placeTypeName);
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter, contactTypes, queryParams.type);
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
        userRoleProperty: Config.getUserRoleConfig(item),
      };
    });

    const pageInfo = {
      page: queryParams.page,
      pageSize: queryParams.pageSize,
    };

    const tmplData = {
      view: 'list',
      session: req.chtSession,
      logo: Config.getLogoBase64(),
      op,
      pageInfo,
      contactType,
      contactTypes: placeData,
      directiveModel,
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.get('/app/list', async (req, resp) => {
    const queryParams: any = req.query;
    const page = queryParams.page && parseInt(queryParams.page, 10);
    const pageSize = queryParams.pageSize && parseInt(queryParams.pageSize, 10);
    const requestContactTypeName = queryParams.contactTypeName;

    const pagination = new Pagination({ page, pageSize, requestContactTypeName });

    const contactTypes = Config.contactTypes();
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter, contactTypes, requestContactTypeName);

    const placeData = contactTypes.map((item) => {
      const itemPlacesData = sessionCache.getPlaces({
        type: item.name,
        filter: directiveModel.filter,
      });
      return {
        ...item,
        places: pagination.getPageData(itemPlacesData, item.name),
        hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
        userRoleProperty: Config.getUserRoleConfig(item),
      };
    });

    const tmplData = {
      session: req.chtSession,
      contactTypes: placeData,
      directiveModel
    };
    return resp.view('src/liquid/place/list.html', tmplData);
  });

  fastify.post('/app/remove-all/:contactTypeName?', async (req, resp) => {
    const params: any = req.params;
    const contactTypeName = params.contactTypeName;
    const sessionCache: SessionCache = req.sessionCache;
    for (const cookieName in req.cookies) {
      if (req.cookies[cookieName] && cookieName === 'currentTab'
        || cookieName.includes('_currentPage')) {
        resp.clearCookie(cookieName, { path: '/' });
      }
    }
    sessionCache.removeAll(contactTypeName);
    resp.header('HX-Redirect', '/');
  });

  fastify.post('/app/refresh-all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    RemotePlaceCache.clear(chtApi);

    const places = sessionCache.getPlaces({ created: false });
    await RemotePlaceResolver.resolve(places, sessionCache, chtApi, { fuzz: true });
    places.forEach(p => p.validate());
    resp.header('HX-Redirect', '/');
  });

  // initiates place creation via the job manager
  fastify.post('/app/apply-changes', async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);

    const chtApi = new ChtApi(req.chtSession);
    uploadManager.doUpload(sessionCache.getPlaces(), chtApi);

    return resp.view('src/liquid/place/directive.html', {
      directiveModel
    });
  });

  fastify.post('/app/set-filter/:filter', async (req, resp) => {
    const params: any = req.params;
    const filter = params.filter;
    resp.setCookie('filter', filter, {
      signed: false,
      sameSite: 'strict',
      httpOnly: true,
      expires: Auth.cookieExpiry(),
      path: '/',
      secure: true,
    });

    resp.header('HX-Redirect', '/');
  });
}
