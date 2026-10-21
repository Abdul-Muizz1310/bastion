import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tier — talks to a real Postgres. Kept out of vitest.config.ts so
 * `pnpm test` stays a fast, hermetic unit run. Every spec in here skips itself
 * when its connection env var is unset.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // Next resolves `server-only` itself; under Vitest it is a no-op marker.
      "server-only": resolve(__dirname, "./tests/unit/helpers/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Shared database: parallel files would race on the same table.
    fileParallelism: false,
  },
});
