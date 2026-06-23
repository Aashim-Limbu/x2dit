import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proofABC, publicFields, buildWithdrawBody } from "./proofconv";

const root = resolve(__dirname, "../../../../artifacts/circuit");
const proof = JSON.parse(readFileSync(resolve(root, "proof.json"), "utf8"));
const pub = JSON.parse(readFileSync(resolve(root, "public.json"), "utf8"));

test("proofABC yields 128/256/128 hex", () => {
  const { a, b, c } = proofABC(proof);
  expect(a).toMatch(/^[0-9a-f]{128}$/);
  expect(b).toMatch(/^[0-9a-f]{256}$/);
  expect(c).toMatch(/^[0-9a-f]{128}$/);
});

test("publicFields matches known artifact hex", () => {
  const f = publicFields(pub);
  expect(f.root).toBe("0012f4149c6840973c2dee91e8ecd7dd2839be83b143607114e7b4cd70bd86d4");
  expect(f.nullifier_hash).toBe("0750bb23dba2ab2e1f42e914eb8582103d00e462df6864ecec9646ce61311b2b");
  expect(f.recipient_fr).toBe("0000000000000000000000001234567890abcdef1234567890abcdef12345678");
  expect(f.denom).toBe(10);
});

test("buildWithdrawBody injects recipient + stringifies proof", () => {
  const body = buildWithdrawBody(proof, pub, "GABC");
  expect(body.recipient).toBe("GABC");
  expect(body.denom).toBe(10);
  const parsed = JSON.parse(body.proof);
  expect(parsed).toHaveProperty("a");
  expect(parsed).toHaveProperty("b");
  expect(parsed).toHaveProperty("c");
});
