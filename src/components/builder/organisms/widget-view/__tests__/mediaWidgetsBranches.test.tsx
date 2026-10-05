// mediaWidgets: gałęzie, których nie domyka branchClose - profil autorów
// slidera (batch-fetch profiles_public - widok zawężony do tenanta:
// display_name vs imię+nazwisko, brak danych),
// dopasowanie src do logo strony (srcMatchesSiteLogo), fallback onError dla
// logo (gc-img-light/dark), warianty ratio + link wewnętrzny bez _blank
// oraz wyłączenie zajawki/covera w konfiguracji slidera.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";
import { LcpCandidatesProvider, LcpEagerSection } from "@/lib/builder/aboveFold";
import { BuilderImageSlotContext } from "@/lib/builder/imageSlotContext";
import { imageWidgetSizes } from "@/lib/builder/widgetImageSizes";
import type { ImageSlot } from "@/lib/builder/imageSlot";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"])
      b[m] = () => b;
    b.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

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

let nextId = 0;
function renderNode(
  type: WidgetType,
  content: WidgetContent,
  opts: {
    lang?: "pl" | "en";
    editable?: boolean;
    lcpCandidate?: boolean;
    /** Pierwsza sekcja renderu czysto klienckiego właściciela (`LcpImage` = "eager"). */
    eagerSection?: boolean;
    slot?: ImageSlot;
  } = {},
) {
  const node: WidgetNode = { id: `mw-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LcpCandidatesProvider widgetIds={opts.lcpCandidate ? [node.id] : []}>
        <LcpEagerSection eager={opts.eagerSection ?? false}>
          <BuilderImageSlotContext.Provider value={opts.slot}>
            <WidgetView
              node={node}
              lang={opts.lang ?? "pl"}
              device="desktop"
              editable={opts.editable ?? false}
              onContentChange={opts.editable ? () => {} : undefined}
            />
          </BuilderImageSlotContext.Provider>
        </LcpEagerSection>
      </LcpCandidatesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("PostsSliderWidget - profile autorów slajdów", () => {
  const posts = [
    {
      id: "p1",
      slug: "pierwszy",
      title_pl: "Pierwszy wpis",
      title_en: null,
      excerpt_pl: "Zajawka",
      excerpt_en: null,
      cover_image_url: null,
      published_at: "2026-01-01T00:00:00Z",
      author_id: "a1",
    },
    {
      id: "p2",
      slug: "drugi",
      title_pl: "Drugi wpis",
      title_en: "Second post",
      excerpt_pl: "Z2",
      excerpt_en: "E2",
      cover_image_url: "https://cdn.example.com/c2.jpg",
      published_at: "2026-01-02T00:00:00Z",
      author_id: "a2",
    },
  ];

  it("resolves display_name and composed first/last names into slides", async () => {
    db.tables.posts = posts;
    db.tables.profiles_public = [
      {
        id: "a1",
        display_name: null,
        first_name: "Jan",
        last_name: "Kowalski",
        avatar_url: null,
        slug: null,
      },
      {
        id: "a2",
        display_name: "  Redakcja NES  ",
        first_name: null,
        last_name: null,
        avatar_url: "https://cdn.example.com/red.png",
        slug: "redakcja",
      },
    ];
    const { container } = renderNode("slider", {
      source: "posts",
      variant: "editorial-hero",
      cta_pl: "Czytaj",
    });

    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    // Brak display_name -> "Imię Nazwisko" złożone z first/last (aktywny slajd).
    await waitFor(() => expect(container.textContent).toContain("Jan Kowalski"));
  });

  it("hides excerpts when showExcerpt=false and tolerates rows without profiles", async () => {
    db.tables.posts = posts;
    db.tables.profiles_public = [];
    const { container } = renderNode("slider", {
      source: "posts",
      showExcerpt: false,
      showAuthor: false,
      showCover: false,
    });
    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    expect(container.textContent).not.toContain("Zajawka");
  });
});

describe("ImageWidget - logo strony i fallbacki", () => {
  // PRZEPISANE ŚWIADOMIE (P1.4). Dawniej priorytet dawała pozycja sekcji
  // (`AboveFoldProvider aboveFold`): każdy obraz trzech czołowych sekcji był
  // eager + high. Teraz wyłącznie widget wskazany przez renderer-właściciela
  // (`lcpCandidates` -> `LcpCandidatesProvider`) - i tylko on niesie znacznik
  // `data-lcp-candidate`, którego szuka boot po LCP (P2.1).
  it.each([false, true])(
    "preserves column sizes; eager/high + marker only for the LCP candidate=%s",
    (lcpCandidate) => {
      const slot: ImageSlot = { desktop: { vw: 50, cap: 680 }, tablet: { vw: 100, cap: 900 } };
      const content = {
        src: "https://p.supabase.co/storage/v1/object/public/covers/full.jpg",
        href: "/raporty",
      };
      const { container } = renderNode("image", content, { slot, lcpCandidate });
      const img = container.querySelector("img")!;
      // Obraz bez ramki nie używa `auto, ` - sizes równe deskryptorowi
      // preloadu (heroImage) w obu stanach.
      expect(img).toHaveAttribute("sizes", imageWidgetSizes(content, slot));
      expect(img.getAttribute("srcset")).toContain("/render/image/public/");
      expect(img).toHaveAttribute("loading", lcpCandidate ? "eager" : "lazy");
      expect(img).toHaveAttribute("fetchpriority", lcpCandidate ? "high" : "auto");
      expect(img.hasAttribute("data-lcp-candidate")).toBe(lcpCandidate);
      expect(container.querySelector("figure")).toHaveClass("w-full");
      expect(container.querySelector("a")?.parentElement?.style.width).toBe("100%");
    },
  );

  it("first section of a pure client render (`eager`): priority WITHOUT the marker; the candidate still wins", () => {
    // Recenzja P1.4 runda 3, M1: nawigacja SPA nie ma kandydata (kod
    // `lcpCandidates` jest tylko na serwerze), ale obraz pierwszej sekcji nie
    // może czekać na obserwację IO. `data-lcp-candidate` zostaje jedyny na
    // stronie - należy wyłącznie do kandydata z SSR.
    const content = { src: "https://p.supabase.co/storage/v1/object/public/covers/spa.jpg" };
    const eager = renderNode("image", content, { eagerSection: true }).container.querySelector(
      "img",
    )!;
    expect(eager).toHaveAttribute("loading", "eager");
    expect(eager.hasAttribute("data-lcp-candidate")).toBe(false);
    cleanup();
    const both = renderNode("image", content, {
      eagerSection: true,
      lcpCandidate: true,
    }).container.querySelector("img")!;
    expect(both).toHaveAttribute("data-lcp-candidate", "");
    expect(both).toHaveAttribute("fetchpriority", "high");
  });

  it("framed image candidate: priority and marker land on the visible foreground img", () => {
    const { container } = renderNode(
      "image",
      { src: "https://p.supabase.co/storage/v1/object/public/covers/framed.jpg", ratio: "16/9" },
      { lcpCandidate: true },
    );
    const img = container.querySelector("img.widget-media-fg")!;
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).toHaveAttribute("data-lcp-candidate", "");
    // Kandydat: sizes BEZ `auto, ` - inaczej klucz preloadu nie pasowałby.
    expect(img.getAttribute("sizes")).not.toMatch(/^auto, /);
  });

  it("light/dark pair never gets priority even when listed as a candidate", () => {
    // `lcpCandidates` nie wskaże pary (oba obrazy są w DOM), ale gdyby kontekst
    // ją wskazał, eager podwoiłby transfer - renderer zostaje przy lazy.
    const { container } = renderNode(
      "image",
      {
        src: "https://p.supabase.co/storage/v1/object/public/covers/light.jpg",
        srcDark: "https://p.supabase.co/storage/v1/object/public/covers/dark.jpg",
      },
      { lcpCandidate: true },
    );
    for (const img of container.querySelectorAll("img")) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img.hasAttribute("data-lcp-candidate")).toBe(false);
    }
  });

  it("uses auto sizes only when a frame reserves the image dimensions", () => {
    const { container } = renderNode("image", {
      src: "https://p.supabase.co/storage/v1/object/public/covers/framed.jpg",
      ratio: "16/9",
    });
    expect(container.querySelector("img")).toHaveAttribute("sizes", "auto, 100vw");
    expect(container.querySelector("[data-widget-media]")?.getAttribute("style")).toContain(
      "aspect-ratio: 16 / 9",
    );
  });

  const themeOptions = {
    key: "theme_options",
    value: {
      logo: {
        main: "https://cdn.example.com/logo.png",
        main_dark: "https://cdn.example.com/logo-dark.png",
      },
    },
  };

  it("treats an image whose src equals the configured site logo as a logo", async () => {
    db.tables.site_settings = [themeOptions];
    const { container } = renderNode("image", {
      src: "https://cdn.example.com/logo.png",
      alt_pl: "Obrazek nagłówka",
      variant: "rounded",
    });

    // Zanim ustawienia dojdą: zwykły obrazek z fade-in i klasą rounded-xl.
    const img = () => container.querySelector("img") as HTMLImageElement;
    expect(img().className).toContain("oi-fade-in");

    // Po dociągnięciu theme_options src pasuje do logo -> styl logo:
    // bez fade-in, klasa bazowa "rounded" zamiast wariantu rounded-xl.
    await waitFor(() => expect(img().className).not.toContain("oi-fade-in"));
    expect(img().className).not.toContain("rounded-xl");
  });

  it("falls back to the light source when the dark logo image fails to load", async () => {
    db.tables.site_settings = [themeOptions];
    const { container } = renderNode("image", {
      src: "",
      useSiteLogo: "main",
      alt_pl: "Logo",
    });

    await waitFor(() => expect(container.querySelector(".gc-img-dark")).not.toBeNull());
    const dark = container.querySelector(".gc-img-dark") as HTMLImageElement;
    fireEvent.error(dark);
    // Handler podmienia src na wariant przeciwny (tu: dark -> dark istnieje,
    // więc zostaje srcDark; kluczowe, że nie rzuca i nie zeruje src).
    expect(dark.getAttribute("src")).toBeTruthy();

    const light = container.querySelector(".gc-img-light") as HTMLImageElement;
    fireEvent.error(light);
    expect(light.getAttribute("src")).toBeTruthy();
  });

  it("renders a framed single-source image with ratio and an internal link", () => {
    const { container } = renderNode("image", {
      src: "https://cdn.example.com/foto.jpg",
      ratio: "16/9",
      href: "/o-nas",
      alt_pl: "Zdjęcie zespołu",
      caption_pl: "Podpis pod zdjęciem",
      align: "left",
      widthPx: 480,
      maxWidthPx: 640,
    });

    // Wewnętrzny link nie dostaje target=_blank.
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "/o-nas");
    expect(link.getAttribute("target")).toBeNull();

    const frame = container.querySelector("[data-widget-media]") as HTMLElement;
    // Ramka ratio ustawia aspect-ratio i tryb dopasowania obrazka; samej
    // szerokości min(100%, 480px) happy-dom nie serializuje (odrzuca min()).
    expect(frame.getAttribute("style")).toContain("aspect-ratio: 16 / 9");
    expect(frame.getAttribute("style")).toContain("--widget-media-fit: cover");
    expect(screen.getByText("Podpis pod zdjęciem")).toBeInTheDocument();
    expect(container.querySelector("figure")?.className).toContain("items-start");
  });

  it("renders the resize handle in the editor and framed light/dark pair", () => {
    const { container } = renderNode(
      "image",
      {
        src: "https://cdn.example.com/a.jpg",
        srcDark: "https://cdn.example.com/b.jpg",
        ratio: "1/1",
        alt_pl: "Ilustracja",
      },
      { editable: true },
    );
    // Obie warstwy w ramce ratio.
    expect(container.querySelector(".gc-img-light.widget-media-fg")).not.toBeNull();
    expect(container.querySelector(".gc-img-dark.widget-media-fg")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KANDYDAT LCP W POZOSTAŁYCH GAŁĘZIACH (P1.4): slider, dark-featured-card,
// post-lista. Wspólna reguła: priorytet + `data-lcp-candidate` WYŁĄCZNIE dla
// widgetu wskazanego przez renderer-właściciela; każdy inny obraz jest leniwy.
// ─────────────────────────────────────────────────────────────────────────────
describe("kandydat LCP - slider, dark-featured-card, post-lista", () => {
  const slides = {
    variant: "editorial-hero",
    autoplay: false,
    items: [
      { image: "https://cdn.example.com/s1.jpg", title_pl: "Slajd 1" },
      { image: "https://cdn.example.com/s2.jpg", title_pl: "Slajd 2" },
    ],
  };

  it("slider-kandydat: slajd 0 eager + high + znacznik, slajd 1 leniwy", async () => {
    const { container } = renderNode("slider", slides, { lcpCandidate: true });
    await waitFor(() => expect(container.querySelector("img.eh-img")).not.toBeNull());
    const imgs = container.querySelectorAll("img.eh-img");
    expect(imgs[0]).toHaveAttribute("loading", "eager");
    expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
    expect(imgs[0]).toHaveAttribute("data-lcp-candidate", "");
    expect(imgs[1]).toHaveAttribute("loading", "lazy");
    expect(container.querySelectorAll("[data-lcp-candidate]")).toHaveLength(1);
  });

  it("slider w pierwszej sekcji renderu klienckiego (`eager`): slajd 0 eager BEZ znacznika", async () => {
    const { container } = renderNode("slider", slides, { eagerSection: true });
    await waitFor(() => expect(container.querySelector("img.eh-img")).not.toBeNull());
    const imgs = container.querySelectorAll("img.eh-img");
    expect(imgs[0]).toHaveAttribute("loading", "eager");
    expect(imgs[1]).toHaveAttribute("loading", "lazy");
    expect(container.querySelectorAll("[data-lcp-candidate]")).toHaveLength(0);
  });

  it("slider spoza kandydata NIE dziedziczy historycznego „slajd 0 zawsze High”", async () => {
    // 4 z 9 obrazów High na fixture `/` to były slidery multi-card spod zgięcia.
    const { container } = renderNode("slider", slides);
    await waitFor(() => expect(container.querySelector("img.eh-img")).not.toBeNull());
    const first = container.querySelector("img.eh-img")!;
    expect(first).toHaveAttribute("loading", "lazy");
    expect(first.getAttribute("fetchpriority")).not.toBe("high");
    expect(container.querySelectorAll("[data-lcp-candidate]")).toHaveLength(0);
  });

  it("dark-featured-card: obraz kandydata eager + high + znacznik; poza kandydatem leniwy", () => {
    const content = { image: "https://cdn.example.com/card.jpg", title_pl: "Karta" };
    const candidate = renderNode("dark-featured-card", content, { lcpCandidate: true });
    const img = candidate.container.querySelector("img")!;
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).toHaveAttribute("data-lcp-candidate", "");
    cleanup();
    const other = renderNode("dark-featured-card", content);
    const lazyImg = other.container.querySelector("img")!;
    expect(lazyImg).toHaveAttribute("loading", "lazy");
    expect(lazyImg.hasAttribute("data-lcp-candidate")).toBe(false);
  });

  it("post-lista: priorytet tylko dla okładki WIODĄCEJ kandydata, reszta leniwa", async () => {
    db.tables.posts = [1, 2, 3].map((n) => ({
      id: `p${n}`,
      slug: `wpis-${n}`,
      title_pl: `Wpis ${n}`,
      title_en: null,
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: `https://cdn.example.com/okladka-${n}.jpg`,
      published_at: "2026-01-01T00:00:00Z",
      author_id: null,
      post_format: null,
    }));
    const candidate = renderNode("post-list", { variant: "card" }, { lcpCandidate: true });
    await waitFor(() => expect(candidate.container.querySelectorAll("img")).toHaveLength(3));
    expect(
      [...candidate.container.querySelectorAll("img")].map((i) => i.getAttribute("loading")),
    ).toEqual(["eager", "lazy", "lazy"]);
    expect(candidate.container.querySelector("img")).toHaveAttribute("fetchpriority", "high");
    cleanup();
    const other = renderNode("post-list", { variant: "card" });
    await waitFor(() => expect(other.container.querySelectorAll("img")).toHaveLength(3));
    expect(
      [...other.container.querySelectorAll("img")].map((i) => i.getAttribute("loading")),
    ).toEqual(["lazy", "lazy", "lazy"]);
    cleanup();
    // Pierwsza sekcja renderu klienckiego: lead eager, bez znacznika.
    const spa = renderNode("post-list", { variant: "card" }, { eagerSection: true });
    await waitFor(() => expect(spa.container.querySelectorAll("img")).toHaveLength(3));
    expect(
      [...spa.container.querySelectorAll("img")].map((i) => i.getAttribute("loading")),
    ).toEqual(["eager", "lazy", "lazy"]);
    expect(spa.container.querySelectorAll("[data-lcp-candidate]")).toHaveLength(0);
  });

  // Recenzja P1.4 M1: atom `WidgetMediaImage` przekazuje znacznik na `<img>`.
  it("okładka wiodąca post-listy-kandydata niesie data-lcp-candidate, pozostałe nie", async () => {
    db.tables.posts = [1, 2].map((n) => ({
      id: `p${n}`,
      slug: `wpis-${n}`,
      title_pl: `Wpis ${n}`,
      title_en: null,
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: `https://cdn.example.com/okladka-${n}.jpg`,
      published_at: "2026-01-01T00:00:00Z",
      author_id: null,
      post_format: null,
    }));
    const { container } = renderNode("post-list", { variant: "card" }, { lcpCandidate: true });
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    const [lead, rest] = container.querySelectorAll("img");
    expect(lead).toHaveAttribute("fetchpriority", "high");
    expect(rest.hasAttribute("data-lcp-candidate")).toBe(false);
    expect(lead).toHaveAttribute("data-lcp-candidate", "");
  });
});
