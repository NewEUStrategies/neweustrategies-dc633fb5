// IMPORT SKOROSZYTU PRZEZ PROCES ARKUSZY (`DataImportControl` + Web Worker).
//
// Pliki .xlsx/.ods czyta osobny proces (`lib/files/spreadsheetWorker`), a nie
// wątek strony. Ten plik dowodzi tego, co kontrolka robi z ODPOWIEDZIĄ procesu
// - bez atrapy własnych warstw (`readWorkbook`, parser, mapowanie problemów
// zostają prawdziwe):
//   * proces, który padł, kończy się komunikatem „Nie udało się przeczytać
//     pliku." - nie wiecznym kręciołkiem i nie pustym importem, a `onRows`
//     nie jest wołane. Na czas odczytu obszar ma `aria-busy`, po błędzie - nie,
//   * skoroszyt z kilkoma niepustymi arkuszami daje LISTĘ arkuszy, a wybór
//     oddaje wywołującemu wiersze WYBRANEGO arkusza; problem odczytu całego
//     pliku (arkusze ponad limit) stoi na liście razem z problemami danych,
//   * plik upuszczony mimo `accept` (np. .numbers) kończy się odmową ze
//     zdaniem, a nie ciszą, po której obszar wygląda na zepsuty; plik
//     poprawny upuszczony na obszar przechodzi tę samą drogę co wybrany oknem.
//
// GRANICA: `Worker` przeglądarki. happy-dom nie uruchamia procesów, więc test
// podstawia klasę, która przyjmuje `postMessage` i odpowiada tak, jak zrobiłby
// to proces (`onmessage` z `{ ok, result }` albo `onerror`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import type { ImportProblem } from "@/lib/charts/importTable";
import "@/lib/i18n-admin-blocks";

class ProcesArkuszy {
  static ostatni: ProcesArkuszy | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  zapytanie: unknown = null;
  zakonczony = false;
  constructor() {
    ProcesArkuszy.ostatni = this;
  }
  postMessage(zapytanie: unknown) {
    this.zapytanie = zapytanie;
  }
  terminate() {
    this.zakonczony = true;
  }
}

beforeEach(() => {
  ProcesArkuszy.ostatni = null;
  vi.stubGlobal("Worker", ProcesArkuszy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function zamontuj(problemy: ImportProblem[] = []) {
  const onRows = vi.fn<(rows: string[][]) => ImportProblem[]>(() => problemy);
  const view = render(<DataImportControl onRows={onRows} />);
  const pole = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!pole) throw new Error("brak pola pliku");
  const obszar = view.container.querySelector<HTMLElement>('[data-slot="upload-area"]');
  if (!obszar) throw new Error("brak obszaru wgrywania");
  return { ...view, onRows, pole, obszar };
}

/** Czeka, aż kontrolka przekaże plik procesowi, i oddaje ten proces. */
async function proces(): Promise<ProcesArkuszy> {
  await waitFor(() => expect(ProcesArkuszy.ostatni?.zapytanie).not.toBeNull());
  return ProcesArkuszy.ostatni!;
}

const ZESZYT = () => new File([new Uint8Array([0x50, 0x4b, 3, 4])], "zeszyt.xlsx");

describe("DataImportControl - proces arkuszy padł", () => {
  it("kończy się komunikatem o błędzie odczytu, a nie importem", async () => {
    const { onRows, pole, obszar } = zamontuj();
    fireEvent.change(pole, { target: { files: [ZESZYT()] } });
    const p = await proces();
    expect(p.zapytanie).toMatchObject({ op: "rows", chartImport: true });
    // Na czas odczytu obszar ogłasza zajętość.
    expect(obszar).toHaveAttribute("aria-busy", "true");

    await act(async () => p.onerror?.(new Event("error")));

    expect(await screen.findByText("Nie udało się przeczytać pliku.")).toBeInTheDocument();
    expect(obszar).not.toHaveAttribute("aria-busy");
    expect(p.zakonczony).toBe(true);
    expect(onRows).not.toHaveBeenCalled();
  });

  it("odpowiedź procesu z odmową (`ok: false`) daje ten sam komunikat", async () => {
    const { onRows, pole } = zamontuj();
    fireEvent.change(pole, { target: { files: [ZESZYT()] } });
    const p = await proces();
    await act(async () => p.onmessage?.(new MessageEvent("message", { data: { ok: false } })));
    expect(await screen.findByText("Nie udało się przeczytać pliku.")).toBeInTheDocument();
    expect(onRows).not.toHaveBeenCalled();
  });
});

describe("DataImportControl - skoroszyt z kilkoma arkuszami", () => {
  const ODPOWIEDZ = {
    ok: true,
    result: {
      sheets: [
        {
          name: "Eksport",
          rows: [
            ["Rok", "PL"],
            ["2021", 120],
          ],
          rowsDropped: 0,
          columnsDropped: 0,
        },
        { name: "Pusty", rows: [], rowsDropped: 0, columnsDropped: 0 },
        {
          name: "Przywóz",
          rows: [
            ["Rok", "DE"],
            ["2022", 80],
          ],
          rowsDropped: 0,
          columnsDropped: 0,
        },
      ],
      sheetsDropped: 2,
    },
  };

  it("pokazuje WYŁĄCZNIE niepuste arkusze i oddaje wiersze wybranego", async () => {
    const { onRows, pole } = zamontuj();
    fireEvent.change(pole, { target: { files: [ZESZYT()] } });
    const p = await proces();
    await act(async () => p.onmessage?.(new MessageEvent("message", { data: ODPOWIEDZ })));

    expect(await screen.findByRole("button", { name: /Przywóz/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eksport/ })).toBeInTheDocument();
    // Arkusz bez wierszy nie jest wyborem - nie dałby niczego do wczytania.
    expect(screen.queryByRole("button", { name: /Pusty/ })).toBeNull();
    // Dopóki redaktor nie wybierze arkusza, dane bloku stoją nietknięte.
    expect(onRows).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Przywóz/ }));
    expect(onRows).toHaveBeenCalledTimes(1);
    expect(onRows.mock.calls[0][0]).toEqual([
      ["Rok", "DE"],
      ["2022", "80"],
    ]);
    expect(screen.getByText("Wczytano dane z pliku.")).toBeInTheDocument();
  });

  it("problem odczytu całego pliku stoi na liście razem z problemami danych", async () => {
    const { pole } = zamontuj([{ code: "seriesTruncated", dropped: 3 }]);
    fireEvent.change(pole, { target: { files: [ZESZYT()] } });
    const p = await proces();
    await act(async () => p.onmessage?.(new MessageEvent("message", { data: ODPOWIEDZ })));
    fireEvent.click(await screen.findByRole("button", { name: /Eksport/ }));
    expect(screen.getByText("Pominięto 3 serii ponad limit.")).toBeInTheDocument();
    expect(
      screen.getByText("Skoroszyt ma więcej arkuszy niż limit - pominięto 2 ostatnich arkuszy."),
    ).toBeInTheDocument();
  });
});

describe("DataImportControl - upuszczenie pliku na obszar", () => {
  it("plik spoza `accept` kończy się odmową ze zdaniem, bez wołania wywołującego", () => {
    const { onRows, obszar } = zamontuj();
    const numbers = new File(["x"], "dane.numbers", { type: "application/x-iwork-numbers" });
    fireEvent.drop(obszar, { dataTransfer: { types: ["Files"], files: [numbers] } });
    expect(screen.getByText("Nie umiem przeczytać tego formatu.")).toBeInTheDocument();
    expect(onRows).not.toHaveBeenCalled();
    expect(ProcesArkuszy.ostatni).toBeNull();
  });

  it("poprawny CSV upuszczony na obszar trafia do wywołującego jak wybrany oknem", async () => {
    const { onRows, obszar } = zamontuj();
    const csv = new File([";Eksport\n2021;120"], "dane.csv", { type: "text/csv" });
    fireEvent.drop(obszar, { dataTransfer: { types: ["Files"], files: [csv] } });
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1));
    expect(onRows.mock.calls[0][0]).toEqual([
      ["", "Eksport"],
      ["2021", "120"],
    ]);
  });
});
