// The plugin talks to Hew through this interface only. Today it is backed by
// `hew-cli mcp` (development, tests); from M3 by the plugin SDK inside Hew.
// Nothing else in the plugin may depend on how the bus is reached.

/** One command of a transaction, as on Hew's bus (`as` names its result for `$ref`). */
export type Command = { method: string; params?: unknown; as?: string };

export interface Host {
  /** One read-only command (`hew.query.*`, `hew.attr.get`, …). */
  query<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Commands in order, as one undo step; answers each command's result. */
  transact(commands: Command[], options?: { label?: string; dry_run?: boolean }): Promise<any[]>;
}

/** A refusal from Hew: `refusal` is its name (`unknown_entity`, `locator_missed`, …). */
export class HostError extends Error {
  readonly refusal: string | null;
  constructor(message: string, refusal: string | null = null) {
    super(message);
    this.name = "HostError";
    this.refusal = refusal;
  }
}
