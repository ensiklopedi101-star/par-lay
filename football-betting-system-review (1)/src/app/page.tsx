import Link from "next/link";
import { AREA_LABEL, findings, goLiveGates, maturity, strengths, type Severity } from "@/lib/audit-data";

const sevStyle: Record<Severity, string> = {
  kritis: "bg-red-500/15 text-red-300 ring-red-500/30",
  tinggi: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  sedang: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
};

export default function Home() {
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const implemented = findings.filter((f) => f.status === "diimplementasi").length;
  const critical = findings.filter((f) => f.severity === "kritis");

  return (
    <div className="space-y-10">
      <section>
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-400">Review sistem · par-lay</p>
        <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
          Fondasi rekayasa Anda kuat. Masalahnya ada di <span className="text-emerald-400">sumber probabilitas</span> dan{" "}
          <span className="text-emerald-400">cara membuktikan edge</span>.
        </h1>
        <p className="mt-4 max-w-3xl text-slate-400">
          Sistem Anda sangat disiplin soal integritas (fail-closed, audit kebocoran data, settlement benar). Namun
          angka yang menggerakkan semua keputusan — probabilitas “nyata” — ditulis oleh LLM, dibandingkan dengan odds
          yang belum dibersihkan dari margin, lalu “dipelajari” dari hasil puluhan bet. Itu tiga celah yang membuat
          klaim edge tidak bisa dipercaya meskipun kode di sekelilingnya rapi.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/temuan" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            Lihat {findings.length} temuan
          </Link>
          <Link href="/lab" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900">
            Coba Quant Lab
          </Link>
          <Link href="/patch" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900">
            Ambil kode patch
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Temuan kritis", value: count("kritis"), tone: "text-red-300" },
          { label: "Temuan tinggi", value: count("tinggi"), tone: "text-amber-300" },
          { label: "Temuan sedang", value: count("sedang"), tone: "text-sky-300" },
          { label: "Sudah diimplementasi (kode)", value: `${implemented}/${findings.length}`, tone: "text-emerald-300" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className={`text-3xl font-bold ${s.tone}`}>{s.value}</div>
            <div className="mt-1 text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-white">Skor kematangan (penilaian reviewer, 0–10)</h2>
          <span className="text-xs text-slate-500">Saat ini → target setelah patch + bukti</span>
        </div>
        <div className="mt-4 space-y-4">
          {maturity.map((m) => (
            <div key={m.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-200">{m.label}</span>
                <span className="tabular-nums text-slate-400">
                  {m.now} → <span className="text-emerald-300">{m.target}</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-slate-800">
                <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/30" style={{ width: `${m.target * 10}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-400" style={{ width: `${m.now * 10}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{m.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Kelemahan yang paling menentukan</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {critical.map((f) => (
            <Link key={f.id} href={`/temuan#${f.id}`} className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-600">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${sevStyle[f.severity]}`}>{f.id} · {f.severity}</span>
                <span className="text-xs text-slate-500">{AREA_LABEL[f.area]}</span>
              </div>
              <h3 className="mt-2 font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1 line-clamp-3 text-sm text-slate-400">{f.impact}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Keunggulan yang harus dipertahankan</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {strengths.map((s) => (
            <div key={s.title} className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
              <h3 className="font-semibold text-emerald-200">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-300">{s.detail}</p>
              <p className="mt-2 text-xs text-slate-500">Bukti: {s.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-lg font-semibold text-white">Apa arti “mendekati kebenaran” secara terukur?</h2>
        <p className="mt-2 text-sm text-slate-400">
          Hasil sepakbola sangat acak; kebenaran yang bisa dikejar adalah <b className="text-slate-200">probabilitas yang terkalibrasi</b> yang
          tidak kalah dari harga penutupan pasar. Sistem dinyatakan punya edge hanya jika semua gerbang ini terpenuhi:
        </p>
        <ul className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
          {goLiveGates.map((g) => (
            <li key={g} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              {g}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Catatan jujur: review ini berbasis pembacaan kode dan dokumentasi repo. Saya tidak punya akses ke database
          Supabase live atau riwayat bet Anda, jadi saya tidak dapat menyatakan apakah sistem saat ini untung/rugi —
          justru itu yang harus dijawab Ledger setelah data terkumpul.
        </p>
      </section>
    </div>
  );
}
