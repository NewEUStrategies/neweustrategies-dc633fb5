// Katalog klubów na hubie `/club` - PODZIAŁ i LICZNIKI jako czyste funkcje.
//
// PO CO OSOBNY MODUŁ. Te trzy reguły siedziały w JSX-ie trasy jako trzy
// wyrażenia inline (`clubs.filter(...)`, drugi `clubs.filter(...)` z podwójnym
// warunkiem, `clubs.reduce(...)` razy dwa). Każda z nich jest REGUŁĄ PRODUKTU,
// a nie układem: co znaczy „mój klub", czy filtr obszaru dotyczy także klubów,
// w których już jestem, i co dokładnie liczy pasek nad katalogiem. Dopóki
// mieszkały w drzewie JSX, jedynym sposobem ich sprawdzenia było zamontowanie
// całego huba z czterema atrapami zapytań - czyli test, który pada przy
// zmianie układu i milczy przy zmianie reguły.
//
// GRANICA WARSTW. To jest warstwa `lib`: zero Reacta, zero i18n, zero dostępu
// do bazy. Wejściem są wiersze `club_list` (już odsiane po stronie RPC - dla
// wołającego bez sesji zwraca WYŁĄCZNIE kluby `public` o statusie `active`),
// wyjściem gołe struktury. Autoryzacja nie jest tu liczona ani powtarzana.
import type { ClubListRow } from "./types";

/**
 * Minimalny kształt wiersza, jakiego potrzebują te reguły. Świadomie WĘŻSZY
 * niż `ClubListRow`: dzięki temu funkcje przyjmują też wiersze zawężone przez
 * dopasowanie nazw (`rankClubs`) i nie wymuszają przenoszenia kolumn, których
 * nie czytają.
 */
export interface ClubHubCatalogRow {
  readonly my_status: string | null;
  readonly policy_area: string | null;
  readonly thread_count: number;
  readonly member_count: number;
}

/** Status członkostwa, który znaczy „to jest MÓJ klub". */
const ACTIVE_STATUS = "active";

/**
 * Czy wiersz jest klubem, w którym wołający ma AKTYWNE członkostwo.
 *
 * `pending` (złożone zgłoszenie), `invited` (zaproszenie bez odpowiedzi),
 * `banned` i `left` NIE są członkostwem - klub z takim statusem musi zostać
 * w „Odkryj", bo droga do środka jeszcze przed użytkownikiem albo jest
 * zamknięta. Sklejenie ich z `active` dawałoby sekcję „Moje kluby" z pozycjami,
 * których kliknięcie kończy się bramką dostępu.
 */
export function isMyClub(row: ClubHubCatalogRow): boolean {
  return row.my_status === ACTIVE_STATUS;
}

/** Kluby podzielone na „moje" i „do odkrycia", z filtrem obszaru polityki. */
export interface ClubHubBuckets<TRow> {
  readonly mine: readonly TRow[];
  readonly discover: readonly TRow[];
}

/**
 * Podział katalogu na dwie sekcje huba.
 *
 * `topic === null` znaczy BRAK zawężenia, nie „obszar nieustawiony": klub
 * z `policy_area = null` ma się pokazać przy braku filtra i zniknąć przy
 * dowolnym wybranym obszarze. Odwrotna interpretacja („null pasuje do
 * wszystkiego") sprawiałaby, że kluby bez przypisanego obszaru wchodzą do
 * każdego filtra i psują całą wartość paska obszarów.
 *
 * Filtr obszaru dotyczy WYŁĄCZNIE sekcji „Odkryj". Sekcja „Moje kluby" to
 * nawigacja do miejsc, w których użytkownik już jest - zawężanie jej obszarem
 * ukrywałoby mu własne kluby i wyglądało jak utrata członkostwa.
 */
export function clubHubBuckets<TRow extends ClubHubCatalogRow>(
  clubs: readonly TRow[],
  topic: string | null,
): ClubHubBuckets<TRow> {
  const mine: TRow[] = [];
  const discover: TRow[] = [];
  for (const row of clubs) {
    if (isMyClub(row)) {
      mine.push(row);
      continue;
    }
    if (topic === null || row.policy_area === topic) discover.push(row);
  }
  return { mine, discover };
}

/** Liczniki paska nad katalogiem. */
export interface ClubHubStats {
  readonly clubs: number;
  readonly threads: number;
  readonly seats: number;
  readonly mine: number;
}

/**
 * Liczniki huba. Liczone z CAŁEGO katalogu, nie z sekcji po filtrze: pasek
 * odpowiada na pytanie „ile tego jest", więc wybór obszaru nie może zmieniać
 * liczby klubów w serwisie. `mine` jest tu wyjątkiem uzasadnionym - to liczba
 * członkostw wołającego, a ta nie zależy od filtra tak samo.
 */
export function clubHubStats(clubs: readonly ClubHubCatalogRow[]): ClubHubStats {
  let threads = 0;
  let seats = 0;
  let mine = 0;
  for (const row of clubs) {
    threads += row.thread_count;
    seats += row.member_count;
    if (isMyClub(row)) mine += 1;
  }
  return { clubs: clubs.length, threads, seats, mine };
}

/** Najkrótsza fraza, dla której wyszukiwanie ma sens. */
export const CLUB_SEARCH_MIN_CHARS = 2;

/**
 * Czy wpisana fraza uruchamia wyszukiwanie (a więc ZASTĘPUJE katalog).
 *
 * Próg dwóch znaków po przycięciu jest obroną przed zapytaniem na każdą
 * literę: jednoznakowa fraza pasuje do prawie wszystkiego, więc wynik nie
 * niesie informacji, a RPC dostaje ruch przy każdym naciśnięciu klawisza.
 * Same białe znaki nie są frazą - inaczej spacja gasiła katalog i pokazywała
 * pustą listę wyników.
 */
export function isClubSearchActive(query: string): boolean {
  return query.trim().length >= CLUB_SEARCH_MIN_CHARS;
}

/**
 * Czy katalog został UCIĘTY, czyli czy za tym, co już przyszło, serwer ma
 * jeszcze wiersze. Porównanie idzie po liczbie wierszy ODDANYCH PRZEZ RPC
 * (offset następnej porcji) wobec sumy z okna `count(*) OVER ()`; wartości
 * równe znaczą „to już wszystko", a `shown` większe od `total` (rozjazd okna
 * po odświeżeniu) traktujemy tak samo, zamiast obiecywać doładowanie, które
 * nie dowiezie ani jednego wiersza.
 */
export function hasMoreClubs(shown: number, total: number): boolean {
  return total > shown;
}

// --- stronicowanie katalogu ------------------------------------------------
//
// DLACZEGO OFFSET, A NIE ROSNĄCY LIMIT. „Pokaż więcej" rosło dotąd przez
// `p_limit` (100 -> 200 -> 300) i zawsze czytało od zera. A13 (przywrócone
// w 20261017130000) tnie stronę serwerowo: `LIMIT LEAST(GREATEST(COALESCE(
// p_limit, 100), 1), 200)`. Powyżej 200 widocznych klubów lista stawała więc
// na 200, licznik w przycisku dalej mówił „200 z 250", a przycisk zostawał
// i nie robił nic - prośba o 300 dostawała te same 200 wierszy. Porcja ma
// teraz STAŁY rozmiar, a kolejne idą przez `p_offset` (wzorzec z `/network`
// i `/network/mutual`: `useInfiniteQuery` + `total_count` z okna).

/**
 * Rozmiar porcji katalogu na hubie. Musi zostać `<= CLUB_LIST_SERVER_CAP` -
 * większa prośba i tak wróci przycięta, a zysk z niej jest żaden.
 */
export const CLUB_CATALOG_PAGE_SIZE = 100;

/**
 * Sufit strony po stronie bazy (A13): `club_list` i
 * `club_list_by_specialization` oddają najwyżej tyle wierszy na wywołanie,
 * niezależnie od `p_limit`. Stała jest DOKUMENTACJĄ kontraktu dla testów
 * i porcji klienta - autorytetem jest `LIMIT` w SQL.
 */
export const CLUB_LIST_SERVER_CAP = 200;

/** Jedna porcja katalogu - to, co oddaje `fetchClubList` dla jednego offsetu. */
export interface ClubCatalogPage<TRow> {
  readonly rows: readonly TRow[];
  /** `total_count` z okna RPC tej porcji (0 dla pustej odpowiedzi). */
  readonly total: number;
}

/**
 * Offset następnej porcji albo `undefined`, gdy doładowanie nie ma czego
 * dowieźć (`getNextPageParam` katalogu).
 *
 * OFFSET = SUMA WIERSZY ODDANYCH PRZEZ SERWER, nie `liczba porcji * rozmiar`
 * i nie liczba wierszy po deduplikacji. To pozycja w porządku SERWERA: gdyby
 * baza przycięła porcję mocniej, niż prosiliśmy (sufit A13 niższy od
 * `p_limit`), mnożenie przeskoczyłoby wiersze; a duplikat usunięty
 * w `mergeClubCatalogPages` nadal zajmował miejsce w porządku serwera, więc
 * odjęcie go cofnęłoby offset i pobrało ten sam wiersz po raz drugi.
 *
 * O „czy jeszcze" rozstrzyga `total` OSTATNIEJ porcji (najświeższe okno),
 * a pusta porcja kończy doładowanie bezwarunkowo - inaczej nieaktualne
 * `total` (kluby zarchiwizowane między porcjami) kręciłoby pętlę pustych
 * odpowiedzi pod przyciskiem, który nic nie dokłada.
 */
export function nextClubCatalogOffset(
  pages: readonly ClubCatalogPage<unknown>[],
): number | undefined {
  const last = pages.at(-1);
  if (last === undefined || last.rows.length === 0) return undefined;
  const consumed = pages.reduce((sum, page) => sum + page.rows.length, 0);
  return hasMoreClubs(consumed, last.total) ? consumed : undefined;
}

/**
 * Sklejenie porcji w jeden katalog: kolejność serwera, każdy klub RAZ.
 *
 * DEDUPLIKACJA PO `id`. Porządek `club_list` (`is_mine DESC,
 * last_activity_at DESC NULLS LAST, lower(name_pl), id`) jest CAŁKOWITY
 * (id na końcu od 20261017150000 - bez niego remis na styku porcji dawał
 * duplikat i DZIURĘ już na statycznych danych, a dziury stąd nie widać), ale
 * żyje: nowy wątek podnosi klub na początek, nowy klub wchodzi w porządek,
 * a dołączenie przenosi klub do „moich" na górze. Offset kolejnej porcji
 * liczy się wtedy od przesuniętej listy, więc wiersz z końca porcji N wraca
 * na początku porcji N+1. Bez deduplikacji ten sam klub stałby w katalogu
 * dwa razy (dwa takie same klucze Reacta, podwójne liczniki w
 * `clubHubStats`). Klub, który wskoczył na porcję JUŻ wczytaną, ominie
 * offset aż do refetchu - to wymagałoby kursora, nie deduplikacji.
 * Wygrywa PIERWSZE wystąpienie - ono stoi tam, gdzie użytkownik już je
 * widział, więc doładowanie nie przestawia kart nad przyciskiem.
 *
 * `total` z OSTATNIEJ niepustej porcji (najświeższe okno). Pusta ostatnia
 * porcja znaczy „za offsetem nic nie ma", więc wszystko jest już na ekranie:
 * suma to liczba wierszy. I nigdy mniej niż widać - „250 z 249" po
 * archiwizacji klubu między porcjami byłoby licznikiem, który kłamie.
 */
export function mergeClubCatalogPages<TRow extends { readonly id: string }>(
  pages: readonly ClubCatalogPage<TRow>[],
): { rows: TRow[]; total: number } {
  const seen = new Set<string>();
  const rows: TRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  const last = pages.at(-1);
  const total = last !== undefined && last.rows.length > 0 ? last.total : rows.length;
  return { rows, total: Math.max(total, rows.length) };
}

/** Sanity: `ClubListRow` spełnia wąski kształt, na którym stoją te reguły. */
export type ClubHubCatalogRowCheck = ClubListRow extends ClubHubCatalogRow ? true : never;
