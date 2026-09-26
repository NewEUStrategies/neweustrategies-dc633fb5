// Hooki panelu: powiązania grupy i ponowna wysyłka biletu.
//
// DLACZEGO TEN TEST ISTNIEJE. Dwie rzeczy, których nie zobaczy test panelu
// (tam oba hooki są atrapami):
//   1. KLUCZ POWIĄZAŃ SIEDZI POD GAŁĘZIĄ WYDARZENIA. Decyzja organizatora
//      unieważnia `registrationKeys.event(eventId)` - gdyby powiązania miały
//      własny korzeń, plakietka „bilet niewysłany" wisiałaby po przyjęciu grupy.
//   2. ODMOWA SERVER FN STAJE SIĘ WYJĄTKIEM. `resendEventTicket` oddaje
//      `{ ok: false, error }` zamiast rzucać; bez przełożenia na wyjątek
//      mutacja kończyłaby się „sukcesem" i panel pokazywałby toast o wysłaniu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchRegistrationGroupLinks: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/events/registrationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/registrationsApi")>()),
  fetchRegistrationGroupLinks: h.fetchRegistrationGroupLinks,
}));
vi.mock("@/lib/events/ticketResend.functions", () => ({
  resendEventTicket: { name: "resendEventTicket" },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "resendEventTicket" ? h.resend : () => Promise.reject(new Error("nieznana fn")),
}));

const { registrationKeys, useRegistrationGroupLinks, useResendEventTicket } =
  await import("@/lib/events/useEventRegistrations");

const EVENT = "evt-kongres";
const REG = "zgl-gosc";

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.fetchRegistrationGroupLinks.mockReset();
  h.resend.mockReset();
});

describe("registrationKeys.groupLinks", () => {
  it("siedzi pod gałęzią wydarzenia - decyzja organizatora je unieważnia", () => {
    const key = registrationKeys.groupLinks(EVENT, [REG]);
    expect(key.slice(0, 2)).toEqual([...registrationKeys.event(EVENT)]);
    expect(key).toEqual(["event-registrations", EVENT, "group-links", [REG]]);
  });

  it("strona listy jest częścią klucza - inna strona to inne zapytanie", () => {
    expect(registrationKeys.groupLinks(EVENT, [REG])).not.toEqual(
      registrationKeys.groupLinks(EVENT, ["zgl-inny"]),
    );
  });
});

describe("useRegistrationGroupLinks", () => {
  it("czyta powiązania wierszy widocznej strony wskazanego wydarzenia", async () => {
    h.fetchRegistrationGroupLinks.mockResolvedValue([{ registration_id: REG }]);
    const { result } = renderHook(() => useRegistrationGroupLinks(EVENT, [REG]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.fetchRegistrationGroupLinks).toHaveBeenCalledWith(EVENT, [REG]);
    expect(result.current.data).toEqual([{ registration_id: REG }]);
  });

  it("bez wydarzenia nie pyta bazy", () => {
    const { result } = renderHook(() => useRegistrationGroupLinks(null, [REG]), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(h.fetchRegistrationGroupLinks).not.toHaveBeenCalled();
  });
});

describe("useResendEventTicket", () => {
  it("oddaje liczbę wysłanych, przekazanych i pominiętych, unieważnia gałąź wydarzenia", async () => {
    h.resend.mockResolvedValue({ ok: true, sent: 2, attempted: 2, skippedSuppressed: 1 });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useResendEventTicket(EVENT), { wrapper });

    await expect(
      result.current.mutateAsync({ registrationId: REG, includeGroup: false }),
    ).resolves.toEqual({ sent: 2, attempted: 2, skippedSuppressed: 1 });
    expect(h.resend).toHaveBeenCalledWith({ data: { registrationId: REG, includeGroup: false } });
    expect(spy).toHaveBeenCalledWith({ queryKey: registrationKeys.event(EVENT) });
  });

  it("odmowa server fn staje się wyjątkiem z tekstem bazy - bez unieważnienia", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "ticket_not_issuable: nope" });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useResendEventTicket(EVENT), { wrapper });

    await expect(
      result.current.mutateAsync({ registrationId: REG, includeGroup: true }),
    ).rejects.toThrow("ticket_not_issuable: nope");
    expect(spy).not.toHaveBeenCalled();
  });
});
