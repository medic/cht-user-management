import _ from 'lodash';

import { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { stringify } from 'csv/sync';

import { Config, ContactProperty } from '../config';
import getCredentialsFiles from '../lib/credentials-file';
import SessionCache from '../services/session-cache';

export default async function files(fastify: FastifyInstance) {
  fastify.get('/files/template/:placeType', async (req) => {
    const params: any = req.params;
    const placeType = params.placeType;
    const columns = getCsvTemplateColumns(placeType);
    return stringify([columns]);
  });

  fastify.get('/files/credentials', async (req, reply) => {
    const sessionCache: SessionCache = req.sessionCache;

    const zip = new JSZip();
    const files = getCredentialsFiles(sessionCache, Config.contactTypes());
    for (const file of files) {
      zip.file(file.filename, file.content);
    }
    
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
    ...(placeTypeConfig.superset ? [placeTypeConfig.superset.friendly_name] : []),
  ]);
  return columns;
}
