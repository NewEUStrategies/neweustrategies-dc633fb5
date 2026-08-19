// Molekuły i atomy edytora Theme Design, do 18.08.2026 na zerze:
// `ColorModeScopeBar`, `ToolbarButtonPreview`, `OverlaySizeRow`,
// `SectionTabsNav` oraz atomy `Field`, `FieldGrid`, `Section`, `PreviewFrame`,
// `ToggleField`, `NumStepper`, `PxStepper`.
//
// Trzy z nich niosą reguły, a nie tylko znaczniki:
//   * pasek zakresu trybu decyduje, DO KTÓREGO slotu piszą wszystkie kontrolki
//     koloru na stronie - pomyłka zapisuje kolor trybu jasnego do nadpisań
//     ciemnych i odwrotnie,
//   * wiersz rozmiarów nakładki rozwija jedno pole na TRZY progi (`_base`,
//     `_md`, `_lg`) - sklejenie kluczy nadpisałoby rozmiar mobilny desktopowym,
//   * `NumStepper` i `PxStepper` GWARANTUJĄ wartość zdefiniowaną; token
//     `undefined` psuje serializację CSS całego motywu.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-admin-theme-design";
import { ColorModeScopeBar } from "../ColorModeScopeBar";
import { ToolbarButtonPreview } from "../ToolbarButtonPreview";
import { OverlaySizeRow } from "../OverlaySizeRow";
import {
  Field,
  FieldGrid,
  Section,
  PreviewFrame,
  ToggleField,
  NumStepper,
  PxStepper,
} from "../../atoms";
import { THEME_DESIGN_DEFAULTS } from "@/lib/theme/themeDesign";
import type { PostLayoutSettings } from "@/lib/postLayouts";

describe("ColorModeScopeBar - zakres edycji kolorów", () => {
  function setup(mode: "light" | "dark" = "light") {
    const onModeChange = vi.fn();
    render(<ColorModeScopeBar mode={mode} onModeChange={onModeChange} />);
    return { onModeChange };
  }

  it("oferuje dokładnie dwa tryby", () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("zaznacza AKTYWNY tryb dla czytnika ekranu", () => {
    // Wyróżnienie wyłącznie kolorem nie mówi nic osobie korzystającej z czytnika,
    // a to pasek decydujący, gdzie trafi każda kolejna zmiana koloru.
    setup("dark");
    expect(screen.getByRole("button", { name: /light/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /dark/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("przełączenie zgłasza WYBRANY tryb, nie odwrotność bieżącego", () => {
    // Naiwne `onModeChange(mode === "light" ? "dark" : "light")` dawałoby
    // poprawny wynik tylko przy kliknięciu w tryb nieaktywny.
    const { onModeChange } = setup("light");
    fireEvent.click(screen.getByRole("button", { name: /light/i }));
    expect(onModeChange).toHaveBeenCalledWith("light");

    fireEvent.click(screen.getByRole("button", { name: /dark/i }));
    expect(onModeChange).toHaveBeenCalledWith("dark");
  });

  it("wyjaśnia, co znaczy puste pole koloru", () => {
    // Bez tej podpowiedzi puste pole wygląda na brak wartości, a znaczy
    // „dziedzicz token globalny”.
    setup();
    expect(screen.getByText(/dziedzicz|inherit/i)).toBeInTheDocument();
  });
});

describe("ToolbarButtonPreview - podgląd przycisku paska", () => {
  it("czyta GEOMETRIĘ z wersji roboczej", () => {
    const design = {
      ...THEME_DESIGN_DEFAULTS,
      toolbarButton: {
        ...THEME_DESIGN_DEFAULTS.toolbarButton,
        radius: "13px",
        paddingX: "9px",
        paddingY: "7px",
        size: "21px",
      },
    };
    render(<ToolbarButtonPreview design={design} icon="B" />);
    const el = screen.getByText("B");
    expect(el.style.borderRadius).toBe("13px");
    expect(el.style.padding).toBe("7px 9px");
    expect(el.style.fontSize).toBe("21px");
  });

  it("NIE wkleja koloru na sztywno - kolory schodzą kaskadą ze zmiennych CSS", () => {
    // Podgląd musi reagować na tryb jasny i ciemny bez przeliczania w JS,
    // więc w stylu inline nie może wylądować żaden literał koloru.
    // (happy-dom pomija deklaracje z `var()`, więc mierzymy ICH BRAK -
    // literał hex/rgb byłby tu widoczny natychmiast.)
    render(<ToolbarButtonPreview design={THEME_DESIGN_DEFAULTS} icon="B" />);
    const style = screen.getByText("B").getAttribute("style") ?? "";
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style).not.toMatch(/rgba?\(/i);
  });

  it("stan AKTYWNY zmienia WYŁĄCZNIE kolory, nie geometrię", () => {
    // Gdyby stan aktywny ruszał promień albo odstępy, pasek „skakałby"
    // przy każdym przełączeniu.
    const { unmount } = render(<ToolbarButtonPreview design={THEME_DESIGN_DEFAULTS} icon="B" />);
    const idle = screen.getByText("B").getAttribute("style") ?? "";
    unmount();

    render(<ToolbarButtonPreview design={THEME_DESIGN_DEFAULTS} icon="B" active />);
    expect(screen.getByText("B").getAttribute("style")).toBe(idle);
  });

  it("szerokość minimalna rośnie z rozmiarem i odstępami", () => {
    // Bez tego przyciski o różnej treści miałyby różną szerokość i pasek
    // „skakałby” przy zmianie ikony.
    render(<ToolbarButtonPreview design={THEME_DESIGN_DEFAULTS} icon="B" />);
    expect(screen.getByText("B").style.minWidth).toContain("calc(");
  });
});

describe("OverlaySizeRow - rozmiary nakładki per próg", () => {
  function draft(): PostLayoutSettings {
    return {
      overlay_title_size_base: 24,
      overlay_title_size_md: 32,
      overlay_title_size_lg: 40,
    } as unknown as PostLayoutSettings;
  }

  function setup() {
    const onPatch = vi.fn();
    render(
      <OverlaySizeRow
        label="Tytuł nakładki"
        field="overlay_title_size"
        draft={draft()}
        onPatch={onPatch}
      />,
    );
    return { onPatch };
  }

  it("rozwija JEDNO pole na TRZY progi", () => {
    setup();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
  });

  it("każdy próg pokazuje SWOJĄ wartość", () => {
    setup();
    const values = screen.getAllByRole("spinbutton").map((i) => (i as HTMLInputElement).value);
    expect(values).toEqual(["24", "32", "40"]);
  });

  it("zapis trafia w klucz Z SUFIKSEM progu", () => {
    // Sklejenie kluczy nadpisałoby rozmiar mobilny desktopowym - i odwrotnie.
    const { onPatch } = setup();
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "18" } });
    expect(onPatch).toHaveBeenCalledWith({ overlay_title_size_base: 18 });

    fireEvent.change(inputs[2], { target: { value: "52" } });
    expect(onPatch).toHaveBeenCalledWith({ overlay_title_size_lg: 52 });
  });

  it("progi mają własne etykiety, nie tylko numery", () => {
    setup();
    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    expect(new Set(labels).size).toBeGreaterThanOrEqual(4);
  });
});

describe("Atomy edytora", () => {
  it("Field wiąże etykietę z kontrolką w jednym bloku", () => {
    render(
      <Field label="Rozmiar">
        <input aria-label="pole" />
      </Field>,
    );
    expect(screen.getByText("Rozmiar")).toBeInTheDocument();
    expect(screen.getByLabelText("pole")).toBeInTheDocument();
  });

  it("FieldGrid układa dzieci w siatkę responsywną", () => {
    const { container } = render(
      <FieldGrid>
        <span>a</span>
        <span>b</span>
      </FieldGrid>,
    );
    expect(container.firstElementChild?.className).toContain("grid");
    expect(container.firstElementChild?.className).toContain("md:grid-cols-3");
  });

  it("Section renderuje tytuł jako nagłówek drugiego poziomu", () => {
    // Poziom nagłówka jest strukturą dokumentu, po której nawiguje czytnik.
    render(
      <Section title="Nagłówki bloków">
        <span>treść</span>
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Nagłówki bloków" })).toBeInTheDocument();
  });

  it("PreviewFrame oznacza swoją zawartość jako PODGLĄD", () => {
    // Bez etykiety redaktor nie odróżnia podglądu od realnej treści panelu.
    render(
      <PreviewFrame>
        <span>zawartość</span>
      </PreviewFrame>,
    );
    expect(screen.getByText("zawartość")).toBeInTheDocument();
    expect(screen.getByText(/podgląd|preview/i)).toBeInTheDocument();
  });

  it("ToggleField przekazuje wartość logiczną", () => {
    const onChange = vi.fn();
    render(<ToggleField label="Wersaliki" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ToggleField odzwierciedla stan wciśnięcia", () => {
    render(<ToggleField label="Pętla" checked onChange={vi.fn()} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("Atomy krokowe - gwarancja wartości zdefiniowanej", () => {
  it("NumStepper spada na MINIMUM po wyczyszczeniu pola", () => {
    // `undefined` w tokenie liczbowym psuje serializację CSS całego motywu.
    const onChange = vi.fn();
    render(<NumStepper value={700} onChange={onChange} min={100} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("NumStepper przekazuje wpisaną liczbę", () => {
    const onChange = vi.fn();
    render(<NumStepper value={700} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith(500);
  });

  it("PxStepper spada na MINIMUM Z JEDNOSTKĄ po wyczyszczeniu pola", () => {
    // Sama liczba bez „px" jest niepoprawną wartością CSS i przeglądarka
    // odrzuca całą deklarację.
    const onChange = vi.fn();
    render(<PxStepper value="18px" onChange={onChange} min={4} />);
    fireEvent.change(within(document.body).getByRole("textbox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("4px");
  });

  it("PxStepper przekazuje wpisaną wartość bez obróbki", () => {
    const onChange = vi.fn();
    render(<PxStepper value="18px" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2rem" } });
    expect(onChange).toHaveBeenCalledWith("2rem");
  });
});
