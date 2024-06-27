import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';

import { getMoveContactQueue } from '../lib/queues';


async function bullMQBoardPlugin(fastify: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();


  createBullBoard({
    queues: [
      new BullMQAdapter(
        getMoveContactQueue().bullQueue
      ),
    ],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Jobs Board',
      },
    },
  });

  serverAdapter.setBasePath('/board');
  fastify.register(serverAdapter.registerPlugin(), { 
    prefix: '/board',
    basePath: '',
  });

}

export default fp(bullMQBoardPlugin, {
  name: 'bullMQBoardPlugin',
});
