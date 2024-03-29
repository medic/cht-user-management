import { FastifyInstance } from 'fastify';
import { stringify } from 'csv/sync';
import { Config } from '../config';
import SessionCache from '../services/session-cache';
import JSZip from 'jszip';

export default async function files(fastify: FastifyInstance) {
  fastify.get('/files/template/:placeType', async (req) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const columns = Config.getCsvTemplateColumns(placeType);
    return stringify([columns]);
  });

  fastify.get('/files/credentials', async (req, reply) => {
    const sessionCache: SessionCache = req.sessionCache;
    const zip = new JSZip();
    for (const contactType of Config.contactTypes()) {
      const places = sessionCache.getPlaces({ type: contactType.name });
      if (!places.length) {
        continue;
      }
      const rows = places.map((place) => [
        ...Object.values(place.hierarchyProperties),
        place.name,
        place.contact.properties.name,
        place.contact.properties.phone,
        place.userRoles.join(' '),
        place.creationDetails.username,
        place.creationDetails.password,
      ]);
      const constraints = Config.getHierarchyWithReplacement(contactType);
      const props = Object.keys(places[0].hierarchyProperties).map(prop => constraints.find(c => c.property_name === prop)!.friendly_name);
      const columns = [
        ...props,
        contactType.friendly,
        'name',
        'phone',
        'role',
        'username',
        'password',
      ];
      zip.file(
        `${contactType.name}.csv`,
        stringify(rows, {
          columns,
          header: true,
        })
      );
    }
    reply.header('Content-Disposition', `attachment; filename="${Date.now()}_${req.chtSession.authInfo.friendly}_users.zip"`);
    return zip.generateNodeStream();
  });
}
