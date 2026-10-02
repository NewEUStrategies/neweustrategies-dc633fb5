// WIDGETY SIDEBARA WPISU - co kompozytor przekazuje każdemu widgetowi.
//
// `postSidebarAndBadge.test.tsx` pilnuje wyboru UKŁADU (per wpis / domyślny /
// awaryjny). Ten plik pilnuje KONTRAKTU WIDGETÓW: jakie dane dostaje każdy typ
// i kiedy widget milczy. Szczególnie karta autora: była zaślepką „Karta autora
// wkrótce.", a teraz renderuje wizytówkę z danych, które wpis już niesie
// (`listen`) - bez osobnego zapytania - i nie dubluje wizytówki panelu czytania.
//
// Widgety mają własne testy, więc są tu atrapami zapisującymi propsy. Leniwe
// (`lazy`) widgety ładują atrapy przez prawdziwy dynamiczny import.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { SidebarLayout, SidebarWidget } from "@/lib/sidebarBuilder/types";

type Props = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = {
    byId: null as unknown,
    fallbackDefault: null as unknown,
    defaultReads: 0,
    props: {} as Record<string, Array<Record<string, unknown>>>,
    record: (name: string, props: Record<string, unknown>): void => {
      (state.props[name] ??= []).push(props);
    },
  };
  return state;
});

vi.mock("@/lib/queries/sidebarLayouts", () => ({
  sidebarLayoutByIdQueryOptions: (id?: string | null) => ({
    queryKey: ["sidebar-layout", id ?? null],
    enabled: !!id,
    queryFn: async () => h.byId,
    retry: false,
  }),
  defaultSidebarLayoutQueryOptions: () => ({
    queryKey: ["sidebar-layout", "default"],
    queryFn: async () => {
      h.defaultReads += 1;
      return h.fallbackDefault;
    },
    retry: false,
  }),
  buildFallbackLayout: () => ({
    id: "fallback",
    widgets: [{ id: "w-fallback", type: "reading-panel", settings: {}, hidden: false }],
  }),
}));

vi.mock("@/components/share/FloatingShareBar", () => ({
  FloatingShareBar: (p: Props) => {
    h.record("FloatingShareBar", p);
    return <div data-testid="reading-panel" />;
  },
}));

vi.mock("@/components/post/AuthorBusinessCard", () => ({
  AuthorBusinessCard: (p: Props) => {
    h.record("AuthorBusinessCard", p);
    return <div data-testid="author-card" />;
  },
}));

vi.mock("@/components/post/RelatedPosts", () => ({
  RelatedPosts: (p: Props) => {
    h.record("RelatedPosts", p);
    return <div data-testid="related-posts" />;
  },
}));

vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: (p: Props) => {
    h.record("NewsletterForm", p);
    return <div data-testid="newsletter" />;
  },
}));

vi.mock("@/components/AdSlot", () => ({
  AdZone: (p: Props) => {
    h.record("AdZone", p);
    return <div data-testid="ad-zone" />;
  },
}));

import { PostSidebarRenderer } from "@/components/post/PostSidebarRenderer";

type RendererProps = ComponentProps<typeof PostSidebarRenderer>;

function layout(widgets: Array<Partial<SidebarWidget> & Pick<SidebarWidget, "type">>) {
  const full: Pick<SidebarLayout, "id" | "widgets"> = {
    id: "override",
    widgets: widgets.map((w, i) => ({ id: `w${i + 1}`, settings: {}, hidden: false, ...w })),
  };
  return full;
}

function renderSidebar(over: Partial<RendererProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <PostSidebarRenderer
          postId="p1"
          postTitle="Analiza"
          lang="pl"
          layoutId="override"
          {...over}
        />
      </QueryClientProvider>,
    ),
  };
}

const LISTEN: NonNullable<RendererProps["listen"]> = {
  postId: "p1",
  title: "Analiza",
  author: "Anna Nowak",
  authorId: "author-1",
  authorHref: "/author/anna",
  authorAvatarUrl: "https://cdn.example.com/anna.jpg",
  authorJobTitle: "Analityczka",
  authorCompany: "NES",
  authorBio: "Długie bio",
  authorEmail: null,
  authorXUrl: "https://x.com/anna",
  authorLinkedinUrl: null,
  authorFacebookUrl: null,
  authorInstagramUrl: null,
  authorWebsiteUrl: "https://anna.example.org",
  authorSpotifyUrl: null,
  authorCustomSocials: [{ label: "Blog", url: "https://blog.example.org" }],
};

/** Czeka, aż układ z bazy wyprze awaryjny panel czytania z pierwszego renderu. */
async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId("reading-panel")).toBeNull());
}

beforeEach(() => {
  h.byId = null;
  h.fallbackDefault = null;
  h.defaultReads = 0;
  h.props = {};
});

describe("PostSidebarRenderer - karta autora", () => {
  it("renderuje wizytówkę z danych autora wpisu, nie zaślepkę", async () => {
    h.byId = layout([{ type: "tags" }, { type: "author-card" }]);
    renderSidebar({ listen: LISTEN, tags: [{ slug: "nato", name: "NATO" }] });
    expect(await screen.findByTestId("author-card")).toBeInTheDocument();
    expect(screen.queryByText(/wkrótce|coming soon/i)).toBeNull();
    expect(h.props.AuthorBusinessCard?.at(-1)).toMatchObject({
      lang: "pl",
      name: "Anna Nowak",
      authorId: "author-1",
      href: "/author/anna",
      avatarUrl: "https://cdn.example.com/anna.jpg",
      jobTitle: "Analityczka",
      company: "NES",
      xUrl: "https://x.com/anna",
      websiteUrl: "https://anna.example.org",
      customSocials: [{ label: "Blog", url: "https://blog.example.org" }],
    });
  });

  it("bez danych autora widget milczy - żadnej pustej ramki", async () => {
    h.byId = layout([{ type: "author-card" }, { type: "newsletter" }]);
    const { container } = renderSidebar({ listen: { ...LISTEN, author: null } });
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(screen.queryByTestId("author-card")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("wpis audio/wideo (bez `listen`) nie dostaje karty", async () => {
    h.byId = layout([{ type: "author-card" }, { type: "newsletter" }]);
    renderSidebar({ listen: null, lang: "en" });
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(h.props.AuthorBusinessCard).toBeUndefined();
  });

  it("obok panelu czytania karta się nie dubluje - panel ma już wizytówkę", async () => {
    h.byId = layout([{ type: "reading-panel" }, { type: "author-card" }]);
    const { client } = renderSidebar({ listen: LISTEN });
    // Układ z bazy wygląda tu jak awaryjny (sam panel), więc czekamy na ODCZYT
    // układu, a nie na zmianę obrazu - inaczej test sprawdzałby stan przejściowy.
    await waitFor(() =>
      expect(client.getQueryState(["sidebar-layout", "override"])?.status).toBe("success"),
    );
    expect(h.props.FloatingShareBar?.at(-1)?.listen).toBe(LISTEN);
    expect(screen.getAllByTestId("reading-panel")).toHaveLength(1);
    expect(screen.queryByTestId("author-card")).toBeNull();
  });

  it("dwa widgety karty w układzie dają JEDNĄ wizytówkę (pierwszy wygrywa)", async () => {
    h.byId = layout([{ type: "author-card" }, { type: "tags" }, { type: "author-card" }]);
    renderSidebar({ listen: LISTEN, tags: [{ slug: "nato", name: "NATO" }] });
    expect(await screen.findByTestId("author-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("author-card")).toHaveLength(1);
    // Karta stoi przed tagami - tam, gdzie postawił ją pierwszy widget.
    const sidebar = screen.getByTestId("author-card").parentElement;
    expect(sidebar?.firstElementChild).toBe(screen.getByTestId("author-card"));
  });

  it("autor bez konta w serwisie dostaje kartę bez identyfikatora (bez obserwacji)", async () => {
    h.byId = layout([{ type: "author-card" }]);
    renderSidebar({ listen: { ...LISTEN, authorId: undefined } });
    expect(await screen.findByTestId("author-card")).toBeInTheDocument();
    expect(h.props.AuthorBusinessCard?.at(-1)).toMatchObject({
      name: "Anna Nowak",
      authorId: null,
    });
  });

  it("ukryty widget karty nie odbiera głosu kolejnemu widocznemu", async () => {
    h.byId = layout([
      { type: "author-card", hidden: true },
      { type: "author-card", id: "visible-card" },
    ]);
    renderSidebar({ listen: LISTEN });
    expect(await screen.findByTestId("author-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("author-card")).toHaveLength(1);
  });
});

describe("PostSidebarRenderer - tagi", () => {
  it("tagi wpisu jako odnośniki do archiwum tagu, z nagłówkiem w języku wpisu", async () => {
    h.byId = layout([{ type: "tags" }]);
    renderSidebar({
      tags: [
        { slug: "nato", name: "NATO" },
        { slug: "ue", name: "UE" },
      ],
    });
    const aside = await screen.findByRole("complementary", { name: "Tagi" });
    expect(aside).toHaveTextContent("TAGI");
    expect(screen.getAllByRole("link").map((a) => [a.getAttribute("href"), a.textContent])).toEqual(
      [
        ["/tag/nato", "#NATO"],
        ["/tag/ue", "#UE"],
      ],
    );
  });

  it("angielski wpis: etykieta i nagłówek po angielsku", async () => {
    h.byId = layout([{ type: "tags" }]);
    renderSidebar({ lang: "en", tags: [{ slug: "nato", name: "NATO" }] });
    expect(await screen.findByRole("complementary", { name: "Tags" })).toHaveTextContent("TAGS");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tag/nato");
  });

  it("wpis bez tagów nie dostaje pustego widgetu tagów", async () => {
    h.byId = layout([{ type: "tags" }, { type: "newsletter" }]);
    renderSidebar({ tags: [] });
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("PostSidebarRenderer - widgety leniwe i reklama", () => {
  it("powiązane wpisy dostają TEN SAM obiekt nadpisania co mount pod treścią", async () => {
    const override = { enabled: true };
    h.byId = layout([{ type: "related-posts" }]);
    renderSidebar({ relatedOverride: override, lang: "en" });
    expect(await screen.findByTestId("related-posts")).toBeInTheDocument();
    const props = h.props.RelatedPosts?.at(-1);
    expect(props).toMatchObject({ postId: "p1", lang: "en", forceLayout: "list", forceColumns: 2 });
    expect(props?.override).toBe(override);
  });

  it("newsletter w sidebarze to karta z oznaczonym źródłem zapisu", async () => {
    h.byId = layout([{ type: "newsletter" }]);
    renderSidebar();
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(h.props.NewsletterForm?.at(-1)).toEqual({
      lang: "pl",
      source: "sidebar",
      variant: "card",
    });
  });

  it("reklama dostaje kontekst targetingu wpisu", async () => {
    const adContent = { categorySlugs: ["energia"], tagSlugs: ["nato"] };
    h.byId = layout([{ type: "ad-slot" }]);
    renderSidebar({ adContent });
    expect(await screen.findByTestId("ad-zone")).toBeInTheDocument();
    expect(h.props.AdZone?.at(-1)).toEqual({
      position: "sidebar",
      pageType: "post",
      pageId: "p1",
      content: adContent,
    });
  });

  it("bez jawnego kontekstu reklama targetuje po tagach wpisu", async () => {
    h.byId = layout([{ type: "ad-slot" }]);
    renderSidebar({ tags: [{ slug: "nato", name: "NATO" }] });
    expect(await screen.findByTestId("ad-zone")).toBeInTheDocument();
    expect(h.props.AdZone?.at(-1)?.content).toEqual({ tagSlugs: ["nato"] });
  });

  it("bez tagów i kontekstu reklama dostaje pustą listę, nie `undefined`", async () => {
    h.byId = layout([{ type: "ad-slot" }]);
    renderSidebar();
    expect(await screen.findByTestId("ad-zone")).toBeInTheDocument();
    expect(h.props.AdZone?.at(-1)?.content).toEqual({ tagSlugs: [] });
  });

  it("strefa sidebar poza budżetem reklam: widget reklamy milczy", async () => {
    h.byId = layout([{ type: "ad-slot" }, { type: "newsletter" }]);
    renderSidebar({ suppressAds: true });
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(screen.queryByTestId("ad-zone")).toBeNull();
    expect(h.props.AdZone).toBeUndefined();
  });
});

describe("PostSidebarRenderer - panel czytania i wybór układu", () => {
  it("ustawienia panelu łączą się z domyślnymi, a TOC w treści wyłącza kopię w panelu", async () => {
    h.byId = layout([
      { type: "reading-panel", settings: { showPrint: false, social: { x: false } } },
    ]);
    renderSidebar({ suppressToc: true, listen: LISTEN });
    await waitFor(() =>
      expect(h.props.FloatingShareBar?.at(-1)?.settings).toMatchObject({ showPrint: false }),
    );
    const props = h.props.FloatingShareBar?.at(-1);
    expect(props?.settings).toMatchObject({
      showToc: false,
      showProgress: true,
      showPrint: false,
      social: { x: false, facebook: true, linkedin: true },
    });
    expect(props).toMatchObject({ entityId: "p1", entityType: "post", variant: "sidebar" });
    expect(props?.listen).toBe(LISTEN);
  });

  it("bez `listen` panel dostaje jawne null (wpis audio/wideo nie ma odsłuchu)", async () => {
    h.byId = layout([{ type: "reading-panel", settings: { showPrint: false } }]);
    renderSidebar();
    await waitFor(() =>
      expect(h.props.FloatingShareBar?.at(-1)?.settings).toMatchObject({ showPrint: false }),
    );
    expect(h.props.FloatingShareBar?.at(-1)?.listen).toBeNull();
    expect(h.props.FloatingShareBar?.at(-1)?.settings).toMatchObject({ showToc: true });
  });

  it("niewidoczny układ per wpis (null, nie błąd) oddaje głos DOMYŚLNEMU układowi tenanta", async () => {
    h.byId = null;
    h.fallbackDefault = layout([{ type: "newsletter" }]);
    renderSidebar({ layoutId: "obcy-tenant" });
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    await settled();
    expect(h.defaultReads).toBe(1);
  });

  it("nieznany typ widgetu (z nowszego buildera) jest pomijany, sąsiedzi zostają", async () => {
    h.byId = {
      id: "override",
      widgets: [
        { id: "w1", type: "widget-z-przyszlosci", settings: {}, hidden: false },
        { id: "w2", type: "newsletter", settings: {}, hidden: false },
      ],
    };
    const { container } = renderSidebar();
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it("widoczny układ per wpis NIE pyta o domyślny (bez zbędnego żądania)", async () => {
    h.byId = layout([{ type: "newsletter" }]);
    h.fallbackDefault = layout([{ type: "tags" }]);
    renderSidebar();
    expect(await screen.findByTestId("newsletter")).toBeInTheDocument();
    expect(h.defaultReads).toBe(0);
  });
});
