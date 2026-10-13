// @vitest-environment node
// Trasy portfela: POST apple (.pkpass), POST google ({ saveUrl }), GET dostępność.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. `/api/public/*` omija broker
// uwierzytelnienia, więc CAŁA ochrona siedzi w tych handlerach: kształt kodu,
// limit tempa po IP i po kodzie, najemca z hosta, nagłówki `no-store`/`nosniff`/
// `no-referrer` na odpowiedzi niosącej kod biletu. Każda ścieżka statusu
// (400, 429, 404, 502, 503, 500, 204, 200) ma tu swój test, a kod biletu nie
// może trafić do żadnego logu.
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freezeClock } from "@/test/time";
import { GOOGLE_CONFIG_FIXTURE, WALLET_QR, walletPayloadRow } from "@/test/events/walletFixtures";
import {
  TEST_SIGNER_CERT_PEM,
  TEST_SIGNER_KEY_PKCS8_PEM,
  TEST_WWDR_CERT_PEM,
} from "@/test/fixtures/walletTestPki";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  rateLimit: vi.fn(),
  host: "wydarzenia.example.org" as string | null,
  caller: vi.fn(),
}));

// Klient WOŁAJĄCEGO (klucz publiczny + nagłówek hosta) - jego własne stawki
// pilnuje `callerClient.server.test.ts`; tu liczy się, że trasa idzie przez niego.
vi.mock("@/lib/events/callerClient.server", () => ({ callerSupabase: h.caller }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/http/requestHost", () => ({ trustedPublicHost: async () => h.host }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.adminRpc } }));

const { appleWalletPost, googleWalletPost, walletAvailabilityGet } =
  await import("../walletRoutes.server");
const { resetWalletConfigMemoForTests } = await import("../walletConfig.server");
const { resetGoogleWalletMemoForTests, walletObjectSuffix } =
  await import("../googleWallet.server");

/** SHA-256 kodu biletu - ten sam skrót, który baza trzyma w `qr_token_hash`. */
const QR_HASH = createHash("sha256").update(WALLET_QR).digest("hex");

freezeClock();

const APPLE_URL = "https://wydarzenia.example.org/api/public/events/wallet/apple";
const GOOGLE_URL = "https://wydarzenia.example.org/api/public/events/wallet/google";

function stubApple(overrides: Record<string, string> = {}) {
  const env = {
    APPLE_WALLET_PASS_TYPE_ID: "pass.org.example.test",
    APPLE_WALLET_TEAM_ID: "TESTTEAM01",
    APPLE_WALLET_SIGNER_CERT_PEM: TEST_SIGNER_CERT_PEM,
    APPLE_WALLET_SIGNER_KEY_PEM: TEST_SIGNER_KEY_PKCS8_PEM,
    APPLE_WALLET_WWDR_CERT_PEM: TEST_WWDR_CERT_PEM,
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

function stubGoogle() {
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", GOOGLE_CONFIG_FIXTURE.issuerId);
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      client_email: GOOGLE_CONFIG_FIXTURE.serviceAccount.clientEmail,
      private_key: TEST_SIGNER_KEY_PKCS8_PEM,
    }),
  );
}

function form(fields: Record<string, string>): Request {
  return new Request(APPLE_URL, {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.7" },
    body: new URLSearchParams(fields),
  });
}

function jsonRequest(body: unknown): Request {
  return new Request(GOOGLE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Ładunek „chudego” JWT `savetowallet` z linku zapisu. */
function jwtPayload(saveUrl: string): Record<string, unknown> {
  const segment = saveUrl.split("/").pop()?.split(".")[1] ?? "";
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
}

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: walletPayloadRow(), error: null });
  h.adminRpc.mockReset().mockResolvedValue({ data: 1, error: null });
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.caller.mockReset().mockResolvedValue({ client: { rpc: h.rpc }, userId: null });
  h.host = "wydarzenia.example.org";
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  // Kod biletu nie może trafić do żadnego logu - w żadnej ścieżce.
  for (const call of [...warn.mock.calls, ...error.mock.calls]) {
    expect(call.join(" ")).not.toContain(WALLET_QR);
  }
  warn.mockRestore();
  error.mockRestore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetWalletConfigMemoForTests();
  resetGoogleWalletMemoForTests();
});

describe("appleWalletPost", () => {
  it("brak konfiguracji -> 503 bez dotykania bazy i limitu", async () => {
    vi.stubEnv("APPLE_WALLET_PASS_TYPE_ID", "");
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expectPrivateHeaders(response);
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["kod za krótki", form({ token: "za-krotki" })],
    ["brak kodu", form({ lang: "pl" })],
    [
      "ciało nie jest formularzem",
      new Request(APPLE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    ],
  ])("%s -> 400 invalid_token, zanim zadziała limit", async (_label, request) => {
    stubApple();
    const response = await appleWalletPost(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it("limit tempa po IP (zamknięty przy awarii) -> 429 z Retry-After", async () => {
    stubApple();
    h.rateLimit.mockResolvedValue(false);
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(await response.json()).toEqual({ error: "rate_limited" });
    // Luźny kubełek po IP: cała sala za jednym NAT-em nie może się zatkać.
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "event_wallet.apple",
      subjectId: "203.0.113.7",
      max: 200,
      windowMinutes: 10,
      failClosed: true,
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("limit tempa po KODZIE -> 429; kubełek nosi skrót kodu, nigdy sam kod", async () => {
    stubApple();
    h.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    const subject = createHash("sha256").update(WALLET_QR, "utf8").digest("hex").slice(0, 32);
    expect(h.rateLimit).toHaveBeenLastCalledWith({
      scope: "event_wallet.apple.token",
      subjectId: subject,
      max: 10,
      windowMinutes: 10,
      failClosed: true,
    });
    expect(JSON.stringify(h.rateLimit.mock.calls)).not.toContain(WALLET_QR);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each(["not_found: no valid ticket for this code", "invalid_token: qr_token must be"])(
    "baza: %s -> 404 not_found (bez rozróżniania powodu)",
    async (message) => {
      stubApple();
      h.rpc.mockResolvedValue({ data: null, error: { message } });
      const response = await appleWalletPost(form({ token: WALLET_QR }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    },
  );

  it("brak zmiennych Supabase -> 503 not_configured w JSON-ie, a nie surowy błąd serwera", async () => {
    stubApple();
    h.caller.mockRejectedValue(new Error("server_misconfigured: missing Supabase environment"));
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expectPrivateHeaders(response);
    expect(h.rpc).not.toHaveBeenCalled();

    // Każda inna awaria klienta to 502 upstream.
    h.caller.mockRejectedValue(new Error("unauthorized"));
    const failed = await appleWalletPost(form({ token: WALLET_QR }));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "upstream" });
    expect(warn).toHaveBeenCalledWith("[wallet] caller client failed:", "unauthorized");
    h.caller.mockRejectedValue("boom");
    expect((await appleWalletPost(form({ token: WALLET_QR }))).status).toBe(502);
  });

  it("inny błąd bazy -> 502 upstream z ostrzeżeniem bez kodu; niepełny wiersz -> 502", async () => {
    stubApple();
    h.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const failed = await appleWalletPost(form({ token: WALLET_QR }));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "upstream" });
    expect(warn).toHaveBeenCalledWith("[wallet] payload rpc failed:", "connection reset");

    h.rpc.mockResolvedValue({ data: { registration_id: "x" }, error: null });
    const incomplete = await appleWalletPost(form({ token: WALLET_QR }));
    expect(incomplete.status).toBe(502);
  });

  it("intent=check -> 204 po wszystkich zaporach, bez budowy paczki i dziennika", async () => {
    stubApple();
    const response = await appleWalletPost(form({ token: WALLET_QR, intent: "check" }));
    expect(response.status).toBe(204);
    expectPrivateHeaders(response);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("sukces: .pkpass jako załącznik, prywatne nagłówki, klient wołającego, dziennik", async () => {
    stubApple();
    const response = await appleWalletPost(form({ token: ` ${WALLET_QR} `, lang: "en" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="bilet-wallet-kongres.pkpass"',
    );
    expectPrivateHeaders(response);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-length")).toBe(String(body.byteLength));

    // Dane biletu idą przez klienta WOŁAJĄCEGO (klucz publiczny, najemca z hosta).
    expect(h.caller).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("event_ticket_wallet_payload", {
      p_payload: { qr_token: WALLET_QR },
    });

    const zip = await JSZip.loadAsync(body);
    const pass = JSON.parse(await zip.file("pass.json")!.async("string")) as {
      barcodes: { message: string }[];
      description: string;
      eventTicket: { backFields: { key: string; value: string }[] };
    };
    expect(pass.barcodes[0].message).toBe(WALLET_QR);
    expect(pass.description).toBe("Ticket: Wallet congress");
    expect(pass.eventTicket.backFields.at(-1)).toEqual({
      key: "event_page",
      label: "Event page",
      value: "https://wydarzenia.example.org/events/wallet-kongres",
    });

    // Dziennik niesie skrót kodu (jak `qr_token_hash` w bazie), nigdy sam kod.
    expect(h.adminRpc).toHaveBeenCalledWith("_event_wallet_pass_note", {
      p_tenant: "52000000-0000-0000-0000-0000000000a0",
      p_registration_id: "52b00000-0000-0000-0000-0000000000a1",
      p_platform: "apple",
      p_object_id: "52b00000-0000-0000-0000-0000000000a1",
      p_code_hash: QR_HASH,
    });
  });

  it("nieznany host -> przepustka bez odnośnika do strony wydarzenia", async () => {
    stubApple();
    h.host = null;
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    const zip = await JSZip.loadAsync(new Uint8Array(await response.arrayBuffer()));
    const pass = JSON.parse(await zip.file("pass.json")!.async("string")) as {
      eventTicket: { backFields: { key: string }[] };
    };
    expect(pass.eventTicket.backFields.map((f) => f.key)).not.toContain("event_page");
  });

  it("awaria dziennika (błąd albo wyjątek) nie odbiera przepustki", async () => {
    stubApple();
    h.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    expect((await appleWalletPost(form({ token: WALLET_QR }))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith("[wallet] apple issue log failed:", "denied");
    h.adminRpc.mockRejectedValueOnce(new Error("boom"));
    expect((await appleWalletPost(form({ token: WALLET_QR }))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith("[wallet] apple issue log failed:", "Error: boom");
  });

  // ZMIANA ŚWIADOMA (OPS-14). Do 20261013111600 ten test utrwalał, że zły klucz
  // to 500 przy KAŻDYM kliknięciu („błąd serwera, nie brak konfiguracji") -
  // dokładnie zachowanie, które audyt wskazał jako defekt: przycisk widoczny,
  // każde dodanie kończy się błędem. Teraz nieczytelny klucz i klucz z innej
  // pary niż certyfikat są BRAKIEM konfiguracji: 503 przed limitem i bazą,
  // jedna czytelna linia logu, a dostępność chowa przycisk.
  it("nieczytelny klucz podpisującego -> 503 not_configured przed limitem i bazą, log z powodem", async () => {
    stubApple({
      APPLE_WALLET_SIGNER_KEY_PEM: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
    });
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[wallet\] apple wallet not configured: signer private key/),
    );
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.adminRpc).not.toHaveBeenCalled();
  });

  it("klucz z innej pary niż certyfikat Pass Type ID -> 503 not_configured i niedostępny portfel", async () => {
    // Klucz CA testowego PKI nie istnieje w fixture - inną parę daje klucz
    // wygenerowany tu, w teście (nigdzie nie zapisany).
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: Uint8Array.of(1, 0, 1),
        hash: "SHA-256",
      },
      true,
      ["sign"],
    );
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    stubApple({
      APPLE_WALLET_SIGNER_KEY_PEM: `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString("base64")}\n-----END PRIVATE KEY-----`,
    });
    const response = await appleWalletPost(form({ token: WALLET_QR }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("private key does not match the Pass Type ID certificate"),
    );
    expect(await walletAvailabilityGet().json()).toMatchObject({ apple: false });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("googleWalletPost", () => {
  function stubGoogleApi(status = 200) {
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("https://oauth2.googleapis.com")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
        : new Response("{}", { status }),
    );
  }

  it("brak konfiguracji -> 503", async () => {
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    const response = await googleWalletPost(jsonRequest({ token: WALLET_QR }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });

  it.each([
    ["zły JSON", "{"],
    ["JSON nie-obiekt", "7"],
    ["zły kształt kodu", { token: "abc" }],
    ["kod nie-napis", { token: 42 }],
  ])("%s -> 400 invalid_token", async (_label, body) => {
    stubGoogle();
    const response = await googleWalletPost(jsonRequest(body));
    expect(response.status).toBe(400);
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it("limit tempa -> 429 w osobnym kubełku Google", async () => {
    stubGoogle();
    h.rateLimit.mockResolvedValue(false);
    const response = await googleWalletPost(jsonRequest({ token: WALLET_QR }));
    expect(response.status).toBe(429);
    expect(h.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "event_wallet.google", subjectId: "203.0.113.8" }),
    );
  });

  it("kod bez ważnego biletu -> 404", async () => {
    stubGoogle();
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_found: x" } });
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(404);
  });

  it("sukces -> { saveUrl } bez kodu biletu w adresie, dziennik z identyfikatorem obiektu", async () => {
    stubGoogle();
    stubGoogleApi();
    const response = await googleWalletPost(jsonRequest({ token: WALLET_QR, lang: "pl" }));
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    const body = (await response.json()) as { saveUrl: string };
    expect(body.saveUrl.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
    expect(body.saveUrl).not.toContain(WALLET_QR);
    const objectId = `${GOOGLE_CONFIG_FIXTURE.issuerId}.reg_52b00000-0000-0000-0000-0000000000a1.${await walletObjectSuffix(WALLET_QR)}`;
    expect(h.adminRpc).toHaveBeenNthCalledWith(1, "_event_wallet_pass_state", {
      p_tenant: "52000000-0000-0000-0000-0000000000a0",
      p_platform: "google",
      p_object_id: objectId,
    });
    expect(h.adminRpc).toHaveBeenNthCalledWith(2, "_event_wallet_pass_note", {
      p_tenant: "52000000-0000-0000-0000-0000000000a0",
      p_registration_id: "52b00000-0000-0000-0000-0000000000a1",
      p_platform: "google",
      p_object_id: objectId,
      p_code_hash: QR_HASH,
      p_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("odmowa Google -> 502 wallet_failed, bez wpisu do dziennika", async () => {
    stubGoogle();
    stubGoogleApi(403);
    const response = await googleWalletPost(jsonRequest({ token: WALLET_QR }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "wallet_failed" });
    expect(h.adminRpc).not.toHaveBeenCalledWith("_event_wallet_pass_note", expect.anything());
  });

  it("obiekt aktywny z tą samą treścią w dzienniku -> bez zapisu obiektu w Google (OPS-14)", async () => {
    stubGoogle();
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      fetches.push(`${String(init.method)} ${url}`);
      return url.startsWith("https://oauth2.googleapis.com")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
        : new Response("{}", { status: 200 });
    });
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    const note = h.adminRpc.mock.calls.find(([name]) => name === "_event_wallet_pass_note");
    const contentHash = (note?.[1] as { p_content_hash: string }).p_content_hash;

    h.adminRpc
      .mockReset()
      .mockImplementation(async (name: string) =>
        name === "_event_wallet_pass_state"
          ? { data: { content_hash: contentHash, active: true }, error: null }
          : { data: 2, error: null },
      );
    fetches.length = 0;
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    expect(fetches.filter((f) => f.includes("/eventTicketObject"))).toEqual([]);
    expect(h.adminRpc).toHaveBeenCalledWith(
      "_event_wallet_pass_note",
      expect.objectContaining({ p_content_hash: contentHash }),
    );

    // Obiekt nieznany dziennikowi -> wstawienie od razu (POST), bez PATCH -> 404.
    h.adminRpc
      .mockReset()
      .mockImplementation(async (name: string) =>
        name === "_event_wallet_pass_state"
          ? { data: null, error: null }
          : { data: 1, error: null },
      );
    fetches.length = 0;
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    expect(fetches.filter((f) => f.includes("/eventTicketObject"))).toEqual([
      "POST https://walletobjects.googleapis.com/walletobjects/v1/eventTicketObject",
    ]);
  });

  it("błąd odczytu stanu nie blokuje dodania (ostrzeżenie); migracja w drodze - po cichu", async () => {
    stubGoogle();
    stubGoogleApi();
    h.adminRpc.mockImplementation(async (name: string) =>
      name === "_event_wallet_pass_state"
        ? { data: null, error: { code: "57014", message: "statement timeout" } }
        : { data: 1, error: null },
    );
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith("[wallet] google pass state failed:", "statement timeout");

    warn.mockClear();
    h.adminRpc.mockImplementation(async (name: string) =>
      name === "_event_wallet_pass_state"
        ? { data: null, error: { code: "PGRST202", message: "no function" } }
        : { data: 1, error: null },
    );
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it("baza sprzed migracji 20261013111600 -> obiekt w STARYM kształcie i dziennik z czterema argumentami (F8)", async () => {
    // Stara funkcja dziennika trzyma jeden wiersz na zgłoszenie i nadpisuje
    // jego `object_id`. Obiekt z kodem nadpisałby wiersz obiektu sprzed OPS-14,
    // który wtedy nigdy nie trafiłby do dezaktywacji.
    stubGoogle();
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      fetches.push(`${String(init.method)} ${url}`);
      return url.startsWith("https://oauth2.googleapis.com")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
        : new Response("{}", { status: 200 });
    });
    let noteCalls = 0;
    h.adminRpc.mockImplementation(async (name: string) => {
      const pending = { data: null, error: { code: "PGRST202", message: "no function" } };
      if (name === "_event_wallet_pass_state") return pending;
      noteCalls += 1;
      return noteCalls === 1 ? pending : { data: 1, error: null };
    });
    const response = await googleWalletPost(jsonRequest({ token: WALLET_QR }));
    expect(response.status).toBe(200);

    const legacyId = `${GOOGLE_CONFIG_FIXTURE.issuerId}.reg_52b00000-0000-0000-0000-0000000000a1`;
    // Zapis jak przed OPS-14: PATCH obiektu w starym kształcie (bez wstawienia od razu).
    expect(fetches.filter((f) => f.includes("/eventTicketObject"))).toEqual([
      `PATCH https://walletobjects.googleapis.com/walletobjects/v1/eventTicketObject/${encodeURIComponent(legacyId)}`,
    ]);
    const { saveUrl } = (await response.json()) as { saveUrl: string };
    expect(jwtPayload(saveUrl)).toMatchObject({
      payload: { eventTicketObjects: [{ id: legacyId }] },
    });
    const notes = h.adminRpc.mock.calls.filter(([name]) => name === "_event_wallet_pass_note");
    expect(notes).toHaveLength(2);
    expect(notes[0][1]).toMatchObject({ p_object_id: legacyId, p_code_hash: QR_HASH });
    expect(notes[1][1]).toEqual({
      p_tenant: "52000000-0000-0000-0000-0000000000a0",
      p_registration_id: "52b00000-0000-0000-0000-0000000000a1",
      p_platform: "google",
      p_object_id: legacyId,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("obiekt z kodem nigdy nie trafia do starej sygnatury dziennika - ostrzeżenie zamiast nadpisania", async () => {
    // Funkcja stanu jest (migracja weszła), a dziennik z kodem zwraca PGRST202
    // (np. nieodświeżony cache schematu). Czteroargumentowy upsert po
    // zgłoszeniu nadpisałby wiersz innego obiektu.
    stubGoogle();
    stubGoogleApi();
    h.adminRpc.mockImplementation(async (name: string) =>
      name === "_event_wallet_pass_state"
        ? { data: null, error: null }
        : { data: null, error: { code: "PGRST202", message: "no function" } },
    );
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    const notes = h.adminRpc.mock.calls.filter(([name]) => name === "_event_wallet_pass_note");
    expect(notes).toHaveLength(1);
    expect((notes[0][1] as { p_object_id: string }).p_object_id).toBe(
      `${GOOGLE_CONFIG_FIXTURE.issuerId}.reg_52b00000-0000-0000-0000-0000000000a1.${await walletObjectSuffix(WALLET_QR)}`,
    );
    expect(warn).toHaveBeenCalledWith("[wallet] google issue log skipped: migration pending");
  });

  it("Apple przed migracją -> dziennik z czterema argumentami (identyfikator = numer zgłoszenia)", async () => {
    stubApple();
    let noteCalls = 0;
    h.adminRpc.mockImplementation(async () => {
      noteCalls += 1;
      return noteCalls === 1
        ? { data: null, error: { code: "PGRST202", message: "no function" } }
        : { data: 1, error: null };
    });
    expect((await appleWalletPost(form({ token: WALLET_QR }))).status).toBe(200);
    const notes = h.adminRpc.mock.calls.filter(([name]) => name === "_event_wallet_pass_note");
    expect(notes).toHaveLength(2);
    expect(notes[1][1]).toEqual({
      p_tenant: "52000000-0000-0000-0000-0000000000a0",
      p_registration_id: "52b00000-0000-0000-0000-0000000000a1",
      p_platform: "apple",
      p_object_id: "52b00000-0000-0000-0000-0000000000a1",
    });
  });

  it("obiekt aktywny bez skrótu treści (zgłoszenie dezaktywacji zamknięte po próbie) -> zapis obiektu (F7)", async () => {
    // Baza czyści `content_hash`, gdy PATCH INACTIVE mógł dojść do Google;
    // ponowne dodanie nie może wtedy pominąć zapisu (stan ACTIVE w treści).
    stubGoogle();
    const bodies: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      bodies.push({ url, body: String(init.body) });
      return url.startsWith("https://oauth2.googleapis.com")
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })
        : new Response("{}", { status: 200 });
    });
    h.adminRpc.mockImplementation(async (name: string) =>
      name === "_event_wallet_pass_state"
        ? { data: { content_hash: null, active: true }, error: null }
        : { data: 2, error: null },
    );
    expect((await googleWalletPost(jsonRequest({ token: WALLET_QR }))).status).toBe(200);
    const objectWrites = bodies.filter((b) => b.url.includes("/eventTicketObject"));
    expect(objectWrites).toHaveLength(1);
    expect(JSON.parse(objectWrites[0].body)).toMatchObject({ state: "ACTIVE" });
  });
});

describe("walletAvailabilityGet", () => {
  it("oddaje wyłącznie flagi, z krótkim cache publicznym", async () => {
    stubApple();
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    const response = walletAvailabilityGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({ apple: true, google: false });
  });
});
