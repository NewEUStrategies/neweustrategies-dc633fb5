// ETYKIETA SEKCJI: TYPOGRAFIA Z PANELU, KOLOR AKCENTU I ODCZYT TREŚCI CMS.
//
// Co ten plik udowadnia:
//
// 1. KAŻDE USTAWIENIE TYPOGRAFII Z PANELU DOCIERA DO WŁAŚCIWEGO ELEMENTU.
//    Numer (editorial-index, numbered-rail) i druga etykieta (masthead,
//    kicker, lede, duo) dostają krój i rozmiar wpisany w panelu. W wąskiej
//    kolumnie (`size="sm"`) rozmiar z panelu jest IGNOROWANY - wariant trzyma
//    własną, kompaktową skalę - ale krój nadal obowiązuje. To samo dla
//    rozmiaru akcji, także w domyślnym wariancie kinetic-signal-notch.
// 2. KOLOR TEKSTU NA AKCENCIE JEST CZYTELNY. Wypełniony tag/odznaka liczy
//    kontrast z akcentu (także z trzyznakowego hex); akcentu, którego nie da
//    się policzyć lokalnie (oklch, var()), nie zgadujemy - zostaje biel,
//    a jawny kolor etykiety z panelu wygrywa z wyliczeniem.
// 3. ODCZYT TREŚCI CMS (`readSectionLabelProps`). Łańcuchy językowe
//    (żądany -> PL -> wartość zastępcza), akcent per widget w ciemnym motywie
//    z `accentColorDark` z powrotem do wspólnej inwersji akcentu, wartości
//    spoza typu `string` nigdy nie trafiają na ekran.
// 4. KATALOGI PANELU (krój, kolor) są rozwiązywalne w całości: każda opcja
//    poza „Domyślna" daje stos fontów, każdy preset koloru - konkretny kolor,
//    a aliasy historyczne - ten sam kolor co ich współczesny odpowiednik.
//
// GRANICE: `AppLink` woła `useRouter()` - podmieniamy wyłącznie ten hook (jak
// sąsiednie testy etykiety). Inwersja akcentu w ciemnym motywie to wspólny
// helper `autoInvertColor`, nie atrapa - test sprawdza, że etykieta z niego
// korzysta, a nie jego heurystykę (ta ma własne testy).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: () => Promise.resolve(),
      preloadRoute: () => Promise.resolve(),
    }),
  };
});

import {
  readSectionLabelProps,
  resolveAccentColor,
  resolveFontFamily,
  SECTION_LABEL_FONTS,
  SectionLabelRender,
  SectionLabelWidgetView,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";

afterEach(cleanup);

type RenderProps = ComponentProps<typeof SectionLabelRender>;

function renderLabel(variant: SectionLabelVariant, props: Partial<RenderProps> = {}) {
  return render(
    <SectionLabelRender label="Tytuł sekcji" accent="#FA9346" variant={variant} {...props} />,
  );
}

const MONO = resolveFontFamily("mono");
const SERIF = resolveFontFamily("serif");

describe("etykieta sekcji - numer wariantów z indeksem", () => {
  it.each(["editorial-index", "numbered-rail"] as const)(
    "%s rysuje numer z krojem i rozmiarem z panelu",
    (variant) => {
      renderLabel(variant, { indexNumber: "07", numberFont: "mono", numberSize: "40px" });
      const num = screen.getByText("07");
      expect(num.style.fontFamily).toBe(MONO);
      expect(num.style.fontSize).toBe("40px");
    },
  );

  it.each(["editorial-index", "numbered-rail"] as const)(
    "%s w wąskiej kolumnie trzyma własną skalę numeru, ale nie gubi kroju",
    (variant) => {
      renderLabel(variant, {
        size: "sm",
        indexNumber: "07",
        numberFont: "mono",
        numberSize: "40px",
      });
      const num = screen.getByText("07");
      expect(num.style.fontSize).toBe("");
      expect(num.style.fontFamily).toBe(MONO);
    },
  );

  it.each(["editorial-index", "numbered-rail"] as const)(
    "%s bez numeru pokazuje 01 i dziedziczy krój widgetu",
    (variant) => {
      renderLabel(variant, { numberFont: "inherit" });
      expect(screen.getByText("01").style.fontFamily).toBe("");
    },
  );
});

describe("etykieta sekcji - druga etykieta (kategoria, kicker, dek)", () => {
  const CATEGORY_VARIANTS = [
    "double-deck-masthead",
    "kicker-tag-rule",
    "stacked-serif-lede",
    "split-rule-duo",
  ] as const;

  it.each(CATEGORY_VARIANTS)("%s rysuje kategorię z krojem i rozmiarem z panelu", (variant) => {
    renderLabel(variant, { category: "Analiza", categoryFont: "serif", categorySize: "15px" });
    const category = screen.getByText("Analiza");
    expect(category.style.fontFamily).toBe(SERIF);
    expect(category.style.fontSize).toBe("15px");
  });

  it.each(CATEGORY_VARIANTS)(
    "%s w wąskiej kolumnie ignoruje rozmiar kategorii z panelu",
    (variant) => {
      renderLabel(variant, {
        size: "sm",
        category: "Analiza",
        categoryFont: "serif",
        categorySize: "15px",
      });
      const category = screen.getByText("Analiza");
      expect(category.style.fontSize).toBe("");
      expect(category.style.fontFamily).toBe(SERIF);
    },
  );

  it.each(CATEGORY_VARIANTS)("%s bez kategorii nie rysuje pustego znacznika", (variant) => {
    const { container } = renderLabel(variant, { categorySize: "15px" });
    expect(container.textContent).toBe("Tytuł sekcji");
  });
});

describe("etykieta sekcji - rozmiar i kolor akcji", () => {
  it.each(["left-bar", "kinetic-signal-notch"] as const)(
    "%s nadaje akcji rozmiar i kolor z panelu",
    (variant) => {
      renderLabel(variant, {
        action: "więcej",
        href: "/raporty",
        actionSize: "14px",
        actionColor: "#123456",
      });
      const action = screen.getByRole("link", { name: /więcej/ });
      expect(action.getAttribute("href")).toBe("/raporty");
      expect(action.style.fontSize).toBe("14px");
      expect(action.style.color).toBe("#123456");
    },
  );

  it.each(["left-bar", "kinetic-signal-notch"] as const)(
    "%s w wąskiej kolumnie: akcja bez odnośnika i bez rozmiaru z panelu, kolor zostaje",
    (variant) => {
      const { container } = renderLabel(variant, {
        size: "sm",
        action: "więcej",
        href: "/raporty",
        actionSize: "14px",
        actionColor: "#123456",
      });
      expect(screen.queryByRole("link")).toBeNull();
      const action = container.querySelector<HTMLElement>("[data-description-root]")!;
      expect(action.textContent).toBe("więcej");
      expect(action.style.fontSize).toBe("");
      expect(action.style.color).toBe("#123456");
    },
  );
});

describe("etykieta sekcji - czytelny tekst na wypełnionym akcencie", () => {
  /** Kolor tekstu odznaki: rodzic `data-title-root` niesie tło akcentu. */
  const badgeInk = (accent: string, labelColor?: string) => {
    renderLabel("badge-filled", { accent, labelColor });
    return screen.getByText("Tytuł sekcji").parentElement!.style.color;
  };

  it.each([
    ["jasnym akcencie #FECA62", "#FECA62", "#0a0a0a"],
    ["trzyznakowym jasnym akcencie #fc6", "#fc6", "#0a0a0a"],
    ["ciemnym akcencie #01112F", "#01112F", "#ffffff"],
    ["akcencie oklch, którego nie liczymy lokalnie", "oklch(0.7 0.1 50)", "#ffffff"],
    ["akcencie ze zmiennej CSS", "var(--accent)", "#ffffff"],
  ])("na %s tekst ma kolor %s", (_, accent, ink) => {
    expect(badgeInk(accent)).toBe(ink);
  });

  it("jawny kolor etykiety z panelu wygrywa z wyliczonym kontrastem", () => {
    expect(badgeInk("#FECA62", "#ff0000")).toBe("#ff0000");
  });

  it("tag kicker-tag-rule liczy kontrast z tego samego akcentu", () => {
    renderLabel("kicker-tag-rule", { accent: "#FECA62", category: "Pilne" });
    expect(screen.getByText("Pilne").style.color).toBe("#0a0a0a");
  });
});

describe("readSectionLabelProps - odczyt treści CMS", () => {
  it.each([
    ["żądanego języka", { label_en: "Latest", label_pl: "Najnowsze" }, {}, "Latest"],
    ["polskiej wersji, gdy brak angielskiej", { label_pl: "Najnowsze" }, {}, "Najnowsze"],
    ["wartości zastępczej podglądu", {}, { labelFallback: "Podgląd" }, "Podgląd"],
    ["słowa „Sekcja”, gdy nie ma nic", {}, {}, "Sekcja"],
    ["słowa „Sekcja” zamiast obiektu zapisanego w polu", { label_en: { x: 1 } }, {}, "Sekcja"],
  ])("bierze etykietę z %s", (_, content, opts, expected) => {
    expect(readSectionLabelProps(content, "en", opts).label).toBe(expected);
  });

  it("akcja: język -> PL -> zastępcza, a wyłączona przełącznikiem znika mimo tekstu", () => {
    expect(readSectionLabelProps({ action_pl: "więcej" }, "en").action).toBe("więcej");
    expect(readSectionLabelProps({}, "pl", { actionFallback: "więcej" }).action).toBe("więcej");
    expect(readSectionLabelProps({}, "pl").action).toBeUndefined();
    expect(
      readSectionLabelProps({ action_pl: "więcej", showAction: false }, "pl").action,
    ).toBeUndefined();
  });

  it("puste pola tekstowe nie przechodzą jako puste ciągi do renderera", () => {
    const props = readSectionLabelProps(
      { href: "", labelColor: "", category_pl: "", arrow: "", gapX: 12 },
      "pl",
    );
    expect(props.href).toBeUndefined();
    expect(props.labelColor).toBeUndefined();
    expect(props.category).toBeUndefined();
    expect(props.arrow).toBeUndefined();
    expect(props.gapX).toBeUndefined();
  });

  it("bez zapisanego wariantu daje domyślny kinetic-signal-notch", () => {
    expect(readSectionLabelProps({}, "pl").variant).toBe("kinetic-signal-notch");
  });

  it("własny akcent wygrywa z historycznym presetem `color`, preset wygrywa z marką", () => {
    expect(readSectionLabelProps({ accentColor: "#123456", color: "sky" }, "pl").accent).toBe(
      "#123456",
    );
    expect(readSectionLabelProps({ color: "sky" }, "pl").accent).toBe("#63B2F2");
    expect(readSectionLabelProps({}, "pl").accent).toBe("#FA9346");
  });

  it("w ciemnym motywie akcent per widget z `accentColorDark` wygrywa, w jasnym jest pomijany", () => {
    const content = { color: "sky", accentColorDark: "#ABCDEF" };
    expect(readSectionLabelProps(content, "pl", { theme: "dark" }).accent).toBe("#ABCDEF");
    expect(readSectionLabelProps(content, "pl", { theme: "light" }).accent).toBe("#63B2F2");
  });

  it("sygnał kinetic (`var(--nes-kinetic-signal)`) obowiązuje w obu motywach z akcentem jako zapasem", () => {
    const content = { color: "sky", accentColorDark: "var(--nes-kinetic-signal)" };
    for (const theme of ["light", "dark"] as const) {
      expect(readSectionLabelProps(content, "pl", { theme }).accent).toBe(
        "var(--nes-kinetic-signal, #63B2F2)",
      );
    }
  });

  it("bez `accentColorDark` ciemny akcent hex przechodzi przez wspólną inwersję akcentu", () => {
    const dark = readSectionLabelProps({ accentColor: "#01112F" }, "pl", { theme: "dark" });
    expect(dark.accent).toBe(autoInvertColor("#01112F", "dark"));
    expect(dark.accent).not.toBe("#01112F");
    // Akcent średniej jasności (marka) czyta się na obu tłach - zostaje.
    expect(readSectionLabelProps({}, "pl", { theme: "dark" }).accent).toBe("#FA9346");
  });

  // DEFEKT: CIEMNE PRESETY KOLORU NIE ODWRACAJĄ SIĘ W CIEMNYM MOTYWIE.
  //
  // WEJŚCIE: widget etykiety z presetem `color: "navy"` (albo "ink", oraz
  //   aliasy "diplomacy"/"neutral"), bez `accentColorDark`, renderowany
  //   z `theme: "dark"` (SectionLabelWidgetView na ciemnej stronie).
  // CO PSUJE: `readSectionLabelProps` (sectionLabelVariants.tsx:274-276) woła
  //   `resolveAccentColor(autoInvertColor(colorBase, "dark"))` - inwersja
  //   biegnie PRZED zamianą nazwy presetu na kolor, a `autoInvertColor`
  //   rozumie tylko zapisy liczbowe (oraz white/black), więc "navy" wraca bez
  //   zmian i dopiero potem staje się #01112F.
  // KONSEKWENCJA: granatowy akcent (pasek, kreska, numer) na granatowym tle
  //   ciemnego motywu - znika. Ten sam kolor zapisany jako hex "#01112F" jest
  //   odwracany poprawnie, więc wynik zależy od tego, którą kontrolką redaktor
  //   go wybrał.
  // DLACZEGO NIE NAPRAWIONE TUTAJ: odwrócona kolejność (najpierw preset, potem
  //   inwersja) zmienia też preset "crimson"/"military" (#CD393B, luminancja
  //   ~0,40 < progu 0,45) w ciemnym motywie z czerwieni na morski turkus -
  //   akcent kategorii „wojsko" zmieniłby znaczenie na wszystkich ciemnych
  //   stronach. Wybór (próg per preset albo jawne ciemne odpowiedniki presetów)
  //   to decyzja produktowa/projektowa.
  // WYMAGANA POPRAWKA: preset nazwany ma w ciemnym motywie dawać ten sam
  //   akcent co jego zapis hex (albo jawny ciemny odpowiednik z palety).
  it.fails("DEFEKT: preset navy w ciemnym motywie odwraca się jak jego zapis hex", () => {
    const preset = readSectionLabelProps({ color: "navy" }, "pl", { theme: "dark" }).accent;
    const hex = readSectionLabelProps({ color: "#01112F" }, "pl", { theme: "dark" }).accent;
    expect(preset).toBe(hex);
  });
});

describe("SectionLabelWidgetView - treść CMS na ekranie", () => {
  it("rysuje etykietę i akcję w języku strony z akcentem ciemnego motywu", () => {
    render(
      <SectionLabelWidgetView
        content={{
          label_pl: "Najnowsze",
          label_en: "Latest",
          action_en: "more",
          href: "/en/reports",
          color: "navy",
          accentColorDark: "#00FF00",
        }}
        lang="en"
        theme="dark"
      />,
    );
    expect(screen.getByText("Latest")).toBeTruthy();
    const action = screen.getByRole("link", { name: /more/ });
    expect(action.getAttribute("href")).toBe("/en/reports");
    expect(action.style.getPropertyValue("--nes-accent")).toBe("#00FF00");
  });
});

describe("katalogi panelu etykiety", () => {
  it("każdy krój z listy poza „Domyślna” daje stos fontów, „Domyślna” dziedziczy", () => {
    for (const { value } of SECTION_LABEL_FONTS) {
      const family = resolveFontFamily(value);
      if (value === "inherit") expect(family).toBeUndefined();
      // Stos kończy się rodziną generyczną - także wewnątrz zapasu `var(...)`.
      else expect(family, value).toMatch(/,\s*(serif|sans-serif|monospace)\)?$/);
    }
    expect(resolveFontFamily("display")).toContain("Red Hat Display");
    expect(resolveFontFamily("komiks")).toBeUndefined();
  });

  it.each([
    ["amber", "#F8B632"],
    ["gold", "#FECA62"],
    ["sky", "#63B2F2"],
    ["green", "#81D365"],
    ["red", "#F24343"],
    ["ivory", "#F8F6F4"],
    ["crimson", "#CD393B"],
    ["navy", "#01112F"],
    ["ink", "#141313"],
    ["brand", "#FA9346"],
  ])("preset %s daje kolor %s", (name, hex) => {
    expect(resolveAccentColor(name)).toBe(hex);
  });

  it.each([
    ["military", "crimson"],
    ["finance", "green"],
    ["diplomacy", "navy"],
    ["transport", "amber"],
    ["cyber", "sky"],
    ["neutral", "ink"],
  ])("alias historyczny %s daje ten sam kolor co %s", (legacy, modern) => {
    expect(resolveAccentColor(legacy)).toBe(resolveAccentColor(modern));
  });

  it.each(["#abc", "oklch(0.7 0.1 50)", "hsl(20 80% 50%)", "rgb(1 2 3)", "var(--accent)"])(
    "zapis koloru CSS %s przechodzi dosłownie",
    (css) => {
      expect(resolveAccentColor(css)).toBe(css);
    },
  );

  it.each([undefined, "", "fioletowy"])("brak albo nieznany preset (%s) daje kolor marki", (v) => {
    expect(resolveAccentColor(v)).toBe("#FA9346");
  });
});
