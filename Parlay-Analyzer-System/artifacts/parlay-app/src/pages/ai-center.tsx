import { useState } from "react";
import { BrainCircuit, Layers3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import RiskCenter from "@/pages/risk-center";
import Parlays from "@/pages/parlays";

export default function AICenter({ defaultTab = "predictions" }: { defaultTab?: "predictions" | "parlays" }) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tiket & Prediksi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kiri: prediksi per pertandingan. Kanan: tiket parlay yang tersimpan. Tiket rekomendasi
          hari ini ada di halaman <strong>Hari Ini</strong>.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "predictions" | "parlays")} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-card p-1 shadow-sm sm:w-[520px]">
          <TabsTrigger value="predictions" className="gap-2 rounded-lg py-2.5">
            <BrainCircuit className="h-4 w-4" /> Prediksi per Laga
          </TabsTrigger>
          <TabsTrigger value="parlays" className="gap-2 rounded-lg py-2.5">
            <Layers3 className="h-4 w-4" /> Tiket Tersimpan
          </TabsTrigger>
        </TabsList>
        <TabsContent value="predictions" className="mt-0">
          <RiskCenter embedded />
        </TabsContent>
        <TabsContent value="parlays" className="mt-0">
          <Parlays embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
