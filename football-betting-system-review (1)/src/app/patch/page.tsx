import { readFileSync } from "node:fs";
import path from "node:path";
import { goLiveGates, roadmap } from "@/lib/audit-data";

export const metadata = { title: "Patch & Rencana — Par-Lay Audit" };
export const dynamic = "force-dynamic";

const root = process.cwd();

const modules: Array<{ file: string; target: string; purpose: string }> = [
  { file: "devig.ts", target: "api-server/src/lib/quant/devig.ts", purpose: "Hapus margin bandar (Shin/power/proporsional). Mengganti impliedProb()." },
  { file: "poisson.ts", target: "api-server/src/lib/quant/poisson.ts", purpose: "Matriks skor Dixon-Coles, semua market koheren, garis seperempat, invers pasar → λ." },
  { file: "strength.ts", target: "api-server/src/lib/quant/strength.ts", purpose: "Statistik tim → λ dengan shrinkage Bayesian; batas penyesuaian LLM ±12%." },
  { file: "blend.ts", target: "api-server/src/lib/quant/blend.ts", purpose: "Pooling model×pasar dan fitBlendWeight (pembelajaran terukur)." },
  { file: "kelly.ts", target: "api-server/src/lib/quant/kelly.ts", purpose: "Stake quarter-Kelly sadar ketidakpastian. Mengganti calculateKelly()." },
  { file: "parlay.ts", target: "api-server/src/lib/quant/parlay.ts", purpose: "Parlay: korelasi, skenario pesimis, titik impas bias, margin menumpuk." },
  { file: "evaluation.ts", target: "api-server/src/lib/quant/evaluation.ts", purpose: "CLV, log-loss/Brier vs pasar, kalibrasi, bootstrap, vonis, circuit breaker." },
  { file: "pipeline.ts", target: "api-server/src/lib/quant/pipeline.ts", purpose: "analyzeMatch(): orkestrasi lengkap + gerbang keputusan." },
  { file: "llm-contract.ts", target: "api-server/src/lib/quant/llm-contract.ts", purpose: "PERSONA_V5, classifyResult, prompt pelajaran proses." },
  { file: "index.ts", target: "api-server/src/lib/quant/index.ts", purpose: "Barrel export." },
];

const migration = `-- supabase/migrations/20261201_quant_ledger.sql
-- 1) kolom baru pada ai_predictions
ALTER TABLE ai_predictions
  ADD COLUMN IF NOT EXISTS p_market_fair   double precision,
  ADD COLUMN IF NOT EXISTS p_model_only    double precision,
  ADD COLUMN IF NOT EXISTS p_final         double precision,
  ADD COLUMN IF NOT EXISTS odds_close      double precision,
  ADD COLUMN IF NOT EXISTS close_fair_prob double precision,
  ADD COLUMN IF NOT EXISTS model_version   integer NOT NULL DEFAULT 2;

-- 2) shadow logging: SEMUA market tiap fixture (tanpa bet) — sampel kalibrasi 10-20x lebih cepat
CREATE TABLE IF NOT EXISTS prediction_selections (
  id              bigserial PRIMARY KEY,
  fixture_id      text NOT NULL,
  analysed_at     timestamptz NOT NULL DEFAULT now(),
  model_version   integer NOT NULL DEFAULT 2,
  market_key      text NOT NULL,            -- mis. 'TOT:over:2.5', 'ML:home'
  family          text NOT NULL,
  line            double precision,
  odds            double precision NOT NULL,
  p_final         double precision NOT NULL,
  p_market_fair   double precision,
  p_model_only    double precision,
  odds_close      double precision,
  close_fair_prob double precision,
  outcome         text,                     -- win|half_win|push|half_loss|loss|void
  was_bet         boolean NOT NULL DEFAULT false,
  UNIQUE (fixture_id, model_version, market_key)
);
CREATE INDEX IF NOT EXISTS prediction_selections_fixture_idx ON prediction_selections (fixture_id);

-- 3) identitas tim kanonik (hentikan fuzzy-name & skip diam-diam)
CREATE TABLE IF NOT EXISTS teams (
  id          bigserial PRIMARY KEY,
  league_slug text NOT NULL,
  canonical   text NOT NULL,
  UNIQUE (league_slug, canonical)
);
CREATE TABLE IF NOT EXISTS team_aliases (
  alias       text NOT NULL,
  provider    text NOT NULL,
  team_id     bigint NOT NULL REFERENCES teams(id),
  PRIMARY KEY (provider, alias)
);`;

const integration = `// services/ai-analysis.ts — di dalam analyzeFixture(), setelah gerbang stats/odds lolos
import { analyzeMatch, sanitizeLlmAdjustment, PERSONA_V5 } from "../lib/quant";

// 1) (opsional) LLM hanya sebagai ekstraktor berita berbukti
const news = await generateAIResponse(apiKey, PERSONA_V5, newsContextForFixture);
const adjustment = sanitizeLlmAdjustment(extractJsonObjects(news.text)[0]);   // tanpa bukti => 1.00

// 2) mesin probabilitas deterministik (menggantikan probability dari LLM)
const analysis = analyzeMatch({
  odds1x2, totals, btts, ah,            // dari extractStructuredOdds(oddsRows)
  league: { homeGoals: lg.homeAvg, awayGoals: lg.awayAvg },
  home: toTeamRates(homeStats), away: toTeamRates(awayStats),
  adjustment,
});

// 3) shadow-log SEMUA selection; bet hanya bila analysis.decision === "BET"
await supabase.from("prediction_selections").upsert(
  analysis.selections.map((s) => ({
    fixture_id: fixtureId, market_key: s.key, family: s.family, line: s.line,
    odds: s.odds, p_final: s.pFinal, p_market_fair: s.pMarket, p_model_only: s.pModelOnly,
    was_bet: analysis.best?.key === s.key,
  })),
  { onConflict: "fixture_id,model_version,market_key" },
);

// 4) stake: kalikan dengan stakingMode(clvTerakhir).stakeMultiplier`;

function readModule(file: string): string {
  try {
    return readFileSync(path.join(root, "src", "lib", "quant", file), "utf8");
  } catch {
    return "// file tidak ditemukan di runtime";
  }
}

function Code({ children, label }: { children: string; label: string }) {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-950">
      <summary className="cursor-pointer select-none px-4 py-2 text-sm text-slate-300 hover:text-white">{label}</summary>
      <pre className="max-h-[32rem] overflow-auto border-t border-slate-800 p-4 text-xs leading-relaxed text-slate-300">
        <code>{children}</code>
      </pre>
    </details>
  );
}

export default function PatchPage() {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-bold text-white">Patch & rencana implementasi</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Modul di bawah murni TypeScript tanpa dependensi, sehingga bisa disalin langsung ke{" "}
          <code>Parlay-Analyzer-System/artifacts/api-server/src/lib/quant/</code>. Semuanya sudah lolos uji sanity
          (jumlah probabilitas = 1, round-trip fitting pasar, settlement garis seperempat, perilaku winner&apos;s curse).
          Saya tidak memiliki akses tulis ke repo GitHub Anda, jadi patch disediakan di sini dan lewat endpoint{" "}
          <code>POST /api/quant/analyze</code>.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-white">Rencana bertahap</h2>
        <ol className="mt-4 space-y-4">
          {roadmap.map((r) => (
            <li key={r.phase} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">{r.phase}</span>
                <h3 className="font-semibold text-slate-100">{r.title}</h3>
                <span className="text-xs text-slate-500">{r.when}</span>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {r.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-emerald-300/80">Selesai bila: {r.exit}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
          <h3 className="font-semibold text-amber-200">Gerbang “boleh menaikkan risiko”</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
            {goLiveGates.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white">Cara memasang di analyzeFixture()</h2>
        <div className="mt-3">
          <Code label="Contoh integrasi (services/ai-analysis.ts)">{integration}</Code>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white">Migrasi SQL (Supabase)</h2>
        <div className="mt-3">
          <Code label="20261201_quant_ledger.sql">{migration}</Code>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white">Modul siap salin ({modules.length} file)</h2>
        <div className="mt-3 space-y-3">
          {modules.map((m) => (
            <div key={m.file}>
              <p className="mb-1 text-sm text-slate-400">
                <span className="font-mono text-emerald-300">{m.target}</span> — {m.purpose}
              </p>
              <Code label={`Lihat kode ${m.file}`}>{readModule(m.file)}</Code>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Uji: <code>npx tsx scripts/quant-sanity.ts</code> (29 pemeriksaan).
        </p>
      </section>
    </div>
  );
}
