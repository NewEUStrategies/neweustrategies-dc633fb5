// Testy inwariantu „RPC klienta istnieje i celuje w istniejącą relację".
//
// Scenariusz wiodący to REALNA regresja z 2026-08-06 („Zapytanie do eksperta"):
// migracja przemianowała tabelę i usunęła pięć funkcji, dwie późniejsze
// odtworzyły JEDNĄ z nich pod starą nazwą tabeli, a klient wołał całą piątkę.
// Produkcja tego nie widziała (blok z RENAME nigdy się nie wykonał), każda
// świeża baza dostawała 42P01 + cztery brakujące RPC.
import { describe, expect, it } from "vitest";
import {
  analyzeRpcContract,
  droppedFunctions,
  extractCalledRpcs,
  referencesRelation,
  renderRpcContractReport,
  retiredRelations,
  rpcContractFailed,
} from "../rpcContract";

describe("extractCalledRpcs", () => {
  it("zbiera nazwy z supabase.rpc(...) razem z plikami wołającymi", () => {
    const called = extractCalledRpcs([
      { file: "src/a.ts", code: `supabase.rpc("send_expert_inmail", args)` },
      { file: "src/b.ts", code: `await client.rpc<Row[]>('list_my_inmails', { p_box })` },
      { file: "src/c.ts", code: `supabase.rpc("send_expert_inmail")` },
    ]);
    expect(called.map((c) => c.name)).toEqual(["list_my_inmails", "send_expert_inmail"]);
    expect(called[1].callers).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("pomija wywołania z nazwą dynamiczną (nie zgadujemy)", () => {
    expect(extractCalledRpcs([{ file: "src/a.ts", code: `supabase.rpc(fnName, args)` }])).toEqual(
      [],
    );
  });
});

describe("retiredRelations", () => {
  it("RENAME wycofuje starą nazwę, a nowa jest żywa", () => {
    const retired = retiredRelations([
      { file: "0001.sql", sql: "CREATE TABLE public.expert_inmails (id uuid);" },
      { file: "0002.sql", sql: "ALTER TABLE public.expert_inmails RENAME TO expert_requests;" },
    ]);
    expect([...retired.keys()]).toEqual(["expert_inmails"]);
    expect(retired.get("expert_inmails")).toBe("0002.sql");
  });

  it("odtworzenie tabeli pod starą nazwą zdejmuje ją z listy wycofanych", () => {
    const retired = retiredRelations([
      { file: "0001.sql", sql: "CREATE TABLE public.t (id uuid);" },
      { file: "0002.sql", sql: "DROP TABLE IF EXISTS public.t;" },
      { file: "0003.sql", sql: "CREATE TABLE IF NOT EXISTS public.t (id uuid);" },
    ]);
    expect([...retired.keys()]).toEqual([]);
  });

  it("ALTER PUBLICATION ... DROP TABLE nie wycofuje tabeli (tylko Realtime)", () => {
    const retired = retiredRelations([
      { file: "0001.sql", sql: "CREATE TABLE public.crm_leads (id uuid);" },
      { file: "0002.sql", sql: "ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_leads;" },
    ]);
    expect([...retired.keys()]).toEqual([]);
  });

  it("ignoruje schematy zarządzane (auth/storage)", () => {
    const retired = retiredRelations([
      { file: "0001.sql", sql: "CREATE TABLE storage.objects (id uuid);" },
      { file: "0002.sql", sql: "DROP TABLE storage.objects;" },
    ]);
    expect([...retired.keys()]).toEqual([]);
  });
});

describe("droppedFunctions", () => {
  it("zapamiętuje plik z ostatnim DROP FUNCTION", () => {
    const dropped = droppedFunctions([
      { file: "0001.sql", sql: "DROP FUNCTION IF EXISTS public.claim_push_outbox(integer);" },
      { file: "0002.sql", sql: "DROP FUNCTION public.claim_push_outbox(integer);" },
    ]);
    expect(dropped.get("claim_push_outbox")).toBe("0002.sql");
  });
});

describe("referencesRelation", () => {
  it("łapie referencję kwalifikowaną i pozycję składniowo relacyjną", () => {
    expect(referencesRelation("SELECT 1 FROM public.expert_inmails ei", "expert_inmails")).toBe(
      true,
    );
    expect(referencesRelation("INSERT INTO expert_inmails (id) VALUES (1)", "expert_inmails")).toBe(
      true,
    );
    expect(referencesRelation("RETURNS SETOF public.expert_inmails", "expert_inmails")).toBe(true);
  });

  it("nie łapie kolumny ani literału o tej samej nazwie", () => {
    expect(referencesRelation("SELECT expert_inmails FROM public.other", "expert_inmails")).toBe(
      false,
    );
    expect(referencesRelation("RAISE EXCEPTION 'expert_inmails: nope'", "expert_inmails")).toBe(
      false,
    );
  });
});

const MIGRATIONS = [
  {
    file: "0001_create.sql",
    sql: `CREATE TABLE public.expert_inmails (id uuid);
          CREATE OR REPLACE FUNCTION public.my_inmail_quota() RETURNS jsonb AS $$
            SELECT count(*) FROM public.expert_inmails $$ LANGUAGE sql;
          CREATE OR REPLACE FUNCTION public.send_expert_inmail(p uuid) RETURNS uuid AS $$
            INSERT INTO public.expert_inmails (id) VALUES (p) RETURNING id $$ LANGUAGE sql;`,
  },
  {
    file: "0002_rename.sql",
    sql: `DROP FUNCTION IF EXISTS public.my_inmail_quota();
          ALTER TABLE public.expert_inmails RENAME TO expert_requests;`,
  },
  {
    file: "0003_recreate_old_name.sql",
    sql: `CREATE OR REPLACE FUNCTION public.send_expert_inmail(p uuid) RETURNS uuid AS $$
            INSERT INTO public.expert_inmails (id) VALUES (p) RETURNING id $$ LANGUAGE sql;`,
  },
];

const CLIENT = [
  {
    file: "src/lib/chat/useExpertRequests.ts",
    code: `supabase.rpc("my_inmail_quota"); supabase.rpc("send_expert_inmail", args);`,
  },
];

describe("analyzeRpcContract - scenariusz „dwóch generacji”", () => {
  const report = analyzeRpcContract({
    migrations: MIGRATIONS,
    definitions: [
      {
        key: "public.my_inmail_quota/0",
        name: "my_inmail_quota",
        file: "0001_create.sql",
        body: " SELECT count(*) FROM public.expert_inmails ",
      },
      {
        key: "public.send_expert_inmail/1",
        name: "send_expert_inmail",
        file: "0003_recreate_old_name.sql",
        body: " INSERT INTO public.expert_inmails (id) VALUES (p) RETURNING id ",
      },
    ],
    clients: CLIENT,
  });

  it("zgłasza RPC wołane przez klienta, którego już nie ma (PGRST202)", () => {
    expect(report.missingFunctions.map((m) => m.name)).toEqual(["my_inmail_quota"]);
    expect(report.missingFunctions[0].callers).toEqual(["src/lib/chat/useExpertRequests.ts"]);
  });

  it("zgłasza funkcję celującą w tabelę po RENAME (42P01)", () => {
    expect(report.orphanedRelationRefs).toEqual([
      {
        fn: "public.send_expert_inmail/1",
        file: "0003_recreate_old_name.sql",
        relation: "expert_inmails",
        retiredIn: "0002_rename.sql",
      },
    ]);
  });

  it("nie liczy funkcji usuniętej razem z tabelą jako wiszącej referencji", () => {
    // my_inmail_quota zniknęła w 0002 - jest „brakującym RPC", nie „sierotą".
    expect(report.orphanedRelationRefs.map((o) => o.fn)).not.toContain("public.my_inmail_quota/0");
  });

  it("blokuje CI i tłumaczy oba rozjazdy w raporcie", () => {
    expect(rpcContractFailed(report)).toBe(true);
    const rendered = renderRpcContractReport(report);
    expect(rendered).toContain("my_inmail_quota");
    expect(rendered).toContain("public.expert_inmails");
    expect(rendered).toContain("42P01");
  });
});

describe("analyzeRpcContract - stan po scaleniu generacji", () => {
  const fixed = [
    ...MIGRATIONS,
    {
      file: "0004_single_generation.sql",
      sql: `ALTER TABLE IF EXISTS public.expert_requests RENAME TO expert_inmails;
            DROP FUNCTION IF EXISTS public.my_inmail_quota();
            CREATE OR REPLACE FUNCTION public.my_inmail_quota() RETURNS jsonb AS $$
              SELECT count(*) FROM public.expert_inmails $$ LANGUAGE sql;`,
    },
  ];

  const report = analyzeRpcContract({
    migrations: fixed,
    definitions: [
      {
        key: "public.my_inmail_quota/0",
        name: "my_inmail_quota",
        file: "0004_single_generation.sql",
        body: " SELECT count(*) FROM public.expert_inmails ",
      },
      {
        key: "public.send_expert_inmail/1",
        name: "send_expert_inmail",
        file: "0003_recreate_old_name.sql",
        body: " INSERT INTO public.expert_inmails (id) VALUES (p) RETURNING id ",
      },
    ],
    clients: CLIENT,
  });

  it("po zbiegnięciu nazw obie kontrole są zielone", () => {
    expect(report.missingFunctions).toEqual([]);
    expect(report.orphanedRelationRefs).toEqual([]);
    expect(rpcContractFailed(report)).toBe(false);
    expect(renderRpcContractReport(report)).toContain("Kontrakt RPC OK");
  });

  it("DROP i CREATE w TYM SAMYM pliku nie kasuje funkcji (wzorzec podmiany sygnatury)", () => {
    expect(report.definedFunctions).toBe(2);
  });
});

describe("analyzeRpcContract - furtka na RPC spoza migracji", () => {
  it("uzasadniony wpis externalRpcs nie blokuje bramki", () => {
    const report = analyzeRpcContract({
      migrations: [{ file: "0001.sql", sql: "CREATE TABLE public.t (id uuid);" }],
      definitions: [],
      clients: [{ file: "src/a.ts", code: `supabase.rpc("graphql")` }],
      externalRpcs: { graphql: "pg_graphql, nie migracja repo" },
    });
    expect(report.missingFunctions).toEqual([]);
    expect(rpcContractFailed(report)).toBe(false);
  });
});
