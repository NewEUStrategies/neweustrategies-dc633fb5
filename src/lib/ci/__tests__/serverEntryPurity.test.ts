// Testy bramki czystości grafu serwera. Konwencja repo: inwariant CI ma test,
// a nie tylko przebieg w CI - inaczej sam skaner nie ma jak umrzeć na czerwono,
// gdy przestanie cokolwiek widzieć.
import { describe, expect, it } from "vitest";
import {
  analyzeServerEntryPurity,
  clientOnlyRouteComponents,
  CLIENT_ONLY_ROUTE_PREFIXES,
  renderServerEntryPurityReport,
  resolveChunkPath,
  serverEntryPurityFailed,
  startEntryLoaders,
  startupChunks,
  staticImportersOfChunk,
  valueImportersOfPackage,
  FROZEN_STATIC_IMPORTERS,
  LAZY_ONLY_PACKAGES,
  type ServerChunk,
  type SourceFile,
} from "@/lib/ci/serverEntryPurity";

const STRIPE_RULE = LAZY_ONLY_PACKAGES[0];

/** Artefakt, w którym SDK jedzie wyłącznie przez `import()`. */
const CZYSTE: ServerChunk[] = [
  { path: "_libs/stripe.mjs", source: "const s=1;export{s};" },
  {
    path: "_ssr/stripe.server-AAA.mjs",
    source:
      'async function c(){const{default:S}=await import("../_libs/stripe.mjs");return S}export{c};',
  },
  { path: "_ssr/router-BBB.mjs", source: 'import{c}from"./stripe.server-AAA.mjs";export{c};' },
];

/** Ten sam artefakt z krawędzią statyczną - regresja, której pilnuje bramka. */
const BRUDNE: ServerChunk[] = [
  CZYSTE[0],
  {
    path: "_ssr/stripe.server-AAA.mjs",
    source: 'import{s}from"../_libs/stripe.mjs";export{s};',
  },
  CZYSTE[2],
];

const ZRODLA: SourceFile[] = [
  { path: "src/lib/ssrSanitizeHtml.ts", source: 'import { parse } from "node-html-parser";' },
  {
    path: "src/lib/builder/normalizeRichHtml.ts",
    source: 'import { parse, type HTMLElement } from "node-html-parser";',
  },
  {
    path: "src/lib/stripe.server.ts",
    source: 'import type Stripe from "stripe";\nexport type X = Stripe;',
  },
];

/** Loader wejść TanStack Start (`getEntries`) w kształcie po Oxc - jedna kopia aplikacji. */
const LOADER: ServerChunk = {
  path: "_ssr/server-LLL.mjs",
  source:
    "async function u(){let[e,t,n]=await Promise.all([import(`./router-RRR.mjs`),import(`./start-SSS.mjs`),import(`./empty-plugin-adapters-PPP.mjs`)]);return{routerEntry:e,startEntry:t,pluginAdapters:n}}export{u};",
};

/** Druga kopia z artefaktu sprzed 2026-10-24: Nitro, chunki bez hashy, cudzysłowy. */
const LOADER_NITRO: ServerChunk = {
  path: "_libs/@tanstack/react-start+[...].mjs",
  source:
    'async function Qi(){let[e,t,n]=await Promise.all([import("../../_chunks/router.mjs"),import("../../_chunks/start.mjs"),import("../_10.mjs")]);return{routerEntry:e,startEntry:t,pluginAdapters:n}}export{Qi};',
};

/** Trasa panelu w kształcie po Oxc, z komponentem podmienionym na zaślepkę (czwarta klasa). */
const TRASA_PANELU: ServerChunk = {
  path: "_ssr/routes-ADM.mjs",
  source:
    "var Kv=S(`/admin/posts/$slug`)({component:w(()=>import(`./admin.posts._slug-AAA.mjs`),`component`),remountDeps:({params:e})=>e.slug});export{Kv};",
};
const ZASLEPKA: ServerChunk = {
  path: "_ssr/admin.posts._slug-AAA.mjs",
  source: "function e(){return null}export{e as component};",
};

/**
 * Analiza z jednym loaderem wejść i trasą panelu z zaślepką dołożonymi do niepustego
 * artefaktu, żeby testy pozostałych reguł nie oblewały na regułach jednej kopii i zaślepek;
 * pusty artefakt zostaje pusty.
 */
function analiza(chunks: ServerChunk[], sources: SourceFile[] = ZRODLA) {
  return analyzeServerEntryPurity({
    chunks: chunks.length > 0 ? [...chunks, LOADER, TRASA_PANELU, ZASLEPKA] : chunks,
    sources,
    lazyOnlyPackages: LAZY_ONLY_PACKAGES,
    frozenRules: FROZEN_STATIC_IMPORTERS,
  });
}

describe("serverEntryPurity - ciężka paczka server-only tylko przez import()", () => {
  it("nie liczy `import(` jako krawędzi inicjalizacyjnej", () => {
    expect(staticImportersOfChunk(CZYSTE, "_libs/stripe.mjs")).toEqual([]);
    expect(staticImportersOfChunk(BRUDNE, "_libs/stripe.mjs")).toEqual([
      "_ssr/stripe.server-AAA.mjs",
    ]);
  });

  it("krawędź po ŚCIEŻCE: moduł aplikacji `_chunks/stripe.mjs` to nie SDK", () => {
    // Nitro na Rolldownie: moduł aplikacji `lib/.../stripe.ts` dostaje `_chunks/stripe.mjs`,
    // a jego importery w `_chunks/` piszą `from"./stripe.mjs"` - ta sama nazwa pliku co SDK.
    const chunks: ServerChunk[] = [
      ...CZYSTE,
      { path: "_chunks/stripe.mjs", source: "const k=`pk`;export{k};" },
      { path: "_chunks/router.mjs", source: 'import{k}from"./stripe.mjs";export{k};' },
    ];
    expect(resolveChunkPath("_chunks/router.mjs", "./stripe.mjs")).toBe("_chunks/stripe.mjs");
    expect(resolveChunkPath("_ssr/a.mjs", "../_libs/stripe.mjs")).toBe("_libs/stripe.mjs");
    expect(staticImportersOfChunk(chunks, "_libs/stripe.mjs")).toEqual([]);
    expect(serverEntryPurityFailed(analiza(chunks))).toBe(false);
  });

  it("fasada `import()` (Nitro na Rolldownie) nie jest krawędzią startową", () => {
    // `_libs/_13.mjs` reeksportuje SDK i jest ładowana WYŁĄCZNIE przez `import()` (backticki Oxc).
    const facade: ServerChunk = {
      path: "_libs/_13.mjs",
      source: 'export{Stripe,s as default}from"./stripe.mjs";',
    };
    const lazy: ServerChunk[] = [
      CZYSTE[0],
      facade,
      {
        path: "_ssr/stripe.server-AAA.mjs",
        source: "async function c(){return(await import(`../_libs/_13.mjs`)).default}export{c};",
      },
      CZYSTE[2],
    ];
    expect(staticImportersOfChunk(lazy, "_libs/stripe.mjs")).toEqual(["_libs/_13.mjs"]);
    expect(startupChunks(lazy).has("_libs/_13.mjs")).toBe(false);
    expect(serverEntryPurityFailed(analiza(lazy))).toBe(false);

    // Ta sama fasada zaimportowana statycznie przez chunk startowy - SDK znów przy starcie.
    const eager: ServerChunk[] = [
      ...lazy.slice(0, 3),
      { path: "_ssr/router-BBB.mjs", source: 'import"../_libs/_13.mjs";export{};' },
    ];
    const report = analiza(eager);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.lazyOnly[0].importers).toEqual(["_libs/_13.mjs"]);
  });

  it("korzenie to pliki bez importerów; start = ich domknięcie statyczne", () => {
    expect([...startupChunks(BRUDNE)].sort()).toEqual([
      "_libs/stripe.mjs",
      "_ssr/router-BBB.mjs",
      "_ssr/stripe.server-AAA.mjs",
    ]);
    // `import()` zdejmuje plik z korzeni, a krawędź dynamiczna nie wciąga go do startu.
    expect([...startupChunks(CZYSTE)].sort()).toEqual([
      "_ssr/router-BBB.mjs",
      "_ssr/stripe.server-AAA.mjs",
    ]);
  });

  it("przechodzi na artefakcie z wyłącznie dynamiczną krawędzią", () => {
    const report = analiza(CZYSTE);
    expect(serverEntryPurityFailed(report)).toBe(false);
    expect(renderServerEntryPurityReport(report)).toContain("Graf serwera czysty");
  });

  it("oblewa i wskazuje importera, gdy wraca krawędź statyczna", () => {
    const report = analiza(BRUDNE);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.lazyOnly[0].pkg.chunk).toBe(STRIPE_RULE.chunk);
    expect(renderServerEntryPurityReport(report)).toContain("_ssr/stripe.server-AAA.mjs");
  });

  it("oblewa na pustym artefakcie - brak pomiaru to nie jest zielone światło", () => {
    const report = analiza([]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(renderServerEntryPurityReport(report)).toContain("artefakt serwera jest pusty");
  });

  it("oblewa, gdy chunku reguły nie ma w artefakcie - reguła bez chunku nic nie mierzy", () => {
    const report = analiza([{ path: "_ssr/router-BBB.mjs", source: "export{};" }]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.missingChunks.map((p) => p.chunk)).toEqual([STRIPE_RULE.chunk]);
  });
});

describe("serverEntryPurity - graf startu i raport", () => {
  it("romb i cykl w grafie: każdy plik startu liczony raz, cykl nie zapętla przejścia", () => {
    // Dwa korzenie importują ten sam chunk, a ten - przez cykl - sam siebie pośrednio.
    const chunks: ServerChunk[] = [
      { path: "index.mjs", source: 'import"./_chunks/a.mjs";import"./_chunks/b.mjs";' },
      { path: "worker.mjs", source: 'import"./_chunks/a.mjs";' },
      { path: "_chunks/a.mjs", source: 'import"./b.mjs";export{};' },
      { path: "_chunks/b.mjs", source: 'import"./a.mjs";export{};' },
      { path: "_chunks/lazy.mjs", source: "export{};" },
      { path: "_chunks/loader.mjs", source: "const l=()=>import(`./lazy.mjs`);export{l};" },
    ];
    // `loader.mjs` nie ma importera, więc jest korzeniem; `lazy.mjs` ma tylko `import()`.
    expect([...startupChunks(chunks)].sort()).toEqual([
      "_chunks/a.mjs",
      "_chunks/b.mjs",
      "_chunks/loader.mjs",
      "index.mjs",
      "worker.mjs",
    ]);
  });

  it("raport skraca listę importerów do 10 i podaje resztę liczbą", () => {
    const importers: ServerChunk[] = Array.from({ length: 12 }, (_, i) => ({
      path: `_ssr/r${String(i).padStart(2, "0")}.mjs`,
      source: 'import{s}from"../_libs/stripe.mjs";export{s};',
    }));
    const report = analiza([CZYSTE[0], ...importers]);
    expect(report.lazyOnly[0].importers).toHaveLength(12);
    const text = renderServerEntryPurityReport(report);
    expect(text).toContain("ma 12 statycznych importerów ładowanych przy starcie");
    expect(text).toContain("_ssr/r09.mjs");
    expect(text).not.toContain("_ssr/r10.mjs");
    expect(text).toContain("… i 2 więcej");
  });

  it("raport zamrożonej listy: nowy importer i wpis do skrócenia, każdy z naprawą", () => {
    const added = renderServerEntryPurityReport(
      analiza(CZYSTE, [
        ...ZRODLA,
        {
          path: "src/lib/wp-import/convert.ts",
          source: 'import { parse } from "node-html-parser";',
        },
      ]),
    );
    expect(added).toContain("nowy statyczny importer `node-html-parser` poza zamrożoną listą");
    expect(added).toContain("    src/lib/wp-import/convert.ts");
    expect(added).toContain(`naprawa: ${FROZEN_STATIC_IMPORTERS[0].remedy}`);
    const stale = renderServerEntryPurityReport(analiza(CZYSTE, [ZRODLA[0], ZRODLA[2]]));
    expect(stale).toContain("wymienia moduły, które już nie importują tej paczki");
    expect(stale).toContain("    src/lib/builder/normalizeRichHtml.ts");
    expect(stale).toContain("Dług został spłacony");
  });

  it("raport brakującego chunku reguły nazywa ścieżkę i każe zaktualizować regułę", () => {
    const text = renderServerEntryPurityReport(
      analiza([{ path: "_ssr/router-BBB.mjs", source: "export{};" }]),
    );
    expect(text).toContain("nie znaleziono chunku `_libs/stripe.mjs`");
    expect(text).toContain("Zaktualizuj regułę lub ją usuń");
  });
});

describe("serverEntryPurity - jedna kopia aplikacji w artefakcie", () => {
  const surowa = (chunks: ServerChunk[]) =>
    analyzeServerEntryPurity({
      chunks,
      sources: ZRODLA,
      lazyOnlyPackages: LAZY_ONLY_PACKAGES,
      frozenRules: FROZEN_STATIC_IMPORTERS,
    });

  it("rozpoznaje loader wejść w backtickach Oxc i w cudzysłowach, z hashem i bez", () => {
    expect(startEntryLoaders([...CZYSTE, LOADER, LOADER_NITRO])).toEqual([
      "_libs/@tanstack/react-start+[...].mjs",
      "_ssr/server-LLL.mjs",
    ]);
  });

  it("sam `import()` chunku routera albo startu to nie loader wejść", () => {
    const chunks: ServerChunk[] = [
      { path: "_ssr/a.mjs", source: "const r=()=>import(`./router-RRR.mjs`);export{r};" },
      { path: "_ssr/b.mjs", source: "const s=()=>import(`./start-SSS.mjs`);export{s};" },
      {
        path: "_ssr/c.mjs",
        source: "Promise.all([import(`./start-SSS.mjs`),import(`./router-RRR.mjs`)]);",
      },
    ];
    expect(startEntryLoaders(chunks)).toEqual([]);
  });

  it("przechodzi z dokładnie jednym loaderem", () => {
    const report = surowa([...CZYSTE, LOADER, TRASA_PANELU, ZASLEPKA]);
    expect(report.startEntryLoaders).toEqual(["_ssr/server-LLL.mjs"]);
    expect(serverEntryPurityFailed(report)).toBe(false);
  });

  it("oblewa na drugiej kopii aplikacji i wskazuje oba loadery z naprawą", () => {
    const report = surowa([...CZYSTE, LOADER, LOADER_NITRO]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    const text = renderServerEntryPurityReport(report);
    expect(text).toContain("artefakt serwera niesie 2 kopie aplikacji");
    expect(text).toContain("    _libs/@tanstack/react-start+[...].mjs");
    expect(text).toContain("    _ssr/server-LLL.mjs");
    expect(text).toContain("importuj LITERAŁEM");
  });

  it("oblewa bez loadera - zmieniony kształt kodu frameworka to defekt skanu", () => {
    const report = surowa([...CZYSTE, TRASA_PANELU, ZASLEPKA]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(renderServerEntryPurityReport(report)).toContain(
      "nie znaleziono loadera wejść TanStack Start",
    );
  });
});

describe("serverEntryPurity - komponenty tras renderowanych wyłącznie po hydratacji", () => {
  const surowa = (chunks: ServerChunk[]) =>
    analyzeServerEntryPurity({
      chunks: [...CZYSTE, LOADER, ...chunks],
      sources: ZRODLA,
      lazyOnlyPackages: LAZY_ONLY_PACKAGES,
      frozenRules: FROZEN_STATIC_IMPORTERS,
    });

  it("zaślepka komponentu trasy panelu przechodzi", () => {
    const report = surowa([TRASA_PANELU, ZASLEPKA]);
    expect(report.clientOnlyComponents).toEqual({ checked: 1, heavy: [] });
    expect(serverEntryPurityFailed(report)).toBe(false);
  });

  it("pełny komponent panelu w artefakcie serwera oblewa z trasą, plikiem i rozmiarem", () => {
    const pelny: ServerChunk = { path: ZASLEPKA.path, source: "x".repeat(170_000) };
    const report = surowa([TRASA_PANELU, pelny]);
    expect(report.clientOnlyComponents.heavy).toEqual([
      { route: "/admin/posts/$slug", chunk: "_ssr/admin.posts._slug-AAA.mjs", bytes: 170_000 },
    ]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    const text = renderServerEntryPurityReport(report);
    expect(text).toContain("1 z 1 komponentów tras renderowanych wyłącznie po hydratacji");
    expect(text).toContain("    /admin/posts/$slug: _ssr/admin.posts._slug-AAA.mjs (170000 B)");
    expect(text).toContain("clientOnlyRouteStubPlugin.ts");
  });

  it("brak pliku zaślepki jest naruszeniem, a nie zielonym światłem", () => {
    const report = surowa([TRASA_PANELU]);
    expect(report.clientOnlyComponents.heavy[0]).toMatchObject({ bytes: -1 });
    expect(renderServerEntryPurityReport(report)).toContain("(brak pliku)");
  });

  it("trasy publiczne, layout `/admin` i komponenty innych tras nie są sprawdzane", () => {
    const publiczne: ServerChunk = {
      path: "_ssr/routes-PUB.mjs",
      source:
        "var A=S(`/admin`)({component:w(()=>import(`./admin-L.mjs`),`component`)});var B=S(`/blog`)({component:w(()=>import(`./blog-B.mjs`),`component`)});",
    };
    const report = surowa([
      publiczne,
      { path: "_ssr/admin-L.mjs", source: "y".repeat(5_000) },
      { path: "_ssr/blog-B.mjs", source: "z".repeat(5_000) },
      TRASA_PANELU,
      ZASLEPKA,
    ]);
    expect(report.clientOnlyComponents).toEqual({ checked: 1, heavy: [] });
  });

  it("węzły błędu i 404 trasy panelu też muszą być zaślepką; loader nie jest sprawdzany", () => {
    const trasa: ServerChunk = {
      path: "_ssr/routes-ADM.mjs",
      source:
        "S(`/admin/x`)({loader:l(()=>import(`./admin.x-L.mjs`),`loader`),component:w(()=>import(`./admin.x-C.mjs`),`component`),errorComponent:w(()=>import(`./admin.x-E.mjs`),`errorComponent`)});",
    };
    const report = surowa([
      trasa,
      { path: "_ssr/admin.x-L.mjs", source: "l".repeat(5_000) },
      { path: "_ssr/admin.x-C.mjs", source: ZASLEPKA.source },
      { path: "_ssr/admin.x-E.mjs", source: "e".repeat(5_000) },
    ]);
    expect(report.clientOnlyComponents.checked).toBe(2);
    expect(report.clientOnlyComponents.heavy.map((h) => h.chunk)).toEqual(["_ssr/admin.x-E.mjs"]);
  });

  it("grupa podziału wspólna z loaderem (kokpit `/admin/`) nie jest sprawdzana", () => {
    const kokpit: ServerChunk = {
      path: "_ssr/routes-KOK.mjs",
      source:
        "S(`/admin/`)({loader:C(()=>import(`./admin.index-K.mjs`),`loader`),component:w(()=>import(`./admin.index-K.mjs`),`component`)});",
    };
    const report = surowa([
      kokpit,
      { path: "_ssr/admin.index-K.mjs", source: "k".repeat(6_000) },
      TRASA_PANELU,
      ZASLEPKA,
    ]);
    expect(report.clientOnlyComponents).toEqual({ checked: 1, heavy: [] });
  });

  it("zero sprawdzonych tras to defekt skanu", () => {
    const report = surowa([]);
    expect(report.clientOnlyComponents.checked).toBe(0);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(renderServerEntryPurityReport(report)).toContain("nie znaleziono komponentów tras");
  });

  it("prefiks reguły to `/admin/` - layout `/admin` renderuje szkielet na serwerze", () => {
    expect(CLIENT_ONLY_ROUTE_PREFIXES).toEqual(["/admin/"]);
    expect(clientOnlyRouteComponents([TRASA_PANELU, ZASLEPKA]).checked).toBe(1);
  });
});

describe("serverEntryPurity - zamrożone statyczne importy parsera HTML", () => {
  it("`import type` nie jest krawędzią i nie liczy się do długu", () => {
    expect(valueImportersOfPackage(ZRODLA, "stripe")).toEqual([]);
    expect(valueImportersOfPackage(ZRODLA, "node-html-parser")).toEqual([
      "src/lib/builder/normalizeRichHtml.ts",
      "src/lib/ssrSanitizeHtml.ts",
    ]);
  });

  it("oblewa na NOWYM statycznym importerze spoza listy", () => {
    const report = analiza(CZYSTE, [
      ...ZRODLA,
      { path: "src/lib/wp-import/convert.ts", source: 'import { parse } from "node-html-parser";' },
    ]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.frozen[0].added).toEqual(["src/lib/wp-import/convert.ts"]);
  });

  it("oblewa na wpisie, który przestał importować paczkę - lista ma mierzyć stan faktyczny", () => {
    const report = analiza(CZYSTE, [ZRODLA[0], ZRODLA[2]]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.frozen[0].stale).toEqual(["src/lib/builder/normalizeRichHtml.ts"]);
  });

  it("lista długu jest dokładnie tak długa, jak ją opisano w komentarzu", () => {
    const rule = FROZEN_STATIC_IMPORTERS[0];
    expect(rule.pkg).toBe("node-html-parser");
    expect(rule.allowed).toEqual([
      "src/lib/builder/normalizeRichHtml.ts",
      "src/lib/ssrSanitizeHtml.ts",
    ]);
  });
});
