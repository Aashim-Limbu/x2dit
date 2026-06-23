import { test, expect } from "vitest";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { POOL_ABI } from "./abis";
import { leafIndexFromLogs } from "./deposit";

test("leafIndexFromLogs decodes the Deposit event leafIndex", () => {
  const topics = encodeEventTopics({
    abi: POOL_ABI, eventName: "Deposit",
    args: { denomIndex: 1, commitment: 123n },
  });
  const data = encodeAbiParameters([{ type: "uint32" }], [7]);
  const logs = [{
    address: "0x4c781728f3f53f220c6f226610cd24d8b1e8e7ef",
    topics, data,
  }] as never;
  expect(leafIndexFromLogs(logs)).toBe(7);
});
