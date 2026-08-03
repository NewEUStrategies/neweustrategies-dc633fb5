import { describe, expect, it } from "vitest";
import {
  classifyExpr,
  extractLatestPolicies,
  insertCheckKind,
  isInsertCapable,
  parenExprAfter,
  policyPredicate,
  readStatementTail,
  type PolicyDef,
} from "../rlsPolicies";

function single(sql: string, file = "0001.sql"): PolicyDef {
  const policies = extractLatestPolicies([{ file, sql }]);
  const [policy] = [...policies.values()];
  expect(policy).toBeDefined();
  return policy;
}

describe("extractLatestPolicies", () => {
  it("rozkłada politykę na komendę, role i obie klauzule", () => {
    const policy = single(`
      CREATE POLICY "Owners can view own author profile"
        ON public.author_profiles FOR SELECT
        TO authenticated
        USING (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public.current_tenant_id()));
    `);
    expect(policy.key).toBe("author_profiles::owners can view own author profile");
    expect(policy.table).toBe("author_profiles");
    expect(policy.command).toBe("select");
    expect([...policy.roles]).toEqual(["authenticated"]);
    expect(policy.using).toContain("current_tenant_id");
    expect(policy.withCheck).toBeNull();
  });

  it("brak FOR to FOR ALL, a brak TO to rola public (semantyka Postgresa)", () => {
    const policy = single("CREATE POLICY p ON public.t USING (true);");
    expect(policy.command).toBe("all");
    expect([...policy.roles]).toEqual(["public"]);
  });

  it("czyta obie klauzule polityki UPDATE", () => {
    const policy = single(`
      CREATE POLICY p ON public.t FOR UPDATE TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
    `);
    expect(policy.using).toBe("user_id = auth.uid()");
    expect(policy.withCheck).toContain("current_tenant_id()");
  });

  it("respektuje kolejność instrukcji w JEDNYM pliku (DROP + CREATE = polityka żyje)", () => {
    const policies = extractLatestPolicies([
      {
        file: "0001.sql",
        sql: `
          DROP POLICY IF EXISTS "p" ON public.t;
          CREATE POLICY "p" ON public.t FOR SELECT USING (user_id = auth.uid());
        `,
      },
    ]);
    expect(policies.has("t::p")).toBe(true);
  });

  it("CREATE, a potem DROP w tym samym pliku usuwa politykę", () => {
    const policies = extractLatestPolicies([
      {
        file: "0001.sql",
        sql: `
          CREATE POLICY "p" ON public.t FOR SELECT USING (true);
          DROP POLICY "p" ON public.t;
        `,
      },
    ]);
    expect(policies.has("t::p")).toBe(false);
  });

  it("późniejsza migracja nadpisuje wcześniejszą definicję (forward-only)", () => {
    const policies = extractLatestPolicies([
      {
        file: "0001.sql",
        sql: "CREATE POLICY p ON public.t FOR SELECT USING (user_id = auth.uid());",
      },
      {
        file: "0002.sql",
        sql: `DROP POLICY IF EXISTS p ON public.t;
              CREATE POLICY p ON public.t FOR SELECT USING (user_id = auth.uid() AND tenant_id = current_tenant_id());`,
      },
    ]);
    const policy = policies.get("t::p");
    expect(policy?.file).toBe("0002.sql");
    expect(policy?.using).toContain("current_tenant_id");
  });

  it("nie gubi się na średniku w literale ani na zagnieżdżonych nawiasach", () => {
    const policy = single(`
      CREATE POLICY p ON public.t FOR SELECT TO anon, authenticated
        USING (note = 'a;b' AND id IN (SELECT x FROM (SELECT 1 AS x) s));
    `);
    expect([...policy.roles]).toEqual(["anon", "authenticated"]);
    expect(policy.using).toBe("note = 'a;b' AND id IN (SELECT x FROM (SELECT 1 AS x) s)");
  });
});

describe("readStatementTail / parenExprAfter", () => {
  it("kończy instrukcję na średniku poziomu 0", () => {
    expect(readStatementTail("abc (x; y) def; ghi", 0)).toBe("abc (x; y) def");
  });

  it("wyciąga zbalansowane wyrażenie po słowie kluczowym", () => {
    expect(parenExprAfter("USING ( a = (b) ) WITH CHECK (c)", /\bUSING\b/i)).toBe("a = (b)");
  });

  it("zwraca null, gdy klauzuli nie ma", () => {
    expect(parenExprAfter("FOR SELECT TO anon", /\bWITH\s+CHECK\b/i)).toBeNull();
  });
});

describe("klasyfikacja wyrażeń i checku INSERT", () => {
  it("rozróżnia true / false / warunek / brak", () => {
    expect(classifyExpr("true")).toBe("true");
    expect(classifyExpr(" FALSE ")).toBe("false");
    expect(classifyExpr("user_id = auth.uid()")).toBe("other");
    expect(classifyExpr(null)).toBe("none");
  });

  it("FOR ALL bez WITH CHECK dziedziczy check INSERT-u z USING", () => {
    expect(insertCheckKind(single("CREATE POLICY p ON public.t USING (true);"))).toBe("permissive");
    expect(insertCheckKind(single("CREATE POLICY p ON public.t USING (false);"))).toBe("deny");
    expect(
      insertCheckKind(single("CREATE POLICY p ON public.t USING (user_id = auth.uid());")),
    ).toBe("restricted");
  });

  it("polityka bez żadnej klauzuli nie ogranicza INSERT-u", () => {
    expect(insertCheckKind(single("CREATE POLICY p ON public.t FOR INSERT TO anon;"))).toBe(
      "permissive",
    );
  });

  it("INSERT-capable to FOR INSERT albo FOR ALL", () => {
    expect(
      isInsertCapable(single("CREATE POLICY p ON public.t FOR INSERT WITH CHECK (true);")),
    ).toBe(true);
    expect(isInsertCapable(single("CREATE POLICY p ON public.t USING (true);"))).toBe(true);
    expect(isInsertCapable(single("CREATE POLICY p ON public.t FOR SELECT USING (true);"))).toBe(
      false,
    );
  });
});

describe("policyPredicate", () => {
  it("nawiasuje klauzule, żeby OR z jednej nie zlało się z drugą", () => {
    const policy = single(`
      CREATE POLICY p ON public.t FOR UPDATE
        USING (a OR b) WITH CHECK (c);
    `);
    expect(policyPredicate(policy)).toBe("(a OR b) AND (c)");
  });
});
