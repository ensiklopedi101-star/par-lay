"use client";

import { useCallback, useEffect, useState } from "react";

type Outcome = "win" | "half_win" | "push" | "half_loss" | "loss" | "void";

interface Item {
  id: number;
  createdAt: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  marketFamily: string;
  selection: string;
  line: number | null;
  oddsTaken: number;
  pFinal: number | null;
  pMarketFair: number | null;
  oddsClose: number | null;
  outcome: Outcome | null;
  source: string;
  clv: number | null;
}

interface Summary {
  nTotal: number;
  nSettled: number;
  profit: number;
  staked: number;
  roi: number | null;
  roiCI: { lo: number; hi: number; pLeZero: number } | null;
  hitRate: number | null;
  avgOdds: number | null;
  avgClaimedEv: number | null;
  clv: { n: number; mean: number; ci: { lo: number; hi: number }; positiveRate: number; tStat: number; fairBasedShare: number } | null;
  scores: { n: number; brierModel: number; brierMarket: number | null; logLossModel: number; logLossMarket: number | null; skillVsMarket: number | null } | null;
  calibration: Array<{ label: string; n: number; meanPredicted: number; observed: number }>;
  betsNeeded: number | null;
  verdict: { level: "insufficient" | "early" | "supported" | "refuted"; headline: string; reasons: string[] };
}

interface BlendFit {
  weight: number;
  logLossAtWeight: number;
  logLossMarketOnly: number;
  logLossModelOnly: number;
  n: number;
  curve: Array<{ w: number; logLoss: number }>;
}

interface Payload {
  items: Item[];
  summary: Summary;
  blendFit: BlendFit | null;
}

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);

const verdictStyle = {
  insufficient: "border-slate-600 bg-slate-900/60 text-slate-200",
  early: "border-amber-700 bg-amber-950/30 text-amber-100",
  supported: "border-emerald-700 bg-emerald-950/30 text-emerald-100",
  refuted: "border-red-800 bg-red-950/30 text-red-100",
} as const;

const outcomeLabel: Record<Outcome, string> = {
  win: "Menang",
  half_win: "Half win",
  push: "Push",
  half_loss: "Half loss",
  loss: "Kalah",
  void: "Void",
};

function Stat({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const emptyForm = { league: "", homeTeam: "", awayTeam: "", marketFamily: "ML", selection: "", oddsTaken: "", pFinal: "", pMarketFair: "", stakeUnits: "1" };

export function LedgerClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<"all" | "manual" | "demo">("all");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/bets?source=${filter}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as Payload);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(j.error ?? "Permintaan gagal");
      return false;
    }
    setMsg(null);
    await load();
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await call("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        oddsTaken: Number(form.oddsTaken),
        pFinal: form.pFinal ? Number(form.pFinal) / 100 : null,
        pMarketFair: form.pMarketFair ? Number(form.pMarketFair) / 100 : null,
        stakeUnits: Number(form.stakeUnits) || 1,
      }),
    });
    if (ok) setForm(emptyForm);
  };

  const patch = (id: number, body: Record<string, unknown>) =>
    call(`/api/bets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const s = data?.summary;
  const hasDemo = data?.items.some((i) => i.source === "demo");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["all", "manual", "demo"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 ${filter === k ? "border-emerald-500 bg-emerald-500/10 text-emerald-200" : "border-slate-700 text-slate-300 hover:bg-slate-900"}`}
          >
            {k === "all" ? "Semua" : k === "manual" ? "Data saya" : "Demo (simulasi)"}
          </button>
        ))}
        <span className="mx-2 hidden h-5 w-px bg-slate-700 sm:block" />
        <button onClick={() => call("/api/bets/demo", { method: "POST" })} className="rounded-md border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-900">
          Muat data demo (160 bet simulasi)
        </button>
        {hasDemo && (
          <button onClick={() => call("/api/bets/demo", { method: "DELETE" })} className="rounded-md border border-red-900 px-3 py-1 text-red-300 hover:bg-red-950/40">
            Hapus data demo
          </button>
        )}
        {loading && <span className="text-xs text-slate-500">memuat…</span>}
      </div>
      {msg && <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{msg}</div>}

      {filter !== "manual" && hasDemo && (
        <div className="rounded-lg border border-sky-900 bg-sky-950/30 p-3 text-sm text-sky-100">
          Data demo adalah <b>simulasi</b>: model dengan noise ±7 poin tanpa shrinkage memilih bet “bernilai”. Perhatikan: EV yang diklaim positif,
          tetapi ROI nyata jauh lebih rendah dan CLV negatif — pola winner&apos;s curse yang ingin dideteksi Ledger pada sistem Anda. Pilih “Data saya” untuk melihat
          hanya bet sungguhan.
        </div>
      )}

      {s && (
        <>
          <div className={`rounded-xl border p-5 ${verdictStyle[s.verdict.level]}`}>
            <div className="text-xs font-semibold uppercase tracking-widest opacity-70">Vonis statistik</div>
            <h2 className="mt-1 text-xl font-bold">{s.verdict.headline}</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm opacity-90">
              {s.verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="mt-4">
              <div className="flex justify-between text-xs opacity-70">
                <span>Bet selesai: {s.nSettled}</span>
                <span>target kesimpulan: 300</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-black/30">
                <div className="h-2 rounded-full bg-current opacity-70" style={{ width: `${Math.min(100, (s.nSettled / 300) * 100)}%` }} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="ROI" value={signed(s.roi)} sub={s.roiCI ? `CI95 ${signed(s.roiCI.lo, 0)} … ${signed(s.roiCI.hi, 0)}` : "butuh ≥ 5 bet"} tone={s.roi != null && s.roi < 0 ? "text-red-300" : "text-emerald-300"} />
            <Stat label="EV yang diklaim" value={signed(s.avgClaimedEv)} sub="rata-rata p_final × odds − 1" />
            <Stat label="CLV rata-rata" value={s.clv ? signed(s.clv.mean, 2) : "—"} sub={s.clv ? `t = ${s.clv.tStat.toFixed(2)} · n = ${s.clv.n} · positif ${pct(s.clv.positiveRate, 0)}` : "isi closing odds"} tone={s.clv && s.clv.mean < 0 ? "text-red-300" : "text-emerald-300"} />
            <Stat
              label="Skill vs pasar (log-loss)"
              value={s.scores?.skillVsMarket == null ? "—" : signed(s.scores.skillVsMarket, 2)}
              sub={s.scores ? `Brier model ${s.scores.brierModel.toFixed(3)} vs pasar ${s.scores.brierMarket?.toFixed(3) ?? "—"}` : "butuh p_final & p_market"}
              tone={s.scores?.skillVsMarket != null && s.scores.skillVsMarket < 0 ? "text-red-300" : "text-emerald-300"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Kalibrasi probabilitas</h3>
              {s.calibration.length === 0 ? (
                <p className="text-sm text-slate-400">Belum cukup data (butuh ≥ 5 bet berhasil dengan p_final).</p>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-xs text-slate-500">
                    <tr><th className="text-left font-medium">Bin prediksi</th><th className="text-right font-medium">n</th><th className="text-right font-medium">Rata-rata prediksi</th><th className="text-right font-medium">Frekuensi nyata</th><th className="text-right font-medium">Selisih</th></tr>
                  </thead>
                  <tbody>
                    {s.calibration.map((c) => {
                      const gap = c.observed - c.meanPredicted;
                      return (
                        <tr key={c.label} className="border-t border-slate-800">
                          <td className="py-1">{c.label}</td>
                          <td className="text-right text-slate-400">{c.n}</td>
                          <td className="text-right">{pct(c.meanPredicted)}</td>
                          <td className="text-right">{pct(c.observed)}</td>
                          <td className={`text-right ${Math.abs(gap) > 0.05 ? "text-amber-300" : "text-slate-400"}`}>{signed(gap)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-slate-500">Selisih negatif besar di bin tinggi = model terlalu percaya diri (overconfident).</p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Bobot model vs pasar yang dipelajari</h3>
              {!data?.blendFit ? (
                <p className="text-sm text-slate-400">Butuh ≥ 30 bet selesai dengan p_model dan p_market_fair untuk memfit bobot.</p>
              ) : (
                <>
                  <p className="text-sm text-slate-300">
                    w* = <b className="text-emerald-300">{data.blendFit.weight.toFixed(2)}</b> dari {data.blendFit.n} sampel. Log-loss pasar saja{" "}
                    {data.blendFit.logLossMarketOnly.toFixed(4)} · model saja {data.blendFit.logLossModelOnly.toFixed(4)} · blend{" "}
                    {data.blendFit.logLossAtWeight.toFixed(4)}.
                  </p>
                  <div className="mt-3 flex h-20 items-end gap-0.5">
                    {(() => {
                      const ys = data.blendFit.curve.map((c) => c.logLoss);
                      const lo = Math.min(...ys);
                      const hi = Math.max(...ys);
                      return data.blendFit.curve.map((c) => (
                        <div key={c.w} title={`w=${c.w.toFixed(2)} · ${c.logLoss.toFixed(4)}`} className={`flex-1 rounded-t ${c.w === data.blendFit!.weight ? "bg-emerald-400" : "bg-slate-600"}`} style={{ height: `${10 + (90 * (c.logLoss - lo)) / Math.max(1e-9, hi - lo)}%` }} />
                      ));
                    })()}
                  </div>
                  <p className="mt-1 flex justify-between text-[10px] text-slate-500"><span>w = 0 (murni pasar)</span><span>w = 1 (murni model)</span></p>
                  <p className="mt-2 text-xs text-slate-500">
                    {data.blendFit.weight <= 0.05
                      ? "w* ≈ 0: model tidak menambah informasi di atas pasar. Gunakan mode pasar-murni."
                      : "Perbarui bobot default pipeline ke nilai ini (dibatasi maks 0.5 sampai bukti ≥ 300 bet)."}
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Catat bet baru</h3>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["league", "Liga"],
              ["homeTeam", "Home*"],
              ["awayTeam", "Away*"],
              ["selection", "Pilihan* (mis. Over 2.5)"],
              ["oddsTaken", "Odds diambil*"],
              ["pFinal", "P akhir model (%)"],
              ["pMarketFair", "P fair pasar (%)"],
              ["stakeUnits", "Stake (unit)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs text-slate-400">{label}</span>
              <input
                value={form[k]}
                onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-xs text-slate-400">Market</span>
            <select value={form.marketFamily} onChange={(e) => setForm((p) => ({ ...p, marketFamily: e.target.value }))} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
              {["ML", "Totals", "AH", "BTTS", "HT"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Simpan</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">Bet juga bisa dikirim langsung dari Quant Lab (tombol “Ledger”). Isi closing odds dan hasil di tabel di bawah setelah laga selesai.</p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Riwayat ({data?.items.length ?? 0})</h3>
        {data && data.items.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada bet. Catat bet sungguhan, kirim dari Quant Lab, atau muat data demo untuk melihat cara kerja vonis.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm tabular-nums">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="text-left font-medium">Laga / pilihan</th>
                  <th className="text-right font-medium">Odds</th>
                  <th className="text-right font-medium">P akhir</th>
                  <th className="text-right font-medium">Close</th>
                  <th className="text-right font-medium">CLV</th>
                  <th className="text-left pl-4 font-medium">Hasil</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.slice(0, 60).map((b) => (
                  <tr key={b.id} className="border-t border-slate-800 align-middle">
                    <td className="py-1.5">
                      <div className="text-slate-100">{b.homeTeam} v {b.awayTeam}</div>
                      <div className="text-xs text-slate-500">{b.selection} · {b.marketFamily}{b.source === "demo" ? " · demo" : ""}</div>
                    </td>
                    <td className="text-right">{b.oddsTaken.toFixed(2)}</td>
                    <td className="text-right text-slate-400">{pct(b.pFinal)}</td>
                    <td className="text-right">
                      <input
                        defaultValue={b.oddsClose ?? ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== String(b.oddsClose ?? "")) void patch(b.id, { oddsClose: v === "" ? null : Number(v) });
                        }}
                        className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right text-xs"
                      />
                    </td>
                    <td className={`text-right ${b.clv == null ? "text-slate-500" : b.clv >= 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(b.clv, 1)}</td>
                    <td className="pl-4">
                      <select
                        value={b.outcome ?? ""}
                        onChange={(e) => void patch(b.id, { outcome: e.target.value || null })}
                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs"
                      >
                        <option value="">Belum selesai</option>
                        {(Object.keys(outcomeLabel) as Outcome[]).map((o) => (
                          <option key={o} value={o}>{outcomeLabel[o]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pl-2 text-right">
                      <button onClick={() => void call(`/api/bets/${b.id}`, { method: "DELETE" })} className="text-xs text-red-300 hover:underline">hapus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.items.length > 60 && <p className="mt-2 text-xs text-slate-500">Menampilkan 60 terbaru dari {data.items.length}.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
