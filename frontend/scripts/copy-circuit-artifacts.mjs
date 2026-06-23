import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../artifacts/circuit");
const DST = path.resolve(__dirname, "../public/circuit");
const FILES = ["withdraw.wasm", "withdraw_final.zkey", "verification_key.json"];

fs.mkdirSync(DST, { recursive: true });
for (const f of FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) {
    console.warn(`WARN: missing artifact ${from} (proving will fail until built)`);
    continue;
  }
  fs.copyFileSync(from, path.join(DST, f));
  console.log(`copied ${f}`);
}
