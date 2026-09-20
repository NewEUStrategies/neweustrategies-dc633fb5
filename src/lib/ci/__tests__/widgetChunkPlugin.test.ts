// Wtyczka `nes:widget-chunks` - hinty `modulepreload` dla leniwych widgetów
// buildera (`scripts/lib/widgetChunkPlugin.ts`).
//
// CZEGO TEN PLIK PILNUJE I DLACZEGO WŁAŚNIE TEGO. Wtyczka jest MAPĄ NAZW:
// łączy typ widgetu z dokumentu buildera (`WidgetType`) ze ŚCIEŻKĄ MODUŁU,
// którego chunk ma pojechać hintem w nagłówku HTTP. Obie strony tej mapy są
// łańcuchami znaków, więc obie psują się BEZ ŻADNEGO OBJAWU:
//
//   - literówka w typie (`events-list` zamiast `event-list`) daje martwy klucz,
//     którego `widgetPreloadHeaders` nigdy nie znajdzie - build zielony,
//     bramki zielone, hint nie istnieje;
//   - przeniesienie albo przemianowanie modułu widgetu zostawia sufiks, którego
//     żaden chunk nie pasuje - `discovered[typ]` to pusta lista, znowu cisza.
//
// Dlatego ten plik sprawdza mapę wobec DWÓCH źródeł prawdy: unii `WidgetType`
// w `src/lib/builder/types.ts` i plików na dysku. Hooki wtyczki testujemy
// bezpośrednio, bez uruchamiania builda - to ten sam kod, który wykona Rollup.
import { existsSync, readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

import {
  WIDGET_CHUNK_TARGETS,
  widgetChunkPlugin,
} from "../../../../scripts/lib/widgetChunkPlugin";

/** Minimalny kształt chunku, od którego zależy decyzja wtyczki. */
function chunk(fileName: string, modules: string[], isEntry = false) {
  return {
    type: "chunk" as const,
    fileName,
    isEntry,
    modules: Object.fromEntries(modules.map((m) => [m, { renderedLength: 1 }])),
  };
}

type PluginWithHooks = {
  enforce?: "pre" | "post";
  transform: (
    this: { error: (m: string) => never },
    code: string,
    id: string,
  ) => { code: string } | null;
  generateBundle: (
    options: { dir?: string },
    bundle: Record<string, ReturnType<typeof chunk>>,
  ) => void;
};

function plugin(): PluginWithHooks {
  return widgetChunkPlugin() as unknown as PluginWithHooks;
}

/** Kontekst hooka: `this.error` Rollupa przerywa build wyjątkiem. */
const errCtx = {
  error: (m: string) => {
    throw new Error(m);
  },
};

const TARGET = "/repo/src/lib/seo/widgetPreloads.ts";
const SOURCE = readFileSync("src/lib/seo/widgetPreloads.ts", "utf8");
const TYPES_SOURCE = readFileSync("src/lib/builder/types.ts", "utf8");
const LAZY_REGISTRY = [
  "src/components/builder/organisms/widget-view/lazyWidgets.tsx",
  "src/components/builder/organisms/widget-view/lazySliderRender.tsx",
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Unia `WidgetType` odczytana ze źródła - jedyna lista dopuszczalnych kluczy. */
const WIDGET_TYPES = new Set(
  (TYPES_SOURCE.match(/export type WidgetType =[\s\S]*?;\n/)?.[0] ?? "")
    .match(/"[a-z0-9-]+"/g)
    ?.map((s) => s.slice(1, -1)) ?? [],
);

const ENTRIES = Object.entries(WIDGET_CHUNK_TARGETS);

/**
 * Klucze SYNTETYCZNE - nie ma ich w `WidgetType` i tak ma zostać.
 * `image-slider` wylicza `widgetPreloadHeaders`: slider bez źródła z wpisów
 * nie potrzebuje warstwy zapytań, więc dostaje węższy zestaw chunków niż
 * `slider`. To jedyny taki wyjątek - każdy następny klucz spoza unii jest
 * literówką i ma tu zapalić czerwone.
 */
const KLUCZE_SYNTETYCZNE = new Set(["image-slider"]);

/**
 * Moduły spoza rejestru `lazyWidgets` - i dlaczego wolno im tam nie być.
 * `ArchivePostList` renderuje listę wpisów na trasach archiwum/wyszukiwarki
 * (statyczny import w `routes/search.tsx` i `PaginatedPostGrid.tsx`), więc
 * siedzi w chunku TRASY, nie w chunku widgetu - a hint ma prowadzić do tego,
 * co naprawdę niesie treść typu `post-list`/`carousel` na danej stronie.
 */
const POZA_REJESTREM = new Set(["/src/components/archive/ArchivePostList.tsx"]);

describe("nes:widget-chunks - mapa typ -> moduł", () => {
  it("unia WidgetType w ogóle się sparsowała (inaczej reszta pliku nic nie dowodzi)", () => {
    expect(WIDGET_TYPES.size).toBeGreaterThan(80);
    expect(WIDGET_TYPES.has("news-ticker")).toBe(true);
  });

  it.each(ENTRIES.map(([type]) => type))("`%s` jest realnym typem z WidgetType", (type) => {
    // Martwy klucz nie wywala builda - `widgetPreloadHeaders` po prostu nigdy
    // go nie trafi, a hint znika po cichu. Tu ma krzyczeć.
    if (KLUCZE_SYNTETYCZNE.has(type)) return;
    expect(WIDGET_TYPES.has(type), `nieznany typ widgetu: ${type}`).toBe(true);
  });

  it("jedynym kluczem spoza unii jest `image-slider` - i jest wyliczany, nie zgadywany", () => {
    const spozaUnii = ENTRIES.map(([t]) => t).filter((t) => !WIDGET_TYPES.has(t));
    expect(spozaUnii).toEqual(["image-slider"]);
    // Dowód, że to wyliczenie faktycznie żyje w `widgetPreloadHeaders`.
    expect(readFileSync("src/lib/seo/widgetPreloads.ts", "utf8")).toContain('"image-slider"');
  });

  it.each(ENTRIES.flatMap(([type, mods]) => mods.map((m) => [type, m] as const)))(
    "`%s` wskazuje istniejący moduł %s",
    (_type, module) => {
      expect(existsSync(module.replace(/^\//, "")), `brak pliku: ${module}`).toBe(true);
    },
  );

  it.each(ENTRIES.flatMap(([type, mods]) => mods.map((m) => [type, m] as const)))(
    "`%s` -> %s ma leniwą krawędź w rejestrze widgetów",
    (_type, module) => {
      if (POZA_REJESTREM.has(module)) return;
      // Hint do chunku, do którego nie prowadzi żaden `import()`, byłby hintem
      // do kodu już pobranego (chunk wejściowy) - koszt nagłówka bez zysku.
      const base = module.replace(/^.*\//, "").replace(/\.tsx?$/, "");
      expect(
        new RegExp(`import\\((?:\\s|\\n)*["'][^"']*${base}["']`).test(LAZY_REGISTRY),
        `brak \`import("...${base}")\` w lazyWidgets/lazySliderRender`,
      ).toBe(true);
    },
  );

  it("nie ma tu ANI JEDNEGO typu panelu admina", () => {
    // Hint jedzie w nagłówku odpowiedzi strony PUBLICZNEJ; moduł admina
    // w tej mapie oznaczałby, że czytelnik pobiera kod panelu.
    for (const [, mods] of ENTRIES) {
      for (const module of mods) {
        expect(module.includes("/admin/"), `moduł admina w mapie: ${module}`).toBe(false);
      }
    }
  });

  it("typy rysowane EAGER (inline) nie mają wpisu", () => {
    // Kontrakt „co zostaje EAGER" z nagłówka `lazyWidgets.tsx`: te typy jadą
    // w chunku wejściowym, więc hint do nich jest z definicji pusty koszt.
    // `heading` ma leniwy odpowiednik wyłącznie jako osobny typ
    // `animated-heading` - i to on jest w mapie.
    for (const eager of [
      "heading",
      "image",
      "cta",
      "video",
      "map",
      "dark-featured-card",
      "button",
      "icon",
      "divider",
      "spacer",
      "menu",
      "mega-menu",
    ]) {
      expect(WIDGET_CHUNK_TARGETS[eager], `typ eager w mapie: ${eager}`).toBeUndefined();
    }
    expect(WIDGET_CHUNK_TARGETS["animated-heading"]).toBeDefined();
  });

  it("nazwy z 2026-09-20 są DOKŁADNIE tymi z rejestru typów, nie z intuicji", () => {
    // `events`/`events-list` nie istnieją - lista wydarzeń to `event-list`.
    // `map` to osadzona ramka Google, mapa świata to `world-map`.
    expect(WIDGET_CHUNK_TARGETS["event-list"]).toBeDefined();
    expect(WIDGET_CHUNK_TARGETS.events).toBeUndefined();
    expect(WIDGET_CHUNK_TARGETS["events-list"]).toBeUndefined();
    expect(WIDGET_CHUNK_TARGETS["world-map"]).toBeDefined();
    expect(WIDGET_CHUNK_TARGETS.map).toBeUndefined();
  });
});

const CLIENT_BUNDLE = {
  "assets/ticker-AAA.js": chunk("assets/ticker-AAA.js", [
    "/repo/src/components/builder/organisms/widget-view/NewsTickerView.tsx",
  ]),
  "assets/events-BBB.js": chunk("assets/events-BBB.js", [
    "/repo/src/components/builder/organisms/widget-view/EventsListView.tsx",
  ]),
  "assets/index-CCC.js": chunk(
    "assets/index-CCC.js",
    ["/repo/src/components/builder/organisms/widget-view/CounterWidget.tsx"],
    true,
  ),
};

describe("nes:widget-chunks - odkrywanie nazw chunków", () => {
  it("czyta bundel PRZEGLĄDARKI i wstawia nazwy do pliku źródłowego", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(errCtx, SOURCE, TARGET);
    expect(out).not.toBeNull();
    expect(out!.code).toContain('"news-ticker":["/assets/ticker-AAA.js"]');
    expect(out!.code).toContain('"event-list":["/assets/events-BBB.js"]');
    // Placeholder musi zniknąć - inaczej podmiana zadziałała tylko pozornie.
    expect(out!.code).not.toMatch(/WIDGET_CHUNK_URLS[^=]+=\s*\{\}/);
  });

  it("POMIJA chunk wejściowy - hint do już pobranego kodu to czysty koszt", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    const out = p.transform.call(errCtx, SOURCE, TARGET);
    expect(out!.code).toContain('"counter":[]');
  });

  it("IGNORUJE bundel serwera - nazwy klienckie nie mogą przyjść z workera", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/server" }, CLIENT_BUNDLE);
    expect(p.transform.call(errCtx, SOURCE, TARGET)).toBeNull();
  });

  it("nie rusza żadnego innego modułu", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    expect(p.transform.call(errCtx, SOURCE, "/repo/src/lib/seo/rootHead.ts")).toBeNull();
  });

  it("nazwa pliku z `$` nie jest interpretowana jako grupa wsteczna", () => {
    // Nazwa chunku pochodzi z Rollupa, a `String.replace` z łańcuchem traktuje
    // `$&` jako sterujące - dlatego wstawiamy wartość funkcją.
    const p = plugin();
    p.generateBundle(
      { dir: "/repo/.output/public" },
      {
        "assets/ticker-$&x.js": chunk("assets/ticker-$&x.js", [
          "/repo/src/components/builder/organisms/widget-view/NewsTickerView.tsx",
        ]),
      },
    );
    const out = p.transform.call(errCtx, SOURCE, TARGET);
    expect(out!.code).toContain('"news-ticker":["/assets/ticker-$&x.js"]');
  });
});

// ── WEJŚCIE, KTÓRE NAPRAWDĘ DOSTAJE BUILD ────────────────────────────────────
//
// Wzorzec podmiany wymaga ADNOTACJI TYPU (`WIDGET_CHUNK_URLS\s*:`), a esbuild
// ją zdejmuje. Gdyby wtyczka nie deklarowała `enforce: "pre"`, trafiłaby do
// koszyka „normal", czyli ZA rdzeniowy `vite:esbuild`, i zobaczyłaby kod PO
// transpilacji - wzorzec nie pasowałby, a `this.error` ZATRZYMAŁBY BUILD.
// To jest ta sama pułapka, która w `nes:locale-chunks` (2026-09-01) unieważniła
// hint słownika; tutaj kosztowałaby nie hint, tylko całe wdrożenie.
describe("nes:widget-chunks - sprzężenie z kolejnością wtyczek", () => {
  const TRANSPILED = transformSync(SOURCE, { loader: "ts", target: "esnext" }).code;

  it("esbuild ZDEJMUJE adnotację typu - dowód przyczyny, nie domysł", () => {
    expect(SOURCE).toContain("WIDGET_CHUNK_URLS: Readonly<");
    expect(TRANSPILED).toContain("WIDGET_CHUNK_URLS = {}");
    expect(TRANSPILED).not.toContain("WIDGET_CHUNK_URLS: Readonly<");
  });

  it('wtyczka deklaruje `enforce: "pre"`, więc widzi ŹRÓDŁO, nie wynik esbuilda', () => {
    expect(plugin().enforce).toBe("pre");
  });

  it("na kodzie po transpilacji podmiana PADA jawnie (a nie po cichu)", () => {
    const p = plugin();
    p.generateBundle({ dir: "/repo/.output/public" }, CLIENT_BUNDLE);
    expect(() => p.transform.call(errCtx, TRANSPILED, TARGET)).toThrow(/WIDGET_CHUNK_URLS/);
  });
});
