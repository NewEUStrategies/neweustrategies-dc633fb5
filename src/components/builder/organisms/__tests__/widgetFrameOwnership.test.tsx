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
  return { ...actual, buildWidgetTypographyCss: vi.fn(actual.buildWidgetTypographyCss) };
});

import { ChromeWidgetView } from "../ChromeWidgetView";
import { WidgetView } from "../WidgetView";
import { broadcastWidgetTypography, subscribeWidgetTypography } from "@/lib/builder/liveTypography";
import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";
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

  it("creates one frame subscription and one typography stylesheet per content widget", async () => {
    const { container, unmount } = setup();
    await waitFor(() =>
      expect(container.querySelector('[data-w-id="frame-owner"]')).not.toBeNull(),
    );
    expect(container.querySelectorAll('[data-w-id="frame-owner"]')).toHaveLength(1);
    expect(subscribeWidgetTypography).toHaveBeenCalledTimes(1);
    expect(buildWidgetTypographyCss).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("22px !important");

    act(() => broadcastWidgetTypography(node.id, { fontSize: { desktop: "31px" } }));
    expect(container.textContent).toContain("31px !important");
    expect(subscribeWidgetTypography).toHaveBeenCalledTimes(1);
    unmount();
    const calls = vi.mocked(buildWidgetTypographyCss).mock.calls.length;
    act(() => broadcastWidgetTypography(node.id, { fontSize: { desktop: "32px" } }));
    expect(buildWidgetTypographyCss).toHaveBeenCalledTimes(calls);
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
