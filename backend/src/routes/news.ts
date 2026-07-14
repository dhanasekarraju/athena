import type { FastifyInstance } from "fastify";

export default async function newsRoutes(app: FastifyInstance) {
  app.get("/api/news", async (request, reply) => {
    const { limit = "30" } = request.query as { limit?: string };
    const news = await app.prisma.newsItem.findMany({
      orderBy: { publishedAt: "desc" },
      take: Math.min(Number(limit) || 30, 100),
    });
    return reply.send({ news });
  });
}
