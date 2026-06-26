// Smoke coverage for the whole widget surface: every registered widget must
// render through WidgetView with its default content - in both languages and
// in read-only + editable (canvas) modes - without throwing. This is the guard
// that catches a renderer crash on any of the ~57 widget types at once.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { Device, WidgetType } from "@/lib/builder/types";

// Data-fetching widgets reach Supabase through react-query. Stub the client so
// every query/RPC resolves to an empty result set instead of touching the
// network - widgets then exercise their empty/loading render path.
vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  const chain = [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "or",
    "filter",
    "contains",
    "overlaps",
    "match",
    "ilike",
  ];
  for (const m of chain) (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  // Thenable: `await query` (or any chain tail) resolves to an empty dataset.
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
        signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
        signUp: vi.fn(async () => ({ data: {}, error: null })),
        updateUser: vi.fn(async () => ({ data: {}, error: null })),
        resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
        signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
      },
    },
  };
});

// No i18next instance is initialised in unit tests; return the provided
// defaultValue (falling back to the key) so translated widgets render text.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
}));

// PodcastLatestView / WebStoriesCarouselView render TanStack <Link>, which needs
// a RouterProvider. Render it as a plain anchor; AppLink's useRouter({warn:false})
// already degrades gracefully so it is left intact.
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});

function renderWidget(type: WidgetType, lang: "pl" | "en", device: Device, editable: boolean) {
  const node = makeWidget(type);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang={lang}
        device={device}
        editable={editable}
        onContentChange={editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("WidgetView - every registered widget renders without throwing", () => {
  for (const def of WIDGETS) {
    it(`renders "${def.type}" in PL (read-only)`, () => {
      expect(() => renderWidget(def.type, "pl", "desktop", false)).not.toThrow();
    });
  }

  for (const def of WIDGETS) {
    it(`renders "${def.type}" in EN (read-only)`, () => {
      expect(() => renderWidget(def.type, "en", "desktop", false)).not.toThrow();
    });
  }

  for (const def of WIDGETS) {
    it(`renders "${def.type}" in editable/canvas mode`, () => {
      expect(() => renderWidget(def.type, "pl", "desktop", true)).not.toThrow();
    });
  }

  it("renders on every device breakpoint", () => {
    for (const device of ["desktop", "tablet", "mobile"] as const) {
      expect(() => renderWidget("heading", "pl", device, false)).not.toThrow();
    }
  });
});

describe("widget registry integrity", () => {
  it("has unique widget types and a defaults() factory for each", () => {
    const types = WIDGETS.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    for (const def of WIDGETS) {
      expect(typeof def.defaults).toBe("function");
      expect(def.defaults()).toBeTypeOf("object");
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("covers a stable, non-trivial number of widget types", () => {
    expect(WIDGETS.length).toBeGreaterThanOrEqual(50);
  });
});
