// The plugin's background entry (`main` in hew-plugin.json).
//
// The SDK that loads it arrives with Hew's M3, and its JavaScript API isn't
// published yet. So this file only declares the plugin's bus commands as plain
// handlers over a Host. Once the SDK is out, the wiring is a few lines: build a
// Host from the SDK's bus handle and register each handler under its command id.

import type { Host } from "./host/host.ts";
import { countParts, type CountOptions, type CutList } from "./cutlist/count.ts";

export type Handler<P, R> = (host: Host, params: P) => Promise<R>;

/** Contributed commands, keyed by the ids in hew-plugin.json (`org.opencutlist.<id>` on the bus). */
export const commands = {
  count_parts: (async (host, params) => countParts(host, params)) as Handler<CountOptions, CutList>,
};
