// Molekuła skutku finansowego rezygnacji (REG-03).
//
// CO TEN PLIK DOWODZI:
//  1. Każdy skutek ma SWOJE zdanie - pełny zwrot z kwotą i terminem w strefie
//     wydarzenia, brak zwrotu po terminie / bez zwrotów, decyzja organizatora
//     (wspólna wpłata bez kwoty płatnika, wpłata ręczna), bilet z planu.
//  2. Rezygnacja bez pieniędzy nie rysuje NICZEGO (bez pustej ramki).
//  3. Goście grupy odwoływani razem z prowadzącym są policzeni.
//  4. Wczytywanie i błąd (z ponowieniem) to osobne stany - nie „brak skutku".
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { CancellationPreview, CancellationRefund } from "@/lib/events/cancellationPreview";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { CancellationFinancialEffect } =
  await import("@/components/events/registration/molecules/CancellationFinancialEffect");

function podglad(refund: Partial<CancellationRefund>): CancellationPreview {
  return {
    kind: "ok",
    registrationId: "r1",
    status: "approved",
    canCancel: true,
    refusal: null,
    refund: {
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

function renderuj(preview: CancellationPreview | undefined, isError = false) {
  const onRetry = vi.fn();
  const view = render(
    <CancellationFinancialEffect
      preview={preview}
      isError={isError}
      onRetry={onRetry}
      timezone="Europe/Warsaw"
    />,
  );
  return { ...view, onRetry };
}

const B = "eventRegistration.cancelRefund";

describe("CancellationFinancialEffect", () => {
  it("pełny zwrot: kwota i termin w strefie WYDARZENIA", () => {
    renderuj(
      podglad({
        effect: "full_refund",
        amountCents: 10000,
        currency: "PLN",
        refundDeadlineAt: "2026-09-08T08:00:00Z",
      }),
    );
    expect(screen.getByText(new RegExp(`${B}\\.fullRefund\\(amount=100,00`))).toBeInTheDocument();
    expect(screen.getByText(`${B}.deadline(date=8 września 2026 10:00)`)).toBeInTheDocument();
  });

  it.each([
    [{ effect: "no_refund", reviewReason: "refund_disabled" }, `${B}.noRefundDisabled`],
    [{ effect: "no_refund", reviewReason: "outside_refund_window" }, `${B}.noRefundWindowPlain`],
    [{ effect: "organizer_review", reviewReason: "shared_payment" }, `${B}.reviewShared`],
    [{ effect: "organizer_review", reviewReason: "manual_payment" }, `${B}.reviewManual`],
    [{ effect: "organizer_review", reviewReason: null }, `${B}.reviewGeneric`],
    [{ effect: "included_ticket" }, `${B}.includedTicket`],
  ] as const)("skutek %j ma własne zdanie", (refund, key) => {
    renderuj(podglad(refund));
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it("wspólna wpłata nie pokazuje żadnej kwoty", () => {
    const { container } = renderuj(
      podglad({ effect: "organizer_review", reviewReason: "shared_payment", amountCents: null }),
    );
    expect(container.textContent).not.toMatch(/amount=/);
  });

  it("rezygnacja bez pieniędzy nie rysuje niczego", () => {
    const { container } = renderuj(podglad({ effect: "none" }));
    expect(container.innerHTML).toBe("");
  });

  it("goście grupy odwoływani razem z prowadzącym są policzeni", () => {
    renderuj(
      podglad({ effect: "full_refund", amountCents: 3000, currency: "PLN", groupGuestsClosing: 2 }),
    );
    expect(screen.getByText(`${B}.groupGuests(count=2)`)).toBeInTheDocument();
  });

  it("wczytywanie i błąd z ponowieniem to osobne stany", () => {
    const { rerender, onRetry } = renderuj(undefined);
    expect(screen.getByRole("status")).toHaveTextContent(`${B}.loading`);

    rerender(
      <CancellationFinancialEffect preview={undefined} isError onRetry={onRetry} timezone={null} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(`${B}.loadError`);
    fireEvent.click(screen.getByRole("button", { name: `${B}.retry` }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
