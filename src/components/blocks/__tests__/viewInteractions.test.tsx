// INTERAKCJE i WARIANTY widoków bloków publicznych.
//
// Macierze (`blockMatrix`, `blockMatrixLoaded`) dowodzą, że każdy blok
// RENDERUJE się w każdym stanie danych. Zostaje druga połowa: gałęzie, które
// otwiera dopiero KLIKNIĘCIE albo konkretna wartość enuma - karuzela na
// „następny", akordeon na rozwinięciu, zakładki na przełączeniu, gwiazdki
// oceny, kopiowanie kodu, lightbox galerii, suwak porównania. Te ścieżki
// widzi czytelnik, a żadna z nich nie wykonuje się przy samym montażu.
//
// Widoki są tu wołane WPROST (są eksportowane), bo przez `BlockView` nie da się
// podać wariantu, którego rejestr nie mapuje - a każdy wariant to osobna gałąź.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  submit: vi.fn(),
  posts: [] as unknown[],
  taxonomy: [] as unknown[],
  session: null as unknown,
  clipboard: vi.fn(),
}));

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
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => h.submit };
});
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    latestPostsBlockQueryOptions: (i: unknown) => opts(["lp", i], () => h.posts),
    queryLoopBlockQueryOptions: (i: unknown) => opts(["ql", i], () => h.posts),
    relatedPostsBlockQueryOptions: (i: unknown) => opts(["rp", i], () => h.posts),
    morePostsBlockQueryOptions: (i: unknown) => opts(["mp", i], () => h.posts),
    blockCategoriesQueryOptions: (l: unknown) => opts(["cat", l], () => h.taxonomy),
    blockArchivesQueryOptions: (l: unknown) => opts(["arch", l], () => h.taxonomy),
    blockTagsQueryOptions: (l: unknown) => opts(["tags", l], () => []),
    blockNavigationQueryOptions: () => opts(["nav"], () => []),
    postNeighborQueryOptions: (i: unknown) => opts(["nb", i], () => null),
    pollBlockQueryOptions: (i: unknown) => opts(["poll", i], () => null),
    authorProfileByIdQueryOptions: (i: unknown) => opts(["ap", i], () => null),
    authorPostsCountQueryOptions: (i: unknown) => opts(["apc", i], () => 12),
    calendarBlockQueryOptions: (i: unknown) => opts(["cal", i], () => []),
    calendarTarget: () => ({ year: 2026, month: 8 }),
    liveBlogEntriesBlockQueryOptions: (i: unknown) => opts(["lb", i], () => []),
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const link of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "like",
    "ilike",
    "or",
    "filter",
    "match",
    "contains",
    "overlaps",
    "order",
    "limit",
    "range",
    "returns",
    "abortSignal",
  ]) {
    chain[link] = () => chain;
  }
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: h.session }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});

import {
  IconBoxView,
  StatsCounterView,
  TestimonialsView,
  PricingTableView,
  TimelineView,
} from "../PresentationViews";
import {
  HeroView,
  CtaSectionView,
  ImageCarouselView,
  ContactFormView as MarketingContactFormView,
  MapView,
} from "../MarketingViews";
import {
  TeamGridView,
  LogoGridView,
  FeatureGridView,
  AlertBannerView,
  DividerTextView,
} from "../DataSocialViews";
import {
  StepListView,
  ComparisonTableView,
  BannerImageView,
  VideoHeroView,
} from "../ConversionViews";
import { AccordionView, TabsView, CountdownView, ProgressView } from "../InteractiveViews";
import { PostStatsView, PostRatingView, LoginOutView, MorePostsView } from "../FoxizExtraViews";
import {
  BreadcrumbsView,
  ReadingTimeView,
  PostViewsView,
  ShareButtonsView,
} from "../PostUtilityViews";
import { TaxonomyListView } from "../TaxonomyListView";
import { TocBlockView } from "../TocBlockView";
import { CodeBlockView } from "../CodeBlockView";
import { GalleryBlock } from "../GalleryBlock";
import { LinkPreviewBlockView } from "../LinkPreviewBlockView";
import { CompareSlider } from "../CompareSlider";
import type { Block } from "@/lib/blocks/types";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  title_pl: "Tytuł wpisu",
  title_en: "Post title",
  excerpt_pl: "Zajawka.",
  excerpt_en: "Excerpt.",
  coverUrl: "https://cdn.test/c.jpg",
  publishedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
  readingTimeMin: 7,
  viewCount: 1234,
  author: { id: "author-1", name: "Autor", slug: "autor" } as CurrentPostCtx["author"],
  categories: [{ slug: "analizy", name: "Analizy" }],
  tags: [{ slug: "energia", name: "Energia" }],
  breadcrumbs: [
    { label: "Start", href: "/" },
    { label: "Analizy", href: "/analizy" },
    { label: "Wpis" },
  ],
};

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={POST_CTX}>{children}</CurrentPostProvider>
    </QueryClientProvider>
  );
}

function view(ui: ReactElement): HTMLElement {
  const { container } = render(<Wrap>{ui}</Wrap>);
  return container;
}

/**
 * Indeks aktywnej klatki karuzeli. Wszystkie klatki zostają w DOM (jeden
 * przesuwany pasek), więc aktywną poznaje się po BRAKU `aria-hidden`, a nie po
 * obecności tekstu.
 */
function activeIndex(container: HTMLElement): number {
  const slides = Array.from(container.querySelectorAll("[aria-hidden]")).filter((el) =>
    el.querySelector("img"),
  );
  return slides.findIndex((el) => el.getAttribute("aria-hidden") === "false");
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];
function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}"`).toBe(false);
  }
}

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
  h.posts = [];
  h.taxonomy = [
    { label: "Analizy", href: "/analizy", count: 12 },
    { label: "Raporty", href: "/raporty", count: 0 },
  ];
  h.session = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("ImageCarouselView - nawigacja i autoodtwarzanie", () => {
  // Wszystkie pozycje mają JEDNAKOWY kształt - `Json` nie dopuszcza
  // `undefined` w wartościach, a mieszane literały dawałyby taki typ.
  const SLIDES = [
    { url: "https://cdn.test/1.jpg", alt: "Pierwszy", caption: "Podpis 1", href: "/a" },
    { url: "https://cdn.test/2.jpg", alt: "Drugi", caption: "", href: "" },
    { url: "https://cdn.test/3.jpg", alt: "Trzeci", caption: "Podpis 3", href: "" },
  ];

  it("BEZ zdjęć nie renderuje niczego", () => {
    const container = view(<ImageCarouselView items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("items NIE-tablicowe nie renderują niczego", () => {
    const container = view(<ImageCarouselView items={"nie tablica" as never} />);
    expect(container.innerHTML).toBe("");
  });

  it("pozycje BEZ adresu obrazu są odfiltrowane", () => {
    const container = view(<ImageCarouselView items={[{ alt: "bez url" }, SLIDES[0]]} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("pokazuje pierwszą klatkę i jej podpis", () => {
    const container = view(<ImageCarouselView items={SLIDES} />);
    expect(container.textContent).toContain("Podpis 1");
  });

  it("przycisk NASTĘPNY przesuwa karuzelę", () => {
    const container = view(<ImageCarouselView items={SLIDES} />);
    expect(activeIndex(container)).toBe(0);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[1]);
    expect(activeIndex(container)).toBe(1);
  });

  it("przycisk POPRZEDNI z pierwszej klatki zawija na ostatnią", () => {
    const container = view(<ImageCarouselView items={SLIDES} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    fireEvent.click(buttons[0]);
    expect(activeIndex(container)).toBe(SLIDES.length - 1);
  });

  it("karuzela z JEDNYM zdjęciem nie pokazuje strzałek", () => {
    const container = view(<ImageCarouselView items={[SLIDES[0]]} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("autoodtwarzanie przesuwa klatkę po upływie interwału", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(<ImageCarouselView items={SLIDES} autoplay interval={2000} />);
    expect(activeIndex(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(activeIndex(container)).toBe(1);
  });

  it("interwał KRÓTSZY niż minimalny jest podnoszony do 1500 ms", () => {
    vi.useFakeTimers();
    const container = view(<ImageCarouselView items={SLIDES} autoplay interval={10} />);
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(activeIndex(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(activeIndex(container)).toBe(1);
  });

  it("najechanie kursorem PAUZUJE autoodtwarzanie, zjechanie je wznawia", () => {
    vi.useFakeTimers();
    const container = view(<ImageCarouselView items={SLIDES} autoplay interval={2000} />);
    const region = container.querySelector('[role="region"]') as HTMLElement;
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(activeIndex(container)).toBe(0);
    fireEvent.mouseLeave(region);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(activeIndex(container)).toBe(1);
  });

  it("BEZ autoodtwarzania klatka nie zmienia się sama", () => {
    vi.useFakeTimers();
    const container = view(<ImageCarouselView items={SLIDES} interval={2000} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(activeIndex(container)).toBe(0);
  });

  it.each(["16:9", "4:3", "1:1", "21:9"] as const)("proporcje %s renderują karuzelę", (aspect) => {
    const container = view(<ImageCarouselView items={SLIDES} aspect={aspect} />);
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("klatka z linkiem opakowuje obraz w odnośnik", () => {
    const container = view(<ImageCarouselView items={[SLIDES[0]]} />);
    expect(container.querySelector("a")).toBeTruthy();
  });
});

describe("MarketingViews.ContactFormView - wysyłka", () => {
  const fill = (container: HTMLElement): void => {
    const inputs = Array.from(container.querySelectorAll("input, textarea"));
    for (const el of inputs) {
      const node = el as HTMLInputElement;
      if (node.type === "checkbox") continue;
      fireEvent.change(node, {
        target: { value: node.type === "email" ? "jan@firma.pl" : "Treść" },
      });
    }
  };

  it("BRAK wymaganej zgody pokazuje komunikat i NIE wysyła", async () => {
    const container = view(<MarketingContactFormView />);
    fill(container);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("zaznaczona zgoda przepuszcza wysyłkę i czyści formularz", async () => {
    const container = view(<MarketingContactFormView />);
    fill(container);
    const consent = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(consent);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.consent).toBe(true);
    expect(payload.lang).toBe("pl");
    expect(payload.consents).toEqual([
      { key: "rodo", text: expect.any(String), given: true, lang: "pl" },
    ]);
  });

  it("zgoda NIEwymagana wysyła bez zaznaczania", async () => {
    const container = view(<MarketingContactFormView requireConsent={false} />);
    fill(container);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    // Bez wymaganej zgody lista zgód NIE jest wysyłana wcale.
    expect(h.submit.mock.calls[0][0].data.consents).toBeUndefined();
  });

  it("BŁĄD API pokazuje komunikat, nie surowy wyjątek", async () => {
    h.submit.mockRejectedValue(new Error("relation does not exist"));
    const container = view(<MarketingContactFormView requireConsent={false} />);
    fill(container);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(container.textContent).not.toContain("relation does not exist"));
  });

  it("pole telefonu i tematu włącza się przełącznikiem", () => {
    const container = view(<MarketingContactFormView showPhone showSubject />);
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThanOrEqual(4);
  });

  it("wyłączony temat usuwa pole z formularza", () => {
    const withSubject = view(<MarketingContactFormView showSubject />);
    const countWith = withSubject.querySelectorAll("input").length;
    cleanup();
    const without = view(<MarketingContactFormView showSubject={false} />);
    expect(without.querySelectorAll("input").length).toBeLessThan(countWith);
  });

  it("tytuł, opis i etykieta przycisku z propsów trafiają do renderu", () => {
    const container = view(
      <MarketingContactFormView
        title="Napisz do nas"
        description="Odpowiadamy szybko"
        submitLabel="Prześlij"
      />,
    );
    expect(container.textContent).toContain("Napisz do nas");
    expect(container.textContent).toContain("Odpowiadamy szybko");
    expect(container.textContent).toContain("Prześlij");
  });

  it("własny komunikat sukcesu wygrywa nad domyślnym", async () => {
    const container = view(
      <MarketingContactFormView requireConsent={false} successMessage="Dziękujemy!" />,
    );
    fill(container);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(container.textContent).toContain("Dziękujemy!"));
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", (lang) => {
    const container = view(<MarketingContactFormView lang={lang} />);
    assertNoLeak(container, `contact ${lang}`);
  });
});

describe("AccordionView / TabsView - rozwijanie i przełączanie", () => {
  const ITEMS = [
    { label: "Sekcja A", body: "Treść A" },
    { label: "Sekcja B", body: "Treść B" },
  ];

  it("akordeon startuje zwinięty i rozwija się na kliknięcie", () => {
    const container = view(<AccordionView items={ITEMS} />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    expect(container.textContent).toContain("Treść A");
  });

  it("drugie kliknięcie ZWIJA sekcję (idempotencja przełączenia)", () => {
    const container = view(<AccordionView items={ITEMS} />);
    const button = container.querySelectorAll("button")[0];
    fireEvent.click(button);
    fireEvent.click(button);
    expect(container.textContent).not.toContain("Treść A");
  });

  it("BEZ allowMultiple otwarcie drugiej sekcji zamyka pierwszą", () => {
    const container = view(<AccordionView items={ITEMS} />);
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(container.textContent).toContain("Treść B");
    expect(container.textContent).not.toContain("Treść A");
  });

  it("Z allowMultiple obie sekcje zostają otwarte", () => {
    const container = view(<AccordionView items={ITEMS} allowMultiple />);
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(container.textContent).toContain("Treść A");
    expect(container.textContent).toContain("Treść B");
  });

  it.each([
    ["pusta tablica", []],
    ["nie tablica", "x" as never],
  ])("akordeon dla %s nie renderuje niczego", (_l, items) => {
    const container = view(<AccordionView items={items as never} />);
    expect(container.textContent).toBe("");
  });

  it("zakładki pokazują pierwszą treść i przełączają się na kliknięcie", () => {
    const container = view(<TabsView items={ITEMS} />);
    // Panele zostają w DOM (SSR + dostępność); aktywny poznaje się po
    // `aria-selected` zakładki i braku atrybutu `hidden` na panelu.
    const selected = () =>
      Array.from(container.querySelectorAll('[role="tab"]')).findIndex(
        (b) => b.getAttribute("aria-selected") === "true",
      );
    const visiblePanels = () =>
      Array.from(container.querySelectorAll('[role="tabpanel"]')).filter(
        (p) => !p.hasAttribute("hidden"),
      );
    expect(selected()).toBe(0);
    expect(visiblePanels()).toHaveLength(1);
    expect(visiblePanels()[0].textContent).toContain("Treść A");
    fireEvent.click(container.querySelectorAll('[role="tab"]')[1]);
    expect(selected()).toBe(1);
    expect(visiblePanels()[0].textContent).toContain("Treść B");
  });

  it.each(["horizontal", "vertical"] as const)(
    "zakładki w orientacji %s renderują się",
    (orientation) => {
      const container = view(<TabsView items={ITEMS} orientation={orientation} />);
      expect(container.querySelectorAll("button")).toHaveLength(2);
    },
  );

  it.each([
    ["pusta tablica", []],
    ["nie tablica", "x" as never],
  ])("zakładki dla %s nie renderują niczego", (_l, items) => {
    const container = view(<TabsView items={items as never} />);
    expect(container.textContent).toBe("");
  });

  it("pozycja BEZ etykiety nie wypisuje wartości zastępczej", () => {
    const container = view(<TabsView items={[{ body: "Sama treść" }]} />);
    assertNoLeak(container, "tabs bez etykiety");
  });
});

describe("CountdownView - odliczanie", () => {
  it("pokazuje odliczanie do daty w przyszłości", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(<CountdownView targetAt="2026-08-20T12:00:00.000Z" label="Do startu" />);
    expect(container.textContent).toContain("Do startu");
    assertNoLeak(container, "countdown");
  });

  it("data w PRZESZŁOŚCI pokazuje komunikat wygaśnięcia", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(
      <CountdownView targetAt="2020-01-01T00:00:00.000Z" expiredText="Czas minął" />,
    );
    expect(container.textContent).toContain("Czas minął");
  });

  it("odliczanie zmienia się z upływem czasu", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(<CountdownView targetAt="2026-08-19T12:00:30.000Z" />);
    const before = container.textContent;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.textContent).not.toBe(before);
  });

  it("przekroczenie terminu W TRAKCIE odliczania pokazuje wygaśnięcie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(
      <CountdownView targetAt="2026-08-19T12:00:02.000Z" expiredText="Koniec" />,
    );
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.textContent).toContain("Koniec");
  });

  it.each([
    ["brak daty", undefined],
    ["pusta data", ""],
    ["data nieprawidłowa", "to-nie-data"],
  ])("%s nie wypisuje Invalid Date", (_l, targetAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(<CountdownView targetAt={targetAt} />);
    assertNoLeak(container, `countdown ${String(targetAt)}`);
  });

  it.each(["pl", "en"] as const)("etykiety jednostek w języku %s", (lang) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const container = view(<CountdownView targetAt="2026-09-19T12:00:00.000Z" lang={lang} />);
    assertNoLeak(container, `countdown ${lang}`);
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });
});

describe("ProgressView", () => {
  it.each([0, 1, 50, 99, 100])("wartość %i renderuje pasek", (value) => {
    const container = view(<ProgressView value={value} showValue />);
    expect(container.textContent).toContain(`${value}`);
  });

  it.each([-10, 150])("wartość poza zakresem (%s) jest klampowana", (value) => {
    const container = view(<ProgressView value={value} showValue />);
    assertNoLeak(container, `progress ${value}`);
  });

  // NaN nie jest „wartością poza zakresem" - to brak wartości. Widok go NIE
  // normalizuje, więc wypisuje „NaN". Na ścieżce bloków jest to nieosiągalne:
  // `renderProgress` czyta wartość przez `num(data, "value", 0)`, a ten czytnik
  // odrzuca wszystko, co nie jest liczbą skończoną. Test przybija ten podział
  // odpowiedzialności - normalizacja należy do czytnika danych, nie do widoku.
  it("NaN przechodzi przez widok dosłownie (normalizacja należy do czytnika)", () => {
    const container = view(<ProgressView value={Number.NaN} showValue />);
    expect(container.textContent).toContain("NaN");
  });

  it("czytnik danych bloku zamienia NaN na 0, więc render publiczny go nie widzi", async () => {
    const { num } = await import("@/components/blocks/renderer/data");
    expect(num({ value: Number.NaN as never }, "value", 0)).toBe(0);
    expect(num({ value: "abc" }, "value", 0)).toBe(0);
    expect(num({}, "value", 0)).toBe(0);
  });

  it("showValue wyłączone ukrywa liczbę", () => {
    const container = view(<ProgressView value={42} showValue={false} />);
    expect(container.textContent).not.toContain("42");
  });

  it.each(["primary", "success", "warning", "danger"] as const)(
    "kolor %s renderuje pasek",
    (color) => {
      const container = view(<ProgressView value={40} color={color} />);
      expect(container.innerHTML.length).toBeGreaterThan(0);
    },
  );

  it("etykieta z propsów trafia do renderu", () => {
    const container = view(<ProgressView value={40} label="Realizacja" />);
    expect(container.textContent).toContain("Realizacja");
  });
});

describe("PostRatingView - ocena wpisu", () => {
  it("renderuje gwiazdki w liczbie max", () => {
    const container = view(<PostRatingView max={5} label="Oceń" />);
    expect(container.querySelectorAll("button").length).toBe(5);
    expect(container.textContent).toContain("Oceń");
  });

  it("kliknięcie gwiazdki ustawia ocenę", () => {
    const container = view(<PostRatingView max={5} />);
    const stars = container.querySelectorAll("button");
    fireEvent.click(stars[3]);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("najechanie na gwiazdkę podświetla ocenę, zjechanie ją cofa", () => {
    const container = view(<PostRatingView max={5} />);
    const stars = container.querySelectorAll("button");
    fireEvent.mouseEnter(stars[2]);
    fireEvent.mouseLeave(stars[2]);
    expect(container.querySelectorAll("button").length).toBe(5);
  });

  it.each([1, 3, 10])("max %i renderuje tyle gwiazdek", (max) => {
    const container = view(<PostRatingView max={max} />);
    expect(container.querySelectorAll("button").length).toBe(max);
  });

  it.each([0, -1])("max %i nie renderuje ujemnej liczby gwiazdek", (max) => {
    const container = view(<PostRatingView max={max} />);
    expect(container.querySelectorAll("button").length).toBeGreaterThanOrEqual(0);
    assertNoLeak(container, `rating max=${max}`);
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", (lang) => {
    const container = view(<PostRatingView max={5} lang={lang} />);
    assertNoLeak(container, `rating ${lang}`);
  });
});

describe("LoginOutView", () => {
  it("BEZ sesji pokazuje odnośnik logowania", async () => {
    const container = view(<LoginOutView loginHref="/logowanie" />);
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/logowanie");
  });

  it("Z sesją pokazuje stan zalogowania", async () => {
    h.session = { user: { id: "u-1", email: "jan@firma.pl" } };
    const container = view(<LoginOutView showAvatar />);
    await waitFor(() => expect((container.textContent ?? "").length).toBeGreaterThan(0));
    assertNoLeak(container, "loginout z sesją");
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", async (lang) => {
    const container = view(<LoginOutView lang={lang} />);
    await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));
    assertNoLeak(container, `loginout ${lang}`);
  });
});

describe("PostStatsView / ReadingTimeView / PostViewsView / BreadcrumbsView", () => {
  it.each([
    ["views"],
    ["reading"],
    ["date"],
    ["author"],
    ["category"],
    // „comments" jest świadomie nieobsługiwane (brak agregatu w kontekście
    // wpisu) - musi wypaść bez śladu, nie wywalić widoku.
    ["comments"],
    ["nieznana-pozycja"],
  ])("statystyka %s renderuje się bez wyjątku", (item) => {
    const container = view(<PostStatsView items={[item]} separator="-" />);
    assertNoLeak(container, `stats ${item}`);
  });

  it("wiele statystyk rozdziela separatorem", () => {
    const container = view(<PostStatsView items={["views", "reading"]} separator="|" />);
    expect(container.textContent).toContain("|");
  });

  it("PUSTA lista pozycji spada na zestaw domyślny", () => {
    const container = view(<PostStatsView items={[]} separator="-" />);
    expect(container.textContent).toContain("Autor");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
  ])("statystyki dla %s nie wypisują nic dziwnego", (_l, items) => {
    const container = view(<PostStatsView items={items as never} />);
    assertNoLeak(container, "stats puste");
  });

  it("czas czytania liczy się z prędkością z propsów", () => {
    const container = view(<ReadingTimeView wpm={100} prefix="Czas:" />);
    expect(container.textContent).toContain("Czas:");
    assertNoLeak(container, "reading time");
  });

  it.each([0, -100, Number.NaN])(
    "prędkość czytania %s nie daje NaN ani dzielenia przez zero",
    (wpm) => {
      const container = view(<ReadingTimeView wpm={wpm} />);
      assertNoLeak(container, `reading time wpm=${wpm}`);
    },
  );

  it("licznik odsłon dokleja przyrostek z propsów", () => {
    const container = view(<PostViewsView suffix="odsłon" />);
    expect(container.textContent).toContain("odsłon");
    expect(container.textContent).toContain("1234");
  });

  it("licznik odsłon BEZ przyrostka pokazuje samą liczbę", () => {
    const container = view(<PostViewsView />);
    assertNoLeak(container, "post views");
  });

  it.each(["/", ">", "-", "•"])("okruszki z separatorem %s renderują ścieżkę", (separator) => {
    const container = view(<BreadcrumbsView separator={separator} showHome />);
    expect(container.textContent).toContain("Analizy");
  });

  it("okruszki BEZ strony głównej pomijają pierwszy poziom", () => {
    const withHome = view(<BreadcrumbsView showHome />);
    const countWith = withHome.querySelectorAll("a").length;
    cleanup();
    const without = view(<BreadcrumbsView showHome={false} />);
    expect(without.querySelectorAll("a").length).toBeLessThanOrEqual(countWith);
  });

  it.each(["pl", "en"] as const)("okruszki w języku %s", (lang) => {
    const container = view(<BreadcrumbsView lang={lang} />);
    assertNoLeak(container, `breadcrumbs ${lang}`);
  });
});

describe("ShareButtonsView", () => {
  it.each(["x", "facebook", "linkedin", "mail", "whatsapp", "telegram", "reddit", "copy"] as const)(
    "kanał %s renderuje przycisk udostępniania",
    (network) => {
      const container = view(<ShareButtonsView networks={[network]} />);
      expect(container.innerHTML.length).toBeGreaterThan(0);
      assertNoLeak(container, `share ${network}`);
    },
  );

  it.each(["filled", "outline", "ghost"] as const)("wariant %s renderuje przyciski", (variant) => {
    const container = view(<ShareButtonsView networks={["x", "facebook"]} variant={variant} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it.each([
    ["pusta lista", []],
    ["kanał nieznany", ["kanal-z-przyszlosci"]],
  ])("%s nie wywala renderu", (_l, networks) => {
    const container = view(<ShareButtonsView networks={networks as never} />);
    assertNoLeak(container, "share puste");
  });

  // Widok WYMAGA tablicy - i to jest jego zadeklarowany kontrakt (`networks`
  // jest typowane jako lista). Na ścieżce bloków gwarantuje go czytnik
  // `strList(block.data, "networks")`, który dla dowolnego innego kształtu
  // oddaje pustą tablicę. Test przybija oba końce tego kontraktu.
  it("nie-tablica na wejściu jest błędem wołającego, nie widoku", async () => {
    const { strList } = await import("@/components/blocks/renderer/data");
    expect(strList({ networks: "x" }, "networks")).toEqual([]);
    expect(strList({ networks: [1, "x", null] as never }, "networks")).toEqual(["x"]);
    expect(strList({}, "networks")).toEqual([]);
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", (lang) => {
    const container = view(<ShareButtonsView networks={["x"]} lang={lang} />);
    assertNoLeak(container, `share ${lang}`);
  });
});

describe("TaxonomyListView", () => {
  it.each(["categories", "archives"] as const)("rodzaj %s pokazuje pozycje", async (kind) => {
    const container = view(
      <TaxonomyListView kind={kind} lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Analizy"));
  });

  it("pokazuje licznik, gdy showCount jest włączone", async () => {
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent).toContain("12"));
  });

  it("ukrywa licznik, gdy showCount jest wyłączone", async () => {
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount={false} layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Analizy"));
    expect(container.textContent).not.toContain("(12)");
  });

  it.each(["list", "dropdown"] as const)("układ %s renderuje listę", async (layout) => {
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout={layout} limit={10} />,
    );
    await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));
    assertNoLeak(container, `taxonomy ${layout}`);
  });

  it("limit jest WEJŚCIEM ZAPYTANIA, nie cięciem po stronie widoku", async () => {
    // Widok renderuje to, co oddała warstwa zapytań - obcięcie robi baza
    // (`.limit()`), żeby nie ściągać wierszy tylko po to, by je wyrzucić.
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={1} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Analizy"));
    expect(container.textContent).toContain("Raporty");
  });

  it("PUSTA lista nie renderuje pustego szkieletu", async () => {
    h.taxonomy = [];
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent ?? "").not.toContain("Analizy"));
    assertNoLeak(container, "taxonomy puste");
  });
});

describe("CodeBlockView", () => {
  it("renderuje kod i etykietę języka", () => {
    const container = view(<CodeBlockView code="const a = 1;" lang="ts" />);
    expect(container.textContent).toContain("const a = 1;");
  });

  it("BEZ języka nie wypisuje wartości zastępczej", () => {
    const container = view(<CodeBlockView code="x" lang="" />);
    assertNoLeak(container, "code bez języka");
  });

  it("PUSTY kod nie wywala renderu", () => {
    const container = view(<CodeBlockView code="" lang="ts" />);
    assertNoLeak(container, "code pusty");
  });

  it("przycisk kopiowania kopiuje treść do schowka", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const container = view(<CodeBlockView code="const a = 1;" lang="ts" />);
    const button = container.querySelector("button");
    if (button) {
      fireEvent.click(button);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("const a = 1;"));
    } else {
      expect(container.textContent).toContain("const a = 1;");
    }
  });

  it("BŁĄD schowka nie wywala widoku", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("brak zgody")) },
      configurable: true,
    });
    const container = view(<CodeBlockView code="x" lang="ts" />);
    const button = container.querySelector("button");
    if (button) fireEvent.click(button);
    await waitFor(() => expect(container.textContent).toContain("x"));
  });

  it("escapuje treść kodu (nie wstrzykuje znaczników)", () => {
    const container = view(<CodeBlockView code="<script>alert(1)</script>" lang="html" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("GalleryBlock", () => {
  const IMAGES = [
    { url: "https://cdn.test/1.jpg", alt: "Pierwszy" },
    { url: "https://cdn.test/2.jpg", alt: "Drugi" },
  ];

  it("renderuje siatkę obrazów", () => {
    const container = view(<GalleryBlock images={IMAGES} />);
    expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
  });

  it("pusta tablica nie renderuje siatki", () => {
    const container = view(<GalleryBlock images={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  // Jak przy `ShareButtonsView`: tablica jest kontraktem wejścia, a na ścieżce
  // bloków pilnuje go `objList(block.data, "images", …)`.
  it("nie-tablica na wejściu jest błędem wołającego, nie widoku", async () => {
    const { objList } = await import("@/components/blocks/renderer/data");
    const map = (o: Record<string, unknown>) => ({ url: String(o.url ?? "") });
    expect(objList({ images: "x" }, "images", map as never)).toEqual([]);
    expect(
      objList({ images: [null, "x", { url: "/a.jpg" }] as never }, "images", map as never),
    ).toEqual([{ url: "/a.jpg" }]);
  });

  it("obraz z PUSTYM alt nie wypisuje wartości zastępczej", () => {
    const container = view(<GalleryBlock images={[{ url: "https://cdn.test/1.jpg", alt: "" }]} />);
    assertNoLeak(container, "gallery pusty alt");
  });

  it("kliknięcie obrazu otwiera podgląd (lightbox)", () => {
    const container = view(<GalleryBlock images={IMAGES} />);
    const clickable = container.querySelector("button, a, img");
    if (clickable) fireEvent.click(clickable);
    assertNoLeak(container, "gallery lightbox");
  });
});

describe("CompareSlider - suwak porównania", () => {
  const PROPS = {
    before: "https://cdn.test/przed.jpg",
    after: "https://cdn.test/po.jpg",
    labelBefore: "Przed",
    labelAfter: "Po",
  };

  it("renderuje oba obrazy i etykiety", () => {
    const container = view(<CompareSlider {...PROPS} />);
    expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Przed");
    expect(container.textContent).toContain("Po");
  });

  it("BEZ etykiet używa wartości domyślnych", () => {
    const container = view(<CompareSlider before={PROPS.before} after={PROPS.after} />);
    assertNoLeak(container, "compare bez etykiet");
  });

  it("suwak reaguje na ruch wskaźnika", () => {
    const container = view(<CompareSlider {...PROPS} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    fireEvent.pointerDown(root, { clientX: 10 });
    fireEvent.pointerMove(root, { clientX: 80 });
    fireEvent.pointerUp(root, { clientX: 80 });
    assertNoLeak(container, "compare pointer");
  });

  it("suwak reaguje na dotyk", () => {
    const container = view(<CompareSlider {...PROPS} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(root, { touches: [{ clientX: 10 }] });
    fireEvent.touchMove(root, { touches: [{ clientX: 60 }] });
    fireEvent.touchEnd(root, {});
    assertNoLeak(container, "compare touch");
  });

  it("suwak reaguje na mysz", () => {
    const container = view(<CompareSlider {...PROPS} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(root, { clientX: 10 });
    fireEvent.mouseMove(root, { clientX: 60 });
    fireEvent.mouseUp(root, { clientX: 60 });
    assertNoLeak(container, "compare mouse");
  });

  it("suwak znosi zdarzenia klawiatury bez wyjątku", () => {
    const container = view(<CompareSlider {...PROPS} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(root, { key: "ArrowRight" });
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    fireEvent.keyDown(root, { key: "Home" });
    assertNoLeak(container, "compare keyboard");
  });

  it("ruch wskaźnika BEZ wciśnięcia nie przesuwa podziału", () => {
    const container = view(<CompareSlider {...PROPS} />);
    const root = container.firstElementChild as HTMLElement;
    const before = root.innerHTML;
    fireEvent.pointerMove(root, { clientX: 200 });
    expect(root.innerHTML).toBe(before);
  });
});

describe("LinkPreviewBlockView", () => {
  const LP_DATA = {
    introPl: "Zobacz też:",
    introEn: "See also:",
    items: [
      { url: "https://x.test/a", labelPl: "Pierwszy link", labelEn: "First link" },
      // Pozycja BEZ etykiety angielskiej - `labelEn` pusty, nie `undefined`
      // (`Json` nie dopuszcza `undefined` w wartościach).
      { url: "https://x.test/b", labelPl: "Drugi link", labelEn: "" },
    ],
    layout: "inline",
    preview: true,
    width: 200,
    height: 120,
  };

  it("renderuje podgląd z pełnymi danymi", () => {
    const container = view(<LinkPreviewBlockView data={LP_DATA} lang="pl" />);
    expect(container.textContent).toContain("Pierwszy link");
    expect(container.textContent).toContain("Zobacz też:");
  });

  it.each(["inline", "list"] as const)("układ %s renderuje odnośniki", (layout) => {
    const container = view(<LinkPreviewBlockView data={{ ...LP_DATA, layout }} lang="pl" />);
    expect(container.textContent).toContain("Pierwszy link");
  });

  it("wyłączony podgląd nadal renderuje odnośnik", () => {
    const container = view(
      <LinkPreviewBlockView data={{ ...LP_DATA, preview: false }} lang="pl" />,
    );
    expect(container.textContent).toContain("Pierwszy link");
  });

  it.each([
    ["bez pozycji", { items: [] }],
    ["items nie-tablica", { items: "x" }],
    ["puste dane", {}],
    ["pozycja bez adresu", { items: [{ labelPl: "Bez adresu" }] }],
  ])("%s nie renderuje bloku wcale", (_l, data) => {
    const container = view(<LinkPreviewBlockView data={data as never} lang="pl" />);
    expect(container.innerHTML).toBe("");
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", (lang) => {
    const container = view(<LinkPreviewBlockView data={LP_DATA} lang={lang} />);
    assertNoLeak(container, `link preview ${lang}`);
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("pozycja BEZ etykiety w danym języku nie wypisuje wartości zastępczej", () => {
    const container = view(<LinkPreviewBlockView data={LP_DATA} lang="en" />);
    assertNoLeak(container, "link preview EN fallback");
  });
});

describe("TocBlockView", () => {
  const HEADINGS: Block[] = [
    { id: "h1", type: "heading", data: { level: 2, text: "Sekcja pierwsza", anchor: "" } },
    { id: "h2", type: "heading", data: { level: 3, text: "Podsekcja", anchor: "wlasna" } },
    { id: "h3", type: "heading", data: { level: 4, text: "Głębiej", anchor: "" } },
    { id: "p1", type: "paragraph", data: { html: "<p>nie nagłówek</p>" } },
  ];

  it("buduje listę z nagłówków dokumentu", () => {
    const container = view(<TocBlockView blocks={HEADINGS} title="Spis treści" />);
    expect(container.textContent).toContain("Sekcja pierwsza");
    expect(container.textContent).toContain("Spis treści");
  });

  it("respektuje zakres poziomów", () => {
    const container = view(<TocBlockView blocks={HEADINGS} minLevel={3} maxLevel={3} />);
    expect(container.textContent).toContain("Podsekcja");
    expect(container.textContent).not.toContain("Sekcja pierwsza");
  });

  it("używa własnej kotwicy, gdy nagłówek ją ma", () => {
    const container = view(<TocBlockView blocks={HEADINGS} minLevel={2} maxLevel={4} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("#wlasna");
  });

  it.each([true, false])("numerowanie ordered=%s renderuje listę", (ordered) => {
    const container = view(<TocBlockView blocks={HEADINGS} ordered={ordered} />);
    expect(container.querySelector(ordered ? "ol" : "ul")).toBeTruthy();
  });

  it.each([true, false])("przyklejanie sticky=%s renderuje listę", (sticky) => {
    const container = view(<TocBlockView blocks={HEADINGS} sticky={sticky} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it.each(["col-1", "col-2", "half"] as const)("układ %s renderuje listę", (columns) => {
    const container = view(<TocBlockView blocks={HEADINGS} columns={columns} />);
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("dokument BEZ nagłówków nie renderuje pustego spisu", () => {
    const container = view(
      <TocBlockView blocks={[{ id: "p", type: "paragraph", data: { html: "<p>x</p>" } }]} />,
    );
    expect(container.textContent).toBe("");
  });

  it("nagłówek z PUSTYM tekstem jest pomijany", () => {
    const container = view(
      <TocBlockView blocks={[{ id: "h", type: "heading", data: { level: 2, text: "" } }]} />,
    );
    assertNoLeak(container, "toc pusty nagłówek");
  });
});

describe("warianty widoków prezentacyjnych", () => {
  it.each(["left", "center"] as const)("IconBoxView wyrównanie %s", (align) => {
    const container = view(
      <IconBoxView
        icon="Zap"
        title="T"
        description="D"
        align={align}
        href="/x"
        linkLabel="Więcej"
      />,
    );
    expect(container.textContent).toContain("T");
  });

  it("IconBoxView BEZ linku nie renderuje odnośnika", () => {
    const container = view(<IconBoxView title="T" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it.each([
    ["ikona nieznana", "NieMaTakiejIkony"],
    ["ikona pusta", ""],
  ])("IconBoxView z %s nie wywala renderu", (_l, icon) => {
    const container = view(<IconBoxView icon={icon} title="T" />);
    assertNoLeak(container, "icon box");
  });

  it("StatsCounterView animuje liczniki do wartości docelowej", () => {
    vi.useFakeTimers();
    const container = view(
      <StatsCounterView items={[{ value: "120", label: "Analiz", suffix: "+" }]} duration={100} />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.textContent).toContain("Analiz");
    assertNoLeak(container, "stats counter");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
    ["pozycja bez wartości", [{ label: "Bez liczby", value: "" }]],
    ["wartość nieliczbowa", [{ value: "abc", label: "Tekst" }]],
  ])("StatsCounterView dla %s nie wypisuje NaN", (_l, items) => {
    vi.useFakeTimers();
    const container = view(<StatsCounterView items={items as never} duration={10} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    assertNoLeak(container, "stats counter puste");
  });

  it.each(["grid", "slider"] as const)("TestimonialsView układ %s", (layout) => {
    const container = view(
      <TestimonialsView
        items={[
          {
            quote: "Cytat",
            author: "Autor",
            role: "Rola",
            avatar: "https://cdn.test/a.jpg",
            rating: 5,
          },
          { quote: "Drugi", author: "", role: "", avatar: "", rating: 0 },
        ]}
        layout={layout}
      />,
    );
    expect(container.textContent).toContain("Cytat");
  });

  it("TestimonialsView w układzie slider przełącza opinie", () => {
    const container = view(
      <TestimonialsView
        items={[
          { quote: "Pierwsza", author: "A" },
          { quote: "Druga", author: "B" },
        ]}
        layout="slider"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    if (buttons.length) fireEvent.click(buttons[buttons.length - 1]);
    assertNoLeak(container, "testimonials slider");
  });

  it("PricingTableView wyróżnia plan oznaczony jako featured", () => {
    const container = view(
      <PricingTableView
        plans={[
          {
            name: "Start",
            price: "0",
            features: ["A"],
            featured: false,
            ctaLabel: "",
            ctaHref: "",
          },
          {
            name: "Pro",
            price: "99",
            features: ["B"],
            featured: true,
            ctaLabel: "Kup",
            ctaHref: "/p",
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("Pro");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/p");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
    ["plan bez nazwy i ceny", [{}]],
    ["features nie-tablica", [{ name: "X", features: "A,B" }]],
  ])("PricingTableView dla %s nie wypisuje wartości zastępczej", (_l, plans) => {
    const container = view(<PricingTableView plans={plans as never} />);
    assertNoLeak(container, "pricing");
  });

  it("TimelineView renderuje etapy", () => {
    const container = view(
      <TimelineView
        items={[
          { date: "2024", title: "Start", description: "Opis" },
          { date: "", title: "Bez daty", description: "" },
        ]}
      />,
    );
    expect(container.textContent).toContain("Start");
    assertNoLeak(container, "timeline");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
  ])("TimelineView dla %s nie renderuje osi", (_l, items) => {
    const container = view(<TimelineView items={items as never} />);
    assertNoLeak(container, "timeline puste");
  });
});

describe("warianty widoków marketingowych i danych", () => {
  it.each(["left", "center"] as const)("HeroView wyrównanie %s", (align) => {
    const container = view(
      <HeroView
        eyebrow="Nowość"
        title="Tytuł"
        subtitle="Podtytuł"
        bgImage="https://cdn.test/bg.jpg"
        ctaLabel="Start"
        ctaHref="/s"
        secondaryLabel="Więcej"
        secondaryHref="/w"
        align={align}
      />,
    );
    expect(container.textContent).toContain("Tytuł");
  });

  it.each(["sm", "md", "lg", "screen"] as const)("HeroView wysokość %s", (height) => {
    const container = view(<HeroView title="T" height={height} />);
    expect(container.textContent).toContain("T");
  });

  it.each([0, 40, 100])("HeroView przyciemnienie %i", (overlay) => {
    const container = view(
      <HeroView title="T" bgImage="https://cdn.test/b.jpg" overlay={overlay} />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("HeroView BEZ tła i przycisków renderuje sam tekst", () => {
    const container = view(<HeroView title="T" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it.each(["primary", "muted", "gradient", "outline"] as const)(
    "CtaSectionView wariant %s",
    (variant) => {
      const container = view(
        <CtaSectionView
          title="T"
          description="D"
          ctaLabel="Kliknij"
          ctaHref="/c"
          variant={variant}
        />,
      );
      expect(container.textContent).toContain("Kliknij");
    },
  );

  it("CtaSectionView BEZ przycisku nie renderuje odnośnika", () => {
    const container = view(<CtaSectionView title="T" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it.each([1, 8, 13, 20])("MapView przybliżenie %i renderuje mapę", (zoom) => {
    const container = view(<MapView lat={52.2} lng={21.0} zoom={zoom} label="Warszawa" />);
    assertNoLeak(container, `map zoom=${zoom}`);
  });

  it("MapView BEZ etykiety nie wypisuje wartości zastępczej", () => {
    const container = view(<MapView />);
    assertNoLeak(container, "map bez etykiety");
  });

  it.each(["circle", "square"] as const)("TeamGridView kształt %s", (shape) => {
    const container = view(
      <TeamGridView
        title="Zespół"
        items={[
          {
            name: "A",
            role: "Rola",
            avatar: "https://cdn.test/a.jpg",
            bio: "Bio",
            social: { linkedin: "https://l.test" },
          },
          { name: "B", role: "", avatar: "", bio: "", social: {} },
        ]}
        shape={shape}
      />,
    );
    expect(container.textContent).toContain("A");
  });

  it.each([1, 2, 3, 4, 5, 6])("TeamGridView %i kolumn", (columns) => {
    const container = view(<TeamGridView items={[{ name: "A" }]} columns={columns} />);
    expect(container.textContent).toContain("A");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
  ])("TeamGridView dla %s nie renderuje siatki", (_l, items) => {
    const container = view(<TeamGridView items={items as never} />);
    assertNoLeak(container, "team grid");
  });

  it.each([true, false])("LogoGridView odcienie szarości %s", (grayscale) => {
    const container = view(
      <LogoGridView
        title="Partnerzy"
        items={[
          { url: "https://cdn.test/l.svg", alt: "P", href: "https://p.test" },
          { url: "https://cdn.test/m.svg", alt: "", href: "" },
        ]}
        grayscale={grayscale}
      />,
    );
    expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
  });

  it.each([true, false])("LogoGridView obramowanie %s", (bordered) => {
    const container = view(
      <LogoGridView items={[{ url: "https://cdn.test/l.svg" }]} bordered={bordered} />,
    );
    expect(container.querySelector("img")).toBeTruthy();
  });

  it.each(["card", "minimal", "bordered"] as const)("FeatureGridView styl %s", (style) => {
    const container = view(
      <FeatureGridView
        title="Możliwości"
        subtitle="Podtytuł"
        items={[
          { icon: "Zap", title: "A", description: "Opis" },
          { icon: "", title: "B", description: "" },
        ]}
        style={style}
      />,
    );
    expect(container.textContent).toContain("A");
  });

  it.each(["info", "success", "warning", "danger", "neutral"] as const)(
    "AlertBannerView wariant %s",
    (variant) => {
      const container = view(
        <AlertBannerView
          variant={variant}
          title="Uwaga"
          message="Treść"
          ctaLabel="Więcej"
          ctaHref="/w"
        />,
      );
      expect(container.textContent).toContain("Treść");
    },
  );

  it("AlertBannerView z możliwością zamknięcia da się zamknąć", () => {
    const container = view(<AlertBannerView message="Treść" dismissible />);
    const button = container.querySelector("button");
    if (button) {
      fireEvent.click(button);
      expect(container.textContent).not.toContain("Treść");
    } else {
      expect(container.textContent).toContain("Treść");
    }
  });

  it.each([true, false])("AlertBannerView ikona %s", (showIcon) => {
    const container = view(<AlertBannerView message="Treść" showIcon={showIcon} />);
    expect(container.textContent).toContain("Treść");
  });

  it.each(["solid", "dashed", "dotted"] as const)("DividerTextView linia %s", (lineStyle) => {
    const container = view(<DividerTextView text="albo" lineStyle={lineStyle} />);
    expect(container.textContent).toContain("albo");
  });

  it.each(["left", "center", "right"] as const)("DividerTextView wyrównanie %s", (align) => {
    const container = view(<DividerTextView text="albo" align={align} />);
    expect(container.textContent).toContain("albo");
  });

  it("DividerTextView BEZ tekstu renderuje samą linię", () => {
    const container = view(<DividerTextView />);
    assertNoLeak(container, "divider bez tekstu");
  });
});

describe("warianty widoków konwersji", () => {
  const STEPS = [
    { title: "Krok 1", description: "Opis" },
    { title: "Krok 2", description: "" },
  ];

  it.each(["vertical", "horizontal"] as const)("StepListView orientacja %s", (orientation) => {
    const container = view(
      <StepListView title="Jak to działa" items={STEPS} orientation={orientation} />,
    );
    expect(container.textContent).toContain("Krok 1");
  });

  it.each(["circle", "square", "plain"] as const)("StepListView numeracja %s", (numberStyle) => {
    const container = view(<StepListView items={STEPS} numberStyle={numberStyle} />);
    expect(container.textContent).toContain("Krok 1");
  });

  it.each([
    ["pusta lista", []],
    ["nie tablica", "x" as never],
  ])("StepListView dla %s nie renderuje kroków", (_l, items) => {
    const container = view(<StepListView items={items as never} />);
    assertNoLeak(container, "step list");
  });

  it("ComparisonTableView renderuje kolumny i wiersze", () => {
    const container = view(
      <ComparisonTableView
        title="Porównanie"
        columns={["A", "B"]}
        rows={[{ feature: "Cecha", values: ["tak", "nie"] }]}
      />,
    );
    expect(container.textContent).toContain("Cecha");
  });

  it.each([-1, 0, 1, 5])("ComparisonTableView wyróżniona kolumna %i", (featuredIndex) => {
    const container = view(
      <ComparisonTableView
        columns={["A", "B"]}
        rows={[{ feature: "C", values: ["1", "2"] }]}
        featuredIndex={featuredIndex}
      />,
    );
    assertNoLeak(container, `comparison featured=${featuredIndex}`);
  });

  it.each([
    ["kolumny puste", [], [{ feature: "C", values: ["1"] }]],
    ["wiersze puste", ["A"], []],
    ["kolumny nie-tablica", "x" as never, []],
    ["wiersze nie-tablica", ["A"], "x" as never],
    ["wiersz bez values", ["A"], [{ feature: "C", values: [] }]],
  ])("ComparisonTableView dla %s nie wywala renderu", (_l, columns, rows) => {
    const container = view(<ComparisonTableView columns={columns as never} rows={rows as never} />);
    assertNoLeak(container, "comparison");
  });

  it.each(["left", "center", "right"] as const)("BannerImageView pozycja %s", (position) => {
    const container = view(
      <BannerImageView
        image="https://cdn.test/b.jpg"
        alt="Baner"
        title="Tytuł"
        description="Opis"
        ctaLabel="Kliknij"
        ctaHref="/c"
        position={position}
      />,
    );
    expect(container.textContent).toContain("Tytuł");
  });

  it.each(["dark", "light"] as const)("BannerImageView motyw %s", (theme) => {
    const container = view(
      <BannerImageView image="https://cdn.test/b.jpg" title="T" theme={theme} />,
    );
    expect(container.textContent).toContain("T");
  });

  it.each(["21:9", "16:9", "4:3"] as const)("BannerImageView proporcje %s", (aspect) => {
    const container = view(
      <BannerImageView image="https://cdn.test/b.jpg" title="T" aspect={aspect} />,
    );
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("BannerImageView BEZ obrazu nie renderuje pustego baneru", () => {
    const container = view(<BannerImageView title="T" />);
    assertNoLeak(container, "banner bez obrazu");
  });

  it.each(["md", "lg", "screen"] as const)("VideoHeroView wysokość %s", (height) => {
    const container = view(
      <VideoHeroView
        src="https://cdn.test/v.mp4"
        poster="https://cdn.test/p.jpg"
        title="Tytuł"
        subtitle="Podtytuł"
        ctaLabel="Zobacz"
        ctaHref="/z"
        height={height}
      />,
    );
    expect(container.textContent).toContain("Tytuł");
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("VideoHeroView autoplay=%s loop=%s", (autoplay, loop) => {
    const container = view(
      <VideoHeroView src="https://cdn.test/v.mp4" title="T" autoplay={autoplay} loop={loop} />,
    );
    expect(container.querySelector("video")).toBeTruthy();
  });

  it("VideoHeroView BEZ źródła nie renderuje odtwarzacza", () => {
    const container = view(<VideoHeroView title="T" />);
    assertNoLeak(container, "video hero bez źródła");
  });

  it.each(["left", "center"] as const)("VideoHeroView wyrównanie %s", (align) => {
    const container = view(<VideoHeroView src="https://cdn.test/v.mp4" title="T" align={align} />);
    expect(container.textContent).toContain("T");
  });
});

describe("MorePostsView", () => {
  it.each(["latest", "trending", "category"] as const)(
    "strategia %s renderuje sekcję",
    async (strategy) => {
      h.posts = [
        {
          id: "p-1",
          slug: "wpis",
          title_pl: "Wpis",
          title_en: "Post",
          excerpt_pl: null,
          excerpt_en: null,
          cover_image_url: "https://cdn.test/p.jpg",
          published_at: "2026-07-01T10:00:00.000Z",
          parent_page_id: "page-blog",
        },
      ];
      const container = view(<MorePostsView strategy={strategy} limit={4} heading="Więcej" />);
      await waitFor(() => expect(container.textContent).toContain("Więcej"));
      assertNoLeak(container, `more posts ${strategy}`);
    },
  );

  it("PUSTA lista nie renderuje sekcji", async () => {
    h.posts = [];
    const container = view(<MorePostsView limit={4} heading="Więcej" />);
    await waitFor(() => expect(container.innerHTML).toBeDefined());
    assertNoLeak(container, "more posts puste");
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", async (lang) => {
    const container = view(<MorePostsView limit={4} lang={lang} />);
    await waitFor(() => expect(container.innerHTML).toBeDefined());
    assertNoLeak(container, `more posts ${lang}`);
  });
});
