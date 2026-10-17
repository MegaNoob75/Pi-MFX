import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { userGuidePlugin } from "./guide.mjs";

export default defineConfig({
  plugins: [react(), userGuidePlugin()],
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/access": { target: "http://127.0.0.1:8080" },
      "/api": {
        target: "http://127.0.0.1:8080",
        timeout: 360000,
        proxyTimeout: 360000
      },
      "/ws": { target: "ws://127.0.0.1:8080", ws: true }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
