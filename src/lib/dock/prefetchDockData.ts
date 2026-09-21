// ROZGRZEWANIE DANYCH PANELU - druga połowa „otwiera się natychmiast".
//
// ── DWA NIEZALEŻNE OPÓŹNIENIA, DWA MECHANIZMY ────────────────────────────
// Kliknięcie zakładki uruchamiało dotąd DWA pobrania, jedno PO drugim:
//   1. paczka JS panelu (`lazy(() => import(...))`),
//   2. dopiero po jej wykonaniu - zapytanie do bazy z `useQuery` w środku.
// Suma dwóch okrążeń sieci, szeregowo, na drodze krytycznej kliknięcia.
//
// `prefetchDockPanel` (w `components/dock/panelChunks.ts`) zdejmuje pierwsze,
// ten moduł zdejmuje drugie - i oba odpalają się z TEGO SAMEGO zamiaru
// (najechanie kursorem, wejście focusem, dotknięcie). Dzięki temu w chwili
// kliknięcia kod i dane są w drodze RÓWNOLEGLE, a przy odrobinie zwłoki
// użytkownika po prostu już są.
//
// ── DLACZEGO `prefetchQuery`, A NIE `ensureQueryData` ────────────────────
// `prefetchQuery` respektuje `staleTime` i NIE rzuca - dziesiąte najechanie
// na tę samą zakładkę w ciągu pół minuty nie robi nic, a błąd sieci nie
// wywraca obsługi zdarzenia wskaźnika (panel pokaże swój stan błędu, gdy
// naprawdę zostanie otwarty). `ensureQueryData` zwraca obietnicę, którą
// trzeba by obsłużyć, i nie ma tu czego zwracać.
//
// ── DLACZEGO BEZ UŻYTKOWNIKA NIE ROBIMY NIC ─────────────────────────────
// Haki mają `enabled: !!user`, a `prefetchQuery` NIE ZNA tej flagi -
// wystrzeliłby zapytanie, które RLS odrzuci. Warunek jest więc tutaj, wprost.
import type { QueryClient } from "@tanstack/react-query";
import type { DockToolId } from "./types";
import { todosQueryOptions } from "./useTodos";
import { notesQueryOptions } from "./useNotes";
import { savedQueryOptions } from "./useSaved";
import { readLaterQueryOptions } from "./useReadLater";
import { calendarEventsQueryOptions } from "./useDockCalendar";

/**
 * Rozgrzewa dane, których panel zażąda po otwarciu.
 *
 * @param month Rok i miesiąc dla kalendarza. Podaje je pasek, bo kursor
 *   miesiąca żyje w panelu, a przed otwarciem panel jeszcze nie istnieje -
 *   rozgrzewamy więc miesiąc BIEŻĄCY, czyli ten, który panel pokaże jako
 *   pierwszy.
 */
export function prefetchDockData(
  client: QueryClient,
  tool: DockToolId,
  userId: string | undefined,
  month: [number, number],
): void {
  if (!userId) return;

  switch (tool) {
    case "todos":
      void client.prefetchQuery(todosQueryOptions(userId));
      return;
    case "notes":
      void client.prefetchQuery(notesQueryOptions(userId));
      return;
    case "saved":
    case "readLater":
      // Panel zapisanych pokazuje OBA zbiory na jednej liście, więc oba muszą
      // być w drodze - inaczej rozgrzanie jednego tylko przesuwa czekanie.
      void client.prefetchQuery(savedQueryOptions(userId));
      void client.prefetchQuery(readLaterQueryOptions(userId));
      return;
    case "calendar":
      void client.prefetchQuery(calendarEventsQueryOptions(userId, month[0], month[1]));
      // Kalendarz rysuje też zadania z terminem - bez nich siatka pokazałaby
      // kropki dopiero po drugim pobraniu.
      void client.prefetchQuery(todosQueryOptions(userId));
      return;
    case "chat":
      // Lista rozmów ma własną warstwę (`useConversations` + kanał realtime),
      // która rozgrzewa się wraz z paczką skrzynki. Świadomie nie dublujemy
      // tu jej konfiguracji - jedno źródło opcji zostaje w warstwie czatu.
      return;
  }
}
