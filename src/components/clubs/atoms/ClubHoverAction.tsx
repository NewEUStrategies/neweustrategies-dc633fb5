// Atom: akcja minimalistyczna - ikona, która na najechaniu rozwija etykietę.
//
// PO CO. Pod każdą kartą strumienia stały dwa szerokie przyciski z pełnym
// tekstem ("Zareaguj", "Komentuj · 2"). Przy kilkunastu kartach pod rząd te
// pasy tekstu ważą więcej niż sama dyskusja i rozbijają rytm kolumny. Akcja
// jest tu drugorzędna wobec treści, więc w spoczynku ma być PIKTOGRAMEM,
// a słowo pojawia się dopiero wtedy, gdy użytkownik faktycznie celuje w akcję.
//
// JAK. Rozwinięcie robi animowana siatka (`grid-template-columns: 0fr -> 1fr`),
// nie `width`/`max-width`: szerokość docelowa liczy się z treści etykiety, więc
// nie trzeba zgadywać pikseli dla PL i EN. Etykieta zostaje w DOM przez cały
// czas (czytnik ekranu i wyszukiwanie w stronie ją widzą), a maskuje ją
// `overflow-hidden` rodzica.
//
// DOSTĘPNOŚĆ. Rozwijamy też na `focus-visible` - nawigacja klawiaturą nie może
// dostać samej ikony bez podpisu. `prefers-reduced-motion` wyłącza przejście,
// stan końcowy pozostaje ten sam.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Klasy powłoki akcji. Wydzielone, bo tę samą geometrię nosi `<button>`
 * (reakcja zostaje na miejscu) i `<Link>` (komentarz prowadzi do wątku) -
 * gdyby każdy trzymał własny zestaw klas, rozjechałyby się przy pierwszej
 * zmianie wysokości.
 */
export function clubHoverActionClass(options?: {
  active?: boolean;
  disabled?: boolean;
  className?: string;
}): string {
  const { active = false, disabled = false, className } = options ?? {};
  return cn(
    "group/act inline-flex h-7 max-w-full items-center rounded-lg border px-2 text-xs font-medium",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary/50 bg-primary/10 text-primary"
      : "border-border/60 bg-transparent text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground",
    disabled && "pointer-events-none opacity-50",
    className,
  );
}

/**
 * Wnętrze akcji: ikona zawsze, etykieta na żądanie, licznik zawsze gdy > 0
 * (liczba jest informacją o dyskusji, nie o akcji - nie wolno jej chować).
 */
export function ClubHoverActionBody({
  icon: Icon,
  label,
  count,
  expanded = false,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  /** Wymusza rozwinięcie (np. jedyna akcja główna karty). */
  expanded?: boolean;
}): ReactNode {
  const showCount = typeof count === "number" && count > 0;
  return (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "grid transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
          expanded
            ? "grid-cols-[1fr]"
            : "grid-cols-[0fr] group-hover/act:grid-cols-[1fr] group-focus-visible/act:grid-cols-[1fr]",
        )}
      >
        <span className="overflow-hidden">
          <span className="block whitespace-nowrap pl-1.5">{label}</span>
        </span>
      </span>
      {showCount ? (
        <span className="ml-1.5 shrink-0 tabular-nums" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </>
  );
}
