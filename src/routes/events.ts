import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { minify } from 'html-minifier';
import { PlaceUploadState } from '../services/place';

export default async function events(fastify: FastifyInstance) {
  // compress: false — this is a long-lived SSE (text/event-stream) response; compressing it buffers
  // events (breaking real-time delivery)
  fastify.get('/events/connection', { compress: false }, async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;

    resp.hijack();

    const updateDirective = async () => {
      const directiveModel = new DirectiveModel(
        sessionCache,
        req.cookies.filter
      );
      const html = await fastify.view('src/liquid/place/directive.liquid', {
        session: req.chtSession,
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
          'src/liquid/components/place_item.liquid',
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

    const groupedChangeListener = async () => {
      resp.sse({ event: `update-group`, data: `update` });
    };

    const placeStateListener = async (args: { id: string; state: PlaceUploadState; err?: string }) => {
      const { id, state, err } = args;
      let statusText;
      if (state === PlaceUploadState.FAILURE) {
        statusText = `<span class="tag is-size-7 is-capitalized has-tooltip-multiline is-warning" data-tooltip="${err}">${state}</span>`;
      } else {
        statusText = `<span class="tag is-size-7 is-success is-capitalized">${state}</span>`;
      }
      resp.sse({ event: `update-${id}`, data: statusText });
    };

    uploadManager.on('refresh_table_row', placeChangeListener);
    uploadManager.on('refresh_grouped', groupedChangeListener);
    uploadManager.on('refresh_place', placeStateListener);

    // Remove *every* listener
    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table_row', placeChangeListener);
      uploadManager.removeListener('refresh_grouped', groupedChangeListener);
      uploadManager.removeListener('refresh_place', placeStateListener);
    });
  });
}
