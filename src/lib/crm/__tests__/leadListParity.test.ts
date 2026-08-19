// BRAMKA PARYTETU: lista leadów liczona w SQL i ta sama lista liczona w JS
// muszą dać TEN SAM ZBIÓR w TEJ SAMEJ KOLEJNOŚCI.
//
// DLACZEGO ISTNIEJE, SKORO OPIS FILTRA JEST JEDEN. Wspólny opis
// (`leadListSpec.ts`) gwarantuje, że obie strony czytają tę samą definicję -
// nie gwarantuje, że ta definicja ZNACZY w PostgREST to samo, co w JS. NULL-e
// w `ORDER BY`, kolejność ENUM-a, semantyka `ilike`, granice `gte/lte` to
// zachowanie BAZY, nie naszego kodu. Dlatego test wykonuje zapytanie zbudowane
// przez PRAWDZIWE `applyLeadListFilters`/`applyLeadListSort` z crm.functions.ts
// na malutkim emulatorze PostgREST, napisanym niezależnie od `leadListSpec`
// (własne porównania, własna obsługa NULL-i, kolejność etapów wczytana wprost
// z migracji) - i porównuje wynik z predykatami klientowymi.
//
// CZEGO NIE PILNUJE: kolacji tekstu (Postgres sortuje wg collation bazy, JS wg
// localeCompare). Dane testowe są ASCII i jednoznaczne w obu porządkach, więc
// test mierzy KSZTAŁT porządku, a nie ustawienia regionalne bazy.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// crm.functions.ts to moduł serwerowy - żeby zaimportować z niego reguły,
// podmieniamy fabrykę server functions i middleware (jak w categoryColorSave).
vi.mock("@tanstack/react-start", () => {
  interface Chain {
    middleware: () => Chain;
    validator: () => Chain;
    inputValidator: () => Chain;
    handler: (h: unknown) => { handler: unknown };
  }
  const createServerFn = (): Chain => {
    const chain: Chain = {
      middleware: () => chain,
      validator: () => chain,
      inputValidator: () => chain,
      handler: (h: unknown) => ({ handler: h }),
    };
    return chain;
  };
  return { createServerFn, createMiddleware: () => ({}) };
});
vi.mock("@/integrations/supabase/require-staff", () => ({ requireCrmStaff: {} }));

import { applyLeadListFilters, applyLeadListSort } from "@/lib/crm.functions";
import {
  filterLeadRows,
  sortLeadRows,
  type LeadFilterQuery,
  type LeadListFilterParams,
  type LeadSortDir,
  type LeadSortKey,
} from "../leadListSpec";
import {
  BUILTIN_LEAD_VIEWS,
  DEFAULT_LEAD_FILTER,
  applyLeadFilter,
  applyLeadSort,
  leadViewToServerParams,
  type LeadFilter,
  type LeadRowShape,
  type LeadSort,
} from "../leadViews";

/* ---------- Kolejność etapów prosto z migracji (źródło: baza) ---------- */

const STAGE_ORDER: string[] = (() => {
  const sql = readFileSync(
    "supabase/migrations/20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql",
    "utf8",
  );
  const match = sql.match(/CREATE TYPE public\.crm_stage AS ENUM \(([^)]*)\)/);
  return (match?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
})();

/* ---------- Emulator PostgREST ---------- */

type Cell = unknown;

/**
 * Wiersz „z bazy". Emulator adresuje kolumny po nazwie, a dane testowe są
 * konkretnym typem - to jedno miejsce łączy jedno z drugim.
 */
function cell(row: object, column: string): Cell {
  return (row as Record<string, Cell>)[column];
}

interface OrderCall {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

const isNullish = (v: Cell): boolean => v === null || v === undefined;

/** Wartość porównywalna wg TYPU DANYCH, nie wg deklaracji w kodzie aplikacji. */
function pgValue(v: Cell): number | string | boolean | null {
  if (isNullish(v)) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  const stageIndex = STAGE_ORDER.indexOf(s);
  if (stageIndex >= 0) return stageIndex;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const ts = Date.parse(s);
    if (!Number.isNaN(ts)) return ts;
  }
  return s;
}

function pgCompare(a: Cell, b: Cell): number {
  const va = pgValue(a);
  const vb = pgValue(b);
  if (va === null || vb === null) return 0;
  if (typeof va === "string" || typeof vb === "string") {
    const sa = String(va);
    const sb = String(vb);
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  }
  return va === vb ? 0 : va < vb ? -1 : 1;
}

/** `ilike` jako wzorzec LIKE bez względu na wielkość liter; NULL nie pasuje. */
function pgIlike(value: Cell, pattern: string): boolean {
  if (isNullish(value)) return false;
  const rx = new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".")}$`,
    "i",
  );
  return rx.test(String(value));
}

/** Rozbija `.or()` na człony, respektując nawiasy (`in.(a,b)`). */
function splitOrTerms(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function orTermMatches(row: object, term: string): boolean {
  const dot = term.indexOf(".");
  const column = term.slice(0, dot);
  const rest = term.slice(dot + 1);
  const value = cell(row, column);
  if (rest === "is.null") return isNullish(value);
  if (rest === "not.is.null") return !isNullish(value);
  const inList = rest.match(/^in\.\((.*)\)$/);
  if (inList) {
    const values = inList[1].split(",").filter(Boolean);
    return !isNullish(value) && values.some((v) => pgCompare(value, v) === 0);
  }
  const m = rest.match(/^(ilike|eq|gte|lte)\.(.*)$/);
  if (!m) throw new Error(`Nieznany człon .or(): ${term}`);
  const [, op, raw] = m;
  if (op === "ilike") return pgIlike(value, raw);
  const literal: Cell = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  if (isNullish(value)) return false;
  if (op === "eq") return pgCompare(value, literal) === 0;
  if (op === "gte") return pgCompare(value, literal) >= 0;
  return pgCompare(value, literal) <= 0;
}

/**
 * Builder, który ZAPISUJE wywołania i potrafi je wykonać na tablicy wierszy.
 * To jest „baza" tego testu: implementacja semantyki PostgREST niezależna od
 * kodu produkcyjnego.
 */
class PostgrestEmulator implements LeadFilterQuery<PostgrestEmulator> {
  private readonly predicates: Array<(row: object) => boolean> = [];
  private readonly orders: OrderCall[] = [];

  eq(column: string, value: unknown) {
    this.predicates.push(
      (row) => !isNullish(cell(row, column)) && pgCompare(cell(row, column), value) === 0,
    );
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.predicates.push(
      (row) =>
        !isNullish(cell(row, column)) && values.some((v) => pgCompare(cell(row, column), v) === 0),
    );
    return this;
  }
  overlaps(column: string, values: readonly unknown[]) {
    this.predicates.push((row) => {
      const value = cell(row, column);
      return Array.isArray(value) && value.some((v) => values.some((w) => String(w) === String(v)));
    });
    return this;
  }
  gte(column: string, value: unknown) {
    this.predicates.push(
      (row) => !isNullish(cell(row, column)) && pgCompare(cell(row, column), value) >= 0,
    );
    return this;
  }
  lte(column: string, value: unknown) {
    this.predicates.push(
      (row) => !isNullish(cell(row, column)) && pgCompare(cell(row, column), value) <= 0,
    );
    return this;
  }
  is(column: string, value: unknown) {
    if (value !== null) throw new Error("emulator obsługuje wyłącznie .is(col, null)");
    this.predicates.push((row) => isNullish(cell(row, column)));
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) {
      throw new Error("emulator obsługuje wyłącznie .not(col, 'is', null)");
    }
    this.predicates.push((row) => !isNullish(cell(row, column)));
    return this;
  }
  or(filter: string) {
    const terms = splitOrTerms(filter);
    this.predicates.push((row) => terms.some((t) => orTermMatches(row, t)));
    return this;
  }
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      column,
      ascending: options.ascending,
      nullsFirst: options.nullsFirst === true,
    });
    return this;
  }

  run<T extends object>(rows: readonly T[]): T[] {
    const kept = rows.filter((row) => this.predicates.every((p) => p(row)));
    return [...kept].sort((a, b) => {
      for (const o of this.orders) {
        const av = cell(a, o.column);
        const bv = cell(b, o.column);
        if (isNullish(av) && isNullish(bv)) continue;
        if (isNullish(av)) return o.nullsFirst ? -1 : 1;
        if (isNullish(bv)) return o.nullsFirst ? 1 : -1;
        const cmp = pgCompare(av, bv);
        if (cmp !== 0) return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
  }
}

/* ---------- Dane syntetyczne (nigdy z prawdziwej bazy) ---------- */

type Lead = LeadRowShape & { owner_id: string | null };

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

const lead = (over: Partial<Lead> & { id: string }): Lead => ({
  email: `${over.id}@example.test`,
  first_name: "Anna",
  last_name: "Kowalska",
  phone: null,
  position: null,
  company: "Acme",
  country: "Poland",
  stage: "new",
  score: 50,
  score_band: "warm",
  tags: ["eu"],
  owner_id: null,
  marketing_consent: false,
  newsletter_status: null,
  source_count: 1,
  last_activity_at: "2026-08-10T10:00:00.000Z",
  created_at: "2026-08-01T10:00:00.000Z",
  follow_up_at: null,
  ...over,
});

const ROWS: Lead[] = [
  lead({
    id: "01",
    first_name: "Anna",
    last_name: "Kowalska",
    company: "Acme",
    country: "Poland",
    stage: "new",
    score: 90,
    score_band: "hot",
    tags: ["eu", "energy"],
    owner_id: OWNER_A,
    marketing_consent: true,
    newsletter_status: "subscribed",
    source_count: 3,
    last_activity_at: "2026-08-17T09:00:00.000Z",
    created_at: "2026-08-15T09:00:00.000Z",
    follow_up_at: "2026-08-20T09:00:00.000Z",
  }),
  lead({
    id: "02",
    first_name: "Bartek",
    last_name: "Nowak",
    company: "Beta",
    country: "Germany",
    stage: "contacted",
    score: 55,
    score_band: "warm",
    tags: ["climate"],
    owner_id: OWNER_B,
    marketing_consent: false,
    newsletter_status: null,
    source_count: 2,
    last_activity_at: "2026-08-12T09:00:00.000Z",
    created_at: "2026-07-20T09:00:00.000Z",
    follow_up_at: null,
  }),
  lead({
    id: "03",
    first_name: "Celina",
    last_name: "Zielinska",
    company: null,
    country: null,
    stage: "qualified",
    score: 30,
    score_band: "cool",
    tags: null,
    owner_id: null,
    marketing_consent: true,
    newsletter_status: null,
    source_count: 0,
    last_activity_at: "2026-08-12T09:00:00.000Z",
    created_at: "2026-05-01T09:00:00.000Z",
    follow_up_at: "2026-08-19T09:00:00.000Z",
  }),
  lead({
    id: "04",
    first_name: null,
    last_name: null,
    company: "Delta",
    country: "France",
    stage: "won",
    score: 70,
    score_band: "hot",
    tags: ["eu"],
    owner_id: OWNER_A,
    marketing_consent: false,
    newsletter_status: "pending",
    source_count: null,
    last_activity_at: "2026-06-01T09:00:00.000Z",
    created_at: "2026-04-01T09:00:00.000Z",
    follow_up_at: null,
  }),
  lead({
    id: "05",
    first_name: "Anna",
    last_name: "Adamska",
    company: "Acme",
    country: "Poland",
    stage: "archived",
    score: 0,
    score_band: "cold",
    tags: [],
    owner_id: null,
    marketing_consent: false,
    newsletter_status: null,
    source_count: null,
    last_activity_at: "2026-08-17T09:00:00.000Z",
    created_at: "2026-08-15T09:00:00.000Z",
    follow_up_at: "2026-08-19T09:00:00.000Z",
  }),
];

const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id);

/** Pełne parametry serwerowej listy - filtr + paginacja + sort. */
function serverParams(
  filter: LeadListFilterParams,
  sort: LeadSortKey,
  dir: LeadSortDir,
): LeadListFilterParams & {
  scope: "tenant";
  limit: number;
  page: number;
  sort: LeadSortKey;
  sort_dir: LeadSortDir;
} {
  return { ...filter, scope: "tenant", limit: 200, page: 1, sort, sort_dir: dir };
}

function sqlSide(filter: LeadListFilterParams, sort: LeadSortKey, dir: LeadSortDir): string[] {
  const params = serverParams(filter, sort, dir);
  const query = applyLeadListSort(applyLeadListFilters(new PostgrestEmulator(), params), params);
  return query.run(ROWS).map((r) => r.id);
}

function jsSide(filter: LeadListFilterParams, sort: LeadSortKey, dir: LeadSortDir): string[] {
  return ids(sortLeadRows(filterLeadRows(ROWS, filter), sort, dir));
}

const FILTERS: Array<[string, LeadListFilterParams]> = [
  ["pusty", {}],
  ["etap", { stage: "qualified" }],
  ["poziom", { band: "hot" }],
  ["źródło: newsletter", { source: "newsletter" }],
  ["źródło: formularz", { source: "form" }],
  ["źródło: import", { source: "import" }],
  ["kraj", { country: "Poland" }],
  ["firma", { company: "Acme" }],
  ["właściciele", { owner_ids: [OWNER_A, OWNER_B] }],
  ["tagi", { tags: ["eu"] }],
  ["przedział score", { score_min: 30, score_max: 70 }],
  ["tylko ze zgodą", { consent_only: true }],
  ["status newslettera", { newsletter_status: "subscribed" }],
  ["okno aktywności", { activity_from: "2026-08-12T09:00:00.000Z" }],
  ["okno utworzenia", { created_from: "2026-07-01T00:00:00.000Z" }],
  [
    "okno domknięte z dwóch stron",
    {
      created_from: "2026-05-01T09:00:00.000Z",
      created_to: "2026-08-01T00:00:00.000Z",
    },
  ],
  ["fraza", { search: "anna" }],
  ["fraza po firmie", { search: "acme" }],
  ["fraza bez trafień", { search: "nieistniejacy" }],
  ["kombinacja", { stage: "new", band: "hot", consent_only: true, tags: ["eu"] }],
];

const SORTS: LeadSortKey[] = [
  "activity",
  "score",
  "created",
  "followUp",
  "company",
  "country",
  "stage",
  "name",
];

describe("parytet: filtr i sort listy leadów", () => {
  for (const [name, filter] of FILTERS) {
    for (const sort of SORTS) {
      for (const dir of ["asc", "desc"] as const) {
        it(`${name} + ${sort} ${dir}: SQL i JS dają ten sam wynik`, () => {
          const fromSql = sqlSide(filter, sort, dir);
          const fromJs = jsSide(filter, sort, dir);
          expect(fromJs).toEqual(fromSql);
        });
      }
    }
  }

  it("wynik nie jest pusty dla każdego filtra poza celowo pustym", () => {
    for (const [name, filter] of FILTERS) {
      if (name === "fraza bez trafień") continue;
      expect(sqlSide(filter, "activity", "desc").length).toBeGreaterThan(0);
    }
  });
});

describe("parytet: widok panelu (LeadFilter) vs parametry serwera", () => {
  const NOW = Date.parse("2026-08-18T12:00:00.000Z");

  const cases: Array<[string, LeadFilter, LeadSort]> = [
    ["domyślny", DEFAULT_LEAD_FILTER, { key: "lastActivity", dir: "desc" }],
    [
      "ostatnie 7 dni",
      { ...DEFAULT_LEAD_FILTER, createdRange: "7d" },
      { key: "created", dir: "desc" },
    ],
    [
      "aktywność 30 dni + zgoda",
      { ...DEFAULT_LEAD_FILTER, activityRange: "30d", consentOnly: true },
      { key: "score", dir: "asc" },
    ],
    [
      "firma i kraj",
      { ...DEFAULT_LEAD_FILTER, company: "Acme", country: "Poland" },
      { key: "name", dir: "asc" },
    ],
    [
      "źródło import",
      { ...DEFAULT_LEAD_FILTER, source: "import" },
      { key: "followUp", dir: "asc" },
    ],
  ];

  for (const [name, filter, sort] of cases) {
    it(`${name}: panel liczy to samo, co lista serwerowa`, () => {
      const params = leadViewToServerParams({ columns: ["name"], filter, sort }, NOW);
      const query = applyLeadListSort(
        applyLeadListFilters(new PostgrestEmulator(), {
          ...params,
          scope: "tenant",
          limit: 200,
          page: 1,
        }),
        { ...params, scope: "tenant", limit: 200, page: 1 },
      );
      const fromSql = query.run(ROWS).map((r) => r.id);
      const fromPanel = ids(applyLeadSort(applyLeadFilter(ROWS, filter, NOW), sort));
      expect(fromPanel).toEqual(fromSql);
    });
  }

  it("wbudowane widoki też trzymają parytet", () => {
    for (const view of BUILTIN_LEAD_VIEWS) {
      const params = leadViewToServerParams(view.config, NOW);
      const full = { ...params, scope: "tenant" as const, limit: 200, page: 1 };
      const fromSql = applyLeadListSort(applyLeadListFilters(new PostgrestEmulator(), full), full)
        .run(ROWS)
        .map((r) => r.id);
      const fromPanel = ids(
        applyLeadSort(applyLeadFilter(ROWS, view.config.filter, NOW), view.config.sort),
      );
      expect(fromPanel).toEqual(fromSql);
    }
  });
});

describe("emulator PostgREST - sam w sobie", () => {
  it("odrzuca operatory, których produkcja nie używa (nie udaje bazy)", () => {
    expect(() => new PostgrestEmulator().is("stage", "new")).toThrow();
    expect(() => new PostgrestEmulator().not("stage", "eq", "new")).toThrow();
    expect(() => new PostgrestEmulator().or("stage.zzz.new").run(ROWS)).toThrow();
  });

  it("dzieli człony .or() z poszanowaniem nawiasów", () => {
    const q = new PostgrestEmulator().or("owner_id.in.(a,b),stage.eq.new");
    expect(q.run(ROWS).map((r) => r.id)).toEqual(["01"]);
  });
});
