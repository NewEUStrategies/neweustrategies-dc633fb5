// Molekuła: PODGLĄD ZASIĘGU kampanii segmentowej - cztery liczby w jednym rzędzie.
//
// CO BYŁO W ORGANIZMIE. `ClubSegmentCampaign` trzymał lokalny komponent
// `PreviewCell` i cztery ręcznie wypisane wywołania z osobnymi etykietami,
// w tym jedno z flagą wyróżnienia. Cztery wywołania obok siebie to cztery
// miejsca, w których da się podstawić liczbę pod cudzą etykietę - i dokładnie
// tak wygląda błąd, którego nie widać: „pójdzie 137” pod napisem „odsiane”.
//
// LICZBA GŁÓWNA JEST WYRÓŻNIONA, BO JEST POTWIERDZENIEM. Wysyłka jest
// nieodwracalna wobec cudzych skrzynek, więc „pójdzie” musi być czytelne od
// pierwszego spojrzenia, a nie równorzędne z odsiewem.
//
// KOMUNIKAT JEST ŻYWY (`aria-live="polite"`): liczby zmieniają się po zmianie
// reguły BEZ przeładowania i bez przeniesienia uwagi, więc czytnik ekranu musi
// je przeczytać sam - inaczej niewidzący administrator klika „wyślij” na
// podstawie liczby z poprzedniej reguły.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać policzony zasięg. Molekuła nie pyta serwera,
// nie zna słownika (dostaje gotowe napisy) i nie decyduje, czy wysyłka jest
// możliwa.
import type { ClubSegmentPreviewCell } from "@/lib/clubs/adminSegment";

export interface ClubCatalogSegmentPreviewCell extends Omit<ClubSegmentPreviewCell, "labelKey"> {
  /** Gotowy napis - klucz rozwiązuje organizm, bo tylko on ma słownik. */
  label: string;
}

export function ClubCatalogSegmentPreview({
  cells,
}: {
  cells: readonly ClubCatalogSegmentPreviewCell[];
}) {
  return (
    <div
      className="grid gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 sm:grid-cols-4"
      aria-live="polite"
    >
      {cells.map((cell) => (
        <div key={cell.id} data-preview-cell={cell.id}>
          <p className="text-xs text-muted-foreground">{cell.label}</p>
          <p
            className={
              cell.emphasis
                ? "text-lg font-semibold tabular-nums text-primary"
                : "text-lg font-semibold tabular-nums"
            }
          >
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}
