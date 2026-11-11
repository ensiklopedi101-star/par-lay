/**
 * Laporan jadwal otomatis: apa yang benar-benar berjalan tanpa disentuh manusia.
 *
 * Kenapa modul ini ada
 * --------------------
 * Dashboard sebelumnya hanya bisa menjawab "kapan sync terakhir". Itu
 * pertanyaan yang salah. Pertanyaan yang benar: **apakah rantai otomatisnya
 * hidup?** Dua hal berbeda — sync bisa berjalan tiap hari sementara settlement
 * tidak pernah dipanggil sama sekali, dan tidak ada satu pun layar yang
 * memperlihatkan bedanya.
 *
 * Kegagalan senyap yang ditemukan (bukti: Supabase, 11 Nov 2026)
 * --------------------------------------------------------------
 * `refreshFixtureResultsForSettlement()` sudah ada dan benar. Ia menulis
 * `status_short`, `home_goals`, `away_goals` dari Odds-API. Masalahnya ia
 * hanya dipanggil dari `runSettlement()`, dan `runSettlement()` dijadwalkan
 * oleh `node-cron` di `scheduler/index.ts` — yang **tidak pernah hidup di
 * Vercel**, karena `index.ts` melewati `startScheduler()` ketika `PORT` tidak
 * diset (dan di serverless memang tidak diset).
 *
 * Akibatnya selama berminggu-minggu:
 *   • 817 fixture berstatus `pending` dengan skor kosong
 *   • `runOutcomeSettlement()` menyelesaikan 0 baris setiap kali dipanggil,
 *     karena ledger `prediction_selections` masih kosong
 *   • cron Vercel hanya `action=sync` (1×/hari), sehingga skor tidak pernah
 *     diminta ulang
 * Loop-nya tertutup rapat: tidak ada skor → tidak ada settlement → tidak ada
 * outcome → tidak ada data untuk membuktikan sistem bekerja.
 *
 * Modul ini tidak memperbaiki apa pun. Ia hanya membuat kondisi itu
 * **terbaca**, sehingga tidak bisa lagi hilang tanpa jejak.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../lib/supabase-client";
import { logger } from "../lib/logger";

/** Batas Vercel Hobby: dua cron per proyek, masing-masing paling sering 1×/hari. */
export const HOBBY_CRON_LIMIT = 2;

/**
 * Aksi yang **harus** terjadwal otomatis agar sistem bisa menutup loop-nya
 * sendiri. `sync` tidak ada di sini karena sudah terjadwal sejak awal.
 */
export const REQUIRED_SCHEDULED_ACTIONS = ["sync", "results", "closing", "outcomes"] as const;

export type ScheduledAction = (typeof REQUIRED_SCHEDULED_ACTIONS)[number];

/** Sumber jadwal: `vercel.json`, `scheduler` (node-cron), atau keduanya. */
export interface CronTrigger {
  action: string;
  /** Ekspresi cron apa adanya, mis. `0 6 * * *`. */
  schedule: string;
  source: "vercel" | "node-cron";
  /** Perkiraan frekuensi per hari, dari ekspresi cron. */
  runsPerDay: number;
  /**
   * Aksi yang benar-benar dijalankan pemicu ini.
   *
   * Satu cron boleh menjalankan beberapa tugas sekaligus — dan di Vercel
   * Hobby itu **keharusan**, karena hanya ada dua slot. Tanpa kolom ini,
   * laporan akan salah mengira `closing` tidak terjadwal padahal ia ikut
   * menumpang di aksi `daily`.
   */
  covers: string[];
}

/**
 * Perkiraan kasar berapa kali satu ekspresi cron berjalan per hari.
 *
 * Sengaja konservatif dan tidak memakai pustaka: yang dibutuhkan hanya
 * membedakan "tiap hari" dari "tiap jam" agar peringatan batas Hobby bisa
 * dijelaskan. Ekspresi yang tidak dikenali dianggap 1×/hari.
 */
export function estimateRunsPerDay(expression: string): number {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 1;
  const [minute, hour] = parts as [string, string, string, string, string];

  const stepCount = (field: string, span: number): number | null => {
    const step = /^\*\/(\d+)$/.exec(field);
    if (step) {
      const n = Number(step[1]);
      return n > 0 ? Math.floor(span / n) : null;
    }
    return null;
  };

  /* Menit berulang tanpa jam tetap → sepanjang hari. */
  const minuteSteps = stepCount(minute, 60);
  if (minuteSteps !== null && (hour === "*" || stepCount(hour, 24) !== null)) {
    return minuteSteps * (stepCount(hour, 24) ?? 1) * 24;
  }

  /* Jam berulang dengan menit tetap → n kali sehari. */
  const hourSteps = stepCount(hour, 24);
  if (hourSteps !== null) return hourSteps;

  if (hour === "*") return 24;
  return 1;
}

/**
 * Baca jadwal yang aktif dari dua sumber.
 *
 * `vercel.json` tidak dibaca dari disk karena berkas itu berada di luar
 * paket api-server dan tidak ikut ter-bundel ke fungsi serverless. Nilainya
 * diteruskan pemanggil (rute sudah mengetahuinya), dan di sini hanya
 * dinormalisasi agar bisa dibandingkan dengan kebutuhan sistem.
 */
/**
 * Aksi gabungan → daftar tugas yang dijalankannya.
 *
 * Harus cocok dengan `handleCron()` di `routes/cron.ts`. Kalau aksi baru
 * ditambahkan di sana tetapi tidak didaftarkan di sini, dashboard akan
 * melaporkannya sebagai celah — kegagalan yang aman (false alarm), bukan
 * klaim palsu bahwa semuanya beres.
 */
export const COMPOSITE_ACTIONS: Record<string, string[]> = {
  daily: ["sync", "results", "closing", "outcomes"],
};

export function buildCronTriggers(input: {
  vercelCrons: Array<{ path: string; schedule: string }>;
  nodeCronSchedules?: Array<{ action: string; schedule: string }>;
}): CronTrigger[] {
  const triggers: CronTrigger[] = [];

  for (const cron of input.vercelCrons) {
    /* Path berbentuk `/api/cron?action=sync`. */
    const match = /action=([a-z-]+)/i.exec(cron.path);
    if (!match) continue;
    const action = match[1]!.toLowerCase();
    triggers.push({
      action,
      schedule: cron.schedule,
      source: "vercel",
      runsPerDay: estimateRunsPerDay(cron.schedule),
      covers: [action, ...(COMPOSITE_ACTIONS[action] ?? [])],
    });
  }

  for (const entry of input.nodeCronSchedules ?? []) {
    triggers.push({
      action: entry.action,
      schedule: entry.schedule,
      source: "node-cron",
      runsPerDay: estimateRunsPerDay(entry.schedule),
      covers: [entry.action],
    });
  }

  return triggers;
}

export interface AutomationGap {
  action: string;
  /** Kenapa aksi ini penting — dipakai langsung sebagai teks di dashboard. */
  consequence: string;
  /** `true` bila sama sekali tidak ada pemicu terjadwal. */
  unscheduled: boolean;
  /** `true` bila terjadwal, tetapi hanya oleh node-cron yang mati di Vercel. */
  onlyOnDeadScheduler: boolean;
}

export interface AutomationStatus {
  /** Semua pemicu yang terbaca, dari kedua sumber. */
  triggers: CronTrigger[];
  /** Aksi yang tidak akan pernah berjalan otomatis. */
  gaps: AutomationGap[];
  /** Aksi yang tercakup cron Vercel — satu-satunya yang hidup di produksi. */
  coveredByVercel: string[];
  /** Jeda terpanjang antara dua putaran, dalam jam (0 bila tidak diketahui). */
  maxGapHours: number;
  /** `true` bila jumlah cron Vercel sudah menyentuh batas Hobby. */
  atHobbyLimit: boolean;
  /** Jumlah fixture lewat yang belum punya skor — angka dampak, bukan teori. */
  fixturesAwaitingScore: number;
  generatedAt: string;
  notes: string[];
}

const CONSEQUENCE: Record<string, string> = {
  sync:
    "Tanpa sync, tidak ada fixture maupun harga baru. Semua analisis berhenti di data lama.",
  results:
    "Tanpa penarikan hasil, fixture selesai tetap berstatus `pending` selamanya. Tidak ada skor → " +
    "tidak ada settlement → tidak ada outcome → tidak ada data untuk menilai sistem.",
  closing:
    "Tanpa penangkapan odds penutup, CLV tidak bisa dihitung, sehingga tidak bisa dibedakan " +
    "menang karena model bagus atau karena harga bergerak menguntungkan.",
  outcomes:
    "Tanpa pengisian outcome, ledger quant tidak pernah punya hasil dan Fase 3 tidak bisa dievaluasi.",
};

function maxGapHoursOf(triggers: CronTrigger[]): number {
  const daily = triggers.filter((trigger) => trigger.runsPerDay > 0);
  if (daily.length === 0) return 0;
  const fastest = Math.max(...daily.map((trigger) => trigger.runsPerDay));
  return Math.round((24 / fastest) * 10) / 10;
}

/**
 * Susun status otomatisasi.
 *
 * `nodeCronSchedules` diisi pemanggil dengan jadwal dari `scheduler/index.ts`.
 * Di produksi Vercel, jadwal itu **tidak pernah berjalan** — `startScheduler()`
 * dilewati karena `PORT` tidak diset. Karena itu entri node-cron ditandai
 * `onlyOnDeadScheduler` alih-alih dihitung sebagai cakupan.
 */
export async function buildAutomationStatus(input: {
  vercelCrons: Array<{ path: string; schedule: string }>;
  nodeCronSchedules?: Array<{ action: string; schedule: string }>;
  supabase?: SupabaseClient;
}): Promise<AutomationStatus> {
  const triggers = buildCronTriggers({
    vercelCrons: input.vercelCrons,
    nodeCronSchedules: input.nodeCronSchedules,
  });

  const coveredByVercel = [
    ...new Set(
      triggers
        .filter((t) => t.source === "vercel")
        .flatMap((t) => t.covers)
        /* `daily` adalah nama wadah, bukan tugas; hanya tugas yang dilaporkan. */
        .filter((name) => REQUIRED_SCHEDULED_ACTIONS.includes(name as ScheduledAction)),
    ),
  ];

  const gaps: AutomationGap[] = [];
  for (const action of REQUIRED_SCHEDULED_ACTIONS) {
    const onVercel = coveredByVercel.includes(action);
    const onNodeCron = triggers.some((t) => t.source === "node-cron" && t.action === action);
    if (onVercel) continue;
    gaps.push({
      action,
      consequence: CONSEQUENCE[action] ?? "Aksi ini tidak berjalan otomatis.",
      unscheduled: !onNodeCron,
      onlyOnDeadScheduler: onNodeCron,
    });
  }

  const notes: string[] = [];

  /* Dampak nyata, bukan teori: berapa fixture menunggu skor sekarang. */
  let fixturesAwaitingScore = 0;
  const client = input.supabase ?? defaultSupabase;
  if (client) {
    try {
      const nowIso = new Date().toISOString();
      const past = await client
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .lt("fixture_date", nowIso);
      const scored = await client
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .lt("fixture_date", nowIso)
        .not("home_goals", "is", null);
      if (!past.error && !scored.error) {
        fixturesAwaitingScore = Math.max(0, (past.count ?? 0) - (scored.count ?? 0));
      }
    } catch (err) {
      logger.debug({ err }, "Gagal menghitung fixture yang menunggu skor");
    }
  }

  if (gaps.some((gap) => gap.action === "results" && gap.onlyOnDeadScheduler)) {
    notes.push(
      "Penarikan hasil sudah ada kodenya, tetapi hanya dijadwalkan oleh `node-cron` di " +
        "`scheduler/index.ts` — dan scheduler itu tidak hidup di Vercel karena `PORT` tidak diset. " +
        "Artinya skor tidak pernah diminta ulang, berapa pun lama sistem menyala.",
    );
  }
  if (fixturesAwaitingScore > 0) {
    notes.push(
      `${fixturesAwaitingScore} fixture sudah lewat tanpa skor akhir. Ini angka dampak dari ` +
        "pemicu yang hilang di atas, bukan masalah terpisah.",
    );
  }
  if (triggers.filter((t) => t.source === "vercel").length >= HOBBY_CRON_LIMIT) {
    notes.push(
      `Cron Vercel sudah memakai ${HOBBY_CRON_LIMIT}/${HOBBY_CRON_LIMIT} slot yang diizinkan paket Hobby. ` +
        "Menambah tugas baru menuntut salah satu tugas lama digabung, bukan ditambah.",
    );
  }

  return {
    triggers,
    gaps,
    coveredByVercel,
    maxGapHours: maxGapHoursOf(triggers.filter((t) => t.source === "vercel")),
    atHobbyLimit: triggers.filter((t) => t.source === "vercel").length >= HOBBY_CRON_LIMIT,
    fixturesAwaitingScore,
    generatedAt: new Date().toISOString(),
    notes,
  };
}
