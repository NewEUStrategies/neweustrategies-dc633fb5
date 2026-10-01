import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetNode } from "@/lib/builder/types";

// Keep the real split registry and Suspense wrappers. The leaves stand in for
// already-prefetched data so this test isolates first-shell code availability.
vi.mock("../RichHtmlView", () => ({ RichHtmlView: () => <p>rich-html</p> }));
vi.mock("@/components/blocks/ContactFormView", () => ({ ContactFormView: () => <p>contact</p> }));
vi.mock("../PostListView", () => ({ PostListView: () => <p>post-list</p> }));
vi.mock("../PostsSliderWidget", () => ({ PostsSliderWidget: () => <p>posts-slider</p> }));
vi.mock("../RatedListView", () => ({ RatedListView: () => <p>rated-list</p> }));
vi.mock("@/lib/builder/sectionLabelVariants", () => ({
  SectionLabelWidgetView: () => <p>section-label</p>,
}));
vi.mock("@/lib/builder/sliderVariants", () => ({ SliderRender: () => <p>slider</p> }));
vi.mock("../TailoredMustReadsView", () => ({
  TailoredMustReadsView: () => <p>tailored-must-reads</p>,
}));
// The dispatcher test renders the real widget frame: it needs a query client
// and a translation stub, not a database or a dictionary.
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => query, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

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
      [<widgets.PostListView c={{}} lang="pl" />, "post-list"],
      [<widgets.RichHtmlView html="<p>rich-html</p>" />, "rich-html"],
      [<widgets.ContactFormView data={{}} lang="pl" />, "contact"],
      [<widgets.PostsSliderWidget c={{}} lang="pl" />, "posts-slider"],
      [<widgets.RatedListView c={{}} lang="pl" />, "rated-list"],
      [<widgets.SectionLabelWidgetView content={{}} lang="pl" theme="light" />, "section-label"],
      [<widgets.SliderRender config={{ items: [] }} lang="pl" />, "slider"],
      [<widgets.TailoredMustReadsView c={{}} lang="pl" />, "tailored-must-reads"],
    ] as const;
    for (const [widget, content] of cases) {
      const html = renderToString(widget);
      expect(html.includes(`<p>${content}</p>`), content).toBe(ssr);
      expect(html.includes("<!--$!-->"), content).toBe(!ssr);
    }
  });
});

// Streaming SSR flushes the shell before a server-side React.lazy resolves on
// the first render of a process. Every content widget therefore reached the
// browser as a 40 px `data-chrome-widget-pending` placeholder whose HTML was
// swapped in after the whole shell had been parsed (measured on the homepage:
// LCP = swap time + 50-110 ms, layout shift 0.0168 at every swap). The full
// dispatcher must render synchronously on the server; the browser keeps the
// lazy chunk and hydrates the boundary later.
describe("the full dispatcher in the first server shell", () => {
  const postList: WidgetNode = {
    id: "shell-post-list",
    kind: "widget",
    type: "post-list",
    content: {},
  };

  it.each([true, false])("SSR=%s renders post-list through ChromeWidgetView", async (ssr) => {
    vi.stubEnv("SSR", ssr);
    vi.resetModules();
    const { ChromeWidgetView } = await import("@/components/builder/organisms/ChromeWidgetView");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToString(
      <QueryClientProvider client={client}>
        <ChromeWidgetView node={postList} lang="pl" device="desktop" />
      </QueryClientProvider>,
    );
    expect(html.includes("<p>post-list</p>")).toBe(ssr);
    expect(html.includes('data-chrome-widget-pending="post-list"')).toBe(!ssr);
    // The boundary itself stays in both arms: the browser hydrates the
    // server HTML into the same Suspense structure with its lazy chunk.
    expect(html.includes("<!--$")).toBe(true);
  });
});
