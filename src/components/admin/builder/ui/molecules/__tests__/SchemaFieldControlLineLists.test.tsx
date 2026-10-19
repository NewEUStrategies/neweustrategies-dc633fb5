// Pole schematu: LISTY „jedna pozycja na linię" (`stringArray`,
// `i18nStringArray`) PISANE Z KLAWIATURY oraz pole danych mapy.
//
// NAPRAWIONE 2026-10-18: pole pokazywało `lista.join("\n")`, a każda zmiana
// zapisywała listę już znormalizowaną (przycięte pozycje, bez pustych linii).
// Kontrolowany `<textarea>` wracał więc do znormalizowanej listy, zanim
// redaktor napisał następny znak: Enter na końcu i spacja na końcu linii
// znikały. Drugiej pozycji („raz" + Enter + „dwa" dawało „razdwa") ani pozycji
// z dwóch słów („Nowy" + spacja + „raport" -> „Nowyraport") nie dało się
// wpisać, tylko wkleić. Pole używa teraz wspólnego atomu `LineListTextarea`,
// który trzyma szkic tak długo, jak znaczy on to samo co dokument.
//
// Testy piszą ZNAK PO ZNAKU względem tego, co pole aktualnie POKAZUJE - tak
// jak klawiatura - a gospodarz oddaje zapis jako nową treść (jak panel).
// Atrapy: słownik (`i18nStub`) i `MapDataField` (pole mapy ma własne testy;
// tu liczy się, co pole schematu mu przekazuje i co zapisuje z jego zmian).
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch, SchemaField } from "@/lib/builder/schemas";
import { SchemaFieldControl } from "../SchemaFieldControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("../MapDataField", () => ({
  MapDataField: ({
    value,
    onChange,
    region,
    placeholder,
    setContentPatch,
  }: {
    value: string;
    onChange: (v: string) => void;
    region: string;
    placeholder?: string;
    setContentPatch?: (patch: ContentPatch) => void;
  }) => (
    <div>
      <textarea
        aria-label="dane mapy"
        data-region={region}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={() => setContentPatch?.({ data: "PL; 1", scheme: undefined })}>
        łatka arkusza
      </button>
    </div>
  ),
}));

type Written = Array<[string, Json]>;

function renderLive(
  field: SchemaField,
  initial: Record<string, unknown>,
  lang: "pl" | "en" = "pl",
) {
  const written: Written = [];
  function Host() {
    const [content, setContent] = useState(initial);
    return (
      <SchemaFieldControl
        field={field}
        lang={lang}
        content={content}
        setContent={(key, value) => {
          written.push([key, value]);
          setContent((prev) => ({ ...prev, [key]: value }));
        }}
      />
    );
  }
  render(<Host />);
  return { written };
}

/** Pisanie z klawiatury: każdy znak dopisany do tego, co pole POKAZUJE. */
function type(area: HTMLTextAreaElement, text: string): void {
  for (const ch of text) fireEvent.change(area, { target: { value: area.value + ch } });
}

const TAGS: SchemaField = { key: "tags", type: "stringArray", label: "Tagi" };
const ITEMS: SchemaField = { key: "items", type: "i18nStringArray", label: "Punkty" };

describe("SchemaFieldControl - lista pisana z klawiatury", () => {
  it("Enter na końcu otwiera nową pozycję zamiast zniknąć", () => {
    const { written } = renderLive(TAGS, { tags: ["raz"] });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    type(area, "\ndwa");
    expect(written.at(-1)).toEqual(["tags", ["raz", "dwa"]]);
    expect(area.value).toBe("raz\ndwa");
  });

  it("spacja między słowami przeżywa zapis", () => {
    const { written } = renderLive(ITEMS, { items_pl: [] });
    const area = screen.getByLabelText("Punkty (PL)") as HTMLTextAreaElement;
    type(area, "Nowy raport");
    expect(written.at(-1)).toEqual(["items_pl", ["Nowy raport"]]);
  });

  it("znak, który nie zmienia listy (Enter, spacja na końcu), nie jest zapisem", () => {
    const { written } = renderLive(TAGS, { tags: ["raz"] });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    type(area, " \n");
    // Sam szkic - bez kroku historii, a pole dalej pokazuje to, co wpisano.
    expect(written).toEqual([]);
    expect(area.value).toBe("raz \n");
  });

  it("puste linie i spacje dalej wypadają z ZAPISU", () => {
    const { written } = renderLive(TAGS, { tags: [] });
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: " x \n\n y \n" } });
    expect(written.at(-1)).toEqual(["tags", ["x", "y"]]);
  });
});

describe("SchemaFieldControl - dane mapy", () => {
  const MAP: SchemaField = { key: "data", type: "mapData", label: "Dane" };

  it("przekazuje dane i region z treści, a zmianę zapisuje pod kluczem pola", () => {
    const { written } = renderLive(MAP, { data: "PL; 3", region: "europe" });
    const area = screen.getByLabelText("dane mapy") as HTMLTextAreaElement;
    expect(area.value).toBe("PL; 3");
    expect(area.getAttribute("data-region")).toBe("europe");
    expect(area.getAttribute("placeholder")).toBe("builder.schemaField.mapDataPlaceholder");
    fireEvent.change(area, { target: { value: "PL; 4" } });
    expect(written).toEqual([["data", "PL; 4"]]);
  });

  it("nieznany region z treści spada na region domyślny parsera", () => {
    renderLive(MAP, { data: "", region: "atlantyda" });
    expect(screen.getByLabelText("dane mapy").getAttribute("data-region")).not.toBe("atlantyda");
  });

  it("bez historii buildera łatka idzie kluczami, a usunięcie zapisuje null", () => {
    const { written } = renderLive(MAP, { data: "", scheme: "blue" });
    fireEvent.click(screen.getByRole("button", { name: "łatka arkusza" }));
    expect(written).toEqual([
      ["data", "PL; 1"],
      ["scheme", null],
    ]);
  });
});
