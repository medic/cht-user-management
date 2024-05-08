import _ from 'lodash';

import { FastifyInstance } from 'fastify';
import { stringify } from 'csv/sync';
import { Config, ContactProperty } from '../config';
import SessionCache from '../services/session-cache';
import createZip from '../services/files';

export default async function files(fastify: FastifyInstance) {
  fastify.get('/files/template/:placeType', async (req) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const columns = getCsvTemplateColumns(placeType);
    return stringify([columns]);
  });

  fastify.get('/files/credentials', async (req, reply) => {
    const sessionCache: SessionCache = req.sessionCache;
    const zip = createZip(sessionCache);
    reply.header('Content-Disposition', `attachment; filename="${Date.now()}_${req.chtSession.authInfo.friendly}_users.zip"`);
    return zip.generateNodeStream();
  });
}

function getCsvTemplateColumns(placeType: string) {
  const placeTypeConfig = Config.getContactType(placeType);
  const hierarchy = Config.getHierarchyWithReplacement(placeTypeConfig);
  const userRoleConfig = Config.getUserRoleConfig(placeTypeConfig);

  const extractColumns = (properties: ContactProperty[]) => properties
    .filter(p => p.type !== 'generated')
    .map(p => p.friendly_name);

  const columns = _.uniq([
    ...hierarchy.map(p => p.friendly_name),
    ...extractColumns(placeTypeConfig.place_properties),
    ...extractColumns(placeTypeConfig.contact_properties),
    ...(Config.hasMultipleRoles(placeTypeConfig) ? [userRoleConfig.friendly_name] : []),
  ]);
  return columns;
}
