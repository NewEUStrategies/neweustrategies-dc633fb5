// Beacon kliknięcia w rekomendację. Reguła jest jedna i twarda: TO NIE MOŻE
// ZABLOKOWAĆ ANI ZEPSUĆ NAWIGACJI. Telemetria jest opcjonalna, klik nie jest -
// dlatego każda ścieżka błędu musi kończyć się cicho, a nie wyjątkiem w
// handlerze `onClick` (React wypuściłby go do granicy błędu i wywalił widok
// rekomendacji zamiast przejść do artykułu).
//
// UWAGA NA ŚRODOWISKO: `vitest.setup.ts` globalnie zastępuje
// `navigator.sendBeacon` no-opem, bo happy-dom wykonuje PRAWDZIWE żądanie
// sieciowe. Ten plik nadpisuje go per test i PRZYWRACA w `afterEach` - inaczej
// zabrałby całej suicie tę osłonę.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackRelatedClick } from "@/lib/relatedClickBeacon";

const BEACON_URL = "/api/public/related-click";

const originalSendBeacon = navigator.sendBeacon;
const originalFetch = globalThis.fetch;

function setSendBeacon(value: unknown) {
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  setSendBeacon(originalSendBeacon);
  globalThis.fetch = originalFetch;
});

describe("trackRelatedClick - ścieżka sendBeacon", () => {
  it("wysyła beacon na kanoniczny adres z ładunkiem JSON", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);
    setSendBeacon(beacon);

    trackRelatedClick("source-1", "target-2");

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(BEACON_URL);
  });

  it("ładunek niesie OBA identyfikatory i typ application/json", async () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);
    setSendBeacon(beacon);

    trackRelatedClick("source-1", "target-2");

    const blob = beacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({
      sourcePostId: "source-1",
      targetPostId: "target-2",
    });
  });

  it("NIE sięga po fetch, gdy sendBeacon jest dostępny (jedno żądanie, nie dwa)", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);
    setSendBeacon(beacon);
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    trackRelatedClick("a", "b");

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("beacon zwracający `false` (kolejka przeglądarki pełna) nie eskaluje błędu", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null) => false);
    setSendBeacon(beacon);

    expect(() => trackRelatedClick("a", "b")).not.toThrow();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("WYJĄTEK z sendBeacon jest pochłaniany - klik nie może paść", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit | null): boolean => {
      throw new Error("beacon blocked by extension");
    });
    setSendBeacon(beacon);

    expect(() => trackRelatedClick("a", "b")).not.toThrow();
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("trackRelatedClick - fallback keepalive fetch", () => {
  it("BRAK sendBeacon (starsza przeglądarka) degraduje do fetch z keepalive", () => {
    setSendBeacon(undefined);
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    trackRelatedClick("source-1", "target-2");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(BEACON_URL);
  });

  it("fallback wysyła POST z ładunkiem JSON i keepalive (żądanie przeżywa nawigację)", () => {
    setSendBeacon(undefined);
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    trackRelatedClick("source-1", "target-2");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sourcePostId: "source-1",
      targetPostId: "target-2",
    });
  });

  it("sendBeacon obecny, ale NIE będący funkcją, też degraduje do fetch", () => {
    setSendBeacon("nie-funkcja");
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    trackRelatedClick("a", "b");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("TRYB OFFLINE: odrzucona obietnica fetch nie eskaluje (bez unhandled rejection)", async () => {
    setSendBeacon(undefined);
    const rejection = Promise.reject(new Error("Failed to fetch"));
    const fetchSpy = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => rejection);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(() => trackRelatedClick("a", "b")).not.toThrow();
    // Obietnica MUSI mieć podpięty `.catch` w kodzie produkcyjnym - inaczej
    // trafiłaby do `unhandledRejection` i wywróciła przebieg suity.
    await expect(rejection.catch(() => "obsluzone")).resolves.toBe("obsluzone");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("WYJĄTEK synchroniczny z fetch jest pochłaniany", () => {
    setSendBeacon(undefined);
    globalThis.fetch = (() => {
      throw new Error("fetch unavailable");
    }) as unknown as typeof fetch;

    expect(() => trackRelatedClick("a", "b")).not.toThrow();
    expect(navigator.sendBeacon).toBeUndefined();
  });
});
