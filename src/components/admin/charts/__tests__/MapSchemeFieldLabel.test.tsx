// POLE SCHEMATU BARW MAPY W PANELU BUILDERA - etykieta RAZ.
//
// `PropField` rysuje etykietę pola, a wybór skali (`MapScalePicker`)
// rysował nad grupą radiową drugi raz ten sam napis - „Schemat barw" stało
// w panelu dwa razy. Teraz grupa bierze nazwę dostępną z etykiety pola
// (`labelledBy`), a sam wybór w bloku CMS dalej ma własny napis.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/lib/i18n-map-editor";
import type { SchemaField } from "@/lib/builder/schemas";
import { MAP_SCHEME_OPTIONS } from "@/lib/builder/dataVizSchemas/shared";
import { SchemaFieldControl } from "@/components/admin/builder/ui/molecules/SchemaFieldControl";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";
import { MapScalePicker } from "../MapScalePicker";

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

describe("etykieta pola schematu", () => {
  it("panel buildera: napis stoi raz, a grupa radiowa ma z niego nazwę", () => {
    renderWithQueryClient(
      <SchemaFieldControl
        field={POLE}
        lang="pl"
        content={{ region: "europe", data: "PL; 1\nDE; 2" }}
        setContent={() => undefined}
        setContentPatch={() => undefined}
      />,
    );
    expect(screen.getAllByText("Schemat barw")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: "Schemat barw" })).toBeInTheDocument();
  });

  it("blok CMS (bez etykiety z zewnątrz): wybór ma własny napis", () => {
    render(
      <MapScalePicker
        value={{ scheme: "blue", classes: 5, method: "quantile", midpoint: null }}
        onChange={() => undefined}
        values={[1, 2, 3]}
        showNoData={false}
        unit=""
        docLang="pl"
        lang="pl"
      />,
    );
    expect(screen.getAllByText("Schemat barw")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: "Schemat barw" })).toBeInTheDocument();
  });
});
