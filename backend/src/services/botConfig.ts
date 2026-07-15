import type { PrismaClient } from "@prisma/client";
import { env } from "../utils/env.js";

export interface RuntimeBotConfig {
  autonomousEnabled: boolean;
  paperTrading: boolean;
  maxOrderInr: number;
  maxOpenExposureInr: number;
  minConfidence: number;
  symbols: string[];
  slFraction: number;
  tp1Fraction: number;
  skipHighRisk: boolean;
  updatedAt?: string;
}

const DEFAULTS: Omit<RuntimeBotConfig, "updatedAt"> = {
  autonomousEnabled: env.AUTONOMOUS_TRADING,
  paperTrading: env.PAPER_TRADING,
  maxOrderInr: env.MAX_ORDER_INR,
  maxOpenExposureInr: env.MAX_OPEN_EXPOSURE_INR,
  minConfidence: env.MIN_SIGNAL_CONFIDENCE,
  symbols: env.AUTONOMOUS_SYMBOLS.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  slFraction: env.SL_FRACTION,
  tp1Fraction: env.TP1_FRACTION,
  skipHighRisk: true,
};

function rowToConfig(row: {
  autonomousEnabled: boolean;
  paperTrading: boolean;
  maxOrderInr: number;
  maxOpenExposureInr: number;
  minConfidence: number;
  symbols: string;
  slFraction: number;
  tp1Fraction: number;
  skipHighRisk: boolean;
  updatedAt: Date;
}): RuntimeBotConfig {
  return {
    autonomousEnabled: row.autonomousEnabled,
    paperTrading: row.paperTrading,
    maxOrderInr: row.maxOrderInr,
    maxOpenExposureInr: row.maxOpenExposureInr,
    minConfidence: row.minConfidence,
    symbols: row.symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    slFraction: row.slFraction,
    tp1Fraction: row.tp1Fraction,
    skipHighRisk: row.skipHighRisk,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureBotConfig(prisma: PrismaClient): Promise<RuntimeBotConfig> {
  const existing = await prisma.botConfig.findUnique({ where: { id: "default" } });
  if (existing) return rowToConfig(existing);

  const created = await prisma.botConfig.create({
    data: {
      id: "default",
      autonomousEnabled: DEFAULTS.autonomousEnabled,
      paperTrading: DEFAULTS.paperTrading,
      maxOrderInr: DEFAULTS.maxOrderInr,
      maxOpenExposureInr: DEFAULTS.maxOpenExposureInr,
      minConfidence: DEFAULTS.minConfidence,
      symbols: DEFAULTS.symbols.join(","),
      slFraction: DEFAULTS.slFraction,
      tp1Fraction: DEFAULTS.tp1Fraction,
      skipHighRisk: DEFAULTS.skipHighRisk,
    },
  });
  return rowToConfig(created);
}

export async function getBotConfig(prisma: PrismaClient): Promise<RuntimeBotConfig> {
  return ensureBotConfig(prisma);
}

export async function updateBotConfig(
  prisma: PrismaClient,
  patch: Partial<{
    autonomousEnabled: boolean;
    paperTrading: boolean;
    maxOrderInr: number;
    maxOpenExposureInr: number;
    minConfidence: number;
    symbols: string[];
    slFraction: number;
    tp1Fraction: number;
    skipHighRisk: boolean;
  }>,
): Promise<RuntimeBotConfig> {
  await ensureBotConfig(prisma);

  const data: Record<string, unknown> = {};
  if (patch.autonomousEnabled !== undefined) data.autonomousEnabled = patch.autonomousEnabled;
  if (patch.paperTrading !== undefined) data.paperTrading = patch.paperTrading;
  if (patch.maxOrderInr !== undefined) data.maxOrderInr = Math.max(50, Math.min(50000, patch.maxOrderInr));
  if (patch.maxOpenExposureInr !== undefined) {
    data.maxOpenExposureInr = Math.max(50, Math.min(100000, patch.maxOpenExposureInr));
  }
  if (patch.minConfidence !== undefined) {
    data.minConfidence = Math.max(0, Math.min(100, patch.minConfidence));
  }
  if (patch.symbols !== undefined) {
    const cleaned = patch.symbols.map((s) => s.toUpperCase()).filter((s) => ["BTC", "ETH", "SOL"].includes(s));
    data.symbols = (cleaned.length ? cleaned : ["BTC"]).join(",");
  }
  if (patch.slFraction !== undefined) data.slFraction = Math.max(0.05, Math.min(0.9, patch.slFraction));
  if (patch.tp1Fraction !== undefined) data.tp1Fraction = Math.max(0.05, Math.min(5, patch.tp1Fraction));
  if (patch.skipHighRisk !== undefined) data.skipHighRisk = patch.skipHighRisk;

  const updated = await prisma.botConfig.update({ where: { id: "default" }, data });
  return rowToConfig(updated);
}
