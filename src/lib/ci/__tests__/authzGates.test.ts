// Testy jednostkowe parsera bramek autoryzacji na SYNTETYCZNYM SQL-u.
//
// Bramka parytetu (src/lib/authz/__tests__) porównuje snapshot z prawdziwymi
// migracjami - ale gdyby parser był po cichu ślepy, oba porównywane zbiory byłyby
// równie puste i test przeszedłby na zielono, nic nie pilnując. Dlatego wzorce
// rozpoznawania mają własne testy: literały ról, aliasy rolowe, odczyty flag
// (vs zapisy w seedach), stan końcowy funkcji i żywotność polityk RLS.
import { describe, expect, it } from "vitest";
import {
  deriveAppRoles,
  deriveAuthzSnapshot,
  deriveLivePolicies,
  diffAuthzSnapshots,
  gateEffectiveRoles,
  gateMode,
  gatedFeatureKeys,
  renderAuthzSnapshotModule,
  selectAuthzSnapshot,
  splitSqlStatements,
  type AuthzFunctionInput,
  type AuthzGateSource,
} from "@/lib/ci/authzGates";

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
    const snapshot = deriveAuthzSnapshot(
      source([fn("stale", "SELECT public.has_role(auth.uid(), 'tenant_admin')")]),
    );
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
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("fn:admin_list_users/0");
    expect(problems[0]).toContain("super_admin");
    expect(problems[0]).toContain("anyRoles");
  });

  it("identyczne snapshoty nie generują ani jednego komunikatu", () => {
    const same = selectAuthzSnapshot(built, { roleGateRefs: ["fn:admin_list_users/0"] });
    expect(diffAuthzSnapshots(same, same)).toEqual([]);
  });

  it("przeniesienie definicji do nowszej migracji raportuje provenance, nie uprawnienia", () => {
    // Dokładnie regres z audytu 2026-08-06: zbiór rol się nie zmienił, zmienił
    // się plik z ostatnią żywą definicją - stary komunikat drukował dwa
    // identyczne obiekty i zaprzeczał własnej tezie.
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
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("provenance");
    expect(problems[0]).toContain("0009_przeniesione.sql");
    expect(problems[0]).not.toContain("anyRoles");
  });
});
