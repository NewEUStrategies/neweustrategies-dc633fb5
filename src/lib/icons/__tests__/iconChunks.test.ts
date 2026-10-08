import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createLucideIcon, type IconNode } from "lucide-react";
import { expect, it } from "vitest";
import { LUCIDE_ICON_NODES, LUCIDE_ICON_ALIASES } from "../lucideIconNodes.generated";
import { iconChunkIndex } from "../iconChunkIndex.js";
import { unpackIconNode } from "../iconNodePacking";
import iconNames from "../iconNames.generated.json";

const chunks: Record<string, unknown>[] = Array.from({ length: 4 }, (_, index) =>
  JSON.parse(readFileSync(`src/lib/icons/chunks/icons-${index}.json`, "utf8")),
);
const normalized = (nodes: (typeof LUCIDE_ICON_NODES)[string]) =>
  nodes.map(([tag, attrs], index) => [tag, { ...attrs, key: String(index) }]);

it("preserves every SVG and alias while removing repeated data and random React keys", () => {
  for (const [name, nodes] of Object.entries(LUCIDE_ICON_NODES)) {
    // JSON equality also pins the attribute order (`key` last) React receives.
    expect(JSON.stringify(unpackIconNode(chunks[iconChunkIndex(name)][name])), name).toBe(
      JSON.stringify(normalized(nodes)),
    );
  }
  for (const [name, canonical] of Object.entries(LUCIDE_ICON_ALIASES)) {
    expect(chunks[iconChunkIndex(name)][name], name).toBe(canonical);
    expect(unpackIconNode(chunks[iconChunkIndex(canonical)][canonical])).toEqual(
      normalized(LUCIDE_ICON_NODES[canonical]),
    );
  }
  expect(iconNames).toEqual(Object.keys(LUCIDE_ICON_NODES).sort());
  for (const chunk of chunks) expect(Object.keys(chunk).length).toBeLessThan(800);
});

it("stores no React keys and keeps `d`-only paths as bare strings", () => {
  for (const chunk of chunks) {
    for (const entry of Object.values(chunk)) {
      if (typeof entry === "string") continue;
      for (const part of entry as unknown[]) {
        if (typeof part === "string") continue;
        const [tag, attrs] = part as [string, Record<string, string>];
        expect(attrs).not.toHaveProperty("key");
        expect(tag === "path" && Object.keys(attrs).join() === "d").toBe(false);
      }
    }
  }
});

it("renders the same SVG markup from a chunk as from the library node", () => {
  for (const [name, nodes] of Object.entries(LUCIDE_ICON_NODES)) {
    const unpacked = unpackIconNode(chunks[iconChunkIndex(name)][name]) as IconNode;
    expect(renderToStaticMarkup(createElement(createLucideIcon(name, unpacked))), name).toBe(
      renderToStaticMarkup(createElement(createLucideIcon(name, normalized(nodes) as IconNode))),
    );
  }
});

it("rejects entries of an unknown shape", () => {
  expect(unpackIconNode(null)).toBeNull();
  expect(unpackIconNode("alias")).toBeNull();
  expect(unpackIconNode([["script", { src: "x" }]])).toBeNull();
  expect(unpackIconNode([["path", null]])).toBeNull();
  expect(unpackIconNode([42])).toBeNull();
});
