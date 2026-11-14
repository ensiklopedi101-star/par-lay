/**
 * Backtest model Poisson (match-context) terhadap hasil nyata.
 *
 * Pertanyaan yang dijawab modul ini bukan "model sering benar?" melainkan
 * pertanyaan profesional: **apakah probabilitas model lebih akurat
 * daripada probabilitas pasar pada pertandingan yang sama?** Karena itu
 * metrik utamanya adalah selisih log-loss berpasangan (model vs pasar,
 * per pertandingan) lengkap dengan t-stat — bukan hit-rate, yang bisa
 * tinggi pada model yang tidak punya nilai betting sama sekali.
 *
 * Modul ini murni (tanpa I/O): penyiapan sampel dari baris database
 * dilakukan pemanggil (scripts/backtest-model.ts), sehingga angka yang
 * sama bisa direproduksi dari ekspor JSON mana pun.
 */

export interface BacktestSample {
  id: string;
  league: string;
  model: { home: number; draw: number; away: number; over25: number; bttsYes: number };
  /** Probabilitas fair pasar (sudah di-devig); null bila pasar tidak tersedia. */
  market: { home: number; draw: number; away: number } | null;
  actual: { homeGoals: number; awayGoals: number };
}

export interface PairedMetric {
  n: number;
  modelLogLoss: number;
  marketLogLoss: number;
  /** market − model; positif = model lebih akurat dari pasar. */
  skill: number;
  /** t-stat selisih berpasangan per pertandingan. */
  tStat: number | null;
}

export interface BinaryMetric {
  n: number;
  logLoss: number;
  brier: number;
  baseRate: number;
}

export interface ModelBacktestReport {
  samples: number;
  withMarket: number;
  oneX2: {
    modelLogLoss: number;
    modelBrier: number;
    /** Ketepatan argmax — konteks saja, BUKAN bukti nilai betting. */
    argmaxHitRate: number;
    vsMarket: PairedMetric | null;
  };
  over25: BinaryMetric;
  btts: BinaryMetric;
  /** ECE atas semua probabilitas biner model (1X2 per sisi, O2.5, BTTS). */
  calibrationEce: number | null;
  byLeague: Array<{ league: string; n: number; modelLogLoss: number; vsMarket: PairedMetric | null }>;
  verdict: string;
}

const EPS = 1e-12;

function clampProb(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function oneX2Outcome(s: BacktestSample): "home" | "draw" | "away" {
  if (s.actual.homeGoals > s.actual.awayGoals) return "home";
  if (s.actual.homeGoals < s.actual.awayGoals) return "away";
  return "draw";
}

function logLoss1X2(probs: { home: number; draw: number; away: number }, s: BacktestSample): number {
  const outcome = oneX2Outcome(s);
  return -Math.log(clampProb(probs[outcome]));
}

function brier1X2(probs: { home: number; draw: number; away: number }, s: BacktestSample): number {
  const outcome = oneX2Outcome(s);
  let sum = 0;
  for (const key of ["home", "draw", "away"] as const) {
    const y = key === outcome ? 1 : 0;
    sum += (probs[key] - y) ** 2;
  }
  return sum;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function paired(samples: BacktestSample[]): PairedMetric | null {
  const withMarket = samples.filter((s) => s.market != null);
  if (withMarket.length === 0) return null;
  const diffs = withMarket.map(
    (s) => logLoss1X2(s.market!, s) - logLoss1X2(s.model, s),
  );
  const skill = mean(diffs);
  let tStat: number | null = null;
  if (diffs.length >= 2) {
    const variance = mean(diffs.map((d) => (d - skill) ** 2));
    const sd = Math.sqrt(variance);
    tStat = sd > 0 ? skill / (sd / Math.sqrt(diffs.length)) : null;
  }
  return {
    n: withMarket.length,
    modelLogLoss: mean(withMarket.map((s) => logLoss1X2(s.model, s))),
    marketLogLoss: mean(withMarket.map((s) => logLoss1X2(s.market!, s))),
    skill,
    tStat,
  };
}

function binaryMetric(
  samples: BacktestSample[],
  prob: (s: BacktestSample) => number,
  outcome: (s: BacktestSample) => boolean,
): BinaryMetric {
  const probs = samples.map(prob);
  const ys = samples.map((s) => (outcome(s) ? 1 : 0));
  return {
    n: samples.length,
    logLoss: mean(probs.map((p, i) => {
      const y = ys[i]!;
      return -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(clampProb(1 - p)));
    })),
    brier: mean(probs.map((p, i) => (p - ys[i]!) ** 2)),
    baseRate: mean(ys),
  };
}

function calibrationEce(samples: BacktestSample[]): number | null {
  const points: Array<{ p: number; y: number }> = [];
  for (const s of samples) {
    const outcome = oneX2Outcome(s);
    points.push({ p: s.model.home, y: outcome === "home" ? 1 : 0 });
    points.push({ p: s.model.draw, y: outcome === "draw" ? 1 : 0 });
    points.push({ p: s.model.away, y: outcome === "away" ? 1 : 0 });
    points.push({ p: s.model.over25, y: s.actual.homeGoals + s.actual.awayGoals > 2.5 ? 1 : 0 });
    points.push({ p: s.model.bttsYes, y: s.actual.homeGoals > 0 && s.actual.awayGoals > 0 ? 1 : 0 });
  }
  if (points.length < 5) return null;
  const bins = new Map<number, { p: number[]; y: number[] }>();
  for (const point of points) {
    const bin = Math.min(9, Math.floor(point.p * 10));
    const bucket = bins.get(bin) ?? { p: [], y: [] };
    bucket.p.push(point.p);
    bucket.y.push(point.y);
    bins.set(bin, bucket);
  }
  let ece = 0;
  for (const bucket of bins.values()) {
    ece += (bucket.p.length / points.length) * Math.abs(mean(bucket.p) - mean(bucket.y));
  }
  return ece;
}

export function buildModelBacktest(samples: BacktestSample[]): ModelBacktestReport {
  const vsMarket = paired(samples);
  const argmaxHits = samples.filter((s) => {
    const best = Math.max(s.model.home, s.model.draw, s.model.away);
    const pick = best === s.model.home ? "home" : best === s.model.draw ? "draw" : "away";
    return pick === oneX2Outcome(s);
  }).length;

  const leagues = new Map<string, BacktestSample[]>();
  for (const s of samples) {
    const arr = leagues.get(s.league) ?? [];
    arr.push(s);
    leagues.set(s.league, arr);
  }

  const ece = calibrationEce(samples);
  let verdict: string;
  if (samples.length < 30) {
    verdict = `Sampel terlalu kecil (n=${samples.length} < 30) — belum ada vonis yang boleh dipercaya.`;
  } else if (vsMarket == null) {
    verdict = "Probabilitas pasar tidak tersedia — model hanya bisa dinilai absolut, bukan vs pasar.";
  } else if (vsMarket.skill > 0 && (vsMarket.tStat ?? 0) >= 2) {
    verdict = `Model mengalahkan pasar secara signifikan (skill ${(vsMarket.skill * 100).toFixed(2)}%, t=${vsMarket.tStat?.toFixed(2)}). Bukti awal mendukung — lanjutkan ke pengumpulan ledger live.`;
  } else if (vsMarket.skill > 0) {
    verdict = `Model di atas pasar tapi belum signifikan (skill ${(vsMarket.skill * 100).toFixed(2)}%, t=${vsMarket.tStat?.toFixed(2) ?? "—"}). Arah benar, bukti belum cukup.`;
  } else {
    verdict = `Model TIDAK mengalahkan pasar pada sampel ini (skill ${(vsMarket.skill * 100).toFixed(2)}%, t=${vsMarket.tStat?.toFixed(2) ?? "—"}). Probabilitas model belum layak jadi dasar bet tanpa campuran pasar.`;
  }

  return {
    samples: samples.length,
    withMarket: samples.filter((s) => s.market != null).length,
    oneX2: {
      modelLogLoss: mean(samples.map((s) => logLoss1X2(s.model, s))),
      modelBrier: mean(samples.map((s) => brier1X2(s.model, s))),
      argmaxHitRate: samples.length === 0 ? 0 : argmaxHits / samples.length,
      vsMarket,
    },
    over25: binaryMetric(samples, (s) => s.model.over25, (s) => s.actual.homeGoals + s.actual.awayGoals > 2.5),
    btts: binaryMetric(samples, (s) => s.model.bttsYes, (s) => s.actual.homeGoals > 0 && s.actual.awayGoals > 0),
    calibrationEce: ece,
    byLeague: [...leagues.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([league, rows]) => ({
        league,
        n: rows.length,
        modelLogLoss: mean(rows.map((s) => logLoss1X2(s.model, s))),
        vsMarket: paired(rows),
      })),
    verdict,
  };
}
