// TypographyControl: starsze zapisy odstępów i długości CSS.
//
// Renderer typografii (`typographyCss.ts` / `liveTypography.ts`) rozumie więcej
// zapisów, niż panel umiał pokazać:
//  * odstęp tytuł-opis zapisany NAPISEM z jednostką („12px" - import, ręczny
//    JSON) renderer czyta przez `normalizeTypographyGapPx` i rysuje 12 px,
//    a panel pokazywał puste pole (czytał wyłącznie liczbę);
//  * światło i interlinia idą do CSS dosłownie, a panel odsiewał z nich same
//    cyfry: „0.5px" pokazywał jako „05", interlinię bez jednostki „1.5" jako
//    „15 px", a „0.02em" jako „002 px". Edycja takiej wartości zapisywała
//    sklejone cyfry z jednostką px.
//
// Zasada: panel pokazuje to, co narysuje strona, a edycja zapisuje format,
// który renderer rozumie (odstęp - liczbę, długości - napis z TĄ SAMĄ
// jednostką). Sam render niczego nie zapisuje.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WidgetTypography } from "@/lib/builder/types";
import { TypographyControl } from "../TypographyControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/admin/settings/FontPicker", () => ({
  FontPicker: () => <input aria-label="stos czcionek" readOnly />,
}));

const ARIA = {
  gap: "builder.typographyControl.gapAria",
  lineHeight: "builder.typographyControl.lineHeightAria",
  letterSpacing: "builder.typographyControl.letterSpacingAria",
} as const;

function renderTypography(initial: Record<string, unknown>) {
  const applied: WidgetTypography[] = [];
  function Host() {
    const [value, setValue] = useState<WidgetTypography>(initial as WidgetTypography);
    return (
      <TypographyControl
        value={value}
        device="desktop"
        onChange={(next) => {
          applied.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Host />);
  return { applied, last: () => applied.at(-1) };
}

const field = (aria: string) => screen.getByLabelText(aria) as HTMLInputElement;
/** Jednostka podpisana przy polu (tekst widoczny obok wartości). */
const unitOf = (aria: string) => field(aria).parentElement?.querySelector("span")?.textContent;

describe("TypographyControl - odstęp tytuł-opis zapisany napisem", () => {
  it("„12px” jest widoczne w polu jako 12 - tyle rysuje strona", () => {
    const { applied } = renderTypography({ titleDescriptionGapPx: "12px" });
    expect(field(ARIA.gap).value).toBe("12");
    expect(applied).toEqual([]);
  });

  it("napis poza zakresem renderera pokazuje wartość domkniętą (200)", () => {
    renderTypography({ titleDescriptionGapPx: "500px" });
    expect(field(ARIA.gap).value).toBe("200");
  });

  it("krok ze starszego napisu liczy od 12 i zapisuje LICZBĘ", () => {
    const { last } = renderTypography({ titleDescriptionGapPx: "12px" });
    fireEvent.keyDown(field(ARIA.gap), { key: "ArrowUp" });
    expect(last()?.titleDescriptionGapPx).toBe(16);
  });

  it("dopisanie cyfry do ułamkowego odstępu nie skleja cyfr", () => {
    const { last } = renderTypography({ titleDescriptionGapPx: "12.5px" });
    expect(field(ARIA.gap).value).toBe("12.5");
    fireEvent.change(field(ARIA.gap), { target: { value: "12.55" } });
    expect(last()?.titleDescriptionGapPx).toBe(12.55);
  });
});

describe("TypographyControl - światło i interlinia zapisane napisem CSS", () => {
  it.each([
    ["0.5px", "0.5"],
    ["-0.5px", "-0.5"],
    ["12px", "12"],
  ])("światło „%s” pokazuje %s px", (stored, shown) => {
    const { applied } = renderTypography({ letterSpacing: stored });
    expect(field(ARIA.letterSpacing).value).toBe(shown);
    expect(unitOf(ARIA.letterSpacing)).toBe("px");
    expect(applied).toEqual([]);
  });

  it("edycja ułamkowego światła zapisuje ułamek z jednostką px", () => {
    const { last } = renderTypography({ letterSpacing: "0.5px" });
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "0.75" } });
    expect(last()?.letterSpacing).toBe("0.75px");
  });

  it("światło w em pokazuje em i zachowuje tę jednostkę przy edycji", () => {
    const { last } = renderTypography({ letterSpacing: "0.02em" });
    expect(field(ARIA.letterSpacing).value).toBe("0.02");
    expect(unitOf(ARIA.letterSpacing)).toBe("em");
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "0.05" } });
    expect(last()?.letterSpacing).toBe("0.05em");
  });

  it("interlinia bez jednostki to mnożnik: pole pokazuje 1.5 bez „px” i tak zapisuje", () => {
    const { last, applied } = renderTypography({ lineHeight: "1.5" });
    expect(field(ARIA.lineHeight).value).toBe("1.5");
    expect(unitOf(ARIA.lineHeight)).toBe("");
    expect(applied).toEqual([]);
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "1.6" } });
    expect(last()?.lineHeight).toBe("1.6");
  });

  it("interlinia w pikselach z ułamkiem jest czytana w całości", () => {
    renderTypography({ lineHeight: "22.5px" });
    expect(field(ARIA.lineHeight).value).toBe("22.5");
    expect(unitOf(ARIA.lineHeight)).toBe("px");
  });

  it("krok strzałki z ułamka nie obcina części dziesiętnej", () => {
    const { last } = renderTypography({ letterSpacing: "0.5px" });
    fireEvent.keyDown(field(ARIA.letterSpacing), { key: "ArrowUp" });
    expect(last()?.letterSpacing).toBe("1.5px");
  });
});

// Stany pośrednie wpisu ułamkowego („-", „.", „1.") są potrzebne, żeby dało się
// dopisać kolejne znaki, ale NIE są wartością CSS: „-px", „.px", „1.px" czy
// interlinię „2." przeglądarka odrzuca i strona rysuje wtedy wartość domyślną,
// choć panel pokazuje wpis. Pole trzyma je więc tylko w szkicu, a dokument
// dostaje wyłącznie liczbę kompletną; opuszczenie pola pokazuje znowu zapis.
describe("TypographyControl - stany pośrednie wpisu nie trafiają do dokumentu", () => {
  /** Zapisy, które CSS odrzuca: bez cyfry albo z separatorem bez cyfr po nim. */
  const invalidCss = (applied: WidgetTypography[], key: "letterSpacing" | "lineHeight") =>
    applied
      .map((next) => next[key])
      .filter((v) => v !== undefined && !/^-?\d*\.?\d+[a-z%]*$/i.test(String(v)));

  it("sam minus w pustym świetle zostaje w polu i daje się skasować do zera zapisu", () => {
    const { applied, last } = renderTypography({});
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "-" } });
    expect(field(ARIA.letterSpacing).value).toBe("-");
    expect(invalidCss(applied, "letterSpacing")).toEqual([]);
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "" } });
    expect(field(ARIA.letterSpacing).value).toBe("");
    expect(last()?.letterSpacing).toBeUndefined();
  });

  it("sama kropka w pustej interlinii zostaje w polu i daje się skasować", () => {
    const { applied, last } = renderTypography({});
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "." } });
    expect(field(ARIA.lineHeight).value).toBe(".");
    expect(invalidCss(applied, "lineHeight")).toEqual([]);
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "" } });
    expect(field(ARIA.lineHeight).value).toBe("");
    expect(last()?.lineHeight).toBeUndefined();
  });

  it("minus wpisany w miejsce światła nie zmienia zapisu, a po wyjściu wraca wartość strony", () => {
    const { applied } = renderTypography({ letterSpacing: "2px" });
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "-" } });
    expect(field(ARIA.letterSpacing).value).toBe("-");
    // Sam minus nie jest liczbą - dokument zostaje przy 2px.
    expect(applied).toEqual([]);
    fireEvent.blur(field(ARIA.letterSpacing));
    expect(field(ARIA.letterSpacing).value).toBe("2");
    expect(applied).toEqual([]);
  });

  it("„1.” w świetle: pole trzyma kropkę do dopisania, zapis to 1px, nigdy „1.px”", () => {
    const { applied, last } = renderTypography({ letterSpacing: "1px" });
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "1." } });
    expect(field(ARIA.letterSpacing).value).toBe("1.");
    fireEvent.blur(field(ARIA.letterSpacing));
    expect(field(ARIA.letterSpacing).value).toBe("1");
    expect(last()?.letterSpacing).toBe("1px");
    expect(invalidCss(applied, "letterSpacing")).toEqual([]);
  });

  it("ułamek wpisywany znak po znaku dochodzi do zapisu w całości", () => {
    const { applied, last } = renderTypography({});
    for (const typed of ["-", "-0", "-0.", "-0.5"]) {
      fireEvent.change(field(ARIA.letterSpacing), { target: { value: typed } });
      expect(field(ARIA.letterSpacing).value).toBe(typed);
    }
    expect(last()?.letterSpacing).toBe("-0.5px");
    expect(invalidCss(applied, "letterSpacing")).toEqual([]);
  });

  it("interlinia bez jednostki „2.” po wyjściu z pola zapisuje mnożnik 2", () => {
    const { applied, last } = renderTypography({ lineHeight: "1.5" });
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "2." } });
    fireEvent.blur(field(ARIA.lineHeight));
    expect(last()?.lineHeight).toBe("2");
    expect(field(ARIA.lineHeight).value).toBe("2");
    expect(unitOf(ARIA.lineHeight)).toBe("");
    expect(invalidCss(applied, "lineHeight")).toEqual([]);
  });

  it("wyczyszczenie i ponowny wpis interlinii w tej samej edycji zostawia mnożnik", () => {
    // Bez tego „1.5" (mnożnik) po Backspace i wpisaniu „1.6" stawało się
    // interlinią 1.6 px - tekst nachodzi wtedy na siebie.
    const { last } = renderTypography({ lineHeight: "1.5" });
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "" } });
    expect(last()?.lineHeight).toBeUndefined();
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "1.6" } });
    expect(last()?.lineHeight).toBe("1.6");
    expect(unitOf(ARIA.lineHeight)).toBe("");
  });

  it("odstęp tytuł-opis przyjmuje kropkę w trakcie wpisu i zapisuje ułamek", () => {
    const { applied, last } = renderTypography({ titleDescriptionGapPx: 12 });
    fireEvent.change(field(ARIA.gap), { target: { value: "12." } });
    // Pole sterowane samym zapisem gubiło kropkę: „12." -> „12", a dopisana
    // piątka dawała 125 zamiast 12.5.
    expect(field(ARIA.gap).value).toBe("12.");
    fireEvent.change(field(ARIA.gap), { target: { value: "12.5" } });
    expect(last()?.titleDescriptionGapPx).toBe(12.5);
    expect(applied.map((next) => next.titleDescriptionGapPx)).not.toContain(125);
  });

  it("odstęp spoza zakresu pokazuje po wyjściu z pola wartość domkniętą", () => {
    const { last } = renderTypography({ titleDescriptionGapPx: 16 });
    fireEvent.change(field(ARIA.gap), { target: { value: "999" } });
    expect(last()?.titleDescriptionGapPx).toBe(200);
    fireEvent.blur(field(ARIA.gap));
    expect(field(ARIA.gap).value).toBe("200");
  });

  it("krok strzałki ze szkicu zapisuje liczbę i pokazuje ją w polu", () => {
    const { last } = renderTypography({});
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "1." } });
    fireEvent.keyDown(field(ARIA.letterSpacing), { key: "ArrowUp" });
    expect(last()?.letterSpacing).toBe("2px");
    expect(field(ARIA.letterSpacing).value).toBe("2");
  });

  it("pola ułamkowe proszą klawiaturę dotykową o separator dziesiętny", () => {
    renderTypography({});
    // Rozmiary czcionek też: zapis „16.5px” albo „1.5rem” jest poprawnym CSS-em.
    for (const aria of [
      ARIA.lineHeight,
      ARIA.letterSpacing,
      ARIA.gap,
      "builder.typographyControl.titleSizeAria",
      "builder.typographyControl.descSizeMobileAria",
    ]) {
      expect(field(aria)).toHaveAttribute("inputmode", "decimal");
    }
  });
});

describe("TypographyControl - rozmiar czcionki zapisany ułamkiem albo w innej jednostce", () => {
  const TITLE = "builder.typographyControl.titleSizeAria";
  const TITLE_MOBILE = "builder.typographyControl.titleSizeMobileAria";

  it("„16.5px” jest polem 16.5 px, a nie 165; render niczego nie zapisuje", () => {
    // NAPRAWIONE 2026-10-19: pole brało same cyfry z zapisu, więc „16.5px”
    // pokazywało 165, a „1.5rem” - 15 z podpisem px.
    const { applied } = renderTypography({
      fontSize: { desktop: "16.5px", tablet: "16.5px", mobile: "1.5rem" },
    });
    expect(field(TITLE).value).toBe("16.5");
    expect(unitOf(TITLE)).toBe("px");
    expect(field(TITLE_MOBILE).value).toBe("1.5");
    expect(unitOf(TITLE_MOBILE)).toBe("rem");
    expect(applied).toEqual([]);
  });

  it("strzałka liczy od liczby z zapisu i zachowuje jednostkę", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "16.5px", tablet: "16.5px", mobile: "1.5rem" },
    });
    fireEvent.keyDown(field(TITLE), { key: "ArrowUp" });
    expect(last()?.fontSize).toEqual({ desktop: "17.5px", tablet: "17.5px", mobile: "1.5rem" });
    fireEvent.keyDown(field(TITLE_MOBILE), { key: "ArrowUp" });
    expect(last()?.fontSize).toEqual({ desktop: "17.5px", tablet: "17.5px", mobile: "2.5rem" });
  });

  it("pisanie rozmiaru desktopu znak po znaku nie przypina telefonowi pierwszej cyfry", () => {
    // NAPRAWIONE 2026-10-19: „1” zapisywało telefonowi 1px, a kolejne znaki
    // zmieniały już tylko desktop - po wpisaniu „24” telefon zostawał na 1px.
    const { last } = renderTypography({});
    fireEvent.change(field(TITLE), { target: { value: "2" } });
    fireEvent.change(field(TITLE), { target: { value: "24" } });
    expect(last()?.fontSize).toEqual({ desktop: "24px", tablet: "24px", mobile: "24px" });
  });

  it("własny rozmiar telefonu zostaje przy zmianie desktopu", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "34px", tablet: "34px", mobile: "26px" },
    });
    fireEvent.change(field(TITLE), { target: { value: "40" } });
    expect(last()?.fontSize).toEqual({ desktop: "40px", tablet: "40px", mobile: "26px" });
  });

  it("wpis ułamka nie zapisuje stanu pośredniego „16.”", () => {
    const { last } = renderTypography({});
    fireEvent.change(field(TITLE), { target: { value: "16." } });
    expect(last()?.fontSize).toEqual({ desktop: "16px", tablet: "16px", mobile: "16px" });
    fireEvent.change(field(TITLE), { target: { value: "16.5" } });
    expect(last()?.fontSize).toEqual({ desktop: "16.5px", tablet: "16.5px", mobile: "16.5px" });
  });
});

describe("TypographyControl - telefon idzie za desktopem przez całą edycję", () => {
  // Decyzja „telefon idzie za desktopem” zapada RAZ, na początku edycji pola
  // desktopowego. Liczona przy każdym zapisie od nowa myliła stan pośredni ze
  // świadomym wyborem: Backspace do pustego pola przypinał telefonowi pierwszą
  // cyfrę starej wartości, a krok strzałki przez rozmiar telefonu „przyklejał”
  // telefon do desktopu.
  const TITLE = "builder.typographyControl.titleSizeAria";
  const TITLE_MOBILE = "builder.typographyControl.titleSizeMobileAria";
  const DESC = "builder.typographyControl.descSizeAria";
  const typeAll = (aria: string, steps: string[]) => {
    for (const typed of steps) fireEvent.change(field(aria), { target: { value: typed } });
  };

  it.each([
    ["telefon równy desktopowi", { desktop: "24px", tablet: "24px", mobile: "24px" }],
    ["sam desktop", { desktop: "24px", tablet: "24px" }],
  ])("Backspace do pustego i nowa wartość (%s): telefon dostaje nową wartość", (_l, fontSize) => {
    const { applied, last } = renderTypography({ fontSize });
    typeAll(TITLE, ["2", "", "3", "32"]);
    expect(last()?.fontSize).toEqual({ desktop: "32px", tablet: "32px", mobile: "32px" });
    // Żaden zapis po drodze nie zostawił telefonu z samym stanem pośrednim.
    expect(applied.map((next) => next.fontSize)).not.toContainEqual({ mobile: "2px" });
  });

  it("Backspace do pustego i nowa wartość zostawia własny rozmiar telefonu", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "34px", tablet: "34px", mobile: "26px" },
    });
    typeAll(TITLE, ["2", "", "3", "32"]);
    expect(last()?.fontSize).toEqual({ desktop: "32px", tablet: "32px", mobile: "26px" });
  });

  it("chwilowa równość z rozmiarem telefonu przy pisaniu nie przejmuje telefonu", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "34px", tablet: "34px", mobile: "26px" },
    });
    typeAll(TITLE, ["2", "26", "2", "28"]);
    expect(last()?.fontSize).toEqual({ desktop: "28px", tablet: "28px", mobile: "26px" });
  });

  it("krok strzałki przez rozmiar telefonu nie przykleja telefonu do desktopu", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "14px", tablet: "14px", mobile: "16px" },
    });
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(field(TITLE), { key: "ArrowUp" });
    expect(last()?.fontSize).toEqual({ desktop: "17px", tablet: "17px", mobile: "16px" });
  });

  it("wyczyszczenie desktopu, za którym szedł telefon, czyści też telefon", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "24px", tablet: "24px", mobile: "24px" },
    });
    fireEvent.change(field(TITLE), { target: { value: "" } });
    expect(last()?.fontSize).toBeUndefined();
  });

  it("rozmiar opisu: „6”, Backspace i „48” daje telefonowi 48 px, a nie 6 px", () => {
    const { last } = renderTypography({
      descriptionFontSize: { desktop: "64px", tablet: "64px", mobile: "64px" },
    });
    typeAll(DESC, ["6", "", "4", "48"]);
    expect(last()?.descriptionFontSize).toEqual({
      desktop: "48px",
      tablet: "48px",
      mobile: "48px",
    });
  });

  it("zmiana telefonu w trakcie edycji desktopu unieważnia decyzję", () => {
    const { last } = renderTypography({ fontSize: { desktop: "30px", tablet: "30px" } });
    fireEvent.change(field(TITLE), { target: { value: "3" } });
    fireEvent.change(field(TITLE_MOBILE), { target: { value: "20" } });
    fireEvent.change(field(TITLE), { target: { value: "36" } });
    expect(last()?.fontSize).toEqual({ desktop: "36px", tablet: "36px", mobile: "20px" });
  });

  it("nowa edycja (po wyjściu z pola) decyduje od nowa", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "34px", tablet: "34px", mobile: "26px" },
    });
    typeAll(TITLE, ["2", "26"]);
    fireEvent.blur(field(TITLE));
    // Dokument nie odróżnia „równe z wyboru” od „idzie za desktopem” - nowa
    // edycja widzi dwa równe rozmiary i prowadzi je razem.
    typeAll(TITLE, ["3", "30"]);
    expect(last()?.fontSize).toEqual({ desktop: "30px", tablet: "30px", mobile: "30px" });
  });
});
