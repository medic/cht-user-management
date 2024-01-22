require('dotenv').config();
import build from "./server";
import { env } from 'process';
const {
  NODE_ENV,
  INTERFACE
} = process.env;

const port: number = env.PORT ? parseInt(env.PORT) : 3000;

(async () => {
  const loggerConfig = {
    transport: {
      target: "pino-pretty",
    },
  };
  const server = build({
    logger: loggerConfig,
  });

  // in 1.1.0 we allowed INTERFACE to be declared in .env, but let's be
  // backwards compatible to when it was undeclared and hard coded to
  // be 0.0.0.0
  let calculated_interface = "0.0.0.0";
  if(INTERFACE){
    calculated_interface = INTERFACE;
  }
  server.listen({ host: calculated_interface, port }, (err, address) => {
    if (err) throw err;
  });
})();
