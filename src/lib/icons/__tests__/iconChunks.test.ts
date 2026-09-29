import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LUCIDE_ICON_NODES, LUCIDE_ICON_ALIASES } from "../lucideIconNodes.generated";
import { iconChunkIndex } from "../iconChunkIndex.js";
import iconNames from "../iconNames.generated.json";

it("preserves every SVG and alias while removing repeated data and random React keys", () => {
  const chunks: Record<string, unknown>[] = Array.from({ length: 4 }, (_, index) =>
    JSON.parse(readFileSync(`src/lib/icons/chunks/icons-${index}.json`, "utf8")),
  );
  const normalized = (nodes: (typeof LUCIDE_ICON_NODES)[string]) =>
    nodes.map(([tag, attrs], index) => [tag, { ...attrs, key: String(index) }]);
  for (const [name, nodes] of Object.entries(LUCIDE_ICON_NODES)) {
    expect(chunks[iconChunkIndex(name)][name], name).toEqual(normalized(nodes));
  }
  for (const [name, canonical] of Object.entries(LUCIDE_ICON_ALIASES)) {
    expect(chunks[iconChunkIndex(name)][name], name).toBe(canonical);
    expect(chunks[iconChunkIndex(canonical)][canonical]).toEqual(
      normalized(LUCIDE_ICON_NODES[canonical]),
    );
  }
  expect(iconNames).toEqual(Object.keys(LUCIDE_ICON_NODES).sort());
  for (const chunk of chunks) expect(Object.keys(chunk).length).toBeLessThan(800);
});
