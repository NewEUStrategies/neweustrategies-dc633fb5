// POLA WYKRESU W PANELU BUILDERA (`chartSeriesColors`, `chartAccent`) -
// PRZEWÓD łatki od panelu do komponentu pola.
//
// Typy pól istnieją od P0a. `SchemaFieldControl` kieruje je do własnych
// komponentów (`src/components/admin/charts/*`), więc ten plik pilnuje, że
// `setContentPatch` dojeżdża do komponentu pola, a bez niego (wołający bez
// historii) kontrolka składa łatkę z kolejnych `setContent`.
//
// Przypadki ZAŚLEPEK P0a (pole tekstowe napisu slotów i pole liczby indeksu)
// zniknęły razem z zaślepkami: pełne komponenty (W5) mają własne testy
// w `ChartColorFields.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch, SchemaField, SchemaFieldEditorProps } from "@/lib/builder/schemas";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

type Written = Array<[string, Json]>;

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
