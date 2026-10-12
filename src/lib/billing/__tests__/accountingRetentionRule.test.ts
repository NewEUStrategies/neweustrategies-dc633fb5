// Reguła retencji dowodów księgowych (INV-13) - decyzja zapisana w teście.
//
// Kryterium audytu: „decyzja doradcy podatkowego zapisana w kodzie i testach
// retencji". Decyzja (konserwatywna, do potwierdzenia przez doradcę): dowód
// żyje do 31.12 SZÓSTEGO roku po roku obrotowym - przedawnienie zobowiązania
// podatkowego (art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej) mija dla VAT
// za grudzień i CIT rocznego właśnie wtedy, rok PO terminie z art. 74 ust. 2
// ustawy o rachunkowości, który liczyła poprzednia reguła (R+5).
//
// Dwie warstwy dowodu:
//   * TS: `accountingRetentionUntil` - płatność ze stycznia i z grudnia tego
//     samego roku dostaje TEN SAM termin, granica roku w strefie siedziby;
//   * parzystość z SQL: NAJNOWSZA definicja `accounting_retention_until`
//     (migracje są forward-only) liczy tę samą liczbę lat w tej samej strefie,
//     oba triggery stemplujące i oba purge'e jej używają. Same daty w bazie
//     przybija pgTAP (`supabase/tests/accounting_retention_test.sql`).
import { describe, expect, it } from "vitest";
import { extractLatestDefinitions } from "../../../../scripts/lib/sqlMigrations";
import {
  ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR,
  ACCOUNTING_TIME_ZONE,
  accountingRetentionUntil,
} from "@/lib/billing/accountingRetentionRule";

const LATEST = extractLatestDefinitions();

function latestBody(key: string): string {
  const def = LATEST.get(key);
  expect(def, `brak definicji ${key}`).toBeDefined();
  return def!.body;
}

describe("accountingRetentionUntil - rok obrotowy + 6", () => {
  it("płatność ze stycznia: 31.12 szóstego roku po roku obrotowym", () => {
    expect(accountingRetentionUntil("2026-01-15T09:00:00Z")).toBe("2032-12-31");
  });

  it("płatność z grudnia (VAT płatny 25.01 roku następnego): ten sam termin, nie wcześniej", () => {
    // Przedawnienie VAT za grudzień 2026: termin płatności 25.01.2027,
    // 5 lat od końca 2027 = 31.12.2032. Reguła R+5 dawała 31.12.2031.
    expect(accountingRetentionUntil("2026-12-15T09:00:00Z")).toBe("2032-12-31");
    expect(accountingRetentionUntil("2026-12-15T09:00:00Z")).not.toBe("2031-12-31");
  });

  it("granica roku obrotowego leży w strefie siedziby, nie w UTC", () => {
    // 31.12, 23:30 w Warszawie (CET = UTC+1) to jeszcze rok 2026...
    expect(accountingRetentionUntil("2026-12-31T22:30:00Z")).toBe("2032-12-31");
    // ...a 23:30 UTC tego samego dnia to już 01.01.2027, 00:30 w Warszawie.
    expect(accountingRetentionUntil("2026-12-31T23:30:00Z")).toBe("2033-12-31");
  });

  it("przyjmuje Date, ISO i znacznik ms - ten sam wynik", () => {
    const at = Date.parse("2027-03-31T12:00:00Z");
    expect(accountingRetentionUntil(new Date(at))).toBe("2033-12-31");
    expect(accountingRetentionUntil(at)).toBe("2033-12-31");
    expect(accountingRetentionUntil("2027-03-31T12:00:00Z")).toBe("2033-12-31");
  });

  it("odrzuca datę, której nie da się odczytać (zamiast liczyć NaN-12-31)", () => {
    expect(() => accountingRetentionUntil("nie-data")).toThrow(RangeError);
  });

  it("nie schodzi poniżej minimum ustawy o rachunkowości (art. 74 ust. 2: R+5)", () => {
    expect(ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR).toBeGreaterThanOrEqual(5);
  });
});

describe("parzystość reguły TS <-> SQL", () => {
  it("accounting_retention_until liczy tę samą liczbę lat w tej samej strefie", () => {
    const body = latestBody("public.accounting_retention_until/1");
    const years = /make_date\([\s\S]*?\)::int\s*\+\s*(\d+)\s*,\s*12\s*,\s*31\s*\)/i.exec(body);
    expect(years, `nie rozpoznano reguły w ciele: ${body}`).not.toBeNull();
    expect(Number(years![1])).toBe(ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR);
    expect(body).toContain(`AT TIME ZONE '${ACCOUNTING_TIME_ZONE}'`);
  });

  it.each([
    "public.tg_payment_orders_stamp_retention/0",
    "public.tg_user_purchases_stamp_retention/0",
  ])("%s stempluje termin tą samą funkcją (brak drugiej reguły)", (key) => {
    expect(latestBody(key)).toMatch(/public\.accounting_retention_until\(/);
  });

  it.each(["public.purge_expired_payment_orders/0", "public.purge_expired_user_purchases/0"])(
    "%s nie ufa samemu stemplowi - sprawdza też regułę i retention_hold",
    (key) => {
      const body = latestBody(key);
      expect(body).toMatch(/public\.accounting_retention_until\(.*\)\s*<\s*current_date/);
      expect(body).toMatch(/retention_hold\s*=\s*false/);
    },
  );
});
