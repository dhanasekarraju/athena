import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { env } from "../utils/env.js";

export default fp(async (app: FastifyInstance) => {
  app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: "7d" },
  });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}
