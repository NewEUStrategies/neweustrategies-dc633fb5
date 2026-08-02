// Kontrakt wspólnej warstwy mutacji leada (used-by-both: drawer listy + karta
// /admin/crm/$id). Test blokuje: idempotencję dodania notatki, inwalidację
// wspólnego klucza ["crm-lead", id], wywołanie callbacków side-effekt i push
// do partnerów CRM (outbox). Dedup nie zmienia zachowania żadnej powierzchni.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  addCrmNote: vi.fn(async (_a?: unknown) => ({ ok: true }) as unknown),
  deleteCrmNote: vi.fn(async (_a?: unknown) => ({ ok: true }) as unknown),
  pushLeadToPartners: vi.fn(
    async (_a?: unknown) => ({ ok: true, enqueued: 1, delivered: 1, failed: 0 }) as unknown,
  ),
  idemKey: vi.fn((action: string) => `idem:${action}`),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/lib/crm.functions", () => ({
  addCrmNote: (a: unknown) => h.addCrmNote(a),
  deleteCrmNote: (a: unknown) => h.deleteCrmNote(a),
  pushLeadToPartners: (a: unknown) => h.pushLeadToPartners(a),
}));
vi.mock("@/lib/http/idempotency", () => ({
  newIdempotencyKey: (action: string) => h.idemKey(action),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
    info: (m: string) => h.toastInfo(m),
  },
}));

import { useLeadNoteMutations, usePartnerPush } from "../leadMutations";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  h.addCrmNote.mockClear();
  h.deleteCrmNote.mockClear();
  h.pushLeadToPartners.mockClear();
  h.idemKey.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastInfo.mockClear();
});

describe("useLeadNoteMutations", () => {
  it("dodaje notatkę z kluczem idempotencji, inwaliduje klucz leada i woła onAdded", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const onAdded = vi.fn();
    const { result } = renderHook(() => useLeadNoteMutations("lead-1", { onAdded }), {
      wrapper: wrapper(qc),
    });

    result.current.addNote.mutate("treść notatki");
    await waitFor(() => expect(result.current.addNote.isSuccess).toBe(true));

    expect(h.idemKey).toHaveBeenCalledWith("crm.add_note");
    expect(h.addCrmNote).toHaveBeenCalledWith({
      data: { lead_id: "lead-1", body: "treść notatki", idempotency_key: "idem:crm.add_note" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["crm-lead", "lead-1"] });
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("usuwa notatkę, inwaliduje i woła onDeleted", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useLeadNoteMutations("lead-2", { onDeleted }), {
      wrapper: wrapper(qc),
    });

    result.current.deleteNote.mutate("note-9");
    await waitFor(() => expect(result.current.deleteNote.isSuccess).toBe(true));

    expect(h.deleteCrmNote).toHaveBeenCalledWith({ data: { id: "note-9" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["crm-lead", "lead-2"] });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("błąd dodania notatki toastuje komunikat i nie woła onAdded", async () => {
    h.addCrmNote.mockRejectedValueOnce(new Error("boom"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onAdded = vi.fn();
    const { result } = renderHook(() => useLeadNoteMutations("lead-3", { onAdded }), {
      wrapper: wrapper(qc),
    });

    result.current.addNote.mutate("x");
    await waitFor(() => expect(result.current.addNote.isError).toBe(true));

    expect(h.toastError).toHaveBeenCalledWith("boom");
    expect(onAdded).not.toHaveBeenCalled();
  });
});

describe("usePartnerPush", () => {
  it("dostarczenie od ręki toastuje sukces z licznikiem (PL)", async () => {
    h.pushLeadToPartners.mockResolvedValueOnce({ ok: true, enqueued: 2, delivered: 2, failed: 0 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePartnerPush("lead-4", "pl"), { wrapper: wrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.pushLeadToPartners).toHaveBeenCalledWith({ data: { lead_id: "lead-4" } });
    expect(h.toastSuccess).toHaveBeenCalledWith("Wysłano do partnerów CRM (2/2)");
  });

  it("enqueue bez natychmiastowej dostawy toastuje info o kolejce (EN)", async () => {
    h.pushLeadToPartners.mockResolvedValueOnce({ ok: true, enqueued: 1, delivered: 0, failed: 1 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePartnerPush("lead-5", "en"), { wrapper: wrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.toastInfo).toHaveBeenCalledWith("Queued for delivery (1) - automatic retry");
  });

  it("brak aktywnych partnerów (ok=false) toastuje błąd", async () => {
    h.pushLeadToPartners.mockResolvedValueOnce({
      ok: false,
      enqueued: 0,
      delivered: 0,
      failed: 0,
      error: "no_active_endpoints",
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePartnerPush("lead-6", "pl"), { wrapper: wrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.toastError).toHaveBeenCalledWith(
      "Brak aktywnych partnerów CRM - dodaj endpoint w zakładce Integracje",
    );
  });
});
