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
//   na korzeniu (`data-lcp-root` + `data-lcp-ids`, także pustą listę),
//   hydratacja odczytuje je z DOM-u, a render czysto kliencki nie ma
//   kandydata, tylko eager w pierwszej malowanej sekcji (runda 10, M1). Dowód:
//   pełna ścieżka `renderToString` (atrapa `isServer` = prawda) ->
//   `hydrateRoot` bez rozjazdu, licznik wywołań `lcpCandidateIds` (tylko
//   serwer), kontrole negatywne (HTML bez nośnika = rozjazd zgłoszony przez
//   Reacta), dwa korzenie-właściciele, sekwencja zalogowanego, ponowne użycie
//   instancji z nowym dokumentem (m2) i `isServer` nieokreślone (dev, m1),
// * `stream` włączone i wyłączone dla sekcji ZALEŻNEJ OD DANYCH i dla statycznej
//   - z dowodem, że na ścieżce KLIENCKIEJ treść jest identyczna,
// * brak danych źródłowych: widget listy wpisów z pustą odpowiedzią Supabase
//   nie wywraca sekcji ani strony,
// * granica `Suspense` renderera (L655) w stanie OCZEKIWANIA i po rozwiązaniu
//   - łącznie z tym, że jej `fallback={null}` NIE REZERWUJE ANI PIKSELA,
// * granica błędu wokół sekcji: uszkodzony `layout.htmlTag` wywraca render
//   JEDNEJ sekcji, a nie strony,
// * WYSPY SEKCJI (P2.2): w strumieniowanym rendererze treści wyspą jest każda
//   sekcja od drugiej W DOKUMENCIE (poza testem A/B), nigdy w powłoce,
//   podglądzie, kanwie, treści wpisu i dokumencie ze spisem treści (skaner
//   spisu zmienia nagłówki wszystkich sekcji); HTML serwera bez fallbacku; przy
//   hydratacji wyspa czeka z HTML serwera, otwiera ją widoczność (kolejka
//   P0.3), pierwsza interakcja (po jednej na klatkę) albo od razu zapisana
//   sesja; zmiana przydziału A/B i dostępu nie przemontowuje wysp.
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
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import { CurrentPostProvider } from "@/lib/content-model/postContext";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";
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
// moduł daje `undefined`; atrapa podaje `false` (klient), a `ssr()` niżej
// przełącza na serwer na czas `renderToString`. `undefined` (dev, NODE_ENV=test)
// sprawdza osobny test: wtedy rozstrzyga brak `document` (`isServerRender`).
const env = vi.hoisted(() => ({ server: false as boolean | undefined }));
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
// ZALOGOWANEGO ustawiają sesję; reszta pliku nie widzi żadnej zmiany. Sesja
// jest zewnętrznym magazynem (`useSyncExternalStore`), więc `auth.set()` po
// hydratacji przerysowuje konsumentów - jak rozstrzygnięcie sesji w produkcji
// (`useAuth` startuje z `session = null`).
const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    session: null as { user: { id: string } } | null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => store.session,
    set(session: { user: { id: string } } | null) {
      store.session = session;
      for (const listener of listeners) listener();
    },
  };
  return store;
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    useAuth: () => {
      const base = actual.useAuth();
      const session = useSyncExternalStore(auth.subscribe, auth.snapshot, auth.snapshot);
      return session ? { ...base, session, user: session.user, loading: false } : base;
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
  /** Ponowny render TEJ SAMEJ instancji drzewa (ten sam korzeń i klient zapytań). */
  readonly rerender: (ui: ReactElement) => Promise<void>;
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
  const client = nowyKlient();
  let root: Root;
  try {
    root = hydrateRoot(host, <QueryClientProvider client={client}>{ui}</QueryClientProvider>, {
      onRecoverableError: (error) => recoverable.push(error),
    });
    hydratedRoots.push({ root, host });
    await act(async () => {});
  } finally {
    spy.mockRestore();
  }
  const rerender = async (next: ReactElement) => {
    await act(async () =>
      root.render(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
    );
  };
  return { host, recoverable, mismatches, rerender };
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

  it("render czysto kliencki (nawigacja SPA): pierwsza sekcja eager, bez znacznika, nośnika i preloadu (M1)", () => {
    // Bez HTML-u serwera nie ma czego odczytać, a kodu `lcpCandidates` w
    // przeglądarce nie ma. Obraz leniwy czekałby jednak na commit, layout i
    // obserwację IO nowej strony, więc pierwszy obraz widgetu PIERWSZEJ
    // malowanej sekcji idzie eager (recenzja P1.4 runda 3, M1). Bez
    // `data-lcp-candidate` (jedyny znacznik na stronie należy do SSR) i bez
    // preloadu - reszta zostaje leniwa.
    lcp.calls = 0;
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([0, 1, 2].map((i) => sekcjaZObrazem(`s${i}`, `https://example.org/spa-${i}.png`)))}
        lang="pl"
        lcpOwner
      />,
    );
    expect(priorytety(container)).toEqual(["eager", "lazy", "lazy"]);
    expect(kandydaci(container)).toHaveLength(0);
    expect(korzen(container)?.hasAttribute("data-lcp-root")).toBe(false);
    expect(korzen(container)?.hasAttribute("data-lcp-ids")).toBe(false);
    expect(document.head.querySelector('link[rel="preload"][href*="spa-"]')).toBeNull();
    expect(lcp.calls).toBe(0);
  });

  it("render czysto kliencki renderera BEZ lcpOwner: wszystko leniwe (powłoka nie dostaje eager)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0"), sekcjaZObrazem("s1")])} lang="pl" />,
    );
    expect(priorytety(container)).toEqual(["lazy", "lazy"]);
  });

  it("render czysto kliencki: sekcja niewidoczna dla czytelnika nie zajmuje „pierwszej sekcji”", () => {
    // Pierwsza MALOWANA sekcja - po filtrze dostępu `SectionsList`, nie
    // pierwsza w dokumencie.
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("dla-czlonkow", sekcjaZObrazem("dla-czlonkow").children, {
            advanced: gate({ auth: "user" }),
          }),
          sekcjaZObrazem("hero"),
          sekcjaZObrazem("dalej"),
        ])}
        lang="pl"
        lcpOwner
      />,
    );
    expect(container.querySelector('[data-sec-id="dla-czlonkow"]')).toBeNull();
    expect(priorytety(container)).toEqual(["eager", "lazy"]);
  });

  it("hydratacja strony BEZ kandydata: pusty nośnik, wszystko leniwe jak w HTML-u serwera (M1)", async () => {
    // Okno 0: serwer nie wyznacza kandydata, ale właściciel i tak zapisuje
    // nośnik (`data-lcp-ids=""`). Bez niego klient uznałby hydratację za render
    // czysto kliencki i dał obrazowi sekcji 0 eager - rozjazd z HTML-em serwera.
    const view = await hydrated(
      <BuilderRenderer
        doc={doc([sekcjaZObrazem("s0"), sekcjaZObrazem("s1")])}
        lang="pl"
        lcpOwner
        aboveFoldCount={0}
      />,
    );
    expect(korzen(view.host)?.getAttribute("data-lcp-ids")).toBe("");
    expect(korzen(view.host)?.getAttribute("data-lcp-root")).toBeTruthy();
    expect(priorytety(view.host)).toEqual(["lazy", "lazy"]);
    expect(kandydaci(view.host)).toHaveLength(0);
    expectCleanHydration(view);
  });

  it("KONTROLA NEGATYWNA: strona bez kandydata, nośnik usunięty - klient bierze render za kliencki i React zgłasza rozjazd", async () => {
    const view = await hydrated(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner aboveFoldCount={0} />,
      (host) => {
        korzen(host)?.removeAttribute("data-lcp-ids");
        korzen(host)?.removeAttribute("data-lcp-root");
      },
    );
    expect(view.mismatches.length + view.recoverable.length).toBeGreaterThan(0);
  });

  it("dwa korzenie-właściciele w jednym dokumencie: każdy czyta WŁASNY nośnik po `useId()` (m4)", async () => {
    // Dopasowanie po wartości `useId()`, nie „pierwszy korzeń w DOM-ie”:
    // odczyt cudzego nośnika dałby drugiemu rendererowi znacznik na obcym id,
    // czyli rozjazd z HTML-em serwera.
    const view = await hydrated(
      <>
        <BuilderRenderer
          doc={doc([sekcjaZObrazem("a0", "https://example.org/a.png")])}
          lang="pl"
          lcpOwner
        />
        <BuilderRenderer
          doc={doc([sekcjaZObrazem("b0", "https://example.org/b.png")])}
          lang="pl"
          lcpOwner
        />
      </>,
    );
    const korzenie = [...view.host.querySelectorAll<HTMLElement>("[data-builder-renderer]")];
    expect(korzenie.map((r) => r.getAttribute("data-lcp-ids"))).toEqual(["a0-img", "b0-img"]);
    expect(new Set(korzenie.map((r) => r.getAttribute("data-lcp-root"))).size).toBe(2);
    expect(korzenie.map((r) => kandydaci(r)[0]?.getAttribute("alt"))).toEqual([
      "Obraz a0",
      "Obraz b0",
    ]);
    expectCleanHydration(view);
  });

  it("ZALOGOWANY w produkcji: SSR gość -> hydratacja gość -> sesja -> sekcja „tylko dla gości” znika; znacznik nie przechodzi na inny obraz (m4)", async () => {
    // `useAuth` startuje z `session = null`, więc hydratacja przebiega jako
    // gość, zgodnie z HTML-em serwera. Lista kandydatów jest utrwalona: po
    // rozstrzygnięciu sesji obraz członka nie dostaje ani znacznika, ani
    // priorytetu (brak priorytetu zamiast złego), a `eager` renderu
    // klienckiego się nie włącza, bo korzeń ma nośnik z SSR.
    const dokument = doc([
      section("promo", sekcjaZObrazem("promo").children, { advanced: gate({ auth: "guest" }) }),
      sekcjaZObrazem("hero"),
    ]);
    const view = await hydrated(<BuilderRenderer doc={dokument} lang="pl" lcpOwner />);
    expect(kandydaci(view.host)[0]?.getAttribute("alt")).toBe("Obraz promo");
    expectCleanHydration(view);
    await act(async () => auth.set({ user: { id: "u-1" } }));
    expect(view.host.querySelector('[data-sec-id="promo"]')).toBeNull();
    expect(view.host.querySelector('[data-sec-id="hero"]')).not.toBeNull();
    expect(kandydaci(view.host)).toHaveLength(0);
    expect(priorytety(view.host)).toEqual(["lazy"]);
    expect(korzen(view.host)?.getAttribute("data-lcp-ids")).toBe("promo-img");
    expectCleanHydration(view);
  });

  it("ta sama instancja z NOWYM dokumentem (trasa `$`, /a -> /b): kandydaci A nie przechodzą na widget o tym samym id w B (m2)", async () => {
    const dokumentA = doc([sekcjaZObrazem("s0"), sekcjaZObrazem("s1")]);
    const view = await hydrated(<BuilderRenderer doc={dokumentA} lang="pl" lcpOwner />);
    expect(korzen(view.host)?.getAttribute("data-lcp-ids")).toBe("s0-img");
    // Odświeżenie bez zmian (React Query zostawia referencję): znacznik zostaje.
    await view.rerender(<BuilderRenderer doc={dokumentA} lang="pl" lcpOwner />);
    expect(kandydaci(view.host)).toHaveLength(1);
    // Ten sam dokument zbudowany od nowa (`parseBuilderDoc` w każdym renderze -
    // `support.tsx`, `EventModulePage`, literał sekcji wyróżnionej archiwum):
    // odcisk z identyfikatorów sekcji jest ten sam, więc znacznik zostaje.
    await view.rerender(
      <BuilderRenderer
        doc={doc([sekcjaZObrazem("s0"), sekcjaZObrazem("s1")])}
        lang="pl"
        lcpOwner
      />,
    );
    expect(kandydaci(view.host)).toHaveLength(1);
    expect(priorytety(view.host)).toEqual(["eager", "lazy"]);
    // B: widget `s0-img` leży w sekcji 2 - dawniej dostałby znacznik i eager/high.
    const dokumentB = doc([
      sekcjaZObrazem("b0", "https://example.org/b0.png"),
      sekcjaZObrazem("b1", "https://example.org/b1.png"),
      section("b2", sekcjaZObrazem("s0", "https://example.org/b2.png").children),
    ]);
    await view.rerender(<BuilderRenderer doc={dokumentB} lang="pl" lcpOwner />);
    expect(kandydaci(view.host)).toHaveLength(0);
    expect(korzen(view.host)?.hasAttribute("data-lcp-ids")).toBe(false);
    expect(korzen(view.host)?.hasAttribute("data-lcp-root")).toBe(false);
    // Nowy dokument to render kliencki: eager wyłącznie pierwsza sekcja B.
    expect(priorytety(view.host)).toEqual(["eager", "lazy", "lazy"]);
    expect(
      view.host
        .querySelector('img[src="https://example.org/b2.png"]')
        ?.getAttribute("fetchpriority"),
    ).toBe("auto");
  });

  it("`isServer` nieokreślone (`bun run dev`, NODE_ENV=test): render bez `document` liczy kandydata jak serwer (m1)", () => {
    // Warunek eksportu `development` daje `isServer` = undefined - dawniej serwer
    // dev wchodził w gałąź klienta: bez kandydata, nośnika i preloadu.
    env.server = undefined;
    vi.stubGlobal("document", undefined);
    let html = "";
    try {
      const src = "https://example.org/dev-hero.png";
      function Trasa() {
        usePreloadLcpImages([{ href: src }]);
        return <BuilderRenderer doc={doc([sekcjaZObrazem("s0", src)])} lang="pl" lcpOwner />;
      }
      html = renderToString(
        <QueryClientProvider client={nowyKlient()}>
          <Trasa />
        </QueryClientProvider>,
      );
    } finally {
      vi.unstubAllGlobals();
      env.server = false;
    }
    expect(html).toContain('data-lcp-ids="s0-img"');
    expect(html.match(/data-lcp-candidate/g)).toHaveLength(1);
    expect(imagePreloadLinks(html)).toHaveLength(1);
    // Ta sama atrapa z `document` (przeglądarka w dev): gałąź klienta.
    env.server = undefined;
    try {
      lcp.calls = 0;
      const { container } = renderWithQueryClient(
        <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" lcpOwner />,
      );
      expect(lcp.calls).toBe(0);
      expect(kandydaci(container)).toHaveLength(0);
    } finally {
      env.server = false;
    }
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

  it("strona bez obrazu w oknie: ani kandydata, ani preloadu obrazu (nośnik pusty)", () => {
    const html = ssrPage(
      [],
      <BuilderRenderer doc={doc([simpleSection("a"), simpleSection("b")])} lang="pl" lcpOwner />,
    );
    expect(html).not.toContain("data-lcp-candidate");
    // Pusty nośnik: hydratacja wie, że serwer nie miał kandydata (M1).
    expect(html).toContain('data-lcp-ids=""');
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

describe("wyspy sekcji (P2.2)", () => {
  const sekcjaToc = (id: string) =>
    section(id, [column(`${id}-c`, [widget(`${id}-toc`, "toc", { content: {} })])]);
  const sekcjaRichToc = (id: string) =>
    section(id, [
      column(`${id}-c`, [
        widget(`${id}-rt`, "rich-text", {
          content: {
            doc: {
              pl: {
                blocks: [
                  {
                    id: `${id}-b`,
                    type: "toc",
                    data: { title: "", maxLevel: 3, ordered: false, sticky: false },
                  },
                ],
              },
            },
          },
        }),
      ]),
    ]);
  const sekcjaAb = (id: string) =>
    simpleSection(id, { advanced: { abTest: { experimentId: "e1", variant: "a" } } });
  const wyspy = (root: ParentNode) =>
    [...root.querySelectorAll("[data-island-id]")].map((el) => el.getAttribute("data-island-id"));
  const stan = (root: ParentNode, id: string) =>
    root.querySelector(`[data-island-id="${id}"]`)?.getAttribute("data-island-state");

  let frames: FrameRequestCallback[] = [];
  /** Jedna klatka kolejki P0.3: rAF, makrozadanie kroku, praca Reacta. */
  async function frame(): Promise<void> {
    await act(async () => {
      const pending = frames.splice(0);
      for (const callback of pending) callback(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    __resetFirstInteractionForTests();
    __resetPostInteractionQueueForTests();
  });

  afterEach(() => {
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    window.localStorage.clear();
  });

  const strona = doc([
    simpleSection("s0"),
    simpleSection("s1"),
    sekcjaAb("s4"),
    sekcjaZDanymi("s5"),
  ]);

  it("renderer treści (`stream`): wyspą jest każda sekcja od drugiej w dokumencie poza testem A/B; HTML bez fallbacku wysp", () => {
    const host = ssrDom(<BuilderRenderer doc={strona} lang="pl" stream />);

    expect(wyspy(host)).toEqual(["sec-s1", "sec-s5"]);
    expect(stan(host, "sec-s1")).toBe("pending");
    expect(stan(host, "sec-s5")).toBe("pending");
    expect(host.querySelector("[data-island-fallback]")).toBeNull();
    // Treść wyspy jest w HTML serwera (wyspa nie zawiesza się na serwerze).
    expect(
      host.querySelector('[data-island-id="sec-s1"] [data-sec-id="s1"]')?.textContent,
    ).toContain("T-s1-w");
    // Sekcja 0 bez otoczki - bezpośrednio w korzeniu renderera.
    expect(korzen(host)?.querySelector(':scope > [data-sec-id="s0"]')).not.toBeNull();
  });

  it.each([
    [
      "dokument z widgetem spisu treści (w dowolnej sekcji)",
      <BuilderRenderer doc={doc([...strona.sections, sekcjaToc("s9")])} lang="pl" stream />,
    ],
    [
      "dokument z blokiem `toc` w `rich-text` (sekcja 0)",
      <BuilderRenderer doc={doc([sekcjaRichToc("s9"), ...strona.sections])} lang="pl" stream />,
    ],
    [
      "treść wpisu (kontekst bieżącego wpisu `post`)",
      <CurrentPostProvider value={{ kind: "post", id: "p-1" }}>
        <BuilderRenderer doc={strona} lang="pl" stream />
      </CurrentPostProvider>,
    ],
    ["renderer bez `stream` (powłoka, popup)", <BuilderRenderer doc={strona} lang="pl" />],
    [
      "podgląd edytora (`editorPreview`)",
      <BuilderRenderer doc={strona} lang="pl" stream editorPreview />,
    ],
    [
      "kanwa buildera",
      <BuilderModeProvider mode="light">
        <BuilderRenderer doc={strona} lang="pl" stream />
      </BuilderModeProvider>,
    ],
  ] as const)("bez wysp: %s", (_, ui) => {
    const host = ssrDom(ui);
    expect(wyspy(host)).toEqual([]);
    expect(host.querySelectorAll("[data-sec-id]").length).toBeGreaterThanOrEqual(4);
  });

  it("strona z buildera (kontekst `page`): wyspy jak na stronie głównej", () => {
    const host = ssrDom(
      <CurrentPostProvider value={{ kind: "page", id: "pg-1" }}>
        <BuilderRenderer doc={strona} lang="pl" stream />
      </CurrentPostProvider>,
    );
    expect(wyspy(host)).toEqual(["sec-s1", "sec-s5"]);
  });

  it("hydratacja: wyspa czeka z HTML serwera; widoczność (IO) otwiera ją przez kolejkę P0.3 na tych samych węzłach", async () => {
    const view = await hydrated(<BuilderRenderer doc={strona} lang="pl" stream />);
    expectCleanHydration(view);
    const serwerowa = view.host.querySelector('[data-sec-id="s1"]');
    expect(stan(view.host, "sec-s1")).toBe("pending");

    await frame();
    expect(stan(view.host, "sec-s1")).toBe("pending");

    await act(async () => observers.triggerIntersection(true));
    expect(stan(view.host, "sec-s1")).toBe("pending"); // callback IO tylko zakłada wpis
    for (let i = 0; i < 4; i += 1) await frame();

    expect(stan(view.host, "sec-s1")).toBe("hydrated");
    expect(stan(view.host, "sec-s5")).toBe("hydrated");
    expect(view.host.querySelector('[data-sec-id="s1"]')).toBe(serwerowa);
    expectCleanHydration(view);
  });

  it("pierwsza interakcja: wyspy otwierają się po jednej na klatkę (kolejka P0.3), bez utraty HTML", async () => {
    const view = await hydrated(<BuilderRenderer doc={strona} lang="pl" stream />);
    const serwerowe = ["s1", "s5"].map((id) => view.host.querySelector(`[data-sec-id="${id}"]`));

    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await frame();
    const poPierwszej = [stan(view.host, "sec-s1"), stan(view.host, "sec-s5")];
    for (let i = 0; i < 4; i += 1) await frame();

    expect(poPierwszej.filter((state) => state === "hydrated").length).toBeLessThanOrEqual(1);
    expect(stan(view.host, "sec-s1")).toBe("hydrated");
    expect(stan(view.host, "sec-s5")).toBe("hydrated");
    expect(["s1", "s5"].map((id) => view.host.querySelector(`[data-sec-id="${id}"]`))).toEqual(
      serwerowe,
    );
    expectCleanHydration(view);
  });

  it("zapisana sesja (zalogowany, redaktor): wyspy sekcji hydratują od razu, bez kolejki", async () => {
    window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
    const view = await hydrated(<BuilderRenderer doc={strona} lang="pl" stream />);

    expect(stan(view.host, "sec-s1")).toBe("hydrated");
    expect(stan(view.host, "sec-s5")).toBe("hydrated");
    expectCleanHydration(view);
  });

  it("zmiana dostępu po hydratacji (sesja) nie przemontowuje czekającej wyspy: decyzja z indeksu w dokumencie", async () => {
    const tylkoZalogowani = simpleSection("s-z", {
      advanced: { access: { auth: "user" } },
    } as never);
    const dokument = doc([tylkoZalogowani, simpleSection("s0"), simpleSection("s1")]);
    const view = await hydrated(<BuilderRenderer doc={dokument} lang="pl" stream />);
    // Gość: pierwsza WIDOCZNA sekcja (s0) ma indeks 1 w dokumencie - jest wyspą.
    expect(wyspy(view.host)).toEqual(["sec-s0", "sec-s1"]);
    const serwerowa = view.host.querySelector('[data-sec-id="s1"]');

    await act(async () => auth.set({ user: { id: "u-1" } }));

    expect(view.host.querySelector('[data-sec-id="s-z"]')).not.toBeNull();
    expect(view.host.querySelector('[data-sec-id="s1"]')).toBe(serwerowa);
    expect(stan(view.host, "sec-s1")).toBe("pending");
  });
});
