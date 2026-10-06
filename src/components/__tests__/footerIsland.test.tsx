// Stopka jedną wyspą hydratacji (P2.2).
//
// CO JEST PRZYPINANE (HTML serwera w kontenerze, `hydrateRoot`, węzły serwera
// śledzone przez tożsamość):
//  1. HTML serwera: `<footer>` -> otoczka wyspy `site-footer` w stanie
//     `pending` -> renderer buildera; bez fallbacku wyspy; `BackToTop` poza
//     wyspą (pływający przycisk hydratuje z resztą strony).
//  2. Hydratacja gościa: renderer stopki NIE renderuje się w przeglądarce, HTML
//     serwera stoi, a re-render stopki (nowy obiekt ustawień, ten sam dokument)
//     kończy się na `memo` wyspy przed jej odwodnioną granicą.
//  3. Widoczność (IO, ekran zapasu w dół) otwiera wyspę przez kolejkę P0.3 na
//     tym samym HTML.
//  4. Dotknięcie linku w czekającej stopce: tor pilny otwiera wyspę przed
//     `click`, a telemetria linków (`<footer>` poza wyspą) dostaje klik.
//  5. Zapisana sesja: hydratacja od razu, jak bez wyspy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  t: null as null | ((lang: "pl" | "en") => unknown),
  server: false,
  /** Rendery renderera buildera w przeglądarce (poza `renderToString`). */
  clientRenders: 0,
  linkEvents: [] as unknown[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.("pl"),
    i18n: { language: "pl", on: () => {}, off: () => {} },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => "pl", setClientLang: () => {} }));
vi.mock("@/lib/ssr/chromeWarmup", () => ({
  ChromeDataGate: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("@/lib/analytics/footerTracking", () => ({
  trackFooterLink: (payload: unknown) => {
    h.linkEvents.push(payload);
  },
  trackFooterNewsletterSubmit: () => {},
}));
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc }: { doc: BuilderDocument }) => {
    if (!h.server) h.clientRenders += 1;
    return (
      <div data-builder-renderer="">
        <section data-sec-id={doc.sections[0]?.id} data-probe="footer-section">
          <a href="/regulamin" data-probe="footer-link">
            Regulamin
          </a>
        </section>
      </div>
    );
  },
}));

import { realT } from "@/test/i18nReal";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Footer } from "@/components/Footer";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

h.t = (lang) => realT(lang);

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  constructor(
    private readonly callback: (
      entries: Array<{ isIntersecting: boolean; target: Element }>,
    ) => void,
    readonly options: { rootMargin?: string } = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
  emit(): void {
    this.callback(this.observed.map((target) => ({ isIntersecting: true, target })));
  }
}

let frames: FrameRequestCallback[] = [];

async function frame(): Promise<void> {
  await act(async () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const footerDoc: BuilderDocument = {
  version: 1,
  sections: [{ id: "ftr-sec-1", kind: "section", children: [] }],
};

const roots: Array<{ root: Root; host: HTMLElement }> = [];

async function hydrateFooter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    footer: { builder_data: footerDoc, chrome: { back_to_top: true } },
  });
  const element = (
    <QueryClientProvider client={client}>
      <Footer />
    </QueryClientProvider>
  );
  const host = document.createElement("div");
  h.server = true;
  vi.stubEnv("SSR", true);
  try {
    host.innerHTML = renderToString(element);
  } finally {
    vi.stubEnv("SSR", false);
    h.server = false;
  }
  document.body.append(host);
  const serverSection = host.querySelector('[data-probe="footer-section"]');
  const errors: unknown[] = [];
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(host, element, { onRecoverableError: (e) => errors.push(e) });
  });
  roots.push({ root, host });
  const island = () => host.querySelector<HTMLElement>('[data-island-id="site-footer"]');
  return { host, client, errors, serverSection, island };
}

beforeEach(() => {
  frames = [];
  h.clientRenders = 0;
  h.linkEvents.length = 0;
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
});

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  window.localStorage.clear();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Footer - stopka jedną wyspą hydratacji (P2.2)", () => {
  it("HTML serwera: <footer> -> wyspa `site-footer` (`pending`) -> renderer; bez fallbacku; BackToTop poza wyspą", async () => {
    const page = await hydrateFooter();
    const island = page.island();
    expect(island?.parentElement?.matches("footer[data-site-footer]")).toBe(true);
    expect(island?.getAttribute("data-island-state")).toBe("pending");
    expect(island?.firstElementChild?.hasAttribute("data-builder-renderer")).toBe(true);
    expect(page.host.innerHTML).not.toContain("data-island-fallback");
    const backToTop = page.host.querySelector("footer[data-site-footer] ~ *");
    expect(backToTop === null || island?.contains(backToTop) === false).toBe(true);
    expect(page.errors).toEqual([]);
  });

  it("gość: renderer stopki nie renderuje się w przeglądarce, HTML stoi; re-render stopki nie dociera do wyspy", async () => {
    const page = await hydrateFooter();
    for (let i = 0; i < 3; i += 1) await frame();

    expect(page.island()?.getAttribute("data-island-state")).toBe("pending");
    expect(h.clientRenders).toBe(0);
    expect(page.host.querySelector('[data-probe="footer-section"]')).toBe(page.serverSection);

    // Nowy obiekt ustawień z tym samym dokumentem stopki (np. odświeżone
    // zapytanie o ustawienia): stopka się renderuje, wyspa - nie.
    await act(async () => {
      page.client.setQueryData(siteSettingsQueryOptions.queryKey, {
        footer: { builder_data: footerDoc, chrome: { back_to_top: true } },
        other: { touched: true },
      });
    });
    expect(page.island()?.getAttribute("data-island-state")).toBe("pending");
    expect(h.clientRenders).toBe(0);
    expect(page.host.querySelector('[data-probe="footer-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });

  it("widoczność (IO, ekran zapasu w dół): wyspa otwiera się przez kolejkę na tym samym HTML", async () => {
    const page = await hydrateFooter();
    const observer = FakeIntersectionObserver.instances.find((instance) =>
      instance.observed.some((node) => node.getAttribute("data-sec-id") === "ftr-sec-1"),
    );
    expect(observer?.options.rootMargin).toBe("0px 0px 100% 0px");

    await act(async () => observer?.emit());
    expect(page.island()?.getAttribute("data-island-state")).toBe("pending");
    for (let i = 0; i < 3; i += 1) await frame();

    expect(page.island()?.getAttribute("data-island-state")).toBe("hydrated");
    expect(h.clientRenders).toBeGreaterThan(0);
    expect(page.host.querySelector('[data-probe="footer-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });

  it("dotknięcie linku w czekającej stopce: tor pilny otwiera wyspę przed `click`, telemetria dostaje klik", async () => {
    const page = await hydrateFooter();
    const link = page.host.querySelector<HTMLAnchorElement>('[data-probe="footer-link"]');
    if (!link) throw new Error("brak linku stopki");
    link.addEventListener("click", (event) => event.preventDefault());

    await act(async () => {
      link.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(page.island()?.getAttribute("data-island-state")).toBe("hydrated");
    expect(h.linkEvents).toHaveLength(1);
    expect(page.host.querySelector('[data-probe="footer-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });

  it("zapisana sesja: hydratacja od razu, jak bez wyspy", async () => {
    window.localStorage.setItem("sb-fixture-auth-token", JSON.stringify({ access_token: "x" }));
    const page = await hydrateFooter();
    expect(page.island()?.getAttribute("data-island-state")).toBe("hydrated");
    expect(page.host.querySelector('[data-probe="footer-section"]')).toBe(page.serverSection);
    expect(page.errors).toEqual([]);
  });
});
