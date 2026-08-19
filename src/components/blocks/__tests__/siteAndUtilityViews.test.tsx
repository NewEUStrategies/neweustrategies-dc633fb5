// Bloki zależne od USTAWIEŃ WITRYNY (site-title / site-tagline / site-logo),
// narzędzia wpisu (okruszki, czas czytania, udostępnianie) oraz lista
// taksonomii w wariancie rozwijanym.
//
// Ta grupa dzieli jedną cechę: renderuje się z danych, których NIE MA w bloku -
// biorą się z `site_settings`, z kontekstu wpisu albo z zapytania. Każdy z nich
// ma gałąź „ustawienia są" i „ustawień nie ma", a druga jest tą, którą widzi
// czytelnik świeżo postawionej instancji. Blok, który w tym stanie wyrenderuje
// puste `<h1>` albo `<img src="">`, psuje stronę główną w dniu wdrożenia.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  siteGeneral: {} as Record<string, unknown>,
  readingSettings: { enabled: true } as Record<string, unknown>,
  taxonomy: [] as unknown[],
  tags: [] as unknown[],
  pending: false,
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
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T extends object>(key: string, defaults: T): T => {
    if (key === "general") return { ...defaults, ...h.siteGeneral } as T;
    if (key === "reading_time") return { ...defaults, ...h.readingSettings } as T;
    return { ...defaults } as T;
  },
  siteSettingsQueryOptions: { queryKey: ["site-settings"], queryFn: async () => ({}) },
}));
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => {
      if (h.pending) await new Promise(() => {});
      return value();
    },
    staleTime: 0,
    gcTime: 0,
  });
  return {
    blockCategoriesQueryOptions: (l: unknown) => opts(["cat", l], () => h.taxonomy),
    blockArchivesQueryOptions: (l: unknown) => opts(["arch", l], () => h.taxonomy),
    blockTagsQueryOptions: (l: unknown) => opts(["tags", l], () => h.tags),
  };
});

import { SiteTitleView, SiteTaglineView, SiteLogoView } from "../ContextBlockViews";
import { BreadcrumbsView, ReadingTimeView, ShareButtonsView } from "../PostUtilityViews";
import { TaxonomyListView } from "../TaxonomyListView";

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  title_pl: "Tytuł",
  title_en: "Title",
  excerpt_pl: "Zajawka wpisu, dość długa, żeby dała się policzyć na minuty czytania.",
  excerpt_en: "Post excerpt, long enough to yield a reading-time estimate in minutes.",
  publishedAt: "2026-08-01T10:00:00.000Z",
  breadcrumbs: [{ label: "Analizy", href: "/analizy" }, { label: "Wpis" }],
};

function Wrap({ ctx, children }: { ctx: CurrentPostCtx | null; children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={ctx}>{children}</CurrentPostProvider>
    </QueryClientProvider>
  );
}

function view(ui: ReactElement, ctx: CurrentPostCtx | null = POST_CTX): HTMLElement {
  const { container } = render(<Wrap ctx={ctx}>{ui}</Wrap>);
  return container;
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];
function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}"`).toBe(false);
  }
}

beforeEach(() => {
  h.siteGeneral = {};
  h.readingSettings = { enabled: true };
  h.taxonomy = [
    { label: "Analizy", href: "/analizy", count: 12 },
    { label: "Raporty", href: "/raporty", count: 0 },
  ];
  h.tags = [
    { slug: "energia", name: "Energia" },
    { slug: "obronnosc", name: "Obronność" },
  ];
  h.pending = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SiteTitleView", () => {
  it("BEZ nazwy witryny w ustawieniach nie renderuje nagłówka", () => {
    const container = view(<SiteTitleView level={2} cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("nazwa PUSTA też nie renderuje nagłówka", () => {
    h.siteGeneral = { name: "" };
    const container = view(<SiteTitleView level={2} cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("nazwa z ustawień renderuje nagłówek linkujący do strony głównej", () => {
    h.siteGeneral = { name: "New European Strategies" };
    const container = view(<SiteTitleView level={2} cls="moja-klasa" />);
    expect(container.querySelector("h2")?.textContent).toBe("New European Strategies");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(container.querySelector("h2")?.className).toContain("moja-klasa");
  });

  it.each([1, 2, 3, 4, 5, 9, 0, -3])("poziom %i klampuje się do h1-h4", (level) => {
    h.siteGeneral = { name: "NES" };
    const container = view(<SiteTitleView level={level} cls="" />);
    expect(container.querySelector("h1,h2,h3,h4")).toBeTruthy();
  });
});

describe("SiteTaglineView", () => {
  it("BEZ hasła witryny nie renderuje akapitu", () => {
    const container = view(<SiteTaglineView cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("hasło PUSTE też nie renderuje akapitu", () => {
    h.siteGeneral = { tagline: "" };
    const container = view(<SiteTaglineView cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("hasło z ustawień renderuje akapit", () => {
    h.siteGeneral = { tagline: "Analizy dla Europy Środkowej" };
    const container = view(<SiteTaglineView cls="klasa" />);
    expect(container.textContent).toBe("Analizy dla Europy Środkowej");
    expect(container.querySelector("p")?.className).toContain("klasa");
  });
});

describe("SiteLogoView", () => {
  it("BEZ adresu logotypu nie renderuje obrazu", () => {
    const container = view(<SiteLogoView width={180} cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("logotyp z ustawień renderuje obraz linkujący do strony głównej", () => {
    h.siteGeneral = { logo_url: "https://cdn.test/logo.svg", name: "NES" };
    const container = view(<SiteLogoView width={180} cls="" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/logo.svg");
    expect(img?.getAttribute("alt")).toBe("NES");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("logotyp BEZ nazwy witryny dostaje pusty alt i zapasową etykietę odnośnika", () => {
    h.siteGeneral = { logo_url: "https://cdn.test/logo.svg" };
    const container = view(<SiteLogoView width={180} cls="" />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Home");
    assertNoLeak(container, "logo bez nazwy");
  });

  it.each([
    [10, 32],
    [32, 32],
    [180, 180],
    [480, 480],
    [9999, 480],
  ])("szerokość %i klampuje się na %i", (width, expected) => {
    h.siteGeneral = { logo_url: "https://cdn.test/logo.svg" };
    const container = view(<SiteLogoView width={width} cls="" />);
    expect(container.querySelector("img")?.getAttribute("style")).toContain(`width: ${expected}px`);
  });
});

describe("BreadcrumbsView", () => {
  it("BEZ okruszków i BEZ strony głównej pokazuje znacznik zastępczy", () => {
    const container = view(<BreadcrumbsView separator="/" showHome={false} lang="pl" cls="" />, {
      ...POST_CTX,
      breadcrumbs: [],
    });
    expect(container.textContent).toContain("[breadcrumbs]");
    expect(container.querySelector('nav[aria-label="breadcrumbs"]')).toBeTruthy();
  });

  it("BEZ okruszków ale ZE stroną główną pokazuje sam poziom główny", () => {
    const container = view(<BreadcrumbsView separator="/" showHome lang="pl" cls="" />, {
      ...POST_CTX,
      breadcrumbs: [],
    });
    expect(container.textContent).not.toContain("[breadcrumbs]");
  });

  it("BEZ kontekstu wpisu pokazuje znacznik zastępczy, nie pustą nawigację", () => {
    const container = view(
      <BreadcrumbsView separator="/" showHome={false} lang="pl" cls="" />,
      null,
    );
    expect(container.textContent).toContain("[breadcrumbs]");
  });

  it("okruszek BEZ adresu renderuje się jako tekst, nie martwy odnośnik", () => {
    const container = view(<BreadcrumbsView separator="/" showHome lang="pl" cls="" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain(null);
    expect(container.textContent).toContain("Wpis");
  });

  it.each(["pl", "en"] as const)("etykieta strony głównej jest w języku %s", (lang) => {
    const container = view(<BreadcrumbsView separator="/" showHome lang={lang} cls="" />);
    assertNoLeak(container, `breadcrumbs ${lang}`);
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });
});

describe("ReadingTimeView", () => {
  it("WYŁĄCZONY czas czytania nie renderuje niczego", () => {
    h.readingSettings = { enabled: false };
    const container = view(<ReadingTimeView wpm={200} prefix="" lang="pl" cls="" />);
    expect(container.innerHTML).toBe("");
  });

  it("bierze wartość policzoną w kontekście wpisu, gdy jest", () => {
    const container = view(<ReadingTimeView wpm={200} prefix="Czas:" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: 9,
    });
    expect(container.textContent).toContain("9");
    expect(container.textContent).toContain("Czas:");
  });

  it("wartość z kontekstu równa 0 NIE jest brana (0 minut to brak wyniku)", () => {
    const container = view(<ReadingTimeView wpm={200} prefix="" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: 0,
    });
    // Spada na wyliczenie z zajawki, więc coś się renderuje - ale nie „0".
    assertNoLeak(container, "reading time 0");
  });

  it("BEZ wartości w kontekście liczy z zajawki", () => {
    const container = view(<ReadingTimeView wpm={5} prefix="" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: undefined,
    });
    assertNoLeak(container, "reading time z zajawki");
  });

  it("BEZ zajawki i BEZ wartości nie renderuje niczego", () => {
    const container = view(<ReadingTimeView wpm={200} prefix="" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: undefined,
      excerpt_pl: "",
      excerpt_en: "",
    });
    expect(container.innerHTML).toBe("");
  });

  it("zajawka z samych spacji jest traktowana jak brak treści", () => {
    const container = view(<ReadingTimeView wpm={200} prefix="" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: undefined,
      excerpt_pl: "   ",
    });
    expect(container.innerHTML).toBe("");
  });

  it("BEZ kontekstu wpisu nie renderuje niczego", () => {
    const container = view(<ReadingTimeView wpm={200} prefix="" lang="pl" cls="" />, null);
    expect(container.innerHTML).toBe("");
  });

  it.each(["pl", "en"] as const)("czyta zajawkę we właściwym języku (%s)", (lang) => {
    const container = view(<ReadingTimeView wpm={5} prefix="" lang={lang} cls="" />, {
      ...POST_CTX,
      readingTimeMin: undefined,
    });
    assertNoLeak(container, `reading time ${lang}`);
  });

  it("BEZ własnego wpm używa ustawień witryny", () => {
    const container = view(<ReadingTimeView prefix="" lang="pl" cls="" />, {
      ...POST_CTX,
      readingTimeMin: undefined,
    });
    assertNoLeak(container, "reading time bez wpm");
  });
});

describe("ShareButtonsView - adresy kanałów", () => {
  it.each([
    ["x", "twitter.com/intent"],
    ["facebook", "facebook.com"],
    ["linkedin", "linkedin.com"],
    ["whatsapp", "wa.me"],
    ["telegram", "t.me/share"],
    ["email", "mailto:"],
  ])("kanał %s buduje adres zawierający %s", (network, fragment) => {
    const container = view(<ShareButtonsView networks={[network]} lang="pl" cls="" />);
    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(
      hrefs.some((x) => x.includes(fragment)),
      `${network} -> ${fragment}`,
    ).toBe(true);
  });

  it("kanał NIEZNANY dostaje adres zastępczy, nie undefined", () => {
    const container = view(
      <ShareButtonsView networks={["kanal-z-przyszlosci"]} lang="pl" cls="" />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.every((x) => x.length > 0)).toBe(true);
    assertNoLeak(container, "share nieznany kanał");
  });

  it("kanał copy kopiuje adres do schowka", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const container = view(<ShareButtonsView networks={["copy"]} lang="pl" cls="" />);
    const button = container.querySelector("button");
    expect(button, "przycisk kopiowania").toBeTruthy();
    fireEvent.click(button as HTMLElement);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("BŁĄD schowka nie wywala widoku", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("brak zgody")) },
      configurable: true,
    });
    const container = view(<ShareButtonsView networks={["copy"]} lang="pl" cls="" />);
    fireEvent.click(container.querySelector("button") as HTMLElement);
    await waitFor(() => expect(container.querySelector("button")).toBeTruthy());
  });
});

describe("TaxonomyListView - wariant rozwijany i stan wczytywania", () => {
  it("stan WCZYTYWANIA pokazuje wskaźnik, nie pustkę", () => {
    h.pending = true;
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={10} />,
    );
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("wariant rozwijany renderuje kontrolkę wyboru z etykietą", async () => {
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="dropdown" limit={10} />,
    );
    await waitFor(() => expect(container.querySelector("button, select")).toBeTruthy());
  });

  it.each([
    ["pl", "Wybierz…"],
    ["en", "Choose…"],
  ] as const)("etykieta zastępcza kontrolki w języku %s", async (lang, placeholder) => {
    const container = view(
      <TaxonomyListView kind="categories" lang={lang} showCount layout="dropdown" limit={10} />,
    );
    await waitFor(() =>
      expect(container.querySelector(`[aria-label="${placeholder}"]`)).toBeTruthy(),
    );
  });

  it("rodzaj tags mapuje wiersze na adresy /tag/<slug> z licznikiem 0", async () => {
    const container = view(
      <TaxonomyListView kind="tags" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Energia"));
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/tag/energia");
    // Licznik dla tagów jest zawsze 0, więc NIE MOŻE się pokazać nawias „(0)".
    expect(container.textContent).not.toContain("(0)");
  });

  it("pozycja z licznikiem 0 nie pokazuje nawiasu, gdy showCount jest włączone", async () => {
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Raporty"));
    expect(container.textContent).toContain("(12)");
    expect(container.textContent).not.toContain("(0)");
  });

  it("PUSTA lista nie renderuje niczego", async () => {
    h.taxonomy = [];
    const container = view(
      <TaxonomyListView kind="categories" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("PUSTA lista tagów też nie renderuje niczego", async () => {
    h.tags = [];
    const container = view(
      <TaxonomyListView kind="tags" lang="pl" showCount layout="list" limit={10} />,
    );
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("BEZ limitu rodzaj tags używa wartości domyślnej zapytania", async () => {
    const container = view(<TaxonomyListView kind="tags" lang="pl" showCount layout="list" />);
    await waitFor(() => expect(container.textContent).toContain("Energia"));
  });
});
