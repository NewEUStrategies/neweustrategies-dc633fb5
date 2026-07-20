/**
 * Gate poprawności grafu chunków klienta: wykrywa CYKLE importów między
 * chunkami zbudowanego bundla przeglądarki.
 *
 * INCYDENT 2026-07-20: manualChunks (vendor-radix) stworzył cykl
 * entry <-> vendor-radix; przy inicjalizacji CJS-interop shim
 * use-sync-external-store dostawał `undefined`, boot klienta padał przed
 * hydrateRoot i KAŻDA strona po SSR była martwa (pełne SSR-owe wizualia,
 * zero interaktywności, zero błędów widocznych dla użytkownika). Dev tego
 * nie łapie (brak chunków), testy jednostkowe też nie. Ten skrypt robi z
 * tamtej klasy awarii deterministyczny, blokujący check CI: analizuje
 * statyczne importy każdego chunka i failuje na jakimkolwiek cyklu.
 *
 * Cykle chunków są w ESM formalnie legalne (live bindings), ale w praktyce
 * przy CJS-interop (esbuild/rollup __commonJS wrappery) i side-effectach
 * modułów kolejność inicjalizacji robi się loteryjna - a stawką jest boot
 * całej aplikacji. Zero cykli to jedyna bezpieczna polityka.
 *
 * Usage: bun run scripts/check-chunk-graph.ts   (po `bun run build`)
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const CLIENT_DIR =
  process.env.CLIENT_DIR ??
  [".output/public/assets", "dist/client/assets"].find((d) => {
    try {
      return readdirSync(d).some((f) => f.endsWith(".js"));
    } catch {
      return false;
    }
  }) ??
  ".output/public/assets";

const files = readdirSync(CLIENT_DIR).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error(`✗ Brak chunków JS w ${CLIENT_DIR}. Najpierw \`bun run build\`.`);
  process.exit(1);
}

// Statyczne importy chunk->chunk. Rollup emituje je w nagłówku pliku w formie
// `import{...}from"./nazwa-HASH.js"` / `import"./nazwa-HASH.js"`; wystarczy
// zeskanować całość regexem po literałach względnych ścieżek .js (dynamiczne
// importy mają tę samą składnię literału, ale nie tworzą krawędzi
// inicjalizacyjnej - filtrujemy je po poprzedzającym `import(`).
const IMPORT_RE = /(import\s*\(?\s*|from\s*)["'](\.\/[^"']+\.js)["']/g;

const edges = new Map<string, Set<string>>();
for (const f of files) {
  const src = readFileSync(join(CLIENT_DIR, f), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(IMPORT_RE)) {
    const isDynamic = m[1].trimEnd().endsWith("(");
    if (isDynamic) continue; // import() nie wykonuje się przy inicjalizacji
    out.add(basename(m[2]));
  }
  out.delete(f);
  edges.set(f, out);
}

// Tarjan SCC - każdy silnie spójny komponent >1 węzła (albo self-loop) = cykl.
let index = 0;
const idx = new Map<string, number>();
const low = new Map<string, number>();
const onStack = new Set<string>();
const stack: string[] = [];
const cycles: string[][] = [];

function strongconnect(v: string) {
  idx.set(v, index);
  low.set(v, index);
  index++;
  stack.push(v);
  onStack.add(v);
  for (const w of edges.get(v) ?? []) {
    if (!edges.has(w)) continue; // import spoza katalogu (np. zewnętrzny URL)
    if (!idx.has(w)) {
      strongconnect(w);
      low.set(v, Math.min(low.get(v)!, low.get(w)!));
    } else if (onStack.has(w)) {
      low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
  }
  if (low.get(v) === idx.get(v)) {
    const comp: string[] = [];
    for (;;) {
      const w = stack.pop()!;
      onStack.delete(w);
      comp.push(w);
      if (w === v) break;
    }
    if (comp.length > 1) cycles.push(comp);
  }
}

for (const f of files) if (!idx.has(f)) strongconnect(f);

const edgeCount = [...edges.values()].reduce((a, s) => a + s.size, 0);
console.log(`Chunk graph: ${files.length} chunków, ${edgeCount} statycznych krawędzi importu`);

if (cycles.length > 0) {
  console.error(`✗ Wykryto ${cycles.length} cykl(e) importów między chunkami:`);
  for (const c of cycles) {
    console.error(`   [${c.length}] ${c.join(" <-> ")}`);
  }
  console.error(
    "  Cykl chunków = loteryjna kolejność inicjalizacji (patrz nagłówek skryptu). " +
      "Najczęstsza przyczyna: manualChunks rozdzielił pakiet od jego zależności.",
  );
  process.exit(1);
}
console.log("✓ Graf chunków acykliczny.");
