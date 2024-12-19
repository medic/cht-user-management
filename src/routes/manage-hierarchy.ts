import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import { FastifyInstance } from 'fastify';
import ManageHierarchyLib from '../lib/manage-hierarchy';
import SessionCache from '../services/session-cache';
import { hierarchyViewModel } from '../services/hierarchy-view-model';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/manage-hierarchy/:action/:placeType', async (req, resp) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const contactTypes = Config.contactTypes();
    
    const contactType = Config.getContactType(placeType);
    const tmplData = {
      view: 'manage-hierarchy',
      op: params.action,
      logo: Config.getLogoBase64(),
      contactTypes,
      contactType,
      session: req.chtSession,
      ...hierarchyViewModel(params.action, contactType),
    };

    return resp.view('src/liquid/app/view.html', tmplData);
  });

  fastify.post('/manage-hierarchy', async (req, resp) => {
    const formData:any = req.body;

    const sessionCache: SessionCache = req.sessionCache;
    const contactType = Config.getContactType(formData.place_type);
    const chtApi = new ChtApi(req.chtSession);
    
    const tmplData: any = {
      view: 'manage-hierarchy',
      op: formData.op,
      logo: Config.getLogoBase64(),
      contactType,
      data: formData,
      session: req.chtSession,
      ...hierarchyViewModel(formData.op, contactType),
    };

    try {
      const isConfirmed = false;
      const job = await ManageHierarchyLib.getJob(formData, contactType, sessionCache, chtApi);
      tmplData.confirm = !isConfirmed;
      if (isConfirmed) {
        const result = await ManageHierarchyLib.scheduleJob(job);
        tmplData.success = result.success;
      } else {
        
      }

      return resp.view('src/liquid/place/manage_hierarchy_form.html', tmplData);
    } catch (e: any) {
      tmplData.error = e.toString();
      return resp.view('src/liquid/place/manage_hierarchy_form.html', tmplData);
    }
  });
}

