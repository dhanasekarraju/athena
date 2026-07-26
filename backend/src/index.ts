import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { env } from "./utils/env";
import prismaPlugin from "./plugins/prisma.js";
import jwtPlugin from "./plugins/jwt.js";

import authRoutes from "./routes/auth.js";
import marketRoutes from "./routes/market.js";
import signalRoutes from "./routes/signals.js";
import newsRoutes from "./routes/news.js";
import portfolioRoutes from "./routes/portfolio.js";
import botRoutes from "./routes/bot.js";
import devicesRoutes from "./routes/devices.js";
import coraiserRoutes from "./routes/coraiser.js";
import liveWebsocket from "./websocket/live.js";
import { getAutoTrader } from "./services/autoTrader.js";
import { getSignalPoller } from "./services/signalPoller.js";

// Prometheus metrics
import client from "prom-client";
import { randomUUID } from "node:crypto";

// Create a register which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: "athena-backend"
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

async function main() {
  const app = Fastify({
    logger: {
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    serializerOpts: {
      req: (request: FastifyRequest) => {
        return {
          method: request.method,
          url: request.url,
          hostname: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
          id: request.id
        };
      }
    }
  });

  // Generate request ID and attach to request/reply
  app.addHook("onRequest", (request: FastifyRequest, reply: FastifyReply, done) => {
    const reqIdHeader = request.headers["x-request-id"];
    const reqId = Array.isArray(reqIdHeader) ? reqIdHeader[0] : reqIdHeader ?? randomUUID();
    request.id = reqId;
    reply.header("X-Request-ID", reqId);
    // Create a child logger for this request with the request ID
    request.log = request.log.child({ reqId });
    done();
  });

  // Security: helmet
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "validator.npmjs.com"],
        scriptSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // Note: We are not excluding health and metrics endpoints from rate limiting due to limitation of the plugin version.
    // In a future update, we can adjust the plugin version or use a different method to exclude these endpoints.
  });

  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(websocketPlugin);
  await app.register(prismaPlugin);
  await app.register(jwtPlugin);

  // Health check with dependency verification
  app.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const health = {
      status: "ok",
      service: "athena-backend",
      timestamp: new Date().toISOString(),
      checks: {} as { [key: string]: any }
    };

    // Check database
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      health.checks.database = { status: "ok" };
    } catch (err) {
      health.status = "error";
      health.checks.database = { status: "error", error: String(err) };
    }

    // Check AI engine
    try {
      const aiHealthRes = await fetch(`${env.AI_ENGINE_URL}/health`);
      if (!aiHealthRes.ok) {
        throw new Error(`HTTP ${aiHealthRes.status}`);
      }
      const aiHealth = await aiHealthRes.json() as { status: string };
      health.checks.aiEngine = {
        ...aiHealth,
        status: aiHealth.status === "ok" ? "ok" : "error",
      };
      if (aiHealth.status !== "ok") {
        health.status = "error";
      }
    } catch (err) {
      health.status = "error";
      health.checks.aiEngine = { status: "error", error: String(err) };
    }

    // Check Redis (via ping)
    try {
      // We don't have direct Redis client here, but we can check via the AI engine or backend's own Redis usage?
      // For simplicity, we'll skip Redis check in health and rely on AI engine/backend logs.
      // Alternatively, we could attempt to ping Redis via the ioredis instance if we exposed it.
      // Since we don't have direct access, we'll omit for now.
      health.checks.redis = { status: "unknown", note: "Not checked in health endpoint" };
    } catch (err) {
      // Not setting error for Redis as it's optional for basic functionality
      health.checks.redis = { status: "error", error: String(err) };
    }

    if (health.status === "error") {
      return reply.code(503).send(health);
    }

    return health;
  });

  // Prometheus metrics endpoint
  app.get("/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await register.metrics();
      reply.header("Content-Type", register.contentType);
      return metrics;
    } catch (err) {
      request.log.error("Failed to generate metrics: %o", err as object);
      reply.status(500).send(err);
    }
  });

  // Register routes
  await app.register(authRoutes);
  await app.register(marketRoutes);
  await app.register(signalRoutes);
  await app.register(newsRoutes);
  await app.register(portfolioRoutes);
  await app.register(botRoutes);
  await app.register(devicesRoutes);
  await app.register(coraiserRoutes);
  await app.register(liveWebsocket);

  // Enhanced error handler with request logger
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const log = request.log ?? app.log;
    log.error(error);
    reply.code(error.statusCode ?? 500).send({
      error: error.message || "Internal Server Error",
      // Include request ID in error response for tracing
      requestId: request.id
    });
  });

  // Start server
  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`ATHENA backend listening on ${address}`);

  // Initialize background services after server is ready
  const { ensureBotConfig } = await import("./services/botConfig.js");
  await ensureBotConfig(app.prisma);
  const trader = getAutoTrader(app.prisma, app.log);
  trader.startMonitor();
  app.log.info(await trader.status(), "AutoTrader status");

  const poller = getSignalPoller(app.prisma, app.log);
  poller.start();
  app.log.info(poller.status, "SignalPoller status");

  // Setup graceful shutdown
  const shutdown = async () => {
    app.log.info("Shutdown signal received, shutting down gracefully...");
    try {
      // Stop accepting new connections
      await app.close();
      app.log.info("HTTP server closed");

      // Stop background services
      trader.stopMonitor();
      app.log.info("AutoTrader stopped");

      poller.stop();
      app.log.info("SignalPoller stopped");

      // Disconnect Prisma
      await app.prisma.$disconnect();
      app.log.info("Prisma disconnected");

      // Wait a bit for any pending promises
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      app.log.error("Error during shutdown: %o", err as object);
      process.exit(1);
    }
    process.exit(0);
  };

  // Listen for termination signals
  process.on("SIGTERM", () => {
    app.log.info("SIGTERM received");
    shutdown();
  });
  process.on("SIGINT", () => {
    app.log.info("SIGINT received");
    shutdown();
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
