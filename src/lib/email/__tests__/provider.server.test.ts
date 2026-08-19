// JEDNA droga wyjścia poczty z platformy - i pierwsza, która ma test.
//
// Ten moduł decyduje, czy mail w ogóle wyjdzie, oraz - co ważniejsze - JAK
// wywołujący ma zareagować, gdy nie wyszedł. Trzy pola wyniku sterują całą
// pętlą ponowień: `rateLimited` wstrzymuje CAŁĄ wysyłkę (nie tylko tę
// wiadomość), `permanent` kieruje wiadomość prosto do DLQ zamiast na kolejną
// próbę, a `messageId` jest JEDYNYM kluczem korelacji webhooka odbicia z
// odbiorcą. Pomyłka w którymkolwiek z nich nie wywala się głośno - cicho psuje
// dostarczalność: przy złym `permanent` kolejka miele martwy adres w
// nieskończoność, przy zgubionym `messageId` odbicie nigdy nie trafi na listę
// wykluczeń i domena jedzie pod próg skarg Google.
//
// ŻADEN test nie wykonuje prawdziwego żądania: `fetch` i `@lovable.dev/email-js`
// są atrapami, adresy wyłącznie syntetyczne (@example.test).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ sendLovableEmail: vi.fn() }));

vi.mock("@lovable.dev/email-js", () => ({ sendLovableEmail: h.sendLovableEmail }));

import { emailProviderConfigured, sendEmail } from "@/lib/email/provider.server";

const GATEWAY = "https://connector-gateway.lovable.dev/resend/emails";

/** Minimalny, poprawny ładunek - test dokłada tylko to, co bada. */
function input(overrides: Partial<Parameters<typeof sendEmail>[0]> = {}) {
  return {
    to: "odbiorca@example.test",
    subject: "Temat",
    html: "<p>Treść</p>",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const ENV_KEYS = ["LOVABLE_API_KEY", "RESEND_API_KEY", "LOVABLE_SEND_URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  h.sendLovableEmail.mockReset();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

/** Oba klucze => gateway Resend jest pierwszym wyborem. */
function withResend(): void {
  process.env.LOVABLE_API_KEY = "lov-key";
  process.env.RESEND_API_KEY = "re-key";
}

/** Sam klucz platformy => zapasowy nadawca (bez identyfikatora wiadomości). */
function withPlatformOnly(): void {
  process.env.LOVABLE_API_KEY = "lov-key";
}

function lastRequestBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

describe("emailProviderConfigured", () => {
  it("widzi gateway Resend, gdy są OBA klucze", () => {
    withResend();
    expect(emailProviderConfigured()).toBe(true);
    expect(process.env.RESEND_API_KEY).toBe("re-key");
  });

  it("widzi zapasowego nadawcę przy samym kluczu platformy", () => {
    withPlatformOnly();
    expect(emailProviderConfigured()).toBe(true);
    expect(process.env.RESEND_API_KEY).toBeUndefined();
  });

  it("sam klucz Resend NIE wystarcza - gateway wymaga też klucza platformy", () => {
    process.env.RESEND_API_KEY = "re-key";
    expect(emailProviderConfigured()).toBe(false);
    expect(process.env.LOVABLE_API_KEY).toBeUndefined();
  });

  it("bez kluczy nie ma dostawcy", () => {
    expect(emailProviderConfigured()).toBe(false);
    expect(process.env.LOVABLE_API_KEY).toBeUndefined();
  });
});

describe("sendEmail - odmowy bez dotykania sieci", () => {
  it("pusty adres odbiorcy jest odmową TRWAŁĄ (nie ma czego ponawiać)", async () => {
    withResend();
    const res = await sendEmail(input({ to: "   " }));
    expect(res).toEqual({
      ok: false,
      error: "no_recipient",
      permanent: true,
      provider: "none",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak skonfigurowanego dostawcy też jest odmową trwałą", async () => {
    const res = await sendEmail(input());
    expect(res.error).toBe("email_not_configured");
    expect(res.permanent).toBe(true);
    expect(res.provider).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail - gateway Resend (ścieżka z identyfikatorem wiadomości)", () => {
  it("zwraca messageId dostawcy - klucz korelacji webhooków odbicia", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));

    const res = await sendEmail(input());

    expect(res).toEqual({ ok: true, messageId: "msg_1", provider: "resend" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(GATEWAY);
  });

  it("wysyła klucze w nagłówkach, a odbiorcę w tablicy `to`", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));

    await sendEmail(input({ subject: "Newsletter", replyTo: "biuro@example.test" }));

    const init = fetchMock.mock.calls[0]?.[1] as {
      method?: string;
      headers?: Record<string, string>;
    };
    expect(init.method).toBe("POST");
    expect(init.headers?.Authorization).toBe("Bearer lov-key");
    expect(init.headers?.["X-Connection-Api-Key"]).toBe("re-key");
    const body = lastRequestBody();
    expect(body.to).toEqual(["odbiorca@example.test"]);
    expect(body.subject).toBe("Newsletter");
    expect(body.reply_to).toBe("biuro@example.test");
  });

  it("pusta odpowiedź gatewaya NIE unieważnia wysyłki - jest ok bez korelacji", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const res = await sendEmail(input());

    expect(res.ok).toBe(true);
    expect(res.messageId).toBeNull();
  });

  it("identyfikator pusty lub nie-tekstowy traktujemy jak brak korelacji", async () => {
    withResend();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "   " }), { status: 200 }));
    const blank = await sendEmail(input());
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 42 }), { status: 200 }));
    const numeric = await sendEmail(input());

    expect(blank.messageId).toBeNull();
    expect(numeric.messageId).toBeNull();
    expect(blank.ok && numeric.ok).toBe(true);
  });

  it("odpowiedź, która nie jest obiektem, nie wywraca odczytu identyfikatora", async () => {
    withResend();
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 200 }));
    const nullBody = await sendEmail(input());
    fetchMock.mockResolvedValueOnce(new Response("123", { status: 200 }));
    const numberBody = await sendEmail(input());

    expect(nullBody.messageId).toBeNull();
    expect(numberBody.messageId).toBeNull();
    expect(nullBody.ok && numberBody.ok).toBe(true);
  });

  it("identyfikator jest przycinany z białych znaków", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: " msg_2 " }), { status: 200 }));

    const res = await sendEmail(input());

    expect(res.messageId).toBe("msg_2");
    expect(res.provider).toBe("resend");
  });
});

describe("sendEmail - nagłówki wypisu RFC 8058", () => {
  it("adres wypisu daje List-Unsubscribe ORAZ One-Click", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "m" }), { status: 200 }));

    await sendEmail(input({ listUnsubscribeUrl: "https://example.test/u/abc" }));

    const headers = lastRequestBody().headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toBe("<https://example.test/u/abc>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("bez adresu wypisu nie wysyłamy pustego obiektu nagłówków", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "m" }), { status: 200 }));

    await sendEmail(input());

    const body = lastRequestBody();
    expect(body.headers).toBeUndefined();
    expect(body.tags).toBeUndefined();
  });
});

describe("sendEmail - tagi korelacyjne", () => {
  it("mapuje tagi na listę {name,value} dostawcy", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "m" }), { status: 200 }));

    await sendEmail(input({ tags: { tenant: "t-1", campaign: "c-1" } }));

    expect(lastRequestBody().tags).toEqual([
      { name: "tenant", value: "t-1" },
      { name: "campaign", value: "c-1" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendEmail - klasyfikacja odmów gatewaya", () => {
  it("429 wstrzymuje CAŁĄ wysyłkę i podaje cooldown z nagłówka", async () => {
    withResend();
    fetchMock.mockResolvedValue(
      new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
    );

    const res = await sendEmail(input());

    expect(res.rateLimited).toBe(true);
    expect(res.retryAfterSeconds).toBe(30);
    // 429 NIE jest trwałe - to samo żądanie ma prawo się udać za chwilę.
    expect(res.permanent).toBe(false);
    expect(res.status).toBe(429);
  });

  it("Retry-After jako data HTTP jest przeliczany na sekundy", async () => {
    withResend();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
    fetchMock.mockResolvedValue(
      new Response("", {
        status: 429,
        headers: { "retry-after": "Tue, 18 Aug 2026 10:01:00 GMT" },
      }),
    );

    const res = await sendEmail(input());

    expect(res.retryAfterSeconds).toBe(60);
    expect(res.rateLimited).toBe(true);
    vi.useRealTimers();
  });

  it("data z przeszłości i śmieci w Retry-After dają brak cooldownu", async () => {
    withResend();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T10:00:00Z"));
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 429,
        headers: { "retry-after": "Tue, 18 Aug 2026 09:00:00 GMT" },
      }),
    );
    const past = await sendEmail(input());
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "wkrótce" } }),
    );
    const junk = await sendEmail(input());

    expect(past.retryAfterSeconds).toBeNull();
    expect(junk.retryAfterSeconds).toBeNull();
    expect(past.rateLimited && junk.rateLimited).toBe(true);
    vi.useRealTimers();
  });

  it("brak nagłówka Retry-After daje null, nie zero", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));

    const res = await sendEmail(input());

    expect(res.retryAfterSeconds).toBeNull();
    expect(res.rateLimited).toBe(true);
  });

  it("403 to odmowa TRWAŁA - ponawianie nic nie zmieni", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("forbidden sender", { status: 403 }));

    const res = await sendEmail(input());

    expect(res.permanent).toBe(true);
    expect(res.rateLimited).toBe(false);
    expect(res.error).toBe("forbidden sender");
  });

  it("408 (timeout) NIE jest trwałe, mimo że to 4xx", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("timeout", { status: 408 }));

    const res = await sendEmail(input());

    expect(res.permanent).toBe(false);
    expect(res.status).toBe(408);
  });

  it("5xx nie jest trwałe - awaria dostawcy mija", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("boom", { status: 503 }));

    const res = await sendEmail(input());

    expect(res.permanent).toBe(false);
    expect(res.ok).toBe(false);
  });

  it("puste ciało błędu zastępujemy kodem, żeby log nie był pusty", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    const res = await sendEmail(input());

    expect(res.error).toBe("http_500");
    expect(res.provider).toBe("resend");
  });

  it("długie ciało błędu jest przycinane do 500 znaków", async () => {
    withResend();
    fetchMock.mockResolvedValue(new Response("x".repeat(900), { status: 400 }));

    const res = await sendEmail(input());

    expect(res.error).toHaveLength(500);
    expect(res.permanent).toBe(true);
  });
});

describe("sendEmail - awaria sieci NIE degraduje do zapasowego dostawcy", () => {
  it("wyjątek z fetch kończy próbę, zamiast wysłać drugi raz inną drogą", async () => {
    // Oba klucze ustawione, więc zapasowy dostawca BYŁBY dostępny.
    withResend();
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const res = await sendEmail(input());

    expect(res.ok).toBe(false);
    expect(res.provider).toBe("resend");
    expect(res.error).toContain("ECONNRESET");
    // Sedno: ryzyko podwójnej wysyłki jest gorsze od jednej próby mniej.
    expect(h.sendLovableEmail).not.toHaveBeenCalled();
  });
});

describe("sendEmail - zapasowy nadawca platformy", () => {
  it("wysyła bez identyfikatora wiadomości (brak korelacji odbić)", async () => {
    withPlatformOnly();
    h.sendLovableEmail.mockResolvedValue({});

    const res = await sendEmail(input());

    expect(res).toEqual({ ok: true, messageId: null, provider: "platform" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("przekazuje pola korelacyjne kolejki i token wypisu", async () => {
    withPlatformOnly();
    process.env.LOVABLE_SEND_URL = "https://send.example.test";
    h.sendLovableEmail.mockResolvedValue({});

    await sendEmail(
      input({
        runId: "run-1",
        idempotencyKey: "idem-1",
        messageId: "our-msg-1",
        unsubscribeToken: "tok-1",
        senderDomain: "mail.example.test",
        label: "digest_daily",
      }),
    );

    const [payload, options] = h.sendLovableEmail.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(payload).toMatchObject({
      run_id: "run-1",
      idempotency_key: "idem-1",
      message_id: "our-msg-1",
      unsubscribe_token: "tok-1",
      sender_domain: "mail.example.test",
      label: "digest_daily",
      purpose: "transactional",
    });
    expect(options).toEqual({ apiKey: "lov-key", sendUrl: "https://send.example.test" });
  });

  it("429 od platformy wstrzymuje wysyłkę i niesie cooldown z błędu", async () => {
    withPlatformOnly();
    h.sendLovableEmail.mockRejectedValue(
      Object.assign(new Error("rate limited"), { status: 429, retryAfterSeconds: 12 }),
    );

    const res = await sendEmail(input());

    expect(res.rateLimited).toBe(true);
    expect(res.retryAfterSeconds).toBe(12);
    expect(res.permanent).toBe(false);
    expect(res.provider).toBe("platform");
  });

  it("401/403/422 od platformy to odmowa trwała", async () => {
    withPlatformOnly();
    for (const status of [401, 403, 422]) {
      h.sendLovableEmail.mockRejectedValueOnce(Object.assign(new Error("nope"), { status }));
      const res = await sendEmail(input());
      expect(res.permanent, `status ${status}`).toBe(true);
      expect(res.status, `status ${status}`).toBe(status);
    }
  });

  it("status odczytany z TREŚCI błędu, gdy nie ma pola `status`", async () => {
    withPlatformOnly();
    h.sendLovableEmail.mockRejectedValue(new Error("gateway returned 503 upstream"));

    const res = await sendEmail(input());

    expect(res.status).toBe(503);
    expect(res.permanent).toBe(false);
  });

  it("błąd bez statusu i bez liczby w treści nie udaje, że zna kod", async () => {
    withPlatformOnly();
    h.sendLovableEmail.mockRejectedValue(new Error("something broke"));

    const res = await sendEmail(input());

    expect(res.status).toBeUndefined();
    expect(res.retryAfterSeconds).toBeNull();
    expect(res.ok).toBe(false);
  });

  it("pola błędu o złym TYPIE są ignorowane, a nie rzutowane na siłę", async () => {
    withPlatformOnly();
    // Dostawca potrafi oddać `status` jako tekst; rzutowanie "429" na liczbę
    // zrobiłoby z tego wstrzymanie CAŁEJ wysyłki na podstawie zgadywanki.
    h.sendLovableEmail.mockRejectedValue(
      Object.assign(new Error("odmowa bez kodu"), { status: "429", retryAfterSeconds: "12" }),
    );

    const res = await sendEmail(input());

    expect(res.status).toBeUndefined();
    expect(res.retryAfterSeconds).toBeNull();
    expect(res.rateLimited).toBe(false);
    expect(res.permanent).toBe(false);
  });

  it("odrzucenie wartością inną niż Error nadal daje czytelny komunikat", async () => {
    withPlatformOnly();
    h.sendLovableEmail.mockRejectedValue("plain string failure");

    const res = await sendEmail(input());

    expect(res.error).toBe("plain string failure");
    expect(res.provider).toBe("platform");
  });
});
