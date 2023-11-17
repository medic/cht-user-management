import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import view from "@fastify/view";
import formbody from "@fastify/formbody";
import autoload from "@fastify/autoload";
import multipart from "@fastify/multipart";
import { Liquid } from "liquidjs";
import { FastifySSEPlugin } from "fastify-sse-v2";
import path from "path";

const build = (opts: FastifyServerOptions): FastifyInstance => {
  const fastify = Fastify(opts);
  fastify.register(formbody);
  fastify.register(multipart);
  fastify.register(FastifySSEPlugin);
  fastify.register(view, {
    engine: {
      liquid: new Liquid({ extname: ".html", root: "src/public" }),
    },
  });
  fastify.register(autoload, {
    dir: path.join(__dirname, "plugins"),
  });
  fastify.register(autoload, {
    dir: path.join(__dirname, "routes"),
  });
  return fastify;
};

export default build;
