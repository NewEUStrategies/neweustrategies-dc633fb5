// Kontrakt logiki nocnej sondy odnowienia i dunningu.
//
// Sonda przez cały czas życia poprzedniej wersji nie wykonała ani jednego
// żądania do operatora (workflow eksportował inną nazwę sekretu, niż skrypt
// czytał), więc jej logika NIGDY nie została uruchomiona na produkcyjnym CI.
// Te testy są pierwszym miejscem, w którym w ogóle się wykonuje - i pilnują
// trzech usterek, które w niej siedziały:
//   1. `created >= armedAt || billing_reason === "subscription_cycle"` - przez
//      alternatywę DOWOLNA stara faktura cykliczna uchodziła za nową,
//   2. brak jakiegokolwiek testu dunningu mimo dunningu w nazwie,
//   3. brak walidacji pliku stanu przekazywanego między krokami joba.
import { describe, expect, it } from "vitest";
import {
  type ProbeState,
  type StripeInvoice,
  type StripeSubscription,
  classifyRenewal,
  formatUnix,
  isFailure,
  parseProbeState,
  periodEndOf,
  renderArmSummary,
  renderVerifySummary,
  selectRenewalCandidate,
  testClockIdOf,
} from "@/lib/ci/billingRenewalProbe";

const PERIOD_END = 1_800_000_000;

function subscription(overrides: Partial<StripeSubscription> = {}): StripeSubscription {
  return {
    id: "sub_probe",
    status: "active",
    customer: "cus_1",
    test_clock: "clock_1",
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...overrides,
  };
}

function state(overrides: Partial<ProbeState> = {}): ProbeState {
  return {
    version: 1,
    subscriptionId: "sub_probe",
    testClockId: "clock_1",
    armedAt: "2026-08-06T02:40:00.000Z",
    frozenBefore: PERIOD_END - 86_400,
    advancedTo: PERIOD_END + 60,
    previousPeriodEnd: PERIOD_END,
    knownInvoiceIds: ["in_old"],
    ...overrides,
  };
}

function invoice(overrides: Partial<StripeInvoice> = {}): StripeInvoice {
  return {
    id: "in_new",
    status: "paid",
    created: PERIOD_END + 61,
    billing_reason: "subscription_cycle",
    ...overrides,
  };
}

describe("odczyt pól subskrypcji", () => {
  it("znajduje Test Clock na subskrypcji i na rozwiniętym kliencie", () => {
    expect(testClockIdOf(subscription())).toBe("clock_1");
    expect(
      testClockIdOf(
        subscription({
          test_clock: null,
          customer: { id: "cus_1", test_clock: { id: "clock_2" } },
        }),
      ),
    ).toBe("clock_2");
    expect(testClockIdOf(subscription({ test_clock: null, customer: "cus_1" }))).toBeNull();
  });

  it("czyta koniec okresu z POZYCJI subskrypcji (API 2026-03-25.dahlia)", () => {
    expect(periodEndOf(subscription())).toBe(PERIOD_END);
    expect(
      periodEndOf(
        subscription({ items: { data: [{ current_period_end: 10 }, { current_period_end: 20 }] } }),
      ),
    ).toBe(20);
    expect(periodEndOf(subscription({ items: { data: [] } }))).toBeNull();
    expect(periodEndOf(subscription({ items: undefined }))).toBeNull();
  });
});

describe("wybór subskrypcji do zbrojenia", () => {
  const withClock = subscription({ id: "sub_b" });
  const withoutClock = subscription({ id: "sub_a", test_clock: null, customer: "cus_x" });
  const cancelled = subscription({ id: "sub_c", status: "canceled" });

  it("bierze wyłącznie aktywną subskrypcję z Test Clockiem i znanym okresem", () => {
    const candidate = selectRenewalCandidate([withoutClock, cancelled, withClock]);
    expect(candidate?.subscription.id).toBe("sub_b");
    expect(candidate?.testClockId).toBe("clock_1");
  });

  it("jest deterministyczny niezależnie od kolejności z API", () => {
    const first = subscription({ id: "sub_1" });
    const second = subscription({ id: "sub_2" });
    expect(selectRenewalCandidate([second, first])?.subscription.id).toBe("sub_1");
    expect(selectRenewalCandidate([first, second])?.subscription.id).toBe("sub_1");
  });

  it("honoruje jawnie wskazaną subskrypcję i nie podstawia zamiennika", () => {
    const first = subscription({ id: "sub_1" });
    const second = subscription({ id: "sub_2" });
    expect(selectRenewalCandidate([first, second], "sub_2")?.subscription.id).toBe("sub_2");
    expect(selectRenewalCandidate([first, second], "sub_nieistnieje")).toBeNull();
  });

  it("zwraca null, gdy w sandboxie nie ma nadającej się subskrypcji", () => {
    expect(selectRenewalCandidate([withoutClock, cancelled])).toBeNull();
    expect(selectRenewalCandidate([])).toBeNull();
  });
});

describe("walidacja stanu przekazywanego między krokami", () => {
  it("przyjmuje poprawny stan w wersji 1", () => {
    expect(parseProbeState(JSON.stringify(state()))).toMatchObject({ subscriptionId: "sub_probe" });
  });

  it("odrzuca śmieci zamiast udawać, że ma stan", () => {
    expect(parseProbeState("nie-json")).toBeNull();
    expect(parseProbeState("null")).toBeNull();
    expect(parseProbeState(JSON.stringify({ ...state(), version: 2 }))).toBeNull();
    expect(parseProbeState(JSON.stringify({ ...state(), subscriptionId: "" }))).toBeNull();
    expect(parseProbeState(JSON.stringify({ ...state(), armedAt: "wczoraj" }))).toBeNull();
    expect(parseProbeState(JSON.stringify({ ...state(), knownInvoiceIds: [1, 2] }))).toBeNull();
    expect(parseProbeState(JSON.stringify({ ...state(), advancedTo: "później" }))).toBeNull();
  });

  it("dopuszcza brak poprzedniego końca okresu (pierwszy przebieg)", () => {
    expect(parseProbeState(JSON.stringify(state({ previousPeriodEnd: null })))).toMatchObject({
      previousPeriodEnd: null,
    });
  });
});

describe("klasyfikacja wyniku", () => {
  it("potwierdza odnowienie: nowa faktura opłacona + okres do przodu", () => {
    const verdict = classifyRenewal({
      subscription: subscription({
        items: { data: [{ current_period_end: PERIOD_END + 2_592_000 }] },
      }),
      invoices: [invoice({ id: "in_old", status: "paid" }), invoice()],
      state: state(),
    });
    expect(verdict.outcome).toBe("renewed");
    expect(verdict.renewalInvoice?.id).toBe("in_new");
    expect(verdict.periodMoved).toBe(true);
    expect(isFailure(verdict.outcome)).toBe(false);
  });

  it("REGRESJA: stara faktura cykliczna NIE jest odnowieniem", () => {
    // Poprzednia wersja miała `created >= armedAt || billing_reason === cycle`.
    // Alternatywa sprawiała, że faktura sprzed miesięcy potwierdzała odnowienie,
    // którego nie było - sonda raportowała sukces przy całkowicie martwym cyklu.
    const verdict = classifyRenewal({
      subscription: subscription(),
      invoices: [invoice({ id: "in_old", created: 1, billing_reason: "subscription_cycle" })],
      state: state({ knownInvoiceIds: ["in_old"] }),
    });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.renewalInvoice).toBeNull();
    expect(verdict.reason).toContain("NOWA faktura");
  });

  it("potwierdza dunning: faktura nieopłacona, subskrypcja w windykacji", () => {
    const verdict = classifyRenewal({
      subscription: subscription({
        status: "past_due",
        items: { data: [{ current_period_end: PERIOD_END + 2_592_000 }] },
      }),
      invoices: [invoice({ status: "open", attempt_count: 2 })],
      state: state(),
    });
    expect(verdict.outcome).toBe("dunning");
    expect(isFailure(verdict.outcome)).toBe(false);
    expect(verdict.reason).toContain("past_due");
  });

  it("NAJGORSZY PRZYPADEK: faktura nieopłacona, a subskrypcja nadal aktywna", () => {
    const verdict = classifyRenewal({
      subscription: subscription({
        status: "active",
        items: { data: [{ current_period_end: PERIOD_END + 2_592_000 }] },
      }),
      invoices: [invoice({ status: "open" })],
      state: state(),
    });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.reason).toContain("bez płatności");
  });

  it("nie udaje sukcesu, gdy faktura powstała, ale okres stoi w miejscu", () => {
    const verdict = classifyRenewal({
      subscription: subscription(),
      invoices: [invoice()],
      state: state(),
    });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.periodMoved).toBe(false);
    expect(verdict.reason).toContain("NIE przesunął");
  });

  it("faktura w wersji roboczej to wynik nierozstrzygnięty, nie regresja", () => {
    const verdict = classifyRenewal({
      subscription: subscription({ items: { data: [{ current_period_end: PERIOD_END + 10 }] } }),
      invoices: [invoice({ status: "draft" })],
      state: state(),
    });
    expect(verdict.outcome).toBe("pending");
    expect(isFailure(verdict.outcome)).toBe(false);
  });

  it("faktura jednorazowa nie uchodzi za odnowienie, ale jest policzona w opisie", () => {
    const verdict = classifyRenewal({
      subscription: subscription(),
      invoices: [invoice({ id: "in_manual", billing_reason: "manual" })],
      state: state(),
    });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.reason).toContain("nowe faktury bez cyklu: 1");
  });

  it("przy pierwszym przebiegu (brak poprzedniego okresu) sam okres wystarcza", () => {
    const verdict = classifyRenewal({
      subscription: subscription(),
      invoices: [invoice()],
      state: state({ previousPeriodEnd: null }),
    });
    expect(verdict.periodMoved).toBe(true);
    expect(verdict.outcome).toBe("renewed");
  });
});

describe("podsumowania dla przebiegu CI", () => {
  it("formatuje znaczniki czasu i brak wartości", () => {
    expect(formatUnix(0)).toBe("1970-01-01T00:00:00Z");
    expect(formatUnix(null)).toBe("-");
    expect(formatUnix(Number.NaN)).toBe("-");
  });

  it("zbrojenie raportuje zegar, okres i liczbę znanych faktur", () => {
    const markdown = renderArmSummary(state());
    expect(markdown).toContain("sub_probe");
    expect(markdown).toContain("clock_1");
    expect(markdown).toContain("faktury znane przed zbrojeniem: 1");
  });

  it("weryfikacja pokazuje wynik, fakturę, ruch okresu i uzasadnienie", () => {
    const subscriptionAfter = subscription({
      status: "past_due",
      items: { data: [{ current_period_end: PERIOD_END + 2_592_000 }] },
    });
    const verdict = classifyRenewal({
      subscription: subscriptionAfter,
      invoices: [invoice({ status: "open" })],
      state: state(),
    });
    const markdown = renderVerifySummary({
      state: state(),
      subscription: subscriptionAfter,
      verdict,
      dunningCensus: 3,
    });
    expect(markdown).toContain("dunning potwierdzony");
    expect(markdown).toContain("`in_new` (open)");
    expect(markdown).toContain("przesunięty");
    expect(markdown).toContain("w windykacji: 3");
    expect(markdown).toContain(verdict.reason);
  });
});

describe("incomplete or corrupt renewal evidence", () => {
  it.each([
    { testClockId: "" },
    { testClockId: 5 },
    { frozenBefore: "yesterday" },
    { previousPeriodEnd: "tomorrow" },
    { armedAt: null },
    { knownInvoiceIds: null },
  ])("rejects a malformed state field: %j", (changes) => {
    expect(parseProbeState(JSON.stringify({ ...state(), ...changes }))).toBeNull();
  });
  it.each(["frozenBefore", "advancedTo"])("rejects an overflowing numeric %s", (field) => {
    const raw = JSON.stringify({ ...state(), [field]: "overflow" }).replace('"overflow"', "1e400");
    expect(parseProbeState(raw)).toBeNull();
  });
  it("does not invent a billing period from incomplete subscription items", () => {
    expect(
      periodEndOf(subscription({ items: { data: [{}, { current_period_end: null }] } })),
    ).toBeNull();
  });
  it("shows missing invoice evidence and an unchanged period in the failed report", () => {
    const sub = subscription();
    const verdict = classifyRenewal({ subscription: sub, invoices: [], state: state() });
    const report = renderVerifySummary({
      state: state(),
      subscription: sub,
      verdict,
      dunningCensus: 0,
    });
    expect(verdict.outcome).toBe("failed");
    expect(report).toContain("faktura odnowieniowa: brak");
    expect(report).toContain("bez zmiany");
  });
  it("never classifies a null invoice status as settled", () => {
    const sub = subscription({ items: { data: [{ current_period_end: PERIOD_END + 10 }] } });
    const verdict = classifyRenewal({
      subscription: sub,
      invoices: [invoice({ status: null })],
      state: state(),
    });
    expect(verdict.outcome).toBe("failed");
    expect(
      renderVerifySummary({ state: state(), subscription: sub, verdict, dunningCensus: 0 }),
    ).toContain("`in_new` (-)");
  });
});
