// The counting rule on recorded Hew answers: no Hew needed.
// The fixtures come from tools/record-fixtures.ts on a real build (named in each file).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReplayHost, type Recording } from "../../src/host/replay.ts";
import { countParts } from "../../src/cutlist/count.ts";
import { formatMarkdown } from "../../src/cutlist/format.ts";
import { SCENES } from "../scenes.ts";

for (const scene of SCENES) {
  test(`${scene.id} ${scene.title}`, async () => {
    const recording: Recording = JSON.parse(readFileSync(new URL(`../fixtures/${scene.id}.json`, import.meta.url), "utf8"));
    const res = await countParts(new ReplayHost(recording), { pieces: true });
    const errors = scene.check(res);
    assert.deepEqual(errors, [], `${errors.join("\n")}\n\n${formatMarkdown(`${scene.id} (recorded on ${recording.hew})`, res)}`);
  });
}
