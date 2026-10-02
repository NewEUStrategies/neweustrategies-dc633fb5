// @vitest-environment node
//
// Wtyczka `nes:widget-chunks` na PRAWDZIWYM buildzie Vite - dowód, którego
// `widgetChunkPlugin.test.ts` z konstrukcji dać nie może.
//
// CO DOWODZI TAMTEN PLIK, A CZEGO NIE. Woła hooki wtyczki RĘCZNIE: sam podaje
// `generateBundle` sfabrykowany bundel (`assets/ticker-AAA.js`), sam woła
// `transform` na tej samej instancji i sam wybiera kolejność. Pilnuje więc
// mapy typ -> moduł, podmiany łańcucha i `enforce: "pre"` - ale NIE tego, na
// czym cała wtyczka stoi:
//
//   - że Vite przekazuje SERWEROWI tę samą instancję wtyczki, którą widział
//     klient (inaczej `discovered` w buildzie serwera jest puste);
//   - że klient buduje się PRZED serwerem (inaczej `transform` serwera
//     przychodzi, zanim cokolwiek odkryto);
//   - że nazwy w bundlu SERWERA to dokładnie pliki wyemitowane przez KLIENTA,
//     z prawdziwymi hashami Rollupa, a nie łańcuchy z fikstury;
//   - że placeholder `{}` nie może po cichu pojechać na produkcję.
//
// Ten plik buduje maleńką aplikację `createBuilder`-em Vite z tymi samymi
// ustawieniami, z których korzysta produkcja: `builder.sharedPlugins: true`
// (TanStack Start, `start-plugin-core/src/vite/plugin.ts`) i kolejność
// klient -> serwer (`buildStartViteEnvironments`). Plik `widgetPreloads.ts`
// fikstury to DOSŁOWNA kopia źródła z repozytorium (wtyczka ma zobaczyć
// prawdziwą deklarację z adnotacją typu), a bundel serwera jest na końcu
// IMPORTOWANY i wykonywany - asercje dotyczą wartości w działającym module,
// nie wyglądu tekstu. Całość to kilka buildów po kilkadziesiąt modułów;
// mieści się w sekundach, bez sieci i bez katalogu `.output` repozytorium.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { createBuilder, createLogger, type Logger, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { widgetChunkPlugin } from "../../../../scripts/lib/widgetChunkPlugin";

const WIDGET_DIR = "src/components/builder/organisms/widget-view";

/** Moduł z treścią `default` - wystarczy, żeby Rollup dał mu własny chunk. */
const stub = (name: string) => `export default function ${name}() {\n  return "${name}";\n}\n`;

/**
 * Fikstura aplikacji. Ścieżki widgetów są TE SAME co w `TARGETS` wtyczki, bo
 * wtyczka dopasowuje moduły po sufiksie ścieżki - inna nazwa nie dowodziłaby
 * niczego o prawdziwym rejestrze.
 */
const FILES: Record<string, string> = {
  [`${WIDGET_DIR}/NewsTickerView.tsx`]: stub("NewsTickerView"),
  [`${WIDGET_DIR}/EventsListView.tsx`]: stub("EventsListView"),
  // Importowany STATYCZNIE z wejścia klienta - ląduje w chunku wejściowym,
  // więc hint do niego byłby hintem do już pobranego kodu.
  [`${WIDGET_DIR}/CounterWidget.tsx`]: stub("CounterWidget"),
  // Slider z wpisów ciągnie warianty statycznie; slider z samych obrazów
  // (`image-slider`) ma dostać WYŁĄCZNIE chunk wariantów.
  [`${WIDGET_DIR}/PostsSliderWidget.tsx`]:
    'import variants from "../../../../lib/builder/sliderVariants.tsx";\n' +
    'export default function PostsSliderWidget() {\n  return ["posts", variants()];\n}\n',
  "src/lib/builder/sliderVariants.tsx": stub("sliderVariants"),
  // Zastępstwo `@/lib/builder/sliderPostsQuery` - oryginał ciągnie Supabase
  // i react-query, a `widgetPreloadHeaders` potrzebuje z niego jednej funkcji.
  // Semantyka ta sama co w oryginale dla przypadków użytych niżej.
  "src/stubs/sliderPostsQuery.ts":
    "export function sliderUsesPostsSource(c) {\n" +
    '  if (c.source === "posts") return true;\n' +
    "  const items = Array.isArray(c.items) ? c.items : [];\n" +
    "  return !items.some((it) => it && (it.image || it.postId));\n" +
    "}\n",
  // DOSŁOWNA kopia - wtyczka ma dostać prawdziwą deklarację placeholdera.
  "src/lib/seo/widgetPreloads.ts": readFileSync("src/lib/seo/widgetPreloads.ts", "utf8"),
  "src/client.ts":
    `import Counter from "./components/builder/organisms/widget-view/CounterWidget.tsx";\n` +
    'import { WIDGET_CHUNK_URLS } from "./lib/seo/widgetPreloads";\n' +
    // Efekt uboczny, nie eksport: build aplikacji nie zachowuje sygnatury
    // wejścia (`preserveEntrySignatures: false`), więc nieużyty eksport
    // zostałby wycięty razem z każdym `import()`.
    "globalThis.__nesFixture = [Counter, WIDGET_CHUNK_URLS,\n" +
    '  () => import("./components/builder/organisms/widget-view/NewsTickerView.tsx"),\n' +
    '  () => import("./components/builder/organisms/widget-view/EventsListView.tsx"),\n' +
    '  () => import("./components/builder/organisms/widget-view/PostsSliderWidget.tsx"),\n' +
    '  () => import("./lib/builder/sliderVariants.tsx"),\n' +
    "];\n",
  "src/server.ts":
    'export { WIDGET_CHUNK_URLS, widgetPreloadHeaders } from "./lib/seo/widgetPreloads";\n',
};

type ServerModule = {
  WIDGET_CHUNK_URLS: Record<string, string[]>;
  widgetPreloadHeaders: (doc: unknown, sectionCount: number) => string[];
};

type BuildResult = {
  clientChunks: Rollup.OutputChunk[];
  server: ServerModule;
  serverCode: string;
  warnings: string[];
};

let workspace = "";
let runs = 0;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "nes-widget-chunks-"));
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/** Logger, który zbiera ostrzeżenia zamiast je drukować. */
function capturingLogger(warnings: string[]): Logger {
  const base = createLogger("silent");
  return {
    ...base,
    warn: (msg) => void warnings.push(msg),
    warnOnce: (msg) => void warnings.push(msg),
  };
}

function chunksOf(output: unknown): Rollup.OutputChunk[] {
  const outputs = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
  return outputs
    .flatMap((o) => o.output)
    .filter((o): o is Rollup.OutputChunk => o.type === "chunk");
}

/**
 * Buduje fiksturę tak, jak robi to produkcja: jeden `createBuilder`, wspólne
 * wtyczki, najpierw klient, potem serwer, katalogi wyjściowe jak u nitro
 * (`.output/public` dla przeglądarki, `.output/server` dla serwera).
 * `withClient: false` odtwarza awarię kolejności (serwer bez klienta przed
 * nim), `clientOutDir` - inny układ artefaktu.
 */
async function buildFixture(
  opts: { withClient?: boolean; base?: string; clientOutDir?: string } = {},
) {
  const root = join(workspace, `app-${++runs}`);
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const warnings: string[] = [];
  const builder = await createBuilder({
    configFile: false,
    envFile: false,
    root,
    base: opts.base ?? "/",
    publicDir: false,
    logLevel: "warn",
    customLogger: capturingLogger(warnings),
    plugins: [widgetChunkPlugin()],
    resolve: {
      alias: { "@/lib/builder/sliderPostsQuery": join(root, "src/stubs/sliderPostsQuery.ts") },
    },
    // Te same przełączniki co w produkcji (patrz nagłówek pliku).
    builder: { sharedPlugins: true },
    environments: {
      client: {
        build: {
          outDir: join(root, opts.clientOutDir ?? ".output/public"),
          write: false,
          minify: false,
          rollupOptions: { input: join(root, "src/client.ts") },
        },
      },
      ssr: {
        build: {
          outDir: join(root, ".output/server"),
          minify: false,
          rollupOptions: { input: join(root, "src/server.ts") },
        },
      },
    },
  });
  const clientChunks =
    opts.withClient === false ? [] : chunksOf(await builder.build(builder.environments.client));
  const serverChunks = chunksOf(await builder.build(builder.environments.ssr));
  const entry = serverChunks.find((c) => c.isEntry);
  if (!entry) throw new Error("bundel serwera bez chunku wejściowego");
  const server = (await import(
    /* @vite-ignore */ pathToFileURL(join(root, ".output/server", entry.fileName)).href
  )) as ServerModule;
  return { clientChunks, server, serverCode: entry.code, warnings } satisfies BuildResult;
}

/** Adres chunku KLIENTA, który zawiera moduł o danym sufiksie (poza wejściem). */
function clientUrlsFor(chunks: Rollup.OutputChunk[], suffix: string, base = "/"): string[] {
  return chunks
    .filter((c) => !c.isEntry && Object.keys(c.modules).some((m) => m.endsWith(suffix)))
    .map((c) => `${base}${c.fileName}`);
}

const section = (...widgets: Array<{ type: string; content?: object }>) => ({
  id: "s",
  kind: "section",
  children: [
    {
      id: "c",
      kind: "column",
      span: { desktop: 12 },
      children: widgets.map((w, i) => ({ id: `w${i}`, kind: "widget", content: {}, ...w })),
    },
  ],
});

describe("nes:widget-chunks - prawdziwy build klient -> serwer", () => {
  let result: BuildResult;

  beforeAll(async () => {
    result = await buildFixture();
  });

  it("bundel SERWERA niesie nazwy plików, które KLIENT faktycznie wyemitował", () => {
    const { clientChunks, server } = result;
    const ticker = clientUrlsFor(clientChunks, `${WIDGET_DIR}/NewsTickerView.tsx`);
    const events = clientUrlsFor(clientChunks, `${WIDGET_DIR}/EventsListView.tsx`);
    // Dokładnie jeden chunk na widget - inaczej asercje niżej nic by nie mówiły.
    expect(ticker).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(server.WIDGET_CHUNK_URLS["news-ticker"]).toEqual(ticker);
    expect(server.WIDGET_CHUNK_URLS["event-list"]).toEqual(events);
    // Nazwy z HASHEM Rollupa, nie łańcuchy z fikstury.
    expect(ticker[0]).toMatch(/^\/assets\/NewsTickerView-[\w-]{8}\.js$/);
  });

  it("KAŻDY adres w mapie serwera wskazuje istniejący, niewejściowy chunk klienta", () => {
    const { clientChunks, server } = result;
    const lazyFiles = new Set(clientChunks.filter((c) => !c.isEntry).map((c) => `/${c.fileName}`));
    const urls = Object.values(server.WIDGET_CHUNK_URLS).flat();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(lazyFiles.has(url), `nieistniejący chunk: ${url}`).toBe(true);
  });

  it("placeholder `{}` NIE przeżył builda serwera, a mapa ma komplet typów", () => {
    expect(result.serverCode).not.toMatch(/WIDGET_CHUNK_URLS\s*=\s*\{\s*\}/);
    // Klucze to typy z `TARGETS` - także te, których fikstura nie ma (puste listy).
    expect(Object.keys(result.server.WIDGET_CHUNK_URLS)).toEqual(
      expect.arrayContaining(["news-ticker", "event-list", "slider", "image-slider", "counter"]),
    );
  });

  it("widget z chunku WEJŚCIOWEGO nie dostaje hintu", () => {
    expect(result.server.WIDGET_CHUNK_URLS.counter).toEqual([]);
  });

  it("slider z wpisów dostaje oba chunki, slider z obrazów - tylko warianty", () => {
    const { clientChunks, server } = result;
    const posts = clientUrlsFor(clientChunks, `${WIDGET_DIR}/PostsSliderWidget.tsx`);
    const variants = clientUrlsFor(clientChunks, "src/lib/builder/sliderVariants.tsx");
    expect(posts).toHaveLength(1);
    expect(variants).toHaveLength(1);
    expect(posts).not.toEqual(variants);
    expect(server.WIDGET_CHUNK_URLS.slider).toEqual([...posts, ...variants]);
    expect(server.WIDGET_CHUNK_URLS["image-slider"]).toEqual(variants);
  });

  it("wykonany bundel serwera produkuje nagłówki `Link` do prawdziwych chunków", () => {
    const { clientChunks, server } = result;
    const ticker = clientUrlsFor(clientChunks, `${WIDGET_DIR}/NewsTickerView.tsx`)[0];
    const variants = clientUrlsFor(clientChunks, "src/lib/builder/sliderVariants.tsx")[0];
    const doc = {
      version: 1,
      sections: [
        section({ type: "news-ticker" }),
        section({ type: "slider", content: { items: [{ image: "https://example.com/a.jpg" }] } }),
        section({ type: "event-list" }),
      ],
    };
    // Dwie pierwsze sekcje: ticker + slider z obrazów; lista wydarzeń jest za zgięciem.
    expect(server.widgetPreloadHeaders(doc, 2)).toEqual([
      `<${ticker}>; rel="modulepreload"; crossorigin`,
      `<${variants}>; rel="modulepreload"; crossorigin`,
    ]);
  });

  it("bundel KLIENTA zostaje z pustą mapą - nazwy zna dopiero serwer", () => {
    // Klient tej mapy nie czyta (nagłówek `Link` jest serwerowy); gdyby
    // podmiana trafiła też do klienta, znaczyłoby to, że `discovered` przecieka
    // z poprzedniego przebiegu.
    const entry = result.clientChunks.find((c) => c.isEntry);
    expect(entry?.code).toMatch(/WIDGET_CHUNK_URLS\s*=\s*\{\s*\}/);
  });

  it("zdrowy build nie zgłasza ŻADNEGO ostrzeżenia wtyczki", () => {
    expect(result.warnings.filter((w) => w.includes("nes:widget-chunks"))).toEqual([]);
  });
});

describe("nes:widget-chunks - prawdziwy build: awarie i konfiguracja", () => {
  it("serwer bez klienta przed nim: placeholder zostaje, ale build MÓWI o tym głośno", async () => {
    // Odtworzenie „innej kolejności środowisk". Wdrożenie nie jest blokowane
    // (to hint wydajnościowy), ale cisza byłaby tu najgorszą odpowiedzią -
    // przed poprawką dokładnie tak było.
    const { server, warnings } = await buildFixture({ withClient: false });
    expect(server.WIDGET_CHUNK_URLS).toEqual({});
    expect(
      server.widgetPreloadHeaders({ version: 1, sections: [section({ type: "news-ticker" })] }, 1),
    ).toEqual([]);
    expect(warnings.some((w) => /nes:widget-chunks.*brak nazw chunków/.test(w))).toBe(true);
  });

  it("klienta rozpoznaje `consumer` środowiska, nie nazwa katalogu wyjściowego", async () => {
    // `dist/browser` nie pasuje do heurystyki `/client|public/`, którą wtyczka
    // rozpoznawała klienta przed poprawką - wtedy mapa serwera była pusta
    // i nikt by się o tym nie dowiedział.
    const { clientChunks, server, warnings } = await buildFixture({ clientOutDir: "dist/browser" });
    expect(server.WIDGET_CHUNK_URLS["news-ticker"]).toEqual(
      clientUrlsFor(clientChunks, `${WIDGET_DIR}/NewsTickerView.tsx`),
    );
    expect(server.WIDGET_CHUNK_URLS["news-ticker"]).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("nes:widget-chunks"))).toEqual([]);
  });

  it("`base` spoza korzenia trafia do adresów - hint wskazuje plik, który istnieje", async () => {
    const { clientChunks, server, warnings } = await buildFixture({ base: "/app/" });
    const ticker = clientUrlsFor(clientChunks, `${WIDGET_DIR}/NewsTickerView.tsx`, "/app/");
    expect(ticker).toHaveLength(1);
    expect(server.WIDGET_CHUNK_URLS["news-ticker"]).toEqual(ticker);
    expect(ticker[0].startsWith("/app/assets/")).toBe(true);
    expect(warnings.filter((w) => w.includes("nes:widget-chunks"))).toEqual([]);
  });
});
