import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

/**
 * Mirrors bot/AI activity into the NewsItem table so the mobile News tab
 * shows what Athena is thinking — no app update needed, the tab already
 * reads /api/news.
 *
 * Throttled per key: guard skips repeat every poll (30s), so identical
 * reasons are collapsed instead of flooding the feed.
 */

export type FeedSentiment = "Bullish" | "Bearish" | "Neutral";

export const BOT_FEED_URL = "athena://bot";

const lastPublishedAt = new Map<string, number>();

export interface BotFeedItem {
  /** Throttle key — identical keys within minIntervalMs are dropped. */
  key: string;
  minIntervalMs?: number;
  title: string;
  source: string;
  sentiment?: FeedSentiment;
  /** Shown nowhere yet, but stored (e.g. signal confidence or trend strength). */
  score?: number;
}

export async function publishBotFeed(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  item: BotFeedItem,
): Promise<void> {
  try {
    const now = Date.now();
    const last = lastPublishedAt.get(item.key) ?? 0;
    if (item.minIntervalMs && now - last < item.minIntervalMs) return;
    lastPublishedAt.set(item.key, now);

    await prisma.newsItem.create({
      data: {
        title: item.title.slice(0, 300),
        source: item.source,
        url: BOT_FEED_URL,
        sentiment: item.sentiment ?? "Neutral",
        sentimentScore: item.score ?? 0,
        publishedAt: new Date(),
      },
    });

    // Opportunistic cleanup so bot chatter doesn't grow unbounded.
    if (Math.random() < 0.02) {
      await prisma.newsItem.deleteMany({
        where: {
          url: BOT_FEED_URL,
          createdAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) },
        },
      });
    }
  } catch (err) {
    log.warn({ err, key: item.key }, "botFeed publish failed");
  }
}

/** Throttle key that survives changing numbers ("conf 32 < 35" ≈ "conf 34 < 35"). */
export function feedKeyFromMessage(prefix: string, message: string): string {
  const skeleton = message.replace(/[0-9₹.,×@()%]+/g, "").replace(/\s+/g, "_").slice(0, 80);
  return `${prefix}:${skeleton}`;
}

/** Best-effort direction coloring for the News tab chips. */
export function sentimentFromMessage(message: string): FeedSentiment {
  if (message.includes("BUY_CALL")) return "Bullish";
  if (message.includes("BUY_PUT")) return "Bearish";
  const pnl = message.match(/pnl≈₹(-?\d+)/);
  if (pnl) return Number(pnl[1]) >= 0 ? "Bullish" : "Bearish";
  return "Neutral";
}

const SOURCE_BY_LEVEL: Record<string, string> = {
  trade: "Athena • Trade",
  exit: "Athena • Exit",
  skip: "Athena • Guard",
  info: "Athena • Bot",
  error: "Athena • Error",
};

/** Skips repeat every poll; keep the feed readable by collapsing repeats for 10m. */
const SKIP_THROTTLE_MS = 10 * 60 * 1000;

export function botActivityToFeedItem(level: string, message: string): BotFeedItem {
  return {
    key: level === "skip" ? feedKeyFromMessage("skip", message) : `evt:${Date.now()}:${message.slice(0, 20)}`,
    minIntervalMs: level === "skip" ? SKIP_THROTTLE_MS : 0,
    title: message,
    source: SOURCE_BY_LEVEL[level] ?? "Athena • Bot",
    sentiment: sentimentFromMessage(message),
  };
}
