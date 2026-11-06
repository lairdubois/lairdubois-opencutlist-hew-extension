// Prints what occurrences reports for the shapes the acceptance test uses.
// Usage: HEW_CLI=… node probe.ts
import { Hew, board, material } from "./hew.ts";

const hew = await Hew.start();
try {
  const oak = await material(hew, "Oak", [180, 140, 90]);
  const loose = await board(hew, "Loose shelf", [0, 0, 0], [0.6, 0.4, 0.018], oak);
  const side = await board(hew, "Side", [1, 0, 0], [0.5, 0.3, 0.018], oak);
  const cmp = await hew.one("hew.component.create", { members: [side] });
  const copy = await hew.one("hew.entity.move", { ids: [cmp.instance], translation: [0, 1, 0], copy: { count: 1 } });
  const looseCopy = await hew.one("hew.entity.move", { ids: [loose], translation: [0, -1, 0], copy: { count: 1 } });
  const a = await board(hew, "Rail A", [3, 0, 0], [0.8, 0.05, 0.02], oak);
  const b = await board(hew, "Rail B", [3, 0.2, 0], [0.8, 0.05, 0.02], oak);
  const grp = await hew.one("hew.group.create", { members: [a, b] });
  const outer = await hew.one("hew.component.create", { members: [grp.group, copy.ids[0]] });
  console.log(JSON.stringify({ cmp, copy, looseCopy, grp, outer }, null, 1));
  for (const r of await hew.occurrences()) {
    const { world_pose, ...rest } = r;
    console.log(JSON.stringify(rest));
  }
  console.log(JSON.stringify(await hew.query("hew.query.part_frame", { path: [outer.instance] })));
  console.log(JSON.stringify(await hew.query("hew.query.measure", { path: [loose] })));
} catch (e: any) {
  console.error("ERROR", e.refusal ?? "", e.message);
} finally {
  hew.close();
}
