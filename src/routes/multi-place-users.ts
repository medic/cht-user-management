import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import SessionCache from '../services/session-cache';
import PlaceFactory from '../services/place-factory';
import Validation from '../validation';
import crypto from 'crypto';

export default async function newHandler(fastify: FastifyInstance) {

  fastify.get('/new', async (req, resp) => {
    const { place_type, contact } = req.query as any;
    const contactType = Config.getContactType(place_type);
    const contactTypes = Config.contactTypes();
    const sessionCache: SessionCache = req.sessionCache;

    const shared = {
      hierarchy: contactType.hierarchy,
      contactType,
      logo: Config.getLogoBase64(),
      show_place_form: false,
      session: req.chtSession,
      MATOMO_HOST: process.env.MATOMO_HOST,
      contactTypes
    };

    if (contact) {
      const placeData = sessionCache.getPlaces({ type: contactType.name, contactId: contact }).find(p => p !== undefined)?.asFormData('hierarchy_');
      const placeFormData = {} as any;
      Object.keys(placeData).filter(k => k.startsWith('contact_') || k.startsWith('hierarchy_')).forEach(k => placeFormData[k] = placeData[k]);
      const data = {
        ...shared,
        data: placeFormData,
        show_place_form: true,
        contact_id: contact
      };
      return resp.view('src/liquid/new/index.liquid', data);
    }

    const data = { ...shared };
    return resp.view('src/liquid/new/index.liquid', data);
  });

  fastify.post('/new', async (req, resp) => {
    const { place_type, contact, another } = req.query as any;

    const contactType = Config.getContactType(place_type);
    const chtApi = new ChtApi(req.chtSession);
    const sessionCache: SessionCache = req.sessionCache;

    await PlaceFactory.createManyWithSingleUser(req.body as { [key: string]: string }, contactType, sessionCache, chtApi, contact);

    if (another) {
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
    const formData = req.body as { [key: string]: string };

    const errors: { [key: string]: string } = {};
    const placeData: { [key: string]: string } = {};
    contactType.place_properties.forEach(prop => {
      const validator = Validation.getValidatorForType(prop.type);
      const valid = validator?.isValid(formData['place_' + prop.property_name], prop);
      if (typeof valid === 'string') {
        errors[prop.property_name] = valid;
      } else if (valid === false) {
        errors[prop.property_name] = prop.errorDescription ?? 'invalid value';
      } else {
        placeData['place_' + prop.property_name] = formData['place_' + prop.property_name];
      }
    });

    if (Object.keys(errors).length > 0) {
      return resp.view('src/liquid/new/place_form_fragment.liquid', { contactType, errors, data: formData });
    }

    return resp.view('src/liquid/new/place_list_fragment.liquid', {
      contactType,
      item: {
        id: crypto.randomUUID(),
        name: placeData.place_name,
        value: Buffer.from(JSON.stringify(placeData)).toString('base64'),
      },
    });
  });

  fastify.post('/new/part/delete/:id', async () => { });

  fastify.get('/new/table', async (req, resp) => {
    const { contact } = req.query as any;
    const sessionCache: SessionCache = req.sessionCache;
    const places = sessionCache.getPlaces({ contactId: contact });
    return resp.view('src/liquid/new/place_list.liquid', {
      contactType: {
        ...places[0].type,
        hierarchy: Config.getHierarchyWithReplacement(places[0].type, 'desc')
      },
      places,
      can_edit: !places.find(p => p.creationDetails.username)
    });
  });

  fastify.get('/edit/contact/:id', async (req, resp) => {
    const { id } = req.params as any;
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const place = sessionCache.getPlaces({ contactId: id }).find(p => p !== undefined);
    if (!place) {
      throw new Error('could not find place');
    }

    const data = place.asFormData('hierarchy_');
    return resp.view('src/liquid/edit/contact/index.liquid', {
      logo: Config.getLogoBase64(),
      contactType: place.type,
      session: req.chtSession,
      contact_id: place.contact.id,
      data,
      hierarchy: place.type.hierarchy,
      MATOMO_HOST: process.env.MATOMO_HOST,
      contactTypes
    });
  });


  fastify.put('/contact/:id', async (req, resp) => {
    const { id } = req.params as any;
    const body = req.body as { [key: string]: string };
    const contactType = Config.getContactType(body.place_type);

    const errors = {} as { [key: string]: string };
    contactType.contact_properties.forEach(prop => {
      const validator = Validation.getValidatorForType(prop.type);
      const valid = validator?.isValid(body['contact_' + prop.property_name], prop);
      if (typeof valid === 'string') {
        errors[prop.property_name] = valid;
      } else if (valid === false) {
        errors[prop.property_name] = prop.errorDescription ?? 'invalid value';
      }
    });

    if (Object.keys(errors).length > 0) {
      return resp.view('src/liquid/edit/contact/form.liquid', {
        logo: Config.getLogoBase64(),
        contactType: contactType,
        contact_id: id,
        data: body,
        errors,
        hierarchy: contactType.hierarchy
      });
    }

    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    const places = sessionCache.getPlaces({ type: body.place_type, contactId: id });
    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const placeData = { ...place.asFormData('hierarchy_'), ...body };
      await PlaceFactory.editOne(place.id, placeData, sessionCache, chtApi);
    }

    resp.header('HX-Redirect', `/`);
    return;
  });
}
