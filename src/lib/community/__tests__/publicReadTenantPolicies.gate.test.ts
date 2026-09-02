// BRAMKA: publiczny czytnik społeczności kontra STAN KOŃCOWY polityk i grantów.
//
// PO CO TEN PLIK ISTNIEJE
//
// `src/lib/community/publicQueries.ts` nie zawiera ANI JEDNEGO warunku
// tenantowego. Czyta pięć tabel (`events`, `polls`, `qa_sessions`, `posts`,
// `member_resources`) zwykłym `from(...).select(...)`, a rozdziałem najemców
// zajmuje się wyłącznie RLS przez `public_tenant_id()`. To jest poprawna
// architektura - i zarazem architektura, w której USUNIĘCIE JEDNEJ POLITYKI
// nie psuje ani typów, ani builda, ani żadnego testu na atrapie klienta.
// Wszystkie testy siostrzanego `publicQueries.test.ts` przeszłyby tak samo,
// gdyby `events` czytały się przez granice najemców. Ten plik jest jedynym
// miejscem, w którym tamta cisza zamienia się w czerwień.
//
// TO NIE JEST ODCZYT POJEDYNCZEJ MIGRACJI. `extractLatestPolicies` odtwarza
// zdarzenia CREATE/DROP POLICY po kolei (migracje są forward-only, a idiomem
// repo jest „DROP IF EXISTS + CREATE" w jednym pliku), więc pytamy o STAN
// KOŃCOWY. Ta sama metoda, co w bramkach `check:sql-owner-tenant-scope`
// i `check:sql-anon-insert` oraz w `src/lib/ci/__tests__/tenantIsolationPolicies.test.ts`.
//
// ── ZNALEZISKO (opisane niżej testem `it.fails` z kontrolą dodatnią) ────────
//
// Wszystkie pięć tabel MA politykę publicznego odczytu wiążącą `tenant_id`
// z `public_tenant_id()`. Ale bramka `check:sql-owner-tenant-scope` jest
// SAMOKALIBRUJĄCA: dla danej tabeli szuka ŚWIADKA, czyli polityki
// WŁAŚCICIELSKIEJ (`kolumna = auth.uid()`), która wiąże tenanta, i dopiero
// wtedy wymaga tego od pozostałych klauzul właścicielskich. Na `qa_sessions`
// świadka NIE MA: obie polityki właścicielskie ("qa sessions host read",
// "qa sessions host update") stoją na gołym `host_user_id = auth.uid()`,
// bez tenanta. Tabela wygląda więc dla bramki jak „świadomie globalna"
// (`witnesses.length === 0 -> continue`) i bramka jej nie analizuje w ogóle -
// mimo że `qa_sessions.tenant_id` istnieje i mimo że rodzeństwo NIE-właścicielskie
// (staff, publiczny odczyt) tenanta pilnuje. Skutek: host sesji Q&A czyta
// i modyfikuje swój wiersz w DOWOLNYM kontekście najemcy, a CI o tym nie mówi.
//
// Zgodnie z regułą modułu: NIE dopisuję polityki do migracji. Kontrakt jest
// przypięty `it.fails` (padnie w dniu naprawy, wtedy trzeba go odpiąć),
// a osobny `it` dowodzi, że te same asercje PRZECHODZĄ dla sąsiedniej tabeli
// `posts`, która świadka ma - czyli że test mierzy defekt, nie własną pomyłkę.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeOwnerTenantScope, isOwnerScoped, unscopedClauses } from "@/lib/ci/ownerTenantScope";
import { extractLatestPolicies, type PolicyDef } from "@/lib/ci/rlsPolicies";
import { stripSqlComments } from "../../../../scripts/lib/sqlMigrations";
import { publicEventRow } from "@/test/events/publicEventRow";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

interface MigrationSql {
  readonly file: string;
  readonly sql: string;
}

function migrations(): MigrationSql[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

const FILES = migrations();
const POLICIES: PolicyDef[] = [...extractLatestPolicies(FILES).values()];

/** Tabele czytane przez `publicQueries.ts` (jedno źródło prawdy dla tego pliku). */
const PUBLICLY_READ_TABLES = [
  "events",
  "polls",
  "qa_sessions",
  "posts",
  "member_resources",
] as const;

/** Predykat polityki bez białych znaków i wielkości liter - do porównań. */
function flatten(expr: string | null): string {
  return (expr ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function policiesOf(table: string): PolicyDef[] {
  return POLICIES.filter((policy) => policy.table === table);
}

/** Polityki, które CZYTA rola `anon` - powierzchnia publicznego odczytu. */
function anonReadable(table: string): PolicyDef[] {
  return policiesOf(table).filter(
    (policy) =>
      (policy.command === "select" || policy.command === "all") &&
      (policy.roles.has("anon") || policy.roles.has("public")),
  );
}

// ---------------------------------------------------------------------------
// Granty kolumnowe (statyczna analiza, taka sama forward-only jak przy politykach)
// ---------------------------------------------------------------------------

interface GrantState {
  /** Kolumny nadane jawnie po ostatnim REVOKE. */
  readonly columns: ReadonlySet<string>;
  /** Czy obowiązuje grant TABELOWY (bez listy kolumn) - wtedy widać wszystko. */
  readonly wholeTable: boolean;
}

interface GrantEvent {
  readonly index: number;
  readonly kind: "revoke" | "grant";
  readonly roles: readonly string[];
  /** `null` dla grantu tabelowego. */
  readonly columns: readonly string[] | null;
}

function splitRoles(raw: string): string[] {
  return raw
    .split(",")
    .map((role) => role.replace(/"/g, "").trim().toLowerCase())
    .filter((role) => role !== "");
}

/**
 * Zdarzenia GRANT/REVOKE SELECT dla jednej tabeli w jednym pliku, w kolejności
 * wystąpienia. Wzorce są ograniczone do JEDNEJ instrukcji (`[^;]`), bo leniwy
 * `[\s\S]*?` przeskakiwał średnik i sklejał grant jednej tabeli z nazwą innej.
 */
function grantEventsIn(sql: string, table: string): GrantEvent[] {
  const events: GrantEvent[] = [];
  const revoke = new RegExp(
    `REVOKE\\s+([^;]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\s+FROM\\s+([A-Za-z0-9_,"\\s]+?);`,
    "gi",
  );
  const grant = new RegExp(
    `GRANT\\s+([^;]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\s+TO\\s+([A-Za-z0-9_,"\\s]+?);`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = revoke.exec(sql)) !== null) {
    if (!/\bselect\b/i.test(match[1]) && !/\ball\b/i.test(match[1])) continue;
    events.push({ index: match.index, kind: "revoke", roles: splitRoles(match[2]), columns: null });
  }
  while ((match = grant.exec(sql)) !== null) {
    const privileges = match[1];
    if (!/\bselect\b/i.test(privileges) && !/\ball\b/i.test(privileges)) continue;
    const columnList = /\b(?:SELECT|ALL)\s*\(([^)]*)\)/i.exec(privileges);
    events.push({
      index: match.index,
      kind: "grant",
      roles: splitRoles(match[2]),
      columns:
        columnList === null
          ? null
          : columnList[1]
              .split(",")
              .map((column) => column.replace(/"/g, "").trim().toLowerCase())
              .filter((column) => column !== ""),
    });
  }
  return events.sort((a, b) => a.index - b.index);
}

/** Stan końcowy uprawnienia SELECT roli na tabeli po wszystkich migracjach. */
function selectGrant(table: string, role: string): GrantState {
  const columns = new Set<string>();
  let wholeTable = false;
  for (const { sql } of FILES) {
    for (const event of grantEventsIn(sql, table)) {
      if (!event.roles.includes(role)) continue;
      if (event.kind === "revoke") {
        columns.clear();
        wholeTable = false;
      } else if (event.columns === null) {
        wholeTable = true;
      } else {
        for (const column of event.columns) columns.add(column);
      }
    }
  }
  return { columns, wholeTable };
}

// ---------------------------------------------------------------------------
// 1. Granica najemcy na publicznej ścieżce odczytu
// ---------------------------------------------------------------------------

describe("każda tabela czytana przez publicQueries.ts ma politykę wiążącą najemcę", () => {
  for (const table of PUBLICLY_READ_TABLES) {
    it(`${table}: istnieje polityka odczytu z public_tenant_id()`, () => {
      const witnesses = anonReadable(table).filter((policy) =>
        /public_tenant_id\(\)/.test(flatten(policy.using)),
      );

      expect(
        witnesses.map((policy) => policy.name),
        `brak polityki publicznego odczytu wiążącej najemcę na "${table}"`,
      ).not.toEqual([]);
    });

    it(`${table}: ŻADNA polityka czytelna dla anon nie jest bez najemcy`, () => {
      // Jedna polityka anon bez `tenant_id` wystarczy, żeby treść jednego
      // najemcy wyszła na domenie drugiego - alternatywa polityk jest SUMĄ
      // uprawnień, nie ich przecięciem.
      const unbound = anonReadable(table)
        .filter((policy) => !/tenant_id/.test(flatten(policy.using)))
        .map((policy) => policy.name);

      expect(unbound).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Filtr klienta ma odpowiednik po stronie bazy (obrona w głąb)
// ---------------------------------------------------------------------------

describe("filtr statusu w zapytaniu klienta jest POWTÓRZONY w polityce", () => {
  // `publicQueries.ts` filtruje statusy sam (`.eq("status","published")`,
  // `.neq("status","draft")`, `.in("status", [...])`, `.eq("published", true)`,
  // `.is("deleted_at", null)`). To jest filtr POPRAWNOŚCI WIDOKU, nie granica
  // poufności: usunięty przypadkiem `.eq()` nie może odsłonić szkicu, bo ten sam
  // warunek stoi w polityce. Ten test pilnuje, żeby ta druga warstwa istniała.
  const EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["events", ["status = 'published'"]],
    ["polls", ["status in ('open', 'closed')"]],
    ["qa_sessions", ["status <> 'draft'"]],
    ["posts", ["status = 'published'", "deleted_at is null"]],
    ["member_resources", ["published"]],
  ];

  for (const [table, fragments] of EXPECTED) {
    it(`${table}: polityka odczytu niesie ${fragments.join(" + ")}`, () => {
      const predicates = anonReadable(table)
        .filter((policy) => /public_tenant_id\(\)/.test(flatten(policy.using)))
        .map((policy) => flatten(policy.using));

      expect(predicates.length).toBeGreaterThan(0);
      for (const fragment of fragments) {
        expect(
          predicates.some((predicate) => predicate.includes(fragment)),
          `żadna polityka publicznego odczytu "${table}" nie niesie \`${fragment}\``,
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Grant kolumnowy `events` kontra lista kolumn czytnika
// ---------------------------------------------------------------------------

describe("grant kolumnowy events: pole dopisane bez GRANT-u wywraca CAŁĄ stronę", () => {
  // Migracja 20260803191905 odebrała `anon`/`authenticated` tabelowy SELECT na
  // `public.events` i nadała go z jawną allowlistą kolumn. PostgREST odmawia
  // CAŁEGO zapytania, gdy w `select` jest choć jedna kolumna spoza allowlisty -
  // więc rozjazd tej listy z grantem to nie „puste pole", tylko lista wydarzeń
  // i strona wydarzenia, które przestają się wczytywać. Zgodność EVENT_COLUMNS
  // z typem `PublicEvent` dowodzi `publicQueries.test.ts`; tu bierzemy ten sam
  // zbiór pól i konfrontujemy go z grantem.
  const readColumns = Object.keys(publicEventRow());

  for (const role of ["anon", "authenticated"] as const) {
    it(`${role}: każda czytana kolumna jest objęta GRANT SELECT`, () => {
      const grant = selectGrant("events", role);
      expect(grant.wholeTable, "events nie powinno mieć grantu tabelowego").toBe(false);

      const missing = readColumns.filter((column) => !grant.columns.has(column));

      expect(missing, `kolumny bez GRANT SELECT dla roli ${role}`).toEqual([]);
    });
  }

  it("join_url i recording_url pozostają POZA grantem - jedyną drogą jest get_event_access", () => {
    const grant = selectGrant("events", "anon");

    expect(grant.columns.has("join_url")).toBe(false);
    expect(grant.columns.has("recording_url")).toBe(false);
    expect(readColumns).not.toContain("join_url");
    expect(readColumns).not.toContain("recording_url");
  });

  it("USTALENIE: pominięcie file_path w bibliotece jest decyzją KLIENTA, nie bazy", () => {
    // `fetchLibraryResources` świadomie nie wybiera `file_path` (plik siedzi
    // w prywatnym buckecie, pobranie idzie przez `authorize_resource_download`).
    // Warto wiedzieć, ile ta ostrożność jest warta: `member_resources` ma grant
    // TABELOWY, więc dowolny inny klient tę kolumnę odczyta dla opublikowanego
    // wiersza. Ścieżka sama w sobie nie daje dostępu do pliku - ale to jest
    // jedyny powód, dla którego to nie jest wyciek, i test ma to mówić wprost,
    // a nie sugerować granicy, której tam nie ma.
    expect(selectGrant("member_resources", "anon").wholeTable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. ZNALEZISKO: bramka owner-tenant-scope nie ma świadka na qa_sessions
// ---------------------------------------------------------------------------

describe("ZNALEZISKO: qa_sessions poza zasięgiem bramki owner-tenant-scope", () => {
  const ownerPoliciesOf = (table: string) => policiesOf(table).filter(isOwnerScoped);

  it("qa_sessions MA polityki właścicielskie (host sesji)", () => {
    // Warunek sensu obu testów niżej: gdyby polityk właścicielskich nie było,
    // „brak świadka" byłby poprawny, a nie ślepy.
    expect(
      ownerPoliciesOf("qa_sessions")
        .map((policy) => policy.name)
        .sort(),
    ).toEqual(["qa sessions host read", "qa sessions host update"]);
  });

  it("qa_sessions JEST tabelą najemcową - rodzeństwo polityk pilnuje tenanta", () => {
    const tenantAware = policiesOf("qa_sessions")
      .filter((policy) => /tenant_id/.test(`${flatten(policy.using)} ${flatten(policy.withCheck)}`))
      .map((policy) => policy.name);

    expect(tenantAware.length).toBeGreaterThan(0);
  });

  it.fails("DEFEKT: klauzule właścicielskie qa_sessions nie wiążą najemcy", () => {
    const gaps = ownerPoliciesOf("qa_sessions")
      .map((policy) => ({ name: policy.name, clauses: unscopedClauses(policy) }))
      .filter((entry) => entry.clauses.length > 0);

    expect(gaps).toEqual([]);
  });

  it("kontrola dodatnia: te same asercje PRZECHODZĄ dla posts", () => {
    // `posts` ma polityki właścicielskie („authors insert own tenant posts",
    // „authors update tenant posts") i obie wiążą tenanta - więc `it.fails`
    // wyżej mierzy stan qa_sessions, a nie błąd tej metody pomiaru.
    const owners = ownerPoliciesOf("posts");
    expect(owners.length).toBeGreaterThan(0);

    const gaps = owners
      .map((policy) => ({ name: policy.name, clauses: unscopedClauses(policy) }))
      .filter((entry) => entry.clauses.length > 0);

    expect(gaps).toEqual([]);
  });

  it("BRAMKA MILCZY: brak świadka wyklucza qa_sessions z analizy, mimo luki", () => {
    // To jest sedno znaleziska. Luka istnieje (test `it.fails` wyżej), a mimo to
    // `check:sql-owner-tenant-scope` nie zgłasza jej ANI jako nowej luki, ANI
    // jako znanego długu - bo `analyzeOwnerTenantScope` pomija tabelę bez
    // właścicielskiego świadka (`witnesses.length === 0 -> continue`).
    // Dopisanie tenanta do JEDNEJ z dwóch polityk hosta uczyniłoby ją świadkiem
    // i bramka natychmiast zapaliłaby się na drugiej.
    const report = analyzeOwnerTenantScope(POLICIES);
    const mentioned = [...report.gaps, ...report.knownGaps].filter(
      (gap) => gap.table === "qa_sessions",
    );

    expect(mentioned).toEqual([]);
    expect(unscopedClauses(ownerPoliciesOf("qa_sessions")[0]).length).toBeGreaterThan(0);
  });

  it("kontrola dodatnia mechanizmu: posts MA świadka, więc jest analizowany", () => {
    const witnesses = ownerPoliciesOf("posts").filter(
      (policy) => unscopedClauses(policy).length === 0,
    );

    expect(witnesses.length).toBeGreaterThan(0);
  });
});
