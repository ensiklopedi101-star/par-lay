import { NextResponse } from "next/server";
import { analyzeMatch, analyzeParlay, sanitizeLlmAdjustment, type MatchInput, type ParlayLeg } from "@/lib/quant";

export const dynamic = "force-dynamic";

/**
 * Endpoint integrasi: server Express Anda cukup POST ke sini (atau meng-copy
 * modul src/lib/quant ke api-server) — LLM tidak lagi dipanggil untuk menghitung.
 *
 *  POST { "match": MatchInput, "adjustment"?: <output LLM mentah> }
 *  POST { "parlay": { legs: ParlayLeg[], offeredOdds?: number } }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  try {
    if (body.parlay && typeof body.parlay === "object") {
      const p = body.parlay as { legs?: ParlayLeg[]; offeredOdds?: number; sigma?: number };
      if (!Array.isArray(p.legs) || p.legs.length === 0) {
        return NextResponse.json({ error: "parlay.legs wajib berisi minimal 1 leg" }, { status: 400 });
      }
      return NextResponse.json({ parlay: analyzeParlay(p.legs, { offeredOdds: p.offeredOdds, sigma: p.sigma }) });
    }
    if (body.match && typeof body.match === "object") {
      const match = body.match as MatchInput;
      const adjustment = body.adjustment !== undefined ? sanitizeLlmAdjustment(body.adjustment) : match.adjustment ?? null;
      return NextResponse.json({ analysis: analyzeMatch({ ...match, adjustment }) });
    }
    return NextResponse.json({ error: "Sertakan 'match' atau 'parlay'" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Input tidak valid" }, { status: 422 });
  }
}
