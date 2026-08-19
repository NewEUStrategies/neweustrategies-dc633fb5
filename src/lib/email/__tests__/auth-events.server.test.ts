// Diagnostyka webhooka maili autoryzacyjnych - warstwa danych.
//
// To jest jedyne miejsce, w którym widać, czy maile logowania w ogóle
// wychodzą i w JAKIM języku. Trzy rzeczy muszą tu być prawdziwe, bo panel
// czyta je bez żadnej dodatkowej weryfikacji:
//   1. sumy liczone są po CAŁYM oknie, a nie po przefiltrowanej stronie -
//      inaczej filtr „tylko błędy" pokazywałby 100% błędów,
//   2. brak tabeli (świeże środowisko) to nie awaria, tylko `infraReady:false` -
//      panel ma powiedzieć „nie ma jeszcze danych", a nie wysypać się błędem,
//   3. każdy inny błąd MUSI polecieć w górę - cicha pustka udawałaby, że
//      maile autoryzacyjne wychodzą, gdy w rzeczywistości nie wiadomo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import type { AuthEmailEventsQuery } from "@/lib/email/auth-events.server";

const db = supabaseFromStub();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

import { fetchAuthEmailEvents } from "@/lib/email/auth-events.server";

const TABLE = "auth_email_events";

function query(overrides: Partial<AuthEmailEventsQuery> = {}): AuthEmailEventsQuery {
  return {
    days: 7,
    emailType: null,
    lang: null,
    status: null,
    fallbackOnly: false,
    search: null,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

/** Wiersz w kształcie tabeli (snake_case), z sensownymi domyślnymi. */
function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    created_at: "2026-08-18T09:00:00.000Z",
    run_id: "run-1",
    message_id: "msg-1",
    email_type: "magic_link",
    lang: "pl",
    lang_source: "profile",
    lang_fallback: false,
    lang_raw: "pl-PL",
    recipient_masked: "o***a@example.test",
    recipient_domain: "example.test",
    sender: "no-reply@example.test",
    sender_domain: "example.test",
    subject: "Twój link do logowania",
    redirect_to: "https://example.test/konto",
    action_url_host: "example.test",
    greeting_name: "Anna",
    status: "enqueued",
    error_message: null,
    duration_ms: 120,
    ...overrides,
  };
}

beforeEach(() => {
  db.reset();
});

describe("odczyt okna czasowego", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pyta o zdarzenia od północy UTC sprzed (days-1) dni", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T15:30:00.000Z"));
    db.setResponse(TABLE, ok([]));

    await fetchAuthEmailEvents(query({ days: 7 }));

    const chain = db.lastChain(TABLE);
    expect(chain?.argsOf("gte")).toEqual(["created_at", "2026-08-12T00:00:00.000Z"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("okno jednodniowe to dzisiejsza północ, nie „teraz minus doba”", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T15:30:00.000Z"));
    db.setResponse(TABLE, ok([]));

    await fetchAuthEmailEvents(query({ days: 1 }));

    expect(db.lastChain(TABLE)?.argsOf("gte")).toEqual(["created_at", "2026-08-18T00:00:00.000Z"]);
    expect(db.lastChain(TABLE)?.argsOf("limit")).toEqual([3000]);
  });
});

describe("mapowanie wiersza", () => {
  it("przenosi komplet pól diagnostycznych", async () => {
    db.setResponse(TABLE, ok([eventRow()]));

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows[0]).toMatchObject({
      id: "evt-1",
      runId: "run-1",
      messageId: "msg-1",
      emailType: "magic_link",
      lang: "pl",
      langSource: "profile",
      langFallback: false,
      recipientMasked: "o***a@example.test",
      actionUrlHost: "example.test",
      status: "enqueued",
      durationMs: 120,
    });
    expect(report.rows).toHaveLength(1);
  });

  it("puste teksty traktuje jak brak wartości, nie jak pusty string", async () => {
    db.setResponse(TABLE, ok([eventRow({ run_id: "", subject: "", lang: "" })]));

    const row = (await fetchAuthEmailEvents(query())).rows[0];

    expect(row?.runId).toBeNull();
    expect(row?.subject).toBeNull();
    expect(row?.lang).toBeNull();
  });

  it("brak identyfikatora nie gubi wiersza - dostaje zastępczy", async () => {
    db.setResponse(TABLE, ok([eventRow({ id: null })]));

    const row = (await fetchAuthEmailEvents(query())).rows[0];

    expect(row?.id).toBeTruthy();
    expect(typeof row?.id).toBe("string");
  });

  it("nieznany typ maila nazywa się `unknown`, a nie znika", async () => {
    db.setResponse(TABLE, ok([eventRow({ email_type: null })]));

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows[0]?.emailType).toBe("unknown");
    expect(report.byType).toEqual([{ type: "unknown", count: 1 }]);
  });

  it("status spoza słownika schodzi na `enqueued`", async () => {
    db.setResponse(TABLE, ok([eventRow({ status: "dziwny" })]));

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows[0]?.status).toBe("enqueued");
    expect(report.totals.enqueued).toBe(1);
  });

  it("statusy `rejected` i `failed` są zachowane", async () => {
    db.setResponse(
      TABLE,
      ok([eventRow({ id: "a", status: "rejected" }), eventRow({ id: "b", status: "failed" })]),
    );

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows.map((r) => r.status)).toEqual(["rejected", "failed"]);
    expect(report.totals.failed).toBe(2);
  });

  it("czas trwania spoza typu liczbowego to brak pomiaru", async () => {
    db.setResponse(TABLE, ok([eventRow({ duration_ms: "120" })]));

    const row = (await fetchAuthEmailEvents(query())).rows[0];

    expect(row?.durationMs).toBeNull();
    expect(row?.id).toBe("evt-1");
  });

  it("fallback języka liczy się TYLKO przy jawnym `true`", async () => {
    db.setResponse(
      TABLE,
      ok([eventRow({ id: "a", lang_fallback: true }), eventRow({ id: "b", lang_fallback: "yes" })]),
    );

    const report = await fetchAuthEmailEvents(query());

    expect(report.totals.fallback).toBe(1);
    expect(report.rows[1]?.langFallback).toBe(false);
  });

  it("wpisy, które nie są obiektami, są odrzucane", async () => {
    db.setResponse(TABLE, ok([eventRow(), "śmieć", null, 42]));

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows).toHaveLength(1);
    expect(report.totals.total).toBe(1);
  });

  it("odpowiedź, która nie jest tablicą, daje pusty raport z działającą infrastrukturą", async () => {
    db.setResponse(TABLE, ok({ nie: "tablica" }));

    const report = await fetchAuthEmailEvents(query());

    expect(report.rows).toEqual([]);
    expect(report.infraReady).toBe(true);
  });
});

describe("sumy okna", () => {
  it("liczy języki, fallbacki i podział zakolejkowane/nieudane", async () => {
    db.setResponse(
      TABLE,
      ok([
        eventRow({ id: "a", lang: "pl", status: "enqueued" }),
        eventRow({ id: "b", lang: "en", status: "failed" }),
        eventRow({ id: "c", lang: "en", status: "enqueued", lang_fallback: true }),
      ]),
    );

    const report = await fetchAuthEmailEvents(query());

    expect(report.totals).toEqual({
      total: 3,
      enqueued: 2,
      failed: 1,
      pl: 1,
      en: 2,
      fallback: 1,
    });
    expect(report.days).toBe(7);
  });

  it("sumy liczą się po CAŁYM oknie, mimo zawężenia filtrem", async () => {
    db.setResponse(
      TABLE,
      ok([
        eventRow({ id: "a", email_type: "magic_link" }),
        eventRow({ id: "b", email_type: "recovery" }),
      ]),
    );

    const report = await fetchAuthEmailEvents(query({ emailType: "recovery" }));

    // Filtr zawęża WIERSZE, nie sumy - inaczej panel kłamałby o skali.
    expect(report.totals.total).toBe(2);
    expect(report.rows).toHaveLength(1);
    expect(report.rowsTotal).toBe(1);
  });

  it("rozkład źródeł języka sortuje malejąco i nazywa brak `unknown`", async () => {
    db.setResponse(
      TABLE,
      ok([
        eventRow({ id: "a", lang_source: "profile" }),
        eventRow({ id: "b", lang_source: "profile" }),
        eventRow({ id: "c", lang_source: null }),
      ]),
    );

    const report = await fetchAuthEmailEvents(query());

    expect(report.bySource).toEqual([
      { source: "profile", count: 2 },
      { source: "unknown", count: 1 },
    ]);
    expect(report.byType[0]?.count).toBe(3);
  });
});

describe("filtry i stronicowanie", () => {
  const rows = [
    eventRow({ id: "a", email_type: "magic_link", lang: "pl", status: "enqueued" }),
    eventRow({ id: "b", email_type: "recovery", lang: "en", status: "failed" }),
    eventRow({
      id: "c",
      email_type: "recovery",
      lang: "pl",
      status: "enqueued",
      lang_fallback: true,
    }),
  ];

  it("filtruje po typie maila", async () => {
    db.setResponse(TABLE, ok(rows));

    const report = await fetchAuthEmailEvents(query({ emailType: "recovery" }));

    expect(report.rows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(report.rowsTotal).toBe(2);
  });

  it("filtruje po języku", async () => {
    db.setResponse(TABLE, ok(rows));

    const report = await fetchAuthEmailEvents(query({ lang: "en" }));

    expect(report.rows.map((r) => r.id)).toEqual(["b"]);
    expect(report.rowsTotal).toBe(1);
  });

  it("filtruje po statusie", async () => {
    db.setResponse(TABLE, ok(rows));

    const report = await fetchAuthEmailEvents(query({ status: "failed" }));

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.id).toBe("b");
  });

  it("pokazuje wyłącznie zdarzenia z awaryjnym językiem", async () => {
    db.setResponse(TABLE, ok(rows));

    const report = await fetchAuthEmailEvents(query({ fallbackOnly: true }));

    expect(report.rows.map((r) => r.id)).toEqual(["c"]);
    expect(report.totals.fallback).toBe(1);
  });

  it("szuka po adresie, domenie, temacie, przekierowaniu i identyfikatorach", async () => {
    db.setResponse(
      TABLE,
      ok([
        eventRow({ id: "a", recipient_masked: "a***a@example.test" }),
        eventRow({ id: "b", subject: "Reset hasła" }),
        eventRow({ id: "c", run_id: "run-XYZ" }),
        eventRow({ id: "d", redirect_to: "https://example.test/panel" }),
      ]),
    );

    const bySubject = await fetchAuthEmailEvents(query({ search: "reset" }));
    const byRun = await fetchAuthEmailEvents(query({ search: "xyz" }));
    const byRedirect = await fetchAuthEmailEvents(query({ search: "/panel" }));

    expect(bySubject.rows.map((r) => r.id)).toEqual(["b"]);
    expect(byRun.rows.map((r) => r.id)).toEqual(["c"]);
    expect(byRedirect.rows.map((r) => r.id)).toEqual(["d"]);
  });

  it("szukanie jest niewrażliwe na wielkość liter", async () => {
    db.setResponse(TABLE, ok([eventRow({ subject: "Twój Link Do Logowania" })]));

    const report = await fetchAuthEmailEvents(query({ search: "LINK DO" }));

    expect(report.rows).toHaveLength(1);
    expect(report.rowsTotal).toBe(1);
  });

  it("filtry składają się ze sobą", async () => {
    db.setResponse(TABLE, ok(rows));

    const report = await fetchAuthEmailEvents(query({ emailType: "recovery", lang: "pl" }));

    expect(report.rows.map((r) => r.id)).toEqual(["c"]);
    expect(report.totals.total).toBe(3);
  });

  it("druga strona zwraca dalsze wiersze, a licznik zostaje pełny", async () => {
    db.setResponse(TABLE, ok(rows));

    const page2 = await fetchAuthEmailEvents(query({ page: 2, pageSize: 2 }));

    expect(page2.rows.map((r) => r.id)).toEqual(["c"]);
    expect(page2.rowsTotal).toBe(3);
  });

  it("strona poza zakresem jest pusta, ale nie kłamie o liczbie wyników", async () => {
    db.setResponse(TABLE, ok(rows));

    const page9 = await fetchAuthEmailEvents(query({ page: 9, pageSize: 2 }));

    expect(page9.rows).toEqual([]);
    expect(page9.rowsTotal).toBe(3);
  });
});

describe("stan infrastruktury", () => {
  it("brak tabeli to „jeszcze nie ma danych”, nie awaria", async () => {
    db.setResponse(TABLE, fail('relation "auth_email_events" does not exist', "42P01"));

    const report = await fetchAuthEmailEvents(query({ days: 14 }));

    expect(report.infraReady).toBe(false);
    expect(report.rows).toEqual([]);
    expect(report.totals.total).toBe(0);
    expect(report.days).toBe(14);
  });

  it("nieodświeżony cache schematu też jest stanem przejściowym", async () => {
    db.setResponse(TABLE, fail("Could not find the table in the schema cache"));

    const report = await fetchAuthEmailEvents(query());

    expect(report.infraReady).toBe(false);
    expect(report.bySource).toEqual([]);
  });

  it("KAŻDY inny błąd leci w górę - cisza udawałaby, że maile wychodzą", async () => {
    db.setResponse(TABLE, fail("permission denied for table auth_email_events", "42501"));

    await expect(fetchAuthEmailEvents(query())).rejects.toThrow(/permission denied/);
    expect(db.chainsFor(TABLE)).toHaveLength(1);
  });
});
