import { useState } from "react";
import { BrainCircuit, History, TicketCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RiskCenter from "@/pages/risk-center";
import Parlays from "@/pages/parlays";
import TiketHariIni from "@/pages/tiket-hari-ini";

/**
 * Menu Tiket Hari Ini (dulu "Tiket & Prediksi").
 *
 * Dirapikan 23 Nov 2026 atas temuan pemilik sistem: menu lama
 * mencampur prediksi per laga, penyusun manual, dan parlay otomatis
 * warisan — sementara tiket rekomendasi resmi (pasar-dulu) hidup di
 * dashboard sebagai pratinjau yang tidak pernah tercatat, sehingga
 * outcome-nya tidak pernah diketahui.
 *
 * Kini satu alur baca:
 *  1. Tiket Hari Ini — tiket resmi yang tersusun + tombol mencatatnya
 *     sebagai snapshot (tiket Telegram juga tercatat otomatis).
 *  2. Riwayat & Outcome — semua tiket yang pernah tercatat/disimpan,
 *     lengkap dengan hasil per leg dan status akhir won/lost.
 *  3. Prediksi per Laga — bahan mentahnya: penilaian AI per laga.
 */
export default function AICenter({ defaultTab = "today" }: { defaultTab?: "today" | "history" | "predictions" }) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tiket Hari Ini</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tiket rekomendasi resmi hari ini, catatan snapshot-nya, dan outcome setiap tiket yang pernah dibuat.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "today" | "history" | "predictions")} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-card p-1 shadow-sm sm:w-[640px]">
          <TabsTrigger value="today" className="gap-2 rounded-lg py-2.5">
            <TicketCheck className="h-4 w-4" /> Tiket Hari Ini
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2 rounded-lg py-2.5">
            <History className="h-4 w-4" /> Riwayat &amp; Outcome
          </TabsTrigger>
          <TabsTrigger value="predictions" className="gap-2 rounded-lg py-2.5">
            <BrainCircuit className="h-4 w-4" /> Prediksi per Laga
          </TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="mt-0">
          <TiketHariIni />
        </TabsContent>
        <TabsContent value="history" className="mt-0">
          <Parlays embedded />
        </TabsContent>
        <TabsContent value="predictions" className="mt-0">
          <RiskCenter embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
