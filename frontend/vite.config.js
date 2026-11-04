import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the browser always calls same-origin relative paths;
// the dev server forwards them to the local FastAPI process.
const backend = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backend,
      "/healthz": backend,
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    // three.js is large and changes rarely, so it gets its own long-cached chunk.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
