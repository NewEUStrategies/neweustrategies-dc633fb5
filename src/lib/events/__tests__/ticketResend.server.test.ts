// Bramka listy wykluczeń przed ponowną wysyłką biletu.
//
// DLACZEGO TEN TEST ISTNIEJE. Wiersz przepuszczony tutaj dostaje NOWY kod
// (stary przestaje wpuszczać), więc bramka musi pytać o dokładnie to, o co
// potem zapyta poczta: kategoria `transactional`, najemca wiersza, klucz
// serwisowy. Pomyłka w którąkolwiek stronę jest kosztowna - przepuszczony
// zablokowany adres traci działający bilet, a zatrzymany czysty adres nie
// dostaje biletu, o który organizator prosił.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  admin: { name: "atrapa-klucza-serwisowego" },
  checkSendAllowed: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.admin }));
vi.mock("@/lib/email/suppression.server", () => ({ checkSendAllowed: h.checkSendAllowed }));

const { suppressedTicketRecipients } = await import("@/lib/events/ticketResend.server");

const TENANT = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  h.checkSendAllowed.mockReset();
  h.checkSendAllowed.mockImplementation(async (_admin: unknown, input: { email: string }) => ({
    allowed: !input.email.startsWith("blocked") && input.email !== "",
    hit: null,
    tenantId: TENANT,
  }));
});

describe("suppressedTicketRecipients", () => {
  it("pusty zakres nie pyta bazy wcale", async () => {
    await expect(suppressedTicketRecipients([])).resolves.toEqual([]);
    expect(h.checkSendAllowed).not.toHaveBeenCalled();
  });

  it("oddaje wiersze z zablokowanym albo pustym adresem, w kolejności zakresu", async () => {
    const result = await suppressedTicketRecipients([
      { registration_id: "reg-lead", email: "lead@example.org", tenant_id: TENANT },
      { registration_id: "reg-blocked", email: "blocked@example.org", tenant_id: TENANT },
      { registration_id: "reg-empty", email: null, tenant_id: TENANT },
    ]);
    expect(result).toEqual(["reg-blocked", "reg-empty"]);
  });

  it("pyta tą samą bramką, co poczta: klucz serwisowy, kategoria transakcyjna, najemca wiersza", async () => {
    await suppressedTicketRecipients([
      { registration_id: "reg-lead", email: "lead@example.org", tenant_id: TENANT },
      { registration_id: "reg-empty", email: null, tenant_id: TENANT },
    ]);
    expect(h.checkSendAllowed).toHaveBeenCalledWith(h.admin, {
      email: "lead@example.org",
      category: "transactional",
      tenantId: TENANT,
    });
    // Pusty adres idzie jako pusty napis - bramka sama go zatrzymuje.
    expect(h.checkSendAllowed).toHaveBeenCalledWith(h.admin, {
      email: "",
      category: "transactional",
      tenantId: TENANT,
    });
  });
});
