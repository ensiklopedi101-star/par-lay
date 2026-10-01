function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeManualContext(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return { ...value };

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return { ...parsed };
    } catch {
      // Keep non-JSON legacy content below rather than discarding it.
    }
  }

  return value == null ? {} : { legacyManualContext: value };
}

export function appendSettlementContext(
  manualContext: unknown,
  settlement: Record<string, unknown>,
  evaluationSource = "fixture_final_score",
  evaluatedAt = new Date().toISOString(),
): Record<string, unknown> {
  return {
    ...normalizeManualContext(manualContext),
    settlement: {
      ...settlement,
      evaluatedAt,
      evaluationSource,
    },
  };
}