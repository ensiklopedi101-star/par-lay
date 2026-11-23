import { useState } from "react";
import { BookmarkCheck, TicketCheck } from "lucide-react";
import { useGetParlayComposition, useRecordTodayTickets, type RecordTodayResult } from "@/api/parlay-hooks";
import { ParlayCompositionPanel } from "@/components/parlay-composition-panel";
import { LiveTicketReportPanel } from "@/components/live-ticket-report-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminPassword } from "@/hooks/use-admin-password";
import { AdminPasswordDialog } from "@/components/AdminPasswordDialog";
import { useToast } from "@/hooks/use-toast";

/**
 * Tiket Hari Ini — satu-satunya tempat tiket rekomendasi dibaca.
 *
 * Panel komposisi adalah pratinjau hidup (dihitung ulang dari ledger
 * setiap dibuka). Agar tiket yang direkomendasikan tidak hilang dan
 * outcome-nya bisa diketahui, tombol "Catat Tiket Hari Ini"
 * menyimpannya sebagai snapshot; tiket tercatat tampil di tab
 * Riwayat & Outcome dan ter-settle otomatis dari skor akhir.
 * Tiket yang dikirim ke Telegram juga tercatat otomatis.
 */
export default function TiketHariIni() {
  const { data: composition, isLoading } = useGetParlayComposition();
  const recordMutation = useRecordTodayTickets();
  const { open, withPassword, onSubmit, onCancel } = useAdminPassword();
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<RecordTodayResult | null>(null);

  const utamaLegs = composition?.variants?.utama?.legs.length ?? composition?.marketFirst?.legs.length ?? 0;
  const formed = [composition?.variants?.utama, composition?.variants?.booster, composition?.variants?.jackpot]
    .filter(Boolean).length;

  const handleRecord = () => {
    withPassword(() => {
      recordMutation.mutate(undefined, {
        onSuccess: (result) => {
          setLastResult(result);
          toast({
            title: result.recorded.length > 0 ? "Tiket tercatat" : "Tidak ada tiket baru",
            description: result.recorded.length > 0
              ? `${result.recorded.length} varian tersimpan sebagai snapshot — outcome-nya tampil di tab Riwayat & Outcome setelah laga selesai.`
              : "Isi tiket sama persis dengan yang sudah tercatat hari ini, atau tidak ada varian yang terbentuk.",
          });
        },
        onError: (error) => {
          toast({ title: "Gagal mencatat tiket", description: error.message, variant: "destructive" });
        },
      });
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <TicketCheck className="h-5 w-5 text-primary" />
          <div className="min-w-0">
            <div className="text-base font-semibold">
              {isLoading ? "Menyusun tiket…" : utamaLegs > 0 ? `${utamaLegs} leg utama tersusun` : "Tiket utama belum terbentuk"}
            </div>
            <div className="text-xs text-muted-foreground">
              Tiga pilihan: 🎯 Utama paling aman · 🚀 Booster seimbang · 💎 Jackpot paling berani.
              {formed > 0 && ` ${formed} dari 3 varian terbentuk hari ini.`}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {lastResult && (
              <Badge variant="outline" className="text-[11px]">
                Terakhir: {lastResult.recorded.length} tercatat, {lastResult.skipped.length} dilewati
              </Badge>
            )}
            <Button onClick={handleRecord} disabled={recordMutation.isPending || isLoading} className="gap-2">
              <BookmarkCheck className="h-4 w-4" />
              {recordMutation.isPending ? "Mencatat…" : "Catat Tiket Hari Ini"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Panel di bawah adalah <strong>pratinjau hidup</strong> — susunannya mengikuti data terbaru. Tiket baru
        resmi tercatat bila Anda menekan tombol di atas (atau saat tiket dikirim ke Telegram). Tiket yang sudah
        tercatat <strong>tidak pernah diubah</strong>; bila susunan berubah, ia tercatat sebagai tiket baru dan
        yang lama tetap tersimpan — sehingga setiap rekomendasi bisa diaudit menang atau kalah di tab
        <strong> Riwayat &amp; Outcome</strong>.
      </p>

      <ParlayCompositionPanel composition={composition} isLoading={isLoading} />

      <LiveTicketReportPanel />

      <AdminPasswordDialog open={open} onOpenChange={onCancel} onSubmit={onSubmit} />
    </div>
  );
}
