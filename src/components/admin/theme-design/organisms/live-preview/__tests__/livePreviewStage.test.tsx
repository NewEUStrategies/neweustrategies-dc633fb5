// SCENA PODGLĄDU NA ŻYWO - dwanaście gałęzi, po jednej na zakładkę edytora.
// Do 19.08.2026 połowa (linie 129-204) bez wykonania.
//
// To jedyne miejsce, w którym redaktor widzi efekt swoich ustawień przed
// zapisem. Reguła jest prosta i łatwa do złamania w ciszy: KAŻDA zakładka
// pokazuje SWOJĄ scenę. Podpięcie cudzej gałęzi nie daje błędu typów, nie
// wywraca renderu - podgląd po prostu pokazuje coś innego, niż redaktor
// właśnie ustawia, więc suwaki „nic nie robią".
//
// Druga reguła to dwujęzyczność: scena renderuje realistyczną próbkę tekstu w
// JĘZYKU PUBLICZNYM (nie w języku panelu), bo służy do oceny, jak karta wygląda
// dla czytelnika. Trzecia: geometria pochodzi z WERSJI ROBOCZEJ, a nie z
// zapisanych ustawień - inaczej podgląd kłamałby przy każdej niezapisanej
// zmianie.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "@/lib/i18n-admin-theme-design";
import { LivePreviewStage } from "../LivePreviewStage";
import { PREVIEW_SECTIONS, getPreviewCopy, getTabTitle } from "../../../lib";
import type { PreviewSection } from "../../../lib";
import { THEME_DESIGN_DEFAULTS, type ThemeDesign } from "@/lib/theme/themeDesign";

function stage(
  activeTab: PreviewSection,
  opts: { draft?: ThemeDesign; lang?: "pl" | "en"; isDark?: boolean } = {},
) {
  return render(
    <LivePreviewStage
      draft={opts.draft ?? THEME_DESIGN_DEFAULTS}
      previewLang={opts.lang ?? "pl"}
      isDark={opts.isDark ?? false}
      activeTab={activeTab}
    />,
  );
}

/** Zaznacznik sceny: selektor CSS, po którym poznajemy, że narysowano WŁAŚCIWĄ. */
const ZNACZNIK: Record<PreviewSection, string> = {
  "block-heading": ".cms-block-heading",
  thumbnail: ".cms-thumb",
  "read-more": ".cms-read-more",
  meta: ".cms-meta-info",
  toolbar: "[data-toolbar-preview], .inline-flex",
  "mode-switch": ".inline-flex",
  social: "svg",
  "post-title": ".cms-post-title",
  "post-excerpt": ".cms-post-excerpt",
  "list-index": "ol",
  carousel: "article",
  overlay: "article",
};

describe("LivePreviewStage - każda zakładka rysuje WŁASNĄ scenę", () => {
  it.each([...PREVIEW_SECTIONS])("%s", (section) => {
    const { container } = stage(section);
    expect(container.querySelector(ZNACZNIK[section])).toBeTruthy();
  });

  it("nagłówek sceny nazywa AKTYWNĄ zakładkę", () => {
    // Bez tej etykiety nie da się stwierdzić, czy podgląd nie utknął na
    // poprzedniej sekcji.
    for (const section of PREVIEW_SECTIONS) {
      const { container, unmount } = stage(section);
      expect(container.textContent, section).toContain(getTabTitle(section, "pl"));
      unmount();
    }
  });

  it("scena zakładki NIE zawiera elementów sceny sąsiedniej", () => {
    // Najczęstsza pomyłka: gałąź `&&` przepisana z sąsiada zostaje z cudzym
    // warunkiem i dwie sceny rysują się naraz.
    const { container } = stage("post-excerpt");
    expect(container.querySelector(".cms-post-excerpt")).toBeTruthy();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.querySelector(".cms-thumb")).toBeNull();
  });
});

describe("LivePreviewStage - język próbki", () => {
  it.each(["pl", "en"] as const)("scena w języku %s bierze tekst z próbki tego języka", (lang) => {
    // Próbka jest w języku PUBLICZNYM, nie w języku panelu - podgląd służy do
    // oceny, jak karta wygląda dla czytelnika.
    const copy = getPreviewCopy(lang);
    const { container } = stage("post-title", { lang });

    expect(container.textContent).toContain(copy.title);
  });

  it("obie wersje językowe różnią się treścią", () => {
    expect(getPreviewCopy("pl").title).not.toBe(getPreviewCopy("en").title);
  });

  it("nazwa zakładki też idzie za językiem podglądu", () => {
    const { container } = stage("block-heading", { lang: "en" });
    expect(container.textContent).toContain("Block headings");
  });
});

describe("LivePreviewStage - geometria z WERSJI ROBOCZEJ", () => {
  it("miniatura bierze proporcje z wersji roboczej", () => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      thumbnail: { ...THEME_DESIGN_DEFAULTS.thumbnail, aspectRatio: "21/9" },
    };
    const { container } = stage("thumbnail", { draft });

    // Przeglądarka normalizuje zapis proporcji do postaci z odstępami.
    expect(container.querySelector<HTMLElement>(".cms-thumb")?.style.aspectRatio).toBe("21 / 9");
  });

  it("ikony społecznościowe biorą rozmiar i odstęp z wersji roboczej", () => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      socialIcons: { ...THEME_DESIGN_DEFAULTS.socialIcons, size: "33px", gap: "17px" },
    };
    const { container } = stage("social", { draft });
    const ikona = container.querySelector<SVGElement>("svg");
    // Rząd ikon to jedyny element z odstępem podanym stylem inline; nagłówek
    // sceny ma odstęp klasą narzędziową.
    const rzad = container.querySelector<HTMLElement>('div[style*="gap"]');

    expect(ikona?.getAttribute("style")).toContain("33px");
    expect(rzad?.style.gap).toBe("17px");
  });

  it("meta bierze rozmiar, odstęp i wersaliki z wersji roboczej", () => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      metaInfo: {
        ...THEME_DESIGN_DEFAULTS.metaInfo,
        fontSize: "19px",
        gap: "11px",
        uppercase: true,
      },
    };
    const { container } = stage("meta", { draft });
    const meta = container.querySelector<HTMLElement>(".cms-meta-info");

    expect(meta?.style.fontSize).toBe("19px");
    expect(meta?.style.gap).toBe("11px");
    expect(meta?.style.textTransform).toBe("uppercase");
  });

  it("wyłączone wersaliki meta dają transformację `none`", () => {
    const { container } = stage("meta");
    expect(container.querySelector<HTMLElement>(".cms-meta-info")?.style.textTransform).toBe(
      "none",
    );
  });

  it("strzałka przycisku „czytaj więcej” idzie za wersją roboczą", () => {
    const zeStrzalka: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, arrow: true },
    };
    const pierwszy = stage("read-more", { draft: zeStrzalka });
    expect(pierwszy.container.textContent).toContain("→");
    pierwszy.unmount();

    const bezStrzalki: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, arrow: false },
    };
    expect(stage("read-more", { draft: bezStrzalki }).container.textContent).not.toContain("→");
  });

  it("numeracja list bierze grubość i przezroczystość z wersji roboczej", () => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      listIndex: { ...THEME_DESIGN_DEFAULTS.listIndex, weight: 300, opacity: 0.42 },
    };
    const { container } = stage("list-index", { draft });
    const numer = container.querySelector<HTMLElement>("ol span");

    expect(numer?.style.fontWeight).toBe("300");
    expect(numer?.style.opacity).toBe("0.42");
  });

  it("numeracja list jest zerowana do dwóch cyfr", () => {
    // „01, 02, 03" zamiast „1, 2, 3" - to wariant „Ranking" z widgetów.
    const { container } = stage("list-index");
    const numery = Array.from(container.querySelectorAll("ol li > span")).map((s) => s.textContent);

    expect(numery).toEqual(["01", "02", "03"]);
  });
});

describe("LivePreviewStage - tryb ciemny", () => {
  it("numeracja list ma OSOBNY kolor dla trybu ciemnego", () => {
    // Numeracja to jedyny element z kolorem wprost w wersji roboczej per tryb;
    // reszta idzie przez tokeny `--td-*`, których happy-dom nie rozwiązuje.
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      listIndex: {
        ...THEME_DESIGN_DEFAULTS.listIndex,
        colorLight: "rgb(10, 20, 30)",
        colorDark: "rgb(200, 210, 220)",
      },
    };
    const jasny = stage("list-index", { draft, isDark: false });
    expect(jasny.container.querySelector<HTMLElement>("ol span")?.style.color).toBe(
      "rgb(10, 20, 30)",
    );
    jasny.unmount();

    const ciemny = stage("list-index", { draft, isDark: true });
    expect(ciemny.container.querySelector<HTMLElement>("ol span")?.style.color).toBe(
      "rgb(200, 210, 220)",
    );
  });

  it("przełącznik trybu podświetla POZYCJĘ odpowiadającą trybowi podglądu", () => {
    // W trybie jasnym aktywna jest pierwsza pozycja, w ciemnym trzecia -
    // podgląd pokazujący zawsze tę samą pozycję nie mówiłby nic o stanie.
    // Pozycja AKTYWNA maluje tło tokenem `--td-ms-active-bg`, nieaktywne
    // dostają wprost `transparent`. Środowisko testowe pomija deklaracje z
    // `var()`, więc aktywną poznajemy po BRAKU zadeklarowanego tła.
    const copy = getPreviewCopy("pl");
    const aktywna = (root: HTMLElement): string | null | undefined =>
      Array.from(root.querySelectorAll<HTMLElement>("div.inline-flex > span")).find(
        (el) => el.style.background === "",
      )?.textContent;

    const jasny = stage("mode-switch", { isDark: false });
    expect(aktywna(jasny.container)).toBe(copy.modeItems[0]);
    jasny.unmount();

    const ciemny = stage("mode-switch", { isDark: true });
    expect(aktywna(ciemny.container)).toBe(copy.modeItems[2]);
  });
});

describe("LivePreviewStage - karuzela i overlay", () => {
  it("karuzela pokazuje trzy slajdy i trzy kropki", () => {
    const { container } = stage("carousel");
    expect(container.querySelectorAll("article")).toHaveLength(3);
    // Kropki paginacji; nagłówek sceny ma własny znacznik o tej samej wysokości,
    // więc adresujemy je przez rząd, nie przez klasę.
    expect(container.querySelectorAll(".items-center.gap-1\\.5 > span")).toHaveLength(3);
  });

  it("karuzela bierze tytuły z próbki, po jednym na slajd", () => {
    const copy = getPreviewCopy("pl");
    const { container } = stage("carousel");
    const tytuly = Array.from(container.querySelectorAll(".cms-post-title")).map(
      (h) => h.textContent,
    );

    expect(tytuly).toEqual([...copy.items]);
  });

  it("overlay składa kategorię, tytuł, zajawkę i meta na jednym kadrze", () => {
    // To najgęstsza scena - cztery warstwy tekstu na zdjęciu; brak
    // którejkolwiek oznacza, że redaktor nie oceni kontrastu.
    const copy = getPreviewCopy("pl");
    const { container } = stage("overlay");

    expect(container.textContent).toContain(copy.overlayCategory);
    expect(container.textContent).toContain(copy.title);
    expect(container.textContent).toContain(copy.excerpt);
    expect(container.textContent).toContain(copy.author);
  });
});
