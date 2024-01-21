require('dotenv').config();
import build from './server';
import { env } from 'process';

const port: number = env.PORT ? parseInt(env.PORT) : 3000;

(async () => {
  const loggerConfig = {
    transport: {
      target: 'pino-pretty',
    },
  };
  const server = build({
    logger: loggerConfig,
  });
  server.listen({ host: '0.0.0.0', port }, (err, address) => {
    if (err) {
      throw err;
    }
    console.log(`server is listening on ${address}`);
  });
})();
