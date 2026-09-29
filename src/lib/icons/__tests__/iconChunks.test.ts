import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LUCIDE_ICON_NODES, LUCIDE_ICON_ALIASES } from "../lucideIconNodes.generated";
import { iconChunkIndex } from "../iconChunkIndex.js";

it("preserves every icon and historical alias while splitting the download", () => {
  const chunks: Record<string, unknown>[] = Array.from({ length: 16 }, (_, index) =>
    JSON.parse(readFileSync(`src/lib/icons/chunks/icons-${index}.json`, "utf8")),
  );
  for (const [name, nodes] of Object.entries(LUCIDE_ICON_NODES)) {
    expect(chunks[iconChunkIndex(name)][name], name).toEqual(nodes);
  }
  for (const [name, canonical] of Object.entries(LUCIDE_ICON_ALIASES)) {
    expect(chunks[iconChunkIndex(name)][name], name).toEqual(LUCIDE_ICON_NODES[canonical]);
  }
  for (const chunk of chunks) expect(Object.keys(chunk).length).toBeLessThan(200);
});
