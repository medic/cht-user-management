import { expect } from 'chai';
import sinon from 'sinon';
import { Queue } from 'bullmq';
import Fastify from 'fastify';

import bullMQBoardPlugin, { SafeBullMQAdapter, redactJobData } from '../../src/plugins/bullmq';

describe('plugins/bullmq.ts', () => {
  let mockQueue: sinon.SinonStubbedInstance<Queue>;
  let adapter: SafeBullMQAdapter;

  beforeEach(() => {
    mockQueue = sinon.createStubInstance(Queue);
    sinon.stub(mockQueue, 'client').get(() => Promise.resolve({ info: sinon.stub().resolves('') }));
    Object.defineProperty(mockQueue, 'name', { value: 'MOVE_CONTACT_QUEUE', configurable: true });
    adapter = new SafeBullMQAdapter(mockQueue as unknown as Queue);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('SafeBullMQAdapter', () => {
    it('is read only', () => {
      expect(adapter.readOnlyMode).to.be.true;
    });

    it('redacts the session token from job data', () => {
      const data = { sourceId: 'a', destinationId: 'b', sessionToken: 'secret' };
      expect(adapter.format('data', data)).to.deep.eq({ sourceId: 'a', destinationId: 'b', sessionToken: '[REDACTED]' });
      expect(data.sessionToken).to.eq('secret');
    });

    it('redactJobData tolerates non-object data', () => {
      expect(redactJobData(undefined)).to.be.undefined;
      expect(redactJobData('x')).to.eq('x');
      expect(redactJobData({ sourceId: 'a' })).to.deep.eq({ sourceId: 'a' });
    });

    it('should set opts.delay to job.delay when opts.delay is undefined', async () => {
      const mockJob: any = {
        id: 'job-1',
        name: 'move_contacts',
        delay: 14400000,
        timestamp: 1728300000000,
        opts: { attempts: 3 },
        toJSON() {
          return {
            id: this.id,
            name: this.name,
            delay: this.delay,
            timestamp: this.timestamp,
            opts: { ...this.opts },
          };
        },
      };

      mockQueue.getJobs.resolves([mockJob]);

      const [job] = await adapter.getJobs(['delayed']);
      expect(job.opts).to.be.an('object');
      expect(job.opts.delay).to.equal(14400000);

      const json = job.toJSON();
      expect(json.opts).to.be.an('object');
      expect(json.opts.delay).to.equal(14400000);
    });

    it('should preserve existing opts.delay if already defined', async () => {
      const mockJob: any = {
        id: 'job-2',
        name: 'move_contacts',
        delay: 5000,
        timestamp: 1728300000000,
        opts: { attempts: 3, delay: 10000 },
        toJSON() {
          return {
            id: this.id,
            name: this.name,
            delay: this.delay,
            timestamp: this.timestamp,
            opts: { ...this.opts },
          };
        },
      };

      mockQueue.getJobs.resolves([mockJob]);

      const [job] = await adapter.getJobs(['delayed']);
      expect(job.opts.delay).to.equal(10000);

      const json = job.toJSON();
      expect(json.opts.delay).to.equal(10000);
    });

    it('should default opts.delay to 0 if job has no delay property', async () => {
      const mockJob: any = {
        id: 'job-3',
        name: 'move_contacts',
        timestamp: 1728300000000,
        opts: {},
        toJSON() {
          return {
            id: this.id,
            name: this.name,
            timestamp: this.timestamp,
            opts: { ...this.opts },
          };
        },
      };

      mockQueue.getJob.resolves(mockJob);

      const job = await adapter.getJob('job-3');
      expect(job).to.not.be.undefined;
      expect(job!.opts.delay).to.equal(0);

      const json = job!.toJSON();
      expect(json.opts.delay).to.equal(0);
    });

    it('should handle null/undefined job results gracefully', async () => {
      mockQueue.getJobs.resolves([null as any]);
      mockQueue.getJob.resolves(undefined);

      const jobs = await adapter.getJobs(['delayed']);
      expect(jobs).to.deep.equal([null]);

      const singleJob = await adapter.getJob('unknown');
      expect(singleJob).to.be.undefined;
    });
  });

  describe('Bull Board access control', () => {
    let fastify: ReturnType<typeof Fastify>;

    const buildWithSession = async (chtSession: any) => {
      fastify = Fastify();
      fastify.addHook('preValidation', async (req: any) => {
        req.chtSession = chtSession;
      });
      await fastify.register(bullMQBoardPlugin);
      fastify.get('/board/api/queues/test-access', async () => ({ ok: true }));
      fastify.get('/boardroom', async () => ({ ok: true }));
    };

    afterEach(async () => {
      await fastify.close();
    });

    it('allows admins', async () => {
      await buildWithSession({ isAdmin: true });
      const response = await fastify.inject({ method: 'GET', url: '/board/api/queues/test-access' });
      expect(response.statusCode).to.equal(200);
    });

    it('rejects non-admins', async () => {
      await buildWithSession({ isAdmin: false });
      const response = await fastify.inject({ method: 'GET', url: '/board/api/queues/test-access' });
      expect(response.statusCode).to.equal(403);
    });

    it('rejects requests without a session', async () => {
      await buildWithSession(undefined);
      const response = await fastify.inject({ method: 'GET', url: '/board/api/queues/test-access' });
      expect(response.statusCode).to.equal(403);
    });

    it('rejects non-admins on the board root', async () => {
      await buildWithSession({ isAdmin: false });
      const response = await fastify.inject({ method: 'GET', url: '/board' });
      expect(response.statusCode).to.equal(403);
    });

    for (const url of ['/%62oard/api/queues/test-access', '/b%6Fard/api/queues/test-access', '/board%2Fapi/queues/test-access']) {
      it(`rejects non-admins using an encoded path: ${url}`, async () => {
        await buildWithSession({ isAdmin: false });
        const response = await fastify.inject({ method: 'GET', url });
        expect(response.statusCode).to.not.equal(200);
        expect(response.json()).to.not.have.property('ok');
      });
    }

    it('rejects non-admins on board routes with a query string', async () => {
      await buildWithSession({ isAdmin: false });
      const response = await fastify.inject({ method: 'GET', url: '/board?x=1' });
      expect(response.statusCode).to.equal(403);
    });

    it('does not affect other routes', async () => {
      await buildWithSession({ isAdmin: false });
      const response = await fastify.inject({ method: 'GET', url: '/boardroom' });
      expect(response.statusCode).to.equal(200);
    });
  });

  describe('Fastify onSend hook for Bull Board API', () => {
    let fastify: ReturnType<typeof Fastify>;

    beforeEach(async () => {
      fastify = Fastify();
      fastify.addHook('preValidation', async (req: any) => {
        req.chtSession = { isAdmin: true };
      });
      await fastify.register(bullMQBoardPlugin);
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should ensure opts.delay is present in /board/api/queues responses', async () => {
      // Mock an endpoint that mimics /board/api/queues returning delayed jobs without opts.delay
      fastify.get('/board/api/queues/test-delayed', async (_req: any, reply: any) => {
        return reply.send({
          queues: [
            {
              name: 'MOVE_CONTACT_QUEUE',
              jobs: [
                {
                  id: 'delayed-1',
                  timestamp: 1728300000000,
                  delay: 14400000,
                  opts: { attempts: 3 },
                },
              ],
            },
          ],
        });
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/board/api/queues/test-delayed',
      });

      expect(response.statusCode).to.equal(200);
      const data = response.json();
      const job = data.queues[0].jobs[0];
      expect(job.opts.delay).to.equal(14400000);
      expect(Number.isFinite((job.timestamp || 0) + job.opts.delay)).to.be.true;
    });

    it('should ensure opts.delay is present in /board/api/queues/:queueName/:jobId responses', async () => {
      fastify.get('/board/api/queues/test-single-job', async (_req: any, reply: any) => {
        return reply.send({
          job: {
            id: 'job-delayed-single',
            timestamp: 1728300000000,
            delay: 14400000,
            opts: { attempts: 3 },
          },
        });
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/board/api/queues/test-single-job',
      });

      expect(response.statusCode).to.equal(200);
      const data = response.json();
      expect(data.job.opts.delay).to.equal(14400000);
      expect(Number.isFinite((data.job.timestamp || 0) + data.job.opts.delay)).to.be.true;
    });
  });
});
