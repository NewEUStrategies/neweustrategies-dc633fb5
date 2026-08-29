// Administracyjne powiadomienie o losie zgłoszenia: co wolno wysłać, a czego NIE.
//
// Ten plik pilnuje trzech rzeczy, których nie sprawdzi żaden test warstwy
// treści (`registrationNotify.server`) ani żaden test panelu:
//
//   1. BRAMKA STATUSU. Panel wysyła decyzję z listy, która mogła się zestarzeć.
//      Ładunek z bazy niesie status Z CHWILI ODCZYTU i jeśli nie zgadza się
//      z powiadomieniem, mail NIE MOŻE wyjść. Mail zaprzeczający aktualnej
//      decyzji jest gorszy niż brak maila.
//   2. KLUCZ IDEMPOTENCJI. Zawiera rodzaj powiadomienia ORAZ stempel przejścia,
//      więc dwa kliknięcia w ten sam przycisk dają jeden mail, a zmiana decyzji
//      (pending -> rejected -> approved -> rejected) daje mail za każdym razem.
//      Zgubienie stempla ucisza drugą decyzję - uczestnik nie dowiaduje się,
//      że wypadł.
//   3. PIECZĘĆ „POWIADOMIONO". `waitlist_notified_at` znaczy dokładnie jedno:
//      „osoba wie, że weszła z rezerwy". Stemplowanie jej po odmowie albo po
//      NIEUDANEJ wysyłce zamienia tę kolumnę w bezużyteczny licznik prób.
//
// PUŁAPKA HARNESSU: `createServerFn` buduje łańcuch
// `.middleware().inputValidator().handler()`. Atrapa oddaje z `.handler(fn)`
// samą funkcję z doklejonym `validate`, więc test wywołuje PRAWDZIWY walidator
// i PRAWDZIWY handler, a nie własną imitację.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildRegistrationNotice, sendTxEmail } = vi.hoisted(() => ({
  buildRegistrationNotice: vi.fn(),
  sendTxEmail: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: ((data: unknown) => unknown) | undefined;
    const api = {
      middleware: () => api,
      inputValidator: (fn: (data: unknown) => unknown) => {
        validate = fn;
        return api;
      },
      handler: (fn: unknown) => Object.assign(fn as object, { validate }),
    };
    return api;
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/lib/events/registrationNotify.server", () => ({ buildRegistrationNotice }));

vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail }));

const { notifyEventRegistrationDecision, registrationNoticeType, REGISTRATION_NOTICES } =
  await import("@/lib/events/registrationNotify.functions");
import type { RegistrationNotice } from "@/lib/events/registrationNotify.functions";

type Result = { ok: boolean; error?: string; skipped?: string };
type Callable = (input: {
  data: { registrationId: string; notice: string };
  context: { supabase: { rpc: ReturnType<typeof vi.fn> } };
}) => Promise<Result>;
type WithValidator = { validate: (data: unknown) => unknown };

const notify = notifyEventRegistrationDecision as unknown as Callable;
const validator = notifyEventRegistrationDecision as unknown as WithValidator;

const REG = "11111111-1111-4111-8111-111111111111";

/** Treść maila zwracana przez `buildRegistrationNotice` - tu nie jest badana. */
const CONTENT = {
  lang: "en" as const,
  eventTitle: "Kongres",
  firstName: "Ala",
  tenantId: "tenant-1",
  details: [{ label: "Kiedy", value: "1 maja" }],
  ctaPath: "/wydarzenia/kongres",
  ctaLabel: null,
};

/**
 * Klient z kontekstu middleware. Rozdziela oba RPC, żeby test mógł osobno
 * sprawdzić odczyt ładunku i osobno stemplowanie pieczęci.
 */
function stubClient(payload: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn(async (name: string) =>
    name === "admin_event_registration_notify_payload"
      ? { data: payload, error }
      : { data: null, error: null },
  );
  return { supabase: { rpc }, rpc };
}

function callsTo(rpc: ReturnType<typeof vi.fn>, name: string) {
  return rpc.mock.calls.filter((call) => call[0] === name);
}

async function run(payload: unknown, notice: string, error: { message: string } | null = null) {
  const { supabase, rpc } = stubClient(payload, error);
  const result = await notify({ data: { registrationId: REG, notice }, context: { supabase } });
  return { result, rpc };
}

beforeEach(() => {
  buildRegistrationNotice.mockReset();
  buildRegistrationNotice.mockReturnValue(CONTENT);
  sendTxEmail.mockReset();
  sendTxEmail.mockResolvedValue({ ok: true });
});

describe("registrationNoticeType - rodzaj maila dla każdego momentu", () => {
  it("mapuje każdy moment cyklu życia na własny szablon", () => {
    expect(registrationNoticeType("received")).toBe("event_registration_received");
    expect(registrationNoticeType("approved")).toBe("event_registration_approved");
    expect(registrationNoticeType("rejected")).toBe("event_registration_rejected");
    expect(registrationNoticeType("promoted")).toBe("event_waitlist_promoted");
  });

  it("żaden moment nie dzieli szablonu z innym", () => {
    // Wspólny szablon dla dwóch momentów oznacza jeden klucz idempotencji na
    // parę i uciszony drugi mail.
    const types = REGISTRATION_NOTICES.map(registrationNoticeType);
    expect(new Set(types).size).toBe(REGISTRATION_NOTICES.length);
  });

  it("zbiór momentów to dokładnie cztery znane wartości", () => {
    expect([...REGISTRATION_NOTICES]).toEqual(["received", "approved", "rejected", "promoted"]);
  });
});

describe("walidator wejścia - jedyna bariera przed publicznym POST", () => {
  it("przepuszcza poprawny UUID z jednym ze znanych momentów", () => {
    expect(validator.validate({ registrationId: REG, notice: "promoted" })).toEqual({
      registrationId: REG,
      notice: "promoted",
    });
  });

  it("odrzuca identyfikator, który nie jest UUID", () => {
    expect(() => validator.validate({ registrationId: "1 OR 1=1", notice: "approved" })).toThrow();
    expect(() => validator.validate({ registrationId: "", notice: "approved" })).toThrow();
  });

  it("odrzuca identyfikator, który nie jest tekstem", () => {
    // `POST` przyjmuje JSON, więc pole bywa liczbą, tablicą albo brakiem.
    expect(() => validator.validate({ registrationId: 42, notice: "approved" })).toThrow();
    expect(() => validator.validate({ registrationId: null, notice: "approved" })).toThrow();
    expect(() => validator.validate({ notice: "approved" })).toThrow();
  });

  it("odrzuca moment spoza zbioru oraz brak momentu", () => {
    expect(() => validator.validate({ registrationId: REG, notice: "cancelled" })).toThrow();
    expect(() => validator.validate({ registrationId: REG, notice: "" })).toThrow();
    expect(() => validator.validate({ registrationId: REG })).toThrow();
  });

  it("odrzuca wejście, które w ogóle nie jest obiektem", () => {
    expect(() => validator.validate(null)).toThrow();
    expect(() => validator.validate("promoted")).toThrow();
  });
});

describe("odczyt ładunku - kontrakt z RPC", () => {
  it("woła `admin_event_registration_notify_payload` z identyfikatorem w `p_payload`", async () => {
    // Supabase mapuje argumenty PO NAZWIE - literówka w `p_payload` albo
    // w `registration_id` to błąd dopiero w bazie, w czasie wykonania.
    const { rpc } = await run({ email: "a@b.pl", status: "rejected" }, "rejected");
    expect(rpc.mock.calls[0]).toEqual([
      "admin_event_registration_notify_payload",
      { p_payload: { registration_id: REG } },
    ]);
  });

  it("oddaje komunikat bazy, gdy RPC odmawia (np. bramka roli)", async () => {
    const { result } = await run(null, "approved", { message: "permission denied" });
    expect(result).toEqual({ ok: false, error: "permission denied" });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("nie wysyła nic, gdy zgłoszenia nie ma", async () => {
    const { result } = await run(null, "approved");
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("traktuje tablicę jako brak wiersza", async () => {
    // RPC zwracające `setof` oddaje tablicę - a wtedy `row.email` byłoby
    // `undefined` i mail poszedłby na pusty adres.
    const { result } = await run([{ email: "a@b.pl", status: "approved" }], "approved");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("traktuje wartość skalarną jako brak wiersza", async () => {
    expect((await run("a@b.pl", "approved")).result).toEqual({ ok: false, error: "not_found" });
    expect((await run(7, "approved")).result).toEqual({ ok: false, error: "not_found" });
  });

  it("odmawia, gdy adres nie jest tekstem albo go brak", async () => {
    expect((await run({ status: "approved" }, "approved")).result).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await run({ email: null, status: "approved" }, "approved")).result).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await run({ email: 42, status: "approved" }, "approved")).result).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("odmawia, gdy adres to sam biały znak", async () => {
    // Puste pole w bazie bywa spacją, a `sendTxEmail` bez adresata wysypałby
    // się dopiero w kolejce.
    const { result } = await run({ email: "   ", status: "approved" }, "approved");
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("wysyła na adres przycięty z białych znaków", async () => {
    await run({ email: "  a@b.pl \n", status: "approved" }, "approved");
    expect(sendTxEmail.mock.calls[0][0]).toMatchObject({ to: "a@b.pl" });
  });
});

describe("bramka statusu - mail nie może zaprzeczać aktualnej decyzji", () => {
  const allowed: [RegistrationNotice, string][] = [
    ["received", "pending"],
    ["received", "waitlist"],
    ["approved", "approved"],
    ["approved", "attended"],
    ["rejected", "rejected"],
    ["promoted", "approved"],
    ["promoted", "attended"],
  ];

  it.each(allowed)('„%s" wychodzi przy statusie „%s"', async (notice, status) => {
    const { result } = await run({ email: "a@b.pl", status }, notice);
    expect(result).toEqual({ ok: true });
    expect(sendTxEmail).toHaveBeenCalledTimes(1);
  });

  const blocked: [RegistrationNotice, string][] = [
    ["received", "approved"],
    ["received", "rejected"],
    ["approved", "pending"],
    ["approved", "rejected"],
    ["rejected", "approved"],
    ["rejected", "waitlist"],
    ["promoted", "waitlist"],
    ["promoted", "rejected"],
  ];

  it.each(blocked)('„%s" milczy, gdy status zdążył się zmienić na „%s"', async (notice, status) => {
    const { result } = await run({ email: "a@b.pl", status }, notice);
    expect(result).toEqual({ ok: true, skipped: "status_changed" });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("milczy przy statusie spoza znanego zbioru", async () => {
    const { result } = await run({ email: "a@b.pl", status: "cancelled" }, "approved");
    expect(result).toEqual({ ok: true, skipped: "status_changed" });
  });

  it("milczy, gdy status nie jest tekstem albo go brak", async () => {
    expect((await run({ email: "a@b.pl" }, "approved")).result).toEqual({
      ok: true,
      skipped: "status_changed",
    });
    expect((await run({ email: "a@b.pl", status: 1 }, "approved")).result).toEqual({
      ok: true,
      skipped: "status_changed",
    });
    expect((await run({ email: "a@b.pl", status: "" }, "received")).result).toEqual({
      ok: true,
      skipped: "status_changed",
    });
  });

  it("odmowa braku wiersza ma pierwszeństwo przed bramką statusu", async () => {
    // Kolejność jest istotna: brak adresu to błąd wołającego, a nie „pominięto".
    const { result } = await run({ email: "", status: "approved" }, "approved");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("treść maila - co dokładnie idzie do potoku poczty", () => {
  it("przekazuje komplet pól z ładunku i policzonej treści", async () => {
    await run(
      { email: "a@b.pl", status: "approved", decided_at: "2026-05-01T10:00:00Z" },
      "approved",
    );
    expect(sendTxEmail).toHaveBeenCalledWith({
      type: "event_registration_approved",
      to: "a@b.pl",
      lang: "en",
      subjectName: "Kongres",
      details: CONTENT.details,
      ctaPath: "/wydarzenia/kongres",
      metaName: "Ala",
      tenantId: "tenant-1",
      idempotencyKey: `event-registration:${REG}:approved:2026-05-01T10:00:00Z`,
    });
  });

  it("NIE przekazuje `manage_token` do budowania treści", async () => {
    // Ścieżka administracyjna klucza jawnego nie zna (baza trzyma sam hash),
    // więc trzeci argument musi zostać niepodany - inaczej mail organizatora
    // niósłby link do samoobsługi cudzego zgłoszenia.
    const row = { email: "a@b.pl", status: "rejected" };
    await run(row, "rejected");
    expect(buildRegistrationNotice).toHaveBeenCalledTimes(1);
    expect(buildRegistrationNotice.mock.calls[0]).toEqual(["rejected", row]);
  });

  it("NIE ustawia własnego napisu przycisku", async () => {
    // `ctaLabel` jest zastrzeżone dla ścieżki samoobsługowej - tutaj musi
    // zostać domyślny napis z `tx-copy`.
    await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(sendTxEmail.mock.calls[0][0]).not.toHaveProperty("ctaLabel");
  });
});

describe("klucz idempotencji - dedup ponowień, ale nie przejść", () => {
  async function keyFor(row: Record<string, unknown>, notice: string) {
    sendTxEmail.mockClear();
    await run(row, notice);
    return sendTxEmail.mock.calls[0][0].idempotencyKey as string;
  }

  it("dla awansu bierze stempel awansu, nie stempel decyzji", async () => {
    const key = await keyFor(
      {
        email: "a@b.pl",
        status: "approved",
        promoted_at: "2026-05-02T08:00:00Z",
        decided_at: "2026-04-01T08:00:00Z",
      },
      "promoted",
    );
    expect(key).toBe(`event-registration:${REG}:promoted:2026-05-02T08:00:00Z`);
  });

  it("dla pozostałych momentów bierze stempel decyzji, nie stempel awansu", async () => {
    const key = await keyFor(
      {
        email: "a@b.pl",
        status: "rejected",
        promoted_at: "2026-05-02T08:00:00Z",
        decided_at: "2026-04-01T08:00:00Z",
      },
      "rejected",
    );
    expect(key).toBe(`event-registration:${REG}:rejected:2026-04-01T08:00:00Z`);
  });

  it('wstawia „0", gdy stempla nie ma, jest pusty albo nie jest tekstem', async () => {
    expect(await keyFor({ email: "a@b.pl", status: "pending" }, "received")).toBe(
      `event-registration:${REG}:received:0`,
    );
    expect(await keyFor({ email: "a@b.pl", status: "pending", decided_at: "" }, "received")).toBe(
      `event-registration:${REG}:received:0`,
    );
    expect(await keyFor({ email: "a@b.pl", status: "pending", decided_at: 17 }, "received")).toBe(
      `event-registration:${REG}:received:0`,
    );
    expect(
      await keyFor({ email: "a@b.pl", status: "approved", promoted_at: null }, "promoted"),
    ).toBe(`event-registration:${REG}:promoted:0`);
  });

  it("dwie różne decyzje o tym samym zgłoszeniu mają różne klucze", async () => {
    const rejected = await keyFor(
      { email: "a@b.pl", status: "rejected", decided_at: "2026-04-01T08:00:00Z" },
      "rejected",
    );
    const approved = await keyFor(
      { email: "a@b.pl", status: "approved", decided_at: "2026-04-02T08:00:00Z" },
      "approved",
    );
    expect(rejected).not.toBe(approved);
  });

  it("powrót do tego samego stanu w innym przejściu daje inny klucz", async () => {
    // pending -> rejected -> approved -> waitlist -> rejected. Bez stempla oba
    // odrzucenia miałyby IDENTYCZNY klucz i drugie nie dotarłoby do uczestnika.
    const first = await keyFor(
      { email: "a@b.pl", status: "rejected", decided_at: "2026-04-01T08:00:00Z" },
      "rejected",
    );
    const second = await keyFor(
      { email: "a@b.pl", status: "rejected", decided_at: "2026-06-01T08:00:00Z" },
      "rejected",
    );
    expect(first).not.toBe(second);
  });
});

describe("wynik wysyłki", () => {
  it("oddaje `duplicate`, gdy potok rozpoznał już wysłany mail", async () => {
    sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const { result } = await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
  });

  it("oddaje czyste `ok`, gdy potok przyjął mail bez pominięcia", async () => {
    sendTxEmail.mockResolvedValue({ ok: true });
    const { result } = await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(result).toEqual({ ok: true });
  });

  it("przy porażce woli powód od surowego błędu", async () => {
    sendTxEmail.mockResolvedValue({
      ok: false,
      skipped: "suppressed",
      reason: "suppressed:complaint",
      error: "ignored",
    });
    const { result } = await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(result).toEqual({ ok: false, error: "suppressed:complaint" });
  });

  it("bez powodu oddaje surowy błąd potoku", async () => {
    sendTxEmail.mockResolvedValue({ ok: false, error: "supabase_unavailable" });
    const { result } = await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(result).toEqual({ ok: false, error: "supabase_unavailable" });
  });

  it("bez powodu i bez błędu oddaje `send_failed`", async () => {
    sendTxEmail.mockResolvedValue({ ok: false, skipped: "no_recipient" });
    const { result } = await run({ email: "a@b.pl", status: "approved" }, "approved");
    expect(result).toEqual({ ok: false, error: "send_failed" });
  });
});

describe('pieczęć „powiadomiono" - wyłącznie dla awansu z rezerwy', () => {
  const MARK = "admin_event_registration_mark_notified";

  it("awans stempluje kolumnę, podając identyfikator w tablicy", async () => {
    const { rpc } = await run({ email: "a@b.pl", status: "approved" }, "promoted");
    expect(callsTo(rpc, MARK)).toEqual([[MARK, { p_payload: { registration_ids: [REG] } }]]);
  });

  it.each(["received", "approved", "rejected"])(
    '„%s" NIE dotyka kolumny awansu',
    async (notice) => {
      const status = notice === "received" ? "pending" : notice;
      const { rpc } = await run({ email: "a@b.pl", status }, notice);
      expect(callsTo(rpc, MARK)).toHaveLength(0);
    },
  );

  it("nie stempluje, gdy wysyłka się nie powiodła", async () => {
    // Pieczęć znaczy „osoba wie". Po nieudanej wysyłce nie wie.
    sendTxEmail.mockResolvedValue({ ok: false, error: "boom" });
    const { rpc, result } = await run({ email: "a@b.pl", status: "approved" }, "promoted");
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(callsTo(rpc, MARK)).toHaveLength(0);
  });

  it("nie stempluje, gdy adres jest na liście wykluczeń", async () => {
    // Lista wykluczeń zwraca `ok:false` - mail NIE wyszedł, więc kolumna
    // „osoba wie, że weszła z rezerwy" musi zostać pusta.
    sendTxEmail.mockResolvedValue({
      ok: false,
      skipped: "suppressed",
      reason: "suppressed:bounce",
    });
    const { rpc } = await run({ email: "a@b.pl", status: "approved" }, "promoted");
    expect(callsTo(rpc, MARK)).toHaveLength(0);
  });

  it("nie stempluje, gdy bramka statusu ucisza mail", async () => {
    const { rpc } = await run({ email: "a@b.pl", status: "waitlist" }, "promoted");
    expect(callsTo(rpc, MARK)).toHaveLength(0);
  });

  it("stempluje także przy duplikacie i nadal oddaje `duplicate`", async () => {
    // Duplikat znaczy „mail już poszedł" - pieczęć musi to odnotować, bo
    // pierwsza próba mogła stempla nie postawić.
    sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    const { rpc, result } = await run({ email: "a@b.pl", status: "approved" }, "promoted");
    expect(callsTo(rpc, MARK)).toHaveLength(1);
    expect(result).toEqual({ ok: true, skipped: "duplicate" });
  });
});
