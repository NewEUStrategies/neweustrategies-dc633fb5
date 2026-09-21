// Panel admina newslettera: import listy z CSV + automat wysyłki.
//
// PO CO TE DWIE POWIERZCHNIE RAZEM. Obie odpowiadają na to samo pytanie
// operatora - "czy poczta wychodzi i do kogo" - i obie mają konsekwencję,
// której nie da się cofnąć:
//
//  1. IMPORT wprowadza na listę DANE OSOBOWE razem ze statusem zgody
//     marketingowej. Wpisanie kogoś jako `subscribed` (z datą potwierdzenia!)
//     to zgoda, której ta osoba nigdy nie wyraziła - a pierwsza wysyłka
//     zamienia to w skargę na spam. Import musi też być IDEMPOTENTNY: drugi
//     przebieg tego samego pliku nie może nadpisać istniejącego wiersza
//     (czyjejś prawdziwej rezygnacji) ani policzyć tej osoby drugi raz.
//  2. AUTOMAT WYSYŁKI (`job_runner_settings`) startował kiedyś z wyłączonym
//     przełącznikiem i pustym adresem, więc świeże wdrożenie nie wysyłało
//     w tle NICZEGO, a jedynym śladem była rosnąca kolejka. Odczyt stanu
//     musi więc oddać DOWÓD działania (moment i status ostatniego ticku,
//     głębokość kolejek), a nie samo "czy przełącznik jest włączony".
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Atrapa `createServerFn` w ogóle nie
// uruchamia middleware, więc zieleń tych testów mówi o LOGICE handlera, a nie
// o tym, kto ma prawo go wywołać. Zestaw middleware każdej funkcji jest tu
// przybity osobno, strukturalnie (`serverFnMeta`), i to jest jedyna asercja
// o dostępie, jaką ten harness uczciwie unieść może.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
  requirePlatformAdmin: { __mw: "requirePlatformAdmin" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table), rpc: h.rpc },
}));

import {
  getJobRunnerSettings,
  importNewsletterSubscribers,
  updateJobRunnerSettings,
} from "@/lib/newsletter-admin.functions";

const db = supabaseFromStub();
const PROFILES = "profiles";
const SUBSCRIBERS = "newsletter_subscribers";
const RUNNER = "job_runner_settings";
const TENANTS = "tenants";
const AUDIT = "audit_log";

const TENANT = "tenant-1";

/** Wiersz konfiguracji automatu w kształcie, w jakim czyta go handler. */
function runnerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    base_url: "https://example.test",
    secret: "sekret-bardzo-dlugi",
    updated_at: "2026-08-20T09:00:00.000Z",
    last_tick_at: "2026-08-22T09:59:00.000Z",
    last_tick_status: "dispatched",
    last_tick_error: null,
    tick_count: 1234,
    ...overrides,
  };
}

/** Odpowiedź RPC `email_queue_depth` - kolejki pgmq. */
function depth(queues: Record<string, unknown> | null, okFlag = true): Record<string, unknown> {
  return queues === null ? { ok: okFlag } : { ok: okFlag, queues };
}

/** Wiersze wysłane do INSERT-u na liście subskrybentów, w kolejności. */
function inserted(): Record<string, unknown>[] {
  return db
    .chainsFor(SUBSCRIBERS)
    .map((chain) => chain.argsOf("insert")?.[0])
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

/** Stan RPC: adres efektywny + głębokość kolejek. Domyślnie oba zdrowe. */
let rpcPlan: { baseUrl: unknown; queueDepth: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();

  rpcPlan = {
    baseUrl: "https://runner.example.test",
    queueDepth: depth({
      auth_emails: 3,
      transactional_emails: 7,
      auth_emails_dlq: 0,
      transactional_emails_dlq: 1,
    }),
  };
  h.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === "job_runner_base_url"
        ? { data: rpcPlan.baseUrl, error: null }
        : { data: rpcPlan.queueDepth, error: null },
    ),
  );

  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SUBSCRIBERS, (chain: RecordedChain) => (chain.has("insert") ? ok(null) : ok([])));
  db.setResponse(RUNNER, (chain: RecordedChain) =>
    chain.has("update") ? ok(null) : ok(runnerRow()),
  );
  // Katalog najemców to ALLOWLISTA hostów zapisu - bez niego żaden adres nie
  // przechodzi, więc atrapa musi go mieć tak samo jak produkcja.
  db.setResponse(TENANTS, ok([{ domain: "example.test" }]));
  db.setResponse(AUDIT, ok(null));

  // Środowisko czyścimy JAWNIE: gdyby host runnera wpadał do allowlisty
  // z `PUBLIC_SITE_URL` maszyny CI, testy o obcym hoście dowodziłyby tylko
  // tego, jak skonfigurowano pipeline.
  vi.stubEnv("PUBLIC_SITE_URL", "");
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("URL", "");
  vi.stubEnv("JOB_RUNNER_BASE_URL_ALLOWLIST", "");

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => {
  resetServerFnContext();
  vi.unstubAllEnvs();
});

describe("obudowa - kto w ogóle może wołać te funkcje", () => {
  // Dowód STRUKTURALNY, nie behawioralny: harness nie uruchamia middleware,
  // więc jedyne, co można tu uczciwie przybić, to DEKLARACJA bramki. TRZY różne
  // bramki, bo to trzy różne zasoby - zrównanie ich z powrotem do `requireStaff`
  // ma być czerwonym testem, a nie niezauważoną regresją.
  it("import listy (dane najemcy) stoi na roli redakcyjnej", () => {
    // Import cudzych danych osobowych bez bramki stanąłby otworem dla każdego
    // zalogowanego - i to jest jedyna z trzech funkcji, która jest tenantowa.
    expect(serverFnMeta(importNewsletterSubscribers)?.middleware).toEqual([
      { __mw: "requireStaff" },
    ]);
  });

  it("odczyt stanu automatu WYPYCHA autorów - telemetria platformy nie jest dla redakcji", () => {
    // Ta sama rola co RPC `job_scheduler_health()` po drugiej stronie panelu
    // zdrowia; bramki muszą być te same po obu stronach.
    expect(serverFnMeta(getJobRunnerSettings)?.middleware).toEqual([
      { __mw: "requireAdminEditor" },
    ]);
  });

  it("ZAPIS konfiguracji automatu stoi na bramce PLATFORMOWEJ, nie na staffie najemcy", () => {
    // `job_runner_settings` to singleton instalacji: `base_url` decyduje, pod
    // jaki adres pg_cron wysyła sekret operatora, a `enabled = false` gasi
    // zadania tła WSZYSTKICH najemców. Staff jednego najemcy nie może o tym
    // decydować.
    expect(serverFnMeta(updateJobRunnerSettings)?.middleware).toEqual([
      { __mw: "requirePlatformAdmin" },
    ]);
  });

  it("operacje zmieniające stan idą metodą POST, odczyt stanu automatu GET", () => {
    expect(serverFnMeta(importNewsletterSubscribers)?.method).toBe("POST");
    expect(serverFnMeta(updateJobRunnerSettings)?.method).toBe("POST");
    expect(serverFnMeta(getJobRunnerSettings)?.method).toBe("GET");
  });
});

describe("import listy z CSV - zgoda marketingowa i idempotencja", () => {
  it("nowy adres trafia na listę jako potwierdzony, z rozłożonym nazwiskiem", async () => {
    const res = await importNewsletterSubscribers({
      data: {
        rows: [{ email: "Anna.Nowak@Example.Test", firstName: "Anna", lastName: "Nowak" }],
      },
    });

    expect(res).toEqual({ ok: true, imported: 1, skipped: 0, errors: [] });
    const row = inserted()[0];
    // Adres schodzi do małych liter - inaczej ta sama osoba wejdzie na listę
    // drugi raz przy imporcie z innego eksportu.
    expect(row.email).toBe("anna.nowak@example.test");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.display_name).toBe("Anna Nowak");
    expect(row.first_name).toBe("Anna");
    expect(row.language).toBe("pl");
    expect(row.status).toBe("subscribed");
    // `subscribed` NIESIE datę potwierdzenia zgody - to jest ten wpis, na który
    // powoła się operator przy skardze.
    expect(typeof row.confirmed_at).toBe("string");
    expect(row.source).toBe("csv-import");
    expect(row.meta).toBeNull();
  });

  it("adres wpisany jako oczekujący NIE dostaje daty potwierdzenia zgody", async () => {
    // Data potwierdzenia przy statusie `pending` byłaby zapisem zgody, której
    // nikt nie wyraził.
    await importNewsletterSubscribers({
      data: { rows: [{ email: "kto@example.test", status: "pending" }] },
    });

    expect(inserted()[0].confirmed_at).toBeNull();
  });

  it("jawna nazwa wyświetlana wygrywa z imieniem i nazwiskiem, firma ląduje w meta", async () => {
    await importNewsletterSubscribers({
      data: {
        rows: [
          {
            email: "biuro@example.test",
            firstName: "Jan",
            lastName: "Kowalski",
            displayName: "Redakcja NES",
            company: "New European Strategies",
            language: "en",
            source: "konferencja",
          },
        ],
        markSource: "import-reczny",
      },
    });

    const row = inserted()[0];
    expect(row.display_name).toBe("Redakcja NES");
    expect(row.language).toBe("en");
    expect(row.meta).toEqual({ company: "New European Strategies" });
    // Źródło z wiersza jest ważniejsze niż znacznik całego importu.
    expect(row.source).toBe("konferencja");
  });

  it("adres bez nazwiska nie dostaje pustej nazwy wyświetlanej", async () => {
    await importNewsletterSubscribers({ data: { rows: [{ email: "sam@example.test" }] } });

    expect(inserted()[0].display_name).toBeNull();
    expect(inserted()[0].last_name).toBeNull();
  });

  it("adres JUŻ NA LIŚCIE jest pomijany - import nie nadpisuje cudzej rezygnacji", async () => {
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) =>
      chain.has("insert") ? ok(null) : ok([{ email: "stary@example.test" }]),
    );

    const res = await importNewsletterSubscribers({
      data: { rows: [{ email: "STARY@example.test" }, { email: "nowy@example.test" }] },
    });

    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(inserted().map((row) => row.email)).toEqual(["nowy@example.test"]);
  });

  it("ten sam adres dwa razy W JEDNYM PLIKU wchodzi raz", async () => {
    // Bez tego jedna osoba dostaje dwie kopie każdej kampanii, a licznik
    // odbiorców kłamie w każdym raporcie.
    const res = await importNewsletterSubscribers({
      data: { rows: [{ email: "duplikat@example.test" }, { email: "Duplikat@example.test" }] },
    });

    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(inserted()).toHaveLength(1);
  });

  it("odrzucony zapis pojedynczego wiersza NIE zatrzymuje reszty pliku", async () => {
    // Import 3000 adresów, w którym jeden łamie ograniczenie bazy, ma wnieść
    // 2999 pozostałych i pokazać ten jeden - a nie wywrócić się w połowie
    // i zostawić listę w stanie, którego nikt nie umie odtworzyć.
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) => {
      if (!chain.has("insert")) return ok([]);
      const row = chain.argsOf("insert")?.[0] as { email?: string } | undefined;
      return row?.email === "zly@example.test" ? fail("duplicate key", "23505") : ok(null);
    });

    const res = await importNewsletterSubscribers({
      data: { rows: [{ email: "zly@example.test" }, { email: "dobry@example.test" }] },
    });

    expect(res.imported).toBe(1);
    expect(res.errors).toEqual([{ email: "zly@example.test", reason: "duplicate key" }]);
  });

  it("pusta odpowiedź na pytanie o adresy już obecne nie blokuje importu", async () => {
    // PostgREST oddaje `data: null`, gdy zapytanie nic nie znalazło w sposób,
    // którego klient nie odróżnia od braku wiersza. Czytanie tego jako awarii
    // zatrzymałoby cały import; czytanie jako pustej listy jest tu poprawne.
    db.setResponse(SUBSCRIBERS, (chain: RecordedChain) => ok(chain.has("insert") ? null : null));

    const res = await importNewsletterSubscribers({
      data: { rows: [{ email: "pierwszy@example.test" }] },
    });

    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it("brak tenanta u wywołującego zatrzymuje import PRZED dotknięciem listy", async () => {
    // Import bez rozstrzygniętego najemcy zapisałby dane osobowe „donikąd",
    // czyli w praktyce do cudzej listy.
    db.setResponse(PROFILES, ok(null));

    await expect(
      importNewsletterSubscribers({ data: { rows: [{ email: "kto@example.test" }] } }),
    ).rejects.toThrow("Profil bez tenanta");
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("błąd odczytu profilu też zatrzymuje import przed zapisem", async () => {
    db.setResponse(PROFILES, fail("profiles unreachable"));

    await expect(
      importNewsletterSubscribers({ data: { rows: [{ email: "kto@example.test" }] } }),
    ).rejects.toThrow("Profil bez tenanta");
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it.each([
    ["adres, który nie jest adresem", { rows: [{ email: "to-nie-mail" }] }],
    ["pusty plik", { rows: [] }],
    ["nieznany status zgody", { rows: [{ email: "a@example.test", status: "kupiony" }] }],
    ["nieznany język", { rows: [{ email: "a@example.test", language: "de" }] }],
    ["brak pola `rows`", {}],
  ])("walidator odrzuca %s - i nic nie leci do bazy", async (_nazwa, payload) => {
    await expect(importNewsletterSubscribers({ data: payload })).rejects.toThrow();
    expect(db.chains).toHaveLength(0);
  });
});

describe("automat wysyłki - odczyt DOWODU działania, nie samego przełącznika", () => {
  it("pełny wiersz oddaje stan, telemetrię ostatniego ticku i głębokość kolejek", async () => {
    const res = await getJobRunnerSettings();

    expect(res.enabled).toBe(true);
    expect(res.base_url).toBe("https://example.test");
    expect(res.effective_base_url).toBe("https://runner.example.test");
    // Sekret NIE opuszcza serwera nawet w podglądzie - panel dostaje sam FAKT
    // ustawienia. Sześć znaków podglądu zawężało przestrzeń sekretu i
    // potwierdzało napastnikowi, że przechwycony nagłówek należy do tej
    // instalacji.
    expect(res.secret_set).toBe(true);
    expect(JSON.stringify(res)).not.toContain("sekret-bardzo-dlugi");
    expect(res.last_tick_at).toBe("2026-08-22T09:59:00.000Z");
    expect(res.last_tick_status).toBe("dispatched");
    expect(res.tick_count).toBe(1234);
    expect(res.queues).toEqual({ auth: 3, transactional: 7, authDlq: 0, transactionalDlq: 1 });
  });

  it("brak wiersza konfiguracji czyta się jako automat WYŁĄCZONY, nie jako awaria", async () => {
    // Świeże wdrożenie nie ma tego wiersza. Panel ma wtedy pokazać „wyłączony
    // i bez adresu" (czyli: nic nie wychodzi), a nie pusty ekran błędu.
    db.setResponse(RUNNER, ok(null));

    const res = await getJobRunnerSettings();

    expect(res).toMatchObject({
      enabled: false,
      base_url: "",
      secret_set: false,
      updated_at: null,
      last_tick_at: null,
      last_tick_status: null,
      last_tick_error: null,
      tick_count: 0,
    });
  });

  it("awaria odczytu konfiguracji jest zgłaszana, a nie przemilczana", async () => {
    db.setResponse(RUNNER, fail("job_runner_settings unreachable"));

    await expect(getJobRunnerSettings()).rejects.toThrow("job_runner_settings unreachable");
  });

  it.each([
    ["dispatched", "dispatched"],
    ["skipped", "skipped"],
    ["error", "error"],
  ])("status ostatniego ticku `%s` dociera do panelu", async (zapisany, oczekiwany) => {
    db.setResponse(RUNNER, ok(runnerRow({ last_tick_status: zapisany })));

    expect((await getJobRunnerSettings()).last_tick_status).toBe(oczekiwany);
  });

  it.each([
    ["napis spoza słownika", "wysłano-chyba"],
    ["wartość pusta", null],
    ["liczba zamiast statusu", 7],
  ])("nieznany status ticku (%s) czyta się jako BRAK informacji", async (_nazwa, zapisany) => {
    // Kafel automatu maluje status kolorem. Nieznana wartość przepuszczona
    // dalej zapaliłaby zielone „wysłano" na podstawie śmiecia w kolumnie.
    db.setResponse(RUNNER, ok(runnerRow({ last_tick_status: zapisany })));

    expect((await getJobRunnerSettings()).last_tick_status).toBeNull();
  });

  it("liczniki kolejek przychodzące z Postgresa jako NAPISY są liczbami w panelu", async () => {
    // `pgmq` liczy `bigint`, a ten w JSON-ie bywa napisem. Bez konwersji panel
    // porównywałby napis z progiem i nigdy nie zapaliłby ostrzeżenia o zatorze.
    rpcPlan.queueDepth = depth({
      auth_emails: "12",
      transactional_emails: "0",
      auth_emails_dlq: 5,
      transactional_emails_dlq: "3",
    });

    expect((await getJobRunnerSettings()).queues).toEqual({
      auth: 12,
      transactional: 0,
      authDlq: 5,
      transactionalDlq: 3,
    });
  });

  it("śmieć w liczniku kolejki czyta się jako zero, nie jako NaN na ekranie", async () => {
    rpcPlan.queueDepth = depth({ auth_emails: "nie-liczba", transactional_emails: true });

    expect((await getJobRunnerSettings()).queues).toEqual({
      auth: 0,
      transactional: 0,
      // Brakującego klucza też nie ma prawa zabraknąć na ekranie.
      authDlq: 0,
      transactionalDlq: 0,
    });
  });

  it.each([
    ["RPC odpowiedziało `ok: false`", depth({ auth_emails: 1 }, false)],
    ["baza nie ma pgmq (pusty obiekt)", {}],
    ["odpowiedź nie jest obiektem", "brak"],
    ["odpowiedź pusta", null],
  ])("kolejki niedostępne (%s) to `null`, a nie same zera", async (_nazwa, odpowiedz) => {
    // Zera znaczą „kolejka pusta, wszystko wyszło". Brak pomiaru znaczy „nie
    // wiem" - i tylko druga z tych odpowiedzi jest prawdziwa na bazie bez pgmq.
    rpcPlan.queueDepth = odpowiedz;

    expect((await getJobRunnerSettings()).queues).toBeNull();
  });

  it("brak adresu efektywnego znaczy, że tick NIE MA GDZIE zapukać", async () => {
    rpcPlan.baseUrl = null;

    expect((await getJobRunnerSettings()).effective_base_url).toBe("");
  });

  it("panel czyta konfigurację z jedynego wiersza tabeli", async () => {
    await getJobRunnerSettings();

    expect(db.lastChain(RUNNER)?.argsOf("eq")).toEqual(["id", 1]);
  });
});

describe("automat wysyłki - zapis konfiguracji", () => {
  it("adres zapisuje się BEZ końcowego ukośnika, żeby nie sklejać `//api`", async () => {
    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://example.test///" },
    });

    expect(res).toEqual({ ok: true });
    expect(db.lastChain(RUNNER)?.argsOf("update")?.[0]).toEqual({
      enabled: true,
      base_url: "https://example.test",
    });
    expect(db.lastChain(RUNNER)?.argsOf("eq")).toEqual(["id", 1]);
  });

  it("wyłączenie automatu z pustym adresem jest poprawnym stanem", async () => {
    // Pusty adres = „wylicz z domeny najemcy"; to nie jest błąd konfiguracji.
    await updateJobRunnerSettings({ data: { enabled: false, base_url: "" } });

    expect(db.lastChain(RUNNER)?.argsOf("update")?.[0]).toEqual({
      enabled: false,
      base_url: "",
    });
  });

  it("nieudany zapis jest zgłaszany - cichy błąd zostawiłby panel z fałszem", async () => {
    db.setResponse(RUNNER, (chain: RecordedChain) =>
      chain.has("update") ? fail("update denied") : ok(runnerRow()),
    );

    await expect(
      updateJobRunnerSettings({ data: { enabled: true, base_url: "" } }),
    ).rejects.toThrow("update denied");
  });

  it.each([
    ["adres bez TLS", "http://example.test"],
    ["adres bez schematu", "example.test"],
    ["adres ze spacją", "https://exa mple.test"],
    // Poniższe cztery przechodziły starą walidację (`^https://[^\s]+$`), choć
    // ścieżka automatyczna (`arm_job_runner`) odrzucała je od zawsze. Ścieżka
    // w URL i userinfo są tu groźne dosłownie: cron wysyła pod ten adres sekret
    // operatora, a `https://ofiara@evil.test` czyta się w panelu jak własna
    // domena.
    ["adres ze ścieżką", "https://evil.test/sciezka"],
    ["adres z userinfo", "https://ofiara@evil.test"],
    ["adres lokalny", "https://localhost"],
    ["adres pętli zwrotnej", "https://127.0.0.1:3000"],
  ])(
    "walidator odrzuca %s - tick niesie sekret, więc idzie WYŁĄCZNIE po https",
    async (_nazwa, adres) => {
      await expect(
        updateJobRunnerSettings({ data: { enabled: true, base_url: adres } }),
      ).rejects.toThrow();
      expect(db.chainsFor(RUNNER)).toHaveLength(0);
    },
  );

  it("walidator odrzuca brak przełącznika - stan automatu musi być jawny", async () => {
    await expect(updateJobRunnerSettings({ data: { base_url: "" } })).rejects.toThrow();
    expect(db.chains).toHaveLength(0);
  });

  it("białe znaki wokół adresu są UCINANE, a nie przemycane do bazy", async () => {
    await updateJobRunnerSettings({
      data: { enabled: true, base_url: "  https://example.test  " },
    });

    expect(db.lastChain(RUNNER)?.argsOf("update")?.[0]).toEqual({
      enabled: true,
      base_url: "https://example.test",
    });
  });
});

describe("automat wysyłki - allowlista hostów zapisu", () => {
  // PO CO ALLOWLISTA. Sam kształt `https://host` nie mówi, czy host jest NASZ.
  // Pod zapisany adres pg_cron puka co minutę z sekretem operatora w nagłówku,
  // więc obcy host w tej kolumnie to przekierowanie sekretu, a nie literówka.
  it("host z katalogu najemców przechodzi", async () => {
    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://example.test" },
    });

    expect(res).toEqual({ ok: true });
    expect(db.lastChain(TENANTS)?.argsOf("select")).toEqual(["domain"]);
  });

  it("OBCY host jest odrzucany i NIE dotyka tabeli konfiguracji", async () => {
    await expect(
      updateJobRunnerSettings({ data: { enabled: true, base_url: "https://evil.test" } }),
    ).rejects.toThrow("base_url_not_in_allowlist");
    expect(db.chainsFor(RUNNER)).toHaveLength(0);
  });

  it("host różniący się WIELKOŚCIĄ LITER i portem to ten sam host", async () => {
    // Domeny nie rozróżniają wielkości liter, a port nie zmienia tożsamości
    // hosta - bez normalizacji `https://Example.test:8443` byłby „obcy".
    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://Example.test:8443" },
    });

    expect(res).toEqual({ ok: true });
  });

  it("host z `PUBLIC_SITE_URL` przechodzi, choć nie ma go w katalogu najemców", async () => {
    // Instalacja jednodomenowa bywa BEZ wpisanej domeny najemcy - wtedy adres
    // aplikacji zna wyłącznie środowisko.
    db.setResponse(TENANTS, ok([{ domain: "" }, { domain: null }]));
    vi.stubEnv("PUBLIC_SITE_URL", "https://app.example.test");

    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://app.example.test" },
    });

    expect(res).toEqual({ ok: true });
  });

  it("furtka `JOB_RUNNER_BASE_URL_ALLOWLIST` wpuszcza host podglądowy", async () => {
    // Staging i podglądy mają host spoza katalogu najemców; bez tej furtki
    // pierwszy zapis po wdrożeniu byłby odrzucony przez własną ochronę.
    vi.stubEnv("JOB_RUNNER_BASE_URL_ALLOWLIST", "preview.example.test, staging.example.test");

    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://staging.example.test" },
    });

    expect(res).toEqual({ ok: true });
  });

  it("PUSTY katalog najemców (zero wierszy) też ODMAWIA - pusta lista nie wpuszcza nikogo", async () => {
    // Inny stan niż błąd odczytu: baza odpowiada POPRAWNIE, tylko nie ma ani
    // jednej domeny. Bez tego przypadku nie widać, czy `tenants ?? []` nie
    // przechodzi przypadkiem w „brak listy = brak ograniczeń" - a to byłaby
    // otwarta furtka na świeżej instalacji, czyli dokładnie tam, gdzie nikt
    // jeszcze nie patrzy.
    db.setResponse(TENANTS, ok(null));

    await expect(
      updateJobRunnerSettings({ data: { enabled: true, base_url: "https://example.test" } }),
    ).rejects.toThrow("base_url_not_in_allowlist");
    expect(db.chainsFor(RUNNER)).toHaveLength(0);
  });

  it("BRAK zmiennej `JOB_RUNNER_BASE_URL_ALLOWLIST` to pusta furtka, nie wyjątek", async () => {
    // Zmiennej nie ma w większości instalacji - ma wtedy działać sam katalog
    // najemców, a nie wywracać się na odczycie nieustawionego środowiska.
    vi.stubEnv("JOB_RUNNER_BASE_URL_ALLOWLIST", undefined);

    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://example.test" },
    });

    expect(res).toEqual({ ok: true });
  });

  it("niedostępny katalog najemców ODMAWIA zapisu - fail closed", async () => {
    // Bez katalogu domen nie wiemy, czy adres jest nasz. Przepuszczenie zapisu
    // „bo baza nie odpowiedziała" zamieniłoby awarię odczytu w otwarte drzwi.
    db.setResponse(TENANTS, fail("tenants unreachable"));

    await expect(
      updateJobRunnerSettings({ data: { enabled: true, base_url: "https://example.test" } }),
    ).rejects.toThrow("base_url_allowlist_unavailable");
    expect(db.chainsFor(RUNNER)).toHaveLength(0);
  });

  it("pusty adres nie pyta o allowlistę - nie ma hosta do sprawdzenia", async () => {
    // Puste = „wylicz z domeny najemcy domyślnego", czyli adres rozstrzyga
    // baza, nie panel.
    await updateJobRunnerSettings({ data: { enabled: false, base_url: "" } });

    expect(db.chainsFor(TENANTS)).toHaveLength(0);
  });
});

describe("automat wysyłki - ślad audytowy zmiany", () => {
  // PO CO. Tabela nie ma `updated_by`, a `updated_at` nadpisuje telemetria
  // ticku już minutę po zapisie. Bez wpisu w `audit_log` po incydencie nie da
  // się ustalić, kto zmienił adres crona ani kiedy.
  it("udany zapis zostawia wpis z autorem, stanem PRZED i PO - ale BEZ sekretu", async () => {
    await updateJobRunnerSettings({
      data: { enabled: false, base_url: "https://example.test" },
    });

    const entry = db.lastChain(AUDIT)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      tenant_id: TENANT,
      actor_id: "user-1",
      action: "job_runner.settings.update",
      entity_type: "job_runner_settings",
      entity_id: "1",
    });
    expect(entry.metadata).toEqual({
      enabled_before: true,
      enabled_after: false,
      base_url_before: "https://example.test",
      base_url_after: "https://example.test",
    });
    // Wpis audytowy czyta się szerzej niż samą tabelę konfiguracji, więc sekret
    // runnera nie ma prawa się w nim znaleźć ani jako pole, ani jako treść.
    expect(JSON.stringify(entry)).not.toContain("sekret-bardzo-dlugi");
  });

  it("stan PRZED czytany jest z jedynego wiersza, zanim zapis go nadpisze", async () => {
    await updateJobRunnerSettings({ data: { enabled: true, base_url: "" } });

    const [odczyt, zapis] = db.chainsFor(RUNNER);
    expect(odczyt?.has("update")).toBe(false);
    expect(odczyt?.argsOf("eq")).toEqual(["id", 1]);
    expect(zapis?.has("update")).toBe(true);
  });

  it("BRAK wiersza konfiguracji: stan PRZED zapisuje się jako `null`, nie jako zgadywanka", async () => {
    // Pierwszy zapis na świeżej instalacji nie ma czego czytać. `null` w polach
    // „przed" jest wtedy JEDYNĄ uczciwą odpowiedzią - domyślenie się `false`
    // albo pustego adresu wpisałoby do dziennika audytu stan, którego nigdy
    // nie było, a to jest gorsze niż luka: ślad, któremu nie wolno wierzyć.
    db.setResponse(RUNNER, ok(null));

    const res = await updateJobRunnerSettings({
      data: { enabled: true, base_url: "https://example.test" },
    });

    expect(res).toEqual({ ok: true });
    const entry = db.lastChain(AUDIT)?.argsOf("insert")?.[0] as { metadata: unknown };
    expect(entry.metadata).toEqual({
      enabled_before: null,
      enabled_after: true,
      base_url_before: null,
      base_url_after: "https://example.test",
    });
  });

  it("audyt rzucający czymś, co NIE JEST `Error`, też nie wywraca zapisu", async () => {
    // Druga droga porażki audytu, osobna od `{ error }` z PostgREST-a: wyjątek
    // spoza warstwy bazy (zerwane połączenie, atrapa, kod bibioteki) bywa
    // napisem albo obiektem. `instanceof Error` jest wtedy fałszywe, więc bez
    // gałęzi `String(...)` log zapisałby „undefined" zamiast powodu - a to
    // jedyny ślad, jaki po tej awarii zostaje.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.setResponse(AUDIT, () => {
      throw "audit_log unreachable";
    });

    const res = await updateJobRunnerSettings({ data: { enabled: true, base_url: "" } });

    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(
      "[updateJobRunnerSettings] audit_log write failed",
      expect.objectContaining({ message: "audit_log unreachable" }),
    );
    spy.mockRestore();
  });

  it("nieudany audyt NIE wywraca zapisu, który w bazie już się wydarzył", async () => {
    // Rzut po udanym UPDATE pokazałby w panelu błąd przy zmianie, która weszła
    // - czyli stan niezgodny z bazą. Audyt jest best-effort, jak `recordJobRun`.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.setResponse(AUDIT, fail("audit_log unreachable"));

    const res = await updateJobRunnerSettings({ data: { enabled: true, base_url: "" } });

    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("brak tenanta wywołującego też nie wywraca zapisu - wpisu po prostu nie ma", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.setResponse(PROFILES, ok(null));

    const res = await updateJobRunnerSettings({ data: { enabled: false, base_url: "" } });

    expect(res).toEqual({ ok: true });
    expect(db.chainsFor(AUDIT)).toHaveLength(0);
    spy.mockRestore();
  });
});
