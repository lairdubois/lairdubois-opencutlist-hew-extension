// Runs the linked-copies acceptance cases against one Hew build.
//
//   HEW_CLI=/path/to/hew-cli node run.ts [--only L1,L7] [--json report.json]
//
// Each case gets its own headless hew-cli session and a fresh document.
// PASS / FAIL / SKIP (a TBD call in adapter.ts whose real shape isn't
// settled yet) / ERROR (anything else, e.g. a crash).

import { writeFileSync } from "node:fs";
import { Hew, cliPath } from "./hew.ts";
import { CASES, Fail } from "./cases.ts";
import { ApiNotSettled } from "./adapter.ts";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

type Outcome = { id: string; needs: string; title: string; status: string; detail: string; ms: number };
const results: Outcome[] = [];

const cli = cliPath();
console.log(`hew-cli: ${cli}\n`);

for (const c of CASES) {
  if (only && !only.includes(c.id)) continue;
  const t0 = Date.now();
  let status = "PASS";
  let detail = "";
  const hew = await Hew.start(cli);
  try {
    detail = (await Promise.race([
      c.run(hew),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout after 60 s")), 60_000)),
    ])) as string ?? "";
  } catch (e: any) {
    if (e instanceof Fail) {
      status = "FAIL";
      detail = e.message;
    } else if (e instanceof ApiNotSettled) {
      status = "SKIP";
      detail = `API not settled: ${e.message}`;
    } else {
      status = "ERROR";
      detail = `${e?.refusal ?? ""} ${e?.message ?? e}`.trim();
    }
  } finally {
    hew.close();
  }
  const ms = Date.now() - t0;
  results.push({ id: c.id, needs: c.needs, title: c.title, status, detail, ms });
  console.log(`${status.padEnd(5)} ${c.id.padEnd(4)} [${c.needs}] ${c.title}${detail ? `\n             ${detail}` : ""}`);
}

const count = (s: string) => results.filter((r) => r.status === s).length;
console.log(`\n${count("PASS")} pass, ${count("FAIL")} fail, ${count("SKIP")} skip, ${count("ERROR")} error`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ cli, date: new Date().toISOString(), results }, null, 2));
process.exit(count("ERROR") > 0 ? 2 : 0);
