// Potwierdzenie zapisu wysyłane kluczem samoobsługi:
// `registrationSelfNotify.server.ts`, wołany przez serwer zapisu
// (`eventRegistration.server.ts`) po utworzeniu zgłoszenia gościa bez konta.
//
// Gość nie jest zalogowany, więc obrona tej ścieżki mieści się w dwóch
// miejscach - i dokładnie te dwa pilnuje ten plik:
//
//   1. NIC POZA KLUCZEM. Adres, imię, język, najemca i rodzaj
//      maila biorą się WYŁĄCZNIE z wiersza bazy. Gdyby rodzaj wybierał klient,
//      wysłałby sobie „zgłoszenie zaakceptowane" na miejsce, którego nie ma.
//   2. NAJEMCA Z ARGUMENTU (REG-17). `event_registration_notify_payload_for_
//      tenant` (A1, tylko `service_role`) dostaje najemcę jawnie i rozstrzyga
//      klucz jedną regułą (wygasły / zamknięty nie oddaje adresu). Stara
//      funkcja (`public_tenant_id()` z nagłówka hosta) jest wołana WYŁĄCZNIE
//      w oknie wdrożenia, klientem anonimowym z nagłówkiem hosta.
//
// FAIL-SOFT: brak maila nie unieważnia zapisu, więc każda odmowa musi być
// zwróconą wartością, a nie wyjątkiem lecącym w formularz.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const anonRpc = vi.fn();
  return {
    adminRpc: vi.fn(),
    anonRpc,
    createClient: vi.fn((..._args: unknown[]) => ({ rpc: anonRpc })),
    buildRegistrationNotice: vi.fn(),
    sendTxEmail: vi.fn(),
    tenantFetch: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: h.tenantFetch,
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.adminRpc } }));
vi.mock("@/lib/events/registrationNotify.server", () => ({
  buildRegistrationNotice: h.buildRegistrationNotice,
}));
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: h.sendTxEmail }));

const { sendRegistrationNoticeForManageToken, hostAnonClient } =
  await import("@/lib/events/registrationSelfNotify.server");

/** 32 znaki base64url - dokładnie tyle, ile daje `_event_new_qr_token()`. */
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const REG = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const CONTENT = {
  lang: "pl" as const,
  eventTitle: "Kongres",
  firstName: "Ala",
  tenantId: "tenant-1",
  details: [{ label: "Kiedy", value: "1 maja" }],
  ctaPath: `/z/${TOKEN}`,
  ctaLabel: "Zarządzaj zgłoszeniem",
};

async function run(row: unknown, error: { message: string; code?: string } | null = null) {
  h.adminRpc.mockResolvedValue({ data: row, error });
  return sendRegistrationNoticeForManageToken(TENANT, TOKEN);
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://przyklad.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "klucz-publiczny";
  h.createClient.mockClear();
  h.adminRpc.mockReset();
  h.anonRpc.mockReset();
  h.buildRegistrationNotice.mockReset();
  h.buildRegistrationNotice.mockReturnValue(CONTENT);
  h.sendTxEmail.mockReset();
  h.sendTxEmail.mockResolvedValue({ ok: true });
});

describe("najemca z argumentu - funkcja tylko dla roli serwisowej", () => {
  it("woła `event_registration_notify_payload_for_tenant` z najemcą i kluczem", async () => {
    await run({ email: "a@b.pl", status: "pending", registration_id: REG });
    expect(h.adminRpc.mock.calls[0]).toEqual([
      "event_registration_notify_payload_for_tenant",
      { _tenant_id: TENANT, p_payload: { manage_token: TOKEN } },
    ]);
    // Nowa funkcja odpowiedziała - stara nie jest pytana wcale.
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.anonRpc).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "okno wdrożenia (%s): stara funkcja klientem anonimowym z nagłówkiem hosta",
    async (code) => {
      h.anonRpc.mockResolvedValue({
        data: { email: "a@b.pl", status: "pending", registration_id: REG },
        error: null,
      });
      await run(null, { code, message: "function not found" });
      expect(h.anonRpc.mock.calls[0]).toEqual([
        "event_registration_notify_payload",
        { p_payload: { manage_token: TOKEN } },
      ]);
      const [url, key, options] = h.createClient.mock.calls[0] as unknown as [
        string,
        string,
        {
          global: { fetch: unknown; headers?: unknown };
          auth: { storage?: unknown; persistSession: boolean };
        },
      ];
      expect(url).toBe("https://przyklad.supabase.co");
      expect(key).toBe("klucz-publiczny");
      // Bez tego `fetch` najemca rozwiązałby się do domyślnego.
      expect(options.global.fetch).toBe(h.tenantFetch);
      expect(options.global.headers).toBeUndefined();
      expect(options.auth.persistSession).toBe(false);
      expect(options.auth.storage).toBeUndefined();
      expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
    },
  );

  it("każdy inny błąd bazy (wygasły klucz, odmowa) NIE włącza starej funkcji", async () => {
    const result = await run(null, {
      code: "P0001",
      message: "manage_expired: this management link expired when the event ended",
    });
    expect(result).toEqual({
      ok: false,
      error: "manage_expired: this management link expired when the event ended",
    });
    expect(h.anonRpc).not.toHaveBeenCalled();
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("klient z tokenem wołającego niesie nagłówek - bez tokenu go nie ma", async () => {
    await hostAnonClient("token-wolajacego");
    const [, , withBearer] = h.createClient.mock.calls[0] as unknown as [
      string,
      string,
      { global: { headers?: Record<string, string> } },
    ];
    expect(withBearer.global.headers).toEqual({ Authorization: "Bearer token-wolajacego" });
  });

  it("brak konfiguracji to brak klienta, nie wyjątek", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(await hostAnonClient()).toBeNull();
  });
});

describe("ładunek z bazy - brak, niepełny, błąd", () => {
  it("odmawia, gdy klucz nie pasuje do żadnego zgłoszenia albo wiersz nie jest obiektem", async () => {
    expect(await run(null)).toEqual({ ok: false, error: "not_found" });
    expect(await run([{ email: "a@b.pl", status: "pending" }])).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await run("a@b.pl")).toEqual({ ok: false, error: "not_found" });
  });

  it("odmawia, gdy adres nie jest tekstem, jest pusty albo to sam biały znak", async () => {
    expect(await run({ status: "pending" })).toEqual({ ok: false, error: "not_found" });
    expect(await run({ email: 42, status: "pending" })).toEqual({ ok: false, error: "not_found" });
    expect(await run({ email: "  \t ", status: "pending" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("wysyła na adres przycięty z białych znaków", async () => {
    await run({ email: " a@b.pl ", status: "pending", registration_id: REG });
    expect(h.sendTxEmail.mock.calls[0][0]).toMatchObject({ to: "a@b.pl" });
  });

  it("wyjątek po drodze to wartość `send_failed`, nie wyjątek w formularz", async () => {
    h.adminRpc.mockRejectedValue(new Error("sieć padła"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendRegistrationNoticeForManageToken(TENANT, TOKEN)).resolves.toEqual({
      ok: false,
      error: "send_failed",
    });
  });
});

describe("rodzaj maila wynika ze STATUSU, nie z życzenia klienta", () => {
  it.each(["pending", "waitlist"])('status „%s" daje „zgłoszenie przyjęte"', async (status) => {
    await run({ email: "a@b.pl", status, registration_id: REG });
    expect(h.buildRegistrationNotice.mock.calls[0][0]).toBe("received");
    expect(h.sendTxEmail.mock.calls[0][0]).toMatchObject({
      type: "event_registration_received",
      idempotencyKey: `event-registration:${REG}:received`,
    });
  });

  it.each(["approved", "attended"])(
    'status „%s" daje „zgłoszenie zaakceptowane"',
    async (status) => {
      await run({ email: "a@b.pl", status, registration_id: REG });
      expect(h.buildRegistrationNotice.mock.calls[0][0]).toBe("approved");
      expect(h.sendTxEmail.mock.calls[0][0]).toMatchObject({
        type: "event_registration_approved",
        idempotencyKey: `event-registration:${REG}:approved`,
      });
    },
  );

  it.each(["rejected", "cancelled", "", "PENDING"])(
    'status „%s" nie daje żadnego maila',
    async (status) => {
      const result = await run({ email: "a@b.pl", status, registration_id: REG });
      expect(result).toEqual({ ok: true, skipped: "not_notifiable" });
      expect(h.sendTxEmail).not.toHaveBeenCalled();
      expect(h.buildRegistrationNotice).not.toHaveBeenCalled();
    },
  );
});

describe("treść maila - klucz jawny widziany tylko tutaj", () => {
  it("przekazuje surowy `manage_token` do budowania treści i komplet pól do poczty", async () => {
    const row = { email: "a@b.pl", status: "pending", registration_id: REG };
    await run(row);
    expect(h.buildRegistrationNotice.mock.calls[0]).toEqual(["received", row, TOKEN]);
    expect(h.sendTxEmail).toHaveBeenCalledWith({
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

  it("wiersz bez najemcy - nadawcą jest najemca, w którym serwer rozstrzygnął klucz", async () => {
    h.buildRegistrationNotice.mockReturnValue({ ...CONTENT, tenantId: null });
    await run({ email: "a@b.pl", status: "approved", registration_id: REG });
    expect(h.sendTxEmail.mock.calls[0][0].tenantId).toBe(TENANT);
  });

  it("brak własnego napisu przycisku oddaje decyzję szablonowi", async () => {
    h.buildRegistrationNotice.mockReturnValue({ ...CONTENT, ctaLabel: null });
    await run({ email: "a@b.pl", status: "approved", registration_id: REG });
    expect(h.sendTxEmail.mock.calls[0][0].ctaLabel).toBeUndefined();
  });
});

describe("wynik wysyłki - odmowa jest wartością, nie awarią", () => {
  it("czyste `ok`, `duplicate`, powód przed błędem, `send_failed` na końcu", async () => {
    const row = { email: "a@b.pl", status: "pending", registration_id: REG };
    expect(await run(row)).toEqual({ ok: true });
    h.sendTxEmail.mockResolvedValue({ ok: true, skipped: "duplicate" });
    expect(await run(row)).toEqual({ ok: true, skipped: "duplicate" });
    h.sendTxEmail.mockResolvedValue({
      ok: false,
      skipped: "suppressed",
      reason: "suppressed:bounce",
      error: "ignored",
    });
    expect(await run(row)).toEqual({ ok: false, error: "suppressed:bounce" });
    h.sendTxEmail.mockResolvedValue({ ok: false, error: "supabase_unavailable" });
    expect(await run(row)).toEqual({ ok: false, error: "supabase_unavailable" });
    h.sendTxEmail.mockResolvedValue({ ok: false, skipped: "no_recipient" });
    expect(await run(row)).toEqual({ ok: false, error: "send_failed" });
  });
});
