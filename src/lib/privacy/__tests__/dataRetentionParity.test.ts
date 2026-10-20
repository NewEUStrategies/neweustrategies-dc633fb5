// PARYTET RETENCJI DANYCH (I9c-X2): stałe TS (`src/lib/privacy/dataRetention.ts`)
// ⇄ SQL (migracje 20261020161000-161400).
//
// Rozjazd w jedną stronę: panel pozwala wybrać okres, którego CHECK bazy nie
// przyjmie (zapis odrzucony bez wyjaśnienia); w drugą - baza przyjmuje okres,
// którego panel nie umie pokazać, albo zadanie usuwa wpisy audytu, które
// panel opisuje jako „finansowe, jak dowody księgowe". Fragmenty SQL budowane
// są ze stałych TS i muszą wystąpić w migracjach DOSŁOWNIE (po wycięciu
// komentarzy i sprowadzeniu białych znaków do zapisu kanonicznego).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlComments } from "@/lib/ci/ownership";
import {
  AUDIT_FINANCIAL_ACTION_PREFIXES,
  AUDIT_FINANCIAL_ENTITY_TYPES,
  DATA_RETENTION_EDITABLE_CATEGORIES,
  DATA_RETENTION_EXISTING,
  DATA_RETENTION_PERIODS,
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
const CORE = `${DIR}/20261020161000_data_retention_core.sql`;
const EXECUTOR = `${DIR}/20261020161100_data_retention_executor.sql`;
const PANEL = `${DIR}/20261020161400_data_retention_panel.sql`;

const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),\][])\s*/g, "$1")
    .trim();

function migracja(path: string): string {
  expect(existsSync(path), `brak migracji: ${path}`).toBe(true);
  return kanon(stripSqlComments(readFileSync(path, "utf8")));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

describe("retencja danych - parytet TS ⇄ SQL", () => {
  it("CHECK okresu w tabeli ustawień = zakresy TS (kategoria edytowalna i ustawowa)", () => {
    const sql = migracja(CORE);
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
    expect(sql).toContain(kanon(`CHECK (category IN (${lista(DATA_RETENTION_RUN_CATEGORIES)}))`));
  });

  it("katalog `_data_retention_catalog()` = wartości domyślne, zakresy i reguły TS", () => {
    const sql = migracja(CORE);
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
    const r = DATA_RETENTION_RULES;
    expect(sql).toContain(
      kanon(
        `'audit_network_months', ${r.auditNetworkMonths}, 'consent_proof_years', ${r.consentProofYears}, 'claims_limitation_years', ${r.claimsLimitationYears}, 'grace_days', ${r.graceDays}, 'postpone_max_days', ${r.postponeMaxDays}, 'crm_extension_months', ${r.crmExtensionMonths}, 'crm_notice_days', ${r.crmNoticeDays}, 'crm_extension_reason_min', ${r.crmExtensionReasonMin}, 'crm_extension_reason_max', ${r.crmExtensionReasonMax}, 'batch_default', ${r.batchDefault}, 'batch_max', ${r.batchMax}`,
      ),
    );
    // Karencja nowego najemcy i wiersze istniejących - te same 14 dni.
    expect(sql).toContain(kanon(`t.created_at + make_interval(days => ${r.graceDays})`));
    expect(sql).toContain(kanon(`now() + interval '${r.graceDays} days'`));
    expect(sql).toContain(
      kanon(
        `CHECK (char_length(reason) BETWEEN ${r.crmExtensionReasonMin} AND ${r.crmExtensionReasonMax})`,
      ),
    );
  });

  it("stałe funkcji wykonawczych i panelu = reguły TS", () => {
    const executor = migracja(EXECUTOR);
    const panel = migracja(PANEL);
    const r = DATA_RETENTION_RULES;
    expect(executor).toContain(`c_network_months constant integer := ${r.auditNetworkMonths}`);
    expect(executor).toContain(`c_years constant integer := ${r.consentProofYears}`);
    expect(executor).toContain(
      kanon(
        `EXTRACT(YEAR FROM (p_last_tx AT TIME ZONE 'Europe/Warsaw'))::int + ${r.claimsLimitationYears}`,
      ),
    );
    expect(panel).toContain(`c_postpone_max constant integer := ${r.postponeMaxDays}`);
    expect(panel).toContain(`c_notice constant integer := ${r.crmNoticeDays}`);
    expect(panel).toContain(`c_months constant integer := ${r.crmExtensionMonths}`);
    expect(panel).toContain(`c_reason_min constant integer := ${r.crmExtensionReasonMin}`);
    expect(panel).toContain(`c_reason_max constant integer := ${r.crmExtensionReasonMax}`);
  });

  it("wpis audytu operacji finansowej: te same prefiksy akcji i typy encji", () => {
    const sql = migracja(EXECUTOR);
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
    ]) {
      expect(key.slice(0, tenant.length)).toEqual([...tenant]);
    }
    expect(tenant.slice(0, 2)).toEqual([...dataRetentionKeys.root()]);
  });
});
