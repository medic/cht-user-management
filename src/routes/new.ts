import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import PlaceFactory from '../services/place-factory';
import SessionCache from '../services/session-cache';
import { ChtApi } from '../lib/cht-api';

export default async function newHandler(fastify: FastifyInstance) {
  
  fastify.get('/new', async (req, resp) => {
    const { place_type } = req.query as any;
    const contactType = Config.getContactType(place_type);
    const data = {
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      contactType,
      userRoleProperty: Config.getUserRoleConfig(contactType),
    };
    return resp.view('src/liquid/new/create_place.liquid', data);
  });

  fastify.post('/new', async (req, resp) => {
    const { place_type } = req.query as any;

    const contactType = Config.getContactType(place_type);
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    await PlaceFactory.createManyWithSingleUser(req.body as {[key:string]:string}, contactType, sessionCache, chtApi);

    resp.header('HX-Redirect', '/');
  });

  fastify.get('/place_form', async (req, resp) => {
    const { place_type, action } = req.query as any;
    if (action === 'cancel') {
      return resp.view('src/liquid/new/new_place_btn.liquid', { place_type });
    }
    const contactType = Config.getContactType(place_type);
    return resp.view('src/liquid/new/place_form_fragment.liquid', { contactType });
  });

  fastify.post('/place_form', async (req, resp) => {
    const { place_type } = req.query as any;
    const contactType = Config.getContactType(place_type);
    const { place_name } = req.body as any;
    return resp.view('src/liquid/new/place_list_fragment.liquid', {
      contactType,
      item: {
        id: place_name.toLowerCase().replaceAll(' ', '_'),
        name: place_name,
        value: Buffer.from(JSON.stringify(req.body)).toString('base64'),
      },
    });
  });
}
