// Bramka CI: złączenia `crm_funnel_view` są zakotwiczone w najemcy SUBSKRYBENTA.
//
// PO CO. Lejek marketingowy (`src/lib/crm-funnel.functions.ts`) czyta widok
// spod SERVICE-ROLE z jednym filtrem `.eq("tenant_id", <najemca z sesji>)`.
// Ten filtr zawęża WIERSZE (`s.tenant_id`), ale flagi `is_registered`
// / `is_contact`, awatar i etap kontaktu pochodzą ze złączeń z `profiles`
// i `crm_leads`. Pod service-role RLS nie istnieje, więc jedyną granicą
// najemcy tych złączeń są predykaty `p.tenant_id = s.tenant_id`
// i `c.tenant_id = s.tenant_id` w definicji widoku. Bez nich subskrybent
// najemcy A z adresem, pod którym w najemcy B istnieje profil albo lead,
// dostałby awatar, flagę rejestracji i etap kontaktu z CUDZEGO najemcy.
//
// Migracje są forward-only, więc liczy się OSTATNIA definicja widoku - jedno
// przyszłe `CREATE OR REPLACE VIEW` bez kotwic cofnęłoby granicę bez śladu
// w diffie kodu lejka. Ta bramka czyta stan końcowy z `supabase/migrations`
// (bez bazy); stan produkcji sprawdza zapytanie właściciela (4) z kolumnami
// `profiles_join_tenant_anchored` i `leads_join_tenant_anchored`.
import { describe, expect, it } from "vitest";

import { loadMigrationFiles } from "../../../../scripts/lib/sqlMigrations";

const VIEW = "crm_funnel_view";

interface ViewStatement {
  readonly file: string;
  readonly kind: "create" | "drop";
  readonly sql: string;
}

/** Wszystkie `CREATE [OR REPLACE] VIEW` i `DROP VIEW` widoku, w kolejności migracji. */
function viewStatements(): ViewStatement[] {
  const out: ViewStatement[] = [];
  const re = new RegExp(
    String.raw`\b(CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?)\s*(?:public\.)?"?${VIEW}"?\b[^;]*;`,
    "gi",
  );
  for (const { file, sql } of loadMigrationFiles()) {
    for (const m of sql.matchAll(re)) {
      out.push({
        file,
        kind: /^DROP/i.test(m[1]) ? "drop" : "create",
        sql: m[0].replace(/\s+/g, " "),
      });
    }
  }
  return out;
}

/**
 * Klauzula złączenia z tabelą (`JOIN public.<tabela> <alias> ON ...`) - tekst
 * od `JOIN` do następnego `JOIN`, `WHERE` albo końca instrukcji.
 */
function joinClause(sql: string, table: string, alias: string): string | null {
  const re = new RegExp(
    String.raw`\bJOIN\s+(?:public\.)?${table}\s+(?:AS\s+)?${alias}\s+ON\b(.*?)(?=\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+|CROSS\s+)?JOIN\b|\bWHERE\b|\bGROUP\s+BY\b|;)`,
    "i",
  );
  return re.exec(sql)?.[1] ?? null;
}

function finalDefinition(): ViewStatement {
  const statements = viewStatements();
  const last = statements.at(-1);
  expect(last, `brak definicji public.${VIEW} w migracjach`).toBeDefined();
  // Widok usunięty i nieodtworzony to inny problem (lejek pada na 42P01), ale
  // też koniec tej granicy - bramka ma to powiedzieć wprost.
  expect(last?.kind, `ostatnia instrukcja o ${VIEW} to DROP (${last?.file})`).toBe("create");
  return last!;
}

describe(`${VIEW} - złączenia zakotwiczone w najemcy subskrybenta (stan końcowy migracji)`, () => {
  it("bazą widoku są subskrybenci (`newsletter_subscribers s`) z kolumną `s.tenant_id`", () => {
    const { sql } = finalDefinition();
    expect(sql).toMatch(/\bFROM\s+(?:public\.)?newsletter_subscribers\s+(?:AS\s+)?s\b/i);
    expect(sql).toMatch(/\bs\.tenant_id\b/i);
  });

  it("złączenie z `profiles` niesie `p.tenant_id = s.tenant_id`", () => {
    const { sql, file } = finalDefinition();
    const clause = joinClause(sql, "profiles", "p");
    expect(clause, `brak złączenia z profiles w ${file}`).not.toBeNull();
    expect(clause).toMatch(/\bp\.tenant_id\s*=\s*s\.tenant_id\b/i);
  });

  it("złączenie z `crm_leads` niesie `c.tenant_id = s.tenant_id`", () => {
    const { sql, file } = finalDefinition();
    const clause = joinClause(sql, "crm_leads", "c");
    expect(clause, `brak złączenia z crm_leads w ${file}`).not.toBeNull();
    expect(clause).toMatch(/\bc\.tenant_id\s*=\s*s\.tenant_id\b/i);
  });

  it("kontrola wykrywania: definicja bez kotwic jest czerwona", () => {
    // Bez tej kontroli dwa testy wyżej mogłyby przechodzić dlatego, że
    // `joinClause` łapie za dużo (np. całą resztę instrukcji z kotwicą
    // drugiego złączenia).
    const unanchored =
      "CREATE OR REPLACE VIEW public.crm_funnel_view AS SELECT s.id FROM public.newsletter_subscribers s " +
      "LEFT JOIN public.profiles p ON lower(p.email) = lower(s.email) " +
      "LEFT JOIN public.crm_leads c ON c.tenant_id = s.tenant_id AND c.email_norm = lower(s.email);";
    expect(joinClause(unanchored, "profiles", "p")).not.toMatch(/p\.tenant_id\s*=\s*s\.tenant_id/i);
    expect(joinClause(unanchored, "crm_leads", "c")).toMatch(/c\.tenant_id\s*=\s*s\.tenant_id/i);
  });
});
