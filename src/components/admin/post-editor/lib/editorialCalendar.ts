// Czysta matematyka kalendarza redakcyjnego (/admin/posts/calendar).
// Wyniesione 1:1 z `src/routes/admin.posts.calendar.tsx`, żeby reguły terminu
// publikacji dały się sprawdzić bez renderowania siatki, dnd-kit, sesji
// i zapytań - trasa zostaje kompozycją.
//
// Umiejscowienie: pod `components/admin/post-editor/lib`, bo kalendarz jest
// częścią workflow redakcyjnego wpisu - przesuwa TEN SAM `publish_at` przez
// TĘ SAMĄ server fn (`updatePost`), pod tą samą bramką workflow i tym samym
// triggerem DB, co selektor statusu w edytorze. Sąsiaduje więc z
// `layoutOverrides.ts`, który wyszedł z edytora dokładnie tą samą drogą.

/** Wiersz wpisu, na którym operuje kalendarz (podzbiór kolumn `posts`). */
export interface CalendarEntry {
  id: string;
  status: string;
  published_at: string | null;
  publish_at: string | null;
}

/** Szkic dostaje domyślnie tę godzinę przy pierwszym zaplanowaniu. */
export const DEFAULT_SCHEDULE_HOUR = 9;

/** Siatka miesiąca ma stałe 6 tygodni - wysokość widoku nie skacze co miesiąc. */
export const GRID_DAYS = 42;

/**
 * Data, pod którą wpis ląduje w kalendarzu:
 *   scheduled -> `publish_at` (termin planowany),
 *   published -> `published_at` (moment faktycznej publikacji),
 *   reszta    -> null (szkice i recenzje nie mają miejsca w siatce; idą do
 *                backlogu w panelu bocznym).
 *
 * Rozdział tych dwóch kolumn jest istotny: `published_at` jest niezmiennym
 * znacznikiem PIERWSZEJ publikacji (porządkuje archiwa, RSS i sitemapy), a
 * `publish_at` to zapis PLANU. Sczytanie jednej zamiast drugiej przesunęłoby
 * wpis w kalendarzu o różnicę między planem a wykonaniem.
 */
export function entryDate(post: CalendarEntry): string | null {
  if (post.status === "scheduled") return post.publish_at;
  if (post.status === "published") return post.published_at;
  return null;
}

/**
 * Lokalny klucz dnia `YYYY-MM-DD`. Świadomie LOKALNY, nie UTC: redaktor planuje
 * w swojej strefie, więc wpis o 23:30 UTC należy w Warszawie do NASTĘPNEGO dnia
 * i tam ma się pokazać. `toISOString().slice(0,10)` dałoby tu dzień wcześniejszy.
 */
export function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Siatka 6 tygodni obejmująca wskazany miesiąc, zaczynająca się od
 * PONIEDZIAŁKU. `Date#getDay()` liczy od niedzieli (0), więc przesunięcie
 * `(getDay() + 6) % 7` przestawia tydzień na europejski: poniedziałek daje 0,
 * niedziela 6. Bez tego miesiąc zaczynający się w niedzielę gubiłby cały
 * pierwszy wiersz.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: GRID_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * Zakres zapytania o wpisy miesiąca: od pierwszej komórki siatki do dnia PO
 * ostatniej. Górna granica jest wyłączna (`lt`), więc musi wskazywać dobę
 * następną - inaczej wpisy z ostatniego dnia siatki wypadałyby z wyniku.
 */
export function gridRange(grid: Date[]): { start: Date; end: Date } {
  const start = grid[0];
  const end = new Date(grid[grid.length - 1]);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Wpisy pogrupowane po dniu, posortowane w obrębie dnia rosnąco po terminie.
 * Wpisy bez daty (szkice, recenzje) są pomijane - nie mają miejsca w siatce.
 */
export function groupByDay<T extends CalendarEntry>(posts: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const post of posts) {
    const iso = entryDate(post);
    if (!iso) continue;
    const key = dayKey(new Date(iso));
    const list = map.get(key);
    if (list) list.push(post);
    else map.set(key, [post]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (entryDate(a) ?? "").localeCompare(entryDate(b) ?? ""));
  }
  return map;
}

/**
 * Czy TEN wpis wolno przeciągnąć na inny termin.
 *
 * Reguła jest tu, a nie w propie JSX, bo dotąd istniała WYŁĄCZNIE jako
 * `draggable={canPublish && p.status === "scheduled"}` w komórce dnia, podczas
 * gdy `onDragEnd` - czyli miejsce, które faktycznie ZAPISUJE - nie sprawdzał
 * statusu w ogóle. Nagłówek trasy obiecuje, że przeciągnięcie opublikowanego
 * jest „świadomie zablokowane”, bo re-datowałoby archiwum, sitemapy i feedy;
 * ta obietnica wisiała na jednym propie w JSX-ie. Teraz pytają o nią oba
 * miejsca, więc dołożenie uchwytu w nowym widoku nie odblokuje zapisu.
 *
 * Szkice i wpisy w recenzji WOLNO planować (to jest sens backlogu), ale tylko
 * roli z prawem publikacji - serwer i trigger DB egzekwują to niezależnie.
 */
export function canReschedule(post: CalendarEntry, actor: { canPublish: boolean }): boolean {
  if (!actor.canPublish) return false;
  return post.status === "scheduled" || post.status === "draft" || post.status === "pending_review";
}

export type RescheduleOutcome =
  { kind: "unchanged" } | { kind: "denied" } | { kind: "reschedule"; publishAtIso: string };

/**
 * Nowy termin po upuszczeniu wpisu na dzień `targetDay` (klucz `YYYY-MM-DD`).
 *
 * Trzy reguły:
 *  1. godzina z dotychczasowego terminu jest ZACHOWANA - przesunięcie dnia nie
 *     może po cichu przestawić publikacji na inną porę,
 *  2. wpis bez terminu (szkic, recenzja) dostaje `DEFAULT_SCHEDULE_HOUR`,
 *  3. upuszczenie na ten sam dzień to `unchanged` - bez zapisu, bo pusty
 *     UPDATE i tak przeszedłby przez bramkę workflow i bumpnął `updated_at`,
 *     fałszując historię edycji.
 */
export function rescheduleTarget(
  post: CalendarEntry,
  targetDay: string,
  actor: { canPublish: boolean },
): RescheduleOutcome {
  if (!canReschedule(post, actor)) return { kind: "denied" };

  const prior = post.status === "scheduled" && post.publish_at ? new Date(post.publish_at) : null;
  if (prior && Number.isNaN(prior.getTime())) return { kind: "denied" };
  if (prior && dayKey(prior) === targetDay) return { kind: "unchanged" };

  const [y, m, d] = targetDay.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return { kind: "denied" };

  const next = new Date(
    y,
    m - 1,
    d,
    prior?.getHours() ?? DEFAULT_SCHEDULE_HOUR,
    prior?.getMinutes() ?? 0,
  );
  if (Number.isNaN(next.getTime())) return { kind: "denied" };

  return { kind: "reschedule", publishAtIso: next.toISOString() };
}
