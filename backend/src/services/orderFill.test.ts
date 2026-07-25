import { describe, expect, it } from "vitest";
import { extractFilledSize, reconcileEntryFill } from "./orderFill.js";

describe("reconcileEntryFill", () => {
  it("stores actual fill when partial but ≥50%", () => {
    const r = reconcileEntryFill({ requestedSize: 10, filledSize: 6, state: "closed" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fillSize).toBe(6);
      expect(r.partial).toBe(true);
    }
  });

  it("rejects zero fill", () => {
    const r = reconcileEntryFill({ requestedSize: 10, filledSize: 0, state: "cancelled" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toMatch(/no fill/i);
  });

  it("rejects materially short fill (<50%) for unwind path", () => {
    const r = reconcileEntryFill({ requestedSize: 10, filledSize: 3, state: "closed" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fillSize).toBe(3);
      expect(r.why).toMatch(/short fill/i);
    }
  });

  it("accepts full fill", () => {
    const r = reconcileEntryFill({ requestedSize: 5, filledSize: 5, state: "closed" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fillSize).toBe(5);
      expect(r.partial).toBe(false);
    }
  });
});

describe("extractFilledSize", () => {
  it("prefers filled_size", () => {
    expect(extractFilledSize({ size: 10, filled_size: 7 })).toBe(7);
  });

  it("derives from size - unfilled_size", () => {
    expect(extractFilledSize({ size: 10, unfilled_size: 4 })).toBe(6);
  });

  it("falls back to size", () => {
    expect(extractFilledSize({ size: 8 })).toBe(8);
  });
});
