# Prototype: counting parts over `occurrences`

> **Status: run on milestone 1 with M2 reads simulated. Everything here must be re-tested on the M2 build.**
>
> - What M1 really verified: `occurrences`, `part_frame`, `faces` and `doc.health` as they are on M1, and the counting logic on top of them.
> - What is **simulated**, not tested on Hew: the three M2 reads (`members`, `solid`, `scope: "own"`, see below), and linked copies, which the cases build as explicit components because M1 has no linked copies.
> - So the synthetic results and the real-model results below show the rule works **on the simulated reads**. They don't show that M2's real reads give the same rows. When M2 is out, the simulations get replaced by the real calls and every case is run again.

The counting logic of OpenCutList for Hew, as settled in the concept mapping 0.4 ([#1](https://github.com/lairdubois/lairdubois-opencutlist-hew-extension/pull/1), §1 and §2), written in TypeScript over Hew's bus and run on milestone 1. It's the second thing I offered @granroth on hew3d/hew#60, next to the acceptance test for linked copies (#2).

## The rule it applies

- **Hew reports facts, the plugin applies the rule.**
- **A part is any component placement with solids of its own**, at any depth, sized from those solids only. Groups are transparent: their solids count toward the enclosing component. So a panel holding dowels is a part, and the dowels are parts too.
- **Counting is by definition**, split on material, size and mirroring (unless the definition is `symmetrical`). In M2, linked copies are definitions too, so the same rule counts them.
- **A container with several solids** (a glued-up blank) is one part; its pieces can be listed under it.
- **Hardware**: a placement painted with a `hardware`-typed material is one item, not descended.
- **Machining**: bodies painted with a `machining`-typed material are left out of the size.
- **Assemblies**: a placement with no solids of its own isn't a part.
- **Hidden** placements are left out (`include_hidden: false`).
- **Open objects** (not closed solids) are reported, not measured.
- **Loose objects** (no definition): still an open question for Boris. The prototype lists each as a part placed once, marked as such.
- **Material**: Boris's order. The placement's own material (not edge or veneer), else votes over its own solids' faces (one per face, ties by type order), else the inherited one.
- **Look-alike rows**: different definitions with the same material, size and mirroring are reported as candidates for Hew's "link them?" suggestion. They're never merged.

Material types are read from our attribute on the material (`org.opencutlist` / `type`), or from an optional name → type map.

## What it simulates on M1

Three M2 reads aren't on M1 yet. The prototype derives them from what M1 has, in one place each, so they can be swapped for the real calls:

| M2 read | Simulated on M1 with |
|---|---|
| `members` on each row | `path` and `parent`: an object's container is the last instance on its path |
| `solid` on object rows | `hew.doc.health`, which lists the objects that aren't closed |
| `scope: "own"` on `part_frame` | the own solids' faces (`hew.query.faces {path}` returns them in the definition's local coordinates), measured along the local axes and scaled by the placement |

## Running it

Needs Node ≥ 23 and a milestone 1 (or later) `hew-cli`.

```bash
HEW_CLI=/path/to/hew-cli node synthetic.ts             # the synthetic cases below
HEW_CLI=… node corpus.ts [--out dir] model.skp …       # real models, opened read-only in a headless session
```

## Synthetic cases (pass on M1, with simulated reads; to re-run on M2)

| Id | Model | Expected and found |
|---|---|---|
| S1 | Panel with four dowels nested in it | Panel ×1 at 600 × 400 × 18 (its own solid, not the dowels); Dowel ×4 |
| S2 | Leg glued up from two boards, placed four times | Leg ×4 at 700 × 50 × 50, two pieces listed under it |
| S3 | Left and right sides; a shelf marked `symmetrical`, one copy mirrored | Side as two rows (plain and mirrored); Shelf ×2 as one row |
| S4 | Hinge of three bodies painted as hardware ×2; door with a machining body inside; cabinet of components only; a shelf on a hidden tag; a loose board | Hinge ×2 as hardware; door 700 × 450 × 18 (tool left out); cabinet as an assembly; hidden shelf left out; loose board listed once |

## Real models (M1, simulated reads; to re-run on M2)

Four of my own `.skp` files, opened in Hew M1. Each took between 0.0 and 0.5 s (the Python port's export-and-explode walk takes up to 8 s on the larger models).

- **Table**: Leg, Brace long and Short brace come out split into plain and mirrored rows, because the model mirrors half of them. That's upstream's behaviour until the definition is marked `symmetrical`.
- **Desk-top shelf**: the five parts as expected. The SketchUp template's figure is reported as not closed, and the template wrapper as an assembly.
- **Microwave cabinet v3**: 38 rows. The part names come from the definitions, as upstream.
- **TV cabinet**: 24 rows. Two loose solids (former SketchUp groups) are listed once each, which is the open question. Three pairs come up as look-alike candidates, and one of them is a part and its mirror image modelled as two definitions (`Component10` and `Component10(Mirror)`). Without handedness the suggestion can't tell them apart, which is exactly what `hew.query.signature` is for.

Compared with the Python port on the same files, the sizes agree. The differences come from the rule, not the geometry:

- the port merged mirrored twins (Leg ×4), the prototype keeps them apart as upstream does;
- the port grouped by name across different definitions, the prototype counts by definition and only flags look-alikes;
- the port printed rough sizes for "solid wood" materials it guessed from the name (+50 / +5 / +5 mm); the prototype prints the net sizes.

## Files

- `count.ts`: the counting logic (`countParts`) and a Markdown formatter.
- `synthetic.ts`: the synthetic cases with their expected results.
- `corpus.ts`: runs the logic on model files.
- `probe.ts`: shows how M1 reports `part_frame` and faces for a rotated component (the basis of the `scope: "own"` simulation).
- It uses the `hew-cli` client from `tests/acceptance/linked-copies/hew.ts`.
