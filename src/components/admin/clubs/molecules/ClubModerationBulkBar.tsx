// Molekuła: PASEK OPERACJI WSADOWYCH nad kolejką i nad listą tematów.
//
// CO BYŁO W ORGANIZMACH. Ten sam przyklejony pasek stał DWA RAZY, w dwóch
// plikach: w `ClubThreadsTab` (przypnij / zamknij / przywróć / usuń) i w
// `ClubModerationTab` (zatwierdź / usuń). Obie kopie miały własny licznik
// zaznaczenia, własny przycisk „wyczyść zaznaczenie” przy prawej krawędzi
// i własny zestaw klas przyklejenia - czyli dwa miejsca do poprawienia, gdy
// pasek zasłania nagłówek tabeli.
//
// PASEK POJAWIA SIĘ DOPIERO PO ZAZNACZENIU - to reguła interfejsu, nie
// oszczędność: pasek z zerem i czterema nieaktywnymi przyciskami to szum nad
// każdą listą. O widoczności decyduje wołający (renderuje molekułę warunkowo),
// bo tylko on wie, co jest zaznaczone.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać, ILU wpisów dotyczy operacja, i oddać
// zdarzenia z listy deskryptorów. Molekuła nie zna zaznaczenia ani mutacji -
// dostaje gotowe etykiety i domknięcia, bo pasek nie ma prawa niczego skasować
// na własną rękę.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Deskryptor jednego przycisku wsadowego. */
export interface ClubModerationBulkAction {
  /** Stabilny klucz dla Reacta i dla asercji w testach. */
  id: string;
  label: string;
  icon: ReactNode;
  /** Akcja NIEODWRACALNA - dostaje ton destrukcyjny. */
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function ClubModerationBulkBar({
  label,
  actions,
  clearLabel,
  onClear,
}: {
  label: string;
  actions: readonly ClubModerationBulkAction[];
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 backdrop-blur">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant="outline"
            data-bulk-action={action.id}
            className={action.destructive === true ? "text-destructive" : undefined}
            disabled={action.disabled === true}
            onClick={action.onSelect}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  );
}
