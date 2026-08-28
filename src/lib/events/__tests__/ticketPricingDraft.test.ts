// Cennik biletu wydarzenia: korzyści + progi czasowe.
//
// Test pilnuje granicy, na której najłatwiej stracić pieniądze: walidacja
// formularza nie może przepuścić progu, który baza odrzuci (redaktor traci
// wypełniony cennik), ani odrzucić progu, który baza przyjmie (redaktor nie
// może zaplanować sprzedaży). Drugi wątek to parser odpowiedzi publicznej -
// brak wyliczonej kwoty musi degradować do CENY BAZOWEJ, nigdy do zera.
import { describe, expect, it } from "vitest";

import {
  benefitsFromText,
  emptyTicketDraft,
  phasesFromJson,
  ticketDraftIssue,
  ticketDraftToInput,
  type TicketDraft,
} from "@/lib/events/ticketDraft";
import { parseRegistrationForm } from "@/lib/events/registrationFormSurface";

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function draft(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    ...emptyTicketDraft(0),
    key: "standard",
    namePl: "Standard",
    nameEn: "Standard",
    priceCents: "12000",
    ...overrides,
  };
}

describe("korzyści biletu", () => {
  it("czyta jedną korzyść z linii i pomija puste linie", () => {
    expect(benefitsFromText("Lunch\n\n  Materiały  \n")).toEqual(["Lunch", "Materiały"]);
  });

  it("odrzuca listę dłuższą niż limit bazy", () => {
    const many = Array.from({ length: 21 }, (_, i) => `Korzyść ${i}`).join("\n");
    expect(ticketDraftIssue(draft({ benefitsPl: many }))?.field).toBe("benefitsPl");
  });

  it("przyjmuje listę na granicy limitu", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Korzyść ${i}`).join("\n");
    expect(ticketDraftIssue(draft({ benefitsEn: many }))).toBeNull();
  });
});

describe("progi cenowe", () => {
  it("odrzuca próg bez ceny", () => {
    const issue = ticketDraftIssue(
      draft({ phases: [{ labelPl: "", labelEn: "", from: "", to: "", priceCents: "" }] }),
    );
    expect(issue).toEqual({ field: "phases", errorKey: "invalidPriceSchedule" });
  });

  it("odrzuca okno, które kończy się przed startem", () => {
    const issue = ticketDraftIssue(
      draft({
        phases: [
          {
            labelPl: "Early",
            labelEn: "Early",
            from: "2026-09-10T10:00",
            to: "2026-09-01T10:00",
            priceCents: "9000",
          },
        ],
      }),
    );
    expect(issue?.field).toBe("phases");
  });

  it("przenosi progi do payloadu w kolejności z formularza", () => {
    const input = ticketDraftToInput(
      draft({
        phases: [
          { labelPl: "Early", labelEn: "Early", from: "", to: "", priceCents: "9000" },
          { labelPl: "Last", labelEn: "Last", from: "", to: "", priceCents: "15000" },
        ],
      }),
      EVENT,
    );
    expect(input.priceSchedule.map((phase) => phase.priceCents)).toEqual([9000, 15000]);
    expect(input.priceSchedule[0].from).toBeNull();
  });

  it("czyta progi z JSON-a i pomija wpisy bez ceny", () => {
    const rows = phasesFromJson([
      { label_pl: "Early", label_en: "Early", from: null, to: null, price_cents: 9000 },
      { label_pl: "Bełkot", price_cents: "dużo" },
      "nie obiekt",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe("9000");
  });
});

describe("publiczna karta biletu", () => {
  const base = {
    event: { id: EVENT, slug: "kongres", title_pl: "Kongres", title_en: "Congress" },
    is_open: true,
    fields: [],
    terms: [],
  };

  it("bierze cenę obowiązującą teraz razem z opisem progu", () => {
    const form = parseRegistrationForm({
      ...base,
      tickets: [
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          key: "standard",
          name_pl: "Standard",
          name_en: "Standard",
          price_cents: 12000,
          effective_price_cents: 9000,
          phase: {
            source: "schedule",
            price_cents: 9000,
            label_pl: "Early bird",
            label_en: "Early bird",
            ends_at: "2026-09-01T10:00:00.000Z",
          },
          benefits_pl: ["Lunch", ""],
          benefits_en: ["Lunch"],
          currency: "PLN",
          availability: "on_sale",
          requires_access_code: true,
          access_code_hint: "Kod z zaproszenia",
        },
      ],
    });
    const ticket = form.tickets[0];
    expect(ticket.effectivePriceCents).toBe(9000);
    expect(ticket.priceCents).toBe(12000);
    expect(ticket.phase?.source).toBe("schedule");
    expect(ticket.benefitsPl).toEqual(["Lunch"]);
    expect(ticket.requiresAccessCode).toBe(true);
  });

  it("brak wyliczonej kwoty degraduje do ceny bazowej, nie do zera", () => {
    const form = parseRegistrationForm({
      ...base,
      tickets: [
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          key: "standard",
          name_pl: "Standard",
          name_en: "Standard",
          price_cents: 12000,
          currency: "PLN",
          availability: "on_sale",
        },
      ],
    });
    expect(form.tickets[0].effectivePriceCents).toBe(12000);
    expect(form.tickets[0].phase?.source).toBe("standard");
  });
});
