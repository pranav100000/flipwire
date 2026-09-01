import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    coverage: {
      all: true,
      exclude: [
        "src/app/**",
        "src/db/**",
        "src/lib/process-runtime.ts",
        "src/processes/**",
        "src/testing/**",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    },
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    sequence: {
      concurrent: false
    }
  }
});
