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
// Bloki „przegląd adwersaryjny" to reprodukcje cichych zieleni znalezionych
// w pierwszej wersji bramki (cofanie się po tekście przez `}` poprzedniego
// bloku, „pierwsze `const query`" zamiast najbliższego, cieniowanie stałej,
// apostrof JSX + `accept="image/*"`, dynamiczne `DROP CONSTRAINT %I`,
// `stripSqlComments` połykający DROP, fałszywe alarmy modelu) - każda jako
// kontrola negatywna z POPRAWNYM werdyktem.
//
// Fixture'y są atrapami SQL i TS (przedmiotem dowodu jest reakcja na KSZTAŁT
// wejścia), a ostatni blok liczy bramkę na PRAWDZIWYM repozytorium przez TEN
// SAM loader co runner CI, żeby inwariant jechał także w `bun run test`
// i w `check:ci-gates`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  loadProductionSources,
  loadRawMigrationFiles,
} from "../../../../scripts/lib/onConflictArbitersInputs";
import { MIGRATIONS_DIR, stripSqlComments } from "../../../../scripts/lib/sqlMigrations";
import {
  DYNAMIC_DDL_BASELINE,
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
      3, 4, 5, 6, 7, 8, 9, 10, 12,
    ]);
    // Import, wyrażenie, szablon z `${}` i `let` (do nadpisania) - nie stała.
    for (const line of [3, 4, 5, 12]) {
      expect(reasonAt(line), `linia ${line}`).toContain("nie jest literałem ani stałą napisową");
    }
    expect(reasonAt(12)).toContain("`MUTABLE`: `let`/`var`");
    expect(reasonAt(6)).toContain("poza literałem opcji");
    // Opcje w zmiennej: cel może w nich siedzieć, a bramka go nie widzi.
    expect(reasonAt(7)).toContain("opcje `.upsert(...)` nie są literałem obiektu");
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

// ═══════════════════════════════════════════════════════════════════════════
// Przegląd adwersaryjny - reprodukcje z POPRAWNYM werdyktem
// ═══════════════════════════════════════════════════════════════════════════

/** Schemat do kontroli negatywnych: każdy cel ma tu jednoznaczną odpowiedź. */
const ADVERSARIAL_SCHEMA: MigrationFile[] = [
  sql(`
CREATE TABLE public.user_roles (id uuid PRIMARY KEY, user_id uuid, role text, tenant_id uuid);
CREATE UNIQUE INDEX user_roles_unique_per_tenant ON public.user_roles (tenant_id, user_id, role);
CREATE TABLE public.site_settings (tenant_id uuid, key text, PRIMARY KEY (tenant_id, key));
CREATE TABLE public.crm_leads (id uuid PRIMARY KEY, tenant_id uuid, email_norm text, UNIQUE (tenant_id, email_norm));`),
];

type Verdict = "VIOLATION" | "UNRESOLVED" | "PASS" | "NO-SITES";

/** Werdykt bramki dla jednego pliku (naruszenie > nierozstrzygnięte > zielone). */
function verdictOf(code: string, file = "src/lib/fixture.ts") {
  const report = analyzeOnConflictArbiters({
    migrations: ADVERSARIAL_SCHEMA,
    sources: [ts(code, file)],
  });
  const verdict: Verdict =
    report.violations.length > 0
      ? "VIOLATION"
      : report.unresolved.length > 0
        ? "UNRESOLVED"
        : report.sites.length > 0
          ? "PASS"
          : "NO-SITES";
  return {
    verdict,
    report,
    tables: report.sites.map((site) => [site.line, site.table, site.target]),
    reasons: report.unresolved.map((entry) => entry.reason),
  };
}

describe("przegląd adwersaryjny: odbiorca to węzły łańcucha, nie tekst przed `.upsert` (G1)", () => {
  // Stara bramka cofała się po tekście przez `}` poprzedniego bloku i brała
  // `.from()` z jego wnętrza - zła tabela, a cel przechodził na zielono.
  it.each([
    [
      "zmienna-zapytanie po bloku if",
      `export async function f(x: boolean) {
  const query = supabase.from("user_roles");
  if (x) {
    await supabase.from("site_settings").select();
  }
  await query.upsert(row, { onConflict: "tenant_id,key" });
}`,
      [6, "user_roles", "tenant_id,key"],
    ],
    [
      "pomocnik po pętli for",
      `export async function f(xs: string[]) {
  for (const x of xs) {
    await supabase.from("site_settings").delete().eq("key", x);
  }
  await write(context, "crm_leads").upsert(rows, { onConflict: "tenant_id,key" });
}`,
      [5, "crm_leads", "tenant_id,key"],
    ],
    [
      "zmienna-zapytanie po try/catch",
      `export async function f() {
  const q = supabase.from("user_roles");
  try {
    await supabase.from("site_settings").select();
  } catch {}
  await q.upsert(row, { onConflict: "tenant_id,key" });
}`,
      [6, "user_roles", "tenant_id,key"],
    ],
  ])("%s - tabela z własnego łańcucha, naruszenie", (_label, code, site) => {
    const { verdict, tables } = verdictOf(code);
    expect(verdict).toBe("VIOLATION");
    expect(tables).toEqual([site]);
  });

  it("`.schema()` z poprzedniego bloku nie przestawia odbiorcy; `.schema()` w łańcuchu - tak", () => {
    const earlier = verdictOf(`export async function f(x: boolean) {
  if (x) {
    await supabase.schema("analytics").from("events").select();
  }
  await supabase.from("site_settings").upsert(row, { onConflict: "tenant_id,key" });
}`);
    expect(earlier.verdict).toBe("PASS");

    const inChain = verdictOf(`export async function f(x: boolean) {
  if (x) {
    await supabase.schema("public").from("site_settings").select();
  }
  await supabase.schema("archive").from("site_settings").upsert(row, { onConflict: "tenant_id,key" });
}`);
    expect(inChain.verdict).toBe("UNRESOLVED");
    expect(inChain.reasons).toEqual([expect.stringContaining("`.schema(...)`")]);

    const viaClient = verdictOf(`const db = supabase.schema("archive");
await db.from("site_settings").upsert(row, { onConflict: "tenant_id,key" });`);
    expect(viaClient.verdict).toBe("UNRESOLVED");
  });

  it("odbiorca warunkowy: różne tabele - nierozstrzygnięte, ta sama - sprawdzana", () => {
    const split = verdictOf(
      'await (cond ? db.from("site_settings") : db.from("user_roles")).upsert(row, { onConflict: "tenant_id,key" });',
    );
    expect(split.verdict).toBe("UNRESOLVED");
    expect(split.reasons).toEqual([expect.stringContaining("warunkowo")]);

    const same = verdictOf(
      'await (cond ? db.from("user_roles") : db.from("user_roles")).upsert(row, { onConflict: "tenant_id,key" });',
    );
    expect(same.verdict).toBe("VIOLATION");
  });
});

describe("przegląd adwersaryjny: nazwy rozwiązywane leksykalnie, najbliższa deklaracja (G3)", () => {
  it("dwie funkcje z `const query`: każda dostaje SWOJĄ tabelę", () => {
    const { verdict, tables } = verdictOf(`async function a() {
  const query = supabase.from("site_settings");
  await query.upsert(r, { onConflict: "tenant_id,key" });
}
async function b() {
  const query = supabase.from("user_roles");
  await query.upsert(r, { onConflict: "tenant_id,key" });
}`);
    expect(verdict).toBe("VIOLATION");
    expect(tables).toEqual([
      [3, "site_settings", "tenant_id,key"],
      [7, "user_roles", "tenant_id,key"],
    ]);
  });

  it("stała przesłonięta wewnętrzną stałą: liczy się wewnętrzna", () => {
    const { verdict, report } = verdictOf(`const T = "tenant_id,user_id,role";
function f() { const T = "user_id,role"; return db.from("user_roles").upsert(row, { onConflict: T }); }`);
    expect(verdict).toBe("VIOLATION");
    expect(report.sites[0]).toMatchObject({ target: "user_id,role", viaConstant: "T" });
  });

  const OUTER = 'const T = "tenant_id,user_id,role";\n';
  it.each([
    [
      "parametr",
      'function f(T: string) { return db.from("user_roles").upsert(row, { onConflict: T }); }',
      "parametr funkcji",
    ],
    [
      "let",
      'function f() { let T = "user_id,role"; return db.from("user_roles").upsert(row, { onConflict: T }); }',
      "`let`/`var`",
    ],
    [
      "var wyniesione z bloku",
      'function f(x: boolean) { if (x) { var T = "user_id,role"; } return db.from("user_roles").upsert(row, { onConflict: T }); }',
      "`let`/`var`",
    ],
    [
      "destrukturyzacja",
      'function f(o: any) { const { T } = o; return db.from("user_roles").upsert(row, { onConflict: T }); }',
      "destrukturyzacja",
    ],
    [
      "zmienna pętli for…of",
      'for (const T of ["user_id,role"]) { await db.from("user_roles").upsert(row, { onConflict: T }); }',
      "zmienna pętli",
    ],
    [
      "zmienna catch",
      'try {} catch (T) { await db.from("user_roles").upsert(row, { onConflict: T }); }',
      "zmienna `catch`",
    ],
    [
      "parametr strzałki",
      'const g = (T: string) => db.from("user_roles").upsert(row, { onConflict: T });',
      "parametr funkcji",
    ],
  ])(
    "stała pliku przesłonięta (%s) - cel NIE jest wartością zewnętrzną",
    (_label, inner, detail) => {
      const { verdict, reasons } = verdictOf(OUTER + inner);
      expect(verdict).toBe("UNRESOLVED");
      expect(reasons).toEqual([expect.stringContaining(detail)]);
    },
  );

  it.each([
    [
      "`let` przesłania stałą tabeli",
      'const TBL = "site_settings";\nfunction f() { let TBL = "user_roles"; return db.from(TBL).upsert(row, { onConflict: "tenant_id,key" }); }',
      "`.from(...)` nie jest literałem ani stałą",
    ],
    [
      "parametr przesłania stałą tabeli",
      'const TBL = "site_settings";\nfunction f(TBL: string) { return db.from(TBL).upsert(row, { onConflict: "tenant_id,key" }); }',
      "`.from(...)` nie jest literałem ani stałą",
    ],
    [
      "zapytanie w `let` nadpisane",
      'let q = db.from("site_settings");\nq = db.from("user_roles");\nawait q.upsert(row, { onConflict: "tenant_id,key" });',
      "odbiorca `q`",
    ],
    [
      "parametr przesłania zapytanie",
      'const q = db.from("site_settings");\nfunction f(q: any) { return q.upsert(row, { onConflict: "tenant_id,key" }); }',
      "odbiorca `q`: parametr",
    ],
  ])("%s - tabela nierozstrzygnięta", (_label, code, reason) => {
    const { verdict, reasons } = verdictOf(code);
    expect(verdict).toBe("UNRESOLVED");
    expect(reasons).toEqual([expect.stringContaining(reason)]);
  });

  it("zapytanie przesłonięte wewnętrzną stałą: tabela z NAJBLIŻSZEJ deklaracji", () => {
    const { verdict, tables } = verdictOf(`const q = db.from("site_settings");
function f() { const q = db.from("user_roles"); return q.upsert(row, { onConflict: "tenant_id,key" }); }`);
    expect(verdict).toBe("VIOLATION");
    expect(tables).toEqual([[2, "user_roles", "tenant_id,key"]]);
  });
});

describe("przegląd adwersaryjny: parser TS zamiast dwóch lekserów (G5)", () => {
  it('apostrof w tekście JSX i `accept="image/*"` nie gubią reszty pliku', () => {
    const { verdict, report } = verdictOf(
      `export function Avatar() {
  return (
    <div>
      <p>Don't upload large files.</p>
      <Button title="It's private" />
      <input type="file" accept="image/*" />
    </div>
  );
}

export async function save(row: Row) {
  await supabase.from("user_roles").upsert(row, { onConflict: "user_id,role" });
}
`,
      "src/components/Avatar.tsx",
    );
    expect(report.upsertCalls).toBe(1);
    expect(verdict).toBe("VIOLATION");
    expect(report.violations[0].site).toMatchObject({ line: 12, table: "user_roles" });
  });

  it.each([
    [
      "apostrof JSX wieloliniowo",
      'export const C = () => (\n  <div>\n    Don\'t worry <button onClick={() => db.from("user_roles").upsert(row, { onConflict: "user_id,role" })}>x</button>\n  </div>\n);',
      "src/x.tsx",
    ],
    [
      "adres URL w tekście JSX",
      'export const C = () => (\n  <p>See https://example.com <b onClick={() => db.from("user_roles").upsert(row, { onConflict: "user_id,role" })} /></p>\n);',
      "src/x.tsx",
    ],
    [
      "`{` w szablonie",
      'const s = `${"{"}`;\nawait db.from("user_roles").upsert(row, { onConflict: "user_id,role" });\nconst t = `x`;',
      "src/x.ts",
    ],
    [
      "regex z apostrofem",
      'const re = /\'/; await db.from("user_roles").upsert(row, { onConflict: "user_id,role" });',
      "src/x.ts",
    ],
    [
      "dzielenie, potem apostrof",
      'const a = total / count; const s = \'it\'; await db.from("user_roles").upsert(row, { onConflict: "user_id,role" });',
      "src/x.ts",
    ],
  ])("%s - upsert widoczny, naruszenie", (_label, code, file) => {
    const { verdict, report } = verdictOf(code, file);
    expect(report.upsertCalls).toBe(1);
    expect(verdict).toBe("VIOLATION");
  });

  it("plik bez importów: `await (…)` na najwyższym poziomie to `await`, nie wywołanie funkcji", () => {
    const { verdict, tables } = verdictOf(
      'await (db.from("user_roles")).upsert(row, { onConflict: "user_id,role" });',
    );
    expect(verdict).toBe("VIOLATION");
    expect(tables).toEqual([[1, "user_roles", "user_id,role"]]);
  });

  it("błąd składni zapala bramkę - drzewo z odzysku parsera nie jest dowodem", () => {
    const { reasons } = verdictOf(
      'const x = ;\nawait db.from("user_roles").upsert(row, { onConflict: "tenant_id,user_id,role" });',
    );
    expect(reasons).toEqual([expect.stringContaining("błąd składni")]);
  });
});

describe("przegląd adwersaryjny: kształty opcji i celu - kontrole negatywne (G8)", () => {
  it.each<[string, string, Verdict, string | null]>([
    [
      "rozkład opcji ze zmiennej",
      'const opts = { onConflict: "user_id,role" };\nawait db.from("user_roles").upsert(row, { ...opts });',
      "UNRESOLVED",
      "rozkładają obiekt",
    ],
    [
      "rozkład importu bez jawnego celu",
      'import { OPTS } from "./x";\nawait db.from("user_roles").upsert(row, { ...OPTS, ignoreDuplicates: true });',
      "UNRESOLVED",
      "rozkładają obiekt",
    ],
    [
      "rozkład PRZED jawnym celem",
      'import { OPTS } from "./x";\nawait db.from("user_roles").upsert(row, { ...OPTS, onConflict: "tenant_id,user_id,role" });',
      "PASS",
      null,
    ],
    [
      "opcje z importu",
      'import { OPTS } from "./x";\nawait db.from("user_roles").upsert(row, OPTS);',
      "UNRESOLVED",
      "nie są literałem obiektu",
    ],
    [
      "opcje z wywołania",
      'await db.from("user_roles").upsert(row, makeOpts("user_id,role"));',
      "UNRESOLVED",
      "nie są literałem obiektu",
    ],
    ["opcje `undefined`", 'await db.from("user_roles").upsert(row, undefined);', "NO-SITES", null],
    [
      'klucz w nawiasach `["onConflict"]`',
      'await db.from("user_roles").upsert(row, { ["onConflict"]: "user_id,role" });',
      "VIOLATION",
      null,
    ],
    [
      "klucz ze stałej",
      'const K = "onConflict";\nawait db.from("user_roles").upsert(row, { [K]: "user_id,role" });',
      "VIOLATION",
      null,
    ],
    [
      "klucz obliczany nieznany",
      'export function f(k: string) { return db.from("user_roles").upsert(row, { [k]: "user_id,role" }); }',
      "UNRESOLVED",
      "klucz obliczany",
    ],
    [
      "klucz w cudzysłowie",
      'await db.from("user_roles").upsert(row, { "onConflict": "user_id,role" });',
      "VIOLATION",
      null,
    ],
    [
      '`["upsert"]` zamiast `.upsert`',
      'await db.from("user_roles")["upsert"](row, { onConflict: "user_id,role" });',
      "VIOLATION",
      null,
    ],
    [
      "upsert przez `.bind`",
      'const up = db.from("user_roles").upsert.bind(db);\nawait up(row, { onConflict: "user_id,role" });',
      "UNRESOLVED",
      "poza literałem opcji",
    ],
    [
      "cel w `.rpc(...)`",
      'await db.rpc("x", { onConflict: "user_id,role" });',
      "UNRESOLVED",
      "poza literałem opcji",
    ],
    [
      "cel w `.insert(...)`",
      'await db.from("user_roles").insert(row, { onConflict: "user_id,role" } as any);',
      "UNRESOLVED",
      "poza literałem opcji",
    ],
    [
      "cel w wierszu, nie w opcjach",
      'await db.from("user_roles").upsert({ user_id: 1, onConflict: "user_id,role" });',
      "UNRESOLVED",
      "poza literałem opcji",
    ],
    [
      "cel zagnieżdżony w opcjach",
      'await db.from("user_roles").upsert(row, { meta: { onConflict: "x" }, onConflict: "tenant_id,user_id,role" });',
      "UNRESOLVED",
      "poza literałem opcji",
    ],
    [
      "`onConflict: undefined`",
      'await db.from("user_roles").upsert(row, { onConflict: undefined });',
      "NO-SITES",
      null,
    ],
    [
      "`onConflict: null`",
      'await db.from("user_roles").upsert(row, { onConflict: null });',
      "UNRESOLVED",
      "nie jest literałem ani stałą",
    ],
    [
      "sklejanie literałów",
      'await db.from("user_roles").upsert(row, { onConflict: "user_id," + "role" });',
      "UNRESOLVED",
      "nie jest literałem ani stałą",
    ],
    [
      "stała z warunku",
      'const T = cond ? "a" : "user_id,role";\nawait db.from("user_roles").upsert(row, { onConflict: T });',
      "UNRESOLVED",
      "stała `T`",
    ],
    [
      "druga stała w jednej deklaracji",
      'const A = "tenant_id,user_id,role", B = "user_id,role";\nawait db.from("user_roles").upsert(row, { onConflict: B });',
      "VIOLATION",
      null,
    ],
    [
      "stała z `as string`",
      'const T = "user_id,role" as string;\nawait db.from("user_roles").upsert(row, { onConflict: T });',
      "VIOLATION",
      null,
    ],
    [
      "stała z `satisfies`",
      'const T = "user_id,role" satisfies string;\nawait db.from("user_roles").upsert(row, { onConflict: T });',
      "VIOLATION",
      null,
    ],
    [
      "właściwość stałej obiektu",
      'const C = { t: "user_id,role" } as const;\nawait db.from("user_roles").upsert(row, { onConflict: C.t });',
      "UNRESOLVED",
      "nie jest literałem ani stałą",
    ],
    [
      "opcje w nawiasach i `as const`",
      'await db.from("user_roles").upsert(row, ({ onConflict: "user_id,role" }) as const);',
      "VIOLATION",
      null,
    ],
    [
      "odbiorca nieznany (`q` bez deklaracji)",
      'const x = supabase.from("site_settings")\nq.upsert(r, { onConflict: "tenant_id,key" })',
      "UNRESOLVED",
      "nie da się ustalić tabeli",
    ],
    [
      "pomocnik z jedną znaną tabelą",
      'await write(ctx, "site_settings", "user_roles_x").upsert(row, { onConflict: "tenant_id,key" });',
      "PASS",
      null,
    ],
    [
      "pomocnik z dwiema znanymi tabelami",
      'await write("site_settings", "user_roles").upsert(row, { onConflict: "tenant_id,key" });',
      "UNRESOLVED",
      "kilka znanych tabel",
    ],
  ])("%s -> %s", (_label, code, expected, reason) => {
    const { verdict, reasons } = verdictOf(code);
    expect(verdict).toBe(expected);
    if (reason !== null) expect(reasons.join(" | ")).toContain(reason);
  });

  it("wzmianki w komentarzach, JSDoc, napisach, regexach, szablonach i tekście JSX nie są celem", () => {
    const { sites, unresolved } = extractOnConflictTargets(
      [
        ts(
          `/** Przykład: db.from("x").upsert(r, { onConflict: "a" }) */
export function C() {
  const s = \`onConflict: \${1}\`; // { onConflict: "b" }
  return <p title="onConflict: c">Ustaw onConflict: "d" {/* { onConflict: "e" } */}</p>;
}`,
          "src/components/Hint.tsx",
        ),
      ],
      new Set(["x"]),
    );
    expect(sites).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});

describe("przegląd adwersaryjny: fałszywe alarmy modelu kluczy (G6)", () => {
  it("`((a), b)` z COLLATE/opclass to kolumny - arbiter, nazwa jak w PG16", () => {
    // Zmierzone na PostgreSQL 16: indkey bez wyrażeń, `Conflict Arbiter
    // Indexes: zz_g6t_a_b_idx` dla `ON CONFLICT (a, b)`.
    const migrations = [
      sql(`
CREATE TABLE public.zz_g6t (id int PRIMARY KEY, a text, b int, email text);
CREATE UNIQUE INDEX ON public.zz_g6t ((a) text_pattern_ops, b);
CREATE UNIQUE INDEX ON public.zz_g6t ((a COLLATE "C") DESC, id);
CREATE UNIQUE INDEX ON public.zz_g6t (((a)), email);
CREATE UNIQUE INDEX ON public.zz_g6t ((lower(email)));
CREATE UNIQUE INDEX ON public.zz_g6t ((CASE WHEN b > 0 THEN a END));
CREATE UNIQUE INDEX ON public.zz_g6t ((pg_catalog.upper(a)));
CREATE UNIQUE INDEX ON public.zz_g6t ((a || b::text));`),
    ];
    const keys = keysOf(migrations, "zz_g6t");
    expect(keys.map((key) => [key.name, key.columns.join(","), key.expression])).toEqual([
      ["zz_g6t_a_b_idx", "a,b", false],
      ["zz_g6t_a_email_idx", "a,email", false],
      ["zz_g6t_a_id_idx", "a,id", false],
      ["zz_g6t_case_idx", "(CASE WHEN b > 0 THEN a END)", true],
      ["zz_g6t_expr_idx", "(a || b::text)", true],
      ["zz_g6t_lower_idx", "(lower(email))", true],
      ["zz_g6t_pkey", "id", false],
      ["zz_g6t_upper_idx", "(pg_catalog.upper(a))", true],
    ]);
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [ts('await db.from("zz_g6t").upsert(r, { onConflict: "b,a" });')],
    });
    expect(report.violations).toEqual([]);
  });

  it("`DROP CONSTRAINT IF EXISTS` nazwy gołego UNIQUE INDEX nic nie zdejmuje (PG: NOTICE, skipping)", () => {
    const migrations = [
      sql(`
CREATE TABLE public.zz_adv (id int PRIMARY KEY, a int, b int, UNIQUE (a, b));
CREATE UNIQUE INDEX zz_adv_pure ON public.zz_adv (b);
ALTER TABLE public.zz_adv DROP CONSTRAINT IF EXISTS zz_adv_pure;`),
    ];
    expect(keysOf(migrations, "zz_adv").map((key) => key.name)).toEqual([
      "zz_adv_a_b_key",
      "zz_adv_pkey",
      "zz_adv_pure",
    ]);
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [ts('await db.from("zz_adv").upsert(r, { onConflict: "b" });')],
    });
    expect(report.violations).toEqual([]);
  });

  it("`DROP INDEX` indeksu ograniczenia nie zdejmuje klucza (PG odmawia), `DROP CONSTRAINT` - tak", () => {
    const kept = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int, UNIQUE (a, b));
DROP INDEX IF EXISTS public.t_a_b_key;
DROP INDEX public.t_pkey CASCADE;`),
      ],
      "t",
    );
    expect(kept.map((key) => key.name)).toEqual(["t_a_b_key", "t_pkey"]);
    const dropped = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int, UNIQUE (a, b));
ALTER TABLE public.t DROP CONSTRAINT t_a_b_key;`),
      ],
      "t",
    );
    expect(dropped.map((key) => key.name)).toEqual(["t_pkey"]);
  });

  it('`DROP COLUMN "constraint"` (cytowana nazwa) to kolumna - jej klucz znika', () => {
    const keys = keysOf(
      [
        sql(`
CREATE TABLE public.t (id int PRIMARY KEY, "constraint" int, b int, UNIQUE ("constraint", b));
ALTER TABLE public.t DROP COLUMN "constraint";`),
      ],
      "t",
    );
    expect(keys.map((key) => key.name)).toEqual(["t_pkey"]);
  });
});

describe("przegląd adwersaryjny: dynamiczne DDL to zapadka, nie informacja (G2)", () => {
  const dynamicDrop: MigrationFile[] = [
    sql(
      "CREATE TABLE public.user_roles (id uuid PRIMARY KEY, user_id uuid, role text, tenant_id uuid, UNIQUE (user_id, role));",
      "1.sql",
    ),
    sql(
      `DO $$
DECLARE v_conname text;
BEGIN
  SELECT conname INTO v_conname FROM pg_constraint
   WHERE conrelid = 'public.user_roles'::regclass AND contype = 'u';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;
CREATE UNIQUE INDEX user_roles_unique_per_tenant ON public.user_roles (tenant_id, user_id, role);`,
      "2.sql",
    ),
  ];
  const staleTarget = ts('await db.from("user_roles").upsert(r, { onConflict: "user_id,role" });');

  it("dynamiczne DROP CONSTRAINT klucza spoza zapadki ZAPALA bramkę (Postgres dałby 42P10)", () => {
    const report = analyzeOnConflictArbiters({ migrations: dynamicDrop, sources: [staleTarget] });
    // Model nadal widzi UNIQUE (user_id, role) - bez zapadki byłaby zieleń.
    expect(report.violations).toEqual([]);
    expect(report.dynamicDdlDrift).toEqual([
      {
        file: "2.sql",
        expected: 0,
        actual: 1,
        texts: ["format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', v_conname)"],
      },
    ]);
    expect(onConflictArbitersFailed(report)).toBe(true);
    const rendered = renderOnConflictArbitersReport(report);
    expect(rendered).toContain("2.sql  w zapadce: 0, w pliku: 1");
    expect(rendered).toContain("Zapisz DDL statycznie");
  });

  it("wpis zapadki z tą samą liczbą przepuszcza; zmiana liczby w którąkolwiek stronę - nie", () => {
    const covered = analyzeOnConflictArbiters({
      migrations: dynamicDrop,
      sources: [staleTarget],
      dynamicDdlBaseline: { "2.sql": { count: 1, why: "fixture" } },
    });
    expect(covered.dynamicDdlDrift).toEqual([]);
    for (const count of [0, 2]) {
      const drifted = analyzeOnConflictArbiters({
        migrations: dynamicDrop,
        sources: [staleTarget],
        dynamicDdlBaseline: { "2.sql": { count, why: "fixture" } },
      });
      expect(
        drifted.dynamicDdlDrift.map((d) => [d.expected, d.actual]),
        `count ${count}`,
      ).toEqual([[count, 1]]);
    }
  });

  it("`EXECUTE zmienna` z tekstem złożonym wcześniej w bloku też jest dynamicznym DDL kluczy", () => {
    const model = buildUniqueKeyModel([
      sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int UNIQUE);
DO $$
DECLARE v_sql text;
BEGIN
  v_sql := 'ALTER TABLE public.t DROP CONSTRAINT ' || quote_ident('t_a_key');
  EXECUTE v_sql;
END $$;`),
    ]);
    expect(model.dynamicDdl.map((entry) => entry.text)).toEqual(["v_sql"]);
  });

  it("`EXECUTE` z jednym literałem (`'…'`, `$q$…$q$`) jest stosowany, a `EXECUTE FUNCTION` pomijany", () => {
    const model = buildUniqueKeyModel([
      sql(`
CREATE TABLE public.t (id int PRIMARY KEY, a int, b int);
DO $$ BEGIN
  EXECUTE 'CREATE UNIQUE INDEX t_a ON public.t (a)';
  EXECUTE $q$CREATE UNIQUE INDEX t_b ON public.t (b)$q$;
  CREATE TRIGGER t_unique_guard BEFORE INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION public.guard();
END $$;`),
    ]);
    expect(model.dynamicDdl).toEqual([]);
    expect(model.tables.get("t")?.map((key) => key.name)).toEqual(["t_a", "t_b", "t_pkey"]);
  });
});

describe("przegląd adwersaryjny: migracje SUROWE przez loader runnera (G4)", () => {
  const before =
    "CREATE TABLE public.user_roles (id uuid PRIMARY KEY, user_id uuid, role text, tenant_id uuid, UNIQUE (user_id, role));";
  const after = `COMMENT ON TABLE public.user_roles IS $$Roles; it's per tenant now$$;
CREATE OR REPLACE FUNCTION public.noop() RETURNS text LANGUAGE sql AS $$ SELECT '--' $$;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX user_roles_unique_per_tenant ON public.user_roles (tenant_id, user_id, role);`;
  const dir = mkdtempSync(join(tmpdir(), "on-conflict-arbiters-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("`$$ SELECT '--' $$` nie połyka DROP: zły cel zostaje czerwony", () => {
    writeFileSync(join(dir, "20990101000001_before.sql"), before);
    writeFileSync(join(dir, "20990101000002_after.sql"), after);
    const migrations = loadRawMigrationFiles(dir);
    expect(migrations.map((migration) => migration.sql)).toEqual([before, after]);
    const report = analyzeOnConflictArbiters({
      migrations,
      sources: [ts('await db.from("user_roles").upsert(r, { onConflict: "user_id,role" });')],
    });
    expect(report.violations.map((violation) => violation.site.target)).toEqual(["user_id,role"]);
    // Dlaczego nie `loadMigrationFiles()`: jego `stripSqlComments` bierze
    // `--` w ciele `$$` za komentarz i ucina resztę linii - DROP ląduje
    // w niedomkniętym ciele i znika z modelu (zły cel byłby zielony). Lekser
    // instrukcji łapie to dziś jako niedzielony tekst, ale wejściem bramki
    // ma być plik bajt w bajt, nie obrona drugiej linii.
    const stripped = [before, after].map((text, index) =>
      sql(stripSqlComments(text), `${index}.sql`),
    );
    expect(stripped[1].sql).toContain("AS $$ SELECT '\n");
    const lossy = analyzeOnConflictArbiters({
      migrations: stripped,
      sources: [ts('await db.from("user_roles").upsert(r, { onConflict: "user_id,role" });')],
    });
    expect(lossy.violations).toEqual([]);
    expect(lossy.unsplittable).toEqual([{ file: "1.sql", message: expect.stringContaining("$$") }]);
  });
});

describe("podział instrukcji przez lexStatements (G7)", () => {
  it("`BEGIN ATOMIC … END` to jedna instrukcja, `;` w nawiasie jej nie kończy", () => {
    expect(
      splitSqlStatementsDeep(
        "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END;\nCREATE UNIQUE INDEX t_a ON public.t (a);",
      ),
    ).toEqual([
      "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END",
      "CREATE UNIQUE INDEX t_a ON public.t (a)",
    ]);
  });

  it("tekst, którego lekser nie podzieli, zapala bramkę zamiast cicho wypaść z modelu", () => {
    const report = analyzeOnConflictArbiters({
      migrations: [...USER_ROLES_HISTORY, sql("\\\\set ON_ERROR_STOP on\nSELECT 1;", "z.sql")],
      sources: [roleUpsert("tenant_id,user_id,role")],
    });
    expect(report.unsplittable).toEqual([
      { file: "z.sql", message: expect.stringContaining("Meta-polecenie psql") },
    ]);
    expect(onConflictArbitersFailed(report)).toBe(true);
    expect(renderOnConflictArbitersReport(report)).toContain("lexStatements");
  });
});

describe("bramka arbitrów onConflict (stan faktyczny repozytorium)", () => {
  // TEN SAM loader co runner CI - test nie ma własnej kopii zakresu skanu.
  const migrations = loadRawMigrationFiles();
  const report = analyzeOnConflictArbiters({ migrations, sources: loadProductionSources() });

  it("bramka faktycznie coś widzi - pusty skan nie może być zielony", () => {
    expect(report.tablesInModel).toBeGreaterThan(300);
    expect(report.sites.length).toBeGreaterThan(50);
    expect(report.upsertCalls).toBeGreaterThanOrEqual(report.sites.length);
  });

  it("każdy cel onConflict w kodzie produkcyjnym ma arbitra i daje się sprawdzić statycznie", () => {
    expect(report.unresolved).toEqual([]);
    expect(report.violations).toEqual([]);
    expect(report.unsplittable).toEqual([]);
    expect(report.dynamicDdlDrift).toEqual([]);
    expect(renderOnConflictArbitersReport(report)).toContain("Arbitrzy onConflict OK");
  });

  it("zapadka dynamicznego DDL wskazuje wyłącznie istniejące migracje (może tylko maleć)", () => {
    const files = new Set(migrations.map((migration) => migration.file));
    for (const [file, entry] of Object.entries(DYNAMIC_DDL_BASELINE)) {
      expect(files.has(file), file).toBe(true);
      expect(entry.count, file).toBeGreaterThan(0);
      expect(entry.why, file).toContain("616/616");
    }
    const total = Object.values(DYNAMIC_DDL_BASELINE).reduce((sum, entry) => sum + entry.count, 0);
    expect(report.dynamicDdl).toHaveLength(total);
  });

  it("loader podaje migracje SUROWE - bajt w bajt jak na dysku, w kolejności nazw", () => {
    const names = migrations.map((migration) => migration.file);
    expect(names).toEqual([...names].sort());
    for (const migration of migrations) {
      expect(migration.sql, migration.file).toBe(
        readFileSync(join(MIGRATIONS_DIR, migration.file), "utf8"),
      );
    }
  });
});
