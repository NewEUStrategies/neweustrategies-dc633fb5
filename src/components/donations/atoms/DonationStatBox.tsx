// Kafel liczby w widgecie darowizn (atom).
//
// Wyciągnięty ZNAK W ZNAK z lokalnego `StatBox` w `DonationsWidgetView.tsx`
// (wariant `stats-strip`). Atom nie zna Supabase, react-query ani i18n -
// dostaje gotową etykietę i gotowy napis wartości, więc test może przypiąć
// jedyną decyzję, jaką tu podejmujemy: akcent z edytora CMS przemalowuje
// WYŁĄCZNIE wiersz etykiety, nigdy samej liczby.
import type { ReactNode } from "react";

export interface DonationStatBoxProps {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: string;
}

export function DonationStatBox({ icon, label, value, accent }: DonationStatBoxProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-4">
      <div
        className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"
        style={accent ? { color: accent } : undefined}
      >
        {icon}
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
