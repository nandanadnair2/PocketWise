import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Generous lock-wait settings so the 20-way concurrency race doesn't
      // trip Prisma's default 5s timeout. Production defaults live in the route.
      TX_MAX_WAIT_MS: "30000",
      TX_TIMEOUT_MS: "60000",
    },
  },
});
