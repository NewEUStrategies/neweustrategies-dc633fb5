// Bramka reputacji: ostatnia rzecz, która stoi między kampanią a filtrami
// dostawców.
//
// Lista wykluczeń broni pojedynczych adresów - ta bramka broni CAŁEJ domeny.
// Dlatego testy pilnują trzech rzeczy, których złamanie widać dopiero po
// fakcie, gdy poczta transakcyjna z tej samej domeny zaczyna lądować w spamie:
//   1. przy przekroczeniu twardego progu skarg wysyłka JEST zatrzymana,
//   2. świadome potwierdzenie operatora przepuszcza wysyłkę, ale NIE kasuje
//      werdyktu (wywołujący ma go zalogować i pokazać ostrzeżenie),
//   3. awaria telemetrii jest fail-open - zepsuty licznik nie może uciszyć
//      redakcji.
//
// Reguł progowych (`computeReputation`) tu nie powtarzamy - mają własny test
// w reputation.test.ts. Tutaj sprawdzamy WARSTWĘ, która je stosuje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { EMPTY_COUNTS } from "@/lib/email/reputation";
import {
  evaluateSendGate,
  fetchDeliverabilityCounts,
  REPUTATION_WINDOW_DAYS,
} from "@/lib/email/reputationGate.server";

type RpcResult = { data: unknown; error: { message: string } | null };

/** Atrapa klienta admina: wyłącznie `rpc`, bo tylko tego używa ten moduł. */
function adminStub(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

/** Wiersz licznika w kształcie, w jakim oddaje go RPC (snake_case). */
function countsRow(overrides: Record<string, number> = {}) {
  return {
    sent: 1000,
    delivered: 1000,
    bounced: 0,
    hard_bounced: 0,
    soft_bounced: 0,
    complained: 0,
    failed: 0,
    delayed: 0,
    suppressed_sends: 0,
    active_suppressions: 0,
    ...overrides,
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("fetchDeliverabilityCounts", () => {
  it("mapuje snake_case RPC na kształt liczników i pyta o właściwy tenant", async () => {
    const { client, rpc } = adminStub({
      data: countsRow({ complained: 7, bounced: 12 }),
      error: null,
    });

    const counts = await fetchDeliverabilityCounts(client, "tenant-1");

    expect(counts.complained).toBe(7);
    expect(counts.bounced).toBe(12);
    expect(counts.delivered).toBe(1000);
    expect(rpc).toHaveBeenCalledWith("email_deliverability_counts", {
      p_tenant: "tenant-1",
      p_days: REPUTATION_WINDOW_DAYS,
    });
  });

  it("przenosi WSZYSTKIE dziesięć pól - nie tylko te w nagłówku panelu", async () => {
    const { client } = adminStub({
      data: countsRow({
        sent: 10,
        delivered: 9,
        bounced: 1,
        hard_bounced: 2,
        soft_bounced: 3,
        complained: 4,
        failed: 5,
        delayed: 6,
        suppressed_sends: 7,
        active_suppressions: 8,
      }),
      error: null,
    });

    const counts = await fetchDeliverabilityCounts(client, "tenant-1");

    expect(counts).toEqual({
      sent: 10,
      delivered: 9,
      bounced: 1,
      hardBounced: 2,
      softBounced: 3,
      complained: 4,
      failed: 5,
      delayed: 6,
      suppressedSends: 7,
      activeSuppressions: 8,
    });
    expect(Object.keys(counts)).toHaveLength(10);
  });

  it("pozwala zawęzić okno oceny", async () => {
    const { client, rpc } = adminStub({ data: countsRow(), error: null });

    await fetchDeliverabilityCounts(client, "tenant-1", 7);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_days: 7 });
    expect(REPUTATION_WINDOW_DAYS).toBe(30);
  });

  it("wartości nieliczbowe schodzą do zera zamiast zatruwać wskaźnik NaN-em", async () => {
    const { client } = adminStub({
      data: { sent: "1000", delivered: null, complained: Number.NaN, bounced: undefined },
      error: null,
    });

    const counts = await fetchDeliverabilityCounts(client, "tenant-1");

    expect(counts.sent).toBe(0);
    expect(counts.delivered).toBe(0);
    expect(counts.complained).toBe(0);
    expect(counts.bounced).toBe(0);
  });

  it("błąd RPC daje puste liczniki i ZOSTAJE zalogowany", async () => {
    const { client } = adminStub({ data: null, error: { message: "permission denied" } });

    const counts = await fetchDeliverabilityCounts(client, "tenant-1");

    expect(counts).toEqual(EMPTY_COUNTS);
    expect(errorSpy).toHaveBeenCalledWith("[reputation] counts failed", "permission denied");
  });

  it("odpowiedź nie-obiektowa daje puste liczniki BEZ wpisu w logu błędów", async () => {
    const { client } = adminStub({ data: null, error: null });

    const counts = await fetchDeliverabilityCounts(client, "tenant-1");

    expect(counts).toEqual(EMPTY_COUNTS);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("evaluateSendGate", () => {
  it("zdrowa domena wysyła bez przeszkód", async () => {
    const { client } = adminStub({ data: countsRow(), error: null });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.allowed).toBe(true);
    expect(verdict.errorCode).toBeNull();
    expect(verdict.summary.blocksSending).toBe(false);
  });

  it("przekroczony twardy próg skarg ZATRZYMUJE wysyłkę i nazywa powód", async () => {
    // 3 skargi na 1000 dostarczonych = 0,30% - dokładnie limit Google.
    const { client } = adminStub({ data: countsRow({ complained: 3 }), error: null });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe("reputation_blocked:complaint_rate");
    expect(verdict.summary.blockReasons).toEqual(["complaint_rate"]);
  });

  it("krytyczne twarde odbicia blokują niezależnie od skarg", async () => {
    const { client } = adminStub({
      data: countsRow({ sent: 1000, delivered: 1000, hard_bounced: 50 }),
      error: null,
    });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.allowed).toBe(false);
    expect(verdict.errorCode).toBe("reputation_blocked:hard_bounce_rate");
    expect(verdict.counts.hardBounced).toBe(50);
  });

  it("dwa powody naraz trafiają do kodu błędu w komplecie", async () => {
    const { client } = adminStub({
      data: countsRow({ complained: 3, hard_bounced: 50 }),
      error: null,
    });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.errorCode).toBe("reputation_blocked:complaint_rate,hard_bounce_rate");
    expect(verdict.summary.blockReasons).toHaveLength(2);
  });

  it("świadome potwierdzenie przepuszcza wysyłkę, ale NIE kasuje werdyktu", async () => {
    const { client } = adminStub({ data: countsRow({ complained: 3 }), error: null });

    const verdict = await evaluateSendGate(client, "tenant-1", true);

    expect(verdict.allowed).toBe(true);
    expect(verdict.errorCode).toBeNull();
    // Sedno: operator ma zobaczyć ostrzeżenie, a log ma zapamiętać ryzyko.
    expect(verdict.summary.blocksSending).toBe(true);
    expect(verdict.summary.blockReasons).toEqual(["complaint_rate"]);
  });

  it("mała próbka nie blokuje, choćby wskaźnik był brzydki", async () => {
    // 2 skargi na 100 dostarczonych to 2%, ale 100 < progu bramki (500).
    const { client } = adminStub({
      data: countsRow({ sent: 100, delivered: 100, complained: 2 }),
      error: null,
    });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.allowed).toBe(true);
    expect(verdict.summary.blockReasons).toEqual([]);
  });

  it("awaria telemetrii jest FAIL-OPEN - zepsuty licznik nie ucisza redakcji", async () => {
    const { client } = adminStub({ data: null, error: { message: "rpc down" } });

    const verdict = await evaluateSendGate(client, "tenant-1");

    expect(verdict.allowed).toBe(true);
    expect(verdict.counts).toEqual(EMPTY_COUNTS);
    expect(verdict.summary.overall).toBe("insufficient_data");
  });
});
