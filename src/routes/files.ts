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
    const userRoleConfig = Config.getUserRoleConfig(placeTypeConfig);
    const columns = _.uniq([
      ...hierarchy.map(p => p.friendly_name),
      ...placeTypeConfig.place_properties.map(p => p.friendly_name),
      ...placeTypeConfig.contact_properties.map(p => p.friendly_name),
      ...(Config.supportsMultipleRoles(placeTypeConfig) ? [userRoleConfig.friendly_name] : []),
    ]);

    return stringify([columns]);
  });

  fastify.get('/files/credentials', async (req, reply) => {
    const sessionCache: SessionCache = req.sessionCache;
    const results = new Map<ContactType, String[][]>();
    const places = sessionCache.getPlaces();
    places.forEach(place => {
      const parent = Config.getParentProperty(place.type);
      const record = [
        place.hierarchyProperties[parent.property_name],
        place.name,
        place.contact.properties.name,
        place.contact.properties.phone,
        place.creationDetails.username,
        place.creationDetails.password,
        place.extractUserRoles().join(' '),
      ];
     
      const result = results.get(place.type) || [];
      result.push(record);
      results.set(place.type, result);
    });
    const zip = new JSZip();
    results.forEach((places, contactType) => {
      const parent = Config.getParentProperty(contactType);
      const columns = [
        parent.friendly_name,
        contactType.friendly,
        'name',
        'phone',
        'username',
        'password',
        'role',
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
