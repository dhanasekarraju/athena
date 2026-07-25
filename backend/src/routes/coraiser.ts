import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { coraiserChat, coraiserHistory } from "../services/coraiser.js";

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
});

export default async function coraiserRoutes(app: FastifyInstance) {
  app.get("/api/coraiser/history", { preHandler: [app.authenticate] }, async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const messages = await coraiserHistory(app.prisma, userId);
    return { messages };
  });

  app.post("/api/coraiser/chat", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = ChatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const userId = (request.user as { sub: string }).sub;
    const result = await coraiserChat(app.prisma, app.log, userId, parsed.data.message.trim());
    return result;
  });

  app.delete("/api/coraiser/history", { preHandler: [app.authenticate] }, async (request) => {
    const userId = (request.user as { sub: string }).sub;
    await app.prisma.coraiserMessage.deleteMany({ where: { userId } });
    return { ok: true };
  });
}
