# OpenCutList for Hew

OpenCutList's cut lists, cutting diagrams and labels for [Hew](https://hew3d.com), written in TypeScript on Hew's plugin API. A rewrite, not a port: the model, the rules and the vocabulary come from [OpenCutList](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension) (L'Air du Bois), and the part model is the one settled in the concept mapping (#1).

**Status: skeleton.** Hew runs plugins from its milestone 3 on. Until then the code runs against `hew-cli`, Hew's command-line bus, and only the part counting is here.

## Layout

| Path | What |
|---|---|
| `hew-plugin.json` | The plugin manifest (Hew's format, `docs/agents/PLUGINS.md` in Hew). Draft: Hew can't load plugins before M3. |
| `src/host/` | The only door to Hew. `Host` is the interface (`query`, `transact`). `HewCliHost` drives `hew-cli mcp` for development, while `RecordingHost` and `ReplayHost` record Hew's answers and replay them in tests. From M3, a host over the SDK joins them. |
| `src/model.ts` | What `hew.query.occurrences` reports, as the plugin reads it. |
| `src/cutlist/` | The counting rule (`count.ts`), material types (`materials.ts`), a Markdown table (`format.ts`). |
| `src/background.ts` | The plugin's entry: its bus commands as plain handlers over a `Host`, to be registered through the SDK in M3. |
| `test/scenes.ts` | Synthetic models, each with the cut list the rule must give. |
| `test/unit/` | The rule on recorded answers (`test/fixtures/`): no Hew needed. |
| `test/hew/` | The same scenes against a real Hew build. |
| `tools/record-fixtures.ts` | Records the fixtures from a real build. |

## Running

Node ≥ 23.6 runs the TypeScript directly; `npm install` only fetches the type checker.

```sh
npm install
npm test                                   # unit tests, on the recorded answers
npm run typecheck
HEW_CLI=/path/to/hew-cli npm run test:hew  # the same scenes, live
HEW_CLI=/path/to/hew-cli npm run record    # re-record the fixtures on a new build
```

`hew-cli` ships inside Hew (`Hew.app/Contents/MacOS/hew-cli` on macOS, in the AppImage on Linux). The fixtures say which build recorded them; they were recorded on `1.5.0-pre.plugin-m2`.

## The rule

- Hew reports facts, the plugin applies the rule.
- A part is any component placement with solids of its own, at any depth, sized from those solids only. Groups are transparent: their solids and the placements in them count toward the enclosing component.
- Identical parts are counted by definition, so Hew's linked copies count as one part placed several times. Rows are split on material, size and mirroring (unless the definition is `symmetrical`).
- Hardware (a placement painted with a `hardware` material) is one item. Machining bodies are left out of the size. Assemblies (no solids of their own) aren't parts. Hidden placements are skipped. Open objects are reported, not measured.
- Objects with no definition (never copied, or imported SketchUp groups) are listed as parts placed once. That's still open (#1).

The scenes cover each point. S5 (groups inside a part) and S6 (linked copies) come from what the real models showed on M2.

## License

GPL-3.0, like OpenCutList.
