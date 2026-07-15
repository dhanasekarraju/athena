-- CreateTable
CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autonomousEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paperTrading" BOOLEAN NOT NULL DEFAULT true,
    "maxOrderInr" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "maxOpenExposureInr" DOUBLE PRECISION NOT NULL DEFAULT 2000,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 55,
    "symbols" TEXT NOT NULL DEFAULT 'BTC,ETH',
    "slFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "tp1Fraction" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "skipHighRisk" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);

-- Seed default row
INSERT INTO "BotConfig" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
