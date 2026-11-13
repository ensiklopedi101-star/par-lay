import { useState } from "react";
import { ArrowRight, BrainCircuit, Layers3, MousePointerClick, ShieldCheck, TicketCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import RiskCenter from "@/pages/risk-center";
import Parlays from "@/pages/parlays";

export default function AICenter({ defaultTab = "predictions" }: { defaultTab?: "predictions" | "parlays" }) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <BrainCircuit className="h-4 w-4" /> Pusat keputusan AI
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Prediksi & Parlay AI</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Ini satu alur kerja, bukan dua fitur terpisah. Sistem menganalisis pertandingan satu per satu,
          menyaring prediksi yang layak, lalu menggabungkan leg terpilih menjadi satu tiket parlay dengan
          pemeriksaan korelasi, EV pesimistis, dan batas stake.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">1 · Prediksi AI</div>
              <p className="mt-1 text-muted-foreground">Nilai setiap laga: market, selection, probabilitas, odds, dan alasan layak/tidak layak.</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">2 · Pilih atau biarkan mesin memilih</div>
              <p className="mt-1 text-muted-foreground">Centang prediksi untuk antrean manual, atau gunakan kandidat otomatis dari scanner.</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <TicketCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">3 · Tiket Parlay AI</div>
              <p className="mt-1 text-muted-foreground">Lihat tiket aktif/selesai, gabungan leg, readiness, hasil, dan rencana stake tiket.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5 shadow-none">
        <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span><strong className="text-foreground">Aturan main:</strong> prediksi yang tidak lolos gate tetap terlihat sebagai NO BET/review — tidak dipaksa masuk parlay.</span>
          <span className="ml-auto hidden items-center gap-1 font-medium text-primary lg:flex">Prediksi tunggal <ArrowRight className="h-4 w-4" /> tiket parlay</span>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "predictions" | "parlays")} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-card p-1 shadow-sm sm:w-[520px]">
          <TabsTrigger value="predictions" className="gap-2 rounded-lg py-2.5">
            <BrainCircuit className="h-4 w-4" /> Prediksi AI
          </TabsTrigger>
          <TabsTrigger value="parlays" className="gap-2 rounded-lg py-2.5">
            <Layers3 className="h-4 w-4" /> Tiket Parlay AI
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
