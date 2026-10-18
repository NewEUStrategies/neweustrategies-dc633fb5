// InteractiveCircleEditor: panel „Interaktywnego koła" - ustawienia koła,
// tekst nad kołem i lista pozycji (do 8).
//
// Reguły, które ten plik przypina:
//  1. Listy wyboru pokazują to, co RYSUJE renderer (`InteractiveCircleWidget`).
//     Brak układu to półokrąg, a obrót łuku renderer stosuje tylko dla pełnego
//     koła - panel nie może więc oferować obrotu przy brakującym układzie ani
//     pokazywać „obrotu" półokręgu, który stoi w miejscu.
//  2. Pola liczbowe nie zapisują NaN ani zera tam, gdzie zero nie jest
//     rozmiarem: pustka wraca do wartości domyślnej renderera.
//  3. Lista pozycji: dodanie seeduje pełny kształt pozycji, limit to 8 (tyle
//     renderer rysuje), edycja jednej pozycji nie rusza sąsiednich.
//
// Atrapy: Radix Select (happy-dom nie otwiera warstwy) oraz `LucideIconPicker`
// (popover z katalogiem ikon - ma własne testy przy edytorach, które go
// używają). Z pickera zostaje tylko to, co panel robi z wynikiem: zapis klucza
// `icon` pozycji. Słownik jest PRAWDZIWY.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { InteractiveCircleEditor } from "../InteractiveCircleEditor";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("../../../molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <span data-testid="ikona" data-value={value}>
      <button type="button" onClick={() => onChange("Heart")}>
        wybierz ikonę
      </button>
      <button type="button" onClick={() => onChange(undefined)}>
        wyczyść ikonę
      </button>
    </span>
  ),
}));

type Content = WidgetNode["content"];
type Row = Record<string, Json>;

function renderEditor(initial: Content, lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <InteractiveCircleEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = render(<Host />);
  const last = (key: string): Json | undefined => written.filter(([k]) => k === key).at(-1)?.[1];
  const items = (): Row[] => (last("items") ?? []) as Row[];
  return { ...view, written, last, items };
}

function fieldsUnder(label: string): Array<HTMLInputElement & HTMLSelectElement> {
  return screen.getAllByText(label, { selector: "label" }).map((node) => {
    const field = node.parentElement?.querySelector("input, textarea, select");
    if (!field) throw new Error(`test: brak pola pod etykietą „${label}"`);
    return field as HTMLInputElement & HTMLSelectElement;
  });
}
const fieldUnder = (label: string, index = 0) => {
  const field = fieldsUnder(label)[index];
  if (!field) throw new Error(`test: brak pola #${index} pod etykietą „${label}"`);
  return field;
};
const optionValues = (select: HTMLSelectElement) =>
  Array.from(select.options).map((option) => option.value);

const addButton = () => screen.getByRole("button", { name: /Dodaj/ });

afterEach(cleanup);

describe("InteractiveCircleEditor - listy zgodne z rendererem", () => {
  it("brak układu = półokrąg: lista animacji NIE oferuje obrotu", () => {
    renderEditor({});
    expect(fieldUnder("Układ").value).toBe("semi");
    expect(optionValues(fieldUnder("Animacja łuku"))).toEqual(["none", "pulse"]);
  });

  it("pełne koło oferuje obrót i pokazuje go jako wybrany", () => {
    renderEditor({ layout: "full", animation: "rotate" });
    const animation = fieldUnder("Animacja łuku");
    expect(optionValues(animation)).toEqual(["none", "rotate", "pulse"]);
    expect(animation.value).toBe("rotate");
  });

  it("półokrąg z zapisanym obrotem: bez opcji obrotu, wybrane „brak” - renderer go nie obraca", () => {
    renderEditor({ layout: "semi", animation: "rotate" });
    const animation = fieldUnder("Animacja łuku");
    expect(optionValues(animation)).toEqual(["none", "pulse"]);
    expect(animation.value).toBe("none");
  });

  it("przełączenie półokręgu na pełne koło odsłania opcję obrotu", () => {
    const { last } = renderEditor({});
    fireEvent.change(fieldUnder("Układ"), { target: { value: "full" } });
    expect(last("layout")).toBe("full");
    expect(optionValues(fieldUnder("Animacja łuku"))).toContain("rotate");
  });

  it.each([
    ["Układ", "layout", "full"],
    ["Aktywacja", "trigger", "click"],
    ["Animacja łuku", "animation", "pulse"],
    ["Autoodtwarzanie", "autoplay", "on"],
  ])("lista „%s” zapisuje wybraną opcję pod kluczem %s", (label, key, value) => {
    const { last } = renderEditor({ layout: "full" });
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(last(key)).toBe(value);
  });
});

describe("InteractiveCircleEditor - pola liczbowe", () => {
  it.each([
    ["Średnica (px)", "size", "640", 640, 480],
    ["Rozmiar pozycji (px)", "itemSize", "90", 90, 72],
    ["Grubość łuku (px)", "circleThickness", "4", 4, 2],
    ["Skala aktywnej", "activeScale", "1.3", 1.3, 1.15],
    ["Interwał (ms)", "intervalMs", "6000", 6000, 4000],
  ])(
    "„%s” zapisuje liczbę, a pustka lub zero wraca do wartości domyślnej renderera",
    (label, key, typed, expected, fallback) => {
      const { last } = renderEditor({});
      const field = fieldUnder(label);
      expect(field.value).toBe(String(fallback));
      fireEvent.change(field, { target: { value: typed } });
      expect(last(key)).toBe(expected);
      fireEvent.change(field, { target: { value: "" } });
      expect(last(key)).toBe(fallback);
      fireEvent.change(field, { target: { value: "0" } });
      expect(last(key)).toBe(fallback);
    },
  );

  it("liczba zapisana napisem w treści nie jest liczbą - pole pokazuje wartość domyślną", () => {
    // Renderer czyta liczby przez `getNum` (tylko typ number) - panel musi
    // pokazać to samo, co rysuje kanwa, a nie napis z dokumentu.
    renderEditor({ size: "700" as unknown as Json });
    expect(fieldUnder("Średnica (px)").value).toBe("480");
  });
});

describe("InteractiveCircleEditor - kolory i tekst nad kołem", () => {
  it.each([
    ["Kolor łuku", "circleColor"],
    ["Tło pozycji", "itemBg"],
    ["Kolor pozycji", "itemColor"],
    ["Tło aktywne", "activeBg"],
    ["Kolor aktywny", "activeColor"],
  ])("„%s” zapisuje kolor, a wyczyszczony - PUSTY napis", (label, key) => {
    const { last } = renderEditor({ [key]: "#101010" });
    const field = fieldUnder(label);
    expect(field.value).toBe("#101010");
    fireEvent.change(field, { target: { value: "#7c3aed" } });
    expect(last(key)).toBe("#7c3aed");
    fireEvent.change(field, { target: { value: "" } });
    expect(last(key)).toBe("");
  });

  it("nagłówek i opis nad kołem zapisują się pod kluczami edytowanej wersji językowej", () => {
    const { last } = renderEditor({ title_pl: "Tytuł PL" }, "en");
    expect(screen.getByText("Nagłówek i wstęp nad kołem (EN)")).toBeTruthy();
    expect(fieldUnder("Nagłówek").value).toBe("");
    fireEvent.change(fieldUnder("Nagłówek"), { target: { value: "Our model" } });
    fireEvent.change(fieldUnder("Opis"), { target: { value: "Four steps" } });
    expect(last("title_en")).toBe("Our model");
    expect(last("desc_en")).toBe("Four steps");
    expect(last("title_pl")).toBeUndefined();
  });
});

describe("InteractiveCircleEditor - lista pozycji", () => {
  const item = (n: number): Row => ({
    icon: "Star",
    label_pl: `Etap ${n}`,
    label_en: `Step ${n}`,
    title_pl: `Tytuł ${n}`,
    title_en: `Title ${n}`,
    desc_pl: "",
    desc_en: "",
    href: "",
  });

  it("dodanie seeduje pełną pozycję z numerem w etykiecie", () => {
    const { items } = renderEditor({ items: [item(1)] });
    fireEvent.click(addButton());
    expect(items()).toHaveLength(2);
    expect(items()[1]).toEqual({
      icon: "Star",
      label_pl: "Pozycja 2",
      label_en: "Item 2",
      title_pl: "Pozycja 2",
      title_en: "Item 2",
      desc_pl: "",
      desc_en: "",
      href: "",
    });
  });

  it("przy ośmiu pozycjach dodanie niczego nie zapisuje - renderer rysuje najwyżej 8", () => {
    const { written } = renderEditor({ items: Array.from({ length: 8 }, (_, i) => item(i + 1)) });
    fireEvent.click(addButton());
    expect(written).toEqual([]);
  });

  it("pola pozycji zapisują się w TEJ pozycji i w edytowanej wersji językowej", () => {
    const { items } = renderEditor({ items: [item(1), item(2)] }, "en");
    fireEvent.change(fieldUnder("Etykieta (EN)", 1), { target: { value: "Plan" } });
    fireEvent.change(fieldUnder("Tytuł w środku (EN)", 1), { target: { value: "Planning" } });
    fireEvent.change(fieldUnder("Opis (EN)", 1), { target: { value: "We plan." } });
    fireEvent.change(fieldUnder("Link (opcjonalny)", 1), { target: { value: "/plan" } });
    const [first, second] = items();
    expect(first).toEqual(item(1));
    expect(second).toMatchObject({
      label_en: "Plan",
      title_en: "Planning",
      desc_en: "We plan.",
      href: "/plan",
      label_pl: "Etap 2",
    });
  });

  it("wybór i wyczyszczenie ikony zapisują nazwę albo PUSTY napis", () => {
    const { items } = renderEditor({ items: [item(1)] });
    expect(screen.getByTestId("ikona").getAttribute("data-value")).toBe("Star");
    fireEvent.click(screen.getByRole("button", { name: "wybierz ikonę" }));
    expect(items()[0]?.icon).toBe("Heart");
    fireEvent.click(screen.getByRole("button", { name: "wyczyść ikonę" }));
    expect(items()[0]?.icon).toBe("");
  });

  it("tytuł ramki: numer i etykieta wersji, z zapasem na polską i na kreskę", () => {
    renderEditor(
      {
        items: [item(1), { ...item(2), label_en: "" }, { label_pl: "", label_en: "" }],
      },
      "en",
    );
    expect(screen.getByText("#1 · Step 1")).toBeTruthy();
    expect(screen.getByText("#2 · Etap 2")).toBeTruthy();
    expect(screen.getByText("#3 · -")).toBeTruthy();
  });

  it("usunięcie pozycji zostawia pozostałe w tej samej kolejności", () => {
    const { items } = renderEditor({ items: [item(1), item(2), item(3)] });
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń" })[1]!);
    expect(items().map((row) => row.label_pl)).toEqual(["Etap 1", "Etap 3"]);
  });
});
