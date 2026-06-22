import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // snarkjs proving is single-threaded + heavy; avoid worker pool surprises.
    pool: "forks",
    testTimeout: 120_000,
  },
});
