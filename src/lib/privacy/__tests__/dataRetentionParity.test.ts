// PARYTET RETENCJI DANYCH (I9c-X2, I9d-Y1): stałe TS
// (`src/lib/privacy/dataRetention.ts`, `newsletterSunset.ts`) ⇄ SQL.
//
// Rozjazd w jedną stronę: panel pozwala wybrać okres, którego CHECK bazy nie
// przyjmie (zapis odrzucony bez wyjaśnienia); w drugą - baza przyjmuje okres,
// którego panel nie umie pokazać, albo zadanie usuwa wpisy audytu, które
// panel opisuje jako „finansowe, jak dowody księgowe". Fragmenty SQL budowane
// są ze stałych TS i muszą wystąpić DOSŁOWNIE (po wycięciu komentarzy
// i sprowadzeniu białych znaków do zapisu kanonicznego).
//
// NAJNOWSZA DEFINICJA, NIE PLIK NA SZTYWNO (I9d-Y1). Dotąd test czytał
// migracje 161000/161100/161400 - po redefinicji katalogu, CHECK-ów i funkcji
// w nowszej migracji (20261020162200 i dalej) stare pliki nadal by przeszły,
// ale przestały dowodzić stanu bazy. Teraz każdy obiekt SQL (ograniczenie,
// funkcja, tabela) jest szukany we WSZYSTKICH migracjach i porównywany jest
// jego OSTATNI tekst w kolejności wersji - ta sama kolejność, w której replay
// i produkcja budują bazę. Asercja dotyczy wycinka definicji (ciała funkcji
// albo wyrażenia CHECK), nie całego pliku.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import {
  AUDIT_FINANCIAL_ACTION_PREFIXES,
  AUDIT_FINANCIAL_ENTITY_TYPES,
  DATA_RETENTION_EDITABLE_CATEGORIES,
  DATA_RETENTION_EXISTING,
  DATA_RETENTION_PERIODS,
  DATA_RETENTION_REDACTED,
  DATA_RETENTION_RULES,
  DATA_RETENTION_RUN_CATEGORIES,
  DATA_RETENTION_STATUTORY_CATEGORIES,
  isFinancialAuditEntry,
  isRetentionPeriodAllowed,
  normalizeExtensionReason,
  retentionPeriodOptions,
} from "../dataRetention";
import { dataRetentionKeys } from "../keys";

const DIR = "supabase/migrations";

const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),\][])\s*/g, "$1")
    .trim();

/** Wszystkie migracje w kolejności wersji (nazwa = 14 cyfr wersji + nazwa). */
const MIGRATIONS: readonly { file: string; sql: string }[] = readdirSync(DIR)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((file) => ({ file, sql: kanon(stripSqlComments(readFileSync(`${DIR}/${file}`, "utf8"))) }));

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Located {
  file: string;
  sql: string;
  index: number;
  length: number;
}

/** OSTATNIE wystąpienie znacznika w NAJNOWSZEJ migracji, która go zawiera. */
function locate(marker: RegExp, label: string): Located {
  for (let i = MIGRATIONS.length - 1; i >= 0; i -= 1) {
    const { file, sql } = MIGRATIONS[i];
    const last = [...sql.matchAll(new RegExp(marker.source, "g"))].at(-1);
    if (last?.index !== undefined) return { file, sql, index: last.index, length: last[0].length };
  }
  throw new Error(`${label}: brak definicji w migracjach`);
}

/** Najnowszy tekst obiektu: od znacznika do pierwszego wystąpienia końca. */
function newest(marker: RegExp, end: string, label: string): { file: string; text: string } {
  const at = locate(marker, label);
  const stop = at.sql.indexOf(end, at.index + at.length);
  expect(stop, `${label}: brak końca definicji w ${at.file}`).toBeGreaterThan(at.index);
  return { file: at.file, text: at.sql.slice(at.index, stop + end.length) };
}

/** Najnowsza definicja funkcji `public.<nazwa>(…)` - nagłówek i ciało `$$…$$`. */
function fn(name: string): string {
  const at = locate(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${escape(name)}\\(`),
    `funkcja ${name}`,
  );
  const open = at.sql.indexOf("$$", at.index);
  const close = at.sql.indexOf("$$", open + 2);
  expect(open, `funkcja ${name}: brak ciała w ${at.file}`).toBeGreaterThan(at.index);
  expect(close, `funkcja ${name}: niezamknięte ciało w ${at.file}`).toBeGreaterThan(open);
  return at.sql.slice(at.index, close + 2);
}

/** Wyrażenie najnowszego CHECK o tej nazwie (do podanego końca). */
function check(name: string, end: string): string {
  return newest(new RegExp(`${escape(name)} CHECK\\(`), end, `CHECK ${name}`).text;
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

describe("retencja danych - parytet TS ⇄ SQL (najnowsza definicja)", () => {
  it("wyszukiwanie najnowszej definicji: pliki w kolejności wersji, ostatni wygrywa", () => {
    expect(existsSync(DIR)).toBe(true);
    const versions = MIGRATIONS.map((m) => m.file.slice(0, 14));
    expect([...versions].sort()).toEqual(versions);
    // Katalog redefiniowany po I9c: najnowszy tekst NIE pochodzi z 161000.
    const catalog = newest(
      /CREATE(?: OR REPLACE)? FUNCTION public\._data_retention_catalog\(/,
      "$$;",
      "katalog",
    );
    expect(catalog.file > "20261020161000").toBe(true);
  });

  it("CHECK okresu w tabeli ustawień = zakresy TS (kategoria edytowalna i ustawowa)", () => {
    const sql = check("data_retention_settings_period_check", "ELSE false END)");
    for (const category of DATA_RETENTION_EDITABLE_CATEGORIES) {
      const { minMonths, maxMonths } = DATA_RETENTION_PERIODS[category];
      expect(sql, category).toContain(
        kanon(
          `WHEN '${category}' THEN period_months IS NOT NULL AND period_months BETWEEN ${minMonths} AND ${maxMonths}`,
        ),
      );
    }
    for (const category of DATA_RETENTION_STATUTORY_CATEGORIES) {
      expect(sql, category).toContain(
        kanon(`WHEN '${category}' THEN period_months IS NULL AND enabled`),
      );
    }
    // Żadnej kategorii spoza TS w CHECK (ELSE false zamyka listę).
    const whens = [...sql.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((m) => m[1]);
    expect(whens).toEqual([...DATA_RETENTION_RUN_CATEGORIES]);
  });

  it("listy kategorii w CHECK ustawień i dziennika przebiegów = kolejność TS", () => {
    for (const name of ["data_retention_settings_category_check", "data_retention_runs_category_check"]) {
      expect(check(name, "))"), name).toBe(
        kanon(`${name} CHECK (category IN (${lista(DATA_RETENTION_RUN_CATEGORIES)}))`),
      );
    }
  });

  it("katalog `_data_retention_catalog()` = wartości domyślne, zakresy, kolejność i reguły TS", () => {
    const sql = fn("_data_retention_catalog");
    for (const category of DATA_RETENTION_EDITABLE_CATEGORIES) {
      const rule = DATA_RETENTION_PERIODS[category];
      expect(sql, category).toContain(
        kanon(
          `jsonb_build_object('key', '${category}', 'default', ${rule.defaultMonths}, 'min', ${rule.minMonths}, 'max', ${rule.maxMonths}, 'editable', true)`,
        ),
      );
    }
    for (const category of DATA_RETENTION_STATUTORY_CATEGORIES) {
      expect(sql, category).toContain(
        kanon(
          `jsonb_build_object('key', '${category}', 'default', NULL, 'min', NULL, 'max', NULL, 'editable', false)`,
        ),
      );
    }
    const keys = [...sql.matchAll(/'key','([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...DATA_RETENTION_RUN_CATEGORIES]);
    const r = DATA_RETENTION_RULES;
    expect(sql).toContain(
      kanon(
        `'rules', jsonb_build_object('audit_network_months', ${r.auditNetworkMonths}, 'consent_proof_years', ${r.consentProofYears}, 'claims_limitation_years', ${r.claimsLimitationYears}, 'grace_days', ${r.graceDays}, 'postpone_max_days', ${r.postponeMaxDays}, 'crm_extension_months', ${r.crmExtensionMonths}, 'crm_notice_days', ${r.crmNoticeDays}, 'crm_extension_reason_min', ${r.crmExtensionReasonMin}, 'crm_extension_reason_max', ${r.crmExtensionReasonMax}, 'batch_default', ${r.batchDefault}, 'batch_max', ${r.batchMax}, 'newsletter_response_days', ${r.newsletterResponseDays}, 'newsletter_daily_cap', ${r.newsletterDailyCap}))`,
      ),
    );
  });

  it("karencja: nowy najemca i seed istniejących - te same 14 dni", () => {
    const r = DATA_RETENTION_RULES;
    expect(fn("_data_retention_effective")).toContain(
      kanon(`t.created_at + make_interval(days => ${r.graceDays})`),
    );
    // Seed każdej migracji katalogu (I9c dla 9 kategorii, I9d-Y1 dla 4 nowych).
    const seeds = MIGRATIONS.filter((m) =>
      m.sql.includes(
        kanon(
          "FROM public.tenants t CROSS JOIN jsonb_array_elements(public._data_retention_catalog() -> 'categories')",
        ),
      ),
    );
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    for (const seed of seeds) {
      expect(seed.sql, seed.file).toContain(kanon(`now() + interval '${r.graceDays} days'`));
    }
  });

  it("powód przedłużenia i wykluczenia: ten sam CHECK tabel co limit TS", () => {
    const r = DATA_RETENTION_RULES;
    const reason = kanon(
      `reason text NOT NULL CHECK (char_length(reason) BETWEEN ${r.crmExtensionReasonMin} AND ${r.crmExtensionReasonMax})`,
    );
    for (const table of ["data_retention_crm_extensions", "newsletter_sunset_exclusions"]) {
      const sql = newest(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\(`),
        ");",
        table,
      ).text;
      expect(sql, table).toContain(reason);
    }
  });

  it("stałe funkcji wykonawczych i panelu = reguły TS", () => {
    const r = DATA_RETENTION_RULES;
    expect(fn("_data_retention_audit_log")).toContain(
      `c_network_months constant integer := ${r.auditNetworkMonths}`,
    );
    expect(fn("_data_retention_consent_log")).toContain(
      `c_years constant integer := ${r.consentProofYears}`,
    );
    expect(fn("_data_retention_customer_until")).toContain(
      kanon(
        `EXTRACT(YEAR FROM (p_last_tx AT TIME ZONE 'Europe/Warsaw'))::int + ${r.claimsLimitationYears}`,
      ),
    );
    expect(fn("admin_data_retention_enforcement")).toContain(
      `c_postpone_max constant integer := ${r.postponeMaxDays}`,
    );
    expect(fn("admin_data_retention_crm_due")).toContain(
      `c_notice constant integer := ${r.crmNoticeDays}`,
    );
    const extend = fn("admin_data_retention_crm_extend");
    expect(extend).toContain(`c_months constant integer := ${r.crmExtensionMonths}`);
    for (const name of [
      "admin_data_retention_crm_extend",
      "admin_data_retention_newsletter_exclude",
      "admin_data_retention_newsletter_include",
    ]) {
      const sql = fn(name);
      expect(sql, name).toContain(`c_reason_min constant integer := ${r.crmExtensionReasonMin}`);
      expect(sql, name).toContain(`c_reason_max constant integer := ${r.crmExtensionReasonMax}`);
    }
  });

  it("wygaszanie newslettera: termin reakcji i dzienny limit próśb = reguły TS", () => {
    const r = DATA_RETENTION_RULES;
    for (const name of [
      "_data_retention_newsletter_inactive",
      "newsletter_sunset_claim",
      "admin_data_retention_newsletter_due",
    ]) {
      expect(fn(name), name).toContain(
        `c_response_days constant integer := ${r.newsletterResponseDays}`,
      );
    }
    for (const name of ["newsletter_sunset_claim", "admin_data_retention_newsletter_due"]) {
      expect(fn(name), name).toContain(`c_daily_cap constant integer := ${r.newsletterDailyCap}`);
    }
  });

  it("dyspozytor przebiegu i podgląd karty mają gałąź KAŻDEJ kategorii TS", () => {
    const run = fn("_data_retention_run_tenant");
    const preview = fn("admin_data_retention_preview");
    for (const category of DATA_RETENTION_RUN_CATEGORIES) {
      // Brak gałęzi = `NULL` w wyniku przebiegu (parser karty) i „wyłączona"
      // w podglądzie (pułapka 3 pakietu I9d-1).
      expect(run, category).toContain(`WHEN '${category}' THEN public._data_retention_`);
      expect(preview, category).toContain(`WHEN '${category}' THEN`);
    }
  });

  it("znacznik zredagowanej wartości = stała TS", () => {
    expect(fn("_data_retention_event_attendees")).toContain(
      `c_redacted constant text := '${DATA_RETENTION_REDACTED}'`,
    );
  });

  it("wpis audytu operacji finansowej: te same prefiksy akcji i typy encji", () => {
    const sql = fn("_data_retention_audit_is_financial");
    expect(sql).toContain(
      kanon(`LIKE ANY (ARRAY[${lista(AUDIT_FINANCIAL_ACTION_PREFIXES.map((p) => `${p}%`))}])`),
    );
    expect(sql).toContain(kanon(`= ANY (ARRAY[${lista(AUDIT_FINANCIAL_ENTITY_TYPES)}])`));
  });

  it("okresy ustalone w innych modułach nadal stoją w swoich migracjach", () => {
    const files = readdirSync(DIR);
    for (const item of DATA_RETENTION_EXISTING) {
      if (item.source === null) {
        expect(item.periodLiteral, item.key).toBeNull();
        continue;
      }
      const file = files.find((name) => name.startsWith(item.source as string));
      expect(file, item.key).toBeDefined();
      const sql = readFileSync(`${DIR}/${file}`, "utf8");
      expect(sql, item.key).toContain(item.periodLiteral);
      if (item.mechanism) expect(sql, item.key).toContain(`FUNCTION public.${item.mechanism}(`);
    }
  });
});

describe("retencja danych - reguły TS", () => {
  it("okres spoza zakresu jest odrzucany, nie przycinany; opcje listy = cały zakres", () => {
    expect(isRetentionPeriodAllowed("paywall_metering", 13)).toBe(true);
    expect(isRetentionPeriodAllowed("paywall_metering", 2)).toBe(false);
    expect(isRetentionPeriodAllowed("paywall_metering", 26)).toBe(false);
    expect(isRetentionPeriodAllowed("audit_log", 12.5)).toBe(false);
    expect(retentionPeriodOptions("email_send_log")).toEqual(
      Array.from({ length: 25 - 6 + 1 }, (_, i) => 6 + i),
    );
    // I9d-Y1: odczyty licznika 2-13 (minimum chroni bieżący okres licznika).
    expect(isRetentionPeriodAllowed("metered_views", 1)).toBe(false);
    expect(isRetentionPeriodAllowed("metered_views", 3)).toBe(true);
    expect(isRetentionPeriodAllowed("newsletter_inactive", 25)).toBe(false);
    for (const category of DATA_RETENTION_EDITABLE_CATEGORIES) {
      const rule = DATA_RETENTION_PERIODS[category];
      expect(isRetentionPeriodAllowed(category, rule.defaultMonths), category).toBe(true);
    }
  });

  it("powód przedłużenia: punkty kodowe jak `char_length`, za długi odrzucony", () => {
    expect(normalizeExtensionReason("  ok  ")).toBeNull();
    expect(normalizeExtensionReason("  Umowa ramowa w toku  ")).toBe("Umowa ramowa w toku");
    // 500 emoji = 500 znaków w bazie (1000 jednostek UTF-16) - przechodzi.
    expect(normalizeExtensionReason("😀".repeat(500))).toBe("😀".repeat(500));
    expect(normalizeExtensionReason("a".repeat(501))).toBeNull();
  });

  it("operacja finansowa w audycie: prefiks akcji albo typ encji", () => {
    expect(isFinancialAuditEntry("membership.manual_grant", "membership_grant")).toBe(true);
    expect(isFinancialAuditEntry("event.invoice.collective_issued", "crm_company")).toBe(true);
    expect(isFinancialAuditEntry("post.update", "post")).toBe(false);
    expect(
      isFinancialAuditEntry("data_retention.settings_changed", "data_retention_settings"),
    ).toBe(false);
  });

  it("klucze karty: wszystko pod prefiksem najemcy (jedna inwalidacja szyny)", () => {
    const tenant = dataRetentionKeys.tenant("t1");
    for (const key of [
      dataRetentionKeys.settings("t1"),
      dataRetentionKeys.preview("t1"),
      dataRetentionKeys.crmDue("t1"),
      dataRetentionKeys.newsletterDue("t1"),
      dataRetentionKeys.newsletterCopy("t1"),
    ]) {
      expect(key.slice(0, tenant.length)).toEqual([...tenant]);
    }
    expect(tenant.slice(0, 2)).toEqual([...dataRetentionKeys.root()]);
  });
});
