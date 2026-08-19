// Czyste reguły LISTY wpisów (/admin/posts) - zapytanie, filtry, zaznaczenie.
//
// Wyniesione z `src/routes/admin.posts.tsx` bez zmiany zachowania (jedyny
// wyjątek opisany jest przy `POSTS_LIST_INVALIDATE_KEYS`), gdzie mieszkały w ciele
// komponentu: wewnątrz `queryFn`, w ternary w JSX-ie i w handlerach `setState`.
// Sprawdzenie ich wymagało dotąd wyrenderowania całej trasy razem z routerem,
// react-query, i18n i klientem Supabase - czyli w praktyce nie były sprawdzane
// wcale, mimo że rozstrzygają rzeczy, które użytkownik widzi wprost:
// które wpisy wchodzą na listę, w jakim języku, i co zrobi „zaznacz wszystkie”.
//
// Umiejscowienie pod `components/admin/post-editor/lib`, bo lista jest wejściem
// do edytora wpisu: to ona ustala `?lang=` otwieranej wersji (patrz
// `viewLangFor` + `parsePostEditorSearch` w `postRouteParams.ts`) i to jej
// filtry decydują, co redaktor w ogóle zobaczy.
import type { BulkStatus } from "@/components/admin/BulkActionsBar";
import type { TenantAuthor } from "@/components/admin/hooks/useTenantAuthors";
import type { StatusFilter, LangFilter } from "@/components/admin/molecules/AdminListToolbar";
import { escapeLike } from "@/lib/admin/listFilters";

/** Zakładka listy: wpisy aktywne albo kosz. */
export type PostsListView = "active" | "trash";

/**
 * Kolumny pobierane dla listy. Stała, bo ten sam zestaw czyta `coverageOf`
 * (title_pl/title_en), sortowanie (updated_at/deleted_at) i mapa autorów
 * (author_id) - usunięcie którejkolwiek psuje kolumnę w tabeli, nie zapytanie.
 */
export const POSTS_LIST_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, status, published_at, publish_at, updated_at, author_id, deleted_at";

/** Stan filtrów listy - dokładnie to, czym steruje pasek narzędzi i zakładki. */
export interface PostsListFilters {
  view: PostsListView;
  /** Fraza JUŻ po debounce (surowa, bez trim - trim robi budowniczy). */
  search: string;
  status: StatusFilter;
  lang: LangFilter;
  /** Identyfikator autora albo "all". */
  author: string;
  /** Granice kosza z `<input type="date">`: "YYYY-MM-DD" albo "". */
  trashFrom: string;
  trashTo: string;
  /** Strona liczona od 1. */
  page: number;
  pageSize: number;
}

/**
 * Minimalny kontrakt łańcucha PostgREST, z którego korzysta lista.
 *
 * Interfejs jest generyczny po SOBIE samym (`Self`), bo builder Supabase
 * zwraca `this` - dzięki temu produkcja podaje tu prawdziwy builder BEZ rzutu
 * (i wynik nadal da się `await`), a test podaje atrapę z
 * `src/test/supabaseChain.ts`. Lista ogniw jest jawna: dołożenie w produkcji
 * ogniwa spoza niej MA być błędem kompilacji, a nie cicho przepuszczonym
 * filtrem.
 */
export interface PostsListQueryBuilder<Self> {
  eq(column: string, value: unknown): Self;
  neq(column: string, value: unknown): Self;
  is(column: string, value: unknown): Self;
  not(column: string, operator: string, value: unknown): Self;
  or(filters: string): Self;
  gte(column: string, value: unknown): Self;
  lte(column: string, value: unknown): Self;
  order(column: string, options: { ascending: boolean }): Self;
  range(from: number, to: number): Self;
}

/** Klucz cache listy. Kolejność elementów = zakres unieważnienia. */
export function postsListQueryKey(
  tenantId: string | null | undefined,
  f: PostsListFilters,
): ReadonlyArray<unknown> {
  return [
    "admin-posts",
    tenantId,
    f.view,
    f.search,
    f.status,
    f.lang,
    f.author,
    f.trashFrom,
    f.trashTo,
    f.page,
    f.pageSize,
  ];
}

/**
 * Klucze unieważniane po KAŻDEJ mutacji listy (kosz, przywrócenie, status,
 * konwersja, duplikat).
 *
 * NAPRAWA wobec stanu zastanego: czwarty klucz (licznik parytetu) nie był
 * unieważniany wcale, więc pasek „X wpisów bez wersji EN” zostawał po masowej
 * publikacji na liczbie sprzed zmiany i wołał o wersje, które już powstały.
 *
 * Cztery, nie jeden: liczniki kosza, widoku i luki parytetu to OSOBNE
 * zapytania po tej samej tabeli, a `invalidateQueries` dopasowuje po prefiksie
 * TABLICY - `["admin-posts"]` nie trafia w `["admin-posts-trash-count"]`, bo
 * to inny napis, nie dłuższy klucz. Pominięcie któregokolwiek zostawia na
 * ekranie liczbę sprzed mutacji.
 */
export const POSTS_LIST_INVALIDATE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["admin-posts"],
  ["admin-posts-trash-count"],
  ["admin-posts-view-count"],
  ["admin-posts-missing-en-count"],
];

/**
 * Podpis filtrów BEZ numeru strony - zmiana podpisu cofa listę na stronę 1.
 *
 * Reguła istnieje, bo strona jest współrzędną W ZBIORZE WYNIKÓW, a nie stanem
 * użytkownika: zawężenie filtra przy otwartej stronie 5 pytałoby o wiersze
 * 200-249 zbioru, który ma ich trzy - lista wyszłaby pusta z komunikatem
 * „brak wyników dla filtrów”, choć wyniki są. Podpis jest tu, a nie w tablicy
 * zależności efektu, żeby dołożenie nowego filtra bez dołożenia go do resetu
 * było widoczne w teście, a nie dopiero w zgłoszeniu redakcji.
 */
export function filtersSignature(f: PostsListFilters): string {
  return JSON.stringify([
    f.view,
    f.search,
    f.status,
    f.lang,
    f.author,
    f.trashFrom,
    f.trashTo,
    f.pageSize,
  ]);
}

/** Zakres wierszy dla PostgREST `.range()` - obustronnie DOMKNIĘTY. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Kolumna sortowania: kosz porządkuje się momentem usunięcia, nie edycji. */
export function sortColumnFor(view: PostsListView): "deleted_at" | "updated_at" {
  return view === "trash" ? "deleted_at" : "updated_at";
}

/**
 * Zawężenie do jednej zakładki. Kosz = wiersze ze stemplem `deleted_at`,
 * widok aktywny = wyłącznie bez stempla. Bez tego ogniwa usunięte wpisy
 * wracałyby na listę główną (miękkie usuwanie nie kasuje wiersza).
 */
export function applyDeletedScope<B extends PostsListQueryBuilder<B>>(
  q: B,
  view: PostsListView,
): B {
  return view === "trash" ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
}

/**
 * Wyrażenie `.or()` dla frazy szukającej: tytuł PL, tytuł EN albo slug.
 * Zwraca `null`, gdy po `trim` nie ma czego szukać - pusty filtr `%%`
 * przepuściłby wszystko, ale kosztowałby zbędne `ILIKE` po trzech kolumnach.
 */
export function searchOrExpression(rawTerm: string): string | null {
  const term = rawTerm.trim();
  if (!term) return null;
  // `escapeLike` zdejmuje `% _ , ( ) " \` - czyli znaki, którymi fraza mogłaby
  // dopisać WŁASNE warunki do wyrażenia `.or()` i wyjść poza tenanta.
  const like = `%${escapeLike(term)}%`;
  return `title_pl.ilike.${like},title_en.ilike.${like},slug.ilike.${like}`;
}

/**
 * Zawężenie po pokryciu językowym. „Obecny” język to tytuł NIE-null i NIE-pusty
 * - sam `not is null` przepuściłby wpisy z pustym stringiem, czyli dokładnie te,
 * których redaktor szuka jako brakujące.
 */
export function applyLangFilter<B extends PostsListQueryBuilder<B>>(q: B, lang: LangFilter): B {
  if (lang === "complete") {
    return q
      .not("title_pl", "is", null)
      .neq("title_pl", "")
      .not("title_en", "is", null)
      .neq("title_en", "");
  }
  if (lang === "has_pl") return q.not("title_pl", "is", null).neq("title_pl", "");
  if (lang === "has_en") return q.not("title_en", "is", null).neq("title_en", "");
  if (lang === "missing_any") {
    return q.or("title_pl.is.null,title_pl.eq.,title_en.is.null,title_en.eq.");
  }
  if (lang === "pl_only") {
    return q.not("title_pl", "is", null).neq("title_pl", "").or("title_en.is.null,title_en.eq.");
  }
  if (lang === "en_only") {
    return q.not("title_en", "is", null).neq("title_en", "").or("title_pl.is.null,title_pl.eq.");
  }
  return q;
}

/**
 * Granice zakresu kosza na `deleted_at`. Dzień „do” jest DOMKNIĘTY: input daje
 * samą datę, więc bez dosunięcia do końca doby wpisy usunięte tego dnia po
 * północy wypadałyby z wyniku i redaktor uznałby je za bezpowrotnie utracone.
 */
export function deletedAtRange(trashFrom: string, trashTo: string): { gte?: string; lte?: string } {
  const range: { gte?: string; lte?: string } = {};
  if (trashFrom) range.gte = new Date(trashFrom).toISOString();
  if (trashTo) {
    range.lte = new Date(new Date(trashTo).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
  }
  return range;
}

/**
 * Pełny łańcuch listy nałożony na `select(...).eq("tenant_id", ...)`.
 *
 * Kolejność ogniw jest zachowana z trasy, a filtr statusu i zakres dat są
 * ZALEŻNE OD ZAKŁADKI: kosz chowa selektor statusu (więc nie wolno go dokładać
 * z pamięci widoku aktywnego), a zakres dat kosza nie ma sensu poza koszem.
 */
export function applyPostsListFilters<B extends PostsListQueryBuilder<B>>(
  q: B,
  f: PostsListFilters,
): B {
  const isTrash = f.view === "trash";
  let out = applyDeletedScope(q, f.view);

  const search = searchOrExpression(f.search);
  if (search) out = out.or(search);

  if (!isTrash && f.status !== "all") out = out.eq("status", f.status);
  if (f.author !== "all") out = out.eq("author_id", f.author);

  out = applyLangFilter(out, f.lang);

  if (isTrash) {
    const range = deletedAtRange(f.trashFrom, f.trashTo);
    if (range.gte) out = out.gte("deleted_at", range.gte);
    if (range.lte) out = out.lte("deleted_at", range.lte);
  }

  const { from, to } = pageRange(f.page, f.pageSize);
  return out.order(sortColumnFor(f.view), { ascending: false }).range(from, to);
}

/**
 * Zapytanie liczące lukę parytetu PL/EN: OPUBLIKOWANE, nieusunięte wpisy bez
 * tytułu angielskiego. Dwujęzyczność jest wyróżnikiem serwisu, więc licznik
 * pilnuje dryfu na widoku listy.
 */
export function applyMissingEnCountFilters<B extends PostsListQueryBuilder<B>>(q: B): B {
  return q.eq("status", "published").is("deleted_at", null).or("title_en.is.null,title_en.eq.");
}

/** Filtry, które ustawia klik w licznik parytetu (razem z powrotem na stronę 1). */
export const PARITY_GAP_FILTERS: {
  status: StatusFilter;
  lang: LangFilter;
  page: number;
} = { status: "published", lang: "pl_only", page: 1 };

/** Czy pokazać pasek luki parytetu. W koszu nigdy - kosz nie jest do parytetu. */
export function shouldShowParityGap(view: PostsListView, missingEnCount: unknown): boolean {
  return view !== "trash" && typeof missingEnCount === "number" && missingEnCount > 0;
}

/** Wiersz listy w zakresie, którego dotyczą reguły językowe. */
export interface PostsListRow {
  title_pl: string | null;
  title_en: string | null;
  slug: string;
}

/**
 * Pokrycie językowe wiersza. Język jest „obecny”, gdy tytuł istnieje i po
 * `trim` nie jest pusty - tytuł ze spacji to dla czytelnika brak tytułu,
 * a plakietka „PL” obok takiego wpisu kłamałaby o gotowości wersji.
 */
export function coverageOf(p: Pick<PostsListRow, "title_pl" | "title_en">): {
  pl: boolean;
  en: boolean;
} {
  return {
    pl: !!(p.title_pl && p.title_pl.trim()),
    en: !!(p.title_en && p.title_en.trim()),
  };
}

/**
 * Język, w którym lista pokazuje tytuły i w którym OTWIERA edytor.
 *
 * Filtr językowy PRZEJMUJE język listy: skoro redaktor zawęził widok do „tylko
 * EN", to chce widzieć i edytować wersję angielską, choćby panel miał UI po
 * polsku. Bez filtra decyduje język interfejsu.
 */
export function viewLangFor(lang: LangFilter, uiLang: string | null | undefined): "pl" | "en" {
  if (lang === "has_en" || lang === "en_only") return "en";
  if (lang === "has_pl" || lang === "pl_only") return "pl";
  return (uiLang ?? "pl").startsWith("en") ? "en" : "pl";
}

/**
 * Tytuł wpisu do KOMUNIKATU (kosz, przywracanie, usuwanie trwałe). Fallback na
 * slug, nie na drugi język: dialog „Usunąć trwale?” musi wskazać konkretny
 * wiersz nawet dla wpisu bez żadnego tytułu.
 */
export function dialogTitleOf(p: PostsListRow, viewLang: "pl" | "en"): string {
  return (viewLang === "en" ? p.title_en : p.title_pl) || p.slug;
}

/**
 * Tytuł wpisu do WIERSZA tabeli: język widoku, potem drugi język, a gdy oba
 * puste - `null` (wiersz rysuje wtedy kursywą „bez tytułu”). Fallback na drugi
 * język jest tu celowy: pusty wiersz w tabeli wygląda jak uszkodzone dane.
 */
export function rowTitleOf(
  p: Pick<PostsListRow, "title_pl" | "title_en">,
  viewLang: "pl" | "en",
): string | null {
  const primary = viewLang === "en" ? p.title_en : p.title_pl;
  const secondary = viewLang === "en" ? p.title_pl : p.title_en;
  return primary || secondary || null;
}

/**
 * Autorzy obszaru roboczego pod klucz `id`. Lista wpisów trzyma w wierszu samo
 * `author_id`, a nazwisko dokłada z osobnego zapytania - bez mapy każdy wiersz
 * przeszukiwałby tablicę autorów liniowo przy każdym renderze.
 */
export function authorMapOf(
  authors: readonly TenantAuthor[] | null | undefined,
): Map<string, TenantAuthor> {
  return new Map((authors ?? []).map((a) => [a.id, a]));
}

/**
 * Autor wiersza albo `null`. Dwa osobne przypadki dają ten sam wynik i oba są
 * normalne: wpis bez autora (import z WordPressa) i autor spoza bieżącej listy
 * (odszedł z zespołu, należy do innego obszaru). Etykieta schodzi wtedy na
 * „-”, zamiast wysypać wiersz na odczycie z niezdefiniowanego obiektu.
 */
export function authorOf(
  row: { author_id: string | null },
  authors: ReadonlyMap<string, TenantAuthor>,
): TenantAuthor | null {
  if (!row.author_id) return null;
  return authors.get(row.author_id) ?? null;
}

/**
 * Czy pod tą ścieżką trasa-rodzic rysuje LISTĘ, czy oddaje miejsce dziecku.
 *
 * `/admin/posts` jest trasą układu dla `new`, `$slug` i `calendar`. Dopasowanie
 * musi być DOKŁADNE: warunek „zaczyna się od” wyrenderowałby listę razem
 * z edytorem pod nim, a dwie tabele naraz to nie tylko bałagan - to drugi
 * komplet zapytań i drugi stan zaznaczenia.
 */
export function showsPostsList(pathname: string): boolean {
  return pathname === "/admin/posts";
}

/**
 * Termin publikacji do pokazania przy statusie - TYLKO dla wpisu
 * zaplanowanego. `publish_at` bywa niepustą pozostałością po wpisie, który
 * wrócił do szkicu; pokazanie go przy szkicu obiecywałoby publikację, której
 * nikt nie zaplanował.
 */
export function scheduledPublishAt(p: {
  status: string;
  publish_at: string | null;
}): string | null {
  return p.status === "scheduled" && p.publish_at ? p.publish_at : null;
}

/**
 * Znacznik czasu w kolumnie daty: w koszu moment USUNIĘCIA, poza koszem
 * ostatnia EDYCJA. To ta sama kolumna, po której zakładka filtruje i sortuje -
 * pokazanie innej sprawiłoby, że zakres dat kosza wygląda na zepsuty (wiersze
 * z datami spoza zakresu), choć filtruje poprawnie.
 */
export function rowTimestampOf(
  p: { updated_at: string; deleted_at: string | null },
  view: PostsListView,
): string {
  return view === "trash" && p.deleted_at ? p.deleted_at : p.updated_at;
}

/** Stan pola „zaznacz wszystkie” - dokładnie to, co przyjmuje `Checkbox`. */
export type SelectAllState = true | false | "indeterminate";

/** Czy WSZYSTKIE wiersze bieżącej strony są zaznaczone (pusta strona: nie). */
export function isAllSelected(allIds: readonly string[], selected: ReadonlySet<string>): boolean {
  return allIds.length > 0 && allIds.every((id) => selected.has(id));
}

export function selectAllState(
  allIds: readonly string[],
  selected: ReadonlySet<string>,
): SelectAllState {
  if (isAllSelected(allIds, selected)) return true;
  return selected.size > 0 ? "indeterminate" : false;
}

/** Przełącz jeden wiersz. Zwraca NOWY zbiór - stan Reacta musi zmienić tożsamość. */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Nowe zaznaczenie po kliknięciu w nagłówkowy checkbox: pełna strona ->
 * czyścimy, inaczej -> zaznaczamy CAŁĄ bieżącą stronę.
 */
export function toggleAllSelected(
  allIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  return isAllSelected(allIds, selected) ? new Set() : new Set(allIds);
}

/**
 * Statusy dostępne w akcji masowej. Publikacja hurtowa zostaje uprawnieniem
 * administratora - reszta redakcji zgłasza do recenzji. Serwer egzekwuje to
 * niezależnie; ta lista tylko nie pokazuje przycisku, który i tak odbije.
 */
export function bulkStatusesFor(isAdmin: boolean): BulkStatus[] {
  return isAdmin
    ? ["draft", "pending_review", "published", "archived"]
    : ["draft", "pending_review", "archived"];
}

/**
 * Klucz komunikatu pustej listy. Rozróżnia „widok jest pusty” od „filtry
 * wycięły wszystko" - inaczej redaktor z aktywnym filtrem widziałby „brak
 * wpisów" i uznał, że treści zniknęły z bazy.
 */
export function emptyStateKey(
  view: PostsListView,
  viewCount: number | null | undefined,
): "admin.list.noResults" | "admin.list.trashEmpty" | "admin.posts.empty" {
  if (viewCount) return "admin.list.noResults";
  return view === "trash" ? "admin.list.trashEmpty" : "admin.posts.empty";
}
