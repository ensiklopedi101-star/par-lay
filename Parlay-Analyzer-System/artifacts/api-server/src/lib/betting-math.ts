/**
 * Matematika taruhan yang dipakai gerbang keputusan.
 *
 * Semua rumus di sini murni dan deterministik: tidak ada panggilan jaringan,
 * tidak ada LLM. Tujuannya satu — mengubah "peluang pasar" menjadi
 * probabilitas yang jujur, lalu membandingkannya dengan probabilitas model.
 *
 * Rujukan yang membentuk desain ini:
 *
 *  • **Devig.** `1/odds` selalu di atas 100% karena margin bandar. Metode
 *    multiplicative adalah standar; Shin lebih baik untuk pasar tiga arah
 *    (1X2 sepak bola) karena mengoreksi favorite–longshot bias. Uji empiris
 *    pada EPL 2024-25 menunjukkan selisih RPS antar metode sangat kecil
 *    (multiplicative 0.19724 vs Shin 0.19731), jadi perbedaan metode bukan
 *    tempat mencari keunggulan — yang penting marginnya dibuang. Karena
 *    bandar kita (1xbet/M88) bukan bandar tajam, kita memakai *worst case*:
 *    probabilitas terendah dari semua metode, supaya edge tidak dilebih-lebihkan.
 *
 *  • **EV.** EV = p × odds − 1. Karena p tidak pernah diketahui pasti, gerbang
 *    memakai EV konservatif: (p − σ) × odds − 1, dengan σ sebagai anggaran
 *    ketidakpastian. Edge di bawah ~3% pada pasar tiga arah dianggap noise.
 *
 *  • **Kelly.** f* = (p·b − q)/b. Full Kelly berbahaya begitu p salah estimasi,
 *    jadi yang dipakai 1/4 Kelly dengan pagar maksimum per tiket. Parlay tidak
 *    memenuhi asumsi independensi, jadi probabilitas gabungan diberi haircut
 *    korelasi dan stake-nya dihitung dari probabilitas yang sudah dikoreksi.
 *
 *  • **Kalibrasi.** Brier score, log loss, dan ECE dipakai untuk menjawab
 *    "apakah angka probabilitas kita masuk akal", bukan sekadar "menang atau
 *    kalah". Sampel kecil belum membuktikan apa pun: CLV butuh ~100-300 taruhan
 *    sebelum bisa dipercaya, dan Brier untuk kejadian jarang butuh jauh lebih
 *    banyak.
 */

export type Odds = number | null | undefined;

export type DevigMethod = "multiplicative" | "additive" | "shin";

export interface DevigResult {
  method: DevigMethod;
  /** Probabilitas wajar; selalu berjumlah 1. */
  fair: number[];
  /** Margin bandar: Σ(1/odds) − 1. 0.05 berarti 5%. */
  overround: number;
  /** Σ(1/odds) mentah (booksum), mis. 1.0363. */
  booksum: number;
}

const VALID_ODDS = (value: Odds): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 1;

/** Probabilitas implisit mentah; 0 untuk odds yang tidak valid. */
export function impliedProbabilities(odds: Odds[]): number[] {
  return odds.map((value) => (VALID_ODDS(value) ? 1 / value : 0));
}

/** Σ(1/odds). > 1 berarti ada margin bandar. */
export function booksum(odds: Odds[]): number {
  return impliedProbabilities(odds).reduce((total, value) => total + value, 0);
}

/**
 * Devig multiplicative: bagi tiap probabilitas mentah dengan jumlahnya.
 * Butuh minimal dua outcome ber-odds valid.
 */
export function devigMultiplicative(odds: Odds[]): DevigResult | null {
  const raw = impliedProbabilities(odds);
  const total = raw.reduce((sum, value) => sum + value, 0);
  const usable = raw.filter((value) => value > 0).length;
  if (usable < 2 || total <= 0) return null;
  return {
    method: "multiplicative",
    fair: raw.map((value) => value / total),
    overround: total - 1,
    booksum: total,
  };
}

/**
 * Devig additive: kurangi margin secara merata. Bisa menghasilkan probabilitas
 * negatif pada underdog ekstrem; bila itu terjadi hasilnya ditolak (null),
 * bukan dipaksa.
 */
export function devigAdditive(odds: Odds[]): DevigResult | null {
  const raw = impliedProbabilities(odds);
  const usable = raw.filter((value) => value > 0).length;
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (usable < 2 || total <= 0) return null;
  const margin = (total - 1) / usable;
  const fair = raw.map((value) => (value > 0 ? value - margin : 0));
  if (fair.some((value) => value < 0)) return null;
  const sum = fair.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return null;
  return {
    method: "additive",
    fair: fair.map((value) => value / sum),
    overround: total - 1,
    booksum: total,
  };
}

function shinProbabilities(raw: number[], total: number, z: number): number[] {
  return raw.map((value) => {
    if (value <= 0) return 0;
    const discriminant = z * z + 4 * (1 - z) * ((value * value) / total);
    const root = Math.sqrt(Math.max(0, discriminant));
    return (root - z) / (2 * (1 - z));
  });
}

/**
 * Devig Shin: menyelesaikan parameter z (proporsi bandar yang memproteksi diri
 * dari taruhan terinformasi) sehingga probabilitas wajar berjumlah 1.
 *
 * z = 0 menghasilkan Σ > 1; z → 1 menghasilkan Σ = 1 (sama dengan
 * multiplicative). Pencarian akar memakai bisection, tanpa dependensi.
 */
export function devigShin(odds: Odds[]): DevigResult | null {
  const raw = impliedProbabilities(odds);
  const total = raw.reduce((sum, value) => sum + value, 0);
  const usable = raw.filter((value) => value > 0).length;
  if (usable < 2 || total <= 0) return null;
  /* Tanpa margin (atau underround) model Shin tidak punya solusi berarti. */
  if (total <= 1.0000001) return devigMultiplicative(odds);

  const sumAt = (z: number) =>
    shinProbabilities(raw, total, z).reduce((acc, value) => acc + value, 0);

  let low = 0;
  let high = 0.999999;
  /* f(0) > 1 dan f(high) < 1; f menurun terhadap z. */
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (sumAt(mid) > 1) low = mid;
    else high = mid;
  }
  const z = (low + high) / 2;
  const fair = shinProbabilities(raw, total, z);
  const sum = fair.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return {
    method: "shin",
    fair: fair.map((value) => value / sum),
    overround: total - 1,
    booksum: total,
  };
}

/** Semua metode yang berhasil dihitung untuk satu pasar. */
export function devigAll(odds: Odds[]): DevigResult[] {
  return [devigMultiplicative(odds), devigAdditive(odds), devigShin(odds)]
    .filter((result): result is DevigResult => result != null);
}

/**
 * Probabilitas wajar paling konservatif untuk satu outcome: yang **terendah**
 * di antara semua metode. Dipakai agar edge tidak lahir dari asumsi devig yang
 * paling menguntungkan.
 */
export function worstCaseFairProbability(odds: Odds[], index: number): number | null {
  const results = devigAll(odds);
  if (results.length === 0) return null;
  const values = results
    .map((result) => result.fair[index])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.min(...values);
}

/**
 * Konsensus probabilitas wajar dari beberapa bookmaker.
 *
 * Mengambil baris pertama saja membuat hasil bergantung pada urutan provider:
 * satu bookmaker yang lambat memperbarui harga bisa menjadi “pasar” bagi
 * seluruh sistem. Di sini setiap bookmaker di-devig dengan worst-case terlebih
 * dahulu, lalu diambil median — outlier satu bookmaker tidak mendominasi,
 * tetapi konservatisme devig per bookmaker tetap dipertahankan.
 */
export function consensusFairProbability(oddsRows: Odds[][], index: number): number | null {
  const values = oddsRows
    .map((odds) => worstCaseFairProbability(odds, index))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
}

/** Probabilitas wajar menurut satu metode (untuk laporan/EDGE, bukan gerbang). */
export function fairProbability(
  odds: Odds[],
  index: number,
  method: DevigMethod = "multiplicative",
): number | null {
  const result =
    method === "shin"
      ? devigShin(odds)
      : method === "additive"
        ? devigAdditive(odds)
        : devigMultiplicative(odds);
  if (!result) return null;
  const value = result.fair[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** EV sebagai pecahan: 0.05 = +5%. */
export function expectedValue(probability: number, odds: number): number {
  if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return 0;
  return probability * odds - 1;
}

/**
 * EV konservatif: turunkan probabilitas sebesar `sigma` sebelum dihitung.
 * `sigma` adalah anggaran ketidakpastian (default 5 poin persen), bukan angka
 * suci — ia mewakili seberapa jauh model boleh salah.
 */
export function conservativeEv(probability: number, odds: number, sigma = 0.05): number {
  const adjusted = Math.max(0, probability - Math.max(0, sigma));
  return expectedValue(adjusted, odds);
}

/**
 * Gabungkan probabilitas model dengan probabilitas wajar pasar.
 *
 * Model belum punya bukti kalibrasi, sedangkan harga pasar adalah prakiraan
 * yang paling efisien. Karena itu model diberi bobot kecil (default 35%);
 * makin kecil bobotnya, makin dekat hasilnya ke pasar dan makin kecil peluang
 * menghasilkan edge palsu.
 */
export function blendProbability(
  modelProbability: number,
  marketFairProbability: number,
  modelWeight = 0.35,
): number {
  if (!Number.isFinite(modelProbability)) return marketFairProbability;
  if (!Number.isFinite(marketFairProbability)) return modelProbability;
  const weight = Math.min(1, Math.max(0, modelWeight));
  return weight * modelProbability + (1 - weight) * marketFairProbability;
}

export interface KellyResult {
  /** Fraksi bankroll menurut Kelly penuh (0 bila tidak ada edge). */
  fullFraction: number;
  /** Fraksi yang disarankan setelah fractional Kelly dan pagar maksimum. */
  recommendedFraction: number;
  /** Persentase untuk ditampilkan, mis. 1.4. */
  recommendedPercent: number;
}

/**
 * Kelly: f* = (p·b − q)/b dengan b = odds − 1.
 * Tidak pernah negatif: tanpa edge, jawabannya 0 (jangan bertaruh).
 */
export function kellyFraction(probability: number, odds: number): number {
  if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return 0;
  if (probability <= 0 || probability >= 1) return 0;
  const b = odds - 1;
  const fraction = (probability * b - (1 - probability)) / b;
  return fraction > 0 ? fraction : 0;
}

/**
 * Rencana stake: 1/4 Kelly (standar praktisi, memangkas varians tanpa
 * kehilangan sebagian besar pertumbuhan) dengan pagar maksimum per tiket.
 */
export function stakingPlan(
  probability: number,
  odds: number,
  options: { fraction?: number; maxPercent?: number } = {},
): KellyResult {
  const fraction = options.fraction ?? 0.25;
  const maxPercent = options.maxPercent ?? 3;
  const fullFraction = kellyFraction(probability, odds);
  const recommendedFraction = Math.min(fullFraction * fraction, maxPercent / 100);
  return {
    fullFraction,
    recommendedFraction,
    recommendedPercent: Number((recommendedFraction * 100).toFixed(2)),
  };
}

/**
 * Probabilitas gabungan parlay.
 *
 * Leg yang tidak independen (satu pertandingan, atau market yang saling
 * terkait seperti Over 2.5 dan BTTS Yes) membuat perkalian biasa terlalu
 * optimistis. `correlationHaircut` mengoreksi itu: 0.85 berarti probabilitas
 * gabungan dipangkas 15%.
 */
export function parlayProbability(probabilities: number[], correlationHaircut = 1): number {
  const usable = probabilities.filter((value) => Number.isFinite(value) && value > 0 && value < 1);
  if (usable.length === 0) return 0;
  const product = usable.reduce((acc, value) => acc * value, 1);
  const haircut = Math.min(1, Math.max(0, correlationHaircut));
  return product * haircut;
}

export interface CalibrationPair {
  probability: number;
  outcome: 0 | 1;
}

/** Brier score: rata-rata (p − o)². Makin kecil makin baik. */
export function brierScore(pairs: CalibrationPair[]): number | null {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.probability) && (pair.outcome === 0 || pair.outcome === 1),
  );
  if (usable.length === 0) return null;
  const total = usable.reduce(
    (sum, pair) => sum + (pair.probability - pair.outcome) ** 2,
    0,
  );
  return total / usable.length;
}

/** Log loss dengan clipping supaya probabilitas 0/1 tidak menghasilkan ∞. */
export function logLoss(pairs: CalibrationPair[], epsilon = 1e-6): number | null {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.probability) && (pair.outcome === 0 || pair.outcome === 1),
  );
  if (usable.length === 0) return null;
  const total = usable.reduce((sum, pair) => {
    const p = Math.min(1 - epsilon, Math.max(epsilon, pair.probability));
    return sum - (pair.outcome === 1 ? Math.log(p) : Math.log(1 - p));
  }, 0);
  return total / usable.length;
}

export interface CalibrationBucket {
  from: number;
  to: number;
  count: number;
  meanProbability: number;
  observedRate: number;
}

/** Tabel kalibrasi per bin, untuk melihat arah bias (terlalu yakin/terlalu ragu). */
export function calibrationBuckets(pairs: CalibrationPair[], bins = 10): CalibrationBucket[] {
  const width = 1 / bins;
  const buckets: CalibrationBucket[] = [];
  for (let index = 0; index < bins; index += 1) {
    const from = index * width;
    const to = from + width;
    const members = pairs.filter((pair) => {
      const p = pair.probability;
      /* floor(p·bins) menghindari galat pembulatan: 0.6/0.1 = 5.999… */
      const bucket = Math.min(bins - 1, Math.max(0, Math.floor(p * bins + 1e-9)));
      return bucket === index && (pair.outcome === 0 || pair.outcome === 1);
    });
    if (members.length === 0) continue;
    buckets.push({
      from: Number(from.toFixed(3)),
      to: Number(to.toFixed(3)),
      count: members.length,
      meanProbability: members.reduce((sum, pair) => sum + pair.probability, 0) / members.length,
      observedRate: members.reduce((sum, pair) => sum + pair.outcome, 0) / members.length,
    });
  }
  return buckets;
}

/** ECE: rata-rata selisih |probabilitas rata-rata − frekuensi nyata| per bin. */
export function expectedCalibrationError(pairs: CalibrationPair[], bins = 10): number | null {
  const buckets = calibrationBuckets(pairs, bins);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return null;
  const weighted = buckets.reduce(
    (sum, bucket) => sum + (bucket.count / total) * Math.abs(bucket.meanProbability - bucket.observedRate),
    0,
  );
  return weighted;
}
