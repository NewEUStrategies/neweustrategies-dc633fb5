// Exhaustive coverage for the three self-contained widget render helpers:
// animated-heading, slider and section-label. Each *Render function is rendered
// directly so every shape / variant / config branch can be driven precisely.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const refs = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
const fallbackImgs = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/builder/contentRefs", () => ({
  useResolvedPostRefs: () => refs.map,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "order", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: fallbackImgs.rows, error: null });
  return { supabase: { from: () => builder, rpc: async () => ({ data: [], error: null }) } };
});

// Router TanStack: renderer nawiguje kliknieciem w kadr, a AppLink w tytule
// preloaduje trase. Podmieniamy WYLACZNIE useRouter (czesciowa atrapa), zeby
// reszta modulu zostala prawdziwa; `present` pozwala zejsc do wariantu
// "brak routera", w ktorym kod robi twarde przejscie.
const routerStub = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  preloadRoute: vi.fn(() => Promise.resolve()),
  present: true,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () =>
      routerStub.present
        ? { navigate: routerStub.navigate, preloadRoute: routerStub.preloadRoute }
        : null,
  };
});

import {
  AnimatedHeadingRender,
  ANIMATED_SHAPES,
  type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";
import {
  SliderRender,
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SLIDER_VARIANT_VALUES,
  type NavArrowVariant,
  type SliderItem,
  type SliderConfig,
} from "@/lib/builder/sliderVariants";
import { SLIDER_SPLIT_SIZES, sliderMultiCardSizes } from "@/lib/builder/sliderSizes";
import {
  SectionLabelRender,
  resolveAccentColor,
  SECTION_LABEL_VARIANTS,
} from "@/lib/builder/sectionLabelVariants";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  refs.map = new Map();
  fallbackImgs.rows = [];
  routerStub.navigate.mockClear();
  routerStub.preloadRoute.mockClear();
  routerStub.present = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AnimatedHeadingRender", () => {
  it("renders every shape in highlight mode", () => {
    for (const { value } of ANIMATED_SHAPES) {
      const { container } = render(
        <AnimatedHeadingRender
          config={{
            mode: "highlight",
            shape: value,
            tag: "h2",
            align: "center",
            textBefore: "Dołącz",
            highlight: "do nas",
            textAfter: "dziś",
            color: "#222222",
            accentColor: "#f97316",
            loop: true,
          }}
        />,
      );
      expect(container.textContent).toContain("do nas");
    }
  });

  it("renders shapes with loop disabled and default colors", () => {
    const { container } = render(
      <AnimatedHeadingRender
        config={{ mode: "highlight", shape: "scribble", loop: false, highlight: "x" }}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("returns no shape svg for an unknown shape", () => {
    const { container } = render(
      <AnimatedHeadingRender
        config={{ shape: "bogus" as AnimatedHeadingShape, highlight: "Hej" }}
      />,
    );
    expect(container.textContent).toContain("Hej");
  });

  it("shows preview placeholder text when highlight is empty", () => {
    const { container } = render(<AnimatedHeadingRender config={{ highlight: "" }} preview />);
    expect(container.textContent).toContain("wyróżnione");
  });

  it("handles textBefore/textAfter spacing variants", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ textBefore: "Przed ", highlight: "X", textAfter: " po" }} />,
    );
    expect(container.textContent).toContain("Przed");
    expect(container.textContent).toContain("po");
  });

  it("rotates words on an interval in rotate mode", () => {
    vi.useFakeTimers();
    render(
      <AnimatedHeadingRender
        config={{
          mode: "rotate",
          rotateWords: ["szybko", "łatwo", "skutecznie"],
          durationMs: 300,
          loop: true,
        }}
      />,
    );
    expect(screen.getByText("szybko")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("łatwo")).toBeTruthy();
  });

  it("does not start an interval with fewer than two words", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "rotate", rotateWords: ["jedno"] }} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toContain("jedno");
  });

  it("renders an empty highlight without preview placeholder", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "highlight", shape: "underline", highlight: "" }} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders rotate mode with no words", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "rotate", rotateWords: [] }} />,
    );
    expect(container.querySelector("h2")).toBeTruthy();
  });
});

describe("SliderRender", () => {
  const items: SliderItem[] = [
    {
      image: "https://cdn.x/1.jpg",
      title_pl: "Slajd 1",
      title_en: "Slide 1",
      subtitle_pl: "Opis 1",
      category_pl: "Analiza",
      author: "Anna",
      readTime: "5 min",
      href: "/p1",
      categoryColor: "#ff0000",
    },
    { image: "https://cdn.x/2.jpg", title_pl: "Slajd 2", subtitle_pl: "Opis 2", href: "/p2" },
    { image: "https://cdn.x/3.jpg", title_pl: "Slajd 3" },
  ];

  it("renders slides with category, meta and a linked title; navigates", () => {
    wrap(<SliderRender config={{ variant: "editorial-hero", items, autoplay: false }} lang="pl" />);
    expect(screen.getByText("Slajd 1")).toBeTruthy();
    expect(screen.getByText("Analiza")).toBeTruthy();
    expect(screen.getByText(/Anna/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Następny"));
    expect(screen.getByText("Slajd 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Poprzedni"));
    fireEvent.click(screen.getByLabelText("Slajd 3"));
    expect(screen.getByText("Slajd 3")).toBeTruthy();
  });

  it("renders an empty placeholder when there are no images", () => {
    const { container } = wrap(<SliderRender config={{ items: [] }} lang="pl" />);
    expect(container.textContent).toContain("Dodaj obrazki");
  });

  it("renders a single slide without navigation and without a title link", () => {
    wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/a.jpg", title_pl: "Solo" }] }}
        lang="pl"
      />,
    );
    expect(screen.getByText("Solo")).toBeTruthy();
    expect(screen.queryByLabelText("Następny")).toBeNull();
  });

  it("truncates long titles and subtitles", () => {
    const long = "x".repeat(200);
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/a.jpg", title_pl: long, subtitle_pl: long }] }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("…");
  });

  it("applies size/weight overrides, ratio and rounded", () => {
    const cfg: SliderConfig = {
      items,
      ratio: "21/9",
      rounded: "full",
      overlayOpacity: 0.3,
      titleSizePx: 40,
      titleWeight: 800,
      subtitleSizePx: 18,
      subtitleWeight: 500,
    };
    expect(() => wrap(<SliderRender config={cfg} lang="en" />)).not.toThrow();
  });

  it("resolves bound posts, preferring authored overrides over live data", () => {
    refs.map = new Map([
      [
        "post-1",
        {
          cover: "https://cdn.x/live.jpg",
          href: "/live",
          authorName: "Live Author",
          title: "Live Title",
          excerpt: "Live excerpt",
        },
      ],
    ]);
    wrap(
      <SliderRender
        config={{
          items: [
            { image: "", postId: "post-1" },
            { image: "", postId: "missing", title_pl: "Own" },
          ],
        }}
        lang="pl"
      />,
    );
    expect(screen.getByText("Live Title")).toBeTruthy();
  });

  it("falls back to a placeholder when an image errors", () => {
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/broken.jpg", title_pl: "Broken" }] }}
        lang="pl"
      />,
    );
    const img = container.querySelector("img.eh-img") as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector("img.eh-img")).toBeTruthy();
  });

  it("autoplays through slides on a timer", () => {
    vi.useFakeTimers();
    wrap(<SliderRender config={{ items, autoplay: true, intervalMs: 1500 }} lang="pl" />);
    expect(screen.getByText("Slajd 1")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByText("Slajd 2")).toBeTruthy();
  });

  it("skips autoplay in preview mode", () => {
    const { container } = wrap(
      <SliderRender config={{ items, autoplay: true }} lang="pl" preview />,
    );
    expect(container.textContent).toContain("Slajd 1");
  });

  it("uses DB fallback images for unsafe sources and falls back to a placeholder on repeated errors", () => {
    fallbackImgs.rows = [
      { cover_image_url: "https://cdn.x/fallback.jpg" },
      { cover_image_url: "" },
    ];
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "javascript:bad", title_pl: "Unsafe" }] }}
        lang="pl"
      />,
    );
    const img = container.querySelector("img.eh-img") as HTMLImageElement;
    fireEvent.error(img);
    fireEvent.error(img);
    expect(screen.getByText("Unsafe")).toBeTruthy();
  });

  it("falls back PL title/subtitle when EN variants are empty", () => {
    const { container } = wrap(
      <SliderRender
        config={{
          items: [{ image: "https://cdn.x/a.jpg", title_pl: "TylkoPL", subtitle_pl: "OpisPL" }],
        }}
        lang="en"
      />,
    );
    expect(container.textContent).toContain("TylkoPL");
  });

  // ==================================================================
  // ROZSZERZENIE: INTERAKCJA I CHROM SLIDERA (moduł 3, silniki treści)
  //
  // CO TA POWIERZCHNIA ROBI: `SliderRender` jest samowystarczalnym rendererem
  // widgetu slidera - rozstrzyga dane slajdów, koercjuje CAŁĄ konfigurację
  // z panelu i deleguje rysowanie do jednego z pięciu wewnętrznych wariantów.
  // Ani strzałki, ani kropki, ani obraz z podwójnym fallbackiem nie mają
  // własnego eksportu, więc każdą gałąź trzeba wywołać konfiguracją
  // i zdarzeniem, a dowodem jest wyłącznie DOM.
  //
  // CO TU JEST NAPRAWDĘ DO OBRONY
  //
  // 1. DRZEWO ODMOWY NAWIGACJI (sliderVariants.tsx:993-1015). Kliknięcie
  //    slajdu ma prowadzić czytelnika do wpisu, ale NIE wolno mu wyprowadzać
  //    redaktora z kanwy edytora ani z podglądu panelu. Rozróżnienie jest
  //    subtelne: publiczny renderer TEŻ ustawia [data-builder-renderer], tyle
  //    że jako atrybut PUSTY, więc blokuje dopiero atrybut Z WARTOŚCIĄ. Ta
  //    para gałęzi jest sednem poprawki "kliknięcie obrazka" i do dziś nie
  //    miała żadnego dowodu.
  //
  // 2. PRZECIĄGANIE (:946-983). Próg 48 px, odrzucanie zdarzeń o cudzym
  //    pointerId, blokada prawego przycisku myszy i trybu podglądu, a przede
  //    wszystkim strażnik "klik tuż po przeciągnięciu NIE nawiguje" - bez
  //    niego każde przesunięcie palcem na telefonie kończyło się otwarciem
  //    wpisu, którego czytelnik nie chciał.
  //
  // 3. AUTOPLAY (:894-909). Pętla kontra zatrzymanie na ostatnim kroku, pauza
  //    pod kursorem, liczba kroków liczona PO KOLUMNACH w multi-card oraz
  //    sprzątanie interwału - cztery różne powody, dla których slajd zmienia
  //    się (albo nie zmienia) sam.
  //
  // 4. CHROM NAWIGACJI (:158-173, :190-274, :597-650). Osiem kształtów
  //    strzałek, sześć stylów tła, cztery pozycje i zaciski rozmiaru,
  //    promienia oraz grubości kreski. Wszystko sterowane wyłącznie panelem,
  //    więc jedyny dowód, że wybór w panelu cokolwiek zmienia, to atrybuty
  //    i zmienne CSS na przycisku.
  //
  // GRANICA DOWODU - czego z tego poziomu pokryć się NIE DA (nie szukać):
  //  - gałąź `default` w `NavArrowGlyph` (:268-273): `asOneOf` zawęża wariant
  //    do katalogu, więc publiczne API nigdy jej nie trafi; ożyje dopiero,
  //    gdy ktoś doda wartość do katalogu bez gałęzi w switchu;
  //  - `target.closest(".eh-side-nav")` w onClick kadru (:1157): przycisk
  //    strzałki zatrzymuje propagację własnego kliknięcia, więc kadr nigdy
  //    nie zobaczy zdarzenia pochodzącego ze strzałki;
  //  - `t.closest("[data-thumb-strip]")` w minimal-strip (:1735): pasek
  //    miniatur jest RODZEŃSTWEM kadru, nie jego potomkiem;
  //  - prawy człon `safeImageUrl(it.image) || it.image` w wariantach
  //    (:1180, :1480, :1618, :1751, :1817): `SliderRender` podmienia każdy
  //    niebezpieczny adres na fallback JESZCZE PRZED wariantem (:750-762),
  //    więc lewy człon jest zawsze prawdziwy;
  //  - `if (!src) return` w `markImageFailed` (:740) - z tego samego powodu:
  //    obraz wchodzący do wariantu nigdy nie ma pustego adresu;
  //  - WSZYSTKIE gałęzie "slajd bez odnośnika" (`href ? <AppLink> : ...`) oraz
  //    `if (!href)` w `navigateTo` (:994) i w kadrze editorial-hero (:1153):
  //    `pickSlideStrings` podstawia "#" za brakujący adres, więc `href` jest
  //    zawsze prawdziwy. To nie jest luka w teście, tylko defekt produkcji -
  //    opisany niżej przy `it.fails` "slajd bez adresu";
  //  - try/catch wokół `setPointerCapture` / `releasePointerCapture`
  //    (:962-966, :977-981): happy-dom nie implementuje tych metod, więc
  //    pokryta jest wyłącznie ścieżka wyjątku.

  const NAV_ARROW_PATHS: Record<NavArrowVariant, string> = {
    chevron: "M9 6l6 6-6 6",
    "chevron-bold": "M9 5l7 7-7 7",
    arrow: "M5 12h14M13 6l6 6-6 6",
    "arrow-long": "M3 12h17M14 6l6 6-6 6",
    caret: "M9 5l8 7-8 7z",
    angle: "M10 5l7 7-7 7",
    "double-chevron": "M6 6l6 6-6 6M12 6l6 6-6 6",
    "arrow-tail": "M4 12h15M13 6l6 6-6 6M5 9l3 3-3 3",
  };

  // Adresy wyłącznie na example.com; wariant "storage" różni się TYLKO
  // ścieżką, bo to ona decyduje o transformacjach (isSupabaseStorageUrl).
  const STORAGE_COVER = "https://cdn.example.com/storage/v1/object/public/media/okladka-1.jpg";
  const STORAGE_COVER_2 = "https://cdn.example.com/storage/v1/object/public/media/okladka-2.jpg";
  const EXTERNAL_COVER = "https://cdn.example.com/media/okladka-3.jpg";

  /** Trzy slajdy BEZ odnośnika - tam, gdzie link tylko przeszkadza. */
  const plainSlides: SliderItem[] = [
    { image: EXTERNAL_COVER, title_pl: "Karta 1" },
    { image: EXTERNAL_COVER, title_pl: "Karta 2" },
    { image: EXTERNAL_COVER, title_pl: "Karta 3" },
  ];

  function media(container: HTMLElement): HTMLElement {
    const el = container.querySelector("[data-widget-media]");
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  function navButton(container: HTMLElement, dir: "prev" | "next"): HTMLElement {
    const el = container.querySelector(`button.eh-${dir}`);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  /** Pełny cykl przeciągnięcia jednym wskaźnikiem (dotyk - bez przycisków). */
  function drag(surface: HTMLElement, fromX: number, toX: number, pointerId = 7) {
    fireEvent.pointerDown(surface, { clientX: fromX, pointerId, pointerType: "touch" });
    fireEvent.pointerMove(surface, { clientX: toX, pointerId, pointerType: "touch" });
    fireEvent.pointerUp(surface, { clientX: toX, pointerId, pointerType: "touch" });
  }

  describe("SliderRender - chrom nawigacji", () => {
    it.each([...NAV_ARROW_VARIANT_VALUES])(
      "rysuje kształt strzałki %s jako jeden inline SVG w obu przyciskach",
      (variant) => {
        const { container } = wrap(
          <SliderRender config={{ items, autoplay: false, navArrowVariant: variant }} lang="pl" />,
        );
        const prev = container.querySelectorAll("button.eh-prev path");
        const next = container.querySelectorAll("button.eh-next path");
        expect(prev).toHaveLength(1);
        expect(next).toHaveLength(1);
        expect(prev[0].getAttribute("d")).toBe(NAV_ARROW_PATHS[variant]);
        expect(next[0].getAttribute("d")).toBe(NAV_ARROW_PATHS[variant]);
      },
    );

    it("odwraca strzałkę wsteczną lustrzanie, zamiast rysować drugą geometrię", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const prevSvg = container.querySelector("button.eh-prev svg") as SVGElement;
      const nextSvg = container.querySelector("button.eh-next svg") as SVGElement;
      expect(prevSvg.style.transform).toBe("scaleX(-1)");
      expect(nextSvg.style.transform).toBe("none");
    });

    it("pogrubia chevron-bold do co najmniej 3 i przepuszcza grubszą kreskę z panelu", () => {
      const cienki = wrap(
        <SliderRender
          config={{ items, autoplay: false, navArrowVariant: "chevron-bold", navArrowStroke: 1 }}
          lang="pl"
        />,
      ).container;
      expect(cienki.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("3");

      const gruby = wrap(
        <SliderRender
          config={{ items, autoplay: false, navArrowVariant: "chevron-bold", navArrowStroke: 4 }}
          lang="pl"
        />,
      ).container;
      expect(gruby.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("4");
    });

    it("ścienia wariant angle o pół punktu, ale nigdy poniżej 1", () => {
      const gruby = wrap(
        <SliderRender
          config={{ items, autoplay: false, navArrowVariant: "angle", navArrowStroke: 4 }}
          lang="pl"
        />,
      ).container;
      expect(gruby.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("3.5");

      const cienki = wrap(
        <SliderRender
          config={{ items, autoplay: false, navArrowVariant: "angle", navArrowStroke: 0.5 }}
          lang="pl"
        />,
      ).container;
      expect(cienki.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("1");
    });

    it.each([...NAV_BG_STYLES])("nadaje przyciskowi klasę modyfikatora eh-nav-%s", (bgStyle) => {
      const { container } = wrap(
        <SliderRender config={{ items, autoplay: false, navBgStyle: bgStyle }} lang="pl" />,
      );
      expect(navButton(container, "prev").className).toContain(`eh-nav-${bgStyle}`);
      expect(navButton(container, "next").className).toContain(`eh-nav-${bgStyle}`);
    });

    it.each([...NAV_POSITIONS])("ustawia data-pos na %s dla obu przycisków", (position) => {
      const { container } = wrap(
        <SliderRender config={{ items, autoplay: false, navPosition: position }} lang="pl" />,
      );
      expect(navButton(container, "prev").getAttribute("data-pos")).toBe(position);
      expect(navButton(container, "next").getAttribute("data-pos")).toBe(position);
    });

    it("zawęża rozmiar przycisku do przedziału 28..96 px", () => {
      const maly = wrap(
        <SliderRender config={{ items, autoplay: false, navSizePx: 5 }} lang="pl" />,
      ).container;
      expect(navButton(maly, "prev").style.getPropertyValue("--nav-size")).toBe("28px");

      const duzy = wrap(
        <SliderRender config={{ items, autoplay: false, navSizePx: 500 }} lang="pl" />,
      ).container;
      expect(navButton(duzy, "prev").style.getPropertyValue("--nav-size")).toBe("96px");
    });

    it("zawęża grubość kreski do przedziału 0.5..4", () => {
      const cienka = wrap(
        <SliderRender config={{ items, autoplay: false, navArrowStroke: 0.1 }} lang="pl" />,
      ).container;
      expect(cienka.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("0.5");

      const gruba = wrap(
        <SliderRender config={{ items, autoplay: false, navArrowStroke: 9 }} lang="pl" />,
      ).container;
      expect(gruba.querySelector("button.eh-prev path")?.getAttribute("stroke-width")).toBe("4");
    });

    it("zamienia promień 999 na pełne koło, ujemny na zero, a zwykły przepisuje w px", () => {
      const kolo = wrap(
        <SliderRender config={{ items, autoplay: false, navRoundedPx: 999 }} lang="pl" />,
      ).container;
      expect(navButton(kolo, "prev").style.getPropertyValue("--nav-radius")).toBe("9999px");

      const ujemny = wrap(
        <SliderRender config={{ items, autoplay: false, navRoundedPx: -20 }} lang="pl" />,
      ).container;
      expect(navButton(ujemny, "prev").style.getPropertyValue("--nav-radius")).toBe("0px");

      const zwykly = wrap(
        <SliderRender config={{ items, autoplay: false, navRoundedPx: 12 }} lang="pl" />,
      ).container;
      expect(navButton(zwykly, "prev").style.getPropertyValue("--nav-radius")).toBe("12px");
    });

    it("skaluje ikonę do 42% przycisku, ale nie poniżej 14 px", () => {
      const maly = wrap(
        <SliderRender config={{ items, autoplay: false, navSizePx: 28 }} lang="pl" />,
      ).container;
      expect((maly.querySelector("button.eh-prev svg") as SVGElement).style.width).toBe("14px");

      const duzy = wrap(
        <SliderRender config={{ items, autoplay: false, navSizePx: 96 }} lang="pl" />,
      ).container;
      expect((duzy.querySelector("button.eh-prev svg") as SVGElement).style.width).toBe("40px");
    });

    it("kliknięcie strzałki przewija slajd i NIE otwiera wpisu", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      fireEvent.click(navButton(container, "next"));
      expect(within(container).getByText("Slajd 2")).toBeTruthy();
      fireEvent.click(navButton(container, "prev"));
      expect(within(container).getByText("Slajd 1")).toBeTruthy();
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it("nazywa strzałki po angielsku przy lang=en", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="en" />);
      expect(within(container).getByLabelText("Next slide")).toBeTruthy();
      expect(within(container).getByLabelText("Previous slide")).toBeTruthy();
    });

    // DEFEKT: DOMYŚLNE KOLORY DAJĄ BIAŁĄ STRZAŁKĘ NA BIAŁYM PRZYCISKU.
    //
    // WEJŚCIE: widget z jedynym ustawieniem nawigacji `navBgStyle: "solid"` -
    //   redaktor wybiera w panelu sam styl tła i nie rusza kolorów.
    // CO PSUJE: `resolveNavStyle` (src/lib/builder/sliderVariants.tsx:166-167)
    //   ustawia tło I strzałkę na to samo "#ffffff", a `NavArrows` wpisuje
    //   `--nav-bg: #ffffff` inline (:600). Przez to CSS-owa wartość zapasowa
    //   `var(--nav-bg, #141414)` z reguły `.eh-nav-solid` (:506) jest martwa -
    //   nie zadziała nigdy, bo zmienna ZAWSZE jest ustawiona.
    // KONSEKWENCJA: przycisk biały i strzałka biała, więc nawigacja slidera
    //   znika. To samo dotyczy stylów "gradient" (:517) i "shadow" (:521),
    //   których wartości zapasowe też są ciemne i też nieosiągalne.
    // WYMAGANA POPRAWKA: wartość domyślna tła musi zależeć od `bgStyle`
    //   (ciemna dla solid/gradient/shadow) albo kolor strzałki ma być liczony
    //   kontrastowo do tła - wybór samego stylu nie może dawać niewidocznej
    //   nawigacji.
    it.fails(
      "DEFEKT: styl solid bez własnych kolorów NIE może dawać białej strzałki na białym tle",
      () => {
        const { container } = wrap(
          <SliderRender config={{ items, autoplay: false, navBgStyle: "solid" }} lang="pl" />,
        );
        const btn = navButton(container, "prev");
        expect(btn.style.getPropertyValue("--nav-arrow")).not.toBe(
          btn.style.getPropertyValue("--nav-bg"),
        );
      },
    );

    // DEFEKT: PASEK POD SLIDEREM MÓWI PO POLSKU NIEZALEŻNIE OD JĘZYKA WIDOKU.
    //
    // WEJŚCIE: `SliderRender` z `lang="en"` i trzema slajdami.
    // CO PSUJE: `DotsNav` ma etykiety wpisane na sztywno po polsku -
    //   "Poprzedni" (:667), "Następny" (:688) i `Slajd ${i + 1}` (:679);
    //   tak samo kropki wariantu cinematic (:1561) i miniatury minimal-strip
    //   (:1805). W TYM SAMYM pliku `NavArrows` lokalizuje etykiety poprawnie
    //   (:1191-1192), więc to niekonsekwencja, nie decyzja projektowa.
    // KONSEKWENCJA: czytnik ekranu na anglojęzycznej wersji serwisu czyta
    //   polskie nazwy przycisków - jedyna treść slidera, której przełącznik
    //   języka nie dotyczy.
    // WYMAGANA POPRAWKA: te same etykiety mają być parą PL/EN wybieraną po
    //   propsie `lang`, dokładnie jak w `NavArrows`.
    it.fails("DEFEKT: kropki slidera MUSZĄ mieć etykiety w języku widoku", () => {
      const { container } = wrap(
        <SliderRender config={{ items: plainSlides, autoplay: false }} lang="en" />,
      );
      expect(container.querySelector('button[aria-label="Slide 1"]')).toBeTruthy();
    });
  });

  describe("SliderRender - przeciąganie kadru", () => {
    it("przesunięcie w lewo ponad progiem 48 px przechodzi do następnego slajdu", () => {
      const { container } = wrap(
        <SliderRender config={{ variant: "editorial-hero", items, autoplay: false }} lang="pl" />,
      );
      drag(media(container), 300, 200);
      expect(within(container).getByText("Slajd 2")).toBeTruthy();
    });

    it("przesunięcie w prawo cofa slajd i zawija na ostatni", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      drag(media(container), 200, 300);
      expect(within(container).getByText("Slajd 3")).toBeTruthy();
    });

    it("przesunięcie poniżej progu zostawia slajd bez zmian", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const surface = media(container);
      // Ruch o 2 px jest poniżej progu przechwycenia wskaźnika (4 px), więc
      // kadr nie zabiera zdarzeń elementom pod spodem.
      fireEvent.pointerDown(surface, { clientX: 300, pointerId: 8, pointerType: "touch" });
      fireEvent.pointerMove(surface, { clientX: 298, pointerId: 8, pointerType: "touch" });
      fireEvent.pointerUp(surface, { clientX: 298, pointerId: 8, pointerType: "touch" });
      expect(within(container).getByText("Slajd 1")).toBeTruthy();
      // Ruch o 10 px przechwytuje wskaźnik, ale nadal nie sięga progu 48 px.
      drag(surface, 300, 290);
      expect(within(container).getByText("Slajd 1")).toBeTruthy();
    });

    it("ignoruje ruch i puszczenie wskaźnika o innym pointerId niż rozpoczęty", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const surface = media(container);
      fireEvent.pointerDown(surface, { clientX: 300, pointerId: 1, pointerType: "touch" });
      fireEvent.pointerMove(surface, { clientX: 200, pointerId: 2, pointerType: "touch" });
      fireEvent.pointerUp(surface, { clientX: 200, pointerId: 2, pointerType: "touch" });
      expect(within(container).getByText("Slajd 1")).toBeTruthy();
    });

    it("nie zaczyna przeciągania w trybie podglądu ani przy jednym slajdzie", () => {
      const podglad = wrap(
        <SliderRender config={{ items, autoplay: false }} lang="pl" preview />,
      ).container;
      const powierzchniaPodgladu = media(podglad);
      fireEvent.pointerDown(powierzchniaPodgladu, {
        clientX: 300,
        pointerId: 3,
        pointerType: "touch",
      });
      fireEvent.pointerMove(powierzchniaPodgladu, {
        clientX: 200,
        pointerId: 3,
        pointerType: "touch",
      });
      expect(powierzchniaPodgladu.className).not.toContain("is-dragging");

      const jeden = wrap(
        <SliderRender
          config={{ items: [{ image: EXTERNAL_COVER, title_pl: "Solo" }], autoplay: false }}
          lang="pl"
        />,
      ).container;
      const powierzchniaSolo = media(jeden);
      fireEvent.pointerDown(powierzchniaSolo, { clientX: 300, pointerId: 4, pointerType: "touch" });
      fireEvent.pointerMove(powierzchniaSolo, { clientX: 200, pointerId: 4, pointerType: "touch" });
      expect(powierzchniaSolo.className).not.toContain("is-dragging");
    });

    it("prawy przycisk myszy nie zaczyna przeciągania", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const surface = media(container);
      fireEvent.pointerDown(surface, {
        clientX: 300,
        pointerId: 5,
        pointerType: "mouse",
        button: 2,
      });
      fireEvent.pointerMove(surface, { clientX: 200, pointerId: 5, pointerType: "mouse" });
      fireEvent.pointerUp(surface, { clientX: 200, pointerId: 5, pointerType: "mouse" });
      expect(within(container).getByText("Slajd 1")).toBeTruthy();
      expect(surface.className).not.toContain("is-dragging");
    });

    it("kliknięcie tuż po przeciągnięciu nie otwiera wpisu", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const surface = media(container);
      drag(surface, 300, 200);
      fireEvent.click(surface);
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it.each(["cinematic-overlay", "split-feature", "minimal-strip"] as const)(
      "wariant %s przewija się przeciągnięciem, a kliknięcie tuż po nim nie otwiera wpisu",
      (variant) => {
        const { container } = wrap(
          <SliderRender config={{ variant, items, autoplay: false }} lang="pl" />,
        );
        const surface = media(container);
        const warstwa = surface.firstElementChild as HTMLElement;

        // Kliknięcie BEZ przeciągnięcia prowadzi do wpisu.
        fireEvent.click(surface);
        expect(routerStub.navigate).toHaveBeenCalledWith({ to: "/p1" });
        routerStub.navigate.mockClear();

        fireEvent.pointerDown(surface, { clientX: 300, pointerId: 9, pointerType: "touch" });
        fireEvent.pointerMove(surface, { clientX: 200, pointerId: 9, pointerType: "touch" });
        expect(surface.className).toContain("is-dragging");
        expect(warstwa.style.transform).toContain("translate3d(-35px");
        expect(warstwa.style.transition).toBe("none");
        fireEvent.pointerUp(surface, { clientX: 200, pointerId: 9, pointerType: "touch" });
        expect(within(container).getByText("Slajd 2")).toBeTruthy();

        // ...a to samo kliknięcie tuż po przeciągnięciu jest już wyciszone.
        fireEvent.click(surface);
        expect(routerStub.navigate).not.toHaveBeenCalled();
      },
    );

    it("przeciąganie odsuwa warstwę obrazów proporcjonalnie i wyłącza animację powrotu", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const surface = media(container);
      const warstwa = surface.firstElementChild as HTMLElement;
      fireEvent.pointerDown(surface, { clientX: 300, pointerId: 6, pointerType: "touch" });
      fireEvent.pointerMove(surface, { clientX: 200, pointerId: 6, pointerType: "touch" });
      expect(warstwa.style.transform).toContain("translate3d(-35px");
      expect(warstwa.style.transition).toBe("none");
      expect(surface.className).toContain("is-dragging");
      fireEvent.pointerUp(surface, { clientX: 200, pointerId: 6, pointerType: "touch" });
      expect(warstwa.style.transform).toBe("");
      expect(warstwa.style.transition).toContain("320ms");
    });
  });

  describe("SliderRender - nawigacja kliknięciem w kadr", () => {
    const jeden = (href: string): SliderItem[] => [
      { image: EXTERNAL_COVER, title_pl: "Jeden", href },
    ];
    // Editorial hero exposes a native anchor over its drag surface. Activate
    // that accessible link, as a browser does, rather than its parent div.
    const linkKadru = (container: HTMLElement) =>
      within(media(container)).getByRole("link", { name: "Jeden" });

    it("wewnętrzny odnośnik idzie przez router, bez przeładowania strony", () => {
      const { container } = wrap(
        <SliderRender config={{ items: jeden("/wpis-1"), autoplay: false }} lang="pl" />,
      );
      fireEvent.click(linkKadru(container));
      expect(routerStub.navigate).toHaveBeenCalledWith({ href: "/wpis-1" });
    });

    it("obcy adres bezwzględny otwiera się w nowej karcie, bez opener-a", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { container } = wrap(
        <SliderRender
          config={{
            variant: "cinematic-overlay",
            items: jeden("https://obcy.example.com/artykul"),
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      fireEvent.click(media(container));
      expect(open).toHaveBeenCalledWith(
        "https://obcy.example.com/artykul",
        "_blank",
        "noopener,noreferrer",
      );
      expect(routerStub.navigate).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it("adres bezwzględny z tej samej domeny wraca do routera jako sama ścieżka", () => {
      const { container } = wrap(
        <SliderRender
          config={{ items: jeden(`${window.location.origin}/wewnetrzny?a=1`), autoplay: false }}
          lang="pl"
        />,
      );
      fireEvent.click(linkKadru(container));
      expect(routerStub.navigate).toHaveBeenCalledWith({ href: "/wewnetrzny?a=1" });
    });

    it("bez routera wykonuje twarde przejście adresem slajdu", () => {
      routerStub.present = false;
      const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
      const { container } = wrap(
        <SliderRender
          config={{ variant: "cinematic-overlay", items: jeden("/wpis-1"), autoplay: false }}
          lang="pl"
        />,
      );
      fireEvent.click(media(container));
      expect(assign).toHaveBeenCalledWith("/wpis-1");
      assign.mockRestore();
    });

    it("nie nawiguje z kanwy edytora", () => {
      const { container } = wrap(
        <div data-visual-canvas>
          <SliderRender config={{ items: jeden("/wpis-1"), autoplay: false }} lang="pl" />
        </div>,
      );
      fireEvent.click(linkKadru(container));
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it.each(["editorial-hero", "cinematic-overlay", "split-feature", "minimal-strip"] as const)(
      "podgląd panelu blokuje nawigację wariantu %s, a publiczny renderer ją przepuszcza",
      (variant) => {
        const target = (container: HTMLElement) =>
          variant === "editorial-hero" ? linkKadru(container) : media(container);
        const podglad = wrap(
          <div data-builder-renderer="widget-props-preview">
            <SliderRender
              config={{ variant, items: jeden("/wpis-1"), autoplay: false }}
              lang="pl"
            />
          </div>,
        ).container;
        fireEvent.click(target(podglad));
        expect(routerStub.navigate).not.toHaveBeenCalled();

        const publiczny = wrap(
          <div data-builder-renderer="true">
            <SliderRender
              config={{ variant, items: jeden("/wpis-1"), autoplay: false }}
              lang="pl"
            />
          </div>,
        ).container;
        fireEvent.click(target(publiczny));
        expect(routerStub.navigate).toHaveBeenCalledWith(
          variant === "editorial-hero" ? { href: "/wpis-1" } : { to: "/wpis-1" },
        );
      },
    );

    it("nie nawiguje w trybie podglądu", () => {
      const podglad = wrap(
        <SliderRender config={{ items: jeden("/wpis-1"), autoplay: false }} lang="pl" preview />,
      ).container;
      fireEvent.click(linkKadru(podglad));
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    // DEFEKT: SLAJD BEZ ODNOŚNIKA UDAJE ODNOŚNIK.
    //
    // WEJŚCIE: slajd z samym obrazem i tytułem - redakcja nie podała `href`.
    // CO PSUJE: `pickSlideStrings` liczy adres jako
    //   `safeUrl(asStr(it.href)) || undefined` (sliderVariants.tsx:1131), a
    //   `safeUrl` dla pustego wejścia zwraca WARTOŚĆ ZAPASOWĄ "#", nie pustkę
    //   (src/lib/sanitizePure.ts:176-179). Wynik jest więc ZAWSZE prawdziwy:
    //   kadr dostaje role="link", tabIndex 0 i kursor wskaźnika, tytuł
    //   opakowuje się w <a href="#">, a kliknięcie schodzi do `navigateTo("#")`
    //   i woła router (:1009-1011).
    // KONSEKWENCJA: czytnik ekranu zapowiada jako odnośnik slajd, który nigdzie
    //   nie prowadzi, a klawiatura dostaje pułapkę na Tab. Przy okazji cała
    //   gałąź "bez odnośnika" w wariantach (:1224-1230, :1361-1363, :1376-1383,
    //   :1396-1402, :1658-1662, :1675-1683) jest martwym kodem, a strażnik
    //   `if (!href || preview) return` (:994) nigdy nie broni pierwszego
    //   warunku.
    // WYMAGANA POPRAWKA: slajd bez adresu ma NIE MIEĆ adresu - `pickSlideStrings`
    //   musi oddać `undefined` (np. `safeUrl(asStr(it.href), "") || undefined`),
    //   żeby warianty rysowały zwykły nagłówek zamiast pozornego linku.
    it.fails("DEFEKT: slajd bez adresu NIE MOŻE renderować się jako odnośnik i nawigować", () => {
      const { container } = wrap(
        <SliderRender
          config={{
            variant: "cinematic-overlay",
            items: [{ image: EXTERNAL_COVER, title_pl: "Bez adresu" }],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      fireEvent.click(media(container));
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it("kadr udostępnia natywny, fokusowalny link, a podgląd blokuje jego aktywację", () => {
      const { container } = wrap(
        <SliderRender config={{ items: jeden("/wpis-1"), autoplay: false }} lang="pl" />,
      );
      const kadr = linkKadru(container);
      expect(kadr.tagName).toBe("A");
      expect(kadr.getAttribute("href")).toBe("/wpis-1");
      expect(kadr.tabIndex).toBe(0);
      kadr.focus();
      expect(document.activeElement).toBe(kadr);
      // Browser keyboard activation dispatches a click with detail=0. The
      // native anchor supplies Enter semantics; the div needs no synthetic role.
      fireEvent.click(kadr, { detail: 0 });
      expect(routerStub.navigate).toHaveBeenCalledWith({ href: "/wpis-1" });
      expect(routerStub.navigate).toHaveBeenCalledTimes(1);

      routerStub.navigate.mockClear();
      const podglad = wrap(
        <SliderRender config={{ items: jeden("/wpis-1"), autoplay: false }} lang="pl" preview />,
      ).container;
      linkKadru(podglad).focus();
      fireEvent.click(linkKadru(podglad), { detail: 0 });
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });
  });

  describe("SliderRender - autoplay, pętla i pauza", () => {
    it("bez pętli automat zatrzymuje się na ostatnim slajdzie", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500, loop: false }}
          lang="pl"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(container).getByText("Karta 2")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(4800);
      });
      expect(within(container).getByText("Karta 3")).toBeTruthy();
    });

    it("z pętlą automat wraca na pierwszy slajd", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500, loop: true }}
          lang="pl"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(4800);
      });
      expect(within(container).getByText("Karta 1")).toBeTruthy();
    });

    it("pauzuje pod kursorem, gdy pauza jest włączona, i rusza po zjechaniu kursorem", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500, pauseOnHover: true }}
          lang="pl"
        />,
      );
      const root = container.querySelector(".eh-slider") as HTMLElement;
      fireEvent.mouseOver(root);
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(container).getByText("Karta 1")).toBeTruthy();
      fireEvent.mouseOut(root);
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(container).getByText("Karta 2")).toBeTruthy();
    });

    it("nie pauzuje pod kursorem, gdy pauza jest wyłączona", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500, pauseOnHover: false }}
          lang="pl"
        />,
      );
      fireEvent.mouseOver(container.querySelector(".eh-slider") as HTMLElement);
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(container).getByText("Karta 2")).toBeTruthy();
    });

    it("nie uruchamia automatu przy jednym slajdzie", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{
            items: [{ image: EXTERNAL_COVER, title_pl: "Solo" }],
            autoplay: true,
            intervalMs: 1500,
          }}
          lang="pl"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(within(container).getByText("Solo")).toBeTruthy();
    });

    it("liczy kroki automatu po kolumnach w wariancie multi-card", () => {
      vi.useFakeTimers();
      const piec: SliderItem[] = [1, 2, 3, 4, 5].map((n) => ({
        image: EXTERNAL_COVER,
        title_pl: `Karta ${n}`,
      }));
      const { container } = wrap(
        <SliderRender
          config={{
            variant: "multi-card",
            items: piec,
            columns: 3,
            autoplay: true,
            intervalMs: 1500,
            loop: false,
          }}
          lang="pl"
        />,
      );
      // 5 slajdów w oknie 3 kolumn = 3 kroki, więc i 3 kropki.
      expect(container.querySelectorAll('button[aria-label^="Slajd "]')).toHaveLength(3);
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(within(container).getByLabelText("Slajd 3").className).toContain("w-2.5");
    });

    it("sprząta interwał po odmontowaniu widgetu", () => {
      vi.useFakeTimers();
      const { unmount } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500 }}
          lang="pl"
        />,
      );
      unmount();
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(9000);
        });
      }).not.toThrow();
    });

    it("wraca na pierwszy slajd, gdy redakcja skróci listę slajdów", () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={qc}>
          <SliderRender config={{ items: plainSlides, autoplay: false }} lang="pl" />
        </QueryClientProvider>,
      );
      fireEvent.click(within(view.container).getByLabelText("Slajd 3"));
      expect(within(view.container).getByText("Karta 3")).toBeTruthy();
      view.rerender(
        <QueryClientProvider client={qc}>
          <SliderRender config={{ items: plainSlides.slice(0, 2), autoplay: false }} lang="pl" />
        </QueryClientProvider>,
      );
      expect(within(view.container).getByText("Karta 1")).toBeTruthy();
    });

    // DEFEKT: AUTOMAT NIE ZATRZYMUJE SIĘ PRZY NAWIGACJI KLAWIATURĄ.
    //
    // WEJŚCIE: slider z autoplay i `pauseOnHover: true`; użytkownik klawiatury
    //   przechodzi Tab-em na strzałkę "Następny slajd" i czyta slajd.
    // CO PSUJE: pauza wisi WYŁĄCZNIE na `onMouseEnter`/`onMouseLeave` korzenia
    //   (src/lib/builder/sliderVariants.tsx:1066-1067), a stan `hovered` jest
    //   jedynym wejściem warunku pauzy (:896). Fokus klawiatury nie ustawia go
    //   nigdy, bo w drzewie nie ma ani `onFocus`, ani `onFocusCapture`.
    // KONSEKWENCJA: treść ucieka spod fokusu - zanim użytkownik naciśnie
    //   Enter, automat podmienia slajd i otwiera się inny wpis niż ten, który
    //   był widoczny. Wzorzec APG dla karuzeli wymaga zatrzymania rotacji,
    //   gdy fokus wejdzie w widget.
    // WYMAGANA POPRAWKA: `onFocus`/`onBlur` (albo focusin/focusout na korzeniu)
    //   muszą ustawiać ten sam stan pauzy co kursor.
    it.fails("DEFEKT: fokus klawiatury MUSI wstrzymać automat tak samo jak kursor", () => {
      vi.useFakeTimers();
      const { container } = wrap(
        <SliderRender
          config={{ items: plainSlides, autoplay: true, intervalMs: 1500, pauseOnHover: true }}
          lang="pl"
        />,
      );
      fireEvent.focus(navButton(container, "next"));
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(within(container).getByText("Karta 1")).toBeTruthy();
    });
  });

  describe("SliderRender - obrazy, kandydaci responsywni i fallbacki", () => {
    it("dodaje kandydatów responsywnych dla okładki ze Storage, a dla obcej nie", () => {
      const zeStorage = wrap(
        <SliderRender
          config={{ items: [{ image: STORAGE_COVER, title_pl: "Ze Storage" }], autoplay: false }}
          lang="pl"
        />,
      ).container;
      const imgStorage = zeStorage.querySelector("img.eh-img") as HTMLImageElement;
      expect(imgStorage.getAttribute("srcset")).toContain("/storage/v1/render/image/public/");
      expect(imgStorage.getAttribute("sizes")).toBe("100vw");

      const obca = wrap(
        <SliderRender
          config={{ items: [{ image: EXTERNAL_COVER, title_pl: "Obca" }], autoplay: false }}
          lang="pl"
        />,
      ).container;
      const imgObca = obca.querySelector("img.eh-img") as HTMLImageElement;
      expect(imgObca.getAttribute("srcset")).toBeNull();
      expect(imgObca.getAttribute("sizes")).toBeNull();
    });

    it("pobiera pierwszy slajd z wysokim priorytetem, a pozostałe z niskim", () => {
      const { container } = wrap(<SliderRender config={{ items, autoplay: false }} lang="pl" />);
      const imgs = container.querySelectorAll("img.eh-img");
      expect(imgs[0].getAttribute("fetchpriority")).toBe("high");
      expect(imgs[0].getAttribute("loading")).toBe("eager");
      expect(imgs[1].getAttribute("fetchpriority")).toBe("low");
      expect(imgs[1].getAttribute("loading")).toBe("lazy");
      fireEvent.click(navButton(container, "next"));
      expect(container.querySelectorAll("img.eh-img")[1].getAttribute("fetchpriority")).toBe(
        "auto",
      );
    });

    it("wariant multi-card pokazuje wszystkie karty naraz i prosi o rozmiar właściwy dla kolumn", () => {
      const { container } = wrap(
        <SliderRender
          config={{
            variant: "multi-card",
            items: [
              { image: STORAGE_COVER, title_pl: "Karta 1" },
              { image: STORAGE_COVER_2, title_pl: "Karta 2" },
            ],
            columns: 2,
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      const imgs = Array.from(container.querySelectorAll(".eh-card-media img"));
      expect(imgs).toHaveLength(2);
      for (const img of imgs) {
        expect((img as HTMLImageElement).style.opacity).toBe("1");
        expect(img.getAttribute("sizes")).toBe(sliderMultiCardSizes(2));
      }
    });

    it("wariant split-feature prosi o rozmiary połówkowe", () => {
      const { container } = wrap(
        <SliderRender
          config={{
            variant: "split-feature",
            items: [{ image: STORAGE_COVER, title_pl: "Split" }],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      expect(container.querySelector("img.eh-img")?.getAttribute("sizes")).toBe(SLIDER_SPLIT_SIZES);
    });

    it("obraz zepsuty już przy montażu przechodzi na obraz zastępczy bez czekania na zdarzenie", () => {
      const proto = window.HTMLImageElement.prototype;
      const opisComplete = Object.getOwnPropertyDescriptor(proto, "complete");
      const opisNaturalWidth = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
      Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
      Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => 0 });
      try {
        const { container } = wrap(
          <SliderRender
            config={{ items: [{ image: EXTERNAL_COVER, title_pl: "Zepsuty" }], autoplay: false }}
            lang="pl"
          />,
        );
        const img = container.querySelector("img.eh-img") as HTMLImageElement;
        expect(img.getAttribute("src")).toContain("data:image/svg+xml");
      } finally {
        if (opisComplete) Object.defineProperty(proto, "complete", opisComplete);
        else Reflect.deleteProperty(proto, "complete");
        if (opisNaturalWidth) Object.defineProperty(proto, "naturalWidth", opisNaturalWidth);
        else Reflect.deleteProperty(proto, "naturalWidth");
      }
    });

    it("zepsuty obraz slajdu przechodzi najpierw na okładkę zapasową z bazy", async () => {
      fallbackImgs.rows = [{ cover_image_url: STORAGE_COVER_2 }];
      const { container } = wrap(
        <SliderRender
          config={{
            items: [
              { image: "nie-jest-adresem", title_pl: "Bez adresu" },
              { image: STORAGE_COVER, title_pl: "Zepsuty" },
            ],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      const imgs = () => container.querySelectorAll("img.eh-img");
      // Slajd bez adresu dostaje okładkę zapasową od razu - to dowód, że
      // zapytanie o fallbacki zdążyło się rozstrzygnąć.
      await waitFor(() => expect(imgs()[0].getAttribute("src")).toBe(STORAGE_COVER_2));
      fireEvent.error(imgs()[1]);
      expect(imgs()[1].getAttribute("src")).toBe(STORAGE_COVER_2);
    });

    it("gdy okładka zapasowa jest tym samym adresem co oryginał, sięga po wbudowany placeholder", async () => {
      fallbackImgs.rows = [{ cover_image_url: STORAGE_COVER }];
      const { container } = wrap(
        <SliderRender
          config={{
            items: [
              { image: "nie-jest-adresem", title_pl: "Bez adresu" },
              { image: STORAGE_COVER, title_pl: "Ta sama okładka" },
            ],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      const imgs = () => container.querySelectorAll("img.eh-img");
      // Pierwszy slajd dostaje okładkę zapasową z bazy - to dowód, że
      // zapytanie o fallbacki zdążyło się rozstrzygnąć.
      await waitFor(() => expect(imgs()[0].getAttribute("src")).toBe(STORAGE_COVER));
      fireEvent.error(imgs()[1]);
      expect(imgs()[1].getAttribute("src")).toContain("data:image/svg+xml");
    });

    it("rozdziela okładki zapasowe cyklicznie po slajdach", async () => {
      fallbackImgs.rows = [
        { cover_image_url: STORAGE_COVER },
        { cover_image_url: STORAGE_COVER_2 },
      ];
      const { container } = wrap(
        <SliderRender
          config={{
            items: [1, 2, 3, 4].map((n) => ({ image: "nie-jest-adresem", title_pl: `S${n}` })),
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      await waitFor(() =>
        expect(container.querySelectorAll("img.eh-img")[0].getAttribute("src")).toBe(STORAGE_COVER),
      );
      const src = Array.from(container.querySelectorAll("img.eh-img")).map((i) =>
        i.getAttribute("src"),
      );
      expect(src).toEqual([STORAGE_COVER, STORAGE_COVER_2, STORAGE_COVER, STORAGE_COVER_2]);
    });
  });

  describe("SliderRender - wiązanie slajdu z wpisem", () => {
    it("wartości wpisane ręcznie wygrywają z danymi na żywo, a puste i same spacje ustępują", () => {
      refs.map = new Map([
        [
          "post-7",
          {
            cover: STORAGE_COVER,
            href: "/na-zywo",
            authorName: "Redakcja",
            authorAvatar: "",
            authorSlug: "redakcja",
            title: "Tytuł na żywo",
            excerpt: "Zajawka na żywo",
          },
        ],
      ]);
      const { container } = wrap(
        <SliderRender
          config={{
            items: [
              { image: "", postId: "post-7", title_pl: "Tytuł redakcji", subtitle_pl: "   " },
            ],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      expect(within(container).getByText("Tytuł redakcji")).toBeTruthy();
      expect(within(container).getByText("Zajawka na żywo")).toBeTruthy();
      expect(container.querySelector("a")?.getAttribute("href")).toBe("/na-zywo");
      expect(container.querySelector("img.eh-img")?.getAttribute("src")).toBe(STORAGE_COVER);
    });

    it("podmienia pole tytułu właściwe dla języka widoku", () => {
      refs.map = new Map([
        [
          "post-8",
          {
            cover: EXTERNAL_COVER,
            href: "/live",
            authorName: "",
            authorAvatar: "",
            authorSlug: "",
            title: "Live English title",
            excerpt: "Live English excerpt",
          },
        ],
      ]);
      const { container } = wrap(
        <SliderRender
          config={{ items: [{ image: "", postId: "post-8", title_pl: "Polski" }], autoplay: false }}
          lang="en"
        />,
      );
      expect(within(container).getByText("Live English title")).toBeTruthy();
    });
  });

  describe("SliderRender - warianty poza editorial-hero", () => {
    const bezOdnosnika: SliderItem[] = [
      { image: EXTERNAL_COVER, title_pl: "", subtitle_pl: "Zajawka 1", category_pl: "Analiza" },
      { image: EXTERNAL_COVER, title_pl: "Bez linku 2", subtitle_pl: "Zajawka 2" },
    ];

    it.each([...SLIDER_VARIANT_VALUES])(
      "wariant %s rysuje kategorię w kolorze domyślnym i twardą spację zamiast pustego tytułu",
      (variant) => {
        const { container } = wrap(
          <SliderRender
            config={{ variant, items: bezOdnosnika, columns: 1, autoplay: false }}
            lang="pl"
          />,
        );
        const badge = Array.from(container.querySelectorAll("span")).find(
          (s) => s.textContent === "Analiza",
        );
        expect(badge?.getAttribute("style") ?? "").toMatch(/#ef6c2e|rgb\(239, 108, 46\)/);
        expect((container.querySelector(".cms-post-title") as HTMLElement).textContent).toBe(
          "\u00A0",
        );
      },
    );

    it.each(["editorial-hero", "cinematic-overlay", "split-feature", "minimal-strip"] as const)(
      "wariant %s nazywa strzałki po angielsku przy lang=en",
      (variant) => {
        const { container } = wrap(
          <SliderRender config={{ variant, items, autoplay: false }} lang="en" />,
        );
        expect(container.querySelector('button[aria-label="Next slide"]')).toBeTruthy();
        expect(container.querySelector('button[aria-label="Previous slide"]')).toBeTruthy();
      },
    );

    it("wariant split-feature rysuje kropki w trybie zwartym", () => {
      const { container } = wrap(
        <SliderRender
          config={{ variant: "split-feature", items: plainSlides, autoplay: false }}
          lang="pl"
        />,
      );
      const kropka = within(container).getByLabelText("Slajd 1");
      expect(kropka.parentElement?.parentElement?.className).toContain("mt-2");
    });

    it("wariant cinematic-overlay przełącza slajd własnymi kropkami, nie otwierając wpisu", () => {
      const { container } = wrap(
        <SliderRender
          config={{ variant: "cinematic-overlay", items, autoplay: false }}
          lang="pl"
        />,
      );
      fireEvent.click(within(container).getByLabelText("Slajd 3"));
      expect(within(container).getByText("Slajd 3")).toBeTruthy();
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it("wariant multi-card przepuszcza kliknięcie kadru do odnośnika, ale blokuje je tuż po przeciągnięciu", () => {
      const { container } = wrap(
        <SliderRender
          config={{ variant: "multi-card", items, columns: 1, autoplay: false }}
          lang="pl"
        />,
      );
      const kadr = container.querySelector(".eh-card-media") as HTMLElement;
      fireEvent.click(kadr);
      expect(routerStub.navigate).toHaveBeenCalledWith({ href: "/p1" });

      routerStub.navigate.mockClear();
      drag(container.querySelector(".eh-multi-surface") as HTMLElement, 300, 200);
      fireEvent.click(kadr);
      expect(routerStub.navigate).not.toHaveBeenCalled();
    });

    it("wariant editorial-hero rezerwuje miejsce na zajawkę, gdy ma ją choć jeden slajd", () => {
      const { container } = wrap(
        <SliderRender
          config={{
            items: [
              { image: EXTERNAL_COVER, title_pl: "Pierwszy bez zajawki" },
              { image: EXTERNAL_COVER, title_pl: "Drugi", subtitle_pl: "Ma zajawkę" },
            ],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      const zajawka = container.querySelector("p.cms-post-excerpt");
      expect(zajawka).toBeTruthy();
      expect(zajawka?.textContent).toBe("\u00A0");
    });

    it("przycina tytuł do 220, a zajawkę do 160 znaków", () => {
      const dlugi = "x".repeat(400);
      const { container } = wrap(
        <SliderRender
          config={{
            items: [{ image: EXTERNAL_COVER, title_pl: dlugi, subtitle_pl: dlugi }],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      const tytul = container.querySelector(".cms-post-title") as HTMLElement;
      const zajawka = container.querySelector("p.cms-post-excerpt") as HTMLElement;
      expect(tytul.textContent).toHaveLength(220);
      expect(tytul.textContent?.endsWith("…")).toBe(true);
      expect(zajawka.textContent).toHaveLength(160);
      expect(zajawka.textContent?.endsWith("…")).toBe(true);
    });

    it("niebezpieczny adres slajdu jest neutralizowany do # i nie otwiera nowej karty", () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const { container } = wrap(
        <SliderRender
          config={{
            items: [{ image: EXTERNAL_COVER, title_pl: "Podejrzany", href: "javascript:alert(1)" }],
            autoplay: false,
          }}
          lang="pl"
        />,
      );
      expect(container.querySelector("a")?.getAttribute("href")).toBe("#");
      fireEvent.click(media(container));
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });
  });
});

describe("SectionLabelRender", () => {
  const variants = SECTION_LABEL_VARIANTS.map((v) => v.value);

  it("renders every variant at md size with an action link", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender
          label="Najnowsze"
          action="więcej"
          href="/all"
          accent="#FA9346"
          variant={variant}
        />,
      );
      expect(container.textContent).toContain("Najnowsze");
    }
  });

  it("renders every variant at sm size and without an action", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender label="Etykieta" accent="#222222" variant={variant} size="sm" />,
      );
      expect(container.textContent).toContain("Etykieta");
    }
  });

  it("applies label/action color + size overrides", () => {
    const { container } = render(
      <SectionLabelRender
        label="Tytuł"
        action="zobacz"
        href="/x"
        accent="#3366ff"
        variant="filled-bar"
        labelColor="#fff"
        labelSize="14px"
        actionColor="#eee"
        actionSize="11px"
      />,
    );
    expect(container.textContent).toContain("Tytuł");
  });

  it("renders the slanted ribbon and badge variants with action spans (no href)", () => {
    for (const variant of ["badge-filled", "slanted-ribbon-rule"] as const) {
      const { container } = render(
        <SectionLabelRender label="Wstęga" action="więcej" accent="#ffffff" variant={variant} />,
      );
      expect(container.textContent).toContain("Wstęga");
    }
  });

  it("renders every variant at sm size WITH an action (sm action spans)", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender
          label="Mała"
          action="więcej"
          href="/x"
          accent="#FA9346"
          variant={variant}
          size="sm"
        />,
      );
      expect(container.textContent).toContain("Mała");
    }
  });

  it("computes contrast for 3-char hex and non-hex accents (filled label)", () => {
    expect(
      render(<SectionLabelRender label="A" accent="#fff" variant="badge-filled" />).container
        .textContent,
    ).toContain("A");
    expect(
      render(<SectionLabelRender label="B" accent="#000" variant="filled-bar" />).container
        .textContent,
    ).toContain("B");
    expect(
      render(<SectionLabelRender label="C" accent="oklch(0.5 0.1 200)" variant="badge-filled" />)
        .container.textContent,
    ).toContain("C");
  });
});

describe("resolveAccentColor", () => {
  it("resolves named presets", () => {
    for (const name of [
      "military",
      "finance",
      "diplomacy",
      "transport",
      "cyber",
      "neutral",
      "brand",
      "unknown",
    ]) {
      expect(resolveAccentColor(name)).toMatch(/oklch|#/);
    }
  });

  it("passes raw css colors through unchanged", () => {
    expect(resolveAccentColor("#abcdef")).toBe("#abcdef");
    expect(resolveAccentColor("oklch(0.5 0.1 200)")).toContain("oklch");
    expect(resolveAccentColor("hsl(200 50% 50%)")).toContain("hsl");
    expect(resolveAccentColor("rgb(1,2,3)")).toContain("rgb");
    expect(resolveAccentColor("var(--x)")).toContain("var(");
  });

  it("defaults to brand orange when empty", () => {
    expect(resolveAccentColor()).toBe("#FA9346");
  });
});
