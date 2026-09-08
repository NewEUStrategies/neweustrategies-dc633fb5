// Harmonogram kanałów społeczności: GET/POST /api/public/community-cron.
//
// PO CO TEN PLIK ISTNIEJE. To PUBLICZNY adres, za którym stoi cała maszyna
// doręczeń społeczności: kolejka push, digesty dzienne i tygodniowe,
// przypomnienia o wydarzeniach i o zadaniach CRM, retencja plików CV kandydatów
// (dane osobowe!) oraz uzgadnianie odznak reputacji. Jedyną bramką jest
// współdzielony sekret w nagłówku `x-community-cron-secret`. Do 02.09.2026 plik
// nie miał ANI JEDNEGO testu (0/93 linii, 0/20 funkcji), więc zdjęcie bramki,
// odwrócenie porównania sekretu albo ciche zjedzenie awarii jednego kanału
// przechodziłoby przez CI bez śladu.
//
// CO JEST PRZEDMIOTEM DOWODU. Endpoint jest cienki i to jest jego zaletą: cała
// idempotencja, okna czasowe i claim SKIP LOCKED żyją w Postgresie. Dlatego
// dowodzimy DOKŁADNIE tego, co robi warstwa HTTP i nic ponadto:
//   1. kto ma prawo uruchomić kanały (sekret env, sekret z tabeli, Bearer),
//   2. że odmowa NIE MA efektów ubocznych (a nie tylko zwraca 401),
//   3. które kanały ruszają dla którego `?job=` i co wygrywa: query czy body,
//   4. że awaria jednego kanału nie zabiera pozostałych, a przebieg i tak
//      trafia do logu z `ok:false` i sklejoną przyczyną,
//   5. że budżet czasu POMIJA kolejne kroki (pominięcie to nie awaria),
//   6. że tick UZBRAJA ścieżkę podstawową publicznym originem żądania,
//   7. że sonda GET diagnozuje zastój bez żadnego efektu ubocznego.
//
// JAK ASERTUJEMY. Przez SKUTEK, nie przez kod odpowiedzi. `200` na ścieżce
// szczęśliwej jest zgodne również ze światem, w którym endpoint nie uruchomił
// niczego, a `401` jest zgodny ze światem, w którym najpierw wysłał wszystkie
// pushe, a dopiero potem sprawdził sekret. Dlatego każdy dowód patrzy na to,
// KTÓRE kanały zostały zawołane i z jakimi argumentami, jaki origin dostało
// zbrojenie i jaki wiersz poszedł do logu przebiegów. Kod odpowiedzi
// sprawdzamy tam, gdzie jest jedynym kontraktem (401 / 400 / 429 / 503 / 500).
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO:
//   * `@tanstack/react-start/server` (`getRequest`) - w teście nie ma runtime'u
//     serwera, a handler i tak czyta żądanie wyłącznie stąd,
//   * `@/integrations/supabase/client.server` - klient service role,
//   * `@/lib/notifications/dispatch.server`, `@/lib/server/jobScheduler.server`,
//     `@/lib/server/careerCvRetention.server`,
//     `@/lib/community/reputationBadges.server` - to SĄSIEDNIE moduły, każdy
//     z własnym testem; tutaj przedmiotem dowodu jest dyspozytor, więc ich
//     atrapy są instrumentem pomiarowym, nie zastępstwem dowodu.
// PRAWDZIWE zostają: limiter po adresie, porównanie sekretu w stałym czasie,
// `parseSchedulerJob`, `normalizeSchedulerSource`, `schedulerFreshness`,
// `isSchedulerAlarming`, budżet czasu i składanie odpowiedzi. To one są
// przedmiotem dowodu, więc atrapowanie ich zamieniłoby plik w test atrapy.
//
// GRANICA DOWODU - RÓWNOLEGŁOŚĆ. Sekcja o nakładających się tickach NIE jest
// testem współbieżności bazy i nie udaje nim być. Zatrzymujemy pierwszy tick
// w środku kanału push i wpuszczamy drugi, więc dowodzimy DOKŁADNIE jednej
// rzeczy: endpoint nie ma WŁASNEGO deduplikatora - drugie wywołanie przechodzi
// i kończy się, choć pierwsze wciąż pracuje, i oba zapisują przebieg. To jest
// zamierzone: jedynym mechanizmem braku dublowania pracy jest claim
// `FOR UPDATE SKIP LOCKED` w Postgresie, a jego dowód mieszka w pgTAP, nie
// w atrapie klienta. Gdyby ktoś dołożył tu pamięciową blokadę „jeden tick
// naraz", ten test zapali się jako pierwszy i wymusi rozmowę o tym, że pamięć
// pojedynczego izolatu niczego nie gwarantuje przy wielu instancjach workera.
//
// ŁAŃCUCH „AWARIA HARMONOGRAMU JEST WIDOCZNA" JEST DOMKNIĘTY Z OBU STRON.
// Ten plik pokrywa koniec ZAPISUJĄCY: przebieg (udany i nieudany) trafia do
// `recordJobRun`, czyli do `public.job_runner_runs`, razem ze źródłem, jobem,
// czasem i przyczyną. Koniec ODCZYTUJĄCY pokrywają:
//   * `src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx`
//     - stan `stale`/`never` podnosi widoczny alert operatora, a stan zdrowy go
//       nie podnosi,
//   * `src/routes/__tests__/adminCommunityNotificationsRoute.test.tsx`
//     - trasa `/admin/community/notifications` montuje ten panel PRZED siatką
//       statystyk i (asercja dołożona razem z tym plikiem) faktycznie montuje
//       komponent czytający zdrowie z logu przebiegów, a nie statyczny baner.
// Ogniwo pośrodku - to, że RPC `job_scheduler_health` liczy świeżość z
// `job_runner_runs` - jest po stronie bazy i sprawdza je pgTAP.
//
// SEKRET. Generowany losowo w teście (`node:crypto`), nigdy nie logowany
// i nigdy nie zapisywany na stałe. Wariant „zły sekret" ma DOKŁADNIE tę samą
// długość co dobry, żeby odmowa nie mogła brać się z długości bufora.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { advanceClock } from "@/test/time";
import { randomBytes } from "node:crypto";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import type {
  ArmOutcome,
  JobRunReport,
  SchedulerHeartbeat,
} from "@/lib/server/jobScheduler.server";

// --- atrapy granic ----------------------------------------------------------

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

const db = vi.hoisted(() => ({ current: null as SupabaseFromStub | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.current!.from(table) },
}));

/**
 * Rejestr kanałów. Jedna funkcja `run` obsługuje wszystkie sześć granic, więc
 * kolejność wywołań jest mierzalna w JEDNEJ liście - a kolejność jest treścią:
 * push idzie przed digestami, a odznaki reputacji na końcu.
 *
 * `beforeStep` to zaczep dla budżetu czasu: test przesuwa nim zamrożony zegar
 * DOKŁADNIE w chwili, w której kanał zaczyna pracę. Zaczep jest polem, a nie
 * bezpośrednim wywołaniem `vi.setSystemTime`, bo fabryka `vi.hoisted` jest
 * wynoszona nad importy i nie wolno w niej sięgać po zaimportowane referencje.
 */
const jobs = vi.hoisted(() => {
  const state = {
    calls: [] as { step: string; args: readonly unknown[] }[],
    /** Kanały, które mają rzucić `Error`: nazwa kroku -> komunikat. */
    failures: new Map<string, string>(),
    /** Kanały, które rzucają czymś, co NIE jest `Error` (napis, obiekt). */
    rawFailures: new Map<string, unknown>(),
    /** Kanały ZATRZYMANE do ręcznego zwolnienia - do dowodu o nakładaniu ticków. */
    holds: new Map<string, Promise<void>>(),
    beforeStep: null as ((step: string) => void) | null,
    run(step: string, args: readonly unknown[], value: unknown): Promise<unknown> {
      state.beforeStep?.(step);
      state.calls.push({ step, args });
      if (state.rawFailures.has(step)) return Promise.reject(state.rawFailures.get(step));
      const failure = state.failures.get(step);
      if (failure !== undefined) return Promise.reject(new Error(failure));
      const hold = state.holds.get(step);
      return hold ? hold.then(() => value) : Promise.resolve(value);
    },
    steps(): string[] {
      return state.calls.map((c) => c.step);
    },
    reset(): void {
      state.calls.length = 0;
      state.failures.clear();
      state.rawFailures.clear();
      state.holds.clear();
      state.beforeStep = null;
    },
  };
  return state;
});

vi.mock("@/lib/notifications/dispatch.server", () => ({
  processPushJobs: (limit: number) => jobs.run("push", [limit], { sent: 4, failed: 0 }),
  processDigests: (kind: string, limit: number) =>
    jobs.run(`digest:${kind}`, [kind, limit], { sent: 2 }),
  runEventReminders: () => jobs.run("eventReminders", [], 3),
  runCrmTaskReminders: () => jobs.run("crmTaskReminders", [], 1),
}));

vi.mock("@/lib/server/careerCvRetention.server", () => ({
  runCareerCvRetention: () => jobs.run("careerCvRetention", [], { removed: 2, scanned: 9 }),
}));

vi.mock("@/lib/community/reputationBadges.server", () => ({
  reconcileReputationBadges: (limit: number) =>
    jobs.run("reputationBadges", [limit], { granted: 1, revoked: 0 }),
}));

const scheduler = vi.hoisted(() => ({
  /** Origin przekazany do `ensureJobRunnerArmed`, tick po ticku. */
  armCalls: [] as (string | null | undefined)[],
  /** Kolejne wyniki zbrojenia; ostatni powtarza się dla dalszych ticków. */
  armOutcomes: [] as ArmOutcome[],
  /** Wiersze, które trafiłyby do `public.job_runner_runs`. */
  runs: [] as JobRunReport[],
  heartbeat: null as SchedulerHeartbeat | null,
  heartbeatReads: 0,
  pendingPush: null as number | null,
  pendingReads: 0,
}));

vi.mock("@/lib/server/jobScheduler.server", () => ({
  ensureJobRunnerArmed: (origin?: string | null): Promise<ArmOutcome> => {
    scheduler.armCalls.push(origin);
    const index = Math.min(scheduler.armCalls.length - 1, scheduler.armOutcomes.length - 1);
    return Promise.resolve(scheduler.armOutcomes[index] ?? "armed");
  },
  recordJobRun: (report: JobRunReport): Promise<void> => {
    scheduler.runs.push(report);
    return Promise.resolve();
  },
  readSchedulerHeartbeat: (): Promise<SchedulerHeartbeat | null> => {
    scheduler.heartbeatReads += 1;
    return Promise.resolve(scheduler.heartbeat);
  },
  countPendingPush: (): Promise<number | null> => {
    scheduler.pendingReads += 1;
    return Promise.resolve(scheduler.pendingPush);
  },
}));

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/community-cron";

const handlers = routeServerHandlers(Route);
const postHandler = handlers.POST!;
const getHandler = handlers.GET!;

// --- stałe scenariusza ------------------------------------------------------

/**
 * Sekret ŻYWY, generowany na każdy przebieg pliku. Nie ma go w repo, nie ma go
 * w logu i nie da się go utrwalić przypadkiem w migawce.
 */
const SECRET = randomBytes(24).toString("hex");
/** Ta sama DŁUGOŚĆ co `SECRET`, inna treść - dowód, że odmowa nie jest o długości. */
const WRONG_SECRET = randomBytes(24).toString("hex");
/** Sekret z tabeli `job_runner_settings` - druga, bazodanowa droga autoryzacji. */
const DB_SECRET = randomBytes(24).toString("hex");

const NOW = new Date("2026-09-02T09:00:00.000Z");
const BASE_URL = "https://neweuropeanstrategies.com/api/public/community-cron";

/** ISO przesunięte WSTECZ o `ms` względem zamrożonego „teraz". */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function heartbeat(over: Partial<SchedulerHeartbeat> = {}): SchedulerHeartbeat {
  return {
    enabled: true,
    baseUrl: "https://neweuropeanstrategies.com",
    lastInvokedAt: ago(30_000),
    lastAppRunAt: ago(30_000),
    lastAppOkAt: ago(30_000),
    lastAppError: null,
    failureStreak: 0,
    ...over,
  };
}

// --- pomocnicy żądania ------------------------------------------------------

/**
 * Każde żądanie z INNEGO adresu. Limiter (`capacity 30`, `0,5 żetonu/s`) jest
 * stanem MODUŁU wspólnym dla całego pliku, a czas jest zamrożony - bez
 * unikalnych adresów kolejne testy zjadałyby sobie kubełek i padały zależnie od
 * kolejności wykonania.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.60.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface CallOptions {
  /** `null` = brak nagłówka sekretu w ogóle. */
  secret?: string | null;
  /** `Authorization: Bearer ...` zamiast dedykowanego nagłówka. */
  bearer?: string;
  query?: string;
  body?: unknown;
  rawBody?: string;
  ip?: string;
  headers?: Record<string, string>;
  /** Wyłącza nagłówek `x-forwarded-for` - do dowodu o wspólnym kubełku. */
  noIp?: boolean;
}

function buildRequest(method: "GET" | "POST", options: CallOptions): Request {
  const headers = new Headers(options.headers ?? {});
  if (!options.noIp) headers.set("x-forwarded-for", options.ip ?? nextIp());
  if (options.secret !== null && options.secret !== undefined) {
    headers.set("x-community-cron-secret", options.secret);
  }
  if (options.bearer !== undefined) headers.set("authorization", options.bearer);
  const body =
    method === "GET"
      ? undefined
      : (options.rawBody ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)));
  const request = new Request(`${BASE_URL}${options.query ?? ""}`, { method, headers, body });
  // `Host` jest nagłówkiem ZABRONIONYM w konstruktorze `Request` (happy-dom
  // trzyma się tu reguł przeglądarki i po prostu go wycina), a w Workerze on
  // JEST i produkcyjny `originFromRequest` na niego spada. Dokładamy go więc po
  // konstrukcji - inaczej gałąź awaryjna origin-u byłaby nietestowalna.
  const host = options.headers?.host;
  if (host !== undefined) request.headers.set("host", host);
  return request;
}

/**
 * Start POST-a BEZ czekania na jego zakończenie. `getRequest()` jest czytany
 * synchronicznie w pierwszej linii handlera, zanim sterowanie wróci do testu,
 * więc kolejny start nie podmienia żądania tickowi, który już biegnie - i
 * dopiero to pozwala uczciwie zmierzyć NAKŁADANIE SIĘ dwóch wywołań.
 */
function startPost(options: CallOptions = {}): Promise<Response> {
  req.current = buildRequest("POST", options);
  return postHandler({ request: req.current });
}

function post(options: CallOptions = {}): Promise<Response> {
  return startPost(options);
}

function get(options: CallOptions = {}): Promise<Response> {
  req.current = buildRequest("GET", options);
  return getHandler({ request: req.current });
}

/** Autoryzowany POST - domyślny punkt wyjścia większości testów. */
function tick(options: Omit<CallOptions, "secret"> = {}): Promise<Response> {
  return post({ ...options, secret: SECRET });
}

/** Ciało odpowiedzi jako rekord - bez rzutowań w teście. */
async function body(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
}

/** Sekcja wyniku pojedynczego kanału (`push`, `digestDaily`, ...). */
function channel(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value !== null && typeof value === "object" ? { ...value } : {};
}

/** Odroczenie sterowane z testu: `promise` czeka, aż ktoś zawoła `release`. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

/** Wiersz logu przebiegów - jedyne źródło prawdy panelu admina. */
function lastRun(): JobRunReport {
  const run = scheduler.runs.at(-1);
  if (!run) throw new Error("test: żaden przebieg nie trafił do logu");
  return run;
}

// --- zasiew ------------------------------------------------------------------

/** `undefined` = brak wiersza konfiguracji, `"throw"` = padnięcie odczytu. */
function seedRunnerSettings(secret?: string | "throw"): void {
  const stub = supabaseFromStub();
  stub.setResponse("job_runner_settings", () => {
    if (secret === "throw") throw new Error("job_runner_settings unreachable");
    return ok(secret === undefined ? null : { secret });
  });
  db.current = stub;
}

let consoleErrors: unknown[][] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // Sekret wchodzi do środowiska dopiero tutaj i wychodzi w `afterEach`.
  vi.stubEnv("COMMUNITY_CRON_SECRET", SECRET);
  jobs.reset();
  scheduler.armCalls.length = 0;
  scheduler.armOutcomes.length = 0;
  scheduler.runs.length = 0;
  scheduler.heartbeat = heartbeat();
  scheduler.heartbeatReads = 0;
  scheduler.pendingPush = 0;
  scheduler.pendingReads = 0;
  seedRunnerSettings();
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Odmowa musi być CAŁKOWITA. Sam `401` byłby zgodny również ze światem,
 * w którym endpoint najpierw drenuje kolejkę push, a dopiero potem patrzy na
 * sekret - dlatego każdy test bramki kończy się tym wywołaniem.
 */
function nothingHappened(): void {
  expect(jobs.steps()).toEqual([]);
  expect(scheduler.armCalls).toEqual([]);
  expect(scheduler.runs).toEqual([]);
}

// ===========================================================================
// BRAMKA SEKRETU - kto w ogóle ma prawo ruszyć kanały
// ===========================================================================
describe("bramka sekretu: kto ma prawo uruchomić kanały społeczności", () => {
  it("BRAK nagłówka - 401 i ani jeden kanał nie ruszył", async () => {
    const res = await post({ secret: null });

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toEqual({ error: "unauthorized" });
    nothingHappened();
  });

  it("PUSTY nagłówek jest traktowany jak brak sekretu", async () => {
    const res = await post({ secret: "" });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("BŁĘDNY sekret TEJ SAMEJ długości - 401, zero efektów ubocznych", async () => {
    // Warunek sensu tego testu: równa długość. Gdyby zły sekret był krótszy,
    // przejście przez bramkę dowodziłoby tylko tego, że kod porównuje długości.
    expect(WRONG_SECRET).toHaveLength(SECRET.length);
    expect(WRONG_SECRET).not.toBe(SECRET);

    const res = await post({ secret: WRONG_SECRET });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("sekret INNEJ długości odpada 401, a `timingSafeEqual` NIE rzuca", async () => {
    // `crypto.timingSafeEqual` RZUCA `RangeError` przy buforach różnej długości.
    // Bez wcześniejszego porównania `a.length === b.length` ta ścieżka kończyłaby
    // się nieobsłużonym wyjątkiem (500) zamiast 401 - czyli wyciekiem sygnału
    // „twój sekret ma inną długość niż prawdziwy".
    const short = SECRET.slice(0, 5);
    expect(short.length).not.toBe(SECRET.length);

    const res = await post({ secret: short });

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toEqual({ error: "unauthorized" });
    nothingHappened();
    // Gdyby wyjątek poleciał i został gdzieś połknięty, zostawiłby ślad w logu.
    expect(consoleErrors).toEqual([]);
  });

  it("sekret dłuższy o jeden znak też odpada bez wyjątku", async () => {
    const res = await post({ secret: `${SECRET}x` });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("PREFIKS prawdziwego sekretu nie przechodzi", async () => {
    const res = await post({ secret: SECRET.slice(0, -1) });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("POPRAWNY sekret uruchamia kanały - i to jest dowód, nie kod 200", async () => {
    const res = await tick({ query: "?job=push" });

    expect(res.status).toBe(200);
    expect(jobs.steps()).toEqual(["push"]);
  });

  it("gdy COMMUNITY_CRON_SECRET jest PUSTY, żaden nagłówek nie autoryzuje z env", async () => {
    // Fail-closed: brak skonfigurowanego sekretu nie może znaczyć „wpuszczaj
    // wszystkich". Tabela też jest pusta, więc jedynym wyjściem jest 401.
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");

    const res = await post({ secret: SECRET });

    expect(res.status).toBe(401);
    nothingHappened();
  });
});

// ===========================================================================
// BRAMKA SEKRETU - droga bazodanowa i Bearer
// ===========================================================================
describe("bramka sekretu: fallback z `job_runner_settings` i `Authorization: Bearer`", () => {
  it("sekret z tabeli przepuszcza, gdy env go nie ma", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings(DB_SECRET);

    const res = await post({ secret: DB_SECRET, query: "?job=push" });

    expect(res.status).toBe(200);
    expect(jobs.steps()).toEqual(["push"]);
    expect(db.current!.chainsFor("job_runner_settings")).toHaveLength(1);
  });

  it("sekret z tabeli o TEJ SAMEJ długości, ale inny, nie przepuszcza", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings(DB_SECRET);

    const res = await post({ secret: WRONG_SECRET });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("BRAK wiersza konfiguracji - 401 (fail-closed)", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings();

    const res = await post({ secret: DB_SECRET });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("wiersz z PUSTYM sekretem nie autoryzuje niczego", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings("");

    const res = await post({ secret: "" });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("AWARIA odczytu tabeli NIE wywraca endpointu - `catch` daje 401, nie 500", async () => {
    // Padnięcie odczytu konfiguracji nie może być ani furtką („baza milczy,
    // więc wpuszczam"), ani awarią całego endpointu: monitoring zewnętrzny
    // odróżnia 401 od 500, a 500 uruchamia zupełnie inną procedurę operatora.
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings("throw");

    const res = await post({ secret: DB_SECRET });

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toEqual({ error: "unauthorized" });
    nothingHappened();
  });

  it("gdy sekret ŚRODOWISKOWY pasuje, tabela NIE jest w ogóle czytana", async () => {
    // Zbędny round-trip po sekret przy każdym ticku to zbędna ekspozycja
    // tabeli service-role-only. Skrót `||` w `authorize` ma tu znaczenie.
    seedRunnerSettings(DB_SECRET);

    await tick({ query: "?job=push" });

    expect(db.current!.chainsFor("job_runner_settings")).toHaveLength(0);
  });

  it("odczyt sekretu z tabeli celuje w JEDEN wiersz konfiguracji (id=1)", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings(DB_SECRET);

    await post({ secret: DB_SECRET, query: "?job=push" });

    const chain = db.current!.lastChain("job_runner_settings")!;
    expect(chain.argsOf("select")).toEqual(["secret"]);
    expect(chain.argsOf("eq")).toEqual(["id", 1]);
    expect(chain.has("maybeSingle")).toBe(true);
  });

  it("`Authorization: Bearer <sekret>` przepuszcza tak samo jak nagłówek dedykowany", async () => {
    const res = await post({ secret: null, bearer: `Bearer ${SECRET}`, query: "?job=push" });

    expect(res.status).toBe(200);
    expect(jobs.steps()).toEqual(["push"]);
  });

  it("schemat `bearer` jest bez rozróżniania wielkości liter, sam sekret NIE", async () => {
    const dobry = await post({ secret: null, bearer: `bEaReR ${SECRET}`, query: "?job=push" });
    expect(dobry.status).toBe(200);

    const zly = await post({ secret: null, bearer: `Bearer ${SECRET.toUpperCase()}` });
    expect(zly.status).toBe(401);
  });

  it("`Authorization` bez schematu Bearer nie autoryzuje", async () => {
    const res = await post({ secret: null, bearer: `Basic ${SECRET}` });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("nagłówek dedykowany WYGRYWA nad Bearer - zły nagłówek nie da się obejść Bearerem", async () => {
    // `providedSecret` czyta Bearer WYŁĄCZNIE wtedy, gdy dedykowanego nagłówka
    // nie ma. Bez tej asercji ktoś mógłby odwrócić kolejność i zrobić z Bearera
    // cichą obwodnicę odrzuconego nagłówka.
    const res = await post({ secret: WRONG_SECRET, bearer: `Bearer ${SECRET}` });

    expect(res.status).toBe(401);
    nothingHappened();
  });

  it("ROZBIEŻNOŚĆ Z BILLING-CRON: `enabled:false` NIE blokuje tej ścieżki", async () => {
    // USTALENIE, nie pochwała. `billing-cron.ts` czyta `enabled, secret`
    // i odmawia przy `enabled:false`; ten endpoint czyta SAM `secret`, więc
    // wyłączenie runnera bazy nie unieważnia sekretu tutaj. Da się to obronić:
    // `enabled` opisuje ścieżkę pg_cron, a community-cron jest właśnie SIATKĄ
    // BEZPIECZEŃSTWA na wypadek, gdy tamta stoi - wyłączenie jej razem
    // z runnerem odbierałoby operatorowi ostatnie wyjście awaryjne. Ale to
    // znaczy, że `enabled:false` NIE jest wyłącznikiem awaryjnym całości,
    // i ta asercja utrwala ten fakt zamiast zostawiać go domysłowi.
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    const stub = supabaseFromStub();
    stub.setResponse("job_runner_settings", ok({ enabled: false, secret: DB_SECRET }));
    db.current = stub;

    const res = await post({ secret: DB_SECRET, query: "?job=push" });

    expect(res.status).toBe(200);
    expect(jobs.steps()).toEqual(["push"]);
  });
});

// ===========================================================================
// LIMITER PO ADRESIE KLIENTA
// ===========================================================================
describe("limiter po adresie klienta (kubełek 30, dolewka 0,5/s)", () => {
  it("kubełek przepuszcza DOKŁADNIE 30 ticków, 31. dostaje 429 i nie rusza kanałów", async () => {
    const ip = "10.99.0.1";
    for (let i = 0; i < 30; i += 1) {
      const res = await post({ secret: SECRET, ip, query: "?job=push" });
      expect(res.status).toBe(200);
    }
    const przed = jobs.calls.length;

    const res = await post({ secret: SECRET, ip, query: "?job=push" });

    expect(res.status).toBe(429);
    expect(jobs.calls).toHaveLength(przed);
    expect(scheduler.runs).toHaveLength(przed);
  });

  it("429 nie ma ciała ani nagłówków JSON - to sygnał transportowy, nie odpowiedź", async () => {
    const ip = "10.99.0.2";
    for (let i = 0; i < 30; i += 1) await post({ secret: SECRET, ip, query: "?job=push" });

    const res = await post({ secret: SECRET, ip, query: "?job=push" });

    expect(res.status).toBe(429);
    await expect(res.text()).resolves.toBe("");
    expect(res.headers.get("Content-Type")).toBeNull();
  });

  it("limiter działa PRZED autoryzacją - odrzucone żądanie nie pyta nawet o sekret", async () => {
    // Świadomy zapis kontraktu, nie pochwała: zgadywanie sekretu kosztuje
    // żetony, ale JEDNOCZEŚNIE zalew z adresu schedulera potrafi wypchnąć
    // legalny tick na 429. Dowód, że kolejność jest taka, a nie odwrotna:
    // wyczerpany kubełek nie dotyka tabeli z sekretem, choć env jest pusty.
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings(DB_SECRET);
    const ip = "10.99.0.3";
    for (let i = 0; i < 30; i += 1) await post({ secret: WRONG_SECRET, ip });
    const odczyty = db.current!.chainsFor("job_runner_settings").length;

    const res = await post({ secret: DB_SECRET, ip, query: "?job=push" });

    expect(res.status).toBe(429);
    expect(db.current!.chainsFor("job_runner_settings")).toHaveLength(odczyty);
    expect(jobs.steps()).toEqual([]);
  });

  it("sonda GET dzieli kubełek z POST-em - to jeden adres, jeden limit", async () => {
    const ip = "10.99.0.4";
    for (let i = 0; i < 30; i += 1) await post({ secret: SECRET, ip, query: "?job=push" });

    const res = await get({ secret: SECRET, ip });

    expect(res.status).toBe(429);
    expect(scheduler.heartbeatReads).toBe(0);
  });

  it("inny adres ma WŁASNY kubełek", async () => {
    for (let i = 0; i < 31; i += 1)
      await post({ secret: SECRET, ip: "10.98.0.1", query: "?job=push" });

    const res = await post({ secret: SECRET, ip: "10.98.0.2", query: "?job=push" });

    expect(res.status).toBe(200);
  });

  it("żądanie BEZ nagłówka adresu wpada do wspólnego kubełka, nie omija limitu", async () => {
    for (let i = 0; i < 31; i += 1) {
      await post({ secret: SECRET, noIp: true, query: "?job=push" });
    }

    const res = await post({ secret: SECRET, noIp: true, query: "?job=push" });

    expect(res.status).toBe(429);
  });
});

// ===========================================================================
// SONDA GET - diagnoza zastoju bez efektów ubocznych
// ===========================================================================
describe("sonda GET: diagnoza harmonogramu bez efektów ubocznych", () => {
  it("sonda NIE uruchamia kanałów, nie zbroi runnera i nie loguje przebiegu", async () => {
    // To jest cały sens osobnego GET-a: uptime robot potrafi tylko GET, więc
    // gdyby sonda cokolwiek uruchamiała, monitoring stałby się drugim cronem.
    const res = await get({ secret: SECRET });

    expect(res.status).toBe(200);
    expect(jobs.steps()).toEqual([]);
    expect(scheduler.armCalls).toEqual([]);
    expect(scheduler.runs).toEqual([]);
  });

  it("sonda BEZ sekretu nie zdradza nawet stanu harmonogramu", async () => {
    const res = await get({ secret: null });

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toEqual({ error: "unauthorized" });
    expect(scheduler.heartbeatReads).toBe(0);
    expect(scheduler.pendingReads).toBe(0);
  });

  it("sonda ze ZŁYM sekretem tej samej długości też milczy", async () => {
    const res = await get({ secret: WRONG_SECRET });

    expect(res.status).toBe(401);
    expect(scheduler.heartbeatReads).toBe(0);
  });

  it("ŚWIEŻY heartbeat - 200 i pełny kształt odpowiedzi", async () => {
    scheduler.heartbeat = heartbeat({
      lastAppOkAt: ago(60_000),
      lastAppRunAt: ago(45_000),
      lastInvokedAt: ago(30_000),
      lastAppError: null,
      failureStreak: 0,
    });
    scheduler.pendingPush = 7;

    const res = await get({ secret: SECRET });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toEqual({
      ok: true,
      freshness: "fresh",
      runnerEnabled: true,
      lastOkAt: ago(60_000),
      lastRunAt: ago(45_000),
      lastCronInvokeAt: ago(30_000),
      lastError: null,
      failureStreak: 0,
      pushPending: 7,
    });
  });

  it("ZASTÓJ (ostatni sukces 30 minut temu) - 503 i `ok:false`", async () => {
    // 503 bez parsowania JSON-a to warunek działania monitoringu zewnętrznego:
    // uptime robot alarmuje po kodzie, nie po treści.
    scheduler.heartbeat = heartbeat({
      lastAppOkAt: ago(30 * 60_000),
      lastAppError: "push transport failed",
      failureStreak: 12,
    });
    scheduler.pendingPush = 431;

    const res = await get({ secret: SECRET });

    expect(res.status).toBe(503);
    await expect(body(res)).resolves.toMatchObject({
      ok: false,
      freshness: "stale",
      lastError: "push transport failed",
      failureStreak: 12,
      pushPending: 431,
    });
  });

  it("stan POŚREDNI (8 minut) to `lagging` i nadal 200 - opóźnienie to nie awaria", async () => {
    // Siatka 5-minutowa potrafi się spóźnić o kilka minut przez kolejkę
    // runnerów GitHuba. Alarm w tym miejscu byłby fałszywy i uczyłby
    // operatora ignorować alarmy.
    scheduler.heartbeat = heartbeat({ lastAppOkAt: ago(8 * 60_000) });

    const res = await get({ secret: SECRET });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ ok: true, freshness: "lagging" });
  });

  it("BRAK heartbeatu (harmonogram nigdy nie ruszył) - 503 i `never`", async () => {
    scheduler.heartbeat = null;
    scheduler.pendingPush = null;

    const res = await get({ secret: SECRET });

    expect(res.status).toBe(503);
    await expect(body(res)).resolves.toEqual({
      ok: false,
      freshness: "never",
      runnerEnabled: false,
      lastOkAt: null,
      lastRunAt: null,
      lastCronInvokeAt: null,
      lastError: null,
      failureStreak: 0,
      pushPending: null,
    });
  });

  it("`pushPending:null` (nieudany odczyt) to NIE to samo co pusta kolejka", async () => {
    // Zero w kolejce znaczy „wszystko doręczone", `null` znaczy „nie wiem".
    // Sklejenie tych dwóch stanów zamieniłoby awarię odczytu w fałszywe
    // uspokojenie na dashboardzie.
    scheduler.pendingPush = null;

    const res = await get({ secret: SECRET });

    const payload = await body(res);
    expect(payload.pushPending).toBeNull();
    expect(payload.pushPending).not.toBe(0);
  });

  it("heartbeat i licznik kolejki są czytane RÓWNOLEGLE, po jednym razie", async () => {
    await get({ secret: SECRET });

    expect(scheduler.heartbeatReads).toBe(1);
    expect(scheduler.pendingReads).toBe(1);
  });

  it("`runnerEnabled:false` jedzie do odpowiedzi, mimo świeżego przebiegu", async () => {
    // Runner wyłączony ręcznie, a przebiegi świeże (bo leci siatka z repo).
    // Operator musi zobaczyć OBIE informacje naraz, nie jedną z nich.
    scheduler.heartbeat = heartbeat({ enabled: false });

    const res = await get({ secret: SECRET });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ ok: true, runnerEnabled: false });
  });
});

// ===========================================================================
// WYBÓR KANAŁÓW - `?job=`, ciało żądania i pierwszeństwo
// ===========================================================================
describe("wybór kanałów: `?job=`, ciało żądania i pierwszeństwo query", () => {
  it("NIEZNANY job - 400 `unknown_job`, żaden kanał nie ruszył", async () => {
    const res = await tick({ query: "?job=wyslij-wszystko" });

    expect(res.status).toBe(400);
    await expect(body(res)).resolves.toEqual({ error: "unknown_job" });
    expect(jobs.steps()).toEqual([]);
  });

  it("NIEZNANY job nie zbroi runnera i NIE zapisuje przebiegu", async () => {
    // USTALENIE, nie zarzut: literówka w `?job=` jest widoczna jako 400 dla
    // wołającego, ale w logu przebiegów nie zostawia śladu. Panel zobaczy ją
    // dopiero przez SPADEK ŚWIEŻOŚCI (bo udanych ticków nie ma), a nie jako
    // wpis „nieznany job". To działa, ale reakcja jest wolniejsza o próg
    // świeżości - i ta asercja utrwala, że tak właśnie jest.
    await tick({ query: "?job=nie-ma-takiego" });

    expect(scheduler.armCalls).toEqual([]);
    expect(scheduler.runs).toEqual([]);
  });

  it("`?job=push` uruchamia WYŁĄCZNIE push, z limitem partii 100", async () => {
    const res = await tick({ query: "?job=push" });

    expect(jobs.calls).toEqual([{ step: "push", args: [100] }]);
    const payload = await body(res);
    expect(payload).toMatchObject({ ok: true, job: "push" });
    expect(payload).not.toHaveProperty("digestDaily");
    expect(payload).not.toHaveProperty("reputationBadges");
  });

  it.each([
    ["digest-daily", "digest:daily", "digestDaily"],
    ["digest-weekly", "digest:weekly", "digestWeekly"],
    ["event-reminders", "eventReminders", "eventReminders"],
    ["crm-task-reminders", "crmTaskReminders", "crmTaskReminders"],
    ["career-cv-retention", "careerCvRetention", "careerCvRetention"],
  ])("`?job=%s` uruchamia dokładnie jeden kanał", async (job, step, key) => {
    const res = await tick({ query: `?job=${job}` });

    expect(jobs.steps()).toEqual([step]);
    const payload = await body(res);
    expect(payload).toMatchObject({ ok: true, job });
    expect(payload).toHaveProperty(key);
    // Odznaki reputacji jadą WYŁĄCZNIE w "all" - pojedynczy job ich nie budzi.
    expect(payload).not.toHaveProperty("reputationBadges");
  });

  it("digesty dostają rozróżnialny okres i limit partii 50", async () => {
    await tick({ query: "?job=digest-weekly" });

    expect(jobs.calls).toEqual([{ step: "digest:weekly", args: ["weekly", 50] }]);
  });

  it("`?job=all` uruchamia WSZYSTKIE kanały, w tym CV i odznaki, w ustalonej kolejności", async () => {
    // Kolejność jest treścią: push drenuje kolejkę najpierw (to on ma
    // najkrótsze okno użyteczności), a odznaki reputacji jadą na końcu, bo są
    // uzgodnieniem stanu, nie doręczeniem.
    const res = await tick({ query: "?job=all" });

    expect(jobs.steps()).toEqual([
      "push",
      "digest:daily",
      "digest:weekly",
      "eventReminders",
      "crmTaskReminders",
      "careerCvRetention",
      "reputationBadges",
    ]);
    expect(res.status).toBe(200);
    const payload = await body(res);
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining([
        "push",
        "digestDaily",
        "digestWeekly",
        "eventReminders",
        "crmTaskReminders",
        "careerCvRetention",
        "reputationBadges",
      ]),
    );
  });

  it("uzgadnianie odznak dostaje limit partii 250", async () => {
    await tick({ query: "?job=all" });

    expect(jobs.calls.find((c) => c.step === "reputationBadges")?.args).toEqual([250]);
  });

  it("BRAK `?job=` i brak ciała - domyślnie `all`", async () => {
    const res = await tick();

    await expect(body(res)).resolves.toMatchObject({ job: "all" });
    expect(jobs.steps()).toContain("reputationBadges");
  });

  it("PUSTY `?job=` znaczy `all`, a nie „nieznany job”", async () => {
    const res = await tick({ query: "?job=" });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ job: "all" });
  });

  it("job z CIAŁA żądania działa, gdy query go nie ma", async () => {
    const res = await tick({ body: { job: "digest-daily" } });

    expect(jobs.steps()).toEqual(["digest:daily"]);
    await expect(body(res)).resolves.toMatchObject({ job: "digest-daily" });
  });

  it("job z ciała jest walidowany tak samo - nieznany daje 400", async () => {
    const res = await tick({ body: { job: "zrob-cos" } });

    expect(res.status).toBe(400);
    expect(jobs.steps()).toEqual([]);
  });

  it("QUERY MA PIERWSZEŃSTWO nad ciałem", async () => {
    // Udokumentowany kontrakt: `?job=` jest tym, co operator wpisuje ręcznie
    // w curl-u, więc nie może go po cichu przebić ciało wysłane przez runnera.
    const res = await tick({ query: "?job=push", body: { job: "digest-daily" } });

    expect(jobs.steps()).toEqual(["push"]);
    await expect(body(res)).resolves.toMatchObject({ job: "push" });
  });

  it("USZKODZONE ciało nie wywraca ticku - wraca `all` i kanały jadą", async () => {
    const res = await tick({ rawBody: "{to nie jest json" });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ job: "all" });
    expect(jobs.steps()).toContain("push");
  });

  it("ciało bez pola `job` (albo z polem nie-napisem) to `all`", async () => {
    const res = await tick({ body: { job: 7, cokolwiek: true } });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ job: "all" });
  });

  it("job jest przycinany i sprowadzany do małych liter", async () => {
    const res = await tick({ query: "?job=%20PUSH%20" });

    expect(jobs.steps()).toEqual(["push"]);
    await expect(body(res)).resolves.toMatchObject({ job: "push" });
  });
});

// ===========================================================================
// UZBROJENIE ŚCIEŻKI PODSTAWOWEJ
// ===========================================================================
describe("uzbrojenie ścieżki podstawowej (`arm_job_runner`)", () => {
  it("origin składa się z `x-forwarded-proto` i `x-forwarded-host`", async () => {
    await tick({
      query: "?job=push",
      headers: { "x-forwarded-proto": "http", "x-forwarded-host": "cron.example.org" },
    });

    expect(scheduler.armCalls).toEqual(["http://cron.example.org"]);
  });

  it("przy WIELU hostach po przecinku liczy się pierwszy, przycięty", async () => {
    // Łańcuch proxy dokleja kolejne hosty. Wzięcie ostatniego (albo całego
    // łańcucha) uzbroiłoby bazę adresem, którego nikt nie obsługuje, i pg_cron
    // dalej tykałby w próżnię - tyle że z fałszywym poczuciem konfiguracji.
    await tick({
      query: "?job=push",
      headers: { "x-forwarded-host": "  cron.example.org  , podszywacz.example.net" },
    });

    expect(scheduler.armCalls).toEqual(["https://cron.example.org"]);
  });

  it("brak `x-forwarded-proto` domyśla się `https`", async () => {
    await tick({ query: "?job=push", headers: { "x-forwarded-host": "nes.example.com" } });

    expect(scheduler.armCalls).toEqual(["https://nes.example.com"]);
  });

  it("bez `x-forwarded-host` wchodzi zwykły `Host`", async () => {
    await tick({ query: "?job=push", headers: { host: "bezposredni.example.com" } });

    expect(scheduler.armCalls).toEqual(["https://bezposredni.example.com"]);
  });

  it("BRAK jakiegokolwiek hosta daje PUSTY origin, a nie `https://`", async () => {
    // Pusty origin jest sygnałem „nie wiem, jak się nazywam" i po stronie
    // `ensureJobRunnerArmed` spada na `PUBLIC_SITE_URL`. Sklejenie `https://`
    // z niczym dałoby adres składniowo poprawny i semantycznie martwy.
    await tick({ query: "?job=push" });

    expect(scheduler.armCalls).toEqual([""]);
  });

  it("wynik zbrojenia trafia do odpowiedzi jako `runnerArmed`", async () => {
    scheduler.armOutcomes.push("armed");

    const res = await tick({ query: "?job=push" });

    await expect(body(res)).resolves.toMatchObject({ runnerArmed: "armed" });
  });

  it("zbrojenie idzie PRZED kanałami - inaczej pierwszy tick pracuje w próżni", async () => {
    await tick({ query: "?job=all" });

    expect(scheduler.armCalls).toHaveLength(1);
    // Zbrojenie jest jedynym krokiem, który wykonuje się przed `runJobs`,
    // a kanały widzą już uzbrojoną konfigurację.
    expect(jobs.steps()[0]).toBe("push");
  });

  it("endpoint NIE MA własnej idempotencji zbrojenia - woła je na KAŻDYM ticku", async () => {
    // To jest świadomy podział pracy, nie przeoczenie. „Rusza tylko dziewiczy
    // wiersz konfiguracji" jest regułą RPC `arm_job_runner` w bazie, więc
    // endpoint nie ma prawa jej DUBLOWAĆ pamięciowym „już zbroiłem": pamięć
    // izolatu nie jest współdzielona między instancjami workera, więc taka
    // lokalna idempotencja byłaby fikcją, a dodatkowo ukryłaby przed panelem
    // moment, w którym konfiguracja została ręcznie zmieniona.
    scheduler.armOutcomes.push("armed", "already_configured");

    const pierwszy = await tick({ query: "?job=push" });
    const drugi = await tick({ query: "?job=push" });

    expect(scheduler.armCalls).toHaveLength(2);
    await expect(body(pierwszy)).resolves.toMatchObject({ runnerArmed: "armed" });
    // Drugi tick niesie DOKŁADNIE to, co powiedziała baza - endpoint niczego
    // nie zapamiętał i niczego nie podmienił.
    await expect(body(drugi)).resolves.toMatchObject({ runnerArmed: "already_configured" });
  });

  it("nieudane zbrojenie NIE blokuje kanałów ani nie psuje kodu odpowiedzi", async () => {
    // „Nie umiem uzbroić bazy" nie może znaczyć „nie doręczam powiadomień":
    // siatka bezpieczeństwa ma działać właśnie wtedy, gdy konfiguracja leży.
    scheduler.armOutcomes.push("unavailable");

    const res = await tick({ query: "?job=all" });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ ok: true, runnerArmed: "unavailable" });
    expect(jobs.steps()).toHaveLength(7);
  });
});

// ===========================================================================
// IZOLACJA KANAŁÓW - awaria jednego a reszta przebiegu
// ===========================================================================
describe("izolacja kanałów: awaria jednego nie zabiera pozostałych", () => {
  it("padnięty digest tygodniowy nie zatrzymuje pozostałych sześciu kanałów", async () => {
    jobs.failures.set("digest:weekly", "resend api key missing");

    const res = await tick({ query: "?job=all" });
    const payload = await body(res);

    // 1. Reszta kanałów WYKONAŁA SIĘ - to jest sedno izolacji.
    expect(jobs.steps()).toEqual([
      "push",
      "digest:daily",
      "digest:weekly",
      "eventReminders",
      "crmTaskReminders",
      "careerCvRetention",
      "reputationBadges",
    ]);
    // 2. Błąd jest przypisany DO TEGO kanału, a nie rozmazany po całości.
    expect(channel(payload, "digestWeekly")).toEqual({ error: "resend api key missing" });
    expect(channel(payload, "digestDaily")).toEqual({ sent: 2 });
    expect(channel(payload, "reputationBadges")).toEqual({ granted: 1, revoked: 0 });
    // 3. Kod odpowiedzi alarmuje scheduler zewnętrzny.
    expect(res.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.errors).toEqual(["digestWeekly: resend api key missing"]);
  });

  it("przebieg z awarią trafia do logu z `ok:false` i sklejoną przyczyną", async () => {
    jobs.failures.set("push", "web push gateway down");
    jobs.failures.set("eventReminders", "kalendarz nieosiągalny");

    await tick({ query: "?job=all" });

    const run = lastRun();
    expect(run.ok).toBe(false);
    expect(run.job).toBe("all");
    // Sklejenie kolejnością wykonania: operator czyta log od góry i widzi,
    // który kanał padł pierwszy.
    expect(run.error).toBe("push: web push gateway down; eventReminders: kalendarz nieosiągalny");
  });

  it("wynik KAŻDEGO kanału (także padniętego) ląduje w logu przebiegów", async () => {
    // Bez wyniku w logu panel pokazuje „przebieg nieudany" bez przyczyny,
    // a operator musi wracać do logów workera - czyli do miejsca, którego
    // w produkcji nie ma pod ręką.
    jobs.failures.set("careerCvRetention", "bucket unavailable");

    await tick({ query: "?job=all" });

    const result = lastRun().result;
    expect(result).toMatchObject({
      push: { sent: 4, failed: 0 },
      careerCvRetention: { error: "bucket unavailable" },
      reputationBadges: { granted: 1, revoked: 0 },
    });
  });

  it("awaria zostawia ślad w logu procesu z nazwą joba i listą przyczyn", async () => {
    jobs.failures.set("crmTaskReminders", "crm timeout");

    await tick({ query: "?job=all" });

    expect(consoleErrors).toEqual([
      ["[community-cron] job failed", "all", ["crmTaskReminders: crm timeout"]],
    ]);
  });

  it("rzucona wartość NIE będąca `Error` też staje się czytelnym komunikatem", async () => {
    // `String(err)` zamiast `undefined`: kanał, który rzuca napisem (albo
    // odrzuca obietnicę czymkolwiek innym niż `Error`) nie może zamienić logu
    // przebiegu w pustą przyczynę - operator dostałby wtedy „przebieg nieudany"
    // bez ani jednego słowa o tym, co padło.
    jobs.rawFailures.set("push", "kanał padł zwykłym napisem");

    const res = await tick({ query: "?job=push" });

    expect(res.status).toBe(500);
    expect(channel(await body(res), "push")).toEqual({ error: "kanał padł zwykłym napisem" });
    expect(lastRun().error).toBe("push: kanał padł zwykłym napisem");
  });

  it("UDANY przebieg nie loguje błędu i nie niesie klucza `errors`", async () => {
    const res = await tick({ query: "?job=all" });
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload).not.toHaveProperty("errors");
    expect(lastRun()).toMatchObject({ ok: true, error: null });
    expect(consoleErrors).toEqual([]);
  });
});

// ===========================================================================
// BUDŻET CZASU JEDNEGO WYWOŁANIA
// ===========================================================================
describe("budżet czasu (COMMUNITY_CRON_DEADLINE_MS = 25 s)", () => {
  /** Kanał `step` "trwa" `ms` - przesuwa zamrożony zegar w chwili startu pracy. */
  function slowStep(step: string, ms: number): void {
    jobs.beforeStep = (current) => {
      if (current === step) advanceClock(ms);
    };
  }

  it("po przekroczeniu budżetu KOLEJNE kanały dostają `skipped_time_budget`", async () => {
    slowStep("push", 26_000);

    const res = await tick({ query: "?job=all" });
    const payload = await body(res);

    // Wykonał się TYLKO push - pozostałe sześć kanałów nawet nie startowało.
    expect(jobs.steps()).toEqual(["push"]);
    for (const key of [
      "digestDaily",
      "digestWeekly",
      "eventReminders",
      "crmTaskReminders",
      "careerCvRetention",
      "reputationBadges",
    ]) {
      expect(channel(payload, key)).toEqual({ error: "skipped_time_budget" });
    }
  });

  it("POMINIĘCIE TO NIE AWARIA - przebieg jest `ok`, kod 200, log bez błędu", async () => {
    // To jest najważniejsza asercja tej sekcji. Praca jest watermarkowa
    // i claimowana, więc pominięty kanał wraca w następnym ticku (za minutę).
    // Gdyby pominięcie liczyło się jako awaria, scheduler alarmowałby przy
    // każdej większej partii, a operator nauczyłby się ignorować alarm.
    slowStep("push", 26_000);

    const res = await tick({ query: "?job=all" });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ ok: true });
    expect(lastRun()).toMatchObject({ ok: true, error: null });
    expect(consoleErrors).toEqual([]);
  });

  it("GRANICA: dokładnie 25 000 ms jeszcze mieści się w budżecie", async () => {
    // Warunek jest `>`, nie `>=`. Test pilnuje, żeby przypadkowa zmiana
    // na `>=` nie ucięła jednego kanału na każdym pełnym ticku.
    slowStep("push", 25_000);

    const res = await tick({ query: "?job=all" });

    expect(jobs.steps()).toEqual([
      "push",
      "digest:daily",
      "digest:weekly",
      "eventReminders",
      "crmTaskReminders",
      "careerCvRetention",
      "reputationBadges",
    ]);
    expect(res.status).toBe(200);
  });

  it("pominięcie dotyczy KOLEJNYCH kroków, nie tego, który przekroczył budżet", async () => {
    // Kanał, który właśnie zjadł budżet, ma prawo dokończyć i ZARAPORTOWAĆ
    // swój wynik - inaczej praca zrobiona zniknęłaby z logu przebiegów.
    slowStep("digest:daily", 40_000);

    const payload = await body(await tick({ query: "?job=all" }));

    expect(channel(payload, "push")).toEqual({ sent: 4, failed: 0 });
    expect(channel(payload, "digestDaily")).toEqual({ sent: 2 });
    expect(channel(payload, "digestWeekly")).toEqual({ error: "skipped_time_budget" });
  });

  it("`durationMs` w logu mierzy CAŁY przebieg, także czas zjedzony przez kanał", async () => {
    slowStep("push", 26_000);

    await tick({ query: "?job=all" });

    expect(lastRun().durationMs).toBe(26_000);
  });

  it("budżet nie tyka przy pojedynczym, szybkim jobie", async () => {
    const res = await tick({ query: "?job=push" });

    expect(lastRun().durationMs).toBe(0);
    await expect(body(res)).resolves.toMatchObject({ durationMs: 0 });
  });
});

// ===========================================================================
// ŹRÓDŁO PRZEBIEGU W LOGU
// ===========================================================================
describe("źródło przebiegu w logu (`?source=` albo `x-cron-source`)", () => {
  it.each([
    ["github_actions", "github_actions"],
    ["github", "github_actions"],
    ["gha", "github_actions"],
    ["actions", "github_actions"],
    ["pg_cron", "pg_cron"],
    ["PG-CRON", "pg_cron"],
    ["postgres", "pg_cron"],
    ["admin", "admin"],
    ["dev", "dev"],
    ["  External  ", "external"],
    ["cokolwiek-innego", "external"],
  ])("`?source=%s` normalizuje się do `%s`", async (raw, expected) => {
    await tick({ query: `?job=push&source=${encodeURIComponent(raw)}` });

    expect(lastRun().source).toBe(expected);
  });

  it("nagłówek `x-cron-source` działa, gdy query go nie ma", async () => {
    await tick({ query: "?job=push", headers: { "x-cron-source": "github" } });

    expect(lastRun().source).toBe("github_actions");
  });

  it("QUERY wygrywa z nagłówkiem", async () => {
    await tick({ query: "?job=push&source=admin", headers: { "x-cron-source": "github" } });

    expect(lastRun().source).toBe("admin");
  });

  it("BRAK źródła spada do `external` - log przyjmuje każdy zewnętrzny scheduler", async () => {
    await tick({ query: "?job=push" });

    expect(lastRun().source).toBe("external");
  });

  it("źródło jedzie także do odpowiedzi, żeby wołający widział, jak został zaksięgowany", async () => {
    const res = await tick({ query: "?job=push&source=gha" });

    await expect(body(res)).resolves.toMatchObject({ source: "github_actions" });
  });

  it("log przebiegu niesie komplet: źródło, job, wynik i czas", async () => {
    await tick({ query: "?job=push&source=github" });

    expect(lastRun()).toEqual({
      source: "github_actions",
      job: "push",
      ok: true,
      durationMs: 0,
      result: { push: { sent: 4, failed: 0 } },
      error: null,
    });
  });
});

// ===========================================================================
// RÓWNOLEGŁOŚĆ - granica dowodu opisana w nagłówku pliku
// ===========================================================================
describe("równoległość: endpoint nie ma własnego deduplikatora", () => {
  /**
   * JAK ROBIMY PRAWDZIWE NAKŁADANIE. Nie odpalamy dwóch obietnic w tym samym
   * tiku (to mierzyłoby głównie kolejkę mikrozadań i mechanikę atrap modułów),
   * tylko ZATRZYMUJEMY pierwszy tick w środku kanału push i dopiero wtedy
   * wpuszczamy drugi. Dzięki temu w chwili startu drugiego wywołania pierwsze
   * jest DOWODNIE w locie: uzbroiło już runnera i nie zapisało jeszcze
   * przebiegu.
   */
  function heldPush(): { wszedl: Promise<void>; release: () => void } {
    const trwa = deferred();
    const wszedl = deferred();
    jobs.holds.set("push", trwa.promise);
    jobs.beforeStep = (step) => {
      if (step === "push") wszedl.release();
    };
    return { wszedl: wszedl.promise, release: trwa.release };
  }

  it("drugi tick wchodzi, gdy pierwszy JESZCZE trwa - i OBA trafiają do logu", async () => {
    const ip = "10.97.0.1";
    const { wszedl, release } = heldPush();

    const pierwszy = startPost({ secret: SECRET, ip, query: "?job=push&source=github" });
    await wszedl;

    // Pierwszy tick jest w locie: runner uzbrojony, przebieg jeszcze niezapisany.
    expect(scheduler.armCalls).toHaveLength(1);
    expect(scheduler.runs).toEqual([]);

    // Drugi tick z tego samego adresu, w trakcie trwania pierwszego.
    jobs.holds.delete("push");
    jobs.beforeStep = null;
    const drugi = await startPost({ secret: SECRET, ip, query: "?job=push&source=pg_cron" });

    // Przeszedł i ZAKOŃCZYŁ SIĘ, mimo że pierwszy wciąż pracuje. Endpoint nie
    // ma żadnej bramki „jeden tick naraz" - i to jest zamierzone.
    expect(drugi.status).toBe(200);
    expect(scheduler.runs.map((r) => r.source)).toEqual(["pg_cron"]);

    release();
    const a = await pierwszy;

    expect(a.status).toBe(200);
    expect(jobs.steps()).toEqual(["push", "push"]);
    expect(scheduler.runs.map((r) => r.source)).toEqual(["pg_cron", "github_actions"]);
    // Zbrojenie też poszło dwa razy - endpoint nie zapamiętuje niczego między
    // wywołaniami, bo w środowisku wieloinstancyjnym taka pamięć byłaby fikcją.
    expect(scheduler.armCalls).toHaveLength(2);
  });

  it("nakładające się ticki o RÓŻNYCH jobach nie mieszają sobie wyników", async () => {
    const { wszedl, release } = heldPush();

    const pierwszy = startPost({ secret: SECRET, query: "?job=push" });
    await wszedl;
    jobs.beforeStep = null;

    const drugi = await startPost({ secret: SECRET, query: "?job=event-reminders" });
    release();
    const a = await pierwszy;

    await expect(body(a)).resolves.toMatchObject({ job: "push" });
    await expect(body(drugi)).resolves.toMatchObject({ job: "event-reminders" });
    // Kolejność w logu jest kolejnością ZAKOŃCZENIA, nie rozpoczęcia - dokładnie
    // tak, jak wygląda to w `job_runner_runs` przy dwóch ścieżkach naraz.
    expect(scheduler.runs.map((r) => r.job)).toEqual(["event-reminders", "push"]);
  });
});

// ===========================================================================
// KONTRAKT ODPOWIEDZI
// ===========================================================================
describe("kontrakt odpowiedzi", () => {
  it("odpowiedź jest JSON-em i NIE JEST cachowana", async () => {
    const res = await tick({ query: "?job=push" });

    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("odmowa też nie jest cachowana - pośrednik nie może utrwalić 401", async () => {
    const res = await post({ secret: WRONG_SECRET });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sonda GET też nie jest cachowana - inaczej monitoring widzi stan sprzed godziny", async () => {
    const res = await get({ secret: SECRET });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("odpowiedź NIE zdradza sekretu ani żadnego jego fragmentu", async () => {
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seedRunnerSettings(DB_SECRET);

    const odmowa = await (await post({ secret: WRONG_SECRET })).text();
    const zgoda = await (await post({ secret: DB_SECRET, query: "?job=all" })).text();

    for (const tekst of [odmowa, zgoda]) {
      expect(tekst).not.toContain(SECRET);
      expect(tekst).not.toContain(DB_SECRET);
      expect(tekst).not.toContain(WRONG_SECRET);
    }
  });
});
