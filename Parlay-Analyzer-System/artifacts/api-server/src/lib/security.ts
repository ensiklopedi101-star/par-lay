/**
 * Utilitas keamanan bersama: perbandingan rahasia timing-safe,
 * normalisasi limit query, dan rate limiter memori sederhana.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Bandingkan dua rahasia tanpa membocorkan panjang/prefix lewat timing. */
export function safeEqual(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Paksa limit query ke rentang aman; tidak pernah NaN/tak terbatas. */
export function clampLimit(raw: unknown, fallback = 200, max = 500): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

interface Bucket { count: number; resetAt: number }

/**
 * Rate limiter per-IP berbasis memori. Di serverless ia bekerja
 * per-instance (bukan global) — tetap menahan brute-force/scrape
 * kasar tanpa dependensi eksternal; bukan pengganti WAF.
 */
export function createRateLimiter(options: { windowMs?: number; max?: number } = {}) {
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const max = options.max ?? 600;
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    }
    const key = req.ip ?? "unknown";
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)).toString());
      res.status(429).json({ error: "Terlalu banyak permintaan — coba lagi nanti." });
      return;
    }
    next();
  };
}

/** Origin CORS yang diizinkan dari env ALLOWED_ORIGINS (koma). Kosong = same-origin saja. */
export function allowedOrigins(): string[] {
  return (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
