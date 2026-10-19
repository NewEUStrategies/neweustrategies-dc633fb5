// InteractiveCircleEditor: pola liczbowe pokazują i zapisują to, co RYSUJE
// renderer (`InteractiveCircleWidget` domyka każdą liczbę do własnego zakresu).
//
// Defekt przypięty tutaj: pole zapisywało `Number(v) || domyślna` bez klamry,
// a renderer klampował - panel mógł pokazywać średnicę 5000, kanwa rysowała
// 900. Do tego wyczyszczenie pola w trakcie pisania od razu wstawiało wartość
// domyślną, więc wielocyfrowej liczby nie dało się wpisać od zera.
//
// Pola idą przez wspólny atom `ClampedNumberInput`: szkic lokalny, zapis
// w locie tylko dla wartości w zakresie, klamra przy opuszczeniu pola / Enter.
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
  LucideIconPicker: () => <span data-testid="ikona" />,
}));

type Content = WidgetNode["content"];

function renderEditor(initial: Content) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <InteractiveCircleEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  render(<Host />);
  const writesOf = (key: string): Json[] => written.filter(([k]) => k === key).map(([, v]) => v);
  return { written, writesOf };
}

/** Pole spod etykiety `PropField` (etykieta i kontrolka są rodzeństwem). */
function field(label: string): HTMLInputElement {
  const box = screen.getByText(label, { selector: "label" }).parentElement;
  const input = box?.querySelector("input");
  if (!input) throw new Error(`test: brak pola pod etykietą „${label}"`);
  return input;
}

afterEach(cleanup);

describe("InteractiveCircleEditor - zakresy z renderera", () => {
  it.each([
    // [etykieta, klucz, zapis w dokumencie, co rysuje renderer]
    ["Średnica (px)", "size", 5000, "900"],
    ["Średnica (px)", "size", 100, "280"],
    ["Rozmiar pozycji (px)", "itemSize", 300, "140"],
    ["Grubość łuku (px)", "circleThickness", 20, "8"],
    ["Skala aktywnej", "activeScale", 3, "1.6"],
    ["Interwał (ms)", "intervalMs", 500, "1500"],
  ])(
    "„%s”: zapis %s=%s pokazuje %s, jak kanwa - bez zapisu przy renderze",
    (label, key, stored, drawn) => {
      const { written } = renderEditor({ [key]: stored });
      expect(field(label).value).toBe(drawn);
      expect(written).toEqual([]);
    },
  );

  it("wpis spoza zakresu nie trafia do dokumentu w trakcie pisania, a przy wyjściu z pola - domknięty", () => {
    const { writesOf } = renderEditor({ size: 480 });
    const diameter = field("Średnica (px)");
    fireEvent.focus(diameter);
    fireEvent.change(diameter, { target: { value: "5000" } });
    expect(diameter.value).toBe("5000");
    expect(writesOf("size")).toEqual([]);
    fireEvent.blur(diameter);
    expect(writesOf("size")).toEqual([900]);
    expect(diameter.value).toBe("900");
  });

  it("wyczyszczenie pola nie wstawia wartości domyślnej - da się wpisać liczbę od zera", () => {
    const { writesOf } = renderEditor({ intervalMs: 6000 });
    const interval = field("Interwał (ms)");
    fireEvent.focus(interval);
    fireEvent.change(interval, { target: { value: "" } });
    expect(interval.value).toBe("");
    for (const typed of ["8", "80", "800", "8000"]) {
      fireEvent.change(interval, { target: { value: typed } });
      expect(interval.value).toBe(typed);
    }
    // „8", „80" i „800" są poniżej 1500 ms - tylko pełna liczba jest zapisem.
    expect(writesOf("intervalMs")).toEqual([8000]);
  });

  it("pola liczbowe mają nazwę dostępną równą etykiecie i klawiaturę numeryczną", () => {
    renderEditor({});
    for (const name of [
      "Średnica (px)",
      "Rozmiar pozycji (px)",
      "Grubość łuku (px)",
      "Interwał (ms)",
    ]) {
      expect(screen.getByRole("textbox", { name }).getAttribute("inputmode")).toBe("numeric");
    }
    expect(screen.getByRole("textbox", { name: "Skala aktywnej" }).getAttribute("inputmode")).toBe(
      "decimal",
    );
  });

  it("skala aktywnej przyjmuje ułamek i zapisuje go w locie", () => {
    const { writesOf } = renderEditor({});
    const scale = field("Skala aktywnej");
    expect(scale.value).toBe("1.15");
    fireEvent.focus(scale);
    fireEvent.change(scale, { target: { value: "1.35" } });
    expect(writesOf("activeScale")).toEqual([1.35]);
  });
});
