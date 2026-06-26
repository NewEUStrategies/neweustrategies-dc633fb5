// Exhaustive branch coverage for renderSimpleWidget cases that the smoke test
// only touches with defaults: every styling permutation, plus the interactive
// chrome widgets (search box, language dropdown, theme toggle) driven by events.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode, WidgetType, WidgetContent, Device } from "@/lib/builder/types";

const search = vi.hoisted(() => ({ rows: [] as unknown[] }));
const changeLanguage = vi.hoisted(() => vi.fn());

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
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "posts" ? search.rows : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl", changeLanguage },
  }),
}));

// Auth form blocks render TanStack <Link>, which requires a RouterProvider.
// Render it as a plain anchor (AppLink's useRouter degrades gracefully already).
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
  opts: { lang?: "pl" | "en"; device?: Device; editable?: boolean; theme?: "light" | "dark" } = {},
) {
  const node: WidgetNode = { id: `w-${nextId++}`, kind: "widget", type, content };
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  search.rows = [];
});

describe("social-icons (color/bg/shape permutations)", () => {
  const colorModes = ["inherit", "official", "custom", "brand", "dark", "light"];
  const bgModes = ["none", "subtle", "brand", "official", "contrast", "custom"];
  it("renders across colorMode x bgMode x shape", () => {
    for (const colorMode of colorModes) {
      for (const bgMode of bgModes) {
        const { container } = renderNode("social-icons", {
          facebook: "https://facebook.com/x",
          x: "https://x.com/y",
          youtube: "https://youtube.com/z",
          instagram: "https://instagram.com/i",
          linkedin: "https://linkedin.com/l",
          email: "a@b.co",
          colorMode,
          bgMode,
          customColor: "#123456",
          customBgColor: "#654321",
          shape: "full",
          themeAdapt: "force-dark",
          size: 18,
          gap: 6,
          showEmpty: "show",
        });
        expect(container.querySelector("svg")).toBeTruthy();
      }
    }
  });

  it("falls back to the twitter alt key and hides empty by default", () => {
    renderNode("social-icons", { twitter: "https://twitter.com/legacy" });
    expect(screen.getByLabelText("X").getAttribute("href")).toContain("twitter.com");
    expect(screen.queryByLabelText("Facebook")).toBeNull();
  });

  it("renders shape + theme variants", () => {
    for (const shape of ["none", "sm", "md", "lg", "full", "square"]) {
      expect(() =>
        renderNode("social-icons", { facebook: "https://facebook.com/x", shape }),
      ).not.toThrow();
    }
    for (const themeAdapt of ["auto", "force-light", "force-dark"]) {
      expect(() =>
        renderNode("social-icons", { email: "a@b.co", themeAdapt, colorMode: "dark" }),
      ).not.toThrow();
    }
  });
});

describe("icon / video / gallery / map", () => {
  it("renders icon wrapper + spin variants", () => {
    for (const variant of ["plain", "circle", "square", "soft", "outlined"]) {
      for (const spin of ["none", "spin", "pulse", "bounce"]) {
        const { container } = renderNode("icon", { name: "Flame", size: 28, variant, spin });
        expect(container.querySelector("svg")).toBeTruthy();
      }
    }
    // Unknown icon name falls back to Star.
    expect(() => renderNode("icon", { name: "NotARealIcon" })).not.toThrow();
  });

  it("renders video for youtube / youtu.be / direct / disallowed / empty", () => {
    expect(
      renderNode("video", {
        url: "https://www.youtube.com/watch?v=abc",
        autoplay: "on",
        loop: "on",
        controls: "off",
      }).container.querySelector("iframe"),
    ).toBeTruthy();
    expect(
      renderNode("video", { url: "https://youtu.be/xyz123" }).container.querySelector("iframe"),
    ).toBeTruthy();
    expect(
      renderNode("video", { url: "https://cdn.example.com/v.mp4" }).container.querySelector(
        "video",
      ),
    ).toBeTruthy();
    expect(renderNode("video", { url: "ftp://bad/clip" }).container.textContent).toContain(
      "niedozwolony",
    );
    expect(renderNode("video", { url: "" }).container.textContent).toContain("brak wideo");
  });

  it("renders gallery variants and empty state", () => {
    for (const variant of ["grid", "carousel", "masonry", "polaroid"]) {
      for (const gap of ["none", "xs", "sm", "md", "lg"]) {
        const { container } = renderNode("gallery", {
          images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
          columns: 3,
          variant,
          gap,
        });
        expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
      }
    }
    expect(renderNode("gallery", { images: [] }).container.textContent).toContain("brak zdjęć");
  });

  it("renders a google map iframe", () => {
    const { container } = renderNode("map", { query: "Kraków", ratio: "4/3" });
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("maps.google");
  });
});

describe("image widget", () => {
  it("renders variants, ratio, alignment, caption and links", () => {
    for (const variant of [
      "default",
      "rounded",
      "circle",
      "polaroid",
      "shadow",
      "frame",
      "zoom-hover",
    ]) {
      const { container } = renderNode("image", {
        src: "https://cdn.example.com/i.png",
        alt_pl: "Opis",
        variant,
        caption_pl: "Podpis",
        align: "left",
      });
      expect(container.querySelector("img")).toBeTruthy();
    }
  });

  it("renders light+dark sources, ratio frame and an external link", () => {
    const { container } = renderNode(
      "image",
      {
        src: "https://cdn.example.com/l.png",
        srcDark: "https://cdn.example.com/d.png",
        alt_pl: "Logo",
        ratio: "1/1",
        href: "https://external.example.com",
        objectFit: "contain",
        align: "right",
      },
      { theme: "dark" },
    );
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
  });

  it("shows a placeholder with no source and renders the resize handle when editable", () => {
    expect(renderNode("image", { src: "" }).container.textContent).toContain("brak obrazka");
    const { container } = renderNode(
      "image",
      { src: "https://cdn.example.com/i.png", widthPx: 200 },
      { editable: true },
    );
    expect(container.querySelector('[role="slider"]')).toBeTruthy();
  });
});

describe("contact / accordion / testimonial / pricing variants", () => {
  it("renders contact stacked / compact / card", () => {
    for (const variant of ["stacked", "compact", "card"]) {
      const { container } = renderNode("contact", { variant });
      expect(container.querySelector("form")).toBeTruthy();
    }
  });

  it("renders accordion variants", () => {
    for (const variant of ["bordered", "separated", "minimal"]) {
      const { container } = renderNode("accordion", {
        variant,
        items: [{ q_pl: "P", a_pl: "<b>A</b>" }],
      });
      expect(container.querySelector("details")).toBeTruthy();
    }
  });

  it("renders testimonial variants with rating + avatar", () => {
    for (const variant of ["card", "minimal", "quote", "centered"]) {
      const { container } = renderNode("testimonial", {
        quote_pl: "Cytat",
        author: "Ola",
        role_pl: "CTO",
        variant,
        rating: 4,
        avatar: "https://cdn.example.com/a.png",
      });
      expect(container.textContent).toContain("Cytat");
      expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("renders pricing featured + non-featured plans", () => {
    const { container } = renderNode("pricing", {
      plans: [
        {
          name_pl: "Free",
          price: "0",
          currency: "PLN",
          period_pl: "/mc",
          features_pl: ["A", "B"],
          cta_pl: "Start",
          href: "/f",
          featured: false,
        },
        {
          name_pl: "Pro",
          price: "49",
          currency: "PLN",
          features_pl: ["C"],
          href: "javascript:bad",
          featured: true,
        },
      ],
    });
    expect(container.textContent).toContain("Free");
    expect(container.textContent).toContain("Pro");
  });
});

describe("navigation chrome widgets", () => {
  it("renders account-link, copyright (combos), search-form, contact-form", () => {
    expect(
      renderNode("account-link", { signin_pl: "Wejdź", signup_pl: "Konto" }).container.textContent,
    ).toContain("Wejdź");
    expect(
      renderNode("copyright", { showYear: false, brand: "NES", text_pl: "prawa" }).container
        .textContent,
    ).toContain("NES");
    expect(
      renderNode("copyright", { showYear: true, brand: "", text_pl: "" }).container.textContent,
    ).toContain("©");
    expect(
      renderNode("search-form", { action: "/szukaj" }).container.querySelector("form"),
    ).toBeTruthy();
    expect(renderNode("contact-form", {}).container).toBeTruthy();
  });

  it("renders the auth form widgets", () => {
    for (const type of ["login-form", "register-form", "lost-password-form"] as const) {
      expect(() => renderNode(type, { variant: "card" })).not.toThrow();
    }
  });
});

describe("theme toggle + language switcher (interactive)", () => {
  it("toggles theme on click", () => {
    const { container } = renderNode("theme-toggle", {});
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
  });

  it("opens the language dropdown and selects an option", () => {
    renderNode("lang-switcher", { label_pl: "Język" });
    const trigger = screen.getByRole("button", { name: "Język" });
    fireEvent.click(trigger);
    const en = screen.getByRole("option", { name: /EN/ });
    fireEvent.click(en);
    expect(changeLanguage).toHaveBeenCalledWith("en");
  });
});

describe("search button widget (live search)", () => {
  it("debounces a query, shows results, then clears", async () => {
    search.rows = [{ id: "1", slug: "alpha", title_pl: "Alfa wynik", excerpt_pl: "opis" }];
    renderNode("search-button", { label_pl: "Szukaj", liveResults: "on", limit: 8 });
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "al" } });
    expect(await screen.findByText("Alfa wynik")).toBeTruthy();
    const clear = screen.getByRole("button", { name: /Wyczyść/ });
    fireEvent.click(clear);
    expect(screen.queryByText("Alfa wynik")).toBeNull();
  });

  it("shows an empty state and supports Enter to search", async () => {
    search.rows = [];
    renderNode("search-button", { label_pl: "Find", liveResults: "off", limit: 5 }, { lang: "en" });
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/No results/)).toBeTruthy();
  });
});
