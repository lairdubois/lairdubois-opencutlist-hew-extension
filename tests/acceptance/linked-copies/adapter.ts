// Every call whose milestone-2 shape isn't public yet lives here, so the
// cases don't change when the names are settled. Each one is marked TBD
// with what it's meant to do. Only these TBD calls can turn a case into
// SKIP ("API not settled"), and only when Hew rejects the call's shape
// (unknown field, wrong locator form, unknown command), never because the
// behaviour is wrong. Any other error stays an ERROR.

import type { Hew } from "./hew.ts";

/**
 * OCL_SIMULATE_LINKS=1 checks the cases themselves on a build without linked
 * copies (M1): before a copy gesture, each loose object or group is folded
 * into a component, which is what M2 is expected to do implicitly. Off by
 * default: an acceptance run must test the real gesture.
 */
const SIMULATE = process.env.OCL_SIMULATE_LINKS === "1";

export { SIMULATE };

/**
 * Runs a copy gesture. With OCL_SIMULATE_LINKS=1, loose objects and groups are
 * first folded into components in the SAME transaction, so the gesture stays
 * one undo step, as M2's implicit linking is expected to be.
 */
async function copyGesture(hew: Hew, method: string, ids: string[], params: Record<string, unknown>) {
  if (!SIMULATE || ids.every((id) => id.startsWith("ins_"))) {
    return hew.one(method, { ids, ...params });
  }
  const cmds: { method: string; params: unknown; as?: string }[] = [];
  const refs = ids.map((id, i) => {
    if (id.startsWith("ins_")) return id;
    cmds.push({ method: "hew.component.create", as: `c${i}`, params: { members: [id] } });
    return { $ref: `c${i}#/instance` };
  });
  cmds.push({ method, params: { ids: refs, ...params } });
  const res = await hew.transact(cmds);
  return res[res.length - 1];
}

/** Plain copy gestures. M1 shapes; in M2 they are expected to link by default. */
export const copy = (hew: Hew, ids: string[], translation: number[], count = 1) =>
  copyGesture(hew, "hew.entity.move", ids, { translation, copy: { count } });

export const gridCopy = (hew: Hew, ids: string[], grid: { count: number; step: number[] }[]) =>
  copyGesture(hew, "hew.entity.move", ids, { copy: { grid } });

export const rotateCopy = (hew: Hew, ids: string[], pivot: number[], axis: number[], angle: number, count: number) =>
  copyGesture(hew, "hew.entity.rotate", ids, { pivot, axis, angle, copy: { count } });

/** A mirrored copy: copy, then mirror the copy with a negative scale (M1 bakes reflections). */
export async function mirroredCopy(hew: Hew, id: string, translation: number[], anchor: number[]) {
  const made = await copy(hew, [id], translation);
  if (SIMULATE) {
    for (const ins of made.ids) await hew.one("hew.component.flip_instance", { instance: ins, axis: "x" });
  } else {
    await hew.one("hew.entity.scale", { ids: made.ids, anchor, factors: [-1, 1, 1] });
  }
  return made;
}

/** Thrown by a TBD call whose shape Hew doesn't accept yet: the case is skipped. */
export class ApiNotSettled extends Error {}

const SHAPE = /invalid_params|unknown field|unknown variant|missing field|locator needs|expected a string|invalid type|unknown method|unknown_command|-32602|-32601/i;

async function tbd<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e: any) {
    const text = `${e?.refusal ?? ""} ${e?.message ?? ""}`;
    if (SHAPE.test(text)) throw new ApiNotSettled(text.trim());
    throw e;
  }
}


/**
 * M2 contract: a face locator addressed by `path` takes `at` in the leaf's own
 * frame (the definition's coordinates, as `hew.query.faces { path }` and
 * raycast report them), not in world coordinates. The cases name world points,
 * so map them through the inverse of the placement's `world_pose` (3x4, row
 * major; rigid or mirrored, so the inverse is the transpose of the rotation).
 */
async function toLeafFrame(hew: Hew, path: string[], at: number[]): Promise<number[]> {
  const rows = await hew.occurrences();
  const row = rows.find((r) => r.id === path[path.length - 1] && JSON.stringify(r.path) === JSON.stringify(path.slice(0, -1)));
  if (!row) return at;
  const m = row.world_pose; // [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]
  const d = [at[0] - m[3], at[1] - m[7], at[2] - m[11]];
  // scale may be non-unit (mirrors are -1): divide each column by its squared length
  const col = (j: number) => [m[j], m[4 + j], m[8 + j]];
  return [0, 1, 2].map((j) => {
    const c = col(j);
    const len2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    return (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / len2;
  });
}

/** M2 contract: `make_unique { path }` takes the instance path; a trailing object id (the solid under the placement) is dropped. */
const instancePath = (path: string[]) => (path.length && path[path.length - 1].startsWith("obj_") ? path.slice(0, -1) : path);

/** TBD (M2): the independent copy ("Paste New"). Assumed: a flag on the copy form. */
export const independentCopy = (hew: Hew, ids: string[], translation: number[]) =>
  tbd(() => hew.one("hew.entity.move", { ids, translation, copy: { count: 1, linked: false } }));

/** TBD (M2): Unlink one placement by path; returns the id remap. M1 takes `instance` only. */
export const unlink = (hew: Hew, path: string[]) => tbd(() => hew.one("hew.component.make_unique", { path: instancePath(path), cascade: true }));

/** TBD (M2): push/pull a face of one placement, addressed by occurrence path + world point. */
export const pushPullThrough = (hew: Hew, path: string[], at: number[], distance: number) =>
  tbd(async () => hew.one("hew.solid.push_pull", { face: { path, at: await toLeafFrame(hew, path, at) }, distance }));

/** TBD (M2): subtract a tool solid from one placement, addressed by path (M1 takes ids `a`, `b`). */
export const subtractThrough = (hew: Hew, path: string[], tool: string) =>
  tbd(() => hew.one("hew.solid.subtract", { a: { path }, b: tool }));

/** TBD (M2): paint one face of one placement, addressed by path + world point. */
export const paintFaceThrough = (hew: Hew, path: string[], at: number[], material: string) =>
  tbd(async () => hew.one("hew.material.paint", { face: { path, at: await toLeafFrame(hew, path, at) }, material }));
