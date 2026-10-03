// Zawężenie listy wpisów do terminu taksonomii (kategorii albo tagu) BEZ
// przewożenia identyfikatorów wpisów przez adres URL.
//
// CO TU NAPRAWIAMY. Warstwa zapytań miała cztery kopie tego samego kształtu:
// najpierw pełny odczyt tabeli pośredniej (`post_categories` / `post_tags`) bez
// `.limit()`, potem cała pobrana lista identyfikatorów wkładana do `.in("id",
// ...)`, a stronicowanie nakładane dopiero na to DRUGIE zapytanie. Stronicowanie
// zabezpieczało więc zapytanie, które nie było problemem, a pierwsze rosło
// liniowo z liczbą wpisów w kategorii. Identyfikator to 36 znaków plus
// separator, czyli około 38 bajtów na wpis w linii żądania - przy paruset
// wpisach archiwum kategorii nie zwalnia, tylko PRZESTAJE DZIAŁAĆ, a razem
// z nim publiczna trasa SSR, którą widzą wyszukiwarki.
//
// DLACZEGO ZAGNIEŻDŻONY SELECT, A NIE `.limit()` NA TABELI POŚREDNIEJ.
// Ogranicznik na zapytaniu pośrednim zamieniłby awarię w ciche gubienie wpisów:
// archiwum wyglądałoby na kompletne, a nie byłoby - i nikt by tego nie zauważył.
// PostgREST ma zadeklarowane klucze obce dla obu tabel pośrednich, więc
// złączenie da się zrobić PO STRONIE BAZY (`post_categories!inner(category_id)`
// z filtrem po `post_categories.category_id`). Zostaje JEDNO zapytanie, o stałej
// długości linii żądania, z sortowaniem i limitem tam, gdzie mają działać.
//
// DLACZEGO JEDEN MODUŁ, A NIE CZTERY ŁATKI. Cztery kopie jednego błędu to
// argument za jednym rozwiązaniem. Ten moduł (`postsNarrowedToTaxonomy` dla
// archiwów i bloków, `postsConstrainedByTaxonomy` dla widżetów buildera - niżej)
// jest jedynym miejscem, które zna nazwy osadzeń i nazwy kolumn filtra.
//
// UWAGA DLA PISZĄCYCH TESTY: literówka w NAZWIE OSADZENIA nie jest błędem
// kompilacji - `select("id, nie_ma_takiej_tabeli!inner(x)")` przechodzi przez
// tsc, a kolumny obok zachowują poprawne typy. Jedyną obroną jest asercja na
// DOSŁOWNYM napisie `select` w teście i dlatego testy modułów korzystających
// z tego pliku sprawdzają podciąg `!inner`, a nie tylko kształt wyniku.
import { supabase } from "@/integrations/supabase/client";

export type TaxonomyKind = "category" | "tag";

/** Termin taksonomii, do którego zawężamy listę wpisów. */
export interface TaxonomyNarrowing {
  readonly kind: TaxonomyKind;
  readonly termIds: readonly string[];
}

const CATEGORY_PIVOT_EMBED = "post_categories!inner(category_id)";
const CATEGORY_PIVOT_FILTER = "post_categories.category_id";
const TAG_PIVOT_EMBED = "post_tags!inner(tag_id)";
const TAG_PIVOT_FILTER = "post_tags.tag_id";

/**
 * Zapytanie o `posts` zawężone do terminów taksonomii przez złączenie w bazie.
 *
 * Lista w `.in(...)` niesie identyfikatory TERMINÓW (kategorii albo tagów),
 * czyli wartość ograniczoną konfiguracją widżetu albo jedynką dla archiwum -
 * nigdy identyfikatory WPISÓW, których liczba rośnie z sukcesem serwisu.
 *
 * Zwrócony builder jest zwykłym builderem PostgREST: wołający dokłada własne
 * `.eq()`, `.order()`, `.limit()` i `.range()` na tym SAMYM zapytaniu.
 */
export function postsNarrowedToTaxonomy<C extends string>(
  cols: C,
  narrowing: TaxonomyNarrowing,
  options?: { count?: "exact"; head?: boolean },
) {
  const base = supabase.from("posts");
  return narrowing.kind === "category"
    ? base
        .select(`${cols}, ${CATEGORY_PIVOT_EMBED}` as const, options)
        .in(CATEGORY_PIVOT_FILTER, [...narrowing.termIds])
    : base
        .select(`${cols}, ${TAG_PIVOT_EMBED}` as const, options)
        .in(TAG_PIVOT_FILTER, [...narrowing.termIds]);
}

// ---------------------------------------------------------------------------
// WARUNKI WŁĄCZAJĄCE I WYKLUCZAJĄCE - widżety buildera (slider, lista wpisów,
// lista oceniana, pasek newsów).
//
// CO TU NAPRAWIAMY. Widżety buildera miały TEN SAM kształt błędu, co cztery
// kopie opisane wyżej, tylko w obu kierunkach naraz: tabela pośrednia czytana
// bez `.limit()`, a pobrane identyfikatory wpisów wkładane do `.in("id", ...)`
// (filtr włączający) albo do `.not("id", "in", ...)` (filtr wykluczający).
// Kategoria z kilkuset wpisami w KTÓRYMKOLWIEK z tych pól przepełniała linię
// żądania i widżet na publicznej stronie przestawał się renderować. Wykluczenie
// jest tu tak samo groźne jak włączenie: wystarczy, że redakcja wytnie z listy
// dużą kategorię („sponsorowane", „archiwum").
//
// JAK. Włączenie to osadzenie `!inner()` z filtrem po kolumnie TERMINU - ten
// sam mechanizm, co `postsNarrowedToTaxonomy`. Wykluczenie to anty-złączenie
// PostgREST (od v11; projekt stoi na 14.5 - `PostgrestVersion` w
// `integrations/supabase/types.ts`): osadzenie BEZ `!inner`, filtr po kolumnie
// terminu zawężający osadzone wiersze i `alias=is.null`, czyli „wpis nie ma ANI
// JEDNEGO przypisania do wykluczonych terminów". Oba osadzenia są PUSTE (`()`): służą
// wyłącznie do filtrowania, więc PostgREST nie dokłada ich do odpowiedzi
// i wiersze wpadające do cache mają dokładnie kolumny z `cols`.
//
// Każdy warunek dostaje WŁASNY alias, bo ta sama tabela pośrednia potrafi
// wystąpić dwa razy (włącz kategorię A, wyklucz kategorię B), a filtr osadzenia
// adresuje osadzenie po aliasie. Alias wynika z pozycji warunku, więc łańcuch
// zapytania jest deterministyczny (testy porównują go dosłownie).
// ---------------------------------------------------------------------------

/** Czy wpis MUSI mieć któryś z terminów (`include`), czy NIE MOŻE mieć żadnego (`exclude`). */
export type TaxonomyConstraintMode = "include" | "exclude";

/** Jeden warunek taksonomii nakładany na listę wpisów. */
export interface TaxonomyConstraint extends TaxonomyNarrowing {
  readonly mode: TaxonomyConstraintMode;
}

const PIVOT_TABLES: Readonly<Record<TaxonomyKind, { table: string; termColumn: string }>> = {
  category: { table: "post_categories", termColumn: "category_id" },
  tag: { table: "post_tags", termColumn: "tag_id" },
};

/**
 * Zapytanie o `posts` z dowolną liczbą warunków taksonomii, w CAŁOŚCI po
 * stronie bazy: linia żądania niesie identyfikatory TERMINÓW (ograniczone
 * konfiguracją widżetu), nigdy identyfikatory WPISÓW.
 *
 * Kilka warunków łączy się koniunkcją (kategoria ORAZ tag ORAZ brak
 * wykluczonych), a terminy wewnątrz jednego warunku - alternatywą (którakolwiek
 * z wybranych kategorii). To ta sama algebra, którą widżety liczyły wcześniej
 * na zbiorach identyfikatorów.
 *
 * Warunek włączający z PUSTĄ listą terminów zostaje i daje pusty wynik (wpis
 * nie może mieć „któregoś z zera terminów"); wołający, który wie to wcześniej,
 * powinien w ogóle nie pytać. Warunek wykluczający bez terminów niczego nie
 * wyklucza, więc nie płacimy za jego złączenie.
 *
 * Typ wiersza to typ samych `cols` - i jest to typ PRAWDZIWY, nie wygodny:
 * puste osadzenia nie trafiają do odpowiedzi PostgREST.
 */
export function postsConstrainedByTaxonomy<C extends string>(
  cols: C,
  constraints: readonly TaxonomyConstraint[],
  options?: { count?: "exact"; head?: boolean },
) {
  const embeds = constraints
    .filter((c) => c.mode === "include" || c.termIds.length > 0)
    .map((c, i) => ({
      constraint: c,
      alias: `tx_${c.mode === "include" ? "inc" : "exc"}_${c.kind}_${i}`,
      pivot: PIVOT_TABLES[c.kind],
    }));
  const select = [
    cols,
    ...embeds.map(
      ({ constraint, alias, pivot }) =>
        `${alias}:${pivot.table}${constraint.mode === "include" ? "!inner" : ""}()`,
    ),
  ].join(", ");
  // Rzutowanie na `C`: patrz ostatni akapit opisu funkcji.
  let q = supabase.from("posts").select(select as C, options);
  for (const { constraint, alias, pivot } of embeds) {
    q = q.in(`${alias}.${pivot.termColumn}`, [...constraint.termIds]);
    if (constraint.mode === "exclude") q = q.is(alias, null);
  }
  return q;
}

/**
 * Slugi -> identyfikatory terminów JEDNYM zapytaniem do słownika (`categories`
 * albo `tags`). Lista slugów pochodzi z konfiguracji widżetu, więc jest
 * ograniczona. Błąd odczytu RZUCA: cicha pustka w tym miejscu kasowałaby
 * wykluczenie i pokazywała wpisy, które redakcja świadomie wycięła.
 */
export async function taxonomyTermIdsBySlug(
  kind: TaxonomyKind,
  slugs: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = Array.from(new Set(slugs));
  if (unique.length === 0) return new Map();
  const { data, error } =
    kind === "category"
      ? await supabase.from("categories").select("id, slug").in("slug", unique)
      : await supabase.from("tags").select("id, slug").in("slug", unique);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.slug, r.id] as const));
}

/** Filtr taksonomii widżetu w postaci, w jakiej leży w treści: listy slugów. */
export interface TaxonomySlugFilter {
  readonly includeCategories?: readonly string[];
  readonly includeTags?: readonly string[];
  readonly excludeCategories?: readonly string[];
  readonly excludeTags?: readonly string[];
}

function knownTermIds(bySlug: ReadonlyMap<string, string>, slugs: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const slug of slugs) {
    const id = bySlug.get(slug);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Slugi z konfiguracji widżetu -> warunki dla `postsConstrainedByTaxonomy`.
 *
 * Najwyżej DWA zapytania (słownik kategorii i słownik tagów), równolegle;
 * slugi włączające i wykluczające tego samego rodzaju jadą jednym zapytaniem.
 * Bez slugów - zero zapytań i pusta lista warunków.
 *
 * `null` znaczy: filtr włączający nie trafił w ŻADEN istniejący termin, więc
 * wynik jest pusty z definicji i zapytanie o wpisy nie musi lecieć. Nieznany
 * slug wykluczający po prostu niczego nie wyklucza. Błąd odczytu słownika
 * RZUCA (patrz `taxonomyTermIdsBySlug`) - o tym, czy zamienić go w pustą listę,
 * decyduje wołający, bo tylko on zna politykę błędów swojego widżetu.
 */
export async function taxonomyConstraintsFromSlugs(
  filter: TaxonomySlugFilter,
): Promise<TaxonomyConstraint[] | null> {
  const includeCategories = filter.includeCategories ?? [];
  const includeTags = filter.includeTags ?? [];
  const excludeCategories = filter.excludeCategories ?? [];
  const excludeTags = filter.excludeTags ?? [];
  const [categoryIds, tagIds] = await Promise.all([
    taxonomyTermIdsBySlug("category", [...includeCategories, ...excludeCategories]),
    taxonomyTermIdsBySlug("tag", [...includeTags, ...excludeTags]),
  ]);

  const constraints: TaxonomyConstraint[] = [];
  const parts: ReadonlyArray<
    readonly [TaxonomyConstraintMode, TaxonomyKind, readonly string[], ReadonlyMap<string, string>]
  > = [
    ["include", "category", includeCategories, categoryIds],
    ["include", "tag", includeTags, tagIds],
    ["exclude", "category", excludeCategories, categoryIds],
    ["exclude", "tag", excludeTags, tagIds],
  ];
  for (const [mode, kind, slugs, bySlug] of parts) {
    if (slugs.length === 0) continue;
    const termIds = knownTermIds(bySlug, slugs);
    if (termIds.length === 0) {
      if (mode === "include") return null;
      continue;
    }
    constraints.push({ mode, kind, termIds });
  }
  return constraints;
}
