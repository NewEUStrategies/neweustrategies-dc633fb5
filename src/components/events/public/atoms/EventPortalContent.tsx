// Atom: KOLUMNA TREŚCI portalu wydarzenia - jedna miara na wszystkie zakładki.
//
// PO CO OSOBNY ATOM NA JEDEN `div`. Ta sama miara (`max-w-5xl`, `px-4`, `pt-8`)
// stała dosłownie w trzech miejscach: w przeglądzie (`events.$slug.index.tsx`),
// w powierzchni zakładki modułowej (`EventModulePage`) i w podglądzie studia -
// a w podglądzie stała jako `max-w-3xl`, czyli już rozjechana. Miara treści jest
// ZMIERZONA ze wzorca (`docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png`:
// kolumny 483/963/481 przy rynnach 39, całość ~1000 punktów), więc jest liczbą
// z pomiaru, a nie gustem - i dokładnie dlatego nie może mieć trzech kopii.
//
// KLASA JEST EKSPORTOWANA OSOBNO, bo przegląd potrzebuje jej na `<article>`,
// a zakładka i podgląd na `<div>`. Tailwind skanuje pliki jako tekst, więc
// literał w stałej generuje te same reguły, co literał w JSX.
import type { ReactNode } from "react";

/** Miara kolumny treści portalu wydarzenia - patrz nagłówek pliku. */
export const EVENT_PORTAL_CONTENT_CLASS = "mx-auto w-full max-w-5xl px-4 pt-8";

export function EventPortalContent({ children }: { children: ReactNode }) {
  return <div className={EVENT_PORTAL_CONTENT_CLASS}>{children}</div>;
}
