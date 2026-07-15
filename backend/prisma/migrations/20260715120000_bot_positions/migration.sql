-- CreateTable
CREATE TABLE "BotPosition" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'delta',
    "productId" INTEGER NOT NULL,
    "productSymbol" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "entryPremium" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit1" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "paper" BOOLEAN NOT NULL DEFAULT true,
    "entryOrderId" TEXT,
    "exitOrderId" TEXT,
    "exitPremium" DOUBLE PRECISION,
    "exitReason" TEXT,
    "realizedPnl" DOUBLE PRECISION,
    "signalSnapshot" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "BotPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotPosition_status_openedAt_idx" ON "BotPosition"("status", "openedAt");

-- CreateIndex
CREATE INDEX "BotPosition_productSymbol_status_idx" ON "BotPosition"("productSymbol", "status");
