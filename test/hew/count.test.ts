// The same scenes against a real Hew build. Skipped unless HEW_CLI is set:
//   HEW_CLI=/path/to/hew-cli npm run test:hew

import { test } from "node:test";
import assert from "node:assert/strict";
import { HewCliHost } from "../../src/host/hew-cli.ts";
import { countParts } from "../../src/cutlist/count.ts";
import { formatMarkdown } from "../../src/cutlist/format.ts";
import { SCENES } from "../scenes.ts";

const skip = process.env.HEW_CLI ? false : "set HEW_CLI to run against Hew";

for (const scene of SCENES) {
  test(`${scene.id} ${scene.title} (live)`, { skip }, async () => {
    const host = await HewCliHost.start();
    try {
      await scene.build(host);
      const res = await countParts(host, { pieces: true });
      const errors = scene.check(res);
      assert.deepEqual(errors, [], `${errors.join("\n")}\n\n${formatMarkdown(scene.id, res)}`);
    } finally {
      host.close();
    }
  });
}
