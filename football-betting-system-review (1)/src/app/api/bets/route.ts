import { NextResponse } from "next/server";
import { db } from "@/db";
import { bets } from "@/db/schema";
import { isOutcome, loadLedger } from "@/lib/bets-summary";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  const filter = source === "manual" || source === "demo" ? source : "all";
  const data = await loadLedger(filter);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const homeTeam = String(body.homeTeam ?? "").trim();
  const awayTeam = String(body.awayTeam ?? "").trim();
  const selection = String(body.selection ?? "").trim();
  const oddsTaken = num(body.oddsTaken);
  if (!homeTeam || !awayTeam || !selection) {
    return NextResponse.json({ error: "Tim home, away, dan selection wajib diisi" }, { status: 400 });
  }
  if (oddsTaken == null || oddsTaken <= 1) {
    return NextResponse.json({ error: "Odds diambil harus > 1.00" }, { status: 400 });
  }
  const prob = (v: unknown) => {
    const n = num(v);
    return n != null && n > 0 && n < 1 ? n : null;
  };
  const outcome = isOutcome(body.outcome) ? body.outcome : null;
  const oddsClose = num(body.oddsClose);
  const [row] = await db
    .insert(bets)
    .values({
      league: String(body.league ?? "").trim(),
      homeTeam,
      awayTeam,
      marketFamily: String(body.marketFamily ?? "ML"),
      selection,
      line: num(body.line),
      oddsTaken,
      pModel: prob(body.pModel),
      pMarketFair: prob(body.pMarketFair),
      pFinal: prob(body.pFinal),
      stakeUnits: Math.max(0.01, num(body.stakeUnits) ?? 1),
      oddsClose: oddsClose != null && oddsClose > 1 ? oddsClose : null,
      closeFairProb: prob(body.closeFairProb),
      outcome,
      settledAt: outcome ? new Date() : null,
      source: "manual",
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
    })
    .returning();
  return NextResponse.json({ bet: row }, { status: 201 });
}
