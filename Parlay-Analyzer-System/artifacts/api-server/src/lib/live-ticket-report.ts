/**
 * Laporan tiket live (Fase B blueprint): bukti dari snapshot Tiket Hari
 * Ini yang BENAR-BENAR tercatat dan ter-settle di tabel `parlays` —
 * bukan backtest gudang, bukan simulasi.
 *
 * Tiga varian resmi (Utama/Booster/Jackpot) dilaporkan terpisah karena
 * profil risikonya memang dirancang berbeda; menggabungkannya akan
 * menyembunyikan varian mana yang bekerja. Tiket legacy ("AI Batch
 * Parlay" dsb.) hanya dihitung jumlahnya, tidak dicampur ke statistik
 * varian — komposernya sudah dimatikan (PR #62).
 *
 * Kejujuran sampel: di bawah MIN_SETTLED_FOR_CLAIMS tiket settled,
 * angka hit-rate/ROI bersifat deskriptif dan DILABELI sampel kecil.
 * ROI memakai taruhan satuan per tiket settled: menang membayar odds
 * gabungan efektif (leg push dihitung odds 1), kalah membayar 0,
 * tiket serba-push membayar 1 (refund).
 */

import { PHASE3_TARGET_SETTLED } from "./ledger-report";

export const LIVE_VARIANTS = ["Utama", "Booster", "Jackpot"] as const;
export type LiveVariant = (typeof LIVE_VARIANTS)[number];

/** Di bawah ini, hit-rate/ROI hanya deskriptif — bukan klaim keunggulan. */
export const MIN_SETTLED_FOR_CLAIMS = 10;

export interface LiveTicketRow {
  id: string;
  parlay_name: string | null;
  status: string | null;
  win_probability: number | string | null;
  created_at: string | null;
}

export interface LiveTicketLegRow {
  parlay_id: string;
  odds: number | string | null;
  result: string | null;
}

export interface LedgerProgressInput {
  settled: number;
  withClose: number;
}

export interface VariantSlice {
  variant: LiveVariant;
  recorded: number;
  active: number;
  won: number;
  lost: number;
  pushed: number;
  settled: number;
  /** won / settled; null bila belum ada yang settled. */
  hitRate: number | null;
  /** Rata-rata probabilitas gabungan yang dijanjikan saat tiket dicatat. */
  avgPromisedProb: number | null;
  /** hitRate − avgPromisedProb pada tiket settled; null bila tak terdefinisi. */
  calibrationGap: number | null;
  /** ROI taruhan satuan atas tiket settled; null bila belum ada. */
  roi: number | null;
  legsTotal: number;
  legsSettled: number;
  legHitRate: number | null;
  sampleSufficient: boolean;
}

export interface LiveTicketReport {
  generatedFrom: { recordedTickets: number; legacyTickets: number };
  variants: VariantSlice[];
  ledger: { settled: number; target: number; pct: number; withClose: number };
  verdict: string;
}

const SETTLED_LEG_RESULTS = new Set(["WIN", "LOSS", "PUSH", "HALF_WIN", "HALF_LOSS"]);
const HIT_LEG_RESULTS = new Set(["WIN", "HALF_WIN"]);

export function variantOfTicketName(name: string | null): LiveVariant | null {
  if (!name) return null;
  for (const variant of LIVE_VARIANTS) {
    if (name.startsWith(`Tiket ${variant}`)) return variant;
  }
  return null;
}

function num(value: number | string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Odds gabungan efektif: leg push menyusut jadi 1, sisanya apa adanya. */
function effectiveCombinedOdds(legs: LiveTicketLegRow[]): number | null {
  if (legs.length === 0) return null;
  let product = 1;
  for (const leg of legs) {
    if (leg.result === "PUSH") continue;
    const odds = num(leg.odds);
    if (odds == null || odds <= 0) return null;
    product *= odds;
  }
  return product;
}

function buildSlice(
  variant: LiveVariant,
  tickets: LiveTicketRow[],
  legsByTicket: Map<string, LiveTicketLegRow[]>,
): VariantSlice {
  let won = 0;
  let lost = 0;
  let pushed = 0;
  let active = 0;
  let promisedSum = 0;
  let promisedCount = 0;
  let payoutSum = 0;
  let legsTotal = 0;
  let legsSettled = 0;
  let legsHit = 0;

  for (const ticket of tickets) {
    const legs = legsByTicket.get(ticket.id) ?? [];
    legsTotal += legs.length;
    for (const leg of legs) {
      if (leg.result && SETTLED_LEG_RESULTS.has(leg.result)) {
        legsSettled += 1;
        if (HIT_LEG_RESULTS.has(leg.result)) legsHit += 1;
      }
    }
    const status = (ticket.status ?? "").toLowerCase();
    if (status === "won") won += 1;
    else if (status === "lost") lost += 1;
    else if (status === "settled") pushed += 1;
    else active += 1;

    const isSettled = status === "won" || status === "lost" || status === "settled";
    if (!isSettled) continue;
    const promised = num(ticket.win_probability);
    if (promised != null) {
      promisedSum += promised;
      promisedCount += 1;
    }
    if (status === "won") payoutSum += effectiveCombinedOdds(legs) ?? 0;
    else if (status === "settled") payoutSum += 1;
  }

  const settled = won + lost + pushed;
  const hitRate = settled > 0 ? won / settled : null;
  const avgPromisedProb = promisedCount > 0 ? promisedSum / promisedCount : null;
  return {
    variant,
    recorded: tickets.length,
    active,
    won,
    lost,
    pushed,
    settled,
    hitRate,
    avgPromisedProb,
    calibrationGap: hitRate != null && avgPromisedProb != null ? hitRate - avgPromisedProb : null,
    roi: settled > 0 ? payoutSum / settled - 1 : null,
    legsTotal,
    legsSettled,
    legHitRate: legsSettled > 0 ? legsHit / legsSettled : null,
    sampleSufficient: settled >= MIN_SETTLED_FOR_CLAIMS,
  };
}

export function buildLiveTicketReport(
  tickets: LiveTicketRow[],
  legs: LiveTicketLegRow[],
  ledger: LedgerProgressInput,
): LiveTicketReport {
  const legsByTicket = new Map<string, LiveTicketLegRow[]>();
  for (const leg of legs) {
    const list = legsByTicket.get(leg.parlay_id);
    if (list) list.push(leg);
    else legsByTicket.set(leg.parlay_id, [leg]);
  }

  const byVariant = new Map<LiveVariant, LiveTicketRow[]>();
  let legacyTickets = 0;
  for (const ticket of tickets) {
    const variant = variantOfTicketName(ticket.parlay_name);
    if (!variant) {
      legacyTickets += 1;
      continue;
    }
    const list = byVariant.get(variant);
    if (list) list.push(ticket);
    else byVariant.set(variant, [ticket]);
  }

  const variants = LIVE_VARIANTS.map((variant) =>
    buildSlice(variant, byVariant.get(variant) ?? [], legsByTicket),
  );
  const totalSettled = variants.reduce((acc, v) => acc + v.settled, 0);
  const totalActive = variants.reduce((acc, v) => acc + v.active, 0);

  let verdict: string;
  if (totalSettled === 0) {
    verdict = totalActive > 0
      ? `${totalActive} tiket live tercatat dan masih berjalan — belum ada yang settled, jadi belum ada bukti menang/kalah. Laporan ini terisi sendiri begitu cron settle berjalan.`
      : "Belum ada tiket live yang tercatat. Catat lewat menu Tiket Hari Ini agar bukti live mulai terkumpul.";
  } else if (totalSettled < MIN_SETTLED_FOR_CLAIMS) {
    verdict = `Baru ${totalSettled} tiket live settled — sampel kecil, angka di bawah ini deskriptif dan belum membuktikan apa-apa. Gerbang klaim: ${MIN_SETTLED_FOR_CLAIMS} tiket settled per laporan.`;
  } else {
    verdict = `${totalSettled} tiket live settled. Bandingkan hit-rate aktual terhadap probabilitas yang dijanjikan (selisih kalibrasi) sebelum memercayai varian mana pun.`;
  }

  return {
    generatedFrom: {
      recordedTickets: variants.reduce((acc, v) => acc + v.recorded, 0),
      legacyTickets,
    },
    variants,
    ledger: {
      settled: ledger.settled,
      target: PHASE3_TARGET_SETTLED,
      pct: Math.min(100, Math.round((ledger.settled / PHASE3_TARGET_SETTLED) * 100)),
      withClose: ledger.withClose,
    },
    verdict,
  };
}
