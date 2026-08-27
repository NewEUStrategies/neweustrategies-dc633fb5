// Molekuła: SPIS PODSTRON WYDARZENIA - sam rysunek kafli, bez źródła pozycji.
//
// PO CO ODDZIELIĆ RYSUNEK OD POZYCJI - dokładnie ten sam powód, co przy
// `EventTabsBar`. `EventMenuNav` bierze pozycje z RPC `event_menu`, które ma
// w ciele `AND e.status = 'published'`, a każda pozycja jest `<Link>`-iem
// wyprowadzającym ze studia. Podgląd w studiu nie może więc zamontować tamtego
// organizmu - a spis MUSI w podglądzie być, bo przełącznik `pages_display_mode`
// zmienia właśnie ten układ i redaktor ma zobaczyć skutek PRZED zapisem.
//
// PRZED TĄ ZMIANĄ PODGLĄD MIAŁ TE KAFLE PRZEPISANE, z adnotacją „znaczniki
// i klasy są przepisane z tamtego komponentu”. Kopia z adnotacją, że jest kopią,
// nadal jest kopią i już się rozjechała: prawdziwy kafel ma
// `transition-colors hover:bg-muted/50` i rysuje ikonę WARUNKOWO, kopia nie
// miała przejścia i ikonę rysowała zawsze.
//
// PREZENTACJĘ WYBIERA ORGANIZATOR, NIE KOMPONENT (`events.pages_display_mode`):
// `list` to pionowa lista (kongres z pięcioma podstronami czyta się w kolumnie),
// `grid` to kafle (dziesięć podstron w kolumnie to przewijanie zamiast nawigacji).
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";

export function EventMenuTiles({
  label,
  grid,
  children,
}: {
  /** Etykieta dostępności - napis, nie klucz: molekuła nie zna słownika. */
  label: string;
  /** `pages_display_mode === "grid"`; nieznana wartość czyta się jako lista. */
  grid: boolean;
  /** Pozycje jako `<li>` - patrz nagłówek pliku. */
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className="mt-8">
      <ul className={cn(grid ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-2")}>
        {children}
      </ul>
    </nav>
  );
}

/** Klasa kafla - `EventPageLink` na stronie publicznej, `<span>` w podglądzie. */
export function eventMenuTileClass(grid: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50",
    grid && "h-full",
  );
}

export function EventMenuTileBody({
  icon,
  color,
  label,
}: {
  /** Nazwa ikony z panelu; `null` albo pusty napis = kafel bez ikony. */
  icon: string | null;
  /** `#RRGGBB` z panelu; `null` albo pusty napis = kafelek z motywu. */
  color: string | null;
  label: string;
}) {
  return (
    <>
      {icon === null || icon === "" ? null : (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          // Kolor pozycji jest TŁEM IKONY, nie kolorem napisu: `#RRGGBB`
          // z panelu nie ma pary w postaci koloru tekstu, a napis na losowym
          // tle bywa nieczytelny.
          style={color === null || color === "" ? undefined : { backgroundColor: color }}
        >
          <DynamicIcon name={icon} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">{label}</span>
    </>
  );
}
