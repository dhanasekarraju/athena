/**
 * Multi-provider LLM helpers: Gemini first, OpenRouter free-model chain on failure.
 * Used by trend judge (JSON) and Co-raiser (chat). Never places orders.
 */

import type { FastifyBaseLogger } from "fastify";
import { env } from "../utils/env.js";

export type LlmProvider = "gemini" | "openrouter";

export interface LlmCompletion {
  text: string;
  provider: LlmProvider;
  model: string;
}

const DEFAULT_TREND_MODELS = [
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "openai/gpt-oss-20b:free",
  "inclusionai/ling-3.0-flash:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
].join(",");

const DEFAULT_CORAISER_MODELS = "nvidia/nemotron-3-nano-30b-a3b:free,inclusionai/ling-3.0-flash:free,openrouter/free";

function parseModelList(raw: string, fallback: string): string[] {
  const src = (raw || fallback).trim() || fallback;
  return src
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function trendOpenRouterModels(): string[] {
  return parseModelList(env.OPENROUTER_TREND_MODELS, DEFAULT_TREND_MODELS);
}

export function coraiserOpenRouterModels(): string[] {
  return parseModelList(env.OPENROUTER_CORAISER_MODEL, DEFAULT_CORAISER_MODELS);
}

async function askGeminiGenerate(opts: {
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  jsonMime: boolean;
  systemInstruction?: string;
  log?: FastifyBaseLogger;
}): Promise<LlmCompletion | null> {
  if (!env.GEMINI_API_KEY) return null;
  const model = env.TREND_JUDGE_MODEL || "gemini-3.1-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      ...(opts.jsonMime ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errBody = await res.text();
    opts.log?.warn(
      { status: res.status, body: errBody.slice(0, 300), model },
      "LLM Gemini request failed",
    );
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return null;
  return { text, provider: "gemini", model };
}

/** Gemini chat with multi-turn history (Co-raiser). */
async function askGeminiChat(opts: {
  system: string;
  history: Array<{ role: string; content: string }>;
  userText: string;
  log?: FastifyBaseLogger;
}): Promise<LlmCompletion | null> {
  if (!env.GEMINI_API_KEY) return null;
  const model = env.TREND_JUDGE_MODEL || "gemini-3.1-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of opts.history.slice(-12)) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: opts.userText }] });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1024,
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const errBody = await res.text();
    opts.log?.warn(
      { status: res.status, body: errBody.slice(0, 300), model },
      "LLM Gemini chat failed",
    );
    return null;
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return null;
  return { text: text.trim(), provider: "gemini", model };
}

async function askOpenRouterChat(opts: {
  models: string[];
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  maxTokens: number;
  log?: FastifyBaseLogger;
}): Promise<LlmCompletion | null> {
  if (!env.OPENROUTER_API_KEY) return null;

  for (const model of opts.models) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://athena.local",
          "X-Title": "Athena Trend Judge",
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const errBody = await res.text();
        opts.log?.warn(
          { status: res.status, body: errBody.slice(0, 300), model },
          "LLM OpenRouter request failed",
        );
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        opts.log?.warn({ model }, "LLM OpenRouter empty reply");
        continue;
      }
      return { text: text.trim(), provider: "openrouter", model };
    } catch (err) {
      opts.log?.warn({ err, model }, "LLM OpenRouter error");
    }
  }
  return null;
}

/**
 * Trend-judge JSON completion: Gemini → OpenRouter free-model chain.
 */
export async function completeJson(opts: {
  prompt: string;
  purpose: "trend";
  log?: FastifyBaseLogger;
}): Promise<LlmCompletion | null> {
  try {
    const gemini = await askGeminiGenerate({
      prompt: opts.prompt,
      temperature: 0,
      maxOutputTokens: 2048,
      jsonMime: true,
      log: opts.log,
    });
    if (gemini) return gemini;
  } catch (err) {
    opts.log?.warn({ err }, "LLM Gemini trend threw");
  }

  return askOpenRouterChat({
    models: trendOpenRouterModels(),
    messages: [
      {
        role: "system",
        content: "Respond with ONLY valid JSON. No markdown fences.",
      },
      { role: "user", content: opts.prompt },
    ],
    temperature: 0,
    maxTokens: 512,
    log: opts.log,
  });
}

/**
 * Co-raiser chat: Gemini → OpenRouter free-model chain.
 */
export async function completeChat(opts: {
  system: string;
  history: Array<{ role: string; content: string }>;
  userText: string;
  log?: FastifyBaseLogger;
}): Promise<LlmCompletion | null> {
  const systemWithContext = opts.system;

  try {
    const gemini = await askGeminiChat({
      system: systemWithContext,
      history: opts.history,
      userText: opts.userText,
      log: opts.log,
    });
    if (gemini) return gemini;
  } catch (err) {
    opts.log?.warn({ err }, "LLM Gemini chat threw");
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemWithContext },
  ];
  for (const m of opts.history.slice(-12)) {
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }
  messages.push({ role: "user", content: opts.userText });

  return askOpenRouterChat({
    models: coraiserOpenRouterModels(),
    messages,
    temperature: 0.6,
    maxTokens: 1024,
    log: opts.log,
  });
}
