# OpenCutList concepts → Hew's data model

*Draft 0.4, 6 November 2026. Written by @TinyWorkshopDesign, corrected by @bbeaulant (OpenCutList side) and reviewed by @granroth (Hew side). 0.2 folded in granroth's answers on hew3d/hew#60 and the milestone 1 API. 0.3 folded in Boris's review: OpenCutList 8.0 as the reference, four corrections, and a body-based proposal for what a part is. 0.4 records the part model the three of us settled on between 3 and 6 November: **linked copies in Hew**, **Boris's part rule applied by the plugin**, and the reads Hew adds in milestone 2 to support both (§1, §2, §14). The body-based proposal of 0.3 is withdrawn.*

## Purpose

Before porting any feature, agree on how OpenCutList's core concepts map onto Hew's document model and the plugin bus. This document covers what a **part** is, how parts are counted and grouped, nesting, mirroring, scaling, size and orientation, materials, edge banding and veneer, visibility, scope, where settings are stored, identity and curves.

Each section has three parts:

- **OpenCutList (SketchUp)**: how upstream does it today.
- **Hew**: the matching concept and the bus call.
- **Proposal / decision**: what we do, or what's still open.

## Sources

- **OpenCutList 8.0 source**, branch `8.0.0` (65fbb4c, 30 October): `cutlist_generate_worker.rb` (model walk, material resolution, edges and veneer), `definition_attributes.rb`, `material_attributes.rb`, `instance_attributes.rb`. Where 7.1.0 differs, the text says so.
- **Hew**, on the `feature/plugin-system` branch (milestone 1, pre-release `v1.4.0-pre.plugin-m1`):
  - `docs/agents/PLUGINS.md`, especially "Reading parts", "Materials" and "Attributes";
  - `docs/API_REFERENCE.gen.md`, generated from the registry the app dispatches through;
  - `docs/agents/ARCHITECTURE.md` §2.1, §2.7, §2.8, §2.11.
- **The discussion**: hew3d/hew#60 (milestone plan, M1 release; Boris's requests of 5 November and granroth's answer of 6 November) and this PR (Boris's reviews of 2, 3 and 5 November; granroth's answer of 5 November).
- **The Python port (Hew CutList)**: what it ran into on Hew 1.3.x through `hew-cli`.

## Summary table

| OpenCutList / SketchUp | Hew | Bus (milestone) | Status |
|---|---|---|---|
| Part = component whose own geometry forms a volume, at any depth (parts can contain parts) | same rule, applied by the plugin over the rows Hew reports | `occurrences` `members`, `solid`; `scope: "own"` (M2) | **decided: §1** |
| Repeated part = component placed several times | **linked copies**: copying an Object or a group links it by default | `definition` on each row (M1); linked copies (M2) | **decided: §2** |
| Hardware: an instance, or a named group, painted with a hardware material is one item (8.0) | same rule | `material` on each row (M1) | §1 |
| Machining entities (`TYPE_MACHINING`) left out of the walk (8.0) | same today; later tool bodies kept on a part, `stage: "stock"` / `"finished"` | after M2 | §1, §13 |
| Instance count of a part | rows that share a `definition` | `occurrences` (M1) | §2 |
| Group = transparent container | Group: no pose; its copies link like Objects (M2) | `occurrences` | §1, §3 |
| Nested components | instances inside definitions | `occurrences` (M1) | §3 |
| Flipped instance (det < 0): separate part unless `symmetrical` | mirrored pose, accumulated along the path | `mirrored` on each row (M1) | §4 |
| Scaled instance | instance pose with non-uniform scale | `part_frame` extents, `world_pose` (M1) | §5 |
| Size from definition bounds + auto-orient / locked axes | definition axes; frame override on objects and groups | `part_frame` (+ `scope: "own"`, M2), `rebase`, `set_frame` (M1) | §6 |
| Material: instance → dominant child (by votes) → inherited | rows carry the instance's own material and the inherited one | `material`, `material_effective` (M1) | §7 |
| Edge banding / veneer: typed material on part faces | face paint by locator; shared by linked copies | `hew.query.faces {path}` (M1) | §8 |
| Visibility: entity hidden + layer hidden, inherited | hidden flag + tags along the path | `hidden`, `include_hidden` (M1) | §9 |
| Scope: selection or whole model; `active_path` in header | `roots` = selection or context members; context `stack` | `occurrences {roots}`, `hew.query.context` (M1) | §10 |
| `ladb_opencutlist` attribute dictionary | attribute dictionaries, namespace `org.opencutlist` | `hew.attr.*` | §11 |
| Entity ids, part uuid, part numbers | `sid`, `document_id`; make-unique id remap (M2) | ids on every row (M1) | §12 |
| Arcs and circles as polylines | analytic circles, arcs and cylinders; fillets planned in core | `faces` `surface`, `hew.compute.outline` (M2) | §13 |

---

## 1. What is a part

**OpenCutList.** The walk descends through groups and instances. Any component whose **own geometry** forms a volume is a part, at any depth, and its size is computed from that geometry only. So a component with faces of its own *and* nested components is a part, and so are the nested ones: parts inside parts (joinery or hardware inside a panel). Groups are never parts: their faces count toward the enclosing instance, and loose faces outside any component aren't listed. 8.0 adds two exceptions (`_fetch_useful_instance_infos`):

- an instance, or a **named** group, painted with a `TYPE_HARDWARE` material is one item, even without faces, and the walk doesn't descend into it;
- an entity painted with a `TYPE_MACHINING` material is left out of the walk and out of face collection.

**The principle** (Boris, #60, 5 November). OpenCutList never invents a data structure of its own: it reads the one the host already has, so it adapts to how people already model. The port keeps that principle, and asks Hew to make its own model better where SketchUp's was weak, rather than working around it in the plugin.

**What went wrong with the earlier proposals.**

- *A part is a closed body* (draft 0.3) finds parts but doesn't **track** them. Identical bodies are grouped by a fingerprint, so they count by coincidence: edit one copy and the group splits without warning, and data set on one copy doesn't reach the others.
- *A part is the deepest node whose members are all objects* (granroth's first reading of `occurrences`) rules out parts inside parts: a panel holding a dowel has a non-object member, so it would stop being a part.

**Decision.**

1. **Hew reports facts, the plugin applies the rule.** In M2 every `occurrences` row lists its direct members (`members: { objects, groups, instances }`), object rows say whether they are a closed `solid`, and `part_frame`, `measure` and `snapshot` take `scope: "own"`: a container's own solids, in its own axes, without the parts nested in it (granroth, PR, 5 November).
2. **Boris's rule.** Any container with solids of its own is a part, at any depth, sized with `scope: "own"`. A panel with dowels is a part with its own size, and the dowels are parts too.
3. **Repeated parts are linked copies** (§2). Copying a board gives a definition holding one solid, placed several times: a part under every rule discussed here.
4. **Glued-up blanks: one container = one part** by default, however many solids it holds, as upstream (Boris and granroth agree). An attribute can list the pieces of the glue-up too; they are the object rows under it, so it's one filter over the same rows.
5. **Hardware, as in 8.0**: an instance or a named group painted with a hardware material is one item and isn't descended.
6. **Machining, as in 8.0, for now**: bodies painted with a machining material are left out. Native tool bodies come after M2 (§13).
7. **Open objects aren't measured as parts.** They are reported with Hew's health verdict, and the plugin offers to close the ones Hew says it can close.
8. **Bodies split on import.** Hew won't rejoin them silently (a split can be a glue line drawn on purpose). Object rows report `family` (as in `hew.doc.health`) and whether Hew can close it, so the plugin lists a split shape as one part, as upstream would. Model Health's Rejoin gains "as one solid" for users who want the real solid.

**Real models, for reference** (Hew 1.3.1, `hew.doc.health`, `.skp` files from the port's tests). The boards people draw are closed solids almost everywhere; what isn't closed is mostly downloaded hardware and props.

| Model | Objects | Closed solids | Not closed |
|---|---|---|---|
| Desk-top shelf | 6 | 5 | the SketchUp default figure |
| Microwave cabinet v1 / v3 | 27 / 35 | 24 / 34 | v1: a leg (open curved surface), a door (closable), a hinge; v3: the figure |
| Table | 3 | 3 | — |
| TV cabinet | 23 | 22 | the figure |
| Desk with props | 1188 | 242 | 946, of which 838 in a downloaded rack |
| Kitchen bin unit | 215 | 27 | 188, almost all downloaded hinges |
| Workbench (third-party) | 567 | 74 | 493: systainers, casters, vice, figure |

**Open question for @bbeaulant.** Upstream doesn't list loose faces, and groups are transparent. In Hew, what about **an Object that was never copied** (no definition), or loose Objects inside a group at the top level? Our suggestion: list it as a part placed once, the same as a component placed once, since an Object in Hew already is "a solid with its own material" and refusing it would give an empty list for anyone who never copies.

## 2. Counting and grouping

**OpenCutList.** The part key (`PartDef.generate_part_id`) is: the material/thickness group, the definition (its `uuid`, else its entity id; plus the instance name for dynamic components), the length, width and thickness at OpenCutList's precision, and the flipped flag (§4). So one definition can give several parts: by material, by scale, or by mirroring. `instance_count_by_part` lets several instances make one physical part. `cumulable` merges identical parts into one longer or wider piece. Parts are numbered and sorted by `part_order_strategy`.

**Hew, with M2's linked copies** (granroth, PR and #60, 5–6 November).

- **Copying an Object or a group** (a Move copy, an array, a grid, a mirrored copy) **creates linked placements of one shared solid, by default.** An independent copy is one explicit choice in the same tools, like Fusion 360's *Paste* / *Paste New*.
- **Component semantics.** An edit through any copy edits all of them. Only an explicit **Unlink** breaks the link; nothing splits on its own. (Looking into this turned up one silent split Hew has today, a boolean on one placement of a component making it unique; it goes away with this work.)
- **Per placement:** name, material, tags, attribute dictionary and pose. A mirrored copy is a real mirrored pose and reads `mirrored`.
- **Built on Hew's component machinery**, so `occurrences` rows keep their shape: linked copies share a `definition`. In the app a copied board reads "Board ×4", and the user never meets the word "definition". A set that someone names, gives axes, or saves to the Library is simply a component.
- **Unlink on the bus** is `hew.component.make_unique`, which takes a path at any depth, keeps attributes, and returns the id remap (the same contract as stretch).
- While editing one copy, the other copies stay on screen and follow live (already on Hew's v1.4 branch).

**The Python port** groups by *name + material + size rounded to 0.1 mm*, because it couldn't trust definitions.

**Decision.**

- **Count by `definition`**, then split on material, size and mirroring, as upstream. That is the rule today for components and, from M2, for every linked copy.
- **No fingerprint in the counting rule.** Look-alike bodies are handled by a **suggestion, in Hew itself**: "these four look identical, link them?" (granroth). That also covers models drawn before linked copies existed. `hew.query.signature` (a canonical shape hash, the hash of its mirror image, and whether they're equal) lets the suggestion tell left from right for bodies drawn separately.
- The part name is a label, not part of the key: the definition's name, else the nearest named node on the path.

## 3. Groups and nesting

**OpenCutList.** Groups and instances are walked recursively. The path (`path + [entity]`) is kept for each instance, for material inheritance and the header.

**Hew.** Groups have no pose: a transform bakes into the leaves (ARCHITECTURE §2.7). Instances carry a pose. A definition's members can be objects, groups and instances (`.hew` v15). `occurrences` returns every placement, nested definitions expanded through each instance, with `path` (the instances above, outermost first), `depth`, `parent` and a 3×4 `world_pose`. `{ path: [...row.path, row.id] }` addresses any row in `part_frame`, `measure`, `faces` and `mesh`. From M2, rows also list their direct `members` (§1).

**What the port learned, now obsolete.** `query.scene` didn't list instances nested in definitions, so the port exported a copy and exploded it. `occurrences` removes that need.

**In M2.** Entering any node from the bus (`hew.view.enter`), and moving, rotating, scaling and copying by path.

## 4. Mirrored instances

**OpenCutList.** A flipped instance is detected from the **cumulated transformation of the whole path** (`PathUtils.get_transformation`), so a mirrored outer instance affects every part nested in it. The flag is part of the part id, so **a mirrored instance is a separate part** (left and right are listed apart) unless the definition is marked `symmetrical`. It also swaps the min and max faces for edge banding and veneer. Mirrored twins deformed the same way must keep sharing their definition (Boris's stretch notes).

**Hew.** Reflections bake in the kernel since M1: a mirrored instance explodes, opens in place and duplicates, and negative scale mirrors. **`mirrored` is accumulated along the whole path** (granroth, 5 November): a mirrored instance inside a mirrored placement reads `false`, as the M1 acceptance report showed, and `part_frame` follows the same path. `part_frame` on a mirrored placement keeps a right-handed frame (`y` negated). `hew.component.flip_instance` mirrors one placement across its definition's local x, y or z plane. From M2, a mirrored linked copy is a mirrored pose of the shared solid.

**Decision.** As upstream: `mirrored` goes into the part key unless `symmetrical` is set, and it swaps the min/max faces for edges and veneer (§8), checked against `part_frame`'s `y`-negation convention.

## 5. Scaled instances

**OpenCutList.** Instance scale is applied to the definition bounds. A scaled instance gives a different size.

**Hew.** Instance poses may scale non-uniformly. Plain Objects and groups bake transforms, so they never carry a scale. `part_frame` on an instance measures along the definition's own axes, scaled by the placement.

**Decision.** Size comes from `part_frame` on the occurrence, scale included, and is part of the part key.

## 6. Size and orientation

**OpenCutList.** Length, width and thickness come from the definition's face bounds in its own axes. With `auto_orient` the longest dimension becomes the length, unless the definition has `orientation_locked_on_axis`. Smart Axes and Edit Part change those axes.

**Hew.**

- **Components have local axes**, as in SketchUp. `hew.component.rebase` sets them; every placement's pose compensates, so nothing moves on screen.
- **Objects and groups** get an **orientation** instead: `hew.entity.set_frame` stores a frame override (`hew.part` / `frame`), relative to the part's own face frame.
- **`part_frame`** reports `source`: `definition`, `attribute` or `face`. From M2 it takes `scope: "own"` on a container (§1).
- **Coming:** a view toggle that draws axes and frames (M2), and an Axes tool (M4).
- **`.skp` import:** a component keeps its axes; a group does not.

**Decision.**

- Default: `part_frame` with `scope: "own"` on a container. With `auto_orient`, reorder its extents longest first, as upstream. Reordering permutes the frame's axes, which changes its handedness: §8 tracks that.
- Locked orientation: `rebase` (components) or `set_frame` (objects), plus `orientation_locked_on_axis: true` in our namespace.
- Smart Axes maps onto `rebase`, `set_frame` and `flip_instance`.

## 7. Material resolution

**OpenCutList** (`_get_material`, with `smart_material`):

1. the material **painted on the instance** itself;
2. otherwise the **dominant material of its children** (`_get_dominant_child_material`), by **votes**: each face is one vote, and each child group, walked recursively, is a single vote (its own dominant material). Ties are broken by `MaterialAttributes.type_order`. The search descends through groups and `cuts_opening` components;
3. otherwise the material **inherited** from the nearest ancestor in the path.

"Virtual" materials (edge and veneer types) are skipped at every step.

**Hew.** A face shows its own paint, else its object's base material, else the material of the nearest painted instance on its path. Each `occurrences` row reports its own `material` and its `material_effective` (`null` on a group row). `hew.query.faces {path}` gives each face's effective material.

**Decision (Boris; granroth agrees nothing more is needed from Hew).** Upstream's order exactly, on the part's container: the instance's own material (not virtual); else the dominant material by votes over its **own** solids' faces (one vote per face; a loose Object's base material stands in for its unpainted faces; each nested group one vote), virtual types skipped, ties by type order; else the inherited material from the rows above.

## 8. Edge banding and veneer

**OpenCutList.** For sheet goods, the faces whose normals run along the part's axes are collected. The min and max faces on each axis give the four edge materials and the two veneer materials, recognised by their material type. They are swapped when `flipped ^ size.axes_flipped?`. `edge_decremented` subtracts the band thickness from the cut size, and the veneer thickness is subtracted from the part thickness (`veneers_def[:thickness_decrement]`).

**Hew.** Painting a face by its locator and attribute dictionaries on faces and edges are in M1. With linked copies, a painted face belongs to the shared solid, so it shows on every copy, as a face inside a SketchUp definition does (granroth, 6 November).

**Decision.** Upstream's algorithm in the occurrence's `part_frame`: classify faces by normal against the frame axes, take min and max per axis, swap them when `mirrored XOR axes_permuted` (§4, §6), and subtract band and veneer thicknesses. Typed materials stay the source of truth.

## 9. Visibility

**OpenCutList.** An entity is skipped if it is hidden, or on a hidden tag or tag folder. A hidden group hides everything inside it. `always_face_camera` components are skipped.

**Hew.** Each row's `hidden` is the effective visibility: its own flag and tags, its groups', and every instance on the path. `include_hidden: false` (the default) skips hidden placements and doesn't descend hidden instances. Hew has no face-camera, glued or cuts-opening components.

**Decision.** `include_hidden: false` by default, with "include hidden parts" as an option.

## 10. Scope and header

**OpenCutList.** The list is generated from the selection if there is one, otherwise from the whole model. The header shows the model's name and description, the active editing path, and the active scene's name and description.

**Hew.** `occurrences` takes `roots`: node ids or `{path}` locators, from `hew.selection.get` (filtered to `obj_`/`grp_`/`ins_`) or the active context's `direct_members`; the context's `stack` is the active path. Hew documents have a title but no description.

**Decision.** As upstream; the header uses the document title plus the active scene's name and description, and "generated from the selection" stays a visible flag.

## 11. Where settings live

Upstream stores everything in the `ladb_opencutlist` dictionary, as strings with units. In Hew, attribute values are JSON, so we store numbers and arrays in **mm**. Every entity and the document carry dictionaries, and so do faces and edges. With linked copies, data on the **definition applies to every copy** (Boris's second need), and per-copy data goes on the placement.

**Namespace:** `org.opencutlist`, which is also the plugin id. `hew.*` is Hew's own.

| Upstream key | On (SketchUp) | On (Hew) | Notes |
|---|---|---|---|
| `uuid`, `numbers` | definition | definition (Object if never copied) | §12 |
| `cumulable`, `instance_count_by_part`, `thickness_layer_count` | definition | definition | |
| `mass`, `url`, `tags`, `symmetrical`, `ignore_grain_direction` | definition | definition | upstream reads `Price` from SketchUp's own dictionary |
| `orientation_locked_on_axis` | definition | definition / Object | with `rebase` / `set_frame` (§6) |
| `length_increase`, `width_increase`, `thickness_increase`, `follow_grain_direction` (8.0) | definition | definition | |
| `role`: `front_panel`, `back_panel`, `hinge` (8.0) | definition | definition | Smart Build's cavity detection |
| `is_grain_group` (8.0) | instance | placement or group | the nearest marked node on the path groups parts by grain |
| `type` (… hardware, veneer, **machining** in 8.0) | material | material | |
| `description`, `url` | material | material | |
| `thickness`, increases, `std_*`, `grained`, `edge_decremented`, `raw_estimated`, `multiplier_coefficient`, prices, masses | material | material | numbers in mm, arrays, JSON |
| per-model presets | model | document | written on `document_will_save` |
| global presets | SketchUp defaults | plugin settings store | |

On instances, 7.1.0 stores nothing beyond the material and the name; 8.0 adds `is_grain_group` and the door opening attribute (not part of the cut list). Machining material settings (`machining_separated`, `machining_material_colored`) will be mapped with native machining (§13).

## 12. Identity

**OpenCutList.** Definitions and materials get a `uuid` attribute. The definition's `uuid` is part of the part key, and part numbers are saved on the definition under `numbers`, keyed by part key, so numbers stay stable across generations.

**Hew.** Public entity ids are stable across undo, redo, save and load (`sid` since `.hew` v14). A saved document has a persistent `document_id`. Faces and edges have no ids; they are addressed by locators. From M2, `make_unique` returns the id remap.

**Decision.** Keep our own `uuid` in `org.opencutlist` on the definition: it survives copy and paste between documents and library inserts. When a placement is made unique, or copied as an independent copy, the new definition carries a copy of the attributes, so the plugin gives it a fresh `uuid` (using the remap) and keeps the numbers of the original. Use Hew ids within a document and `document_id` for anything kept outside it.

## 13. Curves, fillets and machining

**OpenCutList.** SketchUp has no true curves: arcs and circles are polylines, so a round top is a polygon and exports and nesting see segments. Machining is kept as separate entities (8.0) so it can be added or removed without touching the original solid.

**Hew.** Curves are analytic: a circle extruded in Hew 1.3.1 is one closed solid whose side faces report a cylindrical `surface` (axis and radius); the segments are only the tessellation. `hew.compute.outline` (M2) returns outlines with analytic arcs, and fillets are planned in core.

**Machining** (granroth, 5–6 November): a part will carry **tool bodies** that Hew subtracts for display, measure, raycast and export. They stay in the model and can be edited or removed. Reads take `stage: "stock"` (sizes, nesting) or `"finished"` (drawings, DXF). Tool bodies link like copies, so one mortise on four linked legs is one mortise. The order is fixed (stock, then cuts, then blends such as fillets): no feature tree. It is designed after M2's by-path booleans and has no milestone yet. Until then, 8.0's machining-typed bodies work as in SketchUp, and `hew.compute.boolean` gives the machined shape for export.

**Decision.** Keep geometry analytic all the way through: true sizes for round parts, true arcs in Packy's irregular mode and DXF, edge banding on the real arc length. Read the stock stage for the cut list and the finished stage for drawings.

## 14. What Hew adds for this (milestone 2)

Committed by granroth on 5–6 November. M2 starts once the part model is settled, likely early in the week of 9 November, after Hew 1.4.

- **Linked copies by default** for Objects and groups (Move copy, array, grid, mirrored copy), with an explicit independent copy and Unlink; the silent unique-and-explode on booleans goes away (§2).
- **`hew.component.make_unique`** by path at any depth, keeping attributes, returning the id remap (§2, §12).
- **`occurrences`**: `members: { objects, groups, instances }` on every row; `solid` and `family` (plus whether it can be closed) on object rows (§1).
- **`scope: "own"`** on `part_frame`, `measure` and `snapshot` (§1, §6).
- **`hew.query.signature`**: canonical shape hash, mirror hash, and whether they're equal (§2).
- **Model Health Rejoin "as one solid"** (§1).
- **Look-alike suggestion** in Hew: "these look identical, link them?" (§2).
- After M2: tool bodies for non-destructive machining (§13).

---

## What the Python port got wrong by design

1. **Mirrored instances unreachable.** True on Hew 1.3; since M1 they explode, open in place and report `mirrored`.
2. **"Walk = export a copy + explode everything".** `occurrences` replaces it.
3. **Material from face area.** Upstream counts votes, on the instance first (§7).
4. **Settings in a side file keyed by material name.** They belong in attributes (§11).
5. **Grouping by name + size.** Counting comes from the model: definitions and linked copies (§2).
6. **Mirrored twins as one part.** Upstream lists them apart unless `symmetrical` (§4).

## Answered

By @granroth on #60 (31 October): public sources are `PLUGINS.md` and `API_REFERENCE.gen.md`; ARCHITECTURE's "flat definitions" predates v15; Hew has no face-camera, glued or cuts-opening components; components have axes, objects and groups get a frame override; ids persist as `sid` since v14.

By @bbeaulant (2–5 November): OpenCutList 8.0 as the reference; upstream's material order with votes; instance-level attributes; linked copies with component semantics and per-placement data; one container = one part for glued-up blanks; machining as a native, non-destructive direction.

By @granroth (5–6 November): yes to linked copies and to machining as a direction; Hew reports members, `solid` and `scope: "own"` and the plugin applies the part rule; seam families reported, not rejoined silently; `hew.query.signature` for left and right; `mirrored` accumulated along the path; nothing more needed for material order.

## Open questions

For @bbeaulant:
1. An Object that was never copied, or loose Objects in a group at the top level: a part placed once, as we suggest, or not listed? (§1)
2. Anything in §1, §2 or §14 that your years of OpenCutList say would go wrong, before granroth starts M2?

Next on our side: an acceptance test for linked copies, and a prototype of the counting logic over `occurrences`, using cases from real models.
