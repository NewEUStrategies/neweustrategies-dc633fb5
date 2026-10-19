// Bramka dostawy huba „Przychód i lejek": rejestr właścicieli funkcji SQL,
// bloki wersji wycinków, CIALO-Z, granty i manifesty plików.
//
// Dwie części: (1) prawdziwe migracje repozytorium MUSZĄ przejść bramkę -
// to jest dowód, że rejestr opisuje stan faktyczny; (2) fikstury w pamięci
// MUSZĄ ją zaczerwienić - to jest dowód, że bramka w ogóle coś widzi
// (cicho zielona bramka jest groźniejsza od fałszywego alarmu).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HUB_CIALO_Z,
  HUB_FACT_AREAS,
  HUB_FUNCTION_KINDS,
  HUB_FUNCTION_OWNERS,
  HUB_PARALLEL_SLICES,
  HUB_SHARED_FILES,
  HUB_SLICE_IDS,
  HUB_SLICE_MANIFESTS,
  HUB_VERSION_BLOCKS,
  analyzeHubDelivery,
  checkSliceDiff,
  globToRegExp,
  hubDeliveryFailed,
  maskSqlComments,
  renderHubDeliveryReport,
  renderSliceDiff,
  sliceDiffFailed,
  sliceOfPath,
  slicesOfPath,
  type HubDeliveryViolationKind,
  type HubMigrationFile,
} from "@/lib/ci/hubDelivery";

const SUPABASE_DIR = "supabase/migrations";

function repoMigrations(): HubMigrationFile[] {
  return readdirSync(SUPABASE_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(`${SUPABASE_DIR}/${name}`, "utf8") }));
}

const HEADER = [
  "-- ===========================================================",
  "-- FIKSTURA BRAMKI",
  "-- DEFEKT: brak.",
  "-- ZMIANA: brak.",
  "-- KOLEJNOŚĆ WDROŻENIA: dowolna.",
  "-- IDEMPOTENTNA: tak.",
  "-- DOWÓD: ten test.",
  "-- ===========================================================",
  "",
].join("\n");

/**
 * Definicja funkcji w kształcie migracji huba (z REVOKE w tym samym pliku).
 * `revoke`: `false` = bez REVOKE, napis = lista ról po `FROM`.
 */
function fnSql(
  name: string,
  opts: { cialoZ?: string; grant?: string; revoke?: false | string } = {},
) {
  const revokeFrom = opts.revoke ?? "PUBLIC, anon, authenticated";
  const lines = [
    opts.cialoZ ? `-- CIALO-Z: ${opts.cialoZ}` : "",
    `CREATE OR REPLACE FUNCTION public.${name}(p_x uuid)`,
    "RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp",
    "AS $$ SELECT 1 $$;",
    revokeFrom === false ? "" : `REVOKE ALL ON FUNCTION public.${name}(uuid) FROM ${revokeFrom};`,
    opts.grant ? `GRANT EXECUTE ON FUNCTION public.${name}(uuid) TO ${opts.grant};` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function file(name: string, body: string, header = HEADER): HubMigrationFile {
  return { name, sql: `${header}${body}\n` };
}

function kinds(files: HubMigrationFile[]): HubDeliveryViolationKind[] {
  return analyzeHubDelivery(files).violations.map((v) => v.kind);
}

describe("bramka dostawy huba - prawdziwe migracje", () => {
  const migrations = repoMigrations();
  const report = analyzeHubDelivery(migrations, { verifyCialoZRegistry: true });

  it("migracje bloku huba przechodzą bramkę (właściciel, blok, CIALO-Z, granty, nagłówek, rozmiar)", () => {
    expect(report.violations, renderHubDeliveryReport(report)).toEqual([]);
    expect(hubDeliveryFailed(report)).toBe(false);
  });

  it("sześć migracji I0 jest w bloku i definiuje dokładnie pięć helperów", () => {
    const i0 = report.files.filter((name) => name.startsWith("2026102009"));
    expect(i0).toEqual([
      "20261020090000_hub_schema_revenue_ledger.sql",
      "20261020090100_hub_schema_funnel_ops.sql",
      "20261020090200_hub_schema_crm_lifecycle.sql",
      "20261020090300_hub_schema_journeys_core.sql",
      "20261020090400_hub_schema_journeys_messaging.sql",
      "20261020090500_hub_shared_sql_helpers.sql",
    ]);
    const i0Functions = report.functions
      .filter((d) => d.block === "2026102009")
      .map((d) => d.name)
      .sort();
    expect(i0Functions).toEqual([
      "_log_emit_error",
      "_tier_rank_of",
      "metering_defaults",
      "revenue_segment_of_tier",
      "tier_rank_of",
    ]);
  });

  it("skan obejmuje WYŁĄCZNIE blok huba - funkcje cennika v6.2 nie są oceniane", () => {
    expect(report.files.every((name) => name >= "20261020090000" && name < "20261020170000")).toBe(
      true,
    );
    expect(migrations.some((m) => m.name.startsWith("20261018160"))).toBe(true);
  });

  it("rejestr CIALO-Z wskazuje najnowszą definicję sprzed huba każdej redefiniowanej funkcji", () => {
    const stale = report.violations.filter((v) => v.kind === "rejestr-cialo-z-nieaktualny");
    expect(stale).toEqual([]);
    // Sanity: analiza naprawdę widzi definicje sprzed huba (inaczej porównanie
    // byłoby puste i zielone z braku danych).
    expect(
      analyzeHubDelivery(
        [
          ...migrations.filter((m) => m.name < "20261020090000"),
          file(
            "20261019000000_newer_workflow_step.sql",
            "CREATE OR REPLACE FUNCTION public.run_workflow_step() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
          ),
        ],
        { verifyCialoZRegistry: true },
      ).violations.map((v) => v.detail),
    ).toEqual([
      "HUB_CIALO_Z.run_workflow_step = 20261007140700, najnowsza definicja sprzed huba: 20261019000000",
    ]);
  });
});

describe("bramka dostawy huba - rejestr", () => {
  it("właściciel i rodzaj opisują ten sam zbiór funkcji", () => {
    expect(Object.keys(HUB_FUNCTION_KINDS).sort()).toEqual(Object.keys(HUB_FUNCTION_OWNERS).sort());
  });

  it("każdy właściciel funkcji ma blok wersji (S6 i S8 nie mają SQL)", () => {
    const owners = new Set(Object.values(HUB_FUNCTION_OWNERS));
    for (const slice of owners) expect(HUB_VERSION_BLOCKS[slice], slice).toBeDefined();
    expect(owners.has("S6")).toBe(false);
    expect(owners.has("S8")).toBe(false);
  });

  it("bloki wersji są rozłączne i leżą w zakresie huba", () => {
    const blocks = Object.values(HUB_VERSION_BLOCKS);
    expect(new Set(blocks).size).toBe(blocks.length);
    for (const block of blocks) {
      expect(`${block}0000` >= "20261020090000" && `${block}0000` < "20261020170000").toBe(true);
    }
  });

  it("nazwy emiterów S1 i faktów S7 są zamrożone jako kontrakt", () => {
    for (const name of [
      "tg_metering_settings_emit",
      "tg_checkout_settings_emit",
      "tg_content_access_emit",
      "tg_retention_settings_emit",
      "tg_retention_reasons_emit",
      "tg_newsletter_settings_emit",
      "tg_b2b_coupons_emit",
      "tg_b2b_coupon_campaigns_emit",
      "tg_b2b_coupon_redemptions_emit",
    ]) {
      expect(HUB_FUNCTION_OWNERS[name], name).toBe("S1");
      expect(HUB_FUNCTION_KINDS[name], name).toBe("trigger");
    }
    expect(HUB_FACT_AREAS).toHaveLength(16);
    for (const area of HUB_FACT_AREAS) {
      expect(HUB_FUNCTION_OWNERS[`_revenue_facts_${area}`]).toBe("S7");
      expect(HUB_FUNCTION_KINDS[`_revenue_facts_${area}`]).toBe("internal");
    }
  });

  it("strażnik pgTAP `hub_grants` sprawdza dokładnie funkcje bez EXECUTE dla klienta z rejestru", () => {
    // Bramka czyta tekst migracji; pgTAP czyta ACL w bazie. Lista w SQL
    // rozjechana z rejestrem = funkcja, której nikt nie sprawdza po wdrożeniu.
    const sql = readFileSync("supabase/tests/hub_shared_helpers_test.sql", "utf8");
    const block = /-- hub-grants:begin([\s\S]*?)-- hub-grants:end/.exec(sql)?.[1] ?? "";
    const list = /p\.proname = ANY \(ARRAY\[([\s\S]*?)\]::name\[\]\)/.exec(block)?.[1] ?? "";
    const inPgTap = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    const expected = Object.entries(HUB_FUNCTION_KINDS)
      .filter(([name, kind]) => kind !== "panel" && kind !== "reader" && !(name in HUB_CIALO_Z))
      .map(([name]) => name)
      .sort();
    expect(expected.length).toBeGreaterThan(60);
    expect(inPgTap).toEqual(expected);
  });

  it("każda funkcja z rejestru CIALO-Z ma właściciela, a każdy wyzwalacz rodzaj trigger", () => {
    for (const name of Object.keys(HUB_CIALO_Z))
      expect(HUB_FUNCTION_OWNERS[name], name).toBeDefined();
    for (const [name, kind] of Object.entries(HUB_FUNCTION_KINDS)) {
      if (name.startsWith("tg_")) expect(kind, name).toBe("trigger");
      if (name.startsWith("_")) expect(kind, name).toBe("internal");
      if (name.startsWith("admin_")) expect(kind, name).toBe("panel");
    }
  });
});

describe("bramka dostawy huba - fikstury zaczerwieniają bramkę", () => {
  it("zielona na poprawnej migracji wycinka", () => {
    expect(kinds([file("20261020100000_ok.sql", fnSql("tg_metering_settings_emit"))])).toEqual([]);
  });

  it("funkcja bez właściciela", () => {
    expect(kinds([file("20261020100000_x.sql", fnSql("hub_unregistered_helper"))])).toEqual([
      "bez-wlasciciela",
    ]);
  });

  it("funkcja w bloku innego wycinka", () => {
    expect(
      kinds([
        file("20261020100000_x.sql", fnSql("admin_revenue_churn", { grant: "authenticated" })),
      ]),
    ).toEqual(["zly-blok"]);
  });

  it("brak REVOKE ALL ... FROM PUBLIC, anon, authenticated w tym samym pliku", () => {
    expect(
      kinds([
        file("20261020110500_x.sql", fnSql("run_revenue_lifecycle_scanner", { revoke: false })),
      ]),
    ).toEqual(["brak-revoke"]);
  });

  it("REVOKE bez authenticated nie wystarcza funkcji wewnętrznej, serwisowej i wyzwalaczowi", () => {
    // Domyślne ACL platformy (scripts/pgtap-local/stub.sql) nadają authenticated
    // EXECUTE jawnie - `FROM PUBLIC, anon` zostawia helper z `p_tenant` otwarty
    // dla każdego zalogowanego (scenariusz: MRR obcego najemcy przez `rpc`).
    for (const [version, name] of [
      ["20261020110300", "_revenue_mrr_at"],
      ["20261020110500", "run_revenue_lifecycle_scanner"],
      ["20261020100000", "tg_content_access_emit"],
    ] as const) {
      const violations = analyzeHubDelivery([
        file(`${version}_x.sql`, fnSql(name, { revoke: "PUBLIC, anon", grant: "service_role" })),
      ]).violations;
      expect(
        violations.map((v) => v.kind),
        name,
      ).toEqual(["brak-revoke"]);
      expect(violations[0].detail, name).toContain("bez: authenticated");
    }
  });

  it("role w REVOKE w dowolnej kolejności i z cudzysłowami", () => {
    expect(
      kinds([
        file(
          "20261020110300_x.sql",
          fnSql("_revenue_mrr_at", { revoke: 'anon, "authenticated", public CASCADE' }),
        ),
      ]),
    ).toEqual([]);
  });

  it("RPC panelu: REVOKE z PUBLIC i anon wystarcza tylko z jawnym GRANT dla authenticated", () => {
    expect(
      kinds([
        file(
          "20261020110400_x.sql",
          fnSql("admin_revenue_churn", { revoke: "PUBLIC, anon", grant: "authenticated" }),
        ),
      ]),
    ).toEqual([]);
    expect(
      kinds([
        file("20261020110400_x.sql", fnSql("admin_revenue_churn", { revoke: "PUBLIC, anon" })),
      ]),
    ).toEqual(["brak-grantu"]);
    expect(
      kinds([file("20261020110400_x.sql", fnSql("admin_revenue_churn", { revoke: "PUBLIC" }))]),
    ).toEqual(["brak-revoke", "brak-grantu"]);
  });

  it("definicja bez schematu albo w cudzysłowach nie omija rejestru, REVOKE ani GRANT", () => {
    const bare = [
      "CREATE OR REPLACE FUNCTION _revenue_rogue(p_tenant uuid) RETURNS int",
      "LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT 1 $$;",
      "GRANT EXECUTE ON FUNCTION _revenue_rogue(uuid) TO authenticated;",
    ].join("\n");
    expect(kinds([file("20261020110300_x.sql", bare)])).toEqual([
      "funkcja-poza-public",
      "bez-wlasciciela",
      "brak-revoke",
    ]);
    const quoted = [
      'CREATE OR REPLACE FUNCTION "public"."_revenue_mrr_at"(p_tenant uuid) RETURNS int',
      "LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT 1 $$;",
      'REVOKE ALL ON FUNCTION "public"."_revenue_mrr_at"(uuid) FROM PUBLIC, anon;',
    ].join("\n");
    const report = analyzeHubDelivery([file("20261020110300_x.sql", quoted)]);
    expect(report.functions.map((d) => d.name)).toEqual(["_revenue_mrr_at"]);
    expect(report.violations.map((v) => v.kind)).toEqual(["brak-revoke"]);
    const otherSchema =
      "CREATE FUNCTION private.hub_x() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;";
    expect(kinds([file("20261020110300_x.sql", otherSchema)])).toEqual(["funkcja-poza-public"]);
  });

  it("GRANT na kilka funkcji naraz i ON ALL FUNCTIONS IN SCHEMA są widoczne", () => {
    const multi = [
      fnSql("_revenue_mrr_at"),
      "GRANT EXECUTE ON FUNCTION public.admin_revenue_churn(uuid), public._revenue_mrr_at(uuid) TO authenticated;",
    ].join("\n");
    const violations = analyzeHubDelivery([file("20261020110300_x.sql", multi)]).violations;
    expect(violations.map((v) => [v.kind, v.detail])).toEqual([
      ["grant-dla-klienta", "public._revenue_mrr_at (internal): GRANT … TO authenticated"],
    ]);
    expect(
      kinds([
        file(
          "20261020110300_x.sql",
          "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;",
        ),
      ]),
    ).toEqual(["grant-dla-klienta"]);
  });

  it("GRANT dla authenticated na funkcji serwisowej, wewnętrznej i wyzwalaczu", () => {
    expect(
      kinds([
        file(
          "20261020110500_x.sql",
          fnSql("run_revenue_lifecycle_scanner", { grant: "authenticated, service_role" }),
        ),
      ]),
    ).toEqual(["grant-dla-klienta"]);
    expect(
      kinds([file("20261020110300_x.sql", fnSql("_revenue_mrr_at", { grant: "authenticated" }))]),
    ).toEqual(["grant-dla-klienta"]);
    expect(
      kinds([
        file("20261020100000_x.sql", fnSql("tg_content_access_emit", { grant: "authenticated" })),
      ]),
    ).toEqual(["grant-dla-klienta"]);
  });

  it("GRANT dla authenticated na RPC panelu jest poprawny, dla anon - nigdy", () => {
    expect(
      kinds([
        file(
          "20261020110400_x.sql",
          fnSql("admin_revenue_churn", { grant: "authenticated, service_role" }),
        ),
      ]),
    ).toEqual([]);
    expect(
      kinds([
        file(
          "20261020110400_x.sql",
          fnSql("admin_revenue_churn", { grant: "authenticated, anon" }),
        ),
      ]),
    ).toEqual(["grant-dla-klienta"]);
  });

  it("redefinicja funkcji sprzed huba: zły, brakujący i poprawny CIALO-Z", () => {
    expect(
      kinds([
        file("20261020130200_x.sql", fnSql("run_workflow_step", { cialoZ: "20261001000000" })),
      ]),
    ).toEqual(["zly-cialo-z"]);
    expect(kinds([file("20261020130200_x.sql", fnSql("run_workflow_step"))])).toEqual([
      "brak-cialo-z",
    ]);
    expect(
      kinds([
        file("20261020130200_x.sql", fnSql("run_workflow_step", { cialoZ: "20261007140700" })),
      ]),
    ).toEqual([]);
  });

  it("CIALO-Z dotyczy definicji, przed którą stoi - nie sąsiedniej", () => {
    const body = [
      fnSql("run_workflow_step", { cialoZ: "20261007140700" }),
      fnSql("crm_upsert_lead_from_profile"),
    ].join("\n");
    expect(kinds([file("20261020130200_x.sql", body)])).toEqual(["brak-cialo-z"]);
  });

  it("funkcja sprzed huba bez wpisu w rejestrze CIALO-Z (gdy znane są migracje sprzed huba)", () => {
    const preHub = file(
      "20261001000000_old.sql",
      "CREATE OR REPLACE FUNCTION public.admin_revenue_churn() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
    );
    const violations = analyzeHubDelivery([
      preHub,
      file("20261020110400_x.sql", fnSql("admin_revenue_churn", { cialoZ: "20261001000000" })),
    ]).violations;
    expect(violations.map((v) => v.kind)).toContain("brak-cialo-z");
  });

  it("ta sama funkcja w dwóch blokach", () => {
    const report = analyzeHubDelivery([
      file("20261020110400_a.sql", fnSql("admin_revenue_churn")),
      file("20261020120400_b.sql", fnSql("admin_revenue_churn")),
    ]);
    expect(report.violations.map((v) => v.kind)).toContain("funkcja-w-dwoch-blokach");
  });

  it("nagłówek PL: brak = czerwień, wariant bez diakrytyków = zieleń", () => {
    expect(
      kinds([file("20261020100000_x.sql", fnSql("tg_metering_settings_emit"), "-- opis\n")]),
    ).toEqual(["brak-naglowka"]);
    const ascii = "-- DEFEKT\n-- ZMIANA\n-- KOLEJNOSC WDROZENIA\n-- IDEMPOTENTNA\n-- DOWOD\n\n";
    expect(
      kinds([file("20261020100000_x.sql", fnSql("tg_metering_settings_emit"), ascii)]),
    ).toEqual([]);
  });

  it("plik ponad 45 KiB", () => {
    const filler = `-- ${"x".repeat(200)}\n`.repeat(240);
    expect(kinds([file("20261020100000_x.sql", `${filler}SELECT 1;`)])).toEqual(["za-duza"]);
  });

  it("dotknięcie public.club_ poza S4 wymaga znacznika pg-harness: exclude", () => {
    const body = "SELECT count(*) FROM public.club_members;";
    expect(kinds([file("20261020150000_x.sql", body)])).toEqual(["brak-pg-harness-exclude"]);
    expect(kinds([file("20261020150000_x.sql", `-- pg-harness: exclude\n${body}`)])).toEqual([]);
    expect(kinds([file("20261020130500_x.sql", body)])).toEqual([]);
  });

  it("pliki spoza bloku huba i definicje w komentarzach nie są oceniane", () => {
    expect(kinds([file("20261018160000_x.sql", fnSql("cennik_helper"), "")])).toEqual([]);
    expect(
      kinds([
        file(
          "20261020100000_x.sql",
          "-- CREATE OR REPLACE FUNCTION public.hub_in_comment(x int)\n/* CREATE FUNCTION public.hub_in_block() */ SELECT 1;",
        ),
      ]),
    ).toEqual([]);
  });

  it("raport nazywa naruszenie i plik", () => {
    const report = analyzeHubDelivery([
      file("20261020100000_x.sql", fnSql("hub_unregistered_helper")),
    ]);
    expect(hubDeliveryFailed(report)).toBe(true);
    expect(renderHubDeliveryReport(report)).toContain(
      "[bez-wlasciciela] 20261020100000_x.sql: public.hub_unregistered_helper",
    );
  });
});

describe("maskSqlComments", () => {
  it("zastępuje komentarze spacjami, zachowując długość, nowe linie i napisy", () => {
    const sql = "SELECT '-- nie komentarz' /* blok\n */ -- linia\n, 1;";
    const masked = maskSqlComments(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked).toContain("'-- nie komentarz'");
    expect(masked).not.toContain("blok");
    expect(masked).not.toContain("linia");
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
  });

  it("napis E'...' z \\' nie rozjeżdża stanu - kod za nim jest nadal widoczny", () => {
    const sql =
      "SELECT E'it\\'s'; -- komentarz\nCREATE FUNCTION public.x() RETURNS int AS $$ SELECT 1 $$;";
    const masked = maskSqlComments(sql);
    expect(masked).not.toContain("komentarz");
    expect(masked).toContain("CREATE FUNCTION public.x()");
  });
});

describe("globToRegExp", () => {
  it("** obejmuje zero i więcej segmentów, * i ? nie przechodzą przez /", () => {
    expect(globToRegExp("src/**/x.ts").test("src/x.ts")).toBe(true);
    expect(globToRegExp("src/**/x.ts").test("src/a/b/x.ts")).toBe(true);
    expect(globToRegExp("src/**").test("src/a/b/c.tsx")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("a/20261020????_*.sql").test("a/202610201000_x.sql")).toBe(true);
    expect(globToRegExp("a/20261020????_*.sql").test("a/20261020100_x.sql")).toBe(false);
  });

  it("klamry, pusta alternatywa i literał $", () => {
    const re = globToRegExp("src/routes/admin.revenue.{$tab,index}.ts{,x}");
    expect(re.test("src/routes/admin.revenue.$tab.tsx")).toBe(true);
    expect(re.test("src/routes/admin.revenue.index.ts")).toBe(true);
    expect(re.test("src/routes/admin.revenueX$tab.tsx")).toBe(false);
    expect(() => globToRegExp("a/{b,c")).toThrow(/klamra/);
  });
});

describe("manifesty wycinków", () => {
  // Pliki wymienione z nazwy w kartach §8.3 - każdy ma dokładnie jednego
  // właściciela wśród wycinków równoległych.
  const SAMPLES: Readonly<Record<string, string[]>> = {
    S1: [
      "supabase/migrations/20261020100100_newsletter_settings_patch.sql",
      "supabase/tests/coupon_events_test.sql",
      "src/lib/newsletter/renderCampaign.server.ts",
      "src/components/admin/paywall/MeteringSettingsCard.tsx",
      "src/routes/admin.paywall.tsx",
      "src/routes/admin.coupons.redemptions.tsx",
      "src/lib/admin/retentionStats.ts",
      "src/hooks/useCheckoutSettings.ts",
      "src/lib/access/__tests__/metering.test.ts",
    ],
    S2: [
      "supabase/migrations/20261020110400_revenue_aggregates.sql",
      "src/lib/revenue/finance/mrrMath.ts",
      "src/lib/billing/__tests__/billingCatalogSqlParity.test.ts",
      "src/components/billing/organisms/RetentionDialog.tsx",
      "src/lib/email-templates/tx-copy.ts",
    ],
    S3: [
      "supabase/migrations/20261020120100_paywall_hits_rpc.sql",
      "src/components/Paywall.tsx",
      "src/components/__tests__/Paywall.reader.test.tsx",
      "src/routes/checkout.$planId.tsx",
      "src/routes/api/public/-track.test.ts",
      "src/lib/access/__tests__/meteringVisitor.server.test.ts",
      "e2e/paywall.spec.ts",
    ],
    S4: [
      "supabase/migrations/20261020130500_club_application_events.sql",
      "supabase/tests/cohesion_layer_test.sql",
      "src/components/admin/crm/LeadStageHistoryCard.tsx",
      "src/routes/admin.crm.$id.tsx",
      "src/lib/crm-tasks.functions.ts",
      "src/lib/admin/__tests__/workflows.test.ts",
    ],
    S5: [
      "supabase/migrations/20261020140100_journeys_engine.sql",
      "supabase/tests/journeys_consent_test.sql",
      "src/lib/journeys/templates/winback_30d.ts",
      "src/lib/server/journeysRunner.server.ts",
      "src/routes/api/public/nl-click.ts",
      "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts",
    ],
    S6: [
      "src/lib/analytics/semantic/benchmarks/groups/retention.server.ts",
      "src/components/admin/revenue/molecules/RoleGateNotice.tsx",
      "src/components/admin/revenue/organisms/RevenueHubLayout.tsx",
      "docs/benchmarki/2026-10-18/przychod.json",
    ],
    S7: [
      "supabase/migrations/20261020150000_revenue_facts.sql",
      "src/lib/revenue/diagnostics/checks/dataQuality.ts",
      "src/components/admin/revenue/molecules/RevenueSignalChip.tsx",
      "src/components/admin/revenue/tabs/RevenueMrrTab.tsx",
      "src/components/admin/dashboard/MarketingPanel.tsx",
    ],
    S8: [
      "src/components/admin/journeys/editor/JourneyCanvas.tsx",
      "src/components/admin/journeys/editor/JourneyEditorRoute.tsx",
      "src/components/admin/revenue/tabs/RevenueJourneysTab.tsx",
      "src/lib/journeys/editorSearch.ts",
    ],
  };

  it.each(Object.entries(SAMPLES))(
    "%s: pliki z karty mają jednego właściciela równoległego",
    (slice, paths) => {
      for (const path of paths) {
        expect(
          slicesOfPath(path).filter((s) => HUB_PARALLEL_SLICES.includes(s)),
          path,
        ).toEqual([slice]);
        expect(sliceOfPath(path), path).toBe(slice);
      }
    },
  );

  it("pliki współdzielone nie należą do żadnego wycinka równoległego (poza przydziałem imiennym)", () => {
    for (const path of HUB_SHARED_FILES) {
      const owner = sliceOfPath(path);
      if (path === "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts") {
        expect(owner).toBe("S5");
      } else {
        expect(owner, path).toBeNull();
      }
    }
  });

  it("każdy wycinek ma manifest z poprawnymi globami", () => {
    for (const slice of HUB_SLICE_IDS) {
      expect(HUB_SLICE_MANIFESTS[slice].length, slice).toBeGreaterThan(0);
      for (const glob of HUB_SLICE_MANIFESTS[slice]) expect(() => globToRegExp(glob)).not.toThrow();
    }
  });
});

describe("checkSliceDiff", () => {
  it("I0: diff toru A mieści się w manifeście (z plikami współdzielonymi)", () => {
    const result = checkSliceDiff("I0", [
      "supabase/migrations/20261020090000_hub_schema_revenue_ledger.sql",
      "supabase/migrations/20261020090500_hub_shared_sql_helpers.sql",
      "drizzle/migrations/0318_hub_schema_revenue_ledger.sql",
      "drizzle/migrations/meta/_journal.json",
      "supabase/tests/hub_schema_rls_test.sql",
      "src/integrations/supabase/types.ts",
      "src/lib/admin/retentionStats.ts",
      "src/routes/admin.monetization.tsx",
      "src/lib/ci/hubDelivery.ts",
      "src/lib/ci/__tests__/hubDelivery.gate.test.ts",
      "src/routes/admin.revenue.$tab.tsx",
      "src/routeTree.gen.ts",
    ]);
    expect(sliceDiffFailed(result), renderSliceDiff(result)).toBe(false);
  });

  it("odrzuca plik spoza manifestu wycinka", () => {
    const result = checkSliceDiff("S1", [
      "src/routes/admin.paywall.tsx",
      "src/routes/admin.crm.index.tsx",
    ]);
    expect(result.outsideManifest).toEqual(["src/routes/admin.crm.index.tsx"]);
    expect(sliceDiffFailed(result)).toBe(true);
  });

  it("odrzuca plik współdzielony w wycinku S, nawet gdy pasuje do globu", () => {
    const result = checkSliceDiff("S1", [
      "src/integrations/supabase/types.ts",
      "drizzle/migrations/meta/_journal.json",
    ]);
    expect(result.shared).toEqual([
      "drizzle/migrations/meta/_journal.json",
      "src/integrations/supabase/types.ts",
    ]);
    expect(renderSliceDiff(result)).toContain(
      "[plik-wspoldzielony] src/integrations/supabase/types.ts",
    );
  });

  it("przydział imienny: S5 może dopisać wpis do bramki service-role, S4 - nie", () => {
    const path = "src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts";
    expect(sliceDiffFailed(checkSliceDiff("S5", [path]))).toBe(false);
    expect(checkSliceDiff("S4", [path]).shared).toEqual([path]);
  });

  it("odrzuca migrację spoza bloku wycinka (także w wycinku bez SQL)", () => {
    expect(
      checkSliceDiff("S1", ["supabase/migrations/20261020110000_revenue_catalog_mirror.sql"])
        .migrationsOutsideBlock,
    ).toEqual(["supabase/migrations/20261020110000_revenue_catalog_mirror.sql"]);
    expect(
      checkSliceDiff("S6", ["supabase/migrations/20261020100000_settings_change_events.sql"])
        .migrationsOutsideBlock,
    ).toHaveLength(1);
  });
});
