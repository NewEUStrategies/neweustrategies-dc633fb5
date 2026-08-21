// Self-test analizatora zakresu najemcy dla zapytań spod service-role.
//
// PO CO TO ISTNIEJE. Bramka `serviceRoleTenantScope.gate.test.ts` jest dziś
// ZIELONA na całym repozytorium - a bramka, która nigdy nie była czerwona, nie
// odróżnia się od bramki zepsutej. Ten plik dowodzi na wejściach syntetycznych,
// że analizator NAPRAWDĘ zapala się na zapytaniu bez granicy najemcy, i że nie
// zapala się na czterech kształtach, które granicę mają, tylko inną niż
// najczęstsza. Bez tego pierwsza asercja bramki („gaps === []") mogłaby być
// prawdziwa dlatego, że skaner nic nie widzi.
//
// CZEGO NIE DUBLUJE. Bramka sprawdza STAN repozytorium (rejestr czytników,
// lista wyjątków, kod produkcyjny). Ten plik sprawdza NARZĘDZIE - i tylko na
// wejściach, których w repozytorium nie ma, żeby zmiana w kodzie produkcyjnym
// nie przewracała testów analizatora.
import { describe, expect, it } from "vitest";

import {
  auditServiceRoleTenantScope,
  exemptionKey,
  renderTenantScopeReport,
  rpcCalls,
  tableQueries,
  usesServiceRole,
  type ScannedSource,
} from "../serviceRoleTenantScope";

function src(source: string, file = "syntetyczny.server.ts"): ScannedSource {
  return { file, source };
}

describe("usesServiceRole", () => {
  it("widzi dynamiczny import klienta service-role", () => {
    expect(usesServiceRole('const { supabaseAdmin } = await import("@/x/client.server");')).toBe(
      true,
    );
  });

  it("nie liczy wzmianki w komentarzu", () => {
    // Inaczej każdy plik opisujący ten inwariant wchodziłby do rejestru.
    expect(usesServiceRole("// ten plik nie używa supabaseAdmin\nconst a = 1;")).toBe(false);
  });

  it("nie liczy klienta użytkownika", () => {
    expect(usesServiceRole('import { supabase } from "@/integrations/supabase/client";')).toBe(
      false,
    );
  });
});

describe("tableQueries - co jest zapytaniem do tabeli", () => {
  it("łapie zapytanie bez granicy najemcy", () => {
    const q = tableQueries(src('admin.from("posts").select("id").eq("status", "published");'));
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ table: "posts", verdict: "UNSCOPED", evidence: null });
  });

  it('uznaje `.eq("tenant_id", tenantId)` za granicę', () => {
    const q = tableQueries(src('admin.from("posts").select("id").eq("tenant_id", tenantId);'));
    expect(q[0].verdict).toBe("SCOPED");
    expect(q[0].evidence).toBe('.eq("tenant_id", tenantId)');
  });

  it("uznaje najemcę w ładunku insertu za granicę", () => {
    // `insert` nie ma czego filtrować - granicę wnosi zapisywana wartość.
    const q = tableQueries(src('admin.from("media").insert({ tenant_id: opts.tenantId });'));
    expect(q[0].verdict).toBe("SCOPED");
  });

  it('uznaje `.in("tenant_id", …)` i `.match({…})` za granicę', () => {
    expect(tableQueries(src('a.from("p").select().in("tenant_id", [tenantId]);'))[0].verdict).toBe(
      "SCOPED",
    );
    expect(
      tableQueries(src('a.from("p").select().match({ tenant_id: tenantId });'))[0].verdict,
    ).toBe("SCOPED");
  });

  it("ODRZUCA porównanie kolumny z samą sobą", () => {
    // `.eq("tenant_id", row.tenant_id)` wygląda jak filtr, a nie jest granicą:
    // porównuje wiersz z wartością, która z tego wiersza przyszła.
    const q = tableQueries(src('a.from("posts").select().eq("tenant_id", row.tenant_id);'));
    expect(q[0].verdict).toBe("UNSCOPED");
  });

  it("pomija kubełek storage - to nie tabela", () => {
    // `.storage.from("media")` nie ma kolumn i nie przyjmuje `.eq()`; zakres
    // najemcy realizuje tam prefiks ścieżki obiektu.
    const q = tableQueries(src('admin.storage.from("media").upload(path, buf);'));
    expect(q).toEqual([]);
  });

  it("nie pozwala łańcuchowi storage dostarczyć dowodu poprzedniemu zapytaniu", () => {
    // Ciało zapytania musi kończyć się na NASTĘPNYM `.from(`, także storage.
    const q = tableQueries(
      src(
        'a.from("posts").select("id");\nawait a.storage.from("media").remove([`${tenantId}/x`]);',
      ),
    );
    expect(q).toHaveLength(1);
    expect(q[0].verdict).toBe("UNSCOPED");
  });

  it("nie liczy zakomentowanego zapytania", () => {
    expect(tableQueries(src('// a.from("posts").select();'))).toEqual([]);
  });

  it("nie bierze filtru z komentarza jako dowodu", () => {
    const q = tableQueries(
      src('a.from("posts").select("id");\n// tu kiedyś było .eq("tenant_id", tenantId)'),
    );
    expect(q[0].verdict).toBe("UNSCOPED");
  });

  it("rozdziela dwa zapytania w jednym pliku i podaje numery linii", () => {
    const q = tableQueries(
      src('a.from("posts").select().eq("tenant_id", tenantId);\n\na.from("tags").select();'),
    );
    expect(q.map((x) => [x.table, x.line, x.verdict])).toEqual([
      ["posts", 1, "SCOPED"],
      ["tags", 3, "UNSCOPED"],
    ]);
  });
});

describe("rpcCalls", () => {
  it("odróżnia RPC z najemcą w argumentach od RPC bez", () => {
    const calls = rpcCalls(
      src('a.rpc("with_tenant", { p_tenant_id: tenantId });\na.rpc("bare", { _page_id: id });'),
    );
    expect(calls.map((c) => [c.fn, c.passesTenant])).toEqual([
      ["with_tenant", true],
      ["bare", false],
    ]);
  });
});

describe("auditServiceRoleTenantScope", () => {
  const bad = src('const { supabaseAdmin } = await import("x");\na.from("posts").select("id");');

  it("zgłasza lukę w pliku spod service-role", () => {
    const r = auditServiceRoleTenantScope([bad], {});
    expect(r.gaps).toEqual([{ file: "syntetyczny.server.ts", table: "posts", line: 2 }]);
    expect(renderTenantScopeReport(r)).toContain('from("posts") - brak granicy najemcy');
  });

  it("NIE zgląda do pliku bez service-role - tam granicę stawia RLS", () => {
    const r = auditServiceRoleTenantScope([src('a.from("posts").select("id");')], {});
    expect(r.serviceRoleFiles).toEqual([]);
    expect(r.analyzed).toBe(0);
  });

  it("wyjątek zdejmuje lukę i melduje się jako użyty", () => {
    const key = exemptionKey("syntetyczny.server.ts", "posts");
    const r = auditServiceRoleTenantScope([bad], { [key]: "uzasadnienie" });
    expect(r.gaps).toEqual([]);
    expect(r.usedExemptions).toEqual([key]);
  });

  it("wyjątek bez trafienia jest raportowany jako martwy", () => {
    const r = auditServiceRoleTenantScope([bad], {
      [exemptionKey("syntetyczny.server.ts", "posts")]: "uzasadnienie",
      [exemptionKey("inny.server.ts", "nieistniejaca")]: "wpis do usunięcia",
    });
    expect(r.staleExemptions).toEqual([exemptionKey("inny.server.ts", "nieistniejaca")]);
  });

  it("wyjątek dla zapytania, które MA filtr, jest raportowany jako zbędny", () => {
    const good = src(
      'const { supabaseAdmin } = await import("x");\na.from("posts").select().eq("tenant_id", tenantId);',
    );
    const key = exemptionKey("syntetyczny.server.ts", "posts");
    const r = auditServiceRoleTenantScope([good], { [key]: "już niepotrzebne" });
    expect(r.redundantExemptions).toEqual([key]);
    expect(r.gaps).toEqual([]);
  });

  it("liczy zapytania i te z granicą - podstawa kanarka zasięgu", () => {
    const mixed = src(
      'const { supabaseAdmin } = await import("x");\n' +
        'a.from("posts").select().eq("tenant_id", tenantId);\n' +
        'a.from("tags").select();',
    );
    const r = auditServiceRoleTenantScope([mixed], {
      [exemptionKey("syntetyczny.server.ts", "tags")]: "powód",
    });
    expect({ analyzed: r.analyzed, scoped: r.scoped }).toEqual({ analyzed: 2, scoped: 1 });
  });

  it("pusty raport nie generuje tekstu", () => {
    expect(renderTenantScopeReport(auditServiceRoleTenantScope([], {}))).toBe("");
  });
});
