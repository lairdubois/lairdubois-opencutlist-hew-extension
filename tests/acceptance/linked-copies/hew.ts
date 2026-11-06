// A minimal client for `hew-cli mcp` (headless): one process, one private
// document, JSON-RPC over stdio. No dependencies; runs on Node >= 23
// (type stripping). Refusals come back as HewError, with the refusal name.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export class HewError extends Error {
  refusal: string | null;
  constructor(message: string, refusal: string | null = null) {
    super(message);
    this.refusal = refusal;
  }
}

export type Row = {
  id: string;
  kind: "object" | "group" | "instance";
  name: string | null;
  definition: string | null;
  definition_name: string | null;
  path: string[];
  parent: string | null;
  depth: number;
  mirrored: boolean;
  hidden: boolean;
  material: string | null;
  material_effective: string | null;
  tags: string[][];
  world_pose: number[];
  [extra: string]: unknown; // members, solid, family… from M2
};

export function cliPath(): string {
  const p = process.env.HEW_CLI;
  if (!p) throw new Error("Set HEW_CLI to the hew-cli of the build under test");
  return p;
}

export class Hew {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiting = new Map<number, (msg: any) => void>();

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    const lines = createInterface({ input: proc.stdout });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const done = this.waiting.get(msg.id);
      if (done) {
        this.waiting.delete(msg.id);
        done(msg);
      }
    });
  }

  static async start(cli = cliPath()): Promise<Hew> {
    const hew = new Hew(spawn(cli, ["mcp"], { stdio: "pipe" }));
    await hew.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ocl-acceptance", version: "0.1" },
    });
    hew.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return hew;
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (msg) => (msg.error ? reject(new HewError(msg.error.message)) : resolve(msg.result)));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private async tool(name: string, args: unknown): Promise<any> {
    const res = await this.request("tools/call", { name, arguments: args });
    let content = res.structuredContent;
    if (content === undefined || content === null) {
      const text = (res.content ?? []).map((c: any) => c.text ?? "").join("");
      try {
        content = JSON.parse(text);
      } catch {
        throw new HewError(text.trim() || "empty answer from Hew");
      }
    }
    if (content.error) {
      const data = content.error.data ?? {};
      throw new HewError(data.explanation ?? content.error.message ?? "refused", data.refusal ?? null);
    }
    return content.result ?? {};
  }

  /** One read-only command. */
  query(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return this.tool("hew_query", { method, params });
  }

  /** Commands in order, as one undo step; returns each command's result. */
  async transact(commands: { method: string; params?: unknown; as?: string }[]): Promise<any[]> {
    const res = await this.tool("hew_transact", { commands });
    return res.results ?? [];
  }

  async one(method: string, params: Record<string, unknown>): Promise<any> {
    return (await this.transact([{ method, params }]))[0];
  }

  async occurrences(params: Record<string, unknown> = {}): Promise<Row[]> {
    return (await this.query("hew.query.occurrences", params)).occurrences;
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/** A board of `size` metres [x, y, z], corner at `at`, as one transaction. */
export async function board(
  hew: Hew,
  name: string,
  at: [number, number, number],
  size: [number, number, number],
  material?: string,
): Promise<string> {
  const [x, y, z] = at;
  const [dx, dy, dz] = size;
  const cmds: { method: string; params?: unknown; as?: string }[] = [
    {
      method: "hew.sketch.draw_rect",
      as: "r",
      params: { plane: { origin: [0, 0, z], normal: [0, 0, 1] }, corner_a: [x, y, z], corner_b: [x + dx, y + dy, z] },
    },
    { method: "hew.solid.extrude", as: "o", params: { region: { $ref: "r#/region_id" }, distance: dz } },
    { method: "hew.entity.rename", params: { id: { $ref: "o#/object_id" }, name } },
  ];
  if (material) cmds.push({ method: "hew.material.set_default", params: { id: { $ref: "o#/object_id" }, material } });
  const res = await hew.transact(cmds);
  return res[1].object_id;
}

export async function material(hew: Hew, name: string, color: [number, number, number]): Promise<string> {
  return (await hew.one("hew.material.create", { name, color })).material;
}
