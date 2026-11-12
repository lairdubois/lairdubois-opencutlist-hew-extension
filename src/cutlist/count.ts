// Part counting over Hew's `occurrences`, following the part model settled in
// the concept mapping 0.4 (#1, §1 and §2):
//
//   - Hew reports facts, the plugin applies the rule.
//   - A part is any component placement with solids of its own, at any depth,
//     sized from those solids only (`scope: "own"`). Groups are transparent:
//     their solids count toward the enclosing component.
//   - Identical parts are counted by definition (linked copies are definitions
//     too), split on material, size and mirroring (unless `symmetrical`).
//   - Hardware (a placement painted with a hardware material) is one item;
//     machining bodies are left out of the size; open objects are reported.
//   - Loose objects (no definition): still Boris's call. Listed as a part
//     placed once unless `loose: false`.

import type { Host } from "../host/host.ts";
import { locator, locatorKey, type Members, type Occurrence } from "../model.ts";
import { NS, TYPE_ORDER, VIRTUAL, readMaterials, type MaterialType } from "./materials.ts";

export type CountOptions = {
  /** List loose objects (no definition) as parts placed once. Default true. */
  loose?: boolean;
  includeHidden?: boolean;
  /** Also list the solids of multi-solid parts (glued-up blanks). */
  pieces?: boolean;
  /** Longest extent first. Default true. */
  autoOrient?: boolean;
  /** Material name → type, for materials the model doesn't type. */
  types?: Record<string, MaterialType>;
};

export type Part = {
  label: string;
  name: string;
  kind: "component" | "loose";
  definition: string | null;
  material: string | null;
  materialType: MaterialType;
  /** Millimeters, rounded to 0.1. */
  size: [number, number, number];
  mirrored: boolean;
  count: number;
  /** Own solids: more than one is a glued-up blank. */
  solids: number;
  /** Placements nested inside this part. */
  nested: number;
  placements: string[][];
  pieces?: { name: string | null; size: [number, number, number] }[];
};

export type CutList = {
  parts: Part[];
  hardware: { name: string; definition: string; count: number }[];
  open: { name: string | null; id: string; kind: "open" | "split"; count: number }[];
  machining: number;
  assemblies: { name: string; definition: string; count: number }[];
  /** Rows of different definitions with the same material, size and mirroring: candidates for Hew's "link them?". */
  lookAlike: string[][];
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function letters(n: number): string {
  let s = "";
  n += 1;
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function countParts(host: Host, opts: CountOptions = {}): Promise<CutList> {
  const { loose = true, includeHidden = false, pieces = false, autoOrient = true } = opts;
  const rows: Occurrence[] = (await host.query("hew.query.occurrences", { include_hidden: includeHidden })).occurrences;
  const materials = await readMaterials(host, opts.types);

  // `solid` and `family` on object rows
  const openKind = new Map<string, "open" | "split">();
  for (const r of rows) if (r.kind === "object" && r.solid === false) openKind.set(r.id, r.family != null ? "split" : "open");

  // `members` on instance and group rows. `path` holds instances only: the members of an
  // instance have path [...path, instance], the members of a group have the group's own path.
  const byLoc = new Map<string, Occurrence>();
  for (const r of rows) byLoc.set(locatorKey(locator(r)), r);
  const ownOf = (c: Occurrence): { objects: Occurrence[]; instances: Occurrence[] } => {
    const m: Members | undefined = c.members;
    if (!m) throw new Error(`row ${c.id} has no members: this needs Hew M2 or later`);
    const base = c.kind === "group" ? c.path : locator(c);
    const out = { objects: [] as Occurrence[], instances: [] as Occurrence[] };
    const at = (id: string) => byLoc.get(locatorKey([...base, id]));
    for (const id of m.objects) {
      const r = at(id);
      if (r) out.objects.push(r);
    }
    for (const id of m.instances) {
      const r = at(id);
      if (r) out.instances.push(r);
    }
    for (const id of m.groups) {
      const g = at(id);
      if (!g) continue;
      const sub = ownOf(g); // groups are transparent
      out.objects.push(...sub.objects);
      out.instances.push(...sub.instances);
    }
    return out;
  };

  // hardware placements are single items: nothing under them is listed
  const hardwareIds = new Set(rows.filter((r) => r.kind === "instance" && materials.type(r.material) === "hardware").map((r) => r.id));
  const underHardware = (r: Occurrence) => r.path.some((id) => hardwareIds.has(id));

  // definition-local faces, the same for every placement of a definition
  const faceCache = new Map<string, any[]>();
  async function facesOf(o: Occurrence) {
    const k = `${o.path.length ? o.path[o.path.length - 1] : ""}/${o.id}`;
    if (!faceCache.has(k)) faceCache.set(k, (await host.query("hew.query.faces", { path: locator(o) })).faces);
    return faceCache.get(k)!;
  }

  // Boris's order: the placement's own material (not edge or veneer), else votes over its own solids' faces, else inherited
  async function partMaterial(c: Occurrence, solids: Occurrence[]): Promise<string | null> {
    if (c.material && !VIRTUAL.has(materials.type(c.material))) return c.material;
    const votes = new Map<string, number>();
    for (const o of solids) {
      for (const f of await facesOf(o)) {
        const m = f.material ?? o.material;
        if (m && !VIRTUAL.has(materials.type(m))) votes.set(m, (votes.get(m) ?? 0) + 1);
      }
    }
    const best = [...votes].sort(
      (a, b) => b[1] - a[1] || TYPE_ORDER.indexOf(materials.type(a[0])) - TYPE_ORDER.indexOf(materials.type(b[0])),
    )[0];
    return best ? best[0] : c.material_effective;
  }

  const symmetricalCache = new Map<string, boolean>();
  async function symmetrical(def: string): Promise<boolean> {
    if (!symmetricalCache.has(def)) {
      let v = false;
      try {
        v = /"symmetrical"\s*:\s*true/.test(JSON.stringify(await host.query("hew.attr.get", { target: def, ns: NS })));
      } catch {
        // no dictionary
      }
      symmetricalCache.set(def, v);
    }
    return symmetricalCache.get(def)!;
  }

  const oriented = (extentsM: number[]): [number, number, number] => {
    let size = extentsM.map((v) => v * 1000);
    if (autoOrient) size = [...size].sort((a, b) => b - a);
    return size.map(r1) as [number, number, number];
  };

  const parts = new Map<string, Part>();
  const hardware = new Map<string, { name: string; definition: string; count: number }>();
  const assemblies = new Map<string, { name: string; definition: string; count: number }>();
  const open = new Map<string, { name: string | null; id: string; kind: "open" | "split"; count: number }>();
  let machining = 0;

  for (const c of rows) {
    if (c.kind !== "instance" || underHardware(c)) continue;
    // OpenCutList names a part after its definition; the placement's own name is a fallback
    const name = c.definition_name || c.name || "Part";
    if (hardwareIds.has(c.id)) {
      const h = hardware.get(c.definition!) ?? { name, definition: c.definition!, count: 0 };
      h.count++;
      hardware.set(c.definition!, h);
      continue;
    }
    const own = ownOf(c);
    const solids: Occurrence[] = [];
    const excluded: string[] = [];
    for (const o of own.objects) {
      if (materials.type(o.material) === "machining") {
        machining++;
        excluded.push(o.id);
        continue;
      }
      if (openKind.has(o.id)) {
        const k = `${c.definition}/${o.id}`;
        const e = open.get(k) ?? { name: o.name ?? name, id: o.id, kind: openKind.get(o.id)!, count: 0 };
        e.count++;
        open.set(k, e);
        excluded.push(o.id);
        continue;
      }
      solids.push(o);
    }
    if (!solids.length) {
      if (own.instances.length) {
        const a = assemblies.get(c.definition!) ?? { name, definition: c.definition!, count: 0 };
        a.count++;
        assemblies.set(c.definition!, a);
      }
      continue;
    }
    // the part frame over the placement's own solids: `scope: "own"` still takes every
    // own Object, open surfaces included, so machining bodies and open objects are excluded
    const pf = await host.query("hew.query.part_frame", { path: locator(c), scope: "own", ...(excluded.length ? { exclude: excluded } : {}) });
    const size = oriented(pf.extents);
    const material = await partMaterial(c, solids);
    const mirrored = c.mirrored && !(await symmetrical(c.definition!));
    const k = JSON.stringify([c.definition, material, size, mirrored]);
    let p = parts.get(k);
    if (!p) {
      p = {
        label: "", name, kind: "component", definition: c.definition, material: materials.name(material),
        materialType: materials.type(material), size, mirrored, count: 0, solids: solids.length,
        nested: own.instances.length, placements: [],
      };
      if (pieces && solids.length > 1) {
        p.pieces = [];
        for (const o of solids) {
          const opf = await host.query("hew.query.part_frame", { path: locator(o) });
          p.pieces.push({ name: o.name, size: opf.extents.map((v: number) => r1(v * 1000)) as [number, number, number] });
        }
      }
      parts.set(k, p);
    }
    p.count++;
    p.placements.push(locator(c));
  }

  // loose objects: no definition (Boris's call; listed as a part placed once)
  if (loose) {
    for (const o of rows) {
      if (o.kind !== "object" || o.path.length || materials.type(o.material) === "machining") continue;
      if (openKind.has(o.id)) {
        open.set(o.id, { name: o.name, id: o.id, kind: openKind.get(o.id)!, count: 1 });
        continue;
      }
      const pf = await host.query("hew.query.part_frame", { path: [o.id] });
      parts.set(o.id, {
        label: "", name: o.name || "Loose solid", kind: "loose", definition: null,
        material: materials.name(o.material), materialType: materials.type(o.material),
        size: oriented(pf.extents), mirrored: false, count: 1, solids: 1, nested: 0, placements: [[o.id]],
      });
    }
  }

  const list = [...parts.values()].sort(
    (a, b) => (a.material ?? "~").localeCompare(b.material ?? "~") || b.size[2] - a.size[2] || b.size[0] - a.size[0] || b.size[1] - a.size[1],
  );
  list.forEach((p, i) => (p.label = letters(i)));
  const alike = new Map<string, string[]>();
  for (const p of list) {
    const k = JSON.stringify([p.material, p.size, p.mirrored]);
    alike.set(k, [...(alike.get(k) ?? []), p.label]);
  }
  return {
    parts: list,
    hardware: [...hardware.values()],
    open: [...open.values()],
    machining,
    assemblies: [...assemblies.values()],
    lookAlike: [...alike.values()].filter((g) => g.length > 1),
  };
}
