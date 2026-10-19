// Listy wpisów z zapytania: navigation, post-navigation-link, query-loop
// (NavLoopViews) i latest-posts (LatestPostsView).
//
// Te bloki nie mają treści w `block.data` - mają PARAMETRY zapytania. Dlatego
// kontrakt jest dwustronny:
//   * do zapytania idą dokładnie parametry bloku (po przycięciu do granic),
//     bo klucz cache musi trafić we wpis rozgrzany prefetchem SSR,
//   * z wiersza bazy na stronę idzie tytuł w języku strony, a bez tłumaczenia
//     drugi język - odnośnik bez nazwy jest dla czytnika ekranu „linkiem" bez
//     celu.
//
// Granice: `@/lib/queries/blocks` (atrapa zapisuje wejścia i zwraca wiersze
// z `h`), router przez wspólną atrapę Link. React Query jest prawdziwy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  nav: [] as unknown[],
  neighbor: null as unknown,
  loop: [] as unknown[],
  latest: [] as unknown[],
  latestPending: false,
  inputs: {} as Record<string, unknown[]>,
  neighborCalls: 0,
}));

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useRouter: () => ({ navigate: () => undefined }) };
});
vi.mock("@/lib/queries/blocks", () => {
  const opts = (name: string, input: unknown, value: () => unknown) => {
    (h.inputs[name] ??= []).push(input);
    return {
      queryKey: [name, input],
      queryFn: async () => value(),
      staleTime: 0,
      gcTime: 0,
    };
  };
  return {
    blockNavigationQueryOptions: () => opts("nav", null, () => h.nav),
    postNeighborQueryOptions: (i: unknown) =>
      opts("neighbor", i, () => {
        h.neighborCalls += 1;
        return h.neighbor;
      }),
    queryLoopBlockQueryOptions: (i: unknown) => opts("loop", i, () => h.loop),
    latestPostsBlockQueryOptions: (i: unknown) =>
      opts("latest", i, async () => {
        if (h.latestPending) await new Promise(() => {});
        return h.latest;
      }),
  };
});

import { NavigationView, PostNavigationLinkView, QueryLoopView } from "../NavLoopViews";
import { LatestPostsView } from "../LatestPostsView";

const CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "biezacy",
  publishedAt: "2026-08-01T10:00:00.000Z",
};

function view(ui: ReactElement, ctx: CurrentPostCtx | null = CTX) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>
    </QueryClientProvider>,
  );
}

const post = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  slug: "wpis-pierwszy",
  title_pl: "Wpis pierwszy",
  title_en: "First post",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  cover_image_url: "https://cdn.test/1.jpg",
  published_at: "2026-07-01T10:00:00.000Z",
  ...over,
});

const linkNames = () => screen.queryAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  h.nav = [];
  h.neighbor = null;
  h.loop = [];
  h.latest = [];
  h.latestPending = false;
  h.inputs = {};
  h.neighborCalls = 0;
});

afterEach(() => cleanup());

describe("NavigationView", () => {
  it("kategorie stają się nawigacją nazwaną kluczem menu, z adresami /category/<slug>", async () => {
    h.nav = [
      { id: "c1", slug: "analizy", name_pl: "Analizy", name_en: "Analyses" },
      { id: "c2", slug: "raporty", name_pl: "Raporty", name_en: null },
      { id: "c3", slug: "pusta", name_pl: null, name_en: null },
    ];
    view(<NavigationView menuKey="primary" layout="vertical" lang="en" cls="" />);
    const nav = await screen.findByRole("navigation", { name: "primary" });
    expect(nav).toBeTruthy();
    // Brak tłumaczenia -> nazwa polska; brak obu nazw -> pozycja pominięta.
    expect(linkNames()).toEqual(["Analyses", "Raporty"]);
    expect(screen.getByRole("link", { name: "Raporty" })).toHaveAttribute(
      "href",
      "/category/raporty",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("PUSTE menu nie renderuje pustego landmarku nawigacji", async () => {
    const { container } = view(
      <NavigationView menuKey="primary" layout="horizontal" lang="pl" cls="" />,
    );
    await waitFor(() => expect(h.inputs.nav).toBeDefined());
    expect(container.querySelector("nav")).toBeNull();
  });
});

describe("PostNavigationLinkView", () => {
  it("pyta o sąsiada bieżącego wpisu w żądanym kierunku i linkuje pod jego adres", async () => {
    h.neighbor = { href: "/post/nastepny", post: { title_pl: "Następny wpis", title_en: null } };
    view(<PostNavigationLinkView direction="next" showTitle lang="pl" cls="" />);
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/post/nastepny");
    expect(link.textContent).toBe("NastępnyNastępny wpis→");
    expect(h.inputs.neighbor?.at(-1)).toEqual({
      currentId: "post-1",
      publishedAt: "2026-08-01T10:00:00.000Z",
      direction: "next",
    });
  });

  // NAPRAWIONE 2026-10-18: tytuł sąsiada nie miał zapasu na drugi język -
  // wpis bez tłumaczenia pokazywał samą etykietę kierunku mimo `showTitle`.
  it("kierunek prev po angielsku: strzałka przed etykietą, tytuł w drugim języku gdy brak EN", async () => {
    h.neighbor = { href: "/post/poprzedni", post: { title_pl: "Poprzedni wpis", title_en: null } };
    view(<PostNavigationLinkView direction="prev" showTitle lang="en" cls="" />);
    const link = await screen.findByRole("link");
    expect(link.textContent).toBe("←PreviousPoprzedni wpis");
  });

  it("showTitle=false pokazuje samą etykietę kierunku", async () => {
    h.neighbor = { href: "/post/x", post: { title_pl: "Tytuł", title_en: "Title" } };
    view(<PostNavigationLinkView direction="prev" showTitle={false} lang="pl" cls="" />);
    expect((await screen.findByRole("link")).textContent).toBe("←Poprzedni");
  });

  it("BEZ daty publikacji bieżącego wpisu zapytanie nie rusza i nic się nie renderuje", async () => {
    h.neighbor = { href: "/post/x", post: { title_pl: "T", title_en: "T" } };
    const { container } = view(
      <PostNavigationLinkView direction="next" showTitle lang="pl" cls="" />,
      { ...CTX, publishedAt: undefined },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(h.neighborCalls).toBe(0);
    expect(container.innerHTML).toBe("");
  });

  it("BRAK sąsiada (pierwszy/ostatni wpis) nie zostawia pustego odnośnika", async () => {
    const { container } = view(
      <PostNavigationLinkView direction="next" showTitle lang="pl" cls="" />,
    );
    await waitFor(() => expect(h.neighborCalls).toBe(1));
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("QueryLoopView", () => {
  const base = {
    categorySlug: "analizy",
    limit: 6,
    layout: "grid" as const,
    showExcerpt: true,
    showDate: true,
    showImage: true,
    orderBy: "title" as const,
    cls: "",
  };

  it("parametry bloku idą do zapytania 1:1 (klucz cache = prefetch SSR)", async () => {
    h.loop = [post()];
    view(<QueryLoopView {...base} lang="en" />);
    await screen.findByText("First post");
    expect(h.inputs.loop?.at(-1)).toEqual({
      categorySlug: "analizy",
      limit: 6,
      orderBy: "title",
      lang: "en",
    });
  });

  it("wpis ma tytuł-odnośnik, okładkę z tytułem jako alt, datę i zajawkę w języku strony", async () => {
    h.loop = [post()];
    const { container } = view(<QueryLoopView {...base} lang="pl" />);
    await screen.findByText("Wpis pierwszy");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Wpis pierwszy");
    expect(screen.getByRole("img", { name: "Wpis pierwszy" })).toBeTruthy();
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-07-01T10:00:00.000Z");
    expect(time?.textContent).toBe("1 lip 2026");
    expect(container.textContent).toContain("Zajawka PL");
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("href")).toBe("/post/wpis-pierwszy");
    }
  });

  it("przełączniki chowają okładkę, datę i zajawkę (układ listy)", async () => {
    h.loop = [post()];
    const { container } = view(
      <QueryLoopView
        {...base}
        layout="list"
        showImage={false}
        showDate={false}
        showExcerpt={false}
        lang="pl"
      />,
    );
    await screen.findByText("Wpis pierwszy");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).not.toContain("Zajawka PL");
  });

  // NAPRAWIONE 2026-10-18: tytuł bez zapasu na drugi język. Wpis bez
  // tłumaczenia dawał `<h3><a></a></h3>` - odnośnik bez dostępnej nazwy - choć
  // nawigacja i latest-posts w tym samym silniku schodzą na drugi język.
  it("wpis bez tłumaczenia tytułu dostaje tytuł w drugim języku, nie pusty odnośnik", async () => {
    h.loop = [post({ title_en: null, cover_image_url: null })];
    view(<QueryLoopView {...base} lang="en" />);
    await waitFor(() => expect(linkNames()).toEqual(["Wpis pierwszy"]));
  });

  it("wpis bez okładki, daty i zajawki nie zostawia pustych elementów", async () => {
    h.loop = [post({ cover_image_url: null, published_at: null, excerpt_pl: null })];
    const { container } = view(<QueryLoopView {...base} lang="pl" />);
    await screen.findByText("Wpis pierwszy");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });

  it("PUSTY wynik nie renderuje listy", async () => {
    const { container } = view(<QueryLoopView {...base} lang="pl" />);
    await waitFor(() => expect(h.inputs.loop).toBeDefined());
    expect(container.querySelector("ul")).toBeNull();
  });
});

describe("LatestPostsView", () => {
  const base = { category: "analizy", showExcerpt: true, showImage: true, lang: "pl" as const };

  it.each([
    [0, 1],
    [-4, 1],
    [12, 12],
    [500, 50],
  ])("liczba %i jest przycinana do 1-50 w zapytaniu (%i)", async (count, sent) => {
    h.latest = [post()];
    view(<LatestPostsView {...base} count={count} layout="list" />);
    await screen.findByText("Wpis pierwszy");
    expect(h.inputs.latest?.at(-1)).toEqual({ count: sent, category: "analizy" });
  });

  it("w trakcie wczytywania pokazuje wskaźnik zamiast pustego miejsca", () => {
    h.latestPending = true;
    const { container } = view(<LatestPostsView {...base} count={3} layout="grid" />);
    expect(container.textContent).toBe("…");
  });

  it("wpis: tytuł-odnośnik z zapasem na drugi język, okładka i zajawka w języku strony", async () => {
    h.latest = [post({ title_pl: null }), post({ id: "p-2", slug: "drugi", title_pl: "Drugi" })];
    const { container } = view(<LatestPostsView {...base} count={3} layout="grid" />);
    await screen.findByText("Drugi");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "First post" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "First post" })[0]).toHaveAttribute(
      "href",
      "/post/wpis-pierwszy",
    );
    expect(container.textContent).toContain("Zajawka PL");
  });

  it("showImage/showExcerpt=false chowają okładkę i zajawkę", async () => {
    h.latest = [post()];
    const { container } = view(
      <LatestPostsView {...base} showImage={false} showExcerpt={false} count={3} layout="list" />,
    );
    await screen.findByText("Wpis pierwszy");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("Zajawka");
  });

  it("PUSTY wynik nie renderuje niczego", async () => {
    const { container } = view(<LatestPostsView {...base} count={3} layout="list" />);
    await waitFor(() => expect(container.textContent).not.toBe("…"));
    expect(container.innerHTML).toBe("");
  });
});
