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
});

export const env = EnvSchema.parse(process.env);
