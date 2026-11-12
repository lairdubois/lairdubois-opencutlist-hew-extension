// Recording and replaying Hew's answers, so the counting logic can be tested
// without Hew: record the queries once against a real build (tools/record-fixtures.ts),
// then replay them in unit tests. Only queries are recorded: the code under
// test reads the model, it never writes.

import { HostError, type Command, type Host } from "./host.ts";

export type Exchange = { method: string; params: Record<string, unknown>; result?: unknown; refusal?: string };
export type Recording = { hew: string; note?: string; exchanges: Exchange[] };

/** Stable key: the method and its params with object keys sorted. */
export function exchangeKey(method: string, params: Record<string, unknown> = {}): string {
  return method + " " + JSON.stringify(params, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}

/** Wraps a host and records every query it answers (refusals included). */
export class RecordingHost implements Host {
  readonly exchanges: Exchange[] = [];
  private inner: Host;
  constructor(inner: Host) {
    this.inner = inner;
  }

  async query<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      const result = await this.inner.query<T>(method, params);
      this.exchanges.push({ method, params, result });
      return result;
    } catch (e) {
      if (e instanceof HostError && e.refusal) this.exchanges.push({ method, params, refusal: e.refusal });
      throw e;
    }
  }

  transact(commands: Command[], options?: { label?: string; dry_run?: boolean }): Promise<any[]> {
    return this.inner.transact(commands, options);
  }
}

/** Answers queries from a recording; any query it hasn't seen is an error. */
export class ReplayHost implements Host {
  private answers = new Map<string, Exchange>();
  constructor(recording: Recording) {
    for (const x of recording.exchanges) this.answers.set(exchangeKey(x.method, x.params), x);
  }

  async query<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const x = this.answers.get(exchangeKey(method, params));
    if (!x) throw new Error(`not in the recording: ${exchangeKey(method, params)}`);
    if (x.refusal) throw new HostError(`recorded refusal ${x.refusal}`, x.refusal);
    return structuredClone(x.result) as T;
  }

  async transact(_commands: Command[], _options?: { label?: string; dry_run?: boolean }): Promise<any[]> {
    throw new Error("ReplayHost is read-only");
  }
}
