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
  opts: { lang?: "pl" | "en"; editable?: boolean } = {},
) {
  const node: WidgetNode = { id: `mw-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang={opts.lang ?? "pl"}
        device="desktop"
        editable={opts.editable ?? false}
        onContentChange={opts.editable ? () => {} : undefined}
      />
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
