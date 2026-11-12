// What Hew's `hew.query.occurrences` reports (M2), as the plugin reads it.
// Lengths are meters; `world_pose` is 12 numbers, row-major 3×4.

export type Members = { objects: string[]; groups: string[]; instances: string[] };

export type Occurrence = {
  id: string;
  kind: "object" | "group" | "instance";
  name: string | null;
  definition: string | null;
  definition_name: string | null;
  /** Instances only, outermost first. A group's members share the group's `path`; `parent` names the group. */
  path: string[];
  parent: string | null;
  depth: number;
  /** Accumulated along the path: a mirror inside a mirror reads false. */
  mirrored: boolean;
  hidden: boolean;
  material: string | null;
  material_effective: string | null;
  tags: string[][];
  /** The placement's pose. An object's geometry lives in its definition, so editing it doesn't change this. */
  world_pose: number[];
  /** Instance and group rows: direct members, as public ids. */
  members?: Members;
  /** Instance rows: part of a linked set. */
  linked?: boolean;
  /** Object rows: a closed, manifold solid. */
  solid?: boolean;
  /** Object rows: the seam family of a shape the importer split, if any. */
  family?: string | null;
};

/** A node's locator: its path plus its id. Unique across the occurrence tree. */
export const locator = (r: Pick<Occurrence, "path" | "id">): string[] => [...r.path, r.id];
export const locatorKey = (l: string[]): string => JSON.stringify(l);
