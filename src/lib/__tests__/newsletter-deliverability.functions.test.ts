// Doręczalność newslettera - warstwa serwerowa panelu.
//
// Ten plik odpowiada operatorowi na pytanie „czy da się jeszcze wysyłać", więc
// jego błędy nie wywalają aplikacji - one podają FAŁSZYWY ODCZYT i pozwalają
// wysłać kampanię, której wysyłać nie wolno. Testy pilnują trzech rzeczy:
//   1. liczniki z RPC są mapowane wiernie (także gdy baza odda tekst zamiast
//      liczby) - na nich stoi bramka reputacji,
//   2. filtry listy wykluczeń trafiają w PRAWDZIWE ogniwa PostgREST, w tym
//      sanityzację frazy szukania (fraza jest wstawiana do wzorca `ilike`),
//   3. instrukcja konfiguracji webhooka idzie za ustawionym źródłem prawdy -
//      dopisanie `email.opened` w trybie `first_party` daje podwójne zliczanie.
//
// Handlery server fn są wywoływane przez atrapę `createServerFn`
// (src/test/serverFn.ts) - patrz komentarz tam: te testy dowodzą LOGIKI
// handlera, nie autoryzacji, którą pilnuje bramka `check:authz-snapshot`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));

import {
  addSuppression,
  getDeliverabilityMetrics,
  getDeliverabilitySetup,
  listSuppressions,
  releaseSuppression,
} from "@/lib/newsletter-deliverability.functions";

const SUPPRESSIONS = "email_suppressions";
const EVENTS = "email_delivery_events";

const db = supabaseFromStub();
let rpc: ReturnType<typeof vi.fn>;

const ENV_KEYS = [
  "PUBLIC_SITE_URL",
  "SITE_URL",
  "URL",
  "RESEND_WEBHOOK_SECRET",
  "NEWSLETTER_ENGAGEMENT_SOURCE",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  db.reset();
  rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
  setServerFnContext({ supabase: { from: db.from, rpc } });
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  resetServerFnContext();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Wiersz metryk w kształcie, w jakim oddaje go RPC. */
function metricsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    days: 30,
    sent: 1000,
    delivered: 980,
    bounced: 15,
    hard_bounced: 10,
    soft_bounced: 5,
    complained: 2,
    failed: 3,
    delayed: 1,
    suppressed_sends: 4,
    active_suppressions: 42,
    generated_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("obudowa server fn", () => {
  it("każda funkcja panelu jest za rolą admin/edytor", () => {
    for (const fn of [
      getDeliverabilityMetrics,
      listSuppressions,
      addSuppression,
      releaseSuppression,
      getDeliverabilitySetup,
    ]) {
      expect(serverFnMeta(fn)?.middleware).toEqual([{ __mw: "requireAdminEditor" }]);
    }
    expect(serverFnMeta(addSuppression)?.method).toBe("POST");
  });

  it("odczyt idzie metodą GET, zmiana listy metodą POST", () => {
    expect(serverFnMeta(getDeliverabilityMetrics)?.method).toBe("GET");
    expect(serverFnMeta(releaseSuppression)?.method).toBe("POST");
  });
});

describe("getDeliverabilityMetrics", () => {
  it("mapuje komplet liczników i liczy z nich reputację", async () => {
    rpc.mockResolvedValue({ data: metricsRow(), error: null });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.counts).toEqual({
      sent: 1000,
      delivered: 980,
      bounced: 15,
      hardBounced: 10,
      softBounced: 5,
      complained: 2,
      failed: 3,
      delayed: 1,
      suppressedSends: 4,
      activeSuppressions: 42,
    });
    expect(metrics.reputation.complaint.numerator).toBe(2);
    expect(metrics.generatedAt).toBe("2026-08-18T10:00:00.000Z");
  });

  it("przekazuje okno w dniach do RPC", async () => {
    rpc.mockResolvedValue({ data: metricsRow({ days: 7 }), error: null });

    const metrics = await getDeliverabilityMetrics({ data: { days: 7 } });

    expect(rpc).toHaveBeenCalledWith("newsletter_deliverability_metrics", { p_days: 7 });
    expect(metrics.days).toBe(7);
  });

  it("domyślne okno to 30 dni, także przy wywołaniu bez danych", async () => {
    rpc.mockResolvedValue({ data: metricsRow(), error: null });

    await getDeliverabilityMetrics();

    expect(rpc).toHaveBeenCalledWith("newsletter_deliverability_metrics", { p_days: 30 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("liczby podane tekstem są parsowane, śmieci schodzą do zera", async () => {
    rpc.mockResolvedValue({
      data: metricsRow({ sent: "1500", delivered: "abc", bounced: null }),
      error: null,
    });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.counts.sent).toBe(1500);
    expect(metrics.counts.delivered).toBe(0);
    expect(metrics.counts.bounced).toBe(0);
  });

  it("odpowiedź nie-obiektowa daje zerowe liczniki i okno z zapytania", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const metrics = await getDeliverabilityMetrics({ data: { days: 14 } });

    expect(metrics.counts.sent).toBe(0);
    expect(metrics.days).toBe(14);
    expect(metrics.reasons).toEqual([]);
  });

  it("mapuje powody wykluczeń, sprowadzając nieznane do `manual`", async () => {
    rpc.mockResolvedValue({
      data: metricsRow({
        suppression_reasons: [
          { reason: "hard_bounce", scope: "permanent", count: 5 },
          { reason: "soft_bounce", scope: "transient", count: 2 },
          { reason: "wymyślony", scope: "cokolwiek", count: 1 },
        ],
      }),
      error: null,
    });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.reasons).toEqual([
      { reason: "hard_bounce", scope: "permanent", count: 5 },
      { reason: "soft_bounce", scope: "transient", count: 2 },
      { reason: "manual", scope: "permanent", count: 1 },
    ]);
    expect(metrics.reasons).toHaveLength(3);
  });

  it("mapuje szereg dzienny, uzupełniając brakującą datę pustką", async () => {
    rpc.mockResolvedValue({
      data: metricsRow({
        series: [
          { day: "2026-08-17", sent: 10, delivered: 9, bounced: 1, complained: 0 },
          { sent: 5 },
        ],
      }),
      error: null,
    });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.series[0]).toEqual({
      day: "2026-08-17",
      sent: 10,
      delivered: 9,
      bounced: 1,
      complained: 0,
    });
    expect(metrics.series[1]).toEqual({
      day: "",
      sent: 5,
      delivered: 0,
      bounced: 0,
      complained: 0,
    });
  });

  it("mapuje kampanie wraz z liczbą wykluczonych wysyłek", async () => {
    rpc.mockResolvedValue({
      data: metricsRow({
        campaigns: [
          {
            id: "c-1",
            name: "Sierpień",
            finished_at: "2026-08-15T10:00:00.000Z",
            sent: 500,
            delivered: 480,
            bounced: 10,
            complained: 1,
            suppressed: 9,
          },
        ],
      }),
      error: null,
    });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.campaigns[0]).toMatchObject({ id: "c-1", name: "Sierpień", suppressed: 9 });
    expect(metrics.campaigns[0]?.finishedAt).toBe("2026-08-15T10:00:00.000Z");
  });

  it("kolekcje, które nie są tablicami, dają puste listy zamiast wysypki", async () => {
    rpc.mockResolvedValue({
      data: metricsRow({ suppression_reasons: "nie tablica", series: null, campaigns: 42 }),
      error: null,
    });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.reasons).toEqual([]);
    expect(metrics.series).toEqual([]);
    expect(metrics.campaigns).toEqual([]);
  });

  it("brak znacznika wygenerowania jest jawny, nie udawany", async () => {
    rpc.mockResolvedValue({ data: metricsRow({ generated_at: undefined }), error: null });

    const metrics = await getDeliverabilityMetrics({ data: { days: 30 } });

    expect(metrics.generatedAt).toBeNull();
    expect(metrics.days).toBe(30);
  });

  it("błąd RPC leci w górę - panel ma pokazać awarię, nie zera", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "rpc exploded" } });

    await expect(getDeliverabilityMetrics({ data: { days: 30 } })).rejects.toThrow("rpc exploded");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("okno spoza zakresu 1..365 jest odrzucane przez walidator", async () => {
    await expect(getDeliverabilityMetrics({ data: { days: 0 } })).rejects.toThrow();
    await expect(getDeliverabilityMetrics({ data: { days: 366 } })).rejects.toThrow();
  });
});

describe("listSuppressions - filtry", () => {
  beforeEach(() => {
    db.setResponse(SUPPRESSIONS, ok([]));
  });

  it("domyślnie pokazuje wykluczenia AKTYWNE (niezdjęte)", async () => {
    await listSuppressions();

    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.argsOf("is")).toEqual(["released_at", null]);
    expect(chain?.has("not")).toBe(false);
  });

  it("stan `released` pokazuje wyłącznie zdjęte", async () => {
    await listSuppressions({ data: { state: "released" } });

    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.argsOf("not")).toEqual(["released_at", "is", null]);
    expect(chain?.has("is")).toBe(false);
  });

  it("stan `all` nie filtruje po zdjęciu blokady", async () => {
    await listSuppressions({ data: { state: "all" } });

    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.has("is")).toBe(false);
    expect(chain?.has("not")).toBe(false);
  });

  it("filtr powodu zawęża zapytanie, `all` go nie dokłada", async () => {
    await listSuppressions({ data: { reason: "complaint" } });
    const filtered = db.lastChain(SUPPRESSIONS);
    await listSuppressions({ data: { reason: "all" } });
    const unfiltered = db.lastChain(SUPPRESSIONS);

    expect(filtered?.argsOf("eq")).toEqual(["reason", "complaint"]);
    expect(unfiltered?.has("eq")).toBe(false);
  });

  it("sortuje od ostatnio widzianych i respektuje limit", async () => {
    await listSuppressions({ data: { limit: 25 } });

    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.argsOf("order")).toEqual(["last_seen_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([25]);
  });

  it("domyślny limit to 300", async () => {
    await listSuppressions();

    expect(db.lastChain(SUPPRESSIONS)?.argsOf("limit")).toEqual([300]);
    expect(db.chainsFor(SUPPRESSIONS)).toHaveLength(1);
  });
});

describe("listSuppressions - sanityzacja frazy szukania", () => {
  beforeEach(() => {
    db.setResponse(SUPPRESSIONS, ok([]));
  });

  it("szuka fragmentu adresu, sprowadzając frazę do małych liter", async () => {
    await listSuppressions({ data: { search: "ANNA" } });

    expect(db.lastChain(SUPPRESSIONS)?.argsOf("ilike")).toEqual(["email", "%anna%"]);
    // Fragment, nie całe dopasowanie - operator wpisuje kawałek adresu.
    expect(db.lastChain(SUPPRESSIONS)?.has("eq")).toBe(false);
  });

  it("usuwa znaki sterujące PostgREST - filtra nie da się rozszerzyć", async () => {
    await listSuppressions({ data: { search: 'a%_,()"\\b' } });

    const args = db.lastChain(SUPPRESSIONS)?.argsOf("ilike");
    // Zostają wyłącznie znaki treści; `%` na brzegach dokłada sam handler.
    expect(args).toEqual(["email", "%ab%"]);
    expect(String(args?.[1]).slice(1, -1)).not.toMatch(/[%_,()"\\]/);
  });

  it("fraza złożona z samych znaków sterujących NIE tworzy filtra", async () => {
    await listSuppressions({ data: { search: '%%,,(("' } });

    // Bez tego `%%` weszłoby do zapytania i „filtrowałoby" całą listę.
    expect(db.lastChain(SUPPRESSIONS)?.has("ilike")).toBe(false);
    // Zapytanie i tak POSZŁO - odrzucamy filtr, nie całe pobranie.
    expect(db.chainsFor(SUPPRESSIONS).length).toBeGreaterThan(0);
  });

  it("pusta fraza nie dokłada filtra", async () => {
    await listSuppressions({ data: { search: "   " } });

    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.has("ilike")).toBe(false);
    expect(chain?.has("order")).toBe(true);
  });
});

describe("listSuppressions - mapowanie wierszy", () => {
  it("przenosi komplet pól wpisu wykluczenia", async () => {
    db.setResponse(
      SUPPRESSIONS,
      ok([
        {
          id: "s-1",
          email: "odbiorca@example.test",
          reason: "complaint",
          scope: "permanent",
          source: "webhook",
          occurrences: 3,
          diagnostic: "550 blocked",
          note: "zgłoszenie spamu",
          campaign_id: "c-1",
          expires_at: null,
          first_seen_at: "2026-08-01T10:00:00.000Z",
          last_seen_at: "2026-08-18T10:00:00.000Z",
          released_at: null,
        },
      ]),
    );

    const rows = await listSuppressions();

    expect(rows[0]).toEqual({
      id: "s-1",
      email: "odbiorca@example.test",
      reason: "complaint",
      scope: "permanent",
      source: "webhook",
      occurrences: 3,
      diagnostic: "550 blocked",
      note: "zgłoszenie spamu",
      campaignId: "c-1",
      expiresAt: null,
      firstSeenAt: "2026-08-01T10:00:00.000Z",
      lastSeenAt: "2026-08-18T10:00:00.000Z",
      releasedAt: null,
    });
    expect(rows).toHaveLength(1);
  });

  it("nieznany powód i zakres schodzą na bezpieczne wartości", async () => {
    db.setResponse(
      SUPPRESSIONS,
      ok([{ id: "s-1", email: "a@example.test", reason: "cokolwiek", scope: "cokolwiek" }]),
    );

    const rows = await listSuppressions();

    expect(rows[0]?.reason).toBe("manual");
    // Nieznany zakres traktujemy jak TRWAŁY - ostrożniej dla odbiorcy.
    expect(rows[0]?.scope).toBe("permanent");
  });

  it("brak źródła znaczy `system`", async () => {
    db.setResponse(SUPPRESSIONS, ok([{ id: "s-1", email: "a@example.test" }]));

    const rows = await listSuppressions();

    expect(rows[0]?.source).toBe("system");
    expect(rows[0]?.occurrences).toBe(0);
  });

  it("błąd zapytania leci w górę", async () => {
    db.setResponse(SUPPRESSIONS, fail("permission denied"));

    // Nie pusta lista - „brak blokad" przy awarii RLS to zaproszenie do wysyłki
    // na adresy, które są zablokowane.
    await expect(listSuppressions()).rejects.toThrow("permission denied");
    await expect(listSuppressions()).rejects.toThrow();
  });
});

describe("addSuppression", () => {
  it("zapisuje adres małymi literami - unikalność jest bez wielkości liter", async () => {
    await addSuppression({ data: { email: "Odbiorca@Example.TEST", reason: "manual" } });

    expect(rpc).toHaveBeenCalledWith("email_suppression_add", {
      p_email: "odbiorca@example.test",
      p_reason: "manual",
      p_note: undefined,
    });
    // Jedno wywołanie - podwójna blokada zawyżałaby licznik wystąpień.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("przekazuje notatkę operatora, gdy jest", async () => {
    await addSuppression({
      data: { email: "a@example.test", reason: "complaint", note: "zgłoszenie z BOK" },
    });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_note: "zgłoszenie z BOK" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("domyślnym powodem jest wpis ręczny", async () => {
    const res = await addSuppression({ data: { email: "a@example.test" } });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_reason: "manual" });
    expect(res).toEqual({ ok: true });
  });

  it("odrzuca adres, który nie jest adresem", async () => {
    await expect(addSuppression({ data: { email: "to nie adres" } })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("odrzuca powód spoza dozwolonego zestawu", async () => {
    await expect(
      addSuppression({ data: { email: "a@example.test", reason: "unsubscribe" } }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("błąd RPC leci w górę - operator ma wiedzieć, że blokada NIE powstała", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "duplicate" } });

    await expect(addSuppression({ data: { email: "a@example.test" } })).rejects.toThrow(
      "duplicate",
    );
    // Wywołanie NASTĄPIŁO - błąd pochodzi z bazy, nie z walidacji wejścia.
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("releaseSuppression", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("zdjęcie blokady NIE przywraca subskrypcji domyślnie", async () => {
    await releaseSuppression({ data: { id } });

    // Zdjęcie blokady i przywrócenie subskrypcji to DWIE decyzje - domyślne
    // przywracanie zapisałoby kogoś, kto się nie zapisał.
    expect(rpc).toHaveBeenCalledWith("email_suppression_release", {
      p_id: id,
      p_resubscribe: false,
    });
    expect(rpc.mock.calls[0]![1].p_resubscribe).not.toBe(true);
  });

  it("przywrócenie subskrypcji jest osobną, jawną decyzją", async () => {
    await releaseSuppression({ data: { id, resubscribe: true } });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_resubscribe: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    await expect(releaseSuppression({ data: { id: "s-1" } })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("błąd RPC leci w górę", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not found" } });

    await expect(releaseSuppression({ data: { id } })).rejects.toThrow("not found");
    // Cicha porażka zostawiłaby operatora w przekonaniu, że blokada zniknęła.
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("getDeliverabilitySetup", () => {
  beforeEach(() => {
    db.setResponse(EVENTS, ok([]));
  });

  it("bez sekretu webhook jest NIESKONFIGUROWANY", async () => {
    const setup = await getDeliverabilitySetup();

    expect(setup.webhookConfigured).toBe(false);
    expect(setup.lastEventAt).toBeNull();
  });

  it("z sekretem webhook jest skonfigurowany", async () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_abc";

    const setup = await getDeliverabilitySetup();

    expect(setup.webhookConfigured).toBe(true);
    expect(setup.webhookUrl).toContain("/api/public/webhooks/resend");
  });

  it("adres webhooka bierze z PUBLIC_SITE_URL, obcinając końcowe ukośniki", async () => {
    process.env.PUBLIC_SITE_URL = "https://example.test///";

    const setup = await getDeliverabilitySetup();

    expect(setup.webhookUrl).toBe("https://example.test/api/public/webhooks/resend");
    expect(setup.webhookUrl).not.toContain("///");
  });

  it("schodzi kolejno na SITE_URL i URL", async () => {
    process.env.SITE_URL = "https://zapas.example.test";
    const fromSite = await getDeliverabilitySetup();
    delete process.env.SITE_URL;
    process.env.URL = "https://ostatni.example.test";
    const fromUrl = await getDeliverabilitySetup();

    expect(fromSite.webhookUrl).toBe("https://zapas.example.test/api/public/webhooks/resend");
    expect(fromUrl.webhookUrl).toBe("https://ostatni.example.test/api/public/webhooks/resend");
  });

  it("TRYB WŁASNY: nie subskrybujemy otwarć ani kliknięć (podwójne zliczanie)", async () => {
    const setup = await getDeliverabilitySetup();

    expect(setup.engagementSource).toBe("first_party");
    expect(setup.events).not.toContain("email.opened");
    expect(setup.events).not.toContain("email.clicked");
    expect(setup.events).toContain("email.bounced");
  });

  it("TRYB DOSTAWCY: bez tych dwóch zdarzeń konfiguracja byłaby martwa", async () => {
    process.env.NEWSLETTER_ENGAGEMENT_SOURCE = "provider";

    const setup = await getDeliverabilitySetup();

    expect(setup.engagementSource).toBe("provider");
    expect(setup.events).toContain("email.opened");
    expect(setup.events).toContain("email.clicked");
  });

  it("zdarzenia dostarczalności są wymagane ZAWSZE, niezależnie od trybu", async () => {
    const firstParty = await getDeliverabilitySetup();
    process.env.NEWSLETTER_ENGAGEMENT_SOURCE = "provider";
    const provider = await getDeliverabilitySetup();

    for (const required of [
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.bounced",
      "email.complained",
      "email.failed",
    ]) {
      expect(firstParty.events, required).toContain(required);
      expect(provider.events, required).toContain(required);
    }
  });

  it("pokazuje czas ostatniego zdarzenia jako dowód, że pętla działa", async () => {
    db.setResponse(EVENTS, ok([{ occurred_at: "2026-08-18T10:00:00.000Z" }]));

    const setup = await getDeliverabilitySetup();

    expect(setup.lastEventAt).toBe("2026-08-18T10:00:00.000Z");
    const chain = db.lastChain(EVENTS);
    expect(chain?.argsOf("order")).toEqual(["occurred_at", { ascending: false }]);
  });
});
