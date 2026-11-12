# Acceptance test: linked copies (Hew milestone 2)

> **Status: run on the M2 pre-release (`v1.5.0-pre.plugin-m2`): 18 of 18 pass, on real linked copies.** No simulation is involved in that result. Kurt (granroth) ran it first on Linux; it was re-run on Linux arm64, headless, on 12 November 2026. See "Results on M2" below.

What OpenCutList needs from Hew's linked copies, as executable cases. Agreed on hew3d/hew#60 and in [lairdubois-opencutlist-hew-extension#1](https://github.com/lairdubois/lairdubois-opencutlist-hew-extension/pull/1) (concept mapping 0.4, §2 and §14): copying an Object or a group links it by default, with component semantics, per-placement data, and an explicit Unlink.

## How a link is checked

Every case leans on one fact that Hew M1 already reports. In `hew.query.occurrences`, **placements of one shared solid are object rows with the same `id` under different paths**: a component's object shows up once per placement of the component. An independent copy has a new `id`. So "these copies are linked" means "one object id, N placements", whatever form the implicit component takes in M2.

## Running it

Needs Node ≥ 23 (TypeScript runs directly) and the `hew-cli` of the build under test. No other dependency.

```bash
HEW_CLI=/path/to/Hew.app/Contents/MacOS/hew-cli node run.ts
HEW_CLI=… node run.ts --only L1,L7 --json report.json
```

Each case runs in its own headless `hew-cli mcp` session, on a fresh document it builds itself. Outcomes:

- **PASS / FAIL**: the behaviour is right or wrong.
- **SKIP**: a call whose M2 shape isn't public yet (marked TBD in `adapter.ts`) was rejected for its *shape* (unknown field, locator form). Only those calls can skip. Once the names are settled, they change in `adapter.ts` only.
- **ERROR**: anything else (a crash, a timeout).

`OCL_SIMULATE_LINKS=1` checks the cases themselves on a build without linked copies: before each copy gesture, loose objects and groups are folded into a component in the same transaction, which is what M2 is expected to do implicitly. It is for testing the test, not Hew.

## Cases

**Baseline** (true on M1 already; they validate the harness):

| Id | What | Expected |
|---|---|---|
| B1 | A component placed three times | one object id, 3 placements; instances share one definition |
| B2 | `make_unique` on one placement | 3 placements of 2 solids; reports whether the copy kept its name and attributes |
| B3 | Mirror inside a mirror | one mirror reads `mirrored: true`; mirror inside mirror reads `false` (accumulated along the path) |
| B4 | Grid copy 4 × 3 of a component | 12 placements of one solid |

**Linked copies** (M2):

| Id | Gesture | Expected |
|---|---|---|
| L1 | Move copy of a loose board | 2 placements of one solid |
| L2 | Array copy ×3 | 4 placements of one solid, **one** undo step; undo leaves 1 |
| L3 | Grid copy 4 × 3 of a loose board | 12 placements of one solid |
| L4 | Rotate copy ×3 (polar) | 4 placements of one solid |
| L5 | Mirrored copy | still linked; one placement reads `mirrored: true` |
| L6 | Copy of a group of two boards | each board linked across the two groups |
| L7 | Push/pull a face **through one copy** | every copy changes (thickness 18 → 20 mm); still linked |
| L8 | Subtract a tool **through one copy** | every copy shows the cut, or an explicit refusal; **never a silent split** |
| L9 | Unlink one copy by path | 3 placements of 2 solids; a remap is returned; the unlinked copy keeps its **name** and the definition's **attributes** |
| L10 | Independent copy (Paste New) | 2 separate solids |
| L11 | Rename, paint and set an attribute on three different copies; set an attribute on the definition | per-placement data stays on its placement; definition data reaches every copy; the link holds |
| L12 | Paint a face (edge band) **through one copy** | the painted face shows on every copy |
| L13 | Two linked sides in a cabinet, cabinet copied | 4 placements of one solid (links nest) |
| L14 | Save and reopen (`.hew`) | still 3 placements of one solid |

## The five M2 calls (`adapter.ts`)

These were guesses before M2. They now carry the shapes M2 takes (corrections by granroth):

| Function | M2 shape | Meaning |
|---|---|---|
| `independentCopy` | `hew.entity.move {copy: {count, linked: false}}` | the "Paste New" copy |
| `unlink` | `hew.component.make_unique {path, cascade: true}`, where `path` is the **instance** path (no trailing object id) | Unlink by occurrence path, returning the id remap |
| `pushPullThrough` | `hew.solid.push_pull {face: {path, at}}`, with `at` in the **leaf's own frame** (the definition's coordinates, as `hew.query.faces {path}` and raycast report them) | edit a face of one placement |
| `subtractThrough` | `hew.solid.subtract {a: {path}, b}` (the guess was right) | a boolean on one placement |
| `paintFaceThrough` | `hew.material.paint {face: {path, at}}`, `at` in the leaf's frame | paint a face of one placement |

The cases name world points; `toLeafFrame` maps them through the inverse of the placement's `world_pose`.

## Results on M2 (`v1.5.0-pre.plugin-m2`, Linux arm64, 12 November 2026)

- **18 of 18 pass**: B1–B4 and L1–L14, no skips.
- Before the three corrections in `adapter.ts`: 14 pass, L10 skips (`independent`), L7 and L12 answer `locator_missed` (world points), L9 answers `unknown_occurrence` (object id at the end of the path).
- The M1 finding is fixed: the copied solid keeps its name through Unlink and Make Unique (L9 checks it).

## Results on M1 (`v1.4.0-pre.plugin-m1`, macOS, 6 November 2026), for the record

- **Real gestures**: B1–B4 pass; L1–L9 and L11–L14 fail with "copies not linked" (expected before M2); L10 skips.
- **Simulated links** (`OCL_SIMULATE_LINKS=1`): 13 pass, 5 skip (the five TBD calls), 0 fail. This only checks the cases' own logic. **It is not a result on Hew's linked copies**: what remains for M2 is the real gesture plus the TBD calls, and the whole suite has to be run again on the M2 build.
- **One finding for M2** (B2): on M1, `make_unique` keeps the definition's attributes, but the copied solid **loses its name** (`"Side"` → `null`). Unlink has to keep it (L9 checks this).

## Files

- `hew.ts`: a small client for `hew-cli mcp` (headless, JSON-RPC over stdio).
- `adapter.ts`: the copy gestures and the five M2 calls.
- `cases.ts`: the cases.
- `run.ts`: the runner.
- `probe.ts`: prints what `occurrences` reports for a few shapes, to check the invariant on a new build.
