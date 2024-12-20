import { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { stringify } from 'csv/sync';

import { Config } from '../config';
import getCredentialsFiles from '../lib/credentials-file';
import SessionCache from '../services/session-cache';

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
    const files = getCredentialsFiles(sessionCache, Config.contactTypes());
    for (const file of files) {
      zip.file(file.filename, file.content);
    }
    
    reply.header('Content-Disposition', `attachment; filename="${Date.now()}_${req.chtApi.chtSession.authInfo.friendly}_users.zip"`);
    return zip.generateNodeStream();
  });
}
