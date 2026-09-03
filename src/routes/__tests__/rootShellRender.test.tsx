// POWŁOKA DOKUMENTU (`shellComponent`) i ekran 404 korzenia - dowód przez
// `renderToStaticMarkup`.
//
// PO CO OSOBNY PLIK. `RootShell` renderuje `<html><head><body>`, więc nie
// przechodzi przez `render()` z testing-library (ta wstawia poddrzewo do
// istniejącego `document.body`). `renderToStaticMarkup` z `react-dom/server` to
// jedyna droga, a jednocześnie ta sama, którą naprawdę idzie SSR.
//
// CO TEN PLIK MONTUJE - i gdzie leży jego granica.
//
// SPROSTOWANIE WŁASNEGO NAGŁÓWKA (2026-09-03). Stało tu, że `RootComponent`
// „NIE MONTUJE SIĘ z gołego renderu" i że montaż „wymaga prawdziwego
// `RouterProvider` z `__root` JAKO KORZENIEM". Pierwsze zdanie było
// NIEPRAWDZIWE, drugie NIEPEŁNE - i przez oba blok montażu stał pod
// BEZWARUNKOWYM `describe.skip` (jedynym w repozytorium), płacąc za to 41
// niewywołanymi funkcjami z 48 w `__root.tsx`. Zmierzone przy odpinaniu:
//
//   * PIERWSZYM blokerem był brak `supabase.auth.onAuthStateChange` we
//     wspólnym `supabaseAuthStub` - montaż wywracał się na
//     `lib/ads/consent.ts:423`. Nagłówek wskazywał `useAuth.tsx`, który ten
//     sam brak ŁAPIE i degraduje do "continuing signed-out", więc NIE jest
//     przyczyną;
//   * DRUGIM - i tu nagłówek miał rację - `Link` i `useRouterState`
//     (`SiteChrome.tsx:32`, `Cannot read properties of null (reading
//     'isServer')`). Ale atrapa tych dwóch WYSTARCZA, żeby powłoka
//     zamontowała się w całości; prawdziwy `RouterProvider` nie jest do tego
//     potrzebny.
//
// GDZIE JEST GRANICA TEGO PLIKU. Atrapa routera przestaje wystarczać dopiero
// wtedy, gdy osiem nakładek `lazy()` korzenia REALNIE się rozstrzygnie:
// prawdziwe `LoginPopup`/`CommandPalette`/`PopupHost` czytają dalsze haki
// (`useNavigate`, `useMatches`) i wywracają się tym samym błędem. Zmierzone:
// wydłużenie przepłukania w tym pliku pokrywa fabryki `lazy()`, ale wywala
// trzy testy. Dlatego montaż na PRAWDZIWYM routerze - z `__root` jako
// korzeniem - mieszka w osobnym pliku (`rootRouterMount.test.tsx`), a tutaj
// zostaje wariant na atrapie, tańszy i wystarczający dla powłoki, efektów
// korzenia, ekranu błędu i szkieletu trasy.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  subscribed: [] as string[],
  /** Callbacki `router.subscribe(...)` - test wywołuje je RĘCZNIE, patrz niżej. */
  handlers: new Map<string, () => void>(),
  /**
   * Czy atrapa `Outlet` ma ZAWIESIĆ render. `RouteLoadingSkeleton` jest
   * fallbackiem `<Suspense>` wokół `<Outlet/>` i NIE JEST eksportowany, więc
   * jedyną drogą do jego wykonania jest zawieszenie dziecka tej granicy.
   *
   * SPROSTOWANIE WŁASNEGO KOMENTARZA (2026-09-03, jeszcze przed scaleniem).
   * Stało tu, że jest to „dokładnie to, co w produkcji robi wolno
   * rozwiązująca się trasa". TO NIEPRAWDA i różnica jest tu całą treścią:
   * prawdziwy `<Outlet/>` zakłada WŁASNĄ granicę `Suspense` wokół dopasowania
   * dziecka, z fallbackiem `null`
   * (`@tanstack/react-router/dist/esm/Match.js:284-287` + `:71-72`, bo
   * `src/router.tsx` nie ustawia `defaultPendingComponent`). React wybiera
   * granicę NAJBLIŻSZĄ, więc w produkcji zawieszenie trasy NIE DOCHODZI do
   * granicy korzenia i szkielet się NIE POKAZUJE.
   *
   * Ten blok dowodzi więc TYLKO tego, że szkielet renderuje się poprawnie, GDY
   * zostanie osiągnięty - a nie że produkcja go osiąga. Nieosiągalność jest
   * zarejestrowana jako `it.fails` w `rootRouterMount.test.tsx` („DEFEKT: wolna
   * trasa NIE pokazuje RouteLoadingSkeleton"), na prawdziwym routerze.
   */
  outletSuspends: false,
  /** Zgłoszenia z `ErrorComponent` - atrapa zamiast beaconu, patrz niżej. */
  platformErrors: [] as { error: unknown; context: unknown }[],
  /** Tabele, o które poddrzewo korzenia REALNIE pyta - lista z pomiaru. */
  tables: [] as string[],
}));

// TRANSPORT ZGŁOSZEŃ ZAATRAPOWANY, i to nie jest wygoda: prawdziwy
// `reportPlatformError` woła `reportBoundaryError` ->
// `sendBeaconPayload(observabilityEndpoint(), ...)`
// (`lib/observability/report.ts:108-115`), czyli WYCHODZI DO SIECI. Żaden test
// w tym repozytorium nie ma do sieci wychodzić. Atrapa dodatkowo zamienia
// „nic nie wybuchło" na sprawdzalny kontrakt: granica błędu MUSI zaraportować.
vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (error: unknown, context: unknown) => {
    h.platformErrors.push({ error, context });
  },
}));

vi.mock("@tanstack/react-router", async (o) => {
  const actual = await o<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    HeadContent: () => null,
    Scripts: () => null,
    Outlet: () => {
      // Obietnica, która NIGDY się nie rozstrzyga - granica `Suspense` zostaje
      // więc na fallbacku i test może go zobaczyć. Rozstrzygająca się obietnica
      // dałaby wyścig: React zdążyłby przemalować na treść przed asercją.
      if (h.outletSuspends) throw new Promise<void>(() => undefined);
      return null;
    },
    // `Link` i `useRouterState` czytają kontekst routera, którego goły render
    // nie ma (`TypeError: Cannot read properties of null (reading 'isServer')`).
    // `Link` idzie przez WSPÓLNY helper repozytorium (`@/test/routerLinkStub`),
    // a `useRouterState` dostaje atrapę, która WYWOŁUJE PRAWDZIWY SELEKTOR
    // wywołującego - czyli logika wyboru w `SiteChrome` (pathname, `ownChrome`
    // ze `staticData`, `contentKind` z `loaderData`) jest tu wykonywana, a nie
    // ominięta. To jest cała różnica między „powłoka się zamontowała" i
    // „gałąź, w której mieszka `SiteChrome`, wpadła do `ErrorBoundary`".
    Link: RouterLinkStub,
    useRouterState: <TSelected,>(opts?: {
      select?: (state: {
        location: { pathname: string; href: string; search: Record<string, unknown> };
        matches: { staticData?: unknown; loaderData?: unknown }[];
        status: string;
        isLoading: boolean;
      }) => TSelected;
    }) => {
      const state = {
        location: { pathname: "/", href: "/", search: {} },
        matches: [],
        status: "idle",
        isLoading: false,
      };
      return opts?.select ? opts.select(state) : (state as unknown as TSelected);
    },
    useRouter: () => ({
      subscribe: (ev: string, cb: () => void) => {
        h.subscribed.push(ev);
        h.handlers.set(ev, cb);
        return () => undefined;
      },
    }),
  };
});

vi.mock("@/lib/i18n", async (o) => {
  const actual = await o<typeof import("@/lib/i18n")>();
  return {
    ...actual,
    syncI18nToRequest: async () => undefined,
    getRenderI18n: () => actual.default,
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseAuthStub, ok } = await import("@/test/supabase");
  const from = supabaseFromStub();
  // TRZY TABELE, KTÓRE PODDRZEWO KORZENIA REALNIE CZYTA - lista Z POMIARU, nie
  // z lektury importów: instrumentowałem `from` i wypisałem zbiór nazw
  // (`site_settings`, `site_design_tokens`, `post_layout_settings`).
  //
  // PO CO TO TU STOI. `supabaseFromStub` na tabeli BEZ zaplanowanej odpowiedzi
  // zwraca BŁĄD, nie pustą listę - i to jest celowe (cichy `[]` udawałby
  // poprawny odczyt). Bez tych trzech wpisów `HeaderInner` (`Header.tsx:53`)
  // rzucał `PostgrestError`, który wpadał do `ErrorBoundary` korzenia
  // JUŻ PO asercjach - czyli test świecił zielono na drzewie podmienionym na
  // ekran błędu. Pusta lista jest tu odpowiedzią WŁAŚCIWĄ, a nie wygodną:
  // `Header` zwraca `null`, gdy `builder_data.sections` jest puste, więc to
  // dokładnie stan „serwis bez skonfigurowanej powłoki".
  for (const table of ["site_settings", "site_design_tokens", "post_layout_settings"]) {
    from.setResponse(table, ok([]));
  }
  return {
    supabase: {
      from: (table: string) => {
        h.tables.push(table);
        return from.from(table);
      },
      // `supabaseAuthStub` wymaga identyfikatora - `null` znaczy ANONIM, czyli
      // dokładnie stan, w jakim renderuje się publiczna powłoka dokumentu.
      //
      // `onAuthStateChange` DOKŁADANY INLINE, a nie do wspólnego helpera:
      // `SupabaseAuthStub` (src/test/supabase/rpc.ts:133-150) wystawia sam
      // `getUser`/`getSession`, a subskrypcję zmian sesji stubuje inline 28
      // plików testowych w tym repozytorium - to jest tu wzorzec dominujący
      // i najwęższy. Bez tej metody montaż korzenia wywraca się na
      // `lib/ads/consent.ts:423` (NIE na `useAuth.tsx:100`, który ten sam brak
      // ŁAPIE i degraduje do "continuing signed-out") - i to jest jedyna
      // realna przeszkoda, jaką odpięcie tego bloku napotkało.
      auth: {
        ...supabaseAuthStub(null),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
        subscribe: () => ({ unsubscribe: () => undefined }),
        unsubscribe: () => undefined,
      }),
      removeChannel: () => undefined,
      rpc: async () => ok([]),
    },
  };
});

const { Route } = await import("@/routes/__root");

describe("RootShell", () => {
  it("renderuje <html lang>, <head> i <body> - pełny dokument, nie fragment", () => {
    // `shellComponent` nie jest w publicznym typie `RouteOptions` (framework
    // czyta je dynamicznie) - zawężamy przez `Record`, nie przez `any`.
    const opts = Route.options as unknown as Record<string, unknown>;
    const Shell = opts["shellComponent"] as (p: {
      children: React.ReactNode;
    }) => React.ReactElement;
    const html = renderToStaticMarkup(<Shell>{null}</Shell>);
    expect(html).toContain("<html lang=");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });
});

describe("NotFoundComponent / ErrorComponent / skeleton", () => {
  it("ekran 404 korzenia renderuje się bez rzutu", () => {
    const NF = Route.options.notFoundComponent as unknown as () => React.ReactElement;
    expect(() => renderToStaticMarkup(<NF />)).not.toThrow();
  });
});

// KORZEŃ APLIKACJI ZAMONTOWANY. Do 2026-09-03 ten blok stał pod
// BEZWARUNKOWYM `describe.skip` - jedynym w całym repozytorium - i jego nagłówek
// twierdził, że montaż wymaga „prawdziwego `RouterProvider` z `__root` JAKO
// KORZENIEM, czyli zmiany w `src/test/routeHarness.tsx`". ZMIERZONE: nie
// wymaga. Odpięcie kosztowało DWIE atrapy w tym pliku i ZERO zmian
// produkcyjnych ani harness'owych:
//
//   1. `supabase.auth.onAuthStateChange` - brak tej metody we WSPÓLNYM
//      `supabaseAuthStub` wywracał montaż na `lib/ads/consent.ts:423`. To był
//      PIERWSZY blocker i nagłówek pominięcia go nie znał (wskazywał
//      `useAuth.tsx`, który ten sam brak łapie i degraduje do
//      "continuing signed-out", więc NIE jest przyczyną);
//   2. `Link` + `useRouterState` - to dopiero DRUGI blocker i jedyny, który
//      nagłówek opisywał trafnie (`Cannot read properties of null (reading
//      'isServer')`, `SiteChrome.tsx:32`). Bez niego test „przechodził", ale
//      cała gałąź `SiteChrome` wpadała do `ErrorBoundary` - czyli zielony wynik
//      na niezamontowanej powłoce.
//
// CO TEN BLOK REALNIE DOWODZI: że `RootComponent` montuje się, że jego DWA
// efekty biegną (obserwowalność za zgodą + subskrypcja routera, watchdog,
// cache-busting, heartbeat) i że drzewo NIE WPADA do granicy błędu. Effekty
// wymagają klienta, więc `renderToStaticMarkup` z górnej części pliku ich nie
// wykonuje - i dlatego oba dowody muszą tu stać obok siebie, nie zamiast siebie.
describe("RootComponent - korzeń aplikacji zamontowany po stronie klienta", () => {
  /**
   * ZGODA ANALITYCZNA ZAPISANA PRZED MONTAŻEM. Bez niej pierwszy efekt korzenia
   * wychodzi natychmiast (`if (!consentMounted || !categories.analytics) return`)
   * i gałąź `afterPrerendering` -> `import("../lib/observability")` nigdy się nie
   * wykonuje. Kształt bierzemy z `safeParse` (`lib/ads/consent.ts:96-112`):
   * `version` MUSI równać się `CONSENT_VERSION` = 2, inaczej wpis jest odrzucany
   * w całości i test cicho mierzyłby wariant bez zgody.
   */
  /**
   * Przepłukanie kolejki `Suspense` + mikrozadań importów dynamicznych.
   * Owinięte w `act`, bo każde rozstrzygnięcie leniwego modułu jest
   * aktualizacją stanu Reacta - bez tego React wypisuje ostrzeżenie i asercja
   * czyta drzewo z poprzedniej klatki.
   */
  async function flushSuspense(rounds = 8): Promise<void> {
    const { act } = await import("@testing-library/react");
    for (let i = 0; i < rounds; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, i === 0 ? 60 : 5));
      });
    }
  }

  function grantAnalyticsConsent(): void {
    window.localStorage.setItem(
      "consent:v2",
      JSON.stringify({
        version: 2,
        ts: 1,
        categories: { necessary: true, functional: true, analytics: true, marketing: false },
        source: "local",
      }),
    );
  }

  it("montuje się, subskrybuje onResolved i NIE wpada do granicy błędu", async () => {
    grantAnalyticsConsent();
    const { render, cleanup, screen } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const Root = Route.options.component as unknown as () => React.ReactElement;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Root />
      </QueryClientProvider>,
    );

    expect(h.subscribed).toContain("onResolved");

    // GRANICA BŁĘDU JEST CZĘŚCIĄ DOWODU, nie ozdobą. `ErrorBoundary` korzenia
    // przechwytuje rzut z dowolnego miejsca poddrzewa i podmienia je na ekran
    // błędu - a wtedy asercja o subskrypcji wyżej NADAL PRZECHODZI (efekt
    // korzenia biegnie przed renderem dzieci). Pytamy o ROLĘ i o obecność
    // landmarku, nie o polski literał z interfejsu.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-chat-dock-slot]")).not.toBeNull();

    // KILKA CYKLI, NIE JEDEN - i to jest ustalenie z pomiaru, nie ostrożność.
    // Gdy dziecko `<Suspense>` zawiesi render, React NIE PRÓBUJE rodzeństwa
    // w tym samym przejściu: maluje fallback i ponawia dopiero po
    // rozstrzygnięciu. Osiem nakładek korzenia siedzi w JEDNEJ granicy, więc
    // pojedyncze przepłukanie wykonywało fabrykę `lazy()` WYŁĄCZNIE pierwszego
    // z nich (zmierzone: `ConsentBanner` tak, `ConsentPreviewPanel` nie).
    // Każdy obrót odblokowuje następną. Ta sama pętla domyka wewnętrzne
    // `.then(m => ...)` importów dynamicznych z obu efektów.
    //
    // `whenIdle` bez `requestIdleCallback` (happy-dom go nie ma) degraduje do
    // `setTimeout(min(timeout, 32))` - `lib/ads/idle.ts:40` - więc 60 ms
    // w pierwszym obrocie starcza na cache-busting i heartbeat podglądu.
    await flushSuspense();

    // Miękka nawigacja: `onResolved` jest jedynym wejściem do atrybucji Web
    // Vitals per URL i do `trackPageView`. Wołamy PRZECHWYCONY callback, bo
    // atrapa routera nie ma prawdziwej historii - dowodzimy, że handler
    // wpisany przez korzeń jest wywoływalny i nie rzuca.
    const onResolved = h.handlers.get("onResolved");
    expect(onResolved).toBeTypeOf("function");
    expect(() => onResolved?.()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));

    // Odmontowanie MUSI być czyste: sprzątanie obu efektów zdejmuje
    // subskrypcję routera i anuluje oba `whenIdle`. Rzut w tej ścieżce zostaje
    // w produkcji cichym wyciekiem na każdej nawigacji między układami.
    expect(() => cleanup()).not.toThrow();
    // ŻADEN BŁĄD NIE WPADŁ DO GRANICY. Ta asercja stoi NA KOŃCU, po
    // przepłukaniu, i to jest jej cała wartość: `PostgrestError` z `Header`
    // przychodził PO wcześniejszych asercjach, więc test bez tego wiersza
    // świecił zielono na drzewie już podmienionym na ekran błędu.
    expect(h.platformErrors.map((e) => String(e.error))).toEqual([]);
  });

  it("markAppReady() ustawia flagę gotowości - kontrakt boot-testu artefaktu", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const Root = Route.options.component as unknown as () => React.ReactElement;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Root />
      </QueryClientProvider>,
    );
    // `__nesAppReady` czyta `e2e/boot-artifact.spec.ts` (żywotność artefaktu) i
    // `e2e/boot-timing.spec.ts` (czas do gotowości). Flaga jest więc KONTRAKTEM
    // między korzeniem i dwiema bramkami CI, a ustawia ją drugi efekt korzenia
    // SYNCHRONICZNIE - bez round-tripu po leniwy chunk.
    expect((window as unknown as { __nesAppReady?: boolean }).__nesAppReady).toBe(true);
    cleanup();
  });

  it("RouteLoadingSkeleton jest fallbackiem granicy wokół <Outlet/>", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const Root = Route.options.component as unknown as () => React.ReactElement;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    h.outletSuspends = true;
    try {
      render(
        <QueryClientProvider client={qc}>
          <Root />
        </QueryClientProvider>,
      );
      // `aria-busy` JEST kontraktem dostępności tego szkieletu, a nie detalem
      // wyglądu: czytnik ekranu musi wiedzieć, że region się ładuje. Pytamy
      // o atrybut, nie o klasy Tailwinda ani o polski literał.
      const busy = document.querySelector('[aria-busy="true"]');
      expect(busy).not.toBeNull();
      cleanup();
    } finally {
      h.outletSuspends = false;
    }
  });
});

// EKRAN BŁĘDU KORZENIA. `errorComponent` to ostatnia linia obrony całej
// aplikacji: każdy rzut, którego nie złapała granica wewnątrz drzewa, kończy
// się TYM komponentem. Renderowany WPROST z `Route.options` - tak samo jak
// ekran 404 wyżej w tym pliku - bo jego wejściem jest para `{error, reset}`,
// a nie stan routera.
describe("ErrorComponent korzenia", () => {
  it("renderuje przyjazny ekran i ZGŁASZA błąd do obserwowalności", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    h.platformErrors.length = 0;
    const EC = Route.options.errorComponent as unknown as (p: {
      error: Error;
      reset: () => void;
    }) => React.ReactElement;
    // `ErrorComponent` woła `console.error(error)` bezwarunkowo - to jest jego
    // zachowanie produkcyjne (błąd MUSI zostać w konsoli przeglądarki).
    // Wyciszamy je, żeby log suity nie wyglądał na czerwony, i PRZYWRACAMY.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resetCalls = 0;
    const error = new Error("boom");
    try {
      render(<EC error={error} reset={() => (resetCalls += 1)} />);
      // Sama obecność ekranu: rola `alert` albo jakikolwiek tekst - pytamy
      // o strukturę, nie o copy.
      expect(document.body.textContent).not.toBe("");
      expect(consoleError).toHaveBeenCalled();
      // KONTRAKT ZGŁOSZENIA: bez tego błąd korzenia jest niewidoczny dla
      // operatora - strona pokazuje ekran, a telemetria milczy.
      //
      // ASERCJA IDZIE PO TREŚCI, NIE PO LICZBIE, i to jest świadome. Zmierzone:
      // WCHODZĄ DWA zgłoszenia, z DWÓCH różnych granic, i oba są zachowaniem
      // produkcyjnym:
      //   * `tanstack_root_error_component` - efekt `ErrorComponent` (`:180`);
      //   * `friendly_error_page` - samo `FriendlyErrorPage`, które zgłasza
      //     się niezależnie od tego, kto je wyrenderował.
      // Przypięcie liczby byłoby więc przypięciem szczegółu cudzego modułu
      // (plus React w trybie deweloperskim wywołuje efekty dwukrotnie).
      // Bramką jest: KAŻDE zgłoszenie niesie TEN błąd, a granica korzenia
      // JEST wśród nadawców.
      expect(h.platformErrors.length).toBeGreaterThan(0);
      for (const entry of h.platformErrors) expect(entry.error).toBe(error);
      const boundaries = h.platformErrors.map((e) =>
        typeof e.context === "object" && e.context !== null && "boundary" in e.context
          ? (e.context as { boundary?: unknown }).boundary
          : undefined,
      );
      expect(boundaries).toContain("tanstack_root_error_component");
      expect(resetCalls).toBe(0);
      cleanup();
    } finally {
      consoleError.mockRestore();
    }
  });
});
