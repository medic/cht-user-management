import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { Job, Queue } from 'bullmq';

import { getChtConfQueue } from '../lib/queues';

const BOARD_PREFIX = '/board';
const REDACTED_JOB_DATA_FIELDS = ['sessionToken'];

export const redactJobData = (data: any) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  const redacted = { ...data };
  for (const field of REDACTED_JOB_DATA_FIELDS) {
    if (field in redacted) {
      redacted[field] = '[REDACTED]';
    }
  }
  return redacted;
};

const isBoardRequest = (url: string) => url === BOARD_PREFIX || url.startsWith(`${BOARD_PREFIX}/`) || url.startsWith(`${BOARD_PREFIX}?`);

export const assertBoardAccess = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!isBoardRequest(req.url)) {
    return;
  }

  if (!req.chtSession?.isAdmin) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
};

export class SafeBullMQAdapter extends BullMQAdapter {
  constructor(queue: Queue) {
    super(queue, { readOnlyMode: true });
    this.setFormatter('data', redactJobData);
  }

  private alignJobOptsDelay(job: Job | any): Job | any {
    if (!job) {
      return job;
    }
    const delay = typeof job.delay === 'number' ? job.delay : 0;
    if (!job.opts) {
      job.opts = {};
    }
    if (typeof job.opts.delay !== 'number') {
      job.opts.delay = delay;
    }

    if (typeof job.toJSON === 'function') {
      const origToJSON = job.toJSON.bind(job);
      job.toJSON = () => {
        const json = origToJSON();
        if (json) {
          const opts = json.opts ? { ...json.opts } : {};
          if (typeof opts.delay !== 'number') {
            opts.delay = delay;
          }
          json.opts = opts;
        }
        return json;
      };
    }

    return job;
  }

  public override async getJobs(jobStatuses: any[], start?: number, end?: number): Promise<Job[]> {
    const jobs = await super.getJobs(jobStatuses, start, end);
    return jobs.map((job) => this.alignJobOptsDelay(job));
  }

  public override async getJob(id: string): Promise<Job | undefined> {
    const job = await super.getJob(id);
    return job ? this.alignJobOptsDelay(job) : undefined;
  }
}

async function bullMQBoardPlugin(fastify: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();

  createBullBoard({
    queues: [
      new SafeBullMQAdapter(
        getChtConfQueue().bullQueue
      ),
    ],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Jobs Board',
      },
    },
  });

  // runs after the global login hook (preValidation) has populated req.chtSession
  fastify.addHook('preHandler', assertBoardAccess);

  serverAdapter.setBasePath(BOARD_PREFIX);
  fastify.register(serverAdapter.registerPlugin(), { 
    prefix: BOARD_PREFIX,
    basePath: '',
  });

  fastify.addHook('onSend', async (request, _reply, payload) => {
    if (typeof payload === 'string' && request.url.startsWith(`${BOARD_PREFIX}/api/queues`)) {
      try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed?.queues)) {
          for (const q of parsed.queues) {
            if (Array.isArray(q?.jobs)) {
              for (const j of q.jobs) {
                if (j && (!j.opts || typeof j.opts.delay !== 'number')) {
                  j.opts = { ...j.opts, delay: typeof j.delay === 'number' ? j.delay : 0 };
                }
              }
            }
          }
          return JSON.stringify(parsed);
        }
        if (parsed?.job) {
          if (!parsed.job.opts || typeof parsed.job.opts.delay !== 'number') {
            parsed.job.opts = { ...parsed.job.opts, delay: typeof parsed.job.delay === 'number' ? parsed.job.delay : 0 };
          }
          return JSON.stringify(parsed);
        }
      } catch {
        // Return original payload if parsing fails
      }
    }
    return payload;
  });
}

export default fp(bullMQBoardPlugin, {
  name: 'bullMQBoardPlugin',
});

