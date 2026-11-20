import { defineConfig } from "vitest/config";
import path from "node:path";

// Same as vitest.config.ts but WITHOUT the generous TX_* env overrides,
// so tests here run with the production defaults (5s / 10s) from the route.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
