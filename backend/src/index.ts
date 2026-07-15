import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { env } from "./utils/env.js";
import prismaPlugin from "./plugins/prisma.js";
import jwtPlugin from "./plugins/jwt.js";

import authRoutes from "./routes/auth.js";
import marketRoutes from "./routes/market.js";
import signalRoutes from "./routes/signals.js";
import newsRoutes from "./routes/news.js";
import portfolioRoutes from "./routes/portfolio.js";
import botRoutes from "./routes/bot.js";
import liveWebsocket from "./websocket/live.js";
import { getAutoTrader } from "./services/autoTrader.js";

const app = Fastify({
  logger: {
    transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

async function main() {
  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(websocketPlugin);
  await app.register(prismaPlugin);
  await app.register(jwtPlugin);

  app.get("/health", async () => ({ status: "ok", service: "athena-backend" }));

  await app.register(authRoutes);
  await app.register(marketRoutes);
  await app.register(signalRoutes);
  await app.register(newsRoutes);
  await app.register(portfolioRoutes);
  await app.register(botRoutes);
  await app.register(liveWebsocket);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(error.statusCode ?? 500).send({
      error: error.message || "Internal Server Error",
    });
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`ATHENA backend listening on :${env.PORT}`);

  const { ensureBotConfig } = await import("./services/botConfig.js");
  await ensureBotConfig(app.prisma);
  const trader = getAutoTrader(app.prisma, app.log);
  trader.startMonitor();
  app.log.info(await trader.status(), "AutoTrader status");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
