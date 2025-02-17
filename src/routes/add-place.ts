import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import PlaceFactory from '../services/place-factory';
import SessionCache from '../services/session-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { UploadManager } from '../services/upload-manager';
import RemotePlaceCache from '../lib/remote-place-cache';
import WarningSystem from '../warnings';
import semver from 'semver';

export default async function addPlace(fastify: FastifyInstance) {
  fastify.get('/add-place', async (req, resp) => {
    const queryParams: any = req.query;

    const contactTypes = Config.contactTypes();
    const contactType = queryParams.type
      ? Config.getContactType(queryParams.type)
      : contactTypes[contactTypes.length - 1];

    if (semver.gte(req.chtSession.chtCoreVersion, '4.9.0') && contactType.can_assign_multiple) {
      resp.redirect(`/new?place_type=${queryParams.type}`);
      return;
    }

    const op = queryParams.op || 'new';
    const tmplData = {
      view: 'add',
      logo: Config.getLogoBase64(),
      session: req.chtSession,
      op,
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      contactType,
      contactTypes,
      userRoleProperty: Config.getUserRoleConfig(contactType)
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/place/dob', async (req, resp) => {
    const { place_type, prefix, prop_type } = req.query as any;
    const contactType = Config.getContactType(place_type).contact_properties.find(prop => prop.type === prop_type);
    return resp.view('src/liquid/components/contact_type_property.html', {
      data: req.body,
      include: {
        prefix,
        place_type,
        prop: contactType
      }
    });
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post('/place', async (req, resp) => {
    const { op, type: placeType } = req.query as any;

    const contactType = Config.getContactType(placeType);
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    if (op === 'new' || op === 'replace') {
      await PlaceFactory.createOne(req.body, contactType, sessionCache, chtApi);
      resp.header('HX-Redirect', `/`);
      return;
    }

    if (op === 'bulk') {
      // read the date we uploaded
      const fileData = await req.file();
      if (!fileData) {
        throw Error('no file data');
      }
      try {
        const csvBuf = await fileData.toBuffer();
        await PlaceFactory.createFromCsv(csvBuf, contactType, sessionCache, chtApi);
      } catch (error) {
        return fastify.view('src/liquid/place/bulk_create_form.html', {
          contactType,
          errors: {
            message: error,
          },
        });
      }

      // back to places list
      resp.header('HX-Redirect', `/`);
      return;
    }

    throw new Error('unknown op');
  });

  fastify.get('/place/edit/:id', async (req, resp) => {
    const params: any = req.params;
    const { id } = params;

    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place || place.isCreated) {
      throw new Error('unknown place or place is already created');
    }

    const data = place.asFormData('hierarchy_');
    const tmplData = {
      view: 'edit',
      op: 'edit',
      logo: Config.getLogoBase64(),
      hierarchy: Config.getHierarchyWithReplacement(place.type, 'desc'),
      place,
      session: req.chtSession,
      contactType: place.type,
      contactTypes: Config.contactTypes(),
      backend: `/place/edit/${id}`,
      data,
      userRoleProperty: Config.getUserRoleConfig(place.type)
    };

    resp.header('HX-Push-Url', `/place/edit/${id}`);
    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/place/edit/:id', async (req, resp) => {
    const { id } = req.params as any;
    const data: any = req.body;
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    await PlaceFactory.editOne(id, data, sessionCache, chtApi);

    // back to places list
    resp.header('HX-Redirect', `/`);
  });

  fastify.post('/place/refresh/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place) {
      throw Error(`unable to find place ${id}`);
    }

    const chtApi = new ChtApi(req.chtSession);
    RemotePlaceCache.clear(chtApi, place.type.name);
    await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
    place.validate();
    await WarningSystem.setWarnings(place.type, chtApi, sessionCache);

    fastify.uploadManager.triggerRefresh(place.id);
  });

  fastify.post('/place/upload/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    
    const place = sessionCache.getPlace(id);
    if (!place) {
      throw Error(`unable to find place ${id}`);
    }
    const places = [];
    if (place.hasSharedUser) {
      const group = sessionCache.getPlaces({ type: place.type.name }).filter(p => p.contact.id === place.contact.id);
      if (group.filter(p => p.isCreated).length > 0) {
        places.push(...group.filter(p => p.isCreated), place);
      } else {
        places.push(group[0], place);
      }
    } else {
      places.push(place);
    }

    const uploadManager: UploadManager = fastify.uploadManager;
    uploadManager.doUpload(places, chtApi, true);
  });

  fastify.post('/place/remove/:id', async (req) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    sessionCache.removePlace(id);
    if (place) {
      const chtApi = new ChtApi(req.chtSession);
      await WarningSystem.setWarnings(place.type, chtApi, sessionCache);
    }

    fastify.uploadManager.triggerRefresh(id);
  });
}
