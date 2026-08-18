// Kontrakt WSPÓLNEGO opisu listy leadów (lib/crm/leadListSpec.ts).
//
// Ten plik testuje OPIS: jakie predykaty powstają z parametrów, co znaczy każdy
// operator na wierszu, jak wygląda porządek (kolumny, NULL-e, tiebreaker) oraz
// jak opis renderuje się do składni PostgREST. Zgodność obu WYKONAŃ (SQL vs JS)
// pilnuje osobna bramka: `leadListParity.test.ts`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEAD_COLUMN_TYPES,
  LEAD_SEARCH_COLUMNS,
  LEAD_SORT_COLUMNS,
  LEAD_SORT_KEYS,
  LEAD_SORT_TIEBREAKER,
  LEAD_STAGE_ORDER,
  LeadListFilterSchema,
  applyLeadFilterSpec,
  applyLeadSortSpec,
  buildLeadFilterSpec,
  compareLeadRows,
  filterLeadRows,
  inferLeadSource,
  leadSearchPattern,
  leadSortSteps,
  leafToOrTerm,
  matchesLeadRow,
  sortLeadRows,
  type LeadFilterQuery,
  type LeadListFilterParams,
  type LeadSortKey,
} from "../leadListSpec";

/* ---------- Atrapa buildera: zapisuje wywołania, nie wykonuje ich ---------- */

interface Call {
  method: string;
  args: unknown[];
}

class RecordingQuery implements LeadFilterQuery<RecordingQuery> {
  readonly calls: Call[] = [];
  private push(method: string, args: unknown[]): RecordingQuery {
    this.calls.push({ method, args });
    return this;
  }
  eq(column: string, value: unknown) {
    return this.push("eq", [column, value]);
  }
  in(column: string, values: readonly unknown[]) {
    return this.push("in", [column, values]);
  }
  overlaps(column: string, values: readonly unknown[]) {
    return this.push("overlaps", [column, values]);
  }
  gte(column: string, value: unknown) {
    return this.push("gte", [column, value]);
  }
  lte(column: string, value: unknown) {
    return this.push("lte", [column, value]);
  }
  is(column: string, value: unknown) {
    return this.push("is", [column, value]);
  }
  not(column: string, operator: string, value: unknown) {
    return this.push("not", [column, operator, value]);
  }
  or(filter: string) {
    return this.push("or", [filter]);
  }
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
    return this.push("order", [column, options]);
  }
}

const record = (params: LeadListFilterParams): Call[] =>
  applyLeadFilterSpec(new RecordingQuery(), buildLeadFilterSpec(params)).calls;

/* ---------- Wiersze syntetyczne (dane osobowe: wyłącznie zmyślone) ---------- */

interface Row {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  country: string | null;
  stage: string;
  score: number;
  score_band: string;
  tags: string[] | null;
  owner_id: string | null;
  marketing_consent: boolean;
  newsletter_status: string | null;
  source_count: number | null;
  last_activity_at: string;
  created_at: string;
  follow_up_at: string | null;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "00000000-0000-4000-8000-000000000001",
  email: "anna.kowalska@example.test",
  first_name: "Anna",
  last_name: "Kowalska",
  company: "Example Sp. z o.o.",
  country: "Poland",
  stage: "new",
  score: 40,
  score_band: "warm",
  tags: ["eu", "energy"],
  owner_id: null,
  marketing_consent: false,
  newsletter_status: null,
  source_count: 1,
  last_activity_at: "2026-08-10T10:00:00.000Z",
  created_at: "2026-08-01T10:00:00.000Z",
  follow_up_at: null,
  ...over,
});

describe("buildLeadFilterSpec - pusty filtr", () => {
  it("brak parametrów = brak predykatów (lista bez zawężenia)", () => {
    expect(buildLeadFilterSpec({})).toEqual([]);
    expect(record({})).toEqual([]);
  });

  it("schemat przepuszcza pusty obiekt i przycina białe znaki", () => {
    const parsed = LeadListFilterSchema.parse({ search: "  Kowalska  ", company: " Example " });
    expect(parsed).toEqual({ search: "Kowalska", company: "Example" });
  });
});

describe("buildLeadFilterSpec - każdy operator osobno", () => {
  it("stage -> eq na kolumnie stage", () => {
    expect(buildLeadFilterSpec({ stage: "qualified" })).toEqual([
      { op: "eq", column: "stage", value: "qualified" },
    ]);
    expect(record({ stage: "qualified" })).toEqual([
      { method: "eq", args: ["stage", "qualified"] },
    ]);
  });

  it("band -> eq na score_band", () => {
    expect(record({ band: "hot" })).toEqual([{ method: "eq", args: ["score_band", "hot"] }]);
  });

  it("owner_ids -> in, pusta lista nie daje predykatu", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    expect(record({ owner_ids: [owner] })).toEqual([{ method: "in", args: ["owner_id", [owner]] }]);
    expect(record({ owner_ids: [] })).toEqual([]);
  });

  it("tags -> overlaps, pusta lista nie daje predykatu", () => {
    expect(record({ tags: ["eu"] })).toEqual([{ method: "overlaps", args: ["tags", ["eu"]] }]);
    expect(record({ tags: [] })).toEqual([]);
  });

  it("score_min/score_max -> gte/lte, zero jest wartością a nie brakiem", () => {
    expect(record({ score_min: 0, score_max: 100 })).toEqual([
      { method: "gte", args: ["score", 0] },
      { method: "lte", args: ["score", 100] },
    ]);
  });

  it("country/company/newsletter_status -> eq", () => {
    expect(record({ country: "Poland", company: "Acme", newsletter_status: "subscribed" })).toEqual(
      [
        { method: "eq", args: ["country", "Poland"] },
        { method: "eq", args: ["company", "Acme"] },
        { method: "eq", args: ["newsletter_status", "subscribed"] },
      ],
    );
  });

  it("consent_only -> eq marketing_consent=true; false nie zawęża listy", () => {
    expect(record({ consent_only: true })).toEqual([
      { method: "eq", args: ["marketing_consent", true] },
    ]);
    expect(record({ consent_only: false })).toEqual([]);
  });

  it("zakresy dat -> gte/lte na aktywności i utworzeniu", () => {
    const params: LeadListFilterParams = {
      activity_from: "2026-08-01T00:00:00.000Z",
      activity_to: "2026-08-31T00:00:00.000Z",
      created_from: "2026-07-01T00:00:00.000Z",
      created_to: "2026-07-31T00:00:00.000Z",
    };
    expect(record(params).map((c) => `${c.method}:${String(c.args[0])}`)).toEqual([
      "gte:last_activity_at",
      "lte:last_activity_at",
      "gte:created_at",
      "lte:created_at",
    ]);
  });
});

describe("buildLeadFilterSpec - źródło leada", () => {
  it("newsletter = status zapisu niepusty", () => {
    expect(record({ source: "newsletter" })).toEqual([
      { method: "not", args: ["newsletter_status", "is", null] },
    ]);
  });

  it("form = brak newslettera + co najmniej jedno zgłoszenie", () => {
    expect(record({ source: "form" })).toEqual([
      { method: "is", args: ["newsletter_status", null] },
      { method: "gte", args: ["source_count", 1] },
    ]);
  });

  it("import = brak newslettera + brak zgłoszeń (alternatywa w .or)", () => {
    expect(record({ source: "import" })).toEqual([
      { method: "is", args: ["newsletter_status", null] },
      { method: "or", args: ["source_count.is.null,source_count.lte.0"] },
    ]);
  });

  it("inferLeadSource zgadza się z filtrem dla każdego źródła", () => {
    const cases: Array<[Row, "form" | "newsletter" | "import"]> = [
      [row({ newsletter_status: "subscribed", source_count: 5 }), "newsletter"],
      [row({ newsletter_status: null, source_count: 2 }), "form"],
      [row({ newsletter_status: null, source_count: 0 }), "import"],
      [row({ newsletter_status: null, source_count: null }), "import"],
    ];
    for (const [r, expected] of cases) {
      expect(inferLeadSource(r)).toBe(expected);
      for (const source of ["form", "newsletter", "import"] as const) {
        expect(matchesLeadRow(r, buildLeadFilterSpec({ source }))).toBe(source === expected);
      }
    }
  });
});

describe("wyszukiwanie", () => {
  it("fraza traci wieloznaczniki LIKE i metaznaki .or (nie doklei warunku)", () => {
    // Metaznaki są USUWANE (nie zastępowane), więc fraza nie może zamienić się
    // w dodatkowy warunek `.or()` ani we wzorzec LIKE o innym zasięgu.
    expect(leadSearchPattern('Kowal%ska_,(x)"\\')).toBe("%kowalskax%");
  });

  it("fraza szuka w e-mailu, imieniu, nazwisku i firmie - jednym .or", () => {
    const calls = record({ search: "kowal" });
    expect(calls).toEqual([
      {
        method: "or",
        args: [
          "email.ilike.%kowal%,first_name.ilike.%kowal%,last_name.ilike.%kowal%,company.ilike.%kowal%",
        ],
      },
    ]);
    expect([...LEAD_SEARCH_COLUMNS]).toEqual(["email", "first_name", "last_name", "company"]);
  });

  it("dopasowanie frazy jest bez względu na wielkość liter, NULL nie pasuje", () => {
    const spec = buildLeadFilterSpec({ search: "kowal" });
    expect(matchesLeadRow(row({ last_name: "KOWALSKA" }), spec)).toBe(true);
    expect(
      matchesLeadRow(
        row({ email: "x@example.test", first_name: null, last_name: null, company: null }),
        spec,
      ),
    ).toBe(false);
  });
});

describe("matchesLeadRow - semantyka operatorów na wierszu", () => {
  it("eq nie dopasowuje NULL-a", () => {
    expect(matchesLeadRow(row({ country: null }), buildLeadFilterSpec({ country: "Poland" }))).toBe(
      false,
    );
  });

  it("in dopasowuje właściciela z listy", () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const spec = buildLeadFilterSpec({ owner_ids: [owner] });
    expect(matchesLeadRow(row({ owner_id: owner }), spec)).toBe(true);
    expect(matchesLeadRow(row({ owner_id: null }), spec)).toBe(false);
  });

  it("overlaps wymaga części wspólnej tagów", () => {
    const spec = buildLeadFilterSpec({ tags: ["energy", "climate"] });
    expect(matchesLeadRow(row({ tags: ["eu", "energy"] }), spec)).toBe(true);
    expect(matchesLeadRow(row({ tags: ["eu"] }), spec)).toBe(false);
    expect(matchesLeadRow(row({ tags: null }), spec)).toBe(false);
  });

  it("gte/lte na liczbach obejmuje granice", () => {
    const spec = buildLeadFilterSpec({ score_min: 40, score_max: 40 });
    expect(matchesLeadRow(row({ score: 40 }), spec)).toBe(true);
    expect(matchesLeadRow(row({ score: 39 }), spec)).toBe(false);
    expect(matchesLeadRow(row({ score: 41 }), spec)).toBe(false);
  });

  it("gte/lte na datach porównuje moment, nie napis", () => {
    const spec = buildLeadFilterSpec({ created_from: "2026-08-01T00:00:00.000Z" });
    // Ten sam moment zapisany inaczej (offset) MUSI przejść filtr.
    expect(matchesLeadRow(row({ created_at: "2026-08-01T02:00:00+02:00" }), spec)).toBe(true);
    expect(matchesLeadRow(row({ created_at: "2026-07-31T23:59:59.000Z" }), spec)).toBe(false);
  });

  it("wszystkie predykaty muszą być spełnione naraz (AND)", () => {
    const spec = buildLeadFilterSpec({ stage: "new", band: "hot" });
    expect(matchesLeadRow(row({ stage: "new", score_band: "warm" }), spec)).toBe(false);
    expect(matchesLeadRow(row({ stage: "new", score_band: "hot" }), spec)).toBe(true);
  });

  it("filterLeadRows nie rusza wejściowej tablicy", () => {
    const rows = [row({ id: "a", stage: "new" }), row({ id: "b", stage: "won" })];
    const out = filterLeadRows(rows, { stage: "won" });
    expect(out.map((r) => r.id)).toEqual(["b"]);
    expect(rows).toHaveLength(2);
  });
});

describe("opis sortowania", () => {
  it("każdy klucz ma kolumny i domyka się tiebreakerem po id", () => {
    for (const key of LEAD_SORT_KEYS) {
      const steps = leadSortSteps(key, "desc");
      expect(steps.length).toBe(LEAD_SORT_COLUMNS[key].length + 1);
      expect(steps.at(-1)).toEqual({
        column: LEAD_SORT_TIEBREAKER,
        ascending: true,
        nullsFirst: false,
      });
      expect(steps.every((s) => s.nullsFirst === false)).toBe(true);
    }
  });

  it("nazwa sortuje się po imieniu i nazwisku (jak ORDER BY w SQL)", () => {
    expect(LEAD_SORT_COLUMNS.name).toEqual(["first_name", "last_name"]);
    expect(leadSortSteps("name", "asc").map((s) => s.column)).toEqual([
      "first_name",
      "last_name",
      "id",
    ]);
  });

  it("kierunek dotyczy kolumn sortu, nigdy tiebreakera", () => {
    const steps = leadSortSteps("score", "asc");
    expect(steps[0]).toEqual({ column: "score", ascending: true, nullsFirst: false });
    expect(steps.at(-1)?.ascending).toBe(true);
    expect(leadSortSteps("score", "desc")[0].ascending).toBe(false);
  });

  it("applyLeadSortSpec wystawia ORDER BY w kolejności opisu", () => {
    const calls = applyLeadSortSpec(new RecordingQuery(), "name", "asc").calls;
    expect(calls).toEqual([
      { method: "order", args: ["first_name", { ascending: true, nullsFirst: false }] },
      { method: "order", args: ["last_name", { ascending: true, nullsFirst: false }] },
      { method: "order", args: ["id", { ascending: true, nullsFirst: false }] },
    ]);
  });
});

describe("sortLeadRows - porządek wierszy", () => {
  const byId = (rows: Row[]): string[] => rows.map((r) => r.id);

  it("puste wartości lądują na końcu w OBU kierunkach", () => {
    const rows = [
      row({ id: "brak", follow_up_at: null }),
      row({ id: "pilne", follow_up_at: "2026-08-20T00:00:00.000Z" }),
      row({ id: "później", follow_up_at: "2026-09-20T00:00:00.000Z" }),
    ];
    expect(byId(sortLeadRows(rows, "followUp", "asc"))).toEqual(["pilne", "później", "brak"]);
    expect(byId(sortLeadRows(rows, "followUp", "desc"))).toEqual(["później", "pilne", "brak"]);
  });

  it("firma bez nazwy nie wypycha firm na początek listy rosnącej", () => {
    const rows = [
      row({ id: "bez", company: null }),
      row({ id: "acme", company: "Acme" }),
      row({ id: "zeta", company: "Zeta" }),
    ];
    expect(byId(sortLeadRows(rows, "company", "asc"))).toEqual(["acme", "zeta", "bez"]);
    expect(byId(sortLeadRows(rows, "company", "desc"))).toEqual(["zeta", "acme", "bez"]);
  });

  it("etapy idą kolejnością lejka, nie alfabetem", () => {
    const rows = [
      row({ id: "archived", stage: "archived" }),
      row({ id: "new", stage: "new" }),
      row({ id: "qualified", stage: "qualified" }),
    ];
    expect(byId(sortLeadRows(rows, "stage", "asc"))).toEqual(["new", "qualified", "archived"]);
  });

  it("równe wartości rozstrzyga id - kolejność jest deterministyczna", () => {
    const same = "2026-08-10T10:00:00.000Z";
    const rows = [
      row({ id: "c", last_activity_at: same }),
      row({ id: "a", last_activity_at: same }),
      row({ id: "b", last_activity_at: same }),
    ];
    expect(byId(sortLeadRows(rows, "activity", "desc"))).toEqual(["a", "b", "c"]);
    expect(byId(sortLeadRows([...rows].reverse(), "activity", "desc"))).toEqual(["a", "b", "c"]);
  });

  it("sortowanie po nazwie schodzi na nazwisko przy tym samym imieniu", () => {
    const rows = [
      row({ id: "2", first_name: "Anna", last_name: "Zielińska" }),
      row({ id: "1", first_name: "Anna", last_name: "Adamska" }),
      row({ id: "3", first_name: "Bartek", last_name: "Adamski" }),
    ];
    expect(byId(sortLeadRows(rows, "name", "asc"))).toEqual(["1", "2", "3"]);
  });

  it("kontakt bez imienia trafia na koniec, nie w środek alfabetu", () => {
    const rows = [
      row({ id: "bez", first_name: null, last_name: null }),
      row({ id: "anna", first_name: "Anna", last_name: "Kowalska" }),
    ];
    expect(byId(sortLeadRows(rows, "name", "asc"))).toEqual(["anna", "bez"]);
    expect(byId(sortLeadRows(rows, "name", "desc"))).toEqual(["anna", "bez"]);
  });

  it("sortLeadRows nie mutuje wejścia", () => {
    const rows = [row({ id: "b", score: 10 }), row({ id: "a", score: 90 })];
    sortLeadRows(rows, "score", "desc");
    expect(byId(rows)).toEqual(["b", "a"]);
  });

  it("nieparsowalna data nie wywraca sortu - porównuje się jak napis", () => {
    const rows = [
      row({ id: "zly", created_at: "brak-daty" }),
      row({ id: "dobry", created_at: "2026-08-01T10:00:00.000Z" }),
    ];
    // Wiersz z uszkodzoną datą ma trafić w deterministyczne miejsce, a nie
    // rozsypać całą listę (NaN w komparatorze).
    expect(byId(sortLeadRows(rows, "created", "asc"))).toHaveLength(2);
    expect(byId(sortLeadRows(rows, "created", "asc"))).toEqual(
      byId(sortLeadRows([...rows].reverse(), "created", "asc")),
    );
  });

  it("etap spoza ENUM-a nie znika z listy - sortuje się jak napis", () => {
    const rows = [row({ id: "nieznany", stage: "zombie" }), row({ id: "nowy", stage: "new" })];
    expect(byId(sortLeadRows(rows, "stage", "asc"))).toHaveLength(2);
    expect(byId(sortLeadRows(rows, "stage", "asc"))).toEqual(
      byId(sortLeadRows([...rows].reverse(), "stage", "asc")),
    );
  });

  it("compareLeadRows zwraca 0 dla wiersza porównanego ze sobą", () => {
    const r = row();
    expect(compareLeadRows(r, r, leadSortSteps("activity", "desc"))).toBe(0);
  });

  it("dwa puste pola sortu nie zamieniają się miejscami - rozstrzyga id", () => {
    const rows = [row({ id: "b", follow_up_at: null }), row({ id: "a", follow_up_at: null })];
    expect(byId(sortLeadRows(rows, "followUp", "asc"))).toEqual(["a", "b"]);
  });
});

describe("renderowanie liści do składni PostgREST", () => {
  it("każdy operator ma swoją postać w .or()", () => {
    expect(leafToOrTerm({ op: "isNull", column: "source_count" })).toBe("source_count.is.null");
    expect(leafToOrTerm({ op: "notNull", column: "newsletter_status" })).toBe(
      "newsletter_status.not.is.null",
    );
    expect(leafToOrTerm({ op: "ilike", column: "email", pattern: "%a%" })).toBe("email.ilike.%a%");
    expect(leafToOrTerm({ op: "eq", column: "stage", value: "new" })).toBe("stage.eq.new");
    expect(leafToOrTerm({ op: "gte", column: "score", value: 10 })).toBe("score.gte.10");
    expect(leafToOrTerm({ op: "lte", column: "score", value: 90 })).toBe("score.lte.90");
    expect(leafToOrTerm({ op: "in", column: "owner_id", values: ["a", "b"] })).toBe(
      "owner_id.in.(a,b)",
    );
    expect(leafToOrTerm({ op: "overlaps", column: "tags", values: ["eu"] })).toBe("tags.ov.{eu}");
  });

  it("samotny ilike też idzie przez .or (jedna droga renderowania)", () => {
    const q = applyLeadFilterSpec(new RecordingQuery(), [
      { op: "ilike", column: "email", pattern: "%a%" },
    ]);
    expect(q.calls).toEqual([{ method: "or", args: ["email.ilike.%a%"] }]);
  });
});

describe("kontrakt z bazą", () => {
  it("kolejność etapów odpowiada deklaracji ENUM w migracji", () => {
    const sql = readFileSync(
      "supabase/migrations/20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql",
      "utf8",
    );
    const match = sql.match(/CREATE TYPE public\.crm_stage AS ENUM \(([^)]*)\)/);
    expect(match).toBeTruthy();
    const declared = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    // Postgres sortuje ENUM wg kolejności deklaracji - gdyby migracja dołożyła
    // etap w środku, sort po `stage` w JS i w SQL rozjechałby się bezgłośnie.
    expect(declared).toEqual([...LEAD_STAGE_ORDER]);
  });

  it("każda kolumna sortu i filtra ma zadeklarowany typ", () => {
    const sortColumns = LEAD_SORT_KEYS.flatMap((k: LeadSortKey) => [...LEAD_SORT_COLUMNS[k]]);
    for (const column of [...sortColumns, LEAD_SORT_TIEBREAKER, ...LEAD_SEARCH_COLUMNS]) {
      expect(LEAD_COLUMN_TYPES[column]).toBeDefined();
    }
  });
});
