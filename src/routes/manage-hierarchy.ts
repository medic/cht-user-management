import { Config } from '../config';
import { ChtApi } from '../lib/cht-api';
import { FastifyInstance } from 'fastify';
import ManageHierarchyLib from '../lib/manage-hierarchy';
import SessionCache from '../services/session-cache';
import { hierarchyViewModel } from '../services/hierarchy-view-model';
import { AppViewModel } from '../liquid/app';
import { ManageHierarchyFormContentViewModel } from '../liquid/place';

export default async function sessionCache(fastify: FastifyInstance) {
  fastify.get('/manage-hierarchy/:action/:placeType', async (req, resp) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const contactTypes = Config.contactTypes();

    const contactType = Config.getContactType(placeType);
    const viewModel: AppViewModel = {
      view: 'manage-hierarchy',
      op: params.action,
      logo: Config.getLogoBase64(),
      contactTypes,
      contactType,
      session: req.chtSession,
      ...hierarchyViewModel(params.action, contactType),
    };

    return resp.view('src/liquid/app/view.liquid', viewModel);
  });

  fastify.post('/manage-hierarchy', async (req, resp) => {
    const formData: any = req.body;

    const sessionCache: SessionCache = req.sessionCache;
    const contactType = Config.getContactType(formData.place_type);
    const chtApi = new ChtApi(req.chtSession);

    const viewModel: ManageHierarchyFormContentViewModel = {
      op: formData.op,
      contactType,
      data: formData,
      ...hierarchyViewModel(formData.op, contactType),
      success: false,
      confirm: false,
    };

    try {
      const isConfirmed = formData.confirmed === 'true';
      const job = await ManageHierarchyLib.getJobDetails(
        formData,
        contactType,
        sessionCache,
        chtApi
      );
      if (isConfirmed) {
        await ManageHierarchyLib.scheduleJob(job);
        viewModel.success = true;
      } else {
        const warningInfo = await ManageHierarchyLib.getWarningInfo(
          job,
          chtApi
        );
        viewModel.warningInfo = warningInfo;
      }

      viewModel.confirm = !isConfirmed;
      return resp.view('src/liquid/components/manage_hierarchy_form_content.liquid', viewModel);
    } catch (e: any) {
      viewModel.error = e.toString();
      return resp.view('src/liquid/components/manage_hierarchy_form_content.liquid', viewModel);
    }
  });
}
