// Molekuła: nazwana SEKCJA pól w formularzu panelu.
//
// PO CO. Formularz rodzaju wydarzenia ma osiemnaście pól. Osiemnaście pól bez
// nagłówków to ściana, w której redaktor nie znajduje pola „limit miejsc", więc
// klika „Zapisz" i sprawdza metodą prób. Sekcja nazywa GRUPĘ decyzji („Ustawienia
// domyślne nowego wydarzenia"), a nie pojedyncze pole - i to jest jedyna rzecz,
// która sprawia, że długi formularz da się czytać.
//
// SIATKA JEST CZĘŚCIĄ SEKCJI, NIE POLA. Pola dostają `columns`, bo o tym, czy
// dwie liczby stoją obok siebie, decyduje kontekst grupy, a nie sama liczba.
// Do `sm` wszystko układa się w pion - dwie kolumny na telefonie dają pola
// szerokości ośmiu znaków.
//
// JEDNA ODPOWIEDZIALNOŚĆ: nazwać grupę i rozłożyć jej dzieci. Molekuła nie zna
// słownika (dostaje gotowy napis), nie wie, co jest w środku, i nie czyta danych.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AdminFormSection({
  title,
  hint,
  columns = 1,
  className,
  children,
}: {
  title: string;
  hint?: string;
  /** Liczba kolumn od `sm`. Do `sm` zawsze jedna. */
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {hint === undefined ? null : (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
        )}
      </div>
      <div
        className={cn(
          "grid gap-3",
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-1 sm:grid-cols-2",
          columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </section>
  );
}
