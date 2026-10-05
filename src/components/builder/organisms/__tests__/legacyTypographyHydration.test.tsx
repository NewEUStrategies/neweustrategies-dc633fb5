// Blok generatora typografii ramki (właściwości spoza szablonu HW-2) przy
// HYDRATACJI - P2.4.
//
// KONTRAKT (ten sam co arkusze korzenia z `useDeferredStyleCss`, P1.2):
//   1. serwer liczy blok generatorem synchronicznie i dopisuje `data-css-hash`;
//   2. klient hydratuje DOKŁADNIE ten HTML bez wywołania generatora (generator
//      nie siedzi w chunku wejściowym - strażnik `check:entry-purity`);
//   3. zmiana danych po hydratacji dociąga generator przez `import()`, a do
//      tego czasu na ekranie zostaje blok z HTML-a;
//   4. render czysto kliencki (bez bloku w DOM-ie) czeka na generator zamiast
//      malować widget bez typografii;
//   5. w edytorze (kanwa, `BuilderModeProvider`) ramka dociąga generator przy
//      montażu, więc zapis dokumentu (aktualizacja synchroniczna) z pierwszą
//      w sesji właściwością spoza szablonu NIE pokazuje fallbacku kanwy
//      (recenzja P2.4 m3); kontrapunkt - ta sama sekwencja poza edytorem się
//      zawiesza.
// Gałąź `createIsomorphicFn` wybieramy sami (wzorzec: theme/__tests__/deferredStyleCss).
import { Suspense, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetNode, WidgetTypography } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));

const h = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/builder/typographyCss", async (orig) => {
  const m = await orig<typeof import("@/lib/builder/typographyCss")>();
  return {
    ...m,
    buildLegacyWidgetTypographyCss: (
      input: Parameters<typeof m.buildLegacyWidgetTypographyCss>[0],
    ) => {
      h.calls++;
      return m.buildLegacyWidgetTypographyCss(input);
    },
  };
});

const node = (typography: WidgetTypography): WidgetNode => ({
  id: "legacy-frame",
  kind: "widget",
  type: "heading",
  content: { text_pl: "Nagłówek", tag: "h2" },
  style: { typography },
});

const SEEDED: WidgetTypography = { fontSize: { desktop: "20px" }, fontWeight: "700" };

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function serverHtml(typography: WidgetTypography) {
  vi.stubEnv("SSR", true);
  vi.resetModules();
  h.calls = 0;
  const { renderToString } = await import("react-dom/server");
  const { ChromeWidgetView } = await import("../ChromeWidgetView");
  const html = renderToString(
    <QueryClientProvider client={client()}>
      <ChromeWidgetView node={node(typography)} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
  return { html, calls: h.calls };
}

async function clientModule() {
  vi.stubEnv("SSR", false);
  vi.resetModules();
  h.calls = 0;
  return (await import("../ChromeWidgetView")).ChromeWidgetView;
}

const block = (root: ParentNode) =>
  root.querySelector<HTMLStyleElement>('style[data-wt-css="legacy-frame"]');

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("blok generatora typografii ramki - hydratacja bez generatora", () => {
  it("serwer liczy blok ze skrótem; klient hydratuje go 1:1 bez generatora", async () => {
    const server = await serverHtml(SEEDED);
    expect(server.calls).toBeGreaterThan(0);
    expect(server.html).toMatch(/<style data-wt-css="legacy-frame" data-css-hash="[a-z0-9]+">/);
    expect(server.html).toContain("font-weight:700 !important");
    expect(server.html).toContain('data-wt="fs tfs"');

    const ChromeWidgetView = await clientModule();
    const container = document.createElement("div");
    container.innerHTML = server.html;
    document.body.appendChild(container);
    const before = container.innerHTML;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const qc = client();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <QueryClientProvider client={qc}>
          <ChromeWidgetView node={node(SEEDED)} lang="pl" device="desktop" />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(errors).toEqual([]);
    expect(consoleError.mock.calls.filter((c) => /hydrat/i.test(String(c[0])))).toEqual([]);
    consoleError.mockRestore();
    expect(h.calls).toBe(0);
    expect(container.innerHTML).toBe(before);

    // Zmiana danych po hydratacji: generator przez `import()`, nowy blok.
    await act(async () => {
      root?.render(
        <QueryClientProvider client={qc}>
          <ChromeWidgetView
            node={node({ ...SEEDED, fontWeight: "800" })}
            lang="pl"
            device="desktop"
          />
        </QueryClientProvider>,
      );
    });
    await waitFor(() => expect(block(container)?.textContent).toContain("font-weight:800"));
    expect(h.calls).toBeGreaterThan(0);
    // Przełączenie urządzenia nie zmienia bloku (rozmiary idą szablonem).
    const hash = block(container)?.getAttribute("data-css-hash");
    await act(async () => {
      root?.render(
        <QueryClientProvider client={qc}>
          <ChromeWidgetView
            node={node({ ...SEEDED, fontWeight: "800" })}
            lang="pl"
            device="mobile"
          />
        </QueryClientProvider>,
      );
    });
    expect(block(container)?.getAttribute("data-css-hash")).toBe(hash);
    act(() => root?.unmount());
  });

  it("render czysto kliencki czeka na generator i maluje widget już z blokiem", async () => {
    const ChromeWidgetView = await clientModule();
    let container: HTMLElement = document.body;
    // Zawieszenie na leniwym imporcie generatora: `act` musi być awaitowane,
    // żeby React wznowił render po rozwiązaniu obietnicy.
    await act(async () => {
      ({ container } = render(
        <QueryClientProvider client={client()}>
          <ChromeWidgetView node={node({ textAlign: "center" })} lang="pl" device="desktop" />
        </QueryClientProvider>,
      ));
    });
    await waitFor(() => expect(block(container)?.textContent ?? "").toContain("text-align:center"));
    // Ramka i blok pojawiają się razem - bez klatki z ramką bez typografii.
    expect(container.querySelector('[data-w-id="legacy-frame"]')).not.toBeNull();
  });

  it.each([
    ["edytor", true, false],
    ["strona publiczna (kontrapunkt)", false, true],
  ])(
    "%s: zapis z pierwszą właściwością spoza szablonu (edytor: %s, fallback: %s)",
    async (_label, editor, suspends) => {
      const ChromeWidgetView = await clientModule();
      const { BuilderModeProvider } = await import("@/lib/content-model/editorCanvas");
      const qc = client();
      const Frame = ChromeWidgetView as ComponentType<Parameters<typeof ChromeWidgetView>[0]>;
      const ui = (typography: WidgetTypography) => {
        const frame = (
          <Suspense fallback={<p data-testid="canvas-fallback" />}>
            <Frame node={node(typography)} lang="pl" device="desktop" editable={editor} />
          </Suspense>
        );
        return (
          <QueryClientProvider client={qc}>
            {editor ? <BuilderModeProvider mode="light">{frame}</BuilderModeProvider> : frame}
          </QueryClientProvider>
        );
      };
      const view = render(ui({ fontSize: { desktop: "20px" } }));
      expect(block(view.container)).toBeNull();
      // Czas na efekty montażu i każdy rozpoczęty w nich import.
      await act(async () => {
        await import("@/lib/builder/typographyCss");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      // Każde (także chwilowe) wstawienie fallbacku granicy kanwy.
      let fallbackShown = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const added of Array.from(record.addedNodes)) {
            if (added instanceof HTMLElement && added.dataset.testid === "canvas-fallback") {
              fallbackShown++;
            }
          }
        }
      });
      observer.observe(view.container, { childList: true, subtree: true });
      // Zapis dokumentu: zwykła aktualizacja, nie przejście.
      await act(async () => {
        view.rerender(ui({ fontSize: { desktop: "20px" }, fontWeight: "700" }));
      });
      await waitFor(() => expect(block(view.container)?.textContent).toContain("font-weight:700"));
      observer.disconnect();
      expect(fallbackShown > 0).toBe(suspends);
      expect(view.queryByTestId("canvas-fallback")).toBeNull();
      view.unmount();
    },
  );
});
