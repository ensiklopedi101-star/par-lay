import {
  useGetAnalysisStatus,
  useGetAutomationStatus,
  useGetParlayComposition,
  useGetSettlementSummary,
  useGetSyncStatus,
} from "@/api/parlay-hooks";
import { AnalysisStatusPanel } from "@/components/analysis-status-panel";
import { AutomationStatusPanel } from "@/components/automation-status-panel";
import { ParlayCompositionPanel } from "@/components/parlay-composition-panel";
import { SettlementTransparencyPanel } from "@/components/settlement-transparency-panel";
import { SyncTransparencyPanel } from "@/components/sync-transparency-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, ShieldCheck } from "lucide-react";

export default function Transparency() {
  const sync = useGetSyncStatus();
  const settlement = useGetSettlementSummary();
  const composition = useGetParlayComposition();
  const analysis = useGetAnalysisStatus();
  const automation = useGetAutomationStatus();

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <Eye className="h-4 w-4" /> Audit trail
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Transparansi Sistem</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Semua bukti proses yang sebelumnya memenuhi Dashboard kini dikumpulkan di sini: sinkronisasi odds,
          pembentukan parlay, status analisis, settlement, dan jadwal otomatis. Dashboard tetap ringkas untuk
          mengambil tindakan; halaman ini untuk memeriksa <strong>mengapa</strong> sistem menghasilkan sesuatu.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5 shadow-none">
        <CardContent className="flex gap-3 py-4 text-sm leading-relaxed">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            <strong>Cara membaca:</strong> mulai dari Sync untuk memastikan data masuk, lalu Analisis untuk melihat
            prediksi yang lahir, Komposisi Parlay untuk memahami pemilihan leg, dan Settlement untuk melihat hasil
            akhirnya. Jika satu tahap kosong, tahap berikutnya memang tidak boleh dipaksakan.
          </p>
        </CardContent>
      </Card>

      <SyncTransparencyPanel status={sync.data} isLoading={sync.isLoading} />
      <AnalysisStatusPanel status={analysis.data} isLoading={analysis.isLoading} />
      <ParlayCompositionPanel composition={composition.data} isLoading={composition.isLoading} />
      <SettlementTransparencyPanel summary={settlement.data} isLoading={settlement.isLoading} />
      <AutomationStatusPanel status={automation.data} isLoading={automation.isLoading} />
    </div>
  );
}
