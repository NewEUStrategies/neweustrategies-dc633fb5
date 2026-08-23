// Wysyłka poczty transakcyjnej - ostatnia warstwa aplikacji przed kolejką.
//
// DLACZEGO CAŁY DOWÓD MUSI POWSTAĆ TUTAJ. Maila nie da się wycofać. Dokument
// HTML poszedł do skrzynki i jest w niej na zawsze, a poprawka dotyczy dopiero
// NASTĘPNEJ wysyłki. Nie ma tu odpowiednika rollbacku ani „edytuj po
// publikacji": jedyny moment, w którym cokolwiek da się jeszcze zatrzymać,
// jest przed `enqueue_email`.
//
// Dlatego ten plik pilnuje trzech rzeczy, których w produkcji nikt nie zobaczy
// na czas:
//
//  1. BRAK KONFIGURACJI MUSI DEGRADOWAĆ SIĘ JAWNIE. Gdyby wysyłka bez klucza
//     service-role zwracała sukces, potwierdzenie zapisu albo ostrzeżenie o
//     nieudanej płatności nigdy by nie wyszło, a wywołujący (webhook płatności)
//     zapisałby u siebie „powiadomiono". Cisza po obu stronach to najgorszy
//     możliwy wariant, bo nie zostawia nawet reklamacji.
//  2. HIGIENA LISTY DOTYCZY KAŻDEGO TYPU. Wysyłka na adres po skardze na spam
//     kosztuje reputację CAŁEJ domeny nadawczej - łącznie z pocztą, bez której
//     nie da się zalogować. W drugą stronę: wypis z newslettera nie może
//     zatrzymać ostrzeżenia o płatności.
//  3. IDEMPOTENCJA JEST WŁASNOŚCIĄ KLUCZA, NIE SZCZĘŚCIA. Ten sam klucz musi
//     dawać ten sam `message_id`, inaczej ponowienie webhooka wysyła drugi
//     mail o tej samej fakturze.
//
// CZEGO TU NIE MA. Ten moduł KOLEJKUJE, a nie rozmawia z dostawcą poczty -
// odpowiedzi 5xx, limity i timeouty dostawcy żyją w `provider.server.ts`
// i `queueDrain.server.ts` i tam mają swoje testy. Udawanie ich tutaj
// dowodziłoby wyłącznie istnienia atrapy.
//
// Zero sieci, zero prawdziwego klucza: klient bazy jest atrapą, a `createClient`
// podmieniony.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { SuppressionReason } from "@/lib/email/suppressionPolicy";

const h = vi.hoisted(() => ({
  createClient: vi.fn<(url: string, key: string, options?: unknown) => never>(),
  /**
   * Wymuszona odpowiedź bramy wykluczeń. Domyślnie `null` - wtedy działa
   * PRAWDZIWA brama (`checkSendAllowed` na atrapie RPC), bo to jej decyzje
   * są tu przedmiotem dowodu. Podmiana służy jednemu przypadkowi, którego
   * przez publiczne wejście nie da się wywołać: blokada bez rozpoznanego
   * powodu.
   */
  gateOverride: null as { allowed: boolean; hit: null; tenantId: string | null } | null,
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

vi.mock("@/lib/email/suppression.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/suppression.server")>();
  return {
    ...actual,
    checkSendAllowed: async (
      admin: Parameters<typeof actual.checkSendAllowed>[0],
      input: Parameters<typeof actual.checkSendAllowed>[1],
    ) => h.gateOverride ?? (await actual.checkSendAllowed(admin, input)),
  };
});

import {
  enqueueRawEmail,
  formatDate,
  formatMoney,
  sendTxEmail,
  type RawEmailInput,
  type TxSendInput,
} from "@/lib/email/transactional.server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let errorSpy: ReturnType<typeof vi.spyOn>;
let savedEnv: Record<string, string | undefined>;

/** Przełączniki atrapy bazy sterowane z pojedynczych testów. */
const state = { duplicate: false, logReadFails: false, logWriteFails: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wiersze zapisane do `email_send_log` w kolejności zapisu. */
function logInserts(): Record<string, unknown>[] {
  return db
    .chainsFor("email_send_log")
    .map((chain) => chain.argsOf("insert")?.[0])
    .filter(isRecord);
}

/** Ładunek ostatniego kolejkowania - brak wywołania to błąd testu. */
function queuedPayload(): Record<string, unknown> {
  const call = rpc.lastCall("enqueue_email");
  if (!call) throw new Error("test: wiadomość nie trafiła do kolejki");
  const payload = call.arg("payload");
  if (!isRecord(payload)) throw new Error("test: ładunek kolejki nie jest obiektem");
  return payload;
}

/** Wartość pola ładunku jako tekst (inny typ to błąd testu, nie cichy `String()`). */
function queuedText(field: string): string {
  const value = queuedPayload()[field];
  if (typeof value !== "string") throw new Error(`test: pole "${field}" nie jest tekstem`);
  return value;
}

/** Wiersz blokady w kształcie, w jakim oddaje go `email_filter_suppressed`. */
function suppress(email: string, reason: SuppressionReason, scope = "permanent"): void {
  rpc.setData("email_filter_suppressed", [{ email, reason, scope, expires_at: null }]);
}

function txInput(overrides: Partial<TxSendInput> = {}): TxSendInput {
  return {
    type: "payment_failed",
    to: "anna@example.test",
    idempotencyKey: "invoice_in_2026_08_1",
    ...overrides,
  };
}

function rawInput(overrides: Partial<RawEmailInput> = {}): RawEmailInput {
  return {
    to: "anna@example.test",
    subject: "Twoje podsumowanie dnia",
    html: "<p>Trzy nowe komentarze</p>",
    label: "digest_daily",
    idempotencyKey: "digest_2026_08_22_anna",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));

  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "https://baza.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-atrapa";

  state.duplicate = false;
  state.logReadFails = false;
  state.logWriteFails = false;
  h.gateOverride = null;

  db = supabaseFromStub();
  rpc = supabaseRpcStub();

  // Log wysyłki obsługuje DWA różne zapytania: zapis próby (insert) i pytanie
  // o duplikat (select). Atrapa musi je rozróżniać, inaczej pierwszy zapis
  // udawałby, że wiadomość już poszła.
  db.setResponse("email_send_log", (chain) => {
    if (chain.has("insert"))
      return state.logWriteFails ? fail("permission denied", "42501") : ok(null);
    if (state.logReadFails) return fail("permission denied", "42501");
    return ok(state.duplicate ? [{ id: "log-1" }] : []);
  });
  db.setResponse("newsletter_subscribers", ok(null));
  db.setResponse("name_dictionary", ok(null));
  db.setResponse("site_settings", ok(null));

  rpc.setData("email_resolve_tenant_for_address", TENANT);
  rpc.setData("email_filter_suppressed", []);
  rpc.setData("enqueue_email", null);

  h.createClient.mockReset();
  h.createClient.mockReturnValue({ from: db.from, rpc: rpc.rpc } as never);

  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  errorSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Konfiguracja dostępu do kolejki (serviceClient)
// ---------------------------------------------------------------------------
describe("dostęp do kolejki", () => {
  it("komplet zmiennych buduje klienta service-role bez trwałej sesji", async () => {
    await sendTxEmail(txInput());

    expect(h.createClient).toHaveBeenCalledWith(
      "https://baza.example.test",
      "service-role-atrapa",
      {
        auth: { persistSession: false },
      },
    );
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("brak adresu bazy zatrzymuje wysyłkę JAWNIE - wywołujący dostaje ok:false i powód", async () => {
    delete process.env.SUPABASE_URL;

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: false, error: "supabase_unavailable" });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("brak klucza service-role zatrzymuje wysyłkę JAWNIE, a nie po cichu", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const result = await sendTxEmail(txInput());

    expect(result.ok).toBe(false);
    expect(result.error).toBe("supabase_unavailable");
    // Brak `skipped` jest tu istotny: „pominięto świadomie" to inna informacja
    // niż „nie zadziałało", a webhook płatności rozróżnia je w swoim logu.
    expect(result.skipped).toBeUndefined();
  });

  it("bez konfiguracji NIC nie trafia do kolejki - nie ma udawanego sukcesu", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await sendTxEmail(txInput());

    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
    expect(logInserts()).toHaveLength(0);
  });

  it("pusty klucz w środowisku liczy się jak brak klucza", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";

    await expect(sendTxEmail(txInput())).resolves.toEqual({
      ok: false,
      error: "supabase_unavailable",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("wysyłka surowego HTML bez konfiguracji też mówi wprost, że nie wyszła", async () => {
    delete process.env.SUPABASE_URL;

    await expect(enqueueRawEmail(rawInput())).resolves.toEqual({
      ok: false,
      error: "supabase_unavailable",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Brak odbiorcy
// ---------------------------------------------------------------------------
describe("brak odbiorcy", () => {
  it("pusty adres nie dotyka bazy - nie ma czego wysłać", async () => {
    const result = await sendTxEmail(txInput({ to: "" }));

    expect(result).toEqual({ ok: false, skipped: "no_recipient" });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("adres z samych spacji to również brak odbiorcy", async () => {
    await expect(sendTxEmail(txInput({ to: "   \n" }))).resolves.toEqual({
      ok: false,
      skipped: "no_recipient",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("wysyłka surowego HTML bez adresu kończy się tak samo", async () => {
    const result = await enqueueRawEmail(rawInput({ to: " " }));

    expect(result).toEqual({ ok: false, skipped: "no_recipient" });
    expect(rpc.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ścieżka szczęśliwa
// ---------------------------------------------------------------------------
describe("kolejkowanie wiadomości", () => {
  it("wiadomość trafia do kolejki transakcyjnej z kompletem pól potrzebnych do wysyłki", async () => {
    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: true });
    expect(rpc.lastCall("enqueue_email")?.arg("queue_name")).toBe("transactional_emails");
    expect(queuedPayload()).toMatchObject({
      to: "anna@example.test",
      from: "New European Strategies <noreply@neweuropeanstrategies.com>",
      sender_domain: "notify.mail.neweuropeanstrategies.com",
      purpose: "transactional",
      label: "payment_failed",
      idempotency_key: "invoice_in_2026_08_1",
      tenant_id: TENANT,
      queued_at: "2026-08-22T10:00:00.000Z",
    });
  });

  it("adres normalizuje się do zapisu, którego pilnuje baza - inaczej blokada z innej wielkości liter nie zadziała", async () => {
    await sendTxEmail(txInput({ to: "  Anna@Example.TEST " }));

    expect(queuedPayload().to).toBe("anna@example.test");
    expect(logInserts()[0]?.recipient_email).toBe("anna@example.test");
  });

  it("ślad 'pending' powstaje PRZED kolejkowaniem - inaczej awaria między zapisami gubi wiadomość bez śladu", async () => {
    let logAtEnqueue: Record<string, unknown>[] = [];
    rpc.setResponse("enqueue_email", () => {
      logAtEnqueue = logInserts();
      return ok(null);
    });

    await sendTxEmail(txInput());

    expect(logAtEnqueue).toHaveLength(1);
    expect(logAtEnqueue[0]).toMatchObject({
      status: "pending",
      template_name: "payment_failed",
      recipient_email: "anna@example.test",
    });
  });

  it("identyfikator w logu i w kolejce to ten sam identyfikator - inaczej raport dostarczalności nie skleja wiersza z wysyłką", async () => {
    await sendTxEmail(txInput());

    const logged = logInserts()[0]?.message_id;
    expect(typeof logged).toBe("string");
    expect(queuedPayload().message_id).toBe(logged);
    expect(String(logged)).toMatch(UUID_V4);
  });

  it("każde uruchomienie dostaje własny run_id do korelacji w logach drenu", async () => {
    await sendTxEmail(txInput());

    expect(String(queuedPayload().run_id)).toMatch(UUID_V4);
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("do kolejki idą obie postacie wiadomości: HTML i tekst dla klientów bez HTML", async () => {
    await sendTxEmail(txInput());

    expect(queuedText("html")).toContain("<");
    expect(queuedText("text").length).toBeGreaterThan(0);
    expect(queuedText("text")).not.toContain("<td");
  });
});

// ---------------------------------------------------------------------------
// Język odbiorcy
// ---------------------------------------------------------------------------
describe("język wiadomości", () => {
  it("brak języka to polski - domyślny język serwisu", async () => {
    await sendTxEmail(txInput());

    expect(queuedText("subject")).toContain("Płatność nie powiodła się");
    expect(queuedText("html")).toContain("Nie udało się pobrać płatności");
  });

  it("język angielski zmienia temat i treść, a nie tylko nagłówek", async () => {
    await sendTxEmail(txInput({ lang: "en" }));

    expect(queuedText("subject")).toContain("Payment failed");
    expect(queuedText("html")).toContain("We could not take your payment");
    expect(queuedText("html")).not.toContain("Nie udało się pobrać płatności");
  });

  it("polski wybrany wprost daje ten sam wynik co brak wyboru", async () => {
    const lang: EmailLang = "pl";

    await sendTxEmail(txInput({ lang }));

    expect(queuedText("subject")).toContain("Płatność nie powiodła się");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Treść i personalizacja
// ---------------------------------------------------------------------------
describe("treść wiadomości", () => {
  it("nazwa planu z wywołania trafia do TEMATU - odbiorca widzi, czego dotyczy ostrzeżenie", async () => {
    await sendTxEmail(txInput({ subjectName: "Klub NES" }));

    expect(queuedText("subject")).toContain("Klub NES");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("bez nazwy planu temat zostaje ogólny, bez pustego łącznika", async () => {
    await sendTxEmail(txInput());

    expect(queuedText("subject")).not.toContain(" -  |");
    expect(queuedText("subject")).toContain("New European Strategies");
  });

  it("szczegóły zdarzenia (kwota, data próby) są w treści, a nie tylko w bazie", async () => {
    await sendTxEmail(
      txInput({
        details: [
          { label: "Kwota", value: "199,00 zł" },
          { label: "Kolejna próba", value: "24 sierpnia 2026" },
        ],
      }),
    );

    expect(queuedText("html")).toContain("199,00 zł");
    expect(queuedText("html")).toContain("24 sierpnia 2026");
  });

  it("zmienne personalizacji budują akapit właściwy dla zdarzenia, a nie treść ogólną", async () => {
    await sendTxEmail(
      txInput({
        type: "subscription_confirmed",
        bodyVars: {
          planName: "Klub NES",
          amount: "199,00 zł",
          interval: "miesięcznie",
          renewsAt: "1 września 2026",
        },
      }),
    );

    const html = queuedText("html");
    expect(html).toContain("Klub NES");
    expect(html).toContain("199,00 zł");
    expect(html).toContain("Kolejne odnowienie nastąpi 1 września 2026");
  });

  it("dodatkowy akapit z wywołania dokłada się do treści", async () => {
    await sendTxEmail(txInput({ extra: "Prorata zostanie rozliczona w kolejnym okresie." }));

    expect(queuedText("html")).toContain("Prorata zostanie rozliczona");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("imię z metadanych oszczędza zapytanie o subskrybenta i wchodzi do powitania", async () => {
    db.setResponse("name_dictionary", ok({ gender: "female", vocative_pl: "Anno" }));

    await sendTxEmail(txInput({ metaName: "Anna Kowalska" }));

    expect(db.chainsFor("newsletter_subscribers")).toHaveLength(0);
    expect(queuedText("html")).toContain("Anno");
  });

  it("bez imienia mail i tak wychodzi - powitanie schodzi na formę ogólną", async () => {
    await sendTxEmail(txInput());

    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
    expect(queuedText("html").length).toBeGreaterThan(0);
  });

  it("imię ze słownika subskrybentów działa, gdy metadanych nie ma", async () => {
    db.setResponse("newsletter_subscribers", ok({ first_name: "Marek", display_name: null }));
    db.setResponse("name_dictionary", ok({ gender: "male", vocative_pl: "Marku" }));

    await sendTxEmail(txInput());

    expect(queuedText("html")).toContain("Marku");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adres CTA
// ---------------------------------------------------------------------------
describe("przycisk akcji", () => {
  it("bezwzględny adres CTA ma pierwszeństwo - jednorazowy link do portalu płatności nie może zostać podmieniony na ścieżkę serwisu", async () => {
    await sendTxEmail(
      txInput({
        ctaUrl: "https://billing.stripe.test/p/session_abc",
        ctaPath: "/konto/subskrypcja",
      }),
    );

    const html = queuedText("html");
    expect(html).toContain("https://billing.stripe.test/p/session_abc");
    expect(html).not.toContain("https://neweuropeanstrategies.com/konto/subskrypcja");
  });

  it("sama ścieżka doklejana jest do adresu serwisu", async () => {
    await sendTxEmail(txInput({ ctaPath: "/konto/subskrypcja" }));

    expect(queuedText("html")).toContain("https://neweuropeanstrategies.com/konto/subskrypcja");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("własna etykieta przycisku zastępuje domyślną", async () => {
    await sendTxEmail(txInput({ ctaPath: "/konto", ctaLabel: "Wejdź do panelu" }));

    expect(queuedText("html")).toContain("Wejdź do panelu");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("bez CTA mail wychodzi bez przycisku, a nie z przyciskiem donikąd", async () => {
    await sendTxEmail(txInput());

    expect(queuedText("html")).not.toContain("Zaktualizuj metodę płatności");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Treści edytowalne w panelu
// ---------------------------------------------------------------------------
describe("nadpisania treści z panelu", () => {
  /** Wartość ustawienia `tx_email_overrides` w kształcie zapisywanym przez panel. */
  function overrides(fields: Record<string, string>): Record<string, unknown> {
    return { value: { team_seat_grace: { pl: fields } } };
  }

  it("temat ustawiony w panelu wygrywa z domyślnym - redakcja nie musi czekać na wdrożenie", async () => {
    db.setResponse("site_settings", ok(overrides({ subject: "Zostały {daysLeft} dni dostępu" })));

    await sendTxEmail(txInput({ type: "team_seat_grace", bodyVars: { daysLeft: 5 } }));

    expect(queuedText("subject")).toBe("Zostały 5 dni dostępu");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("tokeny w nadpisaniu podstawiają dane zdarzenia, a nieznane znikają bez śladu w treści", async () => {
    db.setResponse(
      "site_settings",
      ok(
        overrides({
          heading: "{orgName}: dostęp do {planName}",
          intro: "Cześć {firstName}, dostęp trwa do {accessUntil}.",
          note: "Nieznany token {czegoNieMa} nie może wyciec do skrzynki.",
        }),
      ),
    );

    await sendTxEmail(
      txInput({
        type: "team_seat_grace",
        metaName: "Anna",
        bodyVars: {
          orgName: "Fundacja Test",
          planName: "Klub NES",
          accessUntil: "1 września 2026",
        },
      }),
    );

    const html = queuedText("html");
    expect(html).toContain("Fundacja Test: dostęp do Klub NES");
    expect(html).toContain("dostęp trwa do 1 września 2026");
    expect(html).not.toContain("{czegoNieMa}");
  });

  it("nadpisanie etykiety przycisku i akapitu dodatkowego dochodzi do wiadomości", async () => {
    db.setResponse(
      "site_settings",
      ok(overrides({ cta: "Przedłuż dostęp", extra: "Płatność rozliczymy proporcjonalnie." })),
    );

    await sendTxEmail(txInput({ type: "team_seat_grace", ctaPath: "/konto" }));

    expect(queuedText("html")).toContain("Przedłuż dostęp");
    expect(queuedText("html")).toContain("Płatność rozliczymy proporcjonalnie.");
  });

  it("puste pole w panelu to brak nadpisania, a nie pusty nagłówek w mailu", async () => {
    db.setResponse("site_settings", ok(overrides({ heading: "   ", subject: "" })));

    await sendTxEmail(txInput({ type: "team_seat_grace" }));

    expect(queuedText("subject").length).toBeGreaterThan(0);
    expect(queuedText("html").length).toBeGreaterThan(0);
  });

  it("awaria odczytu nadpisań nie zatrzymuje maila - wychodzi treść domyślna", async () => {
    db.setResponse("site_settings", fail("permission denied", "42501"));

    const result = await sendTxEmail(txInput({ type: "team_seat_grace" }));

    expect(result).toEqual({ ok: true });
    expect(queuedText("subject").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Brama listy wykluczeń
// ---------------------------------------------------------------------------
describe("brama listy wykluczeń", () => {
  it("skarga na spam zatrzymuje nawet ostrzeżenie o nieudanej płatności - reputacja domeny jest wspólna dla całej poczty", async () => {
    suppress("anna@example.test", "complaint");

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: false, skipped: "suppressed", reason: "suppressed:complaint" });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("twarde odbicie zatrzymuje wysyłkę - adres nie istnieje, każda próba psuje statystyki", async () => {
    suppress("anna@example.test", "hard_bounce");

    const result = await sendTxEmail(txInput({ type: "event_registered" }));

    expect(result.skipped).toBe("suppressed");
    expect(result.reason).toBe("suppressed:hard_bounce");
  });

  it("blokada ręczna operatora również zatrzymuje pocztę transakcyjną", async () => {
    suppress("anna@example.test", "manual");

    await expect(sendTxEmail(txInput({ type: "donation_received" }))).resolves.toMatchObject({
      skipped: "suppressed",
      reason: "suppressed:manual",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("wypis z newslettera NIE zatrzymuje maila o nieudanej płatności - to zgoda marketingowa, nie zakaz kontaktu", async () => {
    suppress("anna@example.test", "unsubscribe");

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: true });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("miękkie odbicie też przepuszcza pocztę transakcyjną - pełna skrzynka to stan przejściowy", async () => {
    suppress("anna@example.test", "soft_bounce", "transient");

    await expect(sendTxEmail(txInput())).resolves.toEqual({ ok: true });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("wypis zatrzymuje potwierdzenie zapisu na newsletter - to wysyłka za zgodą, którą właśnie cofnięto", async () => {
    suppress("anna@example.test", "unsubscribe");

    const result = await sendTxEmail(txInput({ type: "newsletter_confirmed" }));

    expect(result).toEqual({ ok: false, skipped: "suppressed", reason: "suppressed:unsubscribe" });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("świadome pominięcie zostawia wiersz w logu - cisza w skrzynce musi być widoczna w panelu", async () => {
    suppress("anna@example.test", "complaint");

    await sendTxEmail(txInput());

    expect(logInserts()).toHaveLength(1);
    expect(logInserts()[0]).toMatchObject({
      status: "suppressed",
      error_message: "suppressed:complaint",
      template_name: "payment_failed",
      recipient_email: "anna@example.test",
    });
  });

  it("wiersz pominięcia niesie identyfikator wiadomości - raport poczty pomija wiersze bez niego", async () => {
    suppress("anna@example.test", "complaint");

    await sendTxEmail(txInput());

    expect(String(logInserts()[0]?.message_id)).toMatch(UUID_V4);
  });

  it.fails(
    "odmowa zapisu śladu pominięcia przechodzi bez echa - wysyłka znika i ze skrzynki, i z panelu",
    async () => {
      // DEFEKT PRZYPIĘTY (kod produkcyjny bez zmian). `suppressionGate` nie
      // sprawdza wyniku zapisu do `email_send_log`. Gdy ten zapis się nie
      // uda, mail jest świadomie pominięty, ale nie zostaje po nim ŻADEN
      // ślad: ani wiersz w panelu dostarczalności, ani komunikat w logu
      // procesu. Skutek jest dokładnie tym, przed czym broni komentarz przy
      // tej funkcji - nie da się odróżnić "nie wysłaliśmy świadomie" od
      // "potok się zepsuł", a odbiorca w tym czasie nie dostał ostrzeżenia o
      // nieudanej płatności.
      state.logWriteFails = true;
      suppress("anna@example.test", "complaint");

      await sendTxEmail(txInput());

      expect(errorSpy).toHaveBeenCalled();
    },
  );

  it("blokada bez rozpoznanego powodu zapisuje ogólne 'suppressed', a nie puste pole", async () => {
    h.gateOverride = { allowed: false, hit: null, tenantId: TENANT };

    const result = await sendTxEmail(txInput());

    expect(result.reason).toBe("suppressed");
    expect(logInserts()[0]?.error_message).toBe("suppressed");
  });

  it("adres blokowany jest sprawdzany po normalizacji, nie w postaci z wywołania", async () => {
    suppress("anna@example.test", "complaint");

    await sendTxEmail(txInput({ to: "ANNA@Example.test" }));

    expect(rpc.lastCall("email_filter_suppressed")?.arg("p_emails")).toEqual(["anna@example.test"]);
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------
describe("tenant odbiorcy", () => {
  it("podany tenant nie jest rozwiązywany ponownie - webhook płatności już go zna", async () => {
    await sendTxEmail(txInput({ tenantId: OTHER_TENANT }));

    expect(rpc.callsFor("email_resolve_tenant_for_address")).toHaveLength(0);
    expect(rpc.lastCall("email_filter_suppressed")?.arg("p_tenant")).toBe(OTHER_TENANT);
  });

  it("bez podanego tenanta adres rozwiązuje baza - lista wykluczeń jest per tenant", async () => {
    await sendTxEmail(txInput());

    expect(rpc.lastCall("email_resolve_tenant_for_address")?.arg("p_email")).toBe(
      "anna@example.test",
    );
    expect(rpc.lastCall("email_filter_suppressed")?.arg("p_tenant")).toBe(TENANT);
  });

  it("tenant trafia do ładunku kolejki - dren sprawdzi listę ponownie bez dodatkowego zapytania", async () => {
    await sendTxEmail(txInput({ tenantId: OTHER_TENANT }));

    expect(queuedPayload().tenant_id).toBe(OTHER_TENANT);
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("adres spoza znanych tenantów wychodzi z pustym tenantem, a nie zostaje uziemiony", async () => {
    rpc.setData("email_resolve_tenant_for_address", null);

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: true });
    expect(queuedPayload().tenant_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Idempotencja
// ---------------------------------------------------------------------------
describe("idempotencja", () => {
  it("ten sam klucz daje ten sam identyfikator - ponowiony webhook nie wyśle drugiego maila o tej samej fakturze", async () => {
    await sendTxEmail(txInput({ idempotencyKey: "invoice_in_2026_08_1" }));
    const first = queuedPayload().message_id;

    await sendTxEmail(txInput({ idempotencyKey: "invoice_in_2026_08_1" }));

    expect(queuedPayload().message_id).toBe(first);
    // Dwa wywołania, jeden identyfikator - to jest cała idempotencja: dren
    // odsieje drugą wiadomość po `message_id`, bo widzi ten sam klucz.
    expect(rpc.callsFor("enqueue_email")).toHaveLength(2);
  });

  it("różne klucze dają różne identyfikatory - dwie faktury to dwie wiadomości", async () => {
    await sendTxEmail(txInput({ idempotencyKey: "invoice_in_2026_08_1" }));
    const first = queuedPayload().message_id;

    await sendTxEmail(txInput({ idempotencyKey: "invoice_in_2026_09_1" }));

    expect(queuedPayload().message_id).not.toBe(first);
    expect(rpc.callsFor("enqueue_email")).toHaveLength(2);
  });

  it("pusty klucz też daje poprawny identyfikator - wiadomość nie może wyjść bez śladu w logu", async () => {
    await sendTxEmail(txInput({ idempotencyKey: "" }));

    expect(String(queuedPayload().message_id)).toMatch(UUID_V4);
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("wiersz 'pending' w logu zatrzymuje drugą wysyłkę i nie dokłada kolejnego wpisu", async () => {
    state.duplicate = true;

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: true, skipped: "duplicate" });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
    expect(logInserts()).toHaveLength(0);
  });

  it("pytanie o duplikat liczy WYŁĄCZNIE 'pending' i 'sent' - wiersz 'suppressed' nie może uziemić maila na zawsze", async () => {
    await sendTxEmail(txInput());

    const read = db.chainsFor("email_send_log").find((chain) => chain.has("select"));
    expect(read?.argsOf("in")).toEqual(["status", ["pending", "sent"]]);
    expect(read?.argsOf("limit")).toEqual([1]);
  });

  it("nieczytelny log NIE zatrzymuje wysyłki - powtórzony mail jest tańszy niż cisza po awarii bazy", async () => {
    // Przypięcie stanu faktycznego: `alreadyHandled` ignoruje błąd odczytu
    // i traktuje go jak „nie było takiej wiadomości". Skutek jest świadomym
    // kompromisem tego modułu (fail-soft), ale ma cenę: w czasie awarii logu
    // ponowienie webhooka wyśle drugi mail.
    state.logReadFails = true;

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: true });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Awarie zapisu do kolejki
// ---------------------------------------------------------------------------
describe("awaria kolejki", () => {
  it("odmowa zapisu wraca do wywołującego z komunikatem - webhook płatności ma czym ponowić", async () => {
    rpc.setError("enqueue_email", "queue transactional_emails is full");

    const result = await sendTxEmail(txInput());

    expect(result).toEqual({ ok: false, error: "queue transactional_emails is full" });
    expect(logInserts().at(-1)).toMatchObject({ status: "failed" });
  });

  it("nieudane kolejkowanie dopisuje do logu wiersz 'failed' z powodem", async () => {
    rpc.setError("enqueue_email", "queue transactional_emails is full");

    await sendTxEmail(txInput());

    expect(logInserts()).toHaveLength(2);
    expect(logInserts()[1]).toMatchObject({
      status: "failed",
      error_message: "queue transactional_emails is full",
      template_name: "payment_failed",
    });
  });

  it("wyjątek w trakcie wysyłki nie wywraca webhooka płatności, ale zostawia ślad w logu procesu", async () => {
    rpc.setResponse("enqueue_email", () => {
      throw new Error("połączenie zerwane");
    });

    const result = await sendTxEmail(txInput());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("połączenie zerwane");
    expect(errorSpy).toHaveBeenCalledWith(
      "[tx-email] send failed",
      "payment_failed",
      expect.any(Error),
    );
  });
});

// ---------------------------------------------------------------------------
// formatMoney - kwota w języku odbiorcy
// ---------------------------------------------------------------------------
describe("formatMoney", () => {
  /**
   * `Intl` rozdziela kwotę od waluty spacją NIEŁAMLIWĄ, a jej wariant zależy
   * od wersji ICU w środowisku. Asercja na dokładnym znaku byłaby asercją o
   * bibliotece, nie o mailu - normalizujemy więc białe znaki i sprawdzamy
   * LICZBĘ oraz WALUTĘ.
   */
  const norm = (value: string): string => value.replace(/[\s\u00a0\u202f]+/gu, " ");

  it("polski odbiorca widzi przecinek dziesiętny i złotówki", () => {
    const out = norm(formatMoney(19900, "PLN", "pl"));

    expect(out).toContain("199,00");
    expect(out).toContain("zł");
  });

  it("angielski odbiorca widzi kropkę dziesiętną i tę samą kwotę", () => {
    const out = norm(formatMoney(19900, "PLN", "en"));

    expect(out).toContain("199.00");
    expect(out).toContain("PLN");
  });

  it("waluta podana małymi literami jest rozpoznawana - inaczej Intl rzuciłby wyjątkiem w połowie wysyłki", () => {
    const out = norm(formatMoney(19900, "eur", "en"));

    expect(out).toContain("199.00");
    expect(out).toContain("€");
  });

  it("euro dla polskiego odbiorcy zostaje euro, a nie złotówkami", () => {
    const out = norm(formatMoney(4550, "EUR", "pl"));

    expect(out).toContain("45,50");
    expect(out).toContain("€");
  });

  it("zero to '0,00', a nie puste miejsce w mailu o darowiźnie", () => {
    expect(norm(formatMoney(0, "PLN", "pl"))).toContain("0,00");
    expect(norm(formatMoney(0, "GBP", "en"))).toContain("0.00");
  });

  it("kwota ujemna (zwrot) zachowuje znak minus", () => {
    const out = norm(formatMoney(-4950, "PLN", "pl"));

    expect(out).toContain("49,50");
    expect(out.startsWith("-")).toBe(true);
  });

  it("duża kwota jest grupowana zgodnie z językiem, a nie sklejona w ciąg cyfr", () => {
    expect(norm(formatMoney(123456789, "PLN", "pl"))).toContain("1 234 567,89");
    expect(norm(formatMoney(123456789, "GBP", "en"))).toContain("1,234,567.89");
  });

  it("grosze nie znikają przy zaokrągleniu - kwota z faktury musi się zgadzać co do centa", () => {
    expect(norm(formatMoney(1, "PLN", "pl"))).toContain("0,01");
    expect(norm(formatMoney(999, "GBP", "en"))).toContain("9.99");
  });
});

// ---------------------------------------------------------------------------
// formatDate - data w języku odbiorcy
// ---------------------------------------------------------------------------
describe("formatDate", () => {
  // Asercje są odporne na strefę czasową runnera: sprawdzamy JĘZYK zapisu
  // (nazwa miesiąca), rok i obecność godziny. Data 2026-08-22T10:00Z leży w
  // sierpniu w każdej strefie świata, więc nazwa miesiąca jest stabilna,
  // a asercja na dokładnym dniu byłaby asercją o strefie runnera, nie o mailu.
  const ISO = "2026-08-22T10:00:00.000Z";

  it("polski odbiorca dostaje miesiąc słownie w dopełniaczu", () => {
    const out = formatDate(ISO, "pl");

    expect(out).toContain("sierpnia");
    expect(out).toContain("2026");
  });

  it("angielski odbiorca dostaje ten sam dzień po angielsku", () => {
    const out = formatDate(ISO, "en");

    expect(out).toContain("August");
    expect(out).toContain("2026");
  });

  it("bez godziny data jest sama - w mailu o odnowieniu godzina byłaby myląca", () => {
    expect(formatDate(ISO, "pl")).not.toMatch(/\d{1,2}:\d{2}/);
    expect(formatDate(ISO, "en")).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("z godziną data niesie porę - bilet na wydarzenie bez niej jest bezużyteczny", () => {
    expect(formatDate(ISO, "pl", true)).toMatch(/\d{2}:\d{2}/);
    expect(formatDate(ISO, "en", true)).toMatch(/\d{2}:\d{2}/);
  });

  it("nieprawidłowa data wraca w postaci surowej, zamiast wypisać 'Invalid Date' w mailu", () => {
    expect(formatDate("nie-data", "pl")).toBe("nie-data");
    expect(formatDate("", "en", true)).toBe("");
  });

  it("sama data bez czasu (YYYY-MM-DD) też jest formatowana, a nie odrzucana", () => {
    expect(formatDate("2026-08-22", "pl")).toContain("sierpnia");
  });
});

// ---------------------------------------------------------------------------
// enqueueRawEmail - gotowy HTML w tej samej kolejce
// ---------------------------------------------------------------------------
describe("enqueueRawEmail", () => {
  it("gotowy HTML idzie tą samą kolejką i tym samym nadawcą co poczta transakcyjna", async () => {
    const result = await enqueueRawEmail(rawInput());

    expect(result).toEqual({ ok: true });
    expect(rpc.lastCall("enqueue_email")?.arg("queue_name")).toBe("transactional_emails");
    expect(queuedPayload()).toMatchObject({
      to: "anna@example.test",
      from: "New European Strategies <noreply@neweuropeanstrategies.com>",
      sender_domain: "notify.mail.neweuropeanstrategies.com",
      subject: "Twoje podsumowanie dnia",
      html: "<p>Trzy nowe komentarze</p>",
      purpose: "transactional",
      label: "digest_daily",
      queued_at: "2026-08-22T10:00:00.000Z",
    });
  });

  it("brak wersji tekstowej to pusty tekst, a nie 'undefined' w skrzynce", async () => {
    await enqueueRawEmail(rawInput());

    expect(queuedPayload().text).toBe("");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("podana wersja tekstowa dociera do kolejki", async () => {
    await enqueueRawEmail(rawInput({ text: "Trzy nowe komentarze" }));

    expect(queuedPayload().text).toBe("Trzy nowe komentarze");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("adres wypisu trafia do ładunku - bez niego wysyłka masowa łamie RFC 8058", async () => {
    await enqueueRawEmail(
      rawInput({ unsubscribeUrl: "https://neweuropeanstrategies.com/wypis?token=abc" }),
    );

    expect(queuedPayload().unsubscribe_url).toBe(
      "https://neweuropeanstrategies.com/wypis?token=abc",
    );
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("bez adresu wypisu pole jest puste, a nie pominięte", async () => {
    await enqueueRawEmail(rawInput());

    expect(queuedPayload().unsubscribe_url).toBeNull();
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("rozpoznana etykieta digestu to wysyłka za zgodą - wypis ją zatrzymuje", async () => {
    suppress("anna@example.test", "unsubscribe");

    const result = await enqueueRawEmail(rawInput({ label: "digest_daily" }));

    expect(result).toEqual({ ok: false, skipped: "suppressed", reason: "suppressed:unsubscribe" });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("etykieta maila autoryzacyjnego przechodzi mimo wypisu - bez linku nikt się nie zaloguje", async () => {
    suppress("anna@example.test", "unsubscribe");

    await expect(
      enqueueRawEmail(rawInput({ label: "auth_recovery", idempotencyKey: "reset_1" })),
    ).resolves.toEqual({ ok: true });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("NIEROZPOZNANA etykieta traktowana jest ostrożniej - domyślna kategoria to wysyłka za zgodą", async () => {
    suppress("anna@example.test", "unsubscribe");

    const result = await enqueueRawEmail(rawInput({ label: "kanal_ktorego_nikt_nie_opisal" }));

    expect(result.skipped).toBe("suppressed");
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("kategoria podana wprost wygrywa z domyślną z etykiety", async () => {
    suppress("anna@example.test", "unsubscribe");

    const result = await enqueueRawEmail(
      rawInput({ label: "kanal_ktorego_nikt_nie_opisal", category: "transactional" }),
    );

    expect(result).toEqual({ ok: true });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("skarga na spam zatrzymuje digest i zostawia ślad w logu", async () => {
    suppress("anna@example.test", "complaint");

    await enqueueRawEmail(rawInput());

    expect(logInserts()[0]).toMatchObject({
      status: "suppressed",
      error_message: "suppressed:complaint",
      template_name: "digest_daily",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("znany tenant nie jest rozwiązywany ponownie i trafia do ładunku", async () => {
    await enqueueRawEmail(rawInput({ tenantId: OTHER_TENANT }));

    expect(rpc.callsFor("email_resolve_tenant_for_address")).toHaveLength(0);
    expect(queuedPayload().tenant_id).toBe(OTHER_TENANT);
  });

  it("wiersz 'pending' w logu zatrzymuje powtórzony digest", async () => {
    state.duplicate = true;

    const result = await enqueueRawEmail(rawInput());

    expect(result).toEqual({ ok: true, skipped: "duplicate" });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(0);
  });

  it("ślad 'pending' powstaje przed kolejkowaniem i niesie etykietę kanału", async () => {
    await enqueueRawEmail(rawInput());

    expect(logInserts()[0]).toMatchObject({
      status: "pending",
      template_name: "digest_daily",
      recipient_email: "anna@example.test",
    });
    expect(rpc.callsFor("enqueue_email")).toHaveLength(1);
  });

  it("odmowa zapisu do kolejki wraca z komunikatem i wierszem 'failed'", async () => {
    rpc.setError("enqueue_email", "queue is full");

    const result = await enqueueRawEmail(rawInput());

    expect(result).toEqual({ ok: false, error: "queue is full" });
    expect(logInserts()[1]).toMatchObject({ status: "failed", error_message: "queue is full" });
  });

  it("wyjątek nie wywraca kanału powiadomień, ale zostawia ślad w logu procesu", async () => {
    rpc.setResponse("enqueue_email", () => {
      throw new Error("połączenie zerwane");
    });

    const result = await enqueueRawEmail(rawInput());

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[tx-email] raw enqueue failed",
      "digest_daily",
      expect.any(Error),
    );
  });

  it("identyfikator wiadomości jest deterministyczny dla klucza kanału", async () => {
    await enqueueRawEmail(rawInput({ idempotencyKey: "digest_2026_08_22_anna" }));
    const first = queuedPayload().message_id;

    await enqueueRawEmail(rawInput({ idempotencyKey: "digest_2026_08_22_anna" }));

    expect(queuedPayload().message_id).toBe(first);
    expect(String(first)).toMatch(UUID_V4);
  });
});
