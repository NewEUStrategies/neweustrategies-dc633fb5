// SKUTEK WPŁATY DLA MIEJSCA (`src/lib/events/paidAdmission.ts`).
//
// PO CO TEN TEST. Od 20260926150000 opłacenie biletu nie zawsze daje miejsce:
// baza może zostawić wpłatę w kolejce, w oczekiwaniu na decyzję organizatora
// albo na zgłoszeniu zamkniętym. Webhook czyta z tej klasyfikacji, czy wolno
// potwierdzić RSVP 'going' i wysłać „miejsce zarezerwowane", a moduł
// powiadomień - który szablon wysłać. Pomyłka w jednym ramieniu to mail
// obiecujący miejsce, którego nie ma, albo odebrany link wejścia komuś,
// kto miejsce ma.
import { describe, expect, it } from "vitest";

import { paidAdmission, paidSeatConfirmed } from "@/lib/events/paidAdmission";

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

describe("paidSeatConfirmed - czy wolno potwierdzić RSVP i „miejsce zarezerwowane”", () => {
  it("brak odpowiedzi (błąd RPC) zostawia starą ścieżkę", () => {
    expect(paidSeatConfirmed(null)).toBe(true);
  });

  it("`applied: false` (zakup bez zgłoszenia z formularza) zostawia starą ścieżkę", () => {
    expect(paidSeatConfirmed({ applied: false, registration_status: "waitlist" })).toBe(true);
    expect(paidSeatConfirmed({})).toBe(true);
  });

  it("zapis bez pola statusu (baza sprzed migracji) potwierdza miejsce", () => {
    expect(paidSeatConfirmed({ applied: true })).toBe(true);
  });

  it("przyjęte zgłoszenie potwierdza miejsce", () => {
    expect(paidSeatConfirmed({ applied: true, registration_status: "approved" })).toBe(true);
  });

  it.each(["waitlist", "pending", "cancelled"])(
    "%s: wpłata bez miejsca NIE potwierdza RSVP ani maila o rezerwacji",
    (status) => {
      expect(paidSeatConfirmed({ applied: true, registration_status: status })).toBe(false);
    },
  );
});
