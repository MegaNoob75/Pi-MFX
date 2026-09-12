import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Optional: `PIMFX_ENGINE=http://192.168.1.10:8080 npm run dev` to talk to a live Pi. */
const engine = (process.env.PIMFX_ENGINE ?? "").trim();
const engineWs = engine.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    "import.meta.env.VITE_PIMFX_ENGINE": JSON.stringify(engine)
  },
  server: {
    port: 5173,
    proxy: engine
      ? {
          "/api": {
            target: engine,
            timeout: 360000,
            proxyTimeout: 360000
          },
          "/ws": { target: engineWs, ws: true }
        }
      : undefined
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
