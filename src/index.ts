require('dotenv').config();
import build from "./server";

(async () => {
  const loggerConfig = {
    transport: {
      target: "pino-pretty",
    },
  };
  const server = build({
    logger: loggerConfig,
  });
  server.listen({ port: 3000 }, (err, address) => {
    if (err) throw err;
    console.log(`server is listening on ${address}`);
  });
})();
