import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import crypto from "node:crypto";
import { env } from "../utils/env.js";

const CredsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = CredsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "Email already registered" });

    const passwordHash = await argon2.hash(password);
    const user = await app.prisma.user.create({ data: { email, passwordHash } });

    return issueTokens(app, reply, user.id, email);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = CredsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const user = await app.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    return issueTokens(app, reply, user.id, email);
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const { refreshToken } = (request.body as { refreshToken?: string }) ?? {};
    if (!refreshToken) return reply.code(400).send({ error: "refreshToken required" });

    const stored = await app.prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date()) {
      return reply.code(401).send({ error: "Invalid or expired refresh token" });
    }

    const user = await app.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) return reply.code(401).send({ error: "User not found" });

    await app.prisma.refreshToken.delete({ where: { id: stored.id } });
    return issueTokens(app, reply, user.id, user.email);
  });

  app.post("/api/auth/logout", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { refreshToken } = (request.body as { refreshToken?: string }) ?? {};
    if (refreshToken) {
      await app.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    return reply.send({ success: true });
  });
}

async function issueTokens(app: FastifyInstance, reply: any, userId: string, email: string) {
  const accessToken = app.jwt.sign({ sub: userId, email });
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await app.prisma.refreshToken.create({
    data: { token: refreshToken, userId, expiresAt },
  });

  return reply.send({
    accessToken,
    refreshToken,
    user: { id: userId, email },
  });
}
