import _ from 'lodash';

import { Config, ContactType } from '../config';
import { ChtApi } from '../lib/cht-api';
import { FastifyInstance } from 'fastify';
import MoveLib from '../lib/move';
import SessionCache from '../services/session-cache';
import { moveContactQueue } from '../lib/queues';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/move/:placeType', async (req, resp) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const contactTypes = Config.contactTypes();
    
    const contactType = Config.getContactType(placeType);
    const tmplData = {
      view: 'move',
      op: 'move',
      logo: Config.getLogoBase64(),
      contactTypes,
      contactType,
      session: req.chtSession,
      ...moveViewModel(contactType),
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/move', async (req, resp) => {
    const formData:any = req.body;

    const sessionCache: SessionCache = req.sessionCache;
    const contactType = Config.getContactType(formData.place_type);
    const chtApi = new ChtApi(req.chtSession);
    
    try {
      const result = await MoveLib.move(formData, contactType, sessionCache, chtApi, moveContactQueue);

      const tmplData = {
        view: 'move',
        op: 'move',
        logo: Config.getLogoBase64(),
        contactType,
        session: req.chtSession,
        ...moveViewModel(contactType),
        ...result
      };
      return resp.view('src/liquid/place/move_form.html', tmplData);
    } catch (e: any) {
      const tmplData = {
        view: 'move',
        op: 'move',
        contactTypes: Config.contactTypes(),
        session: req.chtSession,
        data: formData,
        contactType,
        ...moveViewModel(contactType),
        error: e.toString(),
      };
  
      return resp.view('src/liquid/place/move_form.html', tmplData);
    }
  });
}

export function moveViewModel(contactType: ContactType) {
  const parentTypeName = contactType.hierarchy.find(h => h.level === 1)?.contact_type;
  if (!parentTypeName) {
    throw Error('parent type name');
  }

  const fromHierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
  const toHierarchy = _.orderBy(contactType.hierarchy, 'level', 'desc');
  fromHierarchy[fromHierarchy.length - 1].friendly_name = contactType.friendly;
  
  return {
    fromHierarchy,
    toHierarchy,
  };
}
