/**
 * Entry point serverless untuk Vercel.
 *
 * Berkas ini sengaja diletakkan di dalam `artifacts/api-server/src`, BUKAN di
 * folder `api/`. Alasannya sudah dibuktikan lewat build Vercel yang gagal:
 *
 *   Vercel memaksa `moduleResolution: nodenext` pada setiap berkas `.ts` yang
 *   ada di folder `api/`, lalu TypeScript menelusuri SELURUH rantai import-nya
 *   sampai ke `src/app.ts` dan `src/routes/*`. Proyek ini ditulis untuk
 *   `moduleResolution: bundler`, sehingga di bawah nodenext muncul galat palsu:
 *   import relatif dianggap wajib berekstensi `.js` (TS2834/TS2835) dan
 *   `pino-http` (CommonJS) dianggap tanpa call signature (TS2349).
 *
 *   Tidak satu pun galat itu nyata — bundel esbuild berjalan normal. Karena
 *   itu TypeScript dikeluarkan sepenuhnya dari jalur build Vercel: berkas ini
 *   dibundel lebih dulu menjadi `api/index.js` (JavaScript murni) lewat
 *   `pnpm run build:vercel`. Vercel menerima `.js` tanpa pemeriksaan tipe.
 *
 * Typecheck tetap berjalan di tempat yang benar: `tsconfig.json` api-server
 * memakai `moduleResolution: bundler`, dan `tsc --build` dari akar repo
 * memeriksa berkas ini bersama sisa backend.
 *
 * Alur sistem tidak berubah: satu domain, `/api/*` ditangani Express yang
 * sama, cron yang sama, route yang sama.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app";

/**
 * Tipe yang jujur untuk "aplikasi Express dipanggil sebagai request listener".
 *
 * `Express` dari `@types/express` hanyalah `interface Application {}` tanpa
 * call signature, sehingga `app(req, res)` ditolak dengan TS2349 meski di
 * runtime Express memang callable (ia mendelegasikan ke `http.Server`).
 * Casting argumen ke `any` tidak menolong — yang ditolak adalah objeknya.
 */
type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

const handleRequest = app as unknown as RequestListener;

/** Kembalikan path asli yang diterima Vercel sebelum rewrite. */
function originalPath(req: IncomingMessage): string {
  const header = req.headers["x-original-url"] ?? req.headers["x-rewrite-url"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string" && raw.startsWith("/")) return raw;

  /* Fallback: `req.url` dari Vercel bisa datang tanpa prefiks `/api`. */
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
