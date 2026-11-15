/**
 * Label market yang bisa dibaca manusia, dari kunci engine.
 *
 * Kunci seperti `TOT:under:8.5` adalah bahasa mesin; rekomendasi yang
 * sampai ke pengguna harus berbunyi "Under 8.5 Gol". Fungsi ini satu-
 * satunya penerjemah — Telegram dan panel memakai hasil yang sama
 * dari server agar tidak berbeda pendapat.
 */
export function friendlyMarketLabel(marketKey: string): string {
  const key = marketKey.trim();
  const lower = key.toLowerCase();

  if (lower.startsWith("ml:")) {
    const side = lower.slice(3);
    if (side === "home") return "Menang — Tuan Rumah (1X2)";
    if (side === "draw") return "Seri (1X2)";
    if (side === "away") return "Menang — Tim Tamu (1X2)";
  }
  if (lower.startsWith("tot:")) {
    const [, side, line] = lower.split(":");
    if (side === "over") return `Over ${line} Gol`;
    if (side === "under") return `Under ${line} Gol`;
  }
  if (lower.startsWith("btts:")) {
    const side = lower.slice(5);
    if (side === "yes") return "Kedua Tim Cetak Gol — Ya";
    if (side === "no") return "Kedua Tim Cetak Gol — Tidak";
  }
  if (lower.startsWith("ah:")) {
    const [, side, line] = lower.split(":");
    const formatted = line && Number(line) > 0 ? `+${line}` : line;
    if (side === "home") return `Asian Handicap — Tuan Rumah ${formatted}`;
    if (side === "away") return `Asian Handicap — Tim Tamu ${formatted}`;
  }
  if (lower.startsWith("ht:")) {
    return `Babak Pertama — ${key.slice(3).replace(/_/g, " ")}`;
  }
  return key.replace(/[:_]/g, " ");
}
