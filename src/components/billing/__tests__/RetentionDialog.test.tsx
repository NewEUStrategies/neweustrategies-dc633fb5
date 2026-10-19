// Dialog anulowania - ŚCIEŻKA REZYGNACJI (S2, P01, P02, Z-09).
//
// Rezygnacja zablokowana albo POZORNIE WYKONANA to ryzyko prawne (DSA art. 25,
// wytyczne UOKiK), więc ten plik liczy KLIKNIĘCIA do anulowania i pilnuje:
//   1. NAJWYŻEJ 2 KROKI - „Anuluj mimo to" jest widoczne na każdym kroku,
//      z ankiety i z oferty to jedno kliknięcie;
//   2. `retention_settings.enabled = false` = samo potwierdzenie (bez ankiety);
//   3. przepływ w bazie: otwarcie -> `startRetentionFlow`, decyzja -> TEN SAM
//      wiersz (`feedbackId`) z `canceled`/`saved`, brak powodu = `null`
//      (serwer zapisze `not_given`, Z-09);
//   4. awaria startu przepływu, zapisu ankiety albo oferty NIE blokuje wyjścia;
//   5. okno zamyka się wyłącznie po UDANEJ rezygnacji;
//   6. dostępność (axe) na każdym kroku.
//
// Asercje idą na KLUCZE i18n (`translateKey`), nie na polski tekst.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { retentionReasons } from "@/test/billing/fixtures";
import { axeViolations, summarize } from "@/test/axe";
import type { RetentionReasonRow } from "@/lib/retention/queries";
import type { RetentionFlowStart } from "@/lib/retention/functions";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  reasons: { current: [] as RetentionReasonRow[], isLoading: false },
  startFlow: vi.fn(),
  submitFeedback: vi.fn(),
  acceptOffer: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});
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
  useRetentionReasons: () => ({ data: h.reasons.current, isLoading: h.reasons.isLoading }),
  reasonLabel: (reason: RetentionReasonRow, lang: string) =>
    lang === "en" ? reason.label_en : reason.label_pl,
}));

import { RetentionDialog } from "@/components/billing/organisms/RetentionDialog";

const FEEDBACK_ID = "55555555-5555-4555-8555-555555555555";

function flow(over: Partial<RetentionFlowStart> = {}): RetentionFlowStart {
  return {
    feedbackId: FEEDBACK_ID,
    surveyEnabled: true,
    offer: { available: true, discountPct: 30, discountPeriods: 3 },
    ...over,
  };
}

function renderDialog(options: { cancel?: () => Promise<void> | void } = {}) {
  const onConfirmCancel = vi.fn(options.cancel ?? (() => Promise.resolve()));
  const onOpenChange = vi.fn();
  const view = renderWithQueryClient(
    <RetentionDialog
      open
      onOpenChange={onOpenChange}
      subscriptionId="sub-1"
      accessUntil="2026-09-30T00:00:00.000Z"
      onConfirmCancel={onConfirmCancel}
    />,
  );
  return { ...view, onConfirmCancel, onOpenChange };
}

const click = (key: string) => fireEvent.click(screen.getByText(key));
const phase = () =>
  document.querySelector("[data-retention-phase]")?.getAttribute("data-retention-phase");

async function opened(expected: string) {
  await waitFor(() => expect(phase()).toBe(expected));
}

beforeEach(() => {
  h.lang.current = "pl";
  h.reasons.current = retentionReasons();
  h.reasons.isLoading = false;
  h.startFlow.mockReset().mockResolvedValue(flow());
  h.submitFeedback.mockReset().mockResolvedValue({ ok: true, feedbackId: FEEDBACK_ID });
  h.acceptOffer.mockReset().mockResolvedValue({ ok: true, discountPct: 30, discountPeriods: 3 });
});

describe("liczba kroków do anulowania (≤ 2)", () => {
  it("retencja wyłączona: samo potwierdzenie - 1 kliknięcie anuluje", async () => {
    h.startFlow.mockResolvedValue(
      flow({ surveyEnabled: false, offer: { available: false, reason: "disabled" } }),
    );
    const { onConfirmCancel } = renderDialog();
    await opened("confirm");

    expect(screen.queryByText("retention.reasonHeading")).toBeNull();
    click("profile.retentionFlow.confirmCancel");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("ankieta z ofertą: „Anuluj mimo to” jest na kroku 1 i anuluje jednym kliknięciem", async () => {
    const { onConfirmCancel } = renderDialog();
    await opened("reason");

    expect(screen.getByText("profile.retentionFlow.cancelAnyway")).toBeTruthy();
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("przez ofertę: dokładnie 2 kroki, „Anuluj mimo to” widoczne także na kroku 2", async () => {
    const { onConfirmCancel } = renderDialog();
    await opened("reason");
    expect(document.querySelector("[data-retention-step='1']")).not.toBeNull();

    click("profile.retentionFlow.next");
    await opened("offer");
    expect(document.querySelector("[data-retention-step='2']")).not.toBeNull();
    expect(onConfirmCancel).not.toHaveBeenCalled();

    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("bez należnej oferty nie ma kroku 2 (brak „Dalej”)", async () => {
    h.startFlow.mockResolvedValue(
      flow({ offer: { available: false, reason: "already_redeemed" } }),
    );
    renderDialog();
    await opened("reason");
    expect(screen.queryByText("profile.retentionFlow.next")).toBeNull();
    expect(document.querySelector("[data-retention-step]")).toBeNull();
  });

  it("w trakcie startu przepływu anulowanie już działa (nic nie czeka na serwer)", async () => {
    h.startFlow.mockReturnValue(new Promise(() => {}));
    const { onConfirmCancel } = renderDialog();
    expect(phase()).toBe("loading");
    click("profile.retentionFlow.confirmCancel");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("awaria startu przepływu degraduje do potwierdzenia, nie blokuje anulowania", async () => {
    h.startFlow.mockRejectedValue(new Error("network"));
    const { onConfirmCancel } = renderDialog();
    await opened("confirm");
    click("profile.retentionFlow.confirmCancel");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });
});

describe("zapis przepływu (ten sam wiersz)", () => {
  it("otwarcie woła startRetentionFlow z subskrypcją", async () => {
    renderDialog();
    await opened("reason");
    expect(h.startFlow).toHaveBeenCalledWith({ data: { subscriptionId: "sub-1" } });
  });

  it("anulowanie bez powodu: canceled, feedbackId przepływu, powód null (Z-09)", async () => {
    renderDialog();
    await opened("reason");
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalledTimes(1));
    expect(h.submitFeedback).toHaveBeenCalledWith({
      data: expect.objectContaining({
        feedbackId: FEEDBACK_ID,
        outcome: "canceled",
        reasonId: null,
        reasonLabel: null,
        offerShown: false,
      }),
    });
  });

  it("wybrany powód i komentarz trafiają do ankiety; oferta pokazana = offerShown", async () => {
    renderDialog();
    await opened("reason");
    const reason = h.reasons.current[0]!;
    fireEvent.click(screen.getByText(reason.label_pl));
    fireEvent.change(screen.getByLabelText("retention.commentLabel"), {
      target: { value: "  za drogo  " },
    });
    click("profile.retentionFlow.next");
    await opened("offer");
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalledTimes(1));
    expect(h.submitFeedback.mock.calls[0]![0].data).toMatchObject({
      reasonId: reason.id,
      reasonLabel: reason.label_pl,
      comment: "za drogo",
      offerShown: true,
      outcome: "canceled",
    });
  });

  it("„Inny powód” to świadomy wybór (etykieta), nie brak powodu", async () => {
    renderDialog();
    await opened("reason");
    fireEvent.click(screen.getByText("retention.otherReason"));
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(h.submitFeedback).toHaveBeenCalledTimes(1));
    expect(h.submitFeedback.mock.calls[0]![0].data).toMatchObject({
      reasonId: null,
      reasonLabel: "retention.otherReason",
    });
  });

  it("„Zostaw subskrypcję” zapisuje saved, zamyka okno i NIE anuluje", async () => {
    const { onConfirmCancel, onOpenChange } = renderDialog();
    await opened("reason");
    click("profile.retentionFlow.keep");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.submitFeedback.mock.calls[0]![0].data).toMatchObject({ outcome: "saved" }),
    );
  });

  it("ankieta zapisuje się dopiero PO udanym anulowaniu (porażka nie zostawia „canceled”)", async () => {
    renderDialog({ cancel: () => Promise.reject(new Error("refused")) });
    await opened("reason");
    click("profile.retentionFlow.cancelAnyway");
    await screen.findByRole("alert");
    expect(h.submitFeedback).not.toHaveBeenCalled();
  });

  it("awaria zapisu ankiety NIE blokuje zamknięcia po anulowaniu", async () => {
    h.submitFeedback.mockRejectedValue(new Error("analytics down"));
    const { onOpenChange } = renderDialog();
    await opened("reason");
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("oferta (P02: rabat na subskrypcji, bez kodu)", () => {
  it("przyjęcie: ten sam przepływ, potwierdzenie rabatu, bez anulowania", async () => {
    const { onConfirmCancel } = renderDialog();
    await opened("reason");
    click("profile.retentionFlow.next");
    await opened("offer");
    click('retention.offer.accept {"pct":30}');
    await opened("accepted");
    expect(h.acceptOffer).toHaveBeenCalledWith({
      data: expect.objectContaining({ subscriptionId: "sub-1", feedbackId: FEEDBACK_ID }),
    });
    expect(
      screen.getByText('profile.retentionFlow.accepted.body {"pct":30,"count":3}'),
    ).toBeTruthy();
    expect(onConfirmCancel).not.toHaveBeenCalled();
  });

  it("oferta wykorzystana w 180 dniach: znika akceptacja, zostaje „Anuluj mimo to”", async () => {
    h.acceptOffer.mockResolvedValue({ ok: false, reason: "already_redeemed" });
    const { onConfirmCancel } = renderDialog();
    await opened("reason");
    click("profile.retentionFlow.next");
    await opened("offer");
    click('retention.offer.accept {"pct":30}');
    await screen.findByText("retention.offer.alreadyRedeemed");
    expect(screen.queryByText('retention.offer.accept {"pct":30}')).toBeNull();
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });

  it("awaria operatora przy ofercie nie zamyka wyjścia", async () => {
    h.acceptOffer.mockRejectedValue(new Error("stripe down"));
    const { onConfirmCancel } = renderDialog();
    await opened("reason");
    click("profile.retentionFlow.next");
    await opened("offer");
    click('retention.offer.accept {"pct":30}');
    await screen.findByText("profile.retentionFlow.offer.unavailable");
    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(1));
  });
});

describe("okno zamyka się tylko po udanej rezygnacji", () => {
  it("porażka: okno zostaje z komunikatem i pozwala ponowić", async () => {
    let attempt = 0;
    const { onConfirmCancel, onOpenChange } = renderDialog({
      cancel: () => (attempt++ === 0 ? Promise.reject(new Error("refused")) : Promise.resolve()),
    });
    await opened("reason");
    click("profile.retentionFlow.cancelAnyway");
    expect((await screen.findByRole("alert")).textContent).toBe("retention.errors.cancel");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    click("profile.retentionFlow.cancelAnyway");
    await waitFor(() => expect(onConfirmCancel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("dostępność", () => {
  it.each(["confirm", "reason", "offer"] as const)("krok %s bez naruszeń axe", async (target) => {
    if (target === "confirm") {
      h.startFlow.mockResolvedValue(flow({ surveyEnabled: false }));
    }
    renderDialog();
    await opened(target === "offer" ? "reason" : target);
    if (target === "offer") {
      click("profile.retentionFlow.next");
      await opened("offer");
    }
    const dialog = screen.getByRole("dialog");
    let violations: Awaited<ReturnType<typeof axeViolations>> = [];
    await act(async () => {
      violations = await axeViolations(dialog);
    });
    expect(violations, summarize(violations)).toEqual([]);
  });
});
