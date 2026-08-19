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
 * Czy katalog został UCIĘTY przez limit porcji, czyli czy pokazać „pokaż
 * więcej". Porównanie idzie po liczbie WIDOCZNYCH wierszy wobec sumy z okna
 * RPC; wartości równe znaczą „to już wszystko", a `shown` większe od `total`
 * (rozjazd okna po odświeżeniu) traktujemy tak samo, zamiast obiecywać
 * doładowanie, które nie dowiezie ani jednego wiersza.
 */
export function hasMoreClubs(shown: number, total: number): boolean {
  return total > shown;
}

/** Sanity: `ClubListRow` spełnia wąski kształt, na którym stoją te reguły. */
export type ClubHubCatalogRowCheck = ClubListRow extends ClubHubCatalogRow ? true : never;
