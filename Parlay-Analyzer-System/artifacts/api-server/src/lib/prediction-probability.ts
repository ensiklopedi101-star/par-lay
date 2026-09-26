/**
 * Read the explicit model probability saved with an AI prediction.
 *
 * New predictions keep a compact legacy value at manual_context.probability
 * and the versioned evaluation snapshot at manual_context.recommendation.
 * Older rows may wrap that snapshot under evaluation_snapshot or
 * evaluationSnapshot. Confidence is intentionally never a fallback.
 */
export function predictionProbabilityFromContext(context: unknown): number {
  if (!context || typeof context !== "object" || Array.isArray(context)) return 0;

  const root = context as Record<string, unknown>;
  const nested = (...keys: string[]): Record<string, unknown> | null => {
    let current: unknown = root;
    for (const key of keys) {
      if (!current || typeof current !== "object" || Array.isArray(current)) return null;
      current = (current as Record<string, unknown>)[key];
    }
    return current && typeof current === "object" && !Array.isArray(current)
      ? current as Record<string, unknown>
      : null;
  };

  const candidates = [
    root.probability,
    nested("recommendation")?.probability,
    nested("evaluation_snapshot", "recommendation")?.probability,
    nested("evaluationSnapshot", "recommendation")?.probability,
    nested("snapshot", "recommendation")?.probability,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === "string" && candidate.trim().endsWith("%")
      ? Number(candidate.trim().slice(0, -1)) / 100
      : Number(candidate);
    if (Number.isFinite(value) && value > 0 && value < 1) return value;
  }

  return 0;
}