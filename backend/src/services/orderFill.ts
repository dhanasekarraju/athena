/**
 * Reconcile requested IOC size vs Delta order response.
 * IOC can partial-fill; never trust the request size for the DB position.
 */
export function reconcileEntryFill(input: {
  requestedSize: number;
  /** Filled size from exchange (prefer filled_size, else response size). */
  filledSize: number;
  state?: string | null;
}): { ok: true; fillSize: number; partial: boolean } | { ok: false; why: string; fillSize: number } {
  const requested = Math.max(0, Math.floor(Number(input.requestedSize) || 0));
  const filled = Math.max(0, Math.floor(Number(input.filledSize) || 0));
  const state = (input.state ?? "").toLowerCase();

  if (filled <= 0) {
    return {
      ok: false,
      fillSize: 0,
      why: `no fill (state=${input.state ?? "?"}, size=0)`,
    };
  }

  // Rejected / cancelled with no usable fill
  if (state.includes("reject") || state === "cancelled") {
    return {
      ok: false,
      fillSize: filled,
      why: `order ${state} (filled=${filled})`,
    };
  }

  // Materially short: caller should unwind on exchange, then skip DB open.
  if (requested > 0 && filled < requested * 0.5) {
    return {
      ok: false,
      fillSize: filled,
      why: `short fill ${filled}/${requested} (<50%) — unwind`,
    };
  }

  return {
    ok: true,
    fillSize: filled,
    partial: filled < requested,
  };
}

/** Prefer explicit filled_size when Delta sends it; else response size. */
export function extractFilledSize(order: {
  size?: number | string;
  filled_size?: number | string;
  unfilled_size?: number | string;
}): number {
  if (order.filled_size != null && order.filled_size !== "") {
    const n = Math.floor(Number(order.filled_size));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (order.unfilled_size != null && order.size != null) {
    const req = Math.floor(Number(order.size));
    const unf = Math.floor(Number(order.unfilled_size));
    if (Number.isFinite(req) && Number.isFinite(unf)) return Math.max(0, req - unf);
  }
  const n = Math.floor(Number(order.size));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
