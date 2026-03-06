function jsonInstruction(payloadDescription) {
  return [
    "You are an aviation assistant.",
    "Return ONLY valid JSON with no markdown or code fences.",
    "Use US aviation units by default: feet (ft) for altitude/elevation, nautical miles (NM) for distance, statute miles (SM) for visibility, and knots (kt) for wind.",
    "Avoid meters unless directly quoting source data; if meters are referenced, include feet (ft) equivalent in the same sentence.",
    `JSON schema: ${payloadDescription}`,
  ].join("\n");
}

export function metarPrompt(metar) {
  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Explain this METAR for a pilot in clear, concise language.",
    "Prefer US aviation wording and units in output (ft/SM/kt).",
    "Include key weather implications in notes.",
    `METAR: ${metar}`,
  ].join("\n\n");
}

export function airportPrompt(data) {
  const serialized = JSON.stringify(data ?? {}, null, 2);

  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Create an airport operational brief from provided airport data.",
    "If source fields include meters, convert and present feet (ft) for pilots.",
    "Highlight runway, traffic, weather, and planning-relevant risks.",
    `Airport data: ${serialized}`,
  ].join("\n\n");
}

export function airspacePrompt(data) {
  const serialized = JSON.stringify(data ?? {}, null, 2);

  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Explain this airspace data in pilot-friendly terms.",
    "Use feet (ft) and NM in explanations whenever altitude or distance appears.",
    "Focus on entry requirements, altitude constraints, and cautions.",
    `Airspace data: ${serialized}`,
  ].join("\n\n");
}

export function contextAskPrompt(payload, options = {}) {
  const { strictJsonOnly = false } = options;
  const serialized = JSON.stringify(payload ?? {}, null, 2);

  return [
    jsonInstruction('{"answer":"string","keyPoints":["string"],"warnings":["string"]}'),
    strictJsonOnly
      ? "CRITICAL: Return JSON only. No prose before or after."
      : "Return compact JSON only.",
    "Role: You are a flight planning assistant. Explain available app context for pilots, but do not replace official briefing or pilot judgment.",
    "Task:",
    "- Answer succinctly in pilot-friendly language.",
    "- Use US aviation units by default (ft, NM, SM, kt).",
    "- Provide 3 to 7 keyPoints.",
    "- Provide warnings only when relevant (e.g., winds, ceiling/visibility, airspace communications/requirements, routing uncertainty).",
    "- If user asks for data not present (e.g., NOTAM specifics, winds aloft details), explicitly say what is missing and where to get it.",
    "Output constraints:",
    "- Must be valid JSON matching schema exactly.",
    "- keyPoints and warnings must be arrays of strings.",
    "- If uncertain, be explicit and conservative.",
    `Question + Context JSON: ${serialized}`,
  ].join("\n\n");
}
