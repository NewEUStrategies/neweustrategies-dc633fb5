// Bilet wliczony w plan - reguły ceny i oferty.
//
// Najdroższe pomyłki w tym module nie są arytmetyczne, tylko dotyczą
// KOLEJNOŚCI benefitów i KIERUNKU degradacji: bilet musi bić zniżkę (inaczej
// zniżka od zera spala roczny benefit), a nieznany kształt odpowiedzi RPC musi
// degradować do pustej puli (inaczej awaria bazy rozdaje darmowe wejściówki).
import { describe, expect, it } from "vitest";
import {
  EMPTY_TICKET_ALLOWANCE,
  coversTicket,
  parseTicketAllowance,
  ticketAmountCents,
  ticketOffer,
  type TicketAllowance,
} from "../ticketAllowance";

const allowance = (over: Partial<TicketAllowance> = {}): TicketAllowance => ({
  ...EMPTY_TICKET_ALLOWANCE,
  ...over,
});

describe("parseTicketAllowance", () => {
  it("czyta odpowiedź RPC i przelicza remaining z granted/used", () => {
    const parsed = parseTicketAllowance({
      granted: 3,
      used: 1,
      remaining: 99,
      discount_pct: 0,
      scope: "organisation",
      org_id: "11111111-1111-1111-1111-111111111111",
      period_start: "2026-03-01",
      period_end: "2027-03-01",
    });
    // `remaining` z bazy jest ignorowane na rzecz różnicy - jedno źródło
    // prawdy po stronie klienta, żeby stary cache nie pokazał puli, której nie ma.
    expect(parsed.remaining).toBe(2);
    expect(parsed.scope).toBe("organisation");
    expect(parsed.orgId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.periodEnd).toBe("2027-03-01");
  });

  it("nieznany zakres degraduje do none, a nie do personal", () => {
    expect(parseTicketAllowance({ granted: 1, used: 0, scope: "whatever" }).scope).toBe("none");
  });

  it("kształt nietypowy (tablica, null, liczba) daje pustą pulę", () => {
    for (const payload of [null, undefined, 7, "x", [], [{ granted: 5 }]]) {
      expect(parseTicketAllowance(payload)).toEqual(EMPTY_TICKET_ALLOWANCE);
    }
  });

  it("ujemne i niepoliczalne wartości nie tworzą puli", () => {
    const parsed = parseTicketAllowance({ granted: -3, used: "abc", discount_pct: 250 });
    expect(parsed.granted).toBe(0);
    expect(parsed.used).toBe(0);
    expect(parsed.remaining).toBe(0);
    expect(parsed.discountPct).toBe(100);
  });
});

describe("ticketAmountCents", () => {
  it("bez benefitów płaci się cenę katalogową", () => {
    expect(ticketAmountCents(30000, allowance())).toBe(30000);
  });

  it("bilet z puli pokrywa całość", () => {
    expect(ticketAmountCents(30000, allowance({ granted: 1, remaining: 1 }))).toBe(0);
  });

  it("zniżka 50% dla stawek ulgowych", () => {
    expect(ticketAmountCents(30000, allowance({ discountPct: 50 }))).toBe(15000);
  });

  it("bilet BIJE zniżkę - inaczej zniżka od zera spalałaby roczny benefit", () => {
    const both = allowance({ granted: 1, remaining: 1, discountPct: 50 });
    expect(ticketAmountCents(30000, both)).toBe(0);
    expect(coversTicket(both)).toBe(true);
  });

  it("zaokrągla w dół, na korzyść kupującego", () => {
    expect(ticketAmountCents(29999, allowance({ discountPct: 50 }))).toBe(14999);
  });

  it("pula wyczerpana nie pokrywa niczego", () => {
    expect(ticketAmountCents(30000, allowance({ granted: 1, used: 1, remaining: 0 }))).toBe(30000);
  });

  it("wydarzenie bezpłatne to zero, nie NaN", () => {
    for (const face of [0, -1, Number.NaN]) {
      expect(ticketAmountCents(face, allowance({ discountPct: 50 }))).toBe(0);
    }
  });
});

describe("ticketOffer", () => {
  it("brak ceny = wydarzenie bezpłatne", () => {
    expect(ticketOffer(null, allowance())).toEqual({ kind: "free" });
    expect(ticketOffer(0, allowance({ granted: 1, remaining: 1 }))).toEqual({ kind: "free" });
  });

  it("pula pokrywa bilet i zapowiada stan po rejestracji", () => {
    expect(
      ticketOffer(30000, allowance({ granted: 3, used: 1, remaining: 2, scope: "organisation" })),
    ).toEqual({ kind: "included", remainingAfter: 1, scope: "organisation" });
  });

  it("zniżka pokazuje obie kwoty - inaczej nie widać, ile członkostwo oszczędza", () => {
    expect(ticketOffer(30000, allowance({ discountPct: 50 }))).toEqual({
      kind: "discounted",
      amountCents: 15000,
      faceValueCents: 30000,
      discountPct: 50,
    });
  });

  it("bez benefitów - pełna cena", () => {
    expect(ticketOffer(30000, allowance())).toEqual({ kind: "full", amountCents: 30000 });
  });

  it("zniżka 0% nie udaje zniżki", () => {
    expect(ticketOffer(30000, allowance({ discountPct: 0 })).kind).toBe("full");
  });
});
