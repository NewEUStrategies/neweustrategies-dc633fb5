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

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => {
  resetServerFnContext();
});

describe("obudowa - kto w ogóle może wołać te funkcje", () => {
  it("import listy i konfiguracja automatu są za rolą redakcyjną", () => {
    // Dowód STRUKTURALNY, nie behawioralny: harness nie uruchamia middleware,
    // więc jedyne, co można tu uczciwie przybić, to DEKLARACJA bramki. Gdyby
    // ktoś ją zdjął, import cudzych danych osobowych stanąłby otworem dla
    // każdego zalogowanego.
    for (const fn of [importNewsletterSubscribers, getJobRunnerSettings, updateJobRunnerSettings]) {
      expect(serverFnMeta(fn)?.middleware).toEqual([{ __mw: "requireStaff" }]);
    }
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
    // Sekret NIE opuszcza serwera - w panelu widać wyłącznie sześć znaków.
    expect(res.secret_preview).toBe("sekret…");
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
      secret_preview: "",
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
});
