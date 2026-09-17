// Measurement Protocol z serwera (ścieżka pewna zakupu): identyfikator pomiaru
// wspólny z przeglądarką, cisza bez sekretu, limit czasu i kształt `purchase`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GA4_MEASUREMENT_ID } from "../tagIds";

const fetchMock = vi.fn();

async function load() {
  return import("../ga4Mp.server");
}

function zadanie(i = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init };
}

const KLUCZE_ENV = [
  "GA4_API_SECRET",
  "GA4_MEASUREMENT_ID",
  "GOOGLE_ANALYTICS_MEASUREMENT_ID",
  "VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY",
];

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const key of KLUCZE_ENV) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendGa4ServerEvent", () => {
  it("bez GA4_API_SECRET milczy - nie dotyka sieci", async () => {
    const { sendGa4ServerEvent } = await load();
    await sendGa4ServerEvent([{ name: "x", params: {} }], null, "seed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bez sekretu z identyfikatorem używa publicznego identyfikatora strumienia - tego, którym nadaje przeglądarka", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { sendGa4ServerEvent } = await load();

    await sendGa4ServerEvent([{ name: "x", params: { a: 1 } }], "123.456", "seed");

    expect(zadanie().url).toBe(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=sekret`,
    );
    expect(zadanie().init.method).toBe("POST");
    // Webhook operatora płatności nie może wisieć na Google - żądanie ma limit czasu.
    expect(zadanie().init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(zadanie().init.body))).toEqual({
      client_id: "123.456",
      non_personalized_ads: true,
      events: [{ name: "x", params: { a: 1 } }],
    });
  });

  it("sekret GA4_MEASUREMENT_ID wygrywa ze stałą wdrożenia", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    vi.stubEnv("GA4_MEASUREMENT_ID", "G-SEKRET0001");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { sendGa4ServerEvent } = await load();

    await sendGa4ServerEvent([{ name: "x", params: {} }], null, "seed");

    expect(zadanie().url).toContain("measurement_id=G-SEKRET0001");
  });

  it("odmowa Google i wyjątek sieci lądują w console.error - nigdy nie rzucają", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    fetchMock.mockRejectedValueOnce(new Error("sieć"));
    const { sendGa4ServerEvent } = await load();

    await sendGa4ServerEvent([{ name: "x", params: {} }], null, "seed");
    await sendGa4ServerEvent([{ name: "x", params: {} }], null, "seed");

    expect(blad).toHaveBeenCalledTimes(2);
    expect(String(blad.mock.calls[0]?.[0])).toContain("GA4 MP 400");
  });
});

describe("sendGa4Purchase", () => {
  it("bez kwoty albo bez waluty nie wysyła nic", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    const { sendGa4Purchase } = await load();

    await sendGa4Purchase({ transactionId: "tx_1", amountCents: null, currency: "PLN" });
    await sendGa4Purchase({ transactionId: "tx_1", amountCents: 100, currency: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("zakup niesie transaction_id, wartość w jednostkach, walutę i czas zaangażowania; bez cookie - syntetyczny client_id", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { sendGa4Purchase, syntheticClientId } = await load();

    await sendGa4Purchase({ transactionId: "tx_1", amountCents: 12345, currency: "PLN" });

    const body = JSON.parse(String(zadanie().init.body)) as {
      client_id: string;
      events: unknown[];
    };
    expect(body.client_id).toBe(syntheticClientId("tx_1"));
    expect(body.client_id).toMatch(/^\d+\.\d+$/);
    expect(body.events[0]).toEqual({
      name: "purchase",
      params: {
        transaction_id: "tx_1",
        value: 123.45,
        currency: "PLN",
        items: [],
        engagement_time_msec: 1,
      },
    });
  });

  it("client_id z cookie przeglądarki zszywa zakup z sesją", async () => {
    vi.stubEnv("GA4_API_SECRET", "sekret");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { sendGa4Purchase } = await load();

    await sendGa4Purchase({
      transactionId: "tx_2",
      amountCents: 500,
      currency: "EUR",
      clientId: "111.222",
    });

    expect(JSON.parse(String(zadanie().init.body))).toMatchObject({ client_id: "111.222" });
  });
});
