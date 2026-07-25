import type { FastifyInstance } from "fastify";
import { z } from "zod";

const RegisterSchema = z.object({
  token: z.string().min(20).max(512),
  platform: z.enum(["android", "ios"]).default("android"),
});

export default async function devicesRoutes(app: FastifyInstance) {
  app.post("/api/devices/fcm", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const userId = (request.user as { sub: string }).sub;
    const { token, platform } = parsed.data;

    await app.prisma.deviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform },
      update: { platform, updatedAt: new Date() },
    });

    return reply.send({ ok: true });
  });

  app.delete("/api/devices/fcm", { preHandler: [app.authenticate] }, async (request, reply) => {
    const token = (request.body as { token?: string } | null)?.token;
    const userId = (request.user as { sub: string }).sub;
    if (!token) return reply.code(400).send({ error: "token required" });

    await app.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return reply.send({ ok: true });
  });
}
