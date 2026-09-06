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
// 2. ARKUSZ INSTANCJI TO BIAŁA LISTA, A NIE CZYSZCZENIE. Rozmiary z panelu
//    trafiają do `<style>` jako reguły `!important` (inline-style przegrywał
//    z regułami `WidgetView`). Wartość spoza białej listy ma być ODRZUCONA
//    w całości, a nie „oczyszczona" do połowicznej deklaracji - inaczej pole
//    tekstowe panelu staje się wektorem wstrzyknięcia CSS.
//
// 3. REGUŁY MOBILNE MAJĄ TRZY ADRESY. Ten sam rozmiar musi wyjść jako
//    `@media (max-width: 767px)` (prawdziwa przeglądarka), jako
//    `[data-builder-renderer][data-device="mobile"]` (kanwa edytora) i jako
//    `[data-visual-canvas][data-device="mobile"]` (podgląd wizualny), bo dwa
//    ostatnie symulują telefon ATRYBUTEM, nie szerokością okna. I odwrotnie:
//    gdy rozmiar mobilny równa się desktopowemu, żadna z tych reguł nie ma
//    powstać.
//
// 4. SELEKTOR NALEŻY DO INSTANCJI. Klasa `eh-i-<useId>` jest potrajana w
//    selektorze dla specyficzności; dwa slidery na jednej stronie nie mogą
//    nadpisywać sobie typografii.
//
// GRANICA DOWODU
//  * Responsywność renderera jest w CZYSTYM CSS (arkusz `SHARED_STYLES`), a
//    happy-dom nie liczy kaskady ani nie ma viewportu - dlatego media query
//    sprawdzamy jako TEKST w `<style>`, nie przez zmianę szerokości okna.
//  * `useId` generuje identyfikator zależny od drzewa, więc nigdy nie
//    asertujemy literału `eh-i-r0`, tylko kształt selektora wyrażeniem
//    regularnym.
//  * Gałęzie osiągalne wyłącznie zdarzeniem (przeciąganie, klik w strzałkę,
//    nawigacja, autoplay) leżą poza tym plikiem z premedytacją - mają własne
//    pliki i własne atrapy routera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import type { SupabaseFromStub } from "@/test/supabase";

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
  type NavArrowVariant,
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

/** Cała treść arkuszy stylów zamontowanych przez widget. */
function styleText(container: HTMLElement): string {
  return [...container.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
}

/**
 * Arkusz instancji ma własny znacznik. Wspólny arkusz React przenosi do head
 * i deduplikuje; jego pozycja w DOM nie określa już numeru arkusza instancji.
 */
function instanceCss(container: HTMLElement): string {
  return container.querySelector("style[data-slider-instance]")?.textContent ?? "";
}

const prevButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("button.eh-prev");
const nextButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("button.eh-next");
const titleOf = (root: HTMLElement) => root.querySelector<HTMLElement>("h3.cms-post-title");
const excerptOf = (root: HTMLElement) => root.querySelector<HTMLElement>("p.cms-post-excerpt");

/** Geometria każdego kształtu strzałki - jedno źródło prawdy dla asercji. */
const ARROW_PATHS: Record<NavArrowVariant, string> = {
  chevron: "M9 6l6 6-6 6",
  "chevron-bold": "M9 5l7 7-7 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  "arrow-long": "M3 12h17M14 6l6 6-6 6",
  caret: "M9 5l8 7-8 7z",
  angle: "M10 5l7 7-7 7",
  "double-chevron": "M6 6l6 6-6 6M12 6l6 6-6 6",
  "arrow-tail": "M4 12h15M13 6l6 6-6 6M5 9l3 3-3 3",
};

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
// Katalog kształtów strzałek
// ------------------------------------------------------------------

describe("SliderRender - katalog kształtów strzałek nawigacji", () => {
  it.each(NAV_ARROW_VARIANT_VALUES)(
    "rysuje kształt %s jako pojedynczy inline SVG w obu przyciskach",
    (arrowVariant) => {
      const { container } = renderSlider({ navArrowVariant: arrowVariant });
      const prev = prevButton(container);
      const next = nextButton(container);
      expect(prev).not.toBeNull();
      expect(next).not.toBeNull();

      const prevPaths = prev?.querySelectorAll("path") ?? [];
      expect(prevPaths).toHaveLength(1);
      expect(prevPaths[0].getAttribute("d")).toBe(ARROW_PATHS[arrowVariant]);
      expect(next?.querySelector("path")?.getAttribute("d")).toBe(ARROW_PATHS[arrowVariant]);
    },
  );

  it("odbija strzałkę wsteczną lustrzanie, zamiast rysować drugą geometrię", () => {
    // Ta sama ścieżka w obie strony = brak szansy na rozjazd kształtów; kierunek
    // robi wyłącznie transformacja CSS.
    const { container } = renderSlider({ navArrowVariant: "arrow" });
    expect(prevButton(container)?.querySelector("svg")?.style.transform).toBe("scaleX(-1)");
    expect(nextButton(container)?.querySelector("svg")?.style.transform).toBe("none");
  });

  it("daje każdemu kształtowi z katalogu inną geometrię", () => {
    // Bramka na „dodałem wariant do katalogu i zapomniałem o gałęzi w switchu":
    // taki wariant cicho dostaje kształt domyślny i wygląda jak chevron.
    const drawn = NAV_ARROW_VARIANT_VALUES.map((arrowVariant) => {
      const { container, unmount } = renderSlider({ navArrowVariant: arrowVariant });
      const d = prevButton(container)?.querySelector("path")?.getAttribute("d") ?? "";
      unmount();
      return d;
    });
    expect(new Set(drawn).size).toBe(NAV_ARROW_VARIANT_VALUES.length);
  });

  it("pogrubia chevron-bold do co najmniej 3, gdy panel prosi o cieńszą kreskę", () => {
    const { container } = renderSlider({ navArrowVariant: "chevron-bold", navArrowStroke: 1 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("3");
  });

  it("honoruje grubszą kreskę chevron-bold, gdy panel prosi o więcej niż 3", () => {
    const { container } = renderSlider({ navArrowVariant: "chevron-bold", navArrowStroke: 4 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("4");
  });

  it("ścieńcza angle o pół punktu wobec ustawienia panelu", () => {
    const { container } = renderSlider({ navArrowVariant: "angle", navArrowStroke: 2 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("1.5");
  });

  it("nie pozwala angle zejść poniżej 1, nawet przy najcieńszym ustawieniu", () => {
    const { container } = renderSlider({ navArrowVariant: "angle", navArrowStroke: 0.5 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("1");
  });

  it("rysuje caret jako trójkąt wypełniony, niezależnie od grubości kreski z panelu", () => {
    const { container } = renderSlider({ navArrowVariant: "caret", navArrowStroke: 4 });
    const path = prevButton(container)?.querySelector("path");
    expect(path?.getAttribute("fill")).toBe("currentColor");
    expect(path?.getAttribute("stroke-width")).toBe("0.5");
  });

  it("rysuje kształty kreskowe bez wypełnienia, żeby kolor tła nie zalał ikony", () => {
    const { container } = renderSlider({ navArrowVariant: "double-chevron" });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("fill")).toBe("none");
  });

  it("wraca do chevronu, gdy zapis dokumentu niesie kształt spoza katalogu", () => {
    const { container } = renderSlider({
      navArrowVariant: "spirala" as unknown as NavArrowVariant,
    });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("d")).toBe(
      ARROW_PATHS.chevron,
    );
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

  it("skaluje ikonę do 42% przycisku dla dużych przycisków", () => {
    const { container } = renderSlider({ navSizePx: 96 });
    expect(prevButton(container)?.querySelector("svg")?.style.width).toBe("40px");
  });

  it("nie schodzi z ikoną poniżej 14 px przy najmniejszym przycisku", () => {
    const { container } = renderSlider({ navSizePx: 28 });
    expect(prevButton(container)?.querySelector("svg")?.style.width).toBe("14px");
  });

  it("zawęża grubość kreski strzałki do dolnej granicy 0.5", () => {
    const { container } = renderSlider({ navArrowStroke: 0.1 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("0.5");
  });

  it("zawęża grubość kreski strzałki do górnej granicy 4", () => {
    const { container } = renderSlider({ navArrowStroke: 9 });
    expect(prevButton(container)?.querySelector("path")?.getAttribute("stroke-width")).toBe("4");
  });
});

// ------------------------------------------------------------------
// Katalog wariantów
// ------------------------------------------------------------------

/** Znacznik DOM, po którym poznajemy, że narysował się właściwy wariant. */
const VARIANT_MARKER: Record<SliderVariant, (root: HTMLElement) => boolean> = {
  "editorial-hero": (root) =>
    root.querySelector<HTMLElement>("[data-widget-media]")?.style.borderRadius === "4px",
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
    "rysuje w wariancie %s tyle obrazów wypełniających, ile jest slajdów",
    (variant) => {
      const { container } = renderSlider({ variant });
      expect(container.querySelectorAll("img[data-fill-image]")).toHaveLength(ITEMS.length);
    },
  );

  it("wraca do wariantu editorial-hero, gdy dokument niesie wariant spoza katalogu", () => {
    const { container } = renderSlider({ variant: "kafelki" as unknown as SliderVariant });
    expect(VARIANT_MARKER["editorial-hero"](container)).toBe(true);
  });

  it("znakuje korzeń klasą instancji obok wspólnej klasy eh-slider", () => {
    const { container } = renderSlider();
    const root = container.querySelector<HTMLElement>(".eh-slider");
    expect(root?.className).toMatch(/\beh-i-[A-Za-z0-9_-]+\b/);
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

  // DEFEKT: NAWIGACJA KROPKAMI MÓWI PO POLSKU TAKŻE W WIDOKU ANGIELSKIM.
  //
  // WEJŚCIE: `<SliderRender lang="en">` z trzema slajdami, wariant domyślny.
  // CO PSUJE: `DotsNav` (sliderVariants.tsx:658-694) w ogóle nie dostaje
  //   propsa `lang` i wpisuje etykiety na sztywno: aria-label="Poprzedni",
  //   "Następny" oraz `Slajd ${i + 1}`. To samo dotyczy kropek wewnątrz
  //   wariantu cinematic-overlay (linia 1561) i przycisków paska miniatur
  //   (linia 1805). W TYM SAMYM pliku `NavArrows` (linie 1189-1190)
  //   lokalizuje etykiety poprawnie, więc to niekonsekwencja, a nie decyzja.
  // KONSEKWENCJA: czytelnik anglojęzycznego wydania słyszy w czytniku ekranu
  //   polskie etykiety, których nie rozumie, a jedyna nawigacja tego widgetu
  //   dostępna z klawiatury przestaje być dla niego opisana. Dług jest
  //   zarejestrowany budżetem 3 w `src/lib/ci/monolingualUserText.ts`, ale
  //   nie naprawiony.
  // WYMAGANA POPRAWKA: `DotsNav` (i obie kopie kropek w wariantach) ma
  //   przyjmować `lang` i wybierać parę PL/EN dokładnie tak, jak robi to
  //   `NavArrows` - "Slide N" / "Previous" / "Next" dla lang="en".
  it.fails("DEFEKT: kropki nawigacji muszą mieć angielskie etykiety przy lang=en", () => {
    const { container } = renderSlider({}, "en");
    expect(container.querySelector('button[aria-label="Slide 1"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Slajd 1"]')).toBeNull();
  });
});

// ------------------------------------------------------------------
// Arkusz CSS instancji
// ------------------------------------------------------------------

describe("SliderRender - arkusz CSS instancji: biała lista jednostek", () => {
  it.each(["26", "26px", "1.5rem", "80%", "12pt", "5vw", "3vh", "2em"])(
    "przyjmuje zapis rozmiaru %s i emituje z niego regułę instancji",
    (raw) => {
      const { container } = renderSlider({ typography: { fontSize: { desktop: raw } } });
      const expected = /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
      expect(instanceCss(container)).toContain(
        `.cms-post-title{font-size:${expected} !important;}`,
      );
    },
  );

  it.each(["", "   ", "abc", "26px !important", "26}<script>", "calc(1px + 2px)", "-4px", "26 px"])(
    "odrzuca zapis rozmiaru %s w całości, zamiast go czyścić",
    (raw) => {
      const { container } = renderSlider({ typography: { fontSize: { desktop: raw } } });
      // Reguła instancji nie może powstać ANI w postaci okrojonej, ANI z
      // resztką wejścia - to jedyna bariera między polem tekstowym panelu
      // a arkuszem wstrzykniętym do dokumentu.
      expect(instanceCss(container)).not.toContain(".cms-post-title{font-size:");
      expect(styleText(container)).not.toContain("script");
    },
  );

  it("nie montuje arkusza instancji, gdy nie ma ani typografii, ani rozmiarów z panelu", () => {
    const { container } = renderSlider();
    expect(container.querySelectorAll("style[data-slider-instance]")).toHaveLength(0);
    expect(document.querySelectorAll('style[data-href="nes-slider-shared-v1"]')).toHaveLength(1);
    expect(instanceCss(container)).toBe("");
  });

  it("bierze rozmiary z panelu slidera, gdy sekcja typografii ich nie definiuje", () => {
    const { container } = renderSlider({ titleSizePx: 30, subtitleSizePx: 14 });
    const css = instanceCss(container);
    expect(css).toContain(".cms-post-title{font-size:30px !important;}");
    expect(css).toContain(".cms-post-excerpt{font-size:14px !important;}");
  });

  it("pozwala typografii wygrać z rozmiarem wpisanym w panelu slidera", () => {
    const { container } = renderSlider({
      titleSizePx: 30,
      typography: { fontSize: { desktop: "44px" } },
    });
    const css = instanceCss(container);
    expect(css).toContain(".cms-post-title{font-size:44px !important;}");
    expect(css).not.toContain("30px");
  });

  it("potraja klasę instancji w selektorze, żeby przebić reguły widoku widgetu", () => {
    // Specyficzność [0,4,0] to jedyny powód istnienia tego arkusza: inline-style
    // przegrywa z `!important` generowanym przez WidgetView.
    const { container } = renderSlider({ titleSizePx: 22 });
    expect(instanceCss(container)).toMatch(
      /\.eh-slider\.(eh-i-[A-Za-z0-9_-]+)\.\1\.\1 \.cms-post-title\{/,
    );
  });

  it("daje dwóm sliderom na jednej stronie rozłączne selektory instancji", () => {
    const { container } = render(
      <>
        <SliderRender config={{ items: ITEMS, autoplay: false, titleSizePx: 20 }} lang="pl" />
        <SliderRender config={{ items: ITEMS, autoplay: false, titleSizePx: 40 }} lang="pl" />
      </>,
    );
    const ids = [...styleText(container).matchAll(/\.eh-slider\.(eh-i-[A-Za-z0-9_-]+)\./g)].map(
      (m) => m[1],
    );
    expect(new Set(ids).size).toBe(2);
  });
});

describe("SliderRender - odstęp tytuł-opis", () => {
  it("nie emituje marginesu, gdy redakcja odstępu nie ustawiła", () => {
    const { container } = renderSlider({ titleSizePx: 22 });
    expect(instanceCss(container)).not.toContain("[data-eh-gap]{margin-top");
    expect(excerptOf(container)?.style.marginTop).toBe("");
  });

  it("traktuje odstęp 0 jako świadome zero, a nie jako brak wartości", () => {
    const { container } = renderSlider({ typography: { titleDescriptionGapPx: 0 } });
    expect(instanceCss(container)).toContain("[data-eh-gap]{margin-top:0px !important;}");
    expect(excerptOf(container)?.style.marginTop).toBe("0px");
  });

  it("przenosi dodatni odstęp jednocześnie do arkusza instancji i do inline-stylu", () => {
    const { container } = renderSlider({ typography: { titleDescriptionGapPx: 18 } });
    expect(instanceCss(container)).toContain("[data-eh-gap]{margin-top:18px !important;}");
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
  it("pomija media query, gdy rozmiar mobilny jest równy desktopowemu", () => {
    const { container } = renderSlider({
      typography: {
        fontSize: { desktop: "26px", tablet: "26px", mobile: "26px" },
        descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "16px" },
      },
    });
    const css = instanceCss(container);
    expect(css).toContain(".cms-post-title{font-size:26px !important;}");
    expect(css).not.toContain("@media (max-width: 767px)");
    expect(css).not.toContain('[data-device="mobile"]');
  });

  it("emituje media query, gdy rozmiar mobilny różni się od desktopowego", () => {
    const { container } = renderSlider({
      typography: { fontSize: { desktop: "34px", mobile: "26px" } },
    });
    expect(instanceCss(container)).toMatch(
      /@media \(max-width: 767px\)\{[^}]*\.cms-post-title\{font-size:26px !important;\}\}/,
    );
  });

  it("dubluje reguły mobilne dla kanwy edytora i dla podglądu wizualnego", () => {
    // Obie powierzchnie symulują telefon ATRYBUTEM data-device, a nie
    // szerokością okna, więc samo media query ich nie obsłuży.
    const { container } = renderSlider({
      typography: { fontSize: { desktop: "34px", mobile: "26px" } },
    });
    const css = instanceCss(container);
    expect(css).toMatch(
      /\[data-builder-renderer\]\[data-device="mobile"\] \.eh-slider\.eh-i-[A-Za-z0-9_-]+/,
    );
    expect(css).toMatch(
      /\[data-visual-canvas\]\[data-device="mobile"\] \.eh-slider\.eh-i-[A-Za-z0-9_-]+/,
    );
  });

  it("tworzy regułę mobilną także wtedy, gdy zdefiniowano wyłącznie mobilny rozmiar zajawki", () => {
    const { container } = renderSlider({
      typography: { descriptionFontSize: { mobile: "13px" } },
    });
    const css = instanceCss(container);
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain(".cms-post-excerpt{font-size:13px !important;}");
  });

  it("odrzuca mobilny rozmiar spoza białej listy, nie psując reguły desktopowej", () => {
    const { container } = renderSlider({
      typography: { fontSize: { desktop: "34px", mobile: "26px}<style>" } },
    });
    const css = instanceCss(container);
    expect(css).toContain(".cms-post-title{font-size:34px !important;}");
    expect(css).not.toContain("@media (max-width: 767px)");
    expect(css).not.toContain("style>");
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
    const { container } = renderSlider();
    const img = container.querySelector<HTMLImageElement>("img[data-fill-image]");
    expect(img?.getAttribute("srcset")).toBeNull();
    expect(img?.getAttribute("sizes")).toBeNull();
  });

  it("dodaje kandydatów responsywnych i deklarację sizes dla okładki ze Storage", () => {
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

  it("daje pierwszemu slajdowi wysoki priorytet pobrania, a pozostałym niski", () => {
    const { container } = renderSlider();
    const imgs = [...container.querySelectorAll<HTMLImageElement>("img[data-fill-image]")];
    expect(imgs[0].getAttribute("fetchpriority")).toBe("high");
    expect(imgs[0].getAttribute("loading")).toBe("eager");
    expect(imgs[1].getAttribute("fetchpriority")).toBe("low");
    expect(imgs[1].getAttribute("loading")).toBe("lazy");
  });

  it("pokazuje w wariancie multi-card wszystkie karty naraz, bez wygaszania nieaktywnych", () => {
    const { container } = renderSlider({ variant: "multi-card" });
    const imgs = [...container.querySelectorAll<HTMLImageElement>("img[data-fill-image]")];
    expect(imgs).toHaveLength(ITEMS.length);
    for (const img of imgs) expect(img.style.opacity).toBe("1");
  });

  it("prosi w wariancie multi-card o rozmiary właściwe dla liczby kolumn", () => {
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
    expect(container.querySelector("img[data-fill-image]")?.getAttribute("sizes")).toBe("50vw");
  });

  it("prosi w wariancie split-feature o rozmiary połówkowe", () => {
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

  // DEFEKT: SLAJD BEZ ADRESU I TAK JEST RENDEROWANY JAKO ODNOŚNIK.
  //
  // WEJŚCIE: slajd bez pola `href` (albo z adresem odrzuconym przez sanitizer,
  //   np. "javascript:alert(1)"), wariant domyślny editorial-hero.
  // CO PSUJE: `pickSlideStrings` (sliderVariants.tsx:1130) liczy
  //   `safeUrl(asStr(it.href)) || undefined`, a `safeUrl`
  //   (src/lib/sanitizePure.ts:176-179) zwraca dla pustego ORAZ dla
  //   niebezpiecznego wejścia wartość zastępczą "#", która jest prawdziwa.
  //   Alternatywa `|| undefined` nigdy się więc nie wykonuje - `href` jest
  //   ustawiony ZAWSZE.
  // KONSEKWENCJA: kadr dostaje role="link", tabIndex=0 i kursor wskaźnika,
  //   tytuł i zajawka trafiają do <a href="#">, a kliknięcie woła
  //   `navigateTo("#")`. Slajd świadomie zostawiony bez adresu obiecuje
  //   czytelnikowi przejście, którego nie ma, i zabiera przystanek fokusu
  //   klawiatury. Przy okazji gałąź „rysuj bez odnośnika" jest we WSZYSTKICH
  //   pięciu wariantach martwa, więc żaden test nie jest w stanie jej dotknąć.
  // WYMAGANA POPRAWKA: `pickSlideStrings` ma wołać `safeUrl(raw, "")` (albo
  //   odrzucać wynik równy "#"), żeby brak bezpiecznego adresu znaczył brak
  //   odnośnika.
  it.fails("DEFEKT: slajd bez bezpiecznego adresu nie może udawać odnośnika", () => {
    const { container } = renderSlider({
      items: [{ image: "https://obrazy.example.com/x.jpg", title_pl: "Bez adresu" }],
    });
    expect(container.querySelector("[data-widget-media]")?.getAttribute("role")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});

// ------------------------------------------------------------------
// Obraz zepsuty już w chwili montażu
// ------------------------------------------------------------------

describe("SliderRender - obraz zepsuty już w chwili montażu", () => {
  /**
   * happy-dom nie pobiera obrazów, więc `complete`/`naturalWidth` nigdy nie
   * ułożą się w kombinację „wczytany, ale bez pikseli". Podmieniamy oba
   * gettery na prototypie na czas jednego testu - to jedyny sposób, żeby
   * dotknąć efektu montażu, który w prawdziwej przeglądarce ratuje slajd
   * z martwym CDN-em (zdarzenie `error` już nie przyjdzie, bo obraz
   * „skończył" się ładować przed podpięciem handlera).
   */
  function withBrokenImages(run: () => void) {
    const proto = window.HTMLImageElement.prototype;
    const completeDesc = Object.getOwnPropertyDescriptor(proto, "complete");
    const widthDesc = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
    Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
    Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => 0 });
    try {
      run();
    } finally {
      if (completeDesc) Object.defineProperty(proto, "complete", completeDesc);
      else Reflect.deleteProperty(proto, "complete");
      if (widthDesc) Object.defineProperty(proto, "naturalWidth", widthDesc);
      else Reflect.deleteProperty(proto, "naturalWidth");
    }
  }

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
    const { container } = renderSlider({
      items: [{ image: "https://obrazy.example.com/zdrowy.jpg", title_pl: "Zdrowa okładka" }],
    });
    expect(container.querySelector("img[data-fill-image]")?.getAttribute("src")).toBe(
      "https://obrazy.example.com/zdrowy.jpg",
    );
  });
});
