import { FastifyInstance } from 'fastify';

import { Config } from '../config';
import DirectiveModel from '../services/directive-model';
import SessionCache from '../services/session-cache';
import { UploadManager } from '../services/upload-manager';
import { minify } from 'html-minifier';
import { PlaceUploadState } from '../services/place';
import { DirectiveViewModel } from '../liquid/place';
import { PlaceItemViewModel } from '../liquid/components';

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
      const viewModel: DirectiveViewModel = {
        session: req.chtSession,
        contactTypes: Config.contactTypes(),
        directiveModel,
      };
      const html = await fastify.view('src/liquid/place/directive.liquid', viewModel);
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
        const viewModel: PlaceItemViewModel = {
          session: req.chtSession,
          contactType: {
            ...place.type,
            hierarchy: Config.getHierarchyWithReplacement(place.type, 'desc'),
          },
          place: place,
        };

        const html = await fastify.view('src/liquid/components/place_item.liquid', viewModel);

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
    uploadManager.on('refresh_place', async (args) => {
      const { id, state, err } = args;
      let statusText;
      if (state === PlaceUploadState.FAILURE) {
        statusText = `<span class="tag is-size-7 is-capitalized has-tooltip-multiline is-warning" data-tooltip="${err}">${state}</span>`;
      } else {
        statusText = `<span class="tag is-size-7 is-success is-capitalized">${state}</span>`;
      }
      resp.sse({ event: `update-${id}`, data: statusText });
    });

    req.socket.on('close', () => {
      uploadManager.removeListener('refresh_table_row', placeChangeListener);
    });
  });
}
