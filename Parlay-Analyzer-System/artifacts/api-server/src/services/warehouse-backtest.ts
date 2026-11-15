/**
 * Backtest gudang riset: model Poisson vs pasar di ±16 ribu
 * pertandingan historis (research_matches), plus uji fitur Elo.
 *
 * Baca-saja dan ter-cache 30 menit. Sampel latih = kick-off sebelum
 * 2024-08-01; validasi = sejak itu. Kekuatan Elo (k) dipilih di
 * latih dan dihakimi di validasi melawan model tanpa Elo — adopsi
 * hanya direkomendasikan bila mengalahkan model dasar di validasi
 * DAN skill validasinya positif (pola anti-overfitting yang sama
 * seperti eksperimen parameter).
 */
import { supabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { collectPagedRows } from "./odds-history";
import {
  buildHtSamples,
  buildModelBacktest,
  prepareWarehouseSamples,
  simulateTicketStrategies,
  summarizeWarehouse,
  type TicketStrategyResult,
  type WarehouseMatch,
  type WarehouseMetricSummary,
} from "../lib/warehouse-backtest";
import { buildHtExperiment, type HtExperimentResult } from "../lib/quant/ht-model";
import { asianHandicapVsMarket, type PairedMetric } from "../lib/model-backtest";

const VALIDATION_FROM = "2024-08-01";
const ELO_GRID = [0, 0.25, 0.5, 0.75, 1, 1.5];
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface WarehouseBacktestResult {
  generatedAt: string;
  matchesInWarehouse: number;
  considered: number;
  skippedNoPrior: number;
  skippedNoMarket: number;
  prior: {
    full: WarehouseMetricSummary;
    validation: WarehouseMetricSummary;
    ahFull: PairedMetric | null;
    calibrationEce: number | null;
    verdict: string;
  };
  elo: {
    grid: Array<{ k: number; trainSkill: number | null }>;
    bestK: number | null;
    validation: WarehouseMetricSummary | null;
    adoptionJustified: boolean;
    note: string;
  };
  /** Simulasi tiket mingguan 5–8 leg: pasar-dulu vs model-dulu vs filter. */
  ticketStrategies: TicketStrategyResult[];
  /** Model babak pertama vs patokan rata-rata liga (tanpa odds HT historis). */
  ht: {
    full: HtExperimentResult | null;
    validation: HtExperimentResult | null;
    note: string;
  };
}

let cached: { at: number; value: WarehouseBacktestResult } | null = null;

export async function getWarehouseBacktest(force = false): Promise<WarehouseBacktestResult> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (!supabase) throw new Error("Supabase client not initialised");

  const today = new Date().toISOString().slice(0, 10);
  const rows = await collectPagedRows<WarehouseMatch>(async (from, to) => {
    const { data, error } = await supabase!
      .from("research_matches")
      .select("league_slug, match_date, home_team, away_team, home_elo, away_elo, ft_home, ft_away, ht_home, ht_away, odd_home, odd_draw, odd_away, over25, under25, handi_size, handi_home, handi_away, max_home, max_draw, max_away, form5_home, form5_away")
      .lt("match_date", today)
      .not("ft_home", "is", null)
      .order("match_date", { ascending: true })
      .range(from, to);
    return { data: (data ?? []) as unknown as WarehouseMatch[], error };
  });

  const preparation = prepareWarehouseSamples(rows);
  const { samples } = preparation;
  const trainSamples = samples.filter((s) => (s.kickoff ?? "") < VALIDATION_FROM);
  const validationSamples = samples.filter((s) => (s.kickoff ?? "") >= VALIDATION_FROM);

  const fullReport = buildModelBacktest(samples);
  const validationReport = buildModelBacktest(validationSamples);

  const eloTrain = ELO_GRID.map((k) => ({
    k,
    trainSkill: buildModelBacktest(
      preparation.eloSamples(k).filter((s) => (s.kickoff ?? "") < VALIDATION_FROM),
    ).oneX2.vsMarket?.skill ?? null,
  }));
  let bestK: number | null = null;
  let bestTrainSkill = Number.NEGATIVE_INFINITY;
  for (const entry of eloTrain) {
    if (entry.trainSkill != null && entry.trainSkill > bestTrainSkill) {
      bestTrainSkill = entry.trainSkill;
      bestK = entry.k;
    }
  }
  const eloValidation = bestK != null
    ? summarizeWarehouse(buildModelBacktest(
      preparation.eloSamples(bestK).filter((s) => (s.kickoff ?? "") >= VALIDATION_FROM),
    ))
    : null;

  const priorValidation = summarizeWarehouse(validationReport);
  const adoptionJustified = Boolean(
    bestK != null && bestK > 0
    && eloValidation?.vsMarket
    && priorValidation.vsMarket
    && eloValidation.vsMarket.skill > priorValidation.vsMarket.skill
    && eloValidation.vsMarket.skill > 0,
  );
  let eloNote: string;
  if (bestK == null) {
    eloNote = "Pasar historis tidak tersedia di data latih — fitur Elo tidak bisa dinilai.";
  } else if (bestK === 0) {
    eloNote = "Kekuatan Elo terbaik di data latih adalah 0: Elo tidak menambah akurasi di atas laju gol musim sebelumnya pada gudang ini.";
  } else if (adoptionJustified) {
    eloNote = `Elo k=${bestK} mengalahkan model dasar di validasi (skill ${(eloValidation!.vsMarket!.skill * 100).toFixed(2)}% vs ${(priorValidation.vsMarket!.skill * 100).toFixed(2)}%) — layak diadopsi ke jalur live lewat PR tersendiri.`;
  } else {
    eloNote = `Elo terbaik di latih (k=${bestK}) tidak mengalahkan model dasar di validasi — adopsi ditolak agar tidak overfitting.`;
  }

  const vsMarket = fullReport.oneX2.vsMarket;
  const value: WarehouseBacktestResult = {
    generatedAt: new Date().toISOString(),
    matchesInWarehouse: rows.length,
    considered: preparation.considered,
    skippedNoPrior: preparation.skippedNoPrior,
    skippedNoMarket: preparation.skippedNoMarket,
    prior: {
      full: summarizeWarehouse(fullReport),
      validation: priorValidation,
      ahFull: asianHandicapVsMarket(samples),
      calibrationEce: fullReport.calibrationEce,
      verdict: vsMarket
        ? `Model inti Poisson (prior musim sebelumnya, tanpa xG) pada ${fullReport.samples} pertandingan historis: skill ${(vsMarket.skill * 100).toFixed(2)}% (t=${vsMarket.tStat?.toFixed(2) ?? "—"}, n=${vsMarket.n}).`
        : "Pasar historis tidak tersedia.",
    },
    elo: {
      grid: eloTrain,
      bestK,
      validation: eloValidation,
      adoptionJustified,
      note: eloNote,
    },
    ticketStrategies: simulateTicketStrategies(preparation.preparedRows),
    ht: (() => {
      const allSamples = buildHtSamples(preparation.preparedRows);
      const validationSamples = buildHtSamples(
        preparation.preparedRows.filter((r) => r.match.match_date >= VALIDATION_FROM),
      );
      const full = buildHtExperiment(allSamples);
      const validation = buildHtExperiment(validationSamples);
      const note = validation && validation.htResult.skill > 0
        ? `Arah hasil HT sedikit informatif di validasi (skill ${(validation.htResult.skill * 100).toFixed(2)}%), tetapi pasar gol HT (Over 0.5/BTTS) tidak mengalahkan rata-rata liga — dan tanpa odds HT historis, nilai melawan bandar belum bisa diklaim. HT belum layak dijadikan andalan leg; probabilitas HT hanya layak tampil sebagai informasi.`
        : "Model HT belum mengalahkan patokan rata-rata liga secara meyakinkan — pasar HT belum layak dijadikan andalan leg.";
      return { full, validation, note };
    })(),
  };
  cached = { at: Date.now(), value };
  logger.info(
    { matches: rows.length, samples: samples.length, skippedNoPrior: preparation.skippedNoPrior },
    "[WAREHOUSE-BACKTEST] laporan dibuat",
  );
  return value;
}
