// SKUTEK WPŁATY DLA MIEJSCA (`src/lib/events/paidAdmission.ts`).
//
// PO CO TEN TEST. Od 20260926180000 opłacenie biletu nie zawsze daje miejsce:
// baza może zostawić wpłatę w kolejce, w oczekiwaniu na decyzję organizatora
// albo na zgłoszeniu zamkniętym. Webhook czyta z tej klasyfikacji, czy wolno
// potwierdzić RSVP 'going' i wysłać „miejsce zarezerwowane", a moduł
// powiadomień - który szablon wysłać. Pomyłka w jednym ramieniu to mail
// obiecujący miejsce, którego nie ma, albo odebrany link wejścia komuś,
// kto miejsce ma.
import { describe, expect, it } from "vitest";

import {
  isTicketPaymentRefusal,
  paidAdmission,
  paidSeatConfirmed,
  paidTicketVerdict,
} from "@/lib/events/paidAdmission";

describe("paidAdmission - status zgłoszenia po wpłacie", () => {
  it.each([
    ["waitlist", "waitlisted"],
    ["pending", "awaitingDecision"],
    ["draft", "awaitingDecision"],
    ["cancelled", "closed"],
    ["rejected", "closed"],
    ["approved", "seated"],
    ["attended", "seated"],
    ["no_show", "seated"],
  ] as const)("%s -> %s", (status, expected) => {
    expect(paidAdmission(status)).toBe(expected);
  });

  it.each([undefined, null, 42, "", "APPROVED"])(
    "%s (brak pola z bazy sprzed migracji albo śmieć) -> seated, czyli dotychczasowe zachowanie",
    (status) => {
      // Odpowiedź bazy bez `registration_status` ma dawać dokładnie to, co
      // przed zmianą - inaczej wdrożenie TS przed migracją odbierałoby RSVP
      // każdemu kupującemu.
      expect(paidAdmission(status)).toBe("seated");
    },
  );
});

describe("paidTicketVerdict - co webhook robi z wpłatą po odpowiedzi bazy (TIX-05)", () => {
  it("brak odpowiedzi to NIE miejsce - dawniej połknięty błąd RPC dawał RSVP i link wejścia", () => {
    expect(paidTicketVerdict(null)).toBe("none");
    expect(paidSeatConfirmed(null)).toBe(false);
  });

  it("zakup bez zgłoszenia z formularza idzie ścieżką RSVP (miejsce rozstrzyga baza pod blokadą)", () => {
    expect(paidTicketVerdict({ applied: false, reason: "registration_not_found" })).toBe("rsvp");
    // Ścieżka RSVP nie jest jeszcze potwierdzonym miejscem zgłoszenia.
    expect(paidSeatConfirmed({ applied: false, reason: "registration_not_found" })).toBe(false);
  });

  it.each([
    "already_settled_by_another_order",
    "registration_mismatch",
    "registration_not_owned",
    "ticket_mismatch",
    "amount_mismatch",
    "currency_mismatch",
  ])("odmowa bazy (%s) to odmowa - bez RSVP i bez „miejsce zarezerwowane”", (reason) => {
    expect(paidTicketVerdict({ applied: false, reason })).toBe("refused");
    expect(isTicketPaymentRefusal({ applied: false, reason })).toBe(true);
    expect(paidSeatConfirmed({ applied: false, reason })).toBe(false);
  });

  it("jawny znacznik `refused` z bazy wystarcza niezależnie od powodu", () => {
    expect(isTicketPaymentRefusal({ applied: false, refused: true, reason: "nowy_powod" })).toBe(
      true,
    );
  });

  it.each(["not_a_ticket_order", "order_not_found"])(
    "%s nie jest odmową wpłaty - nic do rozliczenia",
    (reason) => {
      expect(paidTicketVerdict({ applied: false, reason })).toBe("none");
      expect(isTicketPaymentRefusal({ applied: false, reason })).toBe(false);
    },
  );

  it("zapis bez pola statusu (baza sprzed migracji) potwierdza miejsce", () => {
    expect(paidSeatConfirmed({ applied: true })).toBe(true);
  });

  it("przyjęte zgłoszenie potwierdza miejsce", () => {
    expect(paidTicketVerdict({ applied: true, registration_status: "approved" })).toBe("seated");
    expect(paidSeatConfirmed({ applied: true, registration_status: "approved" })).toBe(true);
  });

  it.each(["waitlist", "pending", "cancelled"])(
    "%s: wpłata bez miejsca NIE potwierdza RSVP ani maila o rezerwacji",
    (status) => {
      expect(paidTicketVerdict({ applied: true, registration_status: status })).toBe("awaiting");
      expect(paidSeatConfirmed({ applied: true, registration_status: status })).toBe(false);
    },
  );
});
