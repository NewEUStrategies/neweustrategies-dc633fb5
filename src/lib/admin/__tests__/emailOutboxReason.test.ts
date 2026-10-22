// Etykiety powodów Skrzynki wysyłek (I9, Z-I9c-02) - parytet z kodami, które
// piszą TS (bramka blokad, anulowanie przy usunięciu konta) i SQL
// (`email_queue_send_recheck`, `_journey_marketing_consent` - NAJNOWSZE
// definicje z migracji), oraz ze słownikiem PL/EN.
//
// PO CO. Nowy kod pominięcia w bazie albo nowy powód wyjścia z zapisu bez
// etykiety pokazałby w panelu surowy napis - redakcja znów nie wiedziałaby,
// czy to awaria, czy zamierzone zatrzymanie.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-email-outbox";
import { extractLatestDefinitions } from "../../../../scripts/lib/sqlMigrations";
import {
  OUTBOX_EXIT_REASONS,
  OUTBOX_SKIP_CODES,
  OUTBOX_SUPPRESSION_REASONS,
  outboxReasonKey,
} from "@/lib/admin/emailOutboxReason";
import { JOURNEY_EXIT_REASONS } from "@/lib/journeys/limits";
import {
  ACCOUNT_DELETED_CANCEL_REASON,
  suppressionSkipReason,
} from "@/lib/email/suppressionPolicy";

const LATEST = extractLatestDefinitions();

function body(key: string): string {
  const def = LATEST.get(key);
  expect(def, `brak definicji ${key}`).toBeDefined();
  return def!.body;
}

const exists = (lang: "pl" | "en", key: string) =>
  i18n.exists(key, { lng: lang, fallbackLng: false });

describe("outboxReasonKey - kody z TS", () => {
  it.each(OUTBOX_SUPPRESSION_REASONS)("suppressed:%s ma etykietę", (reason) => {
    expect(outboxReasonKey(suppressionSkipReason(reason))).toBe(
      `adminOutbox.reason.suppressed.${reason}`,
    );
  });

  it("goła blokada i blokada kampanii bez powodu - etykieta ogólna", () => {
    expect(outboxReasonKey("suppressed")).toBe("adminOutbox.reason.suppressed.generic");
    expect(outboxReasonKey("suppressed:unknown")).toBe("adminOutbox.reason.suppressed.generic");
  });

  it("anulowanie przy usunięciu konta (stała wspólna z SQL)", () => {
    expect(outboxReasonKey(ACCOUNT_DELETED_CANCEL_REASON)).toBe(
      "adminOutbox.reason.cancelledAccountDeleted",
    );
  });

  it("każdy powód wyjścia z zapisu (JOURNEY_EXIT_REASONS) ma etykietę - i nic ponad", () => {
    expect([...OUTBOX_EXIT_REASONS].sort()).toEqual([...JOURNEY_EXIT_REASONS].sort());
    for (const reason of JOURNEY_EXIT_REASONS) {
      expect(outboxReasonKey(`skipped:exited:${reason}`)).toBe(
        `adminOutbox.reason.exited.${reason}`,
      );
    }
    expect(outboxReasonKey("skipped:exited:unknown")).toBe("adminOutbox.reason.exited.unknown");
  });

  it.each([
    null,
    undefined,
    "",
    "  ",
    "rate_limited",
    "http_503",
    "suppressed:nowy_powod",
    "skipped:exited:nowy",
    "skipped:nowy",
  ])("kod bez etykiety (%s) daje null - panel pokazuje go surowo", (code) => {
    expect(outboxReasonKey(code)).toBeNull();
  });
});

describe("outboxReasonKey - kody z SQL (najnowsze definicje)", () => {
  it("każdy literał `skipped:<kod>` werdyktu email_queue_send_recheck ma etykietę", () => {
    const sql = body("public.email_queue_send_recheck/2");
    const literals = [...sql.matchAll(/'skipped:([a-z_]+)'/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(0);
    for (const code of literals) {
      expect(outboxReasonKey(`skipped:${code}`), `skipped:${code}`).not.toBeNull();
    }
    // Prefiksy składane w SQL: wyjście z zapisu i werdykt zgody.
    expect(sql).toContain("'skipped:exited:'");
    expect(sql).toContain("'skipped:'");
  });

  it("każdy werdykt _journey_marketing_consent poza `ok` ma etykietę `skipped:<werdykt>`", () => {
    const sql = body("public._journey_marketing_consent/2");
    const verdicts = new Set([...sql.matchAll(/RETURN\s+'([a-z_]+)'/g)].map((m) => m[1]));
    verdicts.delete("ok");
    expect(verdicts.size).toBeGreaterThan(0);
    for (const verdict of verdicts) {
      expect(OUTBOX_SKIP_CODES as readonly string[]).toContain(verdict);
    }
  });
});

describe("słownik adminOutbox.reason - parytet PL/EN", () => {
  const keys = [
    "adminOutbox.reason.suppressed.generic",
    "adminOutbox.reason.cancelledAccountDeleted",
    "adminOutbox.reason.exited.unknown",
    ...OUTBOX_SUPPRESSION_REASONS.map((r) => `adminOutbox.reason.suppressed.${r}`),
    ...OUTBOX_EXIT_REASONS.map((r) => `adminOutbox.reason.exited.${r}`),
    ...OUTBOX_SKIP_CODES.map((r) => `adminOutbox.reason.skipped.${r}`),
  ];

  it.each(["pl", "en"] as const)("%s: każdy klucz zwracany przez mapę istnieje", (lang) => {
    for (const key of keys) expect(exists(lang, key), `${lang} ${key}`).toBe(true);
  });

  it("napisy PL i EN się różnią (nie ma nieprzetłumaczonych)", () => {
    for (const key of keys) {
      expect(i18n.t(key, { lng: "pl" }), key).not.toBe(i18n.t(key, { lng: "en" }));
    }
  });
});
