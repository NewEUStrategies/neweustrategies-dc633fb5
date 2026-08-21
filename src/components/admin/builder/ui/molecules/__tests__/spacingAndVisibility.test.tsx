// Kontrolki wspólne dla WSZYSTKICH widgetów: odstępy (padding/margin/align),
// widoczność per urządzenie i stan hover.
//
// `SpacingControl` jest tu najciekawszy, bo tłumaczy CZTERY pola na JEDEN
// skrót CSS i z powrotem. Dwa realne błędy, które ten test przypina:
//   * bezjednostkowa liczba ("10") jest w CSS IGNOROWANA (poza zerem), więc
//     panel musi dopisać `px` - inaczej redaktor wpisuje 10, zapis wygląda
//     poprawnie, a odstęp się nie zmienia;
//   * skrót musi się zwijać dokładnie tak, jak go rozwija (`parseSides`), bo
//     inaczej ponowne otwarcie panelu pokazuje inne wartości niż zapisane.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AdvancedSettings, CommonStyle, HoverStyle } from "@/lib/builder/types";
import { MutableHost, selectWithOption, optionValues } from "@/test/builder/panels";
import { SpacingControl } from "../SpacingControl";
import { VisibilityControl } from "../VisibilityControl";
import { HoverControl } from "../HoverControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

interface Spacing {
  padding?: HTMLInputElement[];
  margin?: HTMLInputElement[];
}

/**
 * Zwraca pola stron obu grup. Panel nie wiąże etykiet z kontrolkami (etykieta
 * jest nad polem), więc adresujemy je przez kolejność w gridzie - ta jest
 * częścią kontraktu wizualnego (góra, prawo, dół, lewo).
 */
function sideInputs(): Spacing {
  const groups = Array.from(document.querySelectorAll("div.grid-cols-4"));
  const read = (group: Element | undefined): HTMLInputElement[] =>
    group ? Array.from(group.querySelectorAll<HTMLInputElement>("input")) : [];
  return { padding: read(groups[0]), margin: read(groups[1]) };
}

function renderSpacing(style: CommonStyle = {}) {
  const applied: CommonStyle[] = [];
  render(
    <MutableHost<CommonStyle> initial={style} onApplied={(next) => applied.push(next)}>
      {(value, apply) => <SpacingControl style={value} device="desktop" onChange={apply} />}
    </MutableHost>,
  );
  return { applied, last: () => applied.at(-1) };
}

describe("SpacingControl - rozwijanie skrótu CSS", () => {
  it.each([
    ["jedna wartość", "8px", ["8px", "8px", "8px", "8px"]],
    ["dwie wartości", "8px 16px", ["8px", "16px", "8px", "16px"]],
    ["trzy wartości", "8px 16px 24px", ["8px", "16px", "24px", "16px"]],
    ["cztery wartości", "1px 2px 3px 4px", ["1px", "2px", "3px", "4px"]],
    ["nadmiar spacji", "  8px   16px  ", ["8px", "16px", "8px", "16px"]],
  ])("%s", (_label, stored, expected) => {
    renderSpacing({ padding: { desktop: stored, tablet: stored, mobile: stored } });
    const values = (sideInputs().padding ?? []).map((i) => i.value);
    expect(values).toEqual(expected);
  });

  it.each([
    ["brak zapisu", undefined],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ])("pokazuje puste pola dla: %s", (_label, stored) => {
    renderSpacing(
      stored === undefined ? {} : { padding: { desktop: stored, tablet: stored, mobile: stored } },
    );
    expect((sideInputs().padding ?? []).map((i) => i.value)).toEqual(["", "", "", ""]);
  });

  it("czyta wartość z tabletu, gdy desktop jej nie ma", () => {
    renderSpacing({ padding: { tablet: "12px" } });
    // Panel pokazuje JEDNĄ wartość dla wszystkich urządzeń, więc musi umieć
    // wskazać reprezentanta - inaczej redaktor widzi pustkę i nadpisuje zapis.
    expect((sideInputs().padding ?? [])[0]?.value).toBe("12px");
  });

  it("czyta wartość z mobile, gdy nie ma ani desktopu, ani tabletu", () => {
    renderSpacing({ padding: { mobile: "4px" } });
    expect((sideInputs().padding ?? [])[0]?.value).toBe("4px");
  });
});

describe("SpacingControl - zwijanie do skrótu CSS", () => {
  it.each([
    ["liczba bez jednostki dostaje px", 0, "10", "10px"],
    ["zero zostaje zerem", 0, "0", "0"],
    ["ułamek", 0, "1.5", "1.5px"],
    ["wartość ujemna", 0, "-4", "-4px"],
    ["jednostka zachowana", 0, "2rem", "2rem"],
    ["procent zachowany", 0, "10%", "10%"],
    ["zmienna CSS zachowana", 0, "var(--gap)", "var(--gap)"],
    ["calc zachowany", 0, "calc(1rem + 2px)", "calc(1rem + 2px)"],
  ])("%s", (_label, index, typed, expected) => {
    const { last } = renderSpacing();
    fireEvent.change((sideInputs().padding ?? [])[index], { target: { value: typed } });
    // Puste strony zapisują się jako jawne "0" (skrót "10px" oznaczałby odstęp
    // z każdej strony), a równe boki zwijają skrót do trzech wartości.
    expect(last()?.padding?.desktop).toBe(expected === "0" ? "0" : `${expected} 0 0`);
  });

  it.each([
    ["słowo kluczowe CSS", "auto"],
    ["wartość bez sensu", "-"],
    ["wyrażenie ze znakiem", "+2"],
  ])("wpis nierozpoznany trafia do zapisu bez zmian: %s", (_label, typed) => {
    const { last } = renderSpacing();
    fireEvent.change((sideInputs().padding ?? [])[0], { target: { value: typed } });
    // Panel nie jest walidatorem CSS - „auto” jest legalne dla marginesu,
    // a resztę odrzuci przeglądarka. Ważne, że panel nic tu nie „naprawia”:
    // dopisanie `px` do „-” dałoby wartość, której nikt nie wpisał.
    expect(last()?.padding?.desktop).toBe(`${typed} 0 0`);
  });

  it("zapisuje tę samą wartość na wszystkie urządzenia", () => {
    const { last } = renderSpacing();
    fireEvent.change((sideInputs().padding ?? [])[0], { target: { value: "8" } });
    expect(last()?.padding).toEqual({
      desktop: "8px 0 0",
      tablet: "8px 0 0",
      mobile: "8px 0 0",
    });
  });

  it("cztery równe strony zwijają się do jednej wartości", () => {
    const { last } = renderSpacing({
      padding: { desktop: "8px 8px 8px 0", tablet: "8px 8px 8px 0", mobile: "8px 8px 8px 0" },
    });
    fireEvent.change((sideInputs().padding ?? [])[3], { target: { value: "8px" } });
    expect(last()?.padding?.desktop).toBe("8px");
  });

  it("para góra/dół i lewo/prawo zwija się do dwóch wartości", () => {
    const { last } = renderSpacing({
      padding: { desktop: "8px 16px 0 16px" },
    });
    fireEvent.change((sideInputs().padding ?? [])[2], { target: { value: "8px" } });
    expect(last()?.padding?.desktop).toBe("8px 16px");
  });

  it("równe boki zwijają się do trzech wartości", () => {
    const { last } = renderSpacing({ padding: { desktop: "8px 16px 0 16px" } });
    fireEvent.change((sideInputs().padding ?? [])[2], { target: { value: "24px" } });
    expect(last()?.padding?.desktop).toBe("8px 16px 24px");
  });

  it("edycja pustego zapisu zostawia go pustym", () => {
    const { last } = renderSpacing();
    fireEvent.change((sideInputs().padding ?? [])[0], { target: { value: "" } });
    // Cztery puste strony -> `undefined`, nie "0 0 0 0": dokument nie może
    // dostać jawnego zera tylko dlatego, że redaktor wszedł w pole i wyszedł.
    expect(last()?.padding?.desktop).toBeUndefined();
  });

  it("wyczyszczenie pól po zapisie zostawia JAWNE zera", () => {
    const { last } = renderSpacing({ padding: { desktop: "8px" } });
    for (const input of sideInputs().padding ?? []) {
      fireEvent.change(input, { target: { value: "" } });
    }
    // Stan faktyczny, przypięty świadomie: pusta strona zapisuje się jako "0",
    // więc po wyczyszczeniu wszystkich czterech pól w dokumencie zostaje
    // `padding: "0"`, a nie brak nadpisania. Panel nie ma przycisku resetu, więc
    // powrotu do wartości dziedziczonej nie da się w nim wykonać - to ma
    // znaczenie dla sekcji, które dziedziczą odstępy z szablonu.
    expect(last()?.padding?.desktop).toBe("0");
  });

  it("margines zapisuje się niezależnie od paddingu", () => {
    const { last } = renderSpacing({ padding: { desktop: "8px" } });
    fireEvent.change((sideInputs().margin ?? [])[0], { target: { value: "12" } });
    expect(last()?.margin?.desktop).toBe("12px 0 0");
    expect(last()?.padding?.desktop).toBe("8px");
  });

  it("rysuje etykiety czterech stron dla obu grup", () => {
    renderSpacing();
    // Góra i dół występują dokładnie dwa razy (padding + margines). Lewo
    // i prawo trzy, bo te same klucze nazywają też opcje listy wyrównania -
    // dlatego liczymy je osobno, a nie jedną pętlą po wszystkich stronach.
    expect(screen.getAllByText("builder.common.top")).toHaveLength(2);
    expect(screen.getAllByText("builder.common.bottom")).toHaveLength(2);
    expect(screen.getAllByText("builder.common.left")).toHaveLength(3);
    expect(screen.getAllByText("builder.common.right")).toHaveLength(3);
  });
});

describe("SpacingControl - wyrównanie", () => {
  it("domyślnie pokazuje wyrównanie do lewej", () => {
    renderSpacing();
    expect(selectWithOption("center").value).toBe("left");
    expect(optionValues(selectWithOption("center"))).toEqual(["left", "center", "right"]);
  });

  it("czyta zapisane wyrównanie", () => {
    renderSpacing({ align: { desktop: "right" } });
    expect(selectWithOption("center").value).toBe("right");
  });

  it("zapisuje wyrównanie na wszystkie urządzenia", () => {
    const { last } = renderSpacing();
    fireEvent.change(selectWithOption("center"), { target: { value: "center" } });
    expect(last()?.align).toEqual({ desktop: "center", tablet: "center", mobile: "center" });
  });
});

describe("VisibilityControl", () => {
  function renderVisibility(advanced: AdvancedSettings = {}) {
    const applied: AdvancedSettings[] = [];
    render(
      <MutableHost<AdvancedSettings> initial={advanced} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <VisibilityControl value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it.each([
    ["Desktop", "desktop"],
    ["Tablet", "tablet"],
    ["Mobile", "mobile"],
  ] as const)("ukrywa widget na urządzeniu %s", (label, key) => {
    const { last } = renderVisibility();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(last()?.hideOn?.[key]).toBe(true);
  });

  it("ponowny klik przywraca widoczność", () => {
    const { last } = renderVisibility({ hideOn: { tablet: true } });
    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    expect(last()?.hideOn?.tablet).toBe(false);
  });

  it("ukrycie jednego urządzenia nie rusza pozostałych", () => {
    const { last } = renderVisibility({ hideOn: { mobile: true } });
    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(last()?.hideOn).toEqual({ mobile: true, desktop: true });
  });

  it("tytuł przycisku opisuje stan i urządzenie", () => {
    renderVisibility({ hideOn: { desktop: true } });
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "title",
      "builder.visibility.hiddenOn(device=Desktop)",
    );
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute(
      "title",
      "builder.visibility.visibleOn(device=Tablet)",
    );
  });

  it("brak zapisu zaawansowanego to stan w pełni widoczny", () => {
    renderVisibility();
    for (const label of ["Desktop", "Tablet", "Mobile"]) {
      expect(screen.getByRole("button", { name: label }).className).toContain("bg-muted/30");
    }
  });
});

describe("HoverControl", () => {
  function renderHover(initial: HoverStyle | undefined) {
    const calls: Array<HoverStyle | undefined> = [];
    function Host() {
      return (
        <HoverControlHost
          initial={initial}
          onChange={(next) => {
            calls.push(next);
          }}
        />
      );
    }
    render(<Host />);
    return { calls, last: () => calls.at(-1) };
  }

  it("wyłączony hover nie pokazuje żadnego pola", () => {
    renderHover(undefined);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText("builder.hover.bg")).toBeNull();
  });

  it("włączenie zapisuje domyślny czas przejścia", () => {
    const { last } = renderHover(undefined);
    fireEvent.click(screen.getByRole("checkbox"));
    // Bez czasu przejścia hover „przeskakuje” - stąd 200 ms jako wartość
    // startowa, a nie pusty obiekt.
    expect(last()).toEqual({ transitionMs: 200 });
  });

  it("wyłączenie czyści cały stan hover", () => {
    const { last } = renderHover({ bgColor: "#fff", transitionMs: 200 });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(last()).toBeUndefined();
  });

  it("włączony hover pokazuje pola i zapisuje kolory", () => {
    const { last } = renderHover({ transitionMs: 200 });
    const colorInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input.font-mono"));
    fireEvent.change(colorInputs[0], { target: { value: "#101010" } });
    expect(last()?.bgColor).toBe("#101010");
    fireEvent.change(colorInputs[1], { target: { value: "#f0f0f0" } });
    expect(last()?.textColor).toBe("#f0f0f0");
  });

  it.each([
    ["skala", "1.03", "1.05", 1.05],
    ["skala zerowa jest odrzucana", "1.03", "0", undefined],
    ["skala ujemna jest odrzucana", "1.03", "-1", undefined],
    ["skala nieliczbowa jest odrzucana", "1.03", "", undefined],
  ])("%s", (_label, placeholder, typed, expected) => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
    if (!input) throw new Error("test: brak pola skali");
    fireEvent.change(input, { target: { value: typed } });
    expect(last()?.scale).toBe(expected);
  });

  it.each([
    ["przesunięcie w pionie", "-2px", "-4px", "translateY"],
    ["promień narożnika", "10px", "12px", "borderRadius"],
    ["cień", "0 8px 24px rgba(0,0,0,.18)", "0 2px 4px #000", "shadow"],
  ] as const)("zapisuje %s", (_label, placeholder, typed, key) => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
    if (!input) throw new Error(`test: brak pola ${placeholder}`);
    fireEvent.change(input, { target: { value: typed } });
    expect(last()?.[key]).toBe(typed);
    fireEvent.change(input, { target: { value: "" } });
    expect(last()?.[key]).toBeUndefined();
  });

  it.each([
    ["czas przejścia", "400", 400],
    ["zero jest dopuszczalne", "0", 0],
  ])("%s", (_label, typed, expected) => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>('input[placeholder="200"]');
    if (!input) throw new Error("test: brak pola czasu przejścia");
    fireEvent.change(input, { target: { value: typed } });
    expect(last()?.transitionMs).toBe(expected);
  });

  // BŁĄD PRODUKCYJNY (udokumentowany, nienaprawiony w tym etapie).
  // Pole czasu przejścia zapisuje `Number.isFinite(n) && n >= 0 ? n : undefined`,
  // a `Number("")` to ZERO - więc wyczyszczenie pola zapisuje 0 ms zamiast
  // zdjąć nadpisanie. Skutek dla redakcji: pole samo „wpisuje się” na 0
  // (`v.transitionMs ?? ""` pokazuje potem zero), a hover przestaje mieć
  // animację, mimo że redaktor chciał wrócić do domyślnych 200 ms. Sąsiednie
  // pole skali robi to POPRAWNIE (`n > 0` odrzuca zero), więc to przeoczenie,
  // nie decyzja. Ten sam wzorzec siedzi w `MotionControl` (czas trwania,
  // opóźnienie, dystans) - tam ma własną kontrolę dodatnią.
  it.fails("wyczyszczenie pola czasu przejścia zdejmuje nadpisanie", () => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>('input[placeholder="200"]');
    if (!input) throw new Error("test: brak pola czasu przejścia");
    fireEvent.change(input, { target: { value: "" } });
    expect(last()?.transitionMs).toBeUndefined();
  });

  it("ujemny czas przejścia jest odrzucany", () => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>('input[placeholder="200"]');
    if (!input) throw new Error("test: brak pola czasu przejścia");
    fireEvent.change(input, { target: { value: "-5" } });
    // Ujemne przejście nie istnieje w CSS - zapis musi zdjąć nadpisanie,
    // a nie wpisać liczbę, którą renderer przepisze do `transition-duration`.
    expect(last()?.transitionMs).toBeUndefined();
  });

  it("wyczyszczenie pola czasu przejścia zapisuje zero - stan faktyczny", () => {
    const { last } = renderHover({ transitionMs: 200 });
    const input = document.querySelector<HTMLInputElement>('input[placeholder="200"]');
    if (!input) throw new Error("test: brak pola czasu przejścia");
    fireEvent.change(input, { target: { value: "" } });
    expect(last()?.transitionMs).toBe(0);
  });
});

/** Gospodarz `HoverControl`: kontrolka dostaje CAŁĄ wartość, nie mutację. */
function HoverControlHost({
  initial,
  onChange,
}: {
  initial: HoverStyle | undefined;
  onChange: (next: HoverStyle | undefined) => void;
}) {
  const [value, setValue] = useState<HoverStyle | undefined>(initial);
  return (
    <HoverControl
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
