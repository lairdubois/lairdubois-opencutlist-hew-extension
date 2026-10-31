# OpenCutList concepts → Hew's data model

*Draft 0.2, 31 October 2026. Written from the Python port's side by @TinyWorkshopDesign, to be corrected by @bbeaulant (OpenCutList side) and reviewed by @granroth (Hew side). 0.2 folds in granroth's answers on hew3d/hew#60 and the milestone 1 API.*

## Purpose

Before porting any feature, agree on how OpenCutList's core concepts map onto Hew's document model and the plugin bus. This document covers what a **part** is, how parts are counted and grouped, nesting, mirroring, scaling, size and orientation, materials, edge banding and veneer, visibility, scope, and where settings are stored.

Each section has three parts:

- **OpenCutList (SketchUp)**: how upstream does it today.
- **Hew**: the matching concept and the bus call.
- **Proposal / question**: what we should do, or what's still open.

## Sources

- **OpenCutList 7.1.0 source**: `cutlist_generate_worker.rb` (model walk, material resolution), `definition_attributes.rb`, `material_attributes.rb`.
- **Hew**, on the `feature/plugin-system` branch (milestone 1, pre-release `v1.4.0-pre.plugin-m1`):
  - `docs/agents/PLUGINS.md`, especially "Reading parts", "Materials" and "Attributes";
  - `docs/API_REFERENCE.gen.md`, generated from the registry the app dispatches through;
  - `docs/agents/ARCHITECTURE.md` §2.1, §2.7, §2.8, §2.11;
  - granroth's comments on hew3d/hew#60 (milestone plan, M1 release, answers to draft 0.1).
- **The Python port (Hew CutList)**: what it ran into on Hew 1.3.x through `hew-cli`.

## Summary table

| OpenCutList / SketchUp | Hew | Bus (milestone) | Status |
|---|---|---|---|
| Part = component definition whose instances contain faces | instance of a definition, or a loose Object | `hew.query.occurrences` (M1) | **open: §1** |
| Instance count of a part | occurrence rows that share a definition | `occurrences` (M1) | §2 |
| Group = transparent container | Group: no pose, never shared; transforms bake into leaves | `occurrences` | §1, §3 |
| Nested components | instances inside definitions | `occurrences` (M1) | §3 |
| Flipped instance (det < 0): separate part unless `symmetrical` | mirrored instance pose | `mirrored` on each row (M1) | §4 |
| Scaled instance | instance pose with non-uniform scale | `part_frame` extents, `world_pose` (M1) | §5 |
| Size from definition bounds + auto-orient / locked axes | definition axes; frame override on objects and groups | `part_frame`, `component.rebase`, `entity.set_frame` (M1) | §6 |
| Material: instance → dominant child → inherited | face → object base → nearest painted instance | `material`, `material_effective` on each row (M1) | §7, question for Boris |
| Edge banding / veneer: typed material on part faces | face material with an "edge"/"veneer" type in our namespace | `hew.query.faces {path}` + `part_frame` (M1) | §8 |
| Visibility: entity hidden + layer hidden, inherited | hidden flag + tags along the path | `hidden`, `include_hidden` (M1) | §9 |
| Scope: selection or whole model; `active_path` in header | `roots` = selection or context members; context `stack` | `occurrences {roots}`, `hew.query.context` (M1) | §10 |
| `ladb_opencutlist` attribute dictionary | attribute dictionaries, namespace `org.opencutlist` | `hew.attr.*` | §11 |
| Entity ids, part uuid, part numbers | `sid` (persisted since `.hew` v14), `document_id` | ids on every row (M1) | §12 |

---

## 1. What is a part

**OpenCutList.** A part is a **component definition**. The walk descends through groups and instances. A component instance becomes a part if its definition, including any groups nested inside it, contains faces, and its face bounds aren't empty or flat. Groups are never parts: their faces count toward the enclosing instance, and loose faces outside any component aren't listed. `cuts_opening` components are treated like groups, and `always_face_camera` components are skipped.

**Hew.** Geometry lives only in **Objects**, which are discrete watertight solids. Groups and definitions hold Objects but have no faces of their own (ARCHITECTURE §2.1, §2.7). A definition's members can be objects, groups and instances. Groups are never shared: two identical groups are two separate nodes.

**granroth's view** (#60, 31 Oct): a part is the **deepest node whose members are all objects**:

- an instance whose definition holds only objects;
- a group holding only objects;
- a loose object at any level.

A container with groups or instances inside is an assembly, and the walk descends. A container holding several solids (a hinge, a drawer front glued up from two boards) is one part with one `part_frame`, which is also what `measure` and `snapshot` assume when given a group or an instance. `kinds` on `occurrences` picks which row types come back.

**Where that differs from upstream.** The two rules agree on the main case: a component whose definition holds geometry only is one part, however many solids it has. They differ in three places:

| Case | Upstream | granroth's rule |
|---|---|---|
| Group holding only objects | never a part: transparent | one part |
| Component whose definition holds groups of objects | one part (the groups count toward it) | assembly: each group is a part |
| Objects outside any component | not listed | each one a part |

The first row matters most in Hew. Every extrusion is a separate Object, so users group boards all the time: a carcass group of five boards would be one part under granroth's rule and five under the upstream walk (if loose Objects are listed at all). Tested on M1: `part_frame` on a group of two separate 800 mm shelves returns one 1300 × 800 × 19 frame, the extent of the pair.

**The Python port** treats every Object as a part, named after the nearest meaningful name: its own, else the component's, else the enclosing group's.

**Proposal.**

- **Components behave as upstream.** An instance whose definition holds geometry (objects, and groups of objects) is one part; an instance whose definition holds further instances is an assembly. "One board = one component" stays the recommended way to model, as upstream.
- **Groups stay transparent**, as upstream. A glued-up part that should count as one is made a component, which is also what gives it a shared identity (§2).
- **Loose Objects are parts** (a Hew extension): an Object outside any component, at the top level, in groups, or next to nested instances inside an assembly definition, is one part. It has no definition, so identical loose Objects are grouped by a fingerprint (§2). This differs from upstream in one more case: there, a definition's own geometry next to nested components is one part, the definition itself.

**Questions for @bbeaulant.**
1. Do you agree with listing loose Objects, or should we keep upstream's discipline (components only, with a tip when the model has none)?
2. Groups: transparent as upstream, or granroth's "a group of objects is one part"?
3. A definition holding several Objects is one part under both rules. That suits a laminated leg, but not a cabinet module whose boards were never made components. Is the upstream answer ("make the boards components") enough, or do we want an "assembly" flag on a definition?

## 2. Counting and grouping

**OpenCutList.** The part key (`PartDef.generate_part_id`) is: the material/thickness group, the definition (its `uuid`, else its entity id; plus the instance name for dynamic components), the length, width and thickness at OpenCutList's precision, and the flipped flag (§4). So one definition can give several parts: by material, by scale, or by mirroring. `instance_count_by_part` lets several instances make one physical part. `cumulable` (none, length, width) merges identical parts into one longer or wider piece. Parts are numbered by letter or number and sorted by `part_order_strategy`.

**Hew.** Every `occurrences` row has `path`, `id`, `kind`, `definition` and `definition_name`, `name`, `tags`, `material` and `material_effective`, `mirrored`, `hidden` and `world_pose`. Rows that share a `definition` share a source. Groups and loose Objects are never shared, so two identical ones count 1 each unless they are fingerprinted (granroth).

**The Python port** groups by *name + material + size rounded to 0.1 mm*, because before `occurrences` it couldn't trust definitions: it had to explode everything.

**Proposal.** Components: group by definition, then split on material, size and mirroring, as upstream. Loose Objects: group by a fingerprint (name, effective material, `part_frame` extents at OpenCutList's precision), which is the port's rule kept only where there's no definition.

## 3. Groups and nesting

**OpenCutList.** Groups and instances are walked recursively. The path (`path + [entity]`) is kept for each instance, for material inheritance and the header.

**Hew.** Groups have no pose: a transform bakes into the leaves (ARCHITECTURE §2.7). Instances carry a pose. A definition's members can be objects, groups and instances (`.hew` v15). ARCHITECTURE §2.1 and §2.11 still call definitions "flat"; granroth confirmed that wording predates v15 and will fix it with M2. `occurrences` returns every placement, nested definitions expanded through each instance, with `path` (the instances above, outermost first), `depth`, `parent` and a 3×4 `world_pose`. `{ path: [...row.path, row.id] }` addresses any row in `part_frame`, `measure`, `faces` and `mesh`.

**What the port learned, now obsolete.** `query.scene` didn't list instances nested in definitions, so the port exported a copy and exploded it. `occurrences` removes that need: no explode and no copy.

**Still M2.** Entering a nested instance from the bus (`hew.view.enter`) and editing parts by path. The cut list itself only needs reads.

## 4. Mirrored instances

**OpenCutList.** A flipped instance (determinant < 0) is detected (`flipped_detection`). The flag is part of the part id (`PartDef.generate_part_id`), so **a mirrored instance is a separate part** (left and right are listed apart) unless the definition is marked `symmetrical`. The flag also swaps the min and max faces, which matters for edge banding and veneer sides. Boris's stretch notes add that mirrored twins deformed the same way must keep sharing their *definition*. That is a modelling rule, separate from how they're listed.

**Hew.** An instance pose may mirror (ARCHITECTURE §2.7). Since M1, reflections bake in the kernel: a mirrored instance explodes, opens in place and duplicates, and negative scale mirrors. Each `occurrences` row reports `mirrored`. `part_frame` on a mirrored placement keeps a right-handed frame (`y` negated) and reports `mirrored: true`. `hew.component.flip_instance` mirrors one placement across its definition's local x, y or z plane.

**What the port learned, now obsolete.** For mirrored instances the port measured the definition's Objects through the pose, and fell back to the bounding box when they contained further nesting. It also listed mirrored twins as the same part, which differs from upstream.

**Proposal.** Same as upstream: `mirrored` goes into the part key unless `symmetrical` is set, and it swaps the min/max faces for edges and veneer (§8). Because `part_frame` negates `y` for a mirrored placement, the swap has to be checked against that convention, not re-derived from the determinant.

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
- Default: `part_frame`. With `auto_orient`, reorder its extents longest first, as upstream.
- Locked orientation on a component: `hew.component.rebase`, plus `orientation_locked_on_axis: true` in our namespace, so `part_frame` and upstream's flag agree.
- Locked orientation on a loose Object: `hew.entity.set_frame`, plus the same flag. To mark grain across the width, write `x: [0, 1, 0]`, `y: [1, 0, 0]`.
- Smart Axes maps onto `rebase`, `set_frame` and `flip_instance`, all in M1.

## 7. Material resolution

**OpenCutList** (`_get_material`, with `smart_material`):
1. the material **painted on the instance** itself;
2. otherwise the **dominant material of its children** (at the first level, or through `cuts_opening` components);
3. otherwise the material **inherited** from the nearest ancestor in the path.

"Virtual" materials are skipped at every step. Those are the **edge** and **veneer** types (`MaterialAttributes.is_virtual?`), so a part's material is never its edge band or veneer, however much area they cover.

**Hew** (PLUGINS.md "Materials"). A face shows its own paint, else its object's base material, else the material of the nearest painted instance on its path (SketchUp's rendering rule). Each `occurrences` row reports both:

- `material`: an object's base, or an instance's **own** material;
- `material_effective`: what the node's unpainted faces show, after inheritance.

`hew.query.faces` called with an occurrence `path` gives each face's effective material (own, else base, else inherited).

**The difference, now readable.** Upstream looks at the *instance* first, because in SketchUp painting an instance is how users set a part's material. Hew's effective material follows the *rendering* order (face first). Since an instance row carries its own `material` separately, the plugin can apply upstream's rule exactly; nothing on the Hew side blocks it.

**The Python port** uses the material covering the largest face area of each Object (face material, else the Object default), close to upstream's "dominant child".

**Proposal.** Apply upstream's order on Hew's data: the instance row's own `material` (skipping virtual types), else the dominant material by face area across the part's Objects (from `faces {path}`, skipping virtual types), else the inherited material from the rows above on the path.

**Question for @bbeaulant.** Keep upstream's instance-first order, or follow Hew's face-first `material_effective`? They differ only when the faces are painted one way and the instance another.

## 8. Edge banding and veneer

**OpenCutList.** For sheet goods, the faces whose normals run along the part's axes are collected. The min and max faces on each axis (swapped when the instance is flipped) give the four edge materials and the two veneer materials, which are recognised by their material type (`TYPE_EDGE`, `TYPE_VENEER`). `edge_decremented` subtracts the band thickness from the cut size.

**Hew.** `hew.query.faces` with an occurrence `path` gives each face's plane, normal and effective material. Material types live in our namespace on the material (§11). Faces and edges also carry attribute dictionaries (addressed by locator), which survive push/pull, copies and cuts across a face; face dictionaries survive booleans too, edge dictionaries don't.

**Proposal.** Same algorithm as upstream, in the occurrence's `part_frame`: classify faces by normal against the frame axes, take min and max per axis, and swap them when the occurrence is mirrored (§4). Keep typed materials as the source of truth, as upstream. Face attributes are an option for data that isn't a material.

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
| `type` (solid wood, sheet good, dimensional, edge, hardware, veneer) | material | material | |
| `thickness`, `length_increase`, `width_increase`, `thickness_increase` | material | material | numbers in mm |
| `std_lengths`, `std_widths`, `std_thicknesses`, `std_sections`, `std_sizes` | material | material | arrays |
| `grained`, `edge_decremented`, `raw_estimated`, `multiplier_coefficient` | material | material | |
| `std_volumic_masses`, `std_prices`, `std_cut_prices` | material | material | JSON |
| per-model presets | model | document | written on `document_will_save` |
| global presets | SketchUp defaults | plugin settings store | |

**The Python port** keeps material settings in a file outside the model (`~/.config/hewcut/materials.json`), keyed by material name. That was only because it had no attribute writes. It goes away.

**Question for @bbeaulant.** Is there anything stored on **instances** (not definitions) upstream that we need, beyond the instance material?

## 12. Identity

**OpenCutList.** Definitions and materials get a `uuid` attribute. The definition's `uuid` is part of the part key (§2), and the part numbers are saved on the definition under `numbers`, keyed by part key, so numbers stay stable across generations.

**Hew.** Public entity ids are stable across undo, redo, save and load: the file format stores them as `sid` since v14 (granroth confirmed HEW_API §5.1 is stale on this). Since M1 a saved document also has a persistent `document_id` (a UUID minted on first save, kept by Save As and copies), meant for state a plugin keeps per model outside the model. Faces and edges of solids have **no** ids; they are addressed by locators (point on a face).

**Proposal.** Keep our own `uuid` in `org.opencutlist` anyway. It survives copy and paste between documents and library inserts, which entity ids won't. Use Hew ids within a document, and `document_id` for anything kept outside it (caches, per-document plugin storage).

---

## What the Python port got wrong by design

granroth flagged these, and M1 confirms them:

1. **Mirrored instances aren't reachable.** True on Hew 1.3 through `hew-cli`. Since M1 they explode, open in place, and report `mirrored`.
2. **"Walk = export a copy + explode everything".** A workaround for `query.scene` not listing nested instances. `occurrences` replaces it.
3. **Material from face area only.** Hew exposes both the instance's own material and the inherited one (§7).
4. **Settings in a side file keyed by material name.** They belong in attributes (§11).
5. **Grouping by name + size.** It should group by definition first (§2), keeping a fingerprint only for loose Objects.
6. **Mirrored twins as one part.** Upstream lists them apart unless the part is `symmetrical` (§4).

## Answered by @granroth (#60, 31 October)

1. **Sources.** The "§7.7 and §18" references came from an internal spec. The public equivalents are `docs/agents/PLUGINS.md` and `docs/API_REFERENCE.gen.md` on `feature/plugin-system`.
2. **Flat definitions.** The ARCHITECTURE wording predates `.hew` v15 and will be fixed with M2 (§3).
3. **Face-camera, glued, cuts-opening.** None exist in Hew, so upstream's special cases for them go away (§1, §9).
4. **Local axes.** Components have them (`rebase`); objects and groups get a frame override (`set_frame`); drawing and an Axes tool come in M2 and M4 (§6).
5. **Persistent ids.** `sid` since v14; HEW_API §5.1 is stale (§12).

## Open questions

For @bbeaulant:
1. Parts: list loose Objects? Groups transparent, or "a group of objects is one part"? An "assembly" flag on definitions? (§1)
2. Material: upstream's instance-first order, or Hew's face-first effective material? (§7)
3. Instance-level attributes we'd need (§11).
