import pino from "pino";

/**
 * `pino-pretty` adalah paket terpisah yang di-inline oleh
 * `esbuild-plugin-pino` saat build. Di lingkungan serverless paket itu bisa
 * gagal dimuat saat cold start dengan galat
 * `unable to determine transport target for "pino-pretty"`, dan seluruh
 * fungsi mati sebelum satu request pun dilayani.
 *
 * Karena itu mode cantik hanya dipakai saat benar-benar jalan di mesin
 * pengembang: ada terminal, bukan NODE_ENV=production, bukan Vercel, bukan
 * proses yang dibundel. Selain itu pakai JSON — yang justru lebih baik untuk
 * log Vercel karena bisa difilter per field.
 */
function usePrettyTransport(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(usePrettyTransport()
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
