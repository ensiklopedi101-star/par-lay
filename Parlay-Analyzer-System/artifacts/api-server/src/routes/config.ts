import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { isSyncRunning } from "../services/odds-fetcher";

export const LEAGUES_CATALOG = [
  { slug: "england-premier-league",      name: "Premier League",         country: "Inggris" },
  { slug: "england-championship",         name: "Championship",           country: "Inggris" },
  { slug: "spain-laliga",                 name: "La Liga",                country: "Spanyol" },
  { slug: "france-ligue-1",              name: "Ligue 1",                country: "Prancis" },
  { slug: "italy-serie-a",               name: "Serie A",                country: "Italia" },
  { slug: "netherlands-eredivisie",       name: "Eredivisie",             country: "Belanda" },
  { slug: "germany-bundesliga",           name: "Bundesliga",             country: "Jerman" },
  { slug: "uefa-champions-league",        name: "UEFA Champions League",  country: "UEFA" },
  { slug: "uefa-europa-league",           name: "UEFA Europa League",     country: "UEFA" },
  { slug: "fifa-world-cup",              name: "FIFA World Cup",         country: "FIFA" },
  { slug: "republic-of-korea-k-league-1","name": "K-League 1",           country: "Korea" },
  { slug: "china-chinese-super-league",  name: "Chinese Super League",   country: "China" },
  { slug: "japan-j1-league",             name: "J1 League",              country: "Jepang" },
];

export const MARKETS_CATALOG = [
  { key: "ML",     label: "1X2 / Match Result",              description: "Full time match winner (Home/Draw/Away)" },
  { key: "AH",     label: "Alternate Spread",                description: "Asian Handicap — alternative line spreads" },
  { key: "Totals", label: "Alternate Totals",                description: "Over/Under — alternative total goals lines" },
  { key: "HT",     label: "Half Time Result",                description: "Half time score / 1X2 at half time" },
  { key: "BTTS",   label: "Both Teams To Score (BTTS)",      description: "Yes / No — both teams score at least one goal" },
];

const router: IRouter = Router();

async function getOrCreateConfig() {
  const { data, error } = await supabase
    .from("scheduler_config")
    .select("*")
    .limit(1);

  if (error) {
    logger.error({ error }, "Failed to fetch config");
    throw error;
  }

  if (data && data.length > 0) return data[0]!;

  // Create default config
  const { data: created, error: insertErr } = await supabase
    .from("scheduler_config")
    .insert({
      leagues: ["serie-a"],
      bookmakers: ["Bet365", "Sbobet"],
      markets: ["ML", "Totals", "BTTS", "Asian Handicap"],
      cron_expression: "0 */3 * * *",
    })
    .select()
    .single();

  if (insertErr) {
    logger.error({ error: insertErr }, "Failed to create default config");
    throw insertErr;
  }

  return created!;
}

router.get("/catalog", (_req, res) => {
  res.json({ leagues: LEAGUES_CATALOG, markets: MARKETS_CATALOG });
});

router.get("/config", async (_req, res) => {
  try {
    const cfg = await getOrCreateConfig();
    res.json({
      id: cfg.id,
      leagues: cfg.leagues,
      bookmakers: cfg.bookmakers,
      markets: cfg.markets,
      cronExpression: cfg.cron_expression,
      aiPersona: cfg.ai_persona ?? null,
      agentInstructions: cfg.agent_instructions ?? null,
      updatedAt: cfg.updated_at ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get config");
    res.status(500).json({ error: "Failed to get config" });
  }
});

router.post("/config", async (req, res) => {
  try {
    const { leagues, bookmakers, markets, cronExpression, aiPersona, agentInstructions } = req.body;
    const { data: existing } = await supabase
      .from("scheduler_config")
      .select("id")
      .limit(1);

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (leagues !== undefined) updatePayload.leagues = leagues;
    if (bookmakers !== undefined) updatePayload.bookmakers = bookmakers;
    if (markets !== undefined) updatePayload.markets = markets;
    if (cronExpression !== undefined) updatePayload.cron_expression = cronExpression;
    if (aiPersona !== undefined) updatePayload.ai_persona = aiPersona;
    if (agentInstructions !== undefined) updatePayload.agent_instructions = agentInstructions;

    let cfg;
    if (existing && existing.length > 0) {
      const { data: updated, error } = await supabase
        .from("scheduler_config")
        .update(updatePayload)
        .eq("id", existing[0]!.id)
        .select()
        .single();
      if (error) throw error;
      cfg = updated!;
    } else {
      const { data: created, error } = await supabase
        .from("scheduler_config")
        .insert({
          leagues,
          bookmakers,
          markets,
          cron_expression: cronExpression,
          ai_persona: aiPersona ?? null,
          agent_instructions: agentInstructions ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      cfg = created!;
    }

    res.json({
      id: cfg.id,
      leagues: cfg.leagues,
      bookmakers: cfg.bookmakers,
      markets: cfg.markets,
      cronExpression: cfg.cron_expression,
      aiPersona: cfg.ai_persona ?? null,
      agentInstructions: cfg.agent_instructions ?? null,
      updatedAt: cfg.updated_at ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to save config");
    res.status(500).json({ error: "Failed to save config" });
  }
});

router.post("/sync/settle", async (_req, res) => {
  try {
    const { runSettlement } = await import("../services/settlement");
    const result = await runSettlement();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Settlement trigger failed");
    res.status(500).json({ error: "Settlement failed" });
  }
});

router.get("/sync/status", async (_req, res) => {
  try {
    const { count: totalCount, error: countErr } = await supabase
      .from("fixtures")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      logger.error({ error: countErr }, "Failed to count fixtures");
    }

    const { data: leagueRows, error: leagueErr } = await supabase
      .from("fixtures")
      .select("league_name");

    if (leagueErr) {
      logger.error({ error: leagueErr }, "Failed to fetch league breakdown");
    }

    const leagueMap = new Map<string, number>();
    for (const row of leagueRows ?? []) {
      leagueMap.set(row.league_name, (leagueMap.get(row.league_name) ?? 0) + 1);
    }

    const { data: lastSync, error: lastSyncErr } = await supabase
      .from("fixtures")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (lastSyncErr) {
      logger.error({ error: lastSyncErr }, "Failed to fetch last sync");
    }

    res.json({
      totalEvents: totalCount ?? 0,
      lastSyncAt: lastSync?.updated_at ?? null,
      isRunning: isSyncRunning(),
      leagueBreakdown: Array.from(leagueMap.entries()).map(([leagueSlug, eventCount]) => ({
        leagueSlug,
        eventCount,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Failed to get sync status");
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

export default router;
