// Awaria leniwego chunku listwy prawnej stopki (recenzja 2, B1).
//
// Na kliencie listwa (`LegalLinks`) jest `React.lazy` w wyspie `site-footer`
// (`Footer.tsx`). Gdy jej chunk nie przyjdzie (sieć komórkowa, filtr, wyścig
// z wdrożeniem), odrzucony import rzuca przy renderze. Bez lokalnej granicy
// błędu wyjątek dochodził do globalnego `ErrorBoundary` korzenia i CAŁA strona
// zmieniała się w ekran błędu (odtworzone na artefakcie).
//
// CO TEN PLIK PRZYPINA (HTML serwera w kontenerze, `hydrateRoot`, prawdziwy
// odrzucony `import()` - `vi.doMock` z fabryką, która rzuca, zarejestrowany PO
// statycznym imporcie `Footer`, więc serwer renderuje prawdziwą listwę, a import
// dynamiczny klienta się nie udaje):
//  1. serwer nadal renderuje listwę (gałąź `import.meta.env.SSR` nie zależy od
//     chunku);
//  2. po otwarciu wyspy znika WYŁĄCZNIE listwa - dokument stopki zostaje tym
//     samym węzłem serwera, nic nie dochodzi do korzenia (`onUncaughtError`),
//     granica `footer:legal-links` zostawia znacznik i raportuje błąd;
//  3. wyspa zgłasza odrzucony chunk (`reportError`) - to zgłoszenie widzi
//     globalna siatka przeładowania po chunk-load error (`cacheBusting.ts`).
//
// Osobny plik, bo stan `React.lazy` (rozwiązany albo odrzucony) żyje w module
// `Footer.tsx` - w `footerIsland.test.tsx` ten sam komponent jest rozwiązany.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { BuilderDocument } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  t: null as null | ((lang: "pl" | "en") => unknown),
  boundaryReports: [] as Array<{ error: unknown; context: Record<string, unknown> }>,
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
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/analytics/footerTracking", () => ({
  trackFooterLink: () => {},
  trackFooterNewsletterSubmit: () => {},
}));
vi.mock("@/lib/platform-error-reporting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform-error-reporting")>()),
  reportPlatformError: (error: unknown, context: Record<string, unknown> = {}) => {
    h.boundaryReports.push({ error, context });
  },
}));
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc }: { doc: BuilderDocument }) => (
    <div data-builder-renderer="">
      <section data-sec-id={doc.sections[0]?.id} data-probe="footer-section">
        <a href="/polityka-prywatnosci" data-probe="footer-link">
          Polityka prywatności
        </a>
      </section>
    </div>
  ),
}));

import { realT } from "@/test/i18nReal";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Footer } from "@/components/Footer";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

h.t = (lang) => realT(lang);

// Statyczny import `Footer` (wyżej) załadował już prawdziwy moduł listwy - z niego
// renderuje serwer. Od tej chwili DYNAMICZNY import tego modułu (`lazy` w stopce)
// się nie udaje, jak chunk `legal-links-*.js`, który nie przyszedł.
const CHUNK_ERROR = new TypeError(
  "Failed to fetch dynamically imported module: https://nes.test/assets/legal-links-test.js",
);
vi.doMock("@/components/footer/LegalLinks", () => {
  throw CHUNK_ERROR;
});

const LEGAL_NAV = `nav[aria-label="${String(realT("pl")("footer.legal_nav"))}"]`;

/** Czy `CHUNK_ERROR` jest tym błędem albo jego przyczyną (dowolnie głęboko). */
function causedByChunk(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (current === CHUNK_ERROR) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  constructor(
    private readonly callback: (
      entries: Array<{ isIntersecting: boolean; target: Element }>,
    ) => void,
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

beforeEach(() => {
  frames = [];
  h.boundaryReports.length = 0;
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
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Footer - awaria chunku listwy prawnej (recenzja 2, B1)", () => {
  it("odrzucony import listwy: znika sama listwa, dokument stopki zostaje, nic nie dochodzi do korzenia", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(siteSettingsQueryOptions.queryKey, {
      footer: { builder_data: footerDoc, chrome: { back_to_top: true } },
    });
    const element = (
      <QueryClientProvider client={client}>
        <Footer />
      </QueryClientProvider>
    );

    // 1. Serwer: listwa w HTML-u mimo niedostępnego chunku klienta.
    const host = document.createElement("div");
    vi.stubEnv("SSR", true);
    try {
      host.innerHTML = renderToString(element);
    } finally {
      vi.stubEnv("SSR", false);
    }
    document.body.append(host);
    const serverSection = host.querySelector('[data-probe="footer-section"]');
    expect(serverSection).not.toBeNull();
    expect(host.querySelector(LEGAL_NAV)).not.toBeNull();

    // Zgłoszenia wyspy (`reportError`) i błędy z hydratacji Reacta.
    const islandReports: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => islandReports.push(error));
    const uncaught: unknown[] = [];
    const caught: unknown[] = [];
    const recoverable: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, element, {
        onUncaughtError: (error) => uncaught.push(error),
        onCaughtError: (error) => caught.push(error),
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    roots.push({ root, host });

    // 2. Widoczność otwiera wyspę: gruntowanie `lazy` -> odrzucony import.
    const observer = FakeIntersectionObserver.instances.find((instance) =>
      instance.observed.some((node) => node.getAttribute("data-sec-id") === "ftr-sec-1"),
    );
    expect(observer).toBeDefined();
    await act(async () => observer?.emit());
    // Klatki do wyjścia wyspy ze stanu `pending`, nie stała ich liczba:
    // odrzucenie importu przechodzi przez runner modułów Vitesta, więc pod
    // obciążeniem shardu CI trwa dłużej niż kilka klatek (przebieg
    // 38035498046: `pending` po 4). Czekanie kończy też błąd w korzeniu i
    // zdjęta wyspa - werdykt wydają asercje niżej; błąd rzucony z `act` w
    // `frame()` przerywa test od razu (`vi.waitFor` ponowiłby próbę i go
    // połknął). Limit poniżej `testTimeout` (20 s): wyspa, która się nie
    // uwodni, kończy test asercją stanu, nie przekroczeniem czasu.
    const island = () => host.querySelector('[data-island-id="site-footer"]');
    const deadline = performance.now() + 10_000;
    while (
      uncaught.length === 0 &&
      island()?.getAttribute("data-island-state") === "pending" &&
      performance.now() < deadline
    ) {
      await frame();
    }

    // Nic nie doszło do korzenia (bez granicy: globalny ekran błędu strony).
    expect(uncaught).toEqual([]);
    expect(island()?.getAttribute("data-island-state")).toBe("hydrated");
    // Strona przeżyła: stopka i dokument buildera to te same węzły serwera.
    expect(host.querySelector("footer[data-site-footer]")).not.toBeNull();
    expect(host.querySelector('[data-probe="footer-section"]')).toBe(serverSection);
    // Zniknęła wyłącznie listwa - w jej miejscu znacznik granicy, a błąd w raporcie.
    expect(host.querySelector(LEGAL_NAV)).toBeNull();
    expect(host.querySelector('[data-render-error="footer:legal-links"]')).not.toBeNull();
    expect(caught.some(causedByChunk)).toBe(true);
    expect(
      h.boundaryReports.some(
        (report) => report.context.label === "footer:legal-links" && causedByChunk(report.error),
      ),
    ).toBe(true);
    // Hydratacja porzuciła HTML listwy (najbliższa granica `Suspense`), nie stopki.
    expect(recoverable.every(causedByChunk)).toBe(true);

    // 3. Wyspa zgłosiła odrzucony chunk - sygnał dla siatki przeładowania.
    expect(islandReports.some(causedByChunk)).toBe(true);
  });
});
