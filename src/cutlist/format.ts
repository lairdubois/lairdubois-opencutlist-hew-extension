// A cut list as a Markdown table, for tools and tests. The plugin's own UI comes with M3.

import type { CutList } from "./count.ts";

export function formatMarkdown(title: string, res: CutList): string {
  const out = [`# ${title}`, "", "| | Part | Qty | L | W | T | Material | Notes |", "|---|---|---:|---:|---:|---:|---|---|"];
  for (const p of res.parts) {
    const notes = [
      p.kind === "loose" ? "loose solid (no definition)" : "",
      p.mirrored ? "mirrored" : "",
      p.solids > 1 ? `${p.solids} solids (glued-up)` : "",
      p.nested ? `holds ${p.nested} nested` : "",
    ].filter(Boolean).join(", ");
    out.push(`| ${p.label} | ${p.name} | ${p.count} | ${p.size[0]} | ${p.size[1]} | ${p.size[2]} | ${p.material ?? "—"} | ${notes} |`);
    for (const pc of p.pieces ?? []) out.push(`| | ↳ ${pc.name ?? "piece"} | | ${pc.size[0]} | ${pc.size[1]} | ${pc.size[2]} | | piece of ${p.label} |`);
  }
  if (res.hardware.length) out.push("", "Hardware: " + res.hardware.map((h) => `${h.name} ×${h.count}`).join(", "));
  if (res.assemblies.length) out.push("", "Assemblies (no solids of their own): " + res.assemblies.map((a) => `${a.name} ×${a.count}`).join(", "));
  if (res.open.length) out.push("", "Not closed solids, not measured: " + res.open.map((o) => `${o.name ?? o.id} (${o.kind}) ×${o.count}`).join(", "));
  if (res.machining) out.push("", `Machining bodies left out: ${res.machining}`);
  if (res.lookAlike.length) out.push("", "Look alike but not linked (Hew's \"link them?\" suggestion): " + res.lookAlike.map((g) => g.join(" = ")).join(", "));
  return out.join("\n");
}
