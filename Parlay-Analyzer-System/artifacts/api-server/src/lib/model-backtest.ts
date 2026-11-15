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
  /** ISO kick-off; dipakai segmentasi peluruhan prior per periode. */
  kickoff?: string;
  model: { home: number; draw: number; away: number; over25: number; bttsYes: number };
  /** Probabilitas fair pasar (sudah di-devig); null bila pasar tidak tersedia. */
  market: { home: number; draw: number; away: number } | null;
  /** Probabilitas fair pasar Over 2.5 (null bila snapshot Totals tidak ada). */
  marketOver25?: number | null;
  /** Probabilitas fair pasar BTTS Yes (null bila snapshot BTTS tidak ada). */
  marketBttsYes?: number | null;
  /**
   * Asian Handicap sisi kandang pada line konsensus: probabilitas cover
   * model (winShare, push dikeluarkan) vs fair pasar. Null bila snapshot
   * AH tidak tersedia.
   */
  ah?: { line: number; modelHomeCover: number; marketHomeFair: number } | null;
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
  /** Model vs pasar di pasar totals — keunggulan bisa bersembunyi di luar 1X2. */
  over25VsMarket: PairedMetric | null;
  bttsVsMarket: PairedMetric | null;
  /** ECE atas semua probabilitas biner model (1X2 per sisi, O2.5, BTTS). */
  calibrationEce: number | null;
  byLeague: Array<{ league: string; n: number; modelLogLoss: number; vsMarket: PairedMetric | null }>;
  /** Per bulan kick-off — mengukur apakah prior musim lalu meluruh. */
  byPeriod: Array<{ period: string; n: number; modelLogLoss: number; vsMarket: PairedMetric | null }>;
  verdict: string;
}

export interface LambdaParamCombo {
  xgWeight: number;
  shrinkK: number;
}

export interface CalibrationExperiment {
  trainN: number;
  validationN: number;
  defaultParams: LambdaParamCombo;
  /** Kombinasi terbaik di data latih (bukan data validasi). */
  bestParams: LambdaParamCombo | null;
  bestTrainSkill: number | null;
  defaultValidation: PairedMetric | null;
  bestValidation: PairedMetric | null;
  /**
   * Parameter baru hanya layak diadopsi bila mengalahkan bawaan di data
   * validasi yang tidak dipakai memilihnya, dan skill validasinya positif.
   * Menang di data latih saja adalah overfitting dengan nama keren.
   */
  adoptionJustified: boolean;
  note: string;
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

function pairedBinary(
  samples: BacktestSample[],
  modelProb: (s: BacktestSample) => number,
  marketProb: (s: BacktestSample) => number | null | undefined,
  outcome: (s: BacktestSample) => boolean,
): PairedMetric | null {
  const usable = samples.filter((s) => marketProb(s) != null);
  if (usable.length === 0) return null;
  const loss = (p: number, s: BacktestSample) => {
    const y = outcome(s) ? 1 : 0;
    return -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(clampProb(1 - p)));
  };
  const diffs = usable.map((s) => loss(marketProb(s)!, s) - loss(modelProb(s), s));
  const skill = mean(diffs);
  let tStat: number | null = null;
  if (diffs.length >= 2) {
    const sd = Math.sqrt(mean(diffs.map((d) => (d - skill) ** 2)));
    tStat = sd > 0 ? skill / (sd / Math.sqrt(diffs.length)) : null;
  }
  return {
    n: usable.length,
    modelLogLoss: mean(usable.map((s) => loss(modelProb(s), s))),
    marketLogLoss: mean(usable.map((s) => loss(marketProb(s)!, s))),
    skill,
    tStat,
  };
}

/**
 * Skill model vs pasar di Asian Handicap (sisi kandang, line konsensus).
 *
 * Hasil aktual dinyatakan fraksional mengikuti semantik line Asia:
 * menang penuh y=1, menang setengah y=0,75, kalah setengah y=0,25,
 * kalah penuh y=0; push murni dikeluarkan dari sampel (taruhan kembali,
 * tidak ada yang dipertaruhkan). Probabilitas model adalah winShare —
 * definisi yang sama seperti jalur live.
 */
export function asianHandicapVsMarket(samples: BacktestSample[]): PairedMetric | null {
  const usable: Array<{ model: number; market: number; y: number }> = [];
  for (const s of samples) {
    if (!s.ah) continue;
    const margin = s.actual.homeGoals - s.actual.awayGoals + s.ah.line;
    const isQuarter = Math.abs(line2x(s.ah.line)) > 0;
    let y: number;
    if (!isQuarter) {
      if (Math.abs(margin) < 1e-9) continue; // push — taruhan kembali
      y = margin > 0 ? 1 : 0;
    } else {
      const s1 = Math.sign(s.actual.homeGoals - s.actual.awayGoals + (s.ah.line - 0.25));
      const s2 = Math.sign(s.actual.homeGoals - s.actual.awayGoals + (s.ah.line + 0.25));
      const sum = s1 + s2;
      if (sum === 0 && s1 === 0) continue; // kedua komponen push (tidak terjadi di line perempat, jaga-jaga)
      y = sum >= 2 ? 1 : sum === 1 ? 0.75 : sum === -1 ? 0.25 : 0;
    }
    usable.push({ model: s.ah.modelHomeCover, market: s.ah.marketHomeFair, y });
  }
  if (usable.length === 0) return null;
  const loss = (p: number, y: number) =>
    -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(clampProb(1 - p)));
  const diffs = usable.map((u) => loss(u.market, u.y) - loss(u.model, u.y));
  const skill = mean(diffs);
  let tStat: number | null = null;
  if (diffs.length >= 2) {
    const sd = Math.sqrt(mean(diffs.map((d) => (d - skill) ** 2)));
    tStat = sd > 0 ? skill / (sd / Math.sqrt(diffs.length)) : null;
  }
  return {
    n: usable.length,
    modelLogLoss: mean(usable.map((u) => loss(u.model, u.y))),
    marketLogLoss: mean(usable.map((u) => loss(u.market, u.y))),
    skill,
    tStat,
  };
}

function line2x(line: number): number {
  const twice = line * 2;
  return Math.abs(twice - Math.round(twice)) > 1e-9 ? 1 : 0;
}

/** Skill model vs pasar untuk satu pasar biner — dipakai uji konfirmasi per paruh/per liga. */
export function binaryVsMarket(
  samples: BacktestSample[],
  market: "over25" | "btts",
): PairedMetric | null {
  return market === "over25"
    ? pairedBinary(samples, (s) => s.model.over25, (s) => s.marketOver25,
      (s) => s.actual.homeGoals + s.actual.awayGoals > 2.5)
    : pairedBinary(samples, (s) => s.model.bttsYes, (s) => s.marketBttsYes,
      (s) => s.actual.homeGoals > 0 && s.actual.awayGoals > 0);
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
    over25VsMarket: pairedBinary(
      samples, (s) => s.model.over25, (s) => s.marketOver25,
      (s) => s.actual.homeGoals + s.actual.awayGoals > 2.5,
    ),
    bttsVsMarket: pairedBinary(
      samples, (s) => s.model.bttsYes, (s) => s.marketBttsYes,
      (s) => s.actual.homeGoals > 0 && s.actual.awayGoals > 0,
    ),
    calibrationEce: ece,
    byLeague: [...leagues.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([league, rows]) => ({
        league,
        n: rows.length,
        modelLogLoss: mean(rows.map((s) => logLoss1X2(s.model, s))),
        vsMarket: paired(rows),
      })),
    byPeriod: [...samples.reduce((map, s) => {
      const period = s.kickoff ? s.kickoff.slice(0, 7) : "unknown";
      const arr = map.get(period) ?? [];
      arr.push(s);
      map.set(period, arr);
      return map;
    }, new Map<string, BacktestSample[]>()).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, rows]) => ({
        period,
        n: rows.length,
        modelLogLoss: mean(rows.map((s) => logLoss1X2(s.model, s))),
        vsMarket: paired(rows),
      })),
    verdict,
  };
}

/**
 * Nilai eksperimen kalibrasi parameter dengan disiplin train/validasi.
 * `trainSkills[i]` dan `validation[i]` sejajar dengan `combos[i]`;
 * kombinasi bawaan harus termasuk di dalamnya.
 */
export function buildCalibrationExperiment(
  combos: LambdaParamCombo[],
  trainSkills: Array<number | null>,
  validation: Array<PairedMetric | null>,
  defaultCombo: LambdaParamCombo,
  trainN: number,
  validationN: number,
): CalibrationExperiment {
  let bestIdx = -1;
  let bestSkill = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < combos.length; i++) {
    const skill = trainSkills[i];
    if (skill != null && skill > bestSkill) {
      bestSkill = skill;
      bestIdx = i;
    }
  }
  const defaultIdx = combos.findIndex(
    (c) => c.xgWeight === defaultCombo.xgWeight && c.shrinkK === defaultCombo.shrinkK,
  );
  const bestParams = bestIdx >= 0 ? combos[bestIdx]! : null;
  const bestValidation = bestIdx >= 0 ? validation[bestIdx]! : null;
  const defaultValidation = defaultIdx >= 0 ? validation[defaultIdx]! : null;

  const adoptionJustified = Boolean(
    bestParams
    && bestValidation
    && defaultValidation
    && bestValidation.skill > defaultValidation.skill
    && bestValidation.skill > 0,
  );

  let note: string;
  if (bestParams == null) {
    note = "Tidak ada kombinasi yang bisa dinilai di data latih (pasar tidak tersedia).";
  } else if (adoptionJustified) {
    note = `Parameter xgWeight=${bestParams.xgWeight}, shrinkK=${bestParams.shrinkK} mengalahkan bawaan di data validasi (skill ${(bestValidation!.skill * 100).toFixed(2)}% vs ${(defaultValidation!.skill * 100).toFixed(2)}%) — layak diadopsi lewat perubahan kode tersendiri.`;
  } else if (bestValidation && defaultValidation && bestValidation.skill <= defaultValidation.skill) {
    note = `Kombinasi terbaik di data latih (xgWeight=${bestParams.xgWeight}, shrinkK=${bestParams.shrinkK}) TIDAK mengalahkan bawaan di validasi — itu overfitting; parameter bawaan dipertahankan.`;
  } else {
    note = `Kombinasi terbaik di data latih belum membuktikan skill positif di validasi — parameter bawaan dipertahankan.`;
  }

  return {
    trainN,
    validationN,
    defaultParams: defaultCombo,
    bestParams,
    bestTrainSkill: bestIdx >= 0 ? bestSkill : null,
    defaultValidation,
    bestValidation,
    adoptionJustified,
    note,
  };
}

export interface BlendExperiment {
  trainN: number;
  validationN: number;
  /** Bobot model optimal di data latih (0 = pasar murni, 1 = model murni). */
  bestWeight: number | null;
  /** Bobot bawaan jalur live saat ini (0.35 model / 0.65 pasar). */
  currentWeight: number;
  /** Log-loss campuran di validasi pada bobot terpilih; null bila tak terhitung. */
  bestValidationLogLoss: number | null;
  /** Log-loss pasar murni (w=0) di validasi — patokan nilai tambah model. */
  marketOnlyValidationLogLoss: number | null;
  currentValidationLogLoss: number | null;
  /**
   * Model terbukti menambah nilai di atas pasar hanya bila campuran
   * berbobot positif mengalahkan pasar murni di data validasi.
   */
  modelAddsValue: boolean;
  note: string;
}

const BLEND_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1];

function blendedLogLoss(samples: BacktestSample[], w: number): number | null {
  const usable = samples.filter((s) => s.market != null);
  if (usable.length === 0) return null;
  return mean(usable.map((s) => {
    const blended = {
      home: w * s.model.home + (1 - w) * s.market!.home,
      draw: w * s.model.draw + (1 - w) * s.market!.draw,
      away: w * s.model.away + (1 - w) * s.market!.away,
    };
    return logLoss1X2(blended, s);
  }));
}

/**
 * Berapa takaran model yang layak dicampur ke pasar? Dipilih di data
 * latih, dihakimi di validasi melawan pasar murni (w=0). Model yang
 * lebih buruk dari pasar tetap bisa menambah nilai bila kesalahannya
 * tidak berkorelasi penuh — eksperimen ini yang membuktikannya,
 * bukan asumsi.
 */
export function buildBlendExperiment(
  train: BacktestSample[],
  validation: BacktestSample[],
  currentWeight = 0.35,
): BlendExperiment {
  let bestWeight: number | null = null;
  let bestTrainLoss = Number.POSITIVE_INFINITY;
  for (const w of BLEND_GRID) {
    const loss = blendedLogLoss(train, w);
    if (loss != null && loss < bestTrainLoss) {
      bestTrainLoss = loss;
      bestWeight = w;
    }
  }
  const bestValidationLogLoss = bestWeight != null ? blendedLogLoss(validation, bestWeight) : null;
  const marketOnlyValidationLogLoss = blendedLogLoss(validation, 0);
  const currentValidationLogLoss = blendedLogLoss(validation, currentWeight);
  const modelAddsValue = Boolean(
    bestWeight != null && bestWeight > 0
    && bestValidationLogLoss != null && marketOnlyValidationLogLoss != null
    && bestValidationLogLoss < marketOnlyValidationLogLoss,
  );

  let note: string;
  if (bestWeight == null) {
    note = "Pasar tidak tersedia — bobot campuran tidak bisa diukur.";
  } else if (bestWeight === 0) {
    note = "Bobot optimal di data latih adalah 0: model tidak menambah apa pun di atas pasar pada sampel ini. Pasar murni adalah probabilitas terbaik yang tersedia; model hanya layak sebagai pemeriksa kewajaran.";
  } else if (modelAddsValue) {
    note = `Campuran berbobot model ${bestWeight} mengalahkan pasar murni di validasi (log-loss ${bestValidationLogLoss?.toFixed(3)} vs ${marketOnlyValidationLogLoss?.toFixed(3)}) — model punya nilai tambah terukur di atas pasar, sebesar takaran itu.`;
  } else {
    note = `Bobot terpilih di latih (${bestWeight}) tidak mengalahkan pasar murni di validasi — nilai tambah model belum terbukti; jangan menaikkan bobot model di jalur live.`;
  }

  return {
    trainN: train.filter((s) => s.market != null).length,
    validationN: validation.filter((s) => s.market != null).length,
    bestWeight,
    currentWeight,
    bestValidationLogLoss,
    marketOnlyValidationLogLoss,
    currentValidationLogLoss,
    modelAddsValue,
    note,
  };
}
