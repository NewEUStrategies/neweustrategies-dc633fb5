// GNIAZDO `ManageTicketActionsSlot` - test zaślepki Foundation (WŁAŚCICIEL: tor B).
//
// Zaślepka nie rysuje NICZEGO: host montuje gniazdo od pierwszego dnia, a tor
// B dopiero wypełni je treścią. Ten plik dowodzi dwóch rzeczy, które host
// zakłada: gniazdo przyjmuje zamrożone właściwości (`slotTypes.ts`) dla każdego
// stanu zgłoszenia i nie wnosi do drzewa ani węzła, ani naruszenia dostępności.
// Tor B przepisuje ten plik razem z gniazdem.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ManageTicketActionsSlot } from "@/components/events/participant/slots/ManageTicketActionsSlot";
import { axeViolations, summarize } from "@/test/axe";
import {
  PARTICIPANT_EVENT_SLUG,
  makeRegistrationManageView,
} from "@/test/events/participantFixtures";

/** 24 bajty w base64url - kształt klucza `manage_token`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

describe("ManageTicketActionsSlot - zaślepka Foundation", () => {
  it("nie rysuje niczego dla typowych właściwości", () => {
    const { container } = render(
      <ManageTicketActionsSlot
        {...{
          slug: PARTICIPANT_EVENT_SLUG,
          token: MANAGE_TOKEN,
          view: makeRegistrationManageView(),
        }}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("nie rysuje niczego także dla stanu brzegowego", () => {
    const { container } = render(
      <ManageTicketActionsSlot
        {...{
          slug: PARTICIPANT_EVENT_SLUG,
          token: null,
          view: makeRegistrationManageView({ ownedByCaller: true }),
        }}
      />,
    );

    expect(container.childNodes).toHaveLength(0);
  });

  it("nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <ManageTicketActionsSlot
        {...{
          slug: PARTICIPANT_EVENT_SLUG,
          token: MANAGE_TOKEN,
          view: makeRegistrationManageView(),
        }}
      />,
    );

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
