// POLA WYKRESU W PANELU BUILDERA - zaślepki P0a (`chartSeriesColors`,
// `chartAccent`).
//
// Typy pól istnieją od P0a, zanim edytor wykresu dostanie pełne kontrolki.
// `SchemaFieldControl` kieruje je do własnych komponentów
// (`src/components/admin/charts/*`), więc ten plik pilnuje dwóch rzeczy:
//   1. każdy typ rysuje DZIAŁAJĄCE pole związane z kluczem (czyta wartość
//      z treści i zapisuje pod `field.key`) - panel nie może pokazać pustki
//      nad ustawieniem, które schemat oferuje;
//   2. `setContentPatch` dojeżdża do komponentu pola, a bez niego (wołający
//      bez historii) kontrolka składa łatkę z kolejnych `setContent`.
// Pełny komponent zastępuje zaślepkę RAZEM z przypadkami punktu 1.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch, SchemaField, SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

type Written = Array<[string, Json]>;

function renderField(
  field: SchemaField,
  content: Record<string, unknown> = {},
  setContentPatch?: (patch: ContentPatch) => void,
) {
  const written: Written = [];
  render(
    <SchemaFieldControl
      field={field}
      lang="pl"
      content={content}
      setContent={(key, value) => written.push([key, value])}
      setContentPatch={setContentPatch}
    />,
  );
  return { written, last: () => written.at(-1) };
}

describe("chartSeriesColors - napis pozycyjny slotów", () => {
  const FIELD: SchemaField = { key: "seriesColors", type: "chartSeriesColors", label: "Kolory" };

  it("pokazuje zapisany napis i zapisuje wpis pod kluczem pola", () => {
    const { last } = renderField(FIELD, { seriesColors: "3;4;8" });
    const pole = screen.getByRole("textbox", { name: "Kolory" });
    expect((pole as HTMLInputElement).value).toBe("3;4;8");
    fireEvent.change(pole, { target: { value: "5;2" } });
    expect(last()).toEqual(["seriesColors", "5;2"]);
  });

  it("wartość spoza napisu pokazuje się jako pustka", () => {
    renderField(FIELD, { seriesColors: 7 });
    expect((screen.getByRole("textbox", { name: "Kolory" }) as HTMLInputElement).value).toBe("");
  });
});

describe("chartAccent - indeks liczony od zera", () => {
  const FIELD: SchemaField = { key: "accentSeries", type: "chartAccent", label: "Akcent" };

  it("zapisuje liczbę całkowitą, a pusty wpis jako null", () => {
    const { written } = renderField(FIELD, { accentSeries: 2 });
    const pole = screen.getByRole("spinbutton", { name: "Akcent" });
    expect((pole as HTMLInputElement).value).toBe("2");
    fireEvent.change(pole, { target: { value: "1" } });
    fireEvent.change(pole, { target: { value: "" } });
    expect(written).toEqual([
      ["accentSeries", 1],
      ["accentSeries", null],
    ]);
  });

  it("ułamek ani liczba ujemna nie trafiają do treści", () => {
    const { written } = renderField(FIELD, {});
    const pole = screen.getByRole("spinbutton", { name: "Akcent" });
    fireEvent.change(pole, { target: { value: "1.5" } });
    fireEvent.change(pole, { target: { value: "-1" } });
    expect(written).toEqual([]);
  });
});

describe("setContentPatch dojeżdża do komponentu pola", () => {
  it("komponent dostaje łatkę wołającego, a bez niej - złożenie z setContent", async () => {
    // Zaślepki nie wołają łatki same (zapisują jeden klucz), więc sprawdzamy
    // PROPSY, które dostają: atrapa komponentu woła łatkę po kliknięciu.
    vi.resetModules();
    vi.doMock("@/components/admin/charts/ChartAccentField", () => ({
      ChartAccentField: ({ setContentPatch }: SchemaFieldEditorProps) => (
        <button type="button" onClick={() => setContentPatch({ a: 1, b: undefined })}>
          łatka
        </button>
      ),
    }));
    const { SchemaFieldControl: Control } =
      await import("@/components/admin/builder/ui/molecules/SchemaFieldControl");
    const field: SchemaField = { key: "accentSeries", type: "chartAccent", label: "Akcent" };

    const patches: ContentPatch[] = [];
    const first = render(
      <Control
        field={field}
        lang="pl"
        content={{}}
        setContent={() => {}}
        setContentPatch={(p) => patches.push(p)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "łatka" }));
    expect(patches).toEqual([{ a: 1, b: undefined }]);
    first.unmount();

    const written: Written = [];
    render(
      <Control
        field={field}
        lang="pl"
        content={{}}
        setContent={(key, value) => written.push([key, value])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "łatka" }));
    // Bez historii: klucz po kluczu, a usunięcie zapisuje `null`.
    expect(written).toEqual([
      ["a", 1],
      ["b", null],
    ]);
    vi.doUnmock("@/components/admin/charts/ChartAccentField");
  });
});
