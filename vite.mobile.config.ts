import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// Standalone SPA build for the Capacitor (Android) APK.
// Outputs to dist/mobile and is consumed by capacitor.config.ts (webDir).
// Web preview / production still uses the main vite.config.ts (TanStack Start SSR).
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  root: path.resolve(__dirname, "mobile"),
  base: "./",
  // IMPORTANT: serve assets from project-root /public (models, textures, sounds)
  // so the Capacitor APK bundles /models/**, /sounds/**, etc.
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/mobile"),
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
