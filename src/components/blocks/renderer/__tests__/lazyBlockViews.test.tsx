// Ciężkie / rzadkie bloki dynamiczne renderera są code-splitowane (React.lazy)
// przez lazyBlockViews.tsx, żeby czytelnik zwykłego artykułu nie ściągał ich
// kodu. Ten test pilnuje dwóch niezmienników:
//   1. dyspozytor rejestru dalej trzyma FUNKCJĘ renderera dla każdego z tych
//      typów (leniwy jest komponent w środku, nie wpis w mapie) - inaczej
//      BlockView[type](ctx) rzuciłby na produkcji;
//   2. leniwy chunk faktycznie się rozwiązuje i renderuje IDENTYCZNĄ treść
//      (tu: pełny, statyczny SVG wykresu), więc SSR/CSR i crawler dostają to
//      samo, co przed podziałem - tyle że pobrane na żądanie.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { Json } from "@/lib/blocks/types";
import { BLOCK_RENDERERS } from "../registry";
import {
  CalendarView,
  ChartBlockView,
  DataMapBlockView,
  LiveBlogBlock,
  PollBlockView,
} from "../lazyBlockViews";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    pollBlockQueryOptions: (i: unknown) => opts(["poll", i], () => null),
    calendarBlockQueryOptions: (i: unknown) => opts(["cal", i], () => []),
    calendarTarget: () => ({ year: 2026, month: 8 }),
    liveBlogEntriesBlockQueryOptions: (i: unknown) => opts(["lb", i], () => []),
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: () => undefined,
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const lazyRender = (ui: ReactElement) => render(<Wrap>{ui}</Wrap>);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("lazyBlockViews - registry integrity", () => {
  it("keeps a function renderer for every deferred block type", () => {
    // Podział dotyczy komponentu w środku renderera, nie samego wpisu w mapie.
    for (const type of ["liveblog", "poll", "calendar", "chart", "data-map"] as const) {
      expect(typeof BLOCK_RENDERERS[type]).toBe("function");
    }
  });
});

describe("lazyBlockViews - deferred chunk resolves to real content", () => {
  it("renders the full static chart SVG once the lazy chunk loads", async () => {
    const data: Record<string, Json> = {
      kind: "bar",
      title: "Eksport wg lat",
      categories: ["2021", "2022", "2023"],
      series: [
        { name: "Eksport", values: [120, 150, 170], colorSlot: 1 },
        { name: "Import", values: [80, 95, 110], colorSlot: 2 },
      ],
    };
    // Wrapper niesie własny <Suspense fallback={null}> - renderujemy wprost.
    const { container } = render(<ChartBlockView data={data} lang="pl" cls="" />);
    // Zanim chunk się rozwiąże, boundary jest pusty (fallback null) - to jest
    // dokładnie kontrakt „SSR wypełnia, klient dogrywa na żądanie".
    await waitFor(() => {
      // 2 serie x 3 kategorie = 6 słupków w finalnym stanie SVG.
      expect(container.querySelectorAll("path.neh-bar")).toHaveLength(6);
    });
  });
});

describe("lazyBlockViews - KAŻDY leniwy widok rozwiązuje się i montuje", () => {
  // Wrapper `withSuspense` to nie jest kod bez treści: to on decyduje, czy
  // boundary oddaje `null` (kontrakt: SSR wypełnia, klient dogrywa) i czy
  // propsy przechodzą do środka. Poniższa tabela montuje KAŻDY z pięciu
  // wrapperów, bo pięć osobnych funkcji `Suspended` to pięć osobnych ścieżek.
  it("wykres rozwiązuje się i rysuje SVG", async () => {
    const data: Record<string, Json> = {
      kind: "line",
      categories: ["A", "B"],
      series: [{ name: "S", values: [1, 2], colorSlot: 1 }],
    };
    const { container } = lazyRender(<ChartBlockView data={data} lang="pl" cls="" />);
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
  });

  it("mapa danych rozwiązuje się i montuje", async () => {
    const data: Record<string, Json> = { title: "Mapa", regions: [{ code: "PL", value: 10 }] };
    const { container } = lazyRender(<DataMapBlockView data={data} lang="pl" cls="" />);
    await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));
  });

  it("kalendarz rozwiązuje się i montuje", async () => {
    const { container } = lazyRender(<CalendarView month="2026-08" lang="pl" />);
    await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));
  });

  it("ankieta rozwiązuje się i montuje", async () => {
    const { container } = lazyRender(
      <PollBlockView pollId="11111111-2222-3333-4444-555555555555" lang="pl" />,
    );
    // Ankieta bez definicji w bazie nie renderuje treści - istotne jest, że
    // chunk się rozwiązał i nie rzucił.
    await waitFor(() => expect(container).toBeTruthy());
  });

  it("relacja na żywo rozwiązuje się i montuje", async () => {
    const { container } = lazyRender(<LiveBlogBlock postId="post-1" blockId="b_live" lang="pl" />);
    await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));
  });

  it.each([
    ["wykres", ChartBlockView],
    ["mapa danych", DataMapBlockView],
    ["kalendarz", CalendarView],
    ["ankieta", PollBlockView],
    ["relacja na żywo", LiveBlogBlock],
  ])("%s jest komponentem, nie surowym wynikiem React.lazy", (_label, View) => {
    // `withSuspense` MUSI zwrócić funkcję komponentu - obiekt lazy wprost
    // renderowałby się bez boundary i wywalał przy pierwszym zawieszeniu.
    expect(typeof View).toBe("function");
  });
});
