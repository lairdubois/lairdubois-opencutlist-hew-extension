// Acceptance cases for linked copies (hew3d/hew#60, milestone 2).
//
// The one invariant every case leans on: placements of one shared solid
// show up in `occurrences` as object rows with the SAME id under different
// paths (that's how M1 already reports a component's object). An
// independent copy has a new id. This holds whatever form the implicit
// component takes in M2, so the cases don't depend on its details.

import { Hew, board, material, type Row } from "./hew.ts";
import * as api from "./adapter.ts";

export class Fail extends Error {}
export const expect = (cond: unknown, msg: string): void => {
  if (!cond) throw new Fail(msg);
};

export type Case = {
  id: string;
  title: string;
  /** "m1": true on the M1 build already (validates the harness); "m2": linked copies. */
  needs: "m1" | "m2";
  run: (hew: Hew) => Promise<string | void>;
};

const BOARD: [number, number, number] = [0.6, 0.4, 0.018];

const solidRows = (rows: Row[], name: string) => rows.filter((r) => r.kind === "object" && r.name === name);
const loc = (r: Row) => [...r.path, r.id];

/** How many placements, and how many distinct solids, a named board has. */
async function census(hew: Hew, name: string) {
  const rows = solidRows(await hew.occurrences(), name);
  return { rows, placements: rows.length, solids: new Set(rows.map((r) => r.id)).size };
}

async function expectLinked(hew: Hew, name: string, placements: number) {
  const c = await census(hew, name);
  expect(c.placements === placements, `${name}: ${c.placements} placements, expected ${placements}`);
  expect(c.solids === 1, `${name}: ${c.solids} distinct solids, expected 1 shared solid (copies not linked)`);
  return c;
}

async function measure(hew: Hew, r: Row) {
  return hew.query("hew.query.measure", { path: loc(r) });
}

/** The definition a placement's solid lives in: the instance right above it. */
async function definitionOf(hew: Hew, r: Row): Promise<string> {
  const above = r.path[r.path.length - 1];
  expect(above, `${r.name} has no instance above it`);
  const rows = await hew.occurrences();
  const inst = rows.find((x) => x.id === above && x.kind === "instance");
  expect(inst?.definition, `no definition for ${above}`);
  return inst!.definition!;
}

async function historyDepth(hew: Hew): Promise<number> {
  // history.status isn't classed read-only on the bus, so it goes through a transaction
  const [s] = await hew.transact([{ method: "hew.history.status", params: {} }]);
  return s.entries?.undo?.length ?? s.undo_depth ?? 0;
}

export const CASES: Case[] = [
  // ---------------------------------------------------------------- baseline (M1)
  {
    id: "B1",
    title: "Component copies share one solid (the invariant the cases rely on)",
    needs: "m1",
    async run(hew) {
      const side = await board(hew, "Side", [0, 0, 0], BOARD);
      const cmp = await hew.one("hew.component.create", { members: [side] });
      await api.copy(hew, [cmp.instance], [0, 1, 0], 2);
      await expectLinked(hew, "Side", 3);
      const insts = (await hew.occurrences()).filter((r) => r.kind === "instance");
      expect(new Set(insts.map((r) => r.definition)).size === 1, "instances don't share one definition");
    },
  },
  {
    id: "B2",
    title: "make_unique on one placement gives it its own solid",
    needs: "m1",
    async run(hew) {
      const side = await board(hew, "Side", [0, 0, 0], BOARD);
      const cmp = await hew.one("hew.component.create", { members: [side] });
      await hew.one("hew.attr.set", { target: cmp.component, ns: "org.opencutlist", key: "grain", value: "length" });
      const made = await api.copy(hew, [cmp.instance], [0, 1, 0], 2);
      await hew.one("hew.component.make_unique", { instance: made.ids[0] });
      // count by placement, not by name: the copied solid's name isn't kept (see note)
      const rows = (await hew.occurrences()).filter((r) => r.kind === "object" && r.path.length === 1);
      const solids = new Set(rows.map((r) => r.id)).size;
      expect(rows.length === 3 && solids === 2, `expected 3 placements of 2 solids, got ${rows.length}/${solids}`);
      const lone = rows.find((r) => r.path[0] === made.ids[0])!;
      const notes: string[] = [];
      if (lone.name !== "Side") notes.push(`the unique copy's solid lost its name ("Side" → ${JSON.stringify(lone.name)})`);
      const attrs = JSON.stringify(await hew.query("hew.attr.get", { target: await definitionOf(hew, lone), ns: "org.opencutlist" }));
      if (!attrs.includes("length")) notes.push("the new definition didn't keep the definition's attributes");
      return notes.length ? `note for M2 (make_unique must keep these): ${notes.join("; ")}` : "name and attributes kept";
    },
  },
  {
    id: "B3",
    title: "mirrored is accumulated along the path (mirror inside mirror reads false)",
    needs: "m1",
    async run(hew) {
      const side = await board(hew, "Side", [0, 0, 0], BOARD);
      const inner = await hew.one("hew.component.create", { members: [side] });
      await hew.one("hew.component.flip_instance", { instance: inner.instance, axis: "x" });
      let r = solidRows(await hew.occurrences(), "Side")[0];
      expect(r.mirrored === true, "one mirror should read mirrored: true");
      const outer = await hew.one("hew.component.create", { members: [inner.instance] });
      await hew.one("hew.component.flip_instance", { instance: outer.instance, axis: "x" });
      r = solidRows(await hew.occurrences(), "Side")[0];
      expect(r.mirrored === false, "mirror inside mirror should read mirrored: false");
    },
  },
  {
    id: "B4",
    title: "Grid copy of a component: 4 × 3 placements of one solid",
    needs: "m1",
    async run(hew) {
      const side = await board(hew, "Side", [0, 0, 0], BOARD);
      const cmp = await hew.one("hew.component.create", { members: [side] });
      await api.gridCopy(hew, [cmp.instance], [
        { count: 4, step: [0.7, 0, 0] },
        { count: 3, step: [0, 0.5, 0] },
      ]);
      await expectLinked(hew, "Side", 12);
    },
  },

  // ---------------------------------------------------------------- linked copies (M2)
  {
    id: "L1",
    title: "Move copy of a loose board links it",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0]);
      await expectLinked(hew, "Shelf", 2);
    },
  },
  {
    id: "L2",
    title: "Array copy (×3) links all four, in one undo step",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      const before = await historyDepth(hew);
      await api.copy(hew, [b], [0, 0.5, 0], 3);
      await expectLinked(hew, "Shelf", 4);
      expect((await historyDepth(hew)) === before + 1, "the array should be one undo step");
      await hew.one("hew.history.undo", {});
      const c = await census(hew, "Shelf");
      expect(c.placements === 1, `undo should leave 1 placement, got ${c.placements}`);
    },
  },
  {
    id: "L3",
    title: "Grid copy (4 × 3) of a loose board links all twelve",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Slat", [0, 0, 0], BOARD);
      await api.gridCopy(hew, [b], [
        { count: 4, step: [0.7, 0, 0] },
        { count: 3, step: [0, 0.5, 0] },
      ]);
      await expectLinked(hew, "Slat", 12);
    },
  },
  {
    id: "L4",
    title: "Rotate copy (polar ×3) links all four",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Spoke", [0.1, 0, 0], [0.5, 0.05, 0.02]);
      await api.rotateCopy(hew, [b], [0, 0, 0], [0, 0, 1], Math.PI / 2, 3);
      await expectLinked(hew, "Spoke", 4);
    },
  },
  {
    id: "L5",
    title: "Mirrored copy stays linked and reads mirrored",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Upright", [0.2, 0, 0], [0.4, 0.3, 0.018]);
      await api.mirroredCopy(hew, b, [0, 0, 0], [0, 0, 0]);
      const c = await expectLinked(hew, "Upright", 2);
      const m = c.rows.map((r) => r.mirrored).sort();
      expect(m[0] === false && m[1] === true, `expected one plain and one mirrored placement, got ${JSON.stringify(m)}`);
    },
  },
  {
    id: "L6",
    title: "Copy of a group links every board in it",
    needs: "m2",
    async run(hew) {
      const a = await board(hew, "Rail", [0, 0, 0], [0.8, 0.05, 0.02]);
      const b = await board(hew, "Stile", [0, 0.2, 0], [0.05, 0.6, 0.02]);
      const g = await hew.one("hew.group.create", { members: [a, b] });
      await api.copy(hew, [g.group], [1, 0, 0]);
      await expectLinked(hew, "Rail", 2);
      await expectLinked(hew, "Stile", 2);
    },
  },
  {
    id: "L7",
    title: "Editing through one copy edits all of them (push/pull)",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0], 2);
      const { rows } = await expectLinked(hew, "Shelf", 3);
      const second = rows[1];
      const top = [0.3, 1.2, 0.018]; // top face of the second copy, in world coordinates
      await api.pushPullThrough(hew, loc(second), top, 0.002);
      const after = await expectLinked(hew, "Shelf", 3);
      for (const r of after.rows) {
        const t = (await measure(hew, r)).extents[2];
        expect(Math.abs(t - 0.02) < 1e-6, `${loc(r).join("/")} thickness ${t}, expected 0.020 on every copy`);
      }
    },
  },
  {
    id: "L8",
    title: "A boolean through one copy never splits it off silently",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Leg", [0, 0, 0], [0.05, 0.05, 0.7]);
      await api.copy(hew, [b], [0.5, 0, 0], 3);
      const { rows } = await expectLinked(hew, "Leg", 4);
      const v0 = (await measure(hew, rows[0])).volume;
      const tool = await board(hew, "Mortise tool", [0.51, 0.015, 0.6], [0.03, 0.02, 0.06]);
      try {
        await api.subtractThrough(hew, loc(rows[1]), tool);
      } catch (e: any) {
        if (e instanceof api.ApiNotSettled) throw e;
        await expectLinked(hew, "Leg", 4);
        return `refused explicitly (${e.refusal}), copies untouched: acceptable`;
      }
      const after = await expectLinked(hew, "Leg", 4);
      for (const r of after.rows) {
        const v = (await measure(hew, r)).volume;
        expect(v < v0 - 1e-9, `${loc(r).join("/")} volume unchanged: the mortise should show on every linked leg`);
      }
    },
  },
  {
    id: "L9",
    title: "Unlink by path: one copy leaves, keeps its attributes, the remap is returned",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0], 2);
      const { rows } = await expectLinked(hew, "Shelf", 3);
      const def = await definitionOf(hew, rows[0]);
      await hew.one("hew.attr.set", { target: def, ns: "org.opencutlist", key: "grain", value: "length" });
      const res = await api.unlink(hew, loc(rows[2]));
      expect(res && Object.keys(res).length > 0, "unlink should return the new ids (remap)");
      const all = (await hew.occurrences()).filter((r) => r.kind === "object");
      const lone = all.find((r) => r.path.length && all.filter((x) => x.id === r.id).length === 1)!;
      expect(lone, "can't find the unlinked copy");
      expect(lone.name === "Shelf", `the unlinked copy lost its name ("Shelf" → ${JSON.stringify(lone.name)})`);
      const attrs = await hew.query("hew.attr.get", { target: await definitionOf(hew, lone), ns: "org.opencutlist" });
      expect(JSON.stringify(attrs).includes("length"), "the unlinked copy lost the definition's attributes");
    },
  },
  {
    id: "L10",
    title: "Independent copy (Paste New) is not linked",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.independentCopy(hew, [b], [0, 1, 0]);
      const c = await census(hew, "Shelf");
      expect(c.placements === 2 && c.solids === 2, `expected 2 independent solids, got ${c.placements}/${c.solids}`);
    },
  },
  {
    id: "L11",
    title: "Name, material and attributes stay per placement; definition data is shared",
    needs: "m2",
    async run(hew) {
      const red = await material(hew, "Red", [200, 40, 40]);
      const b = await board(hew, "Door", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0], 2);
      const { rows } = await expectLinked(hew, "Door", 3);
      const inst = rows.map((r) => r.path[r.path.length - 1]);
      expect(inst.every(Boolean), "linked placements should each have an instance above the solid");
      await hew.one("hew.entity.rename", { id: inst[0], name: "Left door" });
      await hew.one("hew.material.paint", { id: inst[1], material: red });
      await hew.one("hew.attr.set", { target: inst[2], ns: "org.opencutlist", key: "is_grain_group", value: true });
      const def = await definitionOf(hew, rows[0]);
      await hew.one("hew.attr.set", { target: def, ns: "org.opencutlist", key: "role", value: "front_panel" });
      await expectLinked(hew, "Door", 3); // none of that splits the link
      const all = await hew.occurrences();
      const byId = (id: string) => all.find((r) => r.id === id)!;
      expect(byId(inst[0]).name === "Left door" && byId(inst[1]).name !== "Left door", "name should be per placement");
      expect(byId(inst[1]).material === red && byId(inst[0]).material !== red, "material should be per placement");
      const a2 = JSON.stringify(await hew.query("hew.attr.get", { target: inst[2], ns: "org.opencutlist" }));
      const a0 = JSON.stringify(await hew.query("hew.attr.get", { target: inst[0], ns: "org.opencutlist" }));
      expect(a2.includes("is_grain_group") && !a0.includes("is_grain_group"), "placement attributes should not leak");
      for (const r of rows) {
        const d = JSON.stringify(await hew.query("hew.attr.get", { target: await definitionOf(hew, r), ns: "org.opencutlist" }));
        expect(d.includes("front_panel"), "definition attributes should reach every copy");
      }
    },
  },
  {
    id: "L12",
    title: "A face painted through one copy shows on every copy (edge banding)",
    needs: "m2",
    async run(hew) {
      const band = await material(hew, "Edge band", [240, 240, 230]);
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0], 1);
      const { rows } = await expectLinked(hew, "Shelf", 2);
      await api.paintFaceThrough(hew, loc(rows[1]), [0.3, 1.0, 0.009], band); // front edge of the copy
      for (const r of rows) {
        const faces = (await hew.query("hew.query.faces", { path: loc(r) })).faces as any[];
        expect(faces.some((f) => f.material === band), `${loc(r).join("/")}: the painted edge doesn't show`);
      }
    },
  },
  {
    id: "L13",
    title: "Nested linking multiplies: 2 linked cabinets × 2 linked sides = 4 placements of 1 solid",
    needs: "m2",
    async run(hew) {
      const s = await board(hew, "Cabinet side", [0, 0, 0], [0.018, 0.5, 0.7]);
      const made = await api.copy(hew, [s], [0.6, 0, 0]);
      await expectLinked(hew, "Cabinet side", 2);
      const rows = solidRows(await hew.occurrences(), "Cabinet side");
      const tops = rows.map((r) => (r.path.length ? r.path[r.path.length - 1] : r.id));
      const g = await hew.one("hew.group.create", { members: [...new Set([...tops, ...made.ids])] });
      await api.copy(hew, [g.group], [1.5, 0, 0]);
      await expectLinked(hew, "Cabinet side", 4);
    },
  },
  {
    id: "L14",
    title: "Links survive save and reopen (.hew)",
    needs: "m2",
    async run(hew) {
      const b = await board(hew, "Shelf", [0, 0, 0], BOARD);
      await api.copy(hew, [b], [0, 1, 0], 2);
      await expectLinked(hew, "Shelf", 3);
      const file = `${process.env.OCL_TMP ?? "/tmp"}/ocl-l14-${process.pid}.hew`;
      await hew.one("hew.doc.save", { path: file });
      const again = await Hew.start();
      try {
        await again.one("hew.doc.open", { path: file });
        await expectLinked(again, "Shelf", 3);
      } finally {
        again.close();
      }
    },
  },
];
