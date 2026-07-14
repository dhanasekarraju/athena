import type { FastifyInstance } from "fastify";
import { aiEngineClient } from "../services/aiEngineClient.js";

export default async function marketRoutes(app: FastifyInstance) {
  app.get("/api/market/prices", async (_request, reply) => {
    try {
      const prices = await aiEngineClient.getMarketPrices();
      return reply.send({ prices });
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: "Market data unavailable" });
    }
  });

  app.get("/api/fear-greed", async (_request, reply) => {
    try {
      const data = await aiEngineClient.getFearGreed();
      return reply.send(data);
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: "Fear & Greed index unavailable" });
    }
  });
}
