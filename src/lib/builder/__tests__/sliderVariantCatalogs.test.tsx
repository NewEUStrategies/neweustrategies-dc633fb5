// CZYSTA (BEZZDARZENIOWA) WARSTWA RENDERERA SLIDERÓW: katalogi wartości,
// arkusz CSS instancji i reguły mobilne.
//
// `sliderVariants.tsx` nie eksportuje ANI JEDNEJ ze swoich funkcji czystych -
// `resolveNavStyle`, `NavArrowGlyph`, `cssLen`, `pickSlideStrings` i cały
// generator arkusza instancji są modulo-prywatne. Jedynym wejściem jest
// `<SliderRender>`, więc ten plik steruje nimi WYŁĄCZNIE konfiguracją widgetu
// i asertuje DOM. Świadomie nie ma tu ani jednego `fireEvent`, ani jednego
// zegara i ani jednej atrapy routera ze szpiegiem: to, co poniżej, musi być
// prawdą już po samym zamontowaniu.
//
// CO TU JEST NAPRAWDĘ DO OBRONY
//
// 1. KATALOG JEST KONTRAKTEM, NIE PODPOWIEDZIĄ. `sliderOptions` wystawia osiem
//    zamkniętych zbiorów, a panel buduje z nich kontrolki. Renderer musi umieć
//    narysować KAŻDĄ wartość z katalogu (osiem kształtów strzałek, sześć stylów
//    tła, cztery pozycje, pięć wariantów) i musi cofnąć się do wartości
//    domyślnej dla wartości spoza katalogu. Inaczej redaktor wybiera opcję,
//    która „nic nie robi" - najczęstsza skarga na ten widget.
//
// 2. TYPOGRAFIA INSTANCJI TO BIAŁA LISTA, A NIE CZYSZCZENIE. Rozmiary z panelu
//    trafiają do zmiennych w stylu korzenia, a klasa-znacznik włącza statyczną
//    regułę `!important` arkusza wspólnego (inline-style przegrywał z regułami
//    `WidgetView`). Wartość spoza białej listy ma być ODRZUCONA w całości -
//    bez zmiennej i bez znacznika - a nie „oczyszczona" do połowicznej
//    deklaracji, inaczej pole tekstowe panelu staje się wektorem wstrzyknięcia.
//
// 3. REGUŁY MOBILNE MAJĄ TRZY ADRESY. Ten sam rozmiar musi działać pod
//    `@media (max-width: 767px)` (prawdziwa przeglądarka) i pod
//    `[data-builder-renderer]` / `[data-visual-canvas]` z `data-device=mobile`
//    (kanwa i podgląd symulują telefon ATRYBUTEM, nie szerokością okna). Gdy
//    rozmiar mobilny równa się desktopowemu, znacznika mobilnego nie ma.
//
// 4. ŻADNEGO `<style>` W `<body>`. Wartości instancji żyją w stylu korzenia,
//    reguły raz na dokument w arkuszach `precedence` (React przenosi je do
//    `<head>`); dwa slidery na jednej stronie niosą własne zmienne.
//
// GRANICA DOWODU
//  * Responsywność renderera jest w CZYSTYM CSS (arkusz `SHARED_STYLES`), a
//    happy-dom nie liczy kaskady ani nie ma viewportu - dlatego reguły
//    sprawdzamy jako TEKST arkusza, a wartości jako zmienne korzenia.
//  * Arkusze `precedence` zostają w `<head>` między testami (React ich nie
//    zdejmuje), więc BRAK arkusza mobilnego sprawdzamy w HTML-u serwera.
//  * Gałęzie osiągalne wyłącznie zdarzeniem (przeciąganie, klik w strzałkę,
//    nawigacja, autoplay) leżą poza tym plikiem z premedytacją - mają własne
//    pliki i własne atrapy routera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import { minifyStaticCss } from "@/lib/css/minifyStaticCss";
import type { SupabaseFromStub } from "@/test/supabase";
import type { LcpImage } from "../aboveFold";

const sb = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  // Slider czyta DWIE tabele w tle: `posts` (okładki-fallbacki) oraz
  // `site_settings` (globalne defaulty karuzeli). Obie odpowiadają pustką,
  // więc obraz zastępczy jest deterministyczny, a defaulty karuzeli schodzą
  // do CAROUSEL_DEFAULTS.
  fromStub.setResponse("posts", () => ok([]));
  fromStub.setResponse("site_settings", () => ok([]));
  sb.from = fromStub;
  return { supabase: { from: fromStub.from, rpc: async () => ({ data: [], error: null }) } };
});

// Wiązanie slajdu z wpisem ma własny plik; tutaj slajdy są w pełni ręczne.
vi.mock("@/lib/builder/contentRefs", () => ({
  useResolvedPostRefs: () => new Map(),
}));

// Router jest nieobecny (`useRouter() === null`) - ten plik niczego nie klika,
// a `AppLink` musi umieć się wyrenderować bez kontekstu trasy.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => null,
  Link: (p: { children?: React.ReactNode }) => <>{p.children}</>,
}));

import * as sliderOptions from "../sliderOptions";
import * as sliderVariants from "../sliderVariants";
import {
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SLIDER_VARIANT_VALUES,
  SliderRender,
  type NavBgStyle,
  type NavPosition,
  type SliderConfig,
  type SliderItem,
  type SliderVariant,
} from "../sliderVariants";

// RODO: żadnych prawdziwych osób ani prawdziwych domen - wyłącznie example.com.
const ITEMS: SliderItem[] = [
  {
    image: "https://obrazy.example.com/slajd-1.jpg",
    title_pl: "Pierwszy slajd",
    title_en: "First slide",
    subtitle_pl: "Zajawka pierwszego slajdu.",
    subtitle_en: "First slide excerpt.",
    category_pl: "Analiza",
    href: "/wpis-1",
  },
  {
    image: "https://obrazy.example.com/slajd-2.jpg",
    title_pl: "Drugi slajd",
    title_en: "Second slide",
    subtitle_pl: "Zajawka drugiego slajdu.",
    href: "/wpis-2",
  },
  {
    image: "https://obrazy.example.com/slajd-3.jpg",
    title_pl: "Trzeci slajd",
    title_en: "Third slide",
    href: "/wpis-3",
  },
];

function renderSlider(config: Partial<SliderConfig> = {}, lang: "pl" | "en" = "pl") {
  return render(<SliderRender config={{ items: ITEMS, autoplay: false, ...config }} lang={lang} />);
}

/** Korzeń slidera (niesie zmienne i znaczniki typografii instancji). */
function sliderRoot(container: ParentNode): HTMLElement {
  const root = container.querySelector<HTMLElement>(".eh-slider");
  if (!root) throw new Error("brak korzenia slidera");
  return root;
}

/** Zmienna typografii instancji ze stylu korzenia (`""`, gdy nieustawiona). */
const rootVar = (container: ParentNode, name: string) =>
  sliderRoot(container).style.getPropertyValue(name);

/** Znaczniki typografii instancji na korzeniu, w kolejności klas. */
const typographyMarkers = (container: ParentNode) =>
  [...sliderRoot(container).classList].filter((c) => /^eh-(t|d|g|tm|dm)$/.test(c));

/** Zminifikowana treść arkusza zasobu `href` (React scala zasoby w jeden `<style>`). */
function resourceCss(href: string): string {
  const el = document.querySelector<HTMLStyleElement>(`style[data-href~="${href}"]`);
  return minifyStaticCss(el?.textContent ?? "");
}

/** HTML serwera samego slidera (zasoby `precedence` lądują na początku napisu). */
function serverHtml(config: Partial<SliderConfig>): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <SliderRender config={{ items: ITEMS, autoplay: false, ...config }} lang="pl" />
    </QueryClientProvider>,
  );
}

/** Zmienne typografii instancji w stylu korzenia. */
const TYPOGRAPHY_VARS = ["--abl-title-fs", "--eh-d", "--eh-g", "--eh-tm", "--eh-dm"];

/** Reguły typografii instancji w arkuszu wspólnym: korzeń (0,4,0) + cel. */
const BASE_TYPOGRAPHY_RULES = [
  ".eh-t.eh-t.eh-t.eh-t .cms-post-title{font-size:var(--abl-title-fs)!important}",
  ".eh-d.eh-d.eh-d.eh-d .cms-post-excerpt{font-size:var(--eh-d)!important}",
  ".eh-g.eh-g.eh-g.eh-g [data-eh-gap]{margin-top:var(--eh-g)!important}",
];

const prevButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("button.eh-prev");
const nextButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("button.eh-next");
const titleOf = (root: HTMLElement) => root.querySelector<HTMLElement>("h3.cms-post-title");
const excerptOf = (root: HTMLElement) => root.querySelector<HTMLElement>("p.cms-post-excerpt");

/**
 * STAN WCZYTANIA OBRAZU JEST WEJŚCIEM TESTU, NIE DOMYŚLNĄ WARTOŚCIĄ ŚRODOWISKA.
 *
 * `ResilientSliderImage` ma efekt montażu, który podmienia okładkę na obrazek
 * zastępczy dokładnie dla kombinacji `complete === true && naturalWidth === 0`
 * (obraz „skończył się ładować" przed podpięciem handlera `error`, więc
 * zdarzenie już nie przyjdzie). happy-dom nigdy nie pobiera obrazów, więc
 * `naturalWidth` zawsze jest zerem, a o wyniku decyduje WYŁĄCZNIE startowa
 * wartość `complete` - a ta jest szczegółem WERSJI happy-dom (20.9 zaczyna od
 * `false`, 20.14 od `true`). Test, który tej wartości nie ustawia, mierzy więc
 * wersję zależności, a nie renderer: w jednej wersji przechodzi przypadkiem,
 * w drugiej wywraca się przypadkiem.
 *
 * Dlatego każdy test dotykający tego efektu stawia oba gettery JAWNIE na czas
 * jednego przebiegu i przywraca oryginalne deskryptory w `finally`.
 */
function withImageLoadState(
  state: { complete: boolean; naturalWidth: number },
  run: () => void,
): void {
  const proto = window.HTMLImageElement.prototype;
  const completeDesc = Object.getOwnPropertyDescriptor(proto, "complete");
  const widthDesc = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
  Object.defineProperty(proto, "complete", { configurable: true, get: () => state.complete });
  Object.defineProperty(proto, "naturalWidth", {
    configurable: true,
    get: () => state.naturalWidth,
  });
  try {
    // ŁATKA MUSI SIĘ ZAŁOŻYĆ, zanim cokolwiek zmierzymy. `complete` startuje w
    // happy-dom 20.9 z `false`, a od 20.14 z `true`, a `naturalWidth` bywa
    // niezerowa domyślnie - więc test „zdrowej okładki" mógłby przejść MIMO
    // nieudanej podmiany getterów i zielony wynik nie dowodziłby niczego.
    // Ta asercja zamienia takie ciche przejście w jawną porażkę.
    const probe = document.createElement("img");
    expect(probe.complete, "łatka `complete` nie założyła się").toBe(state.complete);
    expect(probe.naturalWidth, "łatka `naturalWidth` nie założyła się").toBe(state.naturalWidth);
    run();
  } finally {
    if (completeDesc) Object.defineProperty(proto, "complete", completeDesc);
    else Reflect.deleteProperty(proto, "complete");
    if (widthDesc) Object.defineProperty(proto, "naturalWidth", widthDesc);
    else Reflect.deleteProperty(proto, "naturalWidth");
  }
}

/** Okładka wczytana i niosąca piksele - efekt montażu nie ma jej ruszać. */
const withLoadedImages = (run: () => void) =>
  withImageLoadState({ complete: true, naturalWidth: 1200 }, run);

afterEach(cleanup);

// ------------------------------------------------------------------
// Krawędź modułu
// ------------------------------------------------------------------

describe("sliderVariants - krawędź modułu wobec sliderOptions", () => {
  it("oddaje TE SAME obiekty katalogów co lekki moduł sliderOptions, bez kopiowania tablic", () => {
    // Re-eksport ma być krawędzią, nie kopią: miejsca wywołania importujące
    // `sliderOptions` (żeby nie ciągnąć 53 kB renderera do głównego bundla)
    // i te importujące historycznie `sliderVariants` muszą porównywać się
    // referencyjnie, inaczej `asOneOf` po jednej stronie przepuści wartość,
    // którą druga strona odrzuci.
    expect(sliderVariants.SLIDER_VARIANTS).toBe(sliderOptions.SLIDER_VARIANTS);
    expect(sliderVariants.SLIDER_VARIANT_VALUES).toBe(sliderOptions.SLIDER_VARIANT_VALUES);
    expect(sliderVariants.SLIDER_AUTHOR_DISPLAYS).toBe(sliderOptions.SLIDER_AUTHOR_DISPLAYS);
    expect(sliderVariants.SLIDER_RATIOS).toBe(sliderOptions.SLIDER_RATIOS);
    expect(sliderVariants.SLIDER_ROUNDED_VALUES).toBe(sliderOptions.SLIDER_ROUNDED_VALUES);
    expect(sliderVariants.NAV_ARROW_VARIANTS).toBe(sliderOptions.NAV_ARROW_VARIANTS);
    expect(sliderVariants.NAV_ARROW_VARIANT_VALUES).toBe(sliderOptions.NAV_ARROW_VARIANT_VALUES);
    expect(sliderVariants.NAV_BG_STYLES).toBe(sliderOptions.NAV_BG_STYLES);
    expect(sliderVariants.NAV_POSITIONS).toBe(sliderOptions.NAV_POSITIONS);
  });

  it("trzyma listy wartości zgodne z listami etykiet panelu", () => {
    // Panel rysuje kontrolkę z listy etykiet, a renderer zawęża wartość listą
    // wartości. Rozjazd tych dwóch list = opcja widoczna w panelu, której
    // renderer nie przyjmie.
    expect([...sliderVariants.SLIDER_VARIANT_VALUES]).toEqual(
      sliderVariants.SLIDER_VARIANTS.map((v) => v.value),
    );
    expect([...sliderVariants.NAV_ARROW_VARIANT_VALUES]).toEqual(
      sliderVariants.NAV_ARROW_VARIANTS.map((v) => v.value),
    );
  });
});

// ------------------------------------------------------------------
// Ujednolicone strzałki - wspólny AngleChevron, jedna geometria
// ------------------------------------------------------------------

describe("SliderRender - ujednolicone strzałki nawigacji", () => {
  it.each(NAV_ARROW_VARIANT_VALUES)(
    "rysuje wspólny kąt dla wariantu %s w obu przyciskach",
    (arrowVariant) => {
      const { container } = renderSlider({ navArrowVariant: arrowVariant });
      const prev = prevButton(container);
      const next = nextButton(container);
      expect(prev).not.toBeNull();
      expect(next).not.toBeNull();
      // Ten sam znak po obu stronach: lewy kąt o otwartym wierzchołku.
      expect(prev?.querySelector("svg polyline")?.getAttribute("points")).toBe(
        "7.5 1.8 3.5 5 7.5 8.2",
      );
      // Prawy kąt - lustrzana geometria, nie transformacja.
      expect(next?.querySelector("svg polyline")?.getAttribute("points")).toBe(
        "3.5 1.8 7.5 5 3.5 8.2",
      );
      // Oba przyciski niosą wspólną klasę traktowania (subtelny, ghostowy).
      expect(prev?.className).toContain("eh-slider-arrow");
      expect(next?.className).toContain("eh-slider-arrow");
    },
  );

  it("daje każdemu wariantowi kształtu identyczną geometrię kąta", () => {
    // Bramka na „wariant z katalogu narysował coś innego": wszystkie warianty
    // muszą prowadzić do tego samego znaku, bo strzałki są ujednolicone.
    const drawn = NAV_ARROW_VARIANT_VALUES.map((arrowVariant) => {
      const { container, unmount } = renderSlider({ navArrowVariant: arrowVariant });
      const points =
        prevButton(container)?.querySelector("svg polyline")?.getAttribute("points") ?? "";
      unmount();
      return points;
    });
    expect(new Set(drawn).size).toBe(1);
  });

  it("trzyma kreskę kąta cienką (hairline) niezależnie od ustawienia panelu", () => {
    const { container } = renderSlider({ navArrowVariant: "chevron-bold", navArrowStroke: 4 });
    const svg = prevButton(container)?.querySelector("svg");
    expect(svg?.getAttribute("stroke-width")).toBe("0.85");
    expect(svg?.querySelector("polyline")?.getAttribute("vector-effect")).toBe(
      "non-scaling-stroke",
    );
  });

  it("trzyma kąt otwarty, a nie ostry szpic", () => {
    // Subtelność: wierzchołek znaku ma być rozwarty (~77°). Geometria
    // „8.2 1.8 2.4 5 8.2 8.2" dawała ostry szpic ~58° i wyglądała agresywnie.
    const { container } = renderSlider();
    const points =
      prevButton(container)?.querySelector("svg polyline")?.getAttribute("points") ?? "";
    const [tipAX, tipAY, apexX, apexY, tipBX, tipBY] = points.trim().split(/\s+/).map(Number);
    const v1 = { x: tipAX - apexX, y: tipAY - apexY };
    const v2 = { x: tipBX - apexX, y: tipBY - apexY };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const angle = (Math.acos(cos) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(70);
    expect(angle).toBeLessThan(95);
  });

  it("grubość kreski z panelu nie zmienia geometrii ujednoliconego kąta", () => {
    for (const stroke of [0.1, 9]) {
      const { container, unmount } = renderSlider({ navArrowStroke: stroke });
      expect(prevButton(container)?.querySelector("svg polyline")?.getAttribute("points")).toBe(
        "7.5 1.8 3.5 5 7.5 8.2",
      );
      expect(prevButton(container)?.querySelector("svg")?.getAttribute("stroke-width")).toBe(
        "0.85",
      );
      unmount();
    }
  });
});

// ------------------------------------------------------------------
// Katalog stylów i geometrii przycisków nawigacji
// ------------------------------------------------------------------

describe("SliderRender - katalog stylów i pozycji nawigacji", () => {
  it.each(NAV_BG_STYLES)("nadaje obu przyciskom klasę modyfikatora eh-nav-%s", (bgStyle) => {
    const { container } = renderSlider({ navBgStyle: bgStyle });
    expect(prevButton(container)?.className).toContain(`eh-nav-${bgStyle}`);
    expect(nextButton(container)?.className).toContain(`eh-nav-${bgStyle}`);
  });

  it("wraca do stylu glass dla wartości spoza katalogu stylów tła", () => {
    const { container } = renderSlider({ navBgStyle: "neon" as unknown as NavBgStyle });
    expect(prevButton(container)?.className).toContain("eh-nav-glass");
  });

  it.each(NAV_POSITIONS)("ustawia na obu przyciskach data-pos=%s", (position) => {
    const { container } = renderSlider({ navPosition: position });
    expect(prevButton(container)?.getAttribute("data-pos")).toBe(position);
    expect(nextButton(container)?.getAttribute("data-pos")).toBe(position);
  });

  it("wraca do pozycji mid dla wartości spoza katalogu pozycji", () => {
    const { container } = renderSlider({ navPosition: "lewa" as unknown as NavPosition });
    expect(prevButton(container)?.getAttribute("data-pos")).toBe("mid");
  });

  it("podnosi zbyt mały rozmiar przycisku do dolnej granicy 28 px", () => {
    const { container } = renderSlider({ navSizePx: 5 });
    expect(prevButton(container)?.style.getPropertyValue("--nav-size")).toBe("28px");
  });

  it("obcina zbyt duży rozmiar przycisku do górnej granicy 96 px", () => {
    const { container } = renderSlider({ navSizePx: 500 });
    expect(prevButton(container)?.style.getPropertyValue("--nav-size")).toBe("96px");
  });

  it("czyta rozmiar przycisku zapisany przez panel jako string liczbowy", () => {
    // Kontrolki panelu commitują stringi - "40" musi znaczyć 40 px, a nie
    // „brak wartości".
    const { container } = renderSlider({ navSizePx: "40" as unknown as number });
    expect(prevButton(container)?.style.getPropertyValue("--nav-size")).toBe("40px");
  });

  it("zamienia promień 999 i większy na pełne koło", () => {
    const { container } = renderSlider({ navRoundedPx: 999 });
    expect(prevButton(container)?.style.getPropertyValue("--nav-radius")).toBe("9999px");
  });

  it("zamienia promień ujemny na zero zamiast wpisywać ujemną długość do CSS", () => {
    const { container } = renderSlider({ navRoundedPx: -20 });
    expect(prevButton(container)?.style.getPropertyValue("--nav-radius")).toBe("0px");
  });

  it("przepuszcza promień pośredni bez zmian", () => {
    const { container } = renderSlider({ navRoundedPx: 12 });
    expect(prevButton(container)?.style.getPropertyValue("--nav-radius")).toBe("12px");
  });

  it("domyślnie rysuje przyciski jako pełne koła o boku 52 px", () => {
    const { container } = renderSlider();
    const prev = prevButton(container);
    expect(prev?.style.getPropertyValue("--nav-size")).toBe("52px");
    expect(prev?.style.getPropertyValue("--nav-radius")).toBe("9999px");
  });

  it("przenosi kolor tła i kolor strzałki z panelu do zmiennych CSS przycisku", () => {
    const { container } = renderSlider({ navBgColor: "#101820", navArrowColor: "#f5c518" });
    const prev = prevButton(container);
    expect(prev?.style.getPropertyValue("--nav-bg")).toBe("#101820");
    expect(prev?.style.getPropertyValue("--nav-arrow")).toBe("#f5c518");
  });

  it("ikona śledzie em przycisku z arkusza wspólnego, niezależnie od rozmiaru przycisku", () => {
    // Rozmiar ikony żyje we wspólnym arkuszu `.eh-slider-arrow svg` (11x10 px)
    // i w `AngleChevron` (calc(0.85em - 1px)); nie skaluje się z rozmiarem
    // przycisku z panelu - geometria strzałek jest ujednolicona.
    for (const size of [28, 52, 96]) {
      const { container, unmount } = renderSlider({ navSizePx: size });
      const svg = prevButton(container)?.querySelector("svg");
      expect(svg?.style.width).toBe("calc(0.85em - 1px)");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 11 10");
      unmount();
    }
  });

  it("trzyma kreskę ikony na 0.85 niezależnie od ustawienia grubości panelu", () => {
    for (const stroke of [0.1, 2.25, 9]) {
      const { container, unmount } = renderSlider({ navArrowStroke: stroke });
      expect(prevButton(container)?.querySelector("svg")?.getAttribute("stroke-width")).toBe(
        "0.85",
      );
      unmount();
    }
  });
});

// ------------------------------------------------------------------
// Katalog wariantów
// ------------------------------------------------------------------

/** Znacznik DOM, po którym poznajemy, że narysował się właściwy wariant. */
const VARIANT_MARKER: Record<SliderVariant, (root: HTMLElement) => boolean> = {
  // Tytuł POD kadrem, poza siatką split-feature. (Dawny znacznik - stały
  // promień 4 px - był w rzeczywistości defektem: kadr ignorował `rounded`.)
  "editorial-hero": (root) => {
    const media = root.querySelector("[data-widget-media]");
    const title = root.querySelector("h3.cms-post-title");
    return (
      media !== null &&
      title !== null &&
      !media.contains(title) &&
      root.querySelector(".md\\:grid-cols-2") === null
    );
  },
  "multi-card": (root) => root.querySelector(".eh-multi-card") !== null,
  "cinematic-overlay": (root) => root.querySelector("[data-widget-media].bg-black") !== null,
  "split-feature": (root) => root.querySelector(".md\\:grid-cols-2") !== null,
  "minimal-strip": (root) => root.querySelector("[data-thumb-strip]") !== null,
};

describe("SliderRender - katalog wariantów", () => {
  it.each(SLIDER_VARIANT_VALUES)("montuje wariant %s i rysuje jego własny szkielet", (variant) => {
    const { container } = renderSlider({ variant });
    expect(VARIANT_MARKER[variant](container)).toBe(true);
    expect(container.textContent).toContain("Pierwszy slajd");
  });

  it.each(SLIDER_VARIANT_VALUES)(
    "rysuje w wariancie %s tyle warstw wypełniających, ile jest slajdów (`<img>` tylko dla pokazanych)",
    (variant) => {
      const { container } = renderSlider({ variant });
      const layers = [...container.querySelectorAll("[data-fill-image]")];
      expect(layers).toHaveLength(ITEMS.length);
      // Multi-card pokazuje wszystkie karty naraz; warianty stosu montują
      // `<img>` tylko dla slajdu aktywnego, reszta to puste zaślepki.
      const expected =
        variant === "multi-card"
          ? ITEMS.map(() => "IMG")
          : ["IMG", ...ITEMS.slice(1).map(() => "SPAN")];
      expect(layers.map((el) => el.tagName)).toEqual(expected);
    },
  );

  it("wraca do wariantu editorial-hero, gdy dokument niesie wariant spoza katalogu", () => {
    const { container } = renderSlider({ variant: "kafelki" as unknown as SliderVariant });
    expect(VARIANT_MARKER["editorial-hero"](container)).toBe(true);
  });

  it("bez typografii korzeń niesie wyłącznie wspólną klasę eh-slider i zmienne przejścia", () => {
    const { container } = renderSlider();
    const root = sliderRoot(container);
    expect(root.className).toBe("w-full h-full min-h-0 eh-slider");
    for (const name of TYPOGRAPHY_VARS) expect(root.style.getPropertyValue(name)).toBe("");
    expect(root.style.getPropertyValue("--eh-columns")).toBe("3");
  });

  it("przenosi czas przejścia ślizgu do zmiennej CSS korzenia", () => {
    const { container } = renderSlider({ speedMs: 900 });
    expect(
      container.querySelector<HTMLElement>(".eh-slider")?.style.getPropertyValue("--eh-speed"),
    ).toBe("900ms");
  });

  it("zawęża zbyt długi czas przejścia do górnej granicy 3000 ms", () => {
    const { container } = renderSlider({ speedMs: 99999 });
    expect(
      container.querySelector<HTMLElement>(".eh-slider")?.style.getPropertyValue("--eh-speed"),
    ).toBe("3000ms");
  });
});

// ------------------------------------------------------------------
// Chrom nawigacji zależny od liczby slajdów
// ------------------------------------------------------------------

describe("SliderRender - chrom nawigacji przy jednym slajdzie", () => {
  it("nie rysuje ani strzałek, ani kropek, ani paska miniatur dla jednego slajdu", () => {
    const single = [ITEMS[0]];
    for (const variant of SLIDER_VARIANT_VALUES) {
      const { container, unmount } = renderSlider({ variant, items: single });
      expect(prevButton(container)).toBeNull();
      expect(nextButton(container)).toBeNull();
      expect(container.querySelector("[data-thumb-strip]")).toBeNull();
      expect(container.querySelector('button[aria-label="Slajd 1"]')).toBeNull();
      unmount();
    }
  });

  it("rysuje po jednej kropce na slajd w wariancie cinematic-overlay", () => {
    const { container } = renderSlider({ variant: "cinematic-overlay" });
    const dots = container.querySelectorAll('button[aria-label^="Slajd "]');
    expect(dots).toHaveLength(ITEMS.length);
  });

  it("rysuje po jednej miniaturze na slajd w wariancie minimal-strip", () => {
    const { container } = renderSlider({ variant: "minimal-strip" });
    const strip = container.querySelector("[data-thumb-strip]");
    expect(strip?.querySelectorAll("button")).toHaveLength(ITEMS.length);
    expect(strip?.querySelectorAll("img")).toHaveLength(ITEMS.length);
  });

  it("lokalizuje etykiety strzałek bocznych zgodnie z językiem widoku", () => {
    const { container: pl } = renderSlider({}, "pl");
    expect(prevButton(pl)?.getAttribute("aria-label")).toBe("Poprzedni slajd");
    expect(nextButton(pl)?.getAttribute("aria-label")).toBe("Następny slajd");

    const { container: en } = renderSlider({}, "en");
    expect(prevButton(en)?.getAttribute("aria-label")).toBe("Previous slide");
    expect(nextButton(en)?.getAttribute("aria-label")).toBe("Next slide");
  });

  // All navigation controls use the widget locale.
  it("kropki nawigacji mają angielskie etykiety przy lang=en", () => {
    const { container } = renderSlider({}, "en");
    expect(container.querySelector('button[aria-label="Slide 1"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Slajd 1"]')).toBeNull();
  });
});

// ------------------------------------------------------------------
// Typografia instancji: zmienne korzenia + statyczne reguły arkusza wspólnego
// ------------------------------------------------------------------

describe("SliderRender - typografia instancji: biała lista jednostek", () => {
  it.each(["26", "26px", "1.5rem", "80%", "12pt", "5vw", "3vh", "2em"])(
    "przyjmuje zapis rozmiaru %s i wystawia go zmienną korzenia ze znacznikiem",
    (raw) => {
      const { container } = renderSlider({ typography: { fontSize: { desktop: raw } } });
      const expected = /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
      expect(rootVar(container, "--abl-title-fs")).toBe(expected);
      expect(typographyMarkers(container)).toEqual(["eh-t"]);
    },
  );

  it.each(["", "   ", "abc", "26px !important", "26}<script>", "calc(1px + 2px)", "-4px", "26 px"])(
    "odrzuca zapis rozmiaru %s w całości, zamiast go czyścić",
    (raw) => {
      const { container } = renderSlider({ typography: { fontSize: { desktop: raw } } });
      // Ani zmienna, ani znacznik nie mogą powstać - to jedyna bariera między
      // polem tekstowym panelu a deklaracją `!important` w dokumencie.
      expect(rootVar(container, "--abl-title-fs")).toBe("");
      expect(typographyMarkers(container)).toEqual([]);
      expect(sliderRoot(container).getAttribute("style")).not.toContain("script");
    },
  );

  it("nie montuje żadnego arkusza w treści, gdy nie ma ani typografii, ani rozmiarów z panelu", () => {
    const { container } = renderSlider();
    expect(container.querySelectorAll("style")).toHaveLength(0);
    expect(typographyMarkers(container)).toEqual([]);
    expect(document.querySelectorAll('style[data-href~="nes-slider-shared-v1"]')).toHaveLength(1);
  });

  it("bierze rozmiary z panelu slidera, gdy sekcja typografii ich nie definiuje", () => {
    const { container } = renderSlider({ titleSizePx: 30, subtitleSizePx: 14 });
    expect(rootVar(container, "--abl-title-fs")).toBe("30px");
    expect(rootVar(container, "--eh-d")).toBe("14px");
    expect(typographyMarkers(container)).toEqual(["eh-t", "eh-d"]);
  });

  it("pozwala typografii wygrać z rozmiarem wpisanym w panelu slidera", () => {
    const { container } = renderSlider({
      titleSizePx: 30,
      typography: { fontSize: { desktop: "44px" } },
    });
    expect(rootVar(container, "--abl-title-fs")).toBe("44px");
    expect(sliderRoot(container).getAttribute("style")).not.toContain("30px");
  });

  it("arkusz wspólny niesie reguły (0,5,0) z !important, które biją reguły widoku widgetu", () => {
    // Korzeń (0,4,0) + cel: ta sama waga co dawny arkusz instancji
    // (`.eh-slider` + potrojona klasa `useId`), więc kaskada się nie zmienia.
    renderSlider({ titleSizePx: 22 });
    const css = resourceCss("nes-slider-shared-v1");
    for (const rule of BASE_TYPOGRAPHY_RULES) expect(css).toContain(rule);
  });

  it("daje dwóm sliderom na jednej stronie własne wartości przy jednym arkuszu", () => {
    const { container } = render(
      <>
        <SliderRender config={{ items: ITEMS, autoplay: false, titleSizePx: 20 }} lang="pl" />
        <SliderRender config={{ items: ITEMS, autoplay: false, titleSizePx: 40 }} lang="pl" />
      </>,
    );
    const roots = [...container.querySelectorAll<HTMLElement>(".eh-slider")];
    expect(roots.map((r) => r.style.getPropertyValue("--abl-title-fs"))).toEqual(["20px", "40px"]);
    expect(container.querySelectorAll("style")).toHaveLength(0);
    expect(document.querySelectorAll('style[data-href~="nes-slider-shared-v1"]')).toHaveLength(1);
  });

  it("rozmiar tytułu ze zmiennej korzenia bije (0,4,0) !important widgetu, a (0,5,1) nie", () => {
    // happy-dom liczy kaskadę tylko częściowo, ale `!important` i specyficzność
    // rozstrzyga. Zapis "26" bez jednostki jest nieważny jako inline `font-size`,
    // więc 26px może pochodzić wyłącznie z reguły arkusza i zmiennej korzenia.
    // Rywale stoją w `<head>` PO arkuszu wspólnym (najtrudniejsza kolejność),
    // więc wygrana może wynikać wyłącznie ze specyficzności.
    const fontSizeWith = (rival: string, config: Partial<SliderConfig>) => {
      const { container, unmount } = renderSlider(config);
      container.setAttribute("data-w-id", "w1");
      const sheet = document.createElement("style");
      sheet.textContent = `${rival}{font-size:11px!important}`;
      document.head.append(sheet);
      try {
        const title = titleOf(container)!;
        return { inline: title.style.fontSize, computed: getComputedStyle(title).fontSize };
      } finally {
        sheet.remove();
        unmount();
      }
    };
    const widgetClass = "[data-w-id][data-w-id][data-w-id] .cms-post-title"; // (0,4,0)
    const widgetHeading = "[data-w-id][data-w-id][data-w-id] h3:not(.a):not(.b)"; // (0,5,1)
    const typed: Partial<SliderConfig> = { typography: { fontSize: { desktop: "26" } } };
    expect(fontSizeWith(widgetClass, typed)).toEqual({ inline: "", computed: "26px" });
    expect(fontSizeWith(widgetClass, {}).computed).toBe("11px");
    expect(fontSizeWith(widgetHeading, typed).computed).toBe("11px");
  });
});

describe("SliderRender - odstęp tytuł-opis", () => {
  it("nie emituje marginesu, gdy redakcja odstępu nie ustawiła", () => {
    const { container } = renderSlider({ titleSizePx: 22 });
    expect(rootVar(container, "--eh-g")).toBe("");
    expect(typographyMarkers(container)).not.toContain("eh-g");
    expect(excerptOf(container)?.style.marginTop).toBe("");
  });

  it("traktuje odstęp 0 jako świadome zero, a nie jako brak wartości", () => {
    const { container } = renderSlider({ typography: { titleDescriptionGapPx: 0 } });
    expect(rootVar(container, "--eh-g")).toBe("0px");
    expect(typographyMarkers(container)).toEqual(["eh-g"]);
    expect(excerptOf(container)?.style.marginTop).toBe("0px");
  });

  it("przenosi dodatni odstęp jednocześnie do zmiennej korzenia i do inline-stylu", () => {
    const { container } = renderSlider({ typography: { titleDescriptionGapPx: 18 } });
    expect(rootVar(container, "--eh-g")).toBe("18px");
    expect(excerptOf(container)?.style.marginTop).toBe("18px");
  });
});

// ------------------------------------------------------------------
// Typografia wspólna w inline-stylu
// ------------------------------------------------------------------

describe("SliderRender - wspólna typografia w inline-stylu", () => {
  it("przenosi rodzinę, stan, wagę, interlinię, tracking, wyrównanie, wersaliki i podkreślenie do tytułu i do zajawki", () => {
    const { container } = renderSlider({
      typography: {
        fontFamily: "Georgia, serif",
        fontStyle: "italic",
        fontWeight: "300",
        lineHeight: "1.6",
        letterSpacing: "0.05em",
        textAlign: "center",
        textTransform: "uppercase",
        textDecoration: "underline",
      },
    });
    for (const el of [titleOf(container), excerptOf(container)]) {
      expect(el).not.toBeNull();
      expect(el?.style.fontFamily).toBe("Georgia, serif");
      expect(el?.style.fontStyle).toBe("italic");
      expect(el?.style.fontWeight).toBe("300");
      expect(el?.style.lineHeight).toBe("1.6");
      expect(el?.style.letterSpacing).toBe("0.05em");
      expect(el?.style.textAlign).toBe("center");
      expect(el?.style.textTransform).toBe("uppercase");
      expect(el?.style.textDecoration).toBe("underline");
    }
  });

  it("pomija pola typografii, których redakcja nie ustawiła", () => {
    // Pusty obiekt typografii nie może dokleić do stylu ani jednej deklaracji -
    // inaczej widget nadpisuje kaskadę motywu wartościami, których nikt nie wybrał.
    const { container } = renderSlider({ typography: {} });
    const title = titleOf(container);
    expect(title?.style.fontFamily).toBe("");
    expect(title?.style.textTransform).toBe("");
    expect(title?.style.letterSpacing).toBe("");
    expect(title?.style.fontWeight).toBe("");
  });

  it("pozwala wadze z sekcji typografii wygrać z wagą wpisaną w panelu slidera", () => {
    const { container } = renderSlider({
      titleWeight: 800,
      subtitleWeight: 800,
      typography: { fontWeight: "300" },
    });
    expect(titleOf(container)?.style.fontWeight).toBe("300");
    expect(excerptOf(container)?.style.fontWeight).toBe("300");
  });

  it("stosuje wagę z panelu slidera, gdy typografia jej nie definiuje", () => {
    const { container } = renderSlider({ titleWeight: 800, subtitleWeight: 500 });
    expect(titleOf(container)?.style.fontWeight).toBe("800");
    expect(excerptOf(container)?.style.fontWeight).toBe("500");
  });

  it("dokłada do rozmiaru z panelu interlinię właściwą dla tytułu i dla zajawki", () => {
    const { container } = renderSlider({ titleSizePx: 30, subtitleSizePx: 14 });
    expect(titleOf(container)?.style.lineHeight).toBe("1.15");
    expect(excerptOf(container)?.style.lineHeight).toBe("1.5");
  });
});

// ------------------------------------------------------------------
// Reguły mobilne
// ------------------------------------------------------------------

describe("SliderRender - reguły mobilne", () => {
  it("pomija znacznik i arkusz mobilny, gdy rozmiar mobilny jest równy desktopowemu", () => {
    const config: Partial<SliderConfig> = {
      typography: {
        fontSize: { desktop: "26px", tablet: "26px", mobile: "26px" },
        descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "16px" },
      },
    };
    const { container } = renderSlider(config);
    expect(rootVar(container, "--abl-title-fs")).toBe("26px");
    expect(typographyMarkers(container)).toEqual(["eh-t", "eh-d"]);
    expect(rootVar(container, "--eh-tm")).toBe("");
    expect(serverHtml(config)).not.toContain("nes-slider-m-v1");
  });

  it("wystawia rozmiar mobilny zmienną i montuje arkusz z media query, gdy różni się od desktopowego", () => {
    const { container } = renderSlider({
      typography: { fontSize: { desktop: "34px", mobile: "26px" } },
    });
    expect(rootVar(container, "--abl-title-fs")).toBe("34px");
    expect(rootVar(container, "--eh-tm")).toBe("26px");
    expect(typographyMarkers(container)).toEqual(["eh-t", "eh-tm"]);
    expect(resourceCss("nes-slider-m-v1")).toContain(
      "@media (max-width: 767px){.eh-tm{--abl-title-fs:var(--eh-tm)!important}" +
        ".eh-tm.eh-tm.eh-tm.eh-tm .cms-post-title{font-size:var(--eh-tm)!important}",
    );
  });

  it("dubluje reguły mobilne dla kanwy edytora i dla podglądu wizualnego (0,7,0)", () => {
    // Obie powierzchnie symulują telefon ATRYBUTEM data-device, a nie
    // szerokością okna, więc samo media query ich nie obsłuży.
    renderSlider({ typography: { fontSize: { desktop: "34px", mobile: "26px" } } });
    const css = resourceCss("nes-slider-m-v1");
    const device = ":is([data-builder-renderer],[data-visual-canvas])[data-device=mobile]";
    expect(css).toContain(
      `${device} .eh-tm.eh-tm.eh-tm.eh-tm .cms-post-title{font-size:var(--eh-tm)!important}`,
    );
    expect(css).toContain(
      `${device} .eh-dm.eh-dm.eh-dm.eh-dm .cms-post-excerpt{font-size:var(--eh-dm)!important}`,
    );
  });

  it("tworzy regułę mobilną także wtedy, gdy zdefiniowano wyłącznie mobilny rozmiar zajawki", () => {
    const config: Partial<SliderConfig> = {
      typography: { descriptionFontSize: { mobile: "13px" } },
    };
    const { container } = renderSlider(config);
    expect(rootVar(container, "--eh-dm")).toBe("13px");
    expect(typographyMarkers(container)).toEqual(["eh-dm"]);
    expect(serverHtml(config)).toContain("nes-slider-m-v1");
    expect(resourceCss("nes-slider-m-v1")).toContain(
      ".eh-dm.eh-dm.eh-dm.eh-dm .cms-post-excerpt{font-size:var(--eh-dm)!important}}",
    );
  });

  it("odrzuca mobilny rozmiar spoza białej listy, nie psując wartości desktopowej", () => {
    const config: Partial<SliderConfig> = {
      typography: { fontSize: { desktop: "34px", mobile: "26px}<style>" } },
    };
    const { container } = renderSlider(config);
    expect(rootVar(container, "--abl-title-fs")).toBe("34px");
    expect(typographyMarkers(container)).toEqual(["eh-t"]);
    expect(sliderRoot(container).getAttribute("style")).not.toContain("style>");
    expect(serverHtml(config)).not.toContain("nes-slider-m-v1");
  });
});

// ------------------------------------------------------------------
// HTML serwera: wartości instancji w atrybutach korzenia, reguły w arkuszach
// `precedence` (bez `<style>` w treści), hydratacja bez rozjazdu
// ------------------------------------------------------------------

describe("SliderRender - typografia instancji w HTML-u serwera", () => {
  const FULL: Partial<SliderConfig> = {
    typography: {
      fontSize: { desktop: "34px", mobile: "26px" },
      descriptionFontSize: { desktop: "16px", mobile: "14px" },
      titleDescriptionGapPx: 0,
    },
  };

  it("nie emituje arkusza instancji; korzeń niesie zmienne i znaczniki tylko ustawionych wartości", () => {
    const html = serverHtml(FULL);
    expect(html).not.toContain("data-slider-instance");
    expect(html).not.toMatch(/eh-i-/);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(typographyMarkers(host)).toEqual(["eh-t", "eh-d", "eh-g", "eh-tm", "eh-dm"]);
    expect(sliderRoot(host).getAttribute("style")).toMatch(
      /^--eh-speed:\d+ms;--eh-columns:3;--abl-title-fs:34px;--eh-d:16px;--eh-g:0px;--eh-tm:26px;--eh-dm:14px$/,
    );
    // Oba zasoby w jednym `<style>` precedencji (scalanie Reacta), wspólny pierwszy.
    expect(html).toContain('data-href="nes-slider-shared-v1 nes-slider-m-v1"');
    expect(sliderRoot(host).querySelectorAll("style")).toHaveLength(0);
  });

  it("hydratacja przejmuje korzeń z typografią instancji bez rozjazdu", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={client}>
        <SliderRender config={{ items: ITEMS, autoplay: false, ...FULL }} lang="pl" />
      </QueryClientProvider>
    );
    const host = document.createElement("div");
    host.innerHTML = serverHtml(FULL);
    document.body.append(host);
    const root = sliderRoot(host);
    const errors: unknown[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((error) => errors.push(error));
    const reactRoot = hydrateRoot(host, tree, {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(async () => {});
      expect(errors).toEqual([]);
      expect(sliderRoot(host)).toBe(root);
      expect(rootVar(host, "--eh-tm")).toBe("26px");
    } finally {
      await act(async () => reactRoot.unmount());
      consoleError.mockRestore();
      host.remove();
    }
  });
});

// ------------------------------------------------------------------
// Slajd bez zdarzeń: teksty, kategoria, obraz zastępczy
// ------------------------------------------------------------------

describe("SliderRender - rozstrzyganie treści slajdu", () => {
  it("czyta tytuł i zajawkę w języku widoku", () => {
    const { container } = renderSlider({}, "en");
    expect(titleOf(container)?.textContent).toBe("First slide");
    expect(excerptOf(container)?.textContent).toBe("First slide excerpt.");
  });

  it("pokazuje treść wypełnioną wyłącznie po angielsku także w widoku polskim", () => {
    // Łańcuch pickI18n: żądany język, potem PL, potem EN. Bez ostatniego
    // ogniwa slajd stworzony w wydaniu angielskim znikałby w podglądzie PL.
    const { container } = renderSlider(
      {
        items: [{ image: "https://obrazy.example.com/en.jpg", title_en: "English only title" }],
      },
      "pl",
    );
    expect(titleOf(container)?.textContent).toBe("English only title");
  });

  it("przycina tytuł do 220 znaków, a zajawkę do 160", () => {
    const { container } = renderSlider({
      items: [
        {
          image: "https://obrazy.example.com/dlugi.jpg",
          title_pl: "T".repeat(400),
          subtitle_pl: "Z".repeat(400),
        },
      ],
    });
    expect(titleOf(container)?.textContent).toHaveLength(220);
    expect(excerptOf(container)?.textContent).toHaveLength(160);
    expect(titleOf(container)?.textContent?.endsWith("…")).toBe(true);
  });

  it("nie dokleja wielokropka do tekstu mieszczącego się w limicie", () => {
    const { container } = renderSlider();
    expect(titleOf(container)?.textContent).toBe("Pierwszy slajd");
  });

  it("rysuje plakietkę kategorii w kolorze z konfiguracji slajdu", () => {
    const { container } = renderSlider({
      items: [
        {
          image: "https://obrazy.example.com/k.jpg",
          title_pl: "Z kategorią",
          category_pl: "Wywiad",
          categoryColor: "#123456",
        },
      ],
    });
    const badge = [...container.querySelectorAll<HTMLElement>("span")].find(
      (el) => el.textContent === "Wywiad",
    );
    expect(badge?.style.background).toBe("#123456");
  });

  it("wraca do koloru markowego kategorii, gdy slajd koloru nie niesie", () => {
    const { container } = renderSlider();
    const badge = [...container.querySelectorAll<HTMLElement>("span")].find(
      (el) => el.textContent === "Analiza",
    );
    expect(badge?.style.background).toBe("#ef6c2e");
  });

  it("rezerwuje miejsce na zajawkę, gdy ma ją choć jeden slajd zestawu", () => {
    // Rezerwa wysokości: bez niej widget skacze przy przejściu na slajd bez
    // zajawki. Pierwszy slajd nie ma opisu, drugi ma.
    const { container } = renderSlider({
      items: [
        { image: "https://obrazy.example.com/a.jpg", title_pl: "Bez zajawki" },
        { image: "https://obrazy.example.com/b.jpg", title_pl: "Z zajawką", subtitle_pl: "Jest." },
      ],
    });
    expect(excerptOf(container)).not.toBeNull();
    expect(excerptOf(container)?.textContent).toBe(" ");
  });

  it("zastępuje adres obrazu odrzucony przez sanitizer obrazkiem zastępczym", () => {
    const { container } = renderSlider({
      items: [{ image: "javascript:alert(1)", title_pl: "Niebezpieczny adres" }],
    });
    const img = container.querySelector<HTMLImageElement>("img[data-fill-image]");
    expect(img?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it("nie dodaje kandydatów responsywnych dla okładki spoza Storage", () => {
    withLoadedImages(() => {
      const { container } = renderSlider();
      const img = container.querySelector<HTMLImageElement>("img[data-fill-image]");
      expect(img?.getAttribute("srcset")).toBeNull();
      expect(img?.getAttribute("sizes")).toBeNull();
    });
  });

  it("dodaje kandydatów responsywnych i deklarację sizes dla okładki ze Storage", () => {
    // Okładka musi być wczytana: `srcSet` powstaje z AKTUALNEGO `displaySrc`,
    // więc podmiana na obrazek zastępczy zdjęłaby oba atrybuty i test mierzyłby
    // efekt montażu zamiast budowania kandydatów.
    withLoadedImages(() => {
      const { container } = renderSlider({
        items: [
          {
            image: "https://baza.example.com/storage/v1/object/public/media/okladka.jpg",
            title_pl: "Okładka ze Storage",
          },
        ],
      });
      const img = container.querySelector<HTMLImageElement>("img[data-fill-image]");
      expect(img?.getAttribute("srcset")).toContain("/storage/v1/render/image/public/");
      expect(img?.getAttribute("sizes")).toBe("100vw");
    });
  });

  it("daje pierwszemu slajdowi wysoki priorytet pobrania, a pozostałych nie pobiera przed pokazaniem", () => {
    const { container } = renderSlider();
    const [first, ...rest] = [...container.querySelectorAll<HTMLElement>("[data-fill-image]")];
    expect(first.tagName).toBe("IMG");
    expect(first.getAttribute("fetchpriority")).toBe("high");
    expect(first.getAttribute("loading")).toBe("eager");
    expect(rest).toHaveLength(ITEMS.length - 1);
    // Zaślepka nie ma czego pobierać ani priorytetyzować - żadnego z atrybutów
    // pobierania (krótszy znacznik niż dawny `<img>` bez src).
    for (const layer of rest) {
      expect(layer.tagName).toBe("SPAN");
      for (const attr of [
        "src",
        "srcset",
        "sizes",
        "loading",
        "fetchpriority",
        "decoding",
        "alt",
      ]) {
        expect(layer.hasAttribute(attr), attr).toBe(false);
      }
    }
  });

  it("pokazuje w wariancie multi-card wszystkie karty naraz, bez wygaszania nieaktywnych", () => {
    const { container } = renderSlider({ variant: "multi-card" });
    const imgs = [...container.querySelectorAll<HTMLImageElement>("img[data-fill-image]")];
    expect(imgs).toHaveLength(ITEMS.length);
    // Karta widoczna nie niesie `style` w ogóle: krycie 1 to wartość
    // początkowa, a przejście żyje w arkuszu wspólnym (P2.6). Wygaszenie
    // wyglądałoby jak inline `opacity:0`.
    for (const img of imgs) {
      expect(img.style.opacity).not.toBe("0");
      expect(img.getAttribute("style")).toBeNull();
    }
  });

  it("prosi w wariancie multi-card o rozmiary właściwe dla liczby kolumn", () => {
    withLoadedImages(() => {
      const { container } = renderSlider({
        variant: "multi-card",
        columns: 2,
        items: [
          {
            image: "https://baza.example.com/storage/v1/object/public/media/karta.jpg",
            title_pl: "Karta",
          },
        ],
      });
      expect(container.querySelector("img[data-fill-image]")?.getAttribute("sizes")).toBe(
        "(max-width: 640px) 100vw, 50vw",
      );
    });
  });

  it("prosi w wariancie split-feature o rozmiary połówkowe", () => {
    withLoadedImages(() => {
      const { container } = renderSlider({
        variant: "split-feature",
        items: [
          {
            image: "https://baza.example.com/storage/v1/object/public/media/split.jpg",
            title_pl: "Split",
          },
        ],
      });
      expect(container.querySelector("img[data-fill-image]")?.getAttribute("sizes")).toBe(
        "(max-width: 767px) 100vw, 50vw",
      );
    });
  });

  // NAPRAWIONE 2026-10-18 (był `it.fails`): SLAJD BEZ BEZPIECZNEGO ADRESU NIE
  // JEST ODNOŚNIKIEM.
  //
  // `pickSlideStrings` woła `safeUrl(raw, "")`, więc brak adresu i adres
  // odrzucony przez sanitizer (np. "javascript:alert(1)") dają `href`
  // undefined, a nie prawdziwe "#". Kadr nie dostaje odnośnika nakładki, tytuł
  // i zajawka nie siedzą w `<a href="#">`, a czytelnik nie traci przystanku
  // fokusu na przejście, którego nie ma. Jawnie wpisane "#" nadal przechodzi -
  // to świadomy wybór redaktora, nie wartość zastępcza.
  it.each([
    ["bez pola href", undefined],
    ["z adresem odrzuconym przez sanitizer", "javascript:alert(1)"],
  ])("slajd %s nie udaje odnośnika", (_, href) => {
    const { container } = renderSlider({
      items: [{ image: "https://obrazy.example.com/x.jpg", title_pl: "Bez adresu", href }],
    });
    expect(container.querySelector("[data-widget-media]")?.getAttribute("role")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe("Bez adresu");
  });
});

// ------------------------------------------------------------------
// Obraz zepsuty już w chwili montażu
// ------------------------------------------------------------------

describe("SliderRender - obraz zepsuty już w chwili montażu", () => {
  /**
   * happy-dom nie pobiera obrazów, więc `complete`/`naturalWidth` nigdy nie
   * ułożą się SAME w kombinację „wczytany, ale bez pikseli". Podmieniamy oba
   * gettery na prototypie na czas jednego testu - to jedyny sposób, żeby
   * dotknąć efektu montażu, który w prawdziwej przeglądarce ratuje slajd
   * z martwym CDN-em (zdarzenie `error` już nie przyjdzie, bo obraz
   * „skończył" się ładować przed podpięciem handlera).
   */
  const withBrokenImages = (run: () => void) =>
    withImageLoadState({ complete: true, naturalWidth: 0 }, run);

  it("przechodzi na obrazek zastępczy, gdy okładka jest martwa już przy montażu", () => {
    withBrokenImages(() => {
      const { container } = renderSlider({
        items: [{ image: "https://obrazy.example.com/martwy.jpg", title_pl: "Martwa okładka" }],
      });
      const img = container.querySelector<HTMLImageElement>("img[data-fill-image]");
      expect(img?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
    });
  });

  it("nie rusza obrazu, który zgłasza niezerową szerokość naturalną", () => {
    // Druga połowa warunku efektu: `complete` też jest prawdą, więc o wyniku
    // decyduje WYŁĄCZNIE niezerowa `naturalWidth`. Bez jawnego ustawienia obu
    // getterów test przechodziłby tylko dzięki temu, że happy-dom w danej
    // wersji startuje z `complete === false` - czyli nie dotykałby wcale
    // gałęzi, którą nazywa w tytule.
    withLoadedImages(() => {
      const { container } = renderSlider({
        items: [{ image: "https://obrazy.example.com/zdrowy.jpg", title_pl: "Zdrowa okładka" }],
      });
      expect(container.querySelector("img[data-fill-image]")?.getAttribute("src")).toBe(
        "https://obrazy.example.com/zdrowy.jpg",
      );
    });
  });
});

// ------------------------------------------------------------------
// Dieta znaczników (P2.6): stałe deklaracje w arkuszu i klasach, kropki
// paginacji animowane wyłącznie przez kompozytor
// ------------------------------------------------------------------

/** Wspólny arkusz slidera (React przenosi go do `<head>`). */
function sharedSheetElement(): HTMLStyleElement {
  const el = document.querySelector<HTMLStyleElement>('style[data-href="nes-slider-shared-v1"]');
  if (!el) throw new Error("brak wspólnego arkusza slidera");
  return el;
}

/** Selektor, którego happy-dom nie umie rozebrać, po prostu nie pasuje. */
function matchesSafely(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * Wartość deklaracji `property` z reguł arkusza wspólnego, których selektor
 * pasuje do `el`. CSSOM happy-dom odrzuca `calc()` ze zmiennymi (szerokość
 * karty), więc reguły czytamy z tekstu - ale porównujemy WARTOŚĆ obliczoną
 * (`evaluateCalc`), a nie zapis źródła.
 */
function sharedDeclarationFor(el: Element, property: string): string | undefined {
  let found: string | undefined;
  for (const [, selector, body] of (sharedSheetElement().textContent ?? "").matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel || sel.startsWith("@") || !matchesSafely(el, sel)) continue;
    const decl = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`).exec(body);
    if (decl) found = decl[1].trim();
  }
  return found;
}

/**
 * Arytmetyka `calc()` po podstawieniu liczb: + - * / i nawiasy. Wystarczy do
 * sprawdzenia, że karty z odstępami wypełniają tor co do piksela.
 */
function evaluateCalc(expression: string): number {
  const tokens = expression.replace(/calc/g, "").match(/\d*\.?\d+|[-+*/()]/g) ?? [];
  let i = 0;
  const factor = (): number => {
    const token = tokens[i++];
    if (token === "(") {
      const value = sum();
      i++;
      return value;
    }
    if (token === "-") return -factor();
    return Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const right = factor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  return sum();
}

/** Ustawienia urządzenia happy-dom (media `prefers-reduced-motion`). */
function deviceSettings(): { prefersReducedMotion: string } {
  return (
    window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }
  ).happyDOM.settings.device;
}

/**
 * Kropki paginacji: kropka to `span[aria-hidden]` w przycisku „Slajd N".
 * Miniatury minimal-strip też są przyciskami „Slajd N", ale bez kropki.
 */
function dotsOf(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Slajd "]')].flatMap(
    (button) => {
      const dot = button.querySelector<HTMLElement>("span[aria-hidden]");
      return dot ? [dot] : [];
    },
  );
}

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** Przejście, które każdy obraz niósł dotąd inline (przed P2.6). */
const PRE_P26_INLINE_TRANSITION =
  "opacity 700ms cubic-bezier(.22,.61,.36,1), scale var(--eh-transition-duration, 1100ms) var(--eh-scale-easing, ease-in-out)";

/**
 * Obraz-wzorzec: kopia aktywnego obrazu z dawnym przejściem inline, w tym
 * samym miejscu drzewa (te same reguły arkusza i te same zmienne CSS).
 */
function preP26Reference(img: HTMLImageElement): HTMLImageElement {
  const reference = img.cloneNode() as HTMLImageElement;
  reference.style.transition = PRE_P26_INLINE_TRANSITION;
  img.after(reference);
  return reference;
}

/** Warianty z obrazami w stosie: widoczny jest tylko aktywny slajd. */
const STACKED_VARIANTS = [
  "editorial-hero",
  "cinematic-overlay",
  "split-feature",
  "minimal-strip",
] as const satisfies readonly SliderVariant[];

/** Warianty z kropkami paginacji (multi-card przy jednej kolumnie ma krok na slajd). */
const DOT_VARIANTS = [
  ["editorial-hero", {}],
  ["multi-card", { columns: 1 }],
  ["cinematic-overlay", {}],
  ["split-feature", {}],
] as const satisfies ReadonlyArray<readonly [SliderVariant, Partial<SliderConfig>]>;

describe("SliderRender - dieta znaczników obrazów i kart (P2.6)", () => {
  it.each(STACKED_VARIANTS)(
    "w wariancie %s aktywny obraz nie ma atrybutu style, a ukryte warstwy niosą wyłącznie opacity:0",
    (variant) => {
      const { container } = renderSlider({ variant });
      const [active, ...hidden] = [...container.querySelectorAll<HTMLElement>("[data-fill-image]")];
      expect(active.tagName).toBe("IMG");
      expect(active.getAttribute("style")).toBeNull();
      expect(hidden).toHaveLength(ITEMS.length - 1);
      for (const img of hidden) {
        expect(img.style.length).toBe(1);
        expect(img.style.opacity).toBe("0");
        expect(img.style.transition).toBe("");
      }
    },
  );

  it("obraz bez style dostaje z arkusza to samo wyliczone przejście co dawny inline", () => {
    const { container } = renderSlider();
    const active = container.querySelector<HTMLImageElement>("img[data-fill-image]")!;
    const reference = preP26Reference(active);
    const transition = getComputedStyle(active).transition;
    expect(transition).toContain("opacity 700ms");
    expect(transition).toBe(getComputedStyle(reference).transition);
    // Najechanie przestawia `--eh-scale-easing` (ease-out na wjeździe); happy-dom
    // nie ma `:hover`, więc zmienną stawiamy wprost na obu obrazach.
    for (const img of [active, reference]) img.style.setProperty("--eh-scale-easing", "ease-out");
    expect(getComputedStyle(active).transition).toContain("ease-out");
    expect(getComputedStyle(active).transition).toBe(getComputedStyle(reference).transition);
  });

  it("przy prefers-reduced-motion zostawia przenikanie (jak dotąd, gdy wygrywał inline), bez skali", () => {
    const device = deviceSettings();
    const previous = device.prefersReducedMotion;
    device.prefersReducedMotion = "reduce";
    try {
      const { container } = renderSlider();
      const active = container.querySelector<HTMLImageElement>("img[data-fill-image]")!;
      const transition = getComputedStyle(active).transition;
      expect(transition).toContain("opacity 700ms");
      expect(transition).not.toContain("scale");
      // Powiększenie na najechaniu jest wyłączone (skala zostaje 1).
      const reduced = [...sharedSheetElement().sheet!.cssRules].find(
        (rule): rule is CSSMediaRule =>
          rule instanceof CSSMediaRule && rule.conditionText.includes("prefers-reduced-motion"),
      );
      const hover = [...(reduced?.cssRules ?? [])].find(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule && rule.selectorText.includes(":hover"),
      );
      expect(hover?.style.getPropertyValue("--eh-scale").trim()).toBe("1");
    } finally {
      device.prefersReducedMotion = previous;
    }
  });

  it.each([1, 2, 3, 4])(
    "karty multi-card bez style, liczba kolumn %i: szerokość z arkusza i odstępy wypełniają tor co do piksela",
    (columns) => {
      const { container } = renderSlider({ variant: "multi-card" });
      const cards = [...container.querySelectorAll<HTMLElement>("article.eh-multi-card-item")];
      expect(cards).toHaveLength(ITEMS.length);
      for (const card of cards) expect(card.getAttribute("style")).toBeNull();
      const track = container.querySelector<HTMLElement>(".eh-multi-track")!;
      // Przesunięcie toru jest stanem (indeks, przeciąganie) - zostaje inline.
      expect(track.style.transform).toContain("translateX(");
      const gap = Number.parseFloat(track.style.gap);
      const width = sharedDeclarationFor(cards[0], "width");
      expect(width).toBeDefined();
      const trackWidth = 1000;
      const cardWidth = evaluateCalc(
        width!
          .replace(/var\(--eh-visible-columns\)/g, String(columns))
          .replace(/100%/g, String(trackWidth))
          .replace(/px/g, ""),
      );
      expect(columns * cardWidth + (columns - 1) * gap).toBeCloseTo(trackWidth, 6);
      // Karta nie rośnie i nie kurczy się we flexie toru - szerokość trzyma.
      const card = getComputedStyle(cards[0]);
      expect(card.getPropertyValue("flex-grow")).toBe("0");
      expect(card.getPropertyValue("flex-shrink")).toBe("0");
    },
  );
});

describe("SliderRender - kreski paginacji tylko przez transform i opacity (P2.6, css:C9)", () => {
  it.each(DOT_VARIANTS)(
    "w wariancie %s każda kreska ma stałe pudełko w-10 h-1 i przejście wyłącznie transform/opacity",
    (variant, extra) => {
      const { container } = renderSlider({ variant, ...extra });
      const dots = dotsOf(container);
      expect(dots).toHaveLength(ITEMS.length);
      for (const dot of dots) {
        expect(tokens(dot)).toEqual(
          expect.arrayContaining(["rounded-full", "w-10", "h-1", "transition-[transform,opacity]"]),
        );
        // Animowane właściwości układu i koloru znikają razem z transition-all.
        for (const banned of ["transition-all", "w-2", "h-2", "w-2.5", "h-2.5"]) {
          expect(tokens(dot)).not.toContain(banned);
        }
        expect(dot.className).not.toMatch(/\bbg-(foreground|white)\/\d+/);
      }
    },
  );

  it.each(DOT_VARIANTS)(
    "w wariancie %s aktywna kreska jest pełna i wydłużona, a nieaktywne skrócone scaleX(.4) i przygaszone",
    (variant, extra) => {
      const { container } = renderSlider({ variant, ...extra });
      const buttons = [...container.querySelectorAll('button[aria-label^="Slajd "]')];
      const active = buttons.filter((b) => b.getAttribute("aria-current") === "true");
      expect(active).toHaveLength(1);
      for (const button of buttons) {
        const dot = button.querySelector<HTMLElement>("span[aria-hidden]")!;
        if (button === active[0]) {
          expect(tokens(dot)).toContain("[transform:scaleX(1)]");
          expect(tokens(dot)).toContain("opacity-100");
        } else {
          expect(tokens(dot)).toContain("[transform:scaleX(.4)]");
          expect(tokens(dot)).toContain("opacity-35");
          expect(tokens(dot)).toContain("group-hover:opacity-60");
        }
      }
    },
  );

  it("zachowuje kontekstowy kolor kresek: bg-foreground na powierzchni, bg-white na obrazie", () => {
    const hero = dotsOf(renderSlider({ variant: "editorial-hero" }).container);
    expect(tokens(hero[1])).toEqual(expect.arrayContaining(["bg-foreground", "opacity-35"]));
    const cinema = dotsOf(renderSlider({ variant: "cinematic-overlay" }).container);
    expect(tokens(cinema[1])).toEqual(expect.arrayContaining(["bg-white", "opacity-35"]));
  });
});

describe("SliderRender - parytet SSR i klienta znaczników P2.6", () => {
  function serverRoot(config: Partial<SliderConfig>): HTMLElement {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToString(
      <QueryClientProvider client={client}>
        <SliderRender config={{ items: ITEMS, autoplay: false, ...config }} lang="pl" />
      </QueryClientProvider>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }

  it.each(SLIDER_VARIANT_VALUES)(
    "wariant %s: te same klasy kropek i te same atrybuty style obrazów po obu stronach",
    (variant) => {
      const config: Partial<SliderConfig> =
        variant === "multi-card" ? { variant, columns: 1 } : { variant };
      const server = serverRoot(config);
      const { container } = renderSlider(config);
      expect(dotsOf(server).map((d) => d.className)).toEqual(
        dotsOf(container).map((d) => d.className),
      );
      // Element (obraz / zaślepka), adres i krycie każdej warstwy - hydratacja
      // nie może podmienić zaślepki na `<img>` ani odwrotnie.
      const imgStyles = (root: ParentNode) =>
        [...root.querySelectorAll<HTMLElement>("[data-fill-image]")].map((el) => [
          el.tagName,
          el.hasAttribute("src"),
          el.hasAttribute("style") ? el.style.opacity : null,
        ]);
      expect(imgStyles(server)).toEqual(imgStyles(container));
      const cardStyles = (root: ParentNode) =>
        [...root.querySelectorAll("article.eh-multi-card-item")].map((a) =>
          a.getAttribute("style"),
        );
      expect(cardStyles(server)).toEqual(cardStyles(container));
    },
  );
});

// ------------------------------------------------------------------
// SSR bez `<img>` bez adresu (walidator HTML: "Element img is missing one or
// more of the following attributes: src, srcset")
// ------------------------------------------------------------------

/**
 * Zaślepka niepokazanego slajdu w dokumencie serwera, co do bajtu. Dopisanie
 * atrybutu łamie ten test, bo zaślepka nie może być dłuższa od dawnego `<img>`
 * bez src (`alt`, `draggable`, `loading`, `fetchpriority`, `decoding`).
 */
const SSR_PLACEHOLDER =
  '<span aria-hidden="true" data-fill-image="true" class="eh-img absolute inset-0 w-full h-full object-cover widget-media-fg" style="opacity:0"></span>';

describe("SliderRender - SSR bez <img> bez src/srcset", () => {
  function sliderTree(config: Partial<SliderConfig>, lcp?: LcpImage) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <SliderRender config={{ items: ITEMS, autoplay: false, ...config }} lang="pl" lcp={lcp} />
      </QueryClientProvider>
    );
  }
  const imgTags = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

  it.each(SLIDER_VARIANT_VALUES)("wariant %s: każdy <img> z serwera ma src", (variant) => {
    const tags = imgTags(renderToString(sliderTree({ variant })));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/\ssrc(set)?="[^"]+"/);
  });

  it.each(STACKED_VARIANTS)(
    "wariant %s: niepokazane slajdy to zaślepki bez atrybutów pobierania",
    (variant) => {
      const html = renderToString(sliderTree({ variant }));
      expect(html.split(SSR_PLACEHOLDER)).toHaveLength(ITEMS.length);
      expect(imgTags(html).filter((tag) => tag.includes("data-fill-image"))).toHaveLength(1);
    },
  );

  it("slajd aktywny kandydata LCP zostaje tym samym <img> (src, eager, high, znacznik, bez style)", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(sliderTree({}, true));
    const [active] = host.querySelectorAll<HTMLElement>("[data-fill-image]");
    expect(active.tagName).toBe("IMG");
    expect(active.getAttribute("src")).toBe(ITEMS[0].image);
    expect(active.getAttribute("loading")).toBe("eager");
    expect(active.getAttribute("fetchpriority")).toBe("high");
    expect(active.getAttribute("data-lcp-candidate")).toBe("");
    expect(active.hasAttribute("style")).toBe(false);
    expect(host.querySelectorAll("[data-lcp-candidate]")).toHaveLength(1);
  });

  it.each(STACKED_VARIANTS)(
    "wariant %s: hydratacja przejmuje zaślepki i obraz bez rozjazdu i bez podmiany węzłów",
    async (variant) => {
      const html = renderToString(sliderTree({ variant }, true));
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      const layers = [...host.querySelectorAll("[data-fill-image]")];
      const errors: unknown[] = [];
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation((error) => errors.push(error));
      const root = hydrateRoot(host, sliderTree({ variant }, true), {
        onRecoverableError: (error) => errors.push(error),
      });
      try {
        await act(async () => {});
        expect(errors).toEqual([]);
        const after = [...host.querySelectorAll("[data-fill-image]")];
        expect(after).toHaveLength(layers.length);
        after.forEach((el, i) => expect(el).toBe(layers[i]));
        expect(after.map((el) => el.tagName)).toEqual(["IMG", ...ITEMS.slice(1).map(() => "SPAN")]);
      } finally {
        await act(async () => root.unmount());
        consoleError.mockRestore();
        host.remove();
      }
    },
  );
});
