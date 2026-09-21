// TEST BRAMKI POLITYKI LOADERÓW TRAS PUBLICZNYCH - z KONTROLĄ NEGATYWNĄ.
//
// PO CO KONTROLA NEGATYWNA, i dlaczego to jest tu najważniejszy rodzaj testu.
// Bramka statyczna ma jedną charakterystyczną awarię: przestaje cokolwiek
// znajdować (kotwica parsera przestaje trafiać, wzorzec przestaje pasować) i od
// tej chwili jest ZIELONA ZAWSZE. Taka awaria nie daje żadnego sygnału - CI
// świeci na zielono, a bramka nie istnieje. Dlatego każda z trzech reguł ma
// tutaj PARĘ przypadków: jeden dowodzący, że poprawne wejście przechodzi,
// i drugi dowodzący, że ZEPSUTE wejście OBLEWA.
//
// WEJŚCIA SĄ ATRAPAMI - świadomie, tak samo jak w `ssrBudgets.test.ts`:
// przedmiotem dowodu jest INWARIANT, czyli reakcja na KSZTAŁT wejścia, a nie
// dzisiejszy stan repozytorium. Stan repozytorium pilnuje OSOBNY blok na dole
// („prawdziwe drzewo tras"), który jest zapadką: dopisuje do dowodu fakt, że
// bramka jest dziś zielona na prawdziwych plikach.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeLoaderPolicy,
  FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL,
  FROZEN_KEY_PARITY_BREAKS,
  FROZEN_UNBUDGETED_NETWORK_LOADERS,
  isPublicRouteFile,
  keyFamily,
  loaderPolicyFacts,
  loaderPolicyFailed,
  renderLoaderPolicyReport,
  type LoaderPolicyReport,
  type LoaderPolicySource,
} from "../loaderPolicy";

/** Wzorcowa trasa publiczna: degraduje, ale SAMA ogłasza politykę cache'u. */
const OK_ROUTE = `
import { createFileRoute } from "@tanstack/react-router";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";

const PROBA_BUDGET_MS = 800;

export const Route = createFileRoute("/proba")({
  loader: async ({ context, params }) => {
    const karta = await loadResilient(
      context.queryClient,
      { queryKey: probaKeys.bySlugViewer(params.slug, null), queryFn: fetchProba },
      null,
      { deadlineAt: Date.now() + PROBA_BUDGET_MS },
    );
    setCacheControlHeader(resilientCacheControl(karta.degraded));
    return { karta: karta.data };
  },
  component: ProbaPage,
});

function ProbaPage() {
  const q = useQuery(probaKeys.bySlugViewer(useParams().slug, null));
  return <div>{q.data}</div>;
}
`;

function analyze(sources: LoaderPolicySource[]): LoaderPolicyReport {
  return analyzeLoaderPolicy({ sources });
}

/**
 * NOWY DŁUG, z pominięciem wpisów „nieodebrana naprawa".
 *
 * Atrapowy zestaw plików nie zawiera tras z zamrożonych list, więc analiza
 * zgłasza dla nich - poprawnie - że wpis nie ma już czego opisywać. To jest
 * inny kierunek zapadki i ma własne przypadki niżej; tutaj przeszkadzałby
 * w odczytaniu wyniku.
 */
function nowyDlug(report: LoaderPolicyReport) {
  return report.violations.filter((v) => v.kind === "nowy-dlug");
}

describe("isPublicRouteFile - dobór plików", () => {
  it("bierze trasy publiczne i pomija gałęzie, które nie są publiczną stroną SSR", () => {
    expect(isPublicRouteFile("src/routes/blog.index.tsx")).toBe(true);
    expect(isPublicRouteFile("src/routes/club.$clubSlug.tsx")).toBe(true);
    expect(isPublicRouteFile("src/routes/$.tsx")).toBe(true);

    expect(isPublicRouteFile("src/routes/admin.billing.tsx")).toBe(false);
    expect(isPublicRouteFile("src/routes/api.public.newsletter.confirm.ts")).toBe(false);
    expect(isPublicRouteFile("src/routes/platform/index.tsx")).toBe(false);
    expect(isPublicRouteFile("src/routes/preview.$token.tsx")).toBe(false);
    expect(isPublicRouteFile("src/lib/ssr/resilientLoad.ts")).toBe(false);
    expect(isPublicRouteFile("src/routes/routeTree.gen.ts")).toBe(false);
    expect(isPublicRouteFile("src/routes/-sitemap.xml.test.ts")).toBe(false);
    expect(isPublicRouteFile("src/routes/__tests__/clubSlugLayoutRoute.test.tsx")).toBe(false);
  });

  it("UKŁAD BEZŚCIEŻKOWY (`_uklad.*`) ZOSTAJE w skanie", () => {
    // Odsiew przedrostka `-` (pliki, które generator tras pomija) nie ma prawa
    // zabrać przy okazji układów bezścieżkowych: to normalne trasy z loaderem.
    // Szersze `[-_]` wyglądało na dzisiejszym drzewie równoważnie - i po cichu
    // wycinałoby całą tę klasę, gdyby ktoś ją wprowadził.
    expect(isPublicRouteFile("src/routes/_uklad.konto.tsx")).toBe(true);
  });

  it("KORZEŃ jest wyłączony ŚWIADOMIE - politykę dokumentu ogłasza trasa liściowa", () => {
    // Loader korzenia degraduje (dwie fale `Promise.allSettled`) i nie ustawia
    // nagłówka. Objęcie go regułą W1 znaczyłoby „korzeń ustala jedną politykę
    // dla całego serwisu, także dla /admin" - czyli coś przeciwnego do
    // doktryny. Bez tego przypadku wyłączenie wyglądałoby jak przeoczenie.
    expect(isPublicRouteFile("src/routes/__root.tsx")).toBe(false);
  });
});

describe("W1 - degradowalny loader ogłasza własny Cache-Control", () => {
  it("poprawna trasa przechodzi", () => {
    const report = analyze([{ file: "src/routes/proba.tsx", source: OK_ROUTE }]);
    expect(nowyDlug(report)).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: zdjęcie `setCacheControlHeader` OBLEWA", () => {
    // Trasa nadal degraduje (`loadResilient` zasiewa fallback i NIE rzuca),
    // ale nie ogłasza już polityki - więc dostanie domyślne `s-maxage=900`
    // z `defaultCacheControlMiddleware` i utrwali niepełny render na brzegu.
    const zepsuta = OK_ROUTE.replace(
      "setCacheControlHeader(resilientCacheControl(karta.degraded));",
      "",
    );
    const report = analyze([{ file: "src/routes/proba.tsx", source: zepsuta }]);

    expect(nowyDlug(report).map((v) => v.rule)).toContain("degradedCacheControl");
    expect(loaderPolicyFailed(report)).toBe(true);
    expect(renderLoaderPolicyReport(report)).toContain("src/routes/proba.tsx");
  });

  it("KONTROLA NEGATYWNA: `.catch(() => null)` bez nagłówka OBLEWA", () => {
    // NAJCZĘSTSZA forma cichej degradacji w tym repozytorium i podpis
    // ustalenia F07 - 42 trasy publiczne z `loader:` bez ani jednego
    // `setCacheControlHeader`.
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    const seo = await context.queryClient.ensureQueryData(probaQueryOptions()).catch(() => null);
    return { seo };
  },
  component: ProbaPage,
});
`;
    const report = analyze([{ file: "src/routes/proba.tsx", source }]);
    expect(nowyDlug(report).map((v) => v.rule)).toContain("degradedCacheControl");
  });

  it("KOMENTARZ cytujący `setCacheControlHeader` NIE ucisza bramki", () => {
    // Wygaszanie komentarzy i treści literałów napisowych (`blankNonCode`) jest
    // warunkiem, żeby bramki nie dało się wyłączyć jednym zdaniem w komentarzu
    // - dokładnie ta klasa obejścia, którą `ssrBudgets.ts` opisuje przy
    // `blankNonCode`.
    const zepsuta = OK_ROUTE.replace(
      "setCacheControlHeader(resilientCacheControl(karta.degraded));",
      '// setCacheControlHeader(resilientCacheControl(karta.degraded));\n    const opis = "setCacheControlHeader(";',
    );
    const report = analyze([{ file: "src/routes/proba.tsx", source: zepsuta }]);
    expect(nowyDlug(report).map((v) => v.rule)).toContain("degradedCacheControl");
  });

  it("trasa z `ssr: false` nie podlega regule - nie ma SSR-owego dokumentu", () => {
    const source = OK_ROUTE.replace(
      'createFileRoute("/proba")({',
      'createFileRoute("/proba")({\n  ssr: false,',
    ).replace("setCacheControlHeader(resilientCacheControl(karta.degraded));", "");
    expect(loaderPolicyFacts("src/routes/proba.tsx", source)).toBeNull();
  });
});

describe("W2 - publiczny loader woła sieć pod budżetem", () => {
  it("`withBudget` domyka regułę", () => {
    const source = `
import { createFileRoute } from "@tanstack/react-router";
const PROBA_BUDGET_MS = 2_000;
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    await withBudget(
      context.queryClient.ensureQueryData(probaQueryOptions()).catch(() => null),
      PROBA_BUDGET_MS,
    );
    setCacheControlHeader(resilientCacheControl(false));
  },
  component: ProbaPage,
});
`;
    const facts = loaderPolicyFacts("src/routes/proba.tsx", source);
    expect(facts?.networkSignals).toContain("ensureQueryData");
    expect(facts?.budgeted).toBe(true);
    expect(nowyDlug(analyze([{ file: "src/routes/proba.tsx", source }]))).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: `ensureQueryData` bez budżetu OBLEWA", () => {
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(probaQueryOptions());
    setCacheControlHeader(contentCacheControl());
  },
  component: ProbaPage,
});
`;
    const report = analyze([{ file: "src/routes/proba.tsx", source }]);
    expect(nowyDlug(report).map((v) => v.rule)).toContain("unbudgetedNetwork");
    expect(loaderPolicyFailed(report)).toBe(true);
  });

  it("`withSsrBudget` domyka regułę tak samo - to ten sam termin, tylko SSR-only", () => {
    // `withSsrBudget` (`src/lib/asyncBudget.ts`) honoruje budżet wyłącznie
    // w renderze serwerowym, bo przy nawigacji SPA wynik loadera jest
    // niezmienny i degradacja „z zegara" zamarzłaby jako fałszywa awaria.
    // Reguła W2 pilnuje CZASU DO PIERWSZEGO BAJTU, czyli dokładnie ścieżki
    // serwerowej - gdyby wzorzec go nie widział, `tracker.index.tsx` oblewałby
    // bramkę mimo dwóch nienaruszonych budżetów.
    const source = `
import { createFileRoute } from "@tanstack/react-router";
const PROBA_BUDGET_MS = 2_000;
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    await withSsrBudget(
      context.queryClient.ensureQueryData(probaQueryOptions()).catch(() => null),
      PROBA_BUDGET_MS,
    );
    setCacheControlHeader(resilientCacheControl(false));
  },
  component: ProbaPage,
});
`;
    const facts = loaderPolicyFacts("src/routes/proba.tsx", source);
    expect(facts?.budgeted).toBe(true);
    // Ta sama zamiana nie ma prawa zgubić flagi „może zdegradować": bez niej
    // reguła W1 przestałaby wymagać własnego `Cache-Control`.
    expect(facts?.canDegrade).toBe(true);
    expect(nowyDlug(analyze([{ file: "src/routes/proba.tsx", source }]))).toEqual([]);
  });

  it("wspólny termin żądania (`deadlineAt`) liczy się jak budżet", () => {
    // Loader, który dostał termin ABSOLUTNY, jedzie pod ograniczeniem czasu,
    // nawet jeśli sam nie woła `withBudget` - taki kształt ma `$.tsx` po
    // ujednoliceniu faz jednym terminem (`lib/ssr/routeSsrDeadline.ts`).
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    const deadlineAt = Date.now() + 1_500;
    await context.queryClient.ensureQueryData({ ...probaQueryOptions(), deadlineAt });
    setCacheControlHeader(contentCacheControl());
  },
  component: ProbaPage,
});
`;
    expect(loaderPolicyFacts("src/routes/proba.tsx", source)?.budgeted).toBe(true);
  });

  it("loader BEZ sieci nie podlega regule - nie ma czego budżetować", () => {
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: () => ({ lang: "pl" }),
  component: ProbaPage,
});
`;
    const facts = loaderPolicyFacts("src/routes/proba.tsx", source);
    expect(facts?.networkSignals).toEqual([]);
    expect(nowyDlug(analyze([{ file: "src/routes/proba.tsx", source }]))).toEqual([]);
  });
});

describe("W4 - parytet kluczy loader/komponent", () => {
  it("rodzina klucza odcina sufiks tożsamości widza", () => {
    expect(keyFamily("clubKeys.bySlugViewer")).toBe(keyFamily("clubKeys.bySlug"));
    expect(keyFamily("publicEventViewerQueryOptions")).toBe(keyFamily("publicEventQueryOptions"));
    // DWA RÓŻNE BYTY, nie rozjazd - gdyby rodzina liczyła się „po wspólnym
    // przedrostku", ta para zapalałaby bramkę fałszywie na `/pricing`.
    expect(keyFamily("billingKeys.plansActive")).not.toBe(keyFamily("billingKeys.mySubscription"));
  });

  it("loader grzejący TEN SAM klucz, który czyta komponent, przechodzi", () => {
    expect(nowyDlug(analyze([{ file: "src/routes/proba.tsx", source: OK_ROUTE }]))).toEqual([]);
  });

  it("KONTROLA NEGATYWNA: `bySlug` w loaderze i `bySlugViewer` w komponencie OBLEWA", () => {
    // Dokładnie defekt F09: czternaście tras `/club/$clubSlug/**` robiło pełny
    // round-trip do `club_view` przed pierwszym bajtem, którego wynik zasilał
    // wyłącznie `head()`, bo komponent czytał klucz Z WIDZEM.
    const zepsuta = OK_ROUTE.replace(
      "queryKey: probaKeys.bySlugViewer(params.slug, null)",
      "queryKey: probaKeys.bySlug(params.slug)",
    );
    const report = analyze([{ file: "src/routes/proba.tsx", source: zepsuta }]);

    const hit = nowyDlug(report).find((v) => v.rule === "keyParity");
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("probaKeys.bySlug");
    expect(hit?.detail).toContain("probaKeys.bySlugViewer");
    expect(loaderPolicyFailed(report)).toBe(true);
  });

  it("KONTROLA NEGATYWNA: ten sam rozjazd na fabrykach `*QueryOptions` OBLEWA", () => {
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    await withBudget(context.queryClient.ensureQueryData(probaQueryOptions()), 1_000);
    setCacheControlHeader(contentCacheControl());
  },
  component: ProbaPage,
});
function ProbaPage() {
  const q = useSuspenseQuery(probaViewerQueryOptions());
  return <div>{q.data}</div>;
}
`;
    expect(
      nowyDlug(analyze([{ file: "src/routes/proba.tsx", source }])).map((v) => v.rule),
    ).toContain("keyParity");
  });

  it("dwie RÓŻNE rodziny w jednym pliku nie są rozjazdem", () => {
    // Zawężenie reguły do sufiksu widza jest tym, co odróżnia ją od bramki
    // krzyczącej na każdą trasę, która czyta więcej kluczy, niż grzeje.
    const source = `
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/proba")({
  loader: async ({ context }) => {
    await withBudget(context.queryClient.ensureQueryData(billingKeys.plansActive), 1_000);
    setCacheControlHeader(contentCacheControl());
  },
  component: ProbaPage,
});
function ProbaPage() {
  const q = useQuery(billingKeys.mySubscription);
  return <div>{q.data}</div>;
}
`;
    expect(nowyDlug(analyze([{ file: "src/routes/proba.tsx", source }]))).toEqual([]);
  });
});

describe("zapadka: zamrożone listy wolno wyłącznie skracać", () => {
  it("lista W4 jest PUSTA - każdy rozjazd klucza oblewa", () => {
    // Pusty rekord jest treścią, a nie brakiem treści: czternaście tras
    // klubowych naprawiono JEDNYM loaderem układu, zamiast wpisywać je tutaj.
    expect(Object.keys(FROZEN_KEY_PARITY_BREAKS)).toEqual([]);
  });

  it("każdy zamrożony wyjątek niesie POWÓD, a nie samą nazwę pliku", () => {
    // Wpis bez uzasadnienia zamienia listę wyjątków w listę życzeń.
    for (const [plik, powod] of [
      ...Object.entries(FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL),
      ...Object.entries(FROZEN_UNBUDGETED_NETWORK_LOADERS),
    ]) {
      expect(plik.startsWith("src/routes/"), plik).toBe(true);
      expect(powod.length, plik).toBeGreaterThan(30);
    }
  });

  it("NIEODEBRANA NAPRAWA oblewa - inaczej wpis zostawia wolny slot", () => {
    // Sekwencja, którą ten warunek zamyka: PR A naprawia trasę (bramka
    // zielona, nikt nie zdejmuje wpisu), PR B psuje ją z powrotem - i trasa
    // DOPASOWUJE SIĘ do nieaktualnego wpisu, więc regresja przechodzi.
    // Fixture: JEDYNY wpis pozostały na liście W1 (`checkout.success.tsx`) -
    // po spłaceniu `support`/`contribute` 2026-09-20 lista ma jeden element,
    // więc dowód „nieodebranej naprawy" jedzie na nim.
    const naprawiona = OK_ROUTE;
    const report = analyze([
      { file: "src/routes/checkout.success.tsx", source: naprawiona },
      { file: "src/routes/proba.tsx", source: OK_ROUTE },
    ]);

    const hit = report.violations.find(
      (v) => v.file === "src/routes/checkout.success.tsx" && v.kind === "nieodebrana-naprawa",
    );
    expect(hit).toBeDefined();
    expect(loaderPolicyFailed(report)).toBe(true);
    expect(renderLoaderPolicyReport(report)).toContain("NIEODEBRANA NAPRAWA");
  });

  it("PUSTY SKAN to awaria parsera, nie zielony wynik", () => {
    // Bramka, która nie widzi ANI JEDNEGO loadera trasy publicznej, nie pilnuje
    // niczego - a wygląda dokładnie tak samo jak bramka przechodząca.
    const report = analyze([]);
    expect(report.loaders).toEqual([]);
    expect(loaderPolicyFailed(report)).toBe(true);
    expect(renderLoaderPolicyReport(report)).toContain("zepsuta kotwica parsera");
  });
});

// ---------------------------------------------------------------------------
// PRAWDZIWE DRZEWO TRAS
// ---------------------------------------------------------------------------
//
// Atrapy dowodzą, że reguły REAGUJĄ; ten blok dowodzi, że reagują TU I TERAZ,
// na plikach w repozytorium. Bez niego bramka mogłaby być zielona w CI i
// czerwona na atrapach (albo odwrotnie) i nikt by tego nie zestawił - ten sam
// rozjazd, dla którego sufity zimnych tras zostały wyniesione z runnera do
// modułu (`publicRouteLoaders.ts`, „RATCHET PER TRASA").

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function realTree(): LoaderPolicyReport {
  const sources = walk("src/routes")
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => ({ file: file.replaceAll("\\", "/"), source: readFileSync(file, "utf8") }));
  return analyzeLoaderPolicy({ sources });
}

describe("polityka loaderów na prawdziwym drzewie tras", () => {
  it("bramka jest ZIELONA na dzisiejszym drzewie", { timeout: 60_000 }, () => {
    const report = realTree();
    expect(renderLoaderPolicyReport(report)).toContain("✓");
    expect(loaderPolicyFailed(report)).toBe(false);
  });

  it("skan NAPRAWDĘ widzi loadery tras publicznych", { timeout: 60_000 }, () => {
    // Liczba kontrolna martwego parsera. ZMIERZONE 2026-09-20: 66 publicznych
    // loaderów. Próg jest luźny z premedytacją - przedmiotem dowodu jest „skan
    // żyje", a nie dzisiejsza liczba tras.
    expect(realTree().loaders.length).toBeGreaterThan(40);
  });
});
