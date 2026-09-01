// POWŁOKA DOKUMENTU (`shellComponent`) i ekran 404 korzenia - dowód przez
// `renderToStaticMarkup`.
//
// PO CO OSOBNY PLIK. `RootShell` renderuje `<html><head><body>`, więc nie
// przechodzi przez `render()` z testing-library (ta wstawia poddrzewo do
// istniejącego `document.body`). `renderToStaticMarkup` z `react-dom/server` to
// jedyna droga, a jednocześnie ta sama, którą naprawdę idzie SSR.
//
// CZEGO TEN PLIK NIE PRÓBUJE. `RootComponent` NIE MONTUJE SIĘ z gołego renderu:
// `Link` i `useRouterState` czytają prawdziwy, pusty kontekst routera
// (`TypeError: Cannot read properties of null (reading 'isServer')`), a
// `supabase.auth.onAuthStateChange` nie istnieje w atrapie. Zamontowanie go
// wymaga prawdziwego `RouterProvider` z `__root` JAKO KORZENIEM, czyli zmiany
// w `src/test/routeHarness.tsx` - to jest zmiana harness'u testowego, nie
// produkcji, i osobna praca. Zapisane, żeby następny czytelnik nie zaczynał od
// zera przy tej samej ścianie.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ subscribed: [] as string[] }));

vi.mock("@tanstack/react-router", async (o) => {
  const actual = await o<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    HeadContent: () => null,
    Scripts: () => null,
    Outlet: () => null,
    useRouter: () => ({
      subscribe: (ev: string) => {
        h.subscribed.push(ev);
        return () => undefined;
      },
    }),
  };
});

vi.mock("@/lib/i18n", async (o) => {
  const actual = await o<typeof import("@/lib/i18n")>();
  return {
    ...actual,
    syncI18nToRequest: async () => undefined,
    getRenderI18n: () => actual.default,
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseAuthStub, ok } = await import("@/test/supabase");
  const from = supabaseFromStub();
  return {
    supabase: {
      from: from.from,
      // `supabaseAuthStub` wymaga identyfikatora - `null` znaczy ANONIM, czyli
      // dokładnie stan, w jakim renderuje się publiczna powłoka dokumentu.
      auth: supabaseAuthStub(null),
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
        subscribe: () => ({ unsubscribe: () => undefined }),
        unsubscribe: () => undefined,
      }),
      removeChannel: () => undefined,
      rpc: async () => ok([]),
    },
  };
});

const { Route } = await import("@/routes/__root");

describe("RootShell", () => {
  it("renderuje <html lang>, <head> i <body> - pełny dokument, nie fragment", () => {
    // `shellComponent` nie jest w publicznym typie `RouteOptions` (framework
    // czyta je dynamicznie) - zawężamy przez `Record`, nie przez `any`.
    const opts = Route.options as unknown as Record<string, unknown>;
    const Shell = opts["shellComponent"] as (p: {
      children: React.ReactNode;
    }) => React.ReactElement;
    const html = renderToStaticMarkup(<Shell>{null}</Shell>);
    expect(html).toContain("<html lang=");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });
});

describe("NotFoundComponent / ErrorComponent / skeleton", () => {
  it("ekran 404 korzenia renderuje się bez rzutu", () => {
    const NF = Route.options.notFoundComponent as unknown as () => React.ReactElement;
    expect(() => renderToStaticMarkup(<NF />)).not.toThrow();
  });
});

describe.skip("RootComponent - wymaga prawdziwego RouterProvider z __root jako korzeniem", () => {
  it("montuje się i subskrybuje onResolved", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const Root = Route.options.component as unknown as () => React.ReactElement;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Root />
      </QueryClientProvider>,
    );
    expect(h.subscribed).toContain("onResolved");
    cleanup();
  });
});
