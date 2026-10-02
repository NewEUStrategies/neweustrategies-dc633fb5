// Publiczny endpoint wypisu z newslettera - 115 linii, zero testów do dziś.
//
// To jest OBOWIĄZEK PRAWNY, nie funkcja produktu: adres z listy mailingowej musi
// dać się usunąć jednym klikiem, a mechanizm jednego kliku (RFC 8058) jest
// wymogiem bramek Gmaila i Yahoo dla nadawców masowych. Newsletter ma w repo
// najniższe pokrycie ze wszystkich modułów (T/P 0,08, audyt 14.08), a ta trasa
// jest w nim najostrzejszą pozycją: bez auth, z zapisem do bazy, wołana przez
// obcą infrastrukturę.
//
// RZECZY, KTÓRE MOGĄ SIĘ TU ZEPSUĆ, I ŻADNA NIE JEST WIDOCZNA W UI:
//
//   1. GET MUTUJE. Bramki pocztowe (i podglądy linków w komunikatorach)
//      wykonują GET na każdym adresie w treści maila. Gdyby GET wypisywał,
//      skaner Outlooka wypisywałby odbiorców, którzy w ogóle nie otworzyli
//      maila - a nadawca zobaczyłby to jako „ludzie masowo się wypisują",
//      nie jako defekt. Dlatego mutacja jest WYŁĄCZNIE na POST.
//   2. WYPIS NIE JEST IDEMPOTENTNY. Token zostaje w wierszu po wypisie -
//      i to on zamienia drugi klik w „already" zamiast w 404. Wyczyszczenie
//      tokena „dla porządku" psuje ponowny klik i one-click bramek, które
//      powtarzają żądanie.
//   3. ENDPOINT ODDAJE ADRES E-MAIL. Token wypisu jest jednocześnie tokenem
//      śledzenia otwarć i klików, więc jedzie w KAŻDYM linku i pikselu maila:
//      w przekazanej wiadomości, w logach bramki, we wspólnej skrzynce.
//      Oddanie choćby zamaskowanego adresu pozwoliłoby posiadaczowi tokena
//      odtworzyć domenę i inicjały odbiorcy.
//   4. WYPIS BEZ BLOKADY. POST zmieniał sam `newsletter_subscribers.status`,
//      więc kanoniczna lista wykluczeń nie wiedziała o wycofaniu zgody: digesty
//      szły dalej, a import CSV po cichu przywracał adres do audiencji. Wypis
//      idzie teraz przez to samo RPC co /email/unsubscribe
//      (`email_unsubscribe_by_token` - status i blokada w JEDNEJ transakcji);
//      zachowanie SQL pilnuje pgTAP
//      (supabase/tests/newsletter_unsubscribe_suppression_test.sql).
//   5. ONE-CLICK BEZ TOKENU. Klient pocztowy POST-uje `List-Unsubscribe=One-Click`
//      (formularz), a token jest WYŁĄCZNIE w query adresu z nagłówka. Ciało,
//      które tokenu nie niesie, nie może unieważnić tokenu z adresu.
//   6. ONE-CLICK W KUBEŁKU CZŁOWIEKA. One-click nadaje serwer dostawcy poczty,
//      więc wielu odbiorców dzieli jeden adres IP. Limit skrojony na jedną
//      przeglądarkę odcinał wypisy po kampanii odpowiedzią 429.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SubscriberRow {
  id: string;
  status: string;
}

interface UnsubscribeOutcome {
  ok: boolean;
  alreadyUnsubscribed: boolean;
  tenantId: string | null;
  error?: string;
}

const db = vi.hoisted(() => {
  const state = {
    /** Wiersz zwracany dla dowolnego tokena, albo `null` (nie znaleziono). */
    row: null as SubscriberRow | null,
    selectError: null as { message: string } | null,
    /** Każde `select(...).eq(...)` - do sprawdzenia, po czym szukamy. */
    selects: [] as Array<{ table: string; columns: string; filter: [string, unknown] }>,
    /**
     * Każde `update(...)` - PUSTA lista jest dowodem, że GET nie mutuje, a POST
     * nie zapisuje statusu z pominięciem listy wykluczeń.
     */
    updates: [] as Array<{
      table: string;
      patch: Record<string, unknown>;
      filter: [string, unknown];
    }>,
    /** Wynik kanonicznego RPC wypisu i jego wywołania (klient, token). */
    unsubscribeResult: null as UnsubscribeOutcome | null,
    unsubscribeCalls: [] as Array<{ client: unknown; token: string }>,
    rateLimitCalls: [] as Array<{ scope: string; subjectId: string; max: number }>,
    /** `false` = limiter odmawia zawsze; inaczej liczy jak prawdziwy kubełek. */
    rateLimitAllows: true,
    /** Liczniki kubełków (scope|subject) - zachowanie `rate_limit_hit`. */
    rateLimitBuckets: new Map<string, number>(),
  };
  const supabaseAdmin = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  state.selects.push({ table, columns, filter: [column, value] });
                  return { data: state.row, error: state.selectError };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              state.updates.push({ table, patch, filter: [column, value] });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { state, supabaseAdmin };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.supabaseAdmin }));

vi.mock("@/lib/email/suppression.server", () => ({
  unsubscribeByToken: async (client: unknown, token: string) => {
    db.state.unsubscribeCalls.push({ client, token });
    return db.state.unsubscribeResult;
  },
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (options: { scope: string; subjectId: string; max: number }) => {
    const { state } = db;
    state.rateLimitCalls.push({
      scope: options.scope,
      subjectId: options.subjectId,
      max: options.max,
    });
    if (!state.rateLimitAllows) return false;
    const key = `${options.scope}|${options.subjectId}`;
    const hits = (state.rateLimitBuckets.get(key) ?? 0) + 1;
    state.rateLimitBuckets.set(key, hits);
    return hits <= options.max;
  },
}));

import { Route, isValidUnsubToken } from "./api.public.newsletter.unsubscribe";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER_TOKEN = "fedcba9876543210fedcba9876543210";
const ORIGIN = "https://nes.example";
const ENDPOINT = `${ORIGIN}/api/public/newsletter/unsubscribe`;

/**
 * Handlery trasy. TanStack trzyma je w `options.server.handlers`; sięgamy tam
 * wprost, bo uruchomienie całego routera wciągnęłoby serwerowy graf frameworka,
 * a badamy zachowanie DWÓCH funkcji, nie routingu.
 */
function handlers(): {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
} {
  const options = (Route as unknown as { options: { server: { handlers: unknown } } }).options;
  return options.server.handlers as ReturnType<typeof handlers>;
}

function getRequest(
  query: string,
  headers: Record<string, string> = { accept: "*/*" },
): { request: Request } {
  return {
    request: new Request(`${ENDPOINT}${query}`, { headers }),
  };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
  query = "",
): { request: Request } {
  return {
    request: new Request(`${ENDPOINT}${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  };
}

/** Surowy POST - dokładnie to, co wysyła klient pocztowy albo formularz. */
function rawPost(
  query: string,
  body: string | undefined,
  contentType?: string,
): { request: Request } {
  return {
    request: new Request(`${ENDPOINT}${query}`, {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : {},
      body,
    }),
  };
}

/** One-click RFC 8058 z serwera dostawcy poczty o podanym adresie IP. */
function oneClickFrom(ip: string, token: string): { request: Request } {
  return {
    request: new Request(`${ENDPOINT}?token=${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cf-connecting-ip": ip,
      },
      body: "List-Unsubscribe=One-Click",
    }),
  };
}

function unsubscribedTokens(): string[] {
  return db.state.unsubscribeCalls.map((call) => call.token);
}

beforeEach(() => {
  const { state } = db;
  state.row = { id: "sub-1", status: "subscribed" };
  state.selectError = null;
  state.selects = [];
  state.updates = [];
  state.unsubscribeResult = { ok: true, alreadyUnsubscribed: false, tenantId: "tenant-1" };
  state.unsubscribeCalls = [];
  state.rateLimitCalls = [];
  state.rateLimitAllows = true;
  state.rateLimitBuckets = new Map();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isValidUnsubToken", () => {
  it("przyjmuje token szesnastkowy w obu wielkościach litery", () => {
    expect(isValidUnsubToken(TOKEN)).toBe(true);
    expect(isValidUnsubToken(TOKEN.toUpperCase())).toBe(true);
  });

  it("odrzuca brak tokena i pusty token", () => {
    expect(isValidUnsubToken(null)).toBe(false);
    expect(isValidUnsubToken("")).toBe(false);
  });

  it("pilnuje granic 16..128 znaków OBUSTRONNIE", () => {
    expect(isValidUnsubToken("a".repeat(15))).toBe(false);
    expect(isValidUnsubToken("a".repeat(16))).toBe(true);
    expect(isValidUnsubToken("a".repeat(128))).toBe(true);
    expect(isValidUnsubToken("a".repeat(129))).toBe(false);
  });

  it.each([
    "g".repeat(32),
    "abcdef0123456789' OR 1=1 --",
    "../../etc/passwd0000",
    "0123456789abcdef%00",
    "0123456789abcdef ",
    "0123456789ab-cdef",
  ])("odrzuca %j", (token) => {
    // Token wchodzi wprost do warunku zapytania, więc zawężenie do samych cyfr
    // szesnastkowych jest tu drugą linią obrony przy parametryzacji zapytania.
    expect(isValidUnsubToken(token)).toBe(false);
  });
});

describe("GET - nigdy nie mutuje", () => {
  it("klik z przeglądarki idzie na przyjazną stronę (303), bez zapytania do bazy", async () => {
    const response = await handlers().GET(
      getRequest(`?token=${TOKEN}`, { accept: "text/html,application/xhtml+xml" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/newsletter/unsubscribe?token=${TOKEN}`,
    );
    expect(db.state.selects).toEqual([]);
    expect(db.state.updates).toEqual([]);
    expect(db.state.unsubscribeCalls).toEqual([]);
  });

  it("przekierowanie zachowuje token, żeby strona miała czym wypisać", async () => {
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`, { accept: "text/html" }));
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("token")).toBe(TOKEN);
  });

  it("przekierowanie bez tokena nie dokłada pustego parametru", async () => {
    const response = await handlers().GET(getRequest("", { accept: "text/html" }));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/newsletter/unsubscribe");
    expect(location.searchParams.has("token")).toBe(false);
  });

  it("SPRAWDZENIE tokena przez fetch NIE wypisuje - to jest cała reguła", async () => {
    // Najważniejszy warunek w pliku. Skaner linków w bramce pocztowej wykonuje
    // dokładnie to żądanie na każdym adresie w mailu - teraz także na adresie
    // z nagłówka List-Unsubscribe, który wskazuje właśnie ten endpoint.
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, already: false });
    expect(db.state.updates).toEqual([]);
    expect(db.state.unsubscribeCalls).toEqual([]);
  });

  it("GET na wierszu JUŻ wypisanym też nie mutuje, tylko raportuje stan", async () => {
    db.state.row = { id: "sub-1", status: "unsubscribed" };
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    await expect(response.json()).resolves.toEqual({ ok: true, already: true });
    expect(db.state.updates).toEqual([]);
    expect(db.state.unsubscribeCalls).toEqual([]);
  });

  it("odpowiedź NIE zawiera adresu e-mail ani żadnego pola z danymi odbiorcy", async () => {
    // Token wypisu jest równocześnie tokenem śledzenia, więc jedzie w każdym
    // linku maila. Posiadacz tokena nie może odtworzyć z tej odpowiedzi domeny
    // ani inicjałów odbiorcy - także w formie zamaskowanej.
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    const payload = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["already", "ok"]);
    expect(JSON.stringify(payload)).not.toMatch(/@|email|mail/i);
  });

  it("czyta wiersz PO TOKENIE i pobiera wyłącznie identyfikator ze statusem", async () => {
    await handlers().GET(getRequest(`?token=${TOKEN}`));
    expect(db.state.selects).toEqual([
      {
        table: "newsletter_subscribers",
        columns: "id, status",
        filter: ["unsubscribe_token", TOKEN],
      },
    ]);
  });

  it("niepoprawny token daje 400 bez dotknięcia bazy", async () => {
    for (const token of ["", "krotki", "a".repeat(129), "nie-hex"]) {
      db.state.selects = [];
      const response = await handlers().GET(getRequest(`?token=${encodeURIComponent(token)}`));
      expect(response.status, token).toBe(400);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_token" });
      expect(db.state.selects, token).toEqual([]);
    }
  });

  it("nieznany token daje 404, a nie 200 z pustką", async () => {
    db.state.row = null;
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("błąd bazy jest 404, nie cichym sukcesem", async () => {
    db.state.selectError = { message: "połączenie zerwane" };
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    expect(response.status).toBe(404);
  });

  it("komunikat błędu bazy nie wycieka do odpowiedzi publicznej", async () => {
    db.state.selectError = { message: 'relation "newsletter_subscribers" nie istnieje' };
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    const body = await response.text();
    expect(body).not.toContain("relation");
    expect(body).not.toContain("nie istnieje");
  });
});

describe("POST - wypis przez kanoniczne RPC (status + blokada w jednej transakcji)", () => {
  it("wypisuje TYM SAMYM mechanizmem co /email/unsubscribe - klientem service_role", async () => {
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    // `email_unsubscribe_by_token` stawia blokadę `unsubscribe` w tenancie
    // subskrybenta i wypisuje wiersz - albo nie robi niczego.
    expect(db.state.unsubscribeCalls).toEqual([{ client: db.supabaseAdmin, token: TOKEN }]);
  });

  it("NIE zapisuje statusu z pominięciem listy wykluczeń - i nie robi osobnego odczytu", async () => {
    // Regresja właściwa: samodzielny UPDATE statusu był dokładnie tym wypisem
    // bez blokady, po którym digesty szły dalej. Jedno RPC zamiast odczytu
    // i zapisu to też jeden round-trip zamiast dwóch.
    await handlers().POST(postRequest({ token: TOKEN }));
    expect(db.state.updates).toEqual([]);
    expect(db.state.selects).toEqual([]);
  });

  it("PONOWNY klik jest idempotentny - `already`, nie 404 i nie błąd", async () => {
    // RPC i tak dopisuje blokadę (wiersze wypisane przed poprawką nie miały
    // wpisu na liście), a do klienta mówi „już wypisany".
    db.state.unsubscribeResult = { ok: true, alreadyUnsubscribed: true, tenantId: "tenant-1" };
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, already: true });
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("nieznany token daje 404", async () => {
    db.state.unsubscribeResult = {
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: "unknown_token",
    };
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("nieudana blokada daje 500 - wypis, który się nie udał, nie może raportować sukcesu", async () => {
    // To jest ta odpowiedź, po której bramka pocztowa powtórzy żądanie. RPC
    // wycofuje wtedy całą transakcję, więc status i lista są nadal spójne.
    db.state.unsubscribeResult = {
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: "suppression_not_recorded: invalid_input",
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "update_failed" });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("komunikat Postgresa z RPC nie wycieka do odpowiedzi publicznej", async () => {
    db.state.unsubscribeResult = {
      ok: false,
      alreadyUnsubscribed: false,
      tenantId: null,
      error: 'relation "email_suppressions" does not exist',
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    const body = await response.text();
    expect(body).not.toContain("relation");
    expect(body).not.toContain("email_suppressions");
    errorLog.mockRestore();
  });
});

describe("POST - skąd czytamy token (RFC 8058 one-click)", () => {
  it("one-click klienta pocztowego: formularz `List-Unsubscribe=One-Click`, token w query", async () => {
    // Dokładnie to żądanie wysyła Gmail/Yahoo na adres z nagłówka kampanii.
    const response = await handlers().POST(
      rawPost(`?token=${TOKEN}`, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("przy one-click pole `token` w ciele NIE nadpisuje tokenu z adresu", async () => {
    await handlers().POST(
      rawPost(
        `?token=${TOKEN}`,
        `List-Unsubscribe=One-Click&token=${OTHER_TOKEN}`,
        "application/x-www-form-urlencoded",
      ),
    );
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("zwykły formularz: token z pola `token`", async () => {
    const response = await handlers().POST(
      rawPost("", `token=${TOKEN}`, "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("strona aplikacji: token z ciała JSON ma pierwszeństwo przed query", async () => {
    await handlers().POST(postRequest({ token: TOKEN }, {}, `?token=${OTHER_TOKEN}`));
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("JSON BEZ tokenu nie unieważnia tokenu z adresu (wcześniej 400)", async () => {
    // Regresja: `request.json()` na `{}` nie rzucał, więc zapas na query nigdy
    // się nie uruchamiał i wypis z poprawnym adresem kończył się 400.
    const response = await handlers().POST(postRequest({}, {}, `?token=${TOKEN}`));
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("puste ciało - token z adresu", async () => {
    const response = await handlers().POST(rawPost(`?token=${TOKEN}`, undefined));
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("puste ciało zadeklarowane jako JSON - token z adresu", async () => {
    const response = await handlers().POST(rawPost(`?token=${TOKEN}`, "", "application/json"));
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("zepsuty JSON nie wywraca wypisu - zostaje token z adresu", async () => {
    const response = await handlers().POST(
      rawPost(`?token=${TOKEN}`, "{to nie json", "application/json"),
    );
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("one-click jako `multipart/form-data` (przykład z samego RFC 8058) - token z adresu", async () => {
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");
    // Pole `token` w ciele one-click nie wygrywa z adresem z nagłówka.
    form.set("token", OTHER_TOKEN);
    const response = await handlers().POST({
      request: new Request(`${ENDPOINT}?token=${TOKEN}`, { method: "POST", body: form }),
    });
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("zwykły formularz `multipart/form-data` - token z pola `token`", async () => {
    const form = new FormData();
    form.set("token", TOKEN);
    const response = await handlers().POST({
      request: new Request(ENDPOINT, { method: "POST", body: form }),
    });
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("uszkodzony `multipart/form-data` nie wywraca wypisu - zostaje token z adresu", async () => {
    const response = await handlers().POST(
      rawPost(`?token=${TOKEN}`, "to nie multipart", "multipart/form-data; boundary=brak"),
    );
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("ciało bez deklaracji typu (text/plain) - token z adresu", async () => {
    // Część bramek wysyła one-click bez nagłówka Content-Type formularza.
    const response = await handlers().POST(
      rawPost(`?token=${TOKEN}`, "List-Unsubscribe=One-Click"),
    );
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });

  it("token o niepoprawnym typie w ciele jest traktowany jak brak tokena", async () => {
    for (const token of [42, null, { value: TOKEN }, [TOKEN]]) {
      db.state.unsubscribeCalls = [];
      const response = await handlers().POST(postRequest({ token }));
      expect(response.status, JSON.stringify(token)).toBe(400);
      expect(db.state.unsubscribeCalls).toEqual([]);
    }
  });

  it("niepoprawny token daje 400 PRZED licznikiem żądań i przed bazą", async () => {
    // Kolejność jest oszczędnością kubełka: śmieciowe żądania nie mogą zużywać
    // limitu prawdziwym odbiorcom z tego samego adresu (wspólne NAT-y, biura).
    const response = await handlers().POST(postRequest({ token: "nie-hex" }));
    expect(response.status).toBe(400);
    expect(db.state.rateLimitCalls).toEqual([]);
    expect(db.state.unsubscribeCalls).toEqual([]);
  });

  it("brak tokena wszędzie daje 400", async () => {
    const response = await handlers().POST(
      rawPost("", "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_token" });
    expect(db.state.unsubscribeCalls).toEqual([]);
  });
});

describe("POST - limit żądań", () => {
  it("liczy per adres IP z nagłówka Cloudflare", async () => {
    await handlers().POST(postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }));
    expect(db.state.rateLimitCalls).toEqual([
      { scope: "newsletter.unsubscribe", subjectId: "203.0.113.7", max: 10 },
    ]);
  });

  it("bierze OSTATNI adres z `x-forwarded-for`, nie całą listę i nie prefiks klienta", async () => {
    // Cały łańcuch jako podmiot dawałby osobny kubełek na każdą kombinację
    // proxy, czyli limit, którego nie da się wyczerpać. Pierwszy wpis jest
    // jeszcze gorszy: to DEKLARACJA KLIENTA - edge proxy dokleja swój adres
    // na KOŃCU, a nie zastępuje nim tego, co wpisał klient. Podmiotem jest
    // więc ogon, jedyna część łańcucha, której klient nie wpisuje sam.
    await handlers().POST(
      postRequest({ token: TOKEN }, { "x-forwarded-for": "203.0.113.7, 198.51.100.2" }),
    );
    expect(db.state.rateLimitCalls[0].subjectId).toBe("198.51.100.2");
  });

  it("rotowanie prefiksu `x-forwarded-for` NIE odnawia budżetu", async () => {
    // Regresja właściwa: napastnik dopisuje sobie dowolny prefiks i musi
    // trafić w ten sam kubełek, co przy prefiksie pustym.
    await handlers().POST(
      postRequest({ token: TOKEN }, { "x-forwarded-for": "1.1.1.1, 198.51.100.2" }),
    );
    await handlers().POST(
      postRequest({ token: TOKEN }, { "x-forwarded-for": "2.2.2.2, 9.9.9.9, 198.51.100.2" }),
    );
    expect(db.state.rateLimitCalls[0].subjectId).toBe("198.51.100.2");
    expect(db.state.rateLimitCalls[1].subjectId).toBe("198.51.100.2");
  });

  it("nagłówek Cloudflare ma pierwszeństwo nad `x-forwarded-for`", async () => {
    await handlers().POST(
      postRequest(
        { token: TOKEN },
        { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.2" },
      ),
    );
    expect(db.state.rateLimitCalls[0].subjectId).toBe("203.0.113.7");
  });

  it("one-click liczy się w OSOBNYM, szerokim kubełku bramki pocztowej", async () => {
    await handlers().POST(oneClickFrom("203.0.113.7", TOKEN));
    expect(db.state.rateLimitCalls).toEqual([
      { scope: "newsletter.unsubscribe.one_click", subjectId: "203.0.113.7", max: 300 },
    ]);
  });

  it("wielu odbiorców przez TEN SAM serwer Gmaila - każdy zostaje wypisany", async () => {
    // Regresja właściwa: nagłówek List-Unsubscribe wskazuje teraz ten
    // endpoint, a one-click POST-uje serwer dostawcy, nie odbiorca. Wspólny
    // kubełek „10 na 10 minut" oddawał jedenastemu odbiorcy 429 - wypis, który
    // się nie wykonał i którego nikt nie powtórzy.
    const recipients = Array.from({ length: 25 }, (_, i) => i.toString(16).padStart(32, "0"));
    for (const token of recipients) {
      const response = await handlers().POST(oneClickFrom("66.249.66.1", token));
      expect(response.status, token).toBe(200);
    }
    expect(unsubscribedTokens()).toEqual(recipients);
  });

  it("ruch bramki pocztowej nie zjada budżetu strony wypisu z tego samego adresu", async () => {
    for (let i = 0; i < 12; i++) {
      await handlers().POST(oneClickFrom("203.0.113.7", TOKEN));
    }
    const response = await handlers().POST(
      postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }),
    );
    expect(response.status).toBe(200);
  });

  it("strona wypisu zachowuje ludzki limit - jedenaste żądanie z adresu to 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await handlers().POST(
        postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("one-click też ma sufit - dopisanie ciała one-click nie zdejmuje limitu", async () => {
    // Ciało `List-Unsubscribe=One-Click` może dokleić każdy, więc kubełek
    // bramki jest szeroki, ale skończony.
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      const response = await handlers().POST(oneClickFrom("203.0.113.7", TOKEN));
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 429)).toEqual([429]);
    expect(statuses[300]).toBe(429);
  });

  it("przekroczony limit daje 429 bez wypisu", async () => {
    db.state.rateLimitAllows = false;
    const response = await handlers().POST(
      postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }),
    );
    expect(response.status).toBe(429);
    expect(db.state.unsubscribeCalls).toEqual([]);
  });

  it("BEZ adresu IP limit jest fail-OPEN - i to jest świadoma decyzja", async () => {
    // Odwrotnie niż przy bramkach kosztowych i egressie (tam fail-closed).
    // Tutaj zamknięcie się przy braku adresu odcięłoby prawdziwym ludziom
    // za nietypowym proxy JEDYNĄ drogę wypisu - a to jest obowiązek prawny,
    // nie funkcja opcjonalna. Zapisane wprost, bo różnica względem reszty
    // platformy jest celowa i wygląda jak przeoczenie.
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(db.state.rateLimitCalls).toEqual([]);
    expect(response.status).toBe(200);
    expect(unsubscribedTokens()).toEqual([TOKEN]);
  });
});
