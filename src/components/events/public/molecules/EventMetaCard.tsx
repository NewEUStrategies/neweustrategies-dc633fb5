// Molekuła: KARTA „KIEDY, GDZIE, ILE MIEJSC” - lewa kolumna przeglądu.
//
// PO CO ISTNIEJE. Ten sam znacznik `<dl>` z tym samym wierszem `<dt>/<dd>`
// stał w DWÓCH plikach: `events.$slug.index.tsx` (funkcja lokalna `MetaRow`)
// i `EventPreviewCanvas.tsx` (funkcja lokalna `PreviewMetaRow`, z komentarzem
// „znaczniki przepisane z trasy”). Kopia z adnotacją, że jest kopią, nadal jest
// kopią - i rozjechała się dokładnie tak, jak każda kopia: podgląd rysował
// kartę w dwóch kolumnach (`sm:grid-cols-2`), strona publiczna w jednej.
// Prawdą jest strona publiczna, więc miara jest jej.
//
// KOMPOZYCJA, NIE LISTA PÓL. Wiersze składa wołający, bo ma ich różną liczbę:
// przegląd zna termin, miejsce, komplet miejsc, cenę i klauzulę Chatham House,
// a szkic formularza w studiu - termin i miejsce. Komponent przyjmujący
// „opcjonalnie wszystko” musiałby znać reguły widoczności każdego pola, czyli
// przenieść tu decyzje, które należą do strony.
//
// ZERO HOOKÓW ROUTERA I ZERO i18next: podgląd studia stoi poza routerem,
// a napisy (etykiety) wchodzą gotowe od wołającego.
import type { ReactNode } from "react";

export function EventMetaCard({ children }: { children: ReactNode }) {
  return <dl className="grid gap-4 rounded-lg border border-border bg-card p-5">{children}</dl>;
}

export function EventMetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  /** Pusty napis jest dopuszczalny - klauzula Chatham House jest samym zdaniem. */
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
