// GNIAZDO `EventMeFollowUpSlot` - test zaślepki Foundation (WŁAŚCICIEL: tor C).
//
// Zaślepka nie rysuje NICZEGO: host montuje gniazdo od pierwszego dnia, a tor
// C dopiero wypełni je treścią. Ten plik dowodzi dwóch rzeczy, które host
// zakłada: gniazdo przyjmuje zamrożone właściwości (`slotTypes.ts`) dla każdego
// stanu zgłoszenia i nie wnosi do drzewa ani węzła, ani naruszenia dostępności.
// Tor C przepisuje ten plik razem z gniazdem.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { EventMeFollowUpSlot } from "@/components/events/participant/slots/EventMeFollowUpSlot";
import { axeViolations, summarize } from "@/test/axe";
import {
  PARTICIPANT_EVENT_SLUG,
  makeEventParticipantOptions,
  makeMyEventRegistrationSummary,
} from "@/test/events/participantFixtures";

describe("EventMeFollowUpSlot - zaślepka Foundation", () => {
  it("nie rysuje niczego dla typowych właściwości", () => {
    const { container } = render(
      <EventMeFollowUpSlot
        {...{
          slug: PARTICIPANT_EVENT_SLUG,
          registration: makeMyEventRegistrationSummary(),
          options: makeEventParticipantOptions({ certificateEnabled: true }),
        }}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("nie rysuje niczego także dla stanu brzegowego", () => {
    const { container } = render(
      <EventMeFollowUpSlot
        {...{ slug: PARTICIPANT_EVENT_SLUG, registration: null, options: null }}
      />,
    );

    expect(container.childNodes).toHaveLength(0);
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <EventMeFollowUpSlot
        {...{
          slug: PARTICIPANT_EVENT_SLUG,
          registration: makeMyEventRegistrationSummary(),
          options: makeEventParticipantOptions({ certificateEnabled: true }),
        }}
      />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
