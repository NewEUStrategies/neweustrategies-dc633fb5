// Split the existing SVG data registry; never import the lucide barrel.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { iconChunkIndex } from "../src/lib/icons/iconChunkIndex.js";

const root = new URL("../src/lib/icons/", import.meta.url);
const source = readFileSync(new URL("lucideIconNodes.generated.ts", root), "utf8");
const data = (name) => {
  const line = source.split("\n").find((value) => value.startsWith(`export const ${name}:`));
  if (!line) throw new Error(`Missing icon registry ${name}`);
  return JSON.parse(line.slice(line.indexOf(" = ") + 3, line.lastIndexOf("}") + 1));
};
const nodes = data("LUCIDE_ICON_NODES");
const aliases = data("LUCIDE_ICON_ALIASES");
const chunks = Array.from({ length: 16 }, () => ({}));
for (const [name, node] of Object.entries(nodes)) chunks[iconChunkIndex(name)][name] = node;
for (const [name, canonical] of Object.entries(aliases)) {
  if (nodes[canonical]) chunks[iconChunkIndex(name)][name] = nodes[canonical];
}
mkdirSync(new URL("chunks/", root), { recursive: true });
chunks.forEach((chunk, index) =>
  writeFileSync(new URL(`chunks/icons-${index}.json`, root), `${JSON.stringify(chunk)}\n`),
);
