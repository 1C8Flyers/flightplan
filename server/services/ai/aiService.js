import OpenAI from "openai";

import { getCache, setCache } from "./cache.js";
import { airspacePrompt, airportPrompt, metarPrompt } from "./prompts.js";

const MODEL = "gpt-4.1-mini";
const FALLBACK_RESPONSE = {
  summary: "Unable to generate AI explanation.",
};

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function normalizeStructuredResponse(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    return null;
  }

  const result = {
    summary: parsed.summary.trim(),
  };

  if (typeof parsed.notes === "string") {
    result.notes = parsed.notes.trim();
  }

  return result;
}

function extractJsonObject(text) {
  if (typeof text !== "string") {
    return null;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateStructured(promptFactory, payload, cacheKey) {
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (!openai) {
    return FALLBACK_RESPONSE;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await openai.responses.create({
        model: MODEL,
        input: promptFactory(payload),
      });

      const rawOutput = completion.output_text ?? "";
      const candidateJson = extractJsonObject(rawOutput);
      const parsed = candidateJson ? safeJsonParse(candidateJson) : null;
      const validated = normalizeStructuredResponse(parsed);

      if (validated) {
        setCache(cacheKey, validated);
        return validated;
      }
    } catch (error) {
      lastError = error;
      break;
    }
  }

  if (lastError) {
    console.error("OpenAI request failed", lastError);
  }

  return FALLBACK_RESPONSE;
}

export async function explainMetar(metar) {
  const sanitizedMetar = String(metar ?? "").trim();
  const cacheKey = `metar:${sanitizedMetar}`;

  return generateStructured(metarPrompt, sanitizedMetar, cacheKey);
}

export async function airportBrief(airportData) {
  const ident =
    airportData && typeof airportData === "object" && typeof airportData.ident === "string"
      ? airportData.ident.trim().toUpperCase()
      : "unknown";

  const cacheKey = `airport:${ident}:${JSON.stringify(airportData ?? {})}`;
  return generateStructured(airportPrompt, airportData ?? {}, cacheKey);
}

export async function explainAirspace(airspaceData) {
  const airspaceId =
    airspaceData && typeof airspaceData === "object" && typeof airspaceData.id === "string"
      ? airspaceData.id.trim().toUpperCase()
      : "unknown";

  const cacheKey = `airspace:${airspaceId}:${JSON.stringify(airspaceData ?? {})}`;
  return generateStructured(airspacePrompt, airspaceData ?? {}, cacheKey);
}

export { FALLBACK_RESPONSE, MODEL };
