/**
 * Mesin probabilitas gol: Poisson bivariat + koreksi Dixon-Coles.
 *
 * KELEMAHAN YANG DIPERBAIKI: pada sistem lama probabilitas "nyata" ditulis oleh
 * LLM (Gemini/Groq) dari 11 statistik yang ditempel sebagai teks. LLM tidak
 * menghitung, tidak terkalibrasi, dan tidak koheren antar-market (probabilitas
 * Over 2.5, BTTS, dan 1X2 bisa saling bertentangan). Di sini SEMUA market
 * diturunkan dari SATU matriks skor sehingga konsisten secara matematis, dan
 * hasilnya deterministik/bisa diuji.
 *
 * Settlement garis seperempat (x.25 / x.75) identik dengan aturan standar Asian
 * market: stake dibelah dua pada dua garis setengah-poin.
 */

export interface ScoreMatrix {
  /** m[h][a] = P(skor h-a) */
  m: number[][];
  maxGoals: number;
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
}

export interface LineOutcome {
  win: number;
  halfWin: number;
  push: number;
  halfLoss: number;
  loss: number;
}

function poissonPmf(lambda: number, maxGoals: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  out.push(p);
  for (let k = 1; k <= maxGoals; k++) {
    p = (p * lambda) / k;
    out.push(p);
  }
  return out;
}

/** Faktor koreksi Dixon-Coles untuk skor rendah. rho tipikal −0.05 … −0.15. */
function tau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function scoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho = -0.1,
  maxGoals = 10,
): ScoreMatrix {
  const lh = Math.max(0.05, lambdaHome);
  const la = Math.max(0.05, lambdaAway);
  const ph = poissonPmf(lh, maxGoals);
  const pa = poissonPmf(la, maxGoals);
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const v = Math.max(0, ph[h]! * pa[a]! * tau(h, a, lh, la, rho));
      row.push(v);
      total += v;
    }
    m.push(row);
  }
  for (const row of m) for (let a = 0; a < row.length; a++) row[a] = row[a]! / total;
  return { m, maxGoals, lambdaHome: lh, lambdaAway: la, rho };
}

export function matchResultProbs(M: ScoreMatrix): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= M.maxGoals; h++) {
    for (let a = 0; a <= M.maxGoals; a++) {
      const p = M.m[h]![a]!;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  return { home, draw, away };
}

export function bttsProb(M: ScoreMatrix): { yes: number; no: number } {
  let yes = 0;
  for (let h = 1; h <= M.maxGoals; h++) {
    for (let a = 1; a <= M.maxGoals; a++) yes += M.m[h]![a]!;
  }
  return { yes, no: 1 - yes };
}

function isQuarterLine(line: number): boolean {
  const twice = line * 2;
  return Math.abs(twice - Math.round(twice)) > 1e-9;
}

function sign(x: number): 1 | 0 | -1 {
  if (x > 1e-9) return 1;
  if (x < -1e-9) return -1;
  return 0;
}

function lineOutcome(
  M: ScoreMatrix,
  line: number,
  margin: (h: number, a: number, line: number) => number,
): LineOutcome {
  const comps = isQuarterLine(line) ? [line - 0.25, line + 0.25] : [line];
  const out: LineOutcome = { win: 0, halfWin: 0, push: 0, halfLoss: 0, loss: 0 };
  for (let h = 0; h <= M.maxGoals; h++) {
    for (let a = 0; a <= M.maxGoals; a++) {
      const p = M.m[h]![a]!;
      const s = comps.reduce((acc, l) => acc + sign(margin(h, a, l)), 0);
      if (comps.length === 1) {
        if (s > 0) out.win += p;
        else if (s < 0) out.loss += p;
        else out.push += p;
      } else if (s >= 2) out.win += p;
      else if (s === 1) out.halfWin += p;
      else if (s === 0) out.push += p;
      else if (s === -1) out.halfLoss += p;
      else out.loss += p;
    }
  }
  return out;
}

export function totalsOutcome(M: ScoreMatrix, line: number, side: "over" | "under"): LineOutcome {
  return lineOutcome(M, line, (h, a, l) => (side === "over" ? h + a - l : l - (h + a)));
}

/** `line` adalah handicap untuk sisi yang DIPILIH (mis. home −0.5, away +0.5). */
export function handicapOutcome(M: ScoreMatrix, line: number, side: "home" | "away"): LineOutcome {
  return lineOutcome(M, line, (h, a, l) => (side === "home" ? h - a + l : a - h + l));
}

/** Profit bersih per 1 unit stake jika harga `odds` (desimal). */
export function evOfOutcome(o: LineOutcome, odds: number): number {
  return (
    o.win * (odds - 1) +
    o.halfWin * ((odds - 1) / 2) -
    o.halfLoss * 0.5 -
    o.loss
  );
}

/** Porsi menang efektif (push dikeluarkan) — dipakai untuk fitting & kalibrasi. */
export function winShare(o: LineOutcome): number {
  const denom = 1 - o.push;
  if (denom <= 1e-12) return 0.5;
  return (o.win + 0.5 * o.halfWin) / denom;
}

export interface MarketTargets {
  home: number;
  draw: number;
  away: number;
  /** garis totals + probabilitas fair Over (setelah de-vig) */
  ouLine?: number;
  overFair?: number;
  /** jangkar total gol bila O/U tidak tersedia */
  priorTotal?: number;
}

export interface FittedLambdas {
  lambdaHome: number;
  lambdaAway: number;
  /** sisa kuadrat; > 0.002 berarti pasar tidak konsisten dengan model Poisson */
  error: number;
}

/**
 * Invers pasar: cari (λ_home, λ_away) yang mereproduksi probabilitas fair
 * 1X2 (+ Over/Under) dari bandar. Ini "prior" terbaik yang tersedia, karena
 * harga pasar menyerap cedera, line-up, uang tajam, dan berita yang tidak
 * dimiliki statistik musiman.
 */
export function fitMarketLambdas(
  t: MarketTargets,
  rho = -0.1,
  maxGoals = 10,
): FittedLambdas {
  const hasOU = t.ouLine != null && t.overFair != null;
  const cost = (lh: number, la: number): number => {
    const M = scoreMatrix(lh, la, rho, maxGoals);
    const r = matchResultProbs(M);
    let c = (r.home - t.home) ** 2 + (r.draw - t.draw) ** 2 + (r.away - t.away) ** 2;
    if (hasOU) {
      const share = winShare(totalsOutcome(M, t.ouLine!, "over"));
      c += 1.5 * (share - t.overFair!) ** 2;
    } else {
      const prior = t.priorTotal ?? 2.7;
      c += 0.0005 * (lh + la - prior) ** 2;
    }
    return c;
  };

  let bestLh = 1.4;
  let bestLa = 1.1;
  let best = Infinity;
  for (let lh = 0.2; lh <= 4.6; lh += 0.1) {
    for (let la = 0.1; la <= 4.0; la += 0.1) {
      const c = cost(lh, la);
      if (c < best) {
        best = c;
        bestLh = lh;
        bestLa = la;
      }
    }
  }
  let step = 0.05;
  for (let iter = 0; iter < 6; iter++) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const dh of [-step, 0, step]) {
        for (const da of [-step, 0, step]) {
          if (dh === 0 && da === 0) continue;
          const lh = Math.max(0.05, bestLh + dh);
          const la = Math.max(0.05, bestLa + da);
          const c = cost(lh, la);
          if (c < best - 1e-14) {
            best = c;
            bestLh = lh;
            bestLa = la;
            improved = true;
          }
        }
      }
    }
    step /= 2;
  }
  return { lambdaHome: bestLh, lambdaAway: bestLa, error: best };
}
