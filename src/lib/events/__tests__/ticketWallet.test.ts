// Portfel na stronie biletu: reguły (platforma, przyciski, błędy) i wywołania tras.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. iPad udający Maca bez przycisku
// Apple, Android z przyciskiem, którego nie obsłuży, kod biletu w adresie
// zapytania albo odpowiedź, która przenosi uczestnika pod obcy adres
// zamiast do Google Wallet - każde z tych psuje jedyną chwilę, w której
// uczestnik chce dodać bilet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectWalletDevice,
  WALLET_ENDPOINTS,
  WALLET_ERROR_KEYS,
  walletButtonsFor,
  walletErrorCodeFromBody,
  walletErrorKey,
  WalletRequestError,
} from "@/lib/events/ticketWallet";
import {
  checkAppleWalletPass,
  fetchWalletAvailability,
  requestGoogleWalletSaveUrl,
} from "@/lib/events/ticketWalletApi";
import { eventWalletEn, eventWalletPl } from "@/lib/i18n-event-wallet";

const TOKEN = "WalletFreeToken_0123456789abcdef";
const SAVE = "https://pay.google.com/gp/v/save/eyJhbGciOi.x.y";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

describe("detectWalletDevice / walletButtonsFor", () => {
  it("iPhone i iPad (także udający Maca) to iOS, Android to Android, reszta - komputer", () => {
    expect(detectWalletDevice(IPHONE, 5)).toBe("ios");
    expect(detectWalletDevice(IPAD_AS_MAC, 5)).toBe("ios");
    expect(detectWalletDevice(IPAD_AS_MAC, 0)).toBe("other");
    expect(detectWalletDevice(ANDROID, 5)).toBe("android");
    expect(detectWalletDevice(WINDOWS, 0)).toBe("other");
  });

  it("przycisk tylko dla portfela skonfigurowanego i działającego na urządzeniu", () => {
    const both = { apple: true, google: true };
    expect(walletButtonsFor("ios", both)).toEqual({ apple: true, google: false });
    expect(walletButtonsFor("android", both)).toEqual({ apple: false, google: true });
    expect(walletButtonsFor("other", both)).toEqual({ apple: true, google: true });
    expect(walletButtonsFor("other", { apple: false, google: true })).toEqual({
      apple: false,
      google: true,
    });
  });
});

describe("mapowanie błędów", () => {
  it("każdy kod trasy ma klucz istniejący w obu językach słownika", () => {
    for (const key of Object.values(WALLET_ERROR_KEYS)) {
      const leaf = key.replace(
        "eventWallet.errors.",
        "",
      ) as keyof typeof eventWalletPl.eventWallet.errors;
      expect(eventWalletPl.eventWallet.errors[leaf]).toBeTruthy();
      expect(eventWalletEn.eventWallet.errors[leaf]).toBeTruthy();
    }
  });

  it("kod z ciała odpowiedzi; obcy kod albo brak ciała -> upstream", () => {
    expect(walletErrorCodeFromBody({ error: "rate_limited" })).toBe("rate_limited");
    expect(walletErrorCodeFromBody({ error: "toString" })).toBe("upstream");
    expect(walletErrorCodeFromBody({ error: 7 })).toBe("upstream");
    expect(walletErrorCodeFromBody({})).toBe("upstream");
    expect(walletErrorCodeFromBody(null)).toBe("upstream");
  });

  it("klucz komunikatu z błędu; nieznany błąd -> ogólny", () => {
    expect(walletErrorKey(new WalletRequestError("not_found"))).toBe("eventWallet.errors.notFound");
    expect(walletErrorKey(new WalletRequestError("not_configured"))).toBe(
      "eventWallet.errors.unavailable",
    );
    expect(walletErrorKey(new Error("x"))).toBe("eventWallet.errors.generic");
    expect(new WalletRequestError("network")).toMatchObject({
      name: "WalletRequestError",
      message: "wallet: network",
    });
  });
});

describe("ticketWalletApi", () => {
  let calls: { url: string; init: RequestInit }[];
  let responder: () => Response | Promise<Response>;

  beforeEach(() => {
    calls = [];
    responder = () => new Response(null, { status: 204 });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responder();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dostępność: GET bez cache, tylko prawdziwe `true` włącza portfel", async () => {
    responder = () => new Response(JSON.stringify({ apple: true, google: "yes" }));
    await expect(fetchWalletAvailability()).resolves.toEqual({ apple: true, google: false });
    expect(calls[0].url).toBe(WALLET_ENDPOINTS.availability);
    expect(calls[0].init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    responder = () => new Response("nie-json");
    await expect(fetchWalletAvailability()).resolves.toEqual({ apple: false, google: false });
    responder = () => new Response("{}", { status: 500 });
    await expect(fetchWalletAvailability()).rejects.toMatchObject({ code: "upstream" });
  });

  it("Apple: sprawdzenie formularzem z kodem W CIELE, 204 = paczka będzie", async () => {
    await expect(checkAppleWalletPass(TOKEN, "en")).resolves.toBeUndefined();
    expect(calls[0].url).toBe(WALLET_ENDPOINTS.apple);
    expect(calls[0].url).not.toContain(TOKEN);
    const body = calls[0].init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ token: TOKEN, lang: "en", intent: "check" });
  });

  it("Apple: odmowa trasy niesie jej kod; 200 zamiast 204 też jest błędem", async () => {
    responder = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    await expect(checkAppleWalletPass(TOKEN, "pl")).rejects.toMatchObject({ code: "not_found" });
    responder = () => new Response("binarne", { status: 200 });
    await expect(checkAppleWalletPass(TOKEN, "pl")).rejects.toMatchObject({ code: "upstream" });
  });

  it("Google: JSON z kodem w ciele -> saveUrl wyłącznie pod adresem zapisu Google", async () => {
    responder = () => new Response(JSON.stringify({ saveUrl: SAVE }));
    await expect(requestGoogleWalletSaveUrl(TOKEN, "pl")).resolves.toBe(SAVE);
    expect(calls[0].url).toBe(WALLET_ENDPOINTS.google);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN, lang: "pl" });
  });

  it.each([
    ["obcy adres", { saveUrl: "https://evil.example.org/save" }],
    ["brak adresu", { ok: true }],
    ["adres nie-napis", { saveUrl: 1 }],
  ])("Google: %s w odpowiedzi -> upstream (bez przekierowania)", async (_label, body) => {
    responder = () => new Response(JSON.stringify(body));
    await expect(requestGoogleWalletSaveUrl(TOKEN, "pl")).rejects.toMatchObject({
      code: "upstream",
    });
  });

  it("Google: ciało nie-JSON przy 200 i odmowa 429 -> kody błędów", async () => {
    responder = () => new Response("<html>");
    await expect(requestGoogleWalletSaveUrl(TOKEN, "pl")).rejects.toMatchObject({
      code: "upstream",
    });
    responder = () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    await expect(requestGoogleWalletSaveUrl(TOKEN, "pl")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("brak sieci -> network", async () => {
    responder = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(requestGoogleWalletSaveUrl(TOKEN, "pl")).rejects.toMatchObject({
      code: "network",
    });
  });
});
