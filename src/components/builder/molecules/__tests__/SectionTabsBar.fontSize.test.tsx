// PEŁNY TEST MOLEKUŁY SectionTabsBar (nazwa pliku pozostała historyczna - plik
// zaczął się od dowodu na `fontSize`, dziś pokrywa całą powierzchnię paska).
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * rozmiar czcionki etykiet i jego zacisk do [8..48] (pierwszy describe),
// * wybór etykiety wg języka wraz z łańcuchem awaryjnym label_pl -> label_en
//   -> literał "Tab",
// * pusta lista pozycji nie renderuje niczego,
// * styl kontenera: orientacja pozioma i pionowa, zawijanie na wąskim ekranie,
//   wyrównanie, odstęp i dopełnienie zależne od wariantu,
// * wszystkie 11 wariantów wizualnych przycisku po stronie aktywnej i
//   nieaktywnej,
// * trzy animowane wskaźniki aktywnej zakładki (belka podkreślenia, kropka,
//   belka górna) i to, który wariant którego wskaźnika NIE dostaje,
// * ikona zakładki: obecność, wymiar z zaciskiem do [10..32], kolor i
//   położenie (obok etykiety albo nad nią),
// * kolor akcentu globalny, per pozycja i jego strażniki na białych znakach,
// * nawigacja klawiaturą (strzałki, Home, End, zawijanie, orientacja,
//   wyłącznik `keyboard`),
// * zdarzenia myszy i przeciągania: zatrzymanie propagacji do kanwy oraz
//   przełączanie zakładki przeciąganiem,
// * dostępność: role, aria-selected, wędrujący tabindex, identyfikatory ARIA.
//
// ── OGRANICZENIE ATRAPY DOM (ZMIERZONE na happy-dom z node_modules tego repo,
//    nie założone) ─────────────────────────────────────────────────────────
// happy-dom MILCZĄCO wycina wartości kolorów, których nie umie sparsować:
//   * `background: color-mix(in oklab, #ff0055 14%, transparent)` -> `""`,
//   * `background: var(--background, #fff)` -> `""`,
//   * `color: var(--muted-foreground, inherit)` -> `""`,
//   * `borderBottom: 1px solid var(--border, hsl(var(--border)))` -> `""`.
// PRZEŻYWAJĄ natomiast: skrót `border: 1px solid var(--border, hsl(var(--border)))`
// w całości, `box-shadow` (tej własności atrapa w ogóle nie waliduje, więc
// przechodzi DOSŁOWNIE - także z color-mix i z var()),
// `linear-gradient(90deg, #hex, color-mix(...))` z kolorami heksowymi, kolory
// heksadecymalne, `transparent`, `currentColor` oraz cała geometria.
// Skrót `border: 1px solid var(--brand, currentColor)` przechodzi tylko
// CZĘŚCIOWO - do postaci "1px solid", bez koloru.
// Dlatego akcent podajemy w testach ZAWSZE jako heks (#ff0055), a gałęzie
// oparte o tokeny dowodzimy negatywnie (pole stylu jest puste) - tak jak
// src/components/popups/__tests__/SignupPopupPanelLayout.test.tsx:153-165.
// Wypisujemy to ograniczenie wprost zamiast je obchodzić.
//
// ── ŚWIADOMIE NIEPOKRYTA GAŁĄŹ ─────────────────────────────────────────────
// `tabs.items ?? []` (SectionTabsBar.tsx:37) jest nieosiągalna: `items` jest
// polem WYMAGANYM w SectionTabsConfig (src/lib/builder/types.ts:558), więc
// trafienie w stronę nullish wymagałoby rzutowania zakazanego konwencją repo
// (zero `any` / `as any`). NIE domykać jej rzutowaniem - lepiej stracić jedną
// gałąź niż złamać regułę.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { CSSProperties } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import type { SectionTabsConfig, SectionTabsVariant } from "@/lib/builder/types";

// DynamicIcon ciągnie lucide-react i dla nieznanej nazwy wchodzi w React.lazy
// + Suspense, co zamieniłoby synchroniczny test w asynchroniczny. Podmiana wg
// wzorca src/components/admin/popups/signup/__tests__/controls.test.tsx:27-29,
// rozszerzona o przekazanie wymiarów i stylu - bo to właśnie one są
// przedmiotem dowodu dla `iconSize` i koloru ikony. Atrapa CELOWO nie ustawia
// `aria-hidden`, żeby selektor wskaźników `[aria-hidden="true"]` łapał tylko
// belki i kropki, a nie ikonę.
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({
    name,
    width,
    height,
    style,
  }: {
    name: string;
    width?: number | string;
    height?: number | string;
    style?: CSSProperties;
  }) => (
    <span
      data-testid={`ikona-${name}`}
      data-ikona={name}
      data-w={String(width)}
      data-h={String(height)}
      style={style}
    />
  ),
}));

import { SectionTabsBar } from "../SectionTabsBar";

afterEach(cleanup);

function makeCfg(fontSize: number): SectionTabsConfig {
  return {
    enabled: true,
    orientation: "horizontal",
    variant: "underline",
    align: "start",
    fontSize,
    items: [
      { id: "t1", label_pl: "Jeden", label_en: "One" },
      { id: "t2", label_pl: "Dwa", label_en: "Two" },
      { id: "t3", label_pl: "Trzy", label_en: "Three" },
    ],
    defaultTabId: "t1",
  };
}

function renderAt(fontSize: number) {
  return render(
    <SectionTabsBar
      sectionId="sec-test"
      tabs={makeCfg(fontSize)}
      lang="pl"
      activeId="t1"
      onSelect={() => {}}
    />,
  );
}

describe("SectionTabsBar - fontSize wiring", () => {
  it("applies tabs.fontSize as inline style to every tab button and label span", () => {
    const { container } = renderAt(22);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    expect(buttons.length).toBe(3);
    buttons.forEach((btn) => {
      expect(btn.style.fontSize).toBe("22px");
      const span = btn.querySelector("span:not([aria-hidden])") as HTMLSpanElement | null;
      expect(span).not.toBeNull();
      expect(span!.style.fontSize).toBe("22px");
    });
  });

  it("re-renders with the new fontSize on every button and span in real-time", () => {
    const { container, rerender } = renderAt(12);
    const btnsBefore = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    btnsBefore.forEach((b) => expect(b.style.fontSize).toBe("12px"));

    rerender(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={makeCfg(30)}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );

    const btnsAfter = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    expect(btnsAfter.length).toBe(3);
    btnsAfter.forEach((b) => {
      expect(b.style.fontSize).toBe("30px");
      const span = b.querySelector("span:not([aria-hidden])") as HTMLSpanElement | null;
      expect(span!.style.fontSize).toBe("30px");
    });
  });

  it("clamps out-of-range values to [8..48]", () => {
    const { container, rerender } = renderAt(4);
    container
      .querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]")
      .forEach((b) => expect(b.style.fontSize).toBe("8px"));

    rerender(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={makeCfg(999)}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );
    container
      .querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]")
      .forEach((b) => expect(b.style.fontSize).toBe("48px"));
  });

  it("falls back to 14px when fontSize is not set", () => {
    const { container } = render(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={{
          enabled: true,
          orientation: "horizontal",
          variant: "underline",
          align: "start",
          items: [{ id: "t1", label_pl: "A", label_en: "A" }],
          defaultTabId: "t1",
        }}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>("[data-section-tab-btn]");
    expect(btn!.style.fontSize).toBe("14px");
  });

  it("adds stable CSS classes and exposes mobile mode for CSS targeting", () => {
    const { container } = renderAt(16);
    const bar = container.querySelector<HTMLDivElement>("[data-section-tabs-bar]");
    const btn = bar?.querySelector<HTMLButtonElement>("[data-section-tab-btn]");
    expect(bar).toHaveAttribute("data-mobile-mode", "scroll");
    expect(btn).toHaveClass("cms-section-tab-btn");
    expect(btn!.querySelector(".cms-section-tab-label")).not.toBeNull();
  });
});

// ───────────────────────── RUSZTOWANIE DLA RESZTY PLIKU ─────────────────────

/** Akcent podawany zawsze heksem - patrz nota o atrapie DOM w nagłówku. */
const AKCENT = "#ff0055";

type PropsyPaska = {
  sectionId?: string;
  lang?: "pl" | "en";
  activeId?: string;
  onSelect?: (id: string) => void;
  keyboard?: boolean;
};

/** Trzy pozycje z etykietami w obu językach i globalnym akcentem heksowym. */
function cfg(nadpisz: Partial<SectionTabsConfig> = {}): SectionTabsConfig {
  return {
    enabled: true,
    items: [
      { id: "t1", label_pl: "Jeden", label_en: "One" },
      { id: "t2", label_pl: "Dwa", label_en: "Two" },
      { id: "t3", label_pl: "Trzy", label_en: "Three" },
    ],
    accentColor: AKCENT,
    defaultTabId: "t1",
    ...nadpisz,
  };
}

function pasek(nadpisz: Partial<SectionTabsConfig> = {}, propsy: PropsyPaska = {}) {
  const {
    sectionId = "sec-1",
    lang = "pl",
    activeId = "t1",
    onSelect = () => {},
    keyboard,
  } = propsy;
  return render(
    <SectionTabsBar
      sectionId={sectionId}
      tabs={cfg(nadpisz)}
      lang={lang}
      activeId={activeId}
      onSelect={onSelect}
      keyboard={keyboard}
    />,
  );
}

function przyciski(c: HTMLElement): HTMLButtonElement[] {
  return Array.from(c.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]"));
}

function pasekEl(c: HTMLElement): HTMLDivElement {
  const el = c.querySelector<HTMLDivElement>("[data-section-tabs-bar]");
  expect(el).not.toBeNull();
  return el!;
}

/** Animowane wskaźniki (belka / kropka) - ikona atrapy nie ma aria-hidden. */
function wskazniki(btn: HTMLElement): HTMLSpanElement[] {
  return Array.from(btn.querySelectorAll<HTMLSpanElement>("[aria-hidden='true']"));
}

function etykiety(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll<HTMLSpanElement>(".cms-section-tab-label")).map(
    (s) => s.textContent ?? "",
  );
}

/**
 * Atrapa schowka przeciągania - happy-dom nie ma prawdziwego DataTransfer.
 * Skopiowana z src/components/admin/menu/__tests__/MenuManager.test.tsx:849-857.
 */
function schowek(types: string[]) {
  const store = new Map<string, string>();
  return {
    types,
    effectAllowed: "",
    setData: (key: string, value: string) => store.set(key, value),
    getData: (key: string) => store.get(key) ?? "",
  };
}

describe("SectionTabsBar - etykieta zakładki i język", () => {
  it("w języku PL pokazuje label_pl, mimo że label_en też jest ustawione", () => {
    const { container } = pasek({}, { lang: "pl" });
    expect(etykiety(container)).toEqual(["Jeden", "Dwa", "Trzy"]);
  });

  it("w języku EN pokazuje label_en, gdy jest niepuste", () => {
    const { container } = pasek({}, { lang: "en" });
    expect(etykiety(container)).toEqual(["One", "Two", "Three"]);
  });

  it("w języku EN bez label_en spada na label_pl", () => {
    const { container } = pasek(
      { items: [{ id: "t1", label_pl: "Polska nazwa" }] },
      { lang: "en" },
    );
    expect(etykiety(container)).toEqual(["Polska nazwa"]);
  });

  it("w języku EN label_en z samych spacji NIE wygrywa - wraca label_pl", () => {
    // Strażnik `.trim()` w labelOf (SectionTabsBar.tsx:22) to realny warunek,
    // a nie ozdoba: sama obecność języka EN nie wystarcza.
    const { container } = pasek(
      { items: [{ id: "t1", label_pl: "Polska nazwa", label_en: "   " }] },
      { lang: "en" },
    );
    expect(etykiety(container)).toEqual(["Polska nazwa"]);
  });

  it("pozycja bez obu etykiet dostaje literał awaryjny 'Tab'", () => {
    const { container } = pasek({ items: [{ id: "t1", label_pl: "" }] }, { lang: "pl" });
    expect(etykiety(container)).toEqual(["Tab"]);
  });

  // DEFEKT: ETYKIETA Z SAMYCH BIAŁYCH ZNAKÓW DAJE ZAKŁADKĘ BEZ NAZWY.
  //
  // WEJSCIE: pozycja `{ id: "t1", label_pl: "   ", label_en: "Two" }` przy
  //   `lang="pl"` - czyli pole wyczyszczone w panelu spacją zamiast Backspace.
  // CO PSUJE: `labelOf` (SectionTabsBar.tsx:21-24) sprawdza `.trim()` WYŁĄCZNIE
  //   dla `label_en` w ścieżce angielskiej. W ścieżce ogólnej wyrażenie
  //   `item.label_pl || item.label_en || "Tab"` widzi ciąg spacji jako wartość
  //   PRAWDZIWĄ, więc łańcuch awaryjny zatrzymuje się na pierwszym ogniwie.
  // KONSEKWENCJA: przycisk `role="tab"` renderuje się z pustą treścią - nie ma
  //   ani widocznej etykiety, ani nazwy dostępnej, więc czytnik ekranu ogłasza
  //   go jako "przycisk" bez nazwy, a na kanwie widać sam prostokąt. Funkcja
  //   WPROST przewiduje ostatnią deskę ratunku ("Tab"), tylko nigdy do niej nie
  //   dochodzi.
  // WYMAGANA POPRAWKA: `labelOf` sprawdza `.trim()` symetrycznie na obu
  //   kandydatach, tak by etykieta z samych spacji spadała na następnego,
  //   a ostatecznie na literał (który dodatkowo powinien iść przez i18n,
  //   bo dziś jest zaszyty po angielsku wbrew regule pary PL/EN).
  it.fails("DEFEKT: etykieta z samych spacji NIE może dawać zakładki bez nazwy", () => {
    const { container } = pasek(
      { items: [{ id: "t1", label_pl: "   ", label_en: "Two" }] },
      { lang: "pl" },
    );
    expect(etykiety(container).map((e) => e.trim())).toEqual(["Two"]);
  });
});

describe("SectionTabsBar - pusty pasek", () => {
  it("pusta lista pozycji nie renderuje ŻADNEGO węzła", () => {
    // Gałąź nieosiągalna przez BuilderRenderer (bramkuje `items.length`
    // wcześniej), więc wykonuje ją wyłącznie bezpośredni render.
    const { container } = pasek({ items: [] });
    expect(container.firstChild).toBeNull();
  });
});

describe("SectionTabsBar - kontener paska", () => {
  it("domyślnie jest poziomy, przewijany i bez zawijania", () => {
    const { container } = pasek();
    const bar = pasekEl(container);
    expect(bar).toHaveAttribute("data-orientation", "horizontal");
    expect(bar).toHaveAttribute("aria-orientation", "horizontal");
    expect(bar).toHaveAttribute("data-mobile-mode", "scroll");
    expect(bar.style.overflowX).toBe("auto");
    expect(bar.style.flexWrap).toBe("nowrap");
    expect(bar.style.maxWidth).toBe("100%");
  });

  it("orientacja pionowa buduje INNY obiekt stylu, a nie dokłada się do poziomego", () => {
    const { container } = pasek({ orientation: "vertical" });
    const bar = pasekEl(container);
    expect(bar).toHaveAttribute("aria-orientation", "vertical");
    expect(bar.style.flexDirection).toBe("column");
    expect(bar.style.gap).toBe("4px");
    expect(bar.style.minWidth).toBe("160px");
    // Pola gałęzi poziomej NIE mogą wyciec do pionowej.
    expect(bar.style.overflowX).toBe("");
    expect(bar.style.flexWrap).toBe("");
    expect(bar.style.maxWidth).toBe("");
  });

  it.each<[SectionTabsConfig["align"], string]>([
    ["start", "flex-start"],
    ["center", "center"],
    ["end", "flex-end"],
    [undefined, "flex-start"],
  ])("wyrównanie %s daje justify-content %s", (align, oczekiwane) => {
    const { container } = pasek({ align });
    expect(pasekEl(container).style.justifyContent).toBe(oczekiwane);
  });

  it("tryb 'wrap' zawija pozycje i wyłącza przewijanie w poziomie", () => {
    const { container } = pasek({ mobileMode: "wrap" });
    const bar = pasekEl(container);
    expect(bar).toHaveAttribute("data-mobile-mode", "wrap");
    expect(bar.style.flexWrap).toBe("wrap");
    expect(bar.style.overflowX).toBe("visible");
  });

  it.each<[SectionTabsVariant, string]>([
    ["segmented", "0"],
    ["pills", "6px"],
    ["pills-solid", "6px"],
    ["ghost", "6px"],
    ["boxed-top", "4px"],
    ["bordered", "4px"],
    ["underline", "2px"],
    ["minimal", "2px"],
  ])("wariant %s ustawia odstęp pozycji na %s", (variant, oczekiwany) => {
    const { container } = pasek({ variant });
    expect(pasekEl(container).style.gap).toBe(oczekiwany);
  });

  it("wariant segmented daje kontenerowi wewnętrzne dopełnienie i zaokrąglenie", () => {
    // Tło `color-mix(in oklab, currentColor 6%, transparent)` atrapa DOM
    // wycina (patrz nota w nagłówku), więc dowodem wykonania tej gałęzi jest
    // GEOMETRIA. Skrót `padding: 3` sąsiaduje z `paddingBottom: undefined`,
    // przez co happy-dom serializuje tylko trzy boki - dlatego czytamy
    // `paddingTop`, a nie skrót.
    const { container } = pasek({ variant: "segmented" });
    const bar = pasekEl(container);
    expect(bar.style.paddingTop).toBe("3px");
    expect(bar.style.borderRadius).toBe("10px");
    expect(bar.style.background).toBe("");
  });

  it.each<[SectionTabsVariant, string]>([
    ["underline-dot", "18px"],
    ["underline-thick", "4px"],
    ["underline-gradient", "4px"],
    ["underline", ""],
    ["pills", ""],
  ])("wariant %s rezerwuje pod paskiem %s", (variant, oczekiwane) => {
    // Ramka `borderBottom` rodziny underline jest zbudowana z var(), które
    // atrapa DOM wycina - rodzinę rozpoznajemy więc po zarezerwowanym miejscu
    // na wskaźnik, nie po ramce.
    const { container } = pasek({ variant });
    expect(pasekEl(container).style.paddingBottom).toBe(oczekiwane);
  });
});

describe("SectionTabsBar - warianty przycisku", () => {
  it("pills: aktywna dostaje kolor akcentu, nieaktywna zostaje przezroczysta", () => {
    const { container } = pasek({ variant: "pills" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.borderRadius).toBe("5px");
    expect(aktywny.style.color).toBe(AKCENT);
    // Tło aktywnej to color-mix - atrapa je wycina, gałąź mimo to wykonana.
    expect(aktywny.style.background).toBe("");
    expect(nieaktywny.style.borderRadius).toBe("5px");
    expect(nieaktywny.style.background).toBe("transparent");
    expect(nieaktywny.style.color).toBe("");
  });

  it("pills-solid: aktywna ma pełne tło akcentu i poświatę, nieaktywna nie ma żadnej", () => {
    const { container } = pasek({ variant: "pills-solid" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.background).toBe(AKCENT);
    expect(aktywny.style.boxShadow).toContain("color-mix");
    expect(aktywny.style.boxShadow).toContain(AKCENT);
    expect(nieaktywny.style.background).toBe("transparent");
    expect(nieaktywny.style.boxShadow).toBe("none");
  });

  it("bordered: aktywna obramowana akcentem, nieaktywna tokenem obramowania", () => {
    // Pełny skrót `border: 1px solid var(...)` PRZEŻYWA atrapę DOM (zmierzone),
    // więc obie strony da się udowodnić wprost.
    const { container } = pasek({ variant: "bordered" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.border).toBe(`1px solid ${AKCENT}`);
    expect(aktywny.style.borderRadius).toBe("8px");
    expect(nieaktywny.style.border).toBe("1px solid var(--border, hsl(var(--border)))");
    expect(nieaktywny.style.background).toBe("transparent");
  });

  it("segmented: aktywna dostaje cień i akcent, nieaktywna gasi cień", () => {
    const { container } = pasek({ variant: "segmented" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.boxShadow).toBe("0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)");
    expect(aktywny.style.color).toBe(AKCENT);
    expect(aktywny.style.borderRadius).toBe("8px");
    // Segmented ma też WŁASNE dopełnienie przycisku (SectionTabsBar.tsx:136).
    expect(aktywny.style.padding).toBe("6px 12px");
    expect(nieaktywny.style.boxShadow).toBe("none");
  });

  it("boxed-top: obie zakładki mają górne zaokrąglenie i wchodzą na ramkę paska", () => {
    // Ramki aktywnej strony są zbudowane z var() i atrapa je wycina, więc
    // stronę aktywną domyka test wskaźnika górnej belki niżej.
    const { container } = pasek({ variant: "boxed-top" });
    const [aktywny, nieaktywny] = przyciski(container);
    for (const btn of [aktywny, nieaktywny]) {
      expect(btn.style.borderRadius).toBe("8px 8px 0px 0px");
      expect(btn.style.marginBottom).toBe("-1px");
      expect(btn.style.borderBottom).toBe("1px solid transparent");
    }
    expect(nieaktywny.style.borderLeft).toBe("1px solid transparent");
    expect(nieaktywny.style.borderRight).toBe("1px solid transparent");
    expect(nieaktywny.style.background).toBe("transparent");
  });

  it("minimal: aktywna pełna, nieaktywna przygaszona", () => {
    const { container } = pasek({ variant: "minimal" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.opacity).toBe("1");
    expect(aktywny.style.color).toBe(AKCENT);
    expect(aktywny.style.marginRight).toBe("12px");
    expect(aktywny.style.padding).toBe("6px 4px");
    expect(nieaktywny.style.opacity).toBe("0.7");
  });

  it("ghost (i wariant domyślny switcha) zaokrągla obie zakładki", () => {
    const { container } = pasek({ variant: "ghost" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(aktywny.style.borderRadius).toBe("8px");
    expect(nieaktywny.style.borderRadius).toBe("8px");
    expect(nieaktywny.style.background).toBe("transparent");
    // Tło aktywnej to color-mix na currentColor - wycięte przez atrapę.
    expect(aktywny.style.background).toBe("");
  });

  it("rodzina underline dosuwa przyciski o piksel na ramkę paska", () => {
    for (const variant of [
      "underline",
      "underline-dot",
      "underline-thick",
      "underline-gradient",
    ] as const) {
      const { container } = render(
        <SectionTabsBar
          sectionId="sec-1"
          tabs={cfg({ variant })}
          lang="pl"
          activeId="t1"
          onSelect={() => {}}
        />,
      );
      przyciski(container).forEach((b) => expect(b.style.marginBottom).toBe("-1px"));
      cleanup();
    }
  });
});

describe("SectionTabsBar - wskaźniki aktywnej zakładki", () => {
  it("underline: belka rozwija się od lewej na aktywnej i znika na nieaktywnej", () => {
    const { container } = pasek({ variant: "underline" });
    const [aktywny, nieaktywny] = przyciski(container);
    const belkaA = wskazniki(aktywny)[0];
    const belkaN = wskazniki(nieaktywny)[0];
    expect(belkaA.style.height).toBe("2px");
    expect(belkaA.style.background).toBe(AKCENT);
    expect(belkaA.style.transform).toBe("scaleX(1)");
    expect(belkaA.style.transformOrigin).toBe("left center");
    expect(belkaA.style.opacity).toBe("1");
    expect(belkaN.style.transform).toBe("scaleX(0)");
    expect(belkaN.style.transformOrigin).toBe("right center");
    expect(belkaN.style.opacity).toBe("0");
  });

  it("underline-thick: belka jest grubsza i ma zaokrąglone górne rogi", () => {
    const { container } = pasek({ variant: "underline-thick" });
    const belka = wskazniki(przyciski(container)[0])[0];
    expect(belka.style.height).toBe("4px");
    expect(belka.style.borderRadius).toBe("2px 2px 0px 0px");
  });

  it("underline-gradient: belka jest gradientem od akcentu", () => {
    const { container } = pasek({ variant: "underline-gradient" });
    const belka = wskazniki(przyciski(container)[0])[0];
    expect(belka.style.height).toBe("3px");
    expect(belka.style.background).toContain("linear-gradient(90deg,");
    expect(belka.style.background).toContain(AKCENT);
  });

  it("underline-dot: zamiast belki jest kropka pod etykietą", () => {
    // isUnderline (SectionTabsBar.tsx:231) ŚWIADOMIE wyklucza underline-dot -
    // ten wariant dostaje wyłącznie kropkę, nigdy belki.
    const { container } = pasek({ variant: "underline-dot" });
    const [aktywny, nieaktywny] = przyciski(container);
    expect(wskazniki(aktywny)).toHaveLength(1);
    const kropka = wskazniki(aktywny)[0];
    expect(kropka.style.width).toBe("6px");
    expect(kropka.style.height).toBe("6px");
    expect(kropka.style.borderRadius).toBe("999px");
    expect(kropka.style.bottom).toBe("-8px");
    expect(kropka.style.left).toBe("50%");
    expect(kropka.style.background).toBe(AKCENT);
    expect(kropka.style.transform).toBe("translateX(-50%) scale(1)");
    expect(wskazniki(nieaktywny)[0].style.transform).toBe("translateX(-50%) scale(0)");
    expect(wskazniki(nieaktywny)[0].style.opacity).toBe("0");
  });

  it("boxed-top: belka jest NA GÓRZE zakładki i tylko aktywna ją rozwija", () => {
    const { container } = pasek({ variant: "boxed-top" });
    const [aktywny, nieaktywny] = przyciski(container);
    const belka = wskazniki(aktywny)[0];
    expect(belka.style.top).toBe("0px");
    expect(belka.style.height).toBe("3px");
    expect(belka.style.background).toBe(AKCENT);
    expect(belka.style.transform).toBe("scaleX(1)");
    expect(wskazniki(nieaktywny)[0].style.transform).toBe("scaleX(0)");
  });

  it("pills: żaden z trzech wskaźników się nie renderuje", () => {
    const { container } = pasek({ variant: "pills" });
    przyciski(container).forEach((b) => expect(wskazniki(b)).toHaveLength(0));
  });
});

describe("SectionTabsBar - ikona zakładki", () => {
  it("pozycja bez ikony nie renderuje żadnej ikony", () => {
    const { container } = pasek();
    expect(container.querySelector("[data-ikona]")).toBeNull();
  });

  it("pozycja z ikoną dostaje wymiar z konfiguracji i akcent tylko na aktywnej", () => {
    const { container } = pasek({
      iconSize: 20,
      items: [
        { id: "t1", label_pl: "Jeden", icon: "star" },
        { id: "t2", label_pl: "Dwa", icon: "flag" },
      ],
    });
    const [aktywny, nieaktywny] = przyciski(container);
    const ikonaA = aktywny.querySelector<HTMLElement>("[data-ikona]")!;
    const ikonaN = nieaktywny.querySelector<HTMLElement>("[data-ikona]")!;
    expect(ikonaA).toHaveAttribute("data-ikona", "star");
    expect(ikonaA).toHaveAttribute("data-w", "20");
    expect(ikonaA).toHaveAttribute("data-h", "20");
    expect(ikonaA.style.color).toBe(AKCENT);
    expect(ikonaA.style.flexShrink).toBe("0");
    expect(ikonaN).toHaveAttribute("data-ikona", "flag");
    expect(ikonaN.style.color).toBe("currentcolor");
  });

  it.each<[number | undefined, string]>([
    [4, "10"],
    [999, "32"],
    [undefined, "16"],
  ])("iconSize %s jest zaciskany do %s", (iconSize, oczekiwany) => {
    const { container } = pasek({
      iconSize,
      items: [{ id: "t1", label_pl: "Jeden", icon: "star" }],
    });
    expect(container.querySelector("[data-ikona]")).toHaveAttribute("data-w", oczekiwany);
  });

  it("iconPosition 'top' układa przycisk w kolumnę i zmienia dopełnienie", () => {
    const { container } = pasek({ iconPosition: "top" });
    const btn = przyciski(container)[0];
    expect(btn.style.flexDirection).toBe("column");
    expect(btn.style.gap).toBe("4px");
    expect(btn.style.padding).toBe("10px 14px 8px");
  });

  it("domyślne iconPosition 'left' układa przycisk w wiersz", () => {
    const { container } = pasek();
    const btn = przyciski(container)[0];
    expect(btn.style.flexDirection).toBe("row");
    expect(btn.style.gap).toBe("8px");
    expect(btn.style.padding).toBe("8px 14px");
  });

  it("iconPosition 'top' RAZEM z wariantem minimal daje własne dopełnienie", () => {
    // Zagnieżdżony warunek z SectionTabsBar.tsx:214 - samo "minimal" go nie
    // odsłania, bo przy ikonie z lewej daje "6px 4px".
    const { container } = pasek({ iconPosition: "top", variant: "minimal" });
    expect(przyciski(container)[0].style.padding).toBe("6px 8px");
  });
});

describe("SectionTabsBar - kolor akcentu", () => {
  it("globalny accentColor barwi aktywną zakładkę", () => {
    const { container } = pasek({ variant: "pills-solid" });
    expect(przyciski(container)[0].style.background).toBe(AKCENT);
  });

  it("kolor per pozycja wygrywa nad globalnym i TYLKO na swojej pozycji", () => {
    const { container } = pasek(
      {
        variant: "pills-solid",
        items: [
          { id: "t1", label_pl: "Jeden" },
          { id: "t2", label_pl: "Dwa", color: "#00aa00" },
        ],
      },
      { activeId: "t2" },
    );
    const [pierwszy, drugi] = przyciski(container);
    expect(drugi.style.background).toBe("#00aa00");
    // Pierwsza pozycja jest nieaktywna, więc jej tło jest przezroczyste,
    // ale jej wskaźnik nadal niesie akcent GLOBALNY, nie zielony.
    expect(pierwszy.style.background).toBe("transparent");
  });

  it("kolor per pozycja z samych spacji spada na akcent globalny", () => {
    const { container } = pasek(
      {
        variant: "pills-solid",
        items: [
          { id: "t1", label_pl: "Jeden" },
          { id: "t2", label_pl: "Dwa", color: "  " },
        ],
      },
      { activeId: "t2" },
    );
    expect(przyciski(container)[1].style.background).toBe(AKCENT);
  });

  it("accentColor z samych spacji nie wpuszcza białych znaków do stylu", () => {
    // DOWÓD NEGATYWNY wymuszony przez atrapę DOM (wzorem
    // SignupPopupPanelLayout.test.tsx:153-165): strażnik `.trim()` podstawia
    // token `var(--brand, currentColor)`, którego happy-dom nie umie
    // sparsować, więc pole tła zostaje puste. Gdyby strażnika nie było,
    // do stylu trafiłby ciąg spacji - też pusty, ale wtedy pasek nie miałby
    // ŻADNEGO koloru akcentu również w przeglądarce. Dlatego równolegle
    // sprawdzamy to na kropce wariantu underline-dot: jej `box-shadow` atrapa
    // przepuszcza DOSŁOWNIE (zmierzone - nie waliduje tej własności), więc
    // widać wprost, że w miejsce akcentu trafił token projektu, a nie ciąg
    // spacji. Bez strażnika `.trim()` byłoby tam `color-mix(in oklab,
    // <spacje> 20%, transparent)`, czyli reguła bez koloru.
    const { container } = pasek({ variant: "pills-solid", accentColor: "   " });
    expect(przyciski(container)[0].style.background).toBe("");

    cleanup();
    const { container: c2 } = pasek({ variant: "underline-dot", accentColor: "   " });
    expect(wskazniki(przyciski(c2)[0])[0].style.boxShadow).toContain("var(--brand, currentColor)");
  });
});

describe("SectionTabsBar - nawigacja klawiaturą", () => {
  function zKlawiatura(nadpisz: Partial<SectionTabsConfig> = {}, propsy: PropsyPaska = {}) {
    const onSelect = vi.fn<(id: string) => void>();
    const wynik = pasek(nadpisz, { ...propsy, onSelect });
    return { onSelect, ...wynik };
  }

  it("ArrowRight wybiera następną zakładkę", () => {
    const { container, onSelect } = zKlawiatura();
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("ArrowRight na OSTATNIEJ zakładce zawija na pierwszą", () => {
    const { container, onSelect } = zKlawiatura({}, { activeId: "t3" });
    fireEvent.keyDown(przyciski(container)[2], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("ArrowLeft wybiera poprzednią zakładkę", () => {
    const { container, onSelect } = zKlawiatura({}, { activeId: "t2" });
    fireEvent.keyDown(przyciski(container)[1], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("ArrowLeft na PIERWSZEJ zakładce zawija na ostatnią", () => {
    const { container, onSelect } = zKlawiatura();
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("t3");
  });

  it("Home wybiera pierwszą, End ostatnią zakładkę", () => {
    const { container, onSelect } = zKlawiatura({}, { activeId: "t2" });
    fireEvent.keyDown(przyciski(container)[1], { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith("t1");
    fireEvent.keyDown(przyciski(container)[1], { key: "End" });
    expect(onSelect).toHaveBeenCalledWith("t3");
  });

  it("w orientacji pionowej ArrowDown i ArrowUp przesuwają wybór", () => {
    const { container, onSelect } = zKlawiatura({ orientation: "vertical" }, { activeId: "t2" });
    fireEvent.keyDown(przyciski(container)[1], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("t3");
    fireEvent.keyDown(przyciski(container)[1], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("w orientacji poziomej ArrowDown i ArrowUp NIE zmieniają zakładki", () => {
    // Strażnik orientacji jest realnym strażnikiem, a nie warunkiem zawsze
    // prawdziwym: w poziomie pionowe strzałki należą do przewijania strony.
    const { container, onSelect } = zKlawiatura({}, { activeId: "t2" });
    fireEvent.keyDown(przyciski(container)[1], { key: "ArrowDown" });
    fireEvent.keyDown(przyciski(container)[1], { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([["a"], [" "], ["Escape"]])(
    "klawisz %s nie zmienia zakładki i NIE jest przechwytywany",
    (key) => {
      const { container, onSelect } = zKlawiatura();
      // fireEvent zwraca false, gdy zdarzenie anulowano - tu ma zwrócić true,
      // bo komponent nie może kraść klawiszy, których nie obsługuje.
      const niezanulowane = fireEvent.keyDown(przyciski(container)[0], { key });
      expect(onSelect).not.toHaveBeenCalled();
      expect(niezanulowane).toBe(true);
    },
  );

  it("rozpoznany klawisz jest przechwytywany (preventDefault)", () => {
    const { container } = zKlawiatura();
    expect(fireEvent.keyDown(przyciski(container)[0], { key: "ArrowRight" })).toBe(false);
  });

  it("keyboard={false} całkowicie wyłącza obsługę klawiatury", () => {
    // Gałąź osiągalna WYŁĄCZNIE z bezpośredniego renderu - BuilderRenderer
    // (BuilderRenderer.tsx:597 i :614) nigdy tego propa nie podaje.
    const { container, onSelect } = zKlawiatura({}, { keyboard: false });
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowRight" });
    fireEvent.keyDown(przyciski(container)[0], { key: "Home" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("activeId spoza listy unieruchamia strzałki", () => {
    const { container, onSelect } = zKlawiatura({}, { activeId: "nie-ma-takiej" });
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowRight" });
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowLeft" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  // DEFEKT: OGNISKO NIE IDZIE ZA WYBOREM Z KLAWIATURY.
  //
  // WEJSCIE: pasek trzech zakładek, ognisko na aktywnej "t1", użytkownik
  //   naciska ArrowRight; rodzic (BuilderRenderer) przerysowuje pasek
  //   z `activeId="t2"`.
  // CO PSUJE: handler `onKey` (SectionTabsBar.tsx:94-112) woła wyłącznie
  //   `onSelect(items[next].id)`. W całym pliku nie ma ani jednego `useRef`
  //   ani `focus()`, więc po przerysowaniu ognisko zostaje na STARYM
  //   przycisku - a ten w tym samym renderze dostaje `tabIndex={-1}`
  //   (SectionTabsBar.tsx:250), podczas gdy nowo aktywny dostaje `tabIndex={0}`
  //   bez ogniska.
  // KONSEKWENCJA: czytnik ekranu nie ogłasza zmiany zakładki (ognisko się nie
  //   ruszyło), a wyjście i powrót klawiszem Tab wraca w INNE miejsce niż to,
  //   które wizualnie jest aktywne. Element z tabIndex -1 pod ogniskiem to
  //   dokładnie ten stan, którego wzorzec WAI-ARIA dla tablist zabrania.
  // WYMAGANA POPRAWKA: po `onSelect(items[next].id)` komponent przenosi
  //   ognisko na przycisk `#sec-<sectionId>-tab-<nowe id>` (wzorzec tablist
  //   z aktywacją automatyczną).
  it.fails("DEFEKT: po strzałce ognisko MUSI przejść na nowo wybraną zakładkę", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container, rerender } = render(
      <SectionTabsBar sectionId="sec-1" tabs={cfg()} lang="pl" activeId="t1" onSelect={onSelect} />,
    );
    przyciski(container)[0].focus();
    fireEvent.keyDown(przyciski(container)[0], { key: "ArrowRight" });
    rerender(
      <SectionTabsBar sectionId="sec-1" tabs={cfg()} lang="pl" activeId="t2" onSelect={onSelect} />,
    );
    expect(document.activeElement).toBe(przyciski(container)[1]);
  });

  // DEFEKT: NIEZNANY activeId ZABIJA RÓWNIEŻ HOME I END.
  //
  // WEJSCIE: pasek trzech zakładek z `activeId="usunieta"` - stan przejściowy
  //   w edytorze zaraz po skasowaniu lub przemianowaniu aktywnej zakładki,
  //   zanim korekta w BuilderRenderer zdąży zadziałać.
  // CO PSUJE: `const cur = idxOf(activeId); if (cur < 0) return;`
  //   (SectionTabsBar.tsx:96-97) wychodzi z handlera PRZED rozpoznaniem
  //   klawisza, więc wyłącza CAŁĄ klawiaturę - także Home i End, których
  //   jedynym zadaniem jest odzyskanie znanej pozycji bez oglądania się na
  //   stan bieżący.
  // KONSEKWENCJA: użytkownik klawiatury zostaje w martwym pasku i nie ma
  //   ŻADNEGO klawisza, którym wróciłby do pierwszej zakładki - jedynym
  //   wyjściem jest mysz, co dla nawigacji klawiaturowej jest ślepą uliczką.
  // WYMAGANA POPRAWKA: Home wybiera pierwszą pozycję, End ostatnią, a strzałki
  //   startują od indeksu 0 - niezależnie od tego, czy `activeId` trafia
  //   w listę.
  it.fails("DEFEKT: Home MUSI odzyskać pierwszą zakładkę przy nieznanym activeId", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { activeId: "usunieta", onSelect });
    fireEvent.keyDown(przyciski(container)[0], { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});

describe("SectionTabsBar - zdarzenia wskaźnika i przeciągania", () => {
  /** Pasek owinięty przodkiem ze szpiegami - kanwa buildera tak właśnie nasłuchuje. */
  function zPrzodkiem(propsy: PropsyPaska = {}) {
    const naPrzodku = {
      mouseDown: vi.fn(),
      pointerDown: vi.fn(),
      click: vi.fn(),
    };
    const onSelect = propsy.onSelect ?? vi.fn<(id: string) => void>();
    const { container } = render(
      <div
        onMouseDown={naPrzodku.mouseDown}
        onPointerDown={naPrzodku.pointerDown}
        onClick={naPrzodku.click}
      >
        <SectionTabsBar
          sectionId="sec-1"
          tabs={cfg()}
          lang="pl"
          activeId={propsy.activeId ?? "t1"}
          onSelect={onSelect}
        />
      </div>,
    );
    return { container, naPrzodku, onSelect };
  }

  it("mousedown na zakładce NIE dochodzi do przodka", () => {
    // Pasek nosi `data-builder-chrome` (SectionTabsBar.tsx:251), a kanwa
    // (VisualCanvas.tsx) traktuje chrome jako element spoza dokumentu - bez
    // zatrzymania propagacji klik w zakładkę zaczynałby zaznaczanie sekcji.
    const { container, naPrzodku } = zPrzodkiem();
    fireEvent.mouseDown(przyciski(container)[1]);
    expect(naPrzodku.mouseDown).not.toHaveBeenCalled();
  });

  it("pointerdown na zakładce NIE dochodzi do przodka", () => {
    const { container, naPrzodku } = zPrzodkiem();
    fireEvent.pointerDown(przyciski(container)[1]);
    expect(naPrzodku.pointerDown).not.toHaveBeenCalled();
  });

  it("klik wybiera zakładkę i JEDNOCZEŚNIE nie dochodzi do przodka", () => {
    const { container, naPrzodku, onSelect } = zPrzodkiem();
    fireEvent.click(przyciski(container)[2]);
    expect(onSelect).toHaveBeenCalledWith("t3");
    expect(naPrzodku.click).not.toHaveBeenCalled();
  });

  it("przeciągnięcie nad NIEAKTYWNĄ zakładką przełącza na nią", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { onSelect });
    fireEvent.dragEnter(przyciski(container)[1], {
      dataTransfer: schowek(["application/x-widget-type"]),
    });
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("przeciągnięcie nad JUŻ aktywną zakładką nic nie robi", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { onSelect });
    fireEvent.dragEnter(przyciski(container)[0], {
      dataTransfer: schowek(["application/x-widget-type"]),
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("przeciągnięcie z PUSTĄ listą typów nic nie robi", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { onSelect });
    fireEvent.dragEnter(przyciski(container)[1], { dataTransfer: schowek([]) });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("przeciągnięcie BEZ schowka nic nie robi i nie rzuca", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { onSelect });
    expect(() => fireEvent.dragEnter(przyciski(container)[1], {})).not.toThrow();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("dragover jest anulowany, więc zakładka ogłasza się celem upuszczenia", () => {
    const { container } = pasek();
    const anulowane =
      fireEvent.dragOver(przyciski(container)[1], {
        dataTransfer: schowek(["application/x-widget-type"]),
      }) === false;
    expect(anulowane).toBe(true);
  });

  // DEFEKT: PRZECIĄGANIE DOWOLNEJ TREŚCI PRZEŁĄCZA ZAKŁADKĘ.
  //
  // WEJSCIE: użytkownik przeciąga zwykły zaznaczony tekst (schowek z typem
  //   "text/plain") albo plik z pulpitu ("Files") nad pasek zakładek.
  // CO PSUJE: `onDragEnter` (SectionTabsBar.tsx:262-266) sprawdza wyłącznie
  //   `e.dataTransfer.types.length > 0`, czyli "cokolwiek jest przeciągane".
  //   Żadnego filtru po MIME nie ma. Bliźniaczo `onDragOver` (:267-269)
  //   bezwarunkowo woła `preventDefault()`, przez co KAŻDY przycisk zakładki
  //   ogłasza się prawidłowym celem upuszczenia, choć `onDrop` nie istnieje.
  // KONSEKWENCJA: przypadkowe przeciągnięcie tekstu po stronie publicznej
  //   podmienia widoczną zakładkę, a kursor kłamie, obiecując upuszczenie,
  //   które nigdy się nie wydarzy. Repo ma na to gotowy wzorzec: MenuManager
  //   filtruje po własnym MIME "application/x-menu-item".
  // WYMAGANA POPRAWKA: oba uchwyty reagują wyłącznie na własny ładunek
  //   buildera "application/x-widget-type" (ustawiany w
  //   src/components/admin/builder/ui/organisms/WidgetLibrary.tsx:452),
  //   a na pozostałe typy pozostają obojętne.
  it.fails("DEFEKT: przeciągnięcie zwykłego tekstu NIE może przełączać zakładki", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = pasek({}, { onSelect });
    fireEvent.dragEnter(przyciski(container)[1], { dataTransfer: schowek(["text/plain"]) });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("SectionTabsBar - dostępność", () => {
  it("pasek to tablist, a aktywna zakładka jest jedyną w kolejce Tab", () => {
    const { container } = pasek({}, { activeId: "t2" });
    expect(pasekEl(container)).toHaveAttribute("role", "tablist");
    const btns = przyciski(container);
    expect(btns.map((b) => b.getAttribute("role"))).toEqual(["tab", "tab", "tab"]);
    expect(btns.map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(btns.map((b) => b.getAttribute("data-active"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.getAttribute("data-section-tab-id"))).toEqual(["t1", "t2", "t3"]);
  });

  it("identyfikatory ARIA są zbudowane z sectionId, więc dwa paski nie kolidują", () => {
    const { container } = render(
      <div>
        <SectionTabsBar
          sectionId="sekcja-a"
          tabs={cfg()}
          lang="pl"
          activeId="t1"
          onSelect={() => {}}
        />
        <SectionTabsBar
          sectionId="sekcja-b"
          tabs={cfg()}
          lang="pl"
          activeId="t1"
          onSelect={() => {}}
        />
      </div>,
    );
    const btns = przyciski(container);
    expect(btns).toHaveLength(6);
    expect(btns[0].id).toBe("sec-sekcja-a-tab-t1");
    expect(btns[0]).toHaveAttribute("aria-controls", "sec-sekcja-a-panel-t1");
    expect(btns[3].id).toBe("sec-sekcja-b-tab-t1");
    expect(btns[3]).toHaveAttribute("aria-controls", "sec-sekcja-b-panel-t1");
    const identyfikatory = btns.map((b) => b.id);
    expect(new Set(identyfikatory).size).toBe(identyfikatory.length);
  });

  it("struktura paska z kompletem paneli nie ma naruszeń dostępności (axe)", async () => {
    const { container } = render(
      <div>
        <SectionTabsBar
          sectionId="a11y"
          tabs={cfg({
            items: [
              { id: "t1", label_pl: "Jeden" },
              { id: "t2", label_pl: "Dwa" },
            ],
          })}
          lang="pl"
          activeId="t1"
          onSelect={() => {}}
        />
        {["t1", "t2"].map((id) => (
          <div
            key={id}
            role="tabpanel"
            id={`sec-a11y-panel-${id}`}
            aria-labelledby={`sec-a11y-tab-${id}`}
            hidden={id !== "t1"}
          >
            Treść {id}
          </div>
        ))}
      </div>,
    );
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  // DEFEKT: aria-controls NIEAKTYWNYCH ZAKŁADEK WSKAZUJE PANEL, KTÓREGO NIE MA.
  //
  // WEJSCIE: sekcja z dwiema zakładkami wyrenderowana tak, jak robi to
  //   produkcja - pasek plus JEDEN panel aktywnej zakładki.
  // CO PSUJE: każdy przycisk dostaje `aria-controls="sec-<sectionId>-panel-<jego
  //   id>"` (SectionTabsBar.tsx:249), natomiast BuilderRenderer trzyma
  //   w drzewie tylko jeden panel, o identyfikatorze zbudowanym z
  //   `displayTabId` (BuilderRenderer.tsx:626). Nieaktywne zakładki wskazują
  //   więc element, którego w dokumencie NIE MA.
  // KONSEKWENCJA: czytnik ekranu nie potrafi przejść z zakładki do jej panelu
  //   i nie ogłasza relacji; to również naruszenie reguły axe
  //   `aria-valid-attr-value`, czyli realny błąd audytu dostępności, a nie
  //   kosmetyka.
  // WYMAGANA POPRAWKA: albo renderować panele WSZYSTKICH zakładek z ukryciem
  //   nieaktywnych atrybutem `hidden`, albo pomijać `aria-controls` na
  //   zakładkach nieaktywnych.
  it.fails("DEFEKT: każde aria-controls MUSI wskazywać istniejący panel", () => {
    const { container } = render(
      <div>
        <SectionTabsBar
          sectionId="jeden-panel"
          tabs={cfg()}
          lang="pl"
          activeId="t1"
          onSelect={() => {}}
        />
        <div role="tabpanel" id="sec-jeden-panel-panel-t1" aria-labelledby="sec-jeden-panel-tab-t1">
          Treść aktywnej zakładki
        </div>
      </div>,
    );
    const wiszace = przyciski(container)
      .map((b) => b.getAttribute("aria-controls") ?? "")
      .filter((id) => container.querySelector(`#${id}`) === null);
    expect(wiszace).toEqual([]);
  });
});
