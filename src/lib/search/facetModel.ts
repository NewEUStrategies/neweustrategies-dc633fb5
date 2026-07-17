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
  SearchMatchMode,
  SearchScope,
  TaxonomyDim,
  AutosuggestItem,
} from "@/lib/queries/archives";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";

/** Sekcje wyników wyszukiwarki premium (zakładki na /search). */
export type SearchTab = "all" | "titles" | "types" | "topics" | "people";

export const SEARCH_TABS: readonly SearchTab[] = [
  "all",
  "titles",
  "types",
  "topics",
  "people",
] as const;

/** Zserializowane parametry URL strony /search (źródło prawdy stanu wyszukiwarki). */
export interface SearchUrl {
  q: string;
  spec?: string; // kind=category  (specjalizacja)
  type?: string; // kind=pub_type  (typ publikacji)
  region?: string; // kind=region  (region/państwo)
  topic?: string; // kind=topic
  project?: string; // kind=project
  series?: string; // kind=series
  org?: string; // kind=organization
  author?: string;
  format?: string;
  lang?: "pl" | "en";
  access?: string;
  from?: string;
  to?: string;
  year?: string;
  sort?: SearchSort;
  /** Zaawansowany tryb dopasowania (all domyślny - nieserializowany). */
  match?: SearchMatchMode;
  /** Zakres dopasowania (all domyślny - nieserializowany). */
  scope?: SearchScope;
  /** Aktywna sekcja wyników (all domyślna - nieserializowana). */
  tab?: SearchTab;
}

/** Wymiar taksonomii → nazwa parametru URL (pojedynczy wybór na wymiar). */
export const DIM_PARAM: Record<TaxonomyDim, keyof SearchUrl> = {
  category: "spec",
  pub_type: "type",
  region: "region",
  topic: "topic",
  project: "project",
  series: "series",
  organization: "org",
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
  "organization",
  "format",
  "lang",
  "access",
  "year",
] as const;

/** Buduje SearchFilters (wejście RPC) z parametrów URL. Rok mapuje się na
 *  zakres dat; jawne from/to mają pierwszeństwo nad rokiem. Zakładka "titles"
 *  wymusza zakres tytułów niezależnie od parametru scope. */
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
  const scope: SearchScope | undefined =
    u.tab === "titles" ? "title" : u.scope === "title" ? "title" : undefined;
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
    match: u.match && u.match !== "all" ? u.match : undefined,
    scope,
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
  dim: FacetDim | "date" | "match" | "scope";
  /** Wartość identyfikująca (id termu / slug / kod), do dopasowania etykiety. */
  value: string;
}

/** Wyprowadza listę aktywnych filtrów z parametrów URL (kolejność jak w panelu).
 *  Tryby zaawansowane (match/scope) też są usuwalnymi chipami - użytkownik
 *  widzi, że działa np. dokładna fraza, i jednym kliknięciem wraca do domyślnych. */
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
  if (u.match && u.match !== "all") out.push({ keys: ["match"], dim: "match", value: u.match });
  if (u.scope && u.scope !== "all") out.push({ keys: ["scope"], dim: "scope", value: u.scope });
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
// Cztery premium sekcje podpowiedzi - wspólne dla widgetu nagłówka i strony
// /search: Tytuły (publikacje), Rodzaje treści (typ/format/dostępność/język),
// Tematyka (pozostałe termy taksonomii), Osoby i organizacje.

export type SuggestBucket = "titles" | "contentTypes" | "topics" | "peopleOrg";

export const SUGGEST_BUCKET_ORDER: readonly SuggestBucket[] = [
  "titles",
  "contentTypes",
  "topics",
  "peopleOrg",
] as const;

export function suggestBucketOf(kind: AutosuggestItem["kind"]): SuggestBucket {
  if (kind === "post") return "titles";
  if (kind === "author" || kind === "organization") return "peopleOrg";
  if (kind === "format" || kind === "pub_type" || kind === "access" || kind === "lang") {
    return "contentTypes";
  }
  return "topics";
}

/** Etykiety sekcji podpowiedzi (widget buildera dostaje lang propem, strona
 *  /search też - jedno źródło prawdy zamiast dwóch kopii tłumaczeń). */
export const SUGGEST_BUCKET_LABELS: Record<"pl" | "en", Record<SuggestBucket, string>> = {
  pl: {
    titles: "Tytuły",
    contentTypes: "Rodzaje treści",
    topics: "Tematyka",
    peopleOrg: "Osoby i organizacje",
  },
  en: {
    titles: "Titles",
    contentTypes: "Content types",
    topics: "Topics",
    peopleOrg: "People & organizations",
  },
};

/** Wspólne uporządkowanie sugestii (tytuły → rodzaje treści → tematyka →
 *  osoby i organizacje), spójne między renderem a nawigacją klawiaturą rodzica. */
export function orderSuggestions(items: AutosuggestItem[]): AutosuggestItem[] {
  return [...items].sort((a, b) => {
    const ga = SUGGEST_BUCKET_ORDER.indexOf(suggestBucketOf(a.kind));
    const gb = SUGGEST_BUCKET_ORDER.indexOf(suggestBucketOf(b.kind));
    return ga - gb || b.score - a.score;
  });
}

/** Statyczny cel nawigacji podpowiedzi: publikacja → permalink /post/<slug>;
 *  autor / term taksonomii / wymiar wyliczany → /search z właściwym filtrem.
 *  Termy taksonomii identyfikuje ID (parametry spec/type/… trafiają do RPC
 *  jako uuid[] - slug w URL wywracał zapytanie). */
export function suggestionHref(it: AutosuggestItem): string {
  const kind = it.kind as string;
  if (kind === "post" && it.slug) return `/post/${it.slug}`;
  const patch: Record<string, string> = {};
  if (kind === "author") {
    if (it.id) patch.author = it.id;
  } else if (kind === "format" && it.slug) patch.format = it.slug;
  else if (kind === "access" && it.slug) patch.access = it.slug;
  else if (kind === "lang" && it.slug) patch.lang = it.slug;
  else if (kind === "year" && it.slug) patch.year = it.slug;
  else {
    const param = (DIM_PARAM as Record<string, keyof SearchUrl>)[kind];
    const value = it.id ?? it.slug;
    if (param && value) patch[param as string] = value;
  }
  const qs = new URLSearchParams(patch).toString();
  return qs ? `/search?${qs}` : "/search";
}

export const AUTOSUGGEST_LISTBOX_ID = "search-autosuggest-listbox";
export const autosuggestOptionId = (i: number) => `search-suggest-opt-${i}`;
