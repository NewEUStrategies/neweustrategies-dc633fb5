// Publiczne widoki bloków Foxiz: `post-stats`, `post-rating`, `loginout`,
// `more-posts` (`FoxizExtraViews.tsx`).
//
// CO MA TU DOWÓD
//  * pasek meta pokazuje TYLKO to, co wynika z kontekstu wpisu: poza wpisem
//    znika, a pozycja bez danych (brak licznika wyświetleń, zła data, brak
//    autora) nie maluje zmyślonej wartości („1 min", „0 wyświetleń"),
//  * ocena czytelnika: zapis pod kluczem wpisu, przywrócenie po montażu,
//    zmiana zdania ZASTĘPUJE głos zamiast dokładać drugi, skala z importu
//    przycięta do 1..10,
//  * przycisk logowania: gość dostaje link, zalogowany awatar/inicjał i
//    wylogowanie przez klienta Supabase,
//  * polecane wpisy: wejście zapytania (strategia, limit, kategoria z
//    kontekstu), odfiltrowanie bieżącego wpisu i przycięcie do 2..12.
//
// GRANICE. Atrapy tylko na brzegach: `useAuth` (jedyny AuthProvider żyje
// w `__root`), `supabase.auth.signOut`, fabryka zapytania `more-posts`
// (warstwa danych - jej SQL ma własne testy). Kontekst wpisu, i18n bloku
// i formatowanie dat są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  user: null as null | { email?: string; user_metadata?: Record<string, unknown> },
  signOut: vi.fn(async () => ({ error: null })),
  posts: [] as unknown[],
  queryInputs: [] as unknown[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: () => h.signOut() } },
}));
vi.mock("@/lib/queries/blocks", () => ({
  morePostsBlockQueryOptions: (input: unknown) => {
    h.queryInputs.push(input);
    return { queryKey: ["more-posts", input], queryFn: async () => h.posts, staleTime: 0 };
  },
}));

import {
  LoginOutView,
  MorePostsView,
  PostRatingView,
  PostStatsView,
} from "@/components/blocks/FoxizExtraViews";

const POST: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  publishedAt: "2026-08-19T10:00:00.000Z",
  readingTimeMin: 7,
  author: { id: "a1", name: "Anna Nowak" },
  categories: [
    { name: "Energia", slug: "energia" },
    { name: "Klimat", slug: "klimat" },
  ],
};

const inPost = (ctx: CurrentPostCtx, ui: ReactElement) => (
  <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>
);
/** Tekst widoku bez podwójnych spacji (ikony i separatory to osobne węzły). */
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Pozycje paska meta (bez separatorów) i same separatory - w kolejności DOM. */
const metaParts = (root: HTMLElement) =>
  Array.from(root.firstElementChild?.children ?? []).map((p) => text(p.lastElementChild));
const metaSeparators = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[aria-hidden]:not(svg)")).map((s) => s.textContent);

beforeEach(() => {
  h.user = null;
  h.posts = [];
  h.queryInputs = [];
  h.signOut.mockClear();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("PostStatsView - pasek meta wpisu", () => {
  it("poza kontekstem wpisu nie renderuje niczego (bez zmyślonego „1 min”)", () => {
    const { container } = render(<PostStatsView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("domyślnie: data, autor i czas czytania - w tej kolejności, rozdzielone separatorem", () => {
    const { container } = render(inPost(POST, <PostStatsView lang="pl" />));
    expect(metaParts(container)).toEqual(["19 sierpnia 2026", "przez Anna Nowak", "7 min"]);
    // Separator tylko MIĘDZY pozycjami, schowany przed czytnikiem ekranu.
    expect(metaSeparators(container)).toEqual(["•", "•"]);
  });

  it("własna lista i separator; kategoria to pierwsza z listy, a „comments” nie ma danych", () => {
    const { container } = render(
      inPost(
        POST,
        <PostStatsView items={["category", "comments", "author"]} separator="|" lang="en" />,
      ),
    );
    expect(metaParts(container)).toEqual(["Energia", "by Anna Nowak"]);
    expect(metaSeparators(container)).toEqual(["|"]);
  });

  it("pozycje bez danych znikają: zła data, brak autora i kategorii", () => {
    const ctx: CurrentPostCtx = { kind: "post", id: "p", publishedAt: "nie-data" };
    const { container } = render(
      inPost(ctx, <PostStatsView items={["date", "author", "category"]} />),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("bez `readingTimeMin` czas liczy się z zajawki w języku bloku (220 słów/min, minimum 1)", () => {
    const words = (n: number) => Array.from({ length: n }, () => "słowo").join(" ");
    const ctx: CurrentPostCtx = {
      kind: "post",
      id: "p",
      excerpt_pl: "krótko",
      excerpt_en: words(660),
    };
    const en = render(inPost(ctx, <PostStatsView items={["reading"]} lang="en" />));
    expect(text(en.container)).toBe("3 min");
    en.unmount();
    const pl = render(inPost(ctx, <PostStatsView items={["reading"]} lang="pl" />));
    expect(text(pl.container)).toBe("1 min");
  });

  // NAPRAWIONE 2026-10-18: trasa publiczna nie podaje `viewCount`, a widok
  // malował wtedy każdemu wpisowi „0 wyświetleń". Pozycja wymaga licznika.
  it("wyświetlenia tylko z licznikiem w kontekście, sformatowane w locale bloku", () => {
    const counted = render(
      inPost({ ...POST, viewCount: 12345 }, <PostStatsView items={["views"]} lang="en" />),
    );
    expect(text(counted.container)).toBe("12,345 views");
    counted.unmount();
    const unknown = render(inPost(POST, <PostStatsView items={["views"]} lang="pl" />));
    expect(unknown.container).toBeEmptyDOMElement();
  });
});

describe("PostRatingView - ocena czytelnika", () => {
  const stars = () => screen.getAllByRole("radio");
  const checked = () =>
    stars()
      .filter((s) => s.getAttribute("aria-checked") === "true")
      .map((s) => s.getAttribute("aria-label"));

  it("grupa radiowa nazwana etykietą bloku, a pusta etykieta daje tytuł domyślny", () => {
    const { unmount } = render(inPost(POST, <PostRatingView label="Jak oceniasz?" />));
    expect(screen.getByRole("radiogroup", { name: "Jak oceniasz?" })).toBeInTheDocument();
    expect(stars().map((s) => s.getAttribute("aria-label"))).toEqual([
      "1/5",
      "2/5",
      "3/5",
      "4/5",
      "5/5",
    ]);
    unmount();
    render(inPost(POST, <PostRatingView label="   " lang="en" />));
    expect(screen.getByRole("radiogroup", { name: "Rate this post" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "2/5" }));
    expect(screen.getByText("Thanks for rating!")).toBeInTheDocument();
    expect(screen.getByText("2.0 (1)")).toBeInTheDocument();
  });

  it("kliknięcie zapisuje ocenę pod kluczem wpisu, zaznacza gwiazdkę i dziękuje", () => {
    render(inPost(POST, <PostRatingView />));
    expect(screen.queryByText("Dziękujemy za ocenę!")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "4/5" }));
    expect(window.localStorage.getItem("post-rating:post-1")).toBe("4");
    expect(checked()).toEqual(["4/5"]);
    expect(screen.getByText("Dziękujemy za ocenę!")).toBeInTheDocument();
    expect(screen.getByText("4.0 (1)")).toBeInTheDocument();
  });

  // NAPRAWIONE 2026-10-18 (lokalny agregat): każde kliknięcie dokładało głos,
  // więc czytelnik, który poprawił 5 na 3, widział „4.0 (2)".
  it("zmiana zdania ZASTĘPUJE głos tego samego czytelnika", () => {
    render(inPost(POST, <PostRatingView />));
    fireEvent.click(screen.getByRole("radio", { name: "5/5" }));
    fireEvent.click(screen.getByRole("radio", { name: "3/5" }));
    expect(screen.getByText("3.0 (1)")).toBeInTheDocument();
    expect(checked()).toEqual(["3/5"]);
    expect(window.localStorage.getItem("post-rating:post-1")).toBe("3");
  });

  it("ocena zapisana wcześniej wraca po montażu; śmieć i wartość spoza skali są ignorowane", () => {
    window.localStorage.setItem("post-rating:post-1", "2");
    const ok = render(inPost(POST, <PostRatingView />));
    expect(checked()).toEqual(["2/5"]);
    // Przywrócona ocena + nowy klik to nadal jeden głos.
    fireEvent.click(screen.getByRole("radio", { name: "5/5" }));
    expect(screen.getByText("5.0 (1)")).toBeInTheDocument();
    ok.unmount();

    for (const junk of ["abc", "9", "2.5"]) {
      window.localStorage.setItem("post-rating:post-1", junk);
      const r = render(inPost(POST, <PostRatingView />));
      expect(checked()).toEqual([]);
      expect(screen.queryByText("Dziękujemy za ocenę!")).toBeNull();
      r.unmount();
    }
  });

  it("skala z importu przycięta do całkowitych 1..10", () => {
    for (const [max, count] of [
      [1e6, 10],
      [0, 1],
      [4.6, 5],
      [Number.NaN, 5],
    ] as const) {
      const r = render(inPost(POST, <PostRatingView max={max} />));
      expect(stars()).toHaveLength(count);
      expect(stars().at(-1)?.getAttribute("aria-label")).toBe(`${count}/${count}`);
      r.unmount();
    }
  });

  it("bez identyfikatora wpisu kliknięcie niczego nie zapisuje", () => {
    render(inPost({ kind: "page" }, <PostRatingView />));
    fireEvent.click(screen.getByRole("radio", { name: "5/5" }));
    expect(window.localStorage.length).toBe(0);
    expect(checked()).toEqual([]);
    expect(screen.queryByText("Dziękujemy za ocenę!")).toBeNull();
  });
});

describe("LoginOutView - logowanie / wylogowanie", () => {
  it("gość dostaje link logowania pod adres z bloku", () => {
    const { unmount } = render(<LoginOutView loginHref="/logowanie" />);
    expect(screen.getByRole("link", { name: "Zaloguj się" })).toHaveAttribute("href", "/logowanie");
    unmount();
    render(<LoginOutView lang="en" />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth");
  });

  it("zalogowany: awatar z nazwą, a „Wyloguj” woła `signOut` klienta", async () => {
    h.user = {
      email: "anna@nes.test",
      user_metadata: { avatar_url: "https://cdn.test/a.jpg", display_name: "Anna" },
    };
    render(<LoginOutView />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img", { name: "Anna" })).toHaveAttribute(
      "src",
      "https://cdn.test/a.jpg",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Wyloguj" }));
    });
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it("bez awatara inicjał z nazwy albo e-maila; `showAvatar=false` chowa oba", () => {
    h.user = { email: "zenon@nes.test", user_metadata: {} };
    const r = render(<LoginOutView lang="en" />);
    expect(screen.getByText("Z")).toBeInTheDocument();
    expect(screen.getByText("zenon@nes.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    r.unmount();
    h.user = { email: "zenon@nes.test", user_metadata: { name: "bartek" } };
    const named = render(<LoginOutView />);
    expect(screen.getByText("B")).toBeInTheDocument();
    named.unmount();
    render(<LoginOutView showAvatar={false} />);
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("MorePostsView - polecane wpisy", () => {
  const post = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    slug: `wpis-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    cover_image_url: null,
    published_at: null,
    parent_page_id: null,
    ...extra,
  });

  // Wejście = klucz cache: prefetch SSR (`blockQueryOptionsList`) buduje je
  // z tych samych danych bloku, więc rozjazd oznaczałby drugie zapytanie.
  it("zapytanie dostaje strategię, surowy limit i kategorię TYLKO dla strategii „category”", () => {
    const a = renderWithQueryClient(inPost(POST, <MorePostsView strategy="category" limit={6} />));
    expect(h.queryInputs.at(-1)).toEqual({
      strategy: "category",
      limit: 6,
      categorySlug: "energia",
    });
    a.unmount();
    renderWithQueryClient(inPost(POST, <MorePostsView strategy="trending" />));
    expect(h.queryInputs.at(-1)).toEqual({ strategy: "trending", limit: 4, categorySlug: null });
  });

  it("pomija bieżący wpis, przycina listę do 2..12 i linkuje na /post/<slug>", async () => {
    h.posts = [post("post-1"), post("2"), post("3"), post("4")];
    const { container } = renderWithQueryClient(inPost(POST, <MorePostsView limit={1} />));
    const section = await screen.findByRole("region", { name: "Polecane dla Ciebie" });
    const links = Array.from(section.querySelectorAll("a"));
    expect(links.map((a) => [a.getAttribute("href"), text(a)])).toEqual([
      ["/post/wpis-2", "Tytuł 2"],
      ["/post/wpis-3", "Tytuł 3"],
    ]);
    expect(container.querySelector('a[href="/post/wpis-post-1"]')).toBeNull();
  });

  it("limit ponad 12 pokazuje najwyżej 12 wpisów", async () => {
    h.posts = Array.from({ length: 15 }, (_, i) => post(`x${i}`));
    renderWithQueryClient(inPost(POST, <MorePostsView limit={50} heading="Czytaj dalej" />));
    const section = await screen.findByRole("region", { name: "Czytaj dalej" });
    expect(section.querySelectorAll("li")).toHaveLength(12);
  });

  it("tytuł w języku bloku z awaryjnym drugim językiem i slugiem; okładka ma alt tytułu", async () => {
    h.posts = [
      post("a", { title_en: null, cover_image_url: "https://cdn.test/a.jpg" }),
      post("b", { title_pl: null, title_en: null }),
    ];
    renderWithQueryClient(inPost(POST, <MorePostsView lang="en" />));
    const section = await screen.findByRole("region", { name: "Recommended for you" });
    expect(Array.from(section.querySelectorAll("li")).map(text)).toEqual(["Tytuł a", "wpis-b"]);
    expect(screen.getByRole("img", { name: "Tytuł a" })).toBeInTheDocument();
    expect(section.querySelectorAll("img")).toHaveLength(1);
  });

  it("gdy zostaje tylko bieżący wpis, sekcja się nie pojawia", async () => {
    h.posts = [post("post-1")];
    const { container, queryClient } = renderWithQueryClient(inPost(POST, <MorePostsView />));
    const key = ["more-posts", { strategy: "latest", limit: 4, categorySlug: null }];
    await waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe("success"));
    expect(container).toBeEmptyDOMElement();
  });
});
