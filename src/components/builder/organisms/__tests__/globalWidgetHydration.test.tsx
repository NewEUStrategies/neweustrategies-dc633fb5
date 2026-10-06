// Widget GLOBALNY typu treściowego przy HYDRATACJI - P2.4 (recenzja M1).
//
// KONTRAKT. Nakładka żywego rekordu widgetu globalnego (`useGlobalWidgetNode`)
// dla typu treściowego żyje POD granicą Suspense leniwego dyspozytora
// (`DeferredWidgetView`) - tak jak w bazie, gdzie wołał ją `WidgetView`.
// Rekord nie jest pobierany w SSR, więc przychodzi po montażu. Gdyby
// nakładka stała NAD granicą, nowy węzeł z rekordem trafiłby jako
// aktualizacja do granicy, która jeszcze się nie uwodniła (chunk `WidgetView`
// w drodze), a React 19 porzuciłby HTML serwera: fallback 40 px
// (`data-chrome-widget-pending`), przesunięcie układu, zniknięcie treści na
// czas ładowania chunku i błąd odzyskiwalny.
//
// Fixture `/` nie ma żadnego `globalId`, więc ani sonda stylów, ani Lighthouse
// tego nie widzą - pilnuje tego wyłącznie ten test.
//
// Leniwy chunk dyspozytora trzymamy zamkniętym bramką (`viewGate`): moduł
// `WidgetView` w kliencie podmieniamy na komponent, który zawiesza się do jej
// otwarcia, a potem renderuje prawdziwy `WidgetView`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetNode } from "@/lib/builder/types";
import type { WidgetViewProps } from "../ChromeWidgetView";

const h = vi.hoisted(() => ({
  fetches: 0,
  live: {
    type: "dark-featured-card",
    content: { title_pl: "Rekord na żywo" },
  } as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.maybeSingle = async () => {
    h.fetches++;
    return { data: { data: h.live }, error: null };
  };
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

const instance: WidgetNode = {
  id: "global-card",
  kind: "widget",
  type: "dark-featured-card",
  globalId: "shared-card",
  content: { title_pl: "Migawka dokumentu" },
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function serverHtml(): Promise<string> {
  vi.stubEnv("SSR", true);
  vi.resetModules();
  const { renderToString } = await import("react-dom/server");
  const { ChromeWidgetView } = await import("../ChromeWidgetView");
  return renderToString(
    <QueryClientProvider client={client()}>
      <ChromeWidgetView node={instance} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
}

/** Moduł kliencki, w którym chunk pełnego dyspozytora czeka na `gate`. */
async function clientModuleWithGatedView(gate: Promise<void>) {
  vi.stubEnv("SSR", false);
  vi.resetModules();
  vi.doMock("../WidgetView", async () => {
    const { createElement, lazy } = await import("react");
    const Gated = lazy(async () => {
      await gate;
      const actual = await vi.importActual<typeof import("../WidgetView")>("../WidgetView");
      return { default: actual.WidgetView };
    });
    return { WidgetView: (props: WidgetViewProps) => createElement(Gated, props) };
  });
  return (await import("../ChromeWidgetView")).ChromeWidgetView;
}

afterEach(() => {
  vi.doUnmock("../WidgetView");
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("widget globalny treściowy - hydratacja przy leniwym dyspozytorze", () => {
  it("rekord po montażu nie podmienia HTML-a serwera na fallback, a nakładka działa po uwodnieniu", async () => {
    const html = await serverHtml();
    expect(html).toContain("Migawka dokumentu");
    expect(html).not.toContain("data-chrome-widget-pending");

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const ChromeWidgetView = await clientModuleWithGatedView(gate);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const before = container.innerHTML;
    const frame = container.querySelector('[data-w-id="global-card"]');
    expect(frame).not.toBeNull();

    // Każde (także chwilowe) wstawienie fallbacku granicy.
    let pendingSeen = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of Array.from(record.addedNodes)) {
          if (
            added instanceof Element &&
            (added.matches("[data-chrome-widget-pending]") ||
              added.querySelector("[data-chrome-widget-pending]"))
          ) {
            pendingSeen++;
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const qc = client();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <QueryClientProvider client={qc}>
            <ChromeWidgetView node={instance} lang="pl" device="desktop" />
          </QueryClientProvider>,
          { onRecoverableError: (error) => errors.push(error) },
        );
      });
      // Czas na każde zapytanie, które ruszyło przy montażu - chunk
      // dyspozytora wciąż w drodze.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(errors).toEqual([]);
      expect(pendingSeen).toBe(0);
      expect(container.innerHTML).toBe(before);
      expect(frame?.isConnected).toBe(true);

      // Chunk dojeżdża: granica uwadnia się na HTML-u serwera, a dopiero
      // potem nakładka podmienia treść na żywy rekord (zwykła aktualizacja).
      await act(async () => {
        openGate();
        await gate;
      });
      await waitFor(() => expect(container.textContent).toContain("Rekord na żywo"));
      expect(h.fetches).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      expect(pendingSeen).toBe(0);
      expect(container.querySelector('[data-w-id="global-card"]')).toBe(frame);
      expect(consoleError.mock.calls.filter((c) => /hydrat/i.test(String(c[0])))).toEqual([]);
    } finally {
      observer.disconnect();
      consoleError.mockRestore();
      openGate();
      act(() => root?.unmount());
    }
  });
});
