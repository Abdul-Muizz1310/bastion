import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 75,
        // Per-module floor (plan "Coverage"): the security core is held higher than the rest.
        "src/platform/**": { lines: 90 },
        "src/capabilities/**": { lines: 90 },
        "src/dossier/**": { lines: 90 },
      },
    },
  },
});
