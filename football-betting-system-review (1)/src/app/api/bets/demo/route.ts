import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bets, type NewBetRow } from "@/db/schema";
import { mulberry32 } from "@/lib/quant";

export const dynamic = "force-dynamic";

/**
 * Data DEMO (simulasi, bukan data nyata Anda). Skenario: model tanpa
 * shrinkage — probabilitas model = kebenaran + noise ±7 poin — lalu memilih
 * bet dengan EV tertinggi. Ini mereproduksi pola "terlihat bagus di atas
 * kertas, rugi di dunia nyata" (winner's curse) yang berisiko pada sistem
 * berbasis probabilitas LLM.
 */
export async function POST() {
  const rnd = mulberry32(1337);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const leagues = ["Premier League", "La Liga", "Serie A", "Bundesliga", "K League 1", "J1 League"];
  const rows: NewBetRow[] = [];
  const start = Date.now() - 1000 * 60 * 60 * 24 * 120;
  let attempts = 0;
  while (rows.length < 160 && attempts < 4000) {
    attempts++;
    const pTrue = Math.min(0.8, Math.max(0.18, 0.2 + rnd() * 0.55));
    const pModel = Math.min(0.92, Math.max(0.08, pTrue + gauss() * 0.07));
    const margin = 1.05;
    const oddsOffered = 1 / Math.min(0.97, Math.max(0.05, pTrue + gauss() * 0.015)) / margin;
    if (oddsOffered <= 1.15) continue;
    if (pModel * oddsOffered - 1 < 0.04) continue; // pilih yang tampak bernilai
    const pMarketFair = Math.min(0.97, Math.max(0.03, 1 / (oddsOffered * 1) * margin));
    const closeFair = Math.min(0.97, Math.max(0.03, pTrue + gauss() * 0.01));
    const oddsClose = 1 / closeFair / margin;
    const won = rnd() < pTrue;
    const i = rows.length;
    rows.push({
      createdAt: new Date(start + (i / 160) * 1000 * 60 * 60 * 24 * 118),
      league: leagues[i % leagues.length]!,
      homeTeam: `Demo Home ${i + 1}`,
      awayTeam: `Demo Away ${i + 1}`,
      marketFamily: ["ML", "Totals", "AH", "BTTS"][i % 4]!,
      selection: "Demo selection",
      oddsTaken: Number(oddsOffered.toFixed(3)),
      pModel,
      pMarketFair,
      pFinal: pModel,
      stakeUnits: 1,
      oddsClose: Number(oddsClose.toFixed(3)),
      closeFairProb: closeFair,
      outcome: won ? "win" : "loss",
      settledAt: new Date(start + (i / 160) * 1000 * 60 * 60 * 24 * 118 + 1000 * 60 * 60 * 6),
      source: "demo",
      notes: "Data simulasi — hapus sebelum memakai ledger sungguhan.",
    });
  }
  await db.delete(bets).where(eq(bets.source, "demo"));
  await db.insert(bets).values(rows);
  return NextResponse.json({ inserted: rows.length });
}

export async function DELETE() {
  await db.delete(bets).where(eq(bets.source, "demo"));
  return NextResponse.json({ ok: true });
}
