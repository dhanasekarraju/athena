import { z } from "zod";
import "dotenv/config";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  REDIS_URL: z.string().default("redis://redis:6379"),
  AI_ENGINE_URL: z.string().default("http://ai-engine:8000"),
  CORS_ORIGIN: z.string().default("*"),

  // Cautious Delta auto-trader (options only)
  AUTONOMOUS_TRADING: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  PAPER_TRADING: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  DELTA_API_KEY: z.string().default(""),
  DELTA_API_SECRET: z.string().default(""),
  DELTA_BASE_URL: z.string().default("https://api.india.delta.exchange"),
  MAX_ORDER_INR: z.coerce.number().default(1000),
  MAX_OPEN_EXPOSURE_INR: z.coerce.number().default(2000),
  MIN_SIGNAL_CONFIDENCE: z.coerce.number().default(55),
  AUTONOMOUS_SYMBOLS: z.string().default("BTC,ETH"),
  SL_FRACTION: z.coerce.number().default(0.4), // sell if premium drops 40%
  TP1_FRACTION: z.coerce.number().default(0.5), // take profit +50%
  BOT_POLL_MS: z.coerce.number().default(15000),
  /** Used to size Delta USD-quoted options against INR risk caps */
  USD_INR_RATE: z.coerce.number().default(85),
  /** Virtual cash for paper trading equity display */
  PAPER_BALANCE_INR: z.coerce.number().default(10000),
});

export const env = EnvSchema.parse(process.env);
