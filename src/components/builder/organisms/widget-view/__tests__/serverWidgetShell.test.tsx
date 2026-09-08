import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";

// Keep the real split registry and Suspense wrappers. The leaves stand in for
// already-prefetched data so this test isolates first-shell code availability.
vi.mock("../PostListView", () => ({ PostListView: () => <p>post-list</p> }));
vi.mock("../PostsSliderWidget", () => ({ PostsSliderWidget: () => <p>posts-slider</p> }));
vi.mock("../RatedListView", () => ({ RatedListView: () => <p>rated-list</p> }));
vi.mock("@/lib/builder/sectionLabelVariants", () => ({
  SectionLabelWidgetView: () => <p>section-label</p>,
}));
vi.mock("@/lib/builder/sliderVariants", () => ({ SliderRender: () => <p>slider</p> }));

// Vitest does not run Start's server/client compiler. Select the same arm for
// this unit test; the artifact boot and bundle gates verify the compiled split.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("reading widgets in the first server shell", () => {
  it.each([true, false])("SSR=%s retains the server/client split", async (ssr) => {
    vi.stubEnv("SSR", ssr);
    vi.resetModules();
    const widgets = await import("../lazyWidgets");
    const cases = [
      [widgets.PostListView, "post-list"],
      [widgets.PostsSliderWidget, "posts-slider"],
      [widgets.RatedListView, "rated-list"],
      [widgets.SectionLabelWidgetView, "section-label"],
      [widgets.SliderRender, "slider"],
    ] as const;
    for (const [Widget, content] of cases) {
      // The mocked leaves have no props; real props remain checked at every
      // production call site and by the full artifact render.
      const html = renderToString(createElement(Widget as ComponentType));
      expect(html.includes(`<p>${content}</p>`), content).toBe(ssr);
      expect(html.includes("<!--$!-->"), content).toBe(!ssr);
    }
  });
});
