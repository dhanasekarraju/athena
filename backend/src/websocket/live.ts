import type { FastifyInstance } from "fastify";
import { env } from "../utils/env.js";

/**
 * Relays live signal updates from the Python AI engine's WebSocket
 * to connected mobile clients on /ws/live.
 */
export default async function websocketRoutes(app: FastifyInstance) {
  app.get("/ws/live", { websocket: true }, (connection, req) => {
    const clientSocket = connection.socket;
    let upstream: WebSocket | null = null;

    try {
      const aiWsUrl = env.AI_ENGINE_URL.replace(/^http/, "ws") + "/ws/signals";
      upstream = new WebSocket(aiWsUrl);

      upstream.addEventListener("open", () => {
        clientSocket.send(JSON.stringify({ type: "connected" }));
      });

      upstream.addEventListener("message", (event) => {
        clientSocket.send(event.data as string);
      });

      upstream.addEventListener("error", () => {
        clientSocket.send(JSON.stringify({ type: "error", message: "AI engine connection lost" }));
      });

      clientSocket.on("message", (raw: Buffer) => {
        if (upstream && upstream.readyState === upstream.OPEN) {
          upstream.send(raw.toString());
        }
      });

      clientSocket.on("close", () => {
        upstream?.close();
      });
    } catch (err) {
      app.log.error(err);
      clientSocket.close();
    }
  });
}
