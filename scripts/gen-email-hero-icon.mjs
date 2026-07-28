// Generuje prerenderowane ikony Lucide do PNG dla maili systemowych NES.
// Ikony są zapisywane w /tmp/{name}.png - następnie należy je wgrać do storage.
import { readFileSync, writeFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const ICONS_FILE = "src/lib/icons/lucideIconNodes.generated.ts";
const OUT_DIR = "/tmp/email-icons";

// Rozmiar docelowy ikony hero w mailu (3x dla retina, skalowane w CSS do ~30px)
const SIZE = 102;
const STROKE = 2;
const STROKE_LINE_CAP = "round";
const STROKE_LINE_JOIN = "round";
const COLOR = "#FA9346"; // brand orange

function parseNodes() {
  const txt = readFileSync(ICONS_FILE, "utf8");
  const m = /LUCIDE_ICON_NODES: Record<string, IconNode> = (\{[\s\S]*?\}) as unknown as Record<string, IconNode>;/ .exec(txt);
  if (!m) throw new Error("Nie znaleziono LUCIDE_ICON_NODES");
  // Zamień klucze obiektów na stringi, aby był poprawny JSON
  const json = m[1].replace(/([,{\[]\s*)([a-zA-Z][a-zA-Z0-9-]*)\s*:/g, '$1"$2":');
  return JSON.parse(json);
}

function nodeToSvg(node) {
  const elements = node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      if (tag === "path") return `<path ${attrStr} />`;
      if (tag === "circle") return `<circle ${attrStr} />`;
      if (tag === "rect") return `<rect ${attrStr} />`;
      if (tag === "polyline") return `<polyline ${attrStr} />`;
      if (tag === "line") return `<line ${attrStr} />`;
      if (tag === "ellipse") return `<ellipse ${attrStr} />`;
      return "";
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${COLOR}" stroke-width="${STROKE}" stroke-linecap="${STROKE_LINE_CAP}" stroke-linejoin="${STROKE_LINE_JOIN}">${elements}</svg>`;
}

async function main() {
  const wasm = readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm");
  await initWasm(wasm);

  const nodes = parseNodes();
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error("Użycie: bun scripts/gen-email-hero-icon.mjs <nazwa-ikony> [<nazwa-ikony> ...]");
    process.exit(1);
  }

  for (const name of names) {
    const node = nodes[name];
    if (!node) {
      console.error(`✗ Ikona "${name}" nie istnieje w LUCIDE_ICON_NODES`);
      continue;
    }
    const svg = nodeToSvg(node);
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: SIZE },
      background: "transparent",
    });
    const png = resvg.render().asPng();
    const outPath = `${OUT_DIR}/${name}.png`;
    writeFileSync(outPath, png);
    console.log(`✓ ${outPath} (${png.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
