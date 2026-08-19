// Atomy paneli „doświadczenia czytelnika". Każdy z nich scalił od trzech do
// dziesięciu kopii tej samej kontrolki rozsianych po czterech plikach tras -
// i w każdym przypadku scalenie NAPRAWIŁO kontrakt dostępności, którego część
// kopii nie miała wcale.
//
// Test atomu sprawdza więc dokładnie to, co scalenie ustaliło: rola, nazwa
// dostępna, stan (wybrany / wyłączony) i powiązanie etykiety z kontrolką.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});

// `AdminColorPicker` wciąga react-colorful i własny słownik bloków. Na granicy
// modułu wystawiamy przycisk z tą samą nazwą dostępną, bo w tym pliku dowodzimy
// POWIĄZANIA podpisu z kontrolką, a nie działania samego selektora barwy.
vi.mock("@/components/admin/blocks/AdminColorPicker", () => ({
  AdminColorPicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string | undefined;
    onChange: (v: string | undefined) => void;
    ariaLabel?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      data-value={value}
      onClick={() => onChange(undefined)}
    >
      {value}
    </button>
  ),
}));

import { PanelSectionHeading } from "@/components/admin/postExperience/atoms/PanelSectionHeading";
import { SelectableOptionCard } from "@/components/admin/postExperience/atoms/SelectableOptionCard";
import { PanelNumberField } from "@/components/admin/postExperience/atoms/PanelNumberField";
import { PanelTextField } from "@/components/admin/postExperience/atoms/PanelTextField";
import { PanelColorField } from "@/components/admin/postExperience/atoms/PanelColorField";
import { PanelSelectField } from "@/components/admin/postExperience/atoms/PanelSelectField";
import { PanelRangeField } from "@/components/admin/postExperience/atoms/PanelRangeField";

describe("PanelSectionHeading - nagłówek sekcji panelu", () => {
  it("renderuje PRAWDZIWY nagłówek, nie `<label>` bez kontrolki", () => {
    const { container } = render(<PanelSectionHeading>Ogólne</PanelSectionHeading>);
    expect(screen.getByRole("heading", { name: "Ogólne", level: 2 })).toBeInTheDocument();
    expect(container.querySelector("label")).toBeNull();
  });

  it("poziom nagłówka jest sterowalny (podsekcja schodzi na H3)", () => {
    render(
      <PanelSectionHeading as="h3" tone="field">
        Kolumny
      </PanelSectionHeading>,
    );
    expect(screen.getByRole("heading", { name: "Kolumny", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("wariant wizualny jest NIEZALEŻNY od semantyki - trzy odmiany, ten sam H2", () => {
    const tones = ["eyebrow", "display", "field"] as const;
    const classes = tones.map((tone) => {
      const { container, unmount } = render(
        <PanelSectionHeading tone={tone}>Sekcja</PanelSectionHeading>,
      );
      const cls = container.querySelector("h2")?.className ?? "";
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(3);
    expect(classes.every((c) => c.length > 0)).toBe(true);
  });

  it("przyjmuje własną klasę, nie gubiąc wariantu", () => {
    const { container } = render(
      <PanelSectionHeading className="mb-4">Sekcja</PanelSectionHeading>,
    );
    const cls = container.querySelector("h2")?.className ?? "";
    expect(cls).toContain("mb-4");
    expect(cls).toContain("uppercase");
  });
});

describe("SelectableOptionCard - karta wyboru opcji", () => {
  it("ogłasza stan WYBRANY przez `aria-pressed`, nie samym kolorem ramki", () => {
    render(<SelectableOptionCard label="2 kolumny" selected onSelect={() => {}} />);
    const button = screen.getByRole("button", { name: "2 kolumny" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.className).toContain("border-brand");
  });

  it("opcja niewybrana ogłasza `aria-pressed=false` i ma neutralną ramkę", () => {
    render(<SelectableOptionCard label="1 kolumna" selected={false} onSelect={() => {}} />);
    const button = screen.getByRole("button", { name: "1 kolumna" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button.className).toContain("border-border");
  });

  it("kliknięcie zgłasza INTENCJĘ, bez zdarzenia DOM w argumencie", () => {
    const onSelect = vi.fn();
    render(<SelectableOptionCard label="Połowa" selected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Połowa" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith();
  });

  it("gdy widoczną treścią jest MINIATURA, nazwa dostępna idzie z `ariaLabel`", () => {
    render(
      <SelectableOptionCard
        label="gwiazdka"
        ariaLabel="Ikona: gwiazdka"
        selected={false}
        onSelect={() => {}}
      >
        <svg aria-hidden="true" />
      </SelectableOptionCard>,
    );
    expect(screen.getByRole("button", { name: "Ikona: gwiazdka" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gwiazdka" })).toBeNull();
  });

  it("bez własnej treści widoczną treścią staje się etykieta", () => {
    render(<SelectableOptionCard label="Karta z ramką" selected={false} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Karta z ramką" }).textContent).toBe("Karta z ramką");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("opcja WYŁĄCZONA nie zgłasza wyboru", () => {
    const onSelect = vi.fn();
    render(<SelectableOptionCard label="H6" selected={false} disabled onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "H6" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("jest przyciskiem typu `button` - nie wysyła formularza panelu", () => {
    render(<SelectableOptionCard label="Opcja" selected={false} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Opcja" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Opcja" })).not.toBeDisabled();
  });
});

describe("PanelNumberField - pole liczbowe z granicami", () => {
  it("etykieta jest POWIĄZANA z polem (czytnik ekranu czyta nazwę, nie samą liczbę)", () => {
    render(
      <PanelNumberField
        label="Pozycja"
        value={3}
        bounds={{ min: -1, max: 20 }}
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Pozycja" });
    expect(input).toHaveValue(3);
    expect(input.id).toBeTruthy();
  });

  it("granice trafiają na atrybuty pola, więc widzi je też walidacja przeglądarki", () => {
    render(
      <PanelNumberField label="Min" value={3} bounds={{ min: 1, max: 20 }} onChange={() => {}} />,
    );
    const input = screen.getByRole("spinbutton", { name: "Min" });
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "20");
  });

  it("wartość PONAD górną granicą jest przycinana PRZED zgłoszeniem zmiany", () => {
    const onChange = vi.fn();
    render(
      <PanelNumberField
        label="Pozycja"
        value={3}
        bounds={{ min: -1, max: 20 }}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Pozycja" });
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.change(input, { target: { value: "7" } });
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([20, 7]);
    expect(onChange.mock.calls.every(([v]) => v <= 20)).toBe(true);
  });

  it("podpowiedź jest wiązana przez `aria-describedby`, nie tylko postawiona obok", () => {
    render(
      <PanelNumberField
        label="Pozycja"
        value={0}
        bounds={{ min: -1, max: 20 }}
        hint="0 = na górze"
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Pozycja" });
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId as string)?.textContent).toBe("0 = na górze");
  });

  it("bez podpowiedzi pole nie zostawia wiszącego `aria-describedby`", () => {
    render(
      <PanelNumberField label="Min" value={3} bounds={{ min: 1, max: 20 }} onChange={() => {}} />,
    );
    const input = screen.getByRole("spinbutton", { name: "Min" });
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).toHaveValue(3);
  });

  it("pole WYŁĄCZONE niesie atrybut `disabled` i pokazuje wartość bez zmian", () => {
    // UWAGA NA GRANICĘ NARZĘDZIA: `fireEvent.change` wysyła zdarzenie wprost do
    // Reacta, omijając blokadę, którą przeglądarka stawia na wyłączonym polu -
    // nie da się nim DOWIEŚĆ, że wpis nie przechodzi. Dowodem jest tu sam
    // atrybut `disabled`: jego brak to regresja, którą łapie pierwsza asercja.
    render(
      <PanelNumberField
        label="Interwał"
        value={5}
        bounds={{ min: 1, max: 20 }}
        disabled
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Interwał" });
    expect(input).toBeDisabled();
    expect(input).toHaveValue(5);
  });
});

describe("PanelTextField - pole tekstowe z powiązaną etykietą", () => {
  it("etykieta jest powiązana z polem i widać w nim wartość", () => {
    render(<PanelTextField label="Tytuł (PL)" value="Spis treści" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Tytuł (PL)" });
    expect(input).toHaveValue("Spis treści");
    expect(input.id).toBeTruthy();
  });

  it("każde pole ma WŁASNY identyfikator - dwa pola obok siebie się nie mieszają", () => {
    render(
      <>
        <PanelTextField label="Tytuł (PL)" value="Spis" onChange={() => {}} />
        <PanelTextField label="Tytuł (EN)" value="Contents" onChange={() => {}} />
      </>,
    );
    const pl = screen.getByRole("textbox", { name: "Tytuł (PL)" });
    const en = screen.getByRole("textbox", { name: "Tytuł (EN)" });
    expect(pl.id).not.toBe(en.id);
    expect([pl, en].map((i) => (i as HTMLInputElement).value)).toEqual(["Spis", "Contents"]);
  });

  it("wpisanie znaku zgłasza NOWĄ wartość pola", () => {
    const onChange = vi.fn();
    render(<PanelTextField label="Tytuł (EN)" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Tytuł (EN)" }), {
      target: { value: "A" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("podpowiedź w pustym polu jest widoczna jako placeholder", () => {
    render(
      <PanelTextField
        label="Etykieta"
        value=""
        placeholder="Z tego artykułu…"
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Etykieta" });
    expect(input).toHaveAttribute("placeholder", "Z tego artykułu…");
    expect(input).toHaveValue("");
  });
});

describe("PanelColorField - pole koloru", () => {
  it("podpis staje się nazwą dostępną selektora barwy", () => {
    render(<PanelColorField label="Tło (jasny motyw)" value="#ffffff" onChange={() => {}} />);
    const picker = screen.getByRole("button", { name: "Tło (jasny motyw)" });
    expect(picker).toHaveAttribute("data-value", "#ffffff");
    expect(screen.getByText("Tło (jasny motyw)")).toBeInTheDocument();
  });

  it("BRAK wartości z selektora schodzi do pustego łańcucha, nie do `undefined`", () => {
    const onChange = vi.fn();
    render(<PanelColorField label="Akcent" value="#fa9346" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Akcent" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("PanelSelectField - lista rozwijana z powiązaną etykietą", () => {
  const options = [
    { value: "boxed", label: "Karta z ramką" },
    { value: "inline", label: "Inline" },
  ];

  it("etykieta jest powiązana z kontrolką, a wartość widoczna", () => {
    render(<PanelSelectField label="Układ" value="inline" options={options} onChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Układ" });
    expect(select).toHaveValue("inline");
    expect(select.id).toBeTruthy();
  });

  it("wszystkie opcje trafiają do listy, w podanej kolejności", () => {
    render(<PanelSelectField label="Układ" value="boxed" options={options} onChange={() => {}} />);
    const rendered = screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(rendered).toEqual(["boxed", "inline"]);
    expect(screen.getByRole("option", { name: "Karta z ramką" })).toBeInTheDocument();
  });

  it("opcja WYŁĄCZONA jest wyłączona w drzewie, nie tylko w regule", () => {
    render(
      <PanelSelectField
        label="Min. poziom"
        value="2"
        options={[
          { value: "2", label: "H2" },
          { value: "5", label: "H5", disabled: true },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("option", { name: "H5" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "H2" })).not.toBeDisabled();
  });

  it("wybór zgłasza WARTOŚĆ opcji, nie jej etykietę", () => {
    const onChange = vi.fn();
    render(<PanelSelectField label="Układ" value="boxed" options={options} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Układ" }), {
      target: { value: "inline" },
    });
    expect(onChange).toHaveBeenCalledWith("inline");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("lista WYŁĄCZONA nie przyjmuje wyboru", () => {
    render(
      <PanelSelectField
        label="Układ"
        value="boxed"
        options={options}
        disabled
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Układ" })).toBeDisabled();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

describe("PanelRangeField - suwak z odczytem wartości", () => {
  it("etykieta jest STAŁA i powiązana z suwakiem, wartość idzie OSOBNYM odczytem", () => {
    // Kopie wpisywały wartość w tekst etykiety, więc nazwa kontrolki zmieniała
    // się przy każdym ruchu suwaka - czytnik ekranu ogłaszał nową nazwę pola
    // zamiast nowej wartości.
    render(
      <PanelRangeField
        label="Rozmiar napisu"
        readout="1.25×"
        value={1.25}
        bounds={{ min: 0.5, max: 3 }}
        step={0.05}
        onChange={() => {}}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Rozmiar napisu" });
    expect(slider).toHaveValue("1.25");
    expect(screen.getByText("1.25×")).toBeInTheDocument();
  });

  it("BEZ odczytu suwak nadal ma nazwę i wartość", () => {
    render(
      <PanelRangeField label="Grubość" value={2} bounds={{ min: 0, max: 8 }} onChange={() => {}} />,
    );
    const slider = screen.getByRole("slider", { name: "Grubość" });
    expect(slider).toHaveValue("2");
    expect(slider).toHaveAttribute("max", "8");
  });

  it("ruch suwaka dociąga wartość do KROKU, nie do całych", () => {
    const onChange = vi.fn();
    render(
      <PanelRangeField
        label="Rozmiar"
        value={1}
        bounds={{ min: 0.5, max: 3 }}
        step={0.05}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Rozmiar" }), {
      target: { value: "1.35" },
    });
    expect(onChange).toHaveBeenCalledWith(1.35);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("podpisy skrajne BEZ skrótu wyzerowania nie rysują dodatkowego przycisku", () => {
    render(
      <PanelRangeField
        label="Przesunięcie"
        value={0}
        bounds={{ min: -200, max: 200 }}
        scaleLabels={["-200", "+200"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("-200")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("skrót wyzerowania jest przyciskiem i zgłasza własną intencję", () => {
    const onReset = vi.fn();
    const onChange = vi.fn();
    render(
      <PanelRangeField
        label="Przesunięcie"
        value={-80}
        bounds={{ min: -200, max: 200 }}
        scaleLabels={["-200", "+200"]}
        resetLabel="Wyzeruj"
        onReset={onReset}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Wyzeruj" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
