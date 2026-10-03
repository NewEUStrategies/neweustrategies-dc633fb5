// Bramka CI: cele @wzmianek NIE wystawiają kartoteki CRM.
//
// DEFEKT (20260922080000_mention_targets_rpc.sql). `search_mention_targets`
// - SECURITY DEFINER z EXECUTE dla `anon` - oddawała w CTE `companies` każdy
// wiersz `crm_companies` najemcy po dwóch literach frazy, a fraza szła do
// `LIKE` bez ucieczki (`'%%'` zrzucało katalog jednym wywołaniem). Anonim
// zbierał nazwy, logo, strony, branże i UUID prospektów oraz firm z leadów;
// UUID otwierał dodatkowo `get_mention_target` i stronę /organization/org-<uuid>.
//
// Naprawa (20261003150000) to JEDNA reguła: firma jest celem wzmianki tylko
// z publicznym śladem (`_mention_public_company_ids`). Reguła siedzi w ciele
// funkcji, więc jedno przyszłe `CREATE OR REPLACE` potrafi ją cofnąć bez śladu
// w diffie czegokolwiek obok - a migracje są forward-only, liczy się OSTATNIA
// definicja. Ta bramka czyta stan końcowy (bez bazy) i pilnuje:
//   1. każde odwołanie do `crm_companies` w obu RPC stoi w tym samym zakresie
//      (CTE albo gałęzi UNION) co wywołanie pomocnika śladu;
//   2. fraza wołającego nie trafia do LIKE/ILIKE/SIMILAR TO;
//   3. pomocnik liczy ślad TYMI predykatami, co polityki publicznego odczytu
//      wpisów i sponsorów, i jest SECURITY INVOKER;
//   4. końcowy stan grantów: RPC wołalne przez anon/authenticated (podpowiedzi
//      osób dla gości), pomocnik - nie.
// Zachowanie na prawdziwej bazie pilnuje pgTAP:
// supabase/tests/mention_targets_public_footprint_test.sql.
import { describe, expect, it } from "vitest";

import {
  extractLatestDefinitions,
  loadMigrationFiles,
  type FnDef,
} from "../../../../scripts/lib/sqlMigrations";

const LATEST = extractLatestDefinitions();
const FILES = loadMigrationFiles();

const SEARCH = "search_mention_targets";
const GET = "get_mention_target";
const FOOTPRINT = "_mention_public_company_ids";

function latest(name: string, arity: number): FnDef {
  const def = LATEST.get(`public.${name}/${arity}`);
  expect(def, `brak funkcji public.${name}/${arity} w migracjach`).toBeDefined();
  return def!;
}

/**
 * Zakres, w którym stoi odwołanie: blok CTE (nawias na głębokości 1) albo -
 * dla odwołania na poziomie zewnętrznym - gałąź między `UNION [ALL]`. Właśnie
 * w tym zakresie musi stać bramka śladu: warunek w innym CTE nie zawęża
 * wierszy tego, który czyta kartotekę.
 */
function enclosingScope(body: string, index: number): string {
  const depthAt: number[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    depthAt.push(depth);
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") depth -= 1;
  }
  if (depthAt[index] === 0) {
    const unionRe = /\bUNION(?:\s+ALL)?\b/gi;
    let start = 0;
    let end = body.length;
    let match: RegExpExecArray | null;
    while ((match = unionRe.exec(body)) !== null) {
      if (depthAt[match.index] !== 0) continue;
      if (match.index < index) start = match.index + match[0].length;
      else {
        end = match.index;
        break;
      }
    }
    return body.slice(start, end);
  }
  let open = index;
  while (open > 0 && !(body[open] === "(" && depthAt[open] === 0)) open -= 1;
  let close = index;
  while (close < body.length && !(body[close] === ")" && depthAt[close] === 1)) close += 1;
  return body.slice(open, close + 1);
}

/** Zakresy wszystkich odwołań do kartoteki w ciele funkcji. */
function crmScopes(body: string): string[] {
  return [...body.matchAll(/\bcrm_companies\b/gi)].map((m) => enclosingScope(body, m.index));
}

type Role = "public" | "anon" | "authenticated" | "service_role";
const ROLES: readonly Role[] = ["public", "anon", "authenticated", "service_role"];

function arityOf(signature: string): number {
  return signature.trim() === "" ? 0 : signature.split(",").length;
}

/** Arność deklaracji `CREATE FUNCTION f(` - parametry mogą mieć domyślne
 *  wartości z nawiasami, więc liczymy przecinki na głębokości zero. */
function declaredArity(sql: string, afterOpenParen: number): number {
  let depth = 1;
  let commas = 0;
  let sawArg = false;
  for (let i = afterOpenParen; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === "," && depth === 1) commas += 1;
    if (!/\s/.test(ch)) sawArg = true;
  }
  return sawArg ? commas + 1 : 0;
}

function rolesOf(list: string): Role[] {
  return list
    .split(",")
    .map((role) => role.replace(/"/g, "").trim().toLowerCase())
    .filter((role): role is Role => (ROLES as readonly string[]).includes(role));
}

/**
 * Końcowy stan EXECUTE funkcji po wszystkich migracjach. Nowa funkcja startuje
 * z najszerszym stanem, jaki daje platforma (PUBLIC + domyślne uprawnienia
 * Supabase dla anon/authenticated/service_role - patrz 20261002140000), więc
 * bramka przechodzi wyłącznie przy JAWNYM odebraniu. `CREATE OR REPLACE`
 * istniejącej funkcji zachowuje ACL, `DROP FUNCTION` je kasuje.
 */
function finalExecute(name: string, arity: number): Record<Role, boolean> {
  const state: Record<Role, boolean> = {
    public: false,
    anon: false,
    authenticated: false,
    service_role: false,
  };
  let exists = false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const { sql } of FILES) {
    const events: { index: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(
      new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${esc}\\s*\\(`, "gi"),
    )) {
      if (declaredArity(sql, m.index + m[0].length) !== arity) continue;
      events.push({
        index: m.index,
        apply: () => {
          if (exists) return;
          exists = true;
          for (const role of ROLES) state[role] = true;
        },
      });
    }
    for (const m of sql.matchAll(
      new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?public\\.${esc}\\s*\\(([^)]*)\\)`, "gi"),
    )) {
      if (arityOf(m[1]) !== arity) continue;
      events.push({
        index: m.index,
        apply: () => {
          exists = false;
          for (const role of ROLES) state[role] = false;
        },
      });
    }
    for (const m of sql.matchAll(
      new RegExp(
        `\\b(GRANT|REVOKE)\\s+(?:EXECUTE|ALL(?:\\s+PRIVILEGES)?)\\s+ON\\s+FUNCTION\\s+public\\.${esc}\\s*\\(([^)]*)\\)\\s+(?:TO|FROM)\\s+([^;]+);`,
        "gi",
      ),
    )) {
      if (arityOf(m[2]) !== arity) continue;
      const grant = m[1].toUpperCase() === "GRANT";
      const roles = rolesOf(m[3]);
      events.push({
        index: m.index,
        apply: () => {
          for (const role of roles) state[role] = grant;
        },
      });
    }
    events.sort((a, b) => a.index - b.index).forEach((event) => event.apply());
  }
  return state;
}

/** Czy rola realnie wykona funkcję (własny grant albo grant dla PUBLIC). */
function canExecute(state: Record<Role, boolean>, role: Exclude<Role, "public">): boolean {
  return state[role] || state.public;
}

describe("cele @wzmianek: stan końcowy migracji nie wystawia kartoteki CRM", () => {
  const search = latest(SEARCH, 2);
  const get = latest(GET, 1);
  const footprint = latest(FOOTPRINT, 1);

  it.each([
    [SEARCH, search],
    [GET, get],
  ])("%s czyta kartotekę wyłącznie przez bramkę śladu publicznego", (_name, def) => {
    const scopes = crmScopes(def.body);
    expect(scopes.length, `${def.file}: funkcja przestała czytać firmy?`).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(
        scope,
        `${def.file}: odwołanie do crm_companies bez ${FOOTPRINT}() w tym samym zakresie. ` +
          "To jest dokładnie defekt z 20260922080000: anonim wylicza całą kartotekę " +
          "(prospekty, firmy z leadów) po dwóch literach albo otwiera kartę firmy po UUID.",
      ).toMatch(new RegExp(`\\b${FOOTPRINT}\\s*\\(`, "i"));
    }
  });

  it("search_mention_targets nie używa frazy jako wzorca LIKE", () => {
    expect(
      search.body,
      `${search.file}: LIKE/ILIKE/SIMILAR TO z frazą wołającego - '%%' znów pasuje do każdej nazwy`,
    ).not.toMatch(/\b(?:I?LIKE|SIMILAR\s+TO)\b/i);
    expect(search.body).toMatch(/\bstrpos\s*\(/i);
  });

  it("obie funkcje zostają SECURITY DEFINER z jawnym search_path", () => {
    for (const def of [search, get]) {
      expect(def.attrs).toMatch(/SECURITY\s+DEFINER/i);
      expect(def.attrs).toMatch(/SET\s+search_path\s*=\s*public\b/i);
    }
  });

  it("pomocnik liczy ślad predykatami publicznego odczytu wpisów i sponsorów", () => {
    const body = footprint.body.replace(/\s+/g, " ");
    // Wpis: polityka „Public reads published posts".
    expect(body).toMatch(/p\.organization_id/i);
    expect(body).toMatch(/p\.tenant_id = _tenant/i);
    expect(body).toMatch(/p\.status = 'published'/i);
    expect(body).toMatch(/p\.deleted_at IS NULL/i);
    // Sponsor: polityka `event_sponsors_public_read`.
    expect(body).toMatch(/s\.tenant_id = _tenant/i);
    expect(body).toMatch(/s\.is_published/i);
    expect(body).toMatch(/e\.status = 'published'/i);
    expect(body).toMatch(/e\.tenant_id = s\.tenant_id/i);
    // Wąsko: kartoteki pomocnik nie czyta wcale - oddaje identyfikatory.
    expect(body).not.toMatch(/\bcrm_companies\b/i);
  });

  it("pomocnik jest SECURITY INVOKER", () => {
    expect(footprint.attrs).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("granty: RPC dla anon/authenticated, pomocnik bez EXECUTE dla klientów", () => {
    const searchAcl = finalExecute(SEARCH, 2);
    const getAcl = finalExecute(GET, 1);
    const footprintAcl = finalExecute(FOOTPRINT, 1);

    expect(canExecute(searchAcl, "anon")).toBe(true);
    expect(canExecute(searchAcl, "authenticated")).toBe(true);
    expect(canExecute(getAcl, "anon")).toBe(true);
    expect(canExecute(getAcl, "authenticated")).toBe(true);

    expect(canExecute(footprintAcl, "anon"), `${FOOTPRINT}: anon ma EXECUTE`).toBe(false);
    expect(
      canExecute(footprintAcl, "authenticated"),
      `${FOOTPRINT}: authenticated ma EXECUTE`,
    ).toBe(false);
  });
});

describe("self-test parserów bramki", () => {
  it("zakres CTE: warunek w innym CTE nie liczy się jako bramka", () => {
    const body =
      "WITH pub AS (SELECT _mention_public_company_ids(t) FROM x), " +
      "companies AS (SELECT c.id FROM public.crm_companies c WHERE c.tenant_id = t) " +
      "SELECT * FROM companies";
    const [scope] = crmScopes(body);
    expect(scope).toContain("crm_companies");
    expect(scope).not.toMatch(/_mention_public_company_ids/);
  });

  it("zakres zewnętrzny: gałąź UNION ALL z bramką przechodzi, bez bramki - nie", () => {
    const gated =
      "SELECT 1 FROM profiles UNION ALL SELECT c.id FROM public.crm_companies c " +
      "WHERE EXISTS (SELECT 1 FROM public._mention_public_company_ids(t) pub WHERE pub.company_id = c.id)";
    expect(crmScopes(gated)[0]).toMatch(/_mention_public_company_ids/);

    const ungated =
      "SELECT c.id FROM public.crm_companies c WHERE c.tenant_id = t " +
      "UNION ALL SELECT x FROM public._mention_public_company_ids(t) x";
    expect(crmScopes(ungated)[0]).not.toMatch(/_mention_public_company_ids/);
  });

  it("odtworzenie grantów: REVOKE FROM PUBLIC nie odbiera EXECUTE roli anon", () => {
    // Doktryna 20261002140000: domyślne uprawnienia platformy nadają EXECUTE
    // roli anon wprost, więc samo `REVOKE ... FROM PUBLIC` zostawia anonimowi
    // wywołanie. Model w `finalExecute` musi to odwzorować.
    const acl = finalExecute(SEARCH, 2);
    expect(acl.public).toBe(false);
    expect(acl.anon).toBe(true);
  });
});
