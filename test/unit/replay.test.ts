import { test } from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../../src/host/host.ts";
import { ReplayHost, exchangeKey } from "../../src/host/replay.ts";

test("exchange keys ignore the order of object keys, not of arrays", () => {
  assert.equal(exchangeKey("m", { a: 1, b: { c: 2, d: 3 } }), exchangeKey("m", { b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(exchangeKey("m", { path: ["a", "b"] }), exchangeKey("m", { path: ["b", "a"] }));
});

test("a replay answers recorded queries, replays refusals, and refuses the rest", async () => {
  const host = new ReplayHost({
    hew: "test",
    exchanges: [
      { method: "hew.query.scene", params: {}, result: { materials: [] } },
      { method: "hew.attr.get", params: { target: "mat_1", ns: "x" }, refusal: "unknown_entity" },
    ],
  });
  assert.deepEqual(await host.query("hew.query.scene", {}), { materials: [] });
  await assert.rejects(host.query("hew.attr.get", { ns: "x", target: "mat_1" }), (e: unknown) => e instanceof HostError && e.refusal === "unknown_entity");
  await assert.rejects(host.query("hew.query.faces", { path: ["obj_1"] }), /not in the recording/);
  await assert.rejects(host.transact([]), /read-only/);
});
