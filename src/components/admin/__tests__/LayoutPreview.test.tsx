// Miniatura presetu layoutu wpisu - `LayoutPreview`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ten kafel jest JEDYNĄ rzeczą, którą
// redaktor widzi przed wyborem układu wpisu (w /admin/post-layouts i w
// edytorze). Jeżeli dwa różne presety rysują ten sam obrazek, wybór jest
// losowaniem, a błąd wychodzi dopiero na opublikowanym artykule. Dlatego
// przypinam RÓŻNICE, a nie sam fakt renderu:
//   1. KAŻDY TRYB NAGŁÓWKA MA WŁASNY SZKIELET - `no-cover` (bez grafiki),
//      `overlay` (nagłówek NA gradiencie, grafika jako tło), `side-by-side`
//      (dwie kolumny), `below-cover` (grafika nad nagłówkiem) i domyślny
//      `above-cover`. `switch` po `preset.header` ma gałąź `default`, więc
//      nieznany tryb NIE znika - ląduje w wariancie `above-cover`.
//   2. RATIO GRAFIKI JEST LICZONE, NIE PRZEPISANE. `ratioPct` bierze wartość
//      z ustawień globalnych TYLKO dla `cover: "ratio"` i tylko z zakresu
//      (10, 200); wszystko inne wraca do 56. Wysokość ramki to
//      `round(ratio/150*28+10)` px - jedyna liczba w tym komponencie, którą
//      da się i trzeba przypiąć, bo to ona odróżnia layout 6 od 10 i 11.
//   3. SIDEBAR: `hasSidebarOverride` WYGRYWA nad presetem w obie strony
//      (dokłada sidebar układowi bez niego i zabiera układowi z nim) - to
//      jest ta sama reguła, którą stosuje renderer publiczny.
//   4. CENTROWANIE NAGŁÓWKA: `settings.center_header` wygrywa nad
//      `preset.centerHeaderDefault`, a `false` w ustawieniach MUSI wygrać z
//      `true` w presecie (gałąź `?? ` łapie tylko `undefined`).
//   5. ZAJAWKA: `showExcerpt: false` (Layout 1a) zdejmuje trzeci pasek
//      nagłówka - to cała różnica między Layout 1 a Layout 1(a).
//   6. WĄSKA KOLUMNA (`contentMaxWidth`) zwęża blok tekstu; bez tego Layout 2
//      wyglądałby identycznie jak Layout 1.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: definicji presetów (`STANDARD_LAYOUTS` i
// spółka mają własne testy w `lib/postLayouts`) ani renderera publicznego -
// tu chodzi wyłącznie o to, czy MINIATURA odróżnia warianty. Asercje idą po
// klasach Tailwind i stylach inline, bo ten komponent nie ma żadnego tekstu.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LayoutPreview } from "@/components/admin/LayoutPreview";
import type { LayoutPreset, PostLayoutSettings } from "@/lib/postLayouts";

/** Preset minimalny - każdy test dokłada tylko to, czego dowodzi. */
function preset(over: Partial<LayoutPreset> = {}): LayoutPreset {
  return {
    id: "layout-test",
    label: "Layout testowy",
    header: "above-cover",
    cover: "wide",
    hasSidebar: false,
    ...over,
  };
}

type Ustawienia = Pick<
  PostLayoutSettings,
  "featured_ratio_l6" | "featured_ratio_l10" | "featured_ratio_l11" | "center_header"
>;

/** Wysokość ramki grafiki w wariancie `cover: "ratio"` (styl inline). */
function wysokoscRamki(root: HTMLElement): string | undefined {
  const kafel = root.querySelector<HTMLElement>("div[style*='height']");
  return kafel?.style.height;
}

describe("LayoutPreview - tryby nagłówka rysują różne szkielety", () => {
  it("no-cover: sam nagłówek i tekst, zero ramek grafiki", () => {
    const { container } = render(<LayoutPreview preset={preset({ header: "no-cover" })} />);

    expect(container.querySelectorAll(".bg-gradient-to-br")).toHaveLength(0);
    // Nagłówek (kicker + tytuł + zajawka) i cztery paski tekstu.
    expect(container.querySelectorAll(".bg-brand")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-foreground\\/30")).toHaveLength(4);
  });

  it("overlay: nagłówek leży NA gradiencie, a tytuł jest w kolorze tła", () => {
    const { container } = render(<LayoutPreview preset={preset({ header: "overlay" })} />);

    expect(container.querySelector(".from-foreground\\/80")).not.toBeNull();
    expect(container.querySelector(".absolute.inset-0")).not.toBeNull();
    // Tytuł na ciemnym tle musi być jasny - inaczej miniatura kłamie.
    expect(container.querySelector(".bg-background")).not.toBeNull();
  });

  it("overlay z okładką full-bleed daje wyższy pas niż wariant zwykły", () => {
    const zwykly = render(<LayoutPreview preset={preset({ header: "overlay", cover: "wide" })} />);
    expect(zwykly.container.querySelector(".h-20")).not.toBeNull();

    const pelny = render(
      <LayoutPreview preset={preset({ header: "overlay", cover: "full-bleed" })} />,
    );
    expect(pelny.container.querySelector(".h-24")).not.toBeNull();
  });

  it("side-by-side: dwie kolumny - grafika obok skróconego nagłówka", () => {
    const { container } = render(<LayoutPreview preset={preset({ header: "side-by-side" })} />);

    expect(container.querySelector(".grid.grid-cols-2")).not.toBeNull();
    expect(container.querySelector(".h-16.w-full")).not.toBeNull();
  });

  it("below-cover: grafika przed nagłówkiem, nagłówek pełnowymiarowy", () => {
    const { container } = render(<LayoutPreview preset={preset({ header: "below-cover" })} />);

    // Pierwszym dzieckiem ramki jest GRAFIKA, dopiero po niej nagłówek -
    // odwrotna kolejność dałaby miniaturę nie do odróżnienia od above-cover.
    const bloki = container.querySelectorAll(".p-3 > *");
    expect(bloki[0]?.className).toContain("bg-gradient-to-br");
    expect(bloki[1]?.className).toContain("flex-col");
    expect(container.querySelector(".h-14.w-full")).not.toBeNull();
  });

  it("above-cover jest gałęzią domyślną - nieznany tryb nie gubi kafelka", () => {
    // Rzutowanie po to, żeby udowodnić gałąź `default` bez `as any`.
    const nieznany = { ...preset(), header: "kosmos" } as unknown as LayoutPreset;
    const { container } = render(<LayoutPreview preset={nieznany} />);

    expect(wysokoscRamki(container)).toBe("56px");
    expect(container.querySelector(".bg-gradient-to-br")).not.toBeNull();
  });
});

describe("LayoutPreview - warianty okładki w trybie above-cover", () => {
  it("full-bleed rozpycha grafikę poza kolumnę tekstu", () => {
    const { container } = render(<LayoutPreview preset={preset({ cover: "full-bleed" })} />);

    expect(container.querySelector(".w-\\[110\\%\\]")).not.toBeNull();
  });

  it("boxed zwęża grafikę i centruje ją w kolumnie", () => {
    const { container } = render(<LayoutPreview preset={preset({ cover: "boxed" })} />);

    expect(container.querySelector(".mx-auto.w-3\\/4")).not.toBeNull();
  });

  it("wide bez ratio ustawia wysokość zastępczą 56 px", () => {
    const { container } = render(<LayoutPreview preset={preset({ cover: "wide" })} />);

    expect(wysokoscRamki(container)).toBe("56px");
  });
});

describe("LayoutPreview - ratioPct: wysokość ramki jest wyliczana z ustawień", () => {
  const ratioPreset = preset({ cover: "ratio", featuredRatioKey: "featured_ratio_l6" });

  it("bierze wartość z ustawień globalnych (100% -> 29 px)", () => {
    const settings = { featured_ratio_l6: 100 } as Ustawienia;
    const { container } = render(<LayoutPreview preset={ratioPreset} settings={settings} />);

    // round(100 / 150 * 28 + 10) = 29
    expect(wysokoscRamki(container)).toBe("29px");
  });

  it("czyta DOKŁADNIE klucz z presetu, nie pierwszy lepszy ratio", () => {
    const settings = { featured_ratio_l6: 150, featured_ratio_l10: 20 } as Ustawienia;
    const { container } = render(
      <LayoutPreview
        preset={preset({ cover: "ratio", featuredRatioKey: "featured_ratio_l10" })}
        settings={settings}
      />,
    );

    // round(20 / 150 * 28 + 10) = 14 (a nie 38, które dałoby 150)
    expect(wysokoscRamki(container)).toBe("14px");
  });

  it.each([
    ["poniżej dolnej granicy", 10],
    ["powyżej górnej granicy", 200],
  ])("odrzuca ratio %s i wraca do 56 (-> 20 px)", (_opis, wartosc) => {
    const settings = { featured_ratio_l6: wartosc } as Ustawienia;
    const { container } = render(<LayoutPreview preset={ratioPreset} settings={settings} />);

    // round(56 / 150 * 28 + 10) = 20
    expect(wysokoscRamki(container)).toBe("20px");
  });

  it("bez obiektu ustawień wraca do 56, mimo `cover: ratio`", () => {
    const { container } = render(<LayoutPreview preset={ratioPreset} />);

    expect(wysokoscRamki(container)).toBe("20px");
  });

  it("preset z `cover: ratio` bez klucza ratio też wraca do 56", () => {
    const settings = { featured_ratio_l6: 120 } as Ustawienia;
    const { container } = render(
      <LayoutPreview preset={preset({ cover: "ratio" })} settings={settings} />,
    );

    expect(wysokoscRamki(container)).toBe("20px");
  });
});

describe("LayoutPreview - sidebar, centrowanie, zajawka i wąska kolumna", () => {
  it("preset z sidebarem rysuje drugą kolumnę o stałej szerokości", () => {
    const { container } = render(<LayoutPreview preset={preset({ hasSidebar: true })} />);

    expect(container.querySelector(".grid-cols-\\[1fr_56px\\]")).not.toBeNull();
    expect(container.querySelector(".border-l")).not.toBeNull();
  });

  it("`hasSidebarOverride` dokłada sidebar układowi, który go nie ma", () => {
    const { container } = render(
      <LayoutPreview preset={preset({ hasSidebar: false })} hasSidebarOverride />,
    );

    expect(container.querySelector(".grid-cols-\\[1fr_56px\\]")).not.toBeNull();
  });

  it("`hasSidebarOverride={false}` ZABIERA sidebar układowi, który go ma", () => {
    const { container } = render(
      <LayoutPreview preset={preset({ hasSidebar: true })} hasSidebarOverride={false} />,
    );

    expect(container.querySelector(".grid-cols-\\[1fr_56px\\]")).toBeNull();
  });

  it("centrowanie z presetu ustawia nagłówek na środek", () => {
    const { container } = render(<LayoutPreview preset={preset({ centerHeaderDefault: true })} />);

    expect(container.querySelector(".items-center.text-center")).not.toBeNull();
  });

  it("`center_header: false` z ustawień wygrywa z `centerHeaderDefault: true` z presetu", () => {
    const settings = { center_header: false } as Ustawienia;
    const { container } = render(
      <LayoutPreview preset={preset({ centerHeaderDefault: true })} settings={settings} />,
    );

    expect(container.querySelector(".items-center.text-center")).toBeNull();
    expect(container.querySelector(".items-start.text-left")).not.toBeNull();
  });

  it("centrowanie działa też w trybie overlay (nagłówek na gradiencie)", () => {
    const settings = { center_header: true } as Ustawienia;
    const { container } = render(
      <LayoutPreview preset={preset({ header: "overlay" })} settings={settings} />,
    );

    expect(container.querySelector(".absolute.items-center")).not.toBeNull();
  });

  it("`showExcerpt: false` zdejmuje trzeci pasek nagłówka", () => {
    const zZajawka = render(<LayoutPreview preset={preset({ header: "no-cover" })} />);
    expect(zZajawka.container.querySelectorAll(".bg-foreground\\/40")).toHaveLength(1);

    const bezZajawki = render(
      <LayoutPreview preset={preset({ header: "no-cover", showExcerpt: false })} />,
    );
    expect(bezZajawki.container.querySelectorAll(".bg-foreground\\/40")).toHaveLength(0);
  });

  it("`contentMaxWidth` zwęża blok tekstu (Layout 2 kontra Layout 1)", () => {
    const szeroki = render(<LayoutPreview preset={preset({ header: "no-cover" })} />);
    expect(szeroki.container.querySelector(".space-y-1.mx-auto")).toBeNull();

    const waski = render(
      <LayoutPreview preset={preset({ header: "no-cover", contentMaxWidth: 672 })} />,
    );
    expect(waski.container.querySelector(".mx-auto.w-3\\/4")).not.toBeNull();
  });

  it("`className` dokleja się do ramki zewnętrznej, nie nadpisuje jej klas", () => {
    const { container } = render(<LayoutPreview preset={preset()} className="ring-2" />);

    const ramka = container.firstElementChild;
    expect(ramka?.className).toContain("ring-2");
    expect(ramka?.className).toContain("border-border");
  });
});
