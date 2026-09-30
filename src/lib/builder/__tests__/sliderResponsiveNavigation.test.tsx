import { Profiler } from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));
vi.mock("@/lib/theme/carouselDefaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme/carouselDefaults")>()),
  useCarouselDefaults: () => ({ data: undefined }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "limit"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => query } };
});

import { SliderRender, type SliderConfig } from "../sliderVariants";

const items = [1, 2, 3, 4, 5].map((n) => ({
  image: `https://cdn.example.com/${n}.jpg`,
  title_pl: `Slajd ${n}`,
}));

function observeWidths() {
  const subscriptions: Array<{ callback: ResizeObserverCallback; element: Element }> = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        subscriptions.push({ callback: this.callback, element });
      }
      disconnect = disconnect;
    },
  );
  return {
    subscriptions,
    disconnect,
    resize(width: number) {
      act(() => {
        for (const { callback, element } of subscriptions) {
          callback(
            [{ target: element, contentRect: { width } } as ResizeObserverEntry],
            {} as ResizeObserver,
          );
        }
      });
    },
  };
}

function mount(config: Partial<SliderConfig>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRender = vi.fn();
  const ui = (next: Partial<SliderConfig>) => (
    <QueryClientProvider client={client}>
      <Profiler id="slider" onRender={onRender}>
        <SliderRender config={{ items, autoplay: false, ...next }} lang="pl" />
      </Profiler>
    </QueryClientProvider>
  );
  const view = render(ui(config));
  return { ...view, onRender, update: (next: Partial<SliderConfig>) => view.rerender(ui(next)) };
}

const dots = (container: HTMLElement) =>
  within(container).getAllByRole("button", { name: /^Slajd \d+$/ });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("responsive slider navigation", () => {
  it.each(["editorial-hero", "cinematic-overlay", "split-feature", "minimal-strip"] as const)(
    "%s keeps full-width media and manual navigation without a width observer",
    (variant) => {
      const observer = observeWidths();
      const { container } = mount({ variant });
      expect(observer.subscriptions).toHaveLength(0);
      expect(container.querySelector(".eh-slider")?.classList.contains("w-full")).toBe(true);
      fireEvent.click(dots(container)[1]);
      expect(dots(container)[1].getAttribute("aria-current")).toBe("true");
      expect(dots(container)[0].getAttribute("aria-current")).toBeNull();
      expect(container.querySelector('img[src*="/2.jpg"]')).not.toBeNull();
    },
  );

  it("updates multi-card pagination only when a column breakpoint changes", async () => {
    const observer = observeWidths();
    const { container, onRender, update, unmount } = mount({ variant: "multi-card", columns: 3 });
    await act(async () => {});
    expect(dots(container)).toHaveLength(3);
    observer.resize(800);
    expect(dots(container)).toHaveLength(4);
    onRender.mockClear();
    observer.resize(850);
    observer.resize(1000);
    expect(onRender).not.toHaveBeenCalled();
    observer.resize(640);
    expect(dots(container)).toHaveLength(5);
    observer.resize(1280);
    expect(dots(container)).toHaveLength(3);
    update({ variant: "multi-card", columns: 4 });
    expect(dots(container)).toHaveLength(2);
    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("attaches measurement when an empty slider receives its cards", () => {
    const observer = observeWidths();
    const { container, update } = mount({ variant: "multi-card", items: [] });
    expect(observer.subscriptions).toHaveLength(0);
    update({ variant: "multi-card" });
    observer.resize(400);
    expect(dots(container)).toHaveLength(5);
    update({ variant: "editorial-hero" });
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });
});
