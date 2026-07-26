import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Password untuk admin actions.
 * Hanya gunakan ADMIN_PASSWORD dari environment. Tidak ada fallback hardcoded.
 * Set ADMIN_PASSWORD di Replit Secrets agar admin routes dapat digunakan.
 */
export const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["x-admin-password"] ?? req.headers["X-Admin-Password"];
  const bodyPassword =
    typeof req.body === "object" && req.body !== null ? req.body["adminPassword"] : undefined;
  const provided = String(header ?? bodyPassword ?? "");

  if (!ADMIN_PASSWORD) {
    logger.warn("Admin action attempted but ADMIN_PASSWORD is not configured. Set ADMIN_PASSWORD in Replit Secrets.");
    res.status(401).json({ error: "Admin password not configured" });
    return;
  }

  if (provided !== ADMIN_PASSWORD) {
    logger.warn({ ip: req.ip, path: req.path }, "Unauthorized admin action attempt");
    res.status(401).json({ error: "Unauthorized — invalid admin password" });
    return;
  }

  next();
}
