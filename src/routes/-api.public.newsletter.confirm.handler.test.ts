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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ sendTxEmail: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t) },
}));
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: h.sendTxEmail }));

import { Route } from "@/routes/api.public.newsletter.confirm";

const db = supabaseFromStub();
const SUBSCRIBERS = "newsletter_subscribers";
const TOKEN = "0123456789abcdef0123456789abcdef";

type Handler = (args: { request: Request }) => Promise<Response>;

function get(
  token: string | null = TOKEN,
  headers: Record<string, string> = {},
): Promise<Response> {
  const handlers = (Route.options as { server: { handlers: { GET: Handler } } }).server.handlers;
  const url = new URL("https://example.test/api/public/newsletter/confirm");
  if (token !== null) url.searchParams.set("token", token);
  return handlers.GET({ request: new Request(url, { headers }) });
}

/** Wiersz subskrybenta oczekującego na potwierdzenie. */
function pendingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1",
    status: "pending",
    confirmation_expires_at: "2026-12-31T00:00:00.000Z",
    tenant_id: "tenant-1",
    email: "nowy@example.test",
    language: "pl",
    first_name: "Anna",
    display_name: null,
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.setResponse(SUBSCRIBERS, (chain) => (chain.has("update") ? ok(null) : ok(pendingRow())));
  h.sendTxEmail.mockResolvedValue(undefined);
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
    await expect(res.json()).resolves.toEqual({ ok: true });
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
      ok(pendingRow({ confirmation_expires_at: "2020-01-01T00:00:00Z" })),
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
    await expect(res.json()).resolves.toEqual({ ok: true, already: true });
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T10:00:00.000Z"));

    const res = await get();

    expect(res.status).toBe(200);
    const update = db
      .chainsFor(SUBSCRIBERS)
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0];
    expect(update).toEqual({
      status: "subscribed",
      confirmed_at: "2026-08-18T10:00:00.000Z",
      confirmation_expires_at: null,
    });
    vi.useRealTimers();
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

  it("nieudany zapis potwierdzenia to 500 z powodem", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? fail("update rejected") : ok(pendingRow()),
    );

    const res = await get();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "update rejected" });
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
  });

  it("nieznany język schodzi na polski", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? ok(null) : ok(pendingRow({ language: "de" })),
    );

    await get();

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({ lang: "pl", ctaPath: "/analizy" });
  });

  it("bez imienia używa nazwy wyświetlanej", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update")
        ? ok(null)
        : ok(pendingRow({ first_name: null, display_name: "Anna N." })),
    );

    await get();

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({ metaName: "Anna N." });
  });

  it("AWARIA maila powitalnego nie unieważnia potwierdzenia", async () => {
    h.sendTxEmail.mockRejectedValue(new Error("kolejka padła"));

    const res = await get();

    // Subskrypcja JEST potwierdzona - użytkownik nie może zobaczyć błędu.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(errorSpy).toHaveBeenCalled();
  });
});
