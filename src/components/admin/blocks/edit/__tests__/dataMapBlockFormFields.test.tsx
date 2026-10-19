// EDYTOR BLOKU MAPY DANYCH - IMPORT Z PLIKU, LEGENDA „BRAK DANYCH" I POLA
// USTAWIEŃ.
//
// PO CO OSOBNY PLIK. `dataMapBlock.test.tsx` dowodzi siatki, wklejki, skali
// barw i odniesień. Poza nim zostały trzy zachowania bez żadnego dowodu:
//  * IMPORT Z PLIKU zastępuje dane mapy - nazwy krajów rozwiązuje skorowidz
//    z TEGO SAMEGO zasobu geometrii, który rysuje mapę, a zapis idzie dopiero
//    po „Zastosuj", jednym `onChange`,
//  * pozycja „brak danych" w podglądzie legendy zależy od krajów regionu:
//    przed wczytaniem zasobu edytor zakłada, że jakiś kraj jest bez wartości,
//    a po wczytaniu - liczy to z geometrii. Mapa, w której KAŻDY kraj ma
//    wartość, nie może obiecywać w legendzie kreskowania, którego nie ma,
//  * region, jednostka, tytuł, opis, źródło i dwa przełączniki zapisują się
//    pod swoimi kluczami, a tekst-OBIEKT nie wchodzi do pola ani do podglądu
//    jako „[object Object]".
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli edytorów, dlatego jego
// import jest PIERWSZY. Zasób geometrii serwuje `installWidgetGateFetch`
// z `public/geo` - ten sam plik, który dostaje przeglądarka; lista krajów
// regionu jest czytana z niego, a nie przepisana do testu, żeby nowa wersja
// zasobu nie rozjechała się z oczekiwaniem.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { GEO_ASSET_URL } from "@/lib/charts/types";
import { dispatchBlockTablePaste } from "@/components/admin/charts/blockTablePaste";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";
import { DataMapBlock } from "../DataVizBlocks";

installWidgetGateFetch();

const ID = "blk-map-form";

function mapa(data: Record<string, Json> = {}): Block {
  return {
    id: ID,
    type: "data-map",
    data: { region: "europe", animate: false, values: [{ id: "PL", value: 12 }], ...data },
  };
}

function ostatnie(changes: readonly Block[]): Record<string, Json> {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: ID, type: "data-map" });
  return zapis.data;
}

/** Kody krajów regionu - z zasobu geometrii, który rysuje mapę. */
function krajeRegionu(region: keyof typeof GEO_ASSET_URL): string[] {
  const plik = resolve("public", GEO_ASSET_URL[region].slice(1));
  const zasob = JSON.parse(readFileSync(plik, "utf8")) as { countries: { id: string }[] };
  return zasob.countries.map((c) => c.id);
}

/** Grupa „Skala barw" - podgląd legendy edytora, nie legenda samej mapy. */
function grupaSkali(): HTMLElement {
  const podpis = screen.getByText("Skala barw");
  if (!podpis.parentElement) throw new Error("brak grupy skali barw");
  return podpis.parentElement;
}

describe("import z pliku", () => {
  it("nazwy krajów z pliku stają się kodami ISO, a dane wymieniają się JEDNYM zapisem po „Zastosuj”", async () => {
    const { container, changes } = renderEditor(DataMapBlock, mapa({ title: "Eksport" }));
    const plik = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!plik) throw new Error("brak pola pliku");
    fireEvent.change(plik, {
      target: { files: [new File(["Kraj;Wartość\nPolska;5\nFrancja;7,5"], "mapa.csv")] },
    });
    const okno = await screen.findByRole("dialog", { name: "Import tabeli z pliku" });
    expect(changes).toHaveLength(0);
    fireEvent.click(within(okno).getByRole("button", { name: "Zastosuj" }));
    expect(changes).toHaveLength(1);
    const data = ostatnie(changes);
    expect(data.title).toBe("Eksport");
    expect(data.values).toEqual([
      { id: "PL", value: 5 },
      { id: "FR", value: 7.5 },
    ]);
  });
});

describe("wklejka i źródła", () => {
  it("OBCIĘTA tabela wklejona na kanwie otwiera podgląd ze zgłoszeniem obcięcia", () => {
    renderEditor(DataMapBlock, mapa());
    act(() => {
      dispatchBlockTablePaste(ID, {
        rows: [
          ["Kraj", "Wartość"],
          ["PL", "1"],
        ],
        source: "tsv",
        cells: 4,
        truncated: true,
      });
    });
    const okno = screen.getByRole("dialog", { name: "Wklejanie tabeli" });
    expect(
      within(okno).getByText("Wklejone dane przekraczają limit - wczytano tylko ich początek."),
    ).toBeInTheDocument();
  });

  it("usunięcie ostatniego źródła mapy USUWA klucz `sources` jednym zapisem", () => {
    // Mapa nie ma pasma optimum, więc usunięcie źródła nie dokłada do zapisu
    // żadnych innych zmian - zostają wartości i reszta treści.
    const { changes } = renderEditor(
      DataMapBlock,
      mapa({ sources: [{ id: "s1", title: "Eurostat" }] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Usuń źródło Eurostat" }));
    expect(changes).toHaveLength(1);
    const data = ostatnie(changes);
    expect("sources" in data).toBe(false);
    expect(data.values).toEqual([{ id: "PL", value: 12 }]);
  });
});

describe("legenda „brak danych” liczona z krajów regionu", () => {
  it("region, w którym KAŻDY kraj ma wartość, traci „brak danych” po wczytaniu geometrii", async () => {
    const kody = krajeRegionu("south-america");
    const values = kody.map((id, i) => ({ id, value: i + 1 }));
    renderEditor(DataMapBlock, mapa({ region: "south-america", classes: 5, values }));
    // Przed wczytaniem zasobu edytor zakłada kraj bez wartości - tak samo
    // robi legenda mapy, więc oba podglądy mówią to samo.
    expect(within(grupaSkali()).getByText(/brak danych/)).toBeInTheDocument();
    await waitFor(() => expect(within(grupaSkali()).queryByText(/brak danych/)).toBeNull());
  });

  it("region z krajem BEZ wartości zachowuje „brak danych” także po wczytaniu geometrii", async () => {
    // Pierwszy kraj regionu zostaje bez wartości.
    const [, ...reszta] = krajeRegionu("south-america");
    const values = reszta.map((id, i) => ({ id, value: i + 1 }));
    renderEditor(DataMapBlock, mapa({ region: "south-america", classes: 5, values }));
    // Wczytany zasób widać po krajach narysowanych z wartością.
    await screen.findAllByRole("img", { name: /: \d/ });
    expect(within(grupaSkali()).getByText(/brak danych/)).toBeInTheDocument();
  });
});

describe("pola ustawień mapy", () => {
  it("region zapisuje się pod `region`, zachowując wartości", () => {
    const { changes } = renderEditor(DataMapBlock, mapa());
    const region = screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .find((el) => Array.from(el.options).some((o) => o.value === "south-america"));
    if (!region) throw new Error("brak listy regionów");
    expect(region.value).toBe("europe");
    fireEvent.change(region, { target: { value: "world" } });
    expect(ostatnie(changes)).toMatchObject({ region: "world", values: [{ id: "PL", value: 12 }] });
  });

  it.each([
    ["Jednostka (np. %, mln)", "unit"],
    ["Tytuł mapy", "title"],
    ["Opis (podtytuł)", "description"],
    ["Źródło danych", "source"],
  ])("pole „%s” zapisuje się pod `%s`", (placeholder, klucz) => {
    const { changes } = renderEditor(DataMapBlock, mapa());
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "wpis" } });
    expect(changes).toHaveLength(1);
    expect(ostatnie(changes)).toEqual({ ...mapa().data, [klucz]: "wpis" });
  });

  it("legenda i animacja są domyślnie WŁĄCZONE, a odznaczenie zapisuje `false`", () => {
    const { changes } = renderEditor(DataMapBlock, {
      id: ID,
      type: "data-map",
      data: { region: "europe", values: [] },
    });
    for (const [nazwa, klucz] of [
      ["Legenda", "showLegend"],
      ["Animacja wejścia", "animate"],
    ] as const) {
      const box = screen.getByRole<HTMLInputElement>("checkbox", { name: nazwa });
      expect(box.checked, nazwa).toBe(true);
      fireEvent.click(box);
      expect(ostatnie(changes)[klucz], nazwa).toBe(false);
    }
  });

  it("tytuł-OBIEKT nie wchodzi ani do pola, ani do podglądu jako „[object Object]”", () => {
    const { container } = renderEditor(DataMapBlock, mapa({ title: { pl: "Mapa" }, unit: ["%"] }));
    expect(screen.getByPlaceholderText<HTMLInputElement>("Tytuł mapy").value).toBe("");
    expect(screen.getByPlaceholderText<HTMLInputElement>("Jednostka (np. %, mln)").value).toBe("");
    expect(container.textContent).not.toContain("[object Object]");
  });
});
