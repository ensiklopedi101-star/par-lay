/**
 * Risiko konteks — Langkah 3 pendekatan pasar-dulu.
 *
 * Pasar kuat menilai kekuatan tim, tetapi leg parlay bisa rapuh karena
 * keadaan di sekitar pertandingan: istirahat pendek setelah laga Eropa,
 * jadwal padat, atau ketimpangan istirahat melawan lawan yang segar.
 * Modul ini menilai keadaan itu dari jadwal semata (data yang kita
 * miliki), memberi tingkat risiko per leg agar komposer bisa
 * menurunkan leg rapuh — bukan menghapusnya diam-diam.
 *
 * Yang TIDAK dinilai di sini: cedera/rotasi susunan pemain dan
 * motivasi klasemen — data itu belum kita miliki terstruktur, dan
 * mengarangnya lebih buruk daripada mengaku tidak tahu.
 */

export type ContextRiskLevel = "rendah" | "sedang" | "tinggi" | "tidak-diketahui";
export type BackedSide = "home" | "away" | null;

export interface ContextInput {
  /** Tim yang didukung leg ini (null untuk Totals/BTTS — netral). */
  backed: BackedSide;
  /** Hari istirahat sejak laga sebelumnya; null bila tidak diketahui. */
  homeRestDays: number | null;
  awayRestDays: number | null;
  /** Jumlah laga dalam 14 hari sebelum laga ini. */
  homeMatches14: number | null;
  awayMatches14: number | null;
}

export interface ContextRisk {
  level: ContextRiskLevel;
  flags: string[];
  /** Pengali skor pemilihan: leg berisiko diturunkan, bukan dihapus. */
  scoreMultiplier: number;
}

function scoreMultiplierFor(level: ContextRiskLevel): number {
  if (level === "tinggi") return 0.85;
  if (level === "sedang") return 0.95;
  return 1;
}

/** Istirahat di bawah ini dianggap pendek untuk sepak bola elite. */
export const SHORT_REST_DAYS = 4;
/** Selisih istirahat yang dianggap ketimpangan material. */
export const REST_GAP_DAYS = 3;

export function assessContext(input: ContextInput): ContextRisk {
  const { backed, homeRestDays, awayRestDays } = input;
  if (homeRestDays == null && awayRestDays == null) {
    return { level: "tidak-diketahui", flags: ["Jadwal sebelumnya tidak tersedia."], scoreMultiplier: 1 };
  }
  const flags: string[] = [];
  let level: ContextRiskLevel = "rendah";

  const raise = (to: "sedang" | "tinggi") => {
    if (to === "tinggi" || level === "rendah") level = to;
  };

  if (homeRestDays != null && awayRestDays != null && homeRestDays < SHORT_REST_DAYS && awayRestDays < SHORT_REST_DAYS) {
    flags.push(`Kedua tim beristirahat pendek (${homeRestDays} vs ${awayRestDays} hari) — laga cenderung kacau.`);
    raise("sedang");
  }

  if (backed) {
    const backedRest = backed === "home" ? homeRestDays : awayRestDays;
    const opponentRest = backed === "home" ? awayRestDays : homeRestDays;
    const backedMatches = backed === "home" ? input.homeMatches14 : input.awayMatches14;
    if (backedRest != null && backedRest < SHORT_REST_DAYS) {
      flags.push(`Tim yang didukung hanya beristirahat ${backedRest} hari — risiko rotasi & kelelahan.`);
      raise("tinggi");
    }
    if (backedRest != null && opponentRest != null && opponentRest - backedRest >= REST_GAP_DAYS) {
      flags.push(`Ketimpangan istirahat: tim yang didukung ${backedRest} hari vs lawan ${opponentRest} hari.`);
      raise("sedang");
    }
    if (backedMatches != null && backedMatches >= 3) {
      flags.push(`Tim yang didukung memainkan ${backedMatches} laga dalam 14 hari terakhir.`);
      raise("sedang");
    }
  }

  return { level, flags, scoreMultiplier: scoreMultiplierFor(level) };
}

/** Tentukan tim yang didukung dari kunci market engine. */
export function backedSideFromKey(marketKey: string): BackedSide {
  const key = marketKey.toLowerCase();
  if (key.startsWith("ml:home") || key.startsWith("ah:home")) return "home";
  if (key.startsWith("ml:away") || key.startsWith("ah:away")) return "away";
  return null;
}
