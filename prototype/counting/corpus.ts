// Runs the counting prototype on real model files (.skp or .hew).
// Usage: HEW_CLI=… node corpus.ts [--out dir] model1.skp model2.skp …
// The files are opened in a private headless session; nothing is written back.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { Hew } from "../../tests/acceptance/linked-copies/hew.ts";
import { countParts, formatResult } from "./count.ts";

const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args.splice(args.indexOf("--out"), 2)[1] : null;
if (outDir) mkdirSync(outDir, { recursive: true });

for (const file of args) {
  const hew = await Hew.start();
  const t0 = Date.now();
  try {
    await hew.one("hew.doc.open", { path: file });
    const res = await countParts(hew, { pieces: true });
    const title = `${basename(file)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
    const text = formatResult(title, res);
    console.log(text + "\n");
    if (outDir) {
      const stem = basename(file).replace(/\.[^.]+$/, "");
      writeFileSync(`${outDir}/${stem}.md`, text + "\n");
      writeFileSync(`${outDir}/${stem}.json`, JSON.stringify(res, null, 2));
    }
  } catch (e: any) {
    console.log(`# ${basename(file)}\nERROR ${e.refusal ?? ""} ${e.message}\n`);
  } finally {
    hew.close();
  }
}
