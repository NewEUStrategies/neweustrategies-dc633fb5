// @vitest-environment node
// Google Wallet: JWT konta usługi, token OAuth, upsert klasy/obiektu, link zapisu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Zły podpis JWT to 401 przy każdym
// kliknięciu; upsert, który nie umie przejść z 404 na wstawienie albo
// z wyścigu 409 na aktualizację, to przycisk działający tylko za drugim
// razem; znacznik czasu w UTC zamiast strefy wydarzenia to bilet pokazujący
// godzinę przesuniętą o dwie. Każde wywołanie sieci jest tu zamockowane.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEventTicketClass,
  buildEventTicketObject,
  createGoogleWalletSave,
  GOOGLE_WALLET_API,
  GOOGLE_WALLET_SAVE_URL,
  GoogleWalletError,
  isoInTimeZone,
  signServiceAccountJwt,
  upsertWalletResource,
  walletAccessToken,
} from "../googleWallet.server";
import { pemBlock } from "../x509";
import { freezeClock } from "@/test/time";
import { TEST_SIGNER_PUBLIC_KEY_PEM } from "@/test/fixtures/walletTestPki";
import {
  GOOGLE_CONFIG_FIXTURE,
  WALLET_QR,
  walletTicketFixture,
} from "@/test/events/walletFixtures";

freezeClock();

const ACCOUNT = GOOGLE_CONFIG_FIXTURE.serviceAccount;
const ISSUER = GOOGLE_CONFIG_FIXTURE.issuerId;
const NOW_MS = Date.UTC(2026, 8, 26, 8, 0, 0);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let calls: Call[] = [];
let responder: (call: Call) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  calls = [];
  responder = () => json(200, {});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    };
    calls.push(call);
    return responder(call);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function decodeSegment(segment: string): Record<string, unknown> {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
}

async function verifyJwt(jwt: string): Promise<boolean> {
  const [header, body, signature] = jwt.split(".");
  const key = await crypto.subtle.importKey(
    "spki",
    new Uint8Array(pemBlock(TEST_SIGNER_PUBLIC_KEY_PEM, ["PUBLIC KEY"]).der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    new Uint8Array(Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    new TextEncoder().encode(`${header}.${body}`),
  );
}

let emailSeq = 0;
/** Świeże konto = pusty cache tokenu (cache jest per izolat i per e-mail). */
function freshAccount() {
  emailSeq += 1;
  return { ...ACCOUNT, clientEmail: `wallet-${emailSeq}@example-project.iam.gserviceaccount.com` };
}

describe("signServiceAccountJwt", () => {
  it("RS256 w base64url bez wypełnienia, weryfikowalny kluczem publicznym", async () => {
    const jwt = await signServiceAccountJwt({ iss: "a@b", note: "zażółć?>" }, ACCOUNT);
    const [header, body, signature] = jwt.split(".");
    expect(decodeSegment(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeSegment(body)).toEqual({ iss: "a@b", note: "zażółć?>" });
    expect(jwt).not.toMatch(/[=+/]/);
    expect(signature.length).toBeGreaterThan(300);
    await expect(verifyJwt(jwt)).resolves.toBe(true);
  });
});

describe("walletAccessToken", () => {
  it("wymienia JWT na token (zakres wystawcy Wallet) i trzyma go w cache", async () => {
    const account = freshAccount();
    responder = () => json(200, { access_token: "tok-1", expires_in: 3600 });
    await expect(walletAccessToken(account, NOW_MS)).resolves.toBe("tok-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(account.tokenUri);
    expect(calls[0].method).toBe("POST");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion")!;
    expect(decodeSegment(assertion.split(".")[1])).toEqual({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: account.tokenUri,
      iat: NOW_MS / 1000,
      exp: NOW_MS / 1000 + 3600,
    });
    await expect(verifyJwt(assertion)).resolves.toBe(true);

    // Drugie wywołanie w oknie ważności - bez sieci.
    await expect(walletAccessToken(account, NOW_MS + 1000)).resolves.toBe("tok-1");
    expect(calls).toHaveLength(1);
    // 60 s przed wygaśnięciem - odświeżenie.
    responder = () => json(200, { access_token: "tok-2", expires_in: 3600 });
    await expect(walletAccessToken(account, NOW_MS + 3541_000)).resolves.toBe("tok-2");
    expect(calls).toHaveLength(2);
    // Inne konto nie dostaje cudzego tokenu.
    await expect(walletAccessToken(freshAccount(), NOW_MS)).resolves.toBe("tok-2");
    expect(calls).toHaveLength(3);
  });

  it("bez expires_in token nie jest cache'owany (następne wywołanie pyta znowu)", async () => {
    const account = freshAccount();
    responder = () => json(200, { access_token: "tok-x" });
    await walletAccessToken(account, NOW_MS);
    await walletAccessToken(account, NOW_MS);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["odmowa 401", () => json(401, { error: "invalid_grant" }), 401],
    ["200 bez tokenu", () => json(200, { token_type: "Bearer" }), 200],
    ["200 z pustym tokenem", () => json(200, { access_token: "" }), 200],
    ["ciało nie-JSON", () => new Response("<html>", { status: 502 }), 502],
    ["JSON nie-obiekt", () => json(200, "tok"), 200],
  ])("%s -> GoogleWalletError ze statusem", async (_label, respond, status) => {
    responder = respond;
    const error = await walletAccessToken(freshAccount(), NOW_MS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleWalletError);
    expect(error).toMatchObject({ status, name: "GoogleWalletError" });
  });
});

describe("isoInTimeZone", () => {
  it("lokalny czas i przesunięcie strefy w danej chwili (lato/zima, ujemne, połówki)", () => {
    expect(isoInTimeZone("2026-10-16T07:00:00.999Z", "Europe/Warsaw")).toBe(
      "2026-10-16T09:00:00+02:00",
    );
    expect(isoInTimeZone("2026-12-01T07:00:00Z", "Europe/Warsaw")).toBe(
      "2026-12-01T08:00:00+01:00",
    );
    expect(isoInTimeZone("2026-10-16T02:30:00Z", "America/New_York")).toBe(
      "2026-10-15T22:30:00-04:00",
    );
    expect(isoInTimeZone("2026-10-16T07:00:00Z", "Asia/Kolkata")).toBe("2026-10-16T12:30:00+05:30");
    expect(isoInTimeZone("2026-10-16T00:00:00Z", "UTC")).toBe("2026-10-16T00:00:00+00:00");
  });
});

describe("buildEventTicketClass / buildEventTicketObject", () => {
  it("klasa: nazwa w obu językach, termin w strefie, miejsce, okładka, strona", () => {
    const eventClass = buildEventTicketClass(
      walletTicketFixture(),
      ISSUER,
      "https://wydarzenia.example.org",
    );
    expect(eventClass).toEqual({
      id: `${ISSUER}.evt_52e00000-0000-0000-0000-0000000000a1`,
      issuerName: "Organizator A",
      reviewStatus: "UNDER_REVIEW",
      eventId: "52e00000-0000-0000-0000-0000000000a1",
      eventName: {
        defaultValue: { language: "pl", value: "Kongres portfela" },
        translatedValues: [{ language: "en", value: "Wallet congress" }],
      },
      dateTime: { start: "2026-10-16T09:00:00+02:00", end: "2026-10-16T17:00:00+02:00" },
      venue: {
        name: {
          defaultValue: { language: "pl", value: "Warszawa, Sala Kongresowa" },
          translatedValues: [{ language: "en", value: "Warszawa, Sala Kongresowa" }],
        },
      },
      heroImage: {
        sourceUri: { uri: "https://cdn.example.org/cover.jpg" },
        contentDescription: {
          defaultValue: { language: "pl", value: "Kongres portfela" },
          translatedValues: [{ language: "en", value: "Wallet congress" }],
        },
      },
      homepageUri: {
        uri: "https://wydarzenia.example.org/events/wallet-kongres",
        description: "Kongres portfela",
      },
      hexBackgroundColor: "#112233",
    });
  });

  it("klasa minimalna: bez końca, miejsca, okładki i hosta; język domyślny = angielski", () => {
    const eventClass = buildEventTicketClass(
      walletTicketFixture(
        { event_ends_at: null, event_location: null, event_cover_url: null },
        "en",
      ),
      ISSUER,
      null,
    );
    expect(eventClass.dateTime).toEqual({ start: "2026-10-16T09:00:00+02:00" });
    expect(eventClass.eventName).toEqual({
      defaultValue: { language: "en", value: "Wallet congress" },
      translatedValues: [{ language: "pl", value: "Kongres portfela" }],
    });
    expect(Object.keys(eventClass)).not.toEqual(
      expect.arrayContaining(["venue", "heroImage", "homepageUri"]),
    );
    expect(eventClass).not.toHaveProperty("venue");
    expect(eventClass).not.toHaveProperty("heroImage");
    expect(eventClass).not.toHaveProperty("homepageUri");
  });

  it("obiekt: kod QR = jawny kod biletu, posiadacz, rodzaj, grupa, wygaśnięcie", () => {
    const object = buildEventTicketObject(walletTicketFixture(), ISSUER);
    expect(object).toMatchObject({
      id: `${ISSUER}.reg_52b00000-0000-0000-0000-0000000000a1`,
      classId: `${ISSUER}.evt_52e00000-0000-0000-0000-0000000000a1`,
      state: "ACTIVE",
      barcode: { type: "QR_CODE", value: WALLET_QR, alternateText: WALLET_QR },
      ticketHolderName: "Hanna Posiadaczka",
      ticketType: {
        defaultValue: { language: "pl", value: "Standardowy" },
        translatedValues: [{ language: "en", value: "Standard" }],
      },
      hexBackgroundColor: "#112233",
      validTimeInterval: { end: { date: "2026-10-17T17:00:00+02:00" } },
    });
    const modules = object.textModulesData as Record<string, unknown>[];
    expect(modules.map((m) => m.id)).toEqual(["group", "info"]);
    expect(modules[0]).toMatchObject({ header: "Grupa", body: "Prasa" });
    expect(modules[0].localizedBody).toEqual({
      defaultValue: { language: "pl", value: "Prasa" },
      translatedValues: [{ language: "en", value: "Press" }],
    });
    expect(modules[1]).toMatchObject({ header: "Wejście" });
  });

  it("obiekt minimalny: bez posiadacza, rodzaju, grupy; wygasa dzień po starcie", () => {
    const object = buildEventTicketObject(
      walletTicketFixture(
        {
          first_name: null,
          last_name: null,
          ticket_name_pl: null,
          ticket_name_en: null,
          group_name_pl: null,
          group_name_en: null,
          event_ends_at: null,
        },
        "en",
      ),
      ISSUER,
    );
    expect(object).not.toHaveProperty("ticketHolderName");
    expect(object).not.toHaveProperty("ticketType");
    expect(object.validTimeInterval).toEqual({ end: { date: "2026-10-17T09:00:00+02:00" } });
    const modules = object.textModulesData as Record<string, unknown>[];
    expect(modules.map((m) => m.id)).toEqual(["info"]);
    expect(modules[0]).toMatchObject({ header: "Entry" });
  });
});

describe("upsertWalletResource", () => {
  const ID = `${ISSUER}.reg_x`;
  const ITEM = `${GOOGLE_WALLET_API}/eventTicketObject/${encodeURIComponent(ID)}`;
  const COLLECTION = `${GOOGLE_WALLET_API}/eventTicketObject`;

  function scripted(...statuses: number[]) {
    const queue = [...statuses];
    responder = () => json(queue.shift() ?? 500, {});
  }

  it("istniejący zasób: jeden PATCH z tokenem i ciałem JSON", async () => {
    scripted(200);
    await upsertWalletResource("eventTicketObject", ID, { id: ID }, "tok");
    expect(calls.map((c) => [c.method, c.url])).toEqual([["PATCH", ITEM]]);
    expect(calls[0].headers).toMatchObject({
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(calls[0].body)).toEqual({ id: ID });
  });

  it("404 -> POST (wstawienie)", async () => {
    scripted(404, 200);
    await upsertWalletResource("eventTicketObject", ID, { id: ID }, "tok");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["PATCH", ITEM],
      ["POST", COLLECTION],
    ]);
  });

  it("404 -> POST 409 (równoległe wstawienie) -> PATCH", async () => {
    scripted(404, 409, 200);
    await upsertWalletResource("eventTicketObject", ID, { id: ID }, "tok");
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST", "PATCH"]);
  });

  it.each([
    ["PATCH 500", [500]],
    ["POST 400", [404, 400]],
    ["PATCH po 409 też 409", [404, 409, 409]],
    ["przekierowanie 302", [302]],
  ])("%s -> GoogleWalletError", async (_label, statuses) => {
    scripted(...statuses);
    await expect(
      upsertWalletResource("eventTicketClass", ID, { id: ID }, "tok"),
    ).rejects.toBeInstanceOf(GoogleWalletError);
  });
});

describe("createGoogleWalletSave", () => {
  function happyGoogle() {
    responder = (call) =>
      call.url.startsWith("https://oauth2.googleapis.com")
        ? json(200, { access_token: "tok-save", expires_in: 3600 })
        : json(200, {});
  }

  it("upsert klasy i obiektu, potem chudy JWT z samym identyfikatorem obiektu", async () => {
    happyGoogle();
    const config = { ...GOOGLE_CONFIG_FIXTURE, serviceAccount: freshAccount() };
    const result = await createGoogleWalletSave({
      ticket: walletTicketFixture(),
      config,
      publicOrigin: "https://wydarzenia.example.org",
      nowMs: NOW_MS,
    });
    expect(result.objectId).toBe(`${ISSUER}.reg_52b00000-0000-0000-0000-0000000000a1`);
    expect(calls.map((c) => c.method + " " + c.url.replace(GOOGLE_WALLET_API, ""))).toEqual([
      "POST https://oauth2.googleapis.com/token",
      `PATCH /eventTicketClass/${encodeURIComponent(`${ISSUER}.evt_52e00000-0000-0000-0000-0000000000a1`)}`,
      `PATCH /eventTicketObject/${encodeURIComponent(result.objectId)}`,
    ]);
    expect(calls[1].headers.Authorization).toBe("Bearer tok-save");

    expect(result.saveUrl.startsWith(GOOGLE_WALLET_SAVE_URL)).toBe(true);
    const jwt = result.saveUrl.slice(GOOGLE_WALLET_SAVE_URL.length);
    expect(decodeSegment(jwt.split(".")[1])).toEqual({
      iss: config.serviceAccount.clientEmail,
      aud: "google",
      typ: "savetowallet",
      iat: NOW_MS / 1000,
      origins: ["https://wydarzenia.example.org"],
      payload: { eventTicketObjects: [{ id: result.objectId }] },
    });
    // Kod biletu NIE jedzie w adresie zapisu.
    expect(result.saveUrl).not.toContain(WALLET_QR);
    await expect(verifyJwt(jwt)).resolves.toBe(true);
  });

  it("bez znanego hosta JWT nie niesie `origins`; błąd Google przerywa przepływ", async () => {
    happyGoogle();
    const config = { ...GOOGLE_CONFIG_FIXTURE, serviceAccount: freshAccount() };
    const result = await createGoogleWalletSave({
      ticket: walletTicketFixture(),
      config,
      publicOrigin: null,
      nowMs: NOW_MS,
    });
    const jwt = result.saveUrl.slice(GOOGLE_WALLET_SAVE_URL.length);
    expect(decodeSegment(jwt.split(".")[1])).not.toHaveProperty("origins");

    responder = (call) =>
      call.url.startsWith("https://oauth2.googleapis.com")
        ? json(200, { access_token: "tok-save", expires_in: 3600 })
        : json(403, {});
    await expect(
      createGoogleWalletSave({
        ticket: walletTicketFixture(),
        config: { ...GOOGLE_CONFIG_FIXTURE, serviceAccount: freshAccount() },
        publicOrigin: null,
        nowMs: NOW_MS,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
