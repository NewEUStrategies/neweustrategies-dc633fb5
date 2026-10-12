// Publiczny zapis przez SERWER (`eventRegistration.functions.ts` +
// `eventRegistration.server.ts`, REG-04, decyzje D2/D3).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SUROWY ADRES W BAZIE albo kubełek kluczowany nagłówkiem, który klient
//      podrabia (`x-forwarded-for`) - limit prób rotuje się jednym nagłówkiem.
//   2. TOŻSAMOŚĆ Z CIAŁA ŻĄDANIA - najemca, osoba albo skrót adresu z ładunku
//      to dokładnie ta dziura, którą zamyka REG-04.
//   3. WYROCZNIA CZŁONKOSTWA - odpowiedź neutralna z czymkolwiek więcej
//      (`delivery`, klucz samoobsługi, identyfikator) mówi, czy adres jest
//      zapisany, a klucz daje obcemu władzę nad cudzym zgłoszeniem.
//   4. ZGUBIONY MAIL - po zapisie przez serwer przeglądarka nie wysyła już
//      potwierdzenia; bez dostawy serwera uczestnik nie dostaje NIC.
//   5. FAŁSZYWE OKNO WDROŻENIA - pominięty argument `_user_id` to inna
//      sygnatura (PGRST202) i cichy powrót do starej, dziurawej funkcji.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: żądanie, sesję, host, katalog najemców,
// klienta serwisowego, pocztę, licznik, wydanie biletu i `waitUntil`.
// `requestRateSubject`, budowa ładunku i walidator Zod jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestRateSubject } from "@/lib/server/rateSubject.server";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import {
  REGISTRATION_PAYLOAD_KEYS,
  type EventRegistrationRequest,
} from "@/lib/events/registrationPayload";
import { REGISTRATION_FIELD_LIMITS } from "@/lib/events/registrationFieldLimits";
import { EVENT_CONSENT_PURPOSE_COPY } from "@/lib/email-templates/tx-copy";

const CF_IP = "192.0.2.7";
const SPOOF_IP = "203.0.113.99";

const h = vi.hoisted(() => ({
  request: null as Request | null,
  userId: null as string | null,
  bearer: null as string | null,
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  hosts: [] as (string | null)[],
  rpc: vi.fn(),
  hostRpc: vi.fn(),
  hostBearers: [] as (string | null)[],
  background: [] as Promise<unknown>[],
  notice: vi.fn(),
  issue: vi.fn(),
  sendTxEmail: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.request === null) throw new Error("brak żądania");
    return h.request;
  },
}));
vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalUserIdFromRequest: async () => h.userId,
  optionalBearerFromRequest: async () => h.bearer,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.example" }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hosts.push(host);
    if (h.tenantThrows) throw new Error("katalog najemców niedostępny");
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.background.push(work);
  },
}));
vi.mock("@/lib/events/registrationSelfNotify.server", () => ({
  hostAnonClient: async (bearer: string | null = null) => {
    h.hostBearers.push(bearer);
    return { rpc: h.hostRpc };
  },
  sendRegistrationNoticeForManageToken: (tenantId: string, token: string) =>
    h.notice(tenantId, token),
}));
vi.mock("@/lib/events/ticketCodeNotify.server", () => ({
  issueAndSendTicketCodes: (id: string) => h.issue(id),
}));
vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: unknown) => h.sendTxEmail(input),
}));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: (opts: unknown) => h.rateLimit(opts),
}));

const { submitEventRegistrationForRequest, deliverRegistration, USER_AGENT_MAX } =
  await import("@/lib/events/eventRegistration.server");
const { submitEventRegistration } = await import("@/lib/events/eventRegistration.functions");

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER = "cccccccc-0000-4000-8000-00000000000c";
const REG = "dddddddd-0000-4000-8000-00000000000d";
const EVENT = "eeeeeeee-0000-4000-8000-00000000000e";
const TICKET = "bbbbbbbb-0000-4000-8000-00000000000b";
/** 32 znaki base64url - kształt `_event_new_qr_token()`. */
const MANAGE = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const QR = "Qr0123456789abcdefghijklmnopqrst";
const CONSENT_TOKEN = "Cn0123456789abcdefghijklmnopqrst";

const NEUTRAL = { ok: true, outcome: "check_email" };

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://nes.example/_serverFn/register", {
    method: "POST",
    headers: {
      "cf-connecting-ip": CF_IP,
      "x-forwarded-for": `${SPOOF_IP}, 10.0.0.1`,
      "user-agent": "Mozilla/5.0 (test)",
      ...headers,
    },
  });
}

function input(over: Partial<EventRegistrationRequest> = {}): EventRegistrationRequest {
  return {
    eventSlug: "kongres",
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna@example.com",
    consentDataProcessing: true,
    lang: "pl",
    ...over,
  };
}

function created(over: Record<string, unknown> = {}) {
  return {
    kind: "created",
    registration_id: REG,
    manage_token: MANAGE,
    qr_token: null,
    status: "pending",
    recipient: { email: "anna@example.com", first_name: "Anna", lang: "pl" },
    event: {
      id: EVENT,
      slug: "kongres",
      title_pl: "Kongres",
      title_en: "Congress",
      starts_at: "2099-09-01T08:00:00Z",
    },
    consent_confirmation: null,
    ...over,
  };
}

/** Odpowiedź `event_register_for_client` w kształcie kontraktu B1a. */
function respond(client: unknown, delivery: unknown = null): void {
  h.rpc.mockResolvedValue({ data: { client, delivery }, error: null });
}

/** Argumenty jedynego wywołania `event_register_for_client`. */
function registerArgs(): Record<string, unknown> {
  const calls = h.rpc.mock.calls.filter(([name]) => name === "event_register_for_client");
  expect(calls).toHaveLength(1);
  return calls[0]![1] as Record<string, unknown>;
}

/** Dokończ dostawę po odpowiedzi (`runAfterResponse`). */
async function drain(): Promise<void> {
  const pending = [...h.background];
  h.background = [];
  await Promise.all(pending);
}

function txCalls(type: string): Record<string, unknown>[] {
  return h.sendTxEmail.mock.calls
    .map(([arg]) => arg as Record<string, unknown>)
    .filter((arg) => arg.type === type);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.request = request();
  h.userId = null;
  h.bearer = null;
  h.tenant = TENANT;
  h.tenantThrows = false;
  h.hosts = [];
  h.rpc.mockReset();
  h.hostRpc.mockReset();
  h.hostRpc.mockResolvedValue({ data: { ok: true }, error: null });
  h.hostBearers = [];
  h.background = [];
  h.notice.mockReset();
  h.notice.mockResolvedValue({ ok: true });
  h.issue.mockReset();
  h.issue.mockResolvedValue(1);
  h.sendTxEmail.mockReset();
  h.sendTxEmail.mockResolvedValue({ ok: true });
  h.rateLimit.mockReset();
  h.rateLimit.mockResolvedValue(true);
  respond(NEUTRAL, created());
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tożsamość z serwera, nigdy z ciała żądania", () => {
  it("adres to solony skrót `ip:<32 hex>` z cf-connecting-ip - podrobiony x-forwarded-for nie ma wpływu", async () => {
    await submitEventRegistrationForRequest(input());
    const subject = registerArgs()._ip_subject;
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(subject).toBe(requestRateSubject(new Headers({ "cf-connecting-ip": CF_IP })));

    // Inny prefiks XFF - ten sam kubełek. Rotacja nagłówka nie daje nowego.
    h.rpc.mockClear();
    h.request = request({ "x-forwarded-for": "198.51.100.1" });
    await submitEventRegistrationForRequest(input());
    expect(registerArgs()._ip_subject).toBe(subject);
  });

  it("żaden surowy adres nie trafia do argumentów RPC", async () => {
    await submitEventRegistrationForRequest(input());
    const serialized = JSON.stringify(h.rpc.mock.calls);
    expect(serialized).not.toContain(CF_IP);
    expect(serialized).not.toContain(SPOOF_IP);
    expect(serialized).not.toContain("10.0.0.1");
  });

  it("przeglądarka jest przycięta do 400 znaków, a jej brak to NULL", async () => {
    h.request = request({ "user-agent": "U".repeat(1_000) });
    await submitEventRegistrationForRequest(input());
    expect(registerArgs()._user_agent).toBe("U".repeat(USER_AGENT_MAX));
    expect(USER_AGENT_MAX).toBe(400);

    h.rpc.mockClear();
    h.request = new Request("https://nes.example/x", {
      method: "POST",
      headers: { "cf-connecting-ip": CF_IP },
    });
    await submitEventRegistrationForRequest(input());
    expect(registerArgs()._user_agent).toBeNull();
  });

  it("najemca z zaufanego hosta, konto z sesji - jawnie, także jako NULL", async () => {
    await submitEventRegistrationForRequest(input());
    expect(h.hosts).toEqual(["nes.example"]);
    const anon = registerArgs();
    expect(anon._tenant_id).toBe(TENANT);
    // Klucz MUSI być obecny: brak argumentu to inna sygnatura (PGRST202).
    expect("_user_id" in anon).toBe(true);
    expect(anon._user_id).toBeNull();

    h.rpc.mockClear();
    h.userId = USER;
    await submitEventRegistrationForRequest(input());
    expect(registerArgs()._user_id).toBe(USER);
  });

  it("wywołuje dokładnie `event_register_for_client` z pięcioma nazwanymi argumentami", async () => {
    await submitEventRegistrationForRequest(input());
    expect(h.rpc.mock.calls[0]![0]).toBe("event_register_for_client");
    expect(Object.keys(registerArgs()).sort()).toEqual([
      "_ip_subject",
      "_tenant_id",
      "_user_agent",
      "_user_id",
      "p_payload",
    ]);
  });

  it("host bez najemcy (albo awaria katalogu) to `unknown` BEZ pytania bazy", async () => {
    h.tenant = null;
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "unknown",
    });
    h.tenant = TENANT;
    h.tenantThrows = true;
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.background).toEqual([]);
  });
});

describe("ładunek - biała lista kluczy", () => {
  it("nie niesie skrótu adresu, przeglądarki, najemcy ani osoby - nawet gdy wołający je podsunie", async () => {
    // Wołający funkcję serwerową wprost (z pominięciem walidatora) podsuwa
    // klucze tożsamości - ładunek bazy i tak ich nie zawiera.
    const poisoned = {
      ...input(),
      ip_hash: "deadbeefdeadbeef",
      user_agent: "forged",
      tenant_id: "ffffffff-0000-4000-8000-00000000000f",
      person_id: "ffffffff-0000-4000-8000-0000000000aa",
      user_id: USER,
    } as EventRegistrationRequest;
    await submitEventRegistrationForRequest(poisoned);
    const payload = registerArgs().p_payload as Record<string, unknown>;
    const allowed = new Set<string>(REGISTRATION_PAYLOAD_KEYS);
    expect(Object.keys(payload).filter((key) => !allowed.has(key))).toEqual([]);
    for (const key of ["ip_hash", "user_agent", "tenant_id", "person_id", "user_id"]) {
      expect(key in payload).toBe(false);
    }
    expect(JSON.stringify(payload)).not.toContain("deadbeef");
    expect(JSON.stringify(payload)).not.toContain("forged");
  });

  it("niesie język, wersję tekstów zgód i kod odsłaniający", async () => {
    await submitEventRegistrationForRequest(
      input({ lang: "en", ticketTypeId: TICKET, revealCode: " VIP-2099 " }),
    );
    const payload = registerArgs().p_payload as Record<string, unknown>;
    expect(payload.lang).toBe("en");
    expect(payload.consent_text_version).toBe(1);
    expect(payload.reveal_code).toBe("VIP-2099");
    expect(payload.ticket_type_id).toBe(TICKET);
    // Atrybucja NIE jest częścią `p_payload` - przypina ją serwer po zapisie.
    expect("attribution" in payload).toBe(false);
  });
});

describe("odpowiedź - do przeglądarki wraca wyłącznie `client`", () => {
  it("neutralna `check_email` przechodzi dosłownie - bez dostawy, klucza i identyfikatora", async () => {
    respond(
      NEUTRAL,
      created({
        consent_confirmation: { token: CONSENT_TOKEN, purposes: ["marketing"], lang: "pl" },
      }),
    );
    const result = await submitEventRegistrationForRequest(input());
    expect(result).toEqual(NEUTRAL);
    const serialized = JSON.stringify(result);
    for (const secret of [MANAGE, REG, CONSENT_TOKEN, "delivery", "anna@example.com"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("dokładnie ta sama odpowiedź dla „utworzono” i „już zapisany”", async () => {
    respond({ ...NEUTRAL }, created());
    const first = await submitEventRegistrationForRequest(input());
    respond({ ...NEUTRAL }, { ...created(), kind: "already_registered", manage_token: null });
    const second = await submitEventRegistrationForRequest(input());
    expect(first).toEqual(second);
  });

  it("baza dokleja klucz do odpowiedzi neutralnej - serwer go nie przepuszcza", async () => {
    respond({ ...NEUTRAL, manage_token: MANAGE, registration_id: REG }, created());
    expect(await submitEventRegistrationForRequest(input())).toEqual(NEUTRAL);
  });

  it("zapis zweryfikowanego właściciela przechodzi tak, jak złożyła go baza", async () => {
    const registered = {
      ok: true,
      outcome: "registered",
      registration_id: REG,
      manage_token: MANAGE,
      status: "approved",
      account_linked: true,
      consent_confirmation_required: false,
    };
    h.userId = USER;
    respond(registered, created({ status: "approved" }));
    expect(await submitEventRegistrationForRequest(input())).toEqual(registered);
  });

  it("odmowa niesie kod, a ogon tylko dla kodów z listami pól", async () => {
    respond({ ok: false, error: "terms_required", detail: "t-1,t-2" });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "terms_required",
      detail: "t-1,t-2",
    });
    respond({ ok: false, error: "sold_out", detail: "anna@example.com" });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "sold_out",
    });
    expect(h.background).toEqual([]);
  });

  it("nieczytelna odpowiedź i błąd bazy to `unknown` - z logiem po stronie serwera", async () => {
    h.rpc.mockResolvedValue({ data: "kosmos", error: null });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "unknown",
    });
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "unknown",
    });
    respond({ ok: false, error: "unknown" });
    await submitEventRegistrationForRequest(input());
    const logged = errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(logged).toContain("[events] registration refused as unknown");
    expect(logged).toContain("[events] registration rpc failed");
    // Odmowa bazy NIE uruchamia starej funkcji - to nie jest okno wdrożenia.
    expect(h.hostRpc).not.toHaveBeenCalled();
  });
});

describe("dostawa po odpowiedzi", () => {
  it("dostawa biegnie pod `waitUntil`, nie przed odpowiedzią", async () => {
    let release: () => void = () => undefined;
    h.notice.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );
    // Mail wisi - a odpowiedź i tak wraca.
    const result = await submitEventRegistrationForRequest(input());
    expect(result).toEqual(NEUTRAL);
    expect(h.background).toHaveLength(1);
    release();
    await drain();
    expect(h.notice).toHaveBeenCalledTimes(1);
  });

  it("„utworzono”: dokładnie jedno potwierdzenie kluczem samoobsługi i jedna atrybucja", async () => {
    const attribution = { first: null, last: null, ad_consent: false };
    await submitEventRegistrationForRequest(input({ attribution }));
    await drain();
    expect(h.notice).toHaveBeenCalledTimes(1);
    expect(h.notice).toHaveBeenCalledWith(TENANT, MANAGE);
    expect(h.hostRpc).toHaveBeenCalledTimes(1);
    expect(h.hostRpc).toHaveBeenCalledWith("event_registration_attribution_attach", {
      p_payload: { manage_token: MANAGE, ...attribution },
    });
    // Atrybucja idzie klientem anonimowym z nagłówkiem hosta - bez tokenu.
    expect(h.hostBearers).toEqual([null]);
    // Zgłoszenie oczekujące nie dostaje biletu ani maila o zajętym adresie.
    expect(h.issue).not.toHaveBeenCalled();
    expect(txCalls("event_registration_already_registered")).toEqual([]);
  });

  it("bez atrybucji (brak zgody na pomiar) nic nie jest przypinane", async () => {
    await submitEventRegistrationForRequest(input({ attribution: null }));
    await drain();
    expect(h.hostRpc).not.toHaveBeenCalled();
    expect(h.notice).toHaveBeenCalledTimes(1);
  });

  it("zgłoszenie zatwierdzone i rozliczone dostaje od razu bilet z kodem QR", async () => {
    respond(NEUTRAL, created({ status: "approved", qr_token: QR }));
    await submitEventRegistrationForRequest(input());
    await drain();
    expect(h.issue).toHaveBeenCalledTimes(1);
    expect(h.issue).toHaveBeenCalledWith(REG);
  });

  it("zatwierdzone, ale nierozliczone (bez kodu z zapisu) - bilet czeka na płatność", async () => {
    respond(NEUTRAL, created({ status: "approved", qr_token: null }));
    await submitEventRegistrationForRequest(input());
    await drain();
    expect(h.issue).not.toHaveBeenCalled();
  });

  it.each(["pending", "waitlist"])(
    "zgłoszenie %s nie dostaje biletu, nawet gdy odpowiedź niesie kod z zapisu",
    async (status) => {
      // Bilet wpuszcza na salę - wydanie go zgłoszeniu czekającemu na decyzję
      // organizatora albo na liście rezerwowej obiecywałoby miejsce, którego
      // nie ma. Kod z zapisu nie jest tu żadnym dowodem przyjęcia.
      respond(NEUTRAL, created({ status, qr_token: QR }));
      await submitEventRegistrationForRequest(input());
      await drain();
      expect(h.issue).not.toHaveBeenCalled();
      // Potwierdzenie zapisu wychodzi i tak - mówi, że zgłoszenie czeka.
      expect(h.notice).toHaveBeenCalledTimes(1);
    },
  );

  it("„już zapisany”: dokładnie jedna wiadomość do właściciela adresu - bez poświadczeń", async () => {
    respond(NEUTRAL, {
      ...created(),
      kind: "already_registered",
      manage_token: MANAGE,
      qr_token: QR,
      status: "approved",
    });
    await submitEventRegistrationForRequest(
      input({ attribution: { first: null, last: null, ad_consent: true } }),
    );
    await drain();
    expect(h.notice).not.toHaveBeenCalled();
    expect(h.issue).not.toHaveBeenCalled();
    expect(h.hostRpc).not.toHaveBeenCalled();
    const sent = txCalls("event_registration_already_registered");
    expect(sent).toHaveLength(1);
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("anna@example.com");
    expect(mail.tenantId).toBe(TENANT);
    expect(mail.ctaPath).toBe("/events/kongres");
    expect(mail.idempotencyKey).toMatch(
      new RegExp(`^event-registration-duplicate:${REG}:\\d{4}-\\d{2}-\\d{2}$`),
    );
    // Ani klucz samoobsługi, ani kod QR nie trafiają do wiadomości.
    expect(JSON.stringify(mail)).not.toContain(MANAGE);
    expect(JSON.stringify(mail)).not.toContain(QR);
  });

  it("zgody do potwierdzenia: mail double opt-in z tokenem we FRAGMENCIE adresu", async () => {
    respond(
      NEUTRAL,
      created({
        consent_confirmation: {
          token: CONSENT_TOKEN,
          purposes: ["marketing", "partner_sharing", "kosmos"],
          lang: "en",
        },
      }),
    );
    await submitEventRegistrationForRequest(input());
    await drain();
    const sent = txCalls("event_consent_confirm");
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.ctaPath).toBe(`/event-consent/confirm#token=${CONSENT_TOKEN}`);
    expect(mail.lang).toBe("en");
    expect(mail.to).toBe("anna@example.com");
    // Klucz idempotencji ze SKRÓTU tokenu - sam token nie trafia do dziennika.
    expect(mail.idempotencyKey).toMatch(/^event-consent-confirm:[0-9a-f]{32}$/);
    expect(String(mail.idempotencyKey)).not.toContain(CONSENT_TOKEN);
    // Jeden wiersz na znany cel, z dokładnym napisem checkboxa.
    const values = (mail.details as { value: string }[]).map((row) => row.value);
    expect(values).toContain(EVENT_CONSENT_PURPOSE_COPY.en.marketing);
    expect(values).toContain(EVENT_CONSENT_PURPOSE_COPY.en.partner_sharing);
    expect(values).not.toContain("kosmos");
    // Kubełek odbiorcy 3 / 60 min, solony skrót - bez e-maila w `rate_limits`.
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    const limit = h.rateLimit.mock.calls[0]![0] as Record<string, unknown>;
    expect(limit).toMatchObject({
      scope: "event.consent.recipient",
      max: 3,
      windowMinutes: 60,
      failClosed: true,
    });
    expect(limit.subjectId).toMatch(/^recipient:[0-9a-f]{32}$/);
    expect(String(limit.subjectId)).not.toContain("anna");
  });

  it("ponad limit odbiorcy mail double opt-in nie wychodzi", async () => {
    h.rateLimit.mockResolvedValue(false);
    respond(
      NEUTRAL,
      created({
        consent_confirmation: { token: CONSENT_TOKEN, purposes: ["marketing"], lang: "pl" },
      }),
    );
    await submitEventRegistrationForRequest(input());
    await drain();
    expect(txCalls("event_consent_confirm")).toEqual([]);
    expect(h.notice).toHaveBeenCalledTimes(1);
  });

  it("awaria każdego kroku dostawy nie zmienia odpowiedzi ani nie zatrzymuje kolejnych", async () => {
    h.notice.mockRejectedValue(new Error("poczta padła"));
    h.issue.mockRejectedValue(new Error("baza padła"));
    h.hostRpc.mockRejectedValue(new Error("sieć padła"));
    h.sendTxEmail.mockRejectedValue(new Error("kolejka padła"));
    respond(
      NEUTRAL,
      created({
        status: "approved",
        qr_token: QR,
        consent_confirmation: { token: CONSENT_TOKEN, purposes: ["marketing"], lang: "pl" },
      }),
    );
    const result = await submitEventRegistrationForRequest(
      input({ attribution: { first: null, last: null, ad_consent: false } }),
    );
    expect(result).toEqual(NEUTRAL);
    await expect(drain()).resolves.toBeUndefined();
    expect(h.notice).toHaveBeenCalledTimes(1);
    expect(h.issue).toHaveBeenCalledTimes(1);
    expect(h.hostRpc).toHaveBeenCalledTimes(1);
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("`deliverRegistration` nigdy nie rzuca", async () => {
    h.notice.mockImplementation(() => {
      throw new Error("synchronicznie");
    });
    await expect(
      deliverRegistration({
        tenantId: TENANT,
        attribution: null,
        delivery: {
          kind: "created",
          registrationId: REG,
          manageToken: MANAGE,
          qrToken: null,
          status: "pending",
          recipient: null,
          event: null,
          consentConfirmation: null,
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("okno wdrożenia - stara `event_register` tylko na PGRST202/42883", () => {
  it.each(["PGRST202", "42883"])(
    "%s: stary zapis klientem z hostem, mapowany na nowy kształt",
    async (code) => {
      h.rpc.mockResolvedValue({ data: null, error: { code, message: "function not found" } });
      h.hostRpc.mockResolvedValue({
        data: {
          registration_id: REG,
          status: "approved",
          manage_token: MANAGE,
          qr_token: QR,
          payment_required: false,
        },
        error: null,
      });
      const result = await submitEventRegistrationForRequest(input());
      expect(h.hostRpc.mock.calls[0]![0]).toBe("event_register");
      const legacyPayload = (h.hostRpc.mock.calls[0]![1] as { p_payload: Record<string, unknown> })
        .p_payload;
      expect(legacyPayload.email).toBe("anna@example.com");
      expect(result).toMatchObject({ ok: true, outcome: "registered", registration_id: REG });
      // Dostawa „utworzono" także w oknie wdrożenia - przeglądarka już nie wysyła maili.
      await drain();
      expect(h.notice).toHaveBeenCalledWith(TENANT, MANAGE);
      expect(h.issue).toHaveBeenCalledWith(REG);
    },
  );

  it("token wołającego jedzie dalej TYLKO przy zweryfikowanym koncie", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    h.hostRpc.mockResolvedValue({ data: { registration_id: REG, status: "pending" }, error: null });
    h.bearer = "nieważny-token";
    await submitEventRegistrationForRequest(input());
    h.userId = USER;
    h.bearer = "ważny-token";
    await submitEventRegistrationForRequest(input());
    // Pierwszy (gość) - bez tokenu; drugi - z tokenem. Atrybucji nie było.
    expect(h.hostBearers).toEqual([null, "ważny-token"]);
  });

  it("stara odmowa wyjątkiem wraca kodem z ogonem list, a obcy błąd - `unknown`", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    h.hostRpc.mockResolvedValue({
      data: null,
      error: { message: "missing_required_fields: diet,vat" },
    });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "missing_required_fields",
      detail: "diet,vat",
    });
    h.hostRpc.mockResolvedValue({
      data: null,
      error: { message: "already_registered: anna@example.com" },
    });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "already_registered",
    });
    h.hostRpc.mockResolvedValue({
      data: null,
      error: { message: 'violates check constraint "x"' },
    });
    expect(await submitEventRegistrationForRequest(input())).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(h.background).toEqual([]);
  });
});

describe("submitEventRegistration (deklaracja)", () => {
  const valid = {
    eventSlug: "kongres",
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna@example.com",
    consentDataProcessing: true,
    lang: "pl",
  };

  it("jest publiczna i POST - gość też się zapisuje, a każde wywołanie liczy się do limitu", () => {
    expect(serverFnMiddlewareNames(submitEventRegistration)).toEqual([]);
    expect(Reflect.get(submitEventRegistration as object, "method")).toBe("POST");
  });

  it("handler przekazuje wejście po walidacji do warstwy serwerowej", async () => {
    expect(
      await callServerFn(submitEventRegistration, { data: valid, context: { supabase: null } }),
    ).toEqual(NEUTRAL);
    expect(registerArgs()._tenant_id).toBe(TENANT);
  });

  it("odrzuca klucze tożsamości podsunięte w ciele żądania", () => {
    for (const extra of [
      { ip_hash: "deadbeef" },
      { user_agent: "x" },
      { tenantId: TENANT },
      { personId: REG },
      { userId: USER },
    ]) {
      expect(() =>
        validateServerFnInput(submitEventRegistration, { ...valid, ...extra }),
      ).toThrow();
    }
  });

  it("sufity pól są WSPÓLNE z bazą - za długi tekst to odmowa, nie przycięcie", () => {
    const L = REGISTRATION_FIELD_LIMITS;
    const ok = validateServerFnInput<Record<string, unknown>>(submitEventRegistration, {
      ...valid,
      firstName: "A".repeat(L.name),
      email: `${"a".repeat(L.email - 12)}@example.com`,
      jobTitle: "J".repeat(L.jobTitle),
      companyText: "C".repeat(L.companyText),
      socialProfileUrl: `https://${"s".repeat(L.socialProfileUrl - 8)}`,
      phone: "1".repeat(L.phoneMax),
      revealCode: "R".repeat(L.code),
    });
    expect(ok.firstName).toBe("A".repeat(L.name));
    for (const over of [
      { firstName: "A".repeat(L.name + 1) },
      { lastName: "A".repeat(L.name + 1) },
      { email: `${"a".repeat(L.email)}@x.pl` },
      { phone: "1".repeat(L.phoneMax + 1) },
      { jobTitle: "J".repeat(L.jobTitle + 1) },
      { companyText: "C".repeat(L.companyText + 1) },
      { socialProfileUrl: `https://${"s".repeat(L.socialProfileUrl)}` },
      { accessCode: "A".repeat(L.code + 1) },
      { revealCode: "R".repeat(L.code + 1) },
    ]) {
      expect(() => validateServerFnInput(submitEventRegistration, { ...valid, ...over })).toThrow();
    }
  });

  it("zła atrybucja zdejmuje WYŁĄCZNIE atrybucję - zapis nie przepada przez UTM", () => {
    const parsed = validateServerFnInput<Record<string, unknown>>(submitEventRegistration, {
      ...valid,
      attribution: { first: { utm_source: "x".repeat(500) }, last: null, ad_consent: true },
    });
    expect(parsed.attribution).toBeNull();
  });

  it("wymaga języka formularza i zgody na przetwarzanie danych jako wartości logicznej", () => {
    expect(() =>
      validateServerFnInput(submitEventRegistration, { ...valid, lang: "de" }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(submitEventRegistration, { ...valid, consentDataProcessing: "true" }),
    ).toThrow();
  });
});
