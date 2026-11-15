import {
  useGetAnalysisStatus,
  useGetAutomationStatus,
  useGetModelBacktest,
  useGetParlayComposition,
  useGetSettlementSummary,
  useGetSyncStatus,
  useGetWarehouseBacktest,
} from "@/api/parlay-hooks";
import { AnalysisStatusPanel } from "@/components/analysis-status-panel";
import { ModelBacktestPanel } from "@/components/model-backtest-panel";
import { WarehouseBacktestPanel } from "@/components/warehouse-backtest-panel";
import { AutomationStatusPanel } from "@/components/automation-status-panel";
import { ParlayCompositionPanel } from "@/components/parlay-composition-panel";
import { SettlementTransparencyPanel } from "@/components/settlement-transparency-panel";
import { SyncTransparencyPanel } from "@/components/sync-transparency-panel";

export default function Transparency() {
  const sync = useGetSyncStatus();
  const settlement = useGetSettlementSummary();
  const composition = useGetParlayComposition();
  const analysis = useGetAnalysisStatus();
  const automation = useGetAutomationStatus();
  const modelBacktest = useGetModelBacktest();
  const warehouseBacktest = useGetWarehouseBacktest();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bukti Sistem</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Halaman pemeriksa: data masuk → analisis → tiket dipilih → hasil akhir.
          Untuk keputusan harian, cukup halaman <strong>Hari Ini</strong>.
        </p>
      </div>

      <SyncTransparencyPanel status={sync.data} isLoading={sync.isLoading} />
      <AnalysisStatusPanel status={analysis.data} isLoading={analysis.isLoading} />
      <ParlayCompositionPanel composition={composition.data} isLoading={composition.isLoading} />
      <SettlementTransparencyPanel summary={settlement.data} isLoading={settlement.isLoading} />
      <ModelBacktestPanel data={modelBacktest.data} isLoading={modelBacktest.isLoading} />
      <WarehouseBacktestPanel data={warehouseBacktest.data} isLoading={warehouseBacktest.isLoading} />
      <AutomationStatusPanel status={automation.data} isLoading={automation.isLoading} />
    </div>
  );
}
