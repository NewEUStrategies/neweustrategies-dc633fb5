// WŁAŚCICIEL PACZEK PANELI DOKU - jedno miejsce, które zna ścieżki importu.
//
// ── PO CO OSOBNY MODUŁ, A NIE `lazy()` W KOMPONENCIE ─────────────────────
// Ta sama konwencja, co `checkout/checkoutDialogChunk.ts`: plik komponentu ma
// eksportować WYŁĄCZNIE komponenty (inaczej fast refresh przestaje działać -
// pilnuje tego `eslint-plugin-react-refresh`), a rozgrzewanie paczki jest
// wołane z miejsc, które granicy jeszcze nie renderują. Tutaj tym miejscem
// jest zakładka na pasku: najechanie kursorem, wejście focusem albo dotknięcie
// palcem ma pobrać kod ZANIM padnie klik.
//
// ── CO TO NAPRAWIA, ZMIERZONE ────────────────────────────────────────────
// Do tej pory paczka panelu startowała DOPIERO na kliknięciu, a granica miała
// `Suspense fallback={null}` - czyli po kliknięciu nie pojawiało się NIC do
// czasu, aż kod dojedzie z sieci. Na zimnym cache to jest cała odczuwana
// „powolność otwierania okienek". Liczby nowych modułów na pierwsze otwarcie
// (surowe bajty źródła, licząc od paczki doku): kalendarz 5 plików/11,5 kB,
// zapisane 5/17,5, notatki 4/17,9, zadania 7/30,3, a skrzynka czatu 80
// plików/592,7 kB - i to ta ostatnia była najbardziej dotknięta, bo ciągnęła
// statycznie całe okno rozmowy, którego przy otwarciu skrzynki jeszcze nie ma
// na ekranie (patrz `chat/chatWindowChunk.ts`).
//
// Rozgrzanie na zamiar zdejmuje ten koszt z drogi krytycznej kliknięcia:
// pobranie leci równolegle z decyzją użytkownika, a nie po niej. Ten sam
// mechanizm ma router repozytorium (`preload: "intent"`), więc dok przestaje
// być jedyną powierzchnią, która czeka z pobraniem do ostatniej chwili.
//
// Idempotencja jest darmowa: bundler cache'uje moduł, więc dziesiąte
// najechanie na tę samą zakładkę nie kosztuje ani jednego żądania.
import type { DockToolId } from "@/lib/dock/types";

/** Import paczki panelu zadań w formacie oczekiwanym przez `React.lazy`. */
export const loadTodoPanel = () =>
  import("./organisms/TodoPanel").then((m) => ({ default: m.TodoPanel }));

/** Import paczki notatnika. */
export const loadNotesPanel = () =>
  import("./organisms/NotesPanel").then((m) => ({ default: m.NotesPanel }));

/** Import paczki zapisanych elementów. */
export const loadSavedPanel = () =>
  import("./organisms/SavedPanel").then((m) => ({ default: m.SavedPanel }));

/** Import paczki mini-kalendarza. */
export const loadCalendarPanel = () =>
  import("./organisms/CalendarPanel").then((m) => ({ default: m.CalendarPanel }));

/** Import paczki wysuwanej skrzynki czatu. */
export const loadChatSideDrawer = () =>
  import("./organisms/ChatSideDrawer").then((m) => ({ default: m.ChatSideDrawer }));

/**
 * Mapa narzędzie -> import. Trzymana jako `Record`, żeby dodanie narzędzia do
 * `DOCK_TOOLS` bez podania jego paczki było błędem typów, a nie cichym brakiem
 * rozgrzewania. `readLater` nie ma własnego panelu - jego elementy pokazuje
 * panel zapisanych, więc wskazuje na tę samą paczkę.
 */
const LOADERS: Record<DockToolId, () => Promise<unknown>> = {
  todos: loadTodoPanel,
  notes: loadNotesPanel,
  saved: loadSavedPanel,
  calendar: loadCalendarPanel,
  chat: loadChatSideDrawer,
  readLater: loadSavedPanel,
};

/**
 * Rozgrzewa paczkę panelu. Wywołuj w chwili, w której użytkownik zadeklarował
 * zamiar otwarcia (`onPointerEnter` / `onFocus` / `onPointerDown`), nie po
 * kliknięciu.
 *
 * Odrzucenie jest ŚWIADOMIE połykane: brak sieci nie może wywalić obsługi
 * zdarzenia wskaźnika, a `Suspense` ponowi import przy prawdziwym otwarciu
 * panelu i wtedy pokaże właściwy stan.
 */
export function prefetchDockPanel(tool: DockToolId): void {
  void LOADERS[tool]().catch(() => {
    /* brak sieci - import ponowi się przy realnym otwarciu panelu */
  });
}
