function jsonInstruction(payloadDescription) {
  return [
    "You are an aviation assistant.",
    "Return ONLY valid JSON with no markdown or code fences.",
    `JSON schema: ${payloadDescription}`,
  ].join("\n");
}

export function metarPrompt(metar) {
  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Explain this METAR for a pilot in clear, concise language.",
    "Include key weather implications in notes.",
    `METAR: ${metar}`,
  ].join("\n\n");
}

export function airportPrompt(data) {
  const serialized = JSON.stringify(data ?? {}, null, 2);

  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Create an airport operational brief from provided airport data.",
    "Highlight runway, traffic, weather, and planning-relevant risks.",
    `Airport data: ${serialized}`,
  ].join("\n\n");
}

export function airspacePrompt(data) {
  const serialized = JSON.stringify(data ?? {}, null, 2);

  return [
    jsonInstruction('{"summary":"string","notes":"string"}'),
    "Task: Explain this airspace data in pilot-friendly terms.",
    "Focus on entry requirements, altitude constraints, and cautions.",
    `Airspace data: ${serialized}`,
  ].join("\n\n");
}
