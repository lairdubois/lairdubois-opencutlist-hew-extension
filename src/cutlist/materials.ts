// Material types, as in OpenCutList. The type is our attribute on the material
// (namespace `org.opencutlist`, key `type`), else an optional name → type map.

import type { Host } from "../host/host.ts";

export const NS = "org.opencutlist";

export type MaterialType =
  | "solid_wood" | "sheet_good" | "dimensional" | "edge" | "hardware" | "veneer" | "machining" | "unknown";

/** Boris's order, used to break ties when a part's faces vote for its material. */
export const TYPE_ORDER: MaterialType[] = [
  "solid_wood", "sheet_good", "dimensional", "hardware", "edge", "veneer", "machining", "unknown",
];

/** Materials that dress a part (edges, veneers) and never make one. */
export const VIRTUAL = new Set<MaterialType>(["edge", "veneer"]);

export type Materials = {
  name(id: string | null): string | null;
  type(id: string | null): MaterialType;
};

export async function readMaterials(host: Host, typesByName: Record<string, MaterialType> = {}): Promise<Materials> {
  const scene = await host.query("hew.query.scene", {});
  const names = new Map<string, string>((scene.materials ?? []).map((m: any) => [m.id, m.name]));
  const types = new Map<string, MaterialType>();
  for (const [id, name] of names) {
    let t: MaterialType | undefined = typesByName[name];
    try {
      const a = await host.query("hew.attr.get", { target: id, ns: NS });
      const v = a?.dictionaries?.[NS]?.type ?? a?.[NS]?.type ?? a?.type;
      if (typeof v === "string") t = v as MaterialType;
    } catch {
      // no dictionary on this material
    }
    types.set(id, t ?? "unknown");
  }
  return {
    name: (id) => (id ? names.get(id) ?? id : null),
    type: (id) => (id ? types.get(id) ?? "unknown" : "unknown"),
  };
}
