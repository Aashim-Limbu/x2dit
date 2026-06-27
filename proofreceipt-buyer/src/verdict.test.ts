import assert from "node:assert/strict";
import { decodeVerdict } from "./verdict.js";

assert.deepEqual(decodeVerdict(0), []);
assert.deepEqual(decodeVerdict(1), ["allowlist-violation: imports an unknown/non-host-fn"]);
assert.deepEqual(decodeVerdict(2), ["denylist-hit: imports a forbidden host fn"]);
assert.deepEqual(decodeVerdict(4), ["auth-presence: writes storage without importing an auth host fn"]);
assert.deepEqual(decodeVerdict(6), [
  "denylist-hit: imports a forbidden host fn",
  "auth-presence: writes storage without importing an auth host fn",
]);
assert.deepEqual(decodeVerdict(7), [
  "allowlist-violation: imports an unknown/non-host-fn",
  "denylist-hit: imports a forbidden host fn",
  "auth-presence: writes storage without importing an auth host fn",
]);

console.log("decodeVerdict: all assertions passed");
