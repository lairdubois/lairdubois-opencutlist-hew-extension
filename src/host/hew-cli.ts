// Host backed by `hew-cli mcp`: one headless Hew process with one private
// document, JSON-RPC over stdio. For development and tests; the plugin itself
// uses the SDK host from M3 on.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HostError, type Command, type Host } from "./host.ts";

export function hewCliPath(): string {
  const p = process.env.HEW_CLI;
  if (!p) throw new Error("Set HEW_CLI to the path of hew-cli");
  return p;
}

export class HewCliHost implements Host {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiting = new Map<number, (msg: any) => void>();

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    // if hew-cli can't start or quits, fail what's pending instead of waiting forever
    const fail = (why: string) => {
      for (const done of this.waiting.values()) done({ error: { message: why } });
      this.waiting.clear();
    };
    proc.on("error", (e) => fail(`hew-cli: ${e.message}`));
    proc.on("exit", (code, signal) => fail(`hew-cli exited (${signal ?? `code ${code}`})`));
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const done = this.waiting.get(msg.id);
      if (done) {
        this.waiting.delete(msg.id);
        done(msg);
      }
    });
  }

  static async start(cli = hewCliPath()): Promise<HewCliHost> {
    const host = new HewCliHost(spawn(cli, ["mcp"], { stdio: "pipe" }));
    await host.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencutlist-hew", version: "0.0.0" },
    });
    host.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return host;
  }

  query<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.tool("hew_query", { method, params });
  }

  async transact(commands: Command[], options: { label?: string; dry_run?: boolean } = {}): Promise<any[]> {
    const res = await this.tool("hew_transact", { commands, ...options });
    return res.results ?? [];
  }

  /** Opens a model file in the private document (read-only for the file on disk). */
  async open(path: string): Promise<void> {
    await this.transact([{ method: "hew.doc.open", params: { path } }]);
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
        reject(new HostError("hew-cli is not running"));
        return;
      }
      this.waiting.set(id, (msg) => (msg.error ? reject(new HostError(msg.error.message)) : resolve(msg.result)));
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
        throw new HostError(text.trim() || "empty answer from Hew");
      }
    }
    if (content.error) {
      const data = content.error.data ?? {};
      throw new HostError(data.explanation ?? content.error.message ?? "refused", data.refusal ?? null);
    }
    return content.result ?? {};
  }
}
