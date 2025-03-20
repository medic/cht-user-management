import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { minify } from 'html-minifier';

export default async function events(fastify: FastifyInstance) {
  fastify.get('/events/connection', async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;

    resp.hijack();

    const updateDirective = async () => {
      const directiveModel = new DirectiveModel(
        sessionCache,
        req.cookies.filter
      );
      const html = await fastify.view('src/liquid/place/directive.html', {
        directiveModel,
      });
      resp.sse({
        event: `directive`,
        data: minify(html, {
          html5: true,
          collapseWhitespace: true,
        }),
      });
    };

    const placeChangeListener = async (arg: string) => {
      const place = sessionCache.getPlace(arg);
      if (!place) {
        resp.sse({ event: `update-${arg}`, data: '<tr></tr>' });
      } else {
        const html = await fastify.view(
          'src/liquid/components/place_item.html',
          {
            session: req.chtSession,
            contactType: {
              ...place.type,
              hierarchy: Config.getHierarchyWithReplacement(place.type, 'desc'),
              userRoleProperty: Config.getUserRoleConfig(place.type),
            },
            place: place,
          }
        );

        resp.sse({
          event: `update-${arg}`,
          data: minify(html, {
            html5: true,
            collapseWhitespace: true,
          }),
        });
      }
      await updateDirective();
    };

    uploadManager.on('refresh_table_row', placeChangeListener);
    uploadManager.on('refresh_grouped', async () => {
      resp.sse({ event: `update-group`, data: `update` });
    });

    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table_row', placeChangeListener);
    });
  });
}
