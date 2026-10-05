// Wyszukiwarka i konto z rejestru `lazyWidgets` jako wyspy na intencję (P2.3).
//
// Przypinane kontrakty (prawdziwy rejestr i prawdziwa wyspa P1.6, liście
// widgetów jako atrapy):
//  1. serwer renderuje wyszukiwarkę, konto i animowany nagłówek sekcji w
//     PIERWSZEJ powłoce (bez granicy dociąganej na końcu dokumentu - źródło
//     przesunięć wiersza nagłówka i sekcji `…0029` w bramce fali 1), a obie
//     wyspy mają w HTML stan `pending`;
//  2. w przeglądarce wyspa czeka na intencję: bez niej liść widgetu nie
//     renderuje się, a HTML serwera stoi; fokus w polu, najechanie na konto i
//     klawisz `/` uwadniają wyspę na tym samym HTML (bez porzucenia węzłów);
//  3. zapisana sesja: obie wyspy od razu (zalogowany ma swój awatar po starcie).
//
// Serwer i klient to dwie instancje rejestru (`vi.resetModules`): Vitest nie
// uruchamia kompilatora Start, więc ramię `createIsomorphicFn` wybiera atrapa
// po `import.meta.env.SSR` - jak w `serverWidgetShell.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ server: false, searchRenders: 0, accountRenders: 0 }));

vi.mock("../SearchButtonWidget", () => ({
  SearchButtonWidget: ({ label }: { label: string }) => {
    if (!h.server) h.searchRenders += 1;
    return (
      <div className="builder-search-widget" data-probe="search">
        <input type="search" aria-label={label} data-probe="search-input" />
      </div>
    );
  },
}));
vi.mock("../AccountMenuWidget", () => ({
  AccountMenuWidget: () => {
    if (!h.server) h.accountRenders += 1;
    return (
      <div className="relative inline-flex" data-probe="account">
        <button type="button" data-probe="account-button">
          Zaloguj
        </button>
      </div>
    );
  },
}));
vi.mock("@/lib/builder/animatedHeadingVariants", () => ({
  AnimatedHeadingRender: () => <h2 data-probe="animated-heading">Nagłówek</h2>,
}));
// Pozostałe liście pierwszej powłoki - poza zakresem tego pliku.
vi.mock("../RichHtmlView", () => ({ RichHtmlView: () => null }));
vi.mock("@/components/blocks/ContactFormView", () => ({ ContactFormView: () => null }));
vi.mock("../PostListView", () => ({ PostListView: () => null }));
vi.mock("../PostsSliderWidget", () => ({ PostsSliderWidget: () => null }));
vi.mock("../RatedListView", () => ({ RatedListView: () => null }));
vi.mock("@/lib/builder/sectionLabelVariants", () => ({ SectionLabelWidgetView: () => null }));
vi.mock("../TailoredMustReadsView", () => ({ TailoredMustReadsView: () => null }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));
// Zapas ciszy poza zakresem: wyspa ma się otworzyć wyłącznie na intencję.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

type Registry = typeof import("../lazyWidgets");

async function registry(ssr: boolean): Promise<Registry> {
  vi.stubEnv("SSR", ssr);
  vi.resetModules();
  return import("../lazyWidgets");
}

function header(widgets: Registry): ReactElement {
  return (
    <div data-row="">
      <widgets.SearchButtonWidget
        label="Szukaj"
        mode="dropdown"
        heading=""
        liveResults
        limit={8}
        lang="pl"
        height={36}
        radius={6}
        fontSize={14}
      />
      <widgets.AccountMenuWidget config={{}} lang="pl" />
    </div>
  );
}

let frames: FrameRequestCallback[] = [];

/** Klatka kolejki P0.3, makrozadanie kroku i praca Reacta w `act`. */
async function frame(): Promise<void> {
  await act(async () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface Page {
  readonly container: HTMLDivElement;
  readonly errors: unknown[];
  readonly root: Root;
  island(prefix: string): HTMLElement;
  probe(name: string): Element | null;
}

const pages: Page[] = [];

async function hydratePage(): Promise<{ page: Page; server: Map<string, Element> }> {
  h.server = true;
  const html = renderToString(header(await registry(true)));
  h.server = false;
  const client = header(await registry(false));
  vi.stubEnv("SSR", false);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const server = new Map(
    Array.from(container.querySelectorAll("[data-probe]"), (node) => [
      node.getAttribute("data-probe") ?? "",
      node,
    ]),
  );
  const errors: unknown[] = [];
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(container, client, { onRecoverableError: (e) => errors.push(e) });
  });
  await frame();
  const page: Page = {
    container,
    errors,
    root,
    island: (prefix) => {
      const found = container.querySelector<HTMLElement>(`[data-island-id^="${prefix}"]`);
      if (!found) throw new Error(`brak wyspy ${prefix}`);
      return found;
    },
    probe: (name) => container.querySelector(`[data-probe="${name}"]`),
  };
  pages.push(page);
  return { page, server };
}

/** Wyspa uwodniona; kilka klatek na chunk (`import()` atrapy) i kolejkę. */
async function untilHydrated(page: Page, prefix: string): Promise<void> {
  for (
    let i = 0;
    i < 8 && page.island(prefix).getAttribute("data-island-state") !== "hydrated";
    i++
  ) {
    await frame();
  }
}

beforeEach(() => {
  frames = [];
  h.searchRenders = 0;
  h.accountRenders = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(async () => {
  for (const page of pages.splice(0)) await act(async () => page.root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("wyszukiwarka i konto w nagłówku: pierwsza powłoka serwera (P2.3)", () => {
  it("serwer renderuje widgety nagłówka i animowany nagłówek bez dociągania", async () => {
    h.server = true;
    const widgets = await registry(true);
    const html = renderToString(
      <>
        {header(widgets)}
        <widgets.AnimatedHeadingRender config={{}} />
      </>,
    );
    h.server = false;
    expect(html).toContain('data-probe="search-input"');
    expect(html).toContain('data-probe="account-button"');
    expect(html).toContain('data-probe="animated-heading"');
    // `<!--$!-->` = granica zawieszona na serwerze (klient dociągnąłby treść).
    expect(html).not.toContain("<!--$!-->");
    const box = document.createElement("div");
    box.innerHTML = html;
    for (const prefix of ["hdr-search", "hdr-account"]) {
      const island = box.querySelector(`[data-island-id^="${prefix}"]`);
      expect(island?.getAttribute("data-island-state"), prefix).toBe("pending");
    }
  });
});

describe("wyszukiwarka i konto w nagłówku: wyspy na intencję (P2.3)", () => {
  it("bez intencji obie wyspy czekają, a HTML serwera stoi", async () => {
    const { page, server } = await hydratePage();
    for (let i = 0; i < 3; i += 1) await frame();
    expect(page.island("hdr-search").getAttribute("data-island-state")).toBe("pending");
    expect(page.island("hdr-account").getAttribute("data-island-state")).toBe("pending");
    expect(h.searchRenders).toBe(0);
    expect(h.accountRenders).toBe(0);
    expect(page.probe("search-input")).toBe(server.get("search-input"));
    expect(page.errors).toEqual([]);
  });

  it("fokus w polu uwadnia wyszukiwarkę na tym samym HTML; konto czeka dalej", async () => {
    const { page, server } = await hydratePage();
    const input = page.probe("search-input");
    if (!(input instanceof HTMLInputElement)) throw new Error("brak pola");
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await untilHydrated(page, "hdr-search");
    expect(page.island("hdr-search").getAttribute("data-island-state")).toBe("hydrated");
    expect(h.searchRenders).toBeGreaterThan(0);
    expect(page.probe("search-input")).toBe(server.get("search-input"));
    expect(page.island("hdr-account").getAttribute("data-island-state")).toBe("pending");
    expect(page.errors).toEqual([]);
  });

  it("klawisz / z dowolnego miejsca uwadnia wyszukiwarkę", async () => {
    const { page } = await hydratePage();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    await untilHydrated(page, "hdr-search");
    expect(page.island("hdr-search").getAttribute("data-island-state")).toBe("hydrated");
    expect(page.island("hdr-account").getAttribute("data-island-state")).toBe("pending");
    expect(page.errors).toEqual([]);
  });

  it("najechanie na konto uwadnia jego wyspę na tym samym HTML", async () => {
    const { page, server } = await hydratePage();
    const button = page.probe("account-button");
    if (!button) throw new Error("brak przycisku konta");
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await untilHydrated(page, "hdr-account");
    expect(page.island("hdr-account").getAttribute("data-island-state")).toBe("hydrated");
    expect(h.accountRenders).toBeGreaterThan(0);
    expect(page.probe("account-button")).toBe(server.get("account-button"));
    expect(page.errors).toEqual([]);
  });

  it("zapisana sesja: obie wyspy uwadniają się od razu", async () => {
    window.localStorage.setItem("sb-fixture-auth-token", JSON.stringify({ access_token: "x" }));
    const { page } = await hydratePage();
    await untilHydrated(page, "hdr-account");
    await untilHydrated(page, "hdr-search");
    expect(page.island("hdr-search").getAttribute("data-island-state")).toBe("hydrated");
    expect(page.island("hdr-account").getAttribute("data-island-state")).toBe("hydrated");
    expect(page.errors).toEqual([]);
  });
});
