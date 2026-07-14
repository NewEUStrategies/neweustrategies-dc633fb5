// Czyste (bez Reacta) helpery modelu fasetowego wyszukiwania archiwum.
// Współdzielone przez stronę /search i testy jednostkowe: mapowanie wymiar ↔
// parametr URL, grupowanie faset, porządkowanie hierarchii (region → państwo)
// oraz wyprowadzanie listy aktywnych filtrów (pod usuwalne chipy).
import type { TFunction } from "i18next";
import type {
  FacetValue,
  FacetDim,
  SearchFilters,
  SearchSort,
  TaxonomyDim,
  AutosuggestItem,
} from "@/lib/queries/archives";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";

/** Zserializowane parametry URL strony /search (źródło prawdy stanu wyszukiwarki). */
export interface SearchUrl {
  q: string;
  spec?: string; // kind=category  (specjalizacja)
  type?: string; // kind=pub_type  (typ publikacji)
  region?: string; // kind=region  (region/państwo)
  topic?: string; // kind=topic
  project?: string; // kind=project
  series?: string; // kind=series
  author?: string;
  format?: string;
  lang?: "pl" | "en";
  access?: string;
  from?: string;
  to?: string;
  year?: string;
  sort?: SearchSort;
}

/** Wymiar taksonomii → nazwa parametru URL (pojedynczy wybór na wymiar). */
export const DIM_PARAM: Record<TaxonomyDim, keyof SearchUrl> = {
  category: "spec",
  pub_type: "type",
  region: "region",
  topic: "topic",
  project: "project",
  series: "series",
};

/** Odwrotna mapa: parametr URL → wymiar taksonomii. */
export const PARAM_DIM: Partial<Record<keyof SearchUrl, FacetDim>> = Object.fromEntries(
  Object.entries(DIM_PARAM).map(([dim, param]) => [param, dim as FacetDim]),
) as Partial<Record<keyof SearchUrl, FacetDim>>;

/** Kolejność wyświetlania grup faset w panelu (jak think-tank/RUSI: typ, region, temat…). */
export const FACET_ORDER: readonly FacetDim[] = [
  "pub_type",
  "category",
  "region",
  "topic",
  "project",
  "series",
  "author",
  "format",
  "lang",
  "access",
  "year",
] as const;

/** Buduje SearchFilters (wejście RPC) z parametrów URL. Rok mapuje się na
 *  zakres dat; jawne from/to mają pierwszeństwo nad rokiem. */
export function urlToFilters(u: SearchUrl): SearchFilters {
  const terms = TAXONOMY_DIMS.map((dim) => u[DIM_PARAM[dim]] as string | undefined).filter(
    (v): v is string => !!v,
  );
  let dateFrom = u.from || undefined;
  let dateTo = u.to || undefined;
  if (u.year && !dateFrom && !dateTo) {
    dateFrom = `${u.year}-01-01`;
    dateTo = `${u.year}-12-31`;
  }
  return {
    q: u.q ?? "",
    authorId: u.author || undefined,
    dateFrom,
    dateTo,
    terms: terms.length > 0 ? terms : undefined,
    format: u.format || undefined,
    lang: u.lang || undefined,
    access: u.access || undefined,
    sort: u.sort ?? "relevance",
  };
}

/** Grupuje płaską listę faset po wymiarze, zachowując malejący porządek liczności. */
export function groupFacets(facets: FacetValue[]): Map<FacetDim, FacetValue[]> {
  const byDim = new Map<FacetDim, FacetValue[]>();
  for (const f of facets) {
    const arr = byDim.get(f.dim) ?? [];
    arr.push(f);
    byDim.set(f.dim, arr);
  }
  for (const arr of byDim.values()) {
    arr.sort((a, b) => b.count - a.count || a.label_pl.localeCompare(b.label_pl));
  }
  return byDim;
}

/** Porządkuje wartości hierarchiczne (region → państwo) w listę z głębokością:
 *  korzeń, potem jego potomkowie. Wartość jest korzeniem, gdy nie ma rodzica
 *  albo jej rodzic nie jest widoczny w zbiorze (np. odcięty przez licznik). */
export function orderTree(values: FacetValue[]): Array<{ value: FacetValue; depth: number }> {
  const ids = new Set(values.map((v) => v.id).filter((id): id is string => !!id));
  const childrenOf = new Map<string | null, FacetValue[]>();
  for (const v of values) {
    const parentVisible = v.parentId && ids.has(v.parentId);
    const key = parentVisible ? v.parentId : null;
    const arr = childrenOf.get(key) ?? [];
    arr.push(v);
    childrenOf.set(key, arr);
  }
  const sortFn = (a: FacetValue, b: FacetValue) =>
    b.count - a.count || a.label_pl.localeCompare(b.label_pl);
  const out: Array<{ value: FacetValue; depth: number }> = [];
  const walk = (key: string | null, depth: number) => {
    const kids = (childrenOf.get(key) ?? []).slice().sort(sortFn);
    for (const v of kids) {
      out.push({ value: v, depth });
      if (v.id) walk(v.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Pojedynczy aktywny filtr do wyrenderowania jako usuwalny chip. */
export interface ActiveSelection {
  /** Klucz(e) URL do wyczyszczenia po usunięciu chipa. */
  keys: (keyof SearchUrl)[];
  dim: FacetDim | "date";
  /** Wartość identyfikująca (id termu / slug / kod), do dopasowania etykiety. */
  value: string;
}

/** Wyprowadza listę aktywnych filtrów z parametrów URL (kolejność jak w panelu). */
export function activeSelections(u: SearchUrl): ActiveSelection[] {
  const out: ActiveSelection[] = [];
  for (const dim of TAXONOMY_DIMS) {
    const param = DIM_PARAM[dim];
    const val = u[param] as string | undefined;
    if (val) out.push({ keys: [param], dim, value: val });
  }
  if (u.author) out.push({ keys: ["author"], dim: "author", value: u.author });
  if (u.format) out.push({ keys: ["format"], dim: "format", value: u.format });
  if (u.lang) out.push({ keys: ["lang"], dim: "lang", value: u.lang });
  if (u.access) out.push({ keys: ["access"], dim: "access", value: u.access });
  if (u.year) out.push({ keys: ["year"], dim: "year", value: u.year });
  // Zakres dat pokazujemy jako jeden chip (chyba że pochodzi z roku).
  if (!u.year && (u.from || u.to)) {
    out.push({ keys: ["from", "to"], dim: "date", value: `${u.from ?? "…"} – ${u.to ?? "…"}` });
  }
  return out;
}

/** Czy jakikolwiek filtr (poza samą frazą) jest aktywny. */
export function hasAnyFilter(u: SearchUrl): boolean {
  return activeSelections(u).length > 0;
}

/** Zbiera etykiety termów/autorów z faset i wyników do cache'a id→etykieta,
 *  by chipy miały nazwę nawet przy zerowej liczności bieżącego zbioru. */
export function collectLabels(
  facets: FacetValue[],
  lang: "pl" | "en",
  into: Record<string, string>,
): Record<string, string> {
  const next = { ...into };
  for (const f of facets) {
    if (f.id) next[f.id] = lang === "en" ? f.label_en || f.label_pl : f.label_pl || f.label_en;
    // Wymiary bez id (format/lang/access/year) klucz po slugu.
    if (!f.id && f.slug) next[`${f.dim}:${f.slug}`] = lang === "en" ? f.label_en : f.label_pl;
  }
  return next;
}

/** Lokalizowana etykieta wartości fasety zależnie od wymiaru (format/lang/
 *  access tłumaczone z i18n, rok dosłownie, reszta z etykiet termu). */
export function facetLabel(f: FacetValue, lang: "pl" | "en", t: TFunction): string {
  switch (f.dim) {
    case "format":
      return t(`search.format.${f.slug}`, { defaultValue: f.slug });
    case "lang":
      return t(`search.lang.${f.slug}`, { defaultValue: f.slug });
    case "access":
      return t(`search.access.${f.slug}`, { defaultValue: f.slug });
    case "year":
      return f.slug;
    default:
      return (lang === "en" ? f.label_en || f.label_pl : f.label_pl || f.label_en) || f.slug;
  }
}

// ---------- AUTOSUGGEST (model prezentacji) --------------------------------

type SuggestGroup = "posts" | "authors" | "terms";

const suggestGroupOf = (it: AutosuggestItem): SuggestGroup =>
  it.kind === "post" ? "posts" : it.kind === "author" ? "authors" : "terms";

export const SUGGEST_GROUP_ORDER: readonly SuggestGroup[] = ["posts", "authors", "terms"] as const;

/** Wspólne uporządkowanie sugestii (posty → autorzy → termy), spójne między
 *  renderem a nawigacją klawiaturą rodzica. */
export function orderSuggestions(items: AutosuggestItem[]): AutosuggestItem[] {
  return [...items].sort((a, b) => {
    const ga = SUGGEST_GROUP_ORDER.indexOf(suggestGroupOf(a));
    const gb = SUGGEST_GROUP_ORDER.indexOf(suggestGroupOf(b));
    return ga - gb || b.score - a.score;
  });
}

export const suggestGroup = suggestGroupOf;
export const AUTOSUGGEST_LISTBOX_ID = "search-autosuggest-listbox";
export const autosuggestOptionId = (i: number) => `search-suggest-opt-${i}`;
