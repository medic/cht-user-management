import { FastifyInstance } from 'fastify';
import { Config } from '../config';
import { ChtApi, CouchDoc, UserInfo } from '../lib/cht-api';

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

  fastify.post('/reassign', async (req, resp) => {
    const body =  req.body as { [key:string]:string };
    const contactType = Config.getContactType(body.place_type);

    const uuidMatch = body.contact.match('/contacts/(?<uuid>[a-z0-9]{32})');
    if (!uuidMatch?.groups?.uuid) {
      const errors = { contact: '*Invalid link' };
      return resp.view('src/liquid/reassign/form.liquid', {
        contactType,
        hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
        logo: Config.getLogoBase64(),
        session: req.chtSession,
        data: req.body,
        errors
      });
    }

    const contactId = uuidMatch.groups.uuid;
    const placeId = body.hierarchy_replacement_id;
    const chtApi = new ChtApi(req.chtSession);
    
    try {
      const user = await chtApi.getUser(contactId) as UserInfo & { place: CouchDoc[] };
      if (!user) {
        throw new Error('We did not find a person with the link provided. Please make sure the link is correct');
      }
      const updatedPlaces = [...user.place.map(d => d._id), placeId];
      await chtApi.updateUser({ username: user.username, place: updatedPlaces });
    } catch (err: any) {
      const errors = { form: 'Error: ' + err.message };
      return resp.view('src/liquid/reassign/form.liquid', {
        contactType,
        hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
        logo: Config.getLogoBase64(),
        session: req.chtSession,
        data: req.body,
        errors
      });
    }

    resp.header('HX-Redirect', `/`);
  });

}
