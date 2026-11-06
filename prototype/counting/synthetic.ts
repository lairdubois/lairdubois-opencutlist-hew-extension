// Synthetic models, each with the cut list the settled rule should give.
// Usage: HEW_CLI=… node synthetic.ts

import { Hew, board, material, type Row } from "../../tests/acceptance/linked-copies/hew.ts";
import { countParts, formatResult, NS, type Result } from "./count.ts";

type Case = { id: string; title: string; build: (hew: Hew) => Promise<void>; check: (res: Result) => string[] };

const comp = async (hew: Hew, members: string[], name?: string) => {
  const c = await hew.one("hew.component.create", { members });
  if (name) await hew.one("hew.entity.rename", { id: c.component, name });
  return c as { component: string; instance: string };
};
const copies = (hew: Hew, id: string, step: number[], count: number) =>
  hew.one("hew.entity.move", { ids: [id], translation: step, copy: { count } });
const setType = (hew: Hew, mat: string, type: string) => hew.one("hew.attr.set", { target: mat, ns: NS, key: "type", value: type });

const find = (res: Result, name: string) => res.parts.filter((p) => p.name === name);
const want = (errors: string[], cond: boolean, msg: string) => {
  if (!cond) errors.push(msg);
};

const CASES: Case[] = [
  {
    id: "S1",
    title: "Panel with dowels: parts inside parts, sized from own solids only",
    async build(hew) {
      const ply = await material(hew, "Plywood 18", [220, 190, 150]);
      await setType(hew, ply, "sheet_good");
      const beech = await material(hew, "Beech", [210, 170, 120]);
      await setType(hew, beech, "solid_wood");
      const panel = await board(hew, "Panel", [0, 0, 0], [0.6, 0.4, 0.018], ply);
      const d = await board(hew, "Dowel", [0.05, 0.05, 0.018], [0.008, 0.008, 0.03], beech);
      const dowel = await comp(hew, [d], "Dowel");
      await copies(hew, dowel.instance, [0.1, 0, 0], 3);
      const rows = await hew.occurrences();
      const dowels = rows.filter((r) => r.kind === "instance" && r.definition === dowel.component).map((r) => r.id);
      await comp(hew, [panel, ...dowels], "Panel");
    },
    check(res) {
      const e: string[] = [];
      const p = find(res, "Panel");
      want(e, p.length === 1 && p[0].count === 1, "one Panel");
      want(e, p[0]?.size.join() === "600,400,18", `Panel size from its own solid: got ${p[0]?.size}`);
      want(e, p[0]?.nested === 4, "Panel holds 4 nested dowels");
      const d = find(res, "Dowel");
      want(e, d.length === 1 && d[0].count === 4, `4 dowels as one row, got ${d.map((x) => x.count)}`);
      want(e, d[0]?.size.join() === "30,8,8", `dowel size 30×8×8, got ${d[0]?.size}`);
      return e;
    },
  },
  {
    id: "S2",
    title: "Glued-up leg (two boards in one component) placed four times: one part ×4",
    async build(hew) {
      const oak = await material(hew, "Oak", [180, 140, 90]);
      await setType(hew, oak, "solid_wood");
      const a = await board(hew, "Lamination A", [0, 0, 0], [0.05, 0.025, 0.7], oak);
      const b = await board(hew, "Lamination B", [0, 0.025, 0], [0.05, 0.025, 0.7], oak);
      const leg = await comp(hew, [a, b], "Leg");
      await copies(hew, leg.instance, [0.5, 0, 0], 3);
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
    async build(hew) {
      const s = await board(hew, "Side", [0, 0, 0], [0.018, 0.5, 0.7]);
      const side = await comp(hew, [s], "Side");
      const made = await copies(hew, side.instance, [0.6, 0, 0], 1);
      await hew.one("hew.component.flip_instance", { instance: made.ids[0], axis: "x" });
      const sh = await board(hew, "Shelf", [0, 0, 0.3], [0.56, 0.48, 0.018]);
      const shelf = await comp(hew, [sh], "Shelf");
      const madeS = await copies(hew, shelf.instance, [3, 0, 0], 1);
      await hew.one("hew.component.flip_instance", { instance: madeS.ids[0], axis: "x" });
      await hew.one("hew.attr.set", { target: shelf.component, ns: NS, key: "symmetrical", value: true });
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
    async build(hew) {
      const metal = await material(hew, "Steel", [150, 150, 160]);
      await setType(hew, metal, "hardware");
      const mach = await material(hew, "Machining", [255, 0, 0]);
      await setType(hew, mach, "machining");
      const ply = await material(hew, "Plywood 18", [220, 190, 150]);
      await setType(hew, ply, "sheet_good");
      // a hinge made of three bodies, painted with a hardware material: one item, ×2
      const h1 = await board(hew, "Cup", [0, 0, 0], [0.035, 0.035, 0.012]);
      const h2 = await board(hew, "Arm", [0.035, 0, 0], [0.05, 0.02, 0.01]);
      const h3 = await board(hew, "Plate", [0.085, 0, 0], [0.03, 0.035, 0.002]);
      const hinge = await comp(hew, [h1, h2, h3], "Hinge");
      await hew.one("hew.material.paint", { id: hinge.instance, material: metal });
      await copies(hew, hinge.instance, [0, 0.2, 0], 1);
      // a door with a machining body inside it: the groove tool doesn't change its size
      const door = await board(hew, "Door", [1, 0, 0], [0.7, 0.45, 0.018], ply);
      const tool = await board(hew, "Groove", [1.6, -0.01, 0.006], [0.01, 0.47, 0.03], mach);
      const doorC = await comp(hew, [door, tool], "Door");
      // a cabinet holding only components: an assembly, not a part
      await comp(hew, [doorC.instance], "Cabinet");
      // a hidden shelf: left out
      const hs = await board(hew, "Hidden shelf", [3, 0, 0], [0.5, 0.3, 0.018], ply);
      const hidden = await comp(hew, [hs], "Hidden shelf");
      // hidden through a tag (hew.view.hide is refused headless on M1)
      await hew.one("hew.tag.create", { path: ["Spare"] });
      await hew.one("hew.tag.assign", { id: hidden.instance, path: ["Spare"] });
      await hew.one("hew.tag.set_visible", { path: ["Spare"], visible: false });
      // a loose board, never copied (open question: listed as a part placed once)
      await board(hew, "Loose top", [4, 0, 0], [0.8, 0.4, 0.025], ply);
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
];

let failed = 0;
for (const c of CASES) {
  const hew = await Hew.start();
  try {
    await c.build(hew);
    const res = await countParts(hew, { pieces: true });
    const errors = c.check(res);
    console.log(`${errors.length ? "FAIL" : "PASS"} ${c.id} ${c.title}`);
    for (const e of errors) console.log(`     - ${e}`);
    if (errors.length || process.env.VERBOSE) console.log(formatResult(c.id, res).replace(/^/gm, "     "));
    failed += errors.length ? 1 : 0;
  } catch (e: any) {
    failed++;
    console.log(`ERROR ${c.id} ${e.refusal ?? ""} ${e.message}`);
  } finally {
    hew.close();
  }
}
process.exit(failed ? 1 : 0);
