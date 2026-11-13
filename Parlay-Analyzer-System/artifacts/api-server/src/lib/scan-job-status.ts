/**
 * Pemulihan job scan yatim.
 *
 * Job batch berjalan sebagai promise latar belakang setelah respons 202
 * terkirim. Bila instance serverless dibunuh di tengah panggilan AI
 * (batas keras 60 detik), tidak ada kode yang sempat menulis status
 * akhir: job selamanya "running" dengan `updated_at` beku, frontend
 * mengira scan masih berjalan, dan sisa fixture tidak pernah dilanjutkan
 * (kejadian 13 Nov 2026: job berhenti di 93/151, `updated_at` membeku
 * lebih dari 3 menit).
 *
 * Aturannya sederhana: job "running" yang tidak diperbarui lebih lama
 * dari ambang basi dianggap mati. Bila masih ada antrean (`pending`),
 * statusnya menjadi `partial` supaya frontend melanjutkan lewat resume;
 * bila antrean kosong, job ditutup sebagai `failed` dengan alasan yang
 * jujur — bukan "selesai" palsu.
 */
export interface ScanJobSnapshot {
  status: string;
  pending: number[];
  updatedAt: string;
}

export function recoverStaleScanJob<T extends ScanJobSnapshot>(
  job: T,
  nowMs: number,
  staleMs: number,
): { job: T; recovered: boolean } {
  if (job.status !== "running") return { job, recovered: false };
  const updatedMs = new Date(job.updatedAt).getTime();
  if (!Number.isFinite(updatedMs) || nowMs - updatedMs <= staleMs) {
    return { job, recovered: false };
  }
  const status = job.pending.length > 0 ? "partial" : "failed";
  return { job: { ...job, status }, recovered: true };
}
