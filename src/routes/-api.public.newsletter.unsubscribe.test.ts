// Publiczny endpoint wypisu z newslettera - 115 linii, zero testów do dziś.
//
// To jest OBOWIĄZEK PRAWNY, nie funkcja produktu: adres z listy mailingowej musi
// dać się usunąć jednym klikiem, a mechanizm jednego kliku (RFC 8058) jest
// wymogiem bramek Gmaila i Yahoo dla nadawców masowych. Newsletter ma w repo
// najniższe pokrycie ze wszystkich modułów (T/P 0,08, audyt 14.08), a ta trasa
// jest w nim najostrzejszą pozycją: bez auth, z zapisem do bazy, wołana przez
// obcą infrastrukturę.
//
// TRZY RZECZY, KTÓRE MOGĄ SIĘ TU ZEPSUĆ, I ŻADNA NIE JEST WIDOCZNA W UI:
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SubscriberRow {
  id: string;
  status: string;
}

const db = vi.hoisted(() => {
  const state = {
    /** Wiersz zwracany dla dowolnego tokena, albo `null` (nie znaleziono). */
    row: null as SubscriberRow | null,
    selectError: null as { message: string } | null,
    updateError: null as { message: string } | null,
    /** Każde `select(...).eq(...)` - do sprawdzenia, po czym szukamy. */
    selects: [] as Array<{ table: string; columns: string; filter: [string, unknown] }>,
    /** Każde `update(...)` - PUSTA lista jest dowodem, że GET nie mutuje. */
    updates: [] as Array<{
      table: string;
      patch: Record<string, unknown>;
      filter: [string, unknown];
    }>,
    rateLimitCalls: [] as Array<{ scope: string; subjectId: string }>,
    rateLimitAllows: true,
  };
  return { state };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  db.state.selects.push({ table, columns, filter: [column, value] });
                  return { data: db.state.row, error: db.state.selectError };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              db.state.updates.push({ table, patch, filter: [column, value] });
              return { error: db.state.updateError };
            },
          };
        },
      };
    },
  },
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (options: { scope: string; subjectId: string }) => {
    db.state.rateLimitCalls.push({ scope: options.scope, subjectId: options.subjectId });
    return db.state.rateLimitAllows;
  },
}));

import { Route, isValidUnsubToken } from "./api.public.newsletter.unsubscribe";

const TOKEN = "0123456789abcdef0123456789abcdef";
const ORIGIN = "https://nes.example";

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
    request: new Request(`${ORIGIN}/api/public/newsletter/unsubscribe${query}`, { headers }),
  };
}

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
  query = "",
): { request: Request } {
  return {
    request: new Request(`${ORIGIN}/api/public/newsletter/unsubscribe${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  };
}

beforeEach(() => {
  const { state } = db;
  state.row = { id: "sub-1", status: "subscribed" };
  state.selectError = null;
  state.updateError = null;
  state.selects = [];
  state.updates = [];
  state.rateLimitCalls = [];
  state.rateLimitAllows = true;
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
    // dokładnie to żądanie na każdym adresie w mailu.
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, already: false });
    expect(db.state.updates).toEqual([]);
  });

  it("GET na wierszu JUŻ wypisanym też nie mutuje, tylko raportuje stan", async () => {
    db.state.row = { id: "sub-1", status: "unsubscribed" };
    const response = await handlers().GET(getRequest(`?token=${TOKEN}`));
    await expect(response.json()).resolves.toEqual({ ok: true, already: true });
    expect(db.state.updates).toEqual([]);
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

describe("POST - wykonuje wypis (RFC 8058, jeden klik)", () => {
  it("wypisuje subskrybenta i stawia znacznik czasu", async () => {
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(db.state.updates).toHaveLength(1);
    expect(db.state.updates[0]).toEqual({
      table: "newsletter_subscribers",
      patch: {
        status: "unsubscribed",
        unsubscribed_at: "2026-08-14T10:00:00.000Z",
        confirmation_token: null,
        confirmation_expires_at: null,
      },
      filter: ["id", "sub-1"],
    });
  });

  it("wypis czyści token POTWIERDZENIA, ale ZOSTAWIA token wypisu", async () => {
    // Rozróżnienie, na którym stoi idempotencja. Token potwierdzenia musi zniknąć
    // (inaczej stary link z maila powitalnego reaktywowałby subskrypcję), a token
    // wypisu musi zostać, bo to on obsługuje ponowny klik.
    await handlers().POST(postRequest({ token: TOKEN }));
    const { patch } = db.state.updates[0];
    expect(patch.confirmation_token).toBeNull();
    expect(patch).not.toHaveProperty("unsubscribe_token");
  });

  it("wypis aktualizuje wiersz po KLUCZU GŁÓWNYM, nie po tokenie", async () => {
    // Zapis po tokenie działałby, ale wiązałby mutację z wartością, która jedzie
    // w każdym mailu; po identyfikatorze odczytanym wcześniej mutacja dotyka
    // dokładnie jednego, już rozstrzygniętego wiersza.
    await handlers().POST(postRequest({ token: TOKEN }));
    expect(db.state.updates[0].filter).toEqual(["id", "sub-1"]);
  });

  it("PONOWNY klik jest idempotentny - `already`, nie 404 i nie druga mutacja", async () => {
    db.state.row = { id: "sub-1", status: "unsubscribed" };
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, already: true });
    expect(db.state.updates).toEqual([]);
  });

  it("czyta token z ciała żądania", async () => {
    await handlers().POST(postRequest({ token: TOKEN }));
    expect(db.state.selects[0].filter).toEqual(["unsubscribe_token", TOKEN]);
  });

  it("spada na token z adresu, gdy ciało nie jest JSON-em", async () => {
    // Część bramek pocztowych wysyła one-click POST bez ciała albo z ciałem
    // `application/x-www-form-urlencoded`. Bez tego zapasu wypis nie działa
    // dokładnie u tych nadawców, którzy go wymagają.
    const request = new Request(`${ORIGIN}/api/public/newsletter/unsubscribe?token=${TOKEN}`, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    });
    const response = await handlers().POST({ request });
    expect(response.status).toBe(200);
    expect(db.state.updates).toHaveLength(1);
  });

  it("token o niepoprawnym typie w ciele jest traktowany jak brak tokena", async () => {
    for (const token of [42, null, { value: TOKEN }, [TOKEN]]) {
      db.state.updates = [];
      const response = await handlers().POST(postRequest({ token }));
      expect(response.status, JSON.stringify(token)).toBe(400);
      expect(db.state.updates).toEqual([]);
    }
  });

  it("niepoprawny token daje 400 PRZED licznikiem żądań i przed bazą", async () => {
    // Kolejność jest oszczędnością kubełka: śmieciowe żądania nie mogą zużywać
    // limitu prawdziwym odbiorcom z tego samego adresu (wspólne NAT-y, biura).
    const response = await handlers().POST(postRequest({ token: "nie-hex" }));
    expect(response.status).toBe(400);
    expect(db.state.rateLimitCalls).toEqual([]);
    expect(db.state.selects).toEqual([]);
  });

  it("nieznany token daje 404 bez mutacji", async () => {
    db.state.row = null;
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(404);
    expect(db.state.updates).toEqual([]);
  });

  it("błąd zapisu daje 500 - wypis, który się nie udał, nie może raportować sukcesu", async () => {
    // To jest ta odpowiedź, po której bramka pocztowa powtórzy żądanie. Ciche
    // `ok: true` przy nieudanym zapisie zostawiłoby adres na liście na zawsze.
    db.state.updateError = { message: "deadlock detected" };
    const response = await handlers().POST(postRequest({ token: TOKEN }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});

describe("POST - limit żądań", () => {
  it("liczy per adres IP z nagłówka Cloudflare", async () => {
    await handlers().POST(postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }));
    expect(db.state.rateLimitCalls).toEqual([
      { scope: "newsletter.unsubscribe", subjectId: "203.0.113.7" },
    ]);
  });

  it("bierze PIERWSZY adres z `x-forwarded-for`, nie całą listę", async () => {
    // Cały łańcuch jako podmiot dawałby osobny kubełek na każdą kombinację
    // proxy, czyli limit, którego nie da się wyczerpać.
    await handlers().POST(
      postRequest({ token: TOKEN }, { "x-forwarded-for": "203.0.113.7, 198.51.100.2" }),
    );
    expect(db.state.rateLimitCalls[0].subjectId).toBe("203.0.113.7");
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

  it("przekroczony limit daje 429 bez mutacji", async () => {
    db.state.rateLimitAllows = false;
    const response = await handlers().POST(
      postRequest({ token: TOKEN }, { "cf-connecting-ip": "203.0.113.7" }),
    );
    expect(response.status).toBe(429);
    expect(db.state.updates).toEqual([]);
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
    expect(db.state.updates).toHaveLength(1);
  });
});
