// POLE SCHEMATU BARW MAPY W PANELU BUILDERA (`mapScheme`).
//
// Do P0a była to zaślepka (lista wyboru); teraz pole renderuje ten sam wybór
// co blok CMS (`MapScalePicker`): grupę radiową z próbkami i nazwami
// kanonicznymi oraz mini-legendę na danych widgetu. Pole zapisuje WYŁĄCZNIE
// klucz schematu - liczba klas, metoda i środek skali są osobnymi polami
// schematu panelu, a legenda tylko je czyta. Przypadki zaślepki zostały
// zastąpione razem z nią (zapowiedź w jej nagłówku).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import "@/lib/i18n-map-editor";
import type { Json } from "@/lib/builder/types";
import type { SchemaField } from "@/lib/builder/schemas";
import { MAP_SCHEME_OPTIONS } from "@/lib/builder/dataVizSchemas/shared";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";

installWidgetGateFetch();

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

const POLE: SchemaField = {
  key: "scheme",
  type: "mapScheme",
  label: "Schemat barw",
  options: MAP_SCHEME_OPTIONS,
};

const DANE = "PL; 1\nDE; 2\nFR; 3\nIT; 4\nES; 5\nCZ; 6";

function renderField(
  content: Record<string, unknown>,
  field: SchemaField = POLE,
  lang: "pl" | "en" = "pl",
) {
  const written: Array<[string, Json]> = [];
  const patches: unknown[] = [];
  const view = renderWithQueryClient(
    <SchemaFieldControl
      field={field}
      lang={lang}
      content={content}
      setContent={(key, value) => written.push([key, value])}
      setContentPatch={(p) => patches.push(p)}
    />,
  );
  return { written, patches, ...view };
}

describe("mapScheme - grupa radiowa schematów", () => {
  it("pusty zapis pokazuje schemat, który narysuje parser (niebieski)", () => {
    renderField({});
    const grupa = screen.getByRole("radiogroup", { name: "Schemat barw" });
    expect(within(grupa).getByRole("radio", { name: /niebieski/ })).toBeChecked();
  });

  it("nieznany zapis też (parser daje niebieski)", () => {
    renderField({ scheme: "Diverging" });
    expect(screen.getByRole("radio", { name: /niebieski/ })).toBeChecked();
  });

  it("wybór zapisuje sam klucz schematu - jednym `setContent`", () => {
    const { written, patches } = renderField({ scheme: "blue" });
    fireEvent.click(screen.getByRole("radio", { name: /łupkowy/ }));
    expect(written).toEqual([["scheme", "slate"]]);
    expect(patches).toEqual([]);
  });

  it("opcje pola zawężają wybór", () => {
    renderField({}, { ...POLE, options: MAP_SCHEME_OPTIONS.slice(0, 2) });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("panel angielski: nazwy kanoniczne po angielsku", () => {
    renderField({ scheme: "diverging" }, POLE, "en");
    expect(screen.getByRole("radio", { name: /Diverging \(decrease - increase\)/ })).toBeChecked();
  });

  it("liczba klas i środek skali NIE są tu kontrolkami - to osobne pola schematu", () => {
    renderField({ scheme: "diverging", classes: "5" });
    expect(screen.queryByRole("combobox", { name: "Liczba klas" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Środek skali/ })).toBeNull();
  });
});

describe("mapScheme - mini-legenda na danych widgetu", () => {
  it("pięć klas z pól `classes`/`method` - po wczytaniu zasobu regionu", async () => {
    const { container } = renderField({
      scheme: "blue",
      classes: "5",
      method: "quantile",
      data: DANE,
      unit: "%",
    });
    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-map-legend-preview] [data-map-class]")).toHaveLength(
        5,
      ),
    );
  });

  it("skala ciągła (brak `classes`) - gradient jak na opublikowanej mapie", () => {
    const { container } = renderField({ data: DANE });
    expect(container.querySelector(".neh-map-legend")?.getAttribute("data-scale")).toBe(
      "continuous",
    );
  });
});
