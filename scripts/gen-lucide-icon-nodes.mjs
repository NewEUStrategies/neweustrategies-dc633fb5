// Regeneruje src/lib/icons/lucideIconNodes.generated.ts z zainstalowanej
// wersji lucide-react. Uruchom po każdym podbiciu lucide-react:
//   bun run scripts/gen-lucide-icon-nodes.mjs
//
// Dlaczego własny plik danych zamiast importów z pakietu: KAŻDA forma
// referencji do rejestru ikon (namespace-import barrela, deep-import
// icons/index.js, mapa dynamicIconImports) kończy się umieszczeniem przez
// Rollupa wszystkich ~1690 modułów ikon w bundlu WEJŚCIOWYM (zmierzone -
// ~640 KB raw na każdej stronie). Czysty plik danych węzłów SVG nie ma tej
// właściwości: ląduje w leniwym chunku i schodzi tylko na żądanie.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ICONS_DIR = "node_modules/lucide-react/dist/esm/icons";
const OUT = "src/lib/icons/lucideIconNodes.generated.ts";

const version = JSON.parse(readFileSync("node_modules/lucide-react/package.json", "utf8")).version;

const out = {};
const aliases = {};
let failed = 0;
for (const fn of readdirSync(ICONS_DIR).sort()) {
  if (!fn.endsWith(".js") || fn === "index.js") continue;
  const name = fn.slice(0, -3);
  const src = readFileSync(join(ICONS_DIR, fn), "utf8");
  const m = /const __iconNode\S* = (\[[\s\S]*?\]);\n/.exec(src);
  if (!m) {
    // Pliki-aliasy re-eksportują kanoniczną ikonę: zapisz mapowanie nazw.
    const alias = /export \{ default(?: as \w+)? \} from '\.\/([a-z0-9-]+)\.js'/.exec(src);
    if (alias) aliases[name] = alias[1];
    else failed++;
    continue;
  }
  // Węzły to czysty JSON po zacytowaniu kluczy atrybutów.
  const arr = m[1].replace(/([,{[]\s*)([a-zA-Z][a-zA-Z0-9-]*)\s*:/g, '$1"$2":');
  try {
    out[name] = JSON.parse(arr);
  } catch {
    failed++;
  }
}

const names = Object.keys(out);
if (names.length < 1000) {
  console.error(`✗ Podejrzanie mało ikon (${names.length}) - zmienił się format dist lucide?`);
  process.exit(1);
}

const header = `// WYGENEROWANE przez scripts/gen-lucide-icon-nodes.mjs z lucide-react v${version}.
// Nie edytować ręcznie; po podbiciu lucide-react uruchom generator ponownie.
// Dane węzłów SVG wszystkich ikon - celowo BEZ importów z rejestru pakietu
// (patrz komentarz w generatorze i w lib/icons/DynamicIconFull).
/* eslint-disable */
import type { IconNode } from "lucide-react";

export const LUCIDE_ICON_NODES: Record<string, IconNode> = `;

writeFileSync(
  OUT,
  header +
    JSON.stringify(out) +
    " as unknown as Record<string, IconNode>;\n\n" +
    "/** Nazwy-aliasy (stare/alternatywne) -> kanoniczna nazwa ikony. */\n" +
    "export const LUCIDE_ICON_ALIASES: Record<string, string> = " +
    JSON.stringify(aliases) +
    ";\n",
);
console.log(
  `✓ ${OUT}: ${names.length} ikon + ${Object.keys(aliases).length} aliasów (pominięto ${failed}), lucide-react v${version}`,
);
