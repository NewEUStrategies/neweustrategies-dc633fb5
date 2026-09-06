// Final branch sweep: the i18n "_en || _pl || default" fallbacks (rendered in
// EN with only PL fields, and with no optional fields at all), plus the last
// per-widget toggle permutations not hit elsewhere.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { RatedListView } from "../RatedListView";
import { globalWidgetKey } from "@/lib/builder/globalWidgets";
import type {
  WidgetNode,
  WidgetType,
  WidgetContent,
  CommonStyle,
  AdvancedSettings,
  Device,
} from "@/lib/builder/types";

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "en" },
  }),
  // lib/i18n.ts (reached via the widget import graph) calls
  // `i18n.use(initReactI18next)` at module import - a full-module mock must
  // export a functional 3rd-party plugin stub or importing the suite throws.
  initReactI18next: { type: "3rdParty", init: () => {} },
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
    id: `s-${nextId++}`,
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
        lang={opts.lang ?? "en"}
        device={opts.device ?? "desktop"}
        editable={opts.editable}
        onContentChange={opts.editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}
function wrapRated(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(cleanup);

describe("EN i18n fallbacks (only PL fields set) + defaults", () => {
  it("falls back to PL across text widgets and uses built-in defaults when empty", () => {
    // PL-only fields, rendered in EN -> exercises the `_en || _pl` right side.
    renderNode("heading", { text_pl: "PLh", subtitle_pl: "PLs" });
    renderNode("text", { html_pl: "<p>PLtext</p>" });
    renderNode("button", { label_pl: "PLb", href: "/x" });
    renderNode("nav-link", { label_pl: "PLn" });
    renderNode("cta", { title_pl: "PLc", subtitle_pl: "PLsub", cta_pl: "PLcta" });
    renderNode("dark-featured-card", { badge_pl: "PLbadge", title_pl: "PLt", excerpt_pl: "PLe" });
    renderNode("hot-topic-bar", { badge_pl: "PLhot", title_pl: "PLtitle" });
    renderNode("testimonial", { quote_pl: "PLq", role_pl: "PLrole", author: "A" });
    renderNode("accordion", { items: [{ q_pl: "PLq", a_pl: "PLa" }] });
    renderNode("pricing", {
      plans: [
        {
          name_pl: "PLname",
          price: "0",
          period_pl: "/m",
          features_pl: ["x"],
          cta_pl: "PLcta",
          href: "/p",
        },
      ],
    });
    renderNode("account-link", { signin_pl: "PLin", signup_pl: "PLup" });
    renderNode("copyright", { text_pl: "PLrights", brand: "B" });
    renderNode("tts", { label_pl: "PLtts" });
    renderNode("section-label", { label_pl: "PLlabel", action_pl: "PLact", href: "/x" });
    renderNode("tabs", { tabs: [{ label_pl: "PLtab", html_pl: "<p>x</p>" }] });
    // Defaults: empty content -> the literal fallback strings.
    expect(renderNode("newsletter", { variant: "icon" }).container).toBeTruthy();
    expect(renderNode("hot-topic-bar", {}).container.textContent).toContain("Hot topic");
    expect(renderNode("section-label", {}).container.textContent).toContain("Sekcja");
  });
});

describe("social-icons active/inactive/background permutations", () => {
  it("renders all-inactive placeholders when showEmpty is set and no links exist", () => {
    const { container } = renderNode("social-icons", {
      showEmpty: "show",
      colorMode: "official",
      bgMode: "official",
    });
    // Inactive icons render as spans (no href) with reduced opacity.
    expect(container.querySelectorAll("span[aria-label]").length).toBeGreaterThan(0);
  });

  it("renders active links without backgrounds (bgMode none)", () => {
    renderNode("social-icons", {
      facebook: "https://facebook.com/x",
      bgMode: "none",
      colorMode: "custom",
      customColor: "#abc",
    });
    expect(screen.getByLabelText("Facebook")).toBeTruthy();
  });

  it("renders a social link on an official-color background (contrast text)", () => {
    // Widget nie obsluguje juz pozycji e-mail - zostaly wylacznie profile
    // social, wiec kontrast tla sprawdzamy na LinkedIn.
    renderNode("social-icons", {
      linkedin: "https://linkedin.com/in/x",
      bgMode: "official",
      colorMode: "official",
    });
    expect(screen.getByLabelText("LinkedIn").getAttribute("href")).toBe(
      "https://linkedin.com/in/x",
    );
  });
});

describe("WidgetView typography + motion branch combos", () => {
  it("applies title-only font size with a description gap", () => {
    const { container } = renderNode(
      "heading",
      { text_pl: "T" },
      {
        style: {
          typography: {
            fontSize: { desktop: "22px" },
            descriptionFontSize: { desktop: "13px" },
            titleDescriptionGapPx: 12,
            fontFamily: "Inter",
          },
        },
      },
    );
    expect(container.querySelectorAll("style").length).toBeGreaterThan(0);
  });

  it("applies font size alone (no description size) and replays animation each view", () => {
    const sized = renderNode(
      "heading",
      { text_pl: "T" },
      { style: { typography: { fontSize: { desktop: "22px" } } } },
    );
    // Title size materializes as a scoped <style> rule with the configured px.
    const sizedCss = [...sized.container.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(sizedCss).toContain("22px");
    const animated = renderNode(
      "heading",
      { text_pl: "T" },
      {
        advanced: {
          animation: "zoom",
          animationOnce: false,
          animationEasing: "bounce",
          animationDuration: 300,
        },
      },
    );
    // The motion wrapper drives the reveal via an inline transition with the
    // configured duration.
    const wrapper = animated.container.querySelector("[data-w-id]");
    expect(wrapper?.getAttribute("style") ?? "").toContain("300ms");
  });
});

describe("RatedListView remaining toggles", () => {
  const items = [
    {
      title_pl: "RA",
      title_en: "",
      excerpt_pl: "ex",
      author: "Au",
      rating: 7,
      category_pl: "Kat",
      date: "2026-01-01",
      format: "video",
    },
  ];

  it("renders number position 'top', between-borders, rating, author/date and category", () => {
    const { container } = wrapRated(
      <RatedListView
        c={{
          source: "manual",
          items,
          numberPosition: "top",
          gridBorders: "between",
          gridBorderWidthPx: 1,
          showAuthor: true,
          showDate: true,
          showRating: true,
          showCategory: true,
          categoryUppercase: false,
          itemPaddingPx: 8,
        }}
        lang="en"
      />,
    );
    expect(container.textContent).toContain("RA");
    expect(container.textContent).toContain("out of 10");
  });

  it("renders between-borders in a grid and exposes a working load-more button", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ title_pl: `T${i}`, rating: 0 }));
    const { container } = wrapRated(
      <RatedListView
        c={{
          source: "manual",
          items: many,
          columnsDesktop: 2,
          gridBorders: "between",
          scrollingMode: "loadmore",
          pageSize: 2,
        }}
        lang="pl"
      />,
    );
    const more = container.querySelector("button");
    expect(more).toBeTruthy();
    fireEvent.click(more!);
    expect(container.textContent).toContain("T3");
  });
});

// ── POWŁOKA WIDGETU: WYRÓWNANIE, WEWNĘTRZNA KOLUMNA, RUCH ────────────────────
// `wrap()` w `WidgetView` niesie największy pojedynczy kłąb gałęzi tej warstwy
// i prawie żadna z nich nie zależy od TYPU widgetu - decydują pola z panelu
// "Zaawansowane" i "Styl". Testy niżej ustawiają je wprost, bo tylko tak widać,
// że ustawienie z panelu naprawdę dojeżdża do stylu w DOM.
function shell(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-w-id]");
  expect(el, "brak powłoki widgetu").toBeTruthy();
  return el as HTMLElement;
}

describe("WidgetView - powłoka: wyrównanie i wewnętrzna kolumna", () => {
  it("wyrównanie treści na ŚRODEK buduje wewnętrzną kolumnę z marginesem auto", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { contentMaxWidth: 640, contentAlign: "center", contentGap: 12 } },
    );
    const inner = shell(container).firstElementChild as HTMLElement;
    expect(inner.style.maxWidth).toBe("640px");
    expect(inner.style.gap).toBe("12px");
    expect(inner.style.alignItems).toBe("center");
    expect(inner.style.marginInline).toBe("auto");
  });

  it("wyrównanie treści do PRAWEJ dosuwa kolumnę lewym marginesem auto", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { contentMaxWidth: "40rem", contentAlign: "end" } },
    );
    const inner = shell(container).firstElementChild as HTMLElement;
    // Wartość tekstowa przechodzi bez doklejania jednostki.
    expect(inner.style.maxWidth).toBe("40rem");
    expect(inner.style.alignItems).toBe("flex-end");
    expect(inner.style.marginLeft).toBe("auto");
  });

  it("wyrównanie treści do LEWEJ dosuwa kolumnę prawym marginesem auto", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { contentMaxWidth: 400, contentAlign: "start" } },
    );
    const inner = shell(container).firstElementChild as HTMLElement;
    expect(inner.style.alignItems).toBe("flex-start");
    expect(inner.style.marginRight).toBe("auto");
  });

  it("BEZ własnego wyrównania treści wewnętrzna kolumna dziedziczy wyrównanie ze stylu", () => {
    // "Wyrównanie treści" puste + "Wyrównanie" = środek -> kolumna ma przejąć
    // to drugie, inaczej ustawienie ze stylu nie robi nic, gdy autor ustawił
    // maksymalną szerokość treści.
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { contentMaxWidth: 500 }, style: { align: { desktop: "center" } } },
    );
    const inner = shell(container).firstElementChild as HTMLElement;
    expect(inner.style.alignItems).toBe("center");
    expect(inner.style.maxWidth).toBe("500px");
  });

  it.each([
    ["right", "flex-end"],
    ["left", "flex-start"],
  ])(
    "wyrównanie %s BEZ szerokości treści opakowuje dziecko w kolumnę shrink-to-content",
    (align, expected) => {
      const { container } = renderNode(
        "heading",
        { text_en: "T" },
        { style: { align: { desktop: align as "left" | "right" } } },
      );
      const box = shell(container).firstElementChild as HTMLElement;
      expect(box.style.alignSelf).toBe(expected);
      expect(box.style.width).toBe("auto");
    },
  );

  it("sam ODSTĘP treści buduje kolumnę o pełnej szerokości (bez limitu szerokości)", () => {
    const { container } = renderNode("heading", { text_en: "T" }, { advanced: { contentGap: 8 } });
    const inner = shell(container).firstElementChild as HTMLElement;
    expect(inner.style.gap).toBe("8px");
    expect(inner.style.maxWidth).toBe("100%");
  });

  it("widget strukturalny (separator) NIE dostaje kolumny shrink-to-content", () => {
    const { container } = renderNode("divider", {}, { style: { align: { desktop: "center" } } });
    const first = shell(container).firstElementChild as HTMLElement;
    expect(first.style.alignSelf).toBe("");
  });

  it("jawna wysokość ramki propaguje się przez powłokę mediów", () => {
    const { container } = renderNode(
      "image",
      { src: "https://cdn.example/a.webp" },
      { advanced: { height: { desktop: 300 } } },
    );
    expect(shell(container).style.height).toBe("100%");
  });

  it("kolory ikon z panelu stylów wchodzą jako reguły zakresowane do widgetu", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      {
        style: {
          iconColor: "#111111",
          iconHoverColor: "#222222",
          iconActiveColor: "#333333",
        },
      },
    );
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(css).toContain("#111111");
    expect(css).toContain("#222222");
    expect(css).toContain("#333333");
    expect(css).toContain("aria-current");
  });
});

describe("WidgetView - animacje wejścia: presety, easing i stan końcowy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["blur", "filter"],
    ["reveal-up", "clip-path"],
  ])("preset %s zawęża listę animowanych właściwości do %s", (animation, prop) => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { animation } as unknown as AdvancedSettings },
    );
    expect(shell(container).getAttribute("style") ?? "").toContain(prop);
  });

  it("preset SPOZA katalogu nie wywraca renderu i animuje samą przezroczystość", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { animation: "wobble" } as unknown as AdvancedSettings },
    );
    const style = shell(container).getAttribute("style") ?? "";
    expect(style).toContain("opacity");
    expect(style).not.toContain("clip-path");
  });

  it("easing SPOZA katalogu spada na ease-out zamiast wpuszczać śmieci do CSS", () => {
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      {
        advanced: {
          animation: "fade",
          animationEasing: "galopem",
        } as unknown as AdvancedSettings,
      },
    );
    expect(shell(container).getAttribute("style") ?? "").toContain("ease-out");
  });

  it("BEZ IntersectionObservera widget od razu jest w stanie KOŃCOWYM (crawler / brak JS)", () => {
    // Bez tego crawler i czytelnik bez JS dostają treść z `opacity: 0`.
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = renderNode(
      "heading",
      { text_en: "T" },
      { advanced: { animation: "fade" } as unknown as AdvancedSettings },
    );
    const style = shell(container).getAttribute("style") ?? "";
    expect(style).toContain("opacity: 1");
    // Stan końcowy zwalnia `will-change` - inaczej warstwa kompozycji zostaje
    // na stałe na każdym widgecie strony.
    expect(style).not.toContain("will-change");
  });
});

describe("WidgetView - nagłówek: presety rozmiaru, warianty i ikona", () => {
  it.each([
    ["sm", "text-xl"],
    ["md", "text-3xl"],
    ["display", "text-6xl"],
  ])("preset rozmiaru %s daje klasę %s", (sizePreset, cls) => {
    const { container } = renderNode("heading", { text_en: "Tytuł", sizePreset });
    expect(container.querySelector("h2")?.className).toContain(cls);
  });

  it("wariant 'highlight' BEZ własnego koloru używa domyślnego podkreślenia marki", () => {
    const { container } = renderNode("heading", { text_en: "Tytuł", variant: "highlight" });
    const h = container.querySelector("h2");
    expect(h?.className).toContain("decoration-brand");
    expect(h?.getAttribute("style") ?? "").not.toContain("text-decoration-color");
  });

  it("odnośnik nagłówka w NOWEJ karcie dostaje rel chroniący przed przejęciem okna", () => {
    const { container } = renderNode("heading", {
      text_en: "Tytuł",
      href: "/analizy",
      target: "blank",
    });
    const a = container.querySelector("a");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  // DEFEKT: PUSTY ADRES ZAMIENIA SIE W "#", WIEC KAZDY NAGLOWEK JEST ODNOSNIKIEM.
  //
  // WEJSCIE: widget "heading" (albo "dark-featured-card") BEZ pola "Adres" -
  //   czyli domyslny stan swiezo dodanego naglowka na kanwie.
  // CO PSUJE: `const href = safeUrl(getStr(c, "href"))` (WidgetView.tsx:479)
  //   wola `safeUrl` BEZ drugiego argumentu, a ten ma domyslny fallback "#"
  //   (`src/lib/sanitizePure.ts:176`). Pusty adres nie zostaje wiec pusty, tylko
  //   staje sie "#", przez co warunek `href ? <AppLink> : titleRow`
  //   (WidgetView.tsx:590-601) ZAWSZE wybiera odnosnik - galaz bez odnosnika
  //   jest nieosiagalna. Ten sam wzorzec siedzi w karcie wyroznionej (1320/1427).
  // KONSEKWENCJA: kazdy naglowek na stronie publicznej jest opakowany w
  //   <a href="#">. Czytnik ekranu oglasza go jako odnosnik, nawigacja po
  //   klawiszu Tab zatrzymuje sie na kazdym naglowku, a klikniecie dopisuje "#"
  //   do adresu i przewija strone na gore. Autor jawnie napisal galaz "bez
  //   odnosnika", wiec to nie jest zamierzona semantyka.
  // WYMAGANA POPRAWKA: `safeUrl(getStr(c, "href"), "")` (pusty fallback) w obu
  //   miejscach, zeby pusty adres zostawal pusty i galaz `titleRow` zyla.
  it.fails("DEFEKT: nagłówek BEZ adresu nie powinien być odnośnikiem", () => {
    const { container } = renderNode("heading", { text_en: "Tytuł" });
    expect(container.querySelector("a")).toBeNull();
  });

  it("ikona po PRAWEJ odwraca kolejność wiersza tytułu", () => {
    const { container } = renderNode("heading", {
      text_en: "Tytuł",
      iconName: "Star",
      iconPosition: "right",
    });
    expect(container.querySelector("span.inline-flex")?.className).toContain("flex-row-reverse");
  });

  it("ikona SPOZA katalogu Lucide nie wywraca nagłówka", () => {
    const { container } = renderNode("heading", { text_en: "Tytuł", iconName: "NieMaTakiej" });
    expect(container.querySelector("h2")?.textContent).toBe("Tytuł");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("tryb edycji w wersji EN podpowiada angielskie etykiety pól", () => {
    const heading = renderNode("heading", {}, { editable: true, lang: "en" });
    expect(heading.container.innerHTML).toContain("Heading");
    cleanup();
    const text = renderNode("text", {}, { editable: true, lang: "en" });
    expect(text.container.innerHTML).toContain("Type text");
    cleanup();
    const cta = renderNode("cta", {}, { editable: true, lang: "en" });
    expect(cta.container.innerHTML).toContain("CTA heading");
  });
});

describe("WidgetView - przycisk, nav-link i menu", () => {
  it("ikona przycisku po PRAWEJ odwraca kolejność, a nieznana ikona znika bez śladu", () => {
    const right = renderNode("button", {
      label_en: "Kup",
      href: "/x",
      iconName: "Star",
      iconPosition: "right",
    });
    expect(right.container.querySelector("a")?.className).toContain("flex-row-reverse");
    cleanup();
    const unknown = renderNode("button", { label_en: "Kup", href: "/x", iconName: "NieMaTakiej" });
    expect(unknown.container.querySelector("svg")).toBeNull();
    expect(unknown.container.textContent).toContain("Kup");
  });

  it("kolory przycisku z panelu działają także w kanwie (tryb edycji)", () => {
    const { container } = renderNode(
      "button",
      {
        label_en: "Kup",
        variant: "primary",
        btnBgColor: "#0a0a0a",
        btnTextColor: "#ffffff",
        iconName: "Star",
      },
      { editable: true },
    );
    const span = container.querySelector("span.inline-flex") as HTMLElement;
    expect(span.style.backgroundColor).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("nav-link w NOWEJ karcie dostaje rel chroniący przed przejęciem okna", () => {
    const { container } = renderNode("nav-link", {
      label_en: "Kontakt",
      href: "/kontakt",
      target: "blank",
    });
    const a = container.querySelector("a");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("menu BEZ wskazanego klucza spada na menu główne", () => {
    const { container } = renderNode("menu", {});
    expect(container.querySelector("[data-w-id]")).toBeTruthy();
  });
});

describe("WidgetView - zakładki, CTA i karta wyróżniona", () => {
  it("zakładki: NIE-tablica, pionowa orientacja i wyrównanie spoza katalogu", () => {
    const broken = renderNode("tabs", {
      tabs: "nie-tablica",
      orientation: "vertical",
      tabAlign: 7,
    } as unknown as WidgetContent);
    expect(broken.container.querySelector("[data-w-id]")).toBeTruthy();
    cleanup();
    const badAlign = renderNode("tabs", {
      tabs: [{ label_en: "Jeden", html_en: "<p>x</p>" }],
      tabAlign: "wszedzie",
    } as unknown as WidgetContent);
    expect(badAlign.container.textContent).toContain("Jeden");
  });

  it("CTA w kanwie honoruje kolory przycisku z panelu", () => {
    const { container } = renderNode(
      "cta",
      { title_en: "Tytuł", cta_en: "Dołącz", ctaBtnBg: "#101010", ctaBtnText: "#fefefe" },
      { editable: true },
    );
    const styled = [...container.querySelectorAll("span")].find((el) => el.style.backgroundColor);
    expect(styled, "przycisk CTA w kanwie nie dostał koloru tła z panelu").toBeTruthy();
    expect(styled?.style.color).toBeTruthy();
  });

  it.each([
    ["sm", "rounded-sm"],
    ["md", "rounded-md"],
    ["lg", "rounded-lg"],
  ])("plakietka karty wyróżnionej: promień %s", (badgeRadius, cls) => {
    const { container } = renderNode("dark-featured-card", {
      badge_en: "Nowe",
      title_en: "Tytuł",
      badgeRadius,
    });
    expect(container.querySelector("div.inline-block")?.className).toContain(cls);
  });

  it.each([
    ["solid-brand", "bg-brand"],
    ["solid-dark", "bg-foreground"],
    ["outline", "bg-transparent"],
    ["ghost", "bg-white/10"],
  ])("plakietka karty wyróżnionej: wariant %s", (badgeVariant, cls) => {
    const { container } = renderNode("dark-featured-card", {
      badge_en: "Nowe",
      title_en: "Tytuł",
      badgeVariant,
    });
    expect(container.querySelector("div.inline-block")?.className).toContain(cls);
  });

  it("mały rozmiar plakietki oraz własne kolory wygrywają nad klasami wariantu", () => {
    const { container } = renderNode("dark-featured-card", {
      badge_en: "Nowe",
      title_en: "Tytuł",
      badgeSize: "sm",
      badgeBg: "#123456",
      badgeText: "#fedcba",
    });
    const badge = container.querySelector("div.inline-block") as HTMLElement;
    expect(badge.className).toContain("text-sm");
    expect(badge.style.background).toBeTruthy();
    expect(badge.style.color).toBeTruthy();
  });

  it.each([
    ["zoom-out", "scale-105"],
    ["brighten", "brightness-90"],
    ["tilt", "origin-center"],
    ["none", "inset-0"],
  ])("animacja obrazu karty wyróżnionej: %s", (imageHover, cls) => {
    const { container } = renderNode("dark-featured-card", {
      title_en: "Tytuł",
      image: "https://cdn.example/a.webp",
      imageHover,
    });
    const img = container.querySelector("[data-widget-media] img");
    expect(img?.getAttribute("class") ?? "").toContain(cls);
  });

  it("obramowanie karty wyróżnionej ze stylu widgetu daje jawny styl i grubość", () => {
    const { container } = renderNode(
      "dark-featured-card",
      { title_en: "Tytuł" },
      { style: { borderColor: "#00ff00" } },
    );
    const card = container.querySelector("div.relative.p-6") as HTMLElement;
    expect(card.style.borderStyle).toBe("solid");
    expect(card.style.borderWidth).toBe("1px");
  });

  it("karta wyróżniona w kanwie pokazuje PUSTĄ plakietkę, żeby dało się ją wpisać", () => {
    // Publicznie pusta plakietka znika; w kanwie musi zostać jako cel kliknięcia,
    // inaczej nie ma jak dodać etykiety do już wstawionej karty.
    const readOnly = renderNode("dark-featured-card", { title_en: "Tytuł" });
    expect(readOnly.container.querySelector("div.inline-block")).toBeNull();
    cleanup();
    const editing = renderNode("dark-featured-card", { title_en: "Tytuł" }, { editable: true });
    expect(editing.container.querySelector("div.inline-block")).not.toBeNull();
  });
});

describe("WidgetView - formularze i wsparcie: wartości domyślne spoza katalogu", () => {
  it("wsparcie: BEZ tytułu, opisu, waluty i adresu spada na wartości domyślne", () => {
    const { container } = renderNode("donations", {});
    expect(container.querySelector("[data-w-id]")).toBeTruthy();
    expect(container.textContent ?? "").not.toContain("undefined");
  });

  it.each(["link", "cos-innego"])("wsparcie: tryb %s nie wywraca renderu", (mode) => {
    const { container } = renderNode("donations", { variant: "compact-card", mode, href: "/x" });
    expect(container.querySelector("[data-w-id]")).toBeTruthy();
  });

  it("newsletter z WŁASNĄ ikoną w kanwie renderuje kafelek bez domyślnej koperty", () => {
    const { container } = renderNode(
      "newsletter",
      { variant: "icon-only", iconName: "Bell", title_en: "Zapisz się" },
      { editable: true },
    );
    expect(container.querySelector("[data-w-id]")).toBeTruthy();
    cleanup();
    const unknownIcon = renderNode("newsletter", {
      variant: "icon",
      iconName: "NieMaTakiejIkony",
      title_en: "Zapisz się",
    });
    expect(unknownIcon.container.textContent).toContain("Zapisz się");
  });
});

describe("WidgetView - globalny widget: rekord na żywo wygrywa nad migawką", () => {
  it("poza kanwą render bierze REKORD, a przypisy globalnego widgetu są rozwijane", () => {
    // Migawka w dokumencie jest tylko fallbackiem SSR - po hydratacji publiczna
    // strona ma pokazać wersję współdzieloną, inaczej dwie strony z tym samym
    // globalnym widgetem rozjeżdżają się na stałe. Znacznik [fn]…[/fn] musi
    // przejść przez ten sam silnik przypisów, co treść przygotowana wcześniej.
    const node: WidgetNode = {
      id: "gw-instance",
      kind: "widget",
      type: "text",
      globalId: "g-1",
      content: { html_en: "<p>Migawka</p>" } as WidgetContent,
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(globalWidgetKey("g-1"), {
      type: "text",
      content: { html_en: "<p>Rekord na żywo [fn]Źródło[/fn]</p>" },
    });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <WidgetView node={node} lang="en" device="desktop" editable={false} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toContain("Rekord na żywo");
    expect(container.textContent).not.toContain("Migawka");
    expect(container.textContent).not.toContain("[fn]");
  });

  it("w KANWIE wygrywa migawka dokumentu (optymistyczna edycja nie może migotać)", () => {
    const node: WidgetNode = {
      id: "gw-instance-edit",
      kind: "widget",
      type: "heading",
      globalId: "g-1",
      content: { text_en: "Migawka" } as WidgetContent,
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(globalWidgetKey("g-1"), {
      type: "heading",
      content: { text_en: "Rekord na żywo" },
    });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <WidgetView node={node} lang="en" device="desktop" editable onContentChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toContain("Migawka");
  });
});
