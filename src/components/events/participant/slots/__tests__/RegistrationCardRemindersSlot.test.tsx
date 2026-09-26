// GNIAZDO `RegistrationCardRemindersSlot` - test zaślepki Foundation (WŁAŚCICIEL: tor A).
//
// Zaślepka nie rysuje NICZEGO: host montuje gniazdo od pierwszego dnia, a tor
// A dopiero wypełni je treścią. Ten plik dowodzi dwóch rzeczy, które host
// zakłada: gniazdo przyjmuje zamrożone właściwości (`slotTypes.ts`) dla każdego
// stanu zgłoszenia i nie wnosi do drzewa ani węzła, ani naruszenia dostępności.
// Tor A przepisuje ten plik razem z gniazdem.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { RegistrationCardRemindersSlot } from "@/components/events/participant/slots/RegistrationCardRemindersSlot";
import { axeViolations, summarize } from "@/test/axe";
import { makeParticipantRegistration } from "@/test/events/participantFixtures";

describe("RegistrationCardRemindersSlot - zaślepka Foundation", () => {
  it("nie rysuje niczego dla typowych właściwości", () => {
    const { container } = render(
      <RegistrationCardRemindersSlot {...{ item: makeParticipantRegistration() }} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("nie rysuje niczego także dla stanu brzegowego", () => {
    const { container } = render(
      <RegistrationCardRemindersSlot
        {...{ item: makeParticipantRegistration({ status: "waitlist", paymentStatus: "unpaid" }) }}
      />,
    );

    expect(container.childNodes).toHaveLength(0);
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <RegistrationCardRemindersSlot {...{ item: makeParticipantRegistration() }} />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
