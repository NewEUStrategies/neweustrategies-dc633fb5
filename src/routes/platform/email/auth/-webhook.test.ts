// Webhook maili autoryzacyjnych - JEDYNA droga, którą mail z linkiem do
// logowania trafia do kolejki.
//
// Trasa stała na 0%, choć nie ma w platformie punktu bardziej zapalnego:
// przyjmuje ładunek z zewnątrz, renderuje szablon, ustala język i imię
// odbiorcy, a potem zapisuje wiadomość do kolejki i do dziennika. Dwie klasy
// błędów są tu nieodwracalne z punktu widzenia użytkownika:
//   * przepuszczenie ładunku bez ważnego podpisu (obcy dyktuje treść maila
//     wysłanego z NASZEJ domeny, łącznie z adresem linku),
//   * zgubienie wiadomości między „zalogowałem" a kolejką - użytkownik nigdy
//     nie dostanie linku, a nikt się o tym nie dowie.
// Dlatego testy pilnują kodów odpowiedzi dla KAŻDEJ odmowy oraz tego, że
// wiersz `pending` powstaje PRZED kolejkowaniem, a porażka kolejkowania
// zostawia ślad w logu i w diagnostyce.
//
// Handler jest wołany wprost przez `Route.options.server.handlers.POST` -
// nie trzeba do tego runtime'u routera ani zmian w kodzie produkcyjnym.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";

const h = vi.hoisted(() => {
  // Klasa MUSI powstać w bloku hoisted: fabryki `vi.mock` są wynoszone nad
  // deklaracje modułu, a `instanceof WebhookError` w kodzie trasy rozstrzyga
  // o tym, czy odmowa dostanie 401 czy 400.
  class FakeWebhookError extends Error {
    code: string;
    constructor(code: string, message = code) {
      super(message);
      this.name = "WebhookError";
      this.code = code;
    }
  }
  return {
    FakeWebhookError,
    verifyWebhookRequest: vi.fn(),
    parseEmailWebhookPayload: vi.fn(),
    render: vi.fn(),
    createClient: vi.fn(),
    rpc: vi.fn(),
    resolveDomainBinding: vi.fn(),
    resolveAccountTenantForAddress: vi.fn(),
  };
});

const FakeWebhookError = h.FakeWebhookError;

vi.mock("@lovable.dev/webhooks-js", () => ({
  WebhookError: h.FakeWebhookError,
  verifyWebhookRequest: h.verifyWebhookRequest,
}));
vi.mock("@lovable.dev/email-js", () => ({ parseEmailWebhookPayload: h.parseEmailWebhookPayload }));
vi.mock("@react-email/render", () => ({ render: h.render }));
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
// Dwa źródła najemca maila autoryzacyjnego. Atrapy, bo katalog domen czyta bazę
// przez klienta serwisowego, a rozstrzygacz adresu - przez RPC; tu przedmiotem
// dowodu jest KOLEJNOŚĆ i to, że wynik ląduje w dzienniku, nie ich wnętrze.
vi.mock("@/lib/server/tenant.server", () => ({
  resolveDomainBinding: h.resolveDomainBinding,
}));
vi.mock("@/lib/email/suppression.server", () => ({
  resolveAccountTenantForAddress: h.resolveAccountTenantForAddress,
}));

import { Route } from "@/routes/platform/email/auth/webhook";

/** Najemca, do którego należy domena z `redirect_to`. */
const TENANT_B = "22222222-2222-4222-8222-222222222222";
/** Najemca rozstrzygnięty z ADRESU, gdy host powrotu nic nie mówi. */
const TENANT_Z_KONTA = "33333333-3333-4333-8333-333333333333";

const db = supabaseFromStub();

function post(headers: Record<string, string> = {}): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  return handlers.POST({
    request: new Request("https://example.test/platform/email/auth/webhook", {
      method: "POST",
      headers,
      body: "{}",
    }),
  });
}

/** Ładunek webhooka w kształcie, jaki oddaje parser dostawcy. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const data = {
    action_type: "recovery",
    email: "odbiorca@example.test",
    url: "https://example.test/reset?token=abc",
    token: "abc",
    redirect_to: "https://example.test/konto",
    user: { user_metadata: { first_name: "Anna" } },
    ...((overrides.data as Record<string, unknown>) ?? {}),
  };
  return { version: "1", run_id: "run-1", type: "auth", ...overrides, data };
}

const ENV_KEYS = ["LOVABLE_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
let savedEnv: Record<string, string | undefined>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Bez tego `h.rpc.mock.calls[0]` niesie wywołanie z POPRZEDNIEGO testu,
  // a asercja o korelacji identyfikatorów porównuje dwa różne przebiegi.
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.LOVABLE_API_KEY = "lov-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  vi.stubEnv("VITE_SUPABASE_URL", "https://db.example.test");

  db.reset();
  db.setResponse("email_send_log", ok(null));
  db.setResponse("auth_email_events", ok(null));
  db.setResponse("newsletter_subscribers", ok(null));
  db.setResponse("name_dictionary", ok(null));

  h.rpc.mockResolvedValue({ error: null });
  h.resolveDomainBinding.mockResolvedValue({
    tenant: { id: TENANT_B, slug: "b", domain: "example.test", isDefault: false },
    directoryPopulated: true,
  });
  h.resolveAccountTenantForAddress.mockResolvedValue(TENANT_Z_KONTA);
  h.createClient.mockReturnValue({ from: db.from, rpc: h.rpc });
  h.render.mockResolvedValue("<html>mail</html>");
  h.verifyWebhookRequest.mockResolvedValue({ payload: payload() });

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Ostatni ładunek wstawiony do danej tabeli. */
function lastInsert(table: string): Record<string, unknown> {
  const args = db.lastChain(table)?.argsOf("insert");
  return (args?.[0] ?? {}) as Record<string, unknown>;
}

describe("odmowy - konfiguracja", () => {
  it("brak klucza platformy to 500, BEZ dotykania ładunku", async () => {
    delete process.env.LOVABLE_API_KEY;

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Server configuration error" });
    expect(h.verifyWebhookRequest).not.toHaveBeenCalled();
  });

  it("brak dostępu serwisowego do bazy to 500 - mail nie zniknie po cichu", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Server configuration error" });
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("odmowy - podpis i ładunek", () => {
  it.each(["invalid_signature", "missing_timestamp", "invalid_timestamp", "stale_timestamp"])(
    "błąd podpisu (%s) to 401, nie 400 - obcy nie dyktuje treści maila",
    async (code) => {
      h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError(code));

      const res = await post();

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Invalid signature" });
    },
  );

  it.each(["invalid_payload", "invalid_json"])("zepsuty ładunek (%s) to 400", async (code) => {
    h.verifyWebhookRequest.mockRejectedValue(new FakeWebhookError(code));

    const res = await post();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid webhook payload" });
  });

  it("błąd spoza słownika kodów też kończy się odmową, nie wysyłką", async () => {
    h.verifyWebhookRequest.mockRejectedValue(new Error("coś pękło"));

    const res = await post();

    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("brak identyfikatora przebiegu to 400 - bez niego nie ma korelacji", async () => {
    h.verifyWebhookRequest.mockResolvedValue({ payload: payload({ run_id: "" }) });

    const res = await post();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid webhook payload" });
  });

  it("nieobsługiwana wersja ładunku jest nazwana wprost", async () => {
    h.verifyWebhookRequest.mockResolvedValue({ payload: payload({ version: "2" }) });

    const res = await post();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unsupported payload version: 2" });
  });

  it("nieznany typ maila jest odrzucany, a nie renderowany „czymkolwiek”", async () => {
    h.verifyWebhookRequest.mockResolvedValue({
      payload: payload({ data: { action_type: "wymyślony" } }),
    });

    const res = await post();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unknown email type: wymyślony" });
    expect(h.render).not.toHaveBeenCalled();
  });
});

describe("ścieżka sukcesu", () => {
  it("kolejkuje wiadomość i potwierdza zakolejkowanie", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, queued: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("wiersz `pending` powstaje PRZED kolejkowaniem - ślad przetrwa awarię", async () => {
    await post();

    const pending = lastInsert("email_send_log");
    expect(pending).toMatchObject({
      template_name: "recovery",
      recipient_email: "odbiorca@example.test",
      status: "pending",
    });
    expect(pending.message_id).toEqual(expect.any(String));
  });

  it("do kolejki idzie komplet: adresat, nadawca, treść i etykieta", async () => {
    await post();

    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    const queued = args.payload as Record<string, unknown>;

    expect(name).toBe("enqueue_email");
    expect(args.queue_name).toBe("auth_emails");
    expect(queued).toMatchObject({
      run_id: "run-1",
      to: "odbiorca@example.test",
      purpose: "transactional",
      label: "recovery",
      html: "<html>mail</html>",
    });
    expect(queued.subject).toBeTruthy();
  });

  it("identyfikator wiadomości jest ten sam w logu i w kolejce (korelacja)", async () => {
    await post();

    const logged = lastInsert("email_send_log").message_id;
    const queued = (h.rpc.mock.calls[0]?.[1] as { payload: Record<string, unknown> }).payload;
    expect(queued.message_id).toBe(logged);
    expect(typeof logged).toBe("string");
  });

  it("diagnostyka zapisuje zamaskowany adres, nie pełny", async () => {
    await post();

    const event = lastInsert("auth_email_events");
    expect(event.status).toBe("enqueued");
    expect(String(event.recipient_masked)).not.toBe("odbiorca@example.test");
    expect(event.recipient_domain).toBe("example.test");
  });

  it("diagnostyka niesie język, jego źródło i host linku akcji", async () => {
    await post();

    const event = lastInsert("auth_email_events");
    expect(event.lang).toBeTruthy();
    expect(event.lang_source).toBeTruthy();
    expect(event.action_url_host).toBe("example.test");
    expect(event.email_type).toBe("recovery");
  });

  it("mierzy czas obsługi - bez tego nie widać degradacji webhooka", async () => {
    await post();

    const event = lastInsert("auth_email_events");
    expect(typeof event.duration_ms).toBe("number");
    expect(event.duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});

describe("obsługiwane typy maili", () => {
  it.each(["signup", "invite", "magiclink", "recovery", "email_change", "reauthentication"])(
    "typ %s ma szablon i trafia do kolejki z własną etykietą",
    async (actionType) => {
      h.verifyWebhookRequest.mockResolvedValue({
        payload: payload({ data: { action_type: actionType } }),
      });

      const res = await post();

      expect(res.status).toBe(200);
      const queued = (h.rpc.mock.calls[0]?.[1] as { payload: Record<string, unknown> }).payload;
      expect(queued.label).toBe(actionType);
    },
  );

  it("ładunek bez pól opcjonalnych nadal daje kompletną wiadomość", async () => {
    h.verifyWebhookRequest.mockResolvedValue({
      payload: payload({
        data: {
          action_type: "signup",
          email: "nowy@example.test",
          url: null,
          token: null,
          redirect_to: null,
          user: null,
        },
      }),
    });

    const res = await post();

    expect(res.status).toBe(200);
    const event = lastInsert("auth_email_events");
    expect(event.redirect_to).toBeNull();
    expect(event.action_url_host).toBeNull();
    expect(event.greeting_name).toBeNull();
  });
});

describe("język i personalizacja", () => {
  it("jawny `?lang=en` w adresie powrotu wygrywa z domyślnym PL", async () => {
    h.verifyWebhookRequest.mockResolvedValue({
      payload: payload({ data: { redirect_to: "https://example.test/konto?lang=en" } }),
    });

    await post();

    const event = lastInsert("auth_email_events");
    expect(event.lang).toBe("en");
    expect(event.lang_source).toBeTruthy();
  });

  it("imię ze słownika trafia do powitania w diagnostyce", async () => {
    db.setResponse("name_dictionary", ok({ gender: "female", vocative_pl: "Aniu" }));

    await post();

    // Wołacz ze słownika, nie mianownik z adresu - „Cześć Anna" brzmi obco.
    expect(lastInsert("auth_email_events").greeting_name).toBe("Aniu");
    expect(lastInsert("auth_email_events").greeting_name).not.toBe("Anna");
  });

  it("awaria ustalania imienia NIE zatrzymuje maila", async () => {
    h.createClient.mockReturnValue({
      from: (table: string) => {
        if (table === "newsletter_subscribers" || table === "name_dictionary") {
          throw new Error("baza imion padła");
        }
        return db.from(table);
      },
      rpc: h.rpc,
    });

    const res = await post();

    expect(res.status).toBe(200);
    // Imię z metadanych zostaje - mail wychodzi spersonalizowany mimo awarii.
    expect(lastInsert("auth_email_events").greeting_name).toBe("Anna");
  });

  it("płeć spoza słownika wartości nie zatruwa odmiany", async () => {
    h.verifyWebhookRequest.mockResolvedValue({
      payload: payload({ data: { user: { user_metadata: { name: "Jan", gender: "inne" } } } }),
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(lastInsert("auth_email_events").greeting_name).toBeTruthy();
  });
});

describe("porażka kolejkowania", () => {
  it("zwraca 500 i ZOSTAWIA ślad porażki w logu wysyłek", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to enqueue email" });
    expect(lastInsert("email_send_log")).toMatchObject({
      status: "failed",
      error_message: "Failed to enqueue email",
    });
  });

  it("diagnostyka dostaje status `failed` i powód od kolejki", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    await post();

    const event = lastInsert("auth_email_events");
    expect(event.status).toBe("failed");
    expect(event.error_message).toBe("queue full");
  });

  it("awaria samej diagnostyki nie zmienia odpowiedzi - log nie rządzi wysyłką", async () => {
    db.setResponse("auth_email_events", () => {
      throw new Error("dziennik padł");
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Najemca maila autoryzacyjnego
//
// To JEDYNA ścieżka wysyłki w platformie bez sesji i bez bramki listy wykluczeń,
// więc tenant nie bierze się tu znikąd - a `email_send_log` niesie adresy
// odbiorców i czytają go panele operatorów per najemca. Wiersz bez stempla widzi
// operator KAŻDEGO serwisu.
// ---------------------------------------------------------------------------
describe("najemca maila autoryzacyjnego", () => {
  it("mail jest przypisany do serwisu, który JEST WŁAŚCICIELEM ADRESU", async () => {
    // Atrapy domyślne stawiają oba źródła w SPRZECZNOŚCI: adres należy do
    // TENANT_Z_KONTA, a host powrotu wskazuje TENANT_B. Wygrywa właściciel.
    await post();

    expect(lastInsert("email_send_log")).toMatchObject({
      status: "pending",
      tenant_id: TENANT_Z_KONTA,
    });
    // Mechanizm, nie tylko wynik: rozstrzygacz adresu MUSIAŁ zostać zapytany.
    // Bez tego test przechodziłby też wtedy, gdyby ktoś zaszył stałą.
    expect(h.resolveAccountTenantForAddress).toHaveBeenCalledTimes(1);
  });

  it("ten sam najemca jedzie w ładunku kolejki", async () => {
    // Dren wywozi wiadomość do DLQ (zepsuty ładunek, TTL, ponowienia) ZANIM
    // rozstrzygnie tenanta, więc bez tego pola wiersz 'dlq' maila
    // autoryzacyjnego nie miałby najemcy z żadnego źródła.
    await post();

    const [, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect((args.payload as Record<string, unknown>).tenant_id).toBe(TENANT_Z_KONTA);
    // Ładunek i wiersz dziennika muszą nieść TEGO SAMEGO najemcę - rozjazd
    // między nimi znaczy, że DLQ i panel przypiszą tę samą wiadomość dwóm
    // serwisom.
    expect(lastInsert("email_send_log").tenant_id).toBe(TENANT_Z_KONTA);
  });

  it("reset hasła zamówiony na CUDZYM serwisie nie stempluje wiersza tym serwisem", async () => {
    // REGRESJA. Kolejność była tu odwrotna - host powrotu przed adresem - i to
    // był wyciek, nie detal. Formularz resetu podaje `redirectTo` jako
    // `${window.location.origin}${redirectTo}` (AuthFormBlocks.tsx:1034-1035),
    // czyli ZAWSZE bieżący origin, a formularz przyjmuje dowolny adres. Operator
    // serwisu B zamawiał więc reset na adres należący do A i dostawał do swojego
    // raportu systemowego wiersz z SUROWYM adresem odbiorcy - czyli dowód, że
    // ten człowiek ma konto, plus jego adres.
    //
    // Host powrotu uwierzytelnia CEL LINKU, nie to, czyj jest odbiorca.
    await post();

    const row = lastInsert("email_send_log");
    expect(row.tenant_id).not.toBe(TENANT_B);
    expect(row.tenant_id).toBe(TENANT_Z_KONTA);
  });

  it("adres, którego nie da się przypisać, oddaje decyzję HOSTOWI powrotu", async () => {
    // `email_resolve_tenant_for_address` oddaje NULL w DWÓCH przypadkach i oba
    // trafiają tutaj: adresu nie ma jeszcze nigdzie (świeża rejestracja) albo
    // żyje u wielu najemców (wieloznaczny). W obu host powrotu jest jedyną
    // odpowiedzią, jaka została - i wtedy jest właściwą, bo mówi, na który
    // serwis ten człowiek właśnie wchodzi.
    h.resolveAccountTenantForAddress.mockResolvedValue(null);

    await post();

    // Do katalogu idzie sam host, nie cały URL.
    expect(h.resolveDomainBinding).toHaveBeenCalledWith("example.test");
    expect(lastInsert("email_send_log").tenant_id).toBe(TENANT_B);
  });

  it("nieznany host NIE zjeżdża na tenanta domyślnego", async () => {
    // `resolveDomainBinding` dopasowuje ŚCIŚLE i to jest sedno: cichy fallback
    // na tenanta domyślnego jest dokładnie tym, co produkuje ten wyciek.
    h.resolveAccountTenantForAddress.mockResolvedValue(null);
    h.resolveDomainBinding.mockResolvedValue({ tenant: null, directoryPopulated: true });

    const res = await post();

    expect(lastInsert("email_send_log").tenant_id).toBeNull();
    // Brak stempla nie może oznaczać braku maila - to są dwie różne rzeczy.
    expect(res.status).toBe(200);
  });

  it("awaria rozstrzygania najemcy NIE zatrzymuje maila z linkiem do logowania", async () => {
    // Atrybucja nie jest warunkiem wysyłki. Padnięty rozstrzygacz ma kosztować
    // stempel, a nie dostęp użytkownika do konta.
    h.resolveAccountTenantForAddress.mockRejectedValue(new Error("rozstrzygacz padł"));

    const res = await post();

    expect(res.status).toBe(200);
    expect(lastInsert("email_send_log").tenant_id).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith("Failed to resolve auth email tenant", expect.any(Error));
  });

  it("gdy ani adres, ani host nic nie mówią, wysyłka i tak idzie", async () => {
    // Link do logowania jest ważniejszy niż stempel; najemcę dopina wtedy
    // trigger bazy `trg_email_send_log_bind_tenant`.
    h.resolveAccountTenantForAddress.mockResolvedValue(null);
    h.resolveDomainBinding.mockResolvedValue({ tenant: null, directoryPopulated: false });

    const res = await post();

    expect(res.status).toBe(200);
    expect(lastInsert("email_send_log").tenant_id).toBeNull();
  });

  it("wiersz 'failed' po odmowie kolejki niesie TEGO SAMEGO najemcę", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    await post();

    expect(h.rpc).toHaveBeenCalled();
    expect(lastInsert("email_send_log")).toMatchObject({
      status: "failed",
      tenant_id: TENANT_Z_KONTA,
    });
  });

  // -------------------------------------------------------------------------
  // auth_email_events - druga tabela, BEZ triggera wiążącego
  //
  // `email_send_log` ma `email_send_log_bind_tenant` (20260913140000), który
  // dopina najemcę przy `NEW.tenant_id IS NULL`. `auth_email_events` NIE MA
  // odpowiednika: 20260913101000 dokłada samą kolumnę, a backfill w
  // 20260913140000 obejmuje wyłącznie wiersze ZASTANE. Wiersz dopisany bez tej
  // kolumny zostaje z NULL-em na zawsze, a `fetchAuthEmailEvents` filtruje
  // twardo po `.eq("tenant_id", …)` - panel wyglądałby na zakresowany i po cichu
  // byłby pusty.
  // -------------------------------------------------------------------------
  it("wiersz 'enqueued' w auth_email_events niesie najemcę", async () => {
    await post();

    expect(lastInsert("auth_email_events")).toMatchObject({
      status: "enqueued",
      tenant_id: TENANT_Z_KONTA,
    });
    // Obie tabele muszą nieść TEGO SAMEGO najemcę: rozjazd między dziennikiem
    // wysyłek a dziennikiem zdarzeń znaczy, że dwa panele pokażą tę samą
    // wiadomość dwóm różnym serwisom.
    expect(lastInsert("auth_email_events").tenant_id).toBe(lastInsert("email_send_log").tenant_id);
  });

  it("wiersz 'failed' w auth_email_events też niesie najemcę", async () => {
    h.rpc.mockResolvedValue({ error: { message: "queue full" } });

    await post();

    expect(lastInsert("auth_email_events")).toMatchObject({
      status: "failed",
      tenant_id: TENANT_Z_KONTA,
    });
    // Ścieżka błędu nie może gubić ani przyczyny, ani najemcy.
    expect(lastInsert("auth_email_events").error_message).toBe("queue full");
  });

  it("nierozstrzygnięty najemca trafia do auth_email_events jako jawny null", async () => {
    // Bez triggera nie ma tu drugiej szansy, więc kolumna musi być NAPISANA -
    // pominięty klucz i jawny null dają ten sam wiersz, ale tylko jawny null
    // dowodzi, że producent o kolumnie pamiętał.
    h.resolveAccountTenantForAddress.mockResolvedValue(null);
    h.resolveDomainBinding.mockResolvedValue({ tenant: null, directoryPopulated: true });

    await post();

    expect(lastInsert("auth_email_events")).toHaveProperty("tenant_id", null);
    // Klucz MUSI być obecny, nie pominięty - bez triggera nie ma tu drugiej
    // szansy, więc pominięcie zostawiłoby wiersz niewidzialny na zawsze.
    expect("tenant_id" in lastInsert("auth_email_events")).toBe(true);
  });
});
