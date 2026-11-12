// Records what Hew answers while counting each synthetic scene, so the unit
// tests can replay it without Hew. Re-run on each new Hew build:
//   HEW_CLI=/path/to/hew-cli npm run record

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { HewCliHost, hewCliPath } from "../src/host/hew-cli.ts";
import { RecordingHost, type Recording } from "../src/host/replay.ts";
import { countParts } from "../src/cutlist/count.ts";
import { SCENES } from "../test/scenes.ts";

const cli = hewCliPath();
const version = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim();
const dir = new URL("../test/fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });

let failed = 0;
for (const scene of SCENES) {
  const host = await HewCliHost.start(cli);
  try {
    await scene.build(host);
    const rec = new RecordingHost(host);
    const res = await countParts(rec, { pieces: true });
    const errors = scene.check(res);
    if (errors.length) {
      failed++;
      console.log(`FAIL ${scene.id}: ${errors.join("; ")} (not recorded)`);
      continue;
    }
    const recording: Recording = { hew: version, note: scene.title, exchanges: rec.exchanges };
    writeFileSync(new URL(`${scene.id}.json`, dir), JSON.stringify(recording, null, 1) + "\n");
    console.log(`recorded ${scene.id} (${rec.exchanges.length} queries) on ${version}`);
  } finally {
    host.close();
  }
}
process.exit(failed ? 1 : 0);
