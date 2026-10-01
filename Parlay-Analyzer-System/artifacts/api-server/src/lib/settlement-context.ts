function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseManualContext(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

export function appendSettlementContext(
  manualContext: unknown,
  settlement: Record<string, unknown>,
  evaluationSource = "fixture_final_score",
  evaluatedAt = new Date().toISOString(),
): Record<string, unknown> {
  const parsedContext = parseManualContext(manualContext);
  const existing = parsedContext
    ? { ...parsedContext }
    : manualContext == null
      ? {}
      : { legacyManualContext: manualContext };
  return {
    ...existing,
    settlement: {
      ...settlement,
      evaluatedAt,
      evaluationSource,
    },
  };
}