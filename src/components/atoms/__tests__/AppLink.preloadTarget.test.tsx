// AppLink - PRELOAD CELU ODNOŚNIKA, NIE BIEŻĄCEJ TRASY (prawdziwy router).
//
// Defekt: intencja wołała `router.preloadRoute({ href })`, ale `preloadRoute`
// buduje lokalizację przez `buildLocation` (router-core), który opcji `href`
// NIE ZNA - zna ją wyłącznie `navigate` (`buildAndCommitLocation`). Brak `to`
// znaczył „bieżąca trasa": na /a najechanie na odnośnik do /b ponownie ładowało
// dopasowania /a, a loader /b czekał na klik. Atrapa routera w
// `AppLink.test.tsx` tego nie widzi - sprawdza tylko argument wywołania.
//
// HARNESS. Prawdziwy `getRouter()` z `src/router.tsx` (ten sam `rewrite`
// zdejmujący i dokładający prefiks języka, te same domyślne progi preloadu),
// prawdziwa historia przeglądarki (happy-dom) i prawdziwe `localeRuntime`
// w gałęzi KLIENTA. Podmienione: drzewo tras (kilka tras z loaderami-
// szpiegami), integracja router<->query, flaga `isServer`, wybór gałęzi
// `createIsomorphicFn` (jak w `lib/i18n/__tests__/urlLanguageNavigation.test.tsx`)
// i rozgrzewanie chunków widżetów (nie dotyczy routera).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Drzewo tras budowane PO zresetowaniu modułów (patrz `boot`). */
  routeTree: undefined as unknown,
}));

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
vi.mock("@/components/builder/organisms/widget-view/warmWidgetChunks", () => ({
  warmCommonWidgetChunks: () => undefined,
}));

/** Próg intencji z implementacji (`PRELOAD_DELAY_MS`) z zapasem na zegar. */
const AFTER_DELAY_MS = 150;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Świeży zestaw modułów dla adresu startowego: `localeRuntime` zasiewa język
 * z `window.location` przy ładowaniu, a pamięć preloadu `AppLink` jest
 * modułowa - reset daje każdemu scenariuszowi czystą kartę.
 */
async function boot(initialPath: string, links: readonly string[]) {
  vi.resetModules();
  window.history.replaceState(null, "", initialPath);
  const rr = await import("@tanstack/react-router");
  const { AppLink } = await import("@/components/atoms/AppLink");

  const loaders = {
    index: vi.fn(() => null),
    a: vi.fn(() => null),
    b: vi.fn(() => null),
    post: vi.fn((slug: string) => slug),
    search: vi.fn((q: string) => q),
    boom: vi.fn((): null => {
      throw new Error("loader celu padł");
    }),
  };

  const Page = () => (
    <ul data-testid="page-a">
      {links.map((href) => (
        <li key={href}>
          <AppLink href={href}>{href}</AppLink>
        </li>
      ))}
    </ul>
  );
  const root = rr.createRootRoute({ component: () => <rr.Outlet /> });
  // `staleTime` celów: klik po preloadzie trafia w TO SAMO dopasowanie (ten sam
  // identyfikator, te same `loaderDeps`) i nie odpala loadera ponownie - tak
  // test widzi, że preload zbudował lokalizację identyczną z nawigacją.
  const fresh = 30_000;
  h.routeTree = root.addChildren([
    rr.createRoute({ getParentRoute: () => root, path: "/", loader: () => loaders.index() }),
    rr.createRoute({
      getParentRoute: () => root,
      path: "/a",
      loader: () => loaders.a(),
      component: Page,
    }),
    rr.createRoute({
      getParentRoute: () => root,
      path: "/b",
      staleTime: fresh,
      loader: () => loaders.b(),
    }),
    rr.createRoute({
      getParentRoute: () => root,
      path: "/post/$slug",
      loader: ({ params }) => loaders.post(params.slug),
    }),
    rr.createRoute({
      getParentRoute: () => root,
      path: "/search",
      staleTime: fresh,
      validateSearch: (search: Record<string, unknown>) => ({
        q: typeof search.q === "string" ? search.q : "",
      }),
      loaderDeps: ({ search }) => ({ q: search.q }),
      loader: ({ deps }) => loaders.search(deps.q),
    }),
    rr.createRoute({ getParentRoute: () => root, path: "/boom", loader: () => loaders.boom() }),
  ]);

  const { getRouter } = await import("@/router");
  const router = getRouter();
  render(<rr.RouterProvider router={router} />);
  await screen.findByTestId("page-a");
  await vi.waitFor(() => expect(router.state.status).toBe("idle"));
  // Wejście na /a to jedno ładowanie - punkt odniesienia dla „nie ponownie /a".
  expect(loaders.a).toHaveBeenCalledTimes(1);
  return { router, loaders };
}

function hover(href: string) {
  fireEvent.mouseEnter(screen.getByText(href));
}

// Router renderuje z wnętrza zdarzeń historii i własnych obietnic, czyli POZA
// `act(...)`. Flaga steruje wyłącznie ostrzeżeniem Reacta (jak w
// `lib/i18n/__tests__/urlLanguageNavigation.test.tsx`).
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnv: boolean | undefined;

beforeEach(() => {
  previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  // Preferencja z innego pliku (ciasteczko, lustro w localStorage) nie może
  // zasiać języka scenariusza.
  document.cookie = "nes_lang=; path=/; max-age=0";
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
});

describe("AppLink - preload ładuje trasę CELU", () => {
  // Przypięcie zachowania router-core, które wymusiło przekład `href` w
  // `AppLink`. Gdy ta asercja padnie (router nauczy się `href` w preloadzie),
  // przekład można uprościć - ale wtedy świadomie, a nie po cichu.
  it("kontrakt router-core: `preloadRoute({ href })` pomija href i dopasowuje BIEŻĄCĄ trasę", async () => {
    const { router, loaders } = await boot("/a", []);

    const matches = await router.preloadRoute({ href: "/b" } as never);

    expect(matches?.map((match) => match.routeId)).toEqual(["__root__", "/a"]);
    expect(loaders.b).not.toHaveBeenCalled();
  });

  it("na /a najechanie na /b odpala loader /b, a NIE ponownie /a; klik trafia w preloadowane dopasowanie", async () => {
    const { router, loaders } = await boot("/a", ["/b"]);

    hover("/b");
    await vi.waitFor(() => expect(loaders.b).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.state.status).toBe("idle"));
    expect(loaders.a).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("/b"), { button: 0 });
    await vi.waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/b"));
    expect(window.location.pathname).toBe("/b");
    // To samo dopasowanie co w preloadzie (świeże przez `staleTime`) - bez
    // drugiego wywołania loadera.
    expect(loaders.b).toHaveBeenCalledTimes(1);
  });

  it("parametry ścieżki, query (loaderDeps) i hash idą do celu tak samo jak przy kliku", async () => {
    const { router, loaders } = await boot("/a", [
      "/post/za%C5%BC%C3%B3%C5%82%C4%87",
      "/search?q=sankcje#wyniki",
    ]);

    hover("/post/za%C5%BC%C3%B3%C5%82%C4%87");
    await vi.waitFor(() => expect(loaders.post).toHaveBeenCalledWith("zażółć"));

    const preload = vi.spyOn(router, "preloadRoute");
    hover("/search?q=sankcje#wyniki");
    await vi.waitFor(() => expect(loaders.search).toHaveBeenCalledWith("sankcje"));
    expect(preload).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "sankcje" },
      hash: "wyniki",
    });
    await vi.waitFor(() => expect(router.state.status).toBe("idle"));

    fireEvent.click(screen.getByText("/search?q=sankcje#wyniki"), { button: 0 });
    await vi.waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/search"));
    expect(window.location.search).toBe("?q=sankcje");
    expect(loaders.search).toHaveBeenCalledTimes(1);
    expect(loaders.a).toHaveBeenCalledTimes(1);
  });

  it("pełny adres TEGO SAMEGO originu preloaduje cel jak ścieżka względna", async () => {
    const href = `${window.location.origin}/b`;
    const { loaders } = await boot("/a", [href]);

    hover(href);
    await vi.waitFor(() => expect(loaders.b).toHaveBeenCalledTimes(1));
    expect(loaders.a).toHaveBeenCalledTimes(1);
  });
});

describe("AppLink - prefiks języka w odnośniku", () => {
  it("na angielskiej stronie /en/b i /en preloadują trasy kanoniczne /b i /", async () => {
    const { router, loaders } = await boot("/en/a", ["/en/b", "/en"]);
    expect(router.state.location.pathname).toBe("/a");

    hover("/en/b");
    await vi.waitFor(() => expect(loaders.b).toHaveBeenCalledTimes(1));
    hover("/en");
    await vi.waitFor(() => expect(loaders.index).toHaveBeenCalledTimes(1));
    expect(loaders.a).toHaveBeenCalledTimes(1);
    // Preload nie dotyka paska adresu ani języka strony.
    expect(window.location.pathname).toBe("/en/a");
  });

  it("odnośnik do wersji angielskiej z polskiej strony preloaduje trasę kanoniczną", async () => {
    const { loaders } = await boot("/a", ["/en/post/raport"]);

    hover("/en/post/raport");
    await vi.waitFor(() => expect(loaders.post).toHaveBeenCalledWith("raport"));
    expect(loaders.a).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/a");
  });
});

describe("AppLink - czego NIE preloadujemy", () => {
  it("odnośniki zewnętrzne, protokołowe i kotwice nie budzą routera", async () => {
    const links = ["https://example.org/b", "//example.org/b", "mailto:biuro@example.org", "#b"];
    const { router, loaders } = await boot("/a", links);
    const preload = vi.spyOn(router, "preloadRoute");

    for (const href of links) hover(href);
    await pause(AFTER_DELAY_MS);

    expect(preload).not.toHaveBeenCalled();
    expect(loaders.b).not.toHaveBeenCalled();
    expect(loaders.a).toHaveBeenCalledTimes(1);
  });
});

describe("AppLink - błąd preloadu nigdy nie dociera do UI", () => {
  /**
   * Każdy błąd, który uciekłby z timera albo z obietnicy preloadu. Timery
   * happy-dom biegną na zegarze Node, więc wyjątek z wywołania zwrotnego
   * timera to `uncaughtException` procesu, nie zdarzenie `error` okna -
   * słuchamy obu.
   */
  function watchEscapes() {
    const escapes: unknown[] = [];
    const onError = (event: ErrorEvent) => escapes.push(event.error);
    const onEscape = (reason: unknown) => escapes.push(reason);
    window.addEventListener("error", onError);
    process.on("unhandledRejection", onEscape);
    process.on("uncaughtException", onEscape);
    return {
      escapes,
      stop: () => {
        window.removeEventListener("error", onError);
        process.off("unhandledRejection", onEscape);
        process.off("uncaughtException", onEscape);
      },
    };
  }

  it("rzucający loader celu: strona zostaje, kolejny preload działa", async () => {
    const { router, loaders } = await boot("/a", ["/boom", "/b"]);
    // Błąd loadera w preloadzie router-core zapisuje w dopasowaniu z cache
    // (a błędy poza loaderem loguje `console.error`) - konsola zostaje cicha.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const watch = watchEscapes();
    try {
      hover("/boom");
      await vi.waitFor(() => expect(loaders.boom).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(router.state.status).toBe("idle"));
      await pause(0);

      hover("/b");
      await vi.waitFor(() => expect(loaders.b).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("page-a")).toBeTruthy();
      expect(window.location.pathname).toBe("/a");
      expect(watch.escapes).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it("odrzucona obietnica `preloadRoute` jest połykana", async () => {
    const { router } = await boot("/a", ["/b"]);
    // Zwykła funkcja, NIE `vi.spyOn(...).mockRejectedValue`: szpieg vitest
    // podpina własne `.then` pod zwracaną obietnicę (`mock.settledResults`),
    // więc jej odrzucenie jest „obsłużone" nawet wtedy, gdy `AppLink` puściłby
    // je luzem (np. `void router.preloadRoute(...)` bez `await`) - test by
    // tego nie zobaczył. Tu odrzucenie widzi tylko `AppLink`.
    const original = router.preloadRoute;
    let calls = 0;
    router.preloadRoute = (() => {
      calls += 1;
      return Promise.reject(new Error("sieć padła w trakcie preloadu"));
    }) as typeof router.preloadRoute;
    const watch = watchEscapes();
    try {
      hover("/b");
      await vi.waitFor(() => expect(calls).toBe(1));
      await pause(AFTER_DELAY_MS);
      expect(watch.escapes).toEqual([]);
      expect(screen.getByTestId("page-a")).toBeTruthy();
    } finally {
      watch.stop();
      router.preloadRoute = original;
    }
  });

  it("wyjątek przy przekładaniu adresu na opcje routera też nie ucieka z timera", async () => {
    const { router } = await boot("/a", ["/b?x=1"]);
    const parse = vi.spyOn(router.options, "parseSearch").mockImplementationOnce(() => {
      throw new Error("parser query padł");
    });
    const preload = vi.spyOn(router, "preloadRoute");
    const watch = watchEscapes();
    try {
      hover("/b?x=1");
      await vi.waitFor(() => expect(parse).toHaveBeenCalled());
      await pause(AFTER_DELAY_MS);
      expect(preload).not.toHaveBeenCalled();
      expect(watch.escapes).toEqual([]);
      expect(screen.getByTestId("page-a")).toBeTruthy();
    } finally {
      watch.stop();
    }
  });
});
