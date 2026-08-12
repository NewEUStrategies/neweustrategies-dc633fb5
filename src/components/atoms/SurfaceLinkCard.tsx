import type { ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Kafel „stad przejdziesz tam" - jedna powierzchnia produktu linkujaca do
 * siasiedniej, ktorej granica nie jest dla uzytkownika oczywista.
 *
 * Wydzielony, bo ten uklad (ikona w kwadracie + tytul + zdanie + strzalka,
 * pionowo na telefonie i poziomo od `sm`) powtarza sie w hubach profilu
 * i za kazdym razem byl przepisywany z palca - razem z ryzykiem, ze kolejna
 * kopia zgubi `aria-hidden` na ikonie dekoracyjnej albo `min-w-0`, bez
 * ktorego dlugi tytul rozpycha kafel na waskim ekranie.
 *
 * Dostepnosc: cala plaszczyzna jest jednym `<Link>`, wiec czytnik oglasza
 * jeden cel z pelna etykieta (tytul + opis). Ikona i strzalka sa dekoracja.
 */
export interface SurfaceLinkCardProps {
  /** Trasa docelowa - typ `Link` z TanStacka waliduje ja przy budowie. */
  readonly to: string;
  /** Parametry `?search=` celu; przekazywane bez zmian do `Link`. */
  readonly search?: Record<string, string>;
  readonly title: string;
  readonly body: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly className?: string;
}

export function SurfaceLinkCard({
  to,
  search,
  title,
  body,
  icon: Icon,
  className,
}: SurfaceLinkCardProps) {
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        "group flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 transition-colors",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">{body}</span>
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
