import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/*
 * PORT and BASE_PATH are only needed to *serve* the app (dev / preview).
 * A production build has no server to bind, so requiring them there made
 * `vite build` impossible on CI, Vercel, or any machine that does not set
 * them. Validate strictly when a server starts; fall back to a safe default
 * when building.
 */
function requireServeEnv(): { port: number; basePath: string } {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  const basePath = process.env.BASE_PATH;
  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }
  return { port, basePath };
}

export default defineConfig(async ({ command }) => {
  const isServe = command === "serve";
  const { port, basePath } = isServe
    ? requireServeEnv()
    : { port: 0, basePath: process.env.BASE_PATH ?? "/" };

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    /* Only meaningful when a dev/preview server is running. */
    ...(isServe
      ? {
          server: {
            port,
            strictPort: true,
            host: "0.0.0.0",
            allowedHosts: true,
            proxy: {
              "/api": {
                target: "http://localhost:8080",
                changeOrigin: true,
              },
            },
            fs: {
              strict: true,
            },
          },
          preview: {
            port,
            host: "0.0.0.0",
            allowedHosts: true,
          },
        }
      : {}),
  };
});
