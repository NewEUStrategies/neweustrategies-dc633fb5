/**
 * Bramka WAGI DOKUMENTU SSR strony `/` na artefakcie `build:smoke`.
 *
 * Renderuje `/` z artefaktu (`.output/server/index.mjs`) z backendem fixture -
 * dokładnie jak `playwright.performance.config.ts` - i sprawdza progi bajtowe
 * z `scripts/performance/document-weight-budgets.json`: HTML surowy/gzip,
 * inline `<style>` (bajty i liczba bloków), inline `<script>` i dehydratowany
 * stan, `modulepreload`, duplikaty preloadów (head + nagłówek `Link`), obrazy
 * `fetchpriority=high`, surowe i gzip bajty domknięcia bootu (rozszerzenie
 * semantyki `check:bundle`, który `bootRaw` liczy, ale nie bramkuje), pulę JS
 * pobieraną z priorytetem High przy starcie i CSS blokujący renderowanie.
 * Uzasadnienie metryk: nagłówek `documentWeight.ts`.
 *
 * ŚCIEŻKA KRYTYCZNA OBRAZU LCP (P1.4, LP-10 + LA-C3): co najwyżej dwa
 * `img[data-lcp-candidate]` (`lcpCandidateCount`), żadnego obrazu eager poza
 * kandydatem i logo w nagłówku powłoki `<header data-site-header>`
 * (`imgEagerNonCandidate`), preload obrazu
 * `fetchpriority=high` wyłącznie dla kandydata - ten sam `imagesrcset` +
 * `imagesizes` co `<img>` (`imagePreloadNonCandidate`), nagłówek `Link`
 * wyłącznie z dozwolonych wpisów (`linkHeaderDisallowed`) i bajty przed LCP
 * (`preLcpTransferBytes`). Od P2.1 (boot po LCP) zestaw bootu `#nes-boot-set`: domknięcie
 * bootu liczone od jego wejścia, dokument bez żadnej drogi do JS-a (`bootEntryMissing`) i seria
 * bootu (`bootBurst*`), czyli JS pobierany w chwili bootu - w trybie `lcp` poza pulą przed LCP.
 * Kontrole negatywne tych reguł były w
 * `document-weight.test.mjs`, który usunął z repo PR #475 razem z resztą testów
 * uprzęży pomiarowej (`git log --diff-filter=D -- scripts/performance/`).
 * Do tego moduły tylko-serwerowe (`lcpCandidate.ts`, `heroImage.ts`) nie mogą
 * trafić do żadnego chunku klienta - sprawdzane z `reports/chunk-inventory.json`
 * artefaktu, gdy inwentarz istnieje i pasuje do buildu (BUNDLE_INVENTORY=1).
 *
 * Progi są RATCHETEM z pomiaru fixture: wolno je wyłącznie obniżać
 * (`--ratchet` przepisuje plik progów, ale nigdy w górę).
 *
 * Usage:
 *   bun run scripts/performance/check-document-weight.ts [--root .] [--path /] [--samples 5]
 *       [--json reports/document-weight.json] [--ratchet] [--headroom 0.02]
 *   bun run scripts/performance/check-document-weight.ts --html dokument.html [--headers h.txt]
 *       (analiza zapisanego dokumentu, np. produkcyjnego; bez bramki, chyba że --assert)
 *
 * Wymaga zbudowanego artefaktu: BUNDLE_INVENTORY=1 bun run build:smoke.
 * Działa też pod `node` (type stripping).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_ACCEPT_LANGUAGE,
  HARNESS_ROOT,
  fetchDocument,
  freePort,
  startArtifact,
  warmDocument,
} from "./artifactServer.ts";
import {
  GATED_METRICS,
  analyzeDocument,
  checkBudgets,
  inventoryMatchesBuild,
  medianWeights,
  ratchetBudgets,
  serverOnlyModulesInClient,
  type Budget,
  type Budgets,
  type ChunkInventoryLike,
  type DocumentWeight,
  type GatedMetric,
  type ServerOnlyLeak,
} from "./documentWeight.ts";

const BUDGETS_FILE = join(HARNESS_ROOT, "scripts/performance/document-weight-budgets.json");

interface BudgetsFile {
  readonly _comment?: readonly string[];
  readonly path?: string;
  readonly measuredAt?: string;
  readonly commit?: string;
  readonly budgets: Budgets;
}

const { values: opts } = parseArgs({
  options: {
    root: { type: "string" },
    path: { type: "string", default: "/" },
    samples: { type: "string", default: "5" },
    json: { type: "string" },
    budgets: { type: "string" },
    ratchet: { type: "boolean", default: false },
    headroom: { type: "string", default: "0.02" },
    html: { type: "string" },
    headers: { type: "string" },
    assert: { type: "boolean", default: false },
  },
});

function fmt(metric: GatedMetric, value: number): string {
  if (metric.endsWith("Bytes")) return `${(value / 1024).toFixed(1)} KB`;
  return String(value);
}

function loadBudgets(file: string): BudgetsFile | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as BudgetsFile;
}

/** Nagłówek `link` z pliku nagłówków (format `curl -D` albo `nazwa: wartość`). */
function linkFromHeaderFile(file: string): string | null {
  const values = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^link:/i.test(l))
    .map((l) => l.replace(/^link:\s*/i, ""));
  return values.length ? values.join(", ") : null;
}

async function sampleArtifact(
  root: string,
  path: string,
  samples: number,
): Promise<{ weights: DocumentWeight[]; cache: string; status: number }> {
  const port = await freePort();
  const artifact = await startArtifact({
    root,
    port,
    fixture: true,
    measurementCase: "document-weight",
  });
  try {
    const warm = await warmDocument(artifact.origin, path, DEFAULT_ACCEPT_LANGUAGE);
    if (warm.status !== 200) {
      throw new Error(
        `GET ${path} -> HTTP ${warm.status} (location: ${warm.headers.get("location") ?? "-"}). ` +
          "Bramka mierzy dokument PL bez przekierowania - sprawdź Accept-Language i fixture.",
      );
    }
    const weights: DocumentWeight[] = [];
    for (let i = 0; i < samples; i++) {
      const doc = i === 0 ? warm : await fetchDocument(artifact.origin, path);
      weights.push(
        analyzeDocument({
          html: doc.body.toString("utf8"),
          linkHeader: doc.headers.get("link"),
          assetsDir: join(root, ".output/public/assets"),
          serverDir: join(root, ".output/server"),
        }),
      );
    }
    return { weights, cache: warm.headers.get("x-nes-cache") ?? "-", status: warm.status };
  } finally {
    await artifact.stop();
  }
}

function printWeight(w: DocumentWeight): void {
  console.log(
    `  HTML ${w.htmlRawBytes} B raw / ${w.htmlGzipBytes} B gzip; <head> ${w.headRawBytes} B; ` +
      `${w.elementCount} elementów, ${w.imgCount} <img> (${w.imgFetchpriorityHigh} high, ${w.imgLazy} lazy), ` +
      `${w.inlineSvgCount} <svg>`,
  );
  console.log(
    `  inline <style>: ${w.inlineStyleCount} bloków / ${w.inlineStyleBytes} B (największy ${w.inlineStyleLargestBytes} B)`,
  );
  console.log(
    `  inline <script>: ${w.inlineScriptCount} / ${w.inlineScriptBytes} B ` +
      `(wykonywalne ${w.inlineExecutableScriptBytes} B, $tsr-stream-barrier ${w.dehydratedStateBytes} B)`,
  );
  console.log(
    `  preloady: modulepreload ${w.modulepreloadCount} unikalnych (head ${w.modulepreloadInHead}, Link ${w.modulepreloadInHeader}), ` +
      `Link: ${w.linkHeaderEntries} wpisów, obrazy ${w.imagePreloadCount}, fonty ${w.fontPreloadCount}, duplikaty ${w.preloadDuplicates} (w dokumencie ${w.documentPreloadDuplicates})`,
  );
  for (const d of w.duplicates)
    console.log(`    duplikat x${d.count} [${d.sources.join(",")}] ${d.key.slice(0, 120)}`);
  if (w.bootClosure) {
    console.log(
      `  boot: ${w.bootClosure.files.length} chunków, ${w.bootClosureRawBytes} B raw / ${w.bootClosureGzipBytes} B gzip ` +
        `(korzenie ${w.bootClosure.roots.join(",")}${w.bootClosure.missing.length ? `; BRAK ${w.bootClosure.missing.join(",")}` : ""})`,
    );
    console.log(
      `  JS z priorytetem High przy starcie: ${w.preloadedJsCount} plików, ${w.preloadedJsRawBytes} B raw / ` +
        `${w.preloadedJsGzipBytes} B gzip; spoza bootu: ${w.preloadOutsideBoot.length} ` +
        `(${w.preloadOutsideBoot.reduce((s, f) => s + f.gzipBytes, 0)} B gzip)`,
    );
    console.log(
      `  CSS blokujący: ${w.renderBlockingCssCount} plik(ów), ${w.renderBlockingCssRawBytes} B raw / ${w.renderBlockingCssGzipBytes} B gzip`,
    );
    console.log(
      w.bootSet
        ? `  zestaw bootu (P2.1): tryb ${w.bootSet.mode}, wejście ${w.bootSet.entry}, ${w.bootSet.urls.length} URL-i; ` +
            `seria bootu ${w.bootBurstCount} plików / ${w.bootBurstGzipBytes} B gzip`
        : `  zestaw bootu (P2.1): brak${w.bootEntryMissing ? " - i brak skryptu wejścia (dokument bez JS-a)" : ""}`,
    );
  }
  console.log(
    `  ścieżka LCP: kandydaci ${w.lcpCandidateCount}${w.lcpCandidateMissing ? " (BRAK znacznika)" : ""}, eager poza kandydatem/logo ${w.imgEagerNonCandidate}, ` +
      `preload obrazu High poza kandydatem ${w.imagePreloadNonCandidate}, Link spoza listy ${w.linkHeaderDisallowed}; ` +
      `przed LCP ${w.preLcpTransferBytes} B (fonty ${w.fontPreloadBytes} B, obraz z artefaktu ${w.lcpImageBytes} B)`,
  );
}

/**
 * Moduły tylko-serwerowe w chunkach klienta (P1.4, m3). `null` = sprawdzenie
 * pominięte (brak inwentarza albo inwentarz z innego buildu) - powód w logu.
 */
function serverOnlyLeaks(root: string): ServerOnlyLeak[] | null {
  const file = join(root, "reports/chunk-inventory.json");
  if (!existsSync(file)) {
    console.log(
      "  moduły tylko-serwerowe: pominięte (brak reports/chunk-inventory.json - build z BUNDLE_INVENTORY=1)",
    );
    return null;
  }
  const inventory = JSON.parse(readFileSync(file, "utf8")) as ChunkInventoryLike;
  if (!inventoryMatchesBuild(inventory, join(root, ".output/public"))) {
    console.log("  moduły tylko-serwerowe: pominięte (inwentarz z innego buildu niż .output)");
    return null;
  }
  const leaks = serverOnlyModulesInClient(inventory);
  console.log(
    leaks.length
      ? `  ✗ moduły tylko-serwerowe w bundlu klienta: ${leaks.map((l) => `${l.module} w ${l.chunk}`).join("; ")}`
      : `  ✓ moduły tylko-serwerowe poza bundlem klienta (${inventory.chunks.length} chunków w inwentarzu)`,
  );
  return leaks;
}

async function main(): Promise<void> {
  const root = resolve(opts.root ?? process.cwd());
  const budgetsPath = resolve(opts.budgets ?? BUDGETS_FILE);
  const budgetsFile = loadBudgets(budgetsPath);
  const samples = Math.max(1, Number.parseInt(opts.samples ?? "5", 10) || 5);

  // Bramka aktywna (artefakt albo --html z --assert) bez pliku progów nie ma
  // z czym porównać pomiaru. Dawniej kończyła się kodem 0 z samą informacją,
  // więc PR, który przemianował albo usunął plik progów, przechodził bez
  // pomiaru. Sprawdzenie stoi PRZED pomiarem: brak progów to błąd konfiguracji,
  // nie artefaktu. Plik progów tworzy wyłącznie --ratchet.
  const gate = !opts.html || opts.assert;
  if (gate && !opts.ratchet && !budgetsFile) {
    console.error(
      `✗ Brak pliku progów ${budgetsPath} - bramka wagi dokumentu nie ma z czym porównać pomiaru.`,
    );
    console.error(
      "  Przywróć scripts/performance/document-weight-budgets.json albo wskaż plik przez --budgets; " +
        "nowy plik progów tworzy wyłącznie --ratchet z artefaktu.",
    );
    process.exitCode = 1;
    return;
  }

  let weights: DocumentWeight[];
  let context: string;
  if (opts.html) {
    const html = readFileSync(resolve(opts.html), "utf8");
    weights = [
      analyzeDocument({
        html,
        linkHeader: opts.headers ? linkFromHeaderFile(resolve(opts.headers)) : null,
        assetsDir: join(root, ".output/public/assets"),
        serverDir: join(root, ".output/server"),
      }),
    ];
    context = `plik ${opts.html}`;
  } else {
    const sampled = await sampleArtifact(root, opts.path ?? "/", samples);
    weights = sampled.weights;
    context = `artefakt ${root}, GET ${opts.path} (fixture, x-nes-cache ${sampled.cache}, ${samples} próbek)`;
  }

  const stats = medianWeights(weights);
  const medians = {} as Record<GatedMetric, number>;
  for (const metric of GATED_METRICS) medians[metric] = stats[metric].median;
  const representative = weights.find((w) => w.htmlRawBytes === medians.htmlRawBytes) ?? weights[0];

  console.log(`Waga dokumentu: ${context}`);
  printWeight(representative);
  const leaks = serverOnlyLeaks(root);

  const results = budgetsFile
    ? checkBudgets({ ...representative, ...medians }, budgetsFile.budgets)
    : [];
  if (results.length) {
    console.log(
      `\n  ${"metryka".padEnd(30)} ${"mediana".padStart(11)} ${"rozrzut".padStart(19)} ${"próg".padStart(11)} ${"cel".padStart(11)}`,
    );
    for (const r of results) {
      const s = stats[r.metric];
      const spread = s.min === s.max ? "-" : `${fmt(r.metric, s.min)}..${fmt(r.metric, s.max)}`;
      console.log(
        `  ${r.ok ? "✓" : "✗"} ${r.metric.padEnd(28)} ${fmt(r.metric, r.value).padStart(11)} ${spread.padStart(19)} ` +
          `${fmt(r.metric, r.max).padStart(11)} ${(r.target === undefined ? "-" : fmt(r.metric, r.target)).padStart(11)}`,
      );
    }
  } else if (!budgetsFile) {
    console.log(`\n  (brak pliku progów ${budgetsPath} - uruchom z --ratchet, żeby go utworzyć)`);
  }

  const jsonPath = resolve(opts.json ?? join(HARNESS_ROOT, "reports/document-weight.json"));
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ context, medians, stats, sample: representative, results, serverOnlyLeaks: leaks }, null, 2)}\n`,
  );
  console.log(`\nraport: ${jsonPath}`);

  if (opts.ratchet) {
    if (opts.html) throw new Error("--ratchet wolno liczyć wyłącznie z artefaktu, nie z pliku");
    const maxima = {} as Record<GatedMetric, number>;
    // Próg z NAJWIĘKSZEJ próbki + zapas: rozrzut strumienia nie może dać flaki.
    for (const metric of GATED_METRICS) maxima[metric] = stats[metric].max;
    const headroom = Number.parseFloat(opts.headroom ?? "0.02");
    const next: Record<GatedMetric, Budget> = ratchetBudgets(
      budgetsFile?.budgets ?? {},
      maxima,
      Number.isFinite(headroom) && headroom >= 0 ? headroom : 0.02,
    );
    const file: BudgetsFile = {
      ...(budgetsFile ?? {}),
      path: opts.path,
      measuredAt: new Date().toISOString().slice(0, 10),
      budgets: next,
    };
    writeFileSync(budgetsPath, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`progi zaciśnięte (tylko w dół): ${budgetsPath}`);
    return;
  }

  const failed = results.filter((r) => !r.ok);
  if (gate && leaks?.length) {
    console.error(
      "\n✗ Moduły tylko-serwerowe w bundlu klienta - wywołanie poza gałęzią `isServerRender()` " +
        "albo flaga `isServer`, której bundler nie zwija (src/lib/builder/aboveFold.tsx).",
    );
    process.exitCode = 1;
  }
  if (gate && failed.length) {
    console.error(
      `\n✗ Waga dokumentu ponad progiem: ${failed.map((r) => `${r.metric} ${fmt(r.metric, r.value)} > ${fmt(r.metric, r.max)}`).join("; ")}`,
    );
    console.error(
      "  Progi wolno wyłącznie obniżać. Regresję naprawia się w kodzie; uzasadnienie progów: _comment w pliku progów.",
    );
    process.exitCode = 1;
  } else if (gate && results.length && !leaks?.length) {
    console.log("\n✓ Waga dokumentu w progach");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
