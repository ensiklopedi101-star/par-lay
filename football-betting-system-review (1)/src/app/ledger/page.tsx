import { LedgerClient } from "./ledger-client";

export const metadata = { title: "Ledger & Bukti — Par-Lay Audit" };

export default function LedgerPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Ledger & Bukti</h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Di sinilah sistem belajar dengan benar. Setiap bet menyimpan probabilitas model, probabilitas fair pasar saat
          bet, odds yang diambil, closing odds, dan hasil. Dari situ dihitung CLV, kalibrasi, skill terhadap pasar, dan
          signifikansi statistik — bukan sekadar hit-rate dari beberapa bet.
        </p>
      </header>
      <LedgerClient />
    </div>
  );
}
