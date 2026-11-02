# OpenCutList concepts → Hew's data model

*Draft 0.3, 2 November 2026. Written from the Python port's side by @TinyWorkshopDesign, to be corrected by @bbeaulant (OpenCutList side) and reviewed by @granroth (Hew side). 0.2 folded in granroth's answers on hew3d/hew#60 and the milestone 1 API. 0.3 folds in Boris's review of 0.2: the reference is now OpenCutList 8.0, four corrections on the upstream side, and a new proposal for what a part is (§1).*

## Purpose

Before porting any feature, agree on how OpenCutList's core concepts map onto Hew's document model and the plugin bus. This document covers what a **part** is, how parts are counted and grouped, nesting, mirroring, scaling, size and orientation, materials, edge banding and veneer, visibility, scope, and where settings are stored.

Each section has three parts:

- **OpenCutList (SketchUp)**: how upstream does it today.
- **Hew**: the matching concept and the bus call.
- **Proposal / question**: what we should do, or what's still open.

## Sources

- **OpenCutList 8.0 source**, branch `8.0.0` (65fbb4c, 30 October): `cutlist_generate_worker.rb` (model walk, material resolution, edges and veneer), `definition_attributes.rb`, `material_attributes.rb`, `instance_attributes.rb`. Where 7.1.0 differs, the text says so. Boris asked to stop using 7.1.0 as the reference: a year of 8.0 development already changes several of its rules.
- **Hew**, on the `feature/plugin-system` branch (milestone 1, pre-release `v1.4.0-pre.plugin-m1`):
  - `docs/agents/PLUGINS.md`, especially "Reading parts", "Materials" and "Attributes";
  - `docs/API_REFERENCE.gen.md`, generated from the registry the app dispatches through;
  - `docs/agents/ARCHITECTURE.md` §2.1, §2.7, §2.8, §2.11;
  - granroth's comments on hew3d/hew#60 (milestone plan, M1 release, answers to draft 0.1).
- **The Python port (Hew CutList)**: what it ran into on Hew 1.3.x through `hew-cli`.

## Summary table

| OpenCutList / SketchUp | Hew | Bus (milestone) | Status |
|---|---|---|---|
| Part = component whose definition contains faces forming a volume (parts can contain parts) | **a body**: one Object that is a closed solid, wherever it sits | `hew.query.occurrences` (M1), `hew.doc.health` | **proposal: §1** |
| Hardware: an instance, or a named group, painted with a hardware material is one item (8.0) | same rule on instances and named groups | `material` on each row (M1) | §1 |
| Machining entities (`TYPE_MACHINING`) left out of the walk (8.0) | same rule, or a native Hew concept | — | **open: §1** |
| Instance count of a part | occurrence rows that share a definition; a fingerprint for bodies without one | `occurrences`, `measure` (M1) | §2 |
| Group = transparent container | Group: no pose, never shared; transforms bake into leaves | `occurrences` | §1, §3 |
| Nested components | instances inside definitions | `occurrences` (M1) | §3 |
| Flipped instance (det < 0): separate part unless `symmetrical` | mirrored instance pose | `mirrored` on each row (M1) | §4 |
| Scaled instance | instance pose with non-uniform scale | `part_frame` extents, `world_pose` (M1) | §5 |
| Size from definition bounds + auto-orient / locked axes | definition axes; frame override on objects and groups | `part_frame`, `component.rebase`, `entity.set_frame` (M1) | §6 |
| Material: instance → dominant child (by votes) → inherited | face → object base → nearest painted instance | `material`, `material_effective` on each row (M1) | §7: upstream order |
| Edge banding / veneer: typed material on part faces | face material with an "edge"/"veneer" type in our namespace | `hew.query.faces {path}` + `part_frame` (M1) | §8 |
| Visibility: entity hidden + layer hidden, inherited | hidden flag + tags along the path | `hidden`, `include_hidden` (M1) | §9 |
| Scope: selection or whole model; `active_path` in header | `roots` = selection or context members; context `stack` | `occurrences {roots}`, `hew.query.context` (M1) | §10 |
| `ladb_opencutlist` attribute dictionary | attribute dictionaries, namespace `org.opencutlist` | `hew.attr.*` | §11 |
| Entity ids, part uuid, part numbers | `sid` (persisted since `.hew` v14), `document_id` | ids on every row (M1) | §12 |
| Arcs and circles as polylines | analytic circles, arcs and cylinders; fillets planned in core | `faces` `surface`, `hew.compute.outline` (M2) | §13 |

---

## 1. What is a part

**OpenCutList.** The walk descends through groups and instances. A component instance is a part when its definition, including the groups nested in it, contains faces forming a volume. That is not limited to leaf components: a component with faces of its own *and* nested components is a part, and so are the nested ones, which gives parts inside parts (joinery inside a panel). Groups are never parts: their faces count toward the enclosing instance, and loose faces outside any component aren't listed ("make components" tip). 8.0 adds two exceptions (`_fetch_useful_instance_infos`):

- an instance, or a **named** group, painted with a `TYPE_HARDWARE` material is one item, even without faces, and the walk doesn't descend into it (hardware made of sub-components);
- an entity painted with a `TYPE_MACHINING` material is left out of the walk and out of face collection.

**Why it doesn't carry over** (Boris, review of 0.2). Upstream is built on SketchUp's logic: every level of the tree is an instance of a definition, with local axes, a transformation and a material, and loose faces are just geometry. In Hew, geometry lives only in Objects, and an Object is a watertight solid with its own base material. An Object is much closer to a *solid group* in SketchUp than to loose faces, so "Objects are parts" is really "groups are parts", which upstream deliberately refuses. But every extrusion in Hew is an Object, so refusing them would give most users an empty list, and making every board a component feels much less natural in Hew than in SketchUp, since an Object is already a thing in itself.

**Proposal: a part is a body.** This is the rule mechanical CAD uses (a SolidWorks weldment cut list lists *bodies*, not folders or assemblies), and it matches Hew's own model:

1. **A part is one body: one Object that is a closed solid** (`health: solid`), wherever it sits: loose, in a group, or inside a component definition, where it counts once per placement.
2. **Groups and components organise, they don't make parts.** Groups are transparent, as upstream. A component is how you say "these are the same" (§2) and how you give a part its own axes (§6), but you don't need one to get a part.
3. **Hardware, as in 8.0**: an instance or a named group painted with a hardware material is one item and isn't descended. A hinge made of twelve bodies is one hinge.
4. **Machining, as in 8.0**: bodies painted with a machining material are left out. Whether Hew should carry this natively is an open question (below).
5. **Open objects are not parts.** Anything that isn't a closed solid is reported, with Hew's own health verdict, instead of being measured. Hew already says which ones can be closed automatically (`cappable`, `hew.solid.cap`).

What falls out of it:

- **Parts inside parts** need no special case: a dowel, a loose tenon or a spline is its own body, so it's its own part.
- **A glued-up blank** (a leg laminated from two boards) is two parts. That is what the workshop cuts. Upstream lists one part when both boards are in one component; a definition attribute could restore that where it's wanted (question 2 below).
- **The empty list goes away** without asking anyone to make components, and components keep their value: identical placements are identical by construction.

**Checked on real models** (Hew 1.3.1, `hew.doc.health`, `.skp` files from the port's tests):

| Model | Objects | Closed solids | Not closed |
|---|---|---|---|
| Desk-top shelf (piano Harvey) | 6 | 5 | 1: the SketchUp default figure |
| Microwave cabinet, v1 / v3 | 27 / 35 | 24 / 34 | v1: a front leg (an open curved surface), a door (closable) and a hinge; v3: only the figure |
| Table | 3 | 3 | 0 |
| TV cabinet | 23 | 22 | 1: the figure |
| Desk with props | 1188 | 242 | 946, of which 838 in a downloaded 12U rack, the rest a chair, a monitor |
| Kitchen bin unit | 215 | 27 | 188, almost all downloaded Blum hinges |
| Workbench (third-party model) | 567 | 74 | 493: Festool systainers, casters, vice, figure |

The boards people draw are closed solids almost everywhere. The exceptions are worth noting: in v1 of the microwave cabinet a leg and a door were open, and v3 of the same model has none. Everything else that isn't closed is downloaded hardware and props, which isn't cut anyway, and rule 3 or a hardware material covers it. So the plugin should report open parts clearly, and offer `hew.solid.cap` where Hew says it applies, rather than drop them silently.

**Questions for @bbeaulant.**
1. Is "a part is a closed body" a sound base for you, given the cases above?
2. Glued-up blanks: two parts by default, with a definition attribute ("one part") for the cases where the list should show the blank? Or the other way round?
3. Machining: in Hew a groove or a mortise is a boolean subtraction on the body itself, so the body stays one closed solid and the geometry is changed. Should OpenCutList keep 8.0's "machining entity next to the part" model, or should we ask Hew for a native, non-destructive form (a tool body attached to a part, subtracted for display and export)?

**Questions for @granroth.**
1. **Bodies split on import.** The `.skp` importer sometimes splits one shape into several Objects joined by shared rims (`hew.doc.health` `families`: 54 in the workbench, 40 in a rack model). Under this rule a board split in two becomes two parts. Could the importer join a family into one Object when the union is a closed solid, or could `occurrences` report the family so the plugin can treat it as one?
2. **Left and right bodies.** Mirrored placements report `mirrored`, but two loose bodies that are mirror images of each other have no definition to compare. Could `part_frame` (or `measure`) return a handedness flag, or a canonical signature, so a fingerprint can tell a left part from a right one?

## 2. Counting and grouping

**OpenCutList.** The part key (`PartDef.generate_part_id`) is: the material/thickness group, the definition (its `uuid`, else its entity id; plus the instance name for dynamic components), the length, width and thickness at OpenCutList's precision, and the flipped flag (§4). So one definition can give several parts: by material, by scale, or by mirroring. `instance_count_by_part` lets several instances make one physical part. `cumulable` (none, length, width) merges identical parts into one longer or wider piece. Parts are numbered by letter or number and sorted by `part_order_strategy`.

**Hew.** Every `occurrences` row has `path`, `id`, `kind`, `definition` and `definition_name`, `name`, `tags`, `material` and `material_effective`, `mirrored`, `hidden` and `world_pose`. Rows that share a `definition` share a source. Groups and loose Objects are never shared, so two identical ones count 1 each unless they are fingerprinted (granroth).

**The Python port** groups by *name + material + size rounded to 0.1 mm*, because before `occurrences` it couldn't trust definitions: it had to explode everything.

**Proposal.** With a part being a body (§1):

- **Bodies inside a component definition**: the key is the definition plus the member Object, then split on material, size and mirroring, as upstream. Every placement of the definition adds one to the count.
- **Bodies with no definition** (loose, or in groups): a fingerprint of effective material, `part_frame` extents at OpenCutList's precision, volume and surface area (`hew.query.measure`, M1), and handedness once Hew can report it (§1, question 2 for granroth). This is what mechanical CAD does to group identical bodies in a cut list, and it doesn't depend on names.
- The part name comes from the body, else from the nearest named group or component on the path, as the port does today. It's a label, not part of the key.

## 3. Groups and nesting

**OpenCutList.** Groups and instances are walked recursively. The path (`path + [entity]`) is kept for each instance, for material inheritance and the header.

**Hew.** Groups have no pose: a transform bakes into the leaves (ARCHITECTURE §2.7). Instances carry a pose. A definition's members can be objects, groups and instances (`.hew` v15). ARCHITECTURE §2.1 and §2.11 still call definitions "flat"; granroth confirmed that wording predates v15 and will fix it with M2. `occurrences` returns every placement, nested definitions expanded through each instance, with `path` (the instances above, outermost first), `depth`, `parent` and a 3×4 `world_pose`. `{ path: [...row.path, row.id] }` addresses any row in `part_frame`, `measure`, `faces` and `mesh`.

**What the port learned, now obsolete.** `query.scene` didn't list instances nested in definitions, so the port exported a copy and exploded it. `occurrences` removes that need: no explode and no copy.

**Still M2.** Entering a nested instance from the bus (`hew.view.enter`) and editing parts by path. The cut list itself only needs reads.

## 4. Mirrored instances

**OpenCutList.** A flipped instance (determinant < 0) is detected (`flipped_detection`). The flag is part of the part id (`PartDef.generate_part_id`), so **a mirrored instance is a separate part** (left and right are listed apart) unless the definition is marked `symmetrical`. The flag also swaps the min and max faces, which matters for edge banding and veneer sides. Boris's stretch notes add that mirrored twins deformed the same way must keep sharing their *definition*. That is a modelling rule, separate from how they're listed.

**Hew.** An instance pose may mirror (ARCHITECTURE §2.7). Since M1, reflections bake in the kernel: a mirrored instance explodes, opens in place and duplicates, and negative scale mirrors. Each `occurrences` row reports `mirrored`. `part_frame` on a mirrored placement keeps a right-handed frame (`y` negated) and reports `mirrored: true`. `hew.component.flip_instance` mirrors one placement across its definition's local x, y or z plane.

**What the port learned, now obsolete.** For mirrored instances the port measured the definition's Objects through the pose, and fell back to the bounding box when they contained further nesting. It also listed mirrored twins as the same part, which differs from upstream.

**Correction (Boris).** Upstream's `InstanceInfo#flipped` and `#scale` come from the **cumulated transformation of the whole path** (`PathUtils.get_transformation`), not from the instance alone. A mirrored or scaled outer instance affects every part nested in it.

**Proposal.** Same as upstream: `mirrored` goes into the part key unless `symmetrical` is set, and it swaps the min/max faces for edges and veneer (§8). Because `part_frame` negates `y` for a mirrored placement, the swap has to be checked against that convention, not re-derived from the determinant.

**To verify on M1** (@granroth): that `mirrored` and `part_frame` on a nested occurrence use the full path, so a part inside a mirrored outer instance reports `mirrored: true` even when its own placement isn't mirrored. `world_pose` is composed along the path, so the test is a mirrored cabinet containing an unmirrored door.

## 5. Scaled instances

**OpenCutList.** Instance scale is applied to the definition bounds (`Size3d.create_from_bounds(bounds, instance_info.scale, …)`). A scaled instance gives a different size.

**Hew.** Instance poses may scale non-uniformly. Plain Objects and groups bake transforms, so they never carry a scale. `part_frame` on an instance measures along the definition's own axes, scaled by the placement.

**Proposal.** Size comes from `part_frame` on the occurrence, scale included. As upstream, the size is part of the part key, so rows with the same definition but a different size become separate parts.

## 6. Size and orientation

**OpenCutList.** Length, width and thickness come from the definition's face bounds in its own axes. With `auto_orient` the longest dimension becomes the length, unless the definition has `orientation_locked_on_axis`. Then the definition's axes win, which is how users force grain direction or front/back roles. Smart Axes and Edit Part change those axes.

**Hew** (PLUGINS.md "Setting axes", granroth on #60).

- **Components have local axes**, as in SketchUp: a definition's geometry lives in its own coordinates and the instance pose places it. `hew.component.rebase` sets them: the geometry moves into the new frame and every placement's pose compensates, so nothing moves on screen.
- **Objects and groups** have no second coordinate system, by design, since they are never instanced. They get an **orientation** instead: `hew.entity.set_frame` stores a frame override as the Hew-owned `hew.part` / `frame` attribute, relative to the part's own `face` frame, so it follows the part through any move. Hew's Shop sheet and Object Info honour it too.
- **`part_frame`** reports `source`: `definition` (instance), `attribute` (override), or `face` (largest face, longest edge, swapped so extents read `[length, width, thickness]`).
- **Coming:** a view toggle that draws a component's axes and a part's frame (M2), and an Axes tool inside a component edit and on a selected object or group (M4).
- **`.skp` import:** a component keeps its axes; a group does not, because its transform is baked into the geometry. Its orientation has to be re-derived or set after import.

**The Python port** computes the frame from face areas (most area = board face, next perpendicular = edge), close to `part_frame`'s `face` source.

**Proposal.**
- Default: `part_frame`. With `auto_orient`, reorder its extents longest first, as upstream. Reordering permutes the frame's axes, which changes its handedness: §8 has to track that.
- Locked orientation on a component: `hew.component.rebase`, plus `orientation_locked_on_axis: true` in our namespace, so `part_frame` and upstream's flag agree.
- Locked orientation on a loose Object: `hew.entity.set_frame`, plus the same flag. To mark grain across the width, write `x: [0, 1, 0]`, `y: [1, 0, 0]`.
- Smart Axes maps onto `rebase`, `set_frame` and `flip_instance`, all in M1.

## 7. Material resolution

**OpenCutList** (`_get_material`, with `smart_material`):
1. the material **painted on the instance** itself;
2. otherwise the **dominant material of its children** (`_get_dominant_child_material`). It **counts votes**, not area: each face is one vote, and each child group, walked recursively, is a single vote (its own dominant material). Ties are broken by `MaterialAttributes.type_order`. The search descends through groups and `cuts_opening` components, not only the first level;
3. otherwise the material **inherited** from the nearest ancestor in the path.

"Virtual" materials are skipped at every step. Those are the **edge** and **veneer** types (`MaterialAttributes.is_virtual?`), so a part's material is never its edge band or veneer, however much area they cover.

**Hew** (PLUGINS.md "Materials"). A face shows its own paint, else its object's base material, else the material of the nearest painted instance on its path (SketchUp's rendering rule). Each `occurrences` row reports both:

- `material`: an object's base, or an instance's **own** material;
- `material_effective`: what the node's unpainted faces show, after inheritance.

`hew.query.faces` called with an occurrence `path` gives each face's effective material (own, else base, else inherited).

**The difference, now readable.** Upstream looks at the *instance* first, because in SketchUp painting an instance is how users set a part's material. Hew's effective material follows the *rendering* order (face first). Since an instance row carries its own `material` separately, the plugin can apply upstream's rule exactly; nothing on the Hew side blocks it.

**The Python port** uses the material covering the largest face area of each Object (face material, else the Object default). That differs from upstream: area, not votes.

**Decision (Boris).** Keep **upstream's instance-first order**: it is what OpenCutList users expect, and it was already a deliberate choice against SketchUp's own rendering order, which is the same as Hew's.

**Proposal.** For a body (§1):
1. the material of the nearest **instance** on its path, if painted and not virtual;
2. otherwise its **dominant material by votes**: one vote per face (from `faces {path}`), virtual types skipped, ties broken by type order. For a loose Object, its base material stands in for unpainted faces;
3. otherwise the material **inherited** from the rows above on the path.

`material_effective` is `null` on a group row, so groups only matter through step 3.

## 8. Edge banding and veneer

**OpenCutList.** For sheet goods, the faces whose normals run along the part's axes are collected. The min and max faces on each axis (swapped when the instance is flipped) give the four edge materials and the two veneer materials, which are recognised by their material type (`TYPE_EDGE`, `TYPE_VENEER`). `edge_decremented` subtracts the band thickness from the cut size.

**Hew.** `hew.query.faces` with an occurrence `path` gives each face's plane, normal and effective material. Material types live in our namespace on the material (§11). Faces and edges also carry attribute dictionaries (addressed by locator), which survive push/pull, copies and cuts across a face; face dictionaries survive booleans too, edge dictionaries don't.

**Corrections (Boris).**
- The swap condition is `flipped ^ size.axes_flipped?`, not `flipped` alone: the axis permutation done by `auto_orient` also changes the frame's handedness.
- Besides `edge_decremented`, the **veneer thickness is subtracted from the part thickness** (`veneers_def[:thickness_decrement]`).

**Proposal.** Same algorithm as upstream, in the occurrence's `part_frame`: classify faces by normal against the frame axes, take min and max per axis, and swap them when `mirrored XOR axes_permuted`, where `axes_permuted` is set when the plugin's reordering of `part_frame` extents (§6) changes handedness, on top of the `y` negation for mirrored placements (§4). Subtract edge band and veneer thicknesses as upstream. Keep typed materials as the source of truth. Face attributes are an option for data that isn't a material.

## 9. Visibility

**OpenCutList.** An entity is skipped if it is hidden, or on a hidden layer (tag) or in a hidden tag folder (`LayerVisibilityHelper`). The walk stops at a hidden entity, so a hidden group hides everything inside it. One SketchUp quirk: a hidden Layer0 ("Untagged") only hides entities at the model root. `always_face_camera` components are skipped.

**Hew.** Each row's `hidden` is the effective visibility: its own flag and tags, its groups', and every instance on the path. `include_hidden: false` (the default) skips hidden placements and doesn't descend hidden instances. Hew has **no** face-camera, glued or cuts-opening components (granroth), so upstream's handling of face-camera and cuts-opening components goes away.

**Proposal.** Call `occurrences` with `include_hidden: false` by default, and offer "include hidden parts" as an option.

## 10. Scope and header

**OpenCutList.** The list is generated from the **selection** if there is one, otherwise from the whole model (or from the active path). The header shows the model's name and description, the active editing path, and the active scene's name and description.

**Hew.** `occurrences` takes `roots`: node ids or `{path}` locators. The selection comes from `hew.selection.get`, filtered to `obj_`/`grp_`/`ins_` ids, since a selection can also hold sketches, guides or annotations, which `roots` refuses. The active context's `direct_members` also work as roots, and its `stack` is the active path. While an editing session is open, `occurrences` lists the model as it is being edited. Hew documents have a title but no description, so the header uses the document title plus the active scene's name and description.

**Proposal.** Same behaviour as upstream. "Generated from the selection" stays a visible flag in the header.

## 11. Where settings live

Upstream stores everything in the `ladb_opencutlist` dictionary, as strings with units. In Hew, attribute values are JSON (HEW_API §8), so we can store numbers and arrays in **mm**, not strings with units. Every entity and the document carry dictionaries, and so do faces and edges.

**Namespace:** `org.opencutlist`, which is also the plugin id. `hew.*` is Hew's own (for example `hew.part` / `frame`, §6).

| Upstream key (dictionary) | On (SketchUp) | On (Hew) | Notes |
|---|---|---|---|
| `uuid`, `numbers` | definition | definition, or the Object for loose parts | see §12 |
| `cumulable`, `instance_count_by_part`, `thickness_layer_count` | definition | definition / Object | |
| `mass`, `url`, `tags`, `symmetrical`, `ignore_grain_direction` | definition | definition / Object | upstream reads `Price` from SketchUp's own dictionary |
| `orientation_locked_on_axis` | definition | definition / Object | together with `rebase` / `set_frame` (§6) |
| `length_increase`, `width_increase`, `thickness_increase`, `follow_grain_direction` (8.0) | definition | definition / Object | numbers in mm, booleans |
| `role`: `front_panel`, `back_panel`, `hinge` (8.0) | definition | definition / Object | used by Smart Build's cavity detection |
| `is_grain_group` (8.0) | instance | instance or group | the nearest marked node on the path groups parts by grain |
| `type` (solid wood, sheet good, dimensional, edge, hardware, veneer, **machining** in 8.0) | material | material | |
| `description`, `url` | material | material | |
| `thickness`, `length_increase`, `width_increase`, `thickness_increase` | material | material | numbers in mm |
| `std_lengths`, `std_widths`, `std_thicknesses`, `std_sections`, `std_sizes` | material | material | arrays |
| `grained`, `edge_decremented`, `raw_estimated`, `multiplier_coefficient` | material | material | |
| `std_volumic_masses`, `std_prices`, `std_cut_prices` | material | material | JSON |
| per-model presets | model | document | written on `document_will_save` |
| global presets | SketchUp defaults | plugin settings store | |

**The Python port** keeps material settings in a file outside the model (`~/.config/hewcut/materials.json`), keyed by material name. That was only because it had no attribute writes. It goes away.

**Answered (Boris).** On instances, 7.1.0 stores nothing beyond the material and the name. 8.0 adds `is_grain_group` (above), and the door opening attribute (`door_def.rb`), which isn't part of the cut list. Boris also mentions new material settings for machining (`machining_separated`, `machining_material_colored`), to be mapped once the machining question (§1) is settled.

## 12. Identity

**OpenCutList.** Definitions and materials get a `uuid` attribute. The definition's `uuid` is part of the part key (§2), and the part numbers are saved on the definition under `numbers`, keyed by part key, so numbers stay stable across generations.

**Hew.** Public entity ids are stable across undo, redo, save and load: the file format stores them as `sid` since v14 (granroth confirmed HEW_API §5.1 is stale on this). Since M1 a saved document also has a persistent `document_id` (a UUID minted on first save, kept by Save As and copies), meant for state a plugin keeps per model outside the model. Faces and edges of solids have **no** ids; they are addressed by locators (point on a face).

**Proposal.** Keep our own `uuid` in `org.opencutlist` anyway. It survives copy and paste between documents and library inserts, which entity ids won't. Use Hew ids within a document, and `document_id` for anything kept outside it (caches, per-document plugin storage).

**Caveat (Boris).** A `uuid` stored on a loose Object is copied along with it, so two copies edited apart keep the same `uuid` (upstream has the same issue after make-unique). With the fingerprint of §2 this doesn't merge different parts, since the key includes the geometry. For stable numbering, numbers are saved keyed by part key, and when two bodies with the same `uuid` end up with different fingerprints, the newer one gets a fresh `uuid`.

## 13. Curves and fillets

**OpenCutList.** SketchUp has no true curves: arcs and circles are polylines, so a round top is a polygon, cylinders are faceted, and exports and nesting see segments.

**Hew.** Curves are analytic. Tested on 1.3.1: a 300 mm circle extruded 25 mm is one closed solid, and every side face reports its `surface` as a cylinder (axis and radius). The 48 segments are only the tessellation. granroth's `hew.compute.outline` (M2) returns outlines with analytic arcs, and fillets are planned as a core Hew feature.

**Proposal.** Keep curves analytic all the way through: `part_frame` extents of a round part are its true size, `outline` feeds Packy's irregular mode (which accepts circular arcs) and DXF export (true arcs for CNC). Edge banding on a curved edge is measured on the real arc length.

---

## What the Python port got wrong by design

granroth flagged these, and M1 confirms them:

1. **Mirrored instances aren't reachable.** True on Hew 1.3 through `hew-cli`. Since M1 they explode, open in place, and report `mirrored`.
2. **"Walk = export a copy + explode everything".** A workaround for `query.scene` not listing nested instances. `occurrences` replaces it.
3. **Material from face area.** Upstream counts votes, and Hew exposes both the instance's own material and the inherited one (§7).
4. **Settings in a side file keyed by material name.** They belong in attributes (§11).
5. **Grouping by name + size.** It should group by definition first (§2), and use a geometric fingerprint, not names, for bodies without one.
6. **Mirrored twins as one part.** Upstream lists them apart unless the part is `symmetrical` (§4).

## Answered by @granroth (#60, 31 October)

1. **Sources.** The "§7.7 and §18" references came from an internal spec. The public equivalents are `docs/agents/PLUGINS.md` and `docs/API_REFERENCE.gen.md` on `feature/plugin-system`.
2. **Flat definitions.** The ARCHITECTURE wording predates `.hew` v15 and will be fixed with M2 (§3).
3. **Face-camera, glued, cuts-opening.** None exist in Hew, so upstream's special cases for them go away (§1, §9).
4. **Local axes.** Components have them (`rebase`); objects and groups get a frame override (`set_frame`); drawing and an Axes tool come in M2 and M4 (§6).
5. **Persistent ids.** `sid` since v14; HEW_API §5.1 is stale (§12).

## Open questions

For @bbeaulant:
1. Is "a part is a closed body" a sound base? (§1)
2. Glued-up blanks: two parts by default with a "one part" attribute, or the other way round? (§1)
3. Machining: keep 8.0's separate machining entities, or ask Hew for a native, non-destructive form? (§1)

For @granroth:
1. Bodies split on import: join a seam family into one Object, or report families in `occurrences`? (§1)
2. Handedness of loose bodies, so left and right parts can be told apart without a definition. (§1, §2)
3. `mirrored` and `part_frame` on nested occurrences: full path or own placement? (§4)

Answered in 0.3: material order (upstream's, §7), instance-level attributes (§11).
