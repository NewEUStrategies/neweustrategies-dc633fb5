// Dialog anulowania - CYKL ŻYCIA OKNA i wyjścia poboczne (S2).
//
// Podstawowy plik (`RetentionDialog.test.tsx`) liczy kroki do anulowania.
// Ten pilnuje tego, co dzieje się MIĘDZY krokami:
//   * Escape w spoczynku zamyka okno bez anulowania i BEZ zapisu decyzji
//     (przepływ zostaje `started`, skaner domknie go jako porzucony);
//   * Escape w trakcie anulowania jest ignorowany - okno czeka na wynik;
//   * ponowne otwarcie zaczyna od czystego stanu i wznawia przepływ
//     (`startRetentionFlow` woła się przy każdym otwarciu);
//   * „zobacz tańsze plany" zamyka okno bez anulowania.
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { retentionReasons } from "@/test/billing/fixtures";
import type { RetentionReasonRow } from "@/lib/retention/queries";

const h = vi.hoisted(() => ({
  reasons: { current: [] as RetentionReasonRow[] },
  startFlow: vi.fn(),
  submitFeedback: vi.fn(),
  acceptOffer: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());
vi.mock("@/lib/i18n-retention", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => {} }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/retention/functions", () => ({
  startRetentionFlow: (arg: unknown) => h.startFlow(arg),
  submitRetentionFeedback: (arg: unknown) => h.submitFeedback(arg),
  acceptRetentionOffer: (arg: unknown) => h.acceptOffer(arg),
}));
vi.mock("@/lib/retention/queries", () => ({
  useRetentionReasons: () => ({ data: h.reasons.current, isLoading: false }),
  reasonLabel: (reason: RetentionReasonRow) => reason.label_pl,
}));

import { RetentionDialog } from "@/components/billing/organisms/RetentionDialog";

const FLOW = {
  feedbackId: "55555555-5555-4555-8555-555555555555",
  surveyEnabled: true,
  offer: { available: true, discountPct: 30, discountPeriods: 3 },
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderControlled(cancel: () => Promise<void> = () => Promise.resolve()) {
  const onConfirmCancel = vi.fn(cancel);
  const onOpenChange = vi.fn();
  const view = render(
    <RetentionDialog
      open
      onOpenChange={onOpenChange}
      subscriptionId="sub-1"
      onConfirmCancel={onConfirmCancel}
    />,
  );
  return { ...view, onConfirmCancel, onOpenChange };
}

/** Rodzic jak w produkcji: trzyma `open` w stanie i otwiera okno ponownie. */
function Host({ onConfirmCancel }: { onConfirmCancel: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        otwórz-ponownie
      </button>
      <RetentionDialog
        open={open}
        onOpenChange={setOpen}
        subscriptionId="sub-1"
        onConfirmCancel={onConfirmCancel}
      />
    </>
  );
}

const clickKey = (key: string) => fireEvent.click(screen.getByText(key));
const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
const phase = () =>
  document.querySelector("[data-retention-phase]")?.getAttribute("data-retention-phase");

beforeEach(() => {
  h.reasons.current = retentionReasons();
  h.startFlow.mockReset().mockResolvedValue(FLOW);
  h.submitFeedback.mockReset().mockResolvedValue({ ok: true, feedbackId: FLOW.feedbackId });
  h.acceptOffer.mockReset().mockResolvedValue({ ok: true, discountPct: 30, discountPeriods: 3 });
});

describe("zamykanie okna", () => {
  it("Escape w spoczynku zamyka okno, NIE anuluje i NIE zapisuje decyzji", async () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();
    await waitFor(() => expect(phase()).toBe("reason"));

    pressEscape();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    expect(h.submitFeedback).not.toHaveBeenCalled();
  });

  it("Escape W TRAKCIE anulowania jest ignorowany - okno czeka na wynik", async () => {
    const pending = deferred();
    const { onOpenChange, onConfirmCancel } = renderControlled(() => pending.promise);
    await waitFor(() => expect(phase()).toBe("reason"));

    clickKey("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
    expect(screen.getByText("profile.retentionFlow.keep").closest("button")).toBeDisabled();

    pressEscape();
    expect(onOpenChange).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});

describe("ponowne otwarcie", () => {
  it("zaczyna od czystej ankiety i ponownie wznawia przepływ", async () => {
    render(<Host onConfirmCancel={() => Promise.resolve()} />);
    await waitFor(() => expect(phase()).toBe("reason"));
    fireEvent.click(screen.getByText(h.reasons.current[0]!.label_pl));
    clickKey("profile.retentionFlow.next");
    await waitFor(() => expect(phase()).toBe("offer"));

    pressEscape();
    await waitFor(() => expect(phase()).toBeUndefined());
    fireEvent.click(screen.getByText("otwórz-ponownie"));

    await waitFor(() => expect(phase()).toBe("reason"));
    expect(h.startFlow).toHaveBeenCalledTimes(2);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.some((r) => r.checked)).toBe(false);
  });
});

describe("wyjścia poboczne", () => {
  it("„zobacz plany” zamyka okno i NIE anuluje", async () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();
    await waitFor(() => expect(phase()).toBe("reason"));
    clickKey("profile.retentionFlow.next");
    await waitFor(() => expect(phase()).toBe("offer"));

    clickKey("retention.offer.downgradeCta");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });

  it("„zamknij” po przyjęciu oferty zamyka okno bez żądania anulowania", async () => {
    const { onOpenChange, onConfirmCancel } = renderControlled();
    await waitFor(() => expect(phase()).toBe("reason"));
    clickKey("profile.retentionFlow.next");
    await waitFor(() => expect(phase()).toBe("offer"));
    clickKey('retention.offer.accept {"pct":30}');
    await waitFor(() => expect(phase()).toBe("accepted"));

    clickKey("profile.retentionFlow.accepted.close");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });
});
