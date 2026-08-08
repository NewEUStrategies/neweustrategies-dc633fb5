// Atom: jedna zakładka przestrzeni roboczej wątku.
//
// DLACZEGO `role="tab"` A NIE LINK. Panele nie są osobnymi adresami - są
// widokami TEGO SAMEGO wątku. Gdyby każdy panel miał własny URL, wątek
// przestałby mieć jeden adres do zacytowania, a to jest jedyna rzecz, którą
// dyskusja musi mieć na trwałe.
//
// Licznik jest częścią NAZWY dostępnej (`aria-label`), a nie osobnym węzłem
// obok - czytnik ekranu, który mówi "Dokumenty, 7" jednym tchem, przekazuje to
// samo, co wzrok widzi jednym spojrzeniem.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ClubWorkspaceTab({
  id,
  panelId,
  label,
  count,
  icon,
  active,
  onSelect,
}: {
  id: string;
  panelId: string;
  label: string;
  /** `null` = brak licznika. Odznaka z zerem to szum, który uczy ignorować odznaki. */
  count: number | null;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      // Zakładka nieaktywna wypada z kolejności Tab - strzałki przenoszą
      // fokus wewnątrz belki (wzorzec WAI-ARIA "tabs with manual activation").
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      aria-label={count === null ? label : `${label} (${count})`}
      className={cn(
        "inline-flex shrink-0 snap-start items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "sm:px-3 sm:text-sm",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span aria-hidden="true" className={active ? "text-primary" : ""}>
        {icon}
      </span>
      <span className="whitespace-nowrap">{label}</span>
      {count !== null ? (
        <span
          aria-hidden="true"
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
