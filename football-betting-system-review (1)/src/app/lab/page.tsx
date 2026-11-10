import { LabClient } from "./lab-client";

export const metadata = { title: "Quant Lab — Par-Lay Audit" };

export default function LabPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Quant Lab</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Mesin pengganti “probabilitas dari LLM”. Masukkan odds bandar dan statistik tim: odds di-de-vig, pasar
          diinversikan menjadi λ gol, statistik tim di-shrink, lalu keduanya digabung dan semua market diturunkan dari
          satu matriks skor. Hampir semua laga akan menghasilkan <b className="text-slate-200">NO BET</b> — itu bukan bug,
          itu yang dilakukan pasar yang efisien.
        </p>
      </header>
      <LabClient />
    </div>
  );
}
