import { AREA_LABEL, findings, type Area, type FixStatus, type Severity } from "@/lib/audit-data";

export const metadata = { title: "Temuan — Par-Lay Audit" };

const sevStyle: Record<Severity, string> = {
  kritis: "bg-red-500/15 text-red-300 ring-red-500/30",
  tinggi: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  sedang: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
};
const statusStyle: Record<FixStatus, { label: string; cls: string }> = {
  diimplementasi: { label: "Kode siap pakai", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  "butuh-integrasi": { label: "Butuh integrasi di repo Anda", cls: "bg-violet-500/15 text-violet-300 ring-violet-500/30" },
  rekomendasi: { label: "Rekomendasi", cls: "bg-slate-500/15 text-slate-300 ring-slate-500/30" },
};

const areas = Object.keys(AREA_LABEL) as Area[];

export default function Temuan() {
  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-bold text-white">Temuan review</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          {findings.length} temuan dari lima dimensi yang Anda minta: pemilihan data, proses analisis, penggunaan data,
          kematangan analisa, dan pembelajaran mandiri. Tiap temuan memuat bukti di repo, dampak, dan perbaikan.
          “Kode siap pakai” berarti modulnya sudah ditulis dan diuji di app ini (<code>src/lib/quant</code>); “butuh
          integrasi” berarti harus dipasang di repo/infrastruktur Anda.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2 text-sm">
          {areas.map((a) => (
            <a key={a} href={`#area-${a}`} className="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-900">
              {AREA_LABEL[a]} ({findings.filter((f) => f.area === a).length})
            </a>
          ))}
        </nav>
      </header>

      {areas.map((area) => (
        <section key={area} id={`area-${area}`} className="scroll-mt-24">
          <h2 className="border-b border-slate-800 pb-2 text-xl font-semibold text-white">{AREA_LABEL[area]}</h2>
          <div className="mt-4 space-y-4">
            {findings
              .filter((f) => f.area === area)
              .map((f) => (
                <article key={f.id} id={f.id} className="scroll-mt-24 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${sevStyle[f.severity]}`}>
                      {f.id} · {f.severity}
                    </span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${statusStyle[f.status].cls}`}>
                      {statusStyle[f.status].label}
                    </span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-100">{f.title}</h3>

                  <dl className="mt-3 grid gap-4 text-sm md:grid-cols-3">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bukti di repo</dt>
                      <dd className="mt-1 space-y-1 text-slate-400">
                        {f.evidence.map((e) => (
                          <p key={e} className="font-mono text-xs leading-relaxed">{e}</p>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dampak</dt>
                      <dd className="mt-1 text-slate-300">{f.impact}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-500">Perbaikan</dt>
                      <dd className="mt-1 text-slate-200">{f.fix}</dd>
                      {f.module && <dd className="mt-2 font-mono text-xs text-emerald-300/80">{f.module}</dd>}
                    </div>
                  </dl>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
