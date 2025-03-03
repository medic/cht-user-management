import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readConfig, writeConfig } from '../config/config-factory';
import { Config, ConfigSystem } from '../config';

export default async function api(fastify: FastifyInstance) {
  fastify.get('/api', (req: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({
      name: 'UMT API',
      version: '1.0',
      status: 'healthy'
    });
  });

  fastify.get('/api/config', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { config } = await readConfig();
      reply.status(200);
      return config;
    } catch (error) {
      reply.status(404).send({ message: 'No configuration found' });
    }

  });

  fastify.post('/api/config', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await req.body as ConfigSystem;
      await Config.assertValid({ config });
      await writeConfig(config);
      reply.send({ message: 'configuration updated' });
      return;
    } catch (error) {
      console.error('Route api/config: ', error);
      reply.send(error);
    }
  });
}
