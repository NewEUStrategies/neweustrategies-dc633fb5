// Widoczne zakładki listy czytelniczej - czysty filtr po ustawieniach.
//
// ATOM: bez Reacta i bez I/O. Etykieta pochodzi z ustawień personalizacji
// (tekst redakcyjny wpisany w panelu, NIE kopia interfejsu), więc nie ma tu
// klucza i18n do zwrócenia - i18n dotyczy napisów aplikacji, nie treści CMS-u.
//
// PO CO OSOBNO: administrator może wyłączyć KAŻDĄ z trzech sekcji, co daje
// osiem kombinacji widoku (w tym „zero zakładek"). Sprawdzenie ich przez
// montaż trasy to osiem przejazdów z atrapami zapytań; jako funkcja to jedna
// tabela przypadków.
import type { PersonalizedSettings } from "@/hooks/usePersonalizedSettings";

/** Identyfikator zakładki = klucz sekcji w ustawieniach. */
export type ReadingListTab = "saved" | "followed" | "recommended";

export interface ReadingListTabDescriptor {
  id: ReadingListTab;
  label: string;
}

/** Zakładki w stałej kolejności katalogu, bez sekcji wyłączonych w panelu. */
export function readingListTabs(
  sections: PersonalizedSettings["sections"],
): ReadingListTabDescriptor[] {
  const all: readonly { id: ReadingListTab; label: string; enabled: boolean }[] = [
    { id: "saved", label: sections.saved.heading, enabled: sections.saved.enabled },
    { id: "followed", label: sections.followed.heading, enabled: sections.followed.enabled },
    {
      id: "recommended",
      label: sections.recommended.heading,
      enabled: sections.recommended.enabled,
    },
  ];
  return all.filter((tab) => tab.enabled).map(({ id, label }) => ({ id, label }));
}
