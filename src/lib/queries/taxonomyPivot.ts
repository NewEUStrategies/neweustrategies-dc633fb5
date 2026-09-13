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
// argument za jednym rozwiązaniem. `postsNarrowedToTaxonomy` jest jedynym
// miejscem, które zna nazwę osadzenia i nazwę kolumny filtra.
//
// UWAGA DLA PISZĄCYCH TESTY: literówka w NAZWIE OSADZENIA nie jest błędem
// kompilacji - `select("id, nie_ma_takiej_tabeli!inner(x)")` przechodzi przez
// tsc, a kolumny obok zachowują poprawne typy. Jedyną obroną jest asercja na
// DOSŁOWNYM napisie `select` w teście i dlatego testy tych trzech modułów
// sprawdzają podciąg `!inner`, a nie tylko kształt wyniku.
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
