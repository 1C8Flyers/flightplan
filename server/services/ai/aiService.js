import OpenAI from "openai";

import { getCache, setCache } from "./cache.js";
import { airspacePrompt, airportPrompt, contextAskPrompt } from "./prompts.js";

const MODEL = "gpt-4.1-mini";
const FALLBACK_RESPONSE = {
  summary: "Unable to generate AI explanation.",
};
const CONTEXT_ASK_DISCLAIMER = "AI-generated. Verify with official sources and pilot judgment.";
const CONTEXT_SIZE_LIMIT_BYTES = 25 * 1024;
const METER_WORD_REGEX = /\bmeters?\b|\bmetres?\b/i;
const FEET_WORD_REGEX = /\bfeet\b|\bft\b/i;

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

function normalizeContextAskResponse(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    return null;
  }

  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 7)
    : [];

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];

  const uniqueWarnings = warnings.includes(CONTEXT_ASK_DISCLAIMER)
    ? warnings
    : [...warnings, CONTEXT_ASK_DISCLAIMER];

  return {
    answer: parsed.answer.trim(),
    keyPoints,
    warnings: uniqueWarnings,
  };
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

function hasMetricWithoutFeet(text) {
  if (typeof text !== "string" || !text.trim()) {
    return false;
  }

  return METER_WORD_REGEX.test(text) && !FEET_WORD_REGEX.test(text);
}

function hasUnitIssueInStructuredResponse(value) {
  const combined = [value?.summary, value?.notes]
    .filter((item) => typeof item === "string")
    .join(" ");

  return hasMetricWithoutFeet(combined);
}

function hasUnitIssueInContextResponse(value) {
  const keyPoints = Array.isArray(value?.keyPoints) ? value.keyPoints.join(" ") : "";
  const warnings = Array.isArray(value?.warnings) ? value.warnings.join(" ") : "";
  const combined = [value?.answer, keyPoints, warnings]
    .filter((item) => typeof item === "string")
    .join(" ");

  return hasMetricWithoutFeet(combined);
}

function truncateString(value, maxLen = 1200) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  if (text.length <= maxLen) {
    return text;
  }

  return `${text.slice(0, maxLen)}…`;
}

function sanitizePrimitive(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value, 500);
  }

  return null;
}

function sanitizeUnknown(value, depth = 0) {
  if (depth > 3) {
    return null;
  }

  const primitive = sanitizePrimitive(value);
  if (primitive !== null || value == null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return primitive;
  }

  if (Array.isArray(value)) {
    const sanitizedArray = value
      .slice(0, 12)
      .map((item) => sanitizeUnknown(item, depth + 1))
      .filter((item) => item !== null);

    return sanitizedArray;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 20);
    const result = {};

    for (const [key, item] of entries) {
      const sanitizedItem = sanitizeUnknown(item, depth + 1);
      if (sanitizedItem !== null) {
        result[key] = sanitizedItem;
      }
    }

    return result;
  }

  return null;
}

function trimToByteLimit(input, maxBytes) {
  const text = JSON.stringify(input ?? {});
  if (text.length <= maxBytes) {
    return input;
  }

  const trimmed = {
    selectedAirport: null,
    selectedAirspace: null,
    route: null,
    weather: input?.weather ?? { metarRaw: null, tafRaw: null },
    map: input?.map ?? { center: { lat: 0, lng: 0 }, zoom: 0 },
    contextReduced: true,
  };

  return trimmed;
}

function sanitizeAskContext(context) {
  const selectedAirport = sanitizeUnknown(context?.selectedAirport);
  const selectedAirspace = sanitizeUnknown(context?.selectedAirspace);
  const route = sanitizeUnknown(context?.route);
  const weather = {
    metarRaw: truncateString(context?.weather?.metarRaw, 1800),
    tafRaw: truncateString(context?.weather?.tafRaw, 1800),
  };
  const map = {
    center: {
      lat: Number.isFinite(Number(context?.map?.center?.lat)) ? Number(context.map.center.lat) : 0,
      lng: Number.isFinite(Number(context?.map?.center?.lng)) ? Number(context.map.center.lng) : 0,
    },
    zoom: Number.isFinite(Number(context?.map?.zoom)) ? Number(context.map.zoom) : 0,
  };

  const sanitized = {
    selectedAirport,
    selectedAirspace,
    route,
    weather,
    map,
  };

  const byteLimited = trimToByteLimit(sanitized, CONTEXT_SIZE_LIMIT_BYTES);
  const hasSelection = Boolean(
    byteLimited.selectedAirport
    || byteLimited.selectedAirspace
    || byteLimited.route
    || byteLimited.weather?.metarRaw
    || byteLimited.weather?.tafRaw
  );

  return {
    context: byteLimited,
    contextEmpty: !hasSelection,
  };
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
      const basePrompt = promptFactory(payload);
      const input = attempt === 2
        ? `${basePrompt}\n\nCRITICAL UNIT RULE: Use US aviation units. Do not use meters unless you also include feet (ft) equivalent.`
        : basePrompt;

      const completion = await openai.responses.create({
        model: MODEL,
        input,
      });

      const rawOutput = completion.output_text ?? "";
      const candidateJson = extractJsonObject(rawOutput);
      const parsed = candidateJson ? safeJsonParse(candidateJson) : null;
      const validated = normalizeStructuredResponse(parsed);

      if (validated) {
        if (hasUnitIssueInStructuredResponse(validated) && attempt < 2) {
          continue;
        }

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

export async function askWithContext(question, context) {
  const sanitizedQuestion = String(question ?? "").trim();
  const questionLimited = sanitizedQuestion.length > 500 ? sanitizedQuestion.slice(0, 500) : sanitizedQuestion;
  const { context: sanitizedContext, contextEmpty } = sanitizeAskContext(context ?? {});

  const payload = {
    question: questionLimited,
    context: sanitizedContext,
    contextState: contextEmpty
      ? "No selected airport/airspace/route/weather was available in the app context."
      : "Context contains current map selections and route/weather details.",
  };

  const cacheKey = `context-ask:${JSON.stringify(payload)}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (!openai) {
    return {
      answer: "Unable to generate AI explanation.",
      keyPoints: ["AI service is currently unavailable on this server."],
      warnings: [CONTEXT_ASK_DISCLAIMER],
    };
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const basePrompt = contextAskPrompt(payload, { strictJsonOnly: attempt === 2 });
      const input = attempt === 2
        ? `${basePrompt}\n\nCRITICAL UNIT RULE: Use US aviation units. Do not use meters unless you also include feet (ft) equivalent.`
        : basePrompt;

      const completion = await openai.responses.create({
        model: MODEL,
        input,
      });

      const rawOutput = completion.output_text ?? "";
      const candidateJson = extractJsonObject(rawOutput);
      const parsed = candidateJson ? safeJsonParse(candidateJson) : null;
      const validated = normalizeContextAskResponse(parsed);

      if (validated) {
        if (hasUnitIssueInContextResponse(validated) && attempt < 2) {
          continue;
        }

        setCache(cacheKey, validated);
        return validated;
      }
    } catch (error) {
      lastError = error;
      break;
    }
  }

  if (lastError) {
    console.error("OpenAI context ask request failed", lastError);
  }

  return {
    answer: "Unable to generate AI explanation.",
    keyPoints: ["Try again in a moment or verify details directly in official briefing tools."],
    warnings: [CONTEXT_ASK_DISCLAIMER],
  };
}

export { FALLBACK_RESPONSE, MODEL };
