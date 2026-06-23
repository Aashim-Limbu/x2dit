import { test, expect, vi, afterEach } from "vitest";

afterEach(() => vi.restoreAllMocks());

test("runWithdraw fetches path by note denom+leafIndex then submits", async () => {
  const getPath = vi.fn().mockResolvedValue({
    leaf_index: 3, root: "1", root_hex: "00", path_elements: [], path_indices: [],
  });
  const postWithdraw = vi.fn().mockResolvedValue({ tx_hash: "deadbeef" });
  const prove = vi.fn().mockResolvedValue({ proof: { pi_a: [], pi_b: [], pi_c: [] }, publicSignals: ["1", "2", "3", "10"] });
  vi.doMock("../relayer/client", () => ({ getPath, postWithdraw }));
  vi.doMock("../proof/prove", () => ({ prove }));
  vi.doMock("../proof/proofconv", () => ({
    buildWithdrawBody: () => ({ proof: "{}", root: "00", nullifier_hash: "00", recipient_fr: "00", recipient: "G", denom: 10 }),
  }));
  const { runWithdraw } = await import("./run");
  const note = "zkh-note-v2:10:0a:0b:3";
  const res = await runWithdraw(note, "GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW");
  expect(getPath).toHaveBeenCalledWith(10, 3);
  expect(res.txHash).toBe("deadbeef");
});
