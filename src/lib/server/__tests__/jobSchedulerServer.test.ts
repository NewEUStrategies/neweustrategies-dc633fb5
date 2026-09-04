// Harmonogram zadań tła - WARSTWA SERWEROWA (`jobScheduler.server.ts`).
//
// PO CO TEN PLIK ISTNIEJE. To te cztery funkcje odpowiadają na pytanie
// „dlaczego newsletter nie wyszedł": `recordJobRun` zapisuje KAŻDY przebieg
// dyspozytora, `ensureJobRunnerArmed` uzbraja ścieżkę podstawową (pg_cron),
// a `readSchedulerHeartbeat` i `countPendingPush` są jedynym źródłem, z którego
// panel i monitoring czytają stan harmonogramu. Do 04.09.2026 moduł miał
// 0/41 linii i 0/6 funkcji.
//
// Zero nie brało się z braku testów, a z ich rodzaju. `SchedulerHealthPanel` ma
// swój test, ale ATRAPUJE ten moduł - i słusznie, bo dowodzi renderowania.
// Skutek: koniec ODCZYTUJĄCY łańcucha „awaria harmonogramu jest widoczna" był
// dowiedziony, a funkcje, które dostarczają mu liczby, nie wykonały się w CI
// ani raz. Ten plik zamyka drugą połowę: tu przedmiotem dowodu jest MAPOWANIE
// na bazę i DEGRADACJA, a nie widok.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   1. `recordJobRun` - mapowanie raportu na argumenty `record_job_run`, w tym
//      normalizacja czasu (`Math.max(0, Math.round(...))`) i - co ważniejsze -
//      pola opcjonalne przekazywane jako `undefined`, a NIE `null`.
//   2. `recordJobRun` NIGDY NIE RZUCA. Brak logu jest mniejszym problemem niż
//      500 na endpoincie, który właśnie wysłał push (:62-65).
//   3. `toJson` (prywatna, dowodzona przez `recordJobRun`) - wartość niedająca
//      się zserializować degraduje się do `null`, a nie wywraca zapisu (:26-33).
//   4. `ensureJobRunnerArmed` - cztery rozłączne wyniki i to, że przy braku
//      poprawnego adresu RPC NIE LECI WCALE.
//   5. `readSchedulerHeartbeat` - mapowanie kolumn, wartości domyślne dla
//      kolumn, których jeszcze nie ma w typach, oraz `null` zamiast rzutu.
//   6. `countPendingPush` - odróżnienie „zero w kolejce" od „nie wiem".
//
// GRANICE, KTÓRE ATRAPUJEMY: WYŁĄCZNIE klient bazy. Każda z tych funkcji
// przyjmuje opcjonalny `client?: DbClient` (`adminClient` :43-47 zwraca podany
// klient BEZ importu), więc atrapa wchodzi parametrem - to najczystsza droga
// i jednocześnie dowód, że wstrzyknięcie działa. Gałąź BEZ klienta (dynamiczny
// import `supabaseAdmin`) ma własną sekcję i tam atrapowany jest moduł klienta.
// PRAWDZIWE zostają wszystkie funkcje tego modułu oraz `normalizeArmOrigin`
// z `@/lib/jobs/scheduler` - to przedmiot dowodu, nie instrument.
//
// WIERNOŚĆ ATRAPY. Błąd bazy jest tworzony przez `pgError`, czyli DZIEDZICZY po
// `Error` - tak jak `PostgrestError` w supabase-js. Bez tego gałąź `throw error`
// / `catch (err)` przechodziłaby obok realnego kształtu wyjątku, a test
// „dowodziłby" degradacji, której produkcja nie wykonuje tak samo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  okCount,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

// --- atrapa klienta bazy -----------------------------------------------------

/** Jedno wywołanie RPC zapisane przez atrapę. */
interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

type RpcResponder = (args: Record<string, unknown>) => SupabaseResult;

/** Powierzchnia klienta service-role, której dotyka ten moduł. */
interface DbSurface {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<SupabaseResult>;
}

/**
 * STRAŻNIK, nie rzutowanie: `as unknown as SupabaseClient` przepuściłby atrapę
 * bez ogniwa `rpc`, czyli test „zdałby" tam, gdzie kod nie miałby czym zapisać
 * przebiegu. Ta sama reguła co w `linkCheckBatch.test.ts`.
 */
function isDbClient(candidate: DbSurface): candidate is DbSurface & SupabaseClient<Database> {
  return typeof candidate.from === "function" && typeof candidate.rpc === "function";
}

interface ClientStub {
  readonly client: SupabaseClient<Database>;
  readonly tables: SupabaseFromStub;
  readonly rpcCalls: RpcCall[];
  setRpc(name: string, responder: RpcResponder | SupabaseResult): void;
  reset(): void;
}

function clientStub(): ClientStub {
  const tables = supabaseFromStub();
  const rpcCalls: RpcCall[] = [];
  const responders = new Map<string, RpcResponder>();
  const candidate: DbSurface = {
    from: tables.from,
    rpc: (name, args) => {
      rpcCalls.push({ name, args });
      const responder = responders.get(name);
      // Brak zaplanowanej odpowiedzi to błąd testu, nie ciche `null`.
      if (!responder) {
        return Promise.resolve(fail(`test: brak zaplanowanej odpowiedzi RPC "${name}"`));
      }
      // Responder wolno RZUCIĆ synchronicznie - tak wygląda padnięcie klienta
      // (np. brak sieci), które kod ma złapać w `catch`, a nie tylko `{ error }`.
      return Promise.resolve(responder(args));
    },
  };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniw from()/rpc()");
  return {
    client: candidate,
    tables,
    rpcCalls,
    setRpc(name, responder) {
      responders.set(name, typeof responder === "function" ? responder : () => responder);
    },
    reset() {
      tables.reset();
      responders.clear();
      rpcCalls.length = 0;
    },
  };
}

/**
 * Klient, który dostaje gałąź BEZ wstrzykniętego parametru - czyli dynamiczny
 * import `supabaseAdmin`. Osobna instancja od tej wstrzykiwanej, żeby dało się
 * dowieść, KTÓRY klient dostał zapytanie.
 */
const fallbackDb = clientStub();

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fallbackDb.client }));

import {
  countPendingPush,
  ensureJobRunnerArmed,
  readSchedulerHeartbeat,
  recordJobRun,
  type JobRunReport,
} from "@/lib/server/jobScheduler.server";

// --- dane syntetyczne --------------------------------------------------------

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const ACTOR = "00000000-0000-4000-8000-0000000000b2";
const ORIGIN = "https://nes.example";

function report(overrides: Partial<JobRunReport> = {}): JobRunReport {
  return { source: "pg_cron", job: "push", ok: true, durationMs: 120, ...overrides };
}

let db: ClientStub;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db = clientStub();
  fallbackDb.reset();
  // Log jest tu ŚWIADCZENIEM (best-effort zapis krzyczy do konsoli), więc
  // przechwytujemy go, zamiast zaśmiecać wyjście przebiegu testów.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  // PUBLIC_SITE_URL jest fallbackiem zbrojenia - domyślnie pusty, żeby żaden
  // test nie zależał od zmiennej środowiskowej maszyny CI.
  vi.stubEnv("PUBLIC_SITE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Argumenty pierwszego wywołania danego RPC na danym kliencie. */
function argsOfRpc(stub: ClientStub, name: string): Record<string, unknown> {
  const call = stub.rpcCalls.find((entry) => entry.name === name);
  if (!call) throw new Error(`test: RPC "${name}" nie zostało zawołane`);
  return call.args;
}

describe("recordJobRun - mapowanie na record_job_run", () => {
  it("przenosi źródło, job, wynik i czas do argumentów RPC", async () => {
    // To jedyny zapis, z którego powstaje heartbeat: `p_source` mówi, KTO
    // tyknął (pg_cron / GitHub Actions / panel), a `p_job` KTÓRY kanał.
    // Pomylenie tych dwóch pól sprawia, że panel pokazuje żywy harmonogram
    // przy martwym cronie - i odwrotnie.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ source: "github_actions", job: "digest-weekly", ok: false }), db.client);

    expect(argsOfRpc(db, "record_job_run")).toMatchObject({
      p_source: "github_actions",
      p_job: "digest-weekly",
      p_ok: false,
      p_duration_ms: 120,
    });
  });

  it("zaokrągla ułamkowy czas trwania", async () => {
    // `performance.now()` daje ułamki, a kolumna jest całkowita. Bez
    // zaokrąglenia PostgREST odrzuciłby wstawienie - czyli log przebiegu
    // ginąłby dokładnie przy tych ścieżkach, które mierzą czas najdokładniej.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ durationMs: 1234.67 }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_duration_ms).toBe(1235);
  });

  it("podnosi UJEMNY czas trwania do zera", async () => {
    // Ujemny czas jest realny: zegar systemowy potrafi cofnąć się między
    // startem i końcem ticku. Kolumna czasu trwania nie ma prawa dostać
    // wartości, która w panelu wygląda jak przebieg z przyszłości.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ durationMs: -42.9 }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_duration_ms).toBe(0);
  });

  it("pola opcjonalne przekazuje jako `undefined`, a NIE `null`", async () => {
    // TO JEST TREŚĆ TEGO TESTU (komentarz :69-71). PostgREST nie wstawia do
    // payloadu klucza o wartości `undefined`, więc zadziała DEFAULT z sygnatury
    // RPC. Jawny `null` byłby ARGUMENTEM podanym wprost - i przy sygnaturze
    // bez wartości domyślnej dla danego typu potrafi rozstrzygnąć przeciążenie
    // funkcji inaczej albo odrzucić wywołanie. Druga asercja pokazuje SKUTEK
    // na drucie: klucz po serializacji ZNIKA z żądania.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report(), db.client);

    const args = argsOfRpc(db, "record_job_run");
    expect(args.p_error).toBeUndefined();
    expect(args.p_tenant_id).toBeUndefined();
    expect(args.p_actor_id).toBeUndefined();
    const wire: unknown = JSON.parse(JSON.stringify(args));
    expect(wire).not.toHaveProperty("p_error");
    expect(wire).not.toHaveProperty("p_tenant_id");
    expect(wire).not.toHaveProperty("p_actor_id");
  });

  it("jawny `null` w raporcie też schodzi do `undefined`", async () => {
    // `JobRunReport` dopuszcza `string | null`, a dyspozytor przekazuje `null`
    // przy przebiegu bez błędu. Kontrakt payloadu musi być ten sam co przy
    // pominiętym polu - inaczej połowa wywołań szłaby inną ścieżką.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ error: null, tenantId: null, actorId: null }), db.client);

    const wire: unknown = JSON.parse(JSON.stringify(argsOfRpc(db, "record_job_run")));
    expect(wire).not.toHaveProperty("p_error");
    expect(wire).not.toHaveProperty("p_tenant_id");
    expect(wire).not.toHaveProperty("p_actor_id");
  });

  it("przekazuje ślad audytowy przebiegu RĘCZNEGO", async () => {
    // Przebieg z panelu to jedyny, który ma autora. Bez `p_tenant_id`
    // i `p_actor_id` log nie odpowiada na pytanie „kto wymusił tę wysyłkę".
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(
      report({ source: "admin", ok: false, error: "push failed", tenantId: TENANT, actorId: ACTOR }),
      db.client,
    );

    expect(argsOfRpc(db, "record_job_run")).toMatchObject({
      p_source: "admin",
      p_error: "push failed",
      p_tenant_id: TENANT,
      p_actor_id: ACTOR,
    });
  });
});

describe("recordJobRun - nigdy nie rzuca", () => {
  it("błąd RPC kończy się logiem, nie wyjątkiem", async () => {
    // Kontrakt z :62-65. Ten zapis wisi ZA wysyłką: pushe już poszły, digest
    // już wyszedł. Rzut zamieniłby udaną wysyłkę w 500 na endpoincie crona,
    // co przy zewnętrznym monitoringu skończyłoby się ponowieniem CAŁEGO ticku
    // - czyli dublowaniem doręczeń z powodu nieudanego LOGU.
    db.setRpc("record_job_run", fail("permission denied for function record_job_run"));

    await expect(recordJobRun(report(), db.client)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[scheduler] record_job_run failed");
  });

  it("padnięcie klienta (rzut zamiast `{ error }`) też jest złapane", async () => {
    // Awaria sieci/klienta nie wraca jako `{ error }`, a jako wyjątek. Gałąź
    // `catch` musi obsłużyć oba kształty, bo w produkcji występują oba.
    db.setRpc("record_job_run", () => {
      throw new Error("fetch failed");
    });

    await expect(recordJobRun(report(), db.client)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("na ścieżce udanej NIE loguje nic", async () => {
    // Log błędu jest sygnałem alarmowym. Gdyby zapalał się przy każdym
    // poprawnym zapisie, przestałby cokolwiek znaczyć.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report(), db.client);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("recordJobRun - serializacja wyniku ticku (toJson)", () => {
  it("przepuszcza zwykły wynik ticku bez zmiany", async () => {
    // Kolumna docelowa to `jsonb`, a podsumowanie ticku jest heterogeniczne
    // (każdy job zwraca własny kształt). Round-trip przez JSON daje DOKŁADNIE
    // to, co wylądowałoby w bazie - i to jest tu przedmiotem dowodu.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ result: { push: { sent: 3 }, digest: null } }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_result).toEqual({
      push: { sent: 3 },
      digest: null,
    });
  });

  it("brak wyniku zapisuje jako `null`, nie jako `undefined`", async () => {
    // Tu `undefined` byłoby błędem: `p_result` NIE ma być pominięty
    // (kolumna ma dostać jawny `null`), inaczej wiersz logu różniłby się
    // kształtem w zależności od tego, czy job cokolwiek zwrócił.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report(), db.client);

    const args = argsOfRpc(db, "record_job_run");
    expect(args.p_result).toBeNull();
    expect(JSON.parse(JSON.stringify(args))).toHaveProperty("p_result", null);
  });

  it("CYKL w wyniku degraduje się do `null`, a zapis i tak leci", async () => {
    // Cykl jest realny: wynik joba potrafi nieść obiekt błędu z referencją
    // wstecz. `JSON.stringify` rzuca na nim `TypeError`. Bez degradacji ten
    // rzut wywróciłby zapis, który właśnie potwierdza ŻYWY harmonogram -
    // czyli awaria pojedynczego pola zabrałaby heartbeat całego ticku.
    db.setRpc("record_job_run", ok(null));
    const cyclic: { name: string; self?: unknown } = { name: "tick" };
    cyclic.self = cyclic;

    await recordJobRun(report({ result: cyclic }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("BigInt w wyniku degraduje się do `null`", async () => {
    // Druga realna wartość nieserializowalna. Kontrakt jest ten sam: log
    // zubożony o jedno pole jest wielokrotnie lepszy niż brak logu.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ result: { rows: 10n } }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_result).toBeNull();
  });

  it("pola `undefined` wewnątrz wyniku wypadają, tak jak w bazie", async () => {
    // Dowód, że to naprawdę round-trip JSON, a nie kopia referencji: `jsonb`
    // nie zna `undefined`, więc panel nigdy nie zobaczy takiego klucza.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ result: { sent: 1, skipped: undefined } }), db.client);

    expect(argsOfRpc(db, "record_job_run").p_result).toEqual({ sent: 1 });
  });
});

describe("ensureJobRunnerArmed", () => {
  it("uzbraja runner originem żądania i mówi o tym w logu", async () => {
    // Baza NIE ZNA publicznego adresu aplikacji, ale każde żądanie ticku go
    // zna (:11-16). Pierwszy tick z dowolnej ścieżki uzbraja pg_cron, czyli
    // uruchamia ścieżkę podstawową bez zewnętrznych zależności. `console.info`
    // jest tu jedynym śladem, że to się stało - i dlatego jest asercją.
    db.setRpc("arm_job_runner", ok({ armed: true }));

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("armed");
    expect(argsOfRpc(db, "arm_job_runner")).toEqual({ p_base_url: ORIGIN });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizuje origin do schematu i hosta, bez ścieżki i parametrów", async () => {
    // `base_url` jest sklejany w bazie z trasą ticku, więc doklejona ścieżka
    // albo query dałyby adres, pod którym nie ma endpointu - runner tykałby
    // w 404 i wyglądał na uzbrojony.
    db.setRpc("arm_job_runner", ok({ armed: true }));

    await ensureJobRunnerArmed("https://nes.example/api/public/community-cron?job=push", db.client);

    expect(argsOfRpc(db, "arm_job_runner")).toEqual({ p_base_url: ORIGIN });
  });

  it("wynik `already_configured`, gdy wiersz konfiguracji nie jest dziewiczy", async () => {
    // RPC rusza WYŁĄCZNIE dziewiczy wiersz, więc świadome wyłączenie runnera
    // zostaje wyłączone (:91-94). Ten wynik to normalny stan każdego ticku po
    // pierwszym, a nie ostrzeżenie - dlatego nie loguje się jako błąd.
    db.setRpc("arm_job_runner", ok({ armed: false, reason: "already_configured" }));

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("already_configured");
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("pusta odpowiedź RPC czyta się jako `already_configured`", async () => {
    // Degradacja w stronę „nic nie robię": nieznany kształt odpowiedzi nie ma
    // prawa udawać udanego zbrojenia ani awarii.
    db.setRpc("arm_job_runner", ok(null));

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("already_configured");
  });

  it("przekazuje odmowę bazy `invalid_base_url` bez tłumaczenia jej na sukces", async () => {
    // Baza ma własną walidację adresu (np. odrzuca host prywatny). Zlanie tego
    // z `already_configured` ukryłoby fakt, że runner NIGDY nie został
    // uzbrojony - a to jest dokładnie ta awaria, której szukamy godzinami.
    db.setRpc("arm_job_runner", ok({ armed: false, reason: "invalid_base_url" }));

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("invalid_base_url");
  });

  it("błąd RPC daje `unavailable` i log, nie rzut", async () => {
    // Zbrojenie jest best-effort (:18-19): nie może wywalić wysyłki, która
    // właśnie się udała. `unavailable` odróżnia „nie wiem" od „skonfigurowane".
    db.setRpc("arm_job_runner", fail("function arm_job_runner does not exist"));

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("unavailable");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[scheduler] arm_job_runner failed");
  });

  it("padnięcie klienta też daje `unavailable`", async () => {
    db.setRpc("arm_job_runner", () => {
      throw new Error("fetch failed");
    });

    await expect(ensureJobRunnerArmed(ORIGIN, db.client)).resolves.toBe("unavailable");
  });

  it("bez poprawnego originu i bez PUBLIC_SITE_URL NIE woła RPC WCALE", async () => {
    // Asercja na LICZBIE WYWOŁAŃ jest tu treścią: zbrojenie adresem `null`
    // albo pustym stringiem zapisałoby do konfiguracji śmieć, który pg_cron
    // dopiero potem odrzuci - i to na produkcji, nie w CI.
    await expect(ensureJobRunnerArmed(null, db.client)).resolves.toBe("invalid_base_url");
    expect(db.rpcCalls).toHaveLength(0);
  });

  it.each([
    ["pusty origin", ""],
    ["nie-URL", "nie-adres"],
    ["http zamiast https", "http://nes.example"],
    ["localhost", "https://localhost:3000"],
    ["pętla zwrotna", "https://127.0.0.1"],
  ])("odrzuca origin: %s", async (_label, origin) => {
    // Adresy lokalne i nieszyfrowane są odrzucane, bo baza wołałaby z nich
    // sama siebie z sieci Supabase - tick trafiałby w nikąd. Każdy z tych
    // przypadków MUSI kończyć się bez wywołania RPC.
    await expect(ensureJobRunnerArmed(origin, db.client)).resolves.toBe("invalid_base_url");
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("spada na PUBLIC_SITE_URL, gdy origin żądania jest bezużyteczny", async () => {
    // Ścieżka realna: tick z pg_cron albo z CLI nie ma originu HTTP. Bez tego
    // fallbacku runner nie uzbroiłby się nigdy w instalacji, w której pierwszy
    // tick nie przychodzi z przeglądarki.
    vi.stubEnv("PUBLIC_SITE_URL", "https://kopia.example");
    db.setRpc("arm_job_runner", ok({ armed: true }));

    await expect(ensureJobRunnerArmed("http://localhost:5173", db.client)).resolves.toBe("armed");
    expect(argsOfRpc(db, "arm_job_runner")).toEqual({ p_base_url: "https://kopia.example" });
  });

  it("origin żądania WYGRYWA z PUBLIC_SITE_URL", async () => {
    // Kolejność jest kontraktem: w instalacji wielodomenowej to origin żądania
    // wskazuje domenę, pod którą aplikacja faktycznie odpowiada.
    vi.stubEnv("PUBLIC_SITE_URL", "https://kopia.example");
    db.setRpc("arm_job_runner", ok({ armed: true }));

    await ensureJobRunnerArmed(ORIGIN, db.client);

    expect(argsOfRpc(db, "arm_job_runner")).toEqual({ p_base_url: ORIGIN });
  });
});

describe("readSchedulerHeartbeat", () => {
  const FULL_ROW = {
    enabled: true,
    base_url: ORIGIN,
    last_invoked_at: "2026-09-04T10:00:00.000Z",
    last_app_run_at: "2026-09-04T09:59:00.000Z",
    last_app_ok_at: "2026-09-04T09:58:00.000Z",
    last_app_error: "push channel timeout",
    failure_streak: 3,
  };

  it("mapuje kolumny heartbeatu na pola wyniku", async () => {
    // Każde z tych pól odpowiada na osobne pytanie diagnostyczne: czy runner
    // jest włączony, pod jakim adresem tyka, kiedy baza go WOŁAŁA, kiedy
    // aplikacja faktycznie PRACOWAŁA i kiedy zrobiła to BEZ błędu. Pomylenie
    // `last_invoked_at` z `last_app_run_at` ukrywa najczęstszą awarię:
    // cron tyka, a aplikacja nie odpowiada.
    db.tables.setResponse("job_runner_settings", ok(FULL_ROW));

    await expect(readSchedulerHeartbeat(db.client)).resolves.toEqual({
      enabled: true,
      baseUrl: ORIGIN,
      lastInvokedAt: "2026-09-04T10:00:00.000Z",
      lastAppRunAt: "2026-09-04T09:59:00.000Z",
      lastAppOkAt: "2026-09-04T09:58:00.000Z",
      lastAppError: "push channel timeout",
      failureStreak: 3,
    });
  });

  it("czyta wiersz konfiguracji jednym zapytaniem po kluczu id = 1", async () => {
    // Tabela ma DOKŁADNIE jeden wiersz konfiguracji. Brak zawężenia
    // `.eq("id", 1)` albo użycie `.single()` zamiast `.maybeSingle()`
    // zamieniłoby brak wiersza w błąd zapytania, czyli w `null` z gałęzi
    // awaryjnej - i sonda mówiłaby „nie wiem" tam, gdzie odpowiedź jest znana.
    db.tables.setResponse("job_runner_settings", ok(FULL_ROW));

    await readSchedulerHeartbeat(db.client);

    const chain = db.tables.lastChain("job_runner_settings");
    expect(chain?.argsOf("eq")).toEqual(["id", 1]);
    expect(chain?.has("maybeSingle")).toBe(true);
    expect(String(chain?.argsOf("select")?.[0])).toContain("failure_streak");
  });

  it("uzupełnia wartości domyślne dla kolumn, których wiersz nie niesie", async () => {
    // Kolumny heartbeatu doszły migracją 20260731110000 i NIE MA ich jeszcze
    // w wygenerowanych typach. Wiersz sprzed migracji (albo z instalacji, gdzie
    // migracja nie doszła) nie ma prawa dać panelowi `undefined`: `enabled`
    // domyślnie FAŁSZ (bezpieczniej pokazać martwy runner niż udawać żywy),
    // `baseUrl` pusty string, a `failureStreak` zero.
    db.tables.setResponse("job_runner_settings", ok({}));

    await expect(readSchedulerHeartbeat(db.client)).resolves.toEqual({
      enabled: false,
      baseUrl: "",
      lastInvokedAt: null,
      lastAppRunAt: null,
      lastAppOkAt: null,
      lastAppError: null,
      failureStreak: 0,
    });
  });

  it("brak wiersza konfiguracji daje `null`", async () => {
    // `null` znaczy tu „nie ma czego pokazać" - inaczej niż wiersz z zerami,
    // który znaczy „jest konfiguracja i jest wyłączona".
    db.tables.setResponse("job_runner_settings", ok(null));

    await expect(readSchedulerHeartbeat(db.client)).resolves.toBeNull();
  });

  it("błąd odczytu daje `null` i log, nie rzut", async () => {
    // Sonda zdrowia nie ma prawa wywrócić endpointu, który ją zawiera.
    // Brak heartbeatu to informacja, nie awaria żądania.
    db.tables.setResponse("job_runner_settings", fail("relation does not exist"));

    await expect(readSchedulerHeartbeat(db.client)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[scheduler] heartbeat read failed");
  });
});

describe("countPendingPush", () => {
  it("liczy WYŁĄCZNIE pozycje o statusie `pending`", async () => {
    // Bez zawężenia statusu licznik pokazywałby całą historię kolejki, czyli
    // rosłby monotonicznie i nigdy nie spadał do zera - alarm o zatorze byłby
    // wtedy zawsze zapalony i dlatego bezwartościowy. `head: true` pilnuje,
    // żeby sonda zdrowia nie ściągała wierszy.
    db.tables.setResponse("notification_push_queue", okCount(12));

    await expect(countPendingPush(db.client)).resolves.toBe(12);
    const chain = db.tables.lastChain("notification_push_queue");
    expect(chain?.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(chain?.argsOf("eq")).toEqual(["status", "pending"]);
  });

  it("pusta kolejka to ZERO, a nie brak odpowiedzi", async () => {
    db.tables.setResponse("notification_push_queue", okCount(0));

    await expect(countPendingPush(db.client)).resolves.toBe(0);
  });

  it("brak licznika w odpowiedzi bazy czyta się jako zero", async () => {
    // PostgREST potrafi nie podać `count`. Zero jest tu jedyną bezpieczną
    // odpowiedzią, bo `null` znaczy w tym kontrakcie „awaria odczytu".
    db.tables.setResponse("notification_push_queue", { data: null, error: null, count: null });

    await expect(countPendingPush(db.client)).resolves.toBe(0);
  });

  it("błąd odczytu daje `null` - `null` to NIE zero", async () => {
    // TO JEST CAŁY KONTRAKT TEJ FUNKCJI. Zwrócenie zera przy nieudanym
    // odczycie pokazałoby w panelu „kolejka pusta" w chwili, w której kolejka
    // może mieć tysiące zaległych powiadomień. Dokładnie ten rodzaj pomyłki
    // opisuje nagłówek modułu: „kolejka pusta" mylone z „harmonogram martwy".
    db.tables.setResponse("notification_push_queue", fail("permission denied"));

    await expect(countPendingPush(db.client)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[scheduler] pending push count failed");
  });
});

describe("adminClient - wybór klienta", () => {
  it("używa WSTRZYKNIĘTEGO klienta i nie sięga po service role", async () => {
    // Dowód, że `adminClient` (:43-47) zwraca podany klient BEZ importu.
    // To nie jest wygoda testu: gdyby funkcja i tak ładowała `supabaseAdmin`,
    // każde wywołanie z wstrzykniętym klientem obchodziłoby zawężenie
    // uprawnień, które wywołujący właśnie wybrał.
    db.setRpc("record_job_run", ok(null));

    await recordJobRun(report(), db.client);

    expect(db.rpcCalls).toHaveLength(1);
    expect(fallbackDb.rpcCalls).toHaveLength(0);
  });

  it("bez klienta zapisuje przebieg klientem service role", async () => {
    // Gałąź produkcyjna: dyspozytor woła te funkcje BEZ parametru, więc to ona
    // wykonuje się na każdym tyknięciu crona. Import jest dynamiczny, żeby
    // klient service role nie wchodził do bundla klienta.
    fallbackDb.setRpc("record_job_run", ok(null));

    await recordJobRun(report({ job: "career-cv-retention" }), fallbackDb.client);

    expect(argsOfRpc(fallbackDb, "record_job_run")).toMatchObject({
      p_job: "career-cv-retention",
    });
  });

  it("bez klienta uzbraja runner klientem service role", async () => {
    fallbackDb.setRpc("arm_job_runner", ok({ armed: true }));

    await expect(ensureJobRunnerArmed(ORIGIN)).resolves.toBe("armed");
    expect(argsOfRpc(fallbackDb, "arm_job_runner")).toEqual({ p_base_url: ORIGIN });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("bez klienta czyta heartbeat klientem service role", async () => {
    fallbackDb.tables.setResponse("job_runner_settings", ok({ enabled: true, base_url: ORIGIN }));

    await expect(readSchedulerHeartbeat()).resolves.toMatchObject({
      enabled: true,
      baseUrl: ORIGIN,
    });
    expect(db.tables.chains).toHaveLength(0);
  });

  it("bez klienta liczy kolejkę push klientem service role", async () => {
    fallbackDb.tables.setResponse("notification_push_queue", okCount(4));

    await expect(countPendingPush()).resolves.toBe(4);
    expect(fallbackDb.tables.lastChain("notification_push_queue")?.argsOf("eq")).toEqual([
      "status",
      "pending",
    ]);
  });

  it("bez klienta `recordJobRun` nadal nie rzuca przy błędzie service role", async () => {
    // Ta kombinacja (gałąź produkcyjna + awaria zapisu) jest tą, która
    // faktycznie zdarza się na produkcji - i to ona nie ma prawa wywalić
    // endpointu crona.
    fallbackDb.setRpc("record_job_run", fail("statement timeout"));

    await expect(recordJobRun(report())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
