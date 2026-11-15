/**
 * Berburu harga (line shopping) — Langkah 2 pendekatan pasar-dulu.
 *
 * Untuk pilihan yang sama, bandar yang berbeda memberi harga berbeda.
 * Mengambil harga terbaik dari yang tersedia adalah keuntungan yang
 * tidak menuntut kita lebih pintar dari pasar: pertandingan dan
 * pilihannya identik, hanya harga belinya yang lebih murah. Pada
 * parlay 5–8 leg, selisih kecil per leg mengalikan menjadi selisih
 * besar di odds gabungan.
 *
 * Modul ini murni: diberi daftar penawaran per bandar dan harga yang
 * sedang dipakai, ia menghitung harga terbaik, kenaikannya, dan arah
 * gerak harga (snapshot pertama → terakhir) sebagai penanda awal CLV.
 */

export interface BookmakerOffer {
  bookmaker: string;
  odds: number;
  capturedAt?: string | null;
}

export type PriceDrift = "menajam" | "menjauh" | "stabil" | "tidak-diketahui";

export interface PriceHuntResult {
  /** Harga yang sedang dipakai leg (dari ledger/engine). */
  usedOdds: number;
  /** Harga terbaik yang tersedia saat ini di semua bandar. */
  bestOdds: number;
  bestBookmaker: string | null;
  /** Jumlah bandar yang menawarkan pilihan ini. */
  offers: number;
  /** Kenaikan relatif harga terbaik vs yang dipakai (0.05 = +5%). */
  uplift: number;
  /** Arah gerak harga pilihan ini dari snapshot pertama ke terakhir. */
  drift: PriceDrift;
  /** Perubahan relatif harga terakhir vs pertama (−0.03 = memendek 3%). */
  driftPct: number | null;
  note: string;
}

const DRIFT_EPSILON = 0.005;

/**
 * Nilai daftar penawaran. `series` adalah harga pilihan yang sama dari
 * waktu ke waktu (semua bandar, urut waktu bebas) untuk menilai drift:
 * harga memendek = pasar bergerak ke arah pilihan kita (sinyal baik),
 * harga memanjang = pasar menjauhi pilihan kita (peringatan).
 */
export function huntBestPrice(
  usedOdds: number,
  offers: BookmakerOffer[],
  series: Array<{ odds: number; capturedAt?: string | null }> = [],
): PriceHuntResult {
  const valid = offers.filter((o) => Number.isFinite(o.odds) && o.odds > 1);
  const best = valid.reduce<BookmakerOffer | null>(
    (acc, o) => (acc == null || o.odds > acc.odds ? o : acc),
    null,
  );
  const bestOdds = best ? best.odds : usedOdds;
  const uplift = usedOdds > 0 ? bestOdds / usedOdds - 1 : 0;

  let drift: PriceDrift = "tidak-diketahui";
  let driftPct: number | null = null;
  const timed = series
    .filter((s) => Number.isFinite(s.odds) && s.odds > 1 && s.capturedAt)
    .sort((a, b) => new Date(a.capturedAt!).getTime() - new Date(b.capturedAt!).getTime());
  if (timed.length >= 2) {
    const first = timed[0]!.odds;
    const last = timed[timed.length - 1]!.odds;
    driftPct = last / first - 1;
    drift = driftPct < -DRIFT_EPSILON ? "menajam" : driftPct > DRIFT_EPSILON ? "menjauh" : "stabil";
  }

  let note: string;
  if (valid.length === 0) {
    note = "Tidak ada penawaran bandar lain yang bisa dibandingkan — harga dipakai apa adanya.";
  } else if (uplift > 0.001) {
    note = `Harga terbaik ${bestOdds.toFixed(2)} di ${best!.bookmaker} — naik ${(uplift * 100).toFixed(1)}% dari harga yang dipakai (${usedOdds.toFixed(2)}).`;
  } else {
    note = `Harga yang dipakai sudah yang terbaik dari ${valid.length} bandar.`;
  }
  if (drift === "menajam") {
    note += " Harga bergerak menajam ke arah pilihan ini (pasar ikut menguat).";
  } else if (drift === "menjauh") {
    note += " Peringatan: harga menjauhi pilihan ini sejak snapshot pertama.";
  }

  return {
    usedOdds,
    bestOdds,
    bestBookmaker: best?.bookmaker ?? null,
    offers: valid.length,
    uplift,
    drift,
    driftPct,
    note,
  };
}

/** Gabungkan dampak berburu harga ke seluruh tiket. */
export function ticketPriceImpact(
  legs: Array<{ usedOdds: number; bestOdds: number }>,
): { usedCombined: number; bestCombined: number; uplift: number } {
  const usedCombined = legs.reduce((acc, l) => acc * l.usedOdds, 1);
  const bestCombined = legs.reduce((acc, l) => acc * l.bestOdds, 1);
  return {
    usedCombined,
    bestCombined,
    uplift: usedCombined > 0 ? bestCombined / usedCombined - 1 : 0,
  };
}
