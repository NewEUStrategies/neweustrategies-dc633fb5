import { RouteLoadingSkeleton } from "@/lib/ssr/RouteLoadingSkeleton";
// KORZEŃ APLIKACJI W PRAWDZIWYM ROUTERZE - bez ani jednej atrapy routera.
//
// PO CO OSOBNY PLIK, obok `rootShellRender.test.tsx`. Tamten dowodzi powłoki
// dokumentu (`shellComponent` przez `renderToStaticMarkup`) i montażu korzenia
// na ATRAPIE routera - i to jest jego granica: atrapa odblokowuje montaż, ale
// gdy osiem nakładek `lazy()` korzenia REALNIE się rozstrzygnie, ich prawdziwe
// komponenty czytają dalsze haki routera (`useNavigate`, `useMatches`,
// `useLocation`) i wywracają się na `Cannot read properties of null (reading
// 'isServer')`. Zmierzone: wydłużenie przepłukania w tamtym pliku pokrywa
// fabryki `lazy()`, ale wywala trzy testy dokładnie tym błędem.
//
// Dlatego tu montujemy `__root` JAKO KORZEŃ prawdziwego `RouterProvider`
// (`src/test/routeHarness.tsx`, opcja `rootRoute`) - hooki dostają prawdziwy
// router, więc nakładki rozstrzygają się bez żadnej atrapy nawigacji.
//
// TA DROGA BYŁA PRZEWIDZIANA I ZAPISANA: commit 08d4cdbaa („Pokrycie dwóch
// plików, które posiadają wszystkie budżety SSR") nazwał ją wprost -
// „droga w górę jest nazwana (opcjonalny `rootRoute` w
// src/test/routeHarness.tsx), ale to zmiana harness'u testowego i osobna
// praca". To jest ta praca. ZERO zmian w kodzie produkcyjnym.
import { createRoute } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platformErrors: [] as { error: unknown; context: unknown }[],
}));

// Transport zgłoszeń zaatrapowany: prawdziwy `reportPlatformError` woła
// `sendBeaconPayload` (`lib/observability/report.ts:108-115`), czyli WYCHODZI
// DO SIECI. Żaden test w tym repozytorium do sieci nie wychodzi. Atrapa jest
// jednocześnie przyrządem: pusta lista = żadna granica błędu nie zadziałała.
vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (error: unknown, context: unknown) => {
    h.platformErrors.push({ error, context });
  },
}));

vi.mock("@/lib/i18n", async (o) => {
  const actual = await o<typeof import("@/lib/i18n")>();
  return {
    ...actual,
    // Loader korzenia biegnie NAPRAWDĘ (tak działa `router.load()`), a
    // `syncI18nToRequest` jest po stronie żądania serwerowego.
    syncI18nToRequest: async () => undefined,
    getRenderI18n: () => actual.default,
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseAuthStub, ok } = await import("@/test/supabase");
  const from = supabaseFromStub();
  // Tabele czytane przez loader korzenia i jego poddrzewo - lista Z POMIARU
  // (instrumentowane `from`). `supabaseFromStub` na tabeli bez zaplanowanej
  // odpowiedzi zwraca BŁĄD, nie pustą listę, więc brak wpisu kończy się
  // `PostgrestError` w granicy błędu, a nie cichym zerem.
  for (const table of [
    "site_settings",
    "site_design_tokens",
    "post_layout_settings",
    "builder_popups",
    "newsletter_settings",
    "menus",
    "menu_items",
  ]) {
    from.setResponse(table, ok([]));
  }
  return {
    supabase: {
      from: from.from,
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

const { Route: RootRoute } = await import("@/routes/__root");

/**
 * ZGODA ANALITYCZNA ZAPISANA PRZED MONTAŻEM. Bez niej pierwszy efekt korzenia
 * wychodzi natychmiast (`if (!consentMounted || !categories.analytics) return`)
 * i gałąź `afterPrerendering` -> `import("../lib/observability")` nigdy nie
 * biegnie. Kształt z `safeParse` (`lib/ads/consent.ts:96-112`): `version` MUSI
 * być równe `CONSENT_VERSION` = 2, inaczej wpis jest odrzucany W CAŁOŚCI
 * i test cicho mierzyłby wariant BEZ zgody.
 */
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

/**
 * ROZGRZANIE REJESTRU MODUŁÓW NAKŁADEK - i to jest NAPRAWA
 * NIEDETERMINIZMU POMIARU, nie optymalizacja.
 *
 * OBJAW, ZMIERZONY: pierwsza wersja tego pliku przepłukiwała granicę
 * `Suspense` ustaloną liczbą obrotów po PRAWDZIWYM zegarze. Pokrycie funkcji
 * `src/routes/__root.tsx` wychodziło wtedy 38/48 (79,17%), 40/48 (83,33%)
 * albo 43/48 (89,58%) - NA TYM SAMYM HEADZIE, bez zmiany ani jednego znaku.
 * Trzy przebiegi tej samej komendy dały 89,58 / 79,17 / 79,17. Wahały się
 * DOKŁADNIE fabryki nakładek (`:111`, `:113`, `:114`, `:116`, `:117`), a próg
 * per-ścieżka postawiony z JEDNEGO pomiaru zapalał się na czerwono bez
 * żadnej regresji. To ta sama klasa defektu, którą zlecenie kazało zdjąć
 * z `src/lib/ssrCache.ts` - tylko że tutaj wprowadziłem ją sam.
 *
 * PRZYCZYNA. Gdy dziecko `<Suspense>` zawiesi render, React NIE PRÓBUJE
 * rodzeństwa w tym samym przejściu: maluje fallback i ponawia dopiero po
 * rozstrzygnięciu. Osiem nakładek korzenia siedzi w JEDNEJ granicy, więc
 * potrzeba OSIEM kolejnych ponowień, a każde czeka na rozwiązanie modułu
 * przez vitesta (transformacja + graf zależności - dla `ConsentBanner` to
 * ~1 400 wierszy źródeł). Ile z tych ośmiu zdąży przed końcem testu, zależy
 * od obciążenia maszyny. Ustalona liczba obrotów po zegarze mierzy więc
 * SZYBKOŚĆ HOSTA, nie kod.
 *
 * NAPRAWA. Rozwiązujemy te moduły ZAWCZASU, przed renderem. Wtedy fabryka
 * `lazy()` wołana przez Reacta trafia w gotowy rejestr i jej `.then`
 * rozstrzyga się w MIKROZADANIU, a nie po round-tripie transformacji. Osiem
 * ponowień mieści się wtedy w ustalonej liczbie przepłukań deterministycznie.
 *
 * CZEGO TO NIE ZMIENIA: fabryki nadal wołane są PRZEZ REACTA z produkcyjnego
 * `__root.tsx` (a nie przez ten import), więc pokrycie mierzy dokładnie to samo
 * co wcześniej - tylko przestaje zależeć od zegara.
 */
async function warmOverlayModules(): Promise<void> {
  await Promise.all([
    import("@/components/ConsentBanner"),
    import("@/components/ConsentPreviewPanel"),
    import("@/components/LoginPopup"),
    import("@/components/NewsletterPopup"),
    import("@/components/popups/PopupHost"),
    import("@/components/search/CommandPalette"),
    import("@/components/chat/ExpertRequestDialogHost"),
    import("@/components/ui/sonner"),
  ]);
}

/**
 * Przepłukanie granicy `Suspense`. Po rozgrzaniu rejestru (wyżej) każde
 * ponowienie Reacta kosztuje MIKROZADANIE, więc liczba obrotów jest górnym
 * ograniczeniem liczby nakładek, a nie zakładem o szybkość maszyny.
 * 24 obroty na 8 nakładek = 3x zapasu.
 */
async function flushOverlays(rounds = 24): Promise<void> {
  const { act } = await import("@testing-library/react");
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      // Makrozadanie w pierwszym obrocie (efekty korzenia odroczone przez
      // `whenIdle` degradują do `setTimeout(..., 32)`), dalej same mikrozadania.
      if (i === 0) await new Promise((r) => setTimeout(r, 60));
      else await Promise.resolve();
    });
  }
}

describe("__root jako korzeń prawdziwego RouterProvider", () => {
  it("montuje całą powłokę, rozstrzyga nakładki lazy i nie wpada do granicy błędu", async () => {
    grantAnalyticsConsent();
    h.platformErrors.length = 0;
    await warmOverlayModules();
    const { renderRoute } = await import("@/test/routeHarness");
    const child = createRoute({
      // Rodzic jest doklepywany przez harness (`wireToParent`), więc ten getter
      // jest tylko wymogiem typu - harness go nadpisuje.
      getParentRoute: () => RootRoute,
      path: "/",
      component: () => <main data-testid="child-route">treść trasy</main>,
    });

    const rendered = await renderRoute({
      route: child,
      rootRoute: RootRoute,
      path: "/",
      initialEntry: "/",
    });

    // 1. DZIECKO PRZESZŁO PRZEZ `<Outlet/>` KORZENIA. To jest dowód, że
    //    powłoka nie tylko się zamontowała, ale też PRZEPUŚCIŁA trasę - awaria
    //    z 2026-07-20 wyglądała dokładnie odwrotnie.
    expect(rendered.getByTestId("child-route")).toBeTruthy();

    // 2. GNIAZDO CHAT-DOCKU renderuje `SiteChrome` - czyli gałąź, która na
    //    atrapie routera wpadała do `ErrorBoundary`, tutaj żyje.
    expect(document.querySelector("[data-chat-dock-slot]")).not.toBeNull();

    // 3. FLAGA GOTOWOŚCI. `__nesAppReady` czytają OBIE bramki artefaktu
    //    (`e2e/boot-artifact.spec.ts` - żywotność, `e2e/boot-timing.spec.ts` -
    //    czas do gotowości), więc to kontrakt między korzeniem i CI.
    expect((window as unknown as { __nesAppReady?: boolean }).__nesAppReady).toBe(true);

    await flushOverlays();

    // 4. ŻADNA GRANICA BŁĘDU NIE ZADZIAŁAŁA - asercja PO przepłukaniu, i to
    //    jest jej cała wartość: błąd z rozstrzygniętego leniwego chunku
    //    przychodzi PÓŹNIEJ niż wszystkie asercje wyżej.
    expect(h.platformErrors.map((e) => String(e.error))).toEqual([]);

    rendered.unmount();
  });

  // The real Outlet must show the root pending component; a mocked Outlet
  // cannot prove that its inner Suspense boundary uses the intended fallback.
  it("wolna trasa pokazuje RouteLoadingSkeleton przez prawdziwy Outlet", async () => {
    const { renderRoute } = await import("@/test/routeHarness");
    const suspending = createRoute({
      getParentRoute: () => RootRoute,
      path: "/",
      // Obietnica, która NIGDY się nie rozstrzyga - dokładnie stan „trasa
      // ładuje się bardzo długo", o którym mówi komentarz przy szkielecie.
      component: () => {
        throw new Promise<void>(() => undefined);
      },
    });

    const rendered = await renderRoute({
      route: suspending,
      rootRoute: RootRoute,
      path: "/",
      initialEntry: "/",
      pendingComponent: RouteLoadingSkeleton,
    });

    // `aria-busy="true"` to kontrakt dostępności szkieletu (`__root.tsx:196`).
    // Pytamy o atrybut, nie o klasy Tailwinda ani o polski literał.
    // A missing root pendingComponent would make this boundary render null.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    rendered.unmount();
  });
});
