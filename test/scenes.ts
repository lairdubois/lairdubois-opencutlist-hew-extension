// Synthetic models, each with the cut list the settled rule should give.
// `build` draws the model through a Host; `check` returns what's wrong (empty = right).
// Used live (test/hew/) and to record the fixtures the unit tests replay (tools/record-fixtures.ts).

import type { Host } from "../src/host/host.ts";
import { NS } from "../src/cutlist/materials.ts";
import type { CutList } from "../src/cutlist/count.ts";

export type Scene = { id: string; title: string; build: (host: Host) => Promise<void>; check: (res: CutList) => string[] };

const one = async (host: Host, method: string, params: Record<string, unknown>) => (await host.transact([{ method, params }]))[0];

/** A board of `size` meters [x, y, z], corner at `at`, as one transaction. */
async function board(host: Host, name: string, at: number[], size: number[], material?: string): Promise<string> {
  const [x, y, z] = at;
  const [dx, dy, dz] = size;
  const res = await host.transact([
    { method: "hew.sketch.draw_rect", as: "r", params: { plane: { origin: [0, 0, z], normal: [0, 0, 1] }, corner_a: [x, y, z], corner_b: [x + dx, y + dy, z] } },
    { method: "hew.solid.extrude", as: "o", params: { region: { $ref: "r#/region_id" }, distance: dz } },
    { method: "hew.entity.rename", params: { id: { $ref: "o#/object_id" }, name } },
    ...(material ? [{ method: "hew.material.set_default", params: { id: { $ref: "o#/object_id" }, material } }] : []),
  ]);
  return res[1].object_id;
}
const material = async (host: Host, name: string, color: number[], type: string) => {
  const m = (await one(host, "hew.material.create", { name, color })).material;
  await one(host, "hew.attr.set", { target: m, ns: NS, key: "type", value: type });
  return m as string;
};
const comp = async (host: Host, members: string[], name: string) => {
  const c = await one(host, "hew.component.create", { members });
  await one(host, "hew.entity.rename", { id: c.component, name });
  return c as { component: string; instance: string };
};
const copies = (host: Host, id: string, step: number[], count: number) =>
  one(host, "hew.entity.move", { ids: [id], translation: step, copy: { count } });

const find = (res: CutList, name: string) => res.parts.filter((p) => p.name === name);
const want = (errors: string[], cond: boolean, msg: string) => {
  if (!cond) errors.push(msg);
};

export const SCENES: Scene[] = [
  {
    id: "S1",
    title: "Panel with dowels: parts inside parts, sized from own solids only",
    async build(host) {
      const ply = await material(host, "Plywood 18", [220, 190, 150], "sheet_good");
      const beech = await material(host, "Beech", [210, 170, 120], "solid_wood");
      const panel = await board(host, "Panel", [0, 0, 0], [0.6, 0.4, 0.018], ply);
      const d = await board(host, "Dowel", [0.05, 0.05, 0.018], [0.008, 0.008, 0.03], beech);
      const dowel = await comp(host, [d], "Dowel");
      await copies(host, dowel.instance, [0.1, 0, 0], 3);
      const rows = (await host.query("hew.query.occurrences", {})).occurrences;
      const dowels = rows.filter((r: any) => r.kind === "instance" && r.definition === dowel.component).map((r: any) => r.id);
      await comp(host, [panel, ...dowels], "Panel");
    },
    check(res) {
      const e: string[] = [];
      const p = find(res, "Panel");
      want(e, p.length === 1 && p[0].count === 1, "one Panel");
      want(e, p[0]?.size.join() === "600,400,18", `Panel size from its own solid: got ${p[0]?.size}`);
      want(e, p[0]?.nested === 4, `Panel holds 4 nested dowels, got ${p[0]?.nested}`);
      const d = find(res, "Dowel");
      want(e, d.length === 1 && d[0].count === 4, `4 dowels as one row, got ${d.map((x) => x.count)}`);
      want(e, d[0]?.size.join() === "30,8,8", `dowel size 30×8×8, got ${d[0]?.size}`);
      return e;
    },
  },
  {
    id: "S2",
    title: "Glued-up leg (two boards in one component) placed four times: one part ×4",
    async build(host) {
      const oak = await material(host, "Oak", [180, 140, 90], "solid_wood");
      const a = await board(host, "Lamination A", [0, 0, 0], [0.05, 0.025, 0.7], oak);
      const b = await board(host, "Lamination B", [0, 0.025, 0], [0.05, 0.025, 0.7], oak);
      const leg = await comp(host, [a, b], "Leg");
      await copies(host, leg.instance, [0.5, 0, 0], 3);
    },
    check(res) {
      const e: string[] = [];
      const l = find(res, "Leg");
      want(e, l.length === 1 && l[0].count === 4, `Leg ×4 as one row, got ${l.map((x) => x.count)}`);
      want(e, l[0]?.size.join() === "700,50,50", `blank 700×50×50, got ${l[0]?.size}`);
      want(e, l[0]?.solids === 2, "2 solids (glued-up)");
      want(e, l[0]?.pieces?.length === 2, "pieces listed when asked");
      return e;
    },
  },
  {
    id: "S3",
    title: "Left and right sides: a mirrored placement is a separate part, unless symmetrical",
    async build(host) {
      const side = await comp(host, [await board(host, "Side", [0, 0, 0], [0.018, 0.5, 0.7])], "Side");
      const made = await copies(host, side.instance, [0.6, 0, 0], 1);
      await one(host, "hew.component.flip_instance", { instance: made.ids[0], axis: "x" });
      const shelf = await comp(host, [await board(host, "Shelf", [0, 0, 0.3], [0.56, 0.48, 0.018])], "Shelf");
      const madeS = await copies(host, shelf.instance, [3, 0, 0], 1);
      await one(host, "hew.component.flip_instance", { instance: madeS.ids[0], axis: "x" });
      await one(host, "hew.attr.set", { target: shelf.component, ns: NS, key: "symmetrical", value: true });
    },
    check(res) {
      const e: string[] = [];
      const s = find(res, "Side");
      want(e, s.length === 2 && s.every((p) => p.count === 1), `Side: left and right as 2 rows, got ${s.map((x) => `${x.count}${x.mirrored ? "m" : ""}`)}`);
      const sh = find(res, "Shelf");
      want(e, sh.length === 1 && sh[0].count === 2, `Shelf (symmetrical) ×2 as one row, got ${sh.map((x) => x.count)}`);
      return e;
    },
  },
  {
    id: "S4",
    title: "Hardware, machining, assembly, hidden and loose",
    async build(host) {
      const metal = await material(host, "Steel", [150, 150, 160], "hardware");
      const mach = await material(host, "Machining", [255, 0, 0], "machining");
      const ply = await material(host, "Plywood 18", [220, 190, 150], "sheet_good");
      // a hinge made of three bodies, painted with a hardware material: one item, ×2
      const h1 = await board(host, "Cup", [0, 0, 0], [0.035, 0.035, 0.012]);
      const h2 = await board(host, "Arm", [0.035, 0, 0], [0.05, 0.02, 0.01]);
      const h3 = await board(host, "Plate", [0.085, 0, 0], [0.03, 0.035, 0.002]);
      const hinge = await comp(host, [h1, h2, h3], "Hinge");
      await one(host, "hew.material.paint", { id: hinge.instance, material: metal });
      await copies(host, hinge.instance, [0, 0.2, 0], 1);
      // a door with a machining body inside it: the groove tool doesn't change its size
      const door = await board(host, "Door", [1, 0, 0], [0.7, 0.45, 0.018], ply);
      const tool = await board(host, "Groove", [1.6, -0.01, 0.006], [0.01, 0.47, 0.03], mach);
      const doorC = await comp(host, [door, tool], "Door");
      // a cabinet holding only components: an assembly, not a part
      await comp(host, [doorC.instance], "Cabinet");
      // a shelf hidden through a tag: left out
      const hidden = await comp(host, [await board(host, "Hidden shelf", [3, 0, 0], [0.5, 0.3, 0.018], ply)], "Hidden shelf");
      await one(host, "hew.tag.create", { path: ["Spare"] });
      await one(host, "hew.tag.assign", { id: hidden.instance, path: ["Spare"] });
      await one(host, "hew.tag.set_visible", { path: ["Spare"], visible: false });
      // a loose board, never copied (Boris's call: listed as a part placed once)
      await board(host, "Loose top", [4, 0, 0], [0.8, 0.4, 0.025], ply);
    },
    check(res) {
      const e: string[] = [];
      want(e, res.hardware.some((h) => h.name === "Hinge" && h.count === 2), `Hinge ×2 as hardware, got ${JSON.stringify(res.hardware)}`);
      want(e, !res.parts.some((p) => ["Cup", "Arm", "Plate", "Hinge"].includes(p.name)), "hinge bodies must not be parts");
      const d = find(res, "Door");
      want(e, d.length === 1 && d[0].size.join() === "700,450,18", `Door 700×450×18 without the tool, got ${d[0]?.size}`);
      want(e, res.machining === 1, `1 machining body left out, got ${res.machining}`);
      want(e, res.assemblies.some((a) => a.name === "Cabinet"), "Cabinet is an assembly");
      want(e, !res.parts.some((p) => p.name === "Cabinet"), "Cabinet is not a part");
      want(e, !res.parts.some((p) => p.name === "Hidden shelf"), "hidden shelf left out");
      const l = find(res, "Loose top");
      want(e, l.length === 1 && l[0].kind === "loose" && l[0].count === 1, "loose board listed once");
      return e;
    },
  },
  {
    id: "S5",
    title: "Groups inside a part: their solids and the parts in them count toward it",
    async build(host) {
      // a drawer box: the bottom sits in a group, and a pull component sits in another group
      const ply = await material(host, "Plywood 12", [220, 190, 150], "sheet_good");
      const front = await board(host, "Front", [0, 0, 0], [0.4, 0.012, 0.15], ply);
      const bottom = await board(host, "Bottom", [0, 0.012, 0], [0.4, 0.3, 0.012], ply);
      const g1 = (await one(host, "hew.group.create", { members: [bottom] })).group;
      const pull = await comp(host, [await board(host, "Pull", [0.18, -0.03, 0.06], [0.04, 0.03, 0.02])], "Pull");
      const g2 = (await one(host, "hew.group.create", { members: [pull.instance] })).group;
      const drawer = await comp(host, [front, g1, g2], "Drawer");
      await copies(host, drawer.instance, [0, 0, 0.2], 1);
    },
    check(res) {
      const e: string[] = [];
      const d = find(res, "Drawer");
      want(e, d.length === 1 && d[0].count === 2, `Drawer ×2 as one row, got ${d.map((x) => x.count)}`);
      want(e, d[0]?.solids === 2, `Drawer has 2 own solids (front + bottom in a group), got ${d[0]?.solids}`);
      want(e, d[0]?.size.join() === "400,312,150", `Drawer sized from front and bottom only, got ${d[0]?.size}`);
      want(e, d[0]?.nested === 1, `Drawer holds 1 nested pull (inside a group), got ${d[0]?.nested}`);
      const p = find(res, "Pull");
      want(e, p.length === 1 && p[0].count === 2, `Pull ×2, got ${p.map((x) => x.count)}`);
      return e;
    },
  },
  {
    id: "S6",
    title: "Linked copies (M2 default): a board copied three times is one part ×4",
    async build(host) {
      const oak = await material(host, "Oak", [180, 140, 90], "solid_wood");
      const shelf = await board(host, "Shelf", [0, 0, 0], [0.8, 0.25, 0.02], oak);
      await copies(host, shelf, [0, 0, 0.3], 3);
    },
    check(res) {
      const e: string[] = [];
      const s = find(res, "Shelf");
      want(e, s.length === 1 && s[0].count === 4 && s[0].kind === "component", `Shelf ×4 by definition, got ${s.map((x) => `${x.kind}×${x.count}`)}`);
      want(e, s[0]?.size.join() === "800,250,20", `Shelf 800×250×20, got ${s[0]?.size}`);
      return e;
    },
  },
];
