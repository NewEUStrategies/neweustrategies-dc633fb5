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
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
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

function queuedPayload(): Record<string, unknown> {
  const args = h.rpc.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
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
    db.setResponse(TOKENS, ok({ token: "tok-zuzyty", used_at: "2026-01-01T00:00:00Z" }));

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
        : ok({ token: "tok-zuzyty", used_at: "2026-01-01T00:00:00Z" }),
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

  it("klucz idempotencji z żądania wygrywa nad wygenerowanym", async () => {
    await post(body({ idempotencyKey: "idem-podane" }));

    expect(queuedPayload().idempotency_key).toBe("idem-podane");
    expect(queuedPayload().message_id).not.toBe("idem-podane");
  });

  it("bez klucza idempotencji używamy identyfikatora wiadomości", async () => {
    await post(body());

    expect(queuedPayload().idempotency_key).toBe(queuedPayload().message_id);
    expect(typeof queuedPayload().message_id).toBe("string");
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

  it("porażka kolejkowania to 500 i wpis `failed` obok wpisu `pending`", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    const res = await post(body());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to enqueue email" });
    const inserts = logInserts();
    expect(inserts[0]).toMatchObject({ status: "pending" });
    expect(inserts[1]).toMatchObject({ status: "failed" });
  });

  it("sukces potwierdza zakolejkowanie", async () => {
    const res = await post(body());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, queued: true });
  });
});
