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

/**
 * Panduan pengganti bila line rekomendasi tidak ada di aplikasi
 * pemilik sistem (Saba umumnya hanya memasang line utama ,5).
 * Aturan yang diajarkan ke pemilik sistem: ganti ke line terdekat
 * pada ARAH YANG SAMA, jangan pernah membalik arah; terima
 * konsekuensinya (hilang perlindungan refund pada line bulat).
 * Hanya line bulat Totals yang butuh panduan — line ,25/,75 khas
 * Asia umumnya tersedia, dan line ,5 tidak punya refund.
 */
export function substitutionHint(marketKey: string): string | null {
  const parts = marketKey.trim().toLowerCase().split(":");
  if (parts[0] !== "tot" || parts.length < 3) return null;
  const side = parts[1];
  const line = Number(parts[2]);
  if (!Number.isFinite(line) || Math.abs(line - Math.round(line)) > 1e-9) return null;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
  if (side === "over") {
    return `bila Over ${fmt(line)} tak ada di aplikasi: Over ${fmt(line + 0.5)} (arah sama, tanpa refund bila tepat ${fmt(line)} gol)`;
  }
  if (side === "under") {
    return `bila Under ${fmt(line)} tak ada di aplikasi: Under ${fmt(line + 0.5)} (arah sama, lebih longgar — tepat ${fmt(line)} gol ikut menang, odds lebih kecil)`;
  }
  return null;
}
