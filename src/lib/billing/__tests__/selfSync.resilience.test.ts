// Samoobsługowa synchronizacja subskrypcji - ODPORNOŚĆ i UCZCIWY WYNIK.
//
// Przycisk „odśwież stan subskrypcji" jest ścieżką ratunkową, gdy webhook się
// spóźnił: klient zapłacił, a nie widzi dostępu. Ten plik przypina trzy ryzyka,
// których podstawowy test (`selfSync.server.test.ts`) nie dotyka:
//
//   1. WSTRZYKNIĘCIE DO ZAPYTANIA SEARCH. `userId` jest interpolowany do
//      zapytania Stripe Search - identyfikator spoza alfabetu UUID nie może
//      trafić do operatora (inaczej klauzula `OR` zwróciłaby cudze subskrypcje).
//   2. JEDNA AWARIA NIE ZATRZYMUJE RESZTY. Niedostępny Search albo pojedyncza
//      subskrypcja, której nie da się pobrać, nie mogą przerwać synchronizacji
//      pozostałych - wtedy ratunek zawodzi dokładnie wtedy, gdy jest potrzebny.
//   3. `applied` NIE KŁAMIE. Zdarzenie pominięte przez dyspozytora (spóźnione
//      względem nowszego stanu) nie jest liczone jako zastosowane - UI nie może
//      meldować „zsynchronizowano 1", gdy nic się nie zmieniło.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  search: vi.fn(),
  dispatch: vi.fn(),
  envs: [] as string[],
}));

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: (env: string) => {
    h.envs.push(env);
    return { subscriptions: { retrieve: h.retrieve, search: h.search } };
  },
}));
vi.mock("@/lib/billing/webhookDispatch.server", () => ({
  dispatchWebhookEvent: (input: unknown) => h.dispatch(input),
}));

import { syncUserSubscriptionsFromProvider } from "@/lib/billing/selfSync.server";

const USER = "4b1c2d3e-0000-4000-8000-00000000abcd";

/** Subskrypcja w kształcie odpowiedzi `subscriptions.retrieve` (ceny rozwinięte). */
const subscription = (id: string, status = "active", userId: string = USER) => ({
  id,
  status,
  customer: "cus_1",
  metadata: { userId },
  items: {
    data: [
      {
        price: { id: "price_1", lookup_key: "plus_monthly", product: "prod_1" },
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_000_000,
        quantity: 1,
      },
    ],
  },
});

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.retrieve.mockReset();
  h.search.mockReset().mockResolvedValue({ data: [] });
  h.dispatch.mockReset().mockResolvedValue("processed");
  h.envs.length = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("zapytanie Search - tylko dla bezpiecznego identyfikatora", () => {
  it("szuka subskrypcji po metadata.userId wołającego, w jego środowisku", async () => {
    h.search.mockResolvedValue({ data: [{ id: "sub_found" }] });
    h.retrieve.mockResolvedValue(subscription("sub_found"));

    const result = await syncUserSubscriptionsFromProvider("live", USER, []);

    expect(h.envs).toEqual(["live"]);
    expect(h.search).toHaveBeenCalledWith({
      query: `metadata['userId']:'${USER}'`,
      limit: 20,
    });
    expect(h.retrieve).toHaveBeenCalledWith("sub_found", { expand: ["items.data.price"] });
    expect(result).toEqual({ scanned: 1, applied: 1, statuses: ["active"] });
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ environment: "live" }));
  });

  it("identyfikator z cudzysłowem NIE trafia do Search - synchronizują się tylko lokalne", async () => {
    const hostile = "x' OR metadata['userId']:'*";
    h.retrieve.mockResolvedValue(subscription("sub_local", "active", hostile));

    const result = await syncUserSubscriptionsFromProvider("sandbox", hostile, ["sub_local"]);

    expect(h.search).not.toHaveBeenCalled();
    expect(h.retrieve).toHaveBeenCalledTimes(1);
    expect(h.retrieve).toHaveBeenCalledWith("sub_local", { expand: ["items.data.price"] });
    expect(result).toEqual({ scanned: 1, applied: 1, statuses: ["active"] });
  });

  it("lokalne wartości spoza formatu `sub_...` nie są wysyłane do operatora", async () => {
    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, [
      "mock_legacy",
      "",
      "pi_123",
    ]);

    expect(h.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, applied: 0, statuses: [] });
  });

  it("subskrypcja znaleziona i lokalnie, i przez Search jest synchronizowana RAZ", async () => {
    h.search.mockResolvedValue({ data: [{ id: "sub_1" }] });
    h.retrieve.mockResolvedValue(subscription("sub_1"));

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_1"]);

    expect(h.retrieve).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(result.scanned).toBe(1);
  });
});

describe("pojedyncza awaria nie zatrzymuje synchronizacji", () => {
  it("niedostępny Search jest logowany, a lokalne identyfikatory i tak się synchronizują", async () => {
    const outage = new Error("search index not ready");
    h.search.mockRejectedValue(outage);
    h.retrieve.mockResolvedValue(subscription("sub_local"));

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_local"]);

    expect(result).toEqual({ scanned: 1, applied: 1, statuses: ["active"] });
    expect(consoleError).toHaveBeenCalledWith("[selfSync] subscriptions.search failed", outage);
  });

  it("nieudane pobranie jednej subskrypcji pomija TYLKO ją - kolejna przechodzi", async () => {
    const missing = new Error("No such subscription: sub_gone");
    h.retrieve.mockImplementation((id: string) =>
      id === "sub_gone" ? Promise.reject(missing) : Promise.resolve(subscription(id, "past_due")),
    );

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_gone", "sub_ok"]);

    expect(result).toEqual({ scanned: 2, applied: 1, statuses: ["past_due"] });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[selfSync] subscription retrieve failed",
      "sub_gone",
      missing,
    );
  });
});

describe("wynik synchronizacji jest uczciwy", () => {
  it("zdarzenie pominięte przez dyspozytor (spóźnione) NIE liczy się jako zastosowane", async () => {
    h.retrieve.mockResolvedValue(subscription("sub_1", "active"));
    h.dispatch.mockResolvedValue("skipped");

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_1"]);

    expect(result).toEqual({ scanned: 1, applied: 0, statuses: ["active"] });
  });

  it("subskrypcja przypięta do innego użytkownika nie wchodzi nawet do podglądu statusów", async () => {
    h.retrieve.mockResolvedValue(subscription("sub_foreign", "active", "someone-else"));

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_foreign"]);

    expect(result).toEqual({ scanned: 1, applied: 0, statuses: [] });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("subskrypcja bez metadanych właściciela przechodzi (identyfikator przyszedł spod RLS)", async () => {
    h.retrieve.mockResolvedValue({ ...subscription("sub_old"), metadata: {} });

    const result = await syncUserSubscriptionsFromProvider("sandbox", USER, ["sub_old"]);

    expect(result).toEqual({ scanned: 1, applied: 1, statuses: ["active"] });
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "subscription.updated", environment: "sandbox" }),
    );
  });
});
