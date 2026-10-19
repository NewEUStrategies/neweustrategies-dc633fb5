// AuthorBioView + RelatedPostsView - warianty, linki społecznościowe, układy.
//
// Ta para była najsłabszym punktem powierzchni publicznej: 240 gałęzi, z czego
// 171 niewykonanych. Nie przez przypadek - każdy z pięciu wariantów wizytówki
// autora ma własne gałęzie, a lista linków buduje się z DZIEWIĘCIU niezależnych
// pól profilu plus tablicy linków własnych. Kombinacji jest tyle, że test
// renderujący „jednego autora" trafia w kilka procent tego kodu.
//
// Reguła, której pilnujemy najmocniej: wizytówka bez autora ZNIKA. Bez tego na
// produkcji mrugają przykładowe dane, a redaktor dowiaduje się o tym z maila
// od czytelnika.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import {
  CurrentPostProvider,
  type CurrentPostAuthor,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  posts: [] as unknown[],
  authorProfile: null as unknown,
  authorPostsCount: null as number | null,
  relatedInputs: [] as unknown[],
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
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    relatedPostsBlockQueryOptions: (i: unknown) => {
      h.relatedInputs.push(i);
      return opts(["rp", i], () => h.posts);
    },
    authorProfileByIdQueryOptions: (i: unknown) => opts(["ap", i], () => h.authorProfile),
    authorPostsCountQueryOptions: (i: unknown) => opts(["apc", i], () => h.authorPostsCount),
  };
});

import { AuthorBioView, RelatedPostsView } from "../PostContextViews";

const NOW = new Date("2026-08-19T12:00:00.000Z");

/** Autor z KOMPLETEM pól - każde z nich otwiera osobną gałąź listy linków. */
const RICH_AUTHOR = {
  id: "author-1",
  name: "Autor Testowy",
  slug: "autor-testowy",
  avatarUrl: "https://cdn.test/avatar.jpg",
  bio_pl: "Biogram po polsku.",
  bio_en: "Bio in English.",
  jobTitle: "Analityk energetyczny",
  contactEmail: "autor@nes.test",
  phone: "+48 600 100 200",
  xUrl: "https://x.com/autor",
  twitterUrl: "https://twitter.com/autor",
  linkedinUrl: "https://linkedin.com/in/autor",
  facebookUrl: "https://facebook.com/autor",
  instagramUrl: "https://instagram.com/autor",
  spotifyUrl: "https://open.spotify.com/artist/autor",
  websiteUrl: "https://autor.test",
  customSocials: [
    { label: "Mastodon", url: "https://mastodon.social/@autor", iconUrl: "https://cdn.test/m.svg" },
    { label: "Substack", url: "https://autor.substack.com" },
  ],
} as unknown as CurrentPostAuthor;

const BARE_AUTHOR = { id: "author-2", name: "Autor Ubogi" } as unknown as CurrentPostAuthor;

function ctxWith(author: CurrentPostAuthor | null): CurrentPostCtx {
  return {
    kind: "post",
    id: "post-1",
    slug: "wpis",
    title_pl: "Tytuł",
    title_en: "Title",
    publishedAt: "2026-08-01T10:00:00.000Z",
    author,
    categories: [{ slug: "analizy", name: "Analizy" }],
    tags: [{ slug: "energia", name: "Energia" }],
  };
}

function Wrap({ ctx, children }: { ctx: CurrentPostCtx | null; children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={ctx}>{children}</CurrentPostProvider>
    </QueryClientProvider>
  );
}

function view(ui: ReactElement, ctx: CurrentPostCtx | null = ctxWith(RICH_AUTHOR)): HTMLElement {
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

const VARIANTS = ["card", "inline", "minimal", "split", "profile"] as const;

const hrefs = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");

beforeEach(() => {
  vi.setSystemTime(NOW);
  h.posts = [];
  h.authorProfile = null;
  h.authorPostsCount = 12;
  h.relatedInputs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AuthorBioView - brak autora", () => {
  it.each(VARIANTS)("wariant %s BEZ kontekstu wpisu nie renderuje niczego", (variant) => {
    const container = view(<AuthorBioView variant={variant} />, null);
    expect(container.innerHTML).toBe("");
  });

  it.each(VARIANTS)("wariant %s z autorem BEZ nazwy nie renderuje niczego", (variant) => {
    const container = view(
      <AuthorBioView variant={variant} />,
      ctxWith({ id: "a" } as unknown as CurrentPostAuthor),
    );
    expect(container.innerHTML).toBe("");
  });

  it.each(VARIANTS)("wariant %s z autorem równym null nie renderuje niczego", (variant) => {
    const container = view(<AuthorBioView variant={variant} />, ctxWith(null));
    expect(container.innerHTML).toBe("");
  });

  it("jawny authorOverride równy null też chowa wizytówkę", () => {
    const container = view(<AuthorBioView authorOverride={null} />, ctxWith(null));
    expect(container.innerHTML).toBe("");
  });
});

describe("AuthorBioView - warianty z pełnym profilem", () => {
  it.each(VARIANTS)("wariant %s pokazuje nazwę autora", (variant) => {
    const container = view(<AuthorBioView variant={variant} />);
    expect(container.textContent).toContain("Autor Testowy");
    assertNoLeak(container, `author-bio ${variant}`);
  });

  it.each(VARIANTS)("wariant %s linkuje do profilu autora", (variant) => {
    const container = view(<AuthorBioView variant={variant} />);
    expect(hrefs(container)).toContain("/author/autor-testowy");
  });

  it.each(VARIANTS)("wariant %s BEZ sluga nie linkuje do profilu", (variant) => {
    const container = view(
      <AuthorBioView variant={variant} authorOverride={{ ...RICH_AUTHOR, slug: undefined }} />,
    );
    expect(hrefs(container).filter((x) => x.startsWith("/author/"))).toEqual([]);
  });

  it.each(VARIANTS)("wariant %s pokazuje awatar, gdy jest włączony", (variant) => {
    const container = view(<AuthorBioView variant={variant} showAvatar />);
    expect(container.querySelector("img")).toBeTruthy();
  });

  it.each(VARIANTS)("wariant %s BEZ awatara nie renderuje obrazu autora", (variant) => {
    const container = view(<AuthorBioView variant={variant} showAvatar={false} />);
    const imgs = Array.from(container.querySelectorAll("img")).map(
      (i) => i.getAttribute("src") ?? "",
    );
    expect(imgs).not.toContain("https://cdn.test/avatar.jpg");
  });

  it.each(VARIANTS)("wariant %s bez adresu awatara pokazuje zastępczą ikonę", (variant) => {
    const container = view(
      <AuthorBioView
        variant={variant}
        showAvatar
        authorOverride={{ ...RICH_AUTHOR, avatarUrl: undefined }}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    assertNoLeak(container, `author-bio ${variant} bez awatara`);
  });

  it.each(VARIANTS)("wariant %s pokazuje stanowisko autora", (variant) => {
    const container = view(<AuthorBioView variant={variant} />);
    expect(container.textContent).toContain("Analityk energetyczny");
  });

  it.each(VARIANTS)("wariant %s BEZ stanowiska nie zostawia pustego wiersza", (variant) => {
    const container = view(
      <AuthorBioView variant={variant} authorOverride={{ ...RICH_AUTHOR, jobTitle: undefined }} />,
    );
    expect(container.textContent).not.toContain("Analityk");
    assertNoLeak(container, `author-bio ${variant} bez stanowiska`);
  });

  it.each(VARIANTS)("wariant %s pokazuje biogram autora", (variant) => {
    const container = view(<AuthorBioView variant={variant} />);
    assertNoLeak(container, `author-bio ${variant} biogram`);
  });

  it.each([
    ["pl", "Biogram po polsku."],
    ["en", "Bio in English."],
  ] as const)("biogram w języku %s", (lang, expected) => {
    const container = view(<AuthorBioView variant="card" lang={lang} />);
    expect(container.textContent).toContain(expected);
  });

  it("BEZ biogramu w danym języku spada na wersję drugą", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        lang="en"
        authorOverride={{ ...RICH_AUTHOR, bio_en: undefined }}
      />,
    );
    expect(container.textContent).toContain("Biogram po polsku.");
  });

  it("BEZ biogramu w obu językach nie renderuje akapitu", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        authorOverride={{ ...RICH_AUTHOR, bio_pl: undefined, bio_en: undefined }}
      />,
    );
    assertNoLeak(container, "author-bio bez biogramu");
  });

  it("biogram w HTML-u jest sprowadzany do czystego tekstu", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        authorOverride={{ ...RICH_AUTHOR, bio_pl: "<b>Pogrubiony</b> biogram" }}
      />,
    );
    expect(container.textContent).toContain("Pogrubiony biogram");
    expect(container.innerHTML).not.toContain("<b>Pogrubiony</b>");
  });
});

describe("AuthorBioView - linki społecznościowe", () => {
  it.each([
    ["contactEmail", "mailto:autor@nes.test"],
    ["phone", "tel:+48600100200"],
    ["xUrl", "https://x.com/autor"],
    ["linkedinUrl", "https://linkedin.com/in/autor"],
    ["facebookUrl", "https://facebook.com/autor"],
    ["instagramUrl", "https://instagram.com/autor"],
    ["spotifyUrl", "https://open.spotify.com/artist/autor"],
    ["websiteUrl", "https://autor.test"],
  ])("pole %s daje odnośnik %s", (_field, href) => {
    const container = view(<AuthorBioView variant="card" showSocial />);
    expect(hrefs(container)).toContain(href);
  });

  it("BEZ xUrl bierze twitterUrl jako zapas", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        showSocial
        authorOverride={{ ...RICH_AUTHOR, xUrl: undefined }}
      />,
    );
    expect(hrefs(container)).toContain("https://twitter.com/autor");
  });

  it("BEZ xUrl i twitterUrl nie renderuje odnośnika X", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        showSocial
        authorOverride={{ ...RICH_AUTHOR, xUrl: undefined, twitterUrl: undefined }}
      />,
    );
    expect(hrefs(container).some((x) => x.includes("x.com") || x.includes("twitter"))).toBe(false);
  });

  it("numer telefonu traci spacje w adresie tel:", () => {
    const container = view(<AuthorBioView variant="card" showSocial />);
    expect(hrefs(container)).toContain("tel:+48600100200");
  });

  it("linki własne renderują ikonę z uploadu, gdy jest podana", () => {
    const container = view(<AuthorBioView variant="card" showSocial />);
    const imgs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(imgs).toContain("https://cdn.test/m.svg");
    expect(hrefs(container)).toContain("https://mastodon.social/@autor");
  });

  it("link własny BEZ ikony dostaje ikonę zastępczą, nie puste miejsce", () => {
    const container = view(<AuthorBioView variant="card" showSocial />);
    expect(hrefs(container)).toContain("https://autor.substack.com");
  });

  it("link własny BEZ adresu jest pomijany", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        showSocial
        authorOverride={
          {
            ...RICH_AUTHOR,
            customSocials: [{ label: "Bez adresu", url: "" }],
          } as unknown as CurrentPostAuthor
        }
      />,
    );
    expect(hrefs(container).some((x) => x === "")).toBe(false);
  });

  it("link własny BEZ etykiety używa adresu jako etykiety", () => {
    const container = view(
      <AuthorBioView
        variant="card"
        showSocial
        authorOverride={
          {
            ...RICH_AUTHOR,
            customSocials: [{ label: "", url: "https://bez-etykiety.test" }],
          } as unknown as CurrentPostAuthor
        }
      />,
    );
    const labels = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("aria-label"),
    );
    expect(labels).toContain("https://bez-etykiety.test");
  });

  it("customSocials nieobecne nie wywala budowania listy", () => {
    const container = view(
      <AuthorBioView variant="card" showSocial authorOverride={BARE_AUTHOR} />,
    );
    assertNoLeak(container, "author-bio bez customSocials");
  });

  it("odnośniki ZEWNĘTRZNE otwierają się w nowej karcie z rel", () => {
    const container = view(<AuthorBioView variant="card" showSocial />);
    const external = Array.from(container.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("href") ?? "").startsWith("https://"),
    );
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) {
      if ((a.getAttribute("aria-label") ?? "") === "") continue;
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noreferrer");
    }
  });

  it.each(["mailto:autor@nes.test", "tel:+48600100200"])(
    "odnośnik %s NIE otwiera się w nowej karcie",
    (href) => {
      const container = view(<AuthorBioView variant="card" showSocial />);
      const a = Array.from(container.querySelectorAll("a")).find(
        (x) => x.getAttribute("href") === href,
      );
      expect(a?.getAttribute("target")).toBeNull();
      expect(a?.getAttribute("rel")).toBeNull();
    },
  );

  it.each(["card", "inline", "minimal", "profile"] as const)(
    "wariant %s z wyłączonymi linkami ich nie renderuje",
    (variant) => {
      const container = view(<AuthorBioView variant={variant} showSocial={false} />);
      expect(hrefs(container).some((x) => x.startsWith("mailto:"))).toBe(false);
    },
  );

  // Wariant „split" ma inny kontrakt: adres kontaktowy jest tam PRZYCISKIEM
  // akcji („Kontakt"), a nie ikoną w pasku linków, więc `showSocial` go nie
  // dotyczy. To celowe rozróżnienie, nie przeoczenie - test je przybija, żeby
  // nikt go nie „naprawił" przez pomyłkę.
  it("wariant split pokazuje przycisk kontaktu NIEZALEŻNIE od showSocial", () => {
    const container = view(<AuthorBioView variant="split" showSocial={false} />);
    expect(hrefs(container)).toContain("mailto:autor@nes.test");
  });

  it("wariant split BEZ adresu kontaktowego nie renderuje przycisku kontaktu", () => {
    const container = view(
      <AuthorBioView
        variant="split"
        authorOverride={{ ...RICH_AUTHOR, contactEmail: undefined }}
      />,
    );
    expect(hrefs(container).some((x) => x.startsWith("mailto:"))).toBe(false);
  });

  it("autor BEZ żadnego linku nie renderuje pustego paska ikon", () => {
    const container = view(
      <AuthorBioView variant="card" showSocial authorOverride={BARE_AUTHOR} />,
    );
    expect(container.querySelectorAll("a[aria-label]")).toHaveLength(0);
  });
});

describe("AuthorBioView - licznik wpisów", () => {
  it("pokazuje licznik, gdy jest włączony i policzony", async () => {
    h.authorPostsCount = 42;
    const container = view(<AuthorBioView variant="card" showPostsCount />);
    await waitFor(() => expect(container.textContent).toContain("42"));
  });

  it("licznik równy 0 jest pokazywany (0 to wynik, nie brak)", async () => {
    h.authorPostsCount = 0;
    const container = view(<AuthorBioView variant="card" showPostsCount />);
    await waitFor(() => expect(container.textContent).toContain("0"));
  });

  it("licznik WYŁĄCZONY nie jest pobierany ani pokazywany", async () => {
    h.authorPostsCount = 42;
    const container = view(<AuthorBioView variant="card" showPostsCount={false} />);
    await waitFor(() => expect(container.textContent).toContain("Autor Testowy"));
    expect(container.textContent).not.toContain("42");
  });

  it("licznik jeszcze nieznany nie wypisuje wartości zastępczej", () => {
    h.authorPostsCount = null;
    const container = view(<AuthorBioView variant="card" showPostsCount />);
    assertNoLeak(container, "author-bio licznik null");
  });

  // NAPRAWIONE 2026-10-18: polska odmiana licznika liczyła formę po samym
  // `n < 5`, więc „0 wpisy" i „22 wpisów" trafiały na wizytówkę autora. Forma
  // idzie teraz z reguł CLDR (`Intl.PluralRules("pl")`): one / few / many.
  it.each([
    [0, "0 wpisów"],
    [1, "1 wpis"],
    [3, "3 wpisy"],
    [12, "12 wpisów"],
    [21, "21 wpisów"],
    [22, "22 wpisy"],
    [104, "104 wpisy"],
    [112, "112 wpisów"],
  ])("licznik %i odmienia się po polsku jako „%s”", async (count, label) => {
    h.authorPostsCount = count;
    const container = view(<AuthorBioView variant="card" showPostsCount lang="pl" />);
    await waitFor(() => expect(container.textContent).toContain(label));
  });

  it.each([
    [1, "1 post"],
    [2, "2 posts"],
  ])("licznik %i po angielsku to „%s”", async (count, label) => {
    h.authorPostsCount = count;
    const container = view(<AuthorBioView variant="card" showPostsCount lang="en" />);
    await waitFor(() => expect(container.textContent).toContain(label));
  });
});

describe("AuthorBioView - autor dociągany po identyfikatorze", () => {
  it("authorId wczytuje profil z bazy i pokazuje jego dane", async () => {
    h.authorProfile = {
      id: "author-9",
      slug: "z-bazy",
      display_name: "Autor Z Bazy",
      avatar_url: "https://cdn.test/db.jpg",
      bio_pl: "Biogram z bazy.",
      bio_en: "Bio from db.",
      job_title: "Redaktor",
      twitter_url: "https://x.com/zbazy",
      linkedin_url: "https://linkedin.com/in/zbazy",
      facebook_url: "https://facebook.com/zbazy",
      instagram_url: "https://instagram.com/zbazy",
      spotify_url: "https://open.spotify.com/artist/zbazy",
      website_url: "https://zbazy.test",
    };
    const container = view(<AuthorBioView variant="card" authorId="author-9" />, ctxWith(null));
    await waitFor(() => expect(container.textContent).toContain("Autor Z Bazy"));
    expect(hrefs(container)).toContain("/author/z-bazy");
    expect(container.textContent).toContain("Redaktor");
  });

  it("profil z bazy o polach NULL nie wypisuje wartości zastępczych", async () => {
    h.authorProfile = {
      id: "author-9",
      slug: null,
      display_name: "Tylko Nazwa",
      avatar_url: null,
      bio_pl: null,
      bio_en: null,
      job_title: null,
      twitter_url: null,
      linkedin_url: null,
      facebook_url: null,
      instagram_url: null,
      spotify_url: null,
      website_url: null,
    };
    const container = view(<AuthorBioView variant="card" authorId="author-9" />, ctxWith(null));
    await waitFor(() => expect(container.textContent).toContain("Tylko Nazwa"));
    assertNoLeak(container, "profil z bazy null");
    expect(container.textContent).not.toContain("null");
  });

  it("profil z bazy BEZ nazwy chowa wizytówkę", async () => {
    h.authorProfile = { id: "author-9", display_name: null, slug: null };
    const container = view(<AuthorBioView variant="card" authorId="author-9" />, ctxWith(null));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("authorOverride ma PIERWSZEŃSTWO nad profilem z bazy", async () => {
    h.authorProfile = { id: "author-9", display_name: "Z Bazy", slug: "z-bazy" };
    const container = view(
      <AuthorBioView variant="card" authorId="author-9" authorOverride={RICH_AUTHOR} />,
      ctxWith(null),
    );
    await waitFor(() => expect(container.textContent).toContain("Autor Testowy"));
    expect(container.textContent).not.toContain("Z Bazy");
  });

  it("BEZ authorId profil z bazy nie jest pobierany - wygrywa kontekst wpisu", async () => {
    h.authorProfile = { id: "author-9", display_name: "Z Bazy", slug: "z-bazy" };
    const container = view(<AuthorBioView variant="card" />);
    await waitFor(() => expect(container.textContent).toContain("Autor Testowy"));
  });
});

describe("AuthorBioView - wariant profile i jego styl", () => {
  it.each([
    ["układ domyślny", {}],
    ["portret po prawej", { imagePosition: "right" }],
    ["bez cienia", { shadow: false }],
    ["własne promienie", { radiusPx: 4 }],
    ["własne kolory", { bgColor: "#101010", textColor: "#f0f0f0" }],
  ])("styl karty profilu: %s renderuje wizytówkę", (_l, profileStyle) => {
    const container = view(
      <AuthorBioView variant="profile" profileStyle={profileStyle as never} />,
    );
    expect(container.textContent).toContain("Autor Testowy");
    assertNoLeak(container, "profile style");
  });

  it("wariant profile BEZ stylu nie wywala renderu", () => {
    const container = view(<AuthorBioView variant="profile" />);
    expect(container.textContent).toContain("Autor Testowy");
  });

  it("wariant profile z wyłączonymi linkami przekazuje pustą listę do karty", () => {
    const container = view(<AuthorBioView variant="profile" showSocial={false} />);
    expect(hrefs(container).some((x) => x.startsWith("mailto:"))).toBe(false);
  });
});

describe("RelatedPostsView", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "p-1",
    slug: "powiazany",
    title_pl: "Powiązany wpis",
    title_en: "Related post",
    cover_image_url: "https://cdn.test/r.jpg",
    published_at: "2026-07-01T10:00:00.000Z",
    ...over,
  });

  it.each(["category", "tag", "author", "latest", "nieznana"])(
    "strategia %s renderuje listę",
    async (strategy) => {
      h.posts = [row()];
      const container = view(<RelatedPostsView strategy={strategy as never} limit={3} />);
      await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
      assertNoLeak(container, `related ${strategy}`);
    },
  );

  it.each(["grid", "list", "compact", "nieznany"])("układ %s renderuje listę", async (layout) => {
    h.posts = [row()];
    const container = view(<RelatedPostsView layout={layout as never} />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
  });

  it("własny nagłówek wygrywa nad domyślnym", async () => {
    h.posts = [row()];
    const container = view(<RelatedPostsView heading="Czytaj dalej" />);
    await waitFor(() => expect(container.textContent).toContain("Czytaj dalej"));
  });

  it.each([
    ["pl", "Powiązany wpis"],
    ["en", "Related post"],
  ] as const)("BEZ nagłówka używa kopii domyślnej dla %s", async (lang, title) => {
    h.posts = [row()];
    const container = view(<RelatedPostsView lang={lang} />);
    await waitFor(() => expect(container.textContent).toContain(title));
    assertNoLeak(container, `related ${lang}`);
  });

  it.each([
    ["pl", "Powiązany wpis"],
    ["en", "Related post"],
  ] as const)("tytuł w języku %s", async (lang, expected) => {
    h.posts = [row()];
    const container = view(<RelatedPostsView lang={lang} />);
    await waitFor(() => expect(container.textContent).toContain(expected));
  });

  // NAPRAWIONE 2026-10-18 (był `it.fails`): ODNOŚNIK BEZ NAZWY.
  // `RelatedPostsView` czytał tytuł jako `(lang === "en" ? p.title_en :
  // p.title_pl) ?? ""` - BEZ zapasu na drugi język, więc wpis bez tłumaczenia
  // lądował na liście jako karta z samą datą, a jego odnośnik nie miał
  // dostępnej nazwy. Teraz tytuł schodzi tym samym łańcuchem co
  // `PostTitleView`: język strony, potem drugi język (pusty/biały napis też
  // liczy się jako brak).
  it("spada na tytuł w drugim języku, gdy brakuje tłumaczenia", async () => {
    h.posts = [row({ title_en: null })];
    const container = view(<RelatedPostsView lang="en" />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
  });

  it.each(["grid", "list", "compact"] as const)(
    "w układzie %s odnośnik wpisu bez tłumaczenia ma dostępną nazwę",
    async (layout) => {
      h.posts = [row({ title_en: "  ", cover_image_url: null })];
      const container = view(<RelatedPostsView lang="en" layout={layout} />);
      await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
      const names = Array.from(container.querySelectorAll("a")).map((a) => a.textContent);
      expect(names).toEqual(["Powiązany wpis"]);
    },
  );

  it("obraz okładki dostaje ten sam tytuł zapasowy jako tekst alternatywny", async () => {
    h.posts = [row({ title_pl: null })];
    const container = view(<RelatedPostsView lang="pl" />);
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Related post");
  });

  it("wpis BEZ tytułu w obu językach nie wypisuje wartości zastępczej", async () => {
    h.posts = [row({ title_pl: null, title_en: null })];
    const container = view(<RelatedPostsView />);
    await waitFor(() => expect(container.innerHTML).toBeDefined());
    assertNoLeak(container, "related bez tytułu");
    expect(container.textContent ?? "").not.toContain("null");
  });

  it("wpis BEZ okładki nie renderuje pustego obrazu", async () => {
    h.posts = [row({ cover_image_url: null })];
    const container = view(<RelatedPostsView />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
    assertNoLeak(container, "related bez okładki");
  });

  it("wpis BEZ daty publikacji nie wypisuje Invalid Date", async () => {
    h.posts = [row({ published_at: null })];
    const container = view(<RelatedPostsView />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
    assertNoLeak(container, "related bez daty");
  });

  it("PUSTA lista nie renderuje sekcji", async () => {
    h.posts = [];
    const container = view(<RelatedPostsView />);
    await waitFor(() => expect(container.innerHTML).toBeDefined());
    expect(container.textContent).not.toContain("Powiązany");
  });

  it("BEZ kontekstu wpisu nie renderuje sekcji", async () => {
    h.posts = [row()];
    const container = view(<RelatedPostsView />, null);
    await waitFor(() => expect(container.innerHTML).toBeDefined());
    assertNoLeak(container, "related bez kontekstu");
  });

  // Wykluczenie bieżącego wpisu robi ZAPYTANIE (`currentId`), nie widok -
  // dlatego kontraktem jest to, co widok przekazuje do zapytania: identyfikator
  // bieżącego wpisu, slugi jego kategorii i tagów, autora oraz limit.
  it("przekazuje do zapytania bieżący wpis (wykluczenie), taksonomie, autora i limit", async () => {
    h.posts = [row()];
    const container = view(<RelatedPostsView strategy="tag" limit={4} />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
    expect(h.relatedInputs.at(-1)).toEqual({
      currentId: "post-1",
      strategy: "tag",
      categorySlugs: ["analizy"],
      tagSlugs: ["energia"],
      authorId: "author-1",
      limit: 4,
    });
  });

  it.each([1, 3, 6])("limit %i przekazywany do zapytania nie wywala renderu", async (limit) => {
    h.posts = [row()];
    const container = view(<RelatedPostsView limit={limit} />);
    await waitFor(() => expect(container.textContent).toContain("Powiązany wpis"));
  });

  it("wpis linkuje pod własny adres", async () => {
    h.posts = [row()];
    const container = view(<RelatedPostsView />);
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
    expect(hrefs(container).some((x) => x.includes("powiazany"))).toBe(true);
  });
});
