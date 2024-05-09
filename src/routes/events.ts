import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { minify } from 'html-minifier';

export default async function events(fastify: FastifyInstance) {
  fastify.get('/events/places/all', async (req, resp) => {
    const sessionCache: SessionCache = req.sessionCache;
    const contactTypes = Config.contactTypes();
    const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);
    const placeData = contactTypes.map(item => ({
      ...item,
      places: sessionCache.getPlaces({
        type: item.name,
        filter: directiveModel.filter,
      }),
      hierarchy: Config.getHierarchyWithReplacement(item, 'desc'),
      userRoleProperty: Config.getUserRoleConfig(item),
    }));

    return resp.view('src/liquid/place/list_event.html', {
      contactTypes: placeData,
      session: req.chtSession,
      directiveModel,
    });
  });

  fastify.get('/events/connection', async (req, resp) => {
    const uploadManager: UploadManager = fastify.uploadManager;
    const sessionCache: SessionCache = req.sessionCache;

    resp.hijack();

    const updateDirective = () => {
      const directiveModel = new DirectiveModel(sessionCache, req.cookies.filter);
      fastify.view('src/liquid/place/directive.html', { directiveModel }).then((html) => {
        resp.sse({
          event: `directive`, data: minify(html, {
            html5: true,
            collapseWhitespace: true,
          })
        });
      });
    };

    const placeChangeListener = (arg: string) => {
      const place = sessionCache.getPlace(arg);
      if (!place) {
        resp.sse({ event: `update-${arg}`, data: '<tr></tr>' });
      } else {
        fastify
          .view('src/liquid/components/place_item.html', {
            contactType: {
              ...place.type,
              hierarchy: Config.getHierarchyWithReplacement(place.type, 'desc'),
              userRoleProperty: Config.getUserRoleConfig(place.type),
            },
            place: place,
          })
          .then((html) => {
            resp.sse({
              event: `update-${arg}`, data: minify(html, {
                html5: true,
                collapseWhitespace: true,
                collapseInlineTagWhitespace: true,
              })
            });
          });
      }
      updateDirective();
    };

    uploadManager.on('refresh_table_row', placeChangeListener);

    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table_row', placeChangeListener);
    });
  });
}
