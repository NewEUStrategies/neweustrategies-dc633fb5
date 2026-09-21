// WŁAŚCICIEL PACZKI OKNA ROZMOWY - jedno miejsce, które zna ścieżkę importu.
//
// ── DLACZEGO TO ISTNIEJE. ZMIERZONE ──────────────────────────────────────
// `ChatSideDrawer` (wysuwana skrzynka doku) importował `ChatWindow`
// i `GroupCreateDialog` STATYCZNIE, choć oba renderują się warunkowo:
// okno rozmowy dopiero po wybraniu wątku, a dialog grupy dopiero po
// kliknięciu „nowa grupa". Skutek policzony na domknięciu importów:
// otwarcie samej skrzynki ciągnęło 80 plików / 592,7 kB źródła. Po zdjęciu
// tych dwóch krawędzi zostaje 17 plików / 141,5 kB - o 76% mniej kodu przed
// pierwszym malowaniem listy rozmów.
//
// To była najdroższa pozycja w całej odczuwanej „powolności otwierania
// okienek": użytkownik klikał „Czat", żeby zobaczyć LISTĘ, a płacił za pełne
// okno wiadomości (kompozytor, lista wiadomości, reakcje, załączniki),
// którego w tym momencie nie ma jeszcze na ekranie.
//
// ── KONWENCJA ────────────────────────────────────────────────────────────
// Ta sama, co `checkout/checkoutDialogChunk.ts` i `dock/panelChunks.ts`:
// osobny modul z `load*` dla `React.lazy` i idempotentnym `prefetch*()`,
// ktory polyka odrzucenie. Plik komponentu zostaje przy samych komponentach,
// zeby fast refresh dzialal.
import type { ChatWindowProps } from "@/components/chat/ChatWindow";

export type { ChatWindowProps };

/** Import paczki okna rozmowy w formacie oczekiwanym przez `React.lazy`. */
export const loadChatWindow = () =>
  import("@/components/chat/ChatWindow").then((m) => ({ default: m.ChatWindow }));

/** Import paczki dialogu tworzenia grupy. */
export const loadGroupCreateDialog = () =>
  import("@/components/chat/GroupCreateDialog").then((m) => ({ default: m.GroupCreateDialog }));

/**
 * Rozgrzewa paczkę okna rozmowy. Wołane z listy wątków w skrzynce
 * (`onPointerEnter` / `onFocus` na wierszu) oraz z żądania otwarcia konkretnej
 * rozmowy z magistrali - w obu wypadkach kod leci równolegle z decyzją
 * użytkownika, a nie po niej.
 */
export function prefetchChatWindow(): void {
  void loadChatWindow().catch(() => {
    /* brak sieci - `Suspense` ponowi import przy realnym otwarciu rozmowy */
  });
}

/** Rozgrzewa paczkę dialogu grupy (najechanie na „nowa grupa"). */
export function prefetchGroupCreateDialog(): void {
  void loadGroupCreateDialog().catch(() => {
    /* brak sieci - `Suspense` ponowi import przy realnym otwarciu dialogu */
  });
}
