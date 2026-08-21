// Molekuła podglądu zasięgu kampanii - CZTERY LICZBY, JEDNA WYRÓŻNIONA.
//
// CO TEN PLIK DOWODZI.
//   1. KAŻDA LICZBA STOI PRZY SWOJEJ ETYKIECIE. Podgląd jest jedyną obroną przed
//      nieodwracalną wysyłką do cudzych skrzynek, więc „137” pod napisem
//      „odsiane” zamiast „pójdzie” to nie literówka, a fałszywe potwierdzenie.
//      Dowodem jest parowanie etykiety z wartością W OBRĘBIE komórki, nie
//      obecność obu napisów na ekranie.
//   2. LICZBA GŁÓWNA JEST WYRÓŻNIONA, bo to ona jest treścią potwierdzenia.
//   3. KOMUNIKAT JEST ŻYWY (`aria-live`): liczby zmieniają się po zmianie reguły
//      bez przeniesienia uwagi, więc czytnik ekranu musi je przeczytać sam.
//   4. ZERA SĄ POKAZYWANE, a nie ukrywane - „0 pójdzie” to informacja, a nie brak
//      informacji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Składu komórek i kolejności
// (`clubSegmentPreviewCells`) - `lib/clubs/__tests__/adminSegment.test.ts`.
// (2) Bramki wysyłki i stanów zapytania - `ClubSegmentCampaign.test.tsx`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ClubCatalogSegmentPreview,
  type ClubCatalogSegmentPreviewCell,
} from "@/components/admin/clubs/molecules/ClubCatalogSegmentPreview";

const CZTERY: readonly ClubCatalogSegmentPreviewCell[] = [
  { id: "matched", label: "Pasuje", value: 40, emphasis: false },
  { id: "already_member", label: "Już w klubie", value: 6, emphasis: false },
  { id: "blocked", label: "Odsiane", value: 4, emphasis: false },
  { id: "will_send", label: "Pójdzie", value: 30, emphasis: true },
];

function podgląd(cells: readonly ClubCatalogSegmentPreviewCell[] = CZTERY) {
  return render(<ClubCatalogSegmentPreview cells={cells} />);
}

/** Treść JEDNEJ komórki - etykieta i liczba muszą stać razem. */
function komórka(container: HTMLElement, id: string): string {
  const cell = container.querySelector(`[data-preview-cell="${id}"]`);
  if (cell === null) throw new Error(`brak komórki ${id}`);
  return cell.textContent ?? "";
}

describe("podgląd zasięgu", () => {
  it("każda liczba stoi przy SWOJEJ etykiecie", () => {
    const { container } = podgląd();

    expect(komórka(container, "matched")).toBe("Pasuje40");
    expect(komórka(container, "already_member")).toBe("Już w klubie6");
    expect(komórka(container, "blocked")).toBe("Odsiane4");
    expect(komórka(container, "will_send")).toBe("Pójdzie30");
  });

  it("liczba GŁÓWNA jest wyróżniona, pozostałe nie", () => {
    const { container } = podgląd();

    expect(container.querySelector('[data-preview-cell="will_send"] .text-primary')).toBeTruthy();
    expect(container.querySelector('[data-preview-cell="matched"] .text-primary')).toBeNull();
  });

  it("komunikat jest ŻYWY dla czytnika ekranu", () => {
    const { container } = podgląd();

    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it("zera są pokazywane - „zero pójdzie” to informacja, nie brak informacji", () => {
    const { container } = podgląd([
      { id: "matched", label: "Pasuje", value: 0, emphasis: false },
      { id: "will_send", label: "Pójdzie", value: 0, emphasis: true },
    ]);

    expect(komórka(container, "matched")).toBe("Pasuje0");
    expect(komórka(container, "will_send")).toBe("Pójdzie0");
  });

  it("pusta lista komórek nie rysuje ani jednej liczby i nie rzuca", () => {
    const { container } = podgląd([]);

    expect(container.querySelectorAll("[data-preview-cell]")).toHaveLength(0);
    expect(screen.queryByText("Pójdzie")).toBeNull();
  });
});
