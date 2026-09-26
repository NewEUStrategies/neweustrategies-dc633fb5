// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Funkcja serwerowa powiadomien: transport, nie granica bezpieczenstwa.
// Pilnujemy walidatora wejscia (1-200 identyfikatorow UUID), bramki
// sesji w middleware i tego, ze handler oddaje KLIENTA UZYTKOWNIKA
// (z kontekstu middleware) - autoryzuje baza, nie serwer.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const { notifyIssuedInvoices } = vi.hoisted(() => ({ notifyIssuedInvoices: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/events/eventInvoiceNotify.server", () => ({ notifyIssuedInvoices }));

const { notifyEventInvoicesIssued } = await import("@/lib/events/eventInvoiceNotify.functions");

const ID = "27f00000-0000-4000-8000-000000000001";

beforeEach(() => {
  notifyIssuedInvoices.mockReset();
});

describe("notifyEventInvoicesIssued", () => {
  it("wymaga sesji (middleware requireSupabaseAuth)", () => {
    expect(serverFnMiddlewareNames(notifyEventInvoicesIssued)).toEqual(["requireSupabaseAuth"]);
  });

  it("walidator: 1-200 identyfikatorow UUID", () => {
    expect(validateServerFnInput(notifyEventInvoicesIssued, { invoiceIds: [ID] })).toEqual({
      invoiceIds: [ID],
    });
    for (const input of [
      {},
      { invoiceIds: [] },
      { invoiceIds: ["nie-uuid"] },
      { invoiceIds: Array.from({ length: 201 }, () => ID) },
    ]) {
      expect(() => validateServerFnInput(notifyEventInvoicesIssued, input)).toThrow();
    }
  });

  it("handler przekazuje klienta uzytkownika i identyfikatory", async () => {
    const supabase = { rpc: vi.fn() };
    notifyIssuedInvoices.mockResolvedValue({ sent: 1, skipped: 0, failed: 0 });
    await expect(
      callServerFn(notifyEventInvoicesIssued, {
        data: { invoiceIds: [ID] },
        context: { supabase },
      }),
    ).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(notifyIssuedInvoices).toHaveBeenCalledWith(supabase, [ID]);
  });
});
