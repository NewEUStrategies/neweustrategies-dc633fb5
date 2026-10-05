// Ukryty nagłówek desktopowy jako wyspa hydratacji (P2.3, krytyka planu M10b).
//
// Pełny nagłówek z buildera jest w HTML zawsze, ale poniżej `lg` ma
// `display: none`. Przypinane kontrakty (HTML serwera w kontenerze,
// `hydrateRoot`, węzły serwera śledzone przez tożsamość):
//  1. telefon (zapytanie `(min-width: 64rem)` nie pasuje): nagłówek desktopowy
//     zostaje odwodniony - renderer buildera nie renderuje się w przeglądarce,
//     HTML serwera stoi, a widoczny pasek mobilny hydratuje jak dotąd;
//  2. rozszerzenie okna do `lg`: wyspa uwadnia się przez kolejkę P0.3 na tym
//     samym HTML (bez porzucenia węzłów, bez błędów hydratacji);
//  3. desktop przy starcie i zapisana sesja: hydratacja od razu, jak bez wyspy;
//  4. otoczka wyspy JEST dawnym `div.hidden.lg:block` (te same klasy, dzieci
//     bez dodatkowego poziomu - selektory `.home-header-grow > div > section`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  t: null as null | ((lang: "pl" | "en") => unknown),
  /** Rendery renderera buildera w przeglądarce (poza `renderToString`). */
  clientBuilderRenders: 0,
  server: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.("pl"),
    i18n: { language: "pl", changeLanguage: () => Promise.resolve(), on: () => {}, off: () => {} },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => "pl", setClientLang: () => {} }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
    select({ location: { pathname: "/" }, matches: [] }),
  useRouter: () => ({
    state: { location: { pathname: "/" } },
    navigate: () => Promise.resolve(),
    preloadRoute: () => Promise.resolve(),
  }),
}));
vi.mock("@/lib/ssr/chromeWarmup", () => ({
  ChromeDataGate: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc }: { doc: BuilderDocument }) => {
    if (!h.server) h.clientBuilderRenders += 1;
    return (
      <div data-builder-renderer="">
        <section data-sec-id={doc.sections[0]?.id} data-probe="desktop-section" />
      </div>
    );
  },
}));
vi.mock("@/components/header/TrendingTicker", () => ({ TrendingTicker: () => null }));
vi.mock("@/components/AdSlot", () => ({ AdZone: () => null }));
vi.mock("@/components/header/mobile/MobileDrawerBody", () => ({
  MobileDrawerBody: () => <div data-testid="drawer-body" />,
}));

import { realT } from "@/test/i18nReal";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Header } from "@/components/Header";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

h.t = (lang) => realT(lang);

const DESKTOP_QUERY = "(min-width: 64rem)";

type MediaListener = (event: { matches: boolean; media: string }) => void;

class FakeMediaQueryList {
  readonly listeners = new Set<MediaListener>();
  constructor(
    readonly media: string,
    public matches: boolean,
  ) {}
  addEventListener(_type: string, listener: MediaListener): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: MediaListener): void {
    this.listeners.delete(listener);
  }
  change(matches: boolean): void {
    this.matches = matches;
    for (const listener of [...this.listeners]) listener({ matches, media: this.media });
  }
}

const mediaLists = new Map<string, FakeMediaQueryList>();

function installMatchMedia(desktop: boolean): void {
  mediaLists.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      let list = mediaLists.get(query);
      if (!list) {
        list = new FakeMediaQueryList(query, query === DESKTOP_QUERY ? desktop : false);
        mediaLists.set(query, list);
      }
      return list;
    },
  });
}

let frames: FrameRequestCallback[] = [];

/** Jedna klatka kolejki P0.3 (rAF -> krok w makrozadaniu) i praca Reacta. */
async function frame(): Promise<void> {
  await act(async () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const doc: BuilderDocument = {
  version: 1,
  sections: [{ id: "hdr-sec-1", kind: "section", children: [] }],
};

function app(client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

interface Mounted {
  readonly container: HTMLDivElement;
  readonly errors: unknown[];
  readonly serverSection: Element;
  island(): HTMLElement;
}

const roots: Root[] = [];

async function hydrateHeader(): Promise<Mounted> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, { header: { builder_data: doc } });
  const element = app(client);
  const container = document.createElement("div");
  h.server = true;
  vi.stubEnv("SSR", true);
  try {
    container.innerHTML = renderToString(element);
  } finally {
    vi.stubEnv("SSR", false);
    h.server = false;
  }
  document.body.append(container);
  const serverSection = container.querySelector('[data-probe="desktop-section"]');
  if (!serverSection) throw new Error("brak nagłówka desktopowego w HTML serwera");
  const errors: unknown[] = [];
  await act(async () => {
    roots.push(hydrateRoot(container, element, { onRecoverableError: (e) => errors.push(e) }));
  });
  await frame();
  const island = (): HTMLElement => {
    const found = container.querySelector<HTMLElement>('[data-island-id="hdr-desktop"]');
    if (!found) throw new Error("brak wyspy hdr-desktop");
    return found;
  };
  return { container, errors, serverSection, island };
}

beforeEach(() => {
  frames = [];
  h.clientBuilderRenders = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  Reflect.deleteProperty(window, "matchMedia");
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Header - ukryty nagłówek desktopowy jako wyspa (P2.3)", () => {
  it("otoczka wyspy to dawny div.hidden.lg:block, renderer buildera jej bezpośrednim dzieckiem", async () => {
    installMatchMedia(false);
    const page = await hydrateHeader();
    const island = page.island();
    expect(island.className.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "lg:block", "home-header-grow"]),
    );
    expect(island.firstElementChild?.hasAttribute("data-builder-renderer")).toBe(true);
    expect(page.errors).toEqual([]);
  });

  it("telefon: nagłówek desktopowy zostaje odwodniony, pasek mobilny jest interaktywny", async () => {
    installMatchMedia(false);
    const page = await hydrateHeader();
    for (let i = 0; i < 3; i += 1) await frame();
    expect(page.island().getAttribute("data-island-state")).toBe("pending");
    expect(h.clientBuilderRenders).toBe(0);
    expect(page.container.querySelector('[data-probe="desktop-section"]')).toBe(page.serverSection);
    // Widoczna nawigacja telefonu: hamburger otwiera szufladę (hydratacja paska).
    const burger = page.container.querySelector<HTMLButtonElement>(
      'button[aria-controls="mobile-header-drawer"]',
    );
    expect(burger).not.toBeNull();
    await act(async () => burger?.click());
    expect(document.getElementById("mobile-header-drawer")).not.toBeNull();
    expect(page.errors).toEqual([]);
  });

  it("rozszerzenie okna do lg: wyspa uwadnia się na tym samym HTML serwera", async () => {
    installMatchMedia(false);
    const page = await hydrateHeader();
    expect(page.island().getAttribute("data-island-state")).toBe("pending");
    const list = mediaLists.get(DESKTOP_QUERY);
    if (!list) throw new Error("wyspa nie pytała o zapytanie lg");
    await act(async () => list.change(true));
    for (
      let i = 0;
      i < 4 && page.island().getAttribute("data-island-state") !== "hydrated";
      i += 1
    ) {
      await frame();
    }
    expect(page.island().getAttribute("data-island-state")).toBe("hydrated");
    expect(h.clientBuilderRenders).toBeGreaterThan(0);
    expect(page.container.querySelector('[data-probe="desktop-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });

  it("desktop przy starcie: hydratacja od razu, bez czekania na kolejkę", async () => {
    installMatchMedia(true);
    const page = await hydrateHeader();
    expect(page.island().getAttribute("data-island-state")).toBe("hydrated");
    expect(page.container.querySelector('[data-probe="desktop-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });

  it("zapisana sesja na telefonie: hydratacja od razu (kontekst sesji i tak się zmieni)", async () => {
    installMatchMedia(false);
    window.localStorage.setItem("sb-fixture-auth-token", JSON.stringify({ access_token: "x" }));
    const page = await hydrateHeader();
    expect(page.island().getAttribute("data-island-state")).toBe("hydrated");
    expect(page.container.querySelector('[data-probe="desktop-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });
});
