import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import SessionCache from '../services/session-cache';
import _ from 'lodash';
import PlaceFactory from '../services/place-factory';
import Validation from '../validation';
import { PlaceUploadState } from '../services/place';

export default async function newHandler(fastify: FastifyInstance) {
  
  fastify.get('/new', async (req, resp) => {
    const { place_type } = req.query as any;
    const contactType = Config.getContactType(place_type);
    const sessionCache: SessionCache = req.sessionCache;
    
    const grouped = Object.values(
      _.groupBy(sessionCache.getPlaces({ type: contactType.name }).filter(p => p.state === PlaceUploadState.STAGED), (p) => p.contact.id)
    )
      .filter(p => p.length > 0)
      .reverse();

    const data = {
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      contactType,
      places: grouped,
      logo: Config.getLogoBase64()
    };

    return resp.view('src/liquid/new/create_place.liquid', data);
  });

  fastify.post('/new', async (req, resp) => {
    const { place_type, cont } = req.query as any;

    const contactType = Config.getContactType(place_type);
    const chtApi = new ChtApi(req.chtSession);
    const sessionCache: SessionCache = req.sessionCache;
    
    await PlaceFactory.createManyWithSingleUser(req.body as {[key:string]:string}, contactType, sessionCache, chtApi);
    
    if (cont) {
      resp.header('HX-Redirect', `/new?place_type=${place_type}`);
    } else {
      resp.header('HX-Redirect', `/`); 
    }
    return;
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
    const formData = req.body as { [key:string]: string };
   
    const errors: { [key:string]: string } = {};
    contactType.place_properties.forEach(prop => {
      const validator = Validation.getValidatorForType(prop.type);
      const valid = validator?.isValid(formData['place_' + prop.property_name], prop);
      if (typeof valid === 'string') {
        throw new Error(valid);
      }
      if (!valid) {
        errors[prop.property_name] = prop.errorDescription ?? 'invalid value';
      }
    });

    if (Object.keys(errors).length > 0) {
      return resp.view('src/liquid/new/place_form_fragment.liquid', { contactType, errors, data: formData });
    }

    return resp.view('src/liquid/new/place_list_fragment.liquid', {
      contactType,
      item: {
        id: formData.place_name.toLowerCase().replaceAll(' ', '_'),
        name: formData.place_name,
        value: Buffer.from(JSON.stringify(req.body)).toString('base64'),
      },
    });
  });

  fastify.get('/new/table', async (req, resp) => {
    const { contact } = req.query as any;
    const sessionCache: SessionCache = req.sessionCache;
    const places = sessionCache.getPlaces().filter(p => p.contact.id === contact);
    return resp.view('src/liquid/new/place_list.liquid', {
      contactType: places[0].type,
      places
    });
  });
}
