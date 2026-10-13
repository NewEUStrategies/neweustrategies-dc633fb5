// SMS jest kanałem pomocniczym - te testy pilnują trzech rzeczy, które decydują
// o tym, czy wiadomość dotrze i ILE RAZY: normalizacji numeru, długości treści
// i dziennika idempotencji (`sms_send_log`, REG-11).
//
// DZIENNIK JEST ATRAPĄ Z SEMANTYKĄ SQL. `sms_send_claim`/`sms_send_finish`
// odtwarzają reguły migracji 20261012110000 (claimed/sent/in_flight/exhausted,
// nowy claim_id przy każdym przejęciu, „wysłane" tylko po finish 'sent') -
// atrapa „zawsze claimed" przepuszczałaby każdą powtórkę i test idempotencji
// byłby zielony niezależnie od kodu. Regułę SQL przypina
// `supabase/tests/sms_send_log_test.sql`.
//
// RODO: numery zmyślone, dostawca nigdy nie jest wybierany (`fetch` jest atrapą).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { normalizePhone, sendSms, trimSmsBody } from "@/lib/notify/sms.server";

/** Wpis dziennika w kształcie, jaki trzyma tabela `sms_send_log`. */
interface LogRow {
  status: "pending" | "sent" | "failed";
  attempts: number;
  claimId: string;
  detail: string | null;
}

/**
 * Atrapa klienta service_role z dziennikiem SMS w pamięci. `breakRpc` symuluje
 * awarię RPC (`error`) albo rzut klienta - dwie różne gałęzie fail-open.
 */
const log = vi.hoisted(() => {
  const rows = new Map<string, LogRow>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const failures = new Map<string, "error" | "throw">();
  let seq = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const mode = failures.get(name);
    if (mode === "throw") throw new Error(`test: klient padł na ${name}`);
    if (mode === "error") return { data: null, error: { code: "XX000", message: "boom" } };
    if (name === "sms_send_claim") {
      const key = `${String(args["p_tenant_id"])}|${String(args["p_idempotency_key"])}`;
      const row = rows.get(key);
      seq += 1;
      const claimId = `claim-${seq}`;
      if (row === undefined) {
        rows.set(key, { status: "pending", attempts: 1, claimId, detail: null });
        return { data: { claim_id: claimId, state: "claimed" }, error: null };
      }
      if (row.status === "failed" && row.attempts < 5) {
        Object.assign(row, {
          status: "pending",
          attempts: row.attempts + 1,
          claimId,
          detail: null,
        });
        return { data: { claim_id: claimId, state: "claimed" }, error: null };
      }
      const state =
        row.status === "sent" ? "sent" : row.status === "pending" ? "in_flight" : "exhausted";
      return { data: { claim_id: null, state }, error: null };
    }
    if (name === "sms_send_finish") {
      for (const row of rows.values()) {
        if (row.claimId === args["p_claim_id"] && row.status === "pending") {
          row.status = args["p_status"] === "sent" ? "sent" : "failed";
          row.detail = typeof args["p_detail"] === "string" ? args["p_detail"] : null;
          return { data: true, error: null };
        }
      }
      return { data: false, error: null };
    }
    throw new Error(`test: nieoczekiwane RPC ${name}`);
  });
  return {
    rpc,
    calls,
    named(name: string): Record<string, unknown>[] {
      return calls.filter((call) => call.name === name).map((call) => call.args);
    },
    breakRpc(name: string, mode: "error" | "throw"): void {
      failures.set(name, mode);
    },
    seed(tenantId: string, key: string, row: LogRow): void {
      rows.set(`${tenantId}|${key}`, row);
    },
    reset(): void {
      rows.clear();
      calls.length = 0;
      failures.clear();
      seq = 0;
      rpc.mockClear();
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => log.rpc(name, args) },
}));

/**
 * Stary licznik `rate_limits` ('sms.once') - z PAMIĘCIĄ jak `rate_limit_hit`
 * (n-te uderzenie w kubełek przechodzi, gdy n <= max). Moduł NIE może go już
 * dotykać - to on zużywał klucz przed operatorem (REG-11). Pamięć jest po to,
 * żeby stary moduł podstawiony w miejsce nowego oblał testy ponowienia
 * z PRAWDZIWEGO powodu (`duplicate` po błędzie), a nie tylko na asercji wywołań.
 */
const limiter = vi.hoisted(() => {
  const hits = new Map<string, number>();
  const rateLimit = vi.fn(async (opts: { scope: string; subjectId: string; max: number }) => {
    const key = `${opts.scope}|${opts.subjectId}`;
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    return count <= opts.max;
  });
  return { rateLimit, hits };
});
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: limiter.rateLimit }));

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KEY = "event-ticket-sms:reg-1:paid:0";

describe("normalizePhone", () => {
  it("uzupełnia polski kierunkowy dla numeru krajowego", () => {
    expect(normalizePhone("601 234 567")).toBe("+48601234567");
  });

  it("zamienia prefiks 00 na +", () => {
    expect(normalizePhone("0049 170 1234567")).toBe("+491701234567");
  });

  it("odrzuca numer, którego dostawca i tak by nie przyjął", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  // LUSTRO W BAZIE (przegląd R67). Zgoda na SMS jest związana z ADRESATEM:
  // trigger `event_people_phone_revokes_sms` liczy go funkcją
  // `_event_phone_sms_destination` (migracja 20261012182000) i musi dawać to
  // samo co ta funkcja. Ta tabela to DOKŁADNIE przypadki z pgTAP
  // `event_sms_scanner_r67_test.sql` (asercja 3) - zmiana reguły tu bez
  // zmiany tam (albo odwrotnie) rozjeżdża zgodę z faktycznym adresatem.
  it.each([
    ["+48 600-100-200", "+48600100200"],
    ["0048600100200", "+48600100200"],
    ["600100200", "+48600100200"],
    ["(600) 100 200", "+48600100200"],
    ["600\t100\u00a0200", "+48600100200"],
    ["\u2009+48 600 100 200\ufeff", "+48600100200"],
    ["+601234567", "+601234567"],
    // „+" w lewo albo w prawo to INNY abonent - stąd zgoda wiąże się z adresatem.
    ["601234567", "+48601234567"],
    ["+44 20 7946 0958", "+442079460958"],
    ["12345", null],
    ["", null],
    [null, null],
    ["+0123456789", null],
    ["6001002001", null],
    ["+48 600 100 200 ext 5", null],
    ["600.100.200", null],
  ])("adresat %j -> %j (ta sama tabela co lustro SQL)", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("trimSmsBody", () => {
  it("nie tnie krótkiej treści", () => {
    expect(trimSmsBody("  Bilet oplacony.  ")).toBe("Bilet oplacony.");
  });

  it("skraca długą treść na granicy słowa", () => {
    const body = `${"wyraz ".repeat(80)}koniec`;
    const out = trimSmsBody(body);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
});

describe("sendSms - dziennik idempotencji (REG-11)", () => {
  type Answer = "ok" | "http_500" | "provider_error" | "throw";

  /** Dostawca SMS: atrapa `fetch` z zaplanowanymi odpowiedziami (domyślnie 200). */
  function givenProvider(...answers: Answer[]) {
    vi.stubEnv("SMSAPI_TOKEN", "token-testowy");
    const queue = [...answers];
    const fetchMock = vi.fn(async () => {
      const next = queue.shift() ?? "ok";
      if (next === "throw") throw new Error("ECONNRESET");
      if (next === "http_500") return { ok: false, status: 500, json: async () => ({}) };
      if (next === "provider_error") {
        return { ok: true, status: 200, json: async () => ({ error: 13 }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function errorLabels(): string[] {
    return errorSpy.mock.calls.map((call) => String(call[0]));
  }

  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.reset();
    limiter.hits.clear();
    limiter.rateLimit.mockClear();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const input = {
    to: "+48500100200",
    body: "Bilet oplacony.",
    idempotencyKey: KEY,
    tenantId: TENANT,
  };

  it("UKOŃCZENIE: błąd HTTP -> ponowienie faktycznie wysyła", async () => {
    // Stara bramka zużywała klucz PRZED operatorem: pierwsza próba kończyła
    // się `sms_http_500`, a ponowienie dostawało `duplicate` - dziennik
    // doręczeń zapisywał „wysłane" o SMS-ie, który nigdy nie wyszedł.
    const fetchMock = givenProvider("http_500", "ok");

    const first = await sendSms(input);
    const retry = await sendSms(input);

    expect(first).toEqual({ ok: false, error: "sms_http_500" });
    expect(retry).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.named("sms_send_finish")).toEqual([
      { p_tenant_id: TENANT, p_claim_id: "claim-1", p_status: "failed", p_detail: "sms_http_500" },
      { p_tenant_id: TENANT, p_claim_id: "claim-2", p_status: "sent" },
    ]);
  });

  it.each([
    ["błąd operatora w odpowiedzi", "provider_error", "sms_provider_13"],
    ["rzut sieci", "throw", "ECONNRESET"],
  ] as const)("%s też zwalnia klucz do ponowienia", async (_label, failure, code) => {
    const fetchMock = givenProvider(failure, "ok");

    expect(await sendSms(input)).toEqual({ ok: false, error: code });
    expect(await sendSms(input)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("`duplicate` dopiero po PRAWDZIWYM sukcesie - i bez drugiego wywołania operatora", async () => {
    const fetchMock = givenProvider("ok");

    expect(await sendSms(input)).toEqual({ ok: true });
    expect(await sendSms(input)).toEqual({ ok: true, skipped: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rezerwacja innego procesu to `in_flight` - bez operatora i bez zamknięcia", async () => {
    const fetchMock = givenProvider();
    log.seed(TENANT, KEY, { status: "pending", attempts: 1, claimId: "obcy", detail: null });

    expect(await sendSms(input)).toEqual({ ok: true, skipped: "in_flight" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.named("sms_send_finish")).toEqual([]);
  });

  it("limit prób to błąd `sms_retry_exhausted`, a nie cicha wysyłka", async () => {
    const fetchMock = givenProvider();
    log.seed(TENANT, KEY, {
      status: "failed",
      attempts: 5,
      claimId: "stary",
      detail: "sms_http_500",
    });

    expect(await sendSms(input)).toEqual({ ok: false, error: "sms_retry_exhausted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("klucz i najemca idą do dziennika literalnymi argumentami, bez numeru i treści", async () => {
    givenProvider();
    await sendSms(input);

    expect(log.named("sms_send_claim")).toEqual([{ p_tenant_id: TENANT, p_idempotency_key: KEY }]);
    // Minimalizacja danych: dziennik nie wie, DO KOGO i CO wysłano.
    expect(JSON.stringify(log.calls)).not.toContain("500100200");
    expect(JSON.stringify(log.calls)).not.toContain("Bilet");
  });

  it.each(["error", "throw"] as const)(
    "awaria rezerwacji (%s) nie wycisza wiadomości o pieniądzach - fail-open z logiem",
    async (mode) => {
      // Fail-open jest tu decyzją: cisza po nieudanej płatności jest gorsza
      // niż SMS wysłany drugi raz przy awarii bazy.
      const fetchMock = givenProvider();
      log.breakRpc("sms_send_claim", mode);

      expect(await sendSms(input)).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Bez rezerwacji nie ma czego zamykać.
      expect(log.named("sms_send_finish")).toEqual([]);
      expect(errorLabels()).toContain("[sms] idempotency gate failed");
    },
  );

  it.each(["error", "throw"] as const)(
    "awaria zamknięcia (%s) zostawia ślad w logu, a wynik wysyłki bez zmian",
    async (mode) => {
      givenProvider();
      log.breakRpc("sms_send_finish", mode);

      expect(await sendSms(input)).toEqual({ ok: true });
      expect(errorLabels()).toContain("[sms] idempotency finish failed");
    },
  );

  it("SMS bez klucza nie pyta dziennika - ludzkie kliknięcie idzie jak dotąd", async () => {
    const fetchMock = givenProvider();

    const result = await sendSms({ to: "+48500100200", body: "Bilet oplacony." });

    expect(result).toEqual({ ok: true });
    expect(log.rpc).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bez skonfigurowanego dostawcy dziennik zostaje nietknięty", async () => {
    // Gdyby rezerwacja stała przed sprawdzeniem dostawcy, włączenie SMS-ów
    // po fakcie zastałoby klucze zarezerwowane na wyłączonym kanale.
    vi.stubEnv("SMSAPI_TOKEN", "");

    expect(await sendSms(input)).toEqual({ ok: true, skipped: "disabled" });
    expect(log.rpc).not.toHaveBeenCalled();
  });

  it("numer nie do wysyłki też nie dotyka dziennika", async () => {
    givenProvider();

    expect(await sendSms({ ...input, to: "123" })).toEqual({ ok: true, skipped: "no_recipient" });
    expect(log.rpc).not.toHaveBeenCalled();
  });

  it("stary licznik 'sms.once' nie jest już pamięcią SMS-a", async () => {
    givenProvider("http_500", "ok");
    await sendSms(input);
    await sendSms(input);

    expect(limiter.rateLimit).not.toHaveBeenCalled();
  });
});
