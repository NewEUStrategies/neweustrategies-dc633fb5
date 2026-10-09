// Rekomendacje pod artykułem: bramki wejścia, sześć układów i beacon klików.
//
// PO CO OSOBNY PLIK. `postComposition.test.tsx` pilnuje kompozycji wpisu
// (siatka, lista, stan pusty, portal śródtekstowy). Tu leży reszta komponentu,
// która do dziś nie miała ani jednego testu: suwak (autoodtwarzanie, kropki,
// przewijanie), karty, magazyn, oś czasu, beacon `related_post_clicks` przy
// każdym rodzaju linku i kolejność bramek konfiguracja -> zgoda -> zapytanie.
//
// Trzy defekty, które ten plik przybija (każdy przypadek padał na starym kodzie):
//   1. ZGODA PRZED KONFIGURACJĄ. Póki konfiguracja najemcy się liczyła, `cfg`
//      niósł DOMYŚLNĄ wagę personalizacji (3), więc odczyt zgody leciał także
//      u najemcy, który personalizację wyłączył - i jego wynik był od razu
//      wyrzucany.
//   2. PODWÓJNY TYTUŁ DLA CZYTNIKA. W kartach i w magazynie okładka leży
//      WEWNĄTRZ linku, którego nazwą jest już tytuł - `alt` z tytułem kazał
//      czytnikowi ekranu przeczytać go dwa razy.
//   3. SUWAK PRZEWIJAŁ STRONĘ. `scrollIntoView` przewija wszystkie przodki,
//      także okno: przy montażu i przy KAŻDYM takcie autoodtwarzania strona
//      skakała do sekcji rekomendacji, choć czytelnik był wyżej, w tekście.
//
// Bramka ruchu (P3.5): autoodtwarzanie suwaka rusza dopiero po pierwszej
// interakcji albo w punkcie ciszy, a przy `prefers-reduced-motion` wcale.
// Przypadki automatu otwierają bramkę przed renderem.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { RelatedPostsInput } from "@/lib/queries/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";
import type { RelatedPostsConfig } from "@/lib/relatedPosts";

const h = vi.hoisted(() => ({
  config: vi.fn<() => Promise<unknown>>(),
  consent: vi.fn<(userId: string) => Promise<boolean>>(),
  posts: vi.fn<(input: RelatedPostsInput) => Promise<unknown[]>>(),
  auth: { user: null as { id: string } | null, loading: false },
  gpc: false,
  track: vi.fn<(sourcePostId: string, targetPostId: string) => void>(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/queries/relatedPosts", () => ({
  relatedPostsConfigQueryOptions: () => ({
    queryKey: ["related-config"],
    queryFn: () => h.config(),
  }),
  relatedPersonalizationConsentQueryOptions: (userId: string) => ({
    queryKey: ["related-consent", userId],
    queryFn: () => h.consent(userId),
  }),
  relatedPostsQueryOptions: (input: RelatedPostsInput) => ({
    queryKey: ["related-posts", input],
    enabled: !!input.postId,
    queryFn: () => h.posts(input),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/ads/consent", () => ({ isGpcCurrentlyHonored: () => h.gpc }));
vi.mock("@/lib/relatedClickBeacon", () => ({
  trackRelatedClick: (sourcePostId: string, targetPostId: string) =>
    h.track(sourcePostId, targetPostId),
}));

import { RelatedPosts } from "@/components/post/RelatedPosts";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";

const SOURCE = "wpis-zrodlowy";
const COVER = "https://cdn.example.test/okladka.jpg";

function related(id: string, patch: Partial<BlogListItem> = {}): BlogListItem {
  return {
    id,
    slug: `analiza-${id}`,
    title_pl: `Analiza ${id}`,
    title_en: `Analysis ${id}`,
    excerpt_pl: `Skrót ${id}`,
    excerpt_en: `Excerpt ${id}`,
    cover_image_url: null,
    published_at: "2026-07-01T12:00:00Z",
    parent_page_id: "strona-analiz",
    href: `/analizy/analiza-${id}`,
    is_sponsored: null,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...patch,
  };
}

function config(patch: Partial<RelatedPostsConfig> = {}): RelatedPostsConfig {
  return { ...RELATED_POSTS_DEFAULTS, ...patch };
}

/** Obietnica rozstrzygana ręcznie - do przypadków „odczyt jeszcze w drodze". */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderRelated(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Wejście ostatniego zapytania o rekomendacje. */
function lastInput(): RelatedPostsInput {
  const input = h.posts.mock.lastCall?.[0];
  if (!input) throw new Error("test: zapytanie o rekomendacje nie poleciało");
  return input;
}

/** Przepycha mikrozadania react-query bez czekania na DOM. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  h.config.mockReset().mockResolvedValue(config());
  h.consent.mockReset().mockResolvedValue(false);
  h.posts.mockReset().mockResolvedValue([related("r1"), related("r2")]);
  h.track.mockReset();
  h.auth = { user: null, loading: false };
  h.gpc = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("bramki wejścia: konfiguracja -> zgoda -> zapytanie", () => {
  it("odczyt ZGODY czeka na konfigurację - przy wadze 0 najemcy nie leci wcale", async () => {
    h.auth = { user: { id: "u1" }, loading: false };
    const cfg = deferred<RelatedPostsConfig>();
    h.config.mockReturnValue(cfg.promise);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await flush();
    // Konfiguracja w drodze: domyślna waga (3) nie może wywołać odczytu zgody.
    expect(h.consent).not.toHaveBeenCalled();
    expect(h.posts).not.toHaveBeenCalled();

    await act(async () => cfg.resolve(config({ weight_personalization: 0 })));
    await screen.findByRole("region");

    expect(h.consent).not.toHaveBeenCalled();
    expect(h.posts).toHaveBeenCalledTimes(1);
    expect(lastInput().personalizedFor).toBeNull();
    expect(lastInput().scoring.weight_personalization).toBe(0);
  });

  it("przy wadze > 0 zgoda jest czytana RAZ, a rekomendacje czekają na jej wynik", async () => {
    h.auth = { user: { id: "u1" }, loading: false };
    h.config.mockResolvedValue(config({ weight_personalization: 5 }));
    const zgoda = deferred<boolean>();
    h.consent.mockReturnValue(zgoda.promise);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await waitFor(() => expect(h.consent).toHaveBeenCalledTimes(1));
    expect(h.consent).toHaveBeenCalledWith("u1");
    expect(h.posts).not.toHaveBeenCalled();

    await act(async () => zgoda.resolve(true));
    await screen.findByRole("region");

    expect(h.posts).toHaveBeenCalledTimes(1);
    expect(lastInput().personalizedFor).toBe("u1");
  });

  it("sygnał GPC zamyka profilowanie bez pytania rejestru o zgodę", async () => {
    h.auth = { user: { id: "u1" }, loading: false };
    h.gpc = true;
    h.consent.mockResolvedValue(true);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    expect(h.consent).not.toHaveBeenCalled();
    expect(lastInput().personalizedFor).toBeNull();
  });

  it("PADNIĘTA konfiguracja daje rekomendacje na wartościach domyślnych, nie ciszę", async () => {
    h.config.mockRejectedValue(new Error("rpc get_related_posts_config: 503"));

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    const region = await screen.findByRole("region");

    expect(region).toHaveAccessibleName(RELATED_POSTS_DEFAULTS.title_pl);
    expect(lastInput().limit).toBe(RELATED_POSTS_DEFAULTS.items_limit);
  });

  it("PADNIĘTE zapytanie o rekomendacje nie zostawia pustej ramki", async () => {
    h.posts.mockRejectedValue(new Error("post_categories: 500"));

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await waitFor(() => expect(h.posts).toHaveBeenCalled());
    await flush();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("wagi i strategia jadą do zapytania Z KONFIGURACJI najemcy", async () => {
    h.config.mockResolvedValue(
      config({ items_limit: 4, source_strategy: "tags", weight_tags: 7, use_idf: false }),
    );

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    expect(lastInput()).toMatchObject({ postId: SOURCE, limit: 4, strategy: "tags" });
    expect(lastInput().scoring).toMatchObject({ weight_tags: 7, use_idf: false });
  });
});

// ---------------------------------------------------------------------------
describe("siatka, lista i treść karty", () => {
  it("liczba kolumn siatki idzie z konfiguracji (2 / 3 / 4)", async () => {
    const klasy: string[] = [];
    for (const columns of [2, 3, 4] as const) {
      h.config.mockResolvedValue(config({ layout: "grid", columns }));
      const { container, unmount } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
      await screen.findByRole("region");
      klasy.push(container.querySelector(".grid")?.className ?? "");
      unmount();
    }

    expect(klasy[0]).toContain("sm:grid-cols-2");
    expect(klasy[0]).not.toContain("lg:grid-cols");
    expect(klasy[1]).toContain("lg:grid-cols-3");
    expect(klasy[2]).toContain("lg:grid-cols-4");
  });

  it("okładka POZA linkiem (siatka) niesie tytuł w `alt` - jest jedynym opisem obrazka", async () => {
    h.posts.mockResolvedValue([related("r1", { cover_image_url: COVER })]);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    const img = await screen.findByRole("img", { name: "Analiza r1" });

    expect(img.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "Analiza r1" })).toHaveAttribute(
      "href",
      "/analizy/analiza-r1",
    );
  });

  it("lista pokazuje miniaturę z opisem, a bez okładki - sam tekst", async () => {
    h.config.mockResolvedValue(config({ layout: "list" }));
    h.posts.mockResolvedValue([related("r1", { cover_image_url: COVER }), related("r2")]);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("img", { name: "Analiza r1" })).toBeInTheDocument();
    expect(within(items[1]).queryByRole("img")).toBeNull();
  });

  it("wyłączone okładka, skrót i data znikają z karty", async () => {
    h.config.mockResolvedValue(
      config({ show_cover: false, show_excerpt: false, show_meta: false }),
    );
    h.posts.mockResolvedValue([related("r1", { cover_image_url: COVER })]);

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Skrót r1")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    expect(screen.getByRole("link", { name: "Analiza r1" })).toBeInTheDocument();
  });

  it("data publikacji jest maszynowo czytelna i sformatowana w języku widoku", async () => {
    renderRelated(<RelatedPosts postId={SOURCE} lang="en" />);
    await screen.findByRole("region");

    const times = document.querySelectorAll("time");
    expect(times[0]).toHaveAttribute("dateTime", "2026-07-01T12:00:00Z");
    expect(times[0].textContent).toBe("1 Jul 2026");
  });

  it("brakujący tytuł w języku widoku spada na drugi język, a nie na pusty link", async () => {
    h.posts.mockResolvedValue([
      related("r1", { title_en: "", cover_image_url: COVER }),
      related("r2", { title_pl: "" }),
    ]);

    const { unmount } = renderRelated(<RelatedPosts postId={SOURCE} lang="en" />);
    await screen.findByRole("region");
    expect(screen.getByRole("link", { name: "Analiza r1" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Analiza r1" })).toBeInTheDocument();
    unmount();

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    expect(screen.getByRole("link", { name: "Analysis r2" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("suwak", () => {
  beforeEach(() => {
    // Wyłącznie interwały: `setTimeout` zostaje prawdziwy, bo na nim jedzie
    // planista powiadomień react-query i oczekiwanie `findBy*`.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    h.posts.mockResolvedValue([related("r1"), related("r2"), related("r3")]);
    __openMotionGateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetMotionGateForTests();
    vi.unstubAllGlobals();
  });

  function aktywna(): string | null {
    const tab = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");
    return tab?.getAttribute("aria-label") ?? null;
  }

  it("kropka przełącza slajd i przewija SAM tor - poziomo, bez ruszania strony", async () => {
    h.config.mockResolvedValue(config({ layout: "slider" }));
    const pageScroll = vi.spyOn(Element.prototype, "scrollIntoView");

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    const track = container.querySelector(".snap-x");
    if (!track) throw new Error("test: brak toru suwaka");
    const trackScroll = vi.spyOn(track, "scrollBy");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 0, 600, 300));
    vi.spyOn(track.children[1], "getBoundingClientRect").mockReturnValue(
      new DOMRect(340, 0, 280, 300),
    );

    expect(aktywna()).toBe("Slide 1");
    fireEvent.click(screen.getByRole("tab", { name: "Slide 2" }));

    expect(aktywna()).toBe("Slide 2");
    expect(trackScroll).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
    // Ani montaż, ani przełączenie nie przewijają okna.
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("autoodtwarzanie przesuwa slajdy w kółko, z interwałem nie krótszym niż 2 s", async () => {
    h.config.mockResolvedValue(
      config({ layout: "slider", slider_autoplay: true, slider_interval_ms: 500 }),
    );
    const pageScroll = vi.spyOn(Element.prototype, "scrollIntoView");

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(aktywna()).toBe("Slide 1");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(aktywna()).toBe("Slide 2");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // Trzy slajdy: po trzecim wraca pierwszy.
    expect(aktywna()).toBe("Slide 1");
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("bez autoodtwarzania nie ma interwału, a odmontowanie sprząta ten włączony", async () => {
    h.config.mockResolvedValue(config({ layout: "slider" }));
    const pierwszy = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    expect(vi.getTimerCount()).toBe(0);
    pierwszy.unmount();

    h.config.mockResolvedValue(config({ layout: "slider", slider_autoplay: true }));
    const drugi = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    expect(vi.getTimerCount()).toBe(1);
    drugi.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("bramka ruchu zamknięta: automat stoi; po otwarciu pierwszy krok po pełnym interwale", async () => {
    __resetMotionGateForTests();
    h.config.mockResolvedValue(
      config({ layout: "slider", slider_autoplay: true, slider_interval_ms: 3000 }),
    );
    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    // Krokami po sekundzie: skok 30 s mógłby wrócić na pierwszy slajd po pełnych obrotach.
    for (let second = 0; second < 30; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(aktywna()).toBe("Slide 1");
    }
    expect(vi.getTimerCount()).toBe(0);

    act(() => __openMotionGateForTests());
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(aktywna()).toBe("Slide 1");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(aktywna()).toBe("Slide 2");
  });

  it("prefers-reduced-motion: bez autoodtwarzania także po otwarciu bramki", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    h.config.mockResolvedValue(config({ layout: "slider", slider_autoplay: true }));
    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    expect(vi.getTimerCount()).toBe(0);
    // Krokami po sekundzie: skok 30 s mógłby wrócić na pierwszy slajd po pełnych obrotach.
    for (let second = 0; second < 30; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(aktywna()).toBe("Slide 1");
    }
  });

  it("pojedyncza rekomendacja nie dostaje kropek nawigacji", async () => {
    h.config.mockResolvedValue(config({ layout: "slider" }));
    h.posts.mockResolvedValue([related("r1")]);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("link", { name: "Analiza r1" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe("karty, magazyn, oś czasu", () => {
  it('karta-link: okładka jest dekoracją (`alt=""`), tytuł czytany RAZ', async () => {
    h.config.mockResolvedValue(config({ layout: "cards" }));
    h.posts.mockResolvedValue([related("r1", { cover_image_url: COVER }), related("r2")]);

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    const cover = container.querySelector("a img");
    expect(cover).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img", { name: "Analiza r1" })).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/analizy/analiza-r1");
    expect(within(links[0]).getByRole("heading", { level: 3 })).toHaveTextContent("Analiza r1");
  });

  it("karta bez okładki dostaje pasek akcentu, a etykiety idą w języku widoku", async () => {
    h.config.mockResolvedValue(config({ layout: "cards", show_meta: false }));
    h.posts.mockResolvedValue([related("r1")]);

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="en" />);
    await screen.findByRole("region");

    const link = screen.getByRole("link");
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("div.h-2[aria-hidden]")).not.toBeNull();
    expect(within(link).getByText("Recommended")).toBeInTheDocument();
    expect(within(link).getByText("Read")).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });

  it("karta pokazuje skrót i datę, gdy konfiguracja ich chce", async () => {
    h.config.mockResolvedValue(config({ layout: "cards" }));
    h.posts.mockResolvedValue([related("r1")]);

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    const link = screen.getByRole("link");
    expect(within(link).getByText("Polecane")).toBeInTheDocument();
    expect(within(link).getByText("Skrót r1")).toBeInTheDocument();
    expect(link.querySelector("time")).toHaveTextContent("1 lip 2026");
  });

  it("magazyn: pierwszy wpis jest wyróżniony, boczna lista mieści najwyżej pięć", async () => {
    h.config.mockResolvedValue(config({ layout: "magazine" }));
    h.posts.mockResolvedValue([
      related("r1", { cover_image_url: COVER }),
      ...["r2", "r3", "r4", "r5", "r6", "r7"].map((id) => related(id)),
    ]);

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    const hero = screen.getByRole("heading", { level: 3 });
    expect(hero).toHaveTextContent("Analiza r1");
    expect(hero.closest("a")).toHaveTextContent("Wyróżnione");
    expect(within(hero.closest("a") ?? container).getByText("Skrót r1")).toBeInTheDocument();
    // Okładka wyróżnienia leży w linku z tytułem - dekoracja.
    expect(hero.closest("a")?.querySelector("img")).toHaveAttribute("alt", "");
    const side = screen.getAllByRole("heading", { level: 4 }).map((el) => el.textContent);
    expect(side).toEqual(["Analiza r2", "Analiza r3", "Analiza r4", "Analiza r5", "Analiza r6"]);
  });

  it("magazyn po angielsku: etykieta i tytuły EN, data w liście bocznej", async () => {
    h.config.mockResolvedValue(config({ layout: "magazine", show_cover: false }));
    h.posts.mockResolvedValue([related("r1"), related("r2")]);

    renderRelated(<RelatedPosts postId={SOURCE} lang="en" />);
    await screen.findByRole("region");

    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Analysis r1");
    const side = screen.getByRole("heading", { level: 4 });
    expect(side).toHaveTextContent("Analysis r2");
    expect(side.parentElement?.querySelector("time")).toHaveTextContent("1 Jul 2026");
  });

  it("oś czasu: wpisy w kolejności, data z PEŁNĄ nazwą miesiąca i skrót", async () => {
    h.config.mockResolvedValue(config({ layout: "timeline" }));

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("h3")?.textContent)).toEqual([
      "Analiza r1",
      "Analiza r2",
    ]);
    expect(items[0].querySelector("time")).toHaveTextContent("1 lipca 2026");
    expect(within(items[0]).getByText("Skrót r1")).toBeInTheDocument();
  });

  it("oś czasu bez metadanych i skrótów zostawia sam tytuł", async () => {
    h.config.mockResolvedValue(
      config({ layout: "timeline", show_meta: false, show_excerpt: false }),
    );

    const { container } = renderRelated(<RelatedPosts postId={SOURCE} lang="en" />);
    await screen.findByRole("region");

    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryByText("Excerpt r1")).toBeNull();
    expect(screen.getByRole("link", { name: "Analysis r1" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BEACON. Każdy rodzaj linku w każdym układzie ma zgłosić parę (źródło, cel) -
// z tego `related_post_clicks` panel BI liczy CTR i ranking przejść. Link bez
// beaconu nie psuje niczego widocznego, więc bez testu wypadłby po cichu.
describe("beacon kliknięcia", () => {
  // Kliknięcie w kotwicę happy-dom kończyłoby się nawigacją okna testu.
  const blockNavigation = (event: Event) => event.preventDefault();
  beforeEach(() => document.addEventListener("click", blockNavigation));
  afterEach(() => document.removeEventListener("click", blockNavigation));

  it.each([
    ["grid", "Analiza r2"],
    ["slider", "Analiza r2"],
    ["cards", "Analiza r2"],
    ["timeline", "Analiza r2"],
  ] as const)("układ %s zgłasza parę (źródło, cel) klikniętego wpisu", async (layout, name) => {
    h.config.mockResolvedValue(config({ layout, show_excerpt: false, show_meta: false }));

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    fireEvent.click(screen.getByRole("link", { name: new RegExp(name) }));

    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith(SOURCE, "r2");
  });

  it("magazyn zgłasza zarówno wyróżnienie, jak i pozycję z listy bocznej", async () => {
    h.config.mockResolvedValue(config({ layout: "magazine" }));

    renderRelated(<RelatedPosts postId={SOURCE} lang="pl" />);
    await screen.findByRole("region");
    fireEvent.click(screen.getByRole("heading", { level: 3 }));
    fireEvent.click(screen.getByRole("heading", { level: 4 }));

    expect(h.track.mock.calls).toEqual([
      [SOURCE, "r1"],
      [SOURCE, "r2"],
    ]);
  });
});
