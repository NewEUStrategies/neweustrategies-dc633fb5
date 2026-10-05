// PUBLICZNY RENDERER: STRUMIENIOWANIE, OKNO „NAD ZGIĘCIEM", GRANICE SUSPENSE
// I CO SIĘ DZIEJE PRZY BRAKU DANYCH ŹRÓDŁOWYCH.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * KANDYDAT LCP STRONY (P1.4) - PRZEPISANE ŚWIADOMIE. Dawniej każda z trzech
//   czołowych sekcji oznaczała swój pierwszy obraz `eager` + `high`
//   (`["eager","eager","eager","lazy","lazy"]`), co na fixture `/` dawało 9
//   obrazów High. Teraz tylko renderer-właściciel (`lcpOwner`) wyznacza
//   kandydata (`lcpCandidates`): DOKŁADNIE jeden obraz eager + high
//   + `data-lcp-candidate`, reszta leniwa; renderer bez `lcpOwner` (powłoka,
//   popup, kanwa) nie ma kandydata wcale. Okno `aboveFoldCount` (domyślnie
//   `ABOVE_FOLD_SECTION_COUNT`) zawęża skan kandydata. Dowód SSR: preload
//   z trasy (`usePreloadLcpImages`) i `<img>` kandydata dają JEDEN `<link>`.
//   Kandydat liczy reguły `advanced.access` TYM SAMYM kontekstem co renderer
//   (sesja - atrapa `useAuth` niżej; recenzja P1.4, B1): znacznik jest
//   zawsze na obrazie, który renderer maluje, a preload loadera (liczony dla
//   gościa) nie idzie do dokumentu renderowanego z innym kontekstem.
//   KANDYDATÓW LICZY TYLKO SERWER (runda 9, `check:bundle`): SSR zapisuje ich
//   na korzeniu (`data-lcp-root` + `data-lcp-ids`), hydratacja odczytuje je
//   z DOM-u, a render czysto kliencki nie ma kandydata. Dowód: pełna ścieżka
//   `renderToString` (atrapa `isServer` = prawda) -> `hydrateRoot` bez
//   rozjazdu, licznik wywołań `lcpCandidateIds` (tylko serwer) i kontrola
//   negatywna (HTML bez nośnika = rozjazd zgłoszony przez Reacta),
// * `stream` włączone i wyłączone dla sekcji ZALEŻNEJ OD DANYCH i dla statycznej
//   - z dowodem, że na ścieżce KLIENCKIEJ treść jest identyczna,
// * brak danych źródłowych: widget listy wpisów z pustą odpowiedzią Supabase
//   nie wywraca sekcji ani strony,
// * granica `Suspense` renderera (L655) w stanie OCZEKIWANIA i po rozwiązaniu
//   - łącznie z tym, że jej `fallback={null}` NIE REZERWUJE ANI PIKSELA,
// * granica błędu wokół sekcji: uszkodzony `layout.htmlTag` wywraca render
//   JEDNEJ sekcji, a nie strony.
//
// ── TWARDE OGRANICZENIA ŚRODOWISKA (nie do obejścia, do udokumentowania) ───
// 1. `import.meta.env.SSR` jest w vitest FAŁSZEM, więc `ServerSectionGate`
//    NIGDY nie montuje się przez `<StreamingSection>` - klient dostaje dzieci
//    bez bramki. Bramka ma własny dowód, montowany BEZPOŚREDNIO, w
//    `src/lib/builder/__tests__/sectionStreaming.test.tsx:58-113`. Tutaj mierzymy
//    to, co widzi PRZEGLĄDARKA, i pilnujemy, że strumieniowanie nie zmienia
//    HTML-a na tej ścieżce.
// 2. Z punktu 1 wynika, że szkielet `SectionStreamSkeleton` (280 px `minHeight`)
//    jest z `BuilderRenderer` nieosiągalny - nic nie zawiesza granicy na
//    kliencie. Dlatego pomiar rezerwy miejsca robimy na trzech faktach:
//    szkielet strumienia rezerwuje 280 px NIEZALEŻNIE od realnej wysokości
//    sekcji (patrz `sectionStreaming.test.tsx:51-55`), granica renderera
//    rezerwuje ZERO, a na kliencie żaden z tych fallbacków się nie pokazuje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, lazy, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  LcpCandidatesProvider,
  usePreloadLcpImages,
  type LcpImagePreload,
} from "@/lib/builder/aboveFold";
import "@/test/i18nReal";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import { shouldStreamSection } from "@/lib/builder/sectionStreaming";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { EmptyContainerPickerBoxProps } from "../BuilderRenderer";
import { BuilderEmptyPickerProvider, BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  gate,
  section,
  simpleSection,
  stubObservers,
  tabsConfig,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// ŚRODOWISKO RENDERU. `isServer` z router-core rozstrzyga gałąź kandydata LCP
// (serwer liczy, klient czyta nośnik z DOM-u) i hooka preloadu. Pod vitestem
// moduł daje `undefined` (klient); `ssr()` niżej przełącza na serwer na czas
// `renderToString`.
const env = vi.hoisted(() => ({ server: false }));
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return env.server;
  },
}));

// Licznik wywołań `lcpCandidateIds` - dowód, że liczy wyłącznie serwer.
const lcp = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/builder/lcpCandidate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/lcpCandidate")>();
  return {
    ...actual,
    lcpCandidateIds: (...args: Parameters<typeof actual.lcpCandidateIds>) => {
      lcp.calls += 1;
      return actual.lcpCandidateIds(...args);
    },
  };
});

// SESJA CZYTELNIKA. Domyślnie `null` - prawdziwy `useAuth` (wartość domyślna
// kontekstu = gość, czyli stan renderu publicznego). Testy kandydata dla
// ZALOGOWANEGO ustawiają sesję; reszta pliku nie widzi żadnej zmiany.
const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  return {
    ...actual,
    useAuth: () => {
      const base = actual.useAuth();
      return auth.session
        ? { ...base, session: auth.session, user: auth.session.user, loading: false }
        : base;
    },
  };
});

// GRANICA SYSTEMU, nie warstwa pod testem: widget listy wpisów czyta dane przez
// react-query z Supabase. Atrapa oddaje pusty zbiór, więc test mierzy ścieżkę
// „brak danych źródłowych" bez sieci.
vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "or",
    "filter",
    "contains",
    "overlaps",
    "match",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  };
});

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  vi.restoreAllMocks();
  auth.session = null;
});

/** Sekcja z JEDNYM obrazem - priorytet ładowania zdradza kandydata LCP. */
const sekcjaZObrazem = (id: string, src = "https://example.org/obraz.png") =>
  section(id, [
    column(`${id}-c`, [
      widget(`${id}-img`, "image", {
        content: { src, alt_pl: `Obraz ${id}` },
      }),
    ]),
  ]);

/** Sekcja zależna od danych (lista wpisów) - jedyny rodzaj, który strumieniuje. */
const sekcjaZDanymi = (id: string) =>
  section(id, [column(`${id}-c`, [widget(`${id}-lista`, "post-list", { content: {} })])]);

const priorytety = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((img) => img.getAttribute("loading"));

const kandydaci = (root: ParentNode) => root.querySelectorAll("img[data-lcp-candidate]");

/** Świeży klient react-query - SSR i hydratacja mają osobne, jak w przeglądarce. */
const nowyKlient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * Render SERWEROWY: `isServer` = prawda (gałąź serwerowa renderera i hooka
 * preloadu, jak w workerze), `renderToString` jak Fizz bez strumienia.
 */
function ssr(ui: ReactElement): string {
  env.server = true;
  try {
    return renderToString(<QueryClientProvider client={nowyKlient()}>{ui}</QueryClientProvider>);
  } finally {
    env.server = false;
  }
}

/** HTML serwera jako odłączony DOM - do asercji bez hydratacji. */
function ssrDom(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = ssr(ui);
  return host;
}

const korzen = (root: ParentNode) => root.querySelector<HTMLElement>("[data-builder-renderer]");

interface Hydrated {
  readonly host: HTMLElement;
  /** Błędy odzyskiwalne hydratacji (`onRecoverableError`) - rozjazd treści. */
  readonly recoverable: unknown[];
  /** `console.error` o rozjeździe hydratacji (React 19 dev: atrybuty „didn't match"). */
  readonly mismatches: string[];
}

const hydratedRoots: Array<{ root: Root; host: HTMLElement }> = [];

/** Jeden dokument naraz, jak w przeglądarce: `useId()` jest unikalne w obrębie korzenia. */
async function unmountHydrated() {
  for (const { root, host } of hydratedRoots.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
}

afterEach(unmountHydrated);

/**
 * Pierwsza wizyta: HTML serwera w DOM-ie, potem `hydrateRoot` po stronie
 * klienta (`isServer` = fałsz). `przedHydratacja` psuje HTML serwera
 * (kontrola negatywna).
 */
async function hydrated(
  ui: ReactElement,
  przedHydratacja?: (host: HTMLElement) => void,
): Promise<Hydrated> {
  await unmountHydrated();
  const host = document.createElement("div");
  host.innerHTML = ssr(ui);
  document.body.append(host);
  przedHydratacja?.(host);
  const recoverable: unknown[] = [];
  const mismatches: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/hydrat|didn't match/i.test(text)) mismatches.push(text);
  });
  try {
    const root = hydrateRoot(
      host,
      <QueryClientProvider client={nowyKlient()}>{ui}</QueryClientProvider>,
      { onRecoverableError: (error) => recoverable.push(error) },
    );
    hydratedRoots.push({ root, host });
    await act(async () => {});
  } finally {
    spy.mockRestore();
  }
  return { host, recoverable, mismatches };
}

/** Hydratacja bez rozjazdu: ani błędu odzyskiwalnego, ani ostrzeżenia o atrybutach. */
function expectCleanHydration(view: Hydrated) {
  expect(view.recoverable).toEqual([]);
  expect(view.mismatches).toEqual([]);
}

describe("kandydat LCP strony (lcpOwner, P1.4)", () => {
  it("renderer BEZ lcpOwner (nagłówek, stopka, popup) nie ma kandydata - każdy obraz leniwy", async () => {
    const view = await hydrated(
      <BuilderRenderer doc={doc([0, 1, 2].map((i) => sekcjaZObrazem(`s${i}`)))} lang="pl" />,
    );
    expect(priorytety(view.host)).toEqual(["lazy", "lazy", "lazy"]);
    expect(kandydaci(view.host)).toHaveLength(0);
    for (const img of view.host.querySelectorAll("img"))
      expect(img.getAttribute("fetchpriority")).toBe("auto");
    expect(korzen(view.host)?.hasAttribute("data-lcp-ids")).toBe(false);
    expectCleanHydration(view);
  });

  it("renderer-właściciel: DOKŁADNIE jeden obraz eager + high + data-lcp-candidate, także po hydratacji", async () => {
    expect(ABOVE_FOLD_SECTION_COUNT).toBe(3);
    const view = await hydrated(
      <BuilderRenderer
        doc={doc([0, 1, 2, 3, 4].map((i) => sekcjaZObrazem(`s${i}`)))}
        lang="pl"
        lcpOwner
      />,
    );
    // Dawniej: ["eager","eager","eager","lazy","lazy"] - trzy obrazy High.
    expect(priorytety(view.host)).toEqual(["eager", "lazy", "lazy", "lazy", "lazy"]);
    const [kandydat] = kandydaci(view.host);
    expect(kandydaci(view.host)).toHaveLength(1);
    expect(kandydat.getAttribute("fetchpriority")).toBe("high");
    expect(kandydat.getAttribute("alt")).toBe("Obraz s0");
    expectCleanHydration(view);
  });

  it("SSR zapisuje kandydatów na korzeniu, hydratacja czyta je z DOM-u - klient NIE liczy `lcpCandidates`", async () => {
    // Dowód celu rundy 9: kod `lcpCandidates` nie jest potrzebny w przeglądarce.
    // Serwer liczy raz, klient odtwarza wynik z `data-lcp-ids` po `useId()`.
    lcp.calls = 0;
    const view = await hydrated(
      <BuilderRenderer
        doc={doc([sekcjaZObrazem("s0"), sekcjaZObrazem("s1")])}
        lang="pl"
        lcpOwner
      />,
    );
    expect(lcp.calls).toBe(1);
    const root = korzen(view.host);
    expect(root?.getAttribute("data-lcp-ids")).toBe("s0-img");
    expect(root?.getAttribute("data-lcp-root")).toBeTruthy();
    expect(kandydaci(view.host)).toHaveLength(1);
    expectCleanHydration(view);
  });

  it("render czysto kliencki (nawigacja SPA): właściciel bez kandydata i bez nośnika", () => {
    // Bez HTML-u serwera nie ma czego odczytać. Każdy obraz jest leniwy - obraz
    // i tak powstaje dopiero z DOM-u wstawionego przez JS, więc preload ani
    // `fetchpriority` nie wyprzedzą skanera (go tu nie ma).
    lcp.calls = 0;
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner />,
    );
    expect(kandydaci(container)).toHaveLength(0);
    expect(priorytety(container)).toEqual(["lazy"]);
    expect(korzen(container)?.hasAttribute("data-lcp-ids")).toBe(false);
    expect(lcp.calls).toBe(0);
  });

  it("KONTROLA NEGATYWNA: HTML serwera bez nośnika - klient gubi kandydata, a React zgłasza rozjazd", async () => {
    // Parytet trzyma WYŁĄCZNIE nośnik: bez `data-lcp-ids` klient renderuje
    // obraz leniwy bez znacznika, a serwer namalował eager/high ze znacznikiem.
    // Ten sam detektor, który w testach wyżej milczy, tu musi zadziałać.
    const view = await hydrated(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner />,
      (host) => {
        korzen(host)?.removeAttribute("data-lcp-ids");
        korzen(host)?.removeAttribute("data-lcp-root");
      },
    );
    expect(view.mismatches.length + view.recoverable.length).toBeGreaterThan(0);
  });

  it("cienka sekcja tekstowa nad hero: kandydatem jest obraz sekcji 1", async () => {
    const view = await hydrated(
      <BuilderRenderer
        doc={doc([simpleSection("tytul"), sekcjaZObrazem("hero"), sekcjaZObrazem("dalej")])}
        lang="pl"
        lcpOwner
      />,
    );
    expect(priorytety(view.host)).toEqual(["eager", "lazy"]);
    expect(kandydaci(view.host)[0]?.getAttribute("alt")).toBe("Obraz hero");
    expectCleanHydration(view);
  });

  it("okno skanu: domyślnie 3 sekcje, `aboveFoldCount` je zawęża, 0 wyłącza", () => {
    const tekst = [0, 1, 2].map((i) => simpleSection(`t${i}`));
    const poza = ssrDom(
      <BuilderRenderer doc={doc([...tekst, sekcjaZObrazem("s3")])} lang="pl" lcpOwner />,
    );
    expect(kandydaci(poza)).toHaveLength(0);
    const waskie = ssrDom(
      <BuilderRenderer
        doc={doc([simpleSection("t"), sekcjaZObrazem("s1")])}
        lang="pl"
        lcpOwner
        aboveFoldCount={1}
      />,
    );
    expect(priorytety(waskie)).toEqual(["lazy"]);
    const zerowe = ssrDom(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner aboveFoldCount={0} />,
    );
    expect(priorytety(zerowe)).toEqual(["lazy"]);
    expect(zerowe.querySelector("img")?.getAttribute("fetchpriority")).toBe("auto");
  });

  it("zagnieżdżony renderer BEZ lcpOwner nie dziedziczy kandydatów rodzica", () => {
    // Kandydaci renderera-właściciela wiszą w kontekście. Renderer powłoki
    // (np. popup otwarty nad treścią) ustawia własną, pustą listę - inaczej
    // widget o tym samym id dostałby priorytet i drugi znacznik na stronie.
    const html = ssrDom(
      <LcpCandidatesProvider widgetIds={["s0-img"]}>
        <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" />
      </LcpCandidatesProvider>,
    );
    expect(kandydaci(html)).toHaveLength(0);
    expect(priorytety(html)).toEqual(["lazy"]);
  });

  it("sesja z regułą „tylko dla gości” w sekcji 0: znacznik na obrazie, który renderer MALUJE (B1)", async () => {
    // Kandydat liczy reguły dostępu kontekstem renderu - tym samym, którym
    // `SectionsList` filtruje sekcje. W produkcji SSR jest anonimowy; atrapa
    // sesji dowodzi, że kandydat nie rozjedzie się z malowanym drzewem przy
    // żadnym kontekście (dawniej: kandydat w niemalowanej sekcji promo).
    const dokument = doc([
      section("promo", sekcjaZObrazem("promo").children, { advanced: gate({ auth: "guest" }) }),
      sekcjaZObrazem("hero"),
    ]);
    const gosc = await hydrated(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(gosc.host)[0]?.getAttribute("alt")).toBe("Obraz promo");
    expectCleanHydration(gosc);
    auth.session = { user: { id: "u-1" } };
    const view = await hydrated(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(view.host.querySelector('[data-sec-id="promo"]')).toBeNull();
    expect(kandydaci(view.host)).toHaveLength(1);
    expect(kandydaci(view.host)[0].getAttribute("alt")).toBe("Obraz hero");
    expect(priorytety(view.host)).toEqual(["eager"]);
    expectCleanHydration(view);
  });

  it("sesja widzi hero „tylko dla zalogowanych” i to on jest kandydatem; gość - następna sekcja", () => {
    const dokument = doc([
      section("dla-czlonkow", sekcjaZObrazem("dla-czlonkow").children, {
        advanced: gate({ auth: "user" }),
      }),
      sekcjaZObrazem("dla-wszystkich"),
    ]);
    const gosc = ssrDom(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(gosc)[0]?.getAttribute("alt")).toBe("Obraz dla-wszystkich");
    auth.session = { user: { id: "u-1" } };
    const zalogowany = ssrDom(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(priorytety(zalogowany)).toEqual(["eager", "lazy"]);
    // (Nie „dla-zalogowanych”: alt z „logo” wyklucza obraz heurystyką logo.)
    expect(kandydaci(zalogowany)[0]?.getAttribute("alt")).toBe("Obraz dla-czlonkow");
  });

  it("widget z regułą dostępu nie jest kandydatem - priorytet dostaje malowany sąsiad", () => {
    const dokument = doc([
      section("s0", [
        column("s0-c", [
          widget("s0-ukryty", "image", {
            content: { src: "https://example.org/ukryty.png", alt_pl: "Ukryty" },
            advanced: gate({ auth: "user" }),
          }),
          widget("s0-widoczny", "image", {
            content: { src: "https://example.org/widoczny.png", alt_pl: "Widoczny" },
          }),
        ]),
      ]),
    ]);
    const html = ssrDom(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(html)).toHaveLength(1);
    expect(kandydaci(html)[0].getAttribute("alt")).toBe("Widoczny");
  });

  it("kanwa buildera (editorPreview) nie wyznacza kandydata nawet z lcpOwner", () => {
    const html = ssrDom(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner editorPreview />,
    );
    expect(kandydaci(html)).toHaveLength(0);
    expect(korzen(html)?.hasAttribute("data-lcp-ids")).toBe(false);
  });
});

/**
 * Render SERWEROWY strony: trasa woła `usePreloadLcpImages` (jak `index.tsx`
 * i `$.tsx`), a pod nią renderuje się kanwa z kandydatem.
 */
function ssrPage(preloads: LcpImagePreload[], content: ReactElement): string {
  function Trasa() {
    usePreloadLcpImages(preloads);
    return content;
  }
  return ssr(<Trasa />);
}

const imagePreloadLinks = (html: string) =>
  html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? [];

describe("SSR: jedno źródło preloadu obrazu LCP (werdykt LP-2)", () => {
  const STORAGE = "https://p.supabase.co/storage/v1/object/public/covers/hero.jpg";

  it("preload z trasy i automatyczny preload `<img>` kandydata to JEDEN `<link>`", () => {
    // Ten sam klucz zasobu (bez srcSet: `href`) - React nie emituje drugiego.
    // Dawniej trasa dokładała osobny `<link>` z `head()`, a React drugi z `<img>`.
    const src = "https://example.org/ssr-hero.png";
    const html = ssrPage(
      [{ href: src }],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", src)])} lang="pl" lcpOwner />,
    );
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${src}"`);
    expect(links[0]).toMatch(/fetchPriority="high"/i);
    expect(html.match(/data-lcp-candidate/g)).toHaveLength(1);
  });

  it("obraz responsywny: preload ma TEN SAM imagesrcset i imagesizes co `<img>` kandydata", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" lcpOwner />,
    );
    const img = /<img[^>]*data-lcp-candidate[^>]*>/.exec(html)?.[0] ?? "";
    const srcset = /srcSet="([^"]+)"/i.exec(img)?.[1];
    const sizes = /sizes="([^"]+)"/.exec(img)?.[1];
    expect(srcset).toContain("/storage/v1/render/image/public/");
    const [link] = imagePreloadLinks(html);
    expect(link).toContain(`imageSrcSet="${srcset}"`);
    expect(link).toContain(`imageSizes="${sizes}"`);
  });

  it("KONTROLA NEGATYWNA: preload o innych `sizes` niż `<img>` daje DWA linki", () => {
    // Dowód, że jedność zależy od klucza `srcSet\nsizes`, a nie od szczęścia:
    // deskryptor z innym `imageSizes` to inny zasób - przeglądarka pobrałaby
    // wtedy dwa warianty obrazu LCP.
    const html = ssrPage(
      [{ href: STORAGE, imageSrcSet: `${STORAGE}?w=1 1w`, imageSizes: "1px" }],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" lcpOwner />,
    );
    expect(imagePreloadLinks(html)).toHaveLength(2);
  });

  it("strona bez obrazu w oknie: ani kandydata, ani preloadu obrazu", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([simpleSection("a"), simpleSection("b")])} lang="pl" lcpOwner />,
    );
    expect(html).not.toContain("data-lcp-candidate");
    expect(html).not.toContain("data-lcp-ids");
    expect(imagePreloadLinks(html)).toHaveLength(0);
  });

  it("dwóch kandydatów: preload każdego z `media` urządzenia, nadal JEDEN link na kandydata", () => {
    // Desktop: większa kolumna 8/12; telefon: kolumna z order.mobile 1. Preload
    // z `media` dzieli klucz zasobu z `<img>`, więc React nie dokłada drugiego.
    const maly = "https://example.org/maly.png";
    const duzy = "https://example.org/duzy.png";
    const dokument = doc([
      section("s0", [
        column("s0-maly", [widget("w-maly", "image", { content: { src: maly, alt_pl: "Mały" } })], {
          span: { desktop: 4 },
          order: { mobile: 1 },
        }),
        column("s0-duzy", [widget("w-duzy", "image", { content: { src: duzy, alt_pl: "Duży" } })], {
          span: { desktop: 8 },
          order: { mobile: 2 },
        }),
      ]),
    ]);
    const html = ssrPage(
      [
        { href: duzy, media: "(min-width: 768px)" },
        { href: maly, media: "(max-width: 767px)" },
      ],
      <BuilderRenderer doc={dokument} lang="pl" lcpOwner />,
    );
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.includes(duzy))).toContain('media="(min-width: 768px)"');
    expect(links.find((l) => l.includes(maly))).toContain('media="(max-width: 767px)"');
    expect(html.match(/data-lcp-candidate/g)).toHaveLength(2);
    // Nośnik do hydratacji: obaj kandydaci, najpierw desktopowy.
    expect(html).toContain('data-lcp-ids="w-duzy w-maly"');
  });

  it("sesja w renderze: preload loadera (liczony dla gościa) nie trafia do dokumentu - tylko `<img>` kandydata", () => {
    // Loader nie zna sesji (SSR jest anonimowy z konstrukcji). Sekcja promo
    // jest „tylko dla gości”: gdyby render miał inny kontekst niż gość, preload
    // jej obrazu byłby pobraniem z High czegoś, czego renderer nie maluje.
    const promo = "https://example.org/promo.png";
    const hero = "https://example.org/hero.png";
    const dokument = doc([
      section("promo", sekcjaZObrazem("promo", promo).children, {
        advanced: gate({ auth: "guest" }),
      }),
      sekcjaZObrazem("hero", hero),
    ]);
    auth.session = { user: { id: "u-1" } };
    const html = ssrPage([{ href: promo }], <BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    const links = imagePreloadLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${hero}"`);
    expect(html).not.toContain(promo);
  });

  it("renderer BEZ lcpOwner nie emituje preloadu obrazu (obrazy leniwe)", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0", STORAGE)])} lang="pl" />,
    );
    expect(imagePreloadLinks(html)).toHaveLength(0);
    expect(html).toContain('loading="lazy"');
  });

  it("na kliencie hook trasy nie emituje preloadu - link przyszedł w HTML-u serwera", () => {
    // Loader liczy preloady tylko na serwerze, a przy hydratacji link już stoi
    // w `<head>`; gałąź `isServer` wycina kod preloadu z bundla klienta.
    const href = "https://example.org/tylko-serwer.png";
    function Trasa() {
      usePreloadLcpImages([{ href }]);
      return null;
    }
    renderWithQueryClient(<Trasa />);
    expect(document.head.querySelector(`link[rel="preload"][href="${href}"]`)).toBeNull();
  });
});

describe("strumieniowanie sekcji na ścieżce KLIENCKIEJ", () => {
  const dokument = doc([
    simpleSection("statyczna"),
    sekcjaZDanymi("dane-1"),
    sekcjaZDanymi("dane-2"),
    sekcjaZDanymi("dane-3"),
    sekcjaZDanymi("dane-4"),
  ]);

  it("decyzja eager/stream jest czystą funkcją dokumentu, nie renderu", () => {
    // Ten sam predykat, którego używa `StreamingSection`. Sekcja statyczna nie
    // strumieniuje NIGDY; każda sekcja z danymi ma bramkę przy włączonym
    // `stream`, także gdy prefetch pierwszego ekranu przekroczył budżet.
    const statyczna = dokument.sections[0];
    const zDanymi = dokument.sections[4];
    expect(shouldStreamSection(statyczna, "pl", true)).toBe(false);
    expect(shouldStreamSection(zDanymi, "pl", true)).toBe(true);
    expect(shouldStreamSection(zDanymi, "pl", false)).toBe(false);
  });

  it.each([false, true])("stream=%s daje IDENTYCZNY zestaw sekcji w DOM", (stream) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream={stream} />,
    );
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["statyczna", "dane-1", "dane-2", "dane-3", "dane-4"]);
    // Na kliencie żaden szkielet strumienia się nie pokazuje: `import.meta.env.SSR`
    // jest fałszem, więc bramka serwerowa nie montuje się i nic nie zawiesza
    // granicy. To jest właśnie brak CLS na tej ścieżce.
    expect(container.querySelector("[data-section-stream-skeleton]")).toBeNull();
  });

  it("włączony stream nie gubi treści sekcji poniżej zgięcia", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream aboveFoldCount={0} />,
    );
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(5);
    expect(container.querySelector('[data-sec-id="dane-4"]')).not.toBeNull();
  });
});

describe("brak danych źródłowych", () => {
  it("lista wpisów z pustą odpowiedzią renderuje sekcję i nie wywraca strony", async () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZDanymi("lista"), simpleSection("sasiad")])} lang="pl" />,
    );
    // Oddaj pętlę zdarzeń zapytaniom react-query.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-sec-id="lista"]')).not.toBeNull();
    expect(container.querySelector('[data-sec-id="sasiad"]')).not.toBeNull();
    expect(container.querySelector("[data-render-error]")).toBeNull();
    expect(container.textContent).toContain("T-sasiad-w");
  });

  it("sekcja z widgetem danych i BEZ kolumn nadal renderuje swoją powłokę", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("pusta", [])])} lang="pl" stream />,
    );
    expect(container.querySelector('[data-sec-id="pusta"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(0);
  });
});

describe("granica Suspense renderera (picker pustego kontenera, L655)", () => {
  /** Boks pickera podawany „z góry" - w produkcji robi to kanwa buildera. */
  function makeLazyBox() {
    let release!: (v: { default: (p: EmptyContainerPickerBoxProps) => ReactElement }) => void;
    const promise = new Promise<{ default: (p: EmptyContainerPickerBoxProps) => ReactElement }>(
      (resolve) => {
        release = resolve;
      },
    );
    const Box = lazy(() => promise);
    const Real = ({ tabsEnabled, onPick }: EmptyContainerPickerBoxProps) => (
      <button type="button" data-picker onClick={() => onPick([6, 6])}>
        {tabsEnabled ? "picker-z-zakladkami" : "picker"}
      </button>
    );
    return { Box, release: () => release({ default: Real }) };
  }

  it("stan OCZEKIWANIA: fallback={null} nie rezerwuje ANI PIKSELA", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    const wiersz = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(wiersz).not.toBeNull();
    // Granica wisi - w wierszu kolumn nie ma NIC: ani boksu, ani zastępczej
    // wysokości. Gdy boks dojedzie, treść wskoczy i przesunie stronę.
    expect(wiersz?.childElementCount).toBe(0);
    expect(wiersz?.style.minHeight ?? "").toBe("");
    expect(container.querySelector("[data-picker]")).toBeNull();
  });

  it("po rozwiązaniu boks pojawia się i oddaje wybrane szerokości kolumn", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    const przycisk = await screen.findByText("picker");
    fireEvent.click(przycisk);
    // Kontener bez zakładek zgłasza `tabId === null`.
    expect(onPick).toHaveBeenCalledWith("kontener", null, [6, 6]);
  });

  it("w kontenerze z zakładkami picker zgłasza AKTYWNĄ zakładkę", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer
          doc={doc([
            section("kontener", [], {
              tabs: tabsConfig([{ id: "t1" }, { id: "t2" }], { defaultTabId: "t2" }),
            }),
          ])}
          lang="pl"
        />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    fireEvent.click(await screen.findByText("picker-z-zakladkami"));
    expect(onPick).toHaveBeenCalledWith("kontener", "t2", [6, 6]);
  });

  it("BEZ dostawcy (strona publiczna) picker nie istnieje - pusty kontener zostaje pusty", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-columns-row]")?.childElementCount).toBe(0);
  });

  it("dostawca podany, ale kontener MA kolumny - picker się nie pokazuje", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([simpleSection("pelna")])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(1);
  });
});

describe("granica BŁĘDU wokół sekcji", () => {
  it("uszkodzony layout.htmlTag wywraca JEDNĄ sekcję, reszta strony żyje", () => {
    // `htmlTag` jedzie z kolumny jsonb - wartość spoza zbioru znaczników HTML
    // (tu: liczba) wywraca `createElement`. Bez ziarnistej granicy padłaby
    // CAŁA strona publiczna.
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <BuilderRenderer
          doc={doc([
            simpleSection("zdrowa-1"),
            simpleSection("polamana", { layout: { htmlTag: 7 } as never }),
            simpleSection("zdrowa-2"),
          ])}
          lang="pl"
        />,
      );
      expect(container.querySelector('[data-sec-id="zdrowa-1"]')).not.toBeNull();
      expect(container.querySelector('[data-sec-id="zdrowa-2"]')).not.toBeNull();
      const diagnostyka = container.querySelector('[data-render-error="section:polamana"]');
      expect(diagnostyka).not.toBeNull();
      // W dev granica pokazuje zwięzły komunikat (rola alert); w produkcji
      // zostaje niewidoczny ślad w DOM - tam mierzy to RenderErrorBoundary.
      expect(diagnostyka?.getAttribute("role")).toBe("alert");
    } finally {
      bledy.mockRestore();
    }
  });

  it("granica z fallbackiem null nie rezerwuje miejsca po zepsutym węźle", () => {
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <Suspense fallback={null}>
          <BuilderRenderer
            doc={doc([simpleSection("polamana", { layout: { htmlTag: 7 } as never })])}
            lang="pl"
          />
        </Suspense>,
      );
      const korzen = container.querySelector<HTMLElement>("[data-builder-renderer]");
      // Jedyne, co zostaje po sekcji, to diagnostyka granicy - nie ma
      // zastępczej wysokości, która utrzymałaby układ strony.
      expect(korzen?.querySelector("[data-sec-id]")).toBeNull();
      expect(korzen?.style.minHeight ?? "").toBe("");
    } finally {
      bledy.mockRestore();
    }
  });
});
