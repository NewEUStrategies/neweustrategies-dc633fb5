// SMS jest kanałem pomocniczym - te testy pilnują trzech rzeczy, które decydują
// o tym, czy wiadomość dotrze i ILE RAZY: normalizacji numeru, długości treści
// i bramki powtórzeń.
//
// RODO: numery zmyślone, dostawca nigdy nie jest wybierany (`fetch` jest atrapą).
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePhone, sendSms, trimSmsBody } from "@/lib/notify/sms.server";

/** Kształt, w jakim `sendSms` woła licznik - atrapa musi go widzieć w całości. */
interface RateLimitCall {
  scope: string;
  subjectId: string;
  max: number;
  windowMinutes?: number;
  failClosed?: boolean;
}

/**
 * Licznik `rate_limits` - jedyna pamięć, jaką ma bramka powtórzeń SMS-a.
 * `allow` to kolejka odpowiedzi: pierwsza wysyłka przechodzi, powtórka nie.
 */
const limiter = vi.hoisted(() => {
  const calls: RateLimitCall[] = [];
  const allow: boolean[] = [];
  let broken: Error | null = null;
  const rateLimit = vi.fn(async (opts: RateLimitCall): Promise<boolean> => {
    if (broken) throw broken;
    calls.push(opts);
    return allow.shift() ?? true;
  });
  return {
    rateLimit,
    calls,
    plan(...answers: boolean[]): void {
      allow.push(...answers);
    },
    breakCounter(error: Error): void {
      broken = error;
    },
    reset(): void {
      calls.length = 0;
      allow.length = 0;
      broken = null;
      rateLimit.mockClear();
    },
  };
});

vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: limiter.rateLimit }));

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

describe("sendSms - bramka powtórzeń", () => {
  /** Dostawca SMS: atrapa `fetch`, która zawsze potwierdza przyjęcie. */
  function givenProvider(): ReturnType<typeof vi.fn> {
    vi.stubEnv("SMSAPI_TOKEN", "token-testowy");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    limiter.reset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ten sam klucz nie wysyła drugiego SMS-a", async () => {
    // Operator płatności ponawia webhooka po każdym timeoucie. Bez tej bramki
    // każde ponowienie to kolejny SMS do tej samej osoby - i żadnego śladu,
    // bo SMS-y nie siedzą w `email_send_log`.
    const fetchMock = givenProvider();
    limiter.plan(true, false);

    const first = await sendSms({ to: "+48500100200", body: "Bilet oplacony.", idempotencyKey: "k" });
    const second = await sendSms({ to: "+48500100200", body: "Bilet oplacony.", idempotencyKey: "k" });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true, skipped: "duplicate" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Limit 1 to całe „raz na klucz": przy limicie 2 bramka przepuściłaby duplikat.
    expect(limiter.calls[0]).toMatchObject({ subjectId: "k", max: 1 });
    expect(limiter.calls[0]?.scope).toBe(limiter.calls[1]?.scope);
  });

  it("SMS bez klucza nie pyta licznika - kontrakt starych wołających zostaje", async () => {
    const fetchMock = givenProvider();

    const result = await sendSms({ to: "+48500100200", body: "Bilet oplacony." });

    expect(result).toEqual({ ok: true });
    expect(limiter.rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("awaria licznika nie wycisza wiadomości o pieniądzach", async () => {
    // Fail-open jest tu decyzją: cisza po nieudanej płatności jest gorsza
    // niż SMS wysłany drugi raz przy awarii bazy.
    const fetchMock = givenProvider();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    limiter.breakCounter(new Error("licznik odmówił"));

    const result = await sendSms({ to: "+48500100200", body: "Bilet oplacony.", idempotencyKey: "k" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Awaria bramki ma zostawić ślad w logach - inaczej duplikat wygląda
    // jak świadoma decyzja modułu.
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[sms] idempotency gate failed",
    );
    errorSpy.mockRestore();
  });

  it("bez skonfigurowanego dostawcy klucz się NIE zużywa", async () => {
    // Gdyby bramka stała przed sprawdzeniem dostawcy, włączenie SMS-ów
    // po fakcie zastałoby wszystkie klucze spalone na wyłączonym kanale.
    vi.stubEnv("SMSAPI_TOKEN", "");

    const result = await sendSms({ to: "+48500100200", body: "Bilet oplacony.", idempotencyKey: "k" });

    expect(result).toEqual({ ok: true, skipped: "disabled" });
    expect(limiter.rateLimit).not.toHaveBeenCalled();
  });

  it("numer nie do wysyłki też nie zużywa klucza", async () => {
    givenProvider();

    const result = await sendSms({ to: "123", body: "Bilet oplacony.", idempotencyKey: "k" });

    expect(result).toEqual({ ok: true, skipped: "no_recipient" });
    expect(limiter.rateLimit).not.toHaveBeenCalled();
  });
});
