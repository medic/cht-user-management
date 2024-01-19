require('dotenv').config();
import build from "./server";
import { env } from 'process';
const {
  NODE_ENV
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
  server.listen({ host: '0.0.0.0', port }, (err, address) => {
    if (err) throw err;
    console.log(`server is listening on ${address}`);
    if (NODE_ENV !== 'production') {
      console.log("\n==============  DEV MODE   ==================\n" +
        "Point your browser at http://127.0.0.1:" + port +
        "\n=============================================\n" );
    }
  });
})();
