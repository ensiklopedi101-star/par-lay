import { BrainCircuit } from "lucide-react";
import AILearningTransparency from "@/components/ai-learning-transparency";

export default function AILearning() {
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <BrainCircuit className="h-4 w-4" />
          AI learning workspace
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Learning</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Audit hasil settlement, lihat market yang paling konsisten, dan pahami lesson yang akan menjadi konteks analisis berikutnya.
        </p>
      </div>
      <AILearningTransparency />
    </div>
  );
}