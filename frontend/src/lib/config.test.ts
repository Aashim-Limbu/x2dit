import { test, expect } from "vitest";
import {
  FIELD, denomIndex, denomAmountUsdc, DENOM_VALUES, relayerPath, EVM,
} from "./config";

test("field modulus is BN254 scalar field", () => {
  expect(FIELD).toBe(
    21888242871839275222246405745257275088548364400416034343698204186575808495617n,
  );
});

test("denom value maps to EVM index", () => {
  expect(DENOM_VALUES).toEqual([1, 10, 100]);
  expect(denomIndex(1)).toBe(0);
  expect(denomIndex(10)).toBe(1);
  expect(denomIndex(100)).toBe(2);
  expect(() => denomIndex(5)).toThrow();
});

test("denom amount is 6-decimal USDC", () => {
  expect(denomAmountUsdc(1)).toBe(1_000_000n);
  expect(denomAmountUsdc(100)).toBe(100_000_000n);
});

test("relayer path is same-origin proxied", () => {
  expect(relayerPath("path?denom=10&leaf_index=0")).toBe(
    "/api/relayer/path?denom=10&leaf_index=0",
  );
});

test("mockUsdc address present", () => {
  expect(EVM.mockUsdc.toLowerCase()).toBe(
    "0x1a39a02a3a776b354a5c97373dde715c419c6ab5",
  );
});
