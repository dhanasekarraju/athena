/**
 * Pure exit decisions for long option positions.
 * SL and TP are evaluated independently; SL always wins if both fire.
 */

export interface ExitQuotes {
  bid: number;
  ask: number;
  mark: number;
}

export interface ExitLevels {
  entryPremium: number;
  stopLoss: number;
  takeProfit1: number;
  /** Settings TP (+fraction) — used as a nearer target when stored TP is far (e.g. AI TP2). */
  settingsTp?: number;
  /** Peak exit price seen so far (for trailing). */
  peakExitPx?: number;
  /** Activate trail after this multiple of entry (default 1.10 = +10%). */
  trailArmAt?: number;
  /** Give-back from peak once trailing (default 0.07 = 7%). */
  trailGiveback?: number;
  /**
   * Once trail is armed, never let the floor fall back to a tiny green exit.
   * Default 1.08 = lock at least +8% vs entry (stops the "sold for ₹1 profit" case).
   */
  trailMinLockMultiple?: number;
}

export type ExitReason =
  | "stop_loss"
  | "take_profit_1"
  | "trail_stop"
  | "protect_breakeven"
  | "time_stop"
  | null;

export interface ExitDecision {
  reason: ExitReason;
  /** Price to book / prefer for fill estimate (executable sell). */
  exitPx: number;
  /** Updated peak for persistence. */
  peakExitPx: number;
  /** Effective SL used this tick (includes trail). */
  effectiveSl: number;
  /** Effective TP used this tick (nearest of stored + settings). */
  effectiveTp: number;
  detail: string;
}

/** Executable sell price for a long option: prefer bid, else mark. */
export function longExitPrice(q: ExitQuotes): number {
  if (q.bid > 0) return q.bid;
  if (q.mark > 0) return q.mark;
  return 0;
}

/**
 * Conservative SL probe: lowest of bid/mark when both exist,
 * so a crashed bid is not ignored because mark is sticky.
 */
export function longSlProbe(q: ExitQuotes): number {
  const parts = [q.bid, q.mark].filter((n) => n > 0);
  if (!parts.length) return 0;
  return Math.min(...parts);
}

/**
 * TP probe: require bid when available (must be able to sell into TP).
 * Fall back to mark only if book has no bid.
 */
export function longTpProbe(q: ExitQuotes): number {
  if (q.bid > 0) return q.bid;
  if (q.mark > 0) return q.mark;
  return 0;
}

export function decideLongExit(q: ExitQuotes, levels: ExitLevels): ExitDecision {
  const exitPx = longExitPrice(q);
  const slProbe = longSlProbe(q);
  const tpProbe = longTpProbe(q);
  const peakExitPx = Math.max(levels.peakExitPx ?? levels.entryPremium, exitPx > 0 ? exitPx : 0);

  const settingsTp =
    levels.settingsTp && levels.settingsTp > levels.entryPremium
      ? levels.settingsTp
      : undefined;
  const effectiveTp =
    settingsTp != null ? Math.min(levels.takeProfit1, settingsTp) : levels.takeProfit1;

  // Trail is aggressive about locking gains; hard SL stays conservative (unchanged).
  const trailArmAt = levels.trailArmAt ?? 1.1;
  const trailGiveback = levels.trailGiveback ?? 0.07;
  const trailMinLockMultiple = levels.trailMinLockMultiple ?? 1.08;
  let effectiveSl = levels.stopLoss;

  const armed = peakExitPx >= levels.entryPremium * trailArmAt;
  if (armed) {
    const trailFloor = peakExitPx * (1 - trailGiveback);
    // Once we've been meaningfully green, don't ride back down to a ₹1 win.
    const minLock = levels.entryPremium * trailMinLockMultiple;
    effectiveSl = Math.max(levels.stopLoss, minLock, trailFloor);
  }

  if (slProbe > 0 && slProbe <= effectiveSl) {
    const reason: ExitReason =
      armed && effectiveSl > levels.stopLoss
        ? slProbe <= levels.entryPremium * trailMinLockMultiple
          ? "protect_breakeven"
          : "trail_stop"
        : "stop_loss";
    return {
      reason,
      exitPx: exitPx || slProbe,
      peakExitPx,
      effectiveSl,
      effectiveTp,
      detail: `SL hit probe=${slProbe.toFixed(4)} effSl=${effectiveSl.toFixed(4)}`,
    };
  }

  if (tpProbe > 0 && tpProbe >= effectiveTp) {
    return {
      reason: "take_profit_1",
      exitPx: exitPx || tpProbe,
      peakExitPx,
      effectiveSl,
      effectiveTp,
      detail: `TP hit probe=${tpProbe.toFixed(4)} effTp=${effectiveTp.toFixed(4)}`,
    };
  }

  return {
    reason: null,
    exitPx,
    peakExitPx,
    effectiveSl,
    effectiveTp,
    detail: `hold bid=${q.bid} mark=${q.mark} sl=${effectiveSl.toFixed(4)} tp=${effectiveTp.toFixed(4)}`,
  };
}

/** Entry levels: settings SL + AI SL (tighter wins); TP prefers AI TP1 then settings. */
export function buildEntryLevels(input: {
  fillPremium: number;
  slFraction: number;
  tp1Fraction: number;
  aiEntry?: number | null;
  aiTp1?: number | null;
  aiTp2?: number | null;
  aiSl?: number | null;
}): {
  stopLoss: number;
  takeProfit1: number;
  tpSource: "ai_tp1" | "settings";
  slSource: "ai" | "settings" | "tighter";
} {
  const { fillPremium, slFraction, tp1Fraction } = input;
  const settingsSl = fillPremium * (1 - slFraction);
  const settingsTp = fillPremium * (1 + tp1Fraction);

  const aiEntry = input.aiEntry && input.aiEntry > 0 ? input.aiEntry : fillPremium;
  const scale = fillPremium / aiEntry;

  const aiSl =
    input.aiSl && input.aiSl > 0 ? input.aiSl * scale : null;
  // Tighter SL for longs = higher price (less room to fall)
  let stopLoss = settingsSl;
  let slSource: "ai" | "settings" | "tighter" = "settings";
  if (aiSl != null && aiSl > 0) {
    if (aiSl > settingsSl) {
      stopLoss = aiSl;
      slSource = "ai";
    } else if (aiSl < settingsSl) {
      stopLoss = settingsSl;
      slSource = "tighter";
    } else {
      stopLoss = settingsSl;
      slSource = "settings";
    }
  }

  // Prefer AI TP1 only (timely). Never wait for TP2 on auto-exit.
  const aiTp1 = input.aiTp1 && input.aiTp1 > 0 ? input.aiTp1 * scale : null;
  let takeProfit1 = settingsTp;
  let tpSource: "ai_tp1" | "settings" = "settings";
  if (aiTp1 != null && aiTp1 > fillPremium * 1.05) {
    // Cap AI TP1 so it cannot be farther than settings TP (avoids waiting forever)
    takeProfit1 = Math.min(aiTp1, settingsTp * 1.15);
    tpSource = "ai_tp1";
  }

  return { stopLoss, takeProfit1, tpSource, slSource };
}

/** Max hold before theta/stale thesis force-exit (options decay every hour). */
export const MAX_HOLD_MS = 90 * 60 * 1000;

/** Extra room when trail was armed — still cap total hold. */
export const MAX_HOLD_TRAIL_MS = 120 * 60 * 1000;

/** Min premium gain (+3%) before a time-cap exit — don't force-sell red. */
export const TIME_STOP_MIN_GREEN = 0.03;

export function shouldTimeExit(input: {
  openedAtMs: number;
  nowMs?: number;
  peakExitPx: number;
  entryPremium: number;
  /** Current executable exit price (bid/mark). */
  exitPx: number;
  trailArmAt?: number;
}): { exit: boolean; holdMin: number; limitMin: number; greenPct?: number } {
  const now = input.nowMs ?? Date.now();
  const holdMs = Math.max(0, now - input.openedAtMs);
  const trailArmAt = input.trailArmAt ?? 1.1;
  const armed = input.peakExitPx >= input.entryPremium * trailArmAt;
  const limitMs = armed ? MAX_HOLD_TRAIL_MS : MAX_HOLD_MS;
  const holdMin = Math.round(holdMs / 60000);
  const limitMin = Math.round(limitMs / 60000);

  if (holdMs < limitMs) {
    return { exit: false, holdMin, limitMin };
  }

  const greenPct =
    input.exitPx > 0 && input.entryPremium > 0
      ? (input.exitPx - input.entryPremium) / input.entryPremium
      : -1;

  // Past cap: only lock a stagnant small winner; red/flat stays on SL/trail.
  if (greenPct >= TIME_STOP_MIN_GREEN) {
    return { exit: true, holdMin, limitMin, greenPct };
  }

  return { exit: false, holdMin, limitMin, greenPct };
}

export type SignalSellReason =
  | "signal_flip"
  | "signal_flip_partial"
  | "signal_hold"
  | "signal_fade"
  | null;

export interface SignalSellDecision {
  reason: SignalSellReason;
  /** 0..1 fraction of open size to sell */
  fraction: number;
  detail: string;
}

/**
 * How much to sell from a fresh AI signal, independent of price TP/SL.
 * Opposite thesis → aggressive; HOLD → scale out; same-dir fade → light trim.
 */
export function decideSignalSell(input: {
  positionDirection: string; // BUY_CALL | BUY_PUT
  signalDirection: string; // BUY_CALL | BUY_PUT | HOLD
  confidence: number;
  minConfidence: number;
  /** Already sold via signals as fraction of original (0..1). */
  alreadySoldFraction?: number;
  riskLevel?: string;
}): SignalSellDecision {
  const posDir = input.positionDirection.toUpperCase();
  const sigDir = input.signalDirection.toUpperCase();
  const conf = input.confidence;
  const minC = Math.max(1, input.minConfidence);
  const already = Math.min(0.95, Math.max(0, input.alreadySoldFraction ?? 0));

  const isLongCall = posDir === "BUY_CALL";
  const isLongPut = posDir === "BUY_PUT";
  if (!isLongCall && !isLongPut) {
    return { reason: null, fraction: 0, detail: "unknown position direction" };
  }

  const opposite =
    (isLongCall && sigDir === "BUY_PUT") || (isLongPut && sigDir === "BUY_CALL");
  const same = (isLongCall && sigDir === "BUY_CALL") || (isLongPut && sigDir === "BUY_PUT");
  const hold = sigDir === "HOLD";

  // Strong opposite → full exit
  if (opposite && conf >= Math.max(minC, 65)) {
    return {
      reason: "signal_flip",
      fraction: 1,
      detail: `flip ${posDir}←${sigDir} conf=${conf}`,
    };
  }
  // Clear opposite but not max conviction → sell most
  if (opposite && conf >= minC) {
    return {
      reason: "signal_flip_partial",
      fraction: Math.min(1, 0.75 + already * 0.25),
      detail: `partial flip ${posDir}←${sigDir} conf=${conf}`,
    };
  }
  // Mild opposite / noise under threshold → light cut if already in profit path handled elsewhere
  if (opposite && conf >= minC * 0.7) {
    return {
      reason: "signal_flip_partial",
      fraction: 0.5,
      detail: `soft flip ${posDir}←${sigDir} conf=${conf}`,
    };
  }

  // HOLD with real confidence → scale out (more if already trimmed)
  if (hold && conf >= minC) {
    const frac = already >= 0.4 ? 1 : 0.5;
    return {
      reason: "signal_hold",
      fraction: frac,
      detail: `HOLD conf=${conf} scale=${frac}`,
    };
  }
  if (hold && conf >= minC * 0.75) {
    return {
      reason: "signal_hold",
      fraction: already >= 0.3 ? 0.5 : 0.33,
      detail: `soft HOLD conf=${conf}`,
    };
  }

  // Same direction but conviction collapsed → trim once
  if (same && conf < minC * 0.65 && already < 0.34) {
    return {
      reason: "signal_fade",
      fraction: 0.33,
      detail: `same-dir fade conf=${conf} < ${Math.round(minC * 0.65)}`,
    };
  }

  // High risk + same dir below min → small trim
  if (same && input.riskLevel === "High" && conf < minC && already < 0.25) {
    return {
      reason: "signal_fade",
      fraction: 0.25,
      detail: `high-risk fade conf=${conf}`,
    };
  }

  return { reason: null, fraction: 0, detail: "hold through signal" };
}

/** Contracts to sell from open size and fraction (Delta sizes are whole contracts). */
export function contractsToSell(openSize: number, fraction: number): number {
  if (openSize <= 0 || fraction <= 0) return 0;
  if (fraction >= 0.999) return openSize;
  // Single contract: only exit if signal wants ≥ half
  if (openSize <= 1) return fraction >= 0.5 ? openSize : 0;
  const n = Math.max(1, Math.floor(openSize * fraction));
  return Math.min(openSize, n);
}

