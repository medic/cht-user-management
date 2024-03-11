import _ from 'lodash';
import { FastifyInstance } from 'fastify';
import { stringify } from 'csv/sync';
import { Config, ContactType } from '../config';
import SessionCache from '../services/session-cache';
import JSZip from 'jszip';

export default async function files(fastify: FastifyInstance) {
  fastify.get('/files/template/:placeType', async (req) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const placeTypeConfig = Config.getContactType(placeType);
    const hierarchy = Config.getHierarchyWithReplacement(placeTypeConfig);
    const columns = _.uniq([
      ...hierarchy.map(p => p.friendly_name),
      ...placeTypeConfig.place_properties.map(p => p.friendly_name),
      ...placeTypeConfig.contact_properties.map(p => p.friendly_name),
    ]);

    return stringify([columns]);
  });

  fastify.get('/files/credentials', async (req, reply) => {
    const sessionCache: SessionCache = req.sessionCache;
    const results = new Map<ContactType, String[][]>();
    const hierarchyProps = new Map<ContactType, string[]>();
    const places = sessionCache.getPlaces();
    places.forEach(place => {
      const record = [
        ...Object.values(place.hierarchyProperties),
        place.name,
        place.contact.properties.name,
        place.contact.properties.phone,
        place.creationDetails.username,
        place.creationDetails.password,
      ];
      const result = results.get(place.type) || [];
      result.push(record);
      results.set(place.type, result);
      if (!hierarchyProps.has(place.type)) {
        hierarchyProps.set(place.type, Object.keys(place.hierarchyProperties));
      }
    });
    const zip = new JSZip();
    results.forEach((places, contactType) => {
      const constraints = Config.getHierarchyWithReplacement(contactType);
      const props = hierarchyProps.get(contactType)!.map(prop => constraints.find(c => c.property_name === prop)!.friendly_name);
      const columns = [
        ...props,
        contactType.friendly,
        'name',
        'phone',
        'username',
        'password'
      ];
      zip.file(
        `${contactType.name}.csv`,
        stringify(places, {
          columns: columns,
          header: true,
        })
      );
    });
    reply.header('Content-Disposition', `attachment; filename="${Date.now()}_${req.chtSession.authInfo.friendly}_users.zip"`);
    return zip.generateNodeStream();
  });
}
