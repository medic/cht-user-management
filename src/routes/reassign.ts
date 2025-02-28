import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import { UploadManager } from '../services/upload-manager';

export default async function newHandler(fastify: FastifyInstance) {
  
  fastify.get('/reassign', async (req, resp) => {
    const { place_type } = req.query as any;
    const contactType = Config.getContactType(place_type);
    return resp.view('src/liquid/reassign/index.liquid', {
      contactType,
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      logo: Config.getLogoBase64(),
      session: req.chtSession
    });
  });

  fastify.post('/reassign/part', async (req, resp) => {
    const body = req.body as { [key:string]: string };
    const contactType = Config.getContactType(body.place_type);
    const hierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
   
    const place = { id: '', name: '', levels: [] as string[] };
    hierarchy.forEach(h => {
      if (h.property_name === 'replacement') {
        place.id = body['hierarchy_' + h.property_name + '_id'];
        place.name = body['hierarchy_' + h.property_name];
      } else {
        place.levels.push(body['hierarchy_' + h.property_name]);
      }
      delete body['hierarchy_' + h.property_name];
      delete body['hierarchy_' + h.property_name + '_id'];
    });

    const places = [];
    if (place.id) {
      places.push({ place, value: Buffer.from(JSON.stringify(place)).toString('base64') });
    }
    Object.keys(body).filter(k => k.startsWith('list_')).map(k => body[k]).forEach(v => {
      const item = { 
        place: JSON.parse(Buffer.from(v, 'base64').toString('utf8')), 
        value: v 
      };
      if (place.id !== item.place.id) {
        places.push(item); 
      }
    });

    return resp.view('src/liquid/reassign/form.liquid', {
      contactType,
      hierarchy,
      session: req.chtSession,
      data: body,
      places
    });
  });


  fastify.post('/reassign/part/delete', async (req, resp) => {
    const { place_id } = req.query as any;
    const body = req.body as { [key:string]: string };
    
    const contactType = Config.getContactType(body.place_type);
    const hierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
    const places = Object.keys(body).filter(k => k.startsWith('list_')).map(k => body[k]).map(v => {
      return {
        place: JSON.parse(Buffer.from(v, 'base64').toString('utf8')), 
        value: v 
      }; 
    }).filter(item => item.place.id !== place_id);

    return resp.view('src/liquid/reassign/form.liquid', {
      contactType,
      hierarchy,
      session: req.chtSession,
      data: body,
      places
    });
  });


  fastify.post('/reassign', async (req, resp) => {
    const body = req.body as { [key:string]: string };
    const contactType = Config.getContactType(body.place_type);
    const hierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
    const places = Object.keys(body).filter(k => k.startsWith('list_')).map(k => body[k]).map(v => {
      return {
        place: JSON.parse(Buffer.from(v, 'base64').toString('utf8')), 
        value: v 
      }; 
    });

    const uuidMatch = body.contact.match('/contacts/(?<uuid>[a-z0-9-]{32,36})');
    if (!uuidMatch?.groups?.uuid) {
      const errors = { contact: '*Invalid link' };
      return resp.view('src/liquid/reassign/form.liquid', {
        contactType,
        hierarchy,
        session: req.chtSession,
        data: body,
        places,
        errors
      });
    }

    if (places.length > 0) {
      const chtApi = new ChtApi(req.chtSession);
      const contactId = uuidMatch.groups.uuid;
      const uploadManager: UploadManager = fastify.uploadManager;
      uploadManager.reassign(contactId, places.map(i => i.place.id), chtApi);
    }

    return resp.view('src/liquid/reassign/form.liquid', {
      contactType,
      hierarchy,
      session: req.chtSession,
      data: { ...body, in_progress: places.length > 0 },
      places,
      errors: {
        form: places.length <= 0 ? 'Please Add some places before trying to reassign': undefined
      }
    });
  });

}
