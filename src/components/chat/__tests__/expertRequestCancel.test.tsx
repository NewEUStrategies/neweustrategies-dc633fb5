// Ścieżka wycofania zapytania: od migracji 20260806160000 anulowanie NIE zwraca
// puli miesięcznej (licznik liczy wszystkie wysłane, inaczej pętla „wyślij →
// anuluj → wyślij” czyniła limit fikcją). Skoro cena kliknięcia wzrosła, UI
// musi ją pokazać PRZED wywołaniem RPC - te testy pilnują, że przycisk otwiera
// potwierdzenie, a nie od razu mutację, i że komunikat o puli tam jest.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ExpertRequestQuota, ExpertRequestRow } from "@/lib/chat/useExpertRequests";

const h = vi.hoisted(() => ({
  rows: [] as ExpertRequestRow[],
  resolveSpy: vi.fn(async () => ({ status: "cancelled" })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  quota: {
    data: undefined as ExpertRequestQuota | undefined,
    isPending: false,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-expert-request", () => ({ ensureI18n: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => h.toastSuccess(...a),
    error: (...a: unknown[]) => h.toastError(...a),
  },
}));

vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequests: () => ({ data: h.rows, isPending: false }),
  useMyExpertRequestQuota: () => h.quota,
  useResolveExpertRequest: () => ({ mutateAsync: h.resolveSpy, isPending: false }),
}));

import { ExpertRequestList } from "@/components/chat/ExpertRequestList";

function row(overrides: Partial<ExpertRequestRow> = {}): ExpertRequestRow {
  return {
    id: "req-1",
    subject: "Regulacja AI w UE",
    reason: "Chcę omówić stanowisko branży wobec projektu rozporządzenia.",
    status: "pending",
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  } as ExpertRequestRow;
}

beforeEach(() => {
  h.rows = [row()];
  h.resolveSpy.mockClear();
  h.resolveSpy.mockResolvedValue({ status: "cancelled" });
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.quota = { data: undefined, isPending: false };
});

describe("wycofanie zapytania (skrzynka „Wysłane”)", () => {
  it("kliknięcie „Wycofaj” NIE wywołuje RPC, tylko otwiera potwierdzenie", () => {
    renderWithQueryClient(<ExpertRequestList box="sent" />);

    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.cancel" }));

    expect(h.resolveSpy).not.toHaveBeenCalled();
    expect(screen.getByText("expertRequest.confirmCancel.title")).toBeInTheDocument();
    // Cena operacji: pula NIE wraca. To zdanie jest sedno tej zmiany.
    expect(screen.getByText("expertRequest.confirmCancel.description")).toBeInTheDocument();
  });

  it("potwierdzenie wysyła akcję cancel dla właściwego wiersza", async () => {
    h.rows = [row({ id: "req-42" })];
    renderWithQueryClient(<ExpertRequestList box="sent" />);

    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.confirmCancel.confirm" }));

    await waitFor(() =>
      expect(h.resolveSpy).toHaveBeenCalledWith({ requestId: "req-42", action: "cancel" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("expertRequest.confirmCancel.doneToast"),
    );
  });

  it("rezygnacja z potwierdzenia zostawia zapytanie w spokoju", () => {
    renderWithQueryClient(<ExpertRequestList box="sent" />);

    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.confirmCancel.keep" }));

    expect(h.resolveSpy).not.toHaveBeenCalled();
  });

  it("odmowa serwera trafia w konkretny komunikat, nie w „Spróbuj ponownie”", async () => {
    h.resolveSpy.mockRejectedValueOnce(new Error("expert_request: invalid status transition"));
    renderWithQueryClient(<ExpertRequestList box="sent" />);

    fireEvent.click(screen.getByRole("button", { name: "expertRequest.actions.cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "expertRequest.confirmCancel.confirm" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("expertRequest.error.invalidTransition"),
    );
  });

  it("skrzynka „Otrzymane” nie oferuje wycofania (to prawo nadawcy)", () => {
    renderWithQueryClient(<ExpertRequestList box="received" />);

    expect(
      screen.queryByRole("button", { name: "expertRequest.actions.cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "expertRequest.actions.approve" }),
    ).toBeInTheDocument();
  });

  it("wiersz rozstrzygnięty nie ma już akcji (maszyna stanów serwera)", () => {
    h.rows = [row({ status: "approved" })];
    renderWithQueryClient(<ExpertRequestList box="sent" />);

    expect(
      screen.queryByRole("button", { name: "expertRequest.actions.cancel" }),
    ).not.toBeInTheDocument();
  });
});
