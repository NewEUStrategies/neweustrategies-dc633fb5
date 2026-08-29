// Potwierdzenie zapisu wysyłane samemu sobie zaraz po formularzu.
//
// Ta ścieżka jest BEZ ZALOGOWANIA, więc cała jej obrona mieści się w trzech
// miejscach - i dokładnie te trzy pilnuje ten plik:
//
//   1. KSZTAŁT SEKRETU. `manage_token` to 32 znaki base64url. Walidator jest
//      jedyną barierą między publicznym `POST` a zapytaniem do bazy;
//      rozluźnienie go wpuszcza dowolny tekst tam, gdzie baza porównuje hash.
//   2. NIC Z CIAŁA ŻĄDANIA POZA KLUCZEM. Adres, imię, język, najemca i rodzaj
//      maila biorą się WYŁĄCZNIE z wiersza bazy. Gdyby rodzaj wybierał klient,
//      wysłałby sobie „zgłoszenie zaakceptowane" na miejsce, którego nie ma.
//   3. KLIENT ANONIMOWY Z NAGŁÓWKIEM HOSTA. `event_registration_notify_payload`
//      ustala najemcę przez `public_tenant_id()`. Klucz serwisowy nagłówka nie
//      niesie i trafiłby zawsze do najemcy domyślnego - czyli pokazałby cudze
//      wydarzenie albo nie znalazł żadnego.
//
// FAIL-SOFT: brak maila nie unieważnia zapisu, więc każda odmowa musi być
// zwróconą wartością, a nie wyjątkiem lecącym w formularz.
//
// PUŁAPKA HARNESSU: atrapa `createServerFn` oddaje z `.handler(fn)` samą
// funkcję z doklejonym `validate`, więc test wywołuje PRAWDZIWY walidator
// i PRAWDZIWY handler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, rpc, buildRegistrationNotice, sendTxEmail, tenantFetch } = vi.hoisted(() => {
  const rpcFn = vi.fn();
  return {
    rpc: rpcFn,
    createClient: vi.fn(() => ({ rpc: rpcFn })),
    buildRegistrationNotice: vi.fn(),
    sendTxEmail: vi.fn(),
    tenantFetch: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient }));

vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({ fetchWithTenantHost: tenantFetch }));

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

vi.mock("@/lib/events/registrationNotify.server", () => ({ buildRegistrationNotice }));

vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail }));

const { confirmEventRegistrationEmail } =
  await import("@/lib/events/registrationSelfNotify.functions");

type Result = { ok: boolean; error?: string; skipped?: string };
type Callable = (input: { data: { manageToken: string } }) => Promise<Result>;
type WithValidator = { validate: (data: unknown) => unknown };

const confirm = confirmEventRegistrationEmail as unknown as Callable;
const validator = confirmEventRegistrationEmail as unknown as WithValidator;

/** 32 znaki base64url - dokładnie tyle, ile daje `_event_new_qr_token()`. */
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const REG = "11111111-1111-4111-8111-111111111111";

const CONTENT = {
  lang: "pl" as const,
  eventTitle: "Kongres",
  firstName: "Ala",
  tenantId: "tenant-1",
  details: [{ label: "Kiedy", value: "1 maja" }],
  ctaPath: `/z/${TOKEN}`,
  ctaLabel: "Zarządzaj zgłoszeniem",
};

function payload(row: unknown, error: { message: string } | null = null) {
  rpc.mockResolvedValue({ data: row, error });
}

async function run(row: unknown, error: { message: string } | null = null) {
  payload(row, error);
  return confirm({ data: { manageToken: TOKEN } });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://przyklad.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "klucz-publiczny";
  createClient.mockClear();
  rpc.mockReset();
  buildRegistrationNotice.mockReset();
  buildRegistrationNotice.mockReturnValue(CONTENT);
  sendTxEmail.mockReset();
  sendTxEmail.mockResolvedValue({ ok: true });
});

describe("walidator klucza samoobsługi", () => {
  it("przepuszcza dokładnie 32 znaki base64url", () => {
    expect(validator.validate({ manageToken: TOKEN })).toEqual({ manageToken: TOKEN });
    expect(validator.validate({ manageToken: "A-_0".repeat(8) })).toEqual({
      manageToken: "A-_0".repeat(8),
    });
  });

  it("odrzuca klucz krótszy i dłuższy niż 32 znaki", () => {
    expect(() => validator.validate({ manageToken: TOKEN.slice(0, 31) })).toThrow();
    expect(() => validator.validate({ manageToken: `${TOKEN}x` })).toThrow();
    expect(() => validator.validate({ manageToken: "" })).toThrow();
  });

  it("odrzuca znaki spoza base64url", () => {
    // Klasyczne base64 (`+`, `/`, `=`) i wszystko, co pachnie wstrzyknięciem.
    expect(() => validator.validate({ manageToken: `${TOKEN.slice(0, 31)}+` })).toThrow();
    expect(() => validator.validate({ manageToken: `${TOKEN.slice(0, 31)}/` })).toThrow();
    expect(() => validator.validate({ manageToken: `${TOKEN.slice(0, 31)}=` })).toThrow();
    expect(() => validator.validate({ manageToken: `${TOKEN.slice(0, 31)} ` })).toThrow();
    expect(() => validator.validate({ manageToken: `${TOKEN.slice(0, 30)}'--` })).toThrow();
  });

  it("odrzuca wartość, która nie jest tekstem, oraz brak wejścia", () => {
    expect(() => validator.validate({ manageToken: 42 })).toThrow();
    expect(() => validator.validate({ manageToken: null })).toThrow();
    expect(() => validator.validate({ manageToken: [TOKEN] })).toThrow();
    expect(() => validator.validate({})).toThrow();
    expect(() => validator.validate(null)).toThrow();
  });
});

describe("klient bazy - anonimowy, z nagłówkiem hosta", () => {
  it("używa klucza PUBLIKOWALNEGO, nie serwisowego, i własnego `fetch`", async () => {
    await run({ email: "a@b.pl", status: "pending", registration_id: REG });
    const [url, key, options] = createClient.mock.calls[0] as unknown as [
      string,
      string,
      { global: { fetch: unknown }; auth: Record<string, unknown> },
    ];
    expect(url).toBe("https://przyklad.supabase.co");
    expect(key).toBe("klucz-publiczny");
    // Bez tego `fetch` najemca rozwiązałby się do domyślnego.
    expect(options.global.fetch).toBe(tenantFetch);
  });

  it("nie zakłada ani nie utrwala żadnej sesji", async () => {
    // Proces serwerowy obsługuje wielu gości naraz - utrwalona sesja
    // przeciekłaby między żądaniami.
    await run({ email: "a@b.pl", status: "pending", registration_id: REG });
    const [, , options] = createClient.mock.calls[0] as unknown as [
      string,
      string,
      { auth: { storage?: unknown; persistSession: boolean; autoRefreshToken: boolean } },
    ];
    expect(options.auth.storage).toBeUndefined();
    expect(options.auth.persistSession).toBe(false);
    expect(options.auth.autoRefreshToken).toBe(false);
  });

  it("woła `event_registration_notify_payload` z kluczem w `p_payload`", async () => {
    // Supabase mapuje argumenty PO NAZWIE - literówka to błąd w czasie wykonania.
    await run({ email: "a@b.pl", status: "pending", registration_id: REG });
    expect(rpc.mock.calls[0]).toEqual([
      "event_registration_notify_payload",
      { p_payload: { manage_token: TOKEN } },
    ]);
  });
});

describe("ładunek z bazy - brak, niepełny, błąd", () => {
  it("oddaje komunikat bazy zamiast rzucać wyjątkiem", async () => {
    const result = await run(null, { message: "rate limited" });
    expect(result).toEqual({ ok: false, error: "rate limited" });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("odmawia, gdy klucz nie pasuje do żadnego zgłoszenia", async () => {
    expect(await run(null)).toEqual({ ok: false, error: "not_found" });
  });

  it("traktuje tablicę i wartość skalarną jako brak wiersza", async () => {
    expect(await run([{ email: "a@b.pl", status: "pending" }])).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await run("a@b.pl")).toEqual({ ok: false, error: "not_found" });
    expect(await run(0)).toEqual({ ok: false, error: "not_found" });
  });

  it("odmawia, gdy adres nie jest tekstem, jest pusty albo to sam biały znak", async () => {
    expect(await run({ status: "pending" })).toEqual({ ok: false, error: "not_found" });
    expect(await run({ email: null, status: "pending" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await run({ email: 42, status: "pending" })).toEqual({ ok: false, error: "not_found" });
    expect(await run({ email: "", status: "pending" })).toEqual({ ok: false, error: "not_found" });
    expect(await run({ email: "  \t ", status: "pending" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });

  it("wysyła na adres przycięty z białych znaków", async () => {
    await run({ email: " a@b.pl ", status: "pending", registration_id: REG });
    expect(sendTxEmail.mock.calls[0][0]).toMatchObject({ to: "a@b.pl" });
  });
});

describe("rodzaj maila wynika ze STATUSU, nie z życzenia klienta", () => {
  it.each(["pending", "waitlist"])('status „%s" daje „zgłoszenie przyjęte"', async (status) => {
    await run({ email: "a@b.pl", status, registration_id: REG });
    expect(buildRegistrationNotice.mock.calls[0][0]).toBe("received");
    expect(sendTxEmail.mock.calls[0][0]).toMatchObject({
      type: "event_registration_received",
      idempotencyKey: `event-registration:${REG}:received`,
    });
  });

  it.each(["approved", "attended"])(
    'status „%s" daje „zgłoszenie zaakceptowane"',
    async (status) => {
      await run({ email: "a@b.pl", status, registration_id: REG });
      expect(buildRegistrationNotice.mock.calls[0][0]).toBe("approved");
      expect(sendTxEmail.mock.calls[0][0]).toMatchObject({
        type: "event_registration_approved",
        idempotencyKey: `event-registration:${REG}:approved`,
      });
    },
  );

  it.each(["rejected", "cancelled", "", "PENDING"])(
    'status „%s" nie daje żadnego maila',
    async (status) => {
      // „Odrzucone" i wszystko spoza zbioru: uczestnik NIE MOŻE dostać od
      // siebie samego potwierdzenia miejsca, którego nie ma.
      const result = await run({ email: "a@b.pl", status, registration_id: REG });
      expect(result).toEqual({ ok: true, skipped: "not_notifiable" });
      expect(sendTxEmail).not.toHaveBeenCalled();
      expect(buildRegistrationNotice).not.toHaveBeenCalled();
    },
  );

  it("brak statusu i status nietekstowy też uciszają mail", async () => {
    expect(await run({ email: "a@b.pl", registration_id: REG })).toEqual({
      ok: true,
      skipped: "not_notifiable",
    });
    expect(await run({ email: "a@b.pl", status: 1, registration_id: REG })).toEqual({
      ok: true,
      skipped: "not_notifiable",
    });
    expect(sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("treść maila - klucz jawny widziany tylko tutaj", () => {
  it("przekazuje surowy `manage_token` do budowania treści", async () => {
    // To JEDYNY moment, w którym serwis widzi klucz jawny (baza trzyma hash),
    // a gość bez konta nie ma go skąd odtworzyć - bez tego link do rezygnacji
    // nigdy nie trafi do maila.
    const row = { email: "a@b.pl", status: "pending", registration_id: REG };
    await run(row);
    expect(buildRegistrationNotice.mock.calls[0]).toEqual(["received", row, TOKEN]);
  });

  it("przekazuje komplet pól do potoku poczty", async () => {
    await run({ email: "a@b.pl", status: "pending", registration_id: REG });
    expect(sendTxEmail).toHaveBeenCalledWith({
      type: "event_registration_received",
      to: "a@b.pl",
      lang: "pl",
      subjectName: "Kongres",
      details: CONTENT.details,
      ctaPath: `/z/${TOKEN}`,
      ctaLabel: "Zarządzaj zgłoszeniem",
      metaName: "Ala",
      tenantId: "tenant-1",
      idempotencyKey: `event-registration:${REG}:received`,
    });
  });

  it("brak własnego napisu przycisku oddaje decyzję szablonowi", async () => {
    // `null` z warstwy treści musi stać się `undefined`, bo tylko wtedy
    // `tx-copy` wstawia swój domyślny napis.
    buildRegistrationNotice.mockReturnValue({ ...CONTENT, ctaLabel: null });
    await run({ email: "a@b.pl", status: "approved", registration_id: REG });
    expect(sendTxEmail.mock.calls[0][0].ctaLabel).toBeUndefined();
  });

  it("gdy ładunek nie niesie identyfikatora, klucz idempotencji ma pustą część", async () => {
    // PRAWDOPODOBNIE USTERKA: przy braku `registration_id` klucz to
    // `event-registration::received` - identyczny dla KAŻDEGO takiego
    // zgłoszenia, więc drugi gość dostałby „duplikat" zamiast potwierdzenia.
    // Test opisuje ZACHOWANIE OBECNE, nie pożądane.
    await run({ email: "a@b.pl", status: "pending" });
    expect(sendTxEmail.mock.calls[0][0].idempotencyKey).toBe("event-registration::received");
    sendTxEmail.mockClear();
    await run({ email: "a@b.pl", status: "pending", registration_id: 7 });
    expect(sendTxEmail.mock.calls[0][0].idempotencyKey).toBe("event-registration::received");
  });
});

describe("wynik wysyłki - odmowa jest wartością, nie awarią", () => {
  it("oddaje czyste `ok`, gdy potok przyjął mail", async () => {
    expect(await run({ email: "a@b.pl", status: "pending", registration_id: REG })).toEqual({
      ok: true,
    });
  });

  it("oddaje `duplicate`, gdy formularz wysłano dwa razy", async () => {
    sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    expect(await run({ email: "a@b.pl", status: "pending", registration_id: REG })).toEqual({
      ok: true,
      skipped: "duplicate",
    });
  });

  it("przy porażce woli powód od surowego błędu", async () => {
    sendTxEmail.mockResolvedValue({
      ok: false,
      skipped: "suppressed",
      reason: "suppressed:bounce",
      error: "ignored",
    });
    expect(await run({ email: "a@b.pl", status: "pending", registration_id: REG })).toEqual({
      ok: false,
      error: "suppressed:bounce",
    });
  });

  it("bez powodu oddaje surowy błąd potoku", async () => {
    sendTxEmail.mockResolvedValue({ ok: false, error: "supabase_unavailable" });
    expect(await run({ email: "a@b.pl", status: "pending", registration_id: REG })).toEqual({
      ok: false,
      error: "supabase_unavailable",
    });
  });

  it("bez powodu i bez błędu oddaje `send_failed`", async () => {
    sendTxEmail.mockResolvedValue({ ok: false, skipped: "no_recipient" });
    expect(await run({ email: "a@b.pl", status: "pending", registration_id: REG })).toEqual({
      ok: false,
      error: "send_failed",
    });
  });
});
