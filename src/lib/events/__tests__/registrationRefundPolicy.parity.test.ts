// Parzystość polityki zleceń zwrotu: panel (TS) i baza (SQL) mówią o tych
// samych liczbach.
//
// PO CO. Budżet prób i okno potwierdzenia żyją w bazie
// (`_event_refund_attempt_budget()`, `_event_refund_unconfirmed_days()`,
// 20261012120000) - tam decydują, kiedy zlecenie przechodzi do `needs_review`
// i co mówi alarm dla administratorów. Panel powtarza te liczby w podpowiedzi
// dziennika („system ponawia do N prób", „ponad N dni"). Rozjazd byłby
// obietnicą prób, których nie będzie, albo terminem, który nie nadejdzie -
// dokładnie tym, co INV-19c zamyka. Test jest statyczny: czyta NAJNOWSZĄ
// definicję każdej funkcji (migracje są forward-only).
import { describe, expect, it } from "vitest";
import { extractLatestDefinitions } from "../../../../scripts/lib/sqlMigrations";
import {
  REFUND_ATTEMPT_BUDGET,
  REFUND_REVIEW_REASONS,
  REFUND_UNCONFIRMED_DAYS,
} from "@/lib/events/registrationRefundJournal";
import {
  adminEventRegistrationEn,
  adminEventRegistrationPl,
} from "@/lib/i18n-admin-event-registration";

const LATEST = extractLatestDefinitions();

/** Stała zwracana przez funkcję `LANGUAGE sql` o ciele `SELECT <liczba>`. */
function sqlConstant(name: string): number {
  const def = LATEST.get(`public.${name}/0`);
  expect(def, `brak definicji public.${name}()`).toBeDefined();
  const match = /^\s*SELECT\s+(\d+)\s*;?\s*$/i.exec(def!.body);
  expect(match, `public.${name}() przestała być stałą: ${def!.body}`).not.toBeNull();
  return Number(match![1]);
}

describe("polityka zleceń zwrotu: TS == SQL", () => {
  it("budżet prób w panelu jest budżetem bazy", () => {
    expect(REFUND_ATTEMPT_BUDGET).toBe(sqlConstant("_event_refund_attempt_budget"));
  });

  it("okno potwierdzenia w panelu jest oknem sweepu", () => {
    expect(REFUND_UNCONFIRMED_DAYS).toBe(sqlConstant("_event_refund_unconfirmed_days"));
  });

  it("każdy powód z CHECK-a ma etykietę i wskazówkę w obu językach", () => {
    const helper = LATEST.get("public._event_refund_job_escalate/3");
    expect(helper, "brak helpera eskalacji").toBeDefined();
    for (const reason of REFUND_REVIEW_REASONS) {
      // Helper zna dozwolone stany źródłowe KAŻDEGO powodu - powód bez gałęzi
      // w helperze byłby odrzucany jako `invalid_review_reason`.
      expect(helper!.body).toContain(`'${reason}'`);
      for (const dict of [adminEventRegistrationPl, adminEventRegistrationEn]) {
        const entry = dict.adminEventRegistration.refundJournal.reasons[reason];
        expect(entry.label.length, `${reason}: etykieta`).toBeGreaterThan(0);
        expect(entry.hint.length, `${reason}: wskazówka`).toBeGreaterThan(0);
      }
    }
  });
});
