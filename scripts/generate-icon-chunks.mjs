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
const chunks = Array.from({ length: 4 }, () => ({}));
for (const [name, node] of Object.entries(nodes)) {
  // React keys are local to each immutable SVG node list. Index keys preserve
  // identity while avoiding thousands of high-entropy library-generated IDs.
  chunks[iconChunkIndex(name)][name] = node.map(([tag, attrs], index) => [
    tag,
    { ...attrs, key: String(index) },
  ]);
}
for (const [name, canonical] of Object.entries(aliases)) {
  if (nodes[canonical]) chunks[iconChunkIndex(name)][name] = canonical;
}
mkdirSync(new URL("chunks/", root), { recursive: true });
chunks.forEach((chunk, index) =>
  writeFileSync(new URL(`chunks/icons-${index}.json`, root), `${JSON.stringify(chunk)}\n`),
);

writeFileSync(
  new URL("iconNames.generated.json", root),
  `${JSON.stringify(Object.keys(nodes).sort())}\n`,
);
