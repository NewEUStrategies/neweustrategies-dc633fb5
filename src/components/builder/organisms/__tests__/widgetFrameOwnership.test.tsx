import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetNode } from "@/lib/builder/types";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => query, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("@/lib/builder/liveTypography", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/liveTypography")>();
  return {
    ...actual,
    subscribeWidgetTypography: vi.fn(actual.subscribeWidgetTypography),
  };
});
vi.mock("@/lib/builder/typographyCss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/typographyCss")>();
  return {
    ...actual,
    buildLegacyWidgetTypographyCss: vi.fn(actual.buildLegacyWidgetTypographyCss),
  };
});

import { ChromeWidgetView } from "../ChromeWidgetView";
import { WidgetView } from "../WidgetView";
import { broadcastWidgetTypography, subscribeWidgetTypography } from "@/lib/builder/liveTypography";
import { buildLegacyWidgetTypographyCss } from "@/lib/builder/typographyCss";
import { globalWidgetKey } from "@/lib/builder/globalWidgets";

const node: WidgetNode = {
  id: "frame-owner",
  kind: "widget",
  type: "post-list",
  content: {},
  style: { typography: { fontSize: { desktop: "22px" } } },
};

function setup(initial = node, editable = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: WidgetNode) => (
    <QueryClientProvider client={client}>
      <ChromeWidgetView node={next} lang="pl" device="desktop" editable={editable} />
    </QueryClientProvider>
  );
  const view = render(ui(initial));
  return { ...view, client, update: (next: WidgetNode) => view.rerender(ui(next)) };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.querySelectorAll('[id^="builder-live-typography-style-"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("content widget frame ownership", () => {
  it("observes motion preferences only when the widget has an entrance animation", () => {
    const media = vi.spyOn(window, "matchMedia");
    const heading: WidgetNode = { ...node, type: "heading", content: { text_pl: "Visible" } };
    const { container, update } = setup(heading);
    const motionQueries = () =>
      media.mock.calls.filter(([query]) => query === "(prefers-reduced-motion: reduce)");
    const frame = () => container.querySelector<HTMLElement>("[data-w-id]")!;
    expect(frame().textContent).toContain("Visible");
    expect(motionQueries()).toHaveLength(0);
    update({ ...heading, advanced: { animation: "fade" } });
    expect(motionQueries()).toHaveLength(1);
    expect(frame().style.transition).toContain("opacity");
    update({ ...heading, advanced: { animation: "none" } });
    expect(frame().style.transition).toBe("");
    expect(frame().textContent).toContain("Visible");
  });

  it("creates one frame subscription and carries sizes as template variables, not a stylesheet", async () => {
    const { container, unmount } = setup();
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    const frame = () => container.querySelector<HTMLElement>('[data-w-id="frame-owner"]')!;
    expect(container.querySelectorAll('[data-w-id="frame-owner"]')).toHaveLength(1);
    expect(subscribeWidgetTypography).toHaveBeenCalledTimes(1);
    // HW-2 (P2.4): rozmiar to dane ramki (tokeny + zmienne), reguły są raz w
    // `styles.css` - bez bloku `<style>` i bez generatora.
    expect(frame().getAttribute("data-wt")).toBe("fs tfs");
    expect(frame().style.getPropertyValue("--wt-fs-d")).toBe("22px");
    expect(container.querySelector("style")).toBeNull();
    expect(buildLegacyWidgetTypographyCss).not.toHaveBeenCalled();

    act(() => broadcastWidgetTypography(node.id, { fontSize: { desktop: "31px" } }));
    expect(frame().style.getPropertyValue("--wt-fs-d")).toBe("31px");
    expect(frame().style.getPropertyValue("--wt-fs-m")).toBe("31px");
    expect(subscribeWidgetTypography).toHaveBeenCalledTimes(1);

    // Właściwość spoza szablonu: blok generatora tylko z nią (bez rozmiarów).
    act(() =>
      broadcastWidgetTypography(node.id, { fontSize: { desktop: "31px" }, fontWeight: "700" }),
    );
    const legacy = container.querySelector('style[data-wt-css="frame-owner"]');
    expect(legacy?.textContent).toContain("font-weight:700 !important");
    expect(legacy?.textContent).not.toContain("font-size");
    expect(legacy?.getAttribute("data-css-hash")).toBeTruthy();
    unmount();
    const calls = vi.mocked(buildLegacyWidgetTypographyCss).mock.calls.length;
    act(() =>
      broadcastWidgetTypography(node.id, { fontSize: { desktop: "32px" }, fontWeight: "800" }),
    );
    expect(buildLegacyWidgetTypographyCss).toHaveBeenCalledTimes(calls);
  });

  it("does not subscribe to global widget records for regular widgets", async () => {
    // hydration:H10 (a): zwykły widget nie zakłada nawet wyłączonego zapytania.
    const { container, client } = setup();
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    const globalRoot = globalWidgetKey("")[0];
    const globalQueries = () =>
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === globalRoot);
    expect(globalQueries()).toHaveLength(0);
    // Kontrapunkt: instancja globalna subskrybuje swój rekord.
    cleanup();
    const global = setup({ ...node, globalId: "shared-widget" });
    await waitFor(() =>
      expect(global.container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    expect(
      global.client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === globalRoot)
        .map((q) => q.queryKey),
    ).toEqual([globalWidgetKey("shared-widget")]);
  });

  it("keeps the same SSR markup as the full dispatcher", async () => {
    // Resolve the real lazy dispatcher first; renderToString does not await it.
    const { container, client } = setup();
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    const markup = (Component: typeof ChromeWidgetView | typeof WidgetView) =>
      renderToString(
        <QueryClientProvider client={client}>
          <Component node={node} lang="pl" device="desktop" />
        </QueryClientProvider>,
      ).replace(/<!--.*?-->/g, "");
    expect(markup(ChromeWidgetView)).toBe(markup(WidgetView));
  });

  it("keeps live global widgets and optimistic editor snapshots authoritative", async () => {
    const instance = { ...node, globalId: "shared-widget" };
    const { container, client, unmount } = setup(instance);
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    act(() => {
      client.setQueryData(globalWidgetKey(instance.globalId), {
        type: "heading",
        content: { text_pl: "Live global heading" },
      });
    });
    await waitFor(() => expect(container.textContent).toContain("Live global heading"));
    unmount();

    const editor = setup(instance, true);
    act(() => {
      editor.client.setQueryData(globalWidgetKey(instance.globalId), {
        type: "heading",
        content: { text_pl: "Stale global heading" },
      });
    });
    await waitFor(() =>
      expect(editor.container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    expect(editor.container.textContent).not.toContain("Stale global heading");
  });

  it("renders a content-type live record of a chrome instance through the full dispatcher", async () => {
    // Ramka chrome z nakładką oddaje treść pełnemu dyspozytorowi z węzłem
    // INSTANCJI - nakładkę robi on sam pod swoją granicą Suspense.
    const instance: WidgetNode = {
      id: "frame-owner",
      kind: "widget",
      type: "heading",
      globalId: "shared-heading",
      content: { text_pl: "Snapshot heading" },
    };
    const { container, client } = setup(instance);
    expect(container.textContent).toContain("Snapshot heading");
    await waitFor(() =>
      expect(client.getQueryState(globalWidgetKey("shared-heading"))?.status).toBe("success"),
    );
    act(() => {
      client.setQueryData(globalWidgetKey("shared-heading"), {
        type: "dark-featured-card",
        content: { title_pl: "Live card title" },
      });
    });
    await waitFor(() => expect(container.textContent).toContain("Live card title"));
    expect(container.textContent).not.toContain("Snapshot heading");
    expect(container.querySelectorAll('[data-w-id="frame-owner"]')).toHaveLength(1);
  });

  it("supports changing a widget between chrome and content types", async () => {
    const { container, update } = setup();
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    update({ ...node, type: "heading", content: { text_pl: "Changed type" } });
    expect(container.textContent).toContain("Changed type");
    update(node);
    await waitFor(() => expect(container.textContent).not.toContain("Changed type"));
    expect(container.querySelectorAll('[data-w-id="frame-owner"]')).toHaveLength(1);
  });
});
