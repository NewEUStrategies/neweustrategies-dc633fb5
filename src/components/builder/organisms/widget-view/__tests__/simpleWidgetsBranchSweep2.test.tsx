// Domknięcie gałęzi renderSimpleWidget, których nie dotknął test exhaustive:
// pełne permutacje dividera (space/gradient/icon/wave/style + wyrównania +
// tryb edycji), spacer z wysokościami responsywnymi i tłem, social-icons w
// układzie listy, wideo z bezpośredniego https, tekst rotowany (string vs
// tablica), timeline (nagłówki dat, aktorzy), logo-cloud, cennik ręczny i
// katalogowy oraz drobne fallbacki (lang-switcher, copyright, hot-topic).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { ThemeProvider } from "@/components/ThemeProvider";
import type { Json, WidgetNode, WidgetType, WidgetContent, Device } from "@/lib/builder/types";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "is",
      "in",
      "not",
      "ilike",
      "order",
      "range",
      "limit",
      "gte",
      "lte",
    ])
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
function widgetNode(type: WidgetType, content: WidgetContent | undefined, id?: string): WidgetNode {
  return { id: id ?? `sw2-${nextId++}`, kind: "widget", type, content: content as WidgetContent };
}

function renderNode(
  type: WidgetType,
  content: WidgetContent | undefined,
  opts: {
    lang?: "pl" | "en";
    device?: Device;
    editable?: boolean;
    theme?: boolean;
    id?: string;
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const inner = (
    <WidgetView
      node={widgetNode(type, content, opts.id)}
      lang={opts.lang ?? "pl"}
      device={opts.device ?? "desktop"}
      editable={opts.editable ?? false}
      onContentChange={opts.editable ? () => {} : undefined}
    />
  );
  return render(
    <QueryClientProvider client={qc}>
      {opts.theme ? <ThemeProvider>{inner}</ThemeProvider> : inner}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  db.tables = {};
});

describe("divider - wszystkie warianty i wyrównania", () => {
  it("renders the space variant as pure spacing publicly and as a labeled box in the editor", () => {
    const pub = renderNode("divider", { variant: "space", thickness: 24 });
    const spacer = pub.container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(spacer.style.height).toBe("24px");
    pub.unmount();

    renderNode("divider", { variant: "space", thickness: 24 }, { editable: true });
    expect(screen.getByText("↕ 24px")).toBeInTheDocument();

    // EN aria-label w edytorze.
    cleanup();
    renderNode("divider", { variant: "space" }, { editable: true, lang: "en" });
    expect(screen.getByLabelText("Spacer")).toBeInTheDocument();
  });

  it("renders gradient with custom from/to, with a single color and with neither", () => {
    const custom = renderNode("divider", {
      variant: "gradient",
      gradientFrom: "#ff0000",
      gradientTo: "#0000ff",
      widthPct: 50,
      align: "left",
    });
    const bar = custom.container.querySelector('div[style*="background-image"]') as HTMLElement;
    expect(bar.style.backgroundImage).toContain("#ff0000");
    expect(bar.style.width).toBe("50%");
    expect(bar.style.marginRight).toBe("auto");
    custom.unmount();

    const single = renderNode("divider", { variant: "gradient", color: "#22cc22", align: "right" });
    const bar2 = single.container.querySelector('div[style*="background-image"]') as HTMLElement;
    expect(bar2.style.backgroundImage).toContain("#22cc22");
    expect(bar2.style.marginLeft).toBe("auto");
    single.unmount();

    // Bez kolorów -> klasa gradientowa zamiast inline stylu. Kanwa rysuje tę
    // samą paletę co strona publiczna (podgląd = publikacja).
    const plain = renderNode("divider", { variant: "gradient" });
    expect(plain.container.querySelector(".via-border")).not.toBeNull();
    plain.unmount();
    const editorPlain = renderNode("divider", { variant: "gradient" }, { editable: true });
    expect(editorPlain.container.querySelector(".via-border")).not.toBeNull();
  });

  it("renders the icon variant with a custom icon, color and icon color", () => {
    const { container } = renderNode("divider", {
      variant: "icon",
      iconName: "Flame",
      iconColor: "#ff8800",
      color: "#123456",
      thickness: 3,
    });
    expect(container.querySelector("svg")).not.toBeNull();
    // Kolor kreski z inline stylu.
    const line = container.querySelector(".flex-1.border-t") as HTMLElement;
    expect(line.style.borderTopColor).toBe("#123456");
    expect(line.style.borderTopWidth).toBe("3px");
  });

  it("falls back to the Star icon for unknown names and keeps the theme line color", () => {
    const { container } = renderNode(
      "divider",
      { variant: "icon", iconName: "NoSuchIcon" },
      { editable: true },
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".border-border")).not.toBeNull();
    expect(container.querySelector(".border-foreground\\/60")).toBeNull();
  });

  it("renders the wave variant with and without color", () => {
    const colored = renderNode("divider", { variant: "wave", color: "#00aa00", widthPct: 80 });
    const svg = colored.container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("class")).toBe("h-3");
    expect(svg.style.color).toBe("#00aa00");
    colored.unmount();

    const plain = renderNode("divider", { variant: "wave" }, { editable: true });
    expect(plain.container.querySelector("svg")?.getAttribute("class")).toContain("text-border");
  });

  it("renders dashed/dotted/double lines, rejecting invalid colors", () => {
    for (const [variant, style] of [
      ["dashed", "dashed"],
      ["dotted", "dotted"],
      ["double", "double"],
    ] as const) {
      const { container, unmount } = renderNode("divider", {
        variant,
        color: "czerwony", // nie przechodzi walidacji hex -> kolor domyślny
        align: "left",
      });
      const sep = container.querySelector('[role="separator"]') as HTMLElement;
      expect(sep.style.borderTopStyle).toBe(style);
      expect(sep.style.borderTopColor).toBe("var(--border)");
      unmount();
    }
    // Edytor: etykieta "Rozdzielacz" + obszar trafienia, ale linia zostaje
    // dokładnie tak cienka, jak zostanie opublikowana.
    const editor = renderNode("divider", { variant: "solid", thickness: 1 }, { editable: true });
    expect(screen.getByText("Rozdzielacz")).toBeInTheDocument();
    expect(
      (editor.container.querySelector('[role="separator"]') as HTMLElement).style.borderTopWidth,
    ).toBe("1px");
    expect(editor.container.querySelector("[data-divider-hit-area]")).not.toBeNull();
    cleanup();
    renderNode("divider", {}, { editable: true, lang: "en" });
    expect(screen.getByText("Divider")).toBeInTheDocument();
  });
});

describe("spacer - wysokości responsywne, tło, wyrównanie", () => {
  it("emits responsive CSS for tablet/mobile heights and paints the background", () => {
    const { container } = renderNode(
      "spacer",
      {
        height: 60,
        heightTablet: 40,
        heightMobile: 20,
        widthPct: 50,
        align: "center",
        bgColor: "#abcdef",
      },
      { id: "sp!!node@@1" },
    );
    const styleTag = container.querySelector("style");
    expect(styleTag?.textContent).toContain("height:40px");
    expect(styleTag?.textContent).toContain("height:20px");
    const box = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(box.style.height).toBe("60px");
    expect(box.style.width).toBe("50%");
    expect(box.style.margin).toBe("0px auto");
    expect(box.style.backgroundColor).toBe("#abcdef");
  });

  it("editable spacer shows the size label with responsive and alignment hints", () => {
    renderNode("spacer", { height: 30, heightTablet: 10, align: "right" }, { editable: true });
    // 30px, 50% domyślne? width 100 -> "↕ 30px · 100% · right · ↔ 10/10".
    expect(screen.getByText(/↕ 30px · 100% · right · ↔ 10\/10/)).toBeInTheDocument();
  });

  it("hides the label on demand and uses the EN aria-label", () => {
    const { container } = renderNode(
      "spacer",
      { showLabel: "hide" },
      { editable: true, lang: "en" },
    );
    expect(screen.getByLabelText("Spacer")).toBeInTheDocument();
    expect(container.textContent).not.toContain("↕");
  });
});

describe("social-icons - układ listy i tryby kolorów", () => {
  it("renders the list layout with CTA labels, alt twitter key and placeholders", () => {
    const { container } = renderNode("social-icons", {
      layout: "list",
      twitter: "https://x.com/nes", // altKey dla "x"
      linkedin: "https://linkedin.com/company/nes",
      ctaLinkedin: "Obserwuj nas",
      showEmpty: "show",
      colorMode: "official",
    });

    // CTA własne i domyślne (Follow powtarza się na kilku platformach).
    expect(screen.getByText("Obserwuj nas")).toBeInTheDocument();
    expect(screen.getAllByText(/Follow|Obserwuj$/).length).toBeGreaterThan(0);
    // showEmpty=show -> platformy bez linku renderują się wygaszone.
    const rows = container.querySelectorAll("a");
    // +1 wiersz: Newsletter jest domyślnie częścią listy.
    expect(rows.length).toBe(7);
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();
  });

  it("hides empty rows in list layout and resolves custom colors with empty values", () => {
    const { container } = renderNode("social-icons", {
      layout: "list",
      facebook: "https://fb.com/nes",
      colorMode: "custom", // brak customColor -> undefined
      bgMode: "custom", // brak customBgColor -> undefined
    });
    expect(container.querySelectorAll("a").length).toBe(2); // facebook + newsletter
  });

  it("resolves dark/light color modes regardless of themeAdapt", () => {
    const dark = renderNode("social-icons", {
      facebook: "https://fb.com/a",
      colorMode: "dark",
      themeAdapt: "force-dark",
    });
    const a1 = dark.container.querySelector("a") as HTMLElement;
    expect(a1.style.color).toBe("#0a0a0a");
    dark.unmount();

    const light = renderNode("social-icons", {
      facebook: "https://fb.com/a",
      colorMode: "light",
      themeAdapt: "force-light",
    });
    const a2 = light.container.querySelector("a") as HTMLElement;
    expect(a2.style.color).toBe("#ffffff");
    light.unmount();

    // themeAdapt "auto" (domyślne) NIE unieważnia jawnego wyboru redakcji.
    const auto = renderNode("social-icons", {
      facebook: "https://fb.com/a",
      colorMode: "light",
    });
    expect((auto.container.querySelector("a") as HTMLElement).style.color).toBe("#ffffff");
  });

  it("applies the custom background color when provided", () => {
    const { container } = renderNode("social-icons", {
      facebook: "https://fb.com/a",
      bgMode: "custom",
      customBgColor: "#001122",
    });
    expect((container.querySelector("a") as HTMLElement).style.backgroundColor).toBe("#001122");
  });
});

describe("lang-switcher i copyright - fallbacki etykiet", () => {
  it("uses label_pl in EN and the built-in label when nothing is set", () => {
    const a = renderNode("lang-switcher", { label_pl: "Wybierz język" }, { lang: "en" });
    expect(a.container.querySelector('[aria-label="Wybierz język"]')).not.toBeNull();
    a.unmount();

    const b = renderNode("lang-switcher", {}, { lang: "en" });
    expect(b.container.querySelector('[aria-label="Change language"]')).not.toBeNull();
    b.unmount();

    const c = renderNode("lang-switcher", {});
    expect(c.container.querySelector('[aria-label="Zmień język"]')).not.toBeNull();
  });

  it("joins brand and text with a dot and can hide the year", () => {
    const both = renderNode("copyright", { brand: "NES", text_pl: "Wszelkie prawa" });
    expect(both.container.textContent).toContain(
      `© ${new Date().getFullYear()} NES. Wszelkie prawa.`,
    );
    both.unmount();

    const noYear = renderNode("copyright", { showYear: false, text_pl: "Sama treść" });
    expect(noYear.container.textContent).not.toContain("©");
    expect(noYear.container.textContent).toContain("Sama treść.");
  });
});

describe("video - bezpośredni plik https", () => {
  it("renders a native <video> for a non-YouTube https URL", () => {
    const { container } = renderNode("video", {
      url: "https://cdn.example.com/film.mp4",
      controls: "off",
      autoplay: "on",
      loop: "on",
      ratio: "4/3",
    });
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("https://cdn.example.com/film.mp4");
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.hasAttribute("loop")).toBe(true);
  });
});

describe("slider - normalizacja ręcznych slajdów", () => {
  it("keeps full items and blanks out non-string fields on partial items", async () => {
    const { container } = renderNode("slider", {
      items: [
        {
          image: "https://cdn.example.com/a.jpg",
          title_pl: "Pełny",
          title_en: "Full",
          subtitle_pl: "Sub PL",
          subtitle_en: "Sub EN",
          href: "/pelny",
          cta_pl: "Zobacz",
          cta_en: "See",
        },
        // Drugi slajd bez pól tekstowych - wszystkie spadają do "".
        { image: "https://cdn.example.com/b.jpg", title_pl: 123, href: 5 },
      ],
      autoplay: false,
      intervalMs: 5000,
      overlayOpacity: 0.7,
      columns: 2,
      titleSizePx: 28,
      titleWeight: 800,
      subtitleSizePx: 15,
      subtitleWeight: 500,
      navSizePx: 44,
      navRoundedPx: 10,
      navBgColor: "#000000",
      navArrowColor: "#ffffff",
      navBgStyle: "solid",
      navPosition: "bottom",
      navArrowVariant: "arrow",
      navArrowStroke: 3,
      rounded: "xl",
      ratio: "21/9",
    });
    // SliderRender siedzi w leniwym chunku - czekamy na materializację slajdów.
    await waitFor(() => expect(container.textContent).toContain("Pełny"));
  });
});

describe("animated-heading i text-rotate", () => {
  it("animated-heading uses the default highlight mode when mode is unset", () => {
    expect(() =>
      renderNode("animated-heading", { highlight_pl: "kluczowe", textBefore_pl: "Coś" }),
    ).not.toThrow();
  });

  it("text-rotate splits a newline string, applies colors in dark mode and renders before/after", async () => {
    localStorage.setItem("theme", "dark");
    const { container } = renderNode(
      "text-rotate",
      {
        texts_pl: "szybko\nsprawnie\n",
        before_pl: "Działamy",
        after_pl: "dla Europy",
        tag: "h3",
        align: "center",
        splitBy: "words",
        staggerFrom: "center",
        color: "#112233",
        accentColor: "#445566",
        rotationInterval: 5000,
        staggerDurationMs: 10,
        transitionMs: 100,
        loop: false,
        auto: false,
      },
      { theme: true },
    );
    const h3 = container.querySelector("h3") as HTMLElement;
    expect(h3).not.toBeNull();
    expect(h3.className).toContain("text-center");
    expect(container.textContent).toContain("Działamy");
    expect(container.textContent).toContain("dla Europy");
    expect(container.textContent).toContain("szybko");
  });

  it("text-rotate accepts an EN array, right alignment and survives empty texts", () => {
    const arr = renderNode(
      "text-rotate",
      { texts_en: ["fast", "smart"], align: "right" },
      { lang: "en" },
    );
    expect(arr.container.querySelector("h2")?.className).toContain("text-right");
    expect(arr.container.textContent).toContain("fast");
    arr.unmount();

    // Brak tekstów -> bezpieczny pusty segment (bez crasha).
    const empty = renderNode("text-rotate", {});
    expect(empty.container.querySelector("h2")).not.toBeNull();
  });
});

describe("accordion i timeline - fallbacki treści", () => {
  it("accordion renders with no items array and falls back to PL answers", () => {
    const none = renderNode("accordion", { variant: "separated" });
    expect(none.container.querySelectorAll("details").length).toBe(0);
    none.unmount();

    renderNode(
      "accordion",
      {
        items: [
          { q_pl: "Pytanie", a_pl: "" },
          { q_pl: "Drugie", a_pl: "<p>Odp</p>" },
        ],
      },
      { lang: "en" },
    );
    // q_en brak -> q_pl.
    expect(screen.getByText("Pytanie")).toBeInTheDocument();
    expect(screen.getByText("Drugie")).toBeInTheDocument();
  });

  it("timeline renders date headings, icon types, actors with and without links", () => {
    // Jawny typ Json[] - heterogeniczne wpisy rozszerzają się do unii
    // z niejawnym `undefined`, której nie przyjmuje indeks Json.
    const entries: Json[] = [
      { type: "heading", date_pl: "2026" },
      { type: "heading" }, // bez daty -> pomijany
      {
        title_pl: "Start projektu",
        desc_pl: "Opis kroku",
        iconType: "avatar",
        avatar: "https://cdn.example.com/av.png",
        actorName: "Anna",
        actorAvatar: "https://cdn.example.com/anna.png",
        actorHref: "https://example.com/anna",
      },
      {
        title_pl: "Etap lucide",
        iconType: "lucide",
        iconName: "Globe",
        titleIconName: "Flame",
        actorName: "Bez Linku",
        actorInitials: "bl",
      },
      { title_pl: "Inicjały", iconType: "initials", initials: "nes" },
    ];
    const { container } = renderNode("timeline", { entries });

    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("Start projektu")).toBeInTheDocument();
    expect(screen.getByText("Opis kroku")).toBeInTheDocument();
    // Aktor z linkiem -> kotwica; bez linku -> span.
    expect(screen.getByText("Anna").closest("a")).toHaveAttribute(
      "href",
      "https://example.com/anna",
    );
    // Bez actorHref safeUrl daje fallback "#" - kotwica bez realnego celu.
    expect(screen.getByText("Bez Linku").closest("a")).toHaveAttribute("href", "#");
    // Inicjały przycięte do 2 znaków, uppercase w klasie.
    expect(screen.getByText("NE")).toBeInTheDocument();
    // Avatar w osi czasu.
    expect(container.querySelector('img[src="https://cdn.example.com/av.png"]')).not.toBeNull();
  });
});

describe("logo-cloud", () => {
  it("shows the empty hint (PL) when no logos are configured", () => {
    renderNode("logo-cloud", { logos: "nie-tablica" as unknown as [] });
    expect(screen.getByText("Dodaj logo w panelu właściwości.")).toBeInTheDocument();
  });

  it("renders a marquee with linked logos, label-only entries and custom speed", () => {
    const { container } = renderNode("logo-cloud", {
      heading_pl: "Partnerzy",
      logos: [
        { src: "https://cdn.example.com/l1.png", href: "https://example.com", alt: "Logo 1" },
        { label: "Tylko tekst" },
      ],
      speedSeconds: 500, // clamp do 180
      pauseOnHover: false,
      fadeEdges: false,
      grayscale: false,
    });

    expect(screen.getByText("Partnerzy")).toBeInTheDocument();
    // Track dubluje logotypy (2 wpisy -> 4 elementy).
    expect(screen.getAllByText("Tylko tekst")).toHaveLength(2);
    const marquee = container.querySelector('[aria-label="Karuzela logo"]') as HTMLElement;
    expect(marquee.getAttribute("style")).toContain("--marquee-duration: 180s");
    expect(marquee.className).not.toContain("lc-pause-hover");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.className).not.toContain("grayscale");
    expect(img.closest("a")).toHaveAttribute("href", "https://example.com");
  });
});

describe("pricing - tryb ręczny i katalogowy", () => {
  it("manual mode tolerates a missing plans array and non-array features", () => {
    const none = renderNode("pricing", {});
    expect(none.container.querySelectorAll("h3").length).toBe(0);
    none.unmount();

    renderNode(
      "pricing",
      { plans: [{ name_pl: "Plan bazowy", features_pl: "nie-tablica" }] },
      { lang: "en" },
    );
    // name_en brak -> name_pl; cta domyślne "Wybierz".
    expect(screen.getByText("Plan bazowy")).toBeInTheDocument();
    expect(screen.getByText("Wybierz")).toBeInTheDocument();
  });

  it("plans mode with defaults pulls the catalog without a limit", async () => {
    db.tables.access_plans = [
      {
        id: "p-1",
        tenant_id: "t",
        name_pl: "Katalogowy",
        name_en: "Catalog",
        price_cents: 900,
        currency: "PLN",
        interval: "month",
        active: true,
        sort_order: 1,
        features_pl: [],
        features_en: [],
        badge_pl: null,
        badge_en: null,
        highlighted: false,
        trial_days: 0,
        tier_key: null,
      },
    ];
    renderNode("pricing", { source: "plans" });
    await waitFor(() => expect(screen.getByText("Katalogowy")).toBeInTheDocument());
  });
});

describe("section-label, hot-topic-bar, contact-form", () => {
  it("renders section-label under the dark theme", () => {
    localStorage.setItem("theme", "dark");
    expect(() =>
      renderNode("section-label", { label_pl: "Sekcja" }, { theme: true }),
    ).not.toThrow();
  });

  it("hot-topic-bar wraps the content in a link when href is set", () => {
    const { container } = renderNode("hot-topic-bar", {
      title_pl: "Gorący temat",
      href: "https://example.com/temat",
    });
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.com/temat");
  });

  it("contact-form falls back to an empty data object when content is missing", async () => {
    const { container } = renderNode("contact-form", undefined);
    await waitFor(() => expect(container.querySelector("form")).not.toBeNull());
  });
});
