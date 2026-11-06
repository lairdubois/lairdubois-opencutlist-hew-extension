// Prototype of OpenCutList's part counting over Hew's `occurrences`,
// following the part model settled in the concept mapping 0.4 (#1, §1, §2):
//
//   - Hew reports facts, the plugin applies the rule.
//   - A part is any component placement with solids of its own, at any
//     depth, sized from those solids only ("scope: own"). Groups are
//     transparent: their solids count toward the enclosing component.
//   - Identical parts are counted by definition (linked copies in M2 are
//     definitions too), split on material, size and mirroring.
//   - Hardware (a component painted with a hardware material) is one item;
//     machining bodies are left out; open objects are reported.
//   - Loose objects (no definition): open question for Boris. Listed as a
//     part placed once unless `loose: false`.
//
// On M1, three M2 reads are simulated: `members` (from path/parent),
// `solid` (from hew.doc.health) and `scope: "own"` (own solids' faces,
// which M1 returns in the definition's local coordinates).

import type { Hew, Row } from "../../tests/acceptance/linked-copies/hew.ts";

export type MaterialType =
  | "solid_wood" | "sheet_good" | "dimensional" | "edge" | "hardware" | "veneer" | "machining" | "unknown";

const TYPE_ORDER: MaterialType[] = [
  "solid_wood", "sheet_good", "dimensional", "hardware", "edge", "veneer", "machining", "unknown",
];
const VIRTUAL = new Set<MaterialType>(["edge", "veneer"]);
export const NS = "org.opencutlist";

export type Options = {
  loose?: boolean; // list loose objects as parts placed once (default true)
  includeHidden?: boolean;
  pieces?: boolean; // also list the solids of multi-solid parts (glued-up blanks)
  autoOrient?: boolean; // longest extent first (default true)
  types?: Record<string, MaterialType>; // material name → type, when not set in the model
};

export type Part = {
  label: string;
  name: string;
  kind: "component" | "loose";
  definition: string | null;
  material: string | null;
  materialType: MaterialType;
  size: [number, number, number]; // mm
  mirrored: boolean;
  count: number;
  solids: number; // own solids (more than 1 = glued-up blank)
  nested: number; // parts nested inside it
  placements: string[][];
  pieces?: { name: string | null; size: [number, number, number] }[];
};

export type Result = {
  parts: Part[];
  hardware: { name: string; definition: string; count: number }[];
  open: { name: string | null; id: string; kind: string; count: number }[];
  machining: number;
  assemblies: { name: string; definition: string; count: number }[];
  /** rows with different definitions but the same material, size and mirroring: candidates for Hew's "link them?" */
  lookAlike: string[][];
};

const r1 = (v: number) => Math.round(v * 10) / 10;

function letters(n: number): string {
  let s = "";
  n += 1;
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function countParts(hew: Hew, opts: Options = {}): Promise<Result> {
  const { loose = true, includeHidden = false, pieces = false, autoOrient = true } = opts;
  const rows = await hew.occurrences({ include_hidden: includeHidden });

  // materials: id → name and type (our attribute on the material, else the options map)
  const scene = await hew.query("hew.query.scene", {});
  const matName = new Map<string, string>((scene.materials ?? []).map((m: any) => [m.id, m.name]));
  const matType = new Map<string, MaterialType>();
  for (const [id, name] of matName) {
    let t: MaterialType | undefined = opts.types?.[name];
    try {
      const a = await hew.query("hew.attr.get", { target: id, ns: NS });
      const v = a?.dictionaries?.[NS]?.type ?? a?.[NS]?.type ?? a?.type;
      if (typeof v === "string") t = v as MaterialType;
    } catch {
      /* no dictionary */
    }
    matType.set(id, t ?? "unknown");
  }
  const typeOf = (id: string | null): MaterialType => (id ? matType.get(id) ?? "unknown" : "unknown");

  // simulated `solid`: health lists the objects that aren't closed solids
  const health = await hew.query("hew.doc.health", {});
  const openKind = new Map<string, string>();
  for (const h of health.rows ?? []) openKind.set(h.object, h.verdict?.kind ?? "open");

  // simulated `members`: an object's container is the last instance of its path
  const key = (p: string[]) => JSON.stringify(p);
  const ownObjects = new Map<string, Row[]>(); // container locator → objects directly in it (groups transparent)
  const nestedInstances = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.kind === "object") push(ownObjects, key(r.path), r);
    if (r.kind === "instance") push(nestedInstances, key(r.path), r);
  }

  // hardware placements are single items: nothing under them is listed
  const hardwareIds = new Set(rows.filter((r) => r.kind === "instance" && typeOf(r.material) === "hardware").map((r) => r.id));
  const underHardware = (r: Row) => r.path.some((id) => hardwareIds.has(id));

  const faceCache = new Map<string, any[]>(); // definition-local faces, same for every placement
  async function facesOf(o: Row) {
    const k = `${o.path.length ? o.path[o.path.length - 1] : ""}/${o.id}`;
    if (!faceCache.has(k)) faceCache.set(k, (await hew.query("hew.query.faces", { path: [...o.path, o.id] })).faces);
    return faceCache.get(k)!;
  }

  // size of a set of own solids, in the container's local axes, scaled by its placement
  async function ownSize(objs: Row[], pose: number[]): Promise<[number, number, number]> {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const o of objs) {
      for (const f of await facesOf(o)) {
        for (const p of f.outer as number[][]) {
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i], p[i]);
            hi[i] = Math.max(hi[i], p[i]);
          }
        }
      }
    }
    // world_pose is 3×4 row major: column j is the image of local axis j
    const scale = [0, 1, 2].map((j) => Math.hypot(pose[j], pose[4 + j], pose[8 + j]));
    return [0, 1, 2].map((i) => (hi[i] - lo[i]) * scale[i] * 1000) as [number, number, number];
  }

  // Boris's material order: the instance's own (not virtual), else votes over its own solids' faces, else inherited
  async function partMaterial(c: Row, objs: Row[]): Promise<string | null> {
    if (c.material && !VIRTUAL.has(typeOf(c.material))) return c.material;
    const votes = new Map<string, number>();
    for (const o of objs) {
      for (const f of await facesOf(o)) {
        const m = f.material ?? o.material;
        if (m && !VIRTUAL.has(typeOf(m))) votes.set(m, (votes.get(m) ?? 0) + 1);
      }
    }
    const best = [...votes].sort(
      (a, b) => b[1] - a[1] || TYPE_ORDER.indexOf(typeOf(a[0])) - TYPE_ORDER.indexOf(typeOf(b[0])),
    )[0];
    return best ? best[0] : c.material_effective;
  }

  const symmetricalCache = new Map<string, boolean>();
  async function symmetrical(def: string): Promise<boolean> {
    if (!symmetricalCache.has(def)) {
      let v = false;
      try {
        const a = JSON.stringify(await hew.query("hew.attr.get", { target: def, ns: NS }));
        v = /"symmetrical"\s*:\s*true/.test(a);
      } catch {
        /* none */
      }
      symmetricalCache.set(def, v);
    }
    return symmetricalCache.get(def)!;
  }

  const parts = new Map<string, Part>();
  const hardware = new Map<string, { name: string; definition: string; count: number }>();
  const assemblies = new Map<string, { name: string; definition: string; count: number }>();
  const open = new Map<string, { name: string | null; id: string; kind: string; count: number }>();
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
    const loc = key([...c.path, c.id]);
    const solids: Row[] = [];
    for (const o of ownObjects.get(loc) ?? []) {
      if (typeOf(o.material) === "machining") {
        machining++;
        continue;
      }
      if (openKind.has(o.id)) {
        const k = `${c.definition}/${o.id}`;
        const e = open.get(k) ?? { name: o.name ?? name, id: o.id, kind: openKind.get(o.id)!, count: 0 };
        e.count++;
        open.set(k, e);
        continue;
      }
      solids.push(o);
    }
    const nested = (nestedInstances.get(loc) ?? []).length;
    if (!solids.length) {
      if (nested) {
        const a = assemblies.get(c.definition!) ?? { name, definition: c.definition!, count: 0 };
        a.count++;
        assemblies.set(c.definition!, a);
      }
      continue;
    }
    let size = await ownSize(solids, c.world_pose);
    if (autoOrient) size = [...size].sort((a, b) => b - a) as [number, number, number];
    size = size.map(r1) as [number, number, number];
    const material = await partMaterial(c, solids);
    const mirrored = c.mirrored && !(await symmetrical(c.definition!));
    const k = JSON.stringify([c.definition, material, size, mirrored]);
    let p = parts.get(k);
    if (!p) {
      p = {
        label: "", name, kind: "component", definition: c.definition, material: material ? matName.get(material) ?? material : null,
        materialType: typeOf(material), size, mirrored, count: 0, solids: solids.length, nested, placements: [],
      };
      if (pieces && solids.length > 1) {
        p.pieces = [];
        for (const o of solids) {
          const pf = await hew.query("hew.query.part_frame", { path: [...o.path, o.id] });
          p.pieces.push({ name: o.name, size: pf.extents.map((v: number) => r1(v * 1000)) });
        }
      }
      parts.set(k, p);
    }
    p.count++;
    p.placements.push([...c.path, c.id]);
  }

  // loose objects: no definition (open question; listed as a part placed once)
  if (loose) {
    for (const o of rows) {
      if (o.kind !== "object" || o.path.length || typeOf(o.material) === "machining") continue;
      if (openKind.has(o.id)) {
        open.set(o.id, { name: o.name, id: o.id, kind: openKind.get(o.id)!, count: 1 });
        continue;
      }
      const pf = await hew.query("hew.query.part_frame", { path: [o.id] });
      let size = pf.extents.map((v: number) => v * 1000) as [number, number, number];
      if (autoOrient) size = [...size].sort((a, b) => b - a) as [number, number, number];
      parts.set(o.id, {
        label: "", name: o.name || "Loose solid", kind: "loose", definition: null,
        material: o.material ? matName.get(o.material) ?? o.material : null, materialType: typeOf(o.material),
        size: size.map(r1) as [number, number, number], mirrored: false, count: 1, solids: 1, nested: 0, placements: [[o.id]],
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
  const lookAlike = [...alike.values()].filter((g) => g.length > 1);
  return { parts: list, hardware: [...hardware.values()], open: [...open.values()], machining, assemblies: [...assemblies.values()], lookAlike };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function formatResult(title: string, res: Result): string {
  const out = [`# ${title}`, "", "| | Part | Qty | L | W | T | Material | Notes |", "|---|---|---:|---:|---:|---:|---|---|"];
  for (const p of res.parts) {
    const notes = [
      p.kind === "loose" ? "loose solid (no definition)" : "",
      p.mirrored ? "mirrored" : "",
      p.solids > 1 ? `${p.solids} solids (glued-up)` : "",
      p.nested ? `holds ${p.nested} nested` : "",
    ].filter(Boolean).join(", ");
    out.push(`| ${p.label} | ${p.name} | ${p.count} | ${p.size[0]} | ${p.size[1]} | ${p.size[2]} | ${p.material ?? "—"} | ${notes} |`);
    for (const pc of p.pieces ?? []) out.push(`| | ↳ ${pc.name ?? "piece"} | | ${pc.size[0]} | ${pc.size[1]} | ${pc.size[2]} | | piece of ${p.label} |`);
  }
  if (res.hardware.length) out.push("", "Hardware: " + res.hardware.map((h) => `${h.name} ×${h.count}`).join(", "));
  if (res.assemblies.length) out.push("", "Assemblies (no solids of their own): " + res.assemblies.map((a) => `${a.name} ×${a.count}`).join(", "));
  if (res.open.length) out.push("", "Not closed solids, not measured: " + res.open.map((o) => `${o.name ?? o.id} (${o.kind}) ×${o.count}`).join(", "));
  if (res.machining) out.push("", `Machining bodies left out: ${res.machining}`);
  if (res.lookAlike.length) out.push("", "Look alike but not linked (Hew's \"link them?\" suggestion): " + res.lookAlike.map((g) => g.join(" = ")).join(", "));
  return out.join("\n");
}
