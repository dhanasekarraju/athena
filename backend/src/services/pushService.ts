import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { env } from "../utils/env.js";

type Messaging = {
  sendEachForMulticast: (msg: {
    tokens: string[];
    notification: { title: string; body: string };
    android?: { priority: "high"; notification?: { channelId: string } };
  }) => Promise<{
    successCount: number;
    failureCount: number;
    responses: Array<{ success: boolean; error?: { code?: string } }>;
  }>;
};

let messagingPromise: Promise<Messaging | null> | null = null;

async function getMessaging(log: FastifyBaseLogger): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
      if (!raw) {
        log.info("Push: FIREBASE_SERVICE_ACCOUNT_JSON empty — buy/sell pushes disabled");
        return null;
      }
      try {
        const admin = await import("firebase-admin");
        const cred = JSON.parse(raw) as Record<string, string>;
        if (!admin.apps.length) {
          admin.initializeApp({ credential: admin.credential.cert(cred as never) });
        }
        log.info("Push: Firebase Admin initialized");
        return admin.messaging() as unknown as Messaging;
      } catch (err) {
        log.warn({ err }, "Push: Firebase Admin init failed — pushes disabled");
        return null;
      }
    })();
  }
  return messagingPromise;
}

/** Notify all registered devices (single-operator bot). */
export async function notifyTrade(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  input: { title: string; body: string },
): Promise<void> {
  const msg = await getMessaging(log);
  if (!msg) return;

  const rows = await prisma.deviceToken.findMany({
    select: { id: true, token: true },
    take: 200,
  });
  if (!rows.length) {
    log.debug("Push: no device tokens registered");
    return;
  }

  const tokens = rows.map((r) => r.token);
  try {
    const result = await msg.sendEachForMulticast({
      tokens,
      notification: { title: input.title, body: input.body },
      android: {
        priority: "high",
        notification: { channelId: "athena_trades" },
      },
    });
    log.info(
      { ok: result.successCount, fail: result.failureCount, title: input.title },
      "Push: trade notification sent",
    );

    const stale: string[] = [];
    result.responses.forEach((r, i) => {
      const code = r.error?.code ?? "";
      if (
        !r.success &&
        (code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token"))
      ) {
        stale.push(rows[i]!.id);
      }
    });
    if (stale.length) {
      await prisma.deviceToken.deleteMany({ where: { id: { in: stale } } });
    }
  } catch (err) {
    log.warn({ err }, "Push: send failed");
  }
}

export function notifyBuy(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  details: {
    paper: boolean;
    product: string;
    direction: string;
    size: number;
    premium: number;
    confidence?: number;
    timeframe?: string;
  },
): void {
  const tag = details.paper ? "PAPER" : "LIVE";
  const conf =
    details.confidence != null ? ` conf ${Number(details.confidence).toFixed(0)}` : "";
  const tf = details.timeframe ? ` ${details.timeframe}` : "";
  void notifyTrade(prisma, log, {
    title: `Athena bought (${tag})`,
    body: `${details.direction} ${details.product} ×${details.size} @ ${details.premium.toFixed(2)}${tf}${conf}`,
  });
}

export function notifySell(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  details: {
    paper: boolean;
    product: string;
    reason: string;
    mark: number;
    pnl: number;
    partial?: boolean;
  },
): void {
  const tag = details.paper ? "PAPER" : "LIVE";
  const kind = details.partial ? "partial sell" : "sold";
  const sign = details.pnl >= 0 ? "+" : "";
  void notifyTrade(prisma, log, {
    title: `Athena ${kind} (${tag})`,
    body: `${details.product} · ${details.reason} @ ${details.mark.toFixed(2)} · PnL ₹${sign}${details.pnl.toFixed(0)}`,
  });
}
