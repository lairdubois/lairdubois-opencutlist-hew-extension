# OpenCutList concepts → Hew's data model

*Draft 0.1, 30 October 2026. Written from the Python port's side by @TinyWorkshopDesign, to be corrected by @bbeaulant (OpenCutList side) and reviewed by @granroth (Hew side).*

## Purpose

Before porting any feature, agree on how OpenCutList's core concepts map onto Hew's document model and the plugin bus. This document covers what a **part** is, how parts are counted and grouped, nesting, mirroring, scaling, size and orientation, materials, edge banding and veneer, visibility, scope, and where settings are stored.

Each section has three parts:

- **OpenCutList (SketchUp)**: how upstream does it today.
- **Hew**: the matching concept and the bus call (mostly milestone 1).
- **Proposal / question**: what we should do, or what's still open.

## Sources

- **OpenCutList 7.1.0 source**: `cutlist_generate_worker.rb` (model walk, material resolution), `definition_attributes.rb`, `material_attributes.rb`.
- **Hew**:
  - `docs/agents/ARCHITECTURE.md` §2.1, §2.7, §2.8, §2.11;
  - `docs/agents/HEW_API.md` §5 (identity) and §8 (attributes);
  - the plugin design gist `PLUGIN_SYSTEM.md` ("The model half: the bus", "OpenCutList, feature by feature");
  - granroth's milestone plan in hew3d/hew#60.
- **The Python port (Hew CutList)**: what it ran into on Hew 1.3.x through `hew-cli`.

> @granroth: you pointed to "sections 7.7 and 18 of the gist", but I can't find them. The published gist has a single revision (28 October) with 15 unnumbered sections. HEW_API.md has §1–§16, and §7 has only 7.1 and 7.2. No Markdown file in `hew3d/hew` (`main` or other branches) has a 7.7 or an 18. Is there a newer revision I should read?

## Summary table

| OpenCutList / SketchUp | Hew | Bus (milestone) | Status |
|---|---|---|---|
| Part = component definition whose instances contain faces | Object (watertight solid), placed directly or through instances | `hew.query.occurrences` (M1) | **open: §1** |
| Instance count of a part | occurrences that share one source | `occurrences` (M1) | §2 |
| Group = transparent container | Group: no geometry and no pose; transforms bake into leaves | `occurrences` | §3 |
| Nested components | instances inside definitions | `occurrences` (M1) | §3 |
| Flipped instance (det < 0): separate part unless `symmetrical` | mirrored pose on an instance | `occurrences` (mirrored flag, M1) | §4 |
| Scaled instance | instance pose with non-uniform scale | `occurrences` world transform | §5 |
| Size from definition bounds + auto-orient / locked axes | `hew.query.part_frame`; frame override | `part_frame` (M1); rebase/frame override (M2) | §6, **open: local axes** |
| Material: instance → dominant child → inherited | face → object → nearest instance | effective material on each row (M1) | **open: §7** |
| Edge banding / veneer: typed material on part faces | face material with an "edge"/"veneer" type in our namespace | `hew.query.faces` + `part_frame` | §8 |
| Visibility: entity hidden + layer hidden, inherited | hidden flag + tags along the path | `hidden`, `include_hidden` (M1) | §9 |
| Scope: selection or whole model; `active_path` in header | `roots` = selection or context members; context `stack` | `occurrences {roots}`, `hew.query.context` | §10 |
| `ladb_opencutlist` attribute dictionary | attribute dictionaries, namespace `org.opencutlist` | `hew.attr.*` | §11 |
| Entity ids, part uuid, part numbers | stable public ids (api-owned, persisted in `.hew`) | §5 of HEW_API | §12 |

---

## 1. What is a part

**OpenCutList.** A part is a **component definition**. The walk descends through groups and instances. A component instance becomes a part if its definition, including any groups nested inside it, contains faces, and its face bounds aren't empty or flat. Groups are never parts: their faces count toward the enclosing instance. `cuts_opening` components are treated like groups, and `always_face_camera` components are skipped.

**Hew.** Geometry lives only in **Objects**, which are discrete watertight solids. Groups and definitions hold Objects but have no faces of their own (ARCHITECTURE §2.1, §2.7). One definition can hold several Objects, and Objects can also sit at the top level or in groups, with no component at all. The gist's own example counts parts as `occurrences({kinds: ["object"]})`.

**The Python port** treats every Object as a part, named after the nearest meaningful name: its own, else the component's, else the enclosing group's. That's the natural reading in a solids-first modeler. People modelling in Hew draw one board, and it's an Object straight away, with no need to make it a component first.

**Proposal.** Support both, with one rule:

- An **Object** is the unit of geometry and measurement.
- A part's **identity** is its **definition** when the Object is the only solid in a component definition (the upstream case: "one board = one component"), and the **Object itself** otherwise. That covers top-level Objects, Objects in groups, and several Objects inside one definition.

**Questions.**
- @bbeaulant: upstream only lists components, and shows a tip when the model has none. Should we keep that discipline, or accept loose Objects as parts? Accepting them is friendlier in Hew, but loose Objects have no shared identity, so two identical boards drawn separately are grouped only by name, material and size, not by definition.
- How should a definition that contains several Objects be treated? Upstream would make it one part, measured from all its faces. The port lists each Object separately, which suits a cabinet module but not a laminated leg.

## 2. Counting and grouping

**OpenCutList.** The part key (`PartDef.generate_part_id`) is: the material/thickness group, the definition (its `uuid`, else its entity id; plus the instance name for dynamic components), the length, width and thickness at OpenCutList's precision, and the flipped flag (§4). So one definition can give several parts: by material, by scale, or by mirroring. `instance_count_by_part` lets several instances make one physical part. `cumulable` (none, length, width) merges identical parts into one longer or wider piece. Parts are numbered by letter or number and sorted by `part_order_strategy`.

**Hew.** Every row of `occurrences` has a path, an id, its kind and its definition. Instances that share a definition share a source, so counting is "group rows by definition (or by Object id for loose Objects)".

**The Python port** groups by *name + material + size rounded to 0.1 mm*, because before `occurrences` it couldn't trust definitions: it had to explode everything.

**Proposal.** Group by definition (or Object), then split on material and size, as upstream does. Keep the port's name/material/size rule only as an optional "merge identical loose parts" setting.

## 3. Groups and nesting

**OpenCutList.** Groups and instances are walked recursively. The path (`path + [entity]`) is kept for each instance, for material inheritance and the header.

**Hew.** Groups have no pose: a transform bakes into the leaves (ARCHITECTURE §2.7). Instances carry a pose. Definitions can contain groups and instances: since `.hew` format v15, `components[].members` are node references (`object`, `group`, `instance`) (HEW_FILE_FORMAT.md), and `delete_definition` refuses while "a live definition still nests it" (ARCHITECTURE §2.11). `occurrences` returns every placement with its path and world transform (gist, M1).

**What the port learned, now obsolete.** `query.scene` didn't list instances nested in definitions, so the port exported a copy and exploded it. M1 removes that need: once `occurrences` lands, no explode and no copy.

**Question for @granroth.** ARCHITECTURE §2.1 says a definition "owns a flat set of geometry", and §2.11 says "definitions are flat, so nothing inside one can host a further frame". The file format (v15+) and the "still nests it" refusal say definitions can hold groups and instances. Are those two sentences just older than v15? If so, they could be updated, since the parts walk depends on it.

## 4. Mirrored instances

**OpenCutList.** A flipped instance (determinant < 0) is detected (`flipped_detection`). The flag is part of the part id (`PartDef.generate_part_id`), so **a mirrored instance is a separate part** (left and right are listed apart) unless the definition is marked `symmetrical`. The flag also swaps the min and max faces, which matters for edge banding and veneer sides. Boris's stretch notes add that mirrored twins deformed the same way must keep sharing their *definition*. That is a modelling rule, separate from how they're listed.

**Hew.** An instance pose may mirror (ARCHITECTURE §2.7). Today `hew.component.explode` refuses a mirrored instance (`cannot_explode_reflected`, API reference). The app edits one in context instead of opening an explode session (ARCHITECTURE §2.11), but in our tests on 1.3.x `hew.context.enter` refused it through the bus. In M1 the reflection kernel work lands and `occurrences` returns mirrored placements.

**What the port learned, now obsolete.** For mirrored instances the port measured the definition's Objects through the pose, and fell back to the bounding box when they contained further nesting. It also listed mirrored twins as the same part, which differs from upstream.

**Proposal.** Same as upstream: `occurrences` must report whether each placement is mirrored (determinant of the accumulated world transform). That flag goes into the part key unless `symmetrical` is set, and it swaps the min/max faces for edges and veneer.

## 5. Scaled instances

**OpenCutList.** Instance scale is applied to the definition bounds (`Size3d.create_from_bounds(bounds, instance_info.scale, …)`). A scaled instance gives a different size.

**Hew.** Instance poses may scale non-uniformly. Plain Objects and groups bake transforms, so they never carry a scale.

**Proposal.** Size comes from `part_frame` on the occurrence, scale included. As upstream, the size is part of the part key, so rows with the same definition but a different size become separate parts.

## 6. Size and orientation

**OpenCutList.** Length, width and thickness come from the definition's face bounds in its own axes. With `auto_orient` the longest dimension becomes the length, unless the definition has `orientation_locked_on_axis`. Then the definition's axes win, which is how users force grain direction or front/back roles. Smart Axes and Edit Part change those axes.

**Hew.** `hew.query.part_frame` returns an oriented frame plus length, width and thickness, for components and plain Objects alike. The gist adds a **frame override** that `part_frame` reads first (for plain Objects), and a **rebase** command that re-expresses a definition in a new frame and compensates every instance. Hew has no visible local axes on groups or components today (Boris's question on #60, open).

**The Python port** computes the frame from face areas (most area = board face, next perpendicular = edge). That's roughly what `part_frame` will do natively.

**Proposal.**
- Default: `part_frame`.
- User choice (locked orientation): store it as a frame override on the Object or a rebase of the definition, plus `orientation_locked_on_axis: true` in our namespace, so the choice survives edits and is visible to `part_frame`.
- Whether Hew shows that frame as **local axes** in the viewport is the open question from Boris. For woodworkers I'd say yes: grain direction is a property you want to see on the part.

## 7. Material resolution

**OpenCutList** (`_get_material`, with `smart_material`):
1. the material **painted on the instance** itself;
2. otherwise the **dominant material of its children** (at the first level, or through `cuts_opening` components);
3. otherwise the material **inherited** from the nearest ancestor in the path.

"Virtual" materials are skipped at every step. Those are the **edge** and **veneer** types (`MaterialAttributes.is_virtual?`), so a part's material is never its edge band or veneer, however much area they cover.

**Hew** (gist, M1): a face's own paint wins, then the Object's default material, then the **nearest enclosing instance**'s. Instance materials are a new kernel feature. Each `occurrences` row will report the **effective material after inheritance**.

**The difference.** Upstream looks at the *instance* first, because in SketchUp a painted instance is how users set a part's material. Hew's order is the *rendering* order (face first). In most models both give the same answer. They differ when a part has its faces painted one way and the instance another.

**The Python port** uses the material covering the largest face area of each Object (face material, else the Object default). That's close to upstream's "dominant child".

**Proposal.** Use Hew's effective material per **Object**, skipping edge and veneer types as upstream does, then pick the part's material by the dominant area across its Objects, as upstream's step 2 does. Treat an instance material as the part material only when the faces don't carry their own.

**Question for @bbeaulant.** Upstream gives the instance's own material priority over its faces. Is that something users rely on, i.e. painting the instance to set the board material while the faces show something else? If so, we need to read the instance material separately rather than Hew's face-first effective material.

## 8. Edge banding and veneer

**OpenCutList.** For sheet goods, the faces whose normals run along the part's axes are collected. The min and max faces on each axis (swapped when the instance is flipped) give the four edge materials and the two veneer materials, which are recognised by their material type (`TYPE_EDGE`, `TYPE_VENEER`). `edge_decremented` subtracts the band thickness from the cut size.

**Hew.** Faces carry a material. `hew.query.faces` gives planes and normals. The gist confirms the upstream model: "a face painted with an 'edge' or 'veneer' typed material". Material types live in our namespace on the material (§11).

**Proposal.** Same algorithm, in the `part_frame` of the occurrence: classify faces by normal against the frame axes, take min and max per axis, and swap them when the occurrence is mirrored.

## 9. Visibility

**OpenCutList.** An entity is skipped if it is hidden, or on a hidden layer (tag) or in a hidden tag folder (`LayerVisibilityHelper`). The walk stops at a hidden entity, so a hidden group hides everything inside it. One SketchUp quirk: a hidden Layer0 ("Untagged") only hides entities at the model root.

**Hew.** Objects, groups and instances can be hidden and carry tags (§2.8). In M1 each row's `hidden` is the effective visibility (own flag, groups above, tags on itself and its ancestors, every instance on the path), and `include_hidden: false` prunes hidden subtrees (granroth, #60).

**Proposal.** Call `occurrences` with `include_hidden: false` by default, and offer "include hidden parts" as an option.

**Question.** Does Hew have equivalents of `always_face_camera` and glued instances, or `cuts_opening`? If not, those upstream exclusions just disappear.

## 10. Scope and header

**OpenCutList.** The list is generated from the **selection** if there is one, otherwise from the whole model (or from the active path). The header shows the model's name and description, the active editing path, and the active scene's name and description.

**Hew.** `occurrences` takes `roots`: the selection (`hew.selection.get`), or the `direct_members` of `hew.query.context`. The context's `stack` is the active path. Hew documents have a title but no description, so the header uses the document title plus the active scene's name and description (granroth, #60).

**Proposal.** Same behaviour. "Generated from the selection" stays a visible flag in the header, as upstream.

## 11. Where settings live

Upstream stores everything in the `ladb_opencutlist` dictionary, as strings with units. In Hew, attribute values are JSON (HEW_API §8), so we can store numbers and arrays in **mm**, not strings with units.

**Namespace:** `org.opencutlist`, which is also the plugin id.

| Upstream key (dictionary) | On (SketchUp) | On (Hew) | Notes |
|---|---|---|---|
| `uuid`, `numbers` | definition | definition, or the Object for loose parts | see §12 |
| `cumulable`, `instance_count_by_part`, `thickness_layer_count` | definition | definition / Object | |
| `mass`, `url`, `tags`, `symmetrical`, `ignore_grain_direction` | definition | definition / Object | upstream reads `Price` from SketchUp's own dictionary |
| `orientation_locked_on_axis` | definition | definition / Object | together with the frame override (§6) |
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

**Hew.** Public entity ids are api-owned and stable across undo and redo (HEW_API §5.1). They are also stable across save and load: HEW_API §5.1 still describes the persistent id as a planned addition, but the file format already stores it as `sid` on every entity since v14, next to the `attrs` dictionaries (HEW_FILE_FORMAT.md). Faces and edges of solids have **no** ids. They are addressed by locators (point on a face).

**Proposal.** Keep our own `uuid` in `org.opencutlist` anyway. It survives copy and paste between documents and library inserts, which entity ids won't. Use Hew ids only within a session.

---

## What the Python port got wrong by design

granroth already flagged these, and I agree:

1. **Mirrored instances aren't reachable.** True on Hew 1.3 through `hew-cli`. Not true from M1 on.
2. **"Walk = export a copy + explode everything".** This was a workaround for `query.scene` not listing nested instances. `occurrences` replaces it.
3. **Material from face area only.** Hew's inheritance (face → object → nearest instance) is the right base (§7).
4. **Settings in a side file keyed by material name.** They belong in attributes (§11).
5. **Grouping by name + size.** It should group by definition first (§2).
6. **Mirrored twins as one part.** Upstream lists them apart unless the part is `symmetrical` (§4).

## Open questions, collected

For @bbeaulant:
1. Parts: components only, or loose Objects too? And a definition with several Objects: one part or many? (§1)
2. Instance material before face material: do users rely on it? (§7)
3. Instance-level attributes we'd need (§11).

For @granroth:
1. Where are "gist §7.7 and §18"? (Sources)
2. Definitions "flat" vs nested instances (§3).
3. `always_face_camera`, glued, `cuts_opening`: do they exist in Hew? (§9)
4. Local axes: shown and settable on groups and components? (§6, Boris's question)
5. HEW_API §5.1 still calls the persistent id a planned addition, while `sid` has been in the file format since v14. Just a stale paragraph? (§12)
