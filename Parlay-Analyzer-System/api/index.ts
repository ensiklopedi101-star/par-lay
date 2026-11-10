/**
 * Handler serverless Vercel untuk seluruh API Express.
 *
 * Vercel menyerahkan request sebagai `(req, res)` Node biasa. Karena aplikasi
 * ini Express murni (tanpa WebSocket, tanpa SSE, tanpa tulis ke disk — semuanya
 * sudah diperiksa), Express bisa menangani request secara langsung: tidak perlu
 * adapter seperti `serverless-http`.
 *
 * `vercel.json` menulis ulang setiap `/api/*` ke berkas ini. Express di dalam
 * `app` sudah menangani prefiks `/api`, jadi URL aslinya harus dipulihkan
 * sebelum diserahkan — kalau tidak, route menjadi `/api/api/healthz`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../artifacts/api-server/src/app";

/** Kembalikan path asli yang diterima Vercel sebelum rewrite. */
function originalPath(req: IncomingMessage): string {
  const header = req.headers["x-original-url"] ?? req.headers["x-rewrite-url"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string" && raw.startsWith("/")) return raw;

  /* Fallback: `req.url` di Vercel bisa datang tanpa prefiks `/api`. */
  const url = req.url ?? "/";
  return url.startsWith("/api") ? url : `/api${url}`;
}

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const path = originalPath(req);
  const queryIndex = (req.url ?? "").indexOf("?");
  const query = queryIndex >= 0 ? (req.url ?? "").slice(queryIndex) : "";
  req.url = `${path}${query}`;

  app(req as any, res as any);
}
