/**
 * Turn a league slug into a human-readable title.
 * Example: "england-premier-league" → "England Premier League"
 */
export function formatLeagueName(slug: string): string {
  if (!slug) return "";
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
