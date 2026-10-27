import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // three.js alone minifies to ~760 kB (mostly the single three.core.js module), so it cannot be split
    // below the 500 kB default. It is only downloaded when the 3D viewer opens; app chunks stay far smaller.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // three.js and the React renderer get their own chunks; both stay behind the viewer's lazy import.
        codeSplitting: {
          // Otherwise a group also captures its dependencies (react), making the entry import the chunk.
          includeDependenciesRecursively: false,
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
            { name: "react-three", test: /node_modules[\\/](@react-three|its-fine|zustand|suspend-react)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin API calls in development; the backend runs on :8000.
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
