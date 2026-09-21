import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  observabilityEndpoint,
  buildErrorPayload,
  sendBeaconPayload,
  reportClientError,
  reportBoundaryError,
  INTERNAL_ERROR_ENDPOINT,
  type ClientErrorPayload,
} from "./report";

/**
 * Odczytaj ładunek beaconu. Transport pakuje JSON w `Blob`, więc `String(body)`
 * daje "[object Blob]" i `JSON.parse` się na tym wywraca - stąd `.text()`.
 */
async function beaconPayload(body: BodyInit | null | undefined): Promise<ClientErrorPayload> {
  const text = body instanceof Blob ? await body.text() : String(body);
  return JSON.parse(text) as ClientErrorPayload;
}

/** Podmień `navigator.sendBeacon` na szpiega zbierającego wywołania. */
function captureBeacon(): ReturnType<typeof vi.fn<(url: string, body?: BodyInit) => boolean>> {
  const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  return beacon;
}

describe("observabilityEndpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("falls back to the internal ingest route when unconfigured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    expect(observabilityEndpoint()).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("prefers the external endpoint when configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com/collect");
    expect(observabilityEndpoint()).toBe("https://rum.example.com/collect");
  });
});

describe("buildErrorPayload", () => {
  it("maps an Error with its stack", () => {
    const err = new Error("boom");
    const p = buildErrorPayload(err, "onerror", "/x", 123);
    expect(p).toMatchObject({
      type: "error",
      message: "boom",
      source: "onerror",
      path: "/x",
      ts: 123,
    });
    expect(p.stack).toBeTypeOf("string");
  });

  it("coerces a string error", () => {
    expect(buildErrorPayload("a string failure", "unhandledrejection", "/y", 1).message).toBe(
      "a string failure",
    );
  });

  it("coerces a non-error object to a generic message", () => {
    expect(buildErrorPayload({ weird: true }, "onerror", "/z", 1).message).toBe(
      "Unknown client error",
    );
  });

  it("attaches structured meta when provided", () => {
    const p = buildErrorPayload(new Error("boom"), "react_error_boundary", "/x", 1, {
      boundary: "builder_render_boundary",
      label: "widget:heading:w3",
    });
    expect(p.meta).toEqual({ boundary: "builder_render_boundary", label: "widget:heading:w3" });
  });

  it("omits meta when it is undefined or empty", () => {
    expect(buildErrorPayload(new Error("x"), "onerror", "/x", 1).meta).toBeUndefined();
    expect(buildErrorPayload(new Error("x"), "onerror", "/x", 1, {}).meta).toBeUndefined();
  });
});

describe("sendBeaconPayload", () => {
  const original = navigator.sendBeacon;
  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("returns false when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", { a: 1 })).toBe(false);
  });

  it("sends a JSON blob and returns the beacon result", () => {
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", { a: 1 })).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("https://x");
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
  });

  it("swallows a throwing sendBeacon", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => {
        throw new Error("nope");
      },
      configurable: true,
      writable: true,
    });
    expect(sendBeaconPayload("https://x", {})).toBe(false);
  });
});

describe("reportClientError", () => {
  const original = navigator.sendBeacon;
  beforeEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    // Bez tego test podmieniający `location` zostawiłby zepsuty glob dla
    // następnych przypadków w pliku.
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("beacons to the internal endpoint when no external endpoint is configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(reportClientError(new Error("x"), "onerror")).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("beacons the error when an external endpoint is configured", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com");
    expect(reportClientError(new Error("x"), "unhandledrejection")).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("znany szum NIE wychodzi beaconem - i nie zużywa round-tripu na sprzątanie AbortControllera", () => {
    // Odsiew idzie U ŹRÓDŁA, a nie w panelu: anulowane żądania i pętla
    // ResizeObservera to 82% wpisów z sierpnia/września 2026. Gdyby ten
    // strażnik przestał działać, `/admin/performance?tab=errors` znów
    // pokazywałby normalne życie przeglądarki zamiast awarii, a prawdziwy
    // wyjątek tonąłby na dalszych stronach listy.
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = captureBeacon();

    const aborted = new Error("signal is aborted without reason");
    aborted.name = "AbortError";
    expect(reportClientError(aborted, "unhandledrejection")).toBe(false);
    expect(
      reportClientError("ResizeObserver loop completed with undelivered notifications.", "onerror"),
    ).toBe(false);
    expect(reportClientError("   ", "onerror")).toBe(false);
    expect(beacon).not.toHaveBeenCalled();

    // Kontrola negatywna: filtr jest WĄSKI, więc realna awaria sieci tą samą
    // drogą nadal wychodzi. Bez tej asercji „nic nie wysyłamy" przechodziłoby
    // też dla filtra, który wycisza wszystko.
    expect(reportClientError(new Error("Failed to fetch"), "onerror")).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("środowisko bez `location` raportuje z pustą ścieżką, zamiast wywrócić globalny handler", async () => {
    // `reportClientError` bywa wołane z `window.onerror` i z workera, a tam
    // globalnego `location` może nie być. Rzut w reporterze błędów jest
    // najgorszym z możliwych: leci Z handlera błędu, więc nie ma go już kto
    // złapać - a przy okazji ginie wpis o pierwotnej awarii. Ścieżka jest
    // metadaną, nie treścią, więc jej brak może kosztować co najwyżej pustego
    // stringa w kolumnie `path`.
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = captureBeacon();
    vi.stubGlobal("location", undefined);

    expect(typeof location).toBe("undefined");
    expect(reportClientError(new Error("boom"), "onerror")).toBe(true);

    const payload = await beaconPayload(beacon.mock.calls[0]?.[1]);
    expect(payload.path).toBe("");
    expect(payload.message).toBe("boom");
    expect(payload.source).toBe("onerror");
  });
});

describe("reportBoundaryError", () => {
  const original = navigator.sendBeacon;
  beforeEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "sendBeacon", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("beacons to the internal endpoint by default (no external config)", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(reportBoundaryError(new Error("x"), { label: "section:s1" })).toBe(true);
    expect(beacon.mock.calls[0][0]).toBe(INTERNAL_ERROR_ENDPOINT);
  });

  it("beacons a react_error_boundary payload with structured meta", () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.com");
    const beacon = vi.fn((_url: string, _body?: BodyInit) => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    expect(
      reportBoundaryError(new Error("crash"), {
        boundary: "builder_render_boundary",
        label: "widget:w1",
      }),
    ).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("https://rum.example.com");
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
  });

  it("bez globalnego `location` raport granicy nadal niesie KONTEKST awarii", async () => {
    // Granice Reacta renderują się także po stronie serwera, gdzie `location`
    // nie istnieje. Ta ścieżka nie ma prawa ani rzucić (rzut w raporcie awarii
    // renderu zamieniłby zepsutą sekcję w zepsutą stronę), ani zgubić `meta` -
    // etykieta widżetu jest jedyną rzeczą, po której da się w panelu wskazać,
    // KTÓRY blok pada. Sam URL jest tu do zastąpienia, kontekst nie.
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const beacon = captureBeacon();
    vi.stubGlobal("location", undefined);

    expect(typeof location).toBe("undefined");
    expect(reportBoundaryError(new Error("crash"), { label: "widget:heading:w3" })).toBe(true);

    const payload = await beaconPayload(beacon.mock.calls[0]?.[1]);
    expect(payload.path).toBe("");
    expect(payload.source).toBe("react_error_boundary");
    expect(payload.meta).toEqual({ label: "widget:heading:w3" });
  });
});
