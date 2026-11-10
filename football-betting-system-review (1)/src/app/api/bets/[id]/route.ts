import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bets } from "@/db/schema";
import { isOutcome } from "@/lib/bets-summary";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const betId = Number(id);
  if (!Number.isInteger(betId)) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const patch: Partial<typeof bets.$inferInsert> = {};
  if ("outcome" in body) {
    if (body.outcome === null || body.outcome === "") {
      patch.outcome = null;
      patch.settledAt = null;
    } else if (isOutcome(body.outcome)) {
      patch.outcome = body.outcome;
      patch.settledAt = new Date();
    } else return NextResponse.json({ error: "Outcome tidak valid" }, { status: 400 });
  }
  if ("oddsClose" in body) {
    const n = Number(body.oddsClose);
    patch.oddsClose = Number.isFinite(n) && n > 1 ? n : null;
  }
  if ("closeFairProb" in body) {
    const n = Number(body.closeFairProb);
    patch.closeFairProb = Number.isFinite(n) && n > 0 && n < 1 ? n : null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
  const [row] = await db.update(bets).set(patch).where(eq(bets.id, betId)).returning();
  if (!row) return NextResponse.json({ error: "Bet tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ bet: row });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const betId = Number(id);
  if (!Number.isInteger(betId)) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  await db.delete(bets).where(eq(bets.id, betId));
  return NextResponse.json({ ok: true });
}
