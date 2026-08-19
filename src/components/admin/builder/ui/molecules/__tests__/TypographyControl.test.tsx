// Pełny edytor typografii widgetu. Cała trudność siedzi w JEDNYM miejscu:
// rozmiar tytułu i opisu jest zapisem RESPONSYWNYM (desktop + tablet +
// mobile), ale panel pokazuje go jako dwa pola - „desktop” i „telefon”.
// Reguły przepisania między tymi reprezentacjami to najczęstsze źródło
// realnych regresji w tym pliku:
//   * ustawienie rozmiaru desktopowego NIE MOŻE zdeptać rozmiaru mobilnego,
//   * wyczyszczenie jednego pola musi zostawić drugie,
//   * wyczyszczenie obu musi USUNĄĆ klucz z dokumentu, a nie zapisać `{}`.
// Do tego `set()` czyści puste stringi, żeby dokument nie rósł o klucze
// bez wartości - to też jest tu sprawdzone.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WidgetTypography } from "@/lib/builder/types";
import { selectWithOption, optionValues } from "@/test/builder/panels";
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
// FontPicker to osobna powierzchnia (ustawienia serwisu, własne zapytania
// o listę fontów). Tutaj interesuje nas WYŁĄCZNIE to, że wybór stosu
// czcionek trafia do zapisu typografii.
vi.mock("@/components/admin/settings/FontPicker", () => ({
  FontPicker: ({ value, onChange }: { value?: string; onChange: (next: string) => void }) => (
    <input
      aria-label="stos czcionek"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const ARIA = {
  title: "builder.typographyControl.titleSizeAria",
  desc: "builder.typographyControl.descSizeAria",
  titleMobile: "builder.typographyControl.titleSizeMobileAria",
  descMobile: "builder.typographyControl.descSizeMobileAria",
  gap: "builder.typographyControl.gapAria",
  lineHeight: "builder.typographyControl.lineHeightAria",
  letterSpacing: "builder.typographyControl.letterSpacingAria",
} as const;

function renderTypography(initial: WidgetTypography = {}) {
  const applied: WidgetTypography[] = [];
  function Host() {
    const [value, setValue] = useState<WidgetTypography>(initial);
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
  return { last: () => applied.at(-1), applied };
}

const field = (aria: string): HTMLInputElement => screen.getByLabelText(aria) as HTMLInputElement;

describe("TypographyControl - rozmiar tytułu", () => {
  it("zapisuje rozmiar desktopowy na desktop, tablet i telefon", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.title), { target: { value: "34" } });
    // Brak rozmiaru mobilnego = telefon dziedziczy desktop. Bez tego widget
    // na telefonie zostaje na wartości domyślnej motywu.
    expect(last()?.fontSize).toEqual({ desktop: "34px", tablet: "34px", mobile: "34px" });
  });

  it("zapis desktopowy zachowuje istniejący rozmiar mobilny", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "30px", tablet: "30px", mobile: "20px" },
    });
    fireEvent.change(field(ARIA.title), { target: { value: "40" } });
    expect(last()?.fontSize).toEqual({ desktop: "40px", tablet: "40px", mobile: "20px" });
  });

  it("odsiewa znaki inne niż cyfry", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.title), { target: { value: "3a4px" } });
    expect(last()?.fontSize?.desktop).toBe("34px");
  });

  it("czyta rozmiar z tabletu, gdy desktop go nie ma", () => {
    renderTypography({ fontSize: { tablet: "28px" } });
    expect(field(ARIA.title).value).toBe("28");
  });

  it("wyczyszczenie pola desktopowego zostawia rozmiar mobilny", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "30px", tablet: "30px", mobile: "18px" },
    });
    fireEvent.change(field(ARIA.title), { target: { value: "" } });
    expect(last()?.fontSize).toEqual({ mobile: "18px" });
  });

  it("wyczyszczenie pola desktopowego bez rozmiaru mobilnego usuwa klucz", () => {
    const { last } = renderTypography({ fontSize: { desktop: "30px", tablet: "30px" } });
    fireEvent.change(field(ARIA.title), { target: { value: "" } });
    // `undefined`, a nie `{}` - puste obiekty zostają w dokumencie na zawsze
    // i mylą kolejne odczyty („jest zapis, ale bez wartości”).
    expect(last()?.fontSize).toBeUndefined();
    expect("fontSize" in (last() ?? {})).toBe(false);
  });
});

describe("TypographyControl - rozmiar mobilny", () => {
  it("zapisuje rozmiar mobilny osobno", () => {
    const { last } = renderTypography({ fontSize: { desktop: "34px", tablet: "34px" } });
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "22" } });
    expect(last()?.fontSize).toEqual({ desktop: "34px", tablet: "34px", mobile: "22px" });
  });

  it("rozmiar mobilny bez desktopowego zapisuje się sam", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "18" } });
    expect(last()?.fontSize).toEqual({ mobile: "18px" });
  });

  it("wyczyszczenie mobilnego zostawia desktop i tablet", () => {
    const { last } = renderTypography({
      fontSize: { desktop: "34px", tablet: "30px", mobile: "20px" },
    });
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "" } });
    expect(last()?.fontSize).toEqual({ desktop: "34px", tablet: "30px" });
  });

  it("wyczyszczenie mobilnego bez desktopu usuwa klucz", () => {
    const { last } = renderTypography({ fontSize: { mobile: "20px" } });
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "" } });
    expect(last()?.fontSize).toBeUndefined();
  });

  it("brak tabletu w zapisie uzupełnia się z desktopu", () => {
    const { last } = renderTypography({ fontSize: { desktop: "34px" } });
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "20" } });
    // Tablet bez wartości spadłby na domyślną - a redakcja ustawiała rozmiar
    // „na duże ekrany”, nie „na sam desktop”.
    expect(last()?.fontSize).toEqual({ desktop: "34px", tablet: "34px", mobile: "20px" });
  });
});

describe("TypographyControl - zapis niekompletny", () => {
  // Dokumenty zapisane starszymi wydaniami edytora mają NIEKOMPLETNE zapisy
  // responsywne (sam desktop, sam tablet, sam telefon). Panel musi je czytać
  // i uzupełniać, a nie gubić - to nie przypadek brzegowy, a większość
  // istniejących stron.
  it("czyszczenie mobilnego uzupełnia tablet z desktopu", () => {
    const { last } = renderTypography({ fontSize: { desktop: "34px", mobile: "20px" } });
    fireEvent.change(field(ARIA.titleMobile), { target: { value: "" } });
    expect(last()?.fontSize).toEqual({ desktop: "34px", tablet: "34px" });
  });

  it("czyszczenie opisu bez wartości mobilnej usuwa klucz", () => {
    const { last } = renderTypography({ descriptionFontSize: { desktop: "16px", tablet: "16px" } });
    fireEvent.change(field(ARIA.desc), { target: { value: "" } });
    expect(last()?.descriptionFontSize).toBeUndefined();
  });

  it("czyszczenie opisu mobilnego zostawia desktop i uzupełnia tablet", () => {
    const { last } = renderTypography({
      descriptionFontSize: { desktop: "16px", mobile: "12px" },
    });
    fireEvent.change(field(ARIA.descMobile), { target: { value: "" } });
    expect(last()?.descriptionFontSize).toEqual({ desktop: "16px", tablet: "16px" });
  });

  it("zapis opisu mobilnego uzupełnia tablet z desktopu", () => {
    const { last } = renderTypography({ descriptionFontSize: { desktop: "16px" } });
    fireEvent.change(field(ARIA.descMobile), { target: { value: "12" } });
    expect(last()?.descriptionFontSize).toEqual({
      desktop: "16px",
      tablet: "16px",
      mobile: "12px",
    });
  });

  it("brak jakiegokolwiek zapisu typografii renderuje puste pola", () => {
    render(<TypographyControl value={undefined} device="desktop" onChange={vi.fn()} />);
    expect(field(ARIA.title).value).toBe("");
    expect(field(ARIA.descMobile).value).toBe("");
  });
});

describe("TypographyControl - rozmiar opisu", () => {
  it("zapisuje rozmiar opisu na trzy urządzenia", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.desc), { target: { value: "15" } });
    expect(last()?.descriptionFontSize).toEqual({
      desktop: "15px",
      tablet: "15px",
      mobile: "15px",
    });
  });

  it("zapis opisu zachowuje wartość mobilną", () => {
    const { last } = renderTypography({
      descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "12px" },
    });
    fireEvent.change(field(ARIA.desc), { target: { value: "18" } });
    expect(last()?.descriptionFontSize).toEqual({
      desktop: "18px",
      tablet: "18px",
      mobile: "12px",
    });
  });

  it("czyszczenie opisu zostawia wartość mobilną, a bez niej usuwa klucz", () => {
    const { last } = renderTypography({
      descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "12px" },
    });
    fireEvent.change(field(ARIA.desc), { target: { value: "" } });
    expect(last()?.descriptionFontSize).toEqual({ mobile: "12px" });
    fireEvent.change(field(ARIA.descMobile), { target: { value: "" } });
    expect(last()?.descriptionFontSize).toBeUndefined();
  });

  it("opis mobilny zapisuje się i czyta osobno", () => {
    const { last } = renderTypography({ descriptionFontSize: { tablet: "16px" } });
    expect(field(ARIA.desc).value).toBe("16");
    fireEvent.change(field(ARIA.descMobile), { target: { value: "13" } });
    expect(last()?.descriptionFontSize).toEqual({
      desktop: "16px",
      tablet: "16px",
      mobile: "13px",
    });
  });

  it("opis mobilny bez desktopowego zapisuje się sam i daje się wyczyścić", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.descMobile), { target: { value: "13" } });
    expect(last()?.descriptionFontSize).toEqual({ mobile: "13px" });
    fireEvent.change(field(ARIA.descMobile), { target: { value: "" } });
    expect(last()?.descriptionFontSize).toBeUndefined();
  });
});

describe("TypographyControl - strzałki pól rozmiaru", () => {
  it.each([
    ["klawiatura w górę", "ArrowUp", "35"],
    ["klawiatura w dół", "ArrowDown", "33"],
  ])("%s", (_label, key, expected) => {
    const { last } = renderTypography({ fontSize: { desktop: "34px", tablet: "34px" } });
    fireEvent.keyDown(field(ARIA.title), { key });
    expect(last()?.fontSize?.desktop).toBe(`${expected}px`);
  });

  it("strzałki na klawiaturze pomijają pozostałe klawisze", () => {
    const { applied } = renderTypography({ fontSize: { desktop: "34px" } });
    fireEvent.keyDown(field(ARIA.title), { key: "Enter" });
    expect(applied).toHaveLength(0);
  });

  it("przyciski krokowe zmieniają wartość", () => {
    const { last } = renderTypography({ fontSize: { desktop: "20px", tablet: "20px" } });
    const box = field(ARIA.title).parentElement as HTMLElement;
    const up = box.querySelector<HTMLButtonElement>(
      'button[aria-label="builder.stepper.increase"]',
    );
    const down = box.querySelector<HTMLButtonElement>(
      'button[aria-label="builder.stepper.decrease"]',
    );
    if (!up || !down) throw new Error("test: brak przycisków krokowych");
    fireEvent.click(up);
    expect(last()?.fontSize?.desktop).toBe("21px");
    fireEvent.click(down);
    expect(last()?.fontSize?.desktop).toBe("20px");
  });

  it("krok z pustego pola startuje od zera", () => {
    const { last } = renderTypography();
    fireEvent.keyDown(field(ARIA.title), { key: "ArrowUp" });
    expect(last()?.fontSize?.desktop).toBe("1px");
  });

  it("krok w dół z pustego pola nie zapisuje wartości ujemnej", () => {
    const { last } = renderTypography();
    fireEvent.keyDown(field(ARIA.title), { key: "ArrowDown" });
    expect(last()?.fontSize).toBeUndefined();
  });

  it("przyciski krokowe z pustego pola: w górę daje 1, w dół czyści", () => {
    const { last } = renderTypography();
    const box = field(ARIA.title).parentElement as HTMLElement;
    const up = box.querySelector<HTMLButtonElement>(
      'button[aria-label="builder.stepper.increase"]',
    );
    const down = box.querySelector<HTMLButtonElement>(
      'button[aria-label="builder.stepper.decrease"]',
    );
    if (!up || !down) throw new Error("test: brak przycisków krokowych");
    fireEvent.click(down);
    expect(last()?.fontSize).toBeUndefined();
    fireEvent.click(up);
    expect(last()?.fontSize?.desktop).toBe("1px");
  });

  it("krok w dół poniżej zera czyści pole", () => {
    const { last } = renderTypography({ fontSize: { desktop: "0px", tablet: "0px" } });
    fireEvent.keyDown(field(ARIA.title), { key: "ArrowDown" });
    // Rozmiar ujemny nie istnieje - krok poniżej zera ZDEJMUJE nadpisanie,
    // zamiast zapisywać wartość, której renderer nie użyje.
    expect(last()?.fontSize).toBeUndefined();
  });

  it("odstęp tytuł-opis ma krok cztery i klamp do 200", () => {
    const { last } = renderTypography({ titleDescriptionGapPx: 16 });
    const box = field(ARIA.gap).parentElement as HTMLElement;
    const up = box.querySelector<HTMLButtonElement>(
      'button[aria-label="builder.stepper.increase"]',
    );
    if (!up) throw new Error("test: brak przycisku krokowego odstępu");
    fireEvent.click(up);
    expect(last()?.titleDescriptionGapPx).toBe(20);
    fireEvent.change(field(ARIA.gap), { target: { value: "999" } });
    expect(last()?.titleDescriptionGapPx).toBe(200);
  });

  it("odstęp tytuł-opis daje się wyczyścić i zerować", () => {
    const { last } = renderTypography({ titleDescriptionGapPx: 16 });
    fireEvent.change(field(ARIA.gap), { target: { value: "0" } });
    // Zero to PRAWIDŁOWY odstęp (opis przyklejony do tytułu), a `set()` czyści
    // tylko `undefined` i pusty napis - liczba zero musi przejść.
    expect(last()?.titleDescriptionGapPx).toBe(0);
    fireEvent.change(field(ARIA.gap), { target: { value: "" } });
    expect(last()?.titleDescriptionGapPx).toBeUndefined();
  });

  it("odstęp bez zapisu pokazuje puste pole", () => {
    renderTypography({});
    expect(field(ARIA.gap).value).toBe("");
  });
});

describe("TypographyControl - interlinia i światło", () => {
  it("zapisuje interlinię w pikselach", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "28" } });
    expect(last()?.lineHeight).toBe("28px");
    fireEvent.change(field(ARIA.lineHeight), { target: { value: "" } });
    expect(last()?.lineHeight).toBeUndefined();
  });

  it("czyta zapisaną interlinię bez jednostki", () => {
    renderTypography({ lineHeight: "28px" });
    expect(field(ARIA.lineHeight).value).toBe("28");
  });

  it("światło międzyliterowe dopuszcza wartość ujemną", () => {
    const { last } = renderTypography();
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "-1" } });
    // Zwężenie liter jest w typografii nagłówków normą - filtr znaków musi
    // przepuścić minus, inaczej redakcja może tylko rozstrzelić tekst.
    expect(last()?.letterSpacing).toBe("-1px");
    fireEvent.change(field(ARIA.letterSpacing), { target: { value: "" } });
    expect(last()?.letterSpacing).toBeUndefined();
  });
});

describe("TypographyControl - wyrównanie i listy", () => {
  it.each([
    ["builder.common.left", "left"],
    ["builder.common.center", "center"],
    ["builder.common.right", "right"],
    ["builder.typographyControl.justify", "justify"],
  ] as const)("ustawia wyrównanie %s", (title, value) => {
    const { last } = renderTypography();
    fireEvent.click(screen.getByTitle(title));
    expect(last()?.textAlign).toBe(value);
  });

  it("ponowny klik w aktywne wyrównanie je zdejmuje", () => {
    const { last } = renderTypography({ textAlign: "center" });
    expect(screen.getByTitle("builder.common.center").className).toContain("bg-background");
    fireEvent.click(screen.getByTitle("builder.common.center"));
    // Zdjęcie wyrównania oddaje decyzję motywowi - to nie to samo, co
    // wymuszenie „do lewej”.
    expect(last()?.textAlign).toBeUndefined();
  });

  it("grubość: wartość specjalna oznacza brak nadpisania", () => {
    const { last } = renderTypography({ fontWeight: "700" });
    const weight = selectWithOption("__unset");
    expect(weight.value).toBe("700");
    expect(optionValues(weight)).toEqual([
      "__unset",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
    ]);
    fireEvent.change(weight, { target: { value: "__unset" } });
    expect(last()?.fontWeight).toBeUndefined();
    expect("fontWeight" in (last() ?? {})).toBe(false);
  });

  it("grubość zapisuje wybraną wartość", () => {
    const { last } = renderTypography();
    fireEvent.change(selectWithOption("__unset"), { target: { value: "600" } });
    expect(last()?.fontWeight).toBe("600");
  });

  it.each([
    ["italic", "italic"],
    ["normal", "normal"],
  ] as const)("styl pisma: %s", (option, expected) => {
    const { last } = renderTypography({ fontStyle: option === "italic" ? "normal" : "italic" });
    fireEvent.change(selectWithOption("italic"), { target: { value: option } });
    expect(last()?.fontStyle).toBe(expected);
  });

  it.each([
    ["uppercase", "uppercase"],
    ["lowercase", "lowercase"],
    ["capitalize", "capitalize"],
  ] as const)("wielkość liter: %s", (option, expected) => {
    const { last } = renderTypography();
    fireEvent.change(selectWithOption("capitalize"), { target: { value: option } });
    expect(last()?.textTransform).toBe(expected);
  });

  it.each([
    ["underline", "underline"],
    ["line-through", "line-through"],
  ] as const)("dekoracja: %s", (option, expected) => {
    const { last } = renderTypography();
    fireEvent.change(selectWithOption("line-through"), { target: { value: option } });
    expect(last()?.textDecoration).toBe(expected);
  });

  it("domyślne wartości list to brak nadpisania", () => {
    renderTypography();
    expect(selectWithOption("__unset").value).toBe("__unset");
    expect(selectWithOption("italic").value).toBe("normal");
    expect(selectWithOption("capitalize").value).toBe("none");
    expect(selectWithOption("line-through").value).toBe("none");
  });
});

describe("TypographyControl - rodzina czcionek", () => {
  it("zapisuje wybrany stos czcionek", () => {
    const { last } = renderTypography();
    fireEvent.change(screen.getByLabelText("stos czcionek"), {
      target: { value: '"Red Hat Display", sans-serif' },
    });
    expect(last()?.fontFamily).toBe('"Red Hat Display", sans-serif');
  });

  it("pusty stos czcionek jest usuwany z zapisu", () => {
    const { last } = renderTypography({ fontFamily: "Georgia, serif" });
    fireEvent.change(screen.getByLabelText("stos czcionek"), { target: { value: "" } });
    // `set()` usuwa klucze puste - inaczej dokument nosiłby `fontFamily: ""`,
    // co renderer wstawia do CSS jako pustą deklarację.
    expect("fontFamily" in (last() ?? {})).toBe(false);
  });

  it("rysuje nagłówki obu grup rozmiarów", () => {
    renderTypography();
    expect(screen.getByText("builder.typographyControl.desktopGroup")).toBeInTheDocument();
    expect(screen.getByText("builder.typographyControl.mobileGroup")).toBeInTheDocument();
  });
});
