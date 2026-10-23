// Potwierdzenie zapisu (double opt-in) - HANDLER trasy.
//
// Czyste reguły rozstrzygania tokenu (`isValidConfirmToken`,
// `resolveConfirmOutcome`, `wantsHtml`) mają własny test obok, w
// `-api.public.newsletter.confirm.test.ts` - tutaj testujemy WARSTWĘ, która
// je stosuje: kody odpowiedzi, zapis potwierdzenia i to, czego brak maila
// powitalnego NIE może zepsuć.
//
// Najważniejsza właściwość tej trasy to IDEMPOTENCJA. Token zostaje w rekordzie
// po potwierdzeniu - dzięki temu ponowne kliknięcie linku z maila (a klienci
// pocztowe i skanery antywirusowe klikają go same) trafia w gałąź „już
// potwierdzone" zamiast w 404 albo w drugą wysyłkę powitania.
//
// OSOBNA ZGODA NA POMIAR (I9d-Y2b). GET po sukcesie niesie stan karty zgody
// na pomiar (`measurement`, `measurementLang`) i NIGDY jej nie udziela
// (skaner linków klika GET za człowieka); decyzję zapisuje wyłącznie POST
// z JSON-em, po limiterze, przez `newsletter_doi_measurement_decide`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

// ZAMROŻENIE NA POZIOMIE PLIKU, nie pojedynczego testu.
//
// Ta trasa rozstrzyga WAŻNOŚĆ tokenu, czyli porównuje `confirmation_expires_at`
// z prawdziwym zegarem. Fabryka `pendingRow()` nosiła termin ważności jako
// literał kalendarzowy (`2026-12-31`), więc cały plik miał datę przydatności:
// zmierzone przy CLOCK_SHIFT=1y - 8 czerwonych z 20, wszystkie z jednego
// powodu („expected 410 to be 200"), bo token wygasał zanim test go użył.
//
// Zamrożony był DOKŁADNIE JEDEN test - ten, w którym data potwierdzenia wchodzi
// do asercji. To ten sam wzorzec, co w darowiznach: zamrożenie stosowane tam,
// gdzie wymuszała je asercja, a nie tam, gdzie wymagała go reguła czasu.
freezeClock();

const h = vi.hoisted(() => ({ sendTxEmail: vi.fn(), rpc: vi.fn(), rateLimit: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t), rpc: h.rpc },
}));
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: h.sendTxEmail }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));

import { Route } from "@/routes/api.public.newsletter.confirm";

const db = supabaseFromStub();
const SUBSCRIBERS = "newsletter_subscribers";
const SUPPRESSIONS = "email_suppressions";
const TOKEN = "0123456789abcdef0123456789abcdef";

function get(
  token: string | null = TOKEN,
  headers: Record<string, string> = {},
): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  const url = new URL("https://example.test/api/public/newsletter/confirm");
  if (token !== null) url.searchParams.set("token", token);
  return handlers.GET({ request: new Request(url, { headers }) });
}

/** Wiersz subskrybenta oczekującego na potwierdzenie. */
function pendingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1",
    status: "pending",
    // WZGLĘDNY, nie kalendarzowy: token ma być WAŻNY w każdym przebiegu, a nie
    // do końca 2026 roku.
    confirmation_expires_at: relativeIso(7 * DZIEN),
    tenant_id: "tenant-1",
    email: "nowy@example.test",
    language: "pl",
    first_name: "Anna",
    display_name: null,
    ...overrides,
  };
}

/** Domyślny stan karty: brak deklaracji pola pomiaru (karty nie ma). */
const NO_CARD = { measurement: "none", measurementLang: "pl" } as const;

function stateRpc(result: unknown, error: { message: string } | null = null): void {
  h.rpc.mockImplementation(async (fn: string) =>
    fn === "newsletter_doi_measurement_state"
      ? { data: error ? null : result, error }
      : { data: null, error: { message: `nieoczekiwane RPC ${fn}` } },
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.setResponse(SUBSCRIBERS, (chain) => (chain.has("update") ? ok(null) : ok(pendingRow())));
  db.setResponse(SUPPRESSIONS, ok(null));
  h.sendTxEmail.mockResolvedValue(undefined);
  stateRpc({ result: "none", lang: "pl" });
  h.rateLimit.mockResolvedValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("klik z maila trafia na stronę, nie na surowy JSON", () => {
  it("nawigacja przeglądarki dostaje przekierowanie 303 na stronę wyniku", async () => {
    const res = await get(TOKEN, { accept: "text/html,application/xhtml+xml" });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `https://example.test/newsletter/confirm?token=${TOKEN}`,
    );
  });

  it("przekierowanie działa też bez tokenu - strona pokaże własny komunikat", async () => {
    const res = await get(null, { accept: "text/html" });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.test/newsletter/confirm");
  });

  it("klient programowy dostaje JSON, nie przekierowanie", async () => {
    const res = await get(TOKEN, { accept: "*/*" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, ...NO_CARD });
  });
});

describe("odmowy", () => {
  it("brak tokenu to 400, bez pytania bazy", async () => {
    const res = await get(null);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "invalid_token" });
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("token o niedozwolonym kształcie nie trafia do zapytania", async () => {
    const res = await get("abcdef0123456789' OR 1=1 --");

    expect(res.status).toBe(400);
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("nieznany token to 404", async () => {
    db.setResponse(SUBSCRIBERS, ok(null));

    const res = await get();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("błąd odczytu też kończy się 404 - nie zdradzamy stanu bazy", async () => {
    db.setResponse(SUBSCRIBERS, fail("db down"));

    const res = await get();

    expect(res.status).toBe(404);
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("token WYGASŁY to 410, a subskrypcja zostaje `pending`", async () => {
    db.setResponse(
      SUBSCRIBERS,
      ok(pendingRow({ confirmation_expires_at: relativeIso(-1 * DZIEN) })),
    );

    const res = await get();

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "expired" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
  });
});

describe("idempotencja ponownego kliknięcia", () => {
  it("drugi klik w ten sam link mówi „już potwierdzone”, nie 404", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ status: "subscribed" })));

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, already: true, ...NO_CARD });
  });

  it("ponowne kliknięcie NIE wysyła powitania drugi raz", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ status: "subscribed" })));

    await get();

    expect(h.sendTxEmail).not.toHaveBeenCalled();
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
  });

  it("adres wypisany wcześniej NIE jest wskrzeszany zachowanym tokenem", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ status: "unsubscribed" })));

    const res = await get();

    expect(res.status).toBe(410);
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
  });
});

describe("potwierdzenie", () => {
  it("ustawia status i datę potwierdzenia oraz kasuje termin ważności", async () => {
    // Lokalne `vi.useFakeTimers()` zniknęło - zegar zamraża cały plik. Asercja
    // bez zmian co do treści: data potwierdzenia to DOKŁADNIE „teraz", a termin
    // ważności zostaje wyczyszczony.
    const res = await get();

    expect(res.status).toBe(200);
    const update = db
      .chainsFor(SUBSCRIBERS)
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0];
    expect(update).toEqual({
      status: "subscribed",
      confirmed_at: relativeIso(0),
      confirmation_expires_at: null,
    });
  });

  it("aktualizuje dokładnie ten jeden wiersz", async () => {
    await get();

    const update = db.chainsFor(SUBSCRIBERS).find((c) => c.has("update"));
    expect(update?.argsOf("eq")).toEqual(["id", "sub-1"]);
    expect(db.lastChain(SUBSCRIBERS)?.table).toBe(SUBSCRIBERS);
  });

  it("szuka subskrybenta po tokenie potwierdzenia", async () => {
    await get();

    const read = db.chainsFor(SUBSCRIBERS)[0];
    expect(read?.argsOf("eq")).toEqual(["confirmation_token", TOKEN]);
    expect(read?.has("maybeSingle")).toBe(true);
  });

  it("nieudany zapis potwierdzenia to 500 ze STAŁYM kodem (komunikat Postgresa tylko w logu)", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? fail("update rejected") : ok(pendingRow()),
    );

    const res = await get();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "update_failed" });
    expect(errorSpy).toHaveBeenCalledWith("[newsletter/confirm] update failed", "update rejected");
    // Karta pomiaru nie powstaje dla niepotwierdzonego zapisu.
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("ponowny zapis po wypisie", () => {
  it("zdejmuje wyłącznie aktywną blokadę `unsubscribe` tego tenanta i adresu", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const release = db.chainsFor(SUPPRESSIONS).find((c) => c.has("update"));
    expect(release?.argsOf("update")?.[0]).toEqual({
      released_at: relativeIso(0),
      expires_at: relativeIso(0),
    });
    const eqs = release?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["tenant_id", "tenant-1"],
      ["email_norm", "nowy@example.test"],
      ["reason", "unsubscribe"],
    ]);
    expect(release?.argsOf("is")).toEqual(["released_at", null]);
  });

  it("nieudane zdjęcie blokady to 500 bez zmiany statusu i bez powitania", async () => {
    db.setResponse(SUPPRESSIONS, fail("db down"));

    const res = await get();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "confirm_failed" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("ponowny klik po potwierdzeniu nie dotyka listy wykluczeń", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ status: "subscribed" })));

    const res = await get();

    expect(db.chainsFor(SUPPRESSIONS)).toHaveLength(0);
    // Gałąź „already" - a nie błąd, który też ominąłby listę wykluczeń.
    await expect(res.json()).resolves.toEqual({ ok: true, already: true, ...NO_CARD });
  });
});

describe("mail powitalny", () => {
  it("idzie z kluczem idempotencji zbudowanym z tenanta i adresu", async () => {
    await get();

    expect(h.sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "newsletter_confirmed",
        to: "nowy@example.test",
        tenantId: "tenant-1",
        idempotencyKey: "newsletter_confirmed:tenant-1:nowy@example.test",
      }),
    );
    // Klucz niesie OBA składniki - bez tenanta ten sam adres w dwóch
    // instalacjach zablokowałby sobie powitanie.
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("język i adres docelowy idą za językiem subskrybenta", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? ok(null) : ok(pendingRow({ language: "en" })),
    );

    await get();

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({
      lang: "en",
      ctaPath: "/en/analyses",
    });
    // Nie polska ścieżka - odbiorca kliknąłby i wylądował w obcym języku.
    expect(h.sendTxEmail.mock.calls[0]?.[0].ctaPath).not.toBe("/analizy");
  });

  it("nieznany język schodzi na polski", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? ok(null) : ok(pendingRow({ language: "de" })),
    );

    await get();

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({ lang: "pl", ctaPath: "/analizy" });
    // Nie „de" - nieobsługiwany język nie może wyciec do szablonu maila.
    expect(h.sendTxEmail.mock.calls[0]?.[0].lang).not.toBe("de");
  });

  it("bez imienia używa nazwy wyświetlanej", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update")
        ? ok(null)
        : ok(pendingRow({ first_name: null, display_name: "Anna N." })),
    );

    await get();

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({ metaName: "Anna N." });
    // Nie pusty napis - „Witaj ," w mailu wygląda na awarię.
    expect(h.sendTxEmail.mock.calls[0]?.[0].metaName).toBeTruthy();
  });

  it("AWARIA maila powitalnego nie unieważnia potwierdzenia", async () => {
    h.sendTxEmail.mockRejectedValue(new Error("kolejka padła"));

    const res = await get();

    // Subskrypcja JEST potwierdzona - użytkownik nie może zobaczyć błędu.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, ...NO_CARD });
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// I9d-Y2b: karta zgody na pomiar na stronie potwierdzenia (GET - stan)
// ---------------------------------------------------------------------------

describe("GET: stan karty zgody na pomiar (bez zapisu zgody)", () => {
  it("po potwierdzeniu pyta o stan TYM tokenem, PO zmianie statusu; `offer` = karta w języku z bazy", async () => {
    stateRpc({ result: "offer", lang: "en" });

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      measurement: "offer",
      measurementLang: "en",
    });
    expect(h.rpc.mock.calls).toEqual([["newsletter_doi_measurement_state", { p_token: TOKEN }]]);
    // GET nigdy nie woła pisarza decyzji.
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain("newsletter_doi_measurement_decide");
    // Stan czytany po zapisie statusu (oferta tylko dla aktywnego subskrybenta).
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(true);
  });

  it("ponowny klik (`already`) też niesie stan karty - decyzję można podjąć później", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ status: "subscribed" })));
    stateRpc({ result: "offer", lang: "pl" });

    const res = await get();

    await expect(res.json()).resolves.toEqual({
      ok: true,
      already: true,
      measurement: "offer",
      measurementLang: "pl",
    });
  });

  it("decyzja już zapisana: `granted` / `declined` przechodzą bez karty decyzji", async () => {
    for (const result of ["granted", "declined"] as const) {
      stateRpc({ result, lang: "pl" });
      const res = await get();
      await expect(res.json()).resolves.toMatchObject({ ok: true, measurement: result });
    }
  });

  it.each([
    ["invalid", { result: "invalid" }],
    ["inactive", { result: "inactive", lang: "pl" }],
    ["gone", { result: "gone" }],
    ["nieznany wynik", { result: "granted_maybe", lang: "pl" }],
    ["pusty wynik", null],
  ])("FAIL-CLOSED: %s -> `none` (bez karty)", async (_why, data) => {
    stateRpc(data);

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, measurement: "none" });
  });

  it("błąd RPC: potwierdzenie dalej 200, karta `none`, język awaryjnie z wiersza subskrybenta", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? ok(null) : ok(pendingRow({ language: "en" })),
    );
    stateRpc(null, { message: "function newsletter_doi_measurement_state does not exist" });

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      measurement: "none",
      measurementLang: "en",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[newsletter/confirm] measurement state failed",
      "function newsletter_doi_measurement_state does not exist",
    );
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("wyjątek RPC też nie psuje potwierdzenia (fail-closed)", async () => {
    h.rpc.mockRejectedValue(new Error("connection reset"));

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, ...NO_CARD });
  });

  it("bez potwierdzenia (wygasły, nieznany, zły token) stanu karty NIE czytamy", async () => {
    db.setResponse(SUBSCRIBERS, ok(pendingRow({ confirmation_expires_at: relativeIso(-DZIEN) })));
    expect((await get()).status).toBe(410);
    db.setResponse(SUBSCRIBERS, ok(null));
    expect((await get()).status).toBe(404);
    expect((await get("xyz")).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("odpowiedź GET nie niesie adresu ani najemcy", async () => {
    stateRpc({ result: "offer", lang: "pl", tenant_id: "tenant-1", email: "nowy@example.test" });

    const body = JSON.stringify(await (await get()).json());

    expect(body).not.toContain("@");
    expect(body).not.toContain("tenant-1");
  });
});

// ---------------------------------------------------------------------------
// I9d-Y2b: decyzja z karty (POST)
// ---------------------------------------------------------------------------

function post(
  body: unknown,
  headers: Record<string, string> = {},
  raw?: string,
): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  return handlers.POST({
    request: new Request("https://example.test/api/public/newsletter/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "Przeglądarka/1.0",
        ...headers,
      },
      body: raw ?? JSON.stringify(body),
    }),
  });
}

function decideRpc(result: unknown, error: { message: string } | null = null): void {
  h.rpc.mockImplementation(async (fn: string) =>
    fn === "newsletter_doi_measurement_decide"
      ? { data: error ? null : result, error }
      : { data: null, error: { message: `nieoczekiwane RPC ${fn}` } },
  );
}

describe("POST: decyzja z karty pomiaru", () => {
  it("„Zgadzam się”: RPC z tokenem, decyzją, IP i UA; 200 `granted`", async () => {
    decideRpc({ result: "granted", lang: "pl" });

    const res = await post({ token: TOKEN, decision: "grant" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, result: "granted" });
    expect(h.rpc.mock.calls).toEqual([
      [
        "newsletter_doi_measurement_decide",
        {
          p_token: TOKEN,
          p_grant: true,
          p_ip: "203.0.113.7",
          p_user_agent: "Przeglądarka/1.0",
        },
      ],
    ]);
    // Bez odczytu i zapisu tabel z TS - decyzję zapisuje wyłącznie baza.
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("„Nie zgadzam się”: `p_grant: false`, 200 `declined`; powtórka `already`", async () => {
    decideRpc({ result: "declined", lang: "en" });
    const res = await post({ token: TOKEN, decision: "decline" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, result: "declined" });
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_grant: false });

    decideRpc({ result: "already", lang: "en" });
    const again = await post({ token: TOKEN, decision: "decline" });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toEqual({ ok: true, result: "already" });
  });

  it.each([
    ["inactive", 409, "inactive"],
    ["none", 422, "none"],
    ["invalid", 400, "invalid_token"],
    ["gone", 400, "invalid_token"],
  ])("wynik RPC `%s` -> %i `%s`", async (result, status, error) => {
    decideRpc({ result, lang: "pl" });

    const res = await post({ token: TOKEN, decision: "grant" });

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ ok: false, error });
  });

  it("tylko JSON: inny typ ciała to 415 bez limitera i bez bazy", async () => {
    const res = await post(
      null,
      { "content-type": "application/x-www-form-urlencoded" },
      `token=${TOKEN}&decision=grant`,
    );

    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "unsupported_media_type" });
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zły token albo decyzja to 400 bez limitera i bez bazy; nieparsowalne ciało = zły token", async () => {
    const badToken = await post({ token: "abc' OR 1=1 --", decision: "grant" });
    expect(badToken.status).toBe(400);
    await expect(badToken.json()).resolves.toEqual({ ok: false, error: "invalid_token" });

    const badDecision = await post({ token: TOKEN, decision: "maybe" });
    expect(badDecision.status).toBe(400);
    await expect(badDecision.json()).resolves.toEqual({ ok: false, error: "invalid_decision" });

    const garbage = await post(null, {}, "{nie-json");
    expect(garbage.status).toBe(400);
    await expect(garbage.json()).resolves.toEqual({ ok: false, error: "invalid_token" });

    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("limiter per IP PRZED zapisem: odmowa = 429 bez RPC", async () => {
    h.rateLimit.mockResolvedValue(false);

    const res = await post({ token: TOKEN, decision: "grant" });

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "newsletter.confirm_measurement",
      subjectId: "203.0.113.7",
      max: 10,
      windowMinutes: 10,
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("nieznane IP: fail-open (bez kubełka), RPC z `p_ip: null`", async () => {
    decideRpc({ result: "granted", lang: "pl" });

    const res = await post({ token: TOKEN, decision: "grant" }, { "cf-connecting-ip": "" });

    expect(res.status).toBe(200);
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls[0]?.[1]).toMatchObject({ p_ip: null });
  });

  it("błąd bazy, nieznany kształt i wyjątek: 500 `update_failed`, komunikat tylko w logu", async () => {
    decideRpc(null, { message: 'relation "crm_consent_log" is locked' });
    const failed = await post({ token: TOKEN, decision: "grant" });
    expect(failed.status).toBe(500);
    const body = JSON.stringify(await failed.json());
    expect(body).toBe(JSON.stringify({ ok: false, error: "update_failed" }));
    expect(errorSpy).toHaveBeenCalledWith(
      "[newsletter/confirm] measurement decision failed",
      'relation "crm_consent_log" is locked',
    );

    decideRpc({ result: "confirmed" });
    expect((await post({ token: TOKEN, decision: "grant" })).status).toBe(500);

    h.rpc.mockRejectedValue(new Error("connection reset"));
    expect((await post({ token: TOKEN, decision: "grant" })).status).toBe(500);
  });

  it("odpowiedź POST nie ujawnia adresu, najemcy ani języka", async () => {
    decideRpc({ result: "granted", lang: "pl", tenant_id: "tenant-1", email: "nowy@example.test" });

    const body = JSON.stringify(await (await post({ token: TOKEN, decision: "grant" })).json());

    expect(body).toBe(JSON.stringify({ ok: true, result: "granted" }));
  });
});
