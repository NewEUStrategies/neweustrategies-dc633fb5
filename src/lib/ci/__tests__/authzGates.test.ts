// Testy jednostkowe parsera bramek autoryzacji na SYNTETYCZNYM SQL-u.
//
// Bramka parytetu (src/lib/authz/__tests__) porównuje snapshot z prawdziwymi
// migracjami - ale gdyby parser był po cichu ślepy, oba porównywane zbiory byłyby
// równie puste i test przeszedłby na zielono, nic nie pilnując. Dlatego wzorce
// rozpoznawania mają własne testy: literały ról, aliasy rolowe, odczyty flag
// (vs zapisy w seedach), stan końcowy funkcji i żywotność polityk RLS.
import { describe, expect, it } from "vitest";
import {
  collectAuthzSnapshotDrift,
  deriveAppRoles,
  deriveAuthzSnapshot,
  deriveLivePolicies,
  diffAuthzSnapshots,
  formatAuthzDriftReport,
  gateEffectiveRoles,
  gateMode,
  gatedFeatureKeys,
  hasAuthorizationDrift,
  renderAuthzSnapshotModule,
  selectAuthzSnapshot,
  splitSqlStatements,
  type AuthzFunctionInput,
  type AuthzGateSource,
} from "@/lib/ci/authzGates";
import type {
  AuthzSnapshotModule,
  FeatureGateEntry,
  RoleGateEntry,
} from "@/lib/authz/authzSnapshotTypes";

const ENUM_SQL = {
  file: "0001_roles.sql",
  sql: "CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'author');\nALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';\nALTER TYPE app_role ADD VALUE 'user';",
};

function fn(
  name: string,
  body: string,
  attrs = "LANGUAGE sql STABLE SECURITY DEFINER",
): AuthzFunctionInput {
  return { key: `public.${name}/0`, name: `public.${name}`, file: "0002_fns.sql", body, attrs };
}

function source(
  functions: readonly AuthzFunctionInput[],
  extra: readonly { file: string; sql: string }[] = [],
): AuthzGateSource {
  return { functions, migrations: [ENUM_SQL, ...extra] };
}

describe("enum app_role", () => {
  it("ignores an empty enum value and splits unfinished SQL conservatively", () => {
    expect(
      deriveAppRoles([{ file: "001.sql", sql: "CREATE TYPE app_role AS ENUM ('', 'admin');" }]),
    ).toEqual(["admin"]);
    expect(splitSqlStatements(";; SELECT $1; SELECT 2")).toEqual(["SELECT $1", "SELECT 2"]);
    expect(splitSqlStatements("CREATE FUNCTION f() RETURNS void AS $$ BEGIN;")).toHaveLength(1);
  });
  it("składa wartości z CREATE TYPE i ALTER TYPE ADD VALUE", () => {
    expect(deriveAppRoles([ENUM_SQL])).toEqual([
      "admin",
      "author",
      "editor",
      "super_admin",
      "user",
    ]);
  });

  it("bez definicji enuma zwraca pustą listę (generator to traktuje jako błąd)", () => {
    expect(deriveAppRoles([{ file: "x.sql", sql: "SELECT 1;" }])).toEqual([]);
  });
});

describe("literały ról w bramkach", () => {
  it("czyta has_role() z rzutowaniem i bez", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn(
          "guarded",
          "SELECT public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'editor')",
        ),
      ]),
    );
    expect(snapshot.roleGates[0].anyRoles).toEqual(["admin", "editor"]);
  });

  it("czyta role = 'x'::app_role (wzorzec is_super_admin)", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn(
          "sa",
          "SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin'::public.app_role)",
        ),
      ]),
    );
    expect(snapshot.roleGates[0].anyRoles).toEqual(["super_admin"]);
  });

  it("IGNORUJE kolumnę `role` bez rzutowania na app_role (obce tabele)", () => {
    const snapshot = deriveAuthzSnapshot(
      source([fn("orgs", "SELECT 1 FROM public.member_organizations WHERE role = 'admin'")]),
    );
    expect(snapshot.roleGates).toEqual([]);
  });

  it("odsiewa literał, którego nie ma w enumie", () => {
    // NEGATYWNA próbka parsera: 'tenant_admin' jest tu celowo spoza enuma - ten
    // test dowodzi, że parser go odsiewa, czyli broni dokładnie tej regresji,
    // dla której istnieje `check:sql-app-role`. Fixture nigdy nie dociera do
    // bazy, więc nie podlega inwariantowi runtime'owemu - stąd zwolnienie.
    const staleGate = "SELECT public.has_role(auth.uid(), 'tenant_admin')"; // app-role-literal-exempt
    const snapshot = deriveAuthzSnapshot(source([fn("stale", staleGate)]));
    expect(snapshot.roleGates).toEqual([]);
  });
});

describe("aliasy rolowe", () => {
  const aliases = [
    fn(
      "is_staff",
      "SELECT public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author')",
    ),
    fn(
      "is_super_admin",
      "SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin'::app_role)",
    ),
    fn(
      "assert_admin_tenant",
      "IF NOT public.has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;",
    ),
  ];

  it("rozwija is_staff()/is_super_admin() jako alternatywy (OR)", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        ...aliases,
        fn("panel", "SELECT public.is_staff() OR public.is_super_admin(auth.uid())"),
      ]),
    );
    const gate = snapshot.roleGates.find((g) => g.ref === "fn:panel/0");
    expect(gate?.anyRoles).toEqual(["admin", "author", "editor", "super_admin"]);
    expect(gate === undefined ? null : gateMode(gate)).toBe("any");
  });

  it("assert_admin_tenant() to warunek TWARDY, nie alternatywa", () => {
    const snapshot = deriveAuthzSnapshot(
      source([...aliases, fn("grant", "v_tenant := public.assert_admin_tenant();")]),
    );
    const gate = snapshot.roleGates.find((g) => g.ref === "fn:grant/0");
    expect(gate?.allRoles).toEqual(["admin"]);
    expect(gate?.anyRoles).toEqual([]);
    expect(gate === undefined ? null : gateMode(gate)).toBe("all");
    expect(gate === undefined ? [] : gateEffectiveRoles(gate)).toEqual(["admin"]);
  });

  it("bramka mieszana sumuje role i jest oznaczona jako mixed", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        ...aliases,
        fn(
          "both",
          "PERFORM public.assert_admin_tenant(); IF public.has_role(auth.uid(),'editor') THEN NULL; END IF;",
        ),
      ]),
    );
    const gate = snapshot.roleGates.find((g) => g.ref === "fn:both/0");
    expect(gate === undefined ? null : gateMode(gate)).toBe("mixed");
    expect(gate === undefined ? [] : gateEffectiveRoles(gate)).toEqual(["admin", "editor"]);
  });
});

describe("odczyty flag warstw", () => {
  it("rozpoznaje has_tier_feature / user_has_tier_feature / features ->>", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn("a", "SELECT public.has_tier_feature('recordings')"),
        fn("b", "SELECT public.user_has_tier_feature(q.user_id, 'qa_priority')"),
        fn("c", "IF COALESCE((v_features ->> 'chat_enabled')::boolean, false) THEN NULL; END IF;"),
      ]),
    );
    expect(gatedFeatureKeys(snapshot)).toEqual(["chat_enabled", "qa_priority", "recordings"]);
  });

  it("NIE bierze zapisów seedowych za bramkę", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn(
          "seed",
          "UPDATE public.membership_tiers SET features = features || jsonb_build_object('working_groups', true) WHERE NOT (features ? 'working_groups');",
        ),
      ]),
    );
    expect(gatedFeatureKeys(snapshot)).toEqual([]);
  });

  it("bramka flagi niesie role obejścia i sposób wiązania z tenantem", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn(
          "get_event_access",
          "v_staff := public.has_role(auth.uid(),'editor'); RETURN v_staff OR public.has_tier_feature('recordings') AND v_event.tenant_id = public.current_tenant_id();",
        ),
      ]),
    );
    expect(snapshot.featureGates).toEqual([
      {
        capability: "recordings",
        ref: "fn:get_event_access/0",
        kind: "function",
        object: "get_event_access",
        file: "0002_fns.sql",
        bypassRoles: ["editor"],
        tenantRef: "caller",
      },
    ]);
  });
});

describe("odniesienie do tenanta", () => {
  it("current_tenant_id() = tenant wołającego", () => {
    const snapshot = deriveAuthzSnapshot(
      source([
        fn(
          "a",
          "SELECT public.has_role(auth.uid(),'admin') AND t.tenant_id = public.current_tenant_id()",
        ),
      ]),
    );
    expect(snapshot.roleGates[0].tenantRef).toBe("caller");
  });

  it("samo porównanie kolumn tenant_id = tenant wiersza", () => {
    const snapshot = deriveAuthzSnapshot(
      source([fn("b", "SELECT public.has_role(auth.uid(),'admin') AND i.tenant_id = f.tenant_id")]),
    );
    expect(snapshot.roleGates[0].tenantRef).toBe("row");
  });

  it("brak odwołania do tenanta jest raportowany jako 'none'", () => {
    const snapshot = deriveAuthzSnapshot(
      source([fn("c", "SELECT public.has_role(auth.uid(),'admin')")]),
    );
    expect(snapshot.roleGates[0].tenantRef).toBe("none");
  });
});

describe("polityki RLS", () => {
  const migration = {
    file: "0003_policies.sql",
    sql: `
      CREATE POLICY "follows owner" ON public.eu_policy_follows
        FOR ALL TO authenticated
        WITH CHECK (user_id = auth.uid() AND public.has_tier_feature('regulatory_monitoring'));
      CREATE POLICY "staff read" ON public.posts FOR SELECT USING (public.has_role(auth.uid(), 'editor'));
    `,
  };

  it("wychwytuje politykę i jej bramkę flagi", () => {
    const snapshot = deriveAuthzSnapshot(source([], [migration]));
    const gate = snapshot.roleGates.find((g) => g.ref === "policy:eu_policy_follows/follows owner");
    expect(gate?.featureKeys).toEqual(["regulatory_monitoring"]);
    expect(gate?.securityDefiner).toBe(false);
  });

  it("polityka usunięta późniejszym DROP-em nie jest żywa", () => {
    const dropped = {
      file: "0004_drop.sql",
      sql: 'DROP POLICY IF EXISTS "staff read" ON public.posts;',
    };
    const live = deriveLivePolicies([migration, dropped]).map((policy) => policy.name);
    expect(live).toEqual(["follows owner"]);
  });

  it("DROP przed CREATE w tej samej migracji zostawia politykę żywą", () => {
    const recreated = {
      file: "0005_recreate.sql",
      sql: 'DROP POLICY IF EXISTS "staff read" ON public.posts;\nCREATE POLICY "staff read" ON public.posts FOR SELECT USING (public.has_role(auth.uid(), \'admin\'));',
    };
    const live = deriveLivePolicies([migration, recreated]);
    const policy = live.find((candidate) => candidate.name === "staff read");
    expect(policy?.file).toBe("0005_recreate.sql");
    expect(policy?.sql).toContain("'admin'");
  });
});

describe("dzielenie SQL-a na instrukcje", () => {
  it("nie rozcina ciała funkcji na dollar-quote", () => {
    const statements = splitSqlStatements(
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN SELECT 1; SELECT 2; END $$; SELECT 3;",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("SELECT 2");
  });

  it("nie rozcina średnika w literale ani nie gubi escapowanego apostrofu", () => {
    const statements = splitSqlStatements("SELECT 'a;b', 'it''s'; SELECT 2;");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("it''s");
  });
});

describe("zaznaczenie i render snapshotu", () => {
  const built = deriveAuthzSnapshot(
    source([
      fn("admin_list_users", "SELECT public.has_role(auth.uid(),'admin')"),
      fn("other_gate", "SELECT public.has_role(auth.uid(),'editor')"),
    ]),
  );

  it("do bundla trafiają tylko bramki dokumentowane przez macierz", () => {
    const selected = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    expect(selected.roleGates.map((gate) => gate.ref)).toEqual(["fn:admin_list_users/0"]);
    expect(selected.danglingRefs).toEqual([]);
  });

  it("referencja bez bramki jest raportowana jako wisząca", () => {
    const selected = selectAuthzSnapshot(built, { roleGateRefs: ["fn:nie_ma/1"] });
    expect(selected.danglingRefs).toEqual(["fn:nie_ma/1"]);
  });

  it("wyrenderowany moduł jest deterministyczny i importowalny jako TS", () => {
    const selected = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    const rendered = renderAuthzSnapshotModule(selected);
    expect(rendered).toBe(renderAuthzSnapshotModule(selected));
    expect(rendered).toContain("export const AUTHZ_SNAPSHOT: AuthzSnapshotModule");
    expect(rendered).toContain('"fn:admin_list_users/0"');
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("diff wskazuje dokładnie, co się rozjechało", () => {
    const before = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    const after = deriveAuthzSnapshot(
      source([
        fn(
          "admin_list_users",
          "SELECT public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')",
        ),
      ]),
    );
    const problems = diffAuthzSnapshots(
      before,
      selectAuthzSnapshot(after, { roleGateRefs: ["fn:admin_list_users/0"] }),
    );
    // Zmiana uprawnień jest PIERWSZA (sortowanie po wadze), a dryf metryk skanu
    // (inna liczba funkcji w źródle) dochodzi jako provenance.
    expect(problems[0]).toContain("fn:admin_list_users/0");
    expect(problems[0]).toContain("krąg uprawnionych");
    expect(problems[0]).toContain("super_admin");
    expect(problems[0]).toContain("anyRoles");
  });

  it("identyczne snapshoty nie generują ani jednego komunikatu", () => {
    const same = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    expect(diffAuthzSnapshots(same, same)).toEqual([]);
  });

  it("przeniesienie definicji do nowszej migracji raportuje provenance, nie uprawnienia", () => {
    // Dokładnie regres z audytu 2026-08-06: zbiór ról się nie zmienił, zmienił
    // się plik z ostatnią żywą definicją - stary komunikat drukował dwa
    // identyczne obiekty i zaprzeczał własnej tezie.
    //
    // `moved` powstaje z `before` przez podmianę SAMEGO `file`, a nie z drugiego
    // `deriveAuthzSnapshot` - inaczej różniłyby się też metryki skanu (`stats`)
    // i test mierzyłby dwa zjawiska naraz zamiast tego, o które pyta.
    const before = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    const moved = deriveAuthzSnapshot(
      source([
        {
          ...fn("admin_list_users", "SELECT public.has_role(auth.uid(),'admin')"),
          file: "0009_przeniesione.sql",
        },
      ]),
    );
    const problems = diffAuthzSnapshots(
      before,
      selectAuthzSnapshot(moved, { roleGateRefs: ["fn:admin_list_users/0"] }),
    );
    // Obok wpisu bramki pojawia się drugi, o statystykach skanu (inne źródło
    // migracji) - istotne jest, że rozjazd bramki to provenance, nie role.
    const gateProblem = problems.find((p) => p.includes("admin_list_users"));
    expect(gateProblem).toBeDefined();
    expect(gateProblem).toContain("to samo uprawnienie w innej migracji");
    expect(gateProblem).toContain("0009_przeniesione.sql");
    expect(gateProblem).not.toContain("anyRoles");
  });
});

// ---------------------------------------------------------------------------
// Diagnostyka dryfu: dowód MUSI zgadzać się z tezą
// ---------------------------------------------------------------------------
//
// REGRESJA, KTÓRĄ TU PRZYBIJAMY: poprzednia diagnostyka porównywała cały obiekt
// bramki, a drukowała cztery wybrane pola - więc dryf pola `file` dawał komunikat
// „bramka rozjechała się: {A} vs {A}" z dwoma IDENTYCZNYMI obiektami i wrzucała
// przeniesioną definicję do jednego worka z realnym zawężeniem uprawnień.
describe("dryf snapshotu bramek", () => {
  const gate = (over: Partial<RoleGateEntry> = {}): RoleGateEntry => ({
    ref: "fn:profiles_guard_verification/0",
    kind: "function",
    object: "profiles_guard_verification",
    file: "20260805122338_stary.sql",
    anyRoles: ["admin", "super_admin"],
    allRoles: [],
    tenantRef: "none",
    securityDefiner: true,
    featureKeys: [],
    ...over,
  });

  const featureGate = (over: Partial<FeatureGateEntry> = {}): FeatureGateEntry => ({
    capability: "premium_content",
    ref: "fn:has_content_access/2",
    kind: "function",
    object: "has_content_access",
    file: "20260723090000_tier.sql",
    bypassRoles: ["admin"],
    tenantRef: "caller",
    ...over,
  });

  const snapshot = (
    roleGates: readonly RoleGateEntry[],
    featureGates: readonly FeatureGateEntry[] = [],
  ): AuthzSnapshotModule => ({
    appRoles: ["admin", "author", "editor", "super_admin", "user"],
    roleGates,
    featureGates,
    stats: { migrations: 10, functions: 5, policies: 3 },
  });

  it("reports removed and added feature gates as authorization changes", () => {
    const removed = collectAuthzSnapshotDrift(snapshot([], [featureGate()]), snapshot([]));
    const added = collectAuthzSnapshotDrift(snapshot([]), snapshot([], [featureGate()]));
    expect(removed[0]).toMatchObject({ kind: "feature_gate_removed", severity: "authorization" });
    expect(added[0]).toMatchObject({ kind: "feature_gate_added", severity: "authorization" });
    expect(formatAuthzDriftReport(removed)).toContain("ZMIANA UPRAWNIEŃ");
    expect(formatAuthzDriftReport(removed)).not.toContain("PROVENANCE -");
  });
  it("reports feature provenance separately from permission changes", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([], [featureGate()]),
      snapshot([], [featureGate({ file: "later.sql" })]),
    );
    expect(drift[0]).toMatchObject({ kind: "feature_gate_changed", severity: "provenance" });
    expect(formatAuthzDriftReport(drift)).not.toContain("ZMIANA UPRAWNIEŃ");
    expect(formatAuthzDriftReport(drift)).toContain("PROVENANCE");
  });

  it("zgodny snapshot nie produkuje ŻADNEGO wpisu", () => {
    expect(collectAuthzSnapshotDrift(snapshot([gate()]), snapshot([gate()]))).toEqual([]);
    expect(diffAuthzSnapshots(snapshot([gate()]), snapshot([gate()]))).toEqual([]);
  });

  it("dryf SAMEGO pola `file` to provenance - bez tezy o zmianie uprawnień", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([gate()]),
      snapshot([gate({ file: "20260806150000_nowy.sql" })]),
    );

    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe("provenance");
    expect(drift[0].kind).toBe("gate_changed");
    expect(drift[0].fields.map((field) => field.field)).toEqual(["file"]);
    // Komunikat pokazuje OBIE wartości pola, które się różni (dowód = teza),
    // i nie twierdzi, że ktokolwiek zyskał albo stracił dostęp.
    expect(drift[0].message).toContain("20260805122338_stary.sql");
    expect(drift[0].message).toContain("20260806150000_nowy.sql");
    expect(drift[0].message).not.toContain("krąg uprawnionych");
    expect(hasAuthorizationDrift(drift)).toBe(false);
  });

  it("zawężenie zbioru ról to dryf uprawnień z nazwanym polem", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([gate()]),
      snapshot([gate({ anyRoles: ["admin"] })]),
    );

    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe("authorization");
    expect(drift[0].fields).toEqual([
      {
        field: "anyRoles",
        severity: "authorization",
        committed: "[admin, super_admin]",
        derived: "[admin]",
      },
    ]);
    expect(drift[0].message).toContain("krąg uprawnionych");
    expect(hasAuthorizationDrift(drift)).toBe(true);
  });

  it("zmiana warunku bez zmiany ról NIE jest opisana jako zmiana kręgu uprawnionych", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([gate()]),
      snapshot([gate({ tenantRef: "caller" })]),
    );

    expect(drift[0].severity).toBe("authorization");
    expect(drift[0].message).toContain("warunki dostępu");
    expect(drift[0].message).toContain("tenantRef: none -> caller");
  });

  it("uprawnienia i provenance w jednym wpisie: waga bierze GORSZĄ, komunikat oba pola", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([gate()]),
      snapshot([gate({ anyRoles: ["admin"], file: "20260806150000_nowy.sql" })]),
    );

    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe("authorization");
    expect(drift[0].fields.map((field) => field.field)).toEqual(["anyRoles", "file"]);
  });

  it("KAŻDE pole bramki jest porównywane (inaczej dryf przechodzi w ciszy)", () => {
    const mutations: ReadonlyArray<{ field: string; over: Partial<RoleGateEntry> }> = [
      { field: "anyRoles", over: { anyRoles: ["admin"] } },
      { field: "allRoles", over: { allRoles: ["admin"] } },
      { field: "tenantRef", over: { tenantRef: "row" } },
      { field: "securityDefiner", over: { securityDefiner: false } },
      { field: "featureKeys", over: { featureKeys: ["premium_content"] } },
      { field: "kind", over: { kind: "policy" } },
      { field: "object", over: { object: "inna_nazwa" } },
      { field: "file", over: { file: "20260806150000_nowy.sql" } },
    ];
    // Lista pokrywa CAŁY kontrakt bramki poza `ref` (kluczem porównania) - gdyby
    // doszło nowe pole, `Record<Exclude<keyof RoleGateEntry, "ref">, …>` w
    // authzGates.ts nie skompiluje się bez klasyfikacji, a ten test bez wpisu.
    expect(mutations.map((mutation) => mutation.field).sort()).toEqual(
      Object.keys(gate())
        .filter((key) => key !== "ref")
        .sort(),
    );

    for (const { field, over } of mutations) {
      const drift = collectAuthzSnapshotDrift(snapshot([gate()]), snapshot([gate(over)]));
      expect(drift, `pole ${field} nie jest porównywane`).toHaveLength(1);
      expect(drift[0].fields.map((entry) => entry.field)).toEqual([field]);
    }
  });

  it("bramka, która zniknęła / doszła, jest dryfem uprawnień", () => {
    const removed = collectAuthzSnapshotDrift(snapshot([gate()]), snapshot([]));
    expect(removed[0].kind).toBe("gate_removed");
    expect(removed[0].severity).toBe("authorization");

    const added = collectAuthzSnapshotDrift(snapshot([]), snapshot([gate()]));
    expect(added[0].kind).toBe("gate_added");
    expect(added[0].severity).toBe("authorization");
  });

  it("bramka flagi warstwy: zmiana bypassu stafowego przestaje być niewidoczna", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([], [featureGate()]),
      snapshot([], [featureGate({ bypassRoles: ["admin", "editor"] })]),
    );

    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe("feature_gate_changed");
    expect(drift[0].severity).toBe("authorization");
    expect(drift[0].message).toContain("premium_content|fn:has_content_access/2");
    expect(drift[0].message).toContain("bypassRoles: [admin] -> [admin, editor]");
  });

  it("starszy skan migracji jest raportowany (bramka bajtowa i test parytetu mówią to samo)", () => {
    const stale: AuthzSnapshotModule = {
      ...snapshot([gate()]),
      stats: { migrations: 612, functions: 545, policies: 504 },
    };
    const drift = collectAuthzSnapshotDrift(stale, snapshot([gate()]));

    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe("stats");
    expect(drift[0].severity).toBe("provenance");
    expect(drift[0].message).toContain("migrations: 612 -> 10");
  });

  it("enum app_role liczy się jako dryf uprawnień", () => {
    const drift = collectAuthzSnapshotDrift(snapshot([gate()]), {
      ...snapshot([gate()]),
      appRoles: ["admin", "author", "editor", "super_admin"],
    });

    expect(drift[0].kind).toBe("app_roles");
    expect(drift[0].severity).toBe("authorization");
    expect(drift[0].message).toContain("user");
  });

  it("raport dla CI rozdziela sekcje i stawia uprawnienia PRZED provenance", () => {
    const drift = collectAuthzSnapshotDrift(
      snapshot([gate(), gate({ ref: "fn:inna/0", object: "inna" })]),
      snapshot([
        gate({ anyRoles: ["admin"] }),
        gate({ ref: "fn:inna/0", object: "inna", file: "20260806150000_nowy.sql" }),
      ]),
    );
    const report = formatAuthzDriftReport(drift);

    expect(report.indexOf("ZMIANA UPRAWNIEŃ")).toBeGreaterThan(-1);
    expect(report.indexOf("ZMIANA UPRAWNIEŃ")).toBeLessThan(report.indexOf("PROVENANCE"));
    expect(report).toContain("generate:authz-snapshot");
    expect(formatAuthzDriftReport([])).toContain("zgadza się");
  });
  // Odpowiednik tej regresji (provenance pola `file`) jest pokryty wyżej,
  // w bloku z dostępnym `built` - patrz "przeniesienie definicji do nowszej
  // migracji raportuje provenance, nie uprawnienia".
});
