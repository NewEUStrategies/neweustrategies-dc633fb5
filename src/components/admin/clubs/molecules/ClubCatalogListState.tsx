// Molekuła: TRZY STANY listy katalogu przed samą listą.
//
// CO BYŁO W ORGANIZMACH. Oba katalogi taksonomii miały w JSX-ie tę samą
// drabinkę trzech zagnieżdżonych ternary: wczytywanie, awaria, pustka, a na
// końcu lista. Drabinka przeklejona to drabinka, która rozjeżdża się przy
// pierwszej poprawce - a każdy z tych stanów znaczy dla administratora coś
// INNEGO i nie wolno ich pomylić:
//
//   - WCZYTYWANIE nie może wyglądać jak pustka. Administrator, który zobaczy
//     „nie ma jeszcze żadnych obszarów”, zakłada drugi wpis o tej samej nazwie.
//   - AWARIA nie może wyglądać jak pustka. „Nie ma wpisów” po nieudanym
//     zapytaniu to nieprawda o stanie bazy, a nie brak danych.
//   - PUSTKA mówi to wprost i nie rysuje ani jednego wiersza.
//
// KOLEJNOŚĆ WARUNKÓW JEST REGUŁĄ: wczytywanie bije awarię, awaria bije pustkę.
// Zapytanie w locie po nieudanej próbie pokazuje postęp, a nie stary błąd.
//
// JEDNA ODPOWIEDZIALNOŚĆ: rozstrzygnąć, co zobaczy administrator ZAMIAST listy.
// Molekuła nie wie, co jest na liście, nie zna słownika (dostaje gotowe napisy)
// i nie pyta serwera - stan dostaje gotowy, bo o kolejności zapytań decyduje
// organizm.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function ClubCatalogListState({
  isLoading,
  loadingLabel,
  errorMessage,
  isEmpty,
  emptyLabel,
  children,
}: {
  isLoading: boolean;
  loadingLabel: string;
  /** Treść odmowy z bazy albo `null`, gdy zapytanie się udało. */
  errorMessage: string | null;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {loadingLabel}
      </div>
    );
  }
  if (errorMessage !== null) {
    return <p className="text-sm text-destructive">{errorMessage}</p>;
  }
  if (isEmpty) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return <>{children}</>;
}
