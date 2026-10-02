// Wysyłka maila transakcyjnego - trasa, która renderuje treść i wkłada ją do
// kolejki, mając w ręku ZWERYFIKOWANĄ domenę nadawczą.
//
// Trasa stała na 0%, choć nie ma tu ani jednej ozdobnej linijki. Trzy bramki
// decydują o tym, czy to jest funkcja produktu, czy otwarty przekaźnik:
//   1. UWIERZYTELNIENIE - bez ważnego tokenu nie ma rozmowy,
//   2. AUTORYZACJA - sam ważny token to dowolne konto czytelnika; bez drugiej
//      bramki każdy zalogowany wysłałby z naszej domeny mail o dowolnej treści
//      na dowolny adres (klasyczny wektor phishingu),
//   3. ALLOWLISTA HOSTÓW - każdy link w mailu musi wskazywać na naszą domenę,
//      inaczej nasza treść firmuje cudzy adres docelowy.
// Do tego cykl życia tokenu wypisu: mail MUSI wyjść z DZIAŁAJĄCYM linkiem
// wypisu (RFC 8058), także wtedy, gdy poprzedni token został już zużyty.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  render: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  checkSendAllowed: vi.fn(),
  fixedToTemplate: { to: "" },
}));

vi.mock("@react-email/render", () => ({ render: h.render }));
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
vi.mock("@/lib/email/suppression.server", () => ({ checkSendAllowed: h.checkSendAllowed }));
vi.mock("@/lib/email-templates/registry", () => ({
  TEMPLATES: {
    // Szablon "zwykły": odbiorca podawany przez wywołującego.
    payment_receipt: {
      component: () => null,
      subject: "Potwierdzenie płatności",
    },
    // Szablon z USTALONYM odbiorcą (powiadomienie do właściciela serwisu).
    owner_alert: {
      component: () => null,
      subject: (data: Record<string, unknown>) => `Alert: ${String(data.kind ?? "brak")}`,
      get to() {
        return h.fixedToTemplate.to;
      },
    },
  },
}));

import { Route } from "@/routes/platform/email/transactional/send";

const db = supabaseFromStub();
const LOG = "email_send_log";
const TOKENS = "email_unsubscribe_tokens";
/**
 * Znacznik zużycia tokenu wypisu - JEDNA stała, nie literał powtórzony przy
 * każdej gałęzi. Wartość jest nieporównywana (liczy się samo „pole niepuste"),
 * a bramka `check:clock-freeze` liczy literały daty per plik: trzy kopie tej
 * samej daty to trzy pozycje długu za jedną informację.
 */
const TOKEN_ZUZYTY_AT = "2026-01-01T00:00:00Z";
const ROLES = "user_roles";

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  return handlers.POST({
    request: new Request("https://example.test/platform/email/transactional/send", {
      method: "POST",
      headers: { Authorization: "Bearer tok-1", "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  });
}

/** Domyślne, poprawne żądanie - test dokłada tylko to, co bada. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateName: "payment_receipt",
    recipientEmail: "odbiorca@example.test",
    templateData: {},
    ...overrides,
  };
}

/** Zalogowany użytkownik (domyślnie NIE-staff, wysyłający do siebie). */
function asUser(email = "odbiorca@example.test", roles: string[] = []): void {
  h.getUser.mockResolvedValue({ data: { user: { id: "u-1", email } }, error: null });
  db.setResponse(ROLES, ok(roles.map((role) => ({ role }))));
}

let savedKey: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  vi.stubEnv("VITE_SUPABASE_URL", "https://db.example.test");

  db.reset();
  db.setResponse(LOG, ok(null));
  // Domyślnie adres MA już ważny token wypisu - to najczęstszy stan i jedyny,
  // który nie wciąga testu w ścieżkę tworzenia tokenu. Testy cyklu życia
  // tokenu podmieniają tę odpowiedź na własną.
  db.setResponse(TOKENS, ok({ token: "tok-istniejacy", used_at: null }));
  h.fixedToTemplate.to = "";

  h.rpc.mockResolvedValue({ error: null });
  h.render.mockResolvedValue("<html>mail</html>");
  h.checkSendAllowed.mockResolvedValue({ allowed: true, hit: null, tenantId: "tenant-1" });
  h.createClient.mockReturnValue({
    auth: { getUser: h.getUser },
    from: db.from,
    rpc: h.rpc,
  });
  asUser();

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  vi.unstubAllEnvs();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Wszystkie ładunki wstawione do logu wysyłek, w kolejności. */
function logInserts(): Record<string, unknown>[] {
  return db
    .chainsFor(LOG)
    .map((c) => c.argsOf("insert")?.[0])
    .filter(Boolean) as Record<string, unknown>[];
}

/** Pierwszy argument ogniwa łańcucha (np. ładunek `insert`). */
function pierwszyArg(chain: RecordedChain, method: string): Record<string, unknown> {
  return (chain.argsOf(method)?.[0] ?? {}) as Record<string, unknown>;
}

/** Filtry `eq` łańcucha jako obiekt kolumna -> wartość. */
function filtryEq(chain: RecordedChain): Record<string, unknown> {
  return Object.fromEntries(
    chain.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]),
  );
}

/** Jedyna aktualizacja dziennika (ustawione pola + filtry) albo `undefined`. */
function logUpdate(): { set: Record<string, unknown>; where: Record<string, unknown> } | undefined {
  const updates = db.chainsFor(LOG).filter((c) => c.has("update"));
  expect(updates.length).toBeLessThanOrEqual(1);
  const chain = updates[0];
  return chain ? { set: pierwszyArg(chain, "update"), where: filtryEq(chain) } : undefined;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function queuedPayload(callIndex = 0): Record<string, unknown> {
  const args = h.rpc.mock.calls[callIndex]?.[1] as { payload: Record<string, unknown> };
  return args.payload;
}

describe("uwierzytelnienie", () => {
  it("brak konfiguracji serwera to 500, zanim cokolwiek dotknie żądania", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("brak nagłówka Authorization to 401", async () => {
    const handlers = routeServerHandlers(Route);
    const res = await handlers.POST({
      request: new Request("https://example.test/x", { method: "POST", body: "{}" }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("schemat inny niż Bearer to 401", async () => {
    const res = await post(body(), { Authorization: "Basic abc" });

    expect(res.status).toBe(401);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("token odrzucony przez Supabase to 401", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });

    const res = await post(body());

    expect(res.status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("token bez użytkownika to 401", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await post(body());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("walidacja żądania", () => {
  it("niepoprawny JSON to 400", async () => {
    const res = await post("{to nie json");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON in request body" });
  });

  it("brak nazwy szablonu to 400", async () => {
    const res = await post(body({ templateName: "" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "templateName is required" });
  });

  it("nazwa szablonu czytana jest też z wariantu snake_case", async () => {
    const res = await post({
      template_name: "payment_receipt",
      recipient_email: "odbiorca@example.test",
    });

    expect(res.status).toBe(200);
    expect(queuedPayload().label).toBe("payment_receipt");
  });

  it("nieznany szablon to 404 z listą dostępnych", async () => {
    const res = await post(body({ templateName: "nie_ma_takiego" }));

    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toContain("payment_receipt");
  });

  it("brak odbiorcy przy szablonie bez ustalonego `to` to 400", async () => {
    const res = await post(body({ recipientEmail: "" }));

    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ciało niebędące obiektem jest traktowane jak puste", async () => {
    const res = await post(["nie", "obiekt"]);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "templateName is required" });
  });
});

describe("autoryzacja - blokada otwartego przekaźnika", () => {
  it("zwykły użytkownik NIE wyśle na cudzy adres", async () => {
    asUser("ja@example.test");

    const res = await post(body({ recipientEmail: "ofiara@example.test" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Forbidden: only staff may send to another recipient",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zwykły użytkownik wyśle na WŁASNY adres", async () => {
    asUser("ja@example.test");

    const res = await post(body({ recipientEmail: "ja@example.test" }));

    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("porównanie własnego adresu jest bez wielkości liter", async () => {
    asUser("Ja@Example.TEST");

    const res = await post(body({ recipientEmail: "ja@example.test" }));

    expect(res.status).toBe(200);
    expect(queuedPayload().to).toBe("ja@example.test");
  });

  it.each(["admin", "editor", "author", "super_admin"])(
    "rola %s może wysłać na dowolny adres",
    async (role) => {
      asUser("redakcja@example.test", [role]);

      const res = await post(body({ recipientEmail: "ktokolwiek@example.test" }));

      expect(res.status).toBe(200);
      expect(queuedPayload().to).toBe("ktokolwiek@example.test");
    },
  );

  it("szablon z USTALONYM odbiorcą omija regułę - i wygrywa z adresem z żądania", async () => {
    asUser("ja@example.test");
    h.fixedToTemplate.to = "wlasciciel@example.test";

    const res = await post(
      body({ templateName: "owner_alert", recipientEmail: "inny@example.test" }),
    );

    expect(res.status).toBe(200);
    expect(queuedPayload().to).toBe("wlasciciel@example.test");
  });

  it("awaria odczytu ról to 403, nie ciche przepuszczenie", async () => {
    db.setResponse(ROLES, fail("permission denied"));

    const res = await post(body());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });
});

describe("allowlista hostów w linkach", () => {
  it.each(["ctaUrl", "siteUrl", "url", "link"])(
    "pole %s wskazujące poza naszą domenę to 400",
    async (field) => {
      asUser("ja@example.test", ["admin"]);

      const res = await post(body({ templateData: { [field]: "https://phishing.example/x" } }));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: `templateData.${field} must point to an allowed domain`,
      });
    },
  );

  it("adres, który nie jest adresem, to 400 z nazwą pola", async () => {
    asUser("ja@example.test", ["admin"]);

    const res = await post(body({ templateData: { ctaUrl: "nie-adres" } }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid URL in templateData.ctaUrl" });
  });

  it("nasza domena (także z www) przechodzi", async () => {
    asUser("ja@example.test", ["admin"]);

    const res = await post(
      body({
        templateData: {
          ctaUrl: "https://neweuropeanstrategies.com/konto",
          siteUrl: "https://www.neweuropeanstrategies.com",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("puste i nietekstowe pola linków są pomijane, nie odrzucane", async () => {
    asUser("ja@example.test", ["admin"]);

    const res = await post(body({ templateData: { ctaUrl: "", url: 42, link: null } }));

    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("bramka listy wykluczeń", () => {
  it("adres wykluczony NIE dostaje maila, a odmowa ląduje w logu", async () => {
    h.checkSendAllowed.mockResolvedValue({
      allowed: false,
      hit: { reason: "complaint" },
      tenantId: "tenant-1",
    });

    const res = await post(body());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: false, reason: "email_suppressed" });
    expect(logInserts()[0]).toMatchObject({ status: "suppressed" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("kategoria maila jest wyprowadzana z nazwy szablonu", async () => {
    await post(body());

    expect(h.checkSendAllowed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "odbiorca@example.test" }),
    );
    expect(h.checkSendAllowed.mock.calls[0]?.[1]).toHaveProperty("category");
  });
});

describe("cykl życia tokenu wypisu", () => {
  it("istniejący NIEZUŻYTY token jest używany ponownie", async () => {
    db.setResponse(TOKENS, ok({ token: "tok-stary", used_at: null }));

    const res = await post(body());

    expect(res.status).toBe(200);
    expect(queuedPayload().unsubscribe_token).toBe("tok-stary");
    expect(db.chainsFor(TOKENS).some((c) => c.has("upsert"))).toBe(false);
  });

  it("brak tokenu tworzy nowy i odczytuje go z powrotem (wyścig zapisów)", async () => {
    const chains: string[] = [];
    db.setResponse(TOKENS, (chain) => {
      chains.push(chain.calls.map((c) => c.method).join("."));
      if (chain.has("upsert")) return ok(null);
      // Pierwszy odczyt: brak wiersza. Drugi (po upsercie): token zapisany.
      return chains.filter((c) => c.startsWith("select")).length > 1
        ? ok({ token: "tok-zapisany" })
        : ok(null);
    });

    const res = await post(body());

    expect(res.status).toBe(200);
    expect(queuedPayload().unsubscribe_token).toBe("tok-zapisany");
  });

  it("ZUŻYTY token jest rotowany, a mail i tak wychodzi", async () => {
    // Regresja: kiedyś ta gałąź odmawiała wysyłki, gubiąc maile o pieniądzach
    // i dostępie. Wypis z marketingu nie jest odmową potwierdzenia płatności.
    db.setResponse(TOKENS, ok({ token: "tok-zuzyty", used_at: TOKEN_ZUZYTY_AT }));

    const res = await post(body());

    expect(res.status).toBe(200);
    const update = db
      .chainsFor(TOKENS)
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown> | undefined;
    expect(update?.used_at).toBeNull();
    // Mail dostaje ŚWIEŻY token, nie martwy link wypisu.
    expect(queuedPayload().unsubscribe_token).not.toBe("tok-zuzyty");
  });

  it("awaria odczytu tokenu to 500 i wpis `failed`", async () => {
    db.setResponse(TOKENS, fail("token lookup exploded"));

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(logInserts()[0]).toMatchObject({
      status: "failed",
      error_message: "Failed to look up unsubscribe token",
    });
  });

  it("awaria zapisu nowego tokenu to 500 i wpis `failed`", async () => {
    db.setResponse(TOKENS, (chain) => (chain.has("upsert") ? fail("upsert failed") : ok(null)));

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(logInserts()[0]).toMatchObject({
      status: "failed",
      error_message: "Failed to create unsubscribe token",
    });
  });

  it("nieudany odczyt po zapisie to 500 - nie wysyłamy z niepewnym tokenem", async () => {
    // Upsert się udaje, ale ponowny odczyt nadal nie widzi wiersza.
    db.setResponse(TOKENS, ok(null));

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(logInserts()[0]).toMatchObject({
      error_message: "Failed to confirm unsubscribe token storage",
    });
  });

  it("awaria rotacji zużytego tokenu to 500 i wpis `failed`", async () => {
    db.setResponse(TOKENS, (chain) =>
      chain.has("update")
        ? fail("rotate failed")
        : ok({ token: "tok-zuzyty", used_at: TOKEN_ZUZYTY_AT }),
    );

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(logInserts()[0]).toMatchObject({
      error_message: "Failed to rotate unsubscribe token",
    });
  });
});

describe("kolejkowanie", () => {
  it("wiersz `pending` powstaje PRZED kolejkowaniem", async () => {
    await post(body());

    expect(logInserts()[0]).toMatchObject({
      template_name: "payment_receipt",
      recipient_email: "odbiorca@example.test",
      status: "pending",
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("do kolejki transakcyjnej idzie komplet pól wysyłki", async () => {
    await post(body());

    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("enqueue_email");
    expect(args.queue_name).toBe("transactional_emails");
    expect(queuedPayload()).toMatchObject({
      to: "odbiorca@example.test",
      purpose: "transactional",
      label: "payment_receipt",
      html: "<html>mail</html>",
      tenant_id: "tenant-1",
    });
  });

  it("klucz z żądania stempluje dziennik, a dostawca dostaje `message_id` z zakresem wywołującego", async () => {
    await post(body({ idempotencyKey: "idem-podane" }));

    // Surowy klucz jest unikalny tylko w obrębie wywołującego - u dostawcy
    // (jedno konto nadawcze platformy) zlałby się z kluczem innego konta.
    expect(queuedPayload().idempotency_key).toBe(queuedPayload().message_id);
    expect(queuedPayload().message_id).not.toBe("idem-podane");
    expect(logInserts()[0]).toMatchObject({
      status: "pending",
      message_id: queuedPayload().message_id,
      metadata: {
        idempotency_key: "idem-podane",
        // Skrót treści, nie jej kopia - dziennik nie przechowuje `templateData`.
        template_data_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  it("bez klucza NIE fabrykujemy go: dziennik nie udaje klucza klienta", async () => {
    await post(body());

    // Losowy `message_id` jako klucz dostawcy odsiewa tylko ponowne doręczenie
    // tej samej wiadomości przez dren - w dzienniku nie ma śladu „klucza",
    // więc wiersz nie wchodzi do indeksu zajęć i niczego nie blokuje.
    expect(queuedPayload().idempotency_key).toBe(queuedPayload().message_id);
    expect(String(queuedPayload().message_id)).toMatch(UUID_V4);
    expect(logInserts()[0]).not.toHaveProperty("metadata");
  });

  it("temat może być funkcją liczoną z danych szablonu", async () => {
    asUser("ja@example.test", ["admin"]);
    h.fixedToTemplate.to = "wlasciciel@example.test";

    await post(body({ templateName: "owner_alert", templateData: { kind: "awaria" } }));

    expect(queuedPayload().subject).toBe("Alert: awaria");
    // Dane szablonu naprawdę weszły do tematu - stały napis przeszedłby test
    // z niewłaściwego powodu.
    expect(queuedPayload().subject).toContain("awaria");
  });

  it("temat statyczny idzie bez zmian", async () => {
    await post(body());

    expect(queuedPayload().subject).toBe("Potwierdzenie płatności");
    expect(queuedPayload().sender_domain).toBeTruthy();
  });

  it("porażka kolejkowania to 500, a wpis `pending` przechodzi w `failed`", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    const res = await post(body());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to enqueue email" });
    // Wiadomość nigdy nie była w obiegu - zawieszony `pending` obok `failed`
    // kłamałby w dzienniku (a z kluczem trzymałby go na zawsze).
    expect(logInserts()).toHaveLength(1);
    expect(logInserts()[0]).toMatchObject({ status: "pending" });
    // Bez klucza identyfikator próby JEST `message_id` - wiersz go nie zmienia.
    expect(logUpdate()).toEqual({
      set: {
        status: "failed",
        error_message: "Failed to enqueue email",
        message_id: queuedPayload().message_id,
      },
      where: { message_id: queuedPayload().message_id, status: "pending" },
    });
  });

  it("porażka kolejkowania bez zapisanego `pending` i tak zostawia wpis `failed`", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });
    db.setResponse(LOG, (chain) =>
      chain.has("insert") && pierwszyArg(chain, "insert").status === "pending"
        ? fail("log down")
        : ok(null),
    );

    const res = await post(body());

    expect(res.status).toBe(500);
    // Bez klucza wpis `pending` jest tylko śladem - jego brak nie zatrzymuje
    // wysyłki, ale porażka kolejki nie może przez to zniknąć z dziennika.
    expect(logInserts()[1]).toMatchObject({
      status: "failed",
      error_message: "Failed to enqueue email",
    });
    expect(logUpdate()).toBeUndefined();
  });

  it("sukces potwierdza zakolejkowanie i oddaje `message_id`", async () => {
    const res = await post(body());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      queued: true,
      message_id: queuedPayload().message_id,
    });
  });
});

// ---------------------------------------------------------------------------
// Najemca w dzienniku wysyłek
//
// Siedem wpisów do `email_send_log` w jednym pliku to dokładnie ta sytuacja,
// przed którą ostrzega nagłówek bramki zakresu najemcy: „plik, w którym 26
// zapytań filtruje po najemcy, a 27. nie, wygląda przy przeglądzie jak plik
// poprawny". Panel wysyłek czyta dziennik w granicach JEDNEGO najemcy, więc
// nieostemplowany wiersz nie jest gorszy - jest niewidoczny.
//
// Klient bazy tej trasy jest NIEOTYPOWANY (`createClient` bez `<Database>`),
// więc brak klucza `tenant_id` nigdy nie zapali się w kompilacji. Ten blok jest
// jedyną rzeczą, która trzyma tu linię.
// ---------------------------------------------------------------------------
describe("najemca w dzienniku wysyłek", () => {
  /** Ostatni wpis do logu - każda gałąź porażki zapisuje dokładnie jeden. */
  function ostatniWpis(): Record<string, unknown> {
    const inserts = logInserts();
    expect(inserts.length).toBeGreaterThan(0);
    return inserts[inserts.length - 1];
  }

  it("wiersz 'suppressed' niesie najemcę z bramki", async () => {
    h.checkSendAllowed.mockResolvedValue({
      allowed: false,
      hit: { reason: "complaint", scope: "permanent" },
      tenantId: "tenant-1",
    });

    await post(body());

    expect(ostatniWpis()).toMatchObject({ status: "suppressed", tenant_id: "tenant-1" });
  });

  it.each([
    ["awaria odczytu tokenu", () => db.setResponse(TOKENS, fail("token lookup exploded"))],
    [
      "awaria zapisu nowego tokenu",
      () =>
        db.setResponse(TOKENS, (chain) => (chain.has("upsert") ? fail("upsert failed") : ok(null))),
    ],
    ["nieudany odczyt po zapisie", () => db.setResponse(TOKENS, ok(null))],
    [
      "awaria rotacji zużytego tokenu",
      () =>
        db.setResponse(TOKENS, (chain) =>
          chain.has("update")
            ? fail("rotate failed")
            : ok({ token: "tok-zuzyty", used_at: TOKEN_ZUZYTY_AT }),
        ),
    ],
  ])("wiersz 'failed' po gałęzi %s niesie najemcę", async (_nazwa, ustaw) => {
    ustaw();

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(ostatniWpis()).toMatchObject({ status: "failed", tenant_id: "tenant-1" });
  });

  it("wpis po odmowie kolejki zachowuje najemcę z bramki", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    await post(body());

    // `pending` przechodzi w `failed` aktualizacją, która NIE dotyka
    // `tenant_id` - stempel z wstawki zostaje na jedynym wierszu wiadomości.
    const inserts = logInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ status: "pending", tenant_id: "tenant-1" });
    expect(logUpdate()?.set).not.toHaveProperty("tenant_id");
    expect(logUpdate()?.set).toMatchObject({ status: "failed" });
  });

  it("nierozstrzygnięty najemca nie zatrzymuje wysyłki - rozstrzyga trigger bazy", async () => {
    // Bramka fail-open oddaje `tenantId: null`, gdy adresu nie da się przypisać.
    // Mail ma wyjść mimo to; najemcę dopina wtedy
    // `trg_email_send_log_bind_tenant` z adresu odbiorcy.
    h.checkSendAllowed.mockResolvedValue({ allowed: true, hit: null, tenantId: null });

    const res = await post(body());

    expect(res.status).toBe(200);
    expect(ostatniWpis()).toHaveProperty("tenant_id", null);
  });
});

// ---------------------------------------------------------------------------
// Idempotencja
//
// Regresja audytu modułu 11: trasa przyjmowała `idempotencyKey`, ale
// `message_id` był losowy per żądanie i nic nie sprawdzało, czy klucz już był.
// Ponowienie klienta (timeout, retry sieci, podwójny klik) było dla drenu NOWĄ
// wiadomością i odbiorca dostawał drugi mail. Kontrakt:
//   * ten sam klucz od tego samego konta = jedna wiadomość, jeden `message_id`,
//   * ten sam klucz z inną treścią (szablon, odbiorca, `templateData`) = 422,
//   * powtórzenie nie dotyka kolejki ani niczego, co ma efekty uboczne,
//   * wyścig rozstrzyga indeks bazy (23505), nie kolejność zapytań,
//   * porażka po drodze NIE zajmuje klucza - ponowienie ma wysłać.
// ---------------------------------------------------------------------------

type WierszDziennika = Record<string, unknown>;

/**
 * Dziennik wysyłek w pamięci z odwzorowaniem
 * `email_send_log_idempotent_pending_uidx`: drugi wiersz 'pending' z kluczem na
 * ten sam `message_id` to 23505. Tylko przy takiej atrapie test „drugie żądanie
 * nie wysyła" mówi coś o kodzie trasy, a nie o odpowiedziach, które test sam
 * zaplanował.
 */
function dziennikZIndeksem(): WierszDziennika[] {
  const wiersze: WierszDziennika[] = [];
  const zajmujeKlucz = (w: WierszDziennika) =>
    w.status === "pending" &&
    (w.metadata as { idempotency_key?: unknown } | undefined)?.idempotency_key != null;

  db.setResponse(LOG, (chain) => {
    if (chain.has("insert")) {
      const nowy = { ...pierwszyArg(chain, "insert") };
      if (
        zajmujeKlucz(nowy) &&
        wiersze.some((w) => zajmujeKlucz(w) && w.message_id === nowy.message_id)
      ) {
        return fail("duplicate key value violates unique constraint", "23505");
      }
      wiersze.push(nowy);
      return ok(null);
    }
    const where = filtryEq(chain);
    const statusy = chain.argsOf("in")?.[1] as unknown[] | undefined;
    const pasuje = (w: WierszDziennika) =>
      Object.entries(where).every(([kolumna, wartosc]) => w[kolumna] === wartosc) &&
      (statusy === undefined || statusy.includes(w.status));
    if (chain.has("update")) {
      for (const w of wiersze.filter(pasuje)) Object.assign(w, pierwszyArg(chain, "update"));
      return ok(null);
    }
    // Odczyt zajęcia czyta odcisk treści aliasem
    // `template_data_sha256:metadata->>template_data_sha256` - atrapa oddaje
    // to samo pole, co PostgREST.
    return ok(
      wiersze.filter(pasuje).map((w) => ({
        ...w,
        template_data_sha256:
          (w.metadata as { template_data_sha256?: unknown } | undefined)?.template_data_sha256 ??
          null,
      })),
    );
  });
  return wiersze;
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("idempotencja", () => {
  it("ten sam klucz dwa razy: jeden mail i ten sam `message_id`", async () => {
    dziennikZIndeksem();

    const pierwsza = await jsonOf(await post(body({ idempotencyKey: "zamowienie-1" })));
    const druga = await jsonOf(await post(body({ idempotencyKey: "zamowienie-1" })));

    expect(pierwsza).toMatchObject({ success: true, queued: true });
    expect(String(pierwsza.message_id)).toMatch(UUID_V4);
    expect(druga).toEqual({
      success: true,
      queued: true,
      message_id: pierwsza.message_id,
      replayed: true,
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("powtórzenie nie płaci za bramkę, token wypisu ani render", async () => {
    dziennikZIndeksem();
    // Zużyty token: oryginał go ROTUJE. Powtórzenie nie może zrobić tego drugi
    // raz - unieważniłoby link wypisu w mailu, który już jest w kolejce.
    db.setResponse(TOKENS, ok({ token: "tok-zuzyty", used_at: TOKEN_ZUZYTY_AT }));

    await post(body({ idempotencyKey: "zamowienie-1" }));
    vi.clearAllMocks();
    const tokenChainsBefore = db.chainsFor(TOKENS).length;

    const res = await post(body({ idempotencyKey: "zamowienie-1" }));

    expect(res.status).toBe(200);
    expect(h.checkSendAllowed).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(db.chainsFor(TOKENS)).toHaveLength(tokenChainsBefore);
  });

  it("nagłówek Idempotency-Key jest tym samym kluczem co pole ciała", async () => {
    dziennikZIndeksem();

    const zNaglowka = await jsonOf(await post(body(), { "Idempotency-Key": "k-1" }));
    const zCiala = await jsonOf(await post(body({ idempotencyKey: "k-1" })));
    const zObu = await jsonOf(
      await post(body({ idempotency_key: "k-1" }), { "Idempotency-Key": " k-1 " }),
    );

    expect(zCiala).toMatchObject({ message_id: zNaglowka.message_id, replayed: true });
    expect(zObu).toMatchObject({ message_id: zNaglowka.message_id, replayed: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("różne klucze w nagłówku i w ciele to 400 - nie zgadujemy, który obowiązuje", async () => {
    const res = await post(body({ idempotencyKey: "a" }), { "Idempotency-Key": "b" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Idempotency-Key header and idempotencyKey in body differ",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("klucz dłuższy niż 255 znaków to 400", async () => {
    const res = await post(body({ idempotencyKey: "x".repeat(256) }));

    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ten sam klucz z INNEGO konta to inna wiadomość - zakres wywołującego", async () => {
    dziennikZIndeksem();

    const a = await jsonOf(await post(body({ idempotencyKey: "order-1" })));
    h.getUser.mockResolvedValue({
      data: { user: { id: "u-2", email: "odbiorca@example.test" } },
      error: null,
    });
    const b = await jsonOf(await post(body({ idempotencyKey: "order-1" })));

    expect(b).not.toHaveProperty("replayed");
    expect(b.message_id).not.toBe(a.message_id);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("`message_id` nie jest skrótem samego klucza (oddzielony od kluczy `sendTxEmail`)", async () => {
    const { deterministicMessageId } = await import("@/lib/email/messageId");

    await post(body({ idempotencyKey: "order-1" }));

    expect(queuedPayload().message_id).not.toBe(await deterministicMessageId("order-1"));
  });

  it.each([
    ["innego odbiorcy", { recipientEmail: "ktos-inny@example.test" }],
    ["innego szablonu", { templateName: "owner_alert" }],
  ])("ten sam klucz dla %s to 422, a nie ciche „już wysłane”", async (_nazwa, zmiana) => {
    dziennikZIndeksem();
    asUser("redakcja@example.test", ["admin"]);
    h.fixedToTemplate.to = "odbiorca@example.test";

    await post(body({ idempotencyKey: "k-1" }));
    const res = await post(body({ idempotencyKey: "k-1", ...zmiana }));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Idempotency key was already used for a different request",
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("ten sam klucz z INNĄ treścią (`templateData`) to 422 - druga kwota nie przepada jako „duplikat”", async () => {
    dziennikZIndeksem();

    await post(body({ idempotencyKey: "k-1", templateData: { amount: "100 PLN" } }));
    const res = await post(body({ idempotencyKey: "k-1", templateData: { amount: "250 PLN" } }));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "Idempotency key was already used for a different request",
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("ta sama treść w innej kolejności pól to powtórzenie, nie inna wiadomość", async () => {
    dziennikZIndeksem();
    const dane = (kolejnosc: "ab" | "ba") =>
      kolejnosc === "ab"
        ? { amount: "100 PLN", order: { id: "o-1", items: [{ sku: "x", qty: 1 }] } }
        : { order: { items: [{ qty: 1, sku: "x" }], id: "o-1" }, amount: "100 PLN" };

    const pierwsza = await jsonOf(
      await post(body({ idempotencyKey: "k-1", templateData: dane("ab") })),
    );
    const druga = await jsonOf(
      await post(body({ idempotencyKey: "k-1", templateData: dane("ba") })),
    );

    expect(druga).toEqual({ ...pierwsza, replayed: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("zajęciem jest wyłącznie wpis 'pending' trasy - ta sama populacja co indeks", async () => {
    dziennikZIndeksem();

    await post(body({ idempotencyKey: "k-1" }));

    // Odczyt zajęcia filtruje po `message_id` i 'pending', a NIE po 'sent':
    // wiersz 'sent' drenu nie niesie `metadata`, więc odcisk treści byłby na
    // nim ślepy, a wpis zajęcia i tak trwa obok niego.
    const odczyt = db.chainsFor(LOG).find((c) => c.has("select"));
    expect(odczyt && filtryEq(odczyt)).toEqual({
      message_id: queuedPayload().message_id,
      status: "pending",
    });
    expect(odczyt?.has("in")).toBe(false);
  });

  it("odbiorca w powtórzeniu porównywany jest bez wielkości liter", async () => {
    dziennikZIndeksem();
    asUser("redakcja@example.test", ["admin"]);

    await post(body({ idempotencyKey: "k-1", recipientEmail: "Ktos@Example.TEST" }));
    const res = await jsonOf(
      await post(body({ idempotencyKey: "k-1", recipientEmail: "ktos@example.test" })),
    );

    expect(res).toMatchObject({ replayed: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("wyścig: przegrany dostaje 23505 i odpowiada tym samym `message_id`, bez kolejki", async () => {
    // Sprawdzenie nic nie widzi (zwycięzca jeszcze nie zapisał), zapis odbija
    // się od indeksu, ponowny odczyt widzi już wiersz zwycięzcy.
    let odczyty = 0;
    db.setResponse(LOG, (chain) => {
      if (chain.has("insert")) return fail("duplicate key", "23505");
      odczyty += 1;
      return odczyty === 1
        ? ok([])
        : ok([{ template_name: "payment_receipt", recipient_email: "odbiorca@example.test" }]);
    });

    const res = await post(body({ idempotencyKey: "k-1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      queued: true,
      message_id: logInserts()[0]?.message_id,
      replayed: true,
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("wyścig, w którym zwycięzca zdążył zwolnić klucz, to 409 - nie fałszywe „zakolejkowano”", async () => {
    db.setResponse(LOG, (chain) => (chain.has("insert") ? fail("duplicate key", "23505") : ok([])));

    const res = await post(body({ idempotencyKey: "k-1" }));

    expect(res.status).toBe(409);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("nieudane zajęcie klucza z innego powodu niż wyścig to 500 bez kolejki", async () => {
    db.setResponse(LOG, (chain) =>
      chain.has("insert") ? fail("connection reset", "08006") : ok([]),
    );

    const res = await post(body({ idempotencyKey: "k-1" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to prepare email" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("awaria odczytu zajęcia to 500, zanim zadziała bramka czy token", async () => {
    db.setResponse(LOG, fail("log unreachable"));

    const res = await post(body({ idempotencyKey: "k-1" }));

    expect(res.status).toBe(500);
    expect(h.checkSendAllowed).not.toHaveBeenCalled();
    expect(db.chainsFor(TOKENS)).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("porażka kolejki zwalnia klucz: ponowienie z tym samym kluczem wysyła", async () => {
    const wiersze = dziennikZIndeksem();
    h.rpc.mockResolvedValueOnce({ error: { message: "queue full" } });

    const pierwsza = await post(body({ idempotencyKey: "k-1" }));
    const druga = await jsonOf(await post(body({ idempotencyKey: "k-1" })));

    expect(pierwsza.status).toBe(500);
    expect(druga).toMatchObject({ success: true, queued: true });
    expect(druga).not.toHaveProperty("replayed");
    expect(h.rpc).toHaveBeenCalledTimes(2);
    // Ta sama wiadomość (ten sam `message_id`), dwie próby w dzienniku.
    expect(queuedPayload(1).message_id).toBe(queuedPayload(0).message_id);
    expect(wiersze.map((w) => w.status)).toEqual(["failed", "pending"]);
    // Zwolnione zajęcie staje się wpisem PRÓBY: nie liczy się do budżetu
    // ponowień drenu dla `message_id` wiadomości, ale wciąż niesie klucz.
    expect(wiersze[0]?.message_id).not.toBe(queuedPayload(0).message_id);
    expect(wiersze[0]?.metadata).toMatchObject({ idempotency_key: "k-1" });
  });

  it("porażki przed kolejką nie zjadają budżetu ponowień drenu (MAX_RETRIES)", async () => {
    // Awaria bazy: pięć ponowień klienta pada na odczycie tokenu wypisu, szóste
    // przechodzi. Dren liczy budżet po wierszach 'failed' z `message_id`
    // wiadomości - gdyby nosiły go te próby, wiadomość poszłaby prosto do DLQ,
    // a klient usłyszałby „zakolejkowano".
    const wiersze = dziennikZIndeksem();
    let awarie = 5;
    db.setResponse(TOKENS, () => {
      if (awarie > 0) {
        awarie -= 1;
        return fail("token lookup exploded");
      }
      return ok({ token: "tok-istniejacy", used_at: null });
    });

    for (let i = 0; i < 5; i += 1) {
      expect((await post(body({ idempotencyKey: "k-1" }))).status).toBe(500);
    }
    const res = await jsonOf(await post(body({ idempotencyKey: "k-1" })));

    expect(res).toMatchObject({ success: true, queued: true });
    const nieudane = wiersze.filter((w) => w.status === "failed");
    expect(nieudane).toHaveLength(5);
    expect(nieudane.filter((w) => w.message_id === res.message_id)).toHaveLength(0);
    expect(new Set(nieudane.map((w) => w.message_id)).size).toBe(5);
    for (const w of nieudane) {
      expect(w.metadata).toMatchObject({ idempotency_key: "k-1" });
    }
  });

  it("odmowa bramki nie zajmuje klucza: ponowienie sprawdza listę od nowa", async () => {
    dziennikZIndeksem();
    h.checkSendAllowed.mockResolvedValueOnce({
      allowed: false,
      hit: { reason: "bounce" },
      tenantId: "tenant-1",
    });

    const pierwsza = await jsonOf(await post(body({ idempotencyKey: "k-1" })));
    const druga = await jsonOf(await post(body({ idempotencyKey: "k-1" })));

    expect(pierwsza).toEqual({ success: false, reason: "email_suppressed" });
    expect(druga).toMatchObject({ success: true, queued: true });
    expect(h.checkSendAllowed).toHaveBeenCalledTimes(2);
  });

  it("bez klucza nie ma odczytu zajęcia - zwykła wysyłka nie płaci za idempotencję", async () => {
    await post(body());

    expect(db.chainsFor(LOG).some((c) => c.has("select"))).toBe(false);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});
