import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
    passWithNoTests: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
