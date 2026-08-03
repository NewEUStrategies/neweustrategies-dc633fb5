import { describe, expect, it } from "vitest";
import {
  analyzeOwnerTenantScope,
  isOwnerBranch,
  isTenantBranch,
  normalizePredicate,
  ownerScopeFailed,
  splitOrBranches,
  unscopedClauses,
} from "../ownerTenantScope";
import { extractLatestPolicies, type PolicyDef } from "../rlsPolicies";

function parse(sql: string): PolicyDef[] {
  return [...extractLatestPolicies([{ file: "0001.sql", sql }]).values()];
}

function one(sql: string): PolicyDef {
  const [policy] = parse(sql);
  expect(policy).toBeDefined();
  return policy;
}

/** Stan author_profiles SPRZED migracji 20260803140000 - wzorzec findingu. */
const AUTHOR_PROFILES_BEFORE_FIX = `
  CREATE POLICY "Owners can view own author profile" ON public.author_profiles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY "Owners can delete own author profile" ON public.author_profiles
    FOR DELETE TO authenticated USING (auth.uid() = user_id);
  CREATE POLICY "Owners can insert own author profile" ON public.author_profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND tenant_id = current_tenant_id());
  CREATE POLICY "Owners can update own author profile" ON public.author_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id AND tenant_id = current_tenant_id())
    WITH CHECK (auth.uid() = user_id AND tenant_id = current_tenant_id());
`;

describe("splitOrBranches", () => {
  it("dzieli po OR najwyższego poziomu, nie po OR w nawiasach", () => {
    expect(splitOrBranches("a = 1 OR (b = 2 OR c = 3)")).toEqual(["a=1", "(b=2orc=3)"]);
  });

  it("NIE dzieli identyfikatorów zawierających „or” (order_id, author_id, moderator)", () => {
    expect(splitOrBranches("order_id = 1 AND author_id = 2 AND moderator")).toEqual([
      "order_id=1andauthor_id=2andmoderator",
    ]);
  });

  it("traktuje literały jako nieprzezroczyste (OR w stringu nie jest alternatywą)", () => {
    // Normalizacja zdejmuje białe znaki także w literale - dla inwariantu bez
    // znaczenia; liczy się to, że predykat NIE rozpadł się na dwie gałęzie.
    expect(splitOrBranches("role = 'editor or admin'")).toHaveLength(1);
    expect(splitOrBranches("user_id = auth.uid() AND note = 'a or b'")).toEqual([
      "user_id=auth.uid()andnote='aorb'",
    ]);
  });

  it("zdejmuje owijkę (select …) z auth.uid() i current_tenant_id()", () => {
    expect(normalizePredicate("(SELECT auth.uid()) = user_id")).toBe("auth.uid()=user_id");
    expect(normalizePredicate("tenant_id = (SELECT public.current_tenant_id())")).toBe(
      "tenant_id=public.current_tenant_id()",
    );
  });
});

describe("rozpoznanie gałęzi", () => {
  it("własność to RÓWNOŚĆ kolumny z auth.uid() - w obie strony", () => {
    expect(isOwnerBranch("auth.uid()=user_id")).toBe(true);
    expect(isOwnerBranch("user_id=auth.uid()")).toBe(true);
  });

  it("has_role(auth.uid(), …) to sprawdzenie ROLI, nie własności wiersza", () => {
    expect(isOwnerBranch("has_role(auth.uid(),'admin'::app_role)")).toBe(false);
    expect(isOwnerBranch("is_staff()andtenant_id=current_tenant_id()")).toBe(false);
  });

  it("tenant wiąże current_tenant_id() albo jawna równość na tenant_id", () => {
    expect(isTenantBranch("user_id=auth.uid()andtenant_id=current_tenant_id()")).toBe(true);
    expect(
      isTenantBranch(
        "user_id=auth.uid()andtenant_id=(selecttenant_idfromprofileswhereid=auth.uid())",
      ),
    ).toBe(true);
    expect(isTenantBranch("user_id=auth.uid()")).toBe(false);
  });
});

describe("unscopedClauses", () => {
  it("wskazuje USING, gdy tenanta pilnuje tylko WITH CHECK", () => {
    const policy = one(`
      CREATE POLICY p ON public.t FOR UPDATE TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
    `);
    expect(unscopedClauses(policy)).toEqual(["USING"]);
  });

  it("wskazuje lukę w gałęzi OR, choć inna gałąź tenanta pilnuje", () => {
    const policy = one(`
      CREATE POLICY p ON public.t FOR SELECT TO authenticated
        USING (user_id = auth.uid()
               OR (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role)));
    `);
    expect(unscopedClauses(policy)).toEqual(["USING"]);
  });

  it("nie zgłasza nic, gdy każda gałąź właścicielska wiąże tenanta", () => {
    const policy = one(`
      CREATE POLICY p ON public.t FOR SELECT TO authenticated
        USING ((user_id = (SELECT auth.uid()) AND tenant_id = (SELECT current_tenant_id()))
               OR (tenant_id = current_tenant_id() AND is_staff()));
    `);
    expect(unscopedClauses(policy)).toEqual([]);
  });
});

describe("analyzeOwnerTenantScope", () => {
  it("łapie finding author_profiles: SELECT i DELETE bez tenanta obok tenantowego INSERT/UPDATE", () => {
    const report = analyzeOwnerTenantScope(parse(AUTHOR_PROFILES_BEFORE_FIX));
    expect(report.gaps.map((gap) => gap.name)).toEqual([
      "owners can delete own author profile",
      "owners can view own author profile",
    ]);
    expect(report.gaps[0].clauses).toEqual(["USING"]);
    expect(report.gaps[0].witnesses).toEqual([
      "owners can insert own author profile",
      "owners can update own author profile",
    ]);
    expect(ownerScopeFailed(report)).toBe(true);
  });

  it("stan PO naprawie jest czysty", () => {
    const report = analyzeOwnerTenantScope(
      parse(`
        CREATE POLICY "Owners can view own author profile" ON public.author_profiles
          FOR SELECT TO authenticated
          USING (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()));
        CREATE POLICY "Owners can delete own author profile" ON public.author_profiles
          FOR DELETE TO authenticated
          USING (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()));
        CREATE POLICY "Owners can insert own author profile" ON public.author_profiles
          FOR INSERT TO authenticated
          WITH CHECK (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()));
      `),
    );
    expect(report.gaps).toEqual([]);
    expect(ownerScopeFailed(report)).toBe(false);
  });

  it("milczy na tabeli, która NIGDZIE nie deklaruje tenanta (bramka samokalibrująca)", () => {
    const report = analyzeOwnerTenantScope(
      parse(`
        CREATE POLICY a ON public.global_table FOR SELECT TO authenticated USING (user_id = auth.uid());
        CREATE POLICY b ON public.global_table FOR DELETE TO authenticated USING (user_id = auth.uid());
      `),
    );
    expect(report.gaps).toEqual([]);
    expect(report.ownerPolicies).toBe(2);
  });

  it("wpis JUSTIFIED przykrywa lukę pozorną i jest raportowany jako trafienie", () => {
    const report = analyzeOwnerTenantScope(parse(AUTHOR_PROFILES_BEFORE_FIX), {
      justified: {
        "author_profiles::owners can view own author profile": "powod",
        "author_profiles::owners can delete own author profile": "powod",
      },
    });
    expect(report.gaps).toEqual([]);
    expect(report.justifiedHits).toHaveLength(2);
    expect(ownerScopeFailed(report)).toBe(false);
  });

  it("znany dług nie blokuje CI, ale zostaje w raporcie", () => {
    const report = analyzeOwnerTenantScope(parse(AUTHOR_PROFILES_BEFORE_FIX), {
      knownGaps: {
        "author_profiles::owners can view own author profile": "dlug",
        "author_profiles::owners can delete own author profile": "dlug",
      },
    });
    expect(report.gaps).toEqual([]);
    expect(report.knownGaps).toHaveLength(2);
    expect(ownerScopeFailed(report)).toBe(false);
  });

  it("NOWA luka obok znanego długu nadal wywala CI (ratchet)", () => {
    const report = analyzeOwnerTenantScope(parse(AUTHOR_PROFILES_BEFORE_FIX), {
      knownGaps: { "author_profiles::owners can view own author profile": "dlug" },
    });
    expect(report.gaps.map((gap) => gap.name)).toEqual(["owners can delete own author profile"]);
    expect(ownerScopeFailed(report)).toBe(true);
  });

  it("wpis bez trafienia (luka zamknięta) wywala CI, żeby lista tylko malała", () => {
    const report = analyzeOwnerTenantScope(parse(AUTHOR_PROFILES_BEFORE_FIX), {
      knownGaps: {
        "author_profiles::owners can view own author profile": "dlug",
        "author_profiles::owners can delete own author profile": "dlug",
        "author_profiles::polityka juz nie istnieje": "dlug",
      },
    });
    expect(report.staleAnnotations).toEqual(["author_profiles::polityka juz nie istnieje"]);
    expect(ownerScopeFailed(report)).toBe(true);
  });
});
