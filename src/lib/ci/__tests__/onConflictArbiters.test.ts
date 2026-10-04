// @vitest-environment node
// TEST BRAMKI ARBITRÓW `onConflict` - z KONTROLĄ NEGATYWNĄ I STANEM REPO.
//
// Regresja, której ta bramka pilnuje, przeszła przez CI dlatego, że test
// `invitationsFunctions.test.ts` jechał na atrapie bazy przyjmującej KAŻDY cel
// konfliktu - i zamroził zły cel `user_id,role` jako oczekiwany. Dlatego
// pierwszy blok niżej odtwarza DOKŁADNIE trzy kroki historii `user_roles`
// z migracji 20260531180217 (linia 29) i 20260531181120 (linie 49-50): zły cel
// musi być czerwony, a dobry - w dowolnej kolejności kolumn - zielony.
//
// Fixture'y są atrapami SQL i TS (przedmiotem dowodu jest reakcja na KSZTAŁT
// wejścia), a ostatni blok liczy bramkę na PRAWDZIWYM repozytorium, żeby
// inwariant jechał także w `bun run test` i w `check:ci-gates`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrationFiles } from "../../../../scripts/lib/sqlMigrations";
import {
  analyzeOnConflictArbiters,
  buildUniqueKeyModel,
  extractOnConflictTargets,
  onConflictArbitersFailed,
  parseConflictTarget,
  renderOnConflictArbitersReport,
  splitSqlStatementsDeep,
  type MigrationFile,
  type SourceFile,
  type UniqueKey,
} from "../onConflictArbiters";

/** Trzy kroki historii `user_roles` - słowo w słowo jak w migracjach. */
const USER_ROLES_HISTORY: MigrationFile[] = [
  {
    file: "20260531180217_924cc12b-a305-41ff-9e8d-21e89de39c86.sql",
    sql: `
-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);`,
  },
  {
    file: "20260531181120_d76ba039-9c35-4128-a979-7dd406a536e1.sql",
    sql: `
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.user_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_per_tenant ON public.user_roles (tenant_id, user_id, role);`,
  },
];

/** Kształt wywołania z `performSend` - wieloliniowy, jak po prettierze. */
function roleUpsert(target: string, file = "src/lib/admin/invitations.functions.ts"): SourceFile {
  return {
    file,
    code: [
      "export async function performSend() {",
      "  const { error: roleWriteError } = await supabaseAdmin",
      '    .from("user_roles")',
      "    .upsert(",
      "      { user_id: authUserId, role: inv.role, tenant_id: inv.tenant_id },",
      `      { onConflict: "${target}", ignoreDuplicates: true },`,
      "    );",
      "  if (roleWriteError) throw new Error(`role_write_failed:${roleWriteError.message}`);",
      "}",
    ].join("\n"),
  };
}

function keysOf(migrations: MigrationFile[], table: string): readonly UniqueKey[] {
  return buildUniqueKeyModel(migrations).tables.get(table) ?? [];
}

const sql = (text: string, file = "20990101000000_fixture.sql"): MigrationFile => ({
  file,
  sql: text,
});
const ts = (code: string, file = "src/lib/fixture.ts"): SourceFile => ({ file, code });

describe("regresja user_roles: UNIQUE(user_id, role) -> DROP -> UNIQUE INDEX (tenant_id, user_id, role)", () => {
  it("model stanu końcowego zna wyłącznie PK i indeks per najemca", () => {
    const keys = keysOf(USER_ROLES_HISTORY, "user_roles");
    expect(keys.map((key) => [key.name, key.origin, key.columns])).toEqual([
      ["user_roles_pkey", "primary", ["id"]],
      ["user_roles_unique_per_tenant", "index", ["tenant_id", "user_id", "role"]],
    ]);
  });

  it('`onConflict: "user_id,role"` to naruszenie z podpowiedzią poprawnego celu', () => {
    const report = analyzeOnConflictArbiters({
      migrations: USER_ROLES_HISTORY,
      sources: [roleUpsert("user_id,role")],
    });
    expect(onConflictArbitersFailed(report)).toBe(true);
    expect(report.violations).toHaveLength(1);
    const [violation] = report.violations;
    expect(violation.problem).toBe("no-arbiter");
    expect(violation.site).toMatchObject({
      file: "src/lib/admin/invitations.functions.ts",
      line: 6,
      table: "user_roles",
      target: "user_id,role",
    });
    expect(violation.suggestions).toEqual(["tenant_id,user_id,role"]);

    const rendered = renderOnConflictArbitersReport(report);
    expect(rendered).toContain("src/lib/admin/invitations.functions.ts:6");
    expect(rendered).toContain("user_roles_unique_per_tenant (tenant_id, user_id, role)");
    expect(rendered).toContain('przejdzie: onConflict: "tenant_id,user_id,role"');
    expect(rendered).toContain("42P10");
  });

  it.each(["tenant_id,user_id,role", "role,user_id,tenant_id", " tenant_id , user_id,role "])(
    'cel "%s" ma arbitra (kolejność i spacje bez znaczenia)',
    (target) => {
      const report = analyzeOnConflictArbiters({
        migrations: USER_ROLES_HISTORY,
        sources: [roleUpsert(target)],
      });
      expect(report.violations).toEqual([]);
      expect(report.unresolved).toEqual([]);
      expect(onConflictArbitersFailed(report)).toBe(false);
      expect(renderOnConflictArbitersReport(report)).toContain("Arbitrzy onConflict OK");
    },
  );

  it("nadzbiór i podzbiór kolumn klucza NIE są arbitrem (Postgres wymaga równości zbiorów)", () => {
    for (const target of ["user_id", "tenant_id,user_id", "tenant_id,user_id,role,id"]) {
      const report = analyzeOnConflictArbiters({
        migrations: USER_ROLES_HISTORY,
        sources: [roleUpsert(target)],
      });
      expect(report.violations, target).toHaveLength(1);
    }
  });
});

describe("model kluczy unikalnych - składnia migracji", () => {
  it("indeks częściowy NIE jest arbitrem (PostgREST nie wysyła predykatu)", () => {
    const migrations = [
      sql(`
CREATE TABLE public.crm_leads (id uuid PRIMARY KEY, tenant_id uuid, phone_norm text);
CREATE UNIQUE INDEX crm_leads_tenant_phone_norm_uniq ON public.crm_leads (tenant_id, phone_norm)
  WHERE phone_norm IS NOT NULL;`),
    ];
    const [, partial] = keysOf(migrations, "crm_leads");
    expect(partial).toMatchObject({ name: "crm_leads_tenant_phone_norm_uniq", partial: true });
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [
        ts('await db.from("crm_leads").upsert(rows, { onConflict: "tenant_id,phone_norm" });'),
      ],
    });
    expect(report.violations).toHaveLength(1);
    expect(renderOnConflictArbitersReport(report)).toContain("częściowy - nie arbiter");
  });

  it("indeks na wyrażeniu NIE jest arbitrem listy kolumn, a jego domyślna nazwa idzie za Postgresem", () => {
    const migrations = [
      sql(`
CREATE TABLE public.newsletter_subscribers (id uuid PRIMARY KEY, tenant_id uuid, email text);
CREATE UNIQUE INDEX ON public.newsletter_subscribers (tenant_id, lower(email));
CREATE UNIQUE INDEX subs_ci ON public.newsletter_subscribers USING btree ((lower(email)), tenant_id);`),
    ];
    const keys = keysOf(migrations, "newsletter_subscribers");
    // Nazwy zmierzone na PostgreSQL 16: element-funkcja daje człon `lower`.
    expect(keys.map((key) => key.name)).toEqual([
      "newsletter_subscribers_pkey",
      "newsletter_subscribers_tenant_id_lower_idx",
      "subs_ci",
    ]);
    expect(keys.filter((key) => key.expression)).toHaveLength(2);
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [
        ts('await db.from("newsletter_subscribers").upsert(r, { onConflict: "tenant_id,email" });'),
      ],
    });
    expect(report.violations).toHaveLength(1);
  });

  it("kolumna z COLLATE/opclass/DESC pozostaje kolumną, a INCLUDE nie wchodzi do klucza", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (a text, b int, c int);
CREATE UNIQUE INDEX t_ab ON public.t (a COLLATE "C" text_pattern_ops, b DESC NULLS LAST) INCLUDE (c);`),
      ],
      "t",
    );
    expect(keys).toEqual([
      expect.objectContaining({ name: "t_ab", columns: ["a", "b"], expression: false }),
    ]);
  });

  it("domyślne nazwy: przycięcie do 63 bajtów, numerowanie kolizji, scalenie UNIQUE z PK", () => {
    // Każda nazwa niżej zmierzona na PostgreSQL 16 (BEGIN … ROLLBACK).
    const migrations = [
      sql(`
CREATE TABLE public.zz_a_very_long_table_name_for_identifier_truncation_x (
  first_column int, second_column int, UNIQUE (first_column, second_column));
CREATE TABLE public.zz_merge (id uuid PRIMARY KEY UNIQUE, a int UNIQUE, b int, UNIQUE (a));
CREATE TABLE public.zz_coll (a_b int, a int, b int, UNIQUE (a, b), UNIQUE (a_b));
ALTER TABLE public.zz_a_very_long_table_name_for_identifier_truncation_x
  DROP CONSTRAINT zz_a_very_long_table_name_for_id_first_column_second_column_key;`),
    ];
    const model = buildUniqueKeyModel(migrations);
    expect(model.tables.get("zz_a_very_long_table_name_for_identifier_truncation_x")).toEqual([]);
    expect(model.tables.get("zz_merge")?.map((key) => key.name)).toEqual([
      "zz_merge_a_key",
      "zz_merge_pkey",
    ]);
    expect(model.tables.get("zz_coll")?.map((key) => key.name)).toEqual([
      "zz_coll_a_b_key",
      "zz_coll_a_b_key1",
    ]);
  });

  it("RENAME tabeli niesie klucze (nazwy zostają), RENAME COLUMN przepina kolumny klucza", () => {
    const migrations = [
      sql(`
CREATE TABLE public.expert_inmails (id uuid PRIMARY KEY, sender uuid, slot int, UNIQUE (sender, slot));
ALTER TABLE public.expert_inmails RENAME TO expert_requests;
ALTER TABLE public.expert_requests RENAME COLUMN sender TO requester_id;`),
    ];
    const model = buildUniqueKeyModel(migrations);
    expect(model.tables.has("expert_inmails")).toBe(false);
    expect(model.tables.get("expert_requests")?.map((key) => [key.name, key.columns])).toEqual([
      ["expert_inmails_pkey", ["id"]],
      ["expert_inmails_sender_slot_key", ["requester_id", "slot"]],
    ]);
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [
        ts('await db.from("expert_requests").upsert(r, { onConflict: "slot,requester_id" });'),
        ts('await db.from("expert_inmails").upsert(r, { onConflict: "id" });', "src/lib/old.ts"),
      ],
    });
    expect(report.violations.map((v) => [v.site.table, v.problem])).toEqual([
      ["expert_inmails", "missing-table"],
    ]);
  });

  it("RENAME CONSTRAINT i ALTER INDEX RENAME zmieniają nazwę, pod którą DROP zdejmuje klucz", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (a int, b int, c int, CONSTRAINT t_u UNIQUE (a), CONSTRAINT t_v UNIQUE (b));
CREATE UNIQUE INDEX t_w ON public.t (c);
ALTER TABLE public.t RENAME CONSTRAINT t_u TO t_u2;
ALTER INDEX IF EXISTS public.t_w RENAME TO t_w2;
ALTER TABLE public.t DROP CONSTRAINT IF EXISTS t_u;
ALTER TABLE ONLY public.t DROP CONSTRAINT t_v;`),
      ],
      "t",
    );
    expect(keys.map((key) => key.name)).toEqual(["t_u2", "t_w2"]);
  });

  it("DROP INDEX (lista, schemat, CONCURRENTLY, IF EXISTS) zdejmuje klucze", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int, c int);
CREATE UNIQUE INDEX t_a ON public.t (a);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS t_b ON ONLY public.t (b);
CREATE UNIQUE INDEX t_c ON t (c);
DROP INDEX IF EXISTS public.t_a, t_b CASCADE;
DROP INDEX CONCURRENTLY public.t_missing;`),
      ],
      "t",
    );
    expect(keys.map((key) => key.name)).toEqual(["t_c", "t_pkey"]);
  });

  it("DROP COLUMN zdejmuje każdy klucz, który jej dotyka - także wielokolumnowy i częściowy", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int, flag bool);
ALTER TABLE public.t ADD CONSTRAINT t_ab UNIQUE (a, b);
CREATE UNIQUE INDEX t_b_flag ON public.t (b) WHERE flag;
ALTER TABLE public.t DROP COLUMN IF EXISTS a, DROP COLUMN flag;`),
      ],
      "t",
    );
    expect(keys.map((key) => key.name)).toEqual(["t_pkey"]);
  });

  it("IF NOT EXISTS: CREATE TABLE, CREATE UNIQUE INDEX i ADD COLUMN … UNIQUE są no-op, gdy obiekt jest", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int);
CREATE TABLE IF NOT EXISTS public.t (id int, UNIQUE (id, a));
CREATE UNIQUE INDEX t_idx ON public.t (a);
CREATE UNIQUE INDEX IF NOT EXISTS t_idx ON public.t (b);
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS a int UNIQUE;
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c text UNIQUE;`),
      ],
      "t",
    );
    expect(keys.map((key) => [key.name, key.columns])).toEqual([
      ["t_c_key", ["c"]],
      ["t_idx", ["a"]],
      ["t_pkey", ["id"]],
    ]);
  });

  it("blok DO: gałąź strażnika i EXECUTE z literałem są stosowane, EXECUTE format(...) idzie do raportu", () => {
    const model = buildUniqueKeyModel([
      sql(`
CREATE TABLE public.events (id uuid PRIMARY KEY, tenant_id uuid);
CREATE TABLE public.pages (id uuid PRIMARY KEY, tenant_id uuid);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.events'::regclass AND conname = 'events_tenant_id_key'
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
  RAISE NOTICE 'ALTER TABLE public.events DROP CONSTRAINT events_tenant_id_key';
END $$;
DO $mig$
DECLARE v_name text;
BEGIN
  EXECUTE 'ALTER TABLE public.pages ADD CONSTRAINT pages_id_tenant_id_key UNIQUE (id, tenant_id)';
  EXECUTE format('ALTER TABLE public.pages DROP CONSTRAINT %I', v_name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $mig$;`),
    ]);
    expect(model.tables.get("events")?.map((key) => key.name)).toEqual([
      "events_pkey",
      "events_tenant_id_key",
    ]);
    expect(model.tables.get("pages")?.map((key) => key.name)).toEqual([
      "pages_id_tenant_id_key",
      "pages_pkey",
    ]);
    expect(model.dynamicDdl).toEqual([
      {
        file: "20990101000000_fixture.sql",
        text: "format('ALTER TABLE public.pages DROP CONSTRAINT %I', v_name)",
      },
    ]);
  });

  it("ciało CREATE FUNCTION nie jest wykonywane przy migracji - jego DDL nie zmienia modelu", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int UNIQUE);
CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.t DROP CONSTRAINT t_a_key;
END $$;`),
      ],
      "t",
    );
    expect(keys.map((key) => key.name)).toEqual(["t_a_key", "t_pkey"]);
  });

  it("identyfikatory: wielkość liter, cudzysłów, schemat public opcjonalny, inne schematy pominięte", () => {
    const model = buildUniqueKeyModel([
      sql(`
CREATE TABLE PUBLIC.Site_Settings (Tenant_Id uuid, "Key" text, CONSTRAINT "Site_PK" PRIMARY KEY (Tenant_Id, "Key"));
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE UNIQUE INDEX users_email ON auth.users (email);
-- ALTER TABLE public.site_settings DROP CONSTRAINT "Site_PK";
/* CREATE UNIQUE INDEX bogus ON public.site_settings (tenant_id); */`),
    ]);
    expect(model.tables.has("users")).toBe(false);
    expect(model.tables.get("site_settings")).toEqual([
      expect.objectContaining({
        name: "Site_PK",
        origin: "primary",
        columns: ["tenant_id", "Key"],
      }),
    ]);
  });

  it("DEFERRABLE i UNIQUE USING INDEX: odraczalny nie jest arbitrem, przejęty indeks staje się ograniczeniem", () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (a int, b int, c int UNIQUE DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX t_ab_idx ON public.t (a, b);
ALTER TABLE public.t ADD CONSTRAINT t_ab UNIQUE USING INDEX t_ab_idx;`),
      ],
      "t",
    );
    expect(keys.map((key) => [key.name, key.origin, key.deferrable])).toEqual([
      ["t_ab", "unique", false],
      ["t_c_key", "unique", true],
    ]);
  });

  it("DROP TABLE, SET SCHEMA i widok w miejscu tabeli dają naruszenie z właściwym powodem", () => {
    const migrations = [
      sql(`
CREATE TABLE public.a (id int PRIMARY KEY);
CREATE TABLE public.b (id int PRIMARY KEY);
CREATE TABLE public.suppressed_emails (email text PRIMARY KEY);
DROP TABLE IF EXISTS public.a, public.b CASCADE;
ALTER TABLE public.suppressed_emails SET SCHEMA archive;
CREATE OR REPLACE VIEW public.suppressed_emails AS SELECT 1 AS email;`),
    ];
    const report = analyzeOnConflictArbiters({
      migrations: [...migrations, sql("CREATE TABLE public.keep (id int PRIMARY KEY);", "z.sql")],
      sources: [
        ts(
          [
            'await db.from("a").upsert(r, { onConflict: "id" });',
            'await db.from("suppressed_emails").upsert(r, { onConflict: "email" });',
          ].join("\n"),
        ),
      ],
    });
    expect(report.violations.map((v) => [v.site.table, v.problem])).toEqual([
      ["a", "missing-table"],
      ["suppressed_emails", "view"],
    ]);
  });

  it("dzielenie instrukcji rozumie dollar-quote, literały E'…' i średniki w komentarzach", () => {
    expect(
      splitSqlStatementsDeep(
        "SELECT 'a;b'; -- x; y\nSELECT E'c\\';d'; DO $t$ BEGIN PERFORM 1; END $t$; /* ; */ SELECT 2",
      ),
    ).toEqual(["SELECT 'a;b'", "SELECT E'c\\';d'", "DO $t$ BEGIN PERFORM 1; END $t$", "SELECT 2"]);
  });
});

describe("ekstrakcja celów onConflict z kodu", () => {
  const known = new Set(["crm_leads", "site_settings", "user_roles"]);

  it("komentarze (liniowy, blokowy, JSDoc) i napisy wspominające onConflict nie są celem", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(`
// upsert z \`onConflict: "endpoint"\` - kiedyś tak było
/**
 * Zapis przez upsert z \`onConflict: "tenant_id"\` - pierwszy zapis tworzy wiersz.
 * Przykład: db.from("x").upsert(row, { onConflict: "tenant_id" })
 */
const hint = 'onConflict: "nie_cel"';
const re = /onConflict: "regex"/;
export async function save() {
  await db.from("site_settings").upsert(row, { onConflict: "tenant_id,key" });
}`),
      ],
      known,
    );
    expect(unresolved).toEqual([]);
    expect(sites).toEqual([
      expect.objectContaining({ table: "site_settings", target: "tenant_id,key", line: 10 }),
    ]);
  });

  it("deklaracje typów (`onConflict?: string`, `onConflict: string`) nie są celem", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(`
interface LooseQuery { upsert(values: unknown, options?: { onConflict?: string }): void }
type Opts = { onConflict: string | undefined; ignoreDuplicates?: boolean };`),
      ],
      known,
    );
    expect(sites).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("pomocnik bez `.from`: tabela z literału znanej tabeli w odbiorcy", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(`
const { error: upErr } = await write(context, "crm_leads").upsert(unproven.map(base), {
  onConflict: "tenant_id,email_norm",
});`),
      ],
      known,
    );
    expect(unresolved).toEqual([]);
    expect(sites).toEqual([
      expect.objectContaining({
        table: "crm_leads",
        columns: ["tenant_id", "email_norm"],
        line: 3,
      }),
    ]);
  });

  it("formatowanie wieloliniowe, generyk z przecinkiem, rzutowanie, `?.` i zmienna z zapytaniem", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(`
const a = await (supabase as unknown as Client)
  .from("site_settings")
  .upsert(
    { key: "footer", value: merged } as Record<string, Json>,
    {
      onConflict: "tenant_id,key",
    },
  );
const b = await client?.from<Row>("user_roles")?.upsert(row, { onConflict: 'role,user_id' });
const query = supabase.from("crm_leads");
const c = await query.upsert(rows, { ignoreDuplicates: true, onConflict: \`tenant_id,email_norm\` });`),
      ],
      known,
    );
    expect(unresolved).toEqual([]);
    expect(sites.map((site) => [site.line, site.table, site.target])).toEqual([
      [7, "site_settings", "tenant_id,key"],
      [10, "user_roles", "role,user_id"],
      [12, "crm_leads", "tenant_id,email_norm"],
    ]);
  });

  it("stała napisowa z tego samego pliku (także skrót `{ onConflict }`) jest rozwiązywana", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(`
const USER_ROLES_CONFLICT_TARGET = "tenant_id,user_id,role";
const onConflict = "tenant_id,key" as const;
await db.from("user_roles").upsert(row, { onConflict: USER_ROLES_CONFLICT_TARGET, ignoreDuplicates: true });
await db.from("site_settings").upsert(row, { onConflict });`),
      ],
      known,
    );
    expect(unresolved).toEqual([]);
    expect(sites.map((site) => [site.table, site.target, site.viaConstant])).toEqual([
      ["user_roles", "tenant_id,user_id,role", "USER_ROLES_CONFLICT_TARGET"],
      ["site_settings", "tenant_id,key", "onConflict"],
    ]);
  });

  it("ZAMKNIĘTE NA NIEPEWNOŚĆ: wartość nieliteralna, szablon, opcje w zmiennej i nieznana tabela są raportowane", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(
          `
import { TARGET } from "./targets";
await db.from("user_roles").upsert(row, { onConflict: TARGET });
await db.from("user_roles").upsert(row, { onConflict: cond ? "a" : "b" });
await db.from("user_roles").upsert(row, { onConflict: \`tenant_id,\${col}\` });
const opts = { onConflict: "tenant_id,key" };
await db.from("site_settings").upsert(row, opts);
await db.from(tableName).upsert(row, { onConflict: "id" });
await repo.upsert(row, { onConflict: "id" });
await db.schema("private").from("user_roles").upsert(row, { onConflict: "id" });
let MUTABLE = "tenant_id,user_id,role";
await db.from("user_roles").upsert(row, { onConflict: MUTABLE });`,
          "src/lib/bad.ts",
        ),
      ],
      known,
    );
    expect(sites).toEqual([]);
    expect(unresolved.every((entry) => entry.file === "src/lib/bad.ts")).toBe(true);
    const reasonAt = (line: number) => unresolved.find((entry) => entry.line === line)?.reason;
    expect(unresolved.map((entry) => entry.line).sort((a, b) => a - b)).toEqual([
      3, 4, 5, 6, 8, 9, 10, 12,
    ]);
    // Import, wyrażenie, szablon z `${}` i `let` (do nadpisania) - nie stała.
    for (const line of [3, 4, 5, 12]) {
      expect(reasonAt(line), `linia ${line}`).toContain("nie jest literałem ani stałą napisową");
    }
    expect(reasonAt(6)).toContain("poza literałem opcji");
    expect(reasonAt(8)).toContain("`.from(...)` nie jest literałem ani stałą");
    expect(reasonAt(9)).toContain("nie da się ustalić tabeli");
    expect(reasonAt(10)).toContain("`.schema(...)`");
    expect(unresolved.find((entry) => entry.line === 6)?.excerpt).toBe(
      'const opts = { onConflict: "tenant_id,key" };',
    );
  });

  it("nierozstrzygnięte wystąpienie zapala bramkę - nie jest pomijane", () => {
    const report = analyzeOnConflictArbiters({
      migrations: USER_ROLES_HISTORY,
      sources: [
        roleUpsert("tenant_id,user_id,role"),
        ts('await db.from("user_roles").upsert(row, { onConflict: TARGET });', "src/lib/x.ts"),
      ],
    });
    expect(report.violations).toEqual([]);
    expect(report.unresolved).toHaveLength(1);
    expect(onConflictArbitersFailed(report)).toBe(true);
    expect(renderOnConflictArbitersReport(report)).toContain("src/lib/x.ts:1");
  });

  it("parseConflictTarget: przycina, zdejmuje cudzysłowy, NIE zmienia wielkości liter (PostgREST cytuje)", () => {
    expect(parseConflictTarget(' tenant_id, "Key" ,role')).toEqual(["tenant_id", "Key", "role"]);
  });
});

describe("bramka nie może być cicho zielona", () => {
  it("zero celów albo zero tabel to porażka, nie zielone światło", () => {
    const empty = analyzeOnConflictArbiters({ migrations: USER_ROLES_HISTORY, sources: [] });
    expect(onConflictArbitersFailed(empty)).toBe(true);
    expect(renderOnConflictArbitersReport(empty)).toContain("skan nic nie widzi");

    const noModel = analyzeOnConflictArbiters({
      migrations: [],
      sources: [roleUpsert("tenant_id,user_id,role")],
    });
    expect(onConflictArbitersFailed(noModel)).toBe(true);
  });
});

/**
 * Zakres skanu jak w `scripts/check-on-conflict-arbiters.ts`: kod produkcyjny
 * `src/**` bez katalogów testowych, plików `.test`/`.spec` i `src/test/**`.
 */
function productionSources(): SourceFile[] {
  const skip = new Set(["node_modules", "__tests__", "__snapshots__", "__mocks__"]);
  const walk = (dir: string, out: string[]): string[] => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  return walk("src", [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(file))
    .filter((file) => !file.startsWith("src/test/"))
    .sort()
    .map((file) => ({ file, code: readFileSync(file, "utf8") }));
}

describe("bramka arbitrów onConflict (stan faktyczny repozytorium)", () => {
  const report = analyzeOnConflictArbiters({
    migrations: loadMigrationFiles(),
    sources: productionSources(),
  });

  it("bramka faktycznie coś widzi - pusty skan nie może być zielony", () => {
    expect(report.tablesInModel).toBeGreaterThan(300);
    expect(report.sites.length).toBeGreaterThan(50);
  });

  it("każdy cel onConflict w kodzie produkcyjnym ma arbitra i daje się sprawdzić statycznie", () => {
    expect(report.unresolved).toEqual([]);
    expect(report.violations).toEqual([]);
    expect(renderOnConflictArbitersReport(report)).toContain("Arbitrzy onConflict OK");
  });
});
