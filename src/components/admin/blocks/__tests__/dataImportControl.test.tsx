// PRZYCISK IMPORTU DANYCH (`DataImportControl`).
//
// Kontrolka jest wspólna dla edytora bloku (Gutenberg) i panelu widgetu
// (Elementor), więc jej zachowanie jest KONTRAKTEM dla obu powierzchni naraz.
// Broni się tu trzech rzeczy, z których każda jest realną drogą do cichego
// błędu w publikacji:
//
//  1. PROBLEMY SĄ WIDOCZNE. Wywołujący zwraca listę tego, co import pominął;
//     kontrolka MUSI ją wypisać. Import, który obcina serie i milczy, wygląda
//     dla redaktora dokładnie jak import udany.
//  2. ZŁY PLIK NIE UDAJE SUKCESU. Rozszerzenie spoza listy i plik ponad limit
//     kończą się komunikatem, a `onRows` nie jest wołane w ogóle.
//  3. TEN SAM PLIK DA SIĘ WCZYTAĆ DWA RAZY. Redaktor poprawia liczby w Excelu
//     i wybiera ten sam plik ponownie - bez zerowania `value` zdarzenie
//     `change` już nie wystrzeli i przycisk wygląda na zepsuty.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { IMPORT_MAX_BYTES, type ImportProblem } from "@/lib/charts/importTable";
import "@/lib/i18n-admin-blocks";

/** Plik tekstowy, który komponent przeczyta własnym parserem (bez `xlsx`). */
function csvFile(name: string, body: string): File {
  return new File([body], name, { type: "text/csv" });
}

function renderControl(problems: ImportProblem[] = []) {
  const onRows = vi.fn<(rows: string[][]) => ImportProblem[]>(() => problems);
  const { container } = render(<DataImportControl onRows={onRows} />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("brak pola pliku");
  return { onRows, input };
}

describe("DataImportControl - odczyt pliku", () => {
  it("czyta CSV i oddaje wiersze wywołującemu", async () => {
    const { onRows, input } = renderControl();
    fireEvent.change(input, {
      target: { files: [csvFile("dane.csv", ";Eksport;Import\n2021;120;80")] },
    });
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1));
    expect(onRows.mock.calls[0][0]).toEqual([
      ["", "Eksport", "Import"],
      ["2021", "120", "80"],
    ]);
  });

  it("po udanym imporcie mówi o tym wprost", async () => {
    const { input } = renderControl();
    fireEvent.change(input, { target: { files: [csvFile("d.csv", "a;b\n1;2")] } });
    await screen.findByText("Wczytano dane z pliku.");
  });

  it("WYPISUJE każdy problem zwrócony przez wywołującego", async () => {
    const { input } = renderControl([
      { code: "seriesTruncated", dropped: 3 },
      { code: "unknownCountries", labels: ["Atlantyda", "Wakanda"] },
    ]);
    fireEvent.change(input, { target: { files: [csvFile("d.csv", "a;b\n1;2")] } });
    // Liczba i lista muszą trafić do tekstu - komunikat ogólnikowy
    // („coś pominięto") nie pozwala redaktorowi zdecydować, czy to ważne.
    await screen.findByText("Pominięto 3 serii ponad limit.");
    expect(screen.getByText(/Atlantyda, Wakanda/)).toBeInTheDocument();
  });

  it("czyści `value` pola, żeby ten sam plik dało się wybrać ponownie", async () => {
    const { onRows, input } = renderControl();
    const plik = csvFile("dane.csv", "a;b\n1;2");
    fireEvent.change(input, { target: { files: [plik] } });
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [plik] } });
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(2));
  });
});

describe("DataImportControl - plik, którego nie wolno przyjąć", () => {
  it("odrzuca nieobsługiwane rozszerzenie i NIE woła wywołującego", async () => {
    const { onRows, input } = renderControl();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "raport.pdf", { type: "application/pdf" })] },
    });
    await screen.findByText("Nie umiem przeczytać tego formatu.");
    expect(onRows).not.toHaveBeenCalled();
  });

  it("odrzuca plik ponad limit rozmiaru, podając limit", async () => {
    const { onRows, input } = renderControl();
    const duzy = csvFile("duzy.csv", "a;b");
    // `size` jest tylko do odczytu - podmieniamy je, bo zbudowanie realnego
    // pliku 5 MB w teście kosztowałoby pamięć i czas bez żadnego zysku.
    Object.defineProperty(duzy, "size", { value: IMPORT_MAX_BYTES + 1 });
    fireEvent.change(input, { target: { files: [duzy] } });
    await screen.findByText(/Plik jest za duży/);
    expect(onRows).not.toHaveBeenCalled();
  });

  it("pusty plik kończy się komunikatem, nie pustym importem", async () => {
    const { onRows, input } = renderControl();
    fireEvent.change(input, { target: { files: [csvFile("pusty.csv", "\n\n")] } });
    await screen.findByText("Plik nie zawiera danych.");
    expect(onRows).not.toHaveBeenCalled();
  });
});

describe("DataImportControl - dostępność", () => {
  it("nie zakłada własnego `role=status` - powierzchnia może mieć swój", () => {
    // Arkusz danych w builderze pokazuje w `role=status` stan synchronizacji.
    // Drugi status w tym samym widoku znaczy, że ani czytnik ekranu, ani test
    // nie wie, o który chodzi - dlatego tu jest sam `aria-live`.
    const { container } = render(<DataImportControl onRows={() => []} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("ukryte pole pliku ma nazwę dostępną", () => {
    const { container } = render(<DataImportControl onRows={() => []} />);
    const input = container.querySelector('input[type="file"]');
    expect(input?.getAttribute("aria-label")).toBe("Importuj z pliku");
  });
});
