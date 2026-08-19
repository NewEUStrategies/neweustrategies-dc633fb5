// JEDEN OPIS TEGO, KTÓRE LEADY SĄ NA LIŚCIE I W JAKIEJ KOLEJNOŚCI.
//
// DLACZEGO TEN PLIK ISTNIEJE. Reguła filtrowania i sortowania leadów żyła
// w repo DWA RAZY, w dwóch nieprzystających postaciach:
//
//   * `lib/crm/leadViews.ts`   - `applyLeadFilter` / `applyLeadSort`, czyli
//     predykaty na TABLICY WIERSZY po stronie klienta,
//   * `lib/crm.functions.ts`   - `applyLeadListFilters` / `applyLeadListSort`,
//     czyli budowa ZAPYTANIA PostgREST po stronie serwera.
//
// Żadna z kopii nie odwoływała się do drugiej, a klientowa nie miała ANI
// JEDNEGO wywołania produkcyjnego (trasa `/admin/crm` liczy filtr i sort w SQL,
// bo przy paginacji serwerowej inaczej strona i total kłamałyby o zbiorze).
// Martwa kopia reguły to najgorszy wariant duplikatu: rozjeżdża się bezgłośnie,
// bo nic jej nie wykonuje. I rozjechała się - w sortowaniu:
//
//   | sort               | serwer (SQL)                    | klient (JS, przed)      |
//   | followUp malejąco  | puste na KOŃCU (nullsFirst:false)| puste na POCZĄTKU      |
//   | company/country ↑  | puste na końcu                  | `?? ""` -> na początku  |
//   | name               | first_name, last_name, id       | sklejone imię+nazwisko  |
//   | równe wartości     | tiebreaker po `id`              | brak (kolejność losowa) |
//
// CO ROBI TEN MODUŁ. Trzyma OPIS (dane), nie dwie implementacje:
//
//   parametry listy  ->  buildLeadFilterSpec()  ->  LeadPredicate[]
//                                                     |            |
//                            applyLeadFilterSpec(q)   |            |  matchesLeadRow(row)
//                            (jedyny konsument PostgREST)          (jedyny predykat JS)
//
// Tak samo sortowanie: `leadSortSteps()` opisuje kolumny, kierunek i miejsce
// NULL-i, a serwer zamienia je na `.order()`, klient na komparator.
//
// CZEGO TEN MODUŁ NIE PILNUJE. Kolacji tekstu: `ORDER BY company` w Postgresie
// sortuje wg collation bazy, a JS wg `localeCompare`. Kontraktem, który tu
// domykamy, jest KSZTAŁT porządku (które kolumny, w jakiej kolejności, gdzie
// lądują NULL-e, czym domykamy remis) - samo porównywanie napisów spoza ASCII
// należy do bazy i sprawdza je pgTAP / pg-harness, nie vitest.
import { z } from "zod";

/* ---------- Słownik kolumn: co znaczy wartość w danej kolumnie ---------- */

/**
 * Typ kolumny widoku `crm_leads`. Potrzebny obu stronom: JS musi wiedzieć, czy
 * `"2026-08-01T00:00:00Z" < "2026-08-10T00:00:00Z"` porównywać jako datę,
 * liczbę czy napis - inaczej `gte`/`lte` i sort dają inny wynik niż SQL.
 */
export type LeadColumnType = "text" | "number" | "timestamp" | "boolean" | "stage" | "text[]";

export const LEAD_COLUMN_TYPES: Readonly<Record<string, LeadColumnType>> = {
  id: "text",
  email: "text",
  first_name: "text",
  last_name: "text",
  phone: "text",
  position: "text",
  company: "text",
  country: "text",
  owner_id: "text",
  stage: "stage",
  score: "number",
  score_band: "text",
  source_count: "number",
  newsletter_status: "text",
  marketing_consent: "boolean",
  tags: "text[]",
  last_activity_at: "timestamp",
  created_at: "timestamp",
  follow_up_at: "timestamp",
};

/**
 * Kolejność etapów lejka. To NIE jest kolejność alfabetyczna ani umowa
 * frontendu: `stage` w bazie ma typ `public.crm_stage` (ENUM), a Postgres
 * sortuje enumy wg KOLEJNOŚCI DEKLARACJI. Ta stała musi więc odpowiadać
 * migracji `20260630053403` - pilnuje tego osobny test kontraktu, który czyta
 * `CREATE TYPE public.crm_stage` wprost z pliku migracji.
 */
export const LEAD_STAGE_ORDER = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
  "archived",
] as const;

export type LeadStage = (typeof LEAD_STAGE_ORDER)[number];

/* ---------- Parametry listy (schemat współdzielony z serwerem) ---------- */

export const LeadStageSchema = z.enum(LEAD_STAGE_ORDER);
export const LeadBandSchema = z.enum(["hot", "warm", "cool", "cold"]);
export const LeadSourceSchema = z.enum(["form", "newsletter", "import"]);

/**
 * Filtry listy leadów - nadzbiór tego, co potrafi ustawić panel (LeadFilter
 * z `leadViews.ts`), bo serwer przyjmuje jeszcze właścicieli, tagi, przedział
 * score i wyszukiwanie. `crm.functions.ts` rozszerza ten schemat o paginację
 * i zakres tenanta, więc walidacja wejścia i opis predykatów nie mogą się
 * rozjechać - to jeden obiekt Zod, nie dwie listy pól.
 */
export const LeadListFilterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  stage: LeadStageSchema.optional(),
  band: LeadBandSchema.optional(),
  source: LeadSourceSchema.optional(),
  owner_ids: z.array(z.string().uuid()).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  score_min: z.number().int().min(0).max(100).optional(),
  score_max: z.number().int().min(0).max(100).optional(),
  country: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
  newsletter_status: z.string().trim().max(40).optional(),
  consent_only: z.boolean().optional(),
  activity_from: z.string().datetime().optional(),
  activity_to: z.string().datetime().optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
});
export type LeadListFilterParams = z.infer<typeof LeadListFilterSchema>;

export const LEAD_SORT_KEYS = [
  "activity",
  "score",
  "created",
  "followUp",
  "company",
  "country",
  "stage",
  "name",
] as const;
export type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];

export const LeadSortKeySchema = z.enum(LEAD_SORT_KEYS);
export const LeadSortDirSchema = z.enum(["asc", "desc"]);
export type LeadSortDir = z.infer<typeof LeadSortDirSchema>;

/* ---------- Opis filtra: predykaty ---------- */

/** Liść predykatu - wprost odpowiada operatorowi PostgREST. */
export type LeadLeafPredicate =
  | { readonly op: "eq"; readonly column: string; readonly value: string | number | boolean }
  | { readonly op: "in"; readonly column: string; readonly values: readonly string[] }
  | { readonly op: "overlaps"; readonly column: string; readonly values: readonly string[] }
  | { readonly op: "gte"; readonly column: string; readonly value: string | number }
  | { readonly op: "lte"; readonly column: string; readonly value: string | number }
  | { readonly op: "isNull"; readonly column: string }
  | { readonly op: "notNull"; readonly column: string }
  | { readonly op: "ilike"; readonly column: string; readonly pattern: string };

/** Alternatywa - PostgREST `.or(...)`, w JS zwykłe „którykolwiek liść". */
export interface LeadAnyOfPredicate {
  readonly op: "anyOf";
  readonly of: readonly LeadLeafPredicate[];
}

export type LeadPredicate = LeadLeafPredicate | LeadAnyOfPredicate;

/**
 * Wzorzec wyszukiwania. Usuwamy wieloznaczniki LIKE i metaznaki `.or()`, żeby
 * fraza nie mogła DOPISAĆ warunku do zapytania (RLS nadal zawęża wiersze, ale
 * fraza nie ma prawa zmieniać logiki filtra). Jedna funkcja, bo ta sama reguła
 * obowiązuje po obu stronach.
 */
export function leadSearchPattern(term: string): string {
  return `%${term.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
}

/** Kolumny przeszukiwane frazą - kolejność ma znaczenie dla łańcucha `.or()`. */
export const LEAD_SEARCH_COLUMNS = ["email", "first_name", "last_name", "company"] as const;

/**
 * Parametry -> lista predykatów. Kolejność jest stabilna (a nie „jakakolwiek"),
 * bo bramka parytetu porównuje wygenerowane zapytanie z wykonaniem predykatów
 * na wierszach - a zapytanie to tekst.
 */
export function buildLeadFilterSpec(params: LeadListFilterParams): LeadPredicate[] {
  const out: LeadPredicate[] = [];
  if (params.stage) out.push({ op: "eq", column: "stage", value: params.stage });
  if (params.band) out.push({ op: "eq", column: "score_band", value: params.band });
  if (params.owner_ids && params.owner_ids.length > 0) {
    out.push({ op: "in", column: "owner_id", values: params.owner_ids });
  }
  if (params.tags && params.tags.length > 0) {
    out.push({ op: "overlaps", column: "tags", values: params.tags });
  }
  if (typeof params.score_min === "number") {
    out.push({ op: "gte", column: "score", value: params.score_min });
  }
  if (typeof params.score_max === "number") {
    out.push({ op: "lte", column: "score", value: params.score_max });
  }
  if (params.country) out.push({ op: "eq", column: "country", value: params.country });
  if (params.company) out.push({ op: "eq", column: "company", value: params.company });
  if (params.newsletter_status) {
    out.push({ op: "eq", column: "newsletter_status", value: params.newsletter_status });
  }
  if (params.consent_only) out.push({ op: "eq", column: "marketing_consent", value: true });
  // Źródło leada wynika z danych, nie z osobnej kolumny: newsletter ma status
  // zapisu, formularz ma licznik zgłoszeń, reszta to import/ręczne dodanie.
  if (params.source === "newsletter") out.push({ op: "notNull", column: "newsletter_status" });
  if (params.source === "form") {
    out.push({ op: "isNull", column: "newsletter_status" });
    out.push({ op: "gte", column: "source_count", value: 1 });
  }
  if (params.source === "import") {
    out.push({ op: "isNull", column: "newsletter_status" });
    out.push({
      op: "anyOf",
      of: [
        { op: "isNull", column: "source_count" },
        { op: "lte", column: "source_count", value: 0 },
      ],
    });
  }
  if (params.activity_from) {
    out.push({ op: "gte", column: "last_activity_at", value: params.activity_from });
  }
  if (params.activity_to) {
    out.push({ op: "lte", column: "last_activity_at", value: params.activity_to });
  }
  if (params.created_from) {
    out.push({ op: "gte", column: "created_at", value: params.created_from });
  }
  if (params.created_to) out.push({ op: "lte", column: "created_at", value: params.created_to });
  if (params.search) {
    const pattern = leadSearchPattern(params.search);
    out.push({
      op: "anyOf",
      of: LEAD_SEARCH_COLUMNS.map((column) => ({ op: "ilike" as const, column, pattern })),
    });
  }
  return out;
}

/**
 * Źródło leada wyprowadzone z wiersza - ta sama reguła, którą wyżej opisują
 * predykaty `source`. Eksport CSV pokazuje ją jako kolumnę, więc etykieta i
 * filtr nie mogą mówić czego innego; test wewnętrznej zgodności sprawdza, że
 * `inferLeadSource(row) === s` dokładnie wtedy, gdy wiersz przechodzi filtr
 * `{ source: s }`.
 */
export function inferLeadSource(row: object): "form" | "newsletter" | "import" {
  const newsletterStatus = cell(row, "newsletter_status");
  if (newsletterStatus !== null && newsletterStatus !== undefined && newsletterStatus !== "") {
    return "newsletter";
  }
  const sourceCount = cell(row, "source_count");
  return typeof sourceCount === "number" && sourceCount >= 1 ? "form" : "import";
}

/* ---------- Opis sortu ---------- */

/** Krok sortowania - jeden wpis = jedno `ORDER BY`. */
export interface LeadSortStep {
  readonly column: string;
  readonly ascending: boolean;
  /** Zawsze `false`: puste wartości lądują NA KOŃCU niezależnie od kierunku. */
  readonly nullsFirst: false;
}

/**
 * Kolumny per klucz sortu. `name` ma dwie, bo „osoba" to imię + nazwisko -
 * sortowanie po sklejonym napisie dałoby inny wynik niż `ORDER BY first_name,
 * last_name` w SQL, a to SQL trzyma paginację.
 */
export const LEAD_SORT_COLUMNS: Readonly<Record<LeadSortKey, readonly string[]>> = {
  activity: ["last_activity_at"],
  score: ["score"],
  created: ["created_at"],
  followUp: ["follow_up_at"],
  company: ["company"],
  country: ["country"],
  stage: ["stage"],
  name: ["first_name", "last_name"],
};

/**
 * Domknięcie remisu. Bez niego dwie strony paginacji mogą pokazać ten sam
 * wiersz albo pominąć inny - przy równych wartościach sortu porządek bez
 * tiebreakera nie jest zdefiniowany ani w SQL, ani w JS.
 */
export const LEAD_SORT_TIEBREAKER = "id";

export function leadSortSteps(key: LeadSortKey, dir: LeadSortDir): LeadSortStep[] {
  const ascending = dir === "asc";
  const steps: LeadSortStep[] = LEAD_SORT_COLUMNS[key].map((column) => ({
    column,
    ascending,
    nullsFirst: false,
  }));
  steps.push({ column: LEAD_SORT_TIEBREAKER, ascending: true, nullsFirst: false });
  return steps;
}

/* ---------- Wykonanie opisu na wierszach (strona JS) ---------- */

export type LeadRowRecord = Record<string, unknown>;

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]/;

/**
 * Odczyt kolumny z wiersza. Wiersze przychodzą jako konkretne interfejsy
 * (`LeadRowShape`, wiersze widoku), a opis filtra mówi o kolumnach po nazwie -
 * to jedno miejsce, które łączy jedno z drugim.
 */
function cell(row: object, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

/** Wartość porównywalna: timestampy jako epoch, reszta jak przyszła. */
function comparable(column: string, value: unknown): number | string | boolean | null {
  if (value === null || value === undefined) return null;
  const type = LEAD_COLUMN_TYPES[column];
  if (type === "timestamp" || (typeof value === "string" && ISO_LIKE.test(value))) {
    const ts = Date.parse(String(value));
    return Number.isNaN(ts) ? String(value) : ts;
  }
  if (type === "stage") {
    const idx = LEAD_STAGE_ORDER.indexOf(String(value) as LeadStage);
    return idx === -1 ? String(value) : idx;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/** `%` i `_` jak w SQL LIKE; NULL nie pasuje do niczego (semantyka SQL). */
function ilikeMatches(value: unknown, pattern: string): boolean {
  if (value === null || value === undefined) return false;
  const rx = new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".")}$`,
    "is",
  );
  return rx.test(String(value));
}

function leafMatches(row: object, p: LeadLeafPredicate): boolean {
  const raw = cell(row, p.column);
  switch (p.op) {
    case "eq":
      return raw !== null && raw !== undefined && raw === p.value;
    case "in":
      return typeof raw === "string" && p.values.includes(raw);
    case "overlaps":
      return Array.isArray(raw) && raw.some((v) => p.values.includes(String(v)));
    case "gte": {
      const a = comparable(p.column, raw);
      const b = comparable(p.column, p.value);
      return a !== null && b !== null && a >= b;
    }
    case "lte": {
      const a = comparable(p.column, raw);
      const b = comparable(p.column, p.value);
      return a !== null && b !== null && a <= b;
    }
    case "isNull":
      return raw === null || raw === undefined;
    case "notNull":
      return raw !== null && raw !== undefined;
    case "ilike":
      return ilikeMatches(raw, p.pattern);
  }
}

/** Czy wiersz spełnia CAŁY opis filtra (AND po predykatach, OR wewnątrz anyOf). */
export function matchesLeadRow(row: object, spec: readonly LeadPredicate[]): boolean {
  return spec.every((p) =>
    p.op === "anyOf" ? p.of.some((leaf) => leafMatches(row, leaf)) : leafMatches(row, p),
  );
}

/**
 * Porównanie dwóch wierszy wg opisu sortu. NULL-e zawsze na końcu (`nullsFirst:
 * false` w każdym kroku), napisy przez `localeCompare` - patrz nagłówek pliku
 * co do kolacji.
 */
export function compareLeadRows(a: object, b: object, steps: readonly LeadSortStep[]): number {
  for (const step of steps) {
    const va = comparable(step.column, cell(a, step.column));
    const vb = comparable(step.column, cell(b, step.column));
    if (va === null && vb === null) continue;
    // Puste na końcu niezależnie od kierunku - dokładnie jak nullsFirst:false.
    if (va === null) return 1;
    if (vb === null) return -1;
    let cmp = 0;
    if (typeof va === "string" || typeof vb === "string") {
      cmp = String(va).localeCompare(String(vb));
    } else {
      cmp = va === vb ? 0 : va < vb ? -1 : 1;
    }
    if (cmp !== 0) return step.ascending ? cmp : -cmp;
  }
  return 0;
}

/** Sortowanie tablicy wierszy wg opisu - nie mutuje wejścia. */
export function sortLeadRows<T extends object>(
  rows: readonly T[],
  key: LeadSortKey,
  dir: LeadSortDir,
): T[] {
  const steps = leadSortSteps(key, dir);
  return [...rows].sort((a, b) => compareLeadRows(a, b, steps));
}

/** Filtrowanie tablicy wierszy wg parametrów - druga prezentacja tego opisu. */
export function filterLeadRows<T extends object>(
  rows: readonly T[],
  params: LeadListFilterParams,
): T[] {
  const spec = buildLeadFilterSpec(params);
  return rows.filter((row) => matchesLeadRow(row, spec));
}

/* ---------- Wykonanie opisu na zapytaniu (strona PostgREST) ---------- */

/**
 * Builder zapytań zawężony do operatorów, których używa opis filtra. Celowo
 * NIE importujemy tu `LooseQuery` z warstwy Supabase: ten moduł ma zostać
 * czysty (bez zależności serwerowych), a strukturalny typ i tak dopasowuje
 * `LooseQuery` w miejscu wywołania.
 */
export interface LeadFilterQuery<Q> {
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  overlaps(column: string, values: readonly unknown[]): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  is(column: string, value: unknown): Q;
  not(column: string, operator: string, value: unknown): Q;
  or(filter: string): Q;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Q;
}

/** Liść w składni `.or()` PostgREST: `kolumna.operator.wartość`. */
export function leafToOrTerm(leaf: LeadLeafPredicate): string {
  switch (leaf.op) {
    case "isNull":
      return `${leaf.column}.is.null`;
    case "notNull":
      return `${leaf.column}.not.is.null`;
    case "ilike":
      return `${leaf.column}.ilike.${leaf.pattern}`;
    case "eq":
      return `${leaf.column}.eq.${String(leaf.value)}`;
    case "gte":
      return `${leaf.column}.gte.${String(leaf.value)}`;
    case "lte":
      return `${leaf.column}.lte.${String(leaf.value)}`;
    case "in":
      return `${leaf.column}.in.(${leaf.values.join(",")})`;
    case "overlaps":
      return `${leaf.column}.ov.{${leaf.values.join(",")}}`;
  }
}

/** Opis filtra -> zapytanie PostgREST. Jedyne miejsce, które to tłumaczy. */
export function applyLeadFilterSpec<Q extends LeadFilterQuery<Q>>(
  query: Q,
  spec: readonly LeadPredicate[],
): Q {
  let q = query;
  for (const p of spec) {
    switch (p.op) {
      case "anyOf":
        q = q.or(p.of.map(leafToOrTerm).join(","));
        break;
      case "eq":
        q = q.eq(p.column, p.value);
        break;
      case "in":
        q = q.in(p.column, p.values);
        break;
      case "overlaps":
        q = q.overlaps(p.column, p.values);
        break;
      case "gte":
        q = q.gte(p.column, p.value);
        break;
      case "lte":
        q = q.lte(p.column, p.value);
        break;
      case "isNull":
        q = q.is(p.column, null);
        break;
      case "notNull":
        q = q.not(p.column, "is", null);
        break;
      case "ilike":
        q = q.or(leafToOrTerm(p));
        break;
    }
  }
  return q;
}

/** Opis sortu -> `ORDER BY` w zapytaniu. Jedyne miejsce, które to tłumaczy. */
export function applyLeadSortSpec<Q extends LeadFilterQuery<Q>>(
  query: Q,
  key: LeadSortKey,
  dir: LeadSortDir,
): Q {
  let q = query;
  for (const step of leadSortSteps(key, dir)) {
    q = q.order(step.column, { ascending: step.ascending, nullsFirst: step.nullsFirst });
  }
  return q;
}
