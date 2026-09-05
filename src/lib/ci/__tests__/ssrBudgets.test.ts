// TEST BRAMKI BUDŻETÓW WEWNĘTRZNYCH SSR - z KONTROLĄ NEGATYWNĄ.
//
// PO CO KONTROLA NEGATYWNA, i dlaczego to jest tu najważniejszy rodzaj testu.
// Bramka statyczna ma jedną charakterystyczną awarię: przestaje cokolwiek
// znajdować (kotwica parsera przestaje trafiać, wzorzec przestaje pasować) i od
// tej chwili jest ZIELONA ZAWSZE. Taka awaria nie daje żadnego sygnału - CI
// świeci na zielono, a bramka nie istnieje. Dlatego każdy z trzech budżetów ma
// tutaj PARĘ testów: jeden dowodzący, że poprawne wejście przechodzi, i drugi
// dowodzący, że ZEPSUTE wejście OBLEWA. Bramka bez tej drugiej połowy jest
// bramką, o której nie wiadomo, czy działa.
//
// WEJŚCIA SĄ ATRAPAMI, NIE PRAWDZIWYM DRZEWEM - świadomie: test na prawdziwych
// plikach mierzyłby stan repozytorium (i zmieniałby wynik przy każdej zmianie
// trasy), a przedmiotem dowodu jest INWARIANT, czyli reakcja na KSZTAŁT
// wejścia. Ta sama konwencja co `gateCoverage.test.ts` i `contentLayering.test.ts`.
import { describe, expect, it } from "vitest";
import {
  analyzeSsrBudgets,
  blankNonCode,
  dehydrationInvariants,
  FROZEN_SSR_BUDGETS,
  FROZEN_UNMEASURABLE_PARALLEL,
  loaderBudgetFacts,
  numericConstants,
  renderSsrBudgetReport,
  routeOptionsBlockWide,
  ssrBudgetsFailed,
  type SsrBudgetSource,
} from "../ssrBudgets";

/** Poprawny korzeń: dwie fale, razem dokładnie 3 000 ms. */
const ROOT_OK = `
import { createRootRouteWithContext } from "@tanstack/react-router";
export const ROOT_WARM_BUDGET_MS = 2_500;
export const CHROME_WARM_BUDGET_MS = 500;
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async ({ context }) => {
    await withBudget(
      Promise.allSettled([context.queryClient.ensureQueryData(a)]),
      ROOT_WARM_BUDGET_MS,
    );
    await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS);
  },
  component: RootComponent,
});
`;

/**
 * Poprawny `src/router.tsx`: trzy inwarianty dehydracji obecne i w kolejności.
 *
 * IMPORT NA GÓRZE JEST CZĘŚCIĄ ATRAPY, nie ozdobą. Pierwsza wersja tej stałej
 * go NIE MIAŁA - i właśnie dlatego test przechodził na implementacji, która
 * szukała PIERWSZEGO WYSTĄPIENIA identyfikatora `sweepQueryCacheForSerialization`
 * zamiast jego WYWOŁANIA. W prawdziwym `src/router.tsx` pierwszym wystąpieniem
 * jest import (`:13`), który zawsze poprzedza `integrationDehydrate`, więc
 * inwariant kolejności był tam PUSTY. Atrapa bez importu nie odtwarzała pliku,
 * który ma opisywać - i test zielenił się na dziurze.
 */
const ROUTER_OK = `
import { sweepQueryCacheForSerialization } from "./lib/ssr/postRenderSweep";
import { guardQueryStream } from "./lib/ssr/queryStreamGuard";
const router = createRouter({
  defaultOptions: {
    dehydrate: {
      shouldDehydrateQuery: (query) => query.state.status === "success",
    },
  },
});
const integrationDehydrate = router.options.dehydrate;
router.options.dehydrate = async () => {
  sweepQueryCacheForSerialization(queryClient, { reason: "dehydrate" });
  const dehydrated = await integrationDehydrate?.();
  if (dehydrated?.queryStream) {
    dehydrated.queryStream = guardQueryStream(dehydrated.queryStream, queryClient, {});
  }
  return dehydrated;
};
`;

function analyze(extra: SsrBudgetSource[] = []) {
  return analyzeSsrBudgets({
    sources: [
      { file: "src/routes/__root.tsx", source: ROOT_OK },
      { file: "src/router.tsx", source: ROUTER_OK },
      ...extra,
    ],
  });
}

describe("blankNonCode - wygaszanie komentarzy i literałów napisowych", () => {
  it("counts a phase ceiling when an absolute deadline is passed as argument three", () => {
    const source = ROOT_OK.replace(
      "withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS)",
      "withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS, homeDeadline)",
    );
    expect(loaderBudgetFacts("src/routes/__root.tsx", source)?.chainMs).toBe(3000);
  });

  it("keeps configured root ceilings visible when warm-up moves into loadResilient", () => {
    const source = ROOT_OK.replace("await withBudget(", "await loadResilient(");
    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(report.rootWarmChainMs).toBe(3000);
    const raised = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: source.replace("2_500", "2_501") },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(ssrBudgetsFailed(raised)).toBe(true);
    const extraPhase = analyzeSsrBudgets({
      sources: [
        {
          file: "src/routes/__root.tsx",
          source: source.replace(
            "await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS);",
            "await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS); await withBudget(extra, 1000);",
          ),
        },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(extraPhase.rootWarmChainMs).toBe(4000);
    expect(ssrBudgetsFailed(extraPhase)).toBe(true);
  });

  it("komentarz cytujący withBudget NIE jest wywołaniem", () => {
    const facts = loaderBudgetFacts(
      "src/routes/x.tsx",
      `
export const Route = createFileRoute("/x")({
  loader: async () => {
    // await withBudget(work, HUGE_BUDGET_MS);
    /* await withBudget(work, HUGE_BUDGET_MS); */
    await withBudget(work, REAL_BUDGET_MS);
  },
});
const HUGE_BUDGET_MS = 999_999;
const REAL_BUDGET_MS = 100;
`,
    );
    // Gdyby komentarze się liczyły, chain wyszedłby ponad 2 000 000 ms.
    expect(facts?.budgetSites).toHaveLength(1);
    expect(facts?.chainMs).toBe(100);
  });

  it("napis zawierający Promise.all NIE jest tablicą", () => {
    const facts = loaderBudgetFacts(
      "src/routes/x.tsx",
      `
export const Route = createFileRoute("/x")({
  loader: async () => {
    log("Promise.all([a, b, c, d, e, f, g, h])");
  },
});
`,
    );
    expect(facts?.parallelSites).toHaveLength(0);
    expect(facts?.maxParallelArms).toBe(0);
  });

  it("zachowuje numery linii - podstawia spacje, nie usuwa znaków", () => {
    const src = 'const a = 1; // komentarz\nconst b = "napis";\nconst c = 3;';
    const blanked = blankNonCode(src);
    expect(blanked.split("\n")).toHaveLength(3);
    expect(blanked.split("\n")[2]).toContain("const c = 3;");
  });
});

describe("routeOptionsBlockWide - kotwica, która NIE POMIJA __root.tsx", () => {
  // TO JEST TEST NA KONKRETNĄ PUŁAPKĘ, nie na ogólną poprawność. Repozytorialny
  // `routeOptionsBlock` (publicRouteLoaders.ts) kotwiczy WYŁĄCZNIE na
  // `createFileRoute(...)({`, a `src/routes/__root.tsx` deklaruje się przez
  // `createRootRouteWithContext<...>()({`. Bramka na tamtej kotwicy pomijałaby
  // PLIK, KTÓREGO PILNUJE - i byłaby zielona właśnie dlatego.
  it("znajduje opcje trasy zadeklarowanej przez createRootRouteWithContext", () => {
    expect(routeOptionsBlockWide(ROOT_OK)).not.toBeNull();
    expect(routeOptionsBlockWide(ROOT_OK)).toContain("loader");
  });

  it("znajduje opcje trasy plikowej (createFileRoute)", () => {
    expect(
      routeOptionsBlockWide(
        'export const Route = createFileRoute("/x")({ loader: async () => {} });',
      ),
    ).toContain("loader");
  });

  it("zwraca null dla pliku, który trasą nie jest", () => {
    expect(routeOptionsBlockWide("export function helper() { return 1; }")).toBeNull();
  });
});

describe("numericConstants", () => {
  it("czyta literały z podkreśleniami i z modyfikatorem export", () => {
    const consts = numericConstants("export const A_MS = 2_500;\nconst B_MS = 500;\n");
    expect(consts.get("A_MS")).toBe(2500);
    expect(consts.get("B_MS")).toBe(500);
  });
});

describe("budżet 1 - szeregowana rozgrzewka przed pierwszym bajtem", () => {
  it("ZIELONO na dwóch falach po 2500 + 500", () => {
    const report = analyze();
    expect(report.rootWarmChainMs).toBe(3000);
    expect(ssrBudgetsFailed(report)).toBe(false);
  });

  it("KONTROLA NEGATYWNA: +1 ms do ROOT_WARM_BUDGET_MS OBLEWA bramkę", () => {
    // Dokładnie kryterium odbioru zlecenia wydania 9: „czerwony po sztucznym
    // podniesieniu ROOT_WARM_BUDGET_MS o 1 ms".
    const report = analyzeSsrBudgets({
      sources: [
        {
          file: "src/routes/__root.tsx",
          source: ROOT_OK.replace("2_500", "2_501"),
        },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(report.rootWarmChainMs).toBe(3001);
    expect(ssrBudgetsFailed(report)).toBe(true);
    const rendered = renderSsrBudgetReport(report);
    // Komunikat MUSI mówić, co przekroczono i O ILE - nie „budżet przekroczony".
    expect(rendered).toContain("rootWarmChainMs = 3001 > 3000");
    expect(rendered).toContain("PRZEKROCZONE O 1");
    expect(rendered).toContain("ROOT_WARM_BUDGET_MS=2501");
  });

  it("KONTROLA NEGATYWNA: TRZECIA FALA rozgrzewki OBLEWA bramkę", () => {
    const withThirdWave = ROOT_OK.replace(
      "await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS);",
      "await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS);\n    await withBudget(Promise.allSettled(extraWarm), CHROME_WARM_BUDGET_MS);",
    );
    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: withThirdWave },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(report.rootWarmChainMs).toBe(3500);
    expect(ssrBudgetsFailed(report)).toBe(true);
  });

  it("KONTROLA NEGATYWNA: łańcuch loadera trasy ponad sufit OBLEWA bramkę", () => {
    const report = analyze([
      {
        file: "src/routes/slow.tsx",
        source: `
const A_MS = 7_000;
const B_MS = 7_000;
export const Route = createFileRoute("/slow")({
  loader: async () => {
    await withBudget(one, A_MS);
    await withBudget(two, B_MS);
  },
});
`,
      },
    ]);
    expect(ssrBudgetsFailed(report)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("loaderChainMs = 14000 > 13000");
  });

  it("rozwiązuje budżet IMPORTOWANY z innego modułu (mapa międzyplikowa)", () => {
    // Bez tego budżet dałoby się podnieść w `src/lib/...` i bramka milczałaby.
    const report = analyze([
      {
        file: "src/routes/support.tsx",
        source: `
import { SUPPORT_DOC_BUDGET_MS } from "@/lib/supportRouteConfig";
export const Route = createFileRoute("/support")({
  loader: async () => {
    await withBudget(doc, SUPPORT_DOC_BUDGET_MS);
  },
});
`,
      },
      {
        file: "src/lib/supportRouteConfig.ts",
        source: "export const SUPPORT_DOC_BUDGET_MS = 4_000;",
      },
    ]);
    const support = report.loaders.find((l) => l.file === "src/routes/support.tsx");
    expect(support?.chainMs).toBe(4000);
    expect(report.unmeasurable.join(" ")).not.toContain("SUPPORT_DOC_BUDGET_MS");
  });
});

describe("budżet 2 - równoległe podżądania (limit 6 subrequestów Workers)", () => {
  it("ZIELONO na sześciu odnogach - dokładnie na limicie", () => {
    const report = analyze([
      {
        file: "src/routes/six.tsx",
        source: `
export const Route = createFileRoute("/six")({
  loader: async ({ context }) => {
    await Promise.all([q(1), q(2), q(3), q(4), q(5), q(6)]);
  },
});
`,
      },
    ]);
    const six = report.loaders.find((l) => l.file === "src/routes/six.tsx");
    expect(six?.maxParallelArms).toBe(6);
    expect(ssrBudgetsFailed(report)).toBe(false);
  });

  it("KONTROLA NEGATYWNA: SIÓDMA odnoga OBLEWA bramkę", () => {
    const report = analyze([
      {
        file: "src/routes/seven.tsx",
        source: `
export const Route = createFileRoute("/seven")({
  loader: async () => {
    await Promise.allSettled([q(1), q(2), q(3), q(4), q(5), q(6), q(7)]);
  },
});
`,
      },
    ]);
    expect(ssrBudgetsFailed(report)).toBe(true);
    const rendered = renderSsrBudgetReport(report);
    expect(rendered).toContain("parallelQueriesPerLoader = 7 > 6");
    expect(rendered).toContain("PRZEKROCZONE O 1");
    expect(rendered).toContain("odrzuca 7. subrequest");
  });

  it("wiszący przecinek NIE jest odnogą", () => {
    const facts = loaderBudgetFacts(
      "src/routes/x.tsx",
      `export const Route = createFileRoute("/x")({
  loader: async () => {
    await Promise.all([
      q(1),
      q(2),
    ]);
  },
});`,
    );
    expect(facts?.maxParallelArms).toBe(2);
  });

  it("tablica ZE ZMIENNEJ jest raportowana jako NIEMIERZALNA, a nie jako zero", () => {
    // TO JEST TEST NA CICHY FAŁSZ. `Promise.allSettled(chromeWarm)` policzone
    // jako 0 odnóg wyglądałoby jak „ten loader nic nie zrównolegla" - czyli
    // bramka twierdziłaby coś nieprawdziwego, będąc zieloną.
    const report = analyze();
    expect(report.unmeasurable.join(" | ")).toContain("NIE DA SIĘ ustalić ze źródeł");
    const root = report.loaders.find((l) => l.file === "src/routes/__root.tsx");
    expect(root?.parallelSites.some((s) => s.arms === null)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("NIEMIERZALNE STATYCZNIE");
  });
});

describe("budżet 3 - dehydratowany stan", () => {
  it("ZIELONO, gdy trzy inwarianty są obecne i w poprawnej kolejności", () => {
    const invariants = dehydrationInvariants(ROUTER_OK);
    expect(invariants.every((i) => i.present)).toBe(true);
  });

  it("KONTROLA NEGATYWNA: zniknięcie shouldDehydrateQuery OBLEWA bramkę", () => {
    const broken = ROUTER_OK.replace(
      'shouldDehydrateQuery: (query) => query.state.status === "success",',
      "",
    );
    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: ROOT_OK },
        { file: "src/router.tsx", source: broken },
      ],
    });
    expect(ssrBudgetsFailed(report)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("ZNIKNĄŁ inwariant dehydracji");
  });

  it("KONTROLA NEGATYWNA: zamiatanie PO dehydracji (zła KOLEJNOŚĆ) OBLEWA bramkę", () => {
    // Kolejność jest tu całą treścią inwariantu: `sweepQueryCacheForSerialization`
    // wywołane PO snapshocie integracji nie zmniejsza payloadu ani o bajt,
    // a kod nadal „woła sweep" - więc bramka szukająca samej OBECNOŚCI
    // przepuściłaby tę regresję.
    const reordered = `
const integrationDehydrate = router.options.dehydrate;
router.options.dehydrate = async () => {
  const dehydrated = await integrationDehydrate?.();
  sweepQueryCacheForSerialization(queryClient, { reason: "dehydrate" });
  if (dehydrated?.queryStream) {
    dehydrated.queryStream = guardQueryStream(dehydrated.queryStream, queryClient, {});
  }
  return dehydrated;
};
const opts = { shouldDehydrateQuery: (query) => query.state.status === "success" };
`;
    const invariants = dehydrationInvariants(reordered);
    const sweep = invariants.find((i) => i.name.includes("PRZED dehydracją"));
    expect(sweep?.present).toBe(false);
  });

  it("KONTROLA NEGATYWNA: zniknięcie guardQueryStream OBLEWA bramkę", () => {
    const broken = ROUTER_OK.replace("guardQueryStream(", "identity(");
    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: ROOT_OK },
        { file: "src/router.tsx", source: broken },
      ],
    });
    expect(ssrBudgetsFailed(report)).toBe(true);
  });

  it("KONTROLA NEGATYWNA: zbyt wiele wpisów zasilających dehydrację OBLEWA bramkę", () => {
    const writes = Array.from(
      { length: FROZEN_SSR_BUDGETS.dehydrationWritesPerLoader + 1 },
      (_, i) => `    await context.queryClient.ensureQueryData(q${i});`,
    ).join("\n");
    const report = analyze([
      {
        file: "src/routes/fat.tsx",
        source: `export const Route = createFileRoute("/fat")({\n  loader: async ({ context }) => {\n${writes}\n  },\n});`,
      },
    ]);
    expect(ssrBudgetsFailed(report)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("dehydrationWritesPerLoader = 12 > 11");
  });
});

describe("dziury, które przepuszczały dowolną wartość - naprawione po recenzji Codeksa", () => {
  // TRZY ZNALEZISKA Z RECENZJI PR #327, wszystkie potwierdzone pomiarem PRZED
  // naprawą i wszystkie tej samej klasy: bramka BLOKUJĄCA przechodziła na
  // wejściu, które miała zatrzymać. Każde ma tu kontrolę negatywną, bo bez niej
  // naprawa jest tylko obietnicą.

  it("KONTROLA NEGATYWNA: budżet jako WYRAŻENIE nie może przejść jako zero", () => {
    // ZMIERZONE PRZED NAPRAWĄ: `ROOT_WARM_BUDGET_MS = 2_500 + 1` dawało
    // `rootWarmChainMs = 500` (nierozwiązany budżet liczony jako 0)
    // i `ssrBudgetsFailed() === false`. Czyli budżet dało się podnieść
    // o DOWOLNĄ wartość, byle zapisać go jako wyrażenie - przez bramkę,
    // która ma pilnować dokładnie tej liczby.
    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: ROOT_OK.replace("2_500", "2_500 + 1") },
        { file: "src/router.tsx", source: ROUTER_OK },
      ],
    });
    expect(ssrBudgetsFailed(report)).toBe(true);
    const rendered = renderSsrBudgetReport(report);
    expect(rendered).toContain("nie jest literałem ani stałą liczbową");
    expect(rendered).toContain("policzyłaby go jako ZERO");
  });

  it("KONTROLA NEGATYWNA: ROZWINIĘCIE w tablicy nie może liczyć się jako jedna odnoga", () => {
    // ZMIERZONE PRZED NAPRAWĄ: `Promise.all([fixedQuery(), ...queries])` dawało
    // `arms = 2`. `...queries` może odpalić dowolnie wiele podżądań, więc
    // loader mógł przekroczyć sufit 6, a bramka raportowała 2 i przechodziła.
    const report = analyze([
      {
        file: "src/routes/spread.tsx",
        source: `
export const Route = createFileRoute("/spread")({
  loader: async () => {
    await Promise.all([fixedQuery(), ...queries]);
  },
});
`,
      },
    ]);
    const facts = report.loaders.find((l) => l.file === "src/routes/spread.tsx");
    // NIE 2 - liczby nie da się ustalić.
    expect(facts?.parallelSites[0]?.arms).toBeNull();
    // I to jest DZIURA W NOWYM PLIKU, więc oblewa (allowlist go nie zna).
    expect(ssrBudgetsFailed(report)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("niemierzalna równoległość");
  });

  it("KONTROLA NEGATYWNA: przeniesienie sweepa PO dehydracji oblewa TAKŻE gdy jest import", () => {
    // TO JEST TEST NA WŁASNĄ ATRAPĘ, nie tylko na kod. Poprzednia wersja
    // sprawdzała kolejność na atrapie BEZ importu, więc przechodziła na
    // implementacji, która porównywała pozycję IMPORTU - a na prawdziwym
    // `src/router.tsx` (import w `:13`, wywołanie w `:160`) inwariant był pusty.
    const reordered = `
import { sweepQueryCacheForSerialization } from "./lib/ssr/postRenderSweep";
const opts = { shouldDehydrateQuery: (query) => query.state.status === "success" };
const integrationDehydrate = router.options.dehydrate;
router.options.dehydrate = async () => {
  const dehydrated = await integrationDehydrate?.();
  sweepQueryCacheForSerialization(queryClient, { reason: "dehydrate" });
  if (dehydrated?.queryStream) {
    dehydrated.queryStream = guardQueryStream(dehydrated.queryStream, queryClient, {});
  }
  return dehydrated;
};
`;
    const sweep = dehydrationInvariants(reordered).find((i) => i.name.includes("PRZED dehydracją"));
    expect(sweep?.present).toBe(false);

    const report = analyzeSsrBudgets({
      sources: [
        { file: "src/routes/__root.tsx", source: ROOT_OK },
        { file: "src/router.tsx", source: reordered },
      ],
    });
    expect(ssrBudgetsFailed(report)).toBe(true);
  });

  it("sam IMPORT bez wywołania NIE spełnia inwariantu zamiatania", () => {
    // Granica z drugiej strony: gdyby ktoś usunął wywołanie, zostawiając import,
    // bramka MUSI to zobaczyć.
    const importOnly = `
import { sweepQueryCacheForSerialization } from "./lib/ssr/postRenderSweep";
const opts = { shouldDehydrateQuery: (query) => query.state.status === "success" };
const integrationDehydrate = router.options.dehydrate;
router.options.dehydrate = async () => {
  const dehydrated = await integrationDehydrate?.();
  if (dehydrated?.queryStream) {
    dehydrated.queryStream = guardQueryStream(dehydrated.queryStream, queryClient, {});
  }
  return dehydrated;
};
`;
    const sweep = dehydrationInvariants(importOnly).find((i) =>
      i.name.includes("PRZED dehydracją"),
    );
    expect(sweep?.present).toBe(false);
  });

  it("ZAMROŻONE dziury z loadera korzenia PRZECHODZĄ - bramka nie jest czerwona na wejściu", () => {
    // Dwie tablice ze zmiennej w loaderze korzenia istniały przy powstaniu
    // bramki. Są opisane w `FROZEN_UNMEASURABLE_PARALLEL` i MUSZĄ przechodzić -
    // bramka czerwona na wejściu nie pilnuje niczego, uczy tylko obchodzenia.
    expect(FROZEN_UNMEASURABLE_PARALLEL["src/routes/__root.tsx"]).toBe(2);
    const report = analyze();
    expect(report.unmeasurable.length).toBeGreaterThan(0);
    expect(ssrBudgetsFailed(report)).toBe(false);
  });
});

describe("awaria SKANU nie może być zielonym wynikiem", () => {
  it("brak src/routes/__root.tsx na wejściu OBLEWA bramkę", () => {
    // Bramka, która nie znalazła pliku niosącego budżet (1), nie pilnuje
    // niczego - i musi to powiedzieć, a nie przejść.
    const report = analyzeSsrBudgets({ sources: [{ file: "src/router.tsx", source: ROUTER_OK }] });
    expect(report.rootWarmChainMs).toBeNull();
    expect(ssrBudgetsFailed(report)).toBe(true);
    expect(renderSsrBudgetReport(report)).toContain("nie zmierzyła pliku, którego pilnuje");
  });

  it("plik bez loadera nie wnosi loadera do raportu", () => {
    const report = analyze([
      {
        file: "src/routes/static.tsx",
        source: 'export const Route = createFileRoute("/static")({ component: Page });',
      },
    ]);
    expect(report.loaders.some((l) => l.file === "src/routes/static.tsx")).toBe(false);
    expect(ssrBudgetsFailed(report)).toBe(false);
  });
});

describe("raport", () => {
  it("wypisuje wszystkie cztery zmierzone liczby razem z sufitami", () => {
    const rendered = renderSsrBudgetReport(analyze());
    expect(rendered).toContain("rozgrzewka korzenia");
    expect(rendered).toContain("najdłuższy łańcuch");
    expect(rendered).toContain("równoległe podżądania");
    expect(rendered).toContain("wpisy do dehydracji");
    expect(rendered).toContain("Wszystkie trzy budżety wewnętrzne w sufitach");
  });
});
