// Kontrakt wspólnej warstwy mutacji leada (used-by-both: drawer listy + karta
// /admin/crm/$id). Test blokuje: idempotencję dodania notatki, inwalidację
// wspólnego klucza ["crm-lead", id], wywołanie callbacków side-effekt i push
// Merydian. Dzięki temu dedup nie zmienia zachowania żadnej z powierzchni.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  addCrmNote: vi.fn(async (_a?: unknown) => ({ ok: true }) as unknown),
  deleteCrmNote: vi.fn(async (_a?: unknown) => ({ ok: true }) as unknown),
  pushLeadToMerydian: vi.fn(async (_a?: unknown) => ({ ok: true, via: "api" }) as unknown),
  idemKey: vi.fn((action: string) => `idem:${action}`),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/crm.functions", () => ({
  addCrmNote: (a: unknown) => h.addCrmNote(a),
  deleteCrmNote: (a: unknown) => h.deleteCrmNote(a),
  pushLeadToMerydian: (a: unknown) => h.pushLeadToMerydian(a),
}));
vi.mock("@/lib/http/idempotency", () => ({
  newIdempotencyKey: (action: string) => h.idemKey(action),
}));
vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { useLeadNoteMutations, useMerydianPush } from "../leadMutations";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  h.addCrmNote.mockClear();
  h.deleteCrmNote.mockClear();
  h.pushLeadToMerydian.mockClear();
  h.idemKey.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
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

describe("useMerydianPush", () => {
  it("sukces toastuje kanał (via)", async () => {
    h.pushLeadToMerydian.mockResolvedValueOnce({ ok: true, via: "hubspot" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMerydianPush("lead-4"), { wrapper: wrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.pushLeadToMerydian).toHaveBeenCalledWith({ data: { lead_id: "lead-4" } });
    expect(h.toastSuccess).toHaveBeenCalledWith("Merydian: hubspot");
  });

  it("odmowa (ok=false) toastuje błąd z payloadu", async () => {
    h.pushLeadToMerydian.mockResolvedValueOnce({ ok: false, error: "no endpoint" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMerydianPush("lead-5"), { wrapper: wrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.toastError).toHaveBeenCalledWith("Merydian: no endpoint");
  });
});
