import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./scheduler";

/**
 * Titik masuk server.
 *
 * Ada dua mode menjalankan yang sangat berbeda:
 *
 *  1. **Proses panjang** (lokal, Replit, VPS) — ada `PORT`, ada penerima
 *     socket, server mendengarkan dan scheduler `node-cron` hidup.
 *  2. **Serverless** (Vercel) — TIDAK ada `PORT`. Platform yang mengatur
 *     pendengarannya; kita hanya menyediakan handler. Timer `node-cron` tidak
 *     ada artinya di sini karena instance hidup beberapa detik lalu mati.
 *
 * Sebelumnya modul ini `throw` bila `PORT` kosong, sehingga setiap request di
 * Vercel gagal saat cold start. Sekarang aplikasi diekspor dan `listen()`
 * hanya dipanggil bila memang ada port untuk didengarkan.
 *
 * Pemicu terjadwal di serverless memakai `/api/cron?action=...` dari luar
 * (lihat `routes/cron.ts`), bukan `node-cron`.
 */

export { app };
export default app;

function listenIfPortProvided(): void {
  const rawPort = process.env["PORT"];
  if (!rawPort) {
    logger.info(
      "PORT tidak diset — berjalan sebagai handler serverless. Pemicu terjadwal lewat /api/cron?action=...",
    );
    return;
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    logger.error({ rawPort }, "Nilai PORT tidak valid — server tidak dijalankan");
    return;
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    if (process.env["ODDS_API_KEY"]) {
      startScheduler();
    } else {
      logger.warn(
        "ODDS_API_KEY not set — scheduler disabled. Set the env var to enable automatic odds fetching.",
      );
    }
  });
}

/*
 * Hanya dengarkan bila modul ini dijalankan langsung sebagai program, bukan
 * ketika di-import oleh bundler serverless (yang hanya ingin `app`).
 */
listenIfPortProvided();
