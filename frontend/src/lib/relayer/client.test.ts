import { test, expect, vi, afterEach } from "vitest";
import { getPath, postWithdraw, RelayerError } from "./client";

afterEach(() => vi.restoreAllMocks());

test("getPath calls same-origin proxy with query", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        leaf_index: 0, root: "1", root_hex: "00", path_elements: [], path_indices: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const res = await getPath(10, 0);
  expect(fetchMock).toHaveBeenCalledWith("/api/relayer/path?denom=10&leaf_index=0");
  expect(res.leaf_index).toBe(0);
});

test("postWithdraw throws RelayerError on non-200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("UnknownRoot", { status: 400 })),
  );
  await expect(
    postWithdraw({
      proof: "{}", root: "00", nullifier_hash: "00", recipient_fr: "00",
      recipient: "G", denom: 10,
    }),
  ).rejects.toBeInstanceOf(RelayerError);
});
