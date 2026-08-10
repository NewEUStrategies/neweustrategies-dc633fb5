// Prymitywy powłoki huba klubu.
//
// JEDEN promień, JEDNA krawędź, JEDEN rytm odstępów dla wszystkich paneli
// i etykiet huba. `--radius` serwisu to 6 px, a `rounded-lg` mapuje się
// dokładnie na nie (`--radius-lg: var(--radius)`), więc wszystko poniżej
// używa `rounded-lg` i nigdzie nie ma pigułek: etykieta w kształcie tabletki
// jest z innego systemu niż karta o narożniku 6 px i widać to natychmiast,
// gdy stoją obok siebie.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Wspólna krawędź paneli. Wydzielona, bo powtarza się w ośmiu miejscach. */
export const HUB_SURFACE = "rounded-lg border border-border/60 bg-card";

/**
 * Panel szyny bocznej: nagłówek, opcjonalna akcja w rogu, treść.
 * Nagłówek jest OPCJONALNY - panel bez tytułu (np. tożsamość klubu) używa tej
 * samej powierzchni, żeby szyna czytała się jak jedna kolumna, a nie jak
 * zbiór luźnych kafelków.
 */
export function ClubRailPanel({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(HUB_SURFACE, "p-3", className)}>
      {title !== undefined ? (
        <header className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {Icon !== undefined ? (
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : null}
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Etykieta liczbowa: ikona + wartość + opis. Używana w pasku tożsamości
 * i w panelu pulsu, więc obie powierzchnie mówią o liczbach tym samym głosem.
 */
export function ClubStatPill({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-xs",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * Przełącznik segmentowy - jedna kontrolka, kilka wykluczających się stanów.
 * Świadomie NIE jest to `<Tabs>` z biblioteki: te renderują panel na każdą
 * zakładkę, a tutaj panel jest jeden (strumień) i tylko jego ŹRÓDŁO się
 * zmienia. Radio-group jest tu poprawnym modelem dostępności.
 */
export function ClubSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon; count?: number }>;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Poziome przewijanie na telefonie zamiast zawijania do drugiego rzędu:
        // segmenty w dwóch rzędach przestają czytać się jako jedna kontrolka.
        "-mx-3 flex gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium leading-none transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {Icon !== undefined ? (
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : null}
            <span className="whitespace-nowrap">{option.label}</span>
            {option.count !== undefined && option.count > 0 ? (
              <span
                className={cn(
                  "rounded-lg px-1 text-[10px] tabular-nums",
                  active ? "bg-primary-foreground/20" : "bg-muted",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ISKRA AKTYWNOŚCI ZNIKŁA W A34. `ClubSparkline` rysował 14 słupków z liczbą
// różnych osób odzywających się danego dnia i miał dwóch konsumentów: panel
// składu w szynie i nagłówek strony składu. Oba odpowiadały na pytanie
// o wolumen ruchu, a moduł ma odpowiadać na pytanie o LUDZI - w szynie stoi
// teraz rząd twarzy (`ClubRosterFaces`), a strona składu ma pod liczbami
// pełną listę nazwisk. Atom bez ani jednego wywołania zostałby kodem, który
// nikt nie utrzymuje, a każdy widzi w podpowiedziach edytora.
