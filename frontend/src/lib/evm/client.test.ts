import { test, expect } from "vitest";
import { MOCK_USDC_ABI, POOL_ABI } from "./abis";

test("pool ABI exposes deposit + Deposit event", () => {
  expect(POOL_ABI.find((x) => x.name === "deposit")).toBeTruthy();
  const ev = POOL_ABI.find((x) => x.type === "event" && x.name === "Deposit");
  expect(ev).toBeTruthy();
});

test("mock usdc ABI exposes mint/approve/allowance", () => {
  for (const fn of ["mint", "approve", "allowance"]) {
    expect(MOCK_USDC_ABI.find((x) => x.name === fn)).toBeTruthy();
  }
});
