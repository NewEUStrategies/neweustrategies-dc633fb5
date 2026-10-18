// Reguły przeniesienia trwających subskrypcji na cenę katalogu v6.2
// (`subscriptionRepricing.ts`) - czyste, bez operatora i bazy.
//
// CZEGO PILNUJE:
//   1. KAŻDA gałąź decyzji (jedenaście powodów pominięcia i `apply`) - to od
//      niej zależy, czy klient zapłaci przy odnowieniu 39, czy 59 zł.
//   2. AKCJA NIGDY NIE PODNOSI CENY - klient na tańszej cenie historycznej
//      zostaje przy swojej (`would_increase`).
//   3. KWOTY Z PROGIEM WOLUMENOWYM - Zespół od 11 miejsc po 79 zł za KAŻDE
//      miejsce; ta sama kwota przed i po to `apply` bez maila.
//   4. HARMONOGRAM - zaplanowany downgrade decyduje o fakturze fazą, która
//      wejdzie przy odnowieniu, a obcy harmonogram idzie do obsługi ręcznej.
//   5. MRR - ekwiwalent miesięczny i sumy wyłącznie z decyzji `apply`.
import { describe, expect, it } from "vitest";

import {
  amountForQuantity,
  isRepriceLookupKey,
  linePriceTarget,
  mergeRepricingPages,
  monthlyEquivalent,
  REPRICE_LOOKUP_KEYS,
  REPRICE_SKIP_REASONS,
  repriceDecision,
  summarizeRepricing,
  type PriceShape,
  type RepriceInput,
  type RepriceLine,
  type RepricingPage,
} from "@/lib/billing/subscriptionRepricing";

function flat(
  id: string,
  unitAmount: number,
  interval: PriceShape["interval"] = "month",
): PriceShape {
  return {
    id,
    currency: "pln",
    interval,
    intervalCount: 1,
    unitAmount,
    tiersMode: null,
    tiers: null,
  };
}

function volume(id: string, base: number, threshold: number, discounted: number): PriceShape {
  return {
    id,
    currency: "pln",
    interval: "month",
    intervalCount: 1,
    unitAmount: null,
    tiersMode: "volume",
    tiers: [
      { upTo: threshold - 1, unitAmount: base, flatAmount: null },
      { upTo: null, unitAmount: discounted, flatAmount: null },
    ],
  };
}

const OLD_PLUS = flat("price_plusOld", 5900);
const NEW_PLUS = flat("price_plusNew", 3900);
const OLD_PLUS_YEAR = flat("price_plusYearOld", 59000, "year");
const NEW_PLUS_YEAR = flat("price_plusYearNew", 39000, "year");
const OLD_PRO = flat("price_proOld", 12900);
const NEW_PRO = flat("price_proNew", 11900);
const OLD_TEAM = volume("price_teamOld", 9900, 11, 7900);
const NEW_TEAM = volume("price_teamNew", 8900, 11, 7900);

const TARGETS = {
  plus_monthly: NEW_PLUS,
  plus_annual: NEW_PLUS_YEAR,
  pro_monthly: NEW_PRO,
  team_monthly_seat: NEW_TEAM,
};

function line(lookupKey: string | null, price: PriceShape, quantity = 1): RepriceLine {
  return { lookupKey, price, quantity };
}

const PERIOD_END = 1_798_761_600; // 2027-01-01T00:00:00Z
const TRIAL_END = 1_795_000_000;

function input(patch: Partial<RepriceInput> = {}): RepriceInput {
  return {
    status: "active",
    pauseCollection: false,
    pendingUpdate: false,
    items: [line("plus_monthly", OLD_PLUS)],
    schedule: null,
    targets: TARGETS,
    cancelScheduled: false,
    trialEnd: null,
    periodEnd: PERIOD_END,
    ...patch,
  };
}

describe("amountForQuantity - kwota pozycji z ceny operatora", () => {
  it("cena płaska: stawka × ilość", () => {
    expect(amountForQuantity(NEW_PLUS, 1)).toBe(3900);
    expect(amountForQuantity(NEW_PLUS, 3)).toBe(11700);
  });

  it("volume: WSZYSTKIE miejsca po stawce progu, który osiągnęła ilość (10 vs 11 miejsc)", () => {
    expect(amountForQuantity(NEW_TEAM, 10)).toBe(89000);
    expect(amountForQuantity(NEW_TEAM, 11)).toBe(86900);
    expect(amountForQuantity(OLD_TEAM, 10)).toBe(99000);
  });

  it("volume z opłatą stałą progu doliczoną raz", () => {
    const withFlat: PriceShape = {
      ...NEW_TEAM,
      tiers: [{ upTo: null, unitAmount: 1000, flatAmount: 500 }],
    };
    expect(amountForQuantity(withFlat, 2)).toBe(2500);
  });

  it("graduated, cena bez kwoty i próg bez stawek są niepoliczalne", () => {
    expect(amountForQuantity({ ...NEW_TEAM, tiersMode: "graduated" }, 5)).toBeNull();
    expect(amountForQuantity({ ...NEW_PLUS, unitAmount: null }, 1)).toBeNull();
    expect(
      amountForQuantity(
        { ...NEW_TEAM, tiers: [{ upTo: null, unitAmount: null, flatAmount: null }] },
        1,
      ),
    ).toBeNull();
    expect(amountForQuantity({ ...NEW_TEAM, tiers: [] }, 1)).toBeNull();
  });

  it("ilość spoza zakresu liczy się jako jedno miejsce", () => {
    expect(amountForQuantity(NEW_PLUS, 0)).toBe(3900);
  });
});

describe("monthlyEquivalent - MRR", () => {
  it("rok / 12, miesiąc wprost, krotność cyklu dzieli kwotę", () => {
    expect(monthlyEquivalent(39000, NEW_PLUS_YEAR)).toBe(3250);
    expect(monthlyEquivalent(3900, NEW_PLUS)).toBe(3900);
    expect(monthlyEquivalent(9000, { interval: "month", intervalCount: 3 })).toBe(3000);
  });

  it("dwa tygodnie i dzień w uczciwej średniej rocznej", () => {
    expect(monthlyEquivalent(1200, { interval: "week", intervalCount: 2 })).toBeCloseTo(2600);
    expect(monthlyEquivalent(120, { interval: "day", intervalCount: 1 })).toBeCloseTo(3650);
  });
});

describe("repriceDecision - kolejność reguł", () => {
  it("Członek miesięcznie 59 -> 39: apply, mail, efekt z końcem okresu", () => {
    const d = repriceDecision(input());
    expect(d).toMatchObject({
      action: "apply",
      reason: null,
      mode: "item",
      lookupKey: "plus_monthly",
      interval: "month",
      fromPriceId: "price_plusOld",
      toPriceId: "price_plusNew",
      currency: "PLN",
      currentAmount: 5900,
      newAmount: 3900,
      currentMrr: 5900,
      newMrr: 3900,
      emailEligible: true,
    });
    expect(d.effectiveAt).toBe(new Date(PERIOD_END * 1000).toISOString());
  });

  it("Członek rocznie 590 -> 390: MRR w ekwiwalencie miesięcznym", () => {
    const d = repriceDecision(input({ items: [line("plus_annual", OLD_PLUS_YEAR)] }));
    expect(d.action).toBe("apply");
    expect(d.interval).toBe("year");
    expect(d.currentMrr).toBeCloseTo(59000 / 12);
    expect(d.newMrr).toBeCloseTo(39000 / 12);
  });

  it("trial w toku: pierwsza faktura po nowej cenie przychodzi z końcem triala", () => {
    const d = repriceDecision(input({ status: "trialing", trialEnd: TRIAL_END }));
    expect(d.action).toBe("apply");
    expect(d.effectiveAt).toBe(new Date(TRIAL_END * 1000).toISOString());
  });

  it.each([["past_due"], ["unpaid"], ["incomplete"], ["canceled"], ["paused"]])(
    "status %s -> status_not_billable (bez kwot i MRR)",
    (status) => {
      const d = repriceDecision(input({ status }));
      expect(d).toMatchObject({ action: "skip", reason: "status_not_billable", currentMrr: 0 });
      expect(d.toPriceId).toBeNull();
    },
  );

  it("wstrzymany pobór -> paused", () => {
    expect(repriceDecision(input({ pauseCollection: true })).reason).toBe("paused");
  });

  it("oczekująca dopłata -> pending_update", () => {
    expect(repriceDecision(input({ pendingUpdate: true })).reason).toBe("pending_update");
  });

  it("dwie pozycje (albo żadna) -> multi_item", () => {
    expect(
      repriceDecision(
        input({ items: [line("plus_monthly", OLD_PLUS), line("pro_monthly", OLD_PRO)] }),
      ).reason,
    ).toBe("multi_item");
    expect(repriceDecision(input({ items: [] })).reason).toBe("multi_item");
  });

  it("harmonogram obcy albo nieczytelny -> schedule_foreign (obsługa ręczna)", () => {
    const next = [line("plus_monthly", OLD_PLUS)];
    for (const schedule of [
      { own: false, nextLines: next, extraPhases: false, endBehavior: "release" },
      { own: true, nextLines: null, extraPhases: false, endBehavior: "release" },
      { own: true, nextLines: next, extraPhases: true, endBehavior: "release" },
      { own: true, nextLines: [...next, ...next], extraPhases: false, endBehavior: "release" },
      // Kształt, którego zapis faz nie zachowa (nie `release`, nie `cancel`).
      { own: true, nextLines: next, extraPhases: false, endBehavior: "none" },
      { own: true, nextLines: next, extraPhases: false, endBehavior: null },
    ]) {
      expect(repriceDecision(input({ schedule })).reason, JSON.stringify(schedule)).toBe(
        "schedule_foreign",
      );
    }
  });

  it("klucz spoza kampanii (student, Partner Biznesowy) -> not_repriced_key", () => {
    for (const key of ["student_monthly", "business_monthly", null]) {
      expect(repriceDecision(input({ items: [line(key, OLD_PLUS)] })).reason).toBe(
        "not_repriced_key",
      );
    }
  });

  it("brak ceny katalogu -> target_price_missing", () => {
    expect(repriceDecision(input({ items: [line("pro_annual", OLD_PRO)] })).reason).toBe(
      "target_price_missing",
    );
  });

  it("ta sama cena -> already_current z MRR po obu stronach", () => {
    const d = repriceDecision(input({ items: [line("plus_monthly", NEW_PLUS)] }));
    expect(d).toMatchObject({
      action: "skip",
      reason: "already_current",
      currentAmount: 3900,
      newAmount: 3900,
      currentMrr: 3900,
      newMrr: 3900,
      emailEligible: false,
    });
  });

  it("inna waluta -> currency_mismatch, inny cykl -> cycle_mismatch", () => {
    expect(
      repriceDecision(input({ items: [line("plus_monthly", { ...OLD_PLUS, currency: "eur" })] }))
        .reason,
    ).toBe("currency_mismatch");
    expect(
      repriceDecision(input({ items: [line("plus_monthly", { ...OLD_PLUS, intervalCount: 3 })] }))
        .reason,
    ).toBe("cycle_mismatch");
  });

  it("kształt niepoliczalny -> unpriceable", () => {
    expect(
      repriceDecision(input({ items: [line("plus_monthly", { ...OLD_PLUS, unitAmount: null })] }))
        .reason,
    ).toBe("unpriceable");
  });

  it("cena historyczna 35 zł -> NIGDY podwyżka do 39 zł (would_increase)", () => {
    const d = repriceDecision(input({ items: [line("plus_monthly", flat("price_promo", 3500))] }));
    expect(d).toMatchObject({
      action: "skip",
      reason: "would_increase",
      currentAmount: 3500,
      newAmount: 3900,
    });
  });

  it("Zespół na 10 miejscach: 990 -> 890 zł, mail", () => {
    const d = repriceDecision(input({ items: [line("team_monthly_seat", OLD_TEAM, 10)] }));
    expect(d).toMatchObject({
      action: "apply",
      quantity: 10,
      currentAmount: 99000,
      newAmount: 89000,
      emailEligible: true,
    });
  });

  it("Zespół od 11 miejsc: 79 zł przed i po -> apply na aktualny obiekt ceny, BEZ maila", () => {
    const d = repriceDecision(input({ items: [line("team_monthly_seat", OLD_TEAM, 12)] }));
    expect(d).toMatchObject({
      action: "apply",
      currentAmount: 94800,
      newAmount: 94800,
      emailEligible: false,
    });
  });

  it("zaplanowany koniec: cena przepięta, ale bez maila o odnowieniu, którego nie będzie", () => {
    const d = repriceDecision(input({ cancelScheduled: true }));
    expect(d.action).toBe("apply");
    expect(d.emailEligible).toBe(false);
  });

  it("WŁASNY harmonogram (downgrade Pro -> Członek): decyduje faza odnowienia", () => {
    const d = repriceDecision(
      input({
        items: [line("pro_monthly", OLD_PRO)],
        schedule: {
          own: true,
          nextLines: [line("plus_monthly", OLD_PLUS)],
          extraPhases: false,
          endBehavior: "release",
        },
      }),
    );
    expect(d).toMatchObject({
      action: "apply",
      mode: "schedule",
      lookupKey: "plus_monthly",
      fromPriceId: "price_plusOld",
      toPriceId: "price_plusNew",
      currentAmount: 5900,
      newAmount: 3900,
    });
  });

  // Przepisanie faz własnego harmonogramu zapisuje `end_behavior: release`
  // i otwartą fazę - przy zaplanowanym końcu odwołałoby rezygnację klienta.
  it("WŁASNY harmonogram przy zaplanowanym końcu -> cancel_scheduled (bez przepisania faz)", () => {
    const schedule = {
      own: true,
      nextLines: [line("plus_monthly", OLD_PLUS)],
      extraPhases: false,
      endBehavior: "release",
    };
    const items = [line("pro_monthly", OLD_PRO)];
    expect(repriceDecision(input({ items, schedule, cancelScheduled: true }))).toMatchObject({
      action: "skip",
      reason: "cancel_scheduled",
      emailEligible: false,
    });
    expect(
      repriceDecision(input({ items, schedule: { ...schedule, endBehavior: "cancel" } })).reason,
    ).toBe("cancel_scheduled");
  });

  it("lista powodów jest kompletna i w kolejności reguł", () => {
    expect(REPRICE_SKIP_REASONS).toHaveLength(13);
    expect(new Set(REPRICE_SKIP_REASONS).size).toBe(13);
    expect(REPRICE_LOOKUP_KEYS).toEqual([
      "plus_monthly",
      "plus_annual",
      "pro_monthly",
      "pro_annual",
      "team_monthly_seat",
    ]);
    expect(isRepriceLookupKey("pro_annual")).toBe(true);
    expect(isRepriceLookupKey("student_annual")).toBe(false);
  });
});

describe("linePriceTarget - pozycje faz harmonogramu", () => {
  it("przepina wyłącznie na niższą albo równą cenę tego samego cyklu i waluty", () => {
    expect(linePriceTarget(line("pro_monthly", OLD_PRO), TARGETS)?.id).toBe("price_proNew");
    expect(linePriceTarget(line("pro_monthly", flat("price_proPromo", 9900)), TARGETS)).toBeNull();
    expect(linePriceTarget(line("pro_monthly", NEW_PRO), TARGETS)).toBeNull();
    expect(linePriceTarget(line("student_monthly", OLD_PLUS), TARGETS)).toBeNull();
    expect(linePriceTarget(line("pro_annual", OLD_PRO), TARGETS)).toBeNull();
    expect(
      linePriceTarget(line("pro_monthly", { ...OLD_PRO, currency: "eur" }), TARGETS),
    ).toBeNull();
    expect(
      linePriceTarget(line("pro_monthly", { ...OLD_PRO, interval: "year" }), TARGETS),
    ).toBeNull();
    expect(
      linePriceTarget(line("pro_monthly", { ...OLD_PRO, unitAmount: null }), TARGETS),
    ).toBeNull();
  });
});

describe("summarizeRepricing i sklejanie stron", () => {
  const apply = repriceDecision(input());
  const team = repriceDecision(input({ items: [line("team_monthly_seat", OLD_TEAM, 2)] }));
  const skip = repriceDecision(input({ status: "past_due" }));
  const current = repriceDecision(input({ items: [line("plus_monthly", NEW_PLUS)] }));

  it("MRR wyłącznie z decyzji apply, liczniki per decyzja i per klucz", () => {
    const s = summarizeRepricing([apply, team, skip, current]);
    expect(s.total).toBe(4);
    expect(s.count).toEqual({ apply: 2, status_not_billable: 1, already_current: 1 });
    expect(s.mrrBefore).toBe(5900 + 19800);
    expect(s.mrrAfter).toBe(3900 + 17800);
    expect(s.mrrDelta).toBe(-4000);
    expect(s.byKey).toEqual({
      plus_monthly: { n: 1, before: 5900, after: 3900 },
      team_monthly_seat: { n: 1, before: 19800, after: 17800 },
    });
  });

  it("strony sklejają się z deduplikacją problemów i sumą z całości", () => {
    const row = (id: string) => ({
      ...apply,
      subscriptionId: id,
      providerSubscriptionId: `sub_${id}`,
      outcome: "planned" as const,
      emailStatus: null,
      error: null,
    });
    const page1: RepricingPage = {
      ok: true,
      mode: "preview",
      environment: "sandbox",
      problems: ["catalog_not_synced"],
      rows: [row("a")],
      nextCursor: "a",
      done: false,
    };
    const page2: RepricingPage = {
      ...page1,
      rows: [row("b")],
      nextCursor: null,
      done: true,
    };
    const run = mergeRepricingPages(mergeRepricingPages(null, page1), page2);
    expect(run.rows.map((r) => r.subscriptionId)).toEqual(["a", "b"]);
    expect(run.problems).toEqual(["catalog_not_synced"]);
    expect(run.done).toBe(true);
    expect(run.summary.count.apply).toBe(2);
    expect(run.summary.mrrDelta).toBe(-4000);
  });
});
