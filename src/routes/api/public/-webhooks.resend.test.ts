// Webhook dostarczalności Resend - pętla zwrotna wysyłki.
//
// Bez tego endpointu platforma wie tylko tyle, że dostawca PRZYJĄŁ wiadomość:
// odbicia i skargi giną, a kolejna kampania idzie w te same martwe skrzynki
// (wytyczne Google wymagają utrzymania wskaźnika zgłoszeń spamu poniżej 0,30%
// i natychmiastowego zaprzestania wysyłki do zgłaszających).
//
// Endpoint jest PUBLICZNY, więc podpis nie jest formalnością: bez niego byłby
// to otwarty sposób na wpisanie DOWOLNEGO adresu na listę wykluczeń, czyli
// odcięcie redakcji od jej najważniejszych czytelników. Dlatego testy używają
// PRAWDZIWEJ weryfikacji podpisu (liczą HMAC tak jak dostawca), a nie atrapy -
// atrapa dowodziłaby tylko tego, że gałąź istnieje.
//
// Druga pilnowana reguła: otwarcia i kliknięcia dostawcy zapisują się do
// zaangażowania WYŁĄCZNIE wtedy, gdy operator uczynił dostawcę źródłem prawdy.
// Domyślnie ta gałąź milczy, bo mierzy dokładnie to samo, co nasz piksel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

const h = vi.hoisted(() => ({
  applyDeliveryEvent: vi.fn(),
  recordCampaignEvent: vi.fn(),
}));

vi.mock("@/lib/email/suppression.server", () => ({ applyDeliveryEvent: h.applyDeliveryEvent }));
vi.mock("@/lib/newsletter/trackingEvents.server", () => ({
  recordCampaignEvent: h.recordCampaignEvent,
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { __client: true } }));

import { __handleForTests as handle } from "@/routes/api/public/webhooks.resend";

const SECRET = "whsec_" + Buffer.from("tajny-klucz-webhooka").toString("base64");
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
const SUBSCRIBER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Podpisuje ładunek dokładnie tak, jak robi to dostawca (Svix). */
function signed(payload: string, id = "msg_1", timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

function request(payload: string, headers: Record<string, string>): Request {
  return new Request("https://example.test/api/public/webhooks/resend", {
    method: "POST",
    headers,
    body: payload,
  });
}

/** Ładunek webhooka Resend. */
function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "email.delivered",
    created_at: "2026-08-18T10:00:00.000Z",
    data: {
      email_id: "prov-msg-1",
      to: ["odbiorca@example.test"],
      created_at: "2026-08-18T10:00:00.000Z",
      ...((overrides.data as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

let savedSecret: string | undefined;
let savedSource: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.RESEND_WEBHOOK_SECRET;
  savedSource = process.env.NEWSLETTER_ENGAGEMENT_SOURCE;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  delete process.env.NEWSLETTER_ENGAGEMENT_SOURCE;

  h.applyDeliveryEvent.mockResolvedValue({
    ok: true,
    duplicate: false,
    suppressed: false,
    campaignId: null,
    subscriberId: null,
  });
  h.recordCampaignEvent.mockResolvedValue(undefined);

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = savedSecret;
  if (savedSource === undefined) delete process.env.NEWSLETTER_ENGAGEMENT_SOURCE;
  else process.env.NEWSLETTER_ENGAGEMENT_SOURCE = savedSource;
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("bramka konfiguracji", () => {
  it("bez sekretu endpoint NIE przetwarza treści - 503", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const payload = event();

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "not_configured" });
    expect(h.applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it("odpowiedzi nie wolno cache'ować", async () => {
    const payload = event();

    const res = await handle(request(payload, signed(payload)));

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("bramka podpisu", () => {
  it("brak nagłówków podpisu to 400 - dostawca odróżnia to od złego podpisu", async () => {
    const payload = event();

    const res = await handle(request(payload, {}));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "missing_headers" });
  });

  it("zły podpis to 401 i ZERO zapisów", async () => {
    const payload = event();
    const headers = signed(payload);
    headers["svix-signature"] = "v1,cGRvcmFiaW9ueQ==";

    const res = await handle(request(payload, headers));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "invalid_signature" });
    expect(h.applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it("podpis policzony dla INNEJ treści nie przechodzi (anty-podmiana)", async () => {
    const headers = signed(event());
    const podmieniony = event({ data: { to: ["ofiara@example.test"] } });

    const res = await handle(request(podmieniony, headers));

    expect(res.status).toBe(401);
    expect(h.applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it("stary znacznik czasu to odmowa (anty-replay)", async () => {
    const payload = event();
    const staryTimestamp = Math.floor(Date.now() / 1000) - 60 * 60;

    const res = await handle(request(payload, signed(payload, "msg_1", staryTimestamp)));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "expired" });
  });

  it("zbyt duży ładunek jest odrzucany przed weryfikacją", async () => {
    const payload = JSON.stringify({ type: "email.delivered", pad: "x".repeat(200 * 1024) });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: "payload_too_large" });
  });
});

describe("bramka treści", () => {
  it("treść niebędąca JSON-em to 400", async () => {
    const payload = "{to nie json";

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("ładunek bez typu zdarzenia to 400", async () => {
    const payload = JSON.stringify({ data: { to: ["a@example.test"] } });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "unsupported_payload" });
  });

  it("NIEZNANY typ zdarzenia przechodzi jako `other` - nowe zdarzenia nie znikają", async () => {
    const payload = event({ type: "email.something_new" });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent.mock.calls[0]?.[1]).toMatchObject({ kind: "other" });
  });
});

describe("zapis zdarzenia dostarczalności", () => {
  it("przekazuje znormalizowane zdarzenie z identyfikatorem dostawy jako kluczem", async () => {
    const payload = event();

    const res = await handle(request(payload, signed(payload, "delivery-42")));

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent.mock.calls[0]?.[1]).toMatchObject({
      provider: "resend",
      eventId: "delivery-42",
      eventType: "email.delivered",
      kind: "delivered",
      email: "odbiorca@example.test",
      providerMessageId: "prov-msg-1",
    });
  });

  it("odpowiedź niesie wynik zapisu, w tym flagę duplikatu", async () => {
    h.applyDeliveryEvent.mockResolvedValue({
      ok: true,
      duplicate: true,
      suppressed: false,
      campaignId: null,
      subscriberId: null,
    });
    const payload = event();

    const res = await handle(request(payload, signed(payload)));

    await expect(res.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
      kind: "delivered",
      suppressed: false,
    });
    expect(res.status).toBe(200);
  });

  it("twarde odbicie niesie klasyfikację i diagnostykę dostawcy", async () => {
    const payload = event({
      type: "email.bounced",
      data: {
        email_id: "prov-msg-2",
        to: ["martwy@example.test"],
        bounce: { type: "Permanent", subType: "General", message: "550 no such user" },
      },
    });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent.mock.calls[0]?.[1]).toMatchObject({
      kind: "bounced",
      diagnostic: "550 no such user",
    });
  });

  it("tagi wysyłki idą dalej WYŁĄCZNIE jako UUID-y (podrobiony tag odpada)", async () => {
    const payload = event({
      data: {
        email_id: "prov-msg-3",
        to: ["odbiorca@example.test"],
        tags: [
          { name: "tenant", value: "nie-uuid" },
          { name: "campaign", value: CAMPAIGN_ID },
        ],
      },
    });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    const applied = h.applyDeliveryEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(applied.tenantHint).toBeNull();
    expect(applied.campaignHint).toBe(CAMPAIGN_ID);
  });

  it("wyjątek w zapisie to 500 - dostawca ponowi, a idempotencja to zniesie", async () => {
    h.applyDeliveryEvent.mockRejectedValue(new Error("db down"));
    const payload = event();

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "handler_error" });
  });
});

describe("zaangażowanie: otwarcia i kliknięcia dostawcy", () => {
  const opened = () =>
    event({
      type: "email.opened",
      data: { email_id: "prov-msg-4", to: ["odbiorca@example.test"] },
    });

  beforeEach(() => {
    h.applyDeliveryEvent.mockResolvedValue({
      ok: true,
      duplicate: false,
      suppressed: false,
      campaignId: CAMPAIGN_ID,
      subscriberId: SUBSCRIBER_ID,
    });
  });

  it("zapisuje otwarcie z czasem WYSTĄPIENIA, nie odbioru webhooka", async () => {
    const payload = opened();

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    expect(h.recordCampaignEvent).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      subscriberId: SUBSCRIBER_ID,
      kind: "open",
      url: null,
      source: "provider",
      occurredAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("kliknięcie niesie adres docelowy", async () => {
    const payload = event({
      type: "email.clicked",
      data: {
        email_id: "prov-msg-5",
        to: ["odbiorca@example.test"],
        click: { link: "https://example.test/artykul" },
      },
    });

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    expect(h.recordCampaignEvent.mock.calls[0]?.[0]).toMatchObject({
      kind: "click",
      url: "https://example.test/artykul",
    });
  });

  it("DUPLIKAT dostawy nie zapisuje zaangażowania drugi raz", async () => {
    h.applyDeliveryEvent.mockResolvedValue({
      ok: true,
      duplicate: true,
      suppressed: false,
      campaignId: CAMPAIGN_ID,
      subscriberId: SUBSCRIBER_ID,
    });
    const payload = opened();

    const res = await handle(request(payload, signed(payload)));

    expect(res.status).toBe(200);
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("bez rozpoznanej kampanii nie ma czego zapisać", async () => {
    h.applyDeliveryEvent.mockResolvedValue({
      ok: true,
      duplicate: false,
      suppressed: false,
      campaignId: null,
      subscriberId: null,
    });
    const payload = opened();

    await handle(request(payload, signed(payload)));

    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
    expect(h.applyDeliveryEvent).toHaveBeenCalledTimes(1);
  });

  it("zdarzenie dostarczalności NIE jest zaangażowaniem", async () => {
    const payload = event();

    await handle(request(payload, signed(payload)));

    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
    // ...ale dziennik dostarczalności zapisuje się niezależnie.
    expect(h.applyDeliveryEvent).toHaveBeenCalledTimes(1);
  });
});
