import type { PrismaClient } from "@prisma/client";

const LOOKBACK_MS = 4 * 60 * 60 * 1000;

/**
 * How long the current directional streak has been active (since last flip away
 * from this direction). Used to avoid entering moves that already ran 2–3 hours.
 */
export async function getDirectionAgeMs(
  prisma: PrismaClient,
  symbol: string,
  direction: string,
  minConfidence: number,
  nowMs = Date.now(),
): Promise<number | null> {
  const since = new Date(nowMs - LOOKBACK_MS);

  const lastOther = await prisma.signal.findFirst({
    where: {
      symbol: symbol.toUpperCase(),
      direction: { not: direction },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const streakStart = lastOther?.createdAt ?? since;

  const firstSame = await prisma.signal.findFirst({
    where: {
      symbol: symbol.toUpperCase(),
      direction,
      confidence: { gte: minConfidence },
      createdAt: { gte: streakStart },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  if (!firstSame) return null;
  return nowMs - firstSame.createdAt.getTime();
}
