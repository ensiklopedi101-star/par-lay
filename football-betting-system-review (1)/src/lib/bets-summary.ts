import { asc } from "drizzle-orm";
import { db } from "@/db";
import { bets, type BetRow } from "@/db/schema";
import {
  binaryOutcome,
  clvOf,
  fitBlendWeight,
  summarizeLedger,
  type BetOutcome,
  type LedgerBet,
} from "@/lib/quant";

const OUTCOMES: BetOutcome[] = ["win", "half_win", "push", "half_loss", "loss", "void"];

export function isOutcome(value: unknown): value is BetOutcome {
  return typeof value === "string" && (OUTCOMES as string[]).includes(value);
}

export function toLedgerBet(row: BetRow): LedgerBet {
  return {
    pModel: row.pModel,
    pMarketFair: row.pMarketFair,
    pFinal: row.pFinal,
    oddsTaken: row.oddsTaken,
    oddsClose: row.oddsClose,
    closeFairProb: row.closeFairProb,
    outcome: isOutcome(row.outcome) ? row.outcome : null,
    stakeUnits: row.stakeUnits,
  };
}

export async function loadLedger(source?: "all" | "manual" | "demo") {
  const rows = await db.select().from(bets).orderBy(asc(bets.createdAt));
  const filtered = source && source !== "all" ? rows.filter((r) => r.source === source) : rows;
  const ledger = filtered.map(toLedgerBet);
  const summary = summarizeLedger(ledger);

  const samples = filtered
    .map((r) => ({
      pModel: r.pModel,
      pMarket: r.pMarketFair,
      outcome: binaryOutcome(isOutcome(r.outcome) ? r.outcome : null),
    }))
    .filter(
      (s): s is { pModel: number; pMarket: number; outcome: 0 | 1 } =>
        s.pModel != null && s.pMarket != null && s.outcome != null,
    );
  const blendFit = fitBlendWeight(samples);

  const items = filtered
    .slice()
    .reverse()
    .map((r) => ({
      ...r,
      clv: clvOf(r)?.value ?? null,
    }));
  return { items, summary, blendFit };
}
