// JĘZYK RENDERU NA KLIENCIE IDZIE ZA ADRESEM - także przy nawigacji, której
// nie zaczął przełącznik (wstecz/dalej przeglądarki).
//
// Defekt z audytu (15.15 / 16.8, `localeRuntime.ts:29`): żywy język klienta był
// zasiewany z URL-a RAZ, przy ładowaniu modułu, a potem zmieniał go wyłącznie
// przełącznik (`setClientLang`). Loader korzenia, który woła
// `syncI18nToRequest`, NIE biegnie ponownie przy zwykłej nawigacji klienta
// (dopasowanie korzenia ma `cause: "stay"` i ten sam identyfikator, więc
// router-core uznaje je za świeże - `load-matches.ts`, `staleMatchShouldReload`).
// Skutek: po „wstecz" z /en/b na /a strona o kanonicznym adresie POLSKIM
// renderowała angielską kopię, a każdy nowo zbudowany odnośnik dostawał prefiks
// "/en" - przeładowanie tej samej strony dawało zaś polszczyznę.
//
// HARNESS. Prawdziwy `getRouter()` z `src/router.tsx` (ten sam rewrite
// input/output), prawdziwa historia przeglądarki (happy-dom, `popstate`),
// prawdziwe `localeRuntime` w gałęzi KLIENTA, prawdziwy `@/lib/i18n` (świeża
// instancja i18next na scenariusz) i prawdziwy przełącznik `switchUiLanguage`.
// Podmienione są tylko: drzewo tras (5 tras zamiast całej aplikacji; korzeń
// odwzorowuje okablowanie językowe `__root.tsx`, które przypina
// `routes/__tests__/rootRoute.test.tsx`), integracja router<->query, flaga
// `isServer` i wybór gałęzi `createIsomorphicFn` (patrz niżej).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnyRouter } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  /** Drzewo tras budowane PO zresetowaniu modułów (patrz `boot`). */
  routeTree: undefined as unknown,
  /** `location.pathname`, które dostał loader korzenia. */
  rootLoaderPathnames: [] as string[],
}));

// Bez kompilatora Startu (vitest) stub `createIsomorphicFn` wybiera gałąź
// SERWEROWĄ - wtedy `currentLang()` nie widzi żywego języka klienta wcale.
// Bundel przeglądarki dostaje `.client()`; tu robimy to samo.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createIsomorphicFn: () => ({
    server: () => ({ client: <T,>(clientImpl: T) => clientImpl }),
  }),
}));
vi.mock("@tanstack/router-core/isServer", () => ({ isServer: false }));
vi.mock("@tanstack/react-router-ssr-query", () => ({
  setupRouterSsrQueryIntegration: () => undefined,
}));
// Fabryka nie importuje produkcji (zakleszczenie, patrz `src/test/i18nStub.ts`)
// - drzewo podaje `boot()` przez `h`.
vi.mock("@/routeTree.gen", () => ({
  get routeTree() {
    return h.routeTree;
  },
}));

type I18nModule = typeof import("@/lib/i18n");

/**
 * Świeży zestaw modułów dla adresu startowego: `localeRuntime` zasiewa język
 * z `window.location` przy ładowaniu, a i18next jest singletonem z
 * `node_modules` (resetModules go nie odtwarza) - stąd świeża instancja.
 */
async function boot(initialPath: string) {
  vi.resetModules();
  window.history.replaceState(null, "", initialPath);
  vi.doMock("i18next", async () => {
    const actual = await vi.importActual<typeof import("i18next")>("i18next");
    return { ...actual, default: actual.createInstance() };
  });
  const i18nModule: I18nModule = await import("@/lib/i18n");
  const runtime = await import("@/lib/i18n/localeRuntime");
  const { switchUiLanguage } = await import("@/lib/i18n/switchUiLanguage");
  const rr = await import("@tanstack/react-router");

  const Page = () => (
    <>
      <h2 id="sekcja">Sekcja</h2>
      <rr.Link<AnyRouter> to="/c" data-testid="to-c">
        c
      </rr.Link>
    </>
  );
  const root = rr.createRootRoute({
    // Odwzorowanie okablowania językowego korzenia (`src/routes/__root.tsx`).
    beforeLoad: async ({ location }) => {
      await i18nModule.syncI18nToRequest(location.publicHref).catch(() => undefined);
    },
    // `__root.tsx` rozpoznaje w loaderze stronę główną po `location.pathname` -
    // zapisujemy, co do loadera faktycznie dociera.
    loader: ({ location }) => {
      h.rootLoaderPathnames.push(location.pathname);
    },
    component: () => <rr.Outlet />,
  });
  const child = (path: string) =>
    rr.createRoute({ getParentRoute: () => root, path, component: Page });
  h.routeTree = root.addChildren([
    child("/"),
    child("/a"),
    child("/b"),
    child("/c"),
    child("/admin/x"),
  ]);

  const { getRouter } = await import("@/router");
  const router = getRouter() as unknown as AnyRouter;
  render(<rr.RouterProvider router={router} />);
  await settled(router, initialPath);
  return { router, i18n: i18nModule.default, runtime, switchUiLanguage };
}

// Drzewo testu nie jest drzewem zarejestrowanym w aplikacji (`Register`), więc
// typowane `to` odrzuciłoby jego ścieżki - jedno zawężenie w helperach.
const go = (router: AnyRouter, to: string) => router.navigate({ to } as never);
const hrefFor = (router: AnyRouter, to: string) => router.buildLocation({ to } as never).publicHref;

/** Czeka, aż router rozstrzygnie nawigację na adres `publicPath` (ścieżka, query, hash). */
async function settled(router: AnyRouter, publicPath: string) {
  await vi.waitFor(() => {
    const { pathname, search, hash } = window.location;
    expect(`${pathname}${search}${hash}`).toBe(publicPath);
    expect(router.state.resolvedLocation?.publicHref).toBe(publicPath);
    expect(router.state.status).toBe("idle");
  });
  // `changeLanguage` dociąga słownik dynamicznym importem - niech dojdzie.
  await vi.dynamicImportSettled();
}

function hrefToC(): string | null {
  return screen.getByTestId("to-c").getAttribute("href");
}

let state: Awaited<ReturnType<typeof boot>> | undefined;

/** Wszystko, co musi mówić jednym językiem: ref klienta, i18next, <html lang>, odnośnik. */
function renderState() {
  return {
    currentLang: state!.runtime.currentLang(),
    i18n: state!.i18n.language,
    htmlLang: document.documentElement.lang,
    hrefToC: hrefToC(),
  };
}
const PL_STATE = { currentLang: "pl", i18n: "pl", htmlLang: "pl", hrefToC: "/c" };
const EN_STATE = { currentLang: "en", i18n: "en", htmlLang: "en", hrefToC: "/en/c" };

// Router renderuje z wnętrza zdarzeń historii (`popstate`, `router.load()`),
// czyli POZA `act(...)` - i właśnie tę kolejność (ref języka przed renderem
// odnośników) sprawdzamy, więc `act` jej nie owija. Flaga steruje wyłącznie
// ostrzeżeniem Reacta (jak w `routes/__tests__/adminImportWordpressRoute.test.tsx`).
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnv: boolean | undefined;

beforeEach(() => {
  previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  // Preferencja z poprzedniego scenariusza (ciasteczko, lustro w localStorage,
  // <html lang>) nie może zasiać języka następnego.
  document.cookie = "nes_lang=; path=/; max-age=0";
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
  h.rootLoaderPathnames = [];
});

afterEach(() => {
  cleanup();
  state = undefined;
  actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
});

describe("język renderu na kliencie po nawigacji wstecz/dalej", () => {
  it("wstecz z /en/b na /a wraca do polskiego (currentLang, i18next, odnośniki); dalej - do angielskiego", async () => {
    state = await boot("/a");
    const { router, i18n, runtime, switchUiLanguage } = state;
    expect(renderState()).toEqual(PL_STATE);

    await go(router, "/b");
    await settled(router, "/b");

    // Przełącznik: setClientLang PRZED nawigacją, `replace` na /en/b.
    switchUiLanguage("en", "pl", { i18n, router });
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(i18n.language).toBe("en"));
    expect(runtime.currentLang()).toBe("en");
    // Adres budowany od nowa ma już prefiks - i wyrenderowany <Link> tej samej
    // strony też (przełącznik odświeża odnośniki po nawigacji, patrz niżej).
    expect(hrefFor(router, "/c")).toBe("/en/c");
    await vi.waitFor(() => expect(hrefToC()).toBe("/en/c"));

    await go(router, "/c");
    await settled(router, "/en/c");
    expect(renderState()).toEqual(EN_STATE);

    window.history.back();
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    // /a to kanoniczny adres POLSKI - tak samo renderuje go SSR.
    window.history.back();
    await settled(router, "/a");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));

    window.history.forward();
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
  });

  // Zmiana języka, która NIE przesuwa adresu (baner zgody woła wprost
  // `i18n.changeLanguage`), a potem zwykły klik w odnośnik: historia zapisuje
  // push do paska mikrozadanie PO `beforeLoad` korzenia, więc kotwica „adres,
  // dla którego ustawiono język" zostawała na /a - i „wstecz" na /a pomijało
  // ponowne wyprowadzenie: angielski pod polskim adresem kanonicznym.
  it("język zmieniony bez nawigacji, klik w odnośnik, wstecz - adres znów decyduje", async () => {
    state = await boot("/a");
    const { router, i18n } = state;
    await i18n.changeLanguage("en");
    await vi.dynamicImportSettled();

    await go(router, "/c");
    await settled(router, "/en/c");
    expect(renderState()).toEqual(EN_STATE);

    window.history.back();
    await settled(router, "/a");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
  });

  // To samo po przełączeniu EN -> PL na stronie treści: przełącznik ZASTĘPUJE
  // wpis /en/a polskim /a, więc po wyjściu i powrocie adres (i język) to /a.
  it("po EN -> PL, kliku i powrocie wraca polskie /a, nie stare /en/a", async () => {
    state = await boot("/en/a");
    const { router, i18n, switchUiLanguage } = state;
    switchUiLanguage("pl", "en", { i18n, router });
    await settled(router, "/a");
    await vi.waitFor(() => expect(i18n.language).toBe("pl"));

    await go(router, "/c");
    await settled(router, "/c");
    expect(renderState()).toEqual(PL_STATE);

    window.history.back();
    await settled(router, "/a");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
  });

  it("strona aplikacji (bez prefiksu) zachowuje preferencję - także po powrocie wstecz", async () => {
    state = await boot("/en/a");
    const { router } = state;
    expect(renderState()).toEqual(EN_STATE);

    await go(router, "/admin/x");
    await settled(router, "/admin/x");
    // /admin nigdy nie dostaje prefiksu; język idzie za preferencją, nie za
    // brakiem prefiksu (to nie jest polski adres kanoniczny).
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    window.history.back();
    await settled(router, "/en/a");
    window.history.forward();
    await settled(router, "/admin/x");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
  });
});

describe("kontrakt przełącznika po poprawce", () => {
  it("EN -> PL na stronie treści: ponowne wyprowadzenie z adresu NIE cofa wyboru", async () => {
    state = await boot("/en/a");
    const { router, i18n, switchUiLanguage } = state;
    expect(renderState()).toEqual(EN_STATE);

    switchUiLanguage("pl", "en", { i18n, router });
    // Router porównuje adresy BEZ prefiksu ("/a" == "/a"); bez zmiany stanu
    // historii nie zapisałby tej nawigacji, a pasek adresu zostałby na /en/a
    // (przeładowanie dałoby z powrotem angielski). Przełącznik musi go zmienić.
    await settled(router, "/a");
    await vi.waitFor(() => expect(i18n.language).toBe("pl"));
    expect(state.runtime.currentLang()).toBe("pl");
    expect(i18n.language).toBe("pl");
    expect(document.documentElement.lang).toBe("pl");
    expect(hrefFor(router, "/c")).toBe("/c");

    // Miękkie odświeżenie trasy (`cacheBusting` po nowym wdrożeniu) ładuje
    // ponownie TEN SAM adres - wybór użytkownika nie może się cofnąć na "/en".
    await router.invalidate();
    await vi.dynamicImportSettled();
    expect(state.runtime.currentLang()).toBe("pl");
    expect(i18n.language).toBe("pl");

    await go(router, "/c");
    await settled(router, "/c");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
  });

  it("na stronie aplikacji `setClientLang` sprzed nawigacji obowiązuje dalej (adres się nie zmienia)", async () => {
    state = await boot("/admin/x");
    const { router, i18n, switchUiLanguage } = state;
    expect(state.runtime.currentLang()).toBe("pl");

    switchUiLanguage("en", "pl", { i18n, router });
    // Ten sam adres - nawigacja `replace` przechodzi przez `beforeLoad`
    // korzenia, a ścieżka bez prefiksu NIE cofa wyboru na polski.
    await settled(router, "/admin/x");
    await vi.waitFor(() => expect(i18n.language).toBe("en"));
    expect(state.runtime.currentLang()).toBe("en");
    expect(hrefFor(router, "/c")).toBe("/en/c");

    await go(router, "/");
    await settled(router, "/en");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
  });

  // Odnośnik zbudowany w POPRZEDNIM języku: taki zostaje po zmianie języka
  // bez nawigacji (baner zgody woła wprost `i18n.changeLanguage`), a po
  // przełączniku - do chwili odświeżenia odnośników po jego nawigacji.
  // Preload biegnie przez `beforeLoad` korzenia z TĄ lokalizacją.
  it("najechanie na odnośnik zbudowany w poprzednim języku (preload) nie cofa języka", async () => {
    state = await boot("/b");
    const { router, i18n } = state;
    await i18n.changeLanguage("en");
    await vi.dynamicImportSettled();
    expect(state.runtime.currentLang()).toBe("en");

    const link = screen.getByTestId("to-c");
    expect(link.getAttribute("href")).toBe("/c");
    const preload = vi.spyOn(router, "preloadRoute");
    fireEvent.mouseEnter(link);
    await vi.waitFor(() => expect(preload).toHaveBeenCalled());
    await preload.mock.results[0]!.value;

    expect(state.runtime.currentLang()).toBe("en");
    expect(i18n.language).toBe("en");
    expect(window.location.pathname).toBe("/b");
  });
});

// ODNOŚNIKI WYRENDEROWANE PRZED PRZEŁĄCZENIEM. `<Link>` TanStack trzyma
// zbudowaną lokalizację, dopóki magazyn lokalizacji routera nie poda INNEGO
// wewnętrznego `href` (`react-router/src/link.tsx`: porównanie `a.href ===
// b.href`), a rewrite `input` zdejmuje prefiks - "/en/b" i "/b" to dla routera
// ten sam "/b". Bez odświeżenia odnośniki strony zostawały w starym języku:
// nowa karta, skopiowany link i pasek statusu prowadziły do drugiej wersji.
describe("odnośniki wyrenderowane przed przełączeniem", () => {
  it("PL -> EN i z powrotem: href odnośnika idzie za językiem bez kolejnej nawigacji", async () => {
    state = await boot("/b");
    const { router, i18n, switchUiLanguage } = state;
    expect(hrefToC()).toBe("/c");

    switchUiLanguage("en", "pl", { i18n, router });
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    switchUiLanguage("pl", "en", { i18n, router });
    await settled(router, "/b");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
  });

  it("jedno przełączenie = jeden zapis historii (replace) i jedno ładowanie, bez pętli", async () => {
    state = await boot("/b");
    const { router, i18n, switchUiLanguage } = state;
    const push = vi.spyOn(router.history, "push");
    const replace = vi.spyOn(router.history, "replace");
    const loads: string[] = [];
    const unsubscribe = router.subscribe("onBeforeLoad", (e) => {
      loads.push(e.toLocation.publicHref);
    });
    const entries = window.history.length;
    try {
      switchUiLanguage("en", "pl", { i18n, router });
      await settled(router, "/en/b");
      await vi.waitFor(() => expect(hrefToC()).toBe("/en/c"));
      // Jeszcze jedno makrozadanie: odświeżenie odnośników nie może wywołać
      // kolejnej nawigacji ani ładowania.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace.mock.calls[0]![0]).toBe("/en/b");
      expect(loads).toEqual(["/en/b"]);
      expect(window.history.length).toBe(entries);
      // Chwilowa kopia lokalizacji (inny wewnętrzny href) nie zostaje w routerze.
      expect(router.state.location.href).toBe("/b");
      expect(router.state.location.publicHref).toBe("/en/b");
    } finally {
      unsubscribe();
    }
  });

  it("klik w odświeżony odnośnik, wstecz i dalej - adres i język zgodne na każdym kroku", async () => {
    state = await boot("/a");
    const { router, i18n, switchUiLanguage } = state;
    await go(router, "/b");
    await settled(router, "/b");

    switchUiLanguage("en", "pl", { i18n, router });
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    fireEvent.click(screen.getByTestId("to-c"));
    await settled(router, "/en/c");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    // Przełącznik ZASTĄPIŁ wpis /b, więc wstecz prowadzi na /en/b, a dalej
    // wstecz - na polskie /a.
    window.history.back();
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
    window.history.back();
    await settled(router, "/a");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
    window.history.forward();
    await settled(router, "/en/b");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
  });

  it("query i hash zostają, widok nie skacze do kotwicy, odnośnik w nowym języku", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      state = await boot("/b?q=1#sekcja");
      const { router, i18n, switchUiLanguage } = state;
      scrollIntoView.mockClear();

      switchUiLanguage("en", "pl", { i18n, router });
      await settled(router, "/en/b?q=1#sekcja");
      await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it("strona aplikacji: adres bez zmian, odnośniki do treści dostają prefiks", async () => {
    state = await boot("/admin/x");
    const { router, i18n, switchUiLanguage } = state;
    expect(renderState()).toEqual(PL_STATE);

    switchUiLanguage("en", "pl", { i18n, router });
    await settled(router, "/admin/x");
    await vi.waitFor(() => expect(renderState()).toEqual(EN_STATE));

    switchUiLanguage("pl", "en", { i18n, router });
    await settled(router, "/admin/x");
    await vi.waitFor(() => expect(renderState()).toEqual(PL_STATE));
  });
});

// `__root.tsx` rozpoznaje w loaderze gołą stronę główną po `location.pathname`.
// Prefiks języka zdejmuje rewrite `input` ZANIM router zbuduje lokalizację, więc
// "/en" dociera do loadera jako "/" - porównania z "/en" i "/en/" były martwe.
describe("lokalizacja widziana przez loader korzenia", () => {
  it.each([
    ["/", "/"],
    ["/en", "/"],
    ["/en/a", "/a"],
  ])("adres %s -> location.pathname %s", async (address, pathname) => {
    state = await boot(address);
    expect(h.rootLoaderPathnames).toEqual([pathname]);
    expect(state.router.state.location.publicHref).toBe(address);
  });
});
