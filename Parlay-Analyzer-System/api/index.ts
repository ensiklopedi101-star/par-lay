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

/**
 * Tipe yang benar untuk "aplikasi Express dipanggil sebagai request listener".
 *
 * `Express` dari `@types/express` hanyalah `interface Application {}` yang
 * TIDAK punya call signature — `app(req, res)` karena itu ditolak TypeScript
 * dengan `TS2349: This expression is not callable`. Di runtime Express memang
 * callable (ia mendelegasikan ke `http.Server`), tetapi tipe publiknya belum
 * mencerminkan itu.
 *
 * Daripada memakai `any` (yang mematikan seluruh pemeriksaan di sini), tipe
 * yang sempit dan jujur dipakai: persis signature yang dibutuhkan Node.
 */
type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

const handleRequest = app as unknown as RequestListener;

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
  const currentUrl = req.url ?? "/";
  const queryIndex = currentUrl.indexOf("?");
  const query = queryIndex >= 0 ? currentUrl.slice(queryIndex) : "";
  req.url = `${path}${query}`;

  handleRequest(req, res);
}
