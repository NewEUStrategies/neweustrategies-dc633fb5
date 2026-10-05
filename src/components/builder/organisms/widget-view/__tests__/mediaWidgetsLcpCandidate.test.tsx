// Kandydat LCP w widgetach mediów (P1.4) i heurystyka logo po alcie (altMarksLogo).
// Priorytet ładowania i znacznik `data-lcp-candidate` dostaje WYŁĄCZNIE widget
// wskazany przez renderer-właściciela (`LcpCandidatesProvider`); pierwsza sekcja
// renderu czysto klienckiego (`LcpEagerSection`) dostaje eager bez znacznika.
// Testy wydzielone przy scaleniu main (PR #475 usunął dawny plik
// mediaWidgetsBranches.test.tsx razem z testami pisanymi pod pokrycie).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
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

describe("ImageWidget - kandydat LCP i logo strony", () => {
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

  const themeOptions = {
    key: "theme_options",
    value: {
      logo: {
        main: "https://cdn.example.com/logo.png",
        main_dark: "https://cdn.example.com/logo-dark.png",
      },
    },
  };

  it("an alt containing 'logo' inside a word (\"Zegar analogowy\") keeps the photo; a whole-word 'Logo' swaps in the site logo", async () => {
    // Dawny test /logo/i podmieniał zwykłe zdjęcie na logo serwisu (altMarksLogo).
    db.tables.site_settings = [themeOptions];
    const photo = "https://p.supabase.co/storage/v1/object/public/covers/zegar.jpg";
    const { container } = renderNode("image", { src: photo, alt_pl: "Zegar analogowy" });
    const img = () => container.querySelector("img") as HTMLImageElement;
    // Dawny kod uznawał alt za logo już w pierwszym renderze: bez klasy wejścia
    // (fadeIn={!isLogo}) i z podmianą src po dociągnięciu theme_options.
    expect(img().className).toContain("oi-fade-in");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(img().className).toContain("oi-fade-in");
    expect(img().getAttribute("src")).toContain("zegar.jpg");
    expect(img().getAttribute("src")).not.toContain("logo.png");
    expect(img().className).not.toContain("site-logo-img");
    cleanup();

    const logo = renderNode("image", { src: "", alt_pl: "Logo NES" });
    await waitFor(() =>
      expect(logo.container.querySelector(".gc-img-light")?.getAttribute("src")).toContain(
        "logo.png",
      ),
    );
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
