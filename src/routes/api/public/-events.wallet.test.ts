// Trasy portfela: /api/public/events/wallet/{apple,google,availability}.
//
// PO CO. Pliki tras są cienkie - każdy handler ładuje logikę z
// `lib/events/wallet/walletRoutes.server.ts` przez `import()`, żeby podpis,
// ZIP i klient bazy nie wchodziły do grafu startowego serwera. Ten test pilnuje
// tego, czego logika nie widzi: metod HTTP każdej trasy i tego, że handler
// oddaje odpowiedź logiki bez zmian - z tym samym żądaniem, więc kod biletu
// nigdzie się po drodze nie gubi.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  apple: vi.fn(),
  google: vi.fn(),
  availability: vi.fn(),
}));

vi.mock("@/lib/events/wallet/walletRoutes.server", () => ({
  appleWalletPost: h.apple,
  googleWalletPost: h.google,
  walletAvailabilityGet: h.availability,
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route as AppleRoute } from "@/routes/api/public/events.wallet.apple";
import { Route as GoogleRoute } from "@/routes/api/public/events.wallet.google";
import { Route as AvailabilityRoute } from "@/routes/api/public/events.wallet.availability";

beforeEach(() => {
  h.apple.mockReset();
  h.google.mockReset();
  h.availability.mockReset();
});

describe("trasy portfela", () => {
  it("apple: POST pod właściwym adresem przekazuje żądanie logice i oddaje jej odpowiedź", async () => {
    const response = new Response("pkpass", { status: 200 });
    h.apple.mockResolvedValue(response);
    const request = new Request("https://a.example.org/api/public/events/wallet/apple", {
      method: "POST",
    });
    const handlers = routeServerHandlers(AppleRoute);
    expect(Object.keys(handlers)).toEqual(["POST"]);
    await expect(handlers.POST!({ request })).resolves.toBe(response);
    expect(h.apple).toHaveBeenCalledWith(request);
  });

  it("google: POST przekazuje żądanie logice i oddaje jej odpowiedź", async () => {
    const response = new Response("{}", { status: 200 });
    h.google.mockResolvedValue(response);
    const request = new Request("https://a.example.org/api/public/events/wallet/google", {
      method: "POST",
    });
    const handlers = routeServerHandlers(GoogleRoute);
    expect(Object.keys(handlers)).toEqual(["POST"]);
    await expect(handlers.POST!({ request })).resolves.toBe(response);
    expect(h.google).toHaveBeenCalledWith(request);
  });

  it("availability: wyłącznie GET, odpowiedź logiki bez zmian", async () => {
    const response = new Response('{"apple":false,"google":false}');
    h.availability.mockReturnValue(response);
    const handlers = routeServerHandlers(AvailabilityRoute);
    expect(Object.keys(handlers)).toEqual(["GET"]);
    await expect(handlers.GET!({})).resolves.toBe(response);
  });
});
