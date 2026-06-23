import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { buildCircuitInput } from "./prove";
import { proofABC, publicFields } from "./proofconv";

const circuit = resolve(__dirname, "../../../../circuits/build");
const wasm = resolve(circuit, "withdraw_js/withdraw.wasm");
const zkey = resolve(circuit, "withdraw_final.zkey");
const vk = JSON.parse(readFileSync(resolve(circuit, "verification_key.json"), "utf8"));
const input = JSON.parse(readFileSync(resolve(circuit, "input.json"), "utf8"));

test("buildCircuitInput shapes match the circuit input.json keys", () => {
  const built = buildCircuitInput({
    secret: BigInt(input.secret),
    nullifier: BigInt(input.nullifier),
    denom: Number(input.denomination),
    path: {
      leaf_index: 0,
      root: input.root,
      root_hex: "",
      path_elements: input.pathElements,
      path_indices: input.pathIndices,
    },
    recipientG: "GBLU6A6OKK35QZR5SIYYNF7PFMKIBEFPOJ6OZP3NM2HWN67DUTFOMIXW",
  });
  expect(Object.keys(built).sort()).toEqual(
    ["denomination", "nullifier", "nullifierHash", "pathElements", "pathIndices", "recipient", "root", "secret"].sort(),
  );
});

test("fullProve(input.json) produces a proof that verifies", async () => {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true);
  // and our converters accept snarkjs output shape
  const abc = proofABC(proof as never);
  expect(abc.a).toMatch(/^[0-9a-f]{128}$/);
  expect(publicFields(publicSignals).denom).toBe(10);
});
