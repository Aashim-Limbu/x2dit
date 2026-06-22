import { test, expect } from "vitest";
import { FULL_ROUNDS, PARTIAL_ROUNDS, INTERNAL_DIAG } from "./poseidon2-constants";

test("t=2 constant shapes", () => {
  expect(FULL_ROUNDS[2]).toHaveLength(8);
  FULL_ROUNDS[2].forEach((row) => expect(row).toHaveLength(2));
  expect(INTERNAL_DIAG[2]).toHaveLength(2);
  expect(PARTIAL_ROUNDS[2].length).toBeGreaterThan(0);
});

test("t=3 constant shapes", () => {
  expect(FULL_ROUNDS[3]).toHaveLength(8);
  FULL_ROUNDS[3].forEach((row) => expect(row).toHaveLength(3));
  expect(INTERNAL_DIAG[3]).toHaveLength(3);
  expect(PARTIAL_ROUNDS[3].length).toBeGreaterThan(0);
});
