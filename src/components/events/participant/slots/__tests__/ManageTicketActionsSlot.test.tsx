// GNIAZDO `ManageTicketActionsSlot` (WŁAŚCICIEL: tor B) - zasady zwrotu
// opłaconego zgłoszenia na stronie samoobsługi (REG-03).
//
// CO TEN PLIK DOWODZI:
//  1. Zgłoszenie z pełnym zwrotem w terminie mówi, DO KIEDY - w strefie
//     wydarzenia (godzina wydarzenia, nie maszyny).
//  2. Po terminie albo bez samodzielnych zwrotów mówi, że zwrot zależy od
//     organizatora - zanim uczestnik w ogóle sięgnie po rezygnację.
//  3. Gniazdo MILCZY bez pieniędzy (bezpłatne, bilet z planu), przy zgłoszeniu
//     zamkniętym, bez klucza i przy bazie bez podglądu.
//  4. Gniazdo pyta o podgląd TYM SAMYM kluczem zapytania co panel - jedna
//     odpowiedź, jedno zdanie (`cancellationPreviewKey`).
//  5. Brak naruszeń axe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import type { CancellationPreview, CancellationRefund } from "@/lib/events/cancellationPreview";
import { cancellationPreviewKey } from "@/lib/events/useCancellationPreview";
import { axeViolations, summarize } from "@/test/axe";
import {
  PARTICIPANT_EVENT_SLUG,
  makeRegistrationManageView,
} from "@/test/events/participantFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  preview: null as unknown,
  calls: [] as unknown[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/events/publicRegistrationApi", () => ({
  fetchCancellationPreview: (input: unknown) => {
    h.calls.push(input);
    return Promise.resolve(h.preview);
  },
}));

vi.mock("@/lib/community/publicQueries", () => ({
  fetchEventPageHeader: () => Promise.resolve({ timezone: "Europe/Warsaw" }),
}));

const { ManageTicketActionsSlot } =
  await import("@/components/events/participant/slots/ManageTicketActionsSlot");

/** 24 bajty w base64url - kształt klucza `manage_token`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

function podglad(refund: Partial<CancellationRefund> | null): CancellationPreview {
  return {
    kind: "ok",
    registrationId: "r1",
    status: "approved",
    canCancel: refund !== null,
    refusal: refund === null ? "already_closed" : null,
    refund:
      refund === null
        ? null
        : {
            effect: "none",
            reviewReason: null,
            amountCents: null,
            currency: null,
            refundMode: null,
            refundDeadlineAt: null,
            groupGuestsClosing: 0,
            acknowledgementRequired: false,
            ...refund,
          },
  };
}

function renderuj(token: string | null = MANAGE_TOKEN) {
  return renderWithQueryClient(
    <ManageTicketActionsSlot
      slug={PARTICIPANT_EVENT_SLUG}
      token={token}
      view={makeRegistrationManageView()}
    />,
  );
}

beforeEach(() => {
  h.preview = podglad({ effect: "none" });
  h.calls = [];
});

describe("ManageTicketActionsSlot - zasady zwrotu (REG-03)", () => {
  it("pełny zwrot w terminie mówi, DO KIEDY - w godzinie wydarzenia", async () => {
    h.preview = podglad({
      effect: "full_refund",
      amountCents: 10000,
      currency: "PLN",
      refundMode: "policy",
      refundDeadlineAt: "2030-06-03T08:00:00.000Z",
      acknowledgementRequired: true,
    });
    renderuj();

    expect(
      await screen.findByText(
        "eventRegistration.cancelRefund.policyUntil(date=3 czerwca 2030 10:00)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "eventRegistration.cancelRefund.policyTitle" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["no_refund", "outside_refund_window"],
    ["no_refund", "refund_disabled"],
    ["organizer_review", "shared_payment"],
  ] as const)("skutek %s (%s): zwrot zależy od organizatora", async (effect, reviewReason) => {
    h.preview = podglad({ effect, reviewReason, acknowledgementRequired: true });
    renderuj();

    expect(
      await screen.findByText("eventRegistration.cancelRefund.policyNone"),
    ).toBeInTheDocument();
  });

  it.each([
    ["bezpłatne", podglad({ effect: "none" })],
    ["bilet z planu", podglad({ effect: "included_ticket" })],
    ["zamknięte", podglad(null)],
    ["baza bez podglądu", { kind: "unavailable" } as CancellationPreview],
    ["wygasły klucz", { kind: "expired" } as CancellationPreview],
  ])("milczy: %s", async (_opis, value) => {
    h.preview = value;
    const { container } = renderuj();
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(container.innerHTML).toBe("");
  });

  it("bez klucza nie pyta bazy i nie rysuje niczego", () => {
    const { container } = renderuj(null);
    expect(h.calls).toEqual([]);
    expect(container.innerHTML).toBe("");
  });

  it("pyta tym samym kluczem zapytania co panel - jedna odpowiedź w cache", async () => {
    const { queryClient } = renderuj();
    await waitFor(() =>
      expect(
        queryClient.getQueryData(cancellationPreviewKey(PARTICIPANT_EVENT_SLUG, MANAGE_TOKEN)),
      ).toBeDefined(),
    );
    expect(h.calls).toEqual([{ manageToken: MANAGE_TOKEN }]);
  });

  it("nie wnosi naruszeń axe", async () => {
    h.preview = podglad({
      effect: "full_refund",
      refundDeadlineAt: "2030-06-03T08:00:00.000Z",
      acknowledgementRequired: true,
    });
    const { container } = renderuj();
    await screen.findByText(/cancelRefund\.policyUntil/);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
