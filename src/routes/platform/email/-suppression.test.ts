// Webhook wykluczeń dostawcy - POST /platform/email/suppression.
//
// To webhook dostawcy raportujący odbicia, skargi i wypisy. Bez podpisu HMAC
// endpoint byłby publicznym sposobem wpisania dowolnego adresu na listę
// wykluczeń (cichy DoS na pocztę wybranego odbiorcy). Łańcuch skutków sięga
// dalej niż newsletter: zepsuta higiena listy psuje reputację domeny, a z nią
// przestaje dochodzić poczta transakcyjna, w tym reset hasła.
//
// Dlatego testy pilnują trzech rzeczy naraz:
//   * odmowa bez ważnego podpisu następuje ZANIM cokolwiek zostanie zapisane
//     (asercje „nie wołano" na całej warstwie wykluczeń, nie sam kod HTTP),
//   * identyfikator zdarzenia jest STABILNY między ponowieniami - to jedyne,
//     co czyni retry dostawcy bezpiecznym, więc asercja na jego dokładny
//     kształt jest dowodem, a nie ozdobą,
//   * adres odbiorcy NIGDY nie trafia do logu w całości.
//
// Handler wołamy wprost przez `Route.options.server.handlers.POST` - nie
// trzeba do tego runtime'u routera ani zmian w kodzie produkcyjnym.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";

const h = vi.hoisted(() => {
  // Klasa MUSI powstać w bloku hoisted: fabryki `vi.mock` są wynoszone nad
  // deklaracje modułu, a `instanceof WebhookError` w kodzie trasy rozstrzyga
  // o tym, czy odmowa dostanie 401, 400, czy 500.
  class FakeWebhookError extends Error {
    code: string;
    constructor(code: string, message = code) {
      super(message);
      this.name = "WebhookError";
      this.code = code;
    }
  }
  return {
    FakeWebhookError,
    verifyWebhookRequest: vi.fn(),
    resolveTenantForAddress: vi.fn(),
    recordSuppression: vi.fn(),
    applyDeliveryEvent: vi.fn(),
  };
});

const FakeWebhookError = h.FakeWebhookError;

vi.mock("@lovable.dev/webhooks-js", () => ({
  WebhookError: h.FakeWebhookError,
  verifyWebhookRequest: h.verifyWebhookRequest,
}));

const db = supabaseFromStub();

// Trasa ładuje oba moduły DYNAMICZNIE (`await import(...)`), więc fabryki
// poniżej biegną dopiero w trakcie testu - stąd wolno im czytać `db`.
vi.mock("@/integrations/supabase/client.server", () => ({
  // Trasa tylko PRZEKAZUJE klienta do warstwy wykluczeń; atrapa łańcucha
  // wystarcza, a osobny test pilnuje, że przekazywany jest właśnie ten klient.
  supabaseAdmin: { from: db.from } as never,
}));

vi.mock("@/lib/email/suppression.server", () => ({
  resolveTenantForAddress: h.resolveTenantForAddress,
  recordSuppression: h.recordSuppression,
  applyDeliveryEvent: h.applyDeliveryEvent,
}));

import { Route } from "@/routes/platform/email/suppression";

/** Żądanie webhooka. Domyślnie BEZ nagłówków podpisu - podpis weryfikuje atrapa. */
function post(headers: Record<string, string> = {}): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  return handlers.POST({
    request: new Request("https://example.test/platform/email/suppression", {
      method: "POST",
      headers,
      body: JSON.stringify({ data: { email: "odbiorca@example.test", reason: "bounce" } }),
    }),
  });
}

/** Ładunek w kształcie, jaki oddaje parser dostawcy. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "odbiorca@example.test",
    reason: "bounce",
    is_retry: false,
    retry_count: 0,
    ...overrides,
  };
}

/** Wynik `applyDeliveryEvent` w kształcie, który czyta trasa. */
function applied(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    duplicate: false,
    tenantId: "tenant-1",
    campaignId: null,
    subscriberId: null,
    suppressed: true,
    ...overrides,
  };
}

/** Skrót: ten ładunek zostanie uznany za zweryfikowany. */
function verified(overrides: Record<string, unknown> = {}): void {
  h.verifyWebhookRequest.mockResolvedValue({ payload: payload(overrides) });
}

/**
 * Parser, który trasa WKŁADA do weryfikacji podpisu. Nie jest eksportowany,
 * więc jedyną uczciwą drogą do niego jest argument atrapy - i to on decyduje,
 * jakie ciała w ogóle wejdą do systemu.
 */
function capturedParser(): (body: string) => unknown {
  const [args] = h.verifyWebhookRequest.mock.calls[0] as [{ parser: (body: string) => unknown }];
  return args.parser;
}

/** Parser po jednym przebiegu żądania (weryfikacja musi zostać wywołana). */
async function parser(): Promise<(body: string) => unknown> {
  await post();
  return capturedParser();
}

/** Klient bazy z PIERWSZEGO wywołania atrapy - do asercji o tym, co trasa przekazuje. */
function adminPassedTo(mock: typeof h.recordSuppression): { from: unknown } {
  const [admin] = mock.mock.calls[0] as [{ from: unknown }];
  return admin;
}

const ENV_KEYS = ["LOVABLE_API_KEY"] as const;
let savedEnv: Record<string, string | undefined>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Bez tego `mock.calls[0]` niesie wywołanie z POPRZEDNIEGO testu, a asercja
  // o kształcie identyfikatora zdarzenia porównuje dwa różne przebiegi.
  vi.clearAllMocks();

  // Trasa stempluje zdarzenie `new Date().toISOString()`. Zegar musi stać,
  // inaczej asercja na `occurredAt` byłaby asercją na moment uruchomienia CI.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));

  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LOVABLE_API_KEY = "lov-key";

  db.reset();

  verified();
  h.resolveTenantForAddress.mockResolvedValue("tenant-1");
  h.recordSuppression.mockResolvedValue(true);
  h.applyDeliveryEvent.mockResolvedValue(applied());

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.useRealTimers();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Asercja zbiorcza: warstwa wykluczeń nie została w ogóle uruchomiona. */
function expectNoSuppressionWork(): void {
  expect(h.resolveTenantForAddress).not.toHaveBeenCalled();
  expect(h.recordSuppression).not.toHaveBeenCalled();
  expect(h.applyDeliveryEvent).not.toHaveBeenCalled();
}

describe("konfiguracja - brak sekretu", () => {
  it("bez klucza platformy nie zaczyna się ŻADNA praca, a odpowiedź to 500", async () => {
    delete process.env.LOVABLE_API_KEY;

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Server configuration error" });
    // Kluczowe: weryfikacja nawet nie ruszyła - nie ma jak „przypadkiem"
    // przepuścić ładunku przy niedokonfigurowanym środowisku.
    expect(h.verifyWebhookRequest).not.toHaveBeenCalled();
    expectNoSuppressionWork();
  });
});

describe("podpis - odmowa przed jakąkolwiek pracą", () => {
  it("żądanie bez podpisu nie wpisuje nikogo na listę wykluczeń", async () => {
    h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError("invalid_signature"));

    const res = await post();

    expect(res.status).toBe(401);
    // Bez tej asercji test „przechodziłby" także wtedy, gdyby trasa najpierw
    // zapisała blokadę, a dopiero potem zwróciła 401.
    expectNoSuppressionWork();
  });

  it.each(["invalid_signature", "stale_timestamp"])(
    "odmowa podpisu (%s) to 401 - obcy nie zablokuje cudzej poczty",
    async (code) => {
      h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError(code));

      const res = await post();

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: code });
      expectNoSuppressionWork();
    },
  );

  it.each(["invalid_payload", "invalid_json"])(
    "ładunek w nieznanym kształcie (%s) to 400, nie cicha blokada",
    async (code) => {
      h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError(code));

      const res = await post();

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Invalid payload" });
      expectNoSuppressionWork();
    },
  );

  it("kod błędu spoza słownika też kończy się odmową, a nie domyślnym „wpuść”", async () => {
    h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError("unknown_code"));

    const res = await post();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Verification failed" });
    expectNoSuppressionWork();
  });

  it("awaria weryfikacji spoza klasy błędów dostawcy daje 500 - dostawca ponowi", async () => {
    h.verifyWebhookRequest.mockRejectedValue(new Error("biblioteka podpisów padła"));

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal error" });
    expectNoSuppressionWork();
  });

  it("każda odmowa zostawia ślad w logu - inaczej atak byłby niewidoczny", async () => {
    h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError("invalid_signature"));

    await post();

    expect(errorSpy).toHaveBeenCalledWith("[platform-suppression] rejected", {
      code: "invalid_signature",
    });
  });

  it("sekret przekazany do weryfikacji to klucz platformy, nie stała z kodu", async () => {
    await post();

    const [args] = h.verifyWebhookRequest.mock.calls[0] as [{ secret: string; req: Request }];
    expect(args.secret).toBe("lov-key");
    expect(args.req).toBeInstanceOf(Request);
  });
});

describe("parser ładunku - co w ogóle wchodzi do systemu", () => {
  it("ciało bez pola `data` jest odrzucane, zanim powstanie jakakolwiek blokada", async () => {
    const parse = await parser();

    expect(() => parse(JSON.stringify({ email: "a@example.test" }))).toThrow(
      "Missing data field in payload",
    );
  });

  it.each([
    ["napis", '"tekst"'],
    ["null", "null"],
    ["liczba", "42"],
  ])("ciało nie-obiektowe (%s) nie jest ładunkiem webhooka", async (_label, body) => {
    const parse = await parser();

    expect(() => parse(body)).toThrow("Missing data field in payload");
  });

  it("ładunek bez adresu nie może wygenerować blokady „na nikogo”", async () => {
    const parse = await parser();

    expect(() => parse(JSON.stringify({ data: { reason: "bounce" } }))).toThrow(
      "Missing required fields: email, reason",
    );
  });

  it("ładunek bez powodu jest odrzucany - powód decyduje o powadze blokady", async () => {
    const parse = await parser();

    expect(() => parse(JSON.stringify({ data: { email: "a@example.test" } }))).toThrow(
      "Missing required fields: email, reason",
    );
  });

  it("puste `data` nie przechodzi za bramkę parsera", async () => {
    const parse = await parser();

    expect(() => parse(JSON.stringify({ data: null }))).toThrow(
      "Missing required fields: email, reason",
    );
  });

  it("ciało niebędące poprawnym JSON-em wysadza parser, zamiast dać pusty ładunek", async () => {
    const parse = await parser();

    expect(() => parse("nie-json")).toThrow(SyntaxError);
  });

  it("ładunek ZBIORCZY (tablica w `data`) jest odrzucany - trasa obsługuje jeden wpis", async () => {
    const parse = await parser();

    // Ustalenie faktu, nie życzenia: dostawca musi przysłać osobne żądanie na
    // adres. Gdyby ktoś kiedyś wysłał paczkę, cicho zniknęłaby w całości.
    expect(() =>
      parse(
        JSON.stringify({
          data: [
            { email: "a@example.test", reason: "bounce" },
            { email: "b@example.test", reason: "complaint" },
          ],
        }),
      ),
    ).toThrow("Missing required fields: email, reason");
  });

  it("poprawny ładunek oddaje samo `data` - reszta koperty nie jedzie dalej", async () => {
    const parse = await parser();

    expect(
      parse(
        JSON.stringify({
          type: "suppression",
          data: { email: "a@example.test", reason: "bounce", is_retry: false, retry_count: 0 },
        }),
      ),
    ).toEqual({ email: "a@example.test", reason: "bounce", is_retry: false, retry_count: 0 });
  });
});

describe("klasyfikacja powodu - od niej zależy powaga blokady", () => {
  it("odbicie księgowane jest jako TWARDE - miękkie wygasłoby po dobie", async () => {
    verified({ reason: "bounce" });

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(expect.anything(), {
      provider: "platform",
      eventId: "platform:odbiorca@example.test:bounce",
      eventType: "platform.bounce",
      kind: "bounced",
      email: "odbiorca@example.test",
      providerMessageId: null,
      bounceClass: "hard",
      diagnostic: "Permanent bounce - email address is invalid or rejected",
      occurredAt: "2026-08-22T10:00:00.000Z",
      payload: {},
    });
  });

  it("skarga na spam to osobny rodzaj zdarzenia, bez klasy odbicia", async () => {
    verified({ reason: "complaint" });

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "complained",
        bounceClass: null,
        eventType: "platform.complaint",
        diagnostic: "Spam complaint - recipient marked email as spam",
      }),
    );
  });

  it("powód spoza słownika NIE jest ignorowany - domyślnie twarde odbicie", async () => {
    verified({ reason: "wymyślony_przez_dostawcę" });

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "bounced", bounceClass: "hard" }),
    );
  });

  it("wypis nie idzie ścieżką dostarczalności - to decyzja odbiorcy, nie awaria", async () => {
    verified({ reason: "unsubscribe" });

    await post();

    expect(h.applyDeliveryEvent).not.toHaveBeenCalled();
    expect(h.recordSuppression).toHaveBeenCalledTimes(1);
  });
});

describe("wypis - blokada za zgodą odbiorcy", () => {
  it("wypis kończy się blokadą o właściwym powadze, źródle i dostawcy", async () => {
    verified({ reason: "unsubscribe" });

    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, reason: "unsubscribe" });
    expect(h.recordSuppression).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "tenant-1",
      email: "odbiorca@example.test",
      reason: "unsubscribe",
      source: "system",
      provider: "platform",
      providerMessageId: null,
      eventId: "platform:odbiorca@example.test:unsubscribe",
      diagnostic: "Recipient unsubscribed",
    });
  });

  it("identyfikator wiadomości od dostawcy jedzie razem z blokadą wypisu", async () => {
    verified({ reason: "unsubscribe", message_id: "msg-77" });

    await post();

    expect(h.recordSuppression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerMessageId: "msg-77",
        eventId: "platform:msg-77:unsubscribe",
      }),
    );
  });

  it("adres bez najemcy nie kończy się cichym „ok” - dostawca dostaje 500 i ponowi", async () => {
    verified({ reason: "unsubscribe" });
    h.resolveTenantForAddress.mockResolvedValue(null);

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to write suppression" });
    expect(h.recordSuppression).not.toHaveBeenCalled();
  });

  it("log o braku najemcy niesie adres ZREDAGOWANY, nie pełny", async () => {
    verified({ reason: "unsubscribe" });
    h.resolveTenantForAddress.mockResolvedValue(null);

    await post();

    expect(errorSpy).toHaveBeenCalledWith("[platform-suppression] no tenant for address", {
      email_redacted: "o***@example.test",
    });
  });

  it("nieudany zapis blokady to 500 - inaczej odbiorca dalej dostawałby maile", async () => {
    verified({ reason: "unsubscribe" });
    h.recordSuppression.mockResolvedValue(false);

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to write suppression" });
  });
});

describe("odbicie i skarga - idempotencja ponowień", () => {
  it("identyfikator zdarzenia bierze się z `message_id` dostawcy, gdy ten go przysłał", async () => {
    verified({ reason: "bounce", message_id: "msg-77" });

    await post();

    // Ten sam `message_id` w ponowieniu daje ten sam identyfikator, więc
    // powtórka nie zdubluje wpisu w logu dostarczalności.
    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "platform:msg-77:bounce",
        providerMessageId: "msg-77",
      }),
    );
  });

  it("bez `message_id` identyfikator składa się z adresu i powodu - nadal STABILNY", async () => {
    verified({ reason: "complaint" });

    await post();

    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "platform:odbiorca@example.test:complaint",
        providerMessageId: null,
      }),
    );
  });

  it("dwa identyczne żądania dają ten sam identyfikator zdarzenia", async () => {
    verified({ reason: "bounce", is_retry: true, retry_count: 3 });

    await post();
    await post();

    const [, first] = h.applyDeliveryEvent.mock.calls[0] as [unknown, { eventId: string }];
    const [, second] = h.applyDeliveryEvent.mock.calls[1] as [unknown, { eventId: string }];
    expect(second.eventId).toBe(first.eventId);
  });

  it("ponowienie rozpoznane jako duplikat nie zapisuje drugi raz", async () => {
    h.applyDeliveryEvent.mockResolvedValue(applied({ duplicate: true }));

    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      duplicate: true,
      suppressed: true,
    });
    expect(h.applyDeliveryEvent).toHaveBeenCalledTimes(1);
    expect(h.recordSuppression).not.toHaveBeenCalled();
  });

  it("nieudane zaksięgowanie zdarzenia to 500 - dostawca ponowi, a retry jest bezpieczny", async () => {
    h.applyDeliveryEvent.mockResolvedValue(applied({ ok: false, suppressed: false }));

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to write suppression" });
  });

  it("porażka księgowania zostawia w logu powód i zredagowany adres", async () => {
    h.applyDeliveryEvent.mockResolvedValue(applied({ ok: false }));

    await post();

    expect(errorSpy).toHaveBeenCalledWith("[platform-suppression] apply failed", {
      email_redacted: "o***@example.test",
      reason: "bounce",
    });
  });

  it("sukces raportuje, czy adres został zablokowany - inaczej nie widać skutku", async () => {
    h.applyDeliveryEvent.mockResolvedValue(applied({ suppressed: false }));

    const res = await post();

    await expect(res.json()).resolves.toEqual({
      success: true,
      duplicate: false,
      suppressed: false,
    });
  });

  it("znacznik czasu zdarzenia jest stemplowany przez trasę, nie zgadywany później", async () => {
    await post();

    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ occurredAt: "2026-08-22T10:00:00.000Z" }),
    );
  });
});

describe("metadane i normalizacja adresu", () => {
  it("brak metadanych daje pusty ładunek, nie `undefined` w kolumnie JSON", async () => {
    await post();

    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: {} }),
    );
  });

  it("metadane dostawcy jadą do logu zdarzenia w całości", async () => {
    verified({ metadata: { smtp_code: "550", host: "mx.example.test" } });

    await post();

    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: { smtp_code: "550", host: "mx.example.test" } }),
    );
  });

  it("adres z wielkimi literami i spacjami jest normalizowany - inaczej blokada minęłaby się z wysyłką", async () => {
    verified({ email: "  ODBIORCA@Example.TEST  " });

    await post();

    expect(h.applyDeliveryEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "odbiorca@example.test",
        // Normalizacja MUSI zajść przed złożeniem identyfikatora, inaczej
        // „ODBIORCA@..." i „odbiorca@..." to dla idempotencji dwa zdarzenia.
        eventId: "platform:odbiorca@example.test:bounce",
      }),
    );
  });

  it("normalizacja obowiązuje też ścieżkę wypisu", async () => {
    verified({ reason: "unsubscribe", email: "ODBIORCA@Example.TEST" });

    await post();

    expect(h.resolveTenantForAddress).toHaveBeenCalledWith(
      expect.anything(),
      "odbiorca@example.test",
    );
    expect(h.recordSuppression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "odbiorca@example.test" }),
    );
  });
});

describe("redakcja adresu w logach", () => {
  it("log sukcesu niesie zamaskowany adres, licznik ponowień i skutek", async () => {
    verified({ retry_count: 2 });
    h.applyDeliveryEvent.mockResolvedValue(applied({ duplicate: true }));

    await post();

    expect(logSpy).toHaveBeenCalledWith("[platform-suppression] processed", {
      email_redacted: "o***@example.test",
      reason: "bounce",
      duplicate: true,
      suppressed: true,
      retry_count: 2,
    });
  });

  it("pełny adres NIGDY nie pojawia się w logu sukcesu", async () => {
    await post();

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("odbiorca@example.test");
    expect(logged).toContain("o***@example.test");
  });

  it("adres bez małpy jest maskowany w całości, a nie przepisywany dosłownie", async () => {
    verified({ email: "brak-malpy" });

    await post();

    expect(logSpy).toHaveBeenCalledWith(
      "[platform-suppression] processed",
      expect.objectContaining({ email_redacted: "***" }),
    );
  });

  it("adres bez części lokalnej też nie wycieka do logu", async () => {
    verified({ email: "@example.test" });

    await post();

    expect(logSpy).toHaveBeenCalledWith(
      "[platform-suppression] processed",
      expect.objectContaining({ email_redacted: "***" }),
    );
  });
});

describe("klient bazy", () => {
  it("do warstwy wykluczeń trafia serwisowy klient trasy, nie klient przeglądarki", async () => {
    verified({ reason: "unsubscribe" });

    await post();

    expect(adminPassedTo(h.recordSuppression).from).toBe(db.from);
    expect(adminPassedTo(h.resolveTenantForAddress).from).toBe(db.from);
  });

  it("ścieżka odbicia dostaje ten sam klient serwisowy", async () => {
    await post();

    expect(adminPassedTo(h.applyDeliveryEvent).from).toBe(db.from);
  });
});

describe("granica typów - czego parser NIE sprawdza", () => {
  it("parser bada tylko PRAWDZIWOŚĆ pól, nie ich typ - liczba w polu adresu przechodzi", async () => {
    const parse = await parser();

    // Ustalenie faktu, nie życzenia: bramka wejściowa przepuszcza ładunek,
    // którego dalsze ogniwa nie umieją obsłużyć.
    expect(parse(JSON.stringify({ data: { email: 123, reason: "bounce" } }))).toEqual({
      email: 123,
      reason: "bounce",
    });
  });

  // DEFEKT (kod produkcyjny nietknięty). Adres niebędący napisem dolatuje do
  // `payload.email.trim()` i wysadza handler wyjątkiem, zamiast dać
  // kontrolowaną odmowę. Konsekwencja: dostawca dostaje surową awarię zamiast
  // 400, w logu nie ma ani powodu, ani (zredagowanego) adresu, a ponieważ
  // wyjątek wygląda dla dostawcy jak błąd przejściowy, ten sam trujący ładunek
  // wraca w kolejnych ponowieniach i zaśmieca kanał zgłoszeń o odbiciach.
  it.fails(
    "adres niebędący napisem powinien kończyć się odmową, a nie wyjątkiem handlera",
    async () => {
      verified({ email: 123 });

      const res = await post();

      expect(res.status).toBe(400);
    },
  );
});
