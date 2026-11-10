"use client";

import { useMemo, useState } from "react";
import {
  analyzeMatch,
  analyzeParlay,
  type DevigMethod,
  type MatchAnalysis,
  type MatchInput,
  type ParlayLeg,
  type SelectionEval,
} from "@/lib/quant";

const DEFAULTS = {
  league: "Premier League",
  home: "Tim Kandang",
  away: "Tim Tamu",
  h1: "1.95",
  hx: "3.60",
  h2: "4.00",
  ouLine: "2.5",
  over: "1.90",
  under: "1.95",
  bttsYes: "1.80",
  bttsNo: "2.00",
  ahLine: "-0.5",
  ahHome: "1.95",
  ahAway: "1.90",
  lgHome: "1.5",
  lgAway: "1.2",
  hMP: "12",
  hGF: "1.9",
  hGA: "1.0",
  hXGF: "1.8",
  hXGA: "1.1",
  aMP: "12",
  aGF: "1.2",
  aGA: "1.5",
  aXGF: "1.3",
  aXGA: "1.4",
  method: "shin",
  rho: "-0.10",
  weightMode: "auto",
  weight: "0.25",
  minEv: "3",
  kelly: "0.25",
  cap: "2",
};
type FormState = typeof DEFAULTS;

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

function Field({
  label,
  value,
  onChange,
  hint,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="text-xs text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
      />
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

interface PLeg extends ParlayLeg {
  label: string;
}

export function LabClient() {
  const [f, setF] = useState<FormState>(DEFAULTS);
  const set = (k: keyof FormState) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const n = (k: keyof FormState) => Number(f[k]);

  const [legs, setLegs] = useState<PLeg[]>([]);
  const [sigma, setSigma] = useState("0.03");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { analysis, error } = useMemo<{ analysis: MatchAnalysis | null; error: string | null }>(() => {
    try {
      const o1 = [n("h1"), n("hx"), n("h2")];
      if (o1.some((o) => !(o > 1))) throw new Error("Odds 1X2 harus angka > 1.00");
      const input: MatchInput = {
        odds1x2: { home: o1[0]!, draw: o1[1]!, away: o1[2]! },
        totals: n("over") > 1 && n("under") > 1 && Number.isFinite(n("ouLine")) ? [{ line: n("ouLine"), overOdds: n("over"), underOdds: n("under") }] : [],
        btts: n("bttsYes") > 1 && n("bttsNo") > 1 ? { yes: n("bttsYes"), no: n("bttsNo") } : null,
        ah: n("ahHome") > 1 && n("ahAway") > 1 && Number.isFinite(n("ahLine")) ? [{ line: n("ahLine"), homeOdds: n("ahHome"), awayOdds: n("ahAway") }] : [],
        league: { homeGoals: n("lgHome"), awayGoals: n("lgAway") },
        home: { matches: n("hMP"), goalsFor: n("hGF"), goalsAgainst: n("hGA"), xgFor: f.hXGF ? n("hXGF") : null, xgAgainst: f.hXGA ? n("hXGA") : null },
        away: { matches: n("aMP"), goalsFor: n("aGF"), goalsAgainst: n("aGA"), xgFor: f.aXGF ? n("aXGF") : null, xgAgainst: f.aXGA ? n("aXGA") : null },
        rho: n("rho"),
        devigMethod: f.method as DevigMethod,
        modelWeight: f.weightMode === "auto" ? null : n("weight"),
        minEv: n("minEv") / 100,
        kellyFraction: n("kelly"),
        maxStakePct: n("cap"),
      };
      if ([input.league.homeGoals, input.league.awayGoals, input.home.matches, input.away.matches].some((v) => !Number.isFinite(v) || v <= 0)) {
        throw new Error("Rata-rata liga dan jumlah laga harus > 0");
      }
      return { analysis: analyzeMatch(input), error: null };
    } catch (e) {
      return { analysis: null, error: e instanceof Error ? e.message : "Input tidak valid" };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const parlay = useMemo(() => {
    if (legs.length < 1) return null;
    try {
      return analyzeParlay(legs, { sigma: Number(sigma) || 0.03 });
    } catch {
      return null;
    }
  }, [legs, sigma]);

  const addLeg = (s: SelectionEval) => {
    setLegs((prev) => [
      ...prev.filter((l) => l.label !== `${f.home} v ${f.away} — ${s.label}`),
      {
        label: `${f.home} v ${f.away} — ${s.label}`,
        p: s.pFinal,
        odds: s.odds,
        pMarket: s.pMarket,
        league: f.league,
        marketFamily: s.family,
      },
    ]);
  };

  const saveToLedger = async (s: SelectionEval) => {
    setSaveMsg(null);
    const res = await fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        league: f.league,
        homeTeam: f.home,
        awayTeam: f.away,
        marketFamily: s.family,
        selection: s.label,
        line: s.line,
        oddsTaken: s.odds,
        pModel: s.pModelOnly,
        pMarketFair: s.pMarket,
        pFinal: s.pFinal,
        stakeUnits: 1,
      }),
    });
    setSaveMsg(res.ok ? `Tersimpan ke Ledger: ${s.label}` : "Gagal menyimpan ke Ledger");
  };

  const sorted = analysis ? analysis.selections.slice().sort((a, b) => b.evConservative - a.evConservative) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* ───────── INPUT ───────── */}
      <div className="space-y-4">
        <Card title="Pertandingan">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block">
              <span className="text-xs text-slate-400">Liga</span>
              <input value={f.league} onChange={(e) => set("league")(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Home</span>
              <input value={f.home} onChange={(e) => set("home")(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Away</span>
              <input value={f.away} onChange={(e) => set("away")(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500" />
            </label>
          </div>
        </Card>

        <Card title="Odds bandar (desimal)">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Home" value={f.h1} onChange={set("h1")} />
            <Field label="Draw" value={f.hx} onChange={set("hx")} />
            <Field label="Away" value={f.h2} onChange={set("h2")} />
            <Field label="Garis O/U" value={f.ouLine} onChange={set("ouLine")} />
            <Field label="Over" value={f.over} onChange={set("over")} />
            <Field label="Under" value={f.under} onChange={set("under")} />
            <Field label="BTTS Yes" value={f.bttsYes} onChange={set("bttsYes")} />
            <Field label="BTTS No" value={f.bttsNo} onChange={set("bttsNo")} />
            <span />
            <Field label="AH garis Home" value={f.ahLine} onChange={set("ahLine")} />
            <Field label="AH Home" value={f.ahHome} onChange={set("ahHome")} />
            <Field label="AH Away" value={f.ahAway} onChange={set("ahAway")} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Kosongkan odds O/U, BTTS, atau AH untuk melewati market tersebut. Odds O/U sangat disarankan agar total gol terkunci ke pasar.</p>
        </Card>

        <Card title="Statistik (per laga, musim berjalan)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rata-rata gol home liga" value={f.lgHome} onChange={set("lgHome")} />
            <Field label="Rata-rata gol away liga" value={f.lgAway} onChange={set("lgAway")} />
          </div>
          <h3 className="mb-2 mt-4 text-xs font-semibold text-emerald-300">{f.home || "Home"}</h3>
          <div className="grid grid-cols-5 gap-2">
            <Field label="MP" value={f.hMP} onChange={set("hMP")} />
            <Field label="GF" value={f.hGF} onChange={set("hGF")} />
            <Field label="GA" value={f.hGA} onChange={set("hGA")} />
            <Field label="xG" value={f.hXGF} onChange={set("hXGF")} />
            <Field label="xGA" value={f.hXGA} onChange={set("hXGA")} />
          </div>
          <h3 className="mb-2 mt-4 text-xs font-semibold text-emerald-300">{f.away || "Away"}</h3>
          <div className="grid grid-cols-5 gap-2">
            <Field label="MP" value={f.aMP} onChange={set("aMP")} />
            <Field label="GF" value={f.aGF} onChange={set("aGF")} />
            <Field label="GA" value={f.aGA} onChange={set("aGA")} />
            <Field label="xG" value={f.aXGF} onChange={set("aXGF")} />
            <Field label="xGA" value={f.aXGA} onChange={set("aXGA")} />
          </div>
        </Card>

        <Card title="Pengaturan model">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Metode de-vig</span>
              <select value={f.method} onChange={(e) => set("method")(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                <option value="shin">Shin (disarankan)</option>
                <option value="power">Power</option>
                <option value="proportional">Proporsional</option>
              </select>
            </label>
            <Field label="ρ Dixon-Coles" value={f.rho} onChange={set("rho")} hint="−0.05 … −0.15" />
            <label className="block">
              <span className="text-xs text-slate-400">Bobot model vs pasar</span>
              <select value={f.weightMode} onChange={(e) => set("weightMode")(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                <option value="auto">Otomatis (maks 0.30 × reliabilitas)</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <Field label="w manual (0–1)" value={f.weight} onChange={set("weight")} hint="0 = murni pasar" />
            <Field label="EV minimum (%)" value={f.minEv} onChange={set("minEv")} />
            <Field label="Fraksi Kelly" value={f.kelly} onChange={set("kelly")} />
            <Field label="Cap stake (% bankroll)" value={f.cap} onChange={set("cap")} />
          </div>
        </Card>
      </div>

      {/* ───────── OUTPUT ───────── */}
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{error}</div>}

        {analysis && (
          <>
            <div
              className={`rounded-xl border p-5 ${
                analysis.decision === "BET" ? "border-emerald-700 bg-emerald-950/30" : "border-slate-700 bg-slate-900/60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-md px-3 py-1 text-sm font-bold ${analysis.decision === "BET" ? "bg-emerald-400 text-slate-950" : "bg-slate-700 text-slate-100"}`}>
                  {analysis.decision === "BET" ? "BET" : "NO BET"}
                </span>
                {analysis.best ? (
                  <p className="text-sm text-slate-200">
                    <b>{analysis.best.label}</b> @ {analysis.best.odds.toFixed(2)} — p akhir {pct(analysis.best.pFinal)} vs pasar {pct(analysis.best.pMarket)} · EV {signed(analysis.best.ev)} · EV konservatif {signed(analysis.best.evConservative)} · stake{" "}
                    <b>{analysis.best.stakePct.toFixed(2)}%</b> · jangan bet di bawah odds <b>{analysis.best.minOdds.toFixed(2)}</b>
                  </p>
                ) : (
                  <p className="text-sm text-slate-300">Tidak ada market yang lolos EV minimum dan EV konservatif. Ini hasil normal pada pasar yang efisien.</p>
                )}
              </div>
              {analysis.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-amber-300">
                  {analysis.warnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="De-vig 1X2">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr><th className="text-left font-medium">Hasil</th><th className="text-right font-medium">1/odds (lama)</th><th className="text-right font-medium">Fair ({analysis.devig1x2.usedMethod})</th></tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {([["Home", n("h1"), analysis.devig1x2.probs.home], ["Draw", n("hx"), analysis.devig1x2.probs.draw], ["Away", n("h2"), analysis.devig1x2.probs.away]] as const).map(([l, o, p]) => (
                      <tr key={l} className="border-t border-slate-800">
                        <td className="py-1">{l}</td>
                        <td className="text-right text-slate-400">{pct(1 / o)}</td>
                        <td className="text-right text-emerald-300">{pct(p)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-700 text-xs text-slate-400">
                      <td className="py-1">Jumlah</td>
                      <td className="text-right text-amber-300">{pct(1 / n("h1") + 1 / n("hx") + 1 / n("h2"))}</td>
                      <td className="text-right">100.0%</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">Margin bandar (overround): {pct(analysis.devig1x2.overround, 2)}. Kolom “lama” adalah yang dipakai sistem sekarang.</p>
              </Card>

              <Card title="λ gol (ekspektasi)">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-xs text-slate-500">
                    <tr><th className="text-left font-medium"></th><th className="text-right font-medium">Home</th><th className="text-right font-medium">Away</th></tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-800"><td className="py-1">Pasar (invers harga)</td><td className="text-right">{analysis.marketLambdas.lambdaHome.toFixed(2)}</td><td className="text-right">{analysis.marketLambdas.lambdaAway.toFixed(2)}</td></tr>
                    <tr className="border-t border-slate-800"><td className="py-1">Model statistik</td><td className="text-right">{analysis.modelLambdas.lambdaHome.toFixed(2)}</td><td className="text-right">{analysis.modelLambdas.lambdaAway.toFixed(2)}</td></tr>
                    <tr className="border-t border-slate-700 text-emerald-300"><td className="py-1">Akhir (blend)</td><td className="text-right">{analysis.finalLambdas.lambdaHome.toFixed(2)}</td><td className="text-right">{analysis.finalLambdas.lambdaAway.toFixed(2)}</td></tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  Bobot model w = {analysis.modelWeight.toFixed(2)} · reliabilitas data {pct(analysis.modelLambdas.reliability, 0)} · galat fit pasar {analysis.marketLambdas.fitError.toExponential(1)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Skor teratas: {analysis.topScores.map((s) => `${s.score} (${pct(s.p)})`).join(" · ")}
                </p>
              </Card>
            </div>

            <Card title="Semua market (diurutkan EV konservatif)">
              {saveMsg && <p className="mb-2 text-xs text-emerald-300">{saveMsg}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm tabular-nums">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="text-left font-medium">Market</th>
                      <th className="text-right font-medium">Odds</th>
                      <th className="text-right font-medium">P pasar</th>
                      <th className="text-right font-medium">P model</th>
                      <th className="text-right font-medium">P akhir</th>
                      <th className="text-right font-medium">EV</th>
                      <th className="text-right font-medium">EV kons.</th>
                      <th className="text-right font-medium">Stake</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.key} className="border-t border-slate-800 align-top">
                        <td className="py-1.5">
                          <div className={s.passes ? "font-semibold text-emerald-300" : "text-slate-200"}>{s.label}</div>
                          {!s.passes && <div className="max-w-[14rem] text-[10px] text-slate-500">{s.rejectReasons[0]}</div>}
                        </td>
                        <td className="text-right">{s.odds.toFixed(2)}</td>
                        <td className="text-right text-slate-400">{pct(s.pMarket)}</td>
                        <td className="text-right text-slate-400">{pct(s.pModelOnly)}</td>
                        <td className="text-right">{pct(s.pFinal)}</td>
                        <td className={`text-right ${s.ev > 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(s.ev)}</td>
                        <td className={`text-right ${s.evConservative > 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(s.evConservative)}</td>
                        <td className="text-right">{s.stakePct > 0 ? `${s.stakePct.toFixed(2)}%` : "—"}</td>
                        <td className="whitespace-nowrap pl-2 text-right">
                          <button onClick={() => addLeg(s)} className="rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:bg-slate-800">+ parlay</button>{" "}
                          <button onClick={() => saveToLedger(s)} className="rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:bg-slate-800">Ledger</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                EV kons. = EV − σ·odds (σ = {pct(analysis.selections[0]?.sigma, 1)} berdasarkan jumlah data). Tombol “+ parlay” boleh dipakai pada market apa pun untuk melihat bagaimana parlay menumpuk error — bukan berarti layak.
              </p>
            </Card>
          </>
        )}

        <Card title="Analisis parlay">
          {legs.length === 0 ? (
            <p className="text-sm text-slate-400">Tambahkan leg dari tabel market di atas (ubah pertandingan, lalu tambahkan lagi). Maksimum yang bermakna: 3–4 leg.</p>
          ) : (
            <div className="space-y-4">
              <ul className="divide-y divide-slate-800 text-sm">
                {legs.map((l) => (
                  <li key={l.label} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate">{l.label}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">p {pct(l.p)} · odds {l.odds.toFixed(2)}</span>
                    <button onClick={() => setLegs((p) => p.filter((x) => x.label !== l.label))} className="text-xs text-red-300 hover:underline">hapus</button>
                  </li>
                ))}
              </ul>
              <div className="flex items-end gap-3">
                <Field label="σ per leg (skenario pesimis)" value={sigma} onChange={setSigma} />
                <button onClick={() => setLegs([])} className="mb-0.5 rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">Kosongkan</button>
              </div>
              {parlay && (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ["Odds gabungan", parlay.combinedOdds.toFixed(2)],
                    ["P menang (independen)", pct(parlay.pIndependent, 2)],
                    ["P menang (berkorelasi, simulasi)", `${pct(parlay.pCorrelated, 2)} ±${pct(parlay.simStdErr * 1.96, 2)}`],
                    ["EV keputusan (nilai terkecil)", signed(parlay.evDecision)],
                    ["EV skenario pesimis (p − σ per leg)", signed(parlay.evPessimistic)],
                    ["Margin bandar yang dibayar", parlay.marginPaid == null ? "—" : pct(parlay.marginPaid, 1)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <div className="text-xs text-slate-500">{k}</div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{v}</div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 sm:col-span-2">
                    <div className="text-xs text-slate-500">Titik impas bias</div>
                    <div className="mt-0.5 text-slate-200">
                      {parlay.breakEvenBias < 0
                        ? "EV parlay sudah negatif bahkan jika semua probabilitas benar."
                        : `Jika SETIAP leg ternyata dioverestimasi ≥ ${(parlay.breakEvenBias * 100).toFixed(1)} poin persen, EV parlay menjadi nol. Bandingkan dengan galat wajar model (±3–5 poin).`}
                    </div>
                    <div className={`mt-2 text-sm font-semibold ${parlay.evPessimistic > 0 && parlay.evDecision > 0 ? "text-emerald-300" : "text-amber-300"}`}>
                      {parlay.evPessimistic > 0 && parlay.evDecision > 0
                        ? "Lolos: EV positif bahkan di skenario pesimis."
                        : "Tidak lolos gerbang: EV tidak bertahan di skenario pesimis. Jangan jadikan produk utama."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
