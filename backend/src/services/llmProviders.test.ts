import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-test-secret";
process.env.JWT_REFRESH_SECRET ??= "test-secret-test-secret";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("completeJson failover", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_TREND_MODELS = "nvidia/nemotron-3-nano-30b-a3b:free";
  });

  it("returns Gemini when Gemini succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("generativelanguage")) {
          return {
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: '{"trend":"up"}' }] } }],
            }),
            text: async () => "",
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const { completeJson } = await import("./llmProviders.js");
    const r = await completeJson({ prompt: "test", purpose: "trend" });
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("gemini");
    expect(r!.text).toContain("up");
  });

  it("falls back to OpenRouter when Gemini returns 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("generativelanguage")) {
          return { ok: false, status: 429, text: async (): Promise<string> => "quota", json: async () => ({}) };
        }
        if (String(url).includes("openrouter.ai")) {
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: '{"trend":"chop","strength":50}' } }],
            }),
            text: async (): Promise<string> => "",
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const { completeJson } = await import("./llmProviders.js");
    const r = await completeJson({ prompt: "test", purpose: "trend" });
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("openrouter");
    expect(r!.model).toBe("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(r!.text).toContain("chop");
  });

  it("returns null when both providers fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "down",
        json: async () => ({}),
      })),
    );

    const { completeJson } = await import("./llmProviders.js");
    const r = await completeJson({ prompt: "test", purpose: "trend" });
    expect(r).toBeNull();
  });
});
