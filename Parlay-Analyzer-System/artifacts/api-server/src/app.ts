import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { allowedOrigins, createRateLimiter } from "./lib/security";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
/* CORS: same-origin (panel) + daftar ALLOWED_ORIGINS; origin asing tidak
 * mendapat header izin. Permintaan tanpa Origin (cron/server) tetap jalan. */
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin)) callback(null, true);
    else callback(null, false);
  },
}));
app.use(createRateLimiter());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

export default app;
