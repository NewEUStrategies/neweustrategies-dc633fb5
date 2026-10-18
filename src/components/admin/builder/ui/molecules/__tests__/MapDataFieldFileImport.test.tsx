// Pole danych MAPY: import z pliku i zwykłe wklejenie tekstu.
//
// 1. Import z pliku ZASTĘPUJE pole wartościami „ISO2; liczba" - nazwy krajów
//    rozwiązuje skorowidz regionu („Polska" -> PL), a wiersze, których nie da
//    się przypisać do kraju, nie trafiają do danych, tylko do listy problemów
//    zwracanej importowi (redakcja widzi, co pominięto).
// 2. Wklejenie zwykłego tekstu (bez tabeli ze schowka arkusza) NIE jest
//    przechwytywane - przeglądarka wkleja je sama, pole nie pisze niczego
//    w imieniu redaktora.
//
// Atrapy: `DataImportControl` (czytanie pliku to jego kontrakt - tu łapiemy
// `onRows`, czyli to, co pole robi z wierszami) i Radix Select (wzorzec
// sąsiednich testów). Geometria Europy z `public/geo` trafia do cache zapytań,
// żeby skorowidz krajów był prawdziwy, a test nie sięgał do sieci.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import "@/lib/i18n-map-editor";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import type { GeoAsset } from "@/lib/charts/types";
import type { ImportProblem } from "@/lib/charts/importTable";
import type { TableLayout } from "@/components/admin/charts/tableLayout";
import { MapDataField } from "../MapDataField";

const importer = vi.hoisted(() => ({
  onRows: null as ((rows: string[][], layout?: TableLayout) => ImportProblem[]) | null,
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/admin/blocks/DataImportControl", () => ({
  DataImportControl: ({
    onRows,
  }: {
    onRows: (rows: string[][], layout?: TableLayout) => ImportProblem[];
  }) => {
    importer.onRows = onRows;
    return null;
  },
}));

const EUROPA = JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset;
const LAYOUT: TableLayout = { header: true, transpose: false, locale: "auto", valueColumn: 1 };

function mount(initial: string) {
  const onChange = vi.fn<(v: string) => void>();
  function Host() {
    const [data, setData] = useState(initial);
    return (
      <MapDataField
        value={data}
        onChange={(v) => {
          onChange(v);
          setData(v);
        }}
        region="europe"
        content={{ region: "europe", data }}
        lang="pl"
      />
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(geoAssetQueryOptions("europe").queryKey, EUROPA);
  const view = render(
    <QueryClientProvider client={qc}>
      <Host />
    </QueryClientProvider>,
  );
  const field = view.container.querySelector("textarea");
  if (field === null) throw new Error("test: brak pola danych");
  return { onChange, field };
}

function runImport(rows: string[][]): ImportProblem[] {
  const onRows = importer.onRows;
  if (!onRows) throw new Error("test: pole nie zamontowało importu");
  let problems: ImportProblem[] = [];
  act(() => {
    problems = onRows(rows, LAYOUT);
  });
  return problems;
}

describe("pole danych mapy - import z pliku", () => {
  it("zastępuje pole wartościami ISO2, nazwy krajów rozwiązuje skorowidz regionu", () => {
    const { onChange, field } = mount("FR; 1");
    const problems = runImport([
      ["Kraj", "Wartość"],
      ["Polska", "38"],
      ["DE", "84"],
    ]);
    expect(onChange).toHaveBeenLastCalledWith("PL; 38\nDE; 84");
    expect(field.value).toBe("PL; 38\nDE; 84");
    expect(problems).toEqual([]);
  });

  it("wiersz bez rozpoznanego kraju nie trafia do danych, tylko do problemów", () => {
    const { onChange } = mount("");
    const problems = runImport([
      ["Kraj", "Wartość"],
      ["Atlantyda", "5"],
      ["PL", "7"],
    ]);
    expect(onChange).toHaveBeenLastCalledWith("PL; 7");
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("pole danych mapy - pisanie i zwykłe wklejenie", () => {
  it("pisanie w polu oddaje surowy tekst bez normalizacji", () => {
    // Redaktor jest w trakcie pisania - „PL; 3" bez nowej linii na końcu
    // albo z niedokończonym kodem to stan przejściowy, którego pole nie
    // „poprawia" pod palcem.
    const { onChange, field } = mount("PL; 38");
    act(() => {
      field.focus();
    });
    fireEvent.change(field, { target: { value: "PL; 38\nD" } });
    expect(onChange).toHaveBeenLastCalledWith("PL; 38\nD");
  });

  it("tekst bez tabeli wkleja przeglądarka, pole niczego nie zapisuje", () => {
    const { onChange, field } = mount("PL; 38");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/html" ? "" : "DE; 84") },
    });
    act(() => {
      field.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
