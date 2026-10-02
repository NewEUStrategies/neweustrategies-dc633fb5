// ODROCZONE GENERATORY CSS BLOKÓW `<style>` KORZENIA (audyt PSI 2026-10-02).
//
// Kontrakt, który tu przypinamy, dla KAŻDEGO z czterech komponentów:
//   1. serwer renderuje blok z prawdziwych danych (generator liczy się na
//      serwerze, synchronicznie);
//   2. klient przy hydratacji odtwarza DOKŁADNIE ten HTML bez jednego
//      wywołania generatora i bez ostrzeżeń o niezgodności hydratacji;
//   3. dopiero zmiana danych po hydratacji dociąga generator (`import()`),
//      przelicza CSS i podmienia skrót `data-css-hash`;
//   4. blok bez skrótu (HTML z brzegu sprzed wdrożenia) i render bez SSR
//      kończą się przeliczeniem, nigdy pustym dokumentem.
//
// Vitest nie uruchamia kompilatora Start, więc gałąź `createIsomorphicFn`
// wybieramy sami (wzorzec: widget-view/__tests__/serverWidgetShell): `SSR=true`
// to serwer (generator synchroniczny), `SSR=false` to przeglądarka (`null`).
// Generator śledzimy przez `vi.mock` opakowujące prawdziwy moduł. Fabryka
// mocka biegnie RAZ na plik (`vi.resetModules()` jej nie powtarza), więc
// licznik wywołań żyje w `vi.hoisted` i jest zerowany jawnie na granicy faz.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pl" } }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));

/** Wywołania generatorów: nazwa generatora per wywołanie. */
const h = vi.hoisted(() => ({ calls: [] as string[] }));
const generatorCalls = (name: string) => h.calls.filter((c) => c === name).length;

vi.mock("@/components/theme/css/designTokensCss", async (orig) => {
  const m = await orig<typeof import("../css/designTokensCss")>();
  return {
    ...m,
    designTokensStyleCss: (input: Parameters<typeof m.designTokensStyleCss>[0]) => {
      h.calls.push("designTokens");
      return m.designTokensStyleCss(input);
    },
  };
});
vi.mock("@/components/theme/css/themeOptionsCss", async (orig) => {
  const m = await orig<typeof import("../css/themeOptionsCss")>();
  return {
    ...m,
    themeOptionsStyleCss: (input: Parameters<typeof m.themeOptionsStyleCss>[0]) => {
      h.calls.push("themeOptions");
      return m.themeOptionsStyleCss(input);
    },
  };
});
vi.mock("@/components/theme/css/themeDesignCss", async (orig) => {
  const m = await orig<typeof import("../css/themeDesignCss")>();
  return {
    ...m,
    themeDesignStyleCss: (input: Parameters<typeof m.themeDesignStyleCss>[0]) => {
      h.calls.push("themeDesign");
      return m.themeDesignStyleCss(input);
    },
  };
});
vi.mock("@/components/theme/css/themeFontSizesCss", async (orig) => {
  const m = await orig<typeof import("../css/themeFontSizesCss")>();
  return {
    ...m,
    themeFontSizesStyleCss: (input: unknown) => {
      h.calls.push("themeFontSizes");
      return m.themeFontSizesStyleCss(input);
    },
  };
});

const SETTINGS_KEY = ["site_settings_public", "all"] as const;
const DESIGN_TOKENS_KEY = ["site_design_tokens"] as const;
const GLOBAL_COLORS_KEY = ["site_global_colors"] as const;
const FONT_SCALE_KEY = ["site_font_scale"] as const;

interface Case {
  name: string;
  marker: string;
  /** Moduł komponentu - importowany PO `vi.resetModules()`. */
  component: () => Promise<() => ReactNode>;
  /** Nazwa generatora w liczniku `h.calls`. */
  generator: string;
  seed: (qc: QueryClient) => void;
  /** Fragment CSS z danych zasiewu. */
  seeded: string;
  change: (qc: QueryClient) => void;
  /** Fragment CSS po zmianie. */
  changed: string;
}

const CASES: Case[] = [
  {
    name: "ThemeDesignStyle",
    marker: "data-theme-design",
    component: async () => (await import("../ThemeDesignStyle")).ThemeDesignStyle,
    generator: "themeDesign",
    seed: (qc) =>
      qc.setQueryData(SETTINGS_KEY, { theme_design: { blockHeading: { fontSize: "11px" } } }),
    seeded: "--td-bh-size:11px;",
    change: (qc) =>
      qc.setQueryData(SETTINGS_KEY, { theme_design: { blockHeading: { fontSize: "22px" } } }),
    changed: "--td-bh-size:22px;",
  },
  {
    name: "ThemeFontSizesStyle",
    marker: "data-theme-font-sizes",
    component: async () => (await import("../ThemeFontSizesStyle")).ThemeFontSizesStyle,
    generator: "themeFontSizes",
    seed: (qc) =>
      qc.setQueryData(SETTINGS_KEY, { font_sizes: { body: { size: 19, lineHeight: 1.7 } } }),
    seeded: "--fs-body:19px;",
    change: (qc) =>
      qc.setQueryData(SETTINGS_KEY, { font_sizes: { body: { size: 21, lineHeight: 1.7 } } }),
    changed: "--fs-body:21px;",
  },
  {
    name: "ThemeOptionsStyle",
    marker: "data-theme-options",
    component: async () => (await import("@/components/ThemeOptionsStyle")).ThemeOptionsStyle,
    generator: "themeOptions",
    seed: (qc) => qc.setQueryData(SETTINGS_KEY, { theme_options: { toggles: { width: 56 } } }),
    seeded: "--to-toggle-w: 56px;",
    change: (qc) => qc.setQueryData(SETTINGS_KEY, { theme_options: { toggles: { width: 61 } } }),
    changed: "--to-toggle-w: 61px;",
  },
  {
    name: "DesignTokensStyle",
    marker: "data-brand-tokens",
    component: async () => (await import("@/components/DesignTokensStyle")).DesignTokensStyle,
    generator: "designTokens",
    seed: (qc) => {
      qc.setQueryData(DESIGN_TOKENS_KEY, {
        colors: [{ name: "primary", value: "#123456" }],
        fonts: {},
        scale: {},
      });
      qc.setQueryData(GLOBAL_COLORS_KEY, {});
      qc.setQueryData(FONT_SCALE_KEY, {});
    },
    seeded: "--brand-primary: #123456;",
    change: (qc) => qc.setQueryData(GLOBAL_COLORS_KEY, { "header-icon": { light: "#abcdef" } }),
    changed: "--gc-header-icon: #abcdef;",
  },
];

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

function Providers({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Faza serwerowa: generator synchroniczny, HTML z `renderToString`. */
async function renderOnServer(c: Case, qc: QueryClient) {
  vi.stubEnv("SSR", true);
  vi.resetModules();
  h.calls = [];
  const { renderToString } = await import("react-dom/server");
  const Component = await c.component();
  const html = renderToString(
    <Providers qc={qc}>
      <Component />
    </Providers>,
  );
  return { html, serverCalls: generatorCalls(c.generator) };
}

/** Faza kliencka: generator niedostępny synchronicznie (jak w przeglądarce). */
async function loadOnClient(c: Case) {
  vi.stubEnv("SSR", false);
  vi.resetModules();
  h.calls = [];
  const Component = await c.component();
  return { Component, calls: () => generatorCalls(c.generator) };
}

function mountSsrHtml(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

const styleIn = (root: ParentNode, marker: string) =>
  root.querySelector<HTMLStyleElement>(`style[${marker}]`);

/**
 * Ostrzeżenia hydratacji z console.error - z jednym, UDOWODNIONYM wyjątkiem.
 *
 * Deweloperski React porównuje `dangerouslySetInnerHTML` tak: ustawia
 * `innerHTML` na zapasowym elemencie tego samego tagu i czyta go z powrotem
 * (`normalizeHTML`). W przeglądarce `<style>` jest elementem „raw text" na obu
 * drogach, więc wynik jest identyczny z treścią sparsowaną z HTML-a serwera.
 * happy-dom parsuje jednak SETTER `innerHTML` na `<style>` jak znaczniki
 * (komentarz CSS `<a href>` z katalogu kolorów globalnych wraca jako
 * `<a href="">`), więc zgłasza niezgodność atrybutów, której w DOM-ie NIE MA -
 * sprawdza to twarda asercja `container.innerHTML === html` tuż wyżej.
 * Tolerujemy więc WYŁĄCZNIE to ostrzeżenie i WYŁĄCZNIE wtedy, gdy sonda
 * potwierdza, że setter happy-dom zmienia ten konkretny CSS.
 */
function hydrationWarnings(errors: { mock: { calls: unknown[][] } }, css: string): string[] {
  const scratch = document.createElement("style");
  scratch.innerHTML = css;
  const happyDomRewritesStyle = scratch.innerHTML !== css;
  return errors.mock.calls
    .map((args) => String(args[0]))
    .filter(
      (message) =>
        !(happyDomRewritesStyle && message.startsWith("A tree hydrated but some attributes")),
    );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe.each(CASES)("$name - odroczony generator CSS", (c) => {
  it("serwer renderuje blok z prawdziwych danych i stempluje skrót wejścia", async () => {
    const qc = makeClient();
    c.seed(qc);
    const { html, serverCalls } = await renderOnServer(c, qc);
    expect(serverCalls).toBe(1);
    expect(html).toContain(c.seeded);
    expect(html).toMatch(/data-css-hash="[0-9a-z]+"/);
  });

  it("hydratacja odtwarza HTML serwera bajt w bajt BEZ wywołania generatora", async () => {
    const qc = makeClient();
    c.seed(qc);
    const { html } = await renderOnServer(c, qc);

    const { Component, calls } = await loadOnClient(c);
    const container = mountSsrHtml(html);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Providers qc={qc}>
        <Component />
      </Providers>,
      { container, hydrate: true },
    );

    expect(container.innerHTML).toBe(html);
    // Efekty już przebiegły (`render` jest w `act`), a skrót się zgadza - nic
    // nie poszło po generator, ani synchronicznie, ani przez `import()`.
    await act(async () => {});
    expect(calls()).toBe(0);
    // React 19 zgłasza niezgodności hydratacji przez console.error.
    expect(hydrationWarnings(errors, styleIn(container, c.marker)?.textContent ?? "")).toEqual([]);
  });

  it("zmiana danych po hydratacji dociąga generator i przelicza blok", async () => {
    const qc = makeClient();
    c.seed(qc);
    const { html } = await renderOnServer(c, qc);

    const { Component, calls } = await loadOnClient(c);
    const container = mountSsrHtml(html);
    render(
      <Providers qc={qc}>
        <Component />
      </Providers>,
      { container, hydrate: true },
    );
    const before = styleIn(container, c.marker)?.getAttribute("data-css-hash");

    act(() => c.change(qc));
    await waitFor(() => expect(calls()).toBe(1));
    await waitFor(() => expect(styleIn(container, c.marker)?.textContent).toContain(c.changed));
    expect(styleIn(container, c.marker)?.getAttribute("data-css-hash")).not.toBe(before);
    // Ten sam stan danych drugi raz nie liczy niczego na nowo.
    act(() => c.change(qc));
    await act(async () => {});
    expect(calls()).toBe(1);
  });

  it("HTML z brzegu BEZ skrótu (sprzed wdrożenia) zostaje przeliczony po hydratacji", async () => {
    const qc = makeClient();
    c.seed(qc);
    const { html } = await renderOnServer(c, qc);
    const legacyHtml = html.replace(/ data-css-hash="[0-9a-z]+"/, "");
    expect(legacyHtml).not.toBe(html);

    const { Component, calls } = await loadOnClient(c);
    const container = mountSsrHtml(legacyHtml);
    render(
      <Providers qc={qc}>
        <Component />
      </Providers>,
      { container, hydrate: true },
    );
    await waitFor(() => expect(calls()).toBe(1));
    await waitFor(() =>
      expect(styleIn(container, c.marker)?.getAttribute("data-css-hash")).toMatch(/[0-9a-z]+/),
    );
    expect(styleIn(container, c.marker)?.textContent).toContain(c.seeded);
  });

  it("render bez SSR emituje pusty blok, a potem dociąga generator", async () => {
    const qc = makeClient();
    c.seed(qc);
    const { Component, calls } = await loadOnClient(c);
    const { container } = render(
      <Providers qc={qc}>
        <Component />
      </Providers>,
    );
    // Blok jest w dokumencie od pierwszego renderu - tylko bez treści.
    expect(styleIn(container, c.marker)).not.toBeNull();
    await waitFor(() => expect(calls()).toBe(1));
    await waitFor(() => expect(styleIn(container, c.marker)?.textContent).toContain(c.seeded));
  });
});

describe("ThemeDesignStyle - wpisy pochodne z cache'u (podgląd na żywo panelu)", () => {
  it("zapis pod kluczem pochodnym ma pierwszeństwo przed wierszem z mapy ustawień", async () => {
    const c = CASES[0];
    const qc = makeClient();
    c.seed(qc);
    const { html } = await renderOnServer(c, qc);
    const { Component, calls } = await loadOnClient(c);
    const container = mountSsrHtml(html);
    render(
      <Providers qc={qc}>
        <Component />
      </Providers>,
      { container, hydrate: true },
    );
    await act(async () => {});
    expect(calls()).toBe(0);

    // Dokładnie to robi `useLiveThemeDesignPreview` / `useSaveThemeDesign`.
    act(() => {
      qc.setQueryData(["site_settings", "theme_design"], {
        blockHeading: { fontSize: "33px" },
      });
    });
    await waitFor(() =>
      expect(styleIn(container, c.marker)?.textContent).toContain("--td-bh-size:33px;"),
    );
    expect(calls()).toBe(1);
  });
});
