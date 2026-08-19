// Raport wysyłek maili systemowych - warstwa danych.
//
// Najważniejsza reguła tego pliku to DEDUPLIKACJA. Jeden e-mail zostawia w
// `email_send_log` wiele wierszy (pending -> sent/dlq), więc każde zliczenie
// musi najpierw sprowadzić je do jednego, najnowszego stanu. Bez tego raport
// pokazuje wielokrotność faktycznej wysyłki, a wskaźnik dostarczalności liczy
// tę samą wiadomość kilka razy - czyli dokładnie ta klasa błędu, przez którą
// operator uznaje kampanię za dowiezioną, choć nie była.
//
// Druga reguła: liczba prób (`attempts`) MA zliczać wszystkie wiersze, bo to
// ona mówi, ile razy kolejka biła się o tę wiadomość.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, okCount, supabaseFromStub } from "@/test/supabaseChain";
import type { SystemEmailQuery } from "@/lib/email/system-log.server";

const db = supabaseFromStub();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

import { fetchSystemEmailReport } from "@/lib/email/system-log.server";

const LOG = "email_send_log";
const SUPPRESSIONS = "email_suppressions";

function query(overrides: Partial<SystemEmailQuery> = {}): SystemEmailQuery {
  return {
    days: 7,
    template: null,
    status: null,
    search: null,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: "msg-1",
    template_name: "password_reset",
    recipient_email: "odbiorca@example.test",
    status: "sent",
    error_message: null,
    created_at: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  db.reset();
  db.setResponse(SUPPRESSIONS, okCount(0));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-18T15:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deduplikacja po identyfikatorze wiadomości", () => {
  it("wiele wierszy jednej wiadomości to JEDEN wpis w raporcie", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ status: "sent", created_at: "2026-08-18T09:05:00.000Z" }),
        logRow({ status: "pending", created_at: "2026-08-18T09:00:00.000Z" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.rows).toHaveLength(1);
    expect(report.totals.total).toBe(1);
  });

  it("wygrywa stan NAJNOWSZY (wejście posortowane malejąco)", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ status: "dlq", created_at: "2026-08-18T09:05:00.000Z" }),
        logRow({ status: "pending", created_at: "2026-08-18T09:00:00.000Z" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.status).toBe("dlq");
    expect(report.totals.failed).toBe(1);
    expect(report.totals.pending).toBe(0);
  });

  it("licznik prób zlicza WSZYSTKIE wiersze wiadomości", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ status: "sent" }),
        logRow({ status: "pending" }),
        logRow({ status: "pending" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.attempts).toBe(3);
    expect(report.rows).toHaveLength(1);
  });

  it("różne wiadomości nie zlewają się w jedną", async () => {
    db.setResponse(LOG, ok([logRow({ message_id: "a" }), logRow({ message_id: "b" })]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows.map((r) => r.messageId)).toEqual(["a", "b"]);
    expect(report.rows.every((r) => r.attempts === 1)).toBe(true);
  });

  it("gdy brak message_id, kluczem jest `id` wiersza", async () => {
    db.setResponse(LOG, ok([{ ...logRow({ message_id: undefined }), id: "row-7" }]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.messageId).toBe("row-7");
    expect(report.totals.total).toBe(1);
  });

  it("wiersz bez jakiegokolwiek identyfikatora jest pomijany", async () => {
    db.setResponse(LOG, ok([logRow({ message_id: undefined }), logRow({ message_id: "ok-1" })]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.messageId).toBe("ok-1");
  });

  it("wpisy nie-obiektowe i odpowiedź nie-tablicowa nie wywracają raportu", async () => {
    db.setResponse(LOG, ok([logRow(), null, "śmieć"]));
    const withJunk = await fetchSystemEmailReport(query());
    db.setResponse(LOG, ok({ nie: "tablica" }));
    const notArray = await fetchSystemEmailReport(query());

    expect(withJunk.rows).toHaveLength(1);
    expect(notArray.rows).toEqual([]);
    expect(notArray.infraReady).toBe(true);
  });
});

describe("mapowanie i sumy", () => {
  it("brak nazwy szablonu nazywa się `unknown`, nie pustką", async () => {
    db.setResponse(LOG, ok([logRow({ template_name: undefined })]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.templateName).toBe("unknown");
    expect(report.templates).toEqual(["unknown"]);
  });

  it("status spoza słownika schodzi na `pending`", async () => {
    db.setResponse(LOG, ok([logRow({ status: "zagadka" })]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.status).toBe("pending");
    expect(report.totals.pending).toBe(1);
  });

  it("wszystkie statusy porażki wpadają do jednego wiadra `failed`", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", status: "dlq" }),
        logRow({ message_id: "b", status: "failed" }),
        logRow({ message_id: "c", status: "bounced" }),
        logRow({ message_id: "d", status: "complained" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.totals.failed).toBe(4);
    expect(report.totals.total).toBe(4);
  });

  it("wykluczone i oczekujące mają własne wiadra", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", status: "suppressed" }),
        logRow({ message_id: "b", status: "pending" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.totals.suppressed).toBe(1);
    expect(report.totals.pending).toBe(1);
    expect(report.totals.sent).toBe(0);
  });

  it("pusty komunikat błędu to brak błędu", async () => {
    db.setResponse(LOG, ok([logRow({ error_message: "" })]));

    const report = await fetchSystemEmailReport(query());

    expect(report.rows[0]?.errorMessage).toBeNull();
    expect(report.rows[0]?.status).toBe("sent");
  });

  it("lista szablonów jest odchudzona z powtórzeń i posortowana", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", template_name: "welcome" }),
        logRow({ message_id: "b", template_name: "password_reset" }),
        logRow({ message_id: "c", template_name: "welcome" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.templates).toEqual(["password_reset", "welcome"]);
    expect(report.totals.total).toBe(3);
  });
});

describe("wskaźnik dostarczalności", () => {
  it("liczy się z ROZSTRZYGNIĘTYCH: wysłane / (wysłane + nieudane)", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", status: "sent" }),
        logRow({ message_id: "b", status: "sent" }),
        logRow({ message_id: "c", status: "sent" }),
        logRow({ message_id: "d", status: "dlq" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.deliveryRate).toBe(0.75);
    expect(report.totals.sent).toBe(3);
  });

  it("oczekujące i wykluczone NIE psują mianownika", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", status: "sent" }),
        logRow({ message_id: "b", status: "pending" }),
        logRow({ message_id: "c", status: "suppressed" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query());

    expect(report.deliveryRate).toBe(1);
    expect(report.totals.total).toBe(3);
  });

  it("bez rozstrzygnięć wskaźnik jest NIEZNANY, a nie zerowy", async () => {
    db.setResponse(LOG, ok([logRow({ status: "pending" })]));

    const report = await fetchSystemEmailReport(query());

    // 0% sugerowałoby katastrofę; null mówi „jeszcze nie wiadomo".
    expect(report.deliveryRate).toBeNull();
    expect(report.totals.pending).toBe(1);
  });
});

describe("szereg dzienny", () => {
  it("ma dokładnie tyle kubełków, ile dni okna, i kończy się dziś", async () => {
    db.setResponse(LOG, ok([]));

    const report = await fetchSystemEmailReport(query({ days: 7 }));

    expect(report.series).toHaveLength(7);
    expect(report.series[0]?.day).toBe("2026-08-12");
    expect(report.series[6]?.day).toBe("2026-08-18");
  });

  it("wrzuca wiadomość do kubełka jej doby i do właściwej kolumny", async () => {
    db.setResponse(
      LOG,
      ok([
        logRow({ message_id: "a", status: "sent", created_at: "2026-08-18T09:00:00.000Z" }),
        logRow({ message_id: "b", status: "dlq", created_at: "2026-08-17T23:59:00.000Z" }),
        logRow({ message_id: "c", status: "suppressed", created_at: "2026-08-17T08:00:00.000Z" }),
      ]),
    );

    const report = await fetchSystemEmailReport(query({ days: 7 }));
    const byDay = Object.fromEntries(report.series.map((p) => [p.day, p]));

    expect(byDay["2026-08-18"]).toMatchObject({ sent: 1, failed: 0 });
    expect(byDay["2026-08-17"]).toMatchObject({ failed: 1, suppressed: 1 });
  });

  it("wiadomość spoza okna nie trafia do żadnego kubełka", async () => {
    db.setResponse(LOG, ok([logRow({ created_at: "2026-01-01T09:00:00.000Z" })]));

    const report = await fetchSystemEmailReport(query({ days: 7 }));

    expect(report.series.every((p) => p.sent === 0)).toBe(true);
    // ...ale nadal liczy się w sumach okna zapytania.
    expect(report.totals.sent).toBe(1);
  });
});

describe("filtry i stronicowanie", () => {
  const rows = [
    logRow({
      message_id: "a",
      template_name: "welcome",
      status: "sent",
      recipient_email: "anna@example.test",
    }),
    logRow({
      message_id: "b",
      template_name: "password_reset",
      status: "dlq",
      recipient_email: "borys@example.test",
    }),
    logRow({
      message_id: "c",
      template_name: "welcome",
      status: "bounced",
      recipient_email: "cezary@example.test",
    }),
  ];

  it("filtruje po szablonie", async () => {
    db.setResponse(LOG, ok(rows));

    const report = await fetchSystemEmailReport(query({ template: "welcome" }));

    expect(report.rows.map((r) => r.messageId)).toEqual(["a", "c"]);
    expect(report.rowsTotal).toBe(2);
  });

  it("filtr `dlq` znaczy KAŻDĄ porażkę, nie tylko dosłowny status", async () => {
    db.setResponse(LOG, ok(rows));

    const report = await fetchSystemEmailReport(query({ status: "dlq" }));

    expect(report.rows.map((r) => r.messageId)).toEqual(["b", "c"]);
    expect(report.rowsTotal).toBe(2);
  });

  it("pozostałe statusy filtrują dosłownie", async () => {
    db.setResponse(LOG, ok(rows));

    const report = await fetchSystemEmailReport(query({ status: "sent" }));

    expect(report.rows.map((r) => r.messageId)).toEqual(["a"]);
    expect(report.rowsTotal).toBe(1);
  });

  it("szukanie działa po adresie odbiorcy, bez wielkości liter", async () => {
    db.setResponse(LOG, ok(rows));

    const report = await fetchSystemEmailReport(query({ search: "  BORYS  " }));

    expect(report.rows.map((r) => r.messageId)).toEqual(["b"]);
    expect(report.rowsTotal).toBe(1);
  });

  it("sumy NIE idą za filtrem - opisują całe okno", async () => {
    db.setResponse(LOG, ok(rows));

    const report = await fetchSystemEmailReport(query({ template: "welcome" }));

    expect(report.totals.total).toBe(3);
    expect(report.rows).toHaveLength(2);
  });

  it("stronicowanie tnie wynik, zachowując pełny licznik", async () => {
    db.setResponse(LOG, ok(rows));

    const page2 = await fetchSystemEmailReport(query({ page: 2, pageSize: 2 }));

    expect(page2.rows.map((r) => r.messageId)).toEqual(["c"]);
    expect(page2.rowsTotal).toBe(3);
  });
});

describe("licznik aktywnych wykluczeń", () => {
  it("pyta wyłącznie o wykluczenia NIEZDJĘTE i NIEWYGASŁE", async () => {
    db.setResponse(LOG, ok([]));
    db.setResponse(SUPPRESSIONS, okCount(12));

    const report = await fetchSystemEmailReport(query());

    expect(report.suppressedRecipients).toBe(12);
    const chain = db.lastChain(SUPPRESSIONS);
    expect(chain?.argsOf("is")).toEqual(["released_at", null]);
    expect(String(chain?.argsOf("or")?.[0])).toContain("expires_at.is.null");
  });

  it("zapytanie jest LICZĄCE - nie ściąga wierszy", async () => {
    db.setResponse(LOG, ok([]));
    db.setResponse(SUPPRESSIONS, okCount(3));

    await fetchSystemEmailReport(query());

    expect(db.lastChain(SUPPRESSIONS)?.argsOf("select")).toEqual([
      "id",
      { count: "exact", head: true },
    ]);
    expect(db.chainsFor(SUPPRESSIONS)).toHaveLength(1);
  });

  it("brak licznika daje zero, a nie wysypkę raportu", async () => {
    db.setResponse(LOG, ok([logRow()]));
    db.setResponse(SUPPRESSIONS, fail("brak dostępu"));

    const report = await fetchSystemEmailReport(query());

    expect(report.suppressedRecipients).toBe(0);
    expect(report.totals.total).toBe(1);
  });
});

describe("stan infrastruktury", () => {
  it("pyta o okno od północy UTC i ogranicza wynik", async () => {
    db.setResponse(LOG, ok([]));

    await fetchSystemEmailReport(query({ days: 7 }));

    const chain = db.lastChain(LOG);
    expect(chain?.argsOf("gte")).toEqual(["created_at", "2026-08-12T00:00:00.000Z"]);
    expect(chain?.argsOf("limit")).toEqual([5000]);
  });

  it("brak tabeli to stan „infrastruktura niegotowa”, nie błąd", async () => {
    db.setResponse(LOG, fail('relation "email_send_log" does not exist', "42P01"));

    const report = await fetchSystemEmailReport(query({ days: 30 }));

    expect(report.infraReady).toBe(false);
    expect(report.days).toBe(30);
    expect(report.deliveryRate).toBeNull();
    expect(report.rows).toEqual([]);
  });

  it("nieodświeżony cache schematu również", async () => {
    db.setResponse(LOG, fail("Could not find table in the schema cache"));

    const report = await fetchSystemEmailReport(query());

    expect(report.infraReady).toBe(false);
    expect(report.templates).toEqual([]);
  });

  it("każdy inny błąd leci w górę", async () => {
    db.setResponse(LOG, fail("permission denied for table email_send_log", "42501"));

    await expect(fetchSystemEmailReport(query())).rejects.toThrow(/permission denied/);
    expect(db.chainsFor(SUPPRESSIONS)).toHaveLength(0);
  });
});
