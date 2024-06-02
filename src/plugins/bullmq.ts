import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';

import { QUEUE_NAMES, queueManager } from '../../shared/queues';


async function bullMQBoardPlugin(fastify: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();

  const moveContactQueue = queueManager.getQueue(QUEUE_NAMES.MOVE_CONTACT_QUEUE);

  createBullBoard({
    queues: [
      new BullMQAdapter(
        moveContactQueue
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
