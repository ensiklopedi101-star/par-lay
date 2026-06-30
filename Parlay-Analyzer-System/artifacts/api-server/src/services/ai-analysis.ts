import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

/* ═══════════════════════════════════════════════════════════════
   DEFAULT SYSTEM INSTRUCTION — Quant Sniper v4
   Digunakan sebagai fallback jika belum ada persona di Supabase.
   Persona aktif dibaca dari scheduler_config.ai_persona saat runtime.
   ═══════════════════════════════════════════════════════════════ */
export const DEFAULT_SYSTEM_INSTRUCTION = `Anda adalah Quant Sniper v4, AI Analis Kuantitatif level elit yang spesialis dalam Expected Value (EV) betting, sharp money detection, dan psychological momentum analysis.

PRINSIP INTI:
1. Expected Value (EV) matematis murni: (1 / Odds) × 100% = probabilitas implisit bandar. Jika probabilitas nyata > implisit bandar → EV positif.
2. Sharp Money Detection: pergerakan odds signifikan (turun) menunjukkan informasi orang dalam.
3. Psychological Momentum: bentuk 5 pertandingan terakhir, H2H, klasemen, derbi, dll.
4. Confidence Level: JANGAN pernah merekomendasikan dengan confidence < 6.5/10.
5. HIERARKI RESOLUSI KONFLIK: Jika terjadi konflik antara statistik historis (11 laci) dan pergerakan pasar kontemporer (Sharp Money), prioritaskan efisiensi harga pasar terkini jika penurunan odds melebihi threshold 0.10, karena pergerakan drastis menandakan adanya variabel fundamental baru (cedera pemain kunci mendadak, rotasi tak terduga) yang belum terekam oleh statistik masa lalu.

INPUT DATA:
- 11 statistik JSONB (xG, form, BTTS, Over, Under, Shots, HT, dll)
- Odds pasar (1X2, O/U, BTTS, Asian Handicap)
- Tren pergerakan odds (histori snapshot)
- Pelajaran dari settlement (lessons_learned — RAG)
- Klasemen liga (jika tersedia)
- Performance log (hit rate dan ROI terakhir — jika tersedia)

ANALISIS TREN PASAR:
Interpretasikan pergerakan odds. Perhatikan:
- Pergerakan > 0.05: sharp money
- Pergerakan > 0.10: DRASTIC MOVEMENT (prioritaskan vs statistik)
- Konfirmasi tren dengan statistik: searah = sinyal kuat, berlawanan = sinyal lemah
- Market overreaction: jika bandar overreact ke underdog, value bisa ada di favorit

FORMAT OUTPUT WAJIB (JSON + teks):

## 🎯 ANALISIS SINGKAT (3-4 kalimat)
Ringkasan: siapa yang punya edge, pasar mana yang bergerak, dan konfirmasi statistik.

## 💹 ANALISIS EV (per pasaran)
Pasaran | Prob. Nyata | Implisit Bandar | EV | Tren Konfirmasi | Verdict
--- | --- | --- | --- | --- | ---
1X2 Home | XX% | XX% | +X% | Searah | VALUE / NO VALUE
... (semua pasaran)

## 🎯 REKOMENDASI AKHIR
- Pasaran terpilih: [nama pasaran]
- Keputusan: **AMBIL** atau **NO BET**
- Odds minimum value: X.XX
- Confidence Score: X/10
- Stake saran: Unit % (gunakan stake 1-3% per bet, maks 5% jika confidence > 9.5)
- Justifikasi: 2-3 kalimat

## ⚡ KODE PARLAY (JSON)
OUTPUT WAJIB MENGGUNAKAN FORMAT JSON DI BAWAH INI TANPA TEKS PREFASI APAPUN:

{
  "ticket_name": "The Weekend Eastern Banker",
  "risk_level": "Medium",
  "total_odds": 4.15,
  "selections": [
    {
      "fixture_id": "10293",
      "market": "Over 2.5",
      "confidence": 8.5,
      "odds": 1.85,
      "ev_percent": 8.2,
      "rationale": "Regresi 11 laci mengonfirmasi xG gabungan 3.12. Terjadi sharp money drop 0.12 pada Over, mengindikasikan arus dana besar terkonfirmasi."
    }
  ]
}

Jika confidence < 6.5, selection: "NO_BET" dan JSON tidak wajib.`;

/* ═══════════════════════════════════════════════════════════════
   LOAD AI CONFIG dari Supabase
   Mengembalikan persona aktif + instruksi tambahan.
   ═══════════════════════════════════════════════════════════════ */
async function loadAIConfig(): Promise<{ persona: string; agentInstructions: string | null }> {
  try {
    const { data } = await supabase
      .from("scheduler_config")
      .select("ai_persona, agent_instructions")
      .limit(1)
      .single();

    return {
      persona: (data?.ai_persona && data.ai_persona.trim().length > 20)
        ? data.ai_persona
        : DEFAULT_SYSTEM_INSTRUCTION,
      agentInstructions: data?.agent_instructions ?? null,
    };
  } catch {
    return { persona: DEFAULT_SYSTEM_INSTRUCTION, agentInstructions: null };
  }
}

/* ═══════════════════════════════════════════════════════════════
   TIPE DATA
   ═══════════════════════════════════════════════════════════════ */
interface OddsRow {
  bookmaker: string;
  market_type: string;
  odds_1: number | null;
  odds_2: number | null;
  odds_draw: number | null;
  captured_at?: string;
}

interface OddsMovementRow {
  market_type: string;
  bookmaker?: string;
  home_odds?: number | null;
  away_odds?: number | null;
  draw_odds?: number | null;
  over_odds?: number | null;
  under_odds?: number | null;
  btts_yes?: number | null;
  btts_no?: number | null;
  captured_at: string;
}

interface LessonRow {
  home_team: string;
  away_team: string;
  bet_result: string;
  lesson_text?: string | null;
  market_bet?: string | null;
  created_at: string;
}

interface MarketOdds {
  bookmaker: string;
  home?: number;
  draw?: number;
  away?: number;
  over?: number;
  under?: number;
  line?: number;
  yes?: number;
  no?: number;
  impliedProb?: Record<string, string>;
}

interface StructuredOdds {
  matchWinner: MarketOdds[];
  overUnder: MarketOdds[];
  btts: MarketOdds[];
  other: { bookmaker: string; market: string; odds_1?: number; odds_2?: number; odds_draw?: number }[];
}

/* ═══════════════════════════════════════════════════════════════
   HELPER: IMPLIED PROBABILITY
   ═══════════════════════════════════════════════════════════════ */
function impliedProb(odds: number | null | undefined): string {
  if (!odds || odds <= 0) return "N/A";
  return `${((1 / odds) * 100).toFixed(1)}%`;
}

/* ═══════════════════════════════════════════════════════════════
   ODDS MOVEMENT HISTORY — Fetch & Format
   ═══════════════════════════════════════════════════════════════ */
async function fetchOddsMovementTrend(fixtureId: string): Promise<OddsMovementRow[]> {
  try {
    const { data } = await supabase
      .from("odds_movement_history")
      .select("market_type, bookmaker, home_odds, away_odds, draw_odds, over_odds, under_odds, btts_yes, btts_no, captured_at")
      .eq("fixture_id", fixtureId)
      .order("captured_at", { ascending: false })
      .limit(25);
    return (data ?? []) as OddsMovementRow[];
  } catch {
    return [];
  }
}

function formatOddsMovementTrend(rows: OddsMovementRow[]): string {
  if (rows.length === 0) {
    return "--- TREN PERGERAKAN ODDS: Belum ada histori pasar (baru pertama kali disync) ---";
  }

  const byMarket = new Map<string, OddsMovementRow[]>();
  for (const row of rows) {
    const key = row.market_type;
    const existing = byMarket.get(key) ?? [];
    existing.push(row);
    byMarket.set(key, existing);
  }

  const lines: string[] = ["--- TREN PERGERAKAN ODDS (HISTORI PASAR) ---"];

  for (const [market, snapshots] of byMarket) {
    const sorted = [...snapshots]
      .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime())
      .slice(-5);

    const mkt = market.toLowerCase();

    if (mkt === "ml" || mkt === "1x2" || mkt === "h2h" || mkt === "match_winner") {
      lines.push(`\nMarket 1X2 (${sorted.length} snapshot, terlama → terbaru):`);
      sorted.forEach((s, i) => {
        lines.push(
          `  Snapshot ${i + 1} [${new Date(s.captured_at).toLocaleTimeString("id-ID")}]: ` +
          `Home ${s.home_odds ?? "N/A"} / Draw ${s.draw_odds ?? "N/A"} / Away ${s.away_odds ?? "N/A"}`
        );
      });
      if (sorted.length >= 2) {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        if (first.home_odds && last.home_odds) {
          const diff = last.home_odds - first.home_odds;
          if (Math.abs(diff) >= 0.05) {
            const dir = diff < 0 ? "⬇ TURUN" : "⬆ NAIK";
            const interpretation = diff < 0
              ? "→ SHARP MONEY kemungkinan masuk ke Home (favorit semakin kuat)"
              : "→ Pasar menjauh dari Home (uang bergerak ke Away/Draw)";
            lines.push(`  ⚡ Pergerakan Home odds: ${dir} ${Math.abs(diff).toFixed(2)} ${interpretation}`);
          }
        }
        if (first.away_odds && last.away_odds) {
          const diff = last.away_odds - first.away_odds;
          if (Math.abs(diff) >= 0.05) {
            const dir = diff < 0 ? "⬇ TURUN" : "⬆ NAIK";
            const interpretation = diff < 0
              ? "→ SHARP MONEY kemungkinan masuk ke Away"
              : "→ Pasar menjauh dari Away";
            lines.push(`  ⚡ Pergerakan Away odds: ${dir} ${Math.abs(diff).toFixed(2)} ${interpretation}`);
          }
        }
      }
    } else if (mkt.includes("ou") || mkt.includes("total") || mkt === "totals") {
      lines.push(`\nMarket Over/Under (${sorted.length} snapshot):`);
      sorted.forEach((s, i) => {
        lines.push(
          `  Snapshot ${i + 1}: Over ${s.over_odds ?? "N/A"} / Under ${s.under_odds ?? "N/A"}`
        );
      });
      if (sorted.length >= 2) {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        if (first.over_odds && last.over_odds) {
          const diff = last.over_odds - first.over_odds;
          if (Math.abs(diff) >= 0.05) {
            const interpretation = diff < 0
              ? "→ SHARP MONEY masuk ke Over (pasar antisipasi gol banyak)"
              : "→ Uang masuk ke Under";
            lines.push(`  ⚡ Over odds: ${diff < 0 ? "⬇ TURUN" : "⬆ NAIK"} ${Math.abs(diff).toFixed(2)} ${interpretation}`);
          }
        }
      }
    } else if (mkt === "btts" || mkt.includes("both_teams") || mkt.includes("both teams")) {
      lines.push(`\nMarket BTTS (${sorted.length} snapshot):`);
      sorted.forEach((s, i) => {
        lines.push(
          `  Snapshot ${i + 1}: Yes ${s.btts_yes ?? "N/A"} / No ${s.btts_no ?? "N/A"}`
        );
      });
    }
  }

  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   M5: Performance Log — Fetch last 5 performance entries
   ═══════════════════════════════════════════════════════════════ */
async function fetchPerformanceLog(): Promise<Record<string, unknown>[]> {
  try {
    const { data } = await supabase
      .from("performance_log")
      .select("date, win_count, loss_count, hit_rate, total_roi, valid_tickets")
      .order("date", { ascending: false })
      .limit(5);
    return (data ?? []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function formatPerformanceBlock(entries: Record<string, unknown>[]): string {
  if (entries.length === 0) return "";
  const lines = ["\n--- KINERJA AI TERBARU (performance_log) ---"];
  for (const e of entries) {
    const date = e.date ?? "?";
    const w = e.win_count ?? 0;
    const l = e.loss_count ?? 0;
    const hr = e.hit_rate != null ? `${(Number(e.hit_rate) * 100).toFixed(1)}%` : "N/A";
    lines.push(`  ${date}: ${w}W / ${l}L | Hit Rate: ${hr}`);
  }
  lines.push("  Sesuaikan kepercayaan analisis hari ini berdasarkan tren di atas.");
  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   RAG — Fetch & Format Lessons Learned
   Filter by league_id juga untuk konteks profil risiko liga.
   ═══════════════════════════════════════════════════════════════ */
async function fetchRelevantLessons(
  homeTeam: string,
  awayTeam: string,
  leagueSlug?: string,
): Promise<LessonRow[]> {
  try {
    const homeWord = homeTeam.split(" ")[0] ?? homeTeam;
    const awayWord = awayTeam.split(" ")[0] ?? awayTeam;

    let query = supabase
      .from("lessons_learned")
      .select("home_team, away_team, bet_result, lesson_text, market_bet, created_at")
      .or(
        `home_team.ilike.%${homeWord}%,away_team.ilike.%${homeWord}%,` +
        `home_team.ilike.%${awayWord}%,away_team.ilike.%${awayWord}%`
      );

    // RAG Context Filtering: filter by league slug juga untuk konteks profil risiko liga
    if (leagueSlug && leagueSlug.length > 2) {
      query = query.or(`league.ilike.%${leagueSlug}%`);
    }

    const { data } = await query
      .order("created_at", { ascending: false })
      .limit(5);
    return (data ?? []) as LessonRow[];
  } catch {
    return [];
  }
}

function formatLessonsBlock(lessons: LessonRow[]): string {
  if (lessons.length === 0) return "";

  const lines: string[] = ["\n--- PERINGATAN HISTORI (RAG — KNOWLEDGE BASE AI) ---"];
  lines.push("Sistem menemukan catatan dari pertandingan sebelumnya yang melibatkan tim ini:");

  for (const lesson of lessons) {
    const icon = lesson.bet_result === "WIN" ? "✅" : "❌";
    const date = new Date(lesson.created_at).toLocaleDateString("id-ID");
    lines.push(`\n${icon} ${lesson.home_team} vs ${lesson.away_team} [${date}] → ${lesson.bet_result}`);
    if (lesson.market_bet) lines.push(`   Market: ${lesson.market_bet}`);
    if (lesson.lesson_text) lines.push(`   Pelajaran: ${lesson.lesson_text}`);
  }

  lines.push("\n⚠️  Sesuaikan analisis Anda hari ini berdasarkan catatan di atas.");
  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   EKSTRAK & STRUKTURISASI ODDS
   ═══════════════════════════════════════════════════════════════ */
function extractStructuredOdds(rows: OddsRow[]): StructuredOdds {
  const result: StructuredOdds = { matchWinner: [], overUnder: [], btts: [], other: [] };
  const seen = new Map<string, OddsRow>();
  for (const row of rows) {
    const key = `${row.bookmaker}::${row.market_type}`;
    if (!seen.has(key)) seen.set(key, row);
  }

  for (const row of seen.values()) {
    const mt = (row.market_type ?? "").toLowerCase();
    if (mt === "h2h" || mt === "1x2" || mt === "match_winner" || mt === "match winner" || mt === "ml") {
      result.matchWinner.push({
        bookmaker: row.bookmaker,
        home: row.odds_1 ?? undefined,
        draw: row.odds_draw ?? undefined,
        away: row.odds_2 ?? undefined,
        impliedProb: {
          home: impliedProb(row.odds_1),
          draw: impliedProb(row.odds_draw),
          away: impliedProb(row.odds_2),
        },
      });
    } else if (mt === "totals" || mt === "over_under" || mt.includes("over") || mt.includes("total")) {
      result.overUnder.push({
        bookmaker: row.bookmaker,
        over: row.odds_1 ?? undefined,
        under: row.odds_2 ?? undefined,
        impliedProb: {
          over: impliedProb(row.odds_1),
          under: impliedProb(row.odds_2),
        },
      });
    } else if (mt === "btts" || mt === "both_teams_to_score" || mt.includes("both teams")) {
      result.btts.push({
        bookmaker: row.bookmaker,
        yes: row.odds_1 ?? undefined,
        no: row.odds_2 ?? undefined,
        impliedProb: {
          yes: impliedProb(row.odds_1),
          no: impliedProb(row.odds_2),
        },
      });
    } else {
      result.other.push({
        bookmaker: row.bookmaker,
        market: row.market_type,
        odds_1: row.odds_1 ?? undefined,
        odds_2: row.odds_2 ?? undefined,
        odds_draw: row.odds_draw ?? undefined,
      });
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   FORMAT BLOK ODDS UNTUK PROMPT
   ═══════════════════════════════════════════════════════════════ */
function formatOddsBlock(homeTeam: string, awayTeam: string, odds: StructuredOdds): string {
  const lines: string[] = ["--- DATA HARGA PASAR (ODDS BANDAR) ---"];
  if (odds.matchWinner.length > 0) {
    lines.push(`\n▪ Match Winner / 1X2 (${homeTeam} | Draw | ${awayTeam}):`);
    for (const o of odds.matchWinner) {
      lines.push(
        `  [${o.bookmaker}]  Home: ${o.home ?? "N/A"} (impl. ${o.impliedProb?.home})` +
        `  |  Draw: ${o.draw ?? "N/A"} (impl. ${o.impliedProb?.draw})` +
        `  |  Away: ${o.away ?? "N/A"} (impl. ${o.impliedProb?.away})`,
      );
    }
  } else {
    lines.push(`\n▪ Match Winner / 1X2: Tidak ada data odds tersedia.`);
  }
  if (odds.overUnder.length > 0) {
    lines.push(`\n▪ Over/Under Goals (Totals):`);
    for (const o of odds.overUnder) {
      lines.push(
        `  [${o.bookmaker}]  Over: ${o.over ?? "N/A"} (impl. ${o.impliedProb?.over})` +
        `  |  Under: ${o.under ?? "N/A"} (impl. ${o.impliedProb?.under})`,
      );
    }
  } else {
    lines.push(`\n▪ Over/Under Goals (Totals): Tidak ada data odds tersedia.`);
  }
  if (odds.btts.length > 0) {
    lines.push(`\n▪ Both Teams to Score (BTTS):`);
    for (const o of odds.btts) {
      lines.push(
        `  [${o.bookmaker}]  Yes: ${o.yes ?? "N/A"} (impl. ${o.impliedProb?.yes})` +
        `  |  No: ${o.no ?? "N/A"} (impl. ${o.impliedProb?.no})`,
      );
    }
  } else {
    lines.push(`\n▪ Both Teams to Score (BTTS): Tidak ada data odds tersedia.`);
  }
  if (odds.other.length > 0) {
    lines.push(`\n▪ Pasaran Lainnya:`);
    for (const o of odds.other) {
      lines.push(
        `  [${o.bookmaker}] ${o.market}: ` +
        `${o.odds_1 != null ? `O1=${o.odds_1}` : ""}` +
        `${o.odds_draw != null ? ` Draw=${o.odds_draw}` : ""}` +
        `${o.odds_2 != null ? ` O2=${o.odds_2}` : ""}`.trim(),
      );
    }
  }
  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   BUILD FULL PROMPT (with Trend + RAG)
   ═══════════════════════════════════════════════════════════════ */
function buildPrompt(
  homeTeam: string,
  awayTeam: string,
  oddsBlock: string,
  trendBlock: string,
  lessonsBlock: string,
  perfBlock: string,
  homeStats: Record<string, unknown>,
  awayStats: Record<string, unknown>,
): string {
  // Helper: format stats (handle multi-season wrapped format)
  const fmt = (stats: Record<string, unknown>, label: string) => {
    const meta = stats._meta as string | undefined;
    if (meta === "COMBINED" || meta === "BASELINE_ONLY") {
      const current = stats.current_season as Record<string, unknown> | string;
      const baseline = stats.baseline_reference as Record<string, unknown>;
      return `MUSIM BERJALAN (${new Date().getFullYear()}): ${JSON.stringify(current)}
MUSIM SEBELUMNYA (${new Date().getFullYear() - 1}): ${JSON.stringify(baseline)}
(Catatan: Data musim berjalan terbatas < 5 pertandingan, gunakan baseline sebagai jangkar)`;
    }
    return JSON.stringify(stats[label] ?? null);
  };

  return `PERTANDINGAN: ${homeTeam} vs ${awayTeam}

${oddsBlock}

${trendBlock}
${lessonsBlock}
${perfBlock}

--- STATISTIK ${homeTeam} (HOME) ---
1. xG (xG, xGA, xGD, GF, GA): ${fmt(homeStats, "stats_xg")}
2. Failed to Score (xFTS, Home/Away %): ${fmt(homeStats, "stats_fts")}
3. BTTS (BTTS %, Home/Away %): ${fmt(homeStats, "stats_btts")}
4. Goal Conceded (Per Match, Home/Away): ${fmt(homeStats, "stats_goals_conceded")}
5. Goal Scored (Per Match, Home/Away): ${fmt(homeStats, "stats_goals_scored")}
6. Shots (Over 10.5 hingga 15.5): ${fmt(homeStats, "stats_shots")}
7. Over 2.5 (% Home/Away): ${fmt(homeStats, "stats_over_25")}
8. Over 3.5 (% Home/Away): ${fmt(homeStats, "stats_over_35")}
9. Under (0.5 hingga 5.5): ${fmt(homeStats, "stats_under")}
10. Team Form (MP, W, D, L, Last 6, PPG): ${fmt(homeStats, "stats_team_form")}
11. HT Win/Loss (Win/Draw/Loss %): ${fmt(homeStats, "stats_ht")}

--- STATISTIK ${awayTeam} (AWAY) ---
1. xG (xG, xGA, xGD, GF, GA): ${fmt(awayStats, "stats_xg")}
2. Failed to Score (xFTS, Home/Away %): ${fmt(awayStats, "stats_fts")}
3. BTTS (BTTS %, Home/Away %): ${fmt(awayStats, "stats_btts")}
4. Goal Conceded (Per Match, Home/Away): ${fmt(awayStats, "stats_goals_conceded")}
5. Goal Scored (Per Match, Home/Away): ${fmt(awayStats, "stats_goals_scored")}
6. Shots (Over 10.5 hingga 15.5): ${fmt(awayStats, "stats_shots")}
7. Over 2.5 (% Home/Away): ${fmt(awayStats, "stats_over_25")}
8. Over 3.5 (% Home/Away): ${fmt(awayStats, "stats_over_35")}
9. Under (0.5 hingga 5.5): ${fmt(awayStats, "stats_under")}
10. Team Form (MP, W, D, L, Last 6, PPG): ${fmt(awayStats, "stats_team_form")}
11. HT Win/Loss (Win/Draw/Loss %): ${fmt(awayStats, "stats_ht")}`;
}

/* ═══════════════════════════════════════════════════════════════
   HELPER
   ═══════════════════════════════════════════════════════════════ */
function hasStats(stats: Record<string, unknown>): boolean {
  // Handle multi-season wrapped format: look inside current_season or baseline_reference
  const meta = stats._meta as string | undefined;
  if (meta === "COMBINED" || meta === "BASELINE_ONLY") {
    const current = stats.current_season as Record<string, unknown> | undefined;
    const baseline = stats.baseline_reference as Record<string, unknown> | undefined;
    return hasStatsObject(current) || hasStatsObject(baseline);
  }
  return hasStatsObject(stats);
}

function hasStatsObject(stats: Record<string, unknown> | undefined): boolean {
  if (!stats) return false;
  return Object.values(stats).some((v) => v !== null && v !== undefined);
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════ */
export interface AnalysisResult {
  fixture_id: string;
  home_team: string;
  away_team: string;
  prediction_text: string;
  created_at: string;
}

export class StatsEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsEmptyError";
  }
}

/* ═══════════════════════════════════════════════════════════════
   MAIN: analyzeFixture
   ═══════════════════════════════════════════════════════════════ */
export async function analyzeFixture(fixtureId: string): Promise<AnalysisResult> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!supabase) throw new Error("Supabase client not initialised");

  /* ── 1. Fetch fixture ── */
  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("*")
    .eq("fixture_id", fixtureId)
    .single();

  if (fixtureError || !fixture) {
    throw new Error(`Fixture not found: ${fixtureError?.message ?? "no data"}`);
  }

  const homeTeam: string = fixture.home_team ?? fixture.home_name ?? fixture.home_team_name ?? fixture.team_home ?? "";
  const awayTeam: string = fixture.away_team ?? fixture.away_name ?? fixture.away_team_name ?? fixture.team_away ?? "";
  const leagueName: string = fixture.league_name ?? fixture.league ?? "";

  if (!homeTeam || !awayTeam) {
    throw new Error("Fixture record is missing home_team or away_team fields");
  }

  /* ── 2. Fetch & parse odds ── */
  const { data: oddsRows } = await supabase
    .from("odds_history")
    .select("bookmaker, market_type, odds_1, odds_2, odds_draw, captured_at")
    .eq("match_id", fixtureId)
    .order("captured_at", { ascending: false })
    .limit(60);

  const structuredOdds = extractStructuredOdds((oddsRows ?? []) as OddsRow[]);
  const oddsBlock = formatOddsBlock(homeTeam, awayTeam, structuredOdds);

  /* ── 3. Fetch odds movement trend + lessons + performance log (parallel) ── */
  // Ekstrak league slug dari fixture untuk RAG filtering
  const leagueSlug = fixture.league_slug ?? fixture.league_name ?? "";
  const [movementRows, lessons, perfLog] = await Promise.all([
    fetchOddsMovementTrend(fixtureId),
    fetchRelevantLessons(homeTeam, awayTeam, leagueSlug),
    fetchPerformanceLog(),
  ]);

  const trendBlock = formatOddsMovementTrend(movementRows);
  const lessonsBlock = formatLessonsBlock(lessons);
  const perfBlock = formatPerformanceBlock(perfLog);

  /* ── 4. Fetch team stats (multi-season: 2026 + 2025) ── */
  const STAT_COLS = "stats_xg, stats_fts, stats_btts, stats_goals_conceded, stats_goals_scored, stats_shots, stats_over_25, stats_over_35, stats_under, stats_team_form, stats_ht, season, matches_played";

  const currentSeason = String(new Date().getFullYear());
  const prevSeason = String(new Date().getFullYear() - 1);

  const fetchStats = async (teamName: string): Promise<Record<string, unknown>> => {
    // 1. Coba exact match musim berjalan
    let { data: current } = await supabase
      .from("team_season_stats")
      .select(STAT_COLS)
      .ilike("team_name", teamName)
      .ilike("season", currentSeason)
      .limit(1)
      .maybeSingle();

    // 2. Coba partial match musim berjalan
    if (!current) {
      const { data: partial } = await supabase
        .from("team_season_stats")
        .select(STAT_COLS)
        .ilike("team_name", `%${teamName.split(" ")[0]}%`)
        .ilike("season", currentSeason)
        .limit(1)
        .maybeSingle();
      current = partial;
    }

    const matchesPlayed = (current?.matches_played as number) ?? 0;

    // 3. Jika musim berjalan < 5 match, ambil baseline 2025
    if (matchesPlayed < 5) {
      const { data: baseline } = await supabase
        .from("team_season_stats")
        .select(STAT_COLS)
        .ilike("team_name", teamName)
        .ilike("season", prevSeason)
        .limit(1)
        .maybeSingle();

      if (baseline && current) {
        // Gabungkan: label current_season + baseline_reference
        return {
          current_season: current,
          baseline_reference: baseline,
          _meta: "COMBINED",
        } as unknown as Record<string, unknown>;
      }
      if (baseline && !current) {
        return {
          current_season: "DATA_UNAVAILABLE",
          baseline_reference: baseline,
          _meta: "BASELINE_ONLY",
        } as unknown as Record<string, unknown>;
      }
    }

    return (current ?? {}) as Record<string, unknown>;
  };

  const [homeStats, awayStats] = await Promise.all([fetchStats(homeTeam), fetchStats(awayTeam)]);

  /* ── Terminal monitoring ── */
  const STAT_KEYS = ["stats_xg","stats_fts","stats_btts","stats_goals_conceded","stats_goals_scored","stats_shots","stats_over_25","stats_over_35","stats_under","stats_team_form","stats_ht"] as const;
  console.log(`\n[AI-ANALYSIS] ════════════════════════════════`);
  console.log(`[AI-ANALYSIS] Fixture: ${homeTeam} vs ${awayTeam} (ID: ${fixtureId})`);
  console.log(`[AI-ANALYSIS] Odds — 1X2: ${structuredOdds.matchWinner.length} | O/U: ${structuredOdds.overUnder.length} | BTTS: ${structuredOdds.btts.length}`);
  console.log(`[AI-ANALYSIS] Odds Trend Snapshots: ${movementRows.length} | RAG Lessons: ${lessons.length}`);
  console.log(`[AI-ANALYSIS] Status JSONB statistik:`);
  for (const key of STAT_KEYS) {
    const label = key.replace("stats_", "").padEnd(18);
    console.log(`  ${label}  Home: ${homeStats[key] != null ? "✓" : "✗"}  |  Away: ${awayStats[key] != null ? "✓" : "✗"}`);
  }

  /* ── Guard: tolak jika statistik kosong ── */
  const homeHasData = hasStats(homeStats);
  const awayHasData = hasStats(awayStats);

  if (!homeHasData && !awayHasData) {
    console.log(`[AI-ANALYSIS] DITOLAK — tidak ada data statistik untuk kedua tim.\n`);
    throw new StatsEmptyError("Data statistik belum lengkap di Supabase. Silakan upload CSV terlebih dahulu.");
  }

  if (!homeHasData || !awayHasData) {
    console.log(`[AI-ANALYSIS] PERINGATAN — data ${!homeHasData ? homeTeam : awayTeam} tidak ditemukan, melanjutkan parsial.`);
  }

  console.log(`[AI-ANALYSIS] Mengirim prompt ke Gemini (gemini-2.0-flash)...\n`);
  logger.info({ fixtureId, homeTeam, awayTeam, trendSnapshots: movementRows.length, ragLessons: lessons.length }, "Calling Gemini for analysis");

  /* ── 5. Load persona dari Supabase → Call Gemini ── */
  const { persona, agentInstructions } = await loadAIConfig();
  const finalPersona = agentInstructions
    ? `${persona}\n\nINSTRUKSI TAMBAHAN:\n${agentInstructions}`
    : persona;
  console.log(`[AI-ANALYSIS] Persona sumber: ${persona === DEFAULT_SYSTEM_INSTRUCTION ? "DEFAULT (fallback)" : "SUPABASE (kustom)"}`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: finalPersona,
  });

  const promptText = buildPrompt(homeTeam, awayTeam, oddsBlock, trendBlock, lessonsBlock, perfBlock, homeStats, awayStats);
  const geminiResult = await model.generateContent(promptText);
  const predictionText = geminiResult.response.text();

  console.log(`[AI-ANALYSIS] Respons Gemini diterima (${predictionText.length} karakter).`);

  /* ── 6. Simpan ke ai_predictions ── */
  const { error: insertError } = await supabase.from("ai_predictions").insert({
    fixture_id: parseInt(fixtureId) || fixtureId,
    prediction_text: predictionText,
    home_team: homeTeam,
    away_team: awayTeam,
    league: leagueName,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    logger.warn({ insertError }, "Failed to save prediction — returning result anyway");
  }

  return {
    fixture_id: fixtureId,
    home_team: homeTeam,
    away_team: awayTeam,
    prediction_text: predictionText,
    created_at: new Date().toISOString(),
  };
}
