import { BrainCircuit, CheckCircle2, GitBranch, LockKeyhole, RefreshCw } from "lucide-react";
import AILearningTransparency from "@/components/ai-learning-transparency";
import LearningLoopControls from "@/components/learning-loop-controls";
import { Card, CardContent } from "@/components/ui/card";

export default function AILearning() {
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <BrainCircuit className="h-4 w-4" />
          AI learning workspace
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Learning</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Halaman ini menjawab tiga hal: apakah sistem sedang belajar, dari data apa ia belajar, dan perubahan apa
          yang boleh terjadi tanpa persetujuan manusia.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">Sudah berjalan?</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Pipeline dan automation-nya ada: settlement → evaluasi → klasifikasi → proposal → backtest holdout.
                Namun “berjalan” belum berarti “sudah berevolusi”; evolusi hanya terjadi bila ada proposal yang lolos seluruh gate.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">Bisa belajar mandiri?</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Bisa mengusulkan dan — pada jalur otomatis — mempromosikan kebijakan bila confidence serta backtest
                objektif lolos. Yang berubah adalah policy/prompt addendum berversi, bukan bobot model Gemini.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-3 py-4">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm">
              <div className="font-semibold">Pengaman evolusi</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Data lama yang tidak dapat diaudit dikeluarkan, NO BET dipisahkan, sampel dibagi training/holdout,
                dan setiap versi dapat di-rollback. Sistem tidak boleh belajar dari kekalahan acak semata.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="flex gap-3 py-4 text-sm leading-relaxed text-amber-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            <strong>Prinsip yang dipakai:</strong> AI tidak “mengubah dirinya sendiri” secara bebas. Ia hanya boleh
            mengusulkan pengetatan ambang/pengecualian market, diuji pada data yang tidak dipakai menyusun usulan,
            lalu dipromosikan bila gate terpenuhi. Bila jumlah sampel eligible masih nol, jawaban yang benar adalah
            <strong> belum berevolusi</strong>, bukan memaksakan pembelajaran.
          </p>
        </CardContent>
      </Card>

      <LearningLoopControls />
      <AILearningTransparency />
    </div>
  );
}
