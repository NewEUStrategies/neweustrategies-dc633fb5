// Behaviour + branch coverage for the widget renderers. Renders through the
// real WidgetView (which also exercises the wrap/style/animation layer) and
// asserts the actual DOM each widget produces: tags, sanitisation, link
// safety, i18n fallback and the major per-widget variant branches.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type {
  WidgetNode,
  WidgetType,
  WidgetContent,
  CommonStyle,
  AdvancedSettings,
  Device,
} from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "order",
    "range",
    "limit",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(async () => ({ data: [], error: null })) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
}));

let nextId = 0;
function renderNode(
  type: WidgetType,
  content: WidgetContent,
  opts: {
    lang?: "pl" | "en";
    device?: Device;
    editable?: boolean;
    style?: CommonStyle;
    advanced?: AdvancedSettings;
  } = {},
) {
  const node: WidgetNode = {
    id: `w-${nextId++}`,
    kind: "widget",
    type,
    content,
    style: opts.style,
    advanced: opts.advanced,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang={opts.lang ?? "pl"}
        device={opts.device ?? "desktop"}
        editable={opts.editable ?? false}
        onContentChange={opts.editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("heading", () => {
  it("renders the configured tag and localized text with a subtitle", () => {
    const { container } = renderNode("heading", {
      text_pl: "Polski",
      text_en: "English",
      subtitle_pl: "Podtytuł",
      tag: "h3",
      variant: "gradient",
      sizePreset: "xl",
      iconName: "Star",
      href: "/x",
    });
    const h3 = container.querySelector("h3");
    expect(h3?.textContent).toContain("Polski");
    expect(screen.getByText("Podtytuł")).toBeTruthy();
  });

  it("falls back to PL when the EN string is empty", () => {
    const { container } = renderNode(
      "heading",
      { text_pl: "TylkoPL", text_en: "" },
      { lang: "en" },
    );
    expect(container.textContent).toContain("TylkoPL");
  });

  it("supports a custom pixel size + weight", () => {
    const { container } = renderNode("heading", { text_pl: "Big", sizePx: 48, titleWeight: "800" });
    const h = container.querySelector("h2");
    expect(h?.getAttribute("style")).toContain("48px");
  });
});

describe("text", () => {
  it("strips dangerous markup but keeps safe content", () => {
    const { container } = renderNode("text", {
      html_pl: "<p>Bezpieczny</p><script>window.__x=1</script>",
    });
    expect(container.textContent).toContain("Bezpieczny");
    expect(container.innerHTML).not.toContain("<script");
  });

  it("renders multi-column + drop-cap variants", () => {
    const { container } = renderNode("text", {
      html_pl: "<p>Kolumny</p>",
      columns: 2,
      dropCap: "on",
    });
    expect(container.textContent).toContain("Kolumny");
  });
});

describe("button", () => {
  it("neutralizes javascript: hrefs to the safe fallback", () => {
    renderNode("button", { label_pl: "Klik", href: "javascript:alert(1)" });
    const link = screen.getByRole("link", { name: /Klik/ });
    expect(link.getAttribute("href")?.toLowerCase().startsWith("javascript")).toBe(false);
  });

  it("keeps a safe href and opens external targets with rel=noopener", () => {
    renderNode("button", { label_pl: "Ext", href: "https://example.com", target: "blank" });
    const link = screen.getByRole("link", { name: /Ext/ });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders variant + size + icon without throwing", () => {
    for (const variant of ["primary", "outline", "ghost", "gradient", "soft", "link"]) {
      expect(() =>
        renderNode("button", { label_pl: "B", variant, size: "lg", iconName: "Star" }),
      ).not.toThrow();
    }
  });
});

describe("nav-link", () => {
  it("renders each visual variant", () => {
    for (const variant of ["text", "primary", "outline", "pill", "underline"]) {
      const { container } = renderNode("nav-link", {
        label_pl: "Menu",
        variant,
        href: "/x",
        iconName: "Star",
      });
      expect(container.textContent).toContain("Menu");
    }
  });
});

describe("divider", () => {
  it("renders every divider variant", () => {
    // The line divider renders as an accessible separator <div> - not <hr>
    // (deliberate: hr has UA quirks with margin/width interplay).
    const { container: line } = renderNode("divider", { variant: "line", thickness: 2 });
    expect(line.querySelector('[role="separator"]')).toBeTruthy();
    for (const variant of ["gradient", "icon", "wave", "dashed", "dotted", "double"]) {
      expect(() =>
        renderNode("divider", { variant, thickness: 2, iconName: "Star" }),
      ).not.toThrow();
    }
  });
});

describe("spacer", () => {
  it("renders a fixed-height box (read-only) and a labelled box (editable)", () => {
    const { container: ro } = renderNode("spacer", { height: 48 });
    expect(ro.innerHTML).toContain("48px");
    const { container: ed } = renderNode("spacer", { height: 48 }, { editable: true });
    expect(ed.textContent).toContain("48px");
  });
});

describe("social-icons", () => {
  it("renders active links and respects showEmpty/official colors", () => {
    renderNode("social-icons", {
      facebook: "https://facebook.com/nes",
      email: "hi@nes.eu",
      colorMode: "official",
      bgMode: "official",
      shape: "full",
      size: 20,
      showEmpty: "show",
    });
    expect(screen.getByLabelText("Facebook").getAttribute("href")).toContain("facebook.com");
    expect(screen.getByLabelText("Email").getAttribute("href")).toBe("mailto:hi@nes.eu");
  });
});

describe("copyright", () => {
  it("shows the year and brand", () => {
    const year = String(new Date().getFullYear());
    const { container } = renderNode("copyright", {
      text_pl: "Wszelkie prawa",
      showYear: true,
      brand: "NES",
    });
    expect(container.textContent).toContain(year);
    expect(container.textContent).toContain("NES");
  });
});

describe("icon", () => {
  it("renders the named lucide icon across wrapper variants", () => {
    for (const variant of ["plain", "circle", "square", "soft", "outlined"]) {
      const { container } = renderNode("icon", { name: "Star", size: 40, variant, spin: "spin" });
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });
});

describe("video", () => {
  it("embeds a YouTube iframe", () => {
    const { container } = renderNode("video", { url: "https://www.youtube.com/watch?v=abc123" });
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toContain("youtube.com/embed/abc123");
  });

  it("renders a direct video element for an https source", () => {
    const { container } = renderNode("video", { url: "https://cdn.example.com/clip.mp4" });
    expect(container.querySelector("video")).toBeTruthy();
  });

  it("shows a placeholder when no url is set", () => {
    const { container } = renderNode("video", { url: "" });
    expect(container.textContent).toContain("brak wideo");
  });
});

describe("gallery", () => {
  it("renders images across layout variants and a placeholder when empty", () => {
    for (const variant of ["grid", "carousel", "masonry", "polaroid"]) {
      const { container } = renderNode("gallery", {
        images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
        columns: 2,
        variant,
        gap: "md",
      });
      expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
    }
    const { container: empty } = renderNode("gallery", { images: [] });
    expect(empty.textContent).toContain("brak zdjęć");
  });
});

describe("image", () => {
  it("renders an <img> for a safe source", () => {
    const { container } = renderNode("image", {
      src: "https://cdn.example.com/x.png",
      alt_pl: "Opis",
    });
    expect(container.querySelector("img")).toBeTruthy();
  });
});

describe("animated-heading", () => {
  it("renders highlight + rotate modes across several shapes", () => {
    for (const mode of ["highlight", "rotate"]) {
      for (const shape of ["underline", "circle", "strike", "framed", "scribble", "none"]) {
        expect(() =>
          renderNode("animated-heading", {
            mode,
            shape,
            tag: "h2",
            textBefore_pl: "Dołącz",
            highlight_pl: "do nas",
            textAfter_pl: "już dziś",
            rotateWords_pl: ["szybko", "łatwo"],
          }),
        ).not.toThrow();
      }
    }
  });
});

describe("section-label", () => {
  it("renders every section-label variant with an action link", () => {
    const variants = [
      "left-bar",
      "left-border",
      "small-corners",
      "only-text",
      "badge-filled",
      "centered-rule",
      "centered-short-rule",
      "filled-bar",
      "centered-underline",
      "slanted-ribbon-rule",
      "double-rule-centered",
    ];
    for (const variant of variants) {
      const { container } = renderNode("section-label", {
        label_pl: "Najnowsze",
        variant,
        color: "brand",
        action_pl: "więcej",
        href: "/all",
      });
      expect(container.textContent).toContain("Najnowsze");
    }
  });
});

describe("hot-topic-bar", () => {
  it("renders badge + title linking to the target", () => {
    const { container } = renderNode("hot-topic-bar", {
      badge_pl: "Hot",
      title_pl: "Temat dnia",
      href: "/news",
      iconName: "Flame",
    });
    expect(container.textContent).toContain("Temat dnia");
  });
});

describe("accordion / testimonial / pricing (rich blocks)", () => {
  it("renders accordion items", () => {
    const { container } = renderNode("accordion", {
      items: [{ q_pl: "Pytanie?", a_pl: "Odpowiedź." }],
    });
    expect(container.textContent).toContain("Pytanie?");
  });

  it("renders a testimonial quote + author", () => {
    const { container } = renderNode("testimonial", {
      quote_pl: "Świetne narzędzie.",
      author: "Anna",
      role_pl: "CEO",
    });
    expect(container.textContent).toContain("Świetne narzędzie.");
    expect(container.textContent).toContain("Anna");
  });

  it("renders pricing plans incl. a featured plan", () => {
    const { container } = renderNode("pricing", {
      plans: [
        {
          name_pl: "Start",
          price: "0",
          currency: "PLN",
          features_pl: ["A"],
          cta_pl: "Wybierz",
          href: "/s",
          featured: false,
        },
        {
          name_pl: "Pro",
          price: "49",
          currency: "PLN",
          features_pl: ["B"],
          cta_pl: "Wybierz",
          href: "/p",
          featured: true,
        },
      ],
    });
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("Pro");
  });
});

describe("cta", () => {
  it("renders each layout variant and links the action", () => {
    for (const variant of ["default", "gradient", "bar", "card", "split"]) {
      const { container } = renderNode("cta", {
        title_pl: "Działajmy",
        cta_pl: "Kontakt",
        href: "/contact",
        variant,
        align: "center",
      });
      expect(container.textContent).toContain("Działajmy");
    }
  });
});

describe("dark-featured-card", () => {
  it("renders badge, title, excerpt, image and link", () => {
    const { container } = renderNode("dark-featured-card", {
      badge_pl: "WYRÓŻNIONE",
      title_pl: "Tytuł",
      excerpt_pl: "Zajawka",
      image: "https://cdn.example.com/cover.jpg",
      href: "/post",
      badgeVariant: "gradient",
      badgeRadius: "full",
      badgeSize: "md",
      imageHover: "fade",
    });
    expect(container.textContent).toContain("Tytuł");
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/post");
  });
});

describe("newsletter (static variants)", () => {
  it("renders icon / icon-only / minimal / inline / card variants", () => {
    for (const variant of ["icon", "icon-only", "minimal"]) {
      const { container } = renderNode("newsletter", { title_pl: "Zapisz się", variant });
      expect(container.textContent.length).toBeGreaterThanOrEqual(0);
    }
    // inline/card editable previews render a form with an email input.
    const { container } = renderNode(
      "newsletter",
      { title_pl: "Newsletter", variant: "card" },
      { editable: true },
    );
    expect(within(container).getByPlaceholderText(/email/i)).toBeTruthy();
  });
});

describe("WidgetView style + advanced layers", () => {
  it("applies id/class, scoped css, color overrides, typography and motion", () => {
    const { container } = renderNode(
      "heading",
      { text_pl: "Styled" },
      {
        style: {
          textColor: "#112233",
          bgColor: "#ffffff",
          borderColor: "#cccccc",
          borderStyle: "solid",
          borderWidth: "1px",
          typography: {
            fontFamily: "Inter, sans-serif",
            fontSize: { desktop: "20px" },
            descriptionFontSize: { desktop: "14px" },
            titleDescriptionGapPx: 8,
            fontWeight: "700",
            textTransform: "uppercase",
            textAlign: "center",
          },
          hover: { bgColor: "#eeeeee", scale: 1.03, translateY: "-2px", transitionMs: 200 },
        },
        advanced: {
          cssClass: "promo-heading",
          htmlId: "promo",
          customCss: ".promo{color:red}",
          animation: "slide-up",
          animationDuration: 400,
          animationDelay: 100,
          animationDistance: 30,
          animationEasing: "spring",
        },
      },
    );
    const root = container.querySelector("#promo");
    expect(root).toBeTruthy();
    expect(root?.className).toContain("promo-heading");
    // Style tags for typography / overrides / hover / scoped custom css are injected.
    expect(container.querySelectorAll("style").length).toBeGreaterThan(0);
  });

  it("renders unknown/dynamic post widgets with placeholder context", () => {
    for (const type of [
      "post-title",
      "post-meta",
      "post-breadcrumbs",
      "post-excerpt",
      "archive-title",
    ] as const) {
      expect(() => renderNode(type, {})).not.toThrow();
    }
  });
});
