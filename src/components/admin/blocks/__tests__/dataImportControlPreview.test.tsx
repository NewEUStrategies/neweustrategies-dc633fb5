// IMPORT Z PODGLĄDEM (`DataImportControl` z `preview`) - PR2.
//
// Plik ZASTĘPUJE całe dane, więc z polem `preview` kontrolka najpierw
// pokazuje podgląd układu, a wywołujący dostaje wiersze dopiero po
// „Zastosuj" - razem z wybranym układem. Problemy ODCZYTU (kodowanie
// zastępcze, obcięcie) stoją na jednej liście z problemami danych.
// Formaty pliku: lista rozszerzeń jest wspólna z procesem arkuszy.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { IMPORT_ACCEPT, type ImportProblem } from "@/lib/charts/importTable";
import { SPREADSHEET_IMPORT_EXTENSIONS } from "@/lib/files/spreadsheetProtocol";
import type { TableLayout } from "@/components/admin/charts/tableLayout";
import "@/lib/i18n-admin-blocks";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

function zamontuj(problems: ImportProblem[] = []) {
  const onRows = vi.fn<(rows: string[][], layout?: TableLayout) => ImportProblem[]>(() => problems);
  const { container } = render(<DataImportControl onRows={onRows} preview="chart" />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("brak pola pliku");
  return { onRows, input };
}

describe("DataImportControl - podgląd przed zastąpieniem danych", () => {
  it("plik otwiera podgląd, a wywołujący nie dostaje nic przed „Zastosuj”", async () => {
    const { onRows, input } = zamontuj();
    fireEvent.change(input, {
      target: { files: [new File([";Eksport;Import\n2021;120;80"], "dane.csv")] },
    });
    await screen.findByRole("dialog", { name: "Import tabeli z pliku" });
    expect(onRows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    expect(onRows).toHaveBeenCalledTimes(1);
    expect(onRows.mock.calls[0][0]).toEqual([
      ["", "Eksport", "Import"],
      ["2021", "120", "80"],
    ]);
    expect(onRows.mock.calls[0][1]).toMatchObject({ header: true, transpose: false });
    await screen.findByText("Wczytano dane z pliku.");
  });

  it("anulowanie podglądu nie woła wywołującego i nie ogłasza sukcesu", async () => {
    const { onRows, input } = zamontuj();
    fireEvent.change(input, { target: { files: [new File(["a;b\n1;2"], "d.csv")] } });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onRows).not.toHaveBeenCalled();
    expect(screen.queryByText("Wczytano dane z pliku.")).toBeNull();
  });

  it("problem odczytu (kodowanie zastępcze) stoi na liście razem z problemami danych", async () => {
    const { input } = zamontuj([{ code: "seriesTruncated", dropped: 2 }]);
    // „Łódź" w Windows-1250 - bajty, które nie są poprawnym UTF-8.
    const bajty = new Uint8Array([0x3b, 0x41, 0x0a, 0xa3, 0xf3, 0x64, 0x9f, 0x3b, 0x31]);
    fireEvent.change(input, { target: { files: [new File([bajty], "cp1250.csv")] } });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    await screen.findByText(/odczytano go jako Windows-1250/);
    expect(screen.getByText("Pominięto 2 serii ponad limit.")).toBeInTheDocument();
  });
});

describe("DataImportControl - formaty pliku", () => {
  it("pole pliku przyjmuje wszystkie formaty procesu arkuszy oraz csv, tsv i txt", () => {
    for (const ext of [...SPREADSHEET_IMPORT_EXTENSIONS, "csv", "tsv", "txt"]) {
      expect(IMPORT_ACCEPT.split(","), ext).toContain(`.${ext}`);
    }
    for (const ext of [
      "xlsx",
      "xlsm",
      "xlsb",
      "xltx",
      "xltm",
      "xls",
      "ods",
      "fods",
      "html",
      "htm",
    ]) {
      expect(SPREADSHEET_IMPORT_EXTENSIONS as readonly string[], ext).toContain(ext);
    }
  });
});
