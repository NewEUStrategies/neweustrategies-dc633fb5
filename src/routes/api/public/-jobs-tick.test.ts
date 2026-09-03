// Ścieżka PODSTAWOWA harmonogramu zadań tła: POST /api/public/jobs-tick.
//
// PO CO TEN PLIK ISTNIEJE. To publiczny adres, po którym pg_cron puka co minutę
// (`invoke_jobs_tick()` z migracji 20260713170000, nagłówek `x-cron-source`
// dołożony w 20260731130000) i którego JEDYNĄ bramką jest współdzielony sekret
// z `public.job_runner_settings` porównywany w stałym czasie plus kubełek
// żetonów po adresie klienta. Za tą bramką stoi cała praca wychodząca aplikacji:
// kampanie newslettera, dren kolejek pocztowych (pgmq), push, digesty,
// przypomnienia o wydarzeniach i zadaniach CRM, skaner linków, embeddingi
// i harmonogram klubów. Do 03.09.2026 plik trasy miał DOKŁADNIE ZERO pokrycia
// (0/16 linii, 0/1 funkcji, 0/14 gałęzi), więc każda z tych zmian przechodziła
// przez CI bez śladu:
//   * zdjęcie bramki sekretu albo odwrócenie warunku (`!==` zamiast `!(await
//     secretsEqual)`) - obcy uruchamia całą maszynę wysyłkową na żądanie,
//   * porównanie sekretu operatorem `===` - kanał czasowy na sekret crona,
//   * przestawienie limitera ZA bramkę - zgadywanie sekretu bez kosztu,
//   * respektowanie `enabled: false` tylko na papierze - wyłączony przez
//     operatora runner dalej wysyła,
//   * podanie dyspozytorowi klienta anonimowego zamiast service role albo
//     źródła `external` przy pracy crona - panel admina twierdzi wtedy, że
//     ścieżka podstawowa nie żyje, choć żyje (dokładnie ten defekt opisuje
//     komentarz w migracji 20260731130000).
//
// CO JEST PRZEDMIOTEM DOWODU. Handler jest cienki i to jest zamierzone: cała
// praca, idempotencja i log przebiegów żyją w `runJobsTick`. Dowodzimy więc
// DOKŁADNIE warstwy HTTP i nic ponadto:
//   1. że BRAK nagłówka `x-jobs-secret` (i nagłówek pusty) kończy się 401
//      ZANIM endpoint sięgnie po tabelę z sekretem,
//   2. że wyłączony przełącznik `job_runner_settings.enabled` blokuje pracę
//      i NIE dopuszcza nawet do porównania sekretu (zwarcie `||`),
//   3. że brak wiersza ustawień (`maybeSingle()` -> `null`) i padnięty odczyt
//      tabeli kończą się 401 - bramka jest fail-closed,
//   4. że niezgodny sekret TEJ SAMEJ długości odpada bez pracy, a o odmowie
//      decyduje WERDYKT `secretsEqual`, nie porównanie operatorem w trasie,
//   5. że limiter jest po ADRESIE klienta (`clientIpFromHeaders`: pierwszy wpis
//      `x-forwarded-for`, potem `x-real-ip`, na końcu wspólny kubełek) i stoi
//      PRZED bramką sekretu oraz przed odczytem tabeli,
//   6. że na ścieżce szczęśliwej dyspozytor dostaje klienta service role
//      (tożsamość obiektu) i źródło znormalizowane przez
//      `normalizeSchedulerSource`, z `pg_cron` jako domyślnym,
//   7. że odpowiedź 200 niesie DOKŁADNIE wynik ticku jako JSON,
//      z `Content-Type: application/json` i `Cache-Control: no-store`.
//
// JAK ASERTUJEMY. Przez SKUTEK, nie przez kod odpowiedzi. `401` jest zgodny
// również ze światem, w którym endpoint najpierw wysłał całą kolejkę, a dopiero
// potem spojrzał na sekret; `200` jest zgodny ze światem, w którym nie zrobił
// nic. Dlatego każdy dowód bramki patrzy na to, czy `runJobsTick` został
// zawołany, czy tabela ustawień była w ogóle czytana i czy sekret trafił do
// porównania - a kod odpowiedzi sprawdzamy tam, gdzie jest jedynym kontraktem
// (401 / 429 / 200 + nagłówki).
//
// CO JEST ATRAPOWANE I DLACZEGO (granica atrapy = moduł z własnym dowodem):
//   * `@tanstack/react-start/server` (`getRequest`) - w teście nie ma runtime'u
//     serwera frameworka, a handler czyta żądanie WYŁĄCZNIE stąd,
//   * `@/integrations/supabase/client.server` - klient service role; jego
//     tworzenie to konfiguracja środowiska, nie zachowanie tej trasy. Atrapa
//     jest tu instrumentem pomiarowym: pozwala dowieść TOŻSAMOŚCI klienta
//     przekazanego dyspozytorowi (`toBe`), czego z prawdziwym klientem nie
//     dałoby się odróżnić od dowolnego innego klienta,
//   * `@/lib/server/jobsTick.server` (`runJobsTick`, `secretsEqual`) - to
//     SĄSIEDNI moduł ciągnący kod server-only (service role, Resend, VAPID,
//     embeddingi); jego praca, budżet czasu i log przebiegów są przedmiotem
//     dowodu W INNYM MIEJSCU (`src/lib/server/__tests__/jobsTickDutyCycle.test.ts`
//     dla cyklu pracy, pgTAP dla `record_job_run` i claimów SKIP LOCKED).
//     Atrapa `secretsEqual` jest WIERNA: powtarza porównanie długości PRZED
//     `timingSafeEqual`, bo bez tego strażnika sekret innej długości kończyłby
//     się `RangeError` (500) zamiast 401 - i test na wiernej atrapie to widzi.
// PRAWDZIWE zostają: limiter (`@/lib/http/rateLimit` - `createRateLimiter`,
// `tickBucket`, `clientIpFromHeaders`) i `normalizeSchedulerSource`
// (`@/lib/jobs/scheduler`). To one są tutaj przedmiotem dowodu: ich atrapowanie
// zamieniłoby ten plik w test atrapy, bo poza nimi handler nie podejmuje
// ŻADNEJ decyzji własnej.
//
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
//   * co robi sam tick (kolejność jobów, budżet 25 s, cykl pracy, wpis do
//     `public.job_runner_runs`) - `src/lib/server/__tests__/jobsTickDutyCycle.test.ts`
//     i pgTAP; tutaj dyspozytor jest granicą,
//   * STAŁOŚĆ CZASU porównania sekretu - nie jest mierzalna w teście
//     jednostkowym (to własność `node:crypto.timingSafeEqual`). Mierzalne jest
//     to, że trasa deleguje decyzję do `secretsEqual` i podaje mu GOŁE sekrety,
//     i to jest tu dowodzone. Statyczny dowód „helper jest naprawdę wywołany"
//     dla bliźniaczych tras podglądu poczty stoi w
//     `src/routes/platform/email/-preview-secrets.test.ts`,
//   * to, że pg_cron faktycznie strzela pod ten adres z tym sekretem i tym
//     nagłówkiem źródła - warstwa bazy (migracje 20260713170000 /
//     20260731130000), dowód należy do pgTAP,
//   * współbieżność dwóch nakładających się ticków - jedynym mechanizmem braku
//     dublowania pracy jest `FOR UPDATE SKIP LOCKED` w Postgresie; limiter
//     w pamięci izolatu niczego tu nie gwarantuje i ten plik tego nie udaje,
//   * dostępność (axe) - to endpoint danych, nie powierzchnia UI.
//
// ZNALEZISKA (zachowanie ISTNIEJĄCE zaasertowane, kodu produkcyjnego nie ruszam):
//   Z1. PUSTY nagłówek `x-cron-source` daje źródło `external`, a nie `pg_cron`.
//       Domyślne `?? "pg_cron"` łapie tylko BRAK nagłówka; `""` przechodzi do
//       normalizacji i spada na `external`. Skutek jest widoczny w panelu
//       (przebieg zaksięgowany nie tej ścieżce), więc jest tu opisany testem
//       imiennym, żeby zmiana tego zachowania była decyzją, nie wypadkiem.
//   Z2. Trasa nie ma `try`: wyjątek z `runJobsTick` (np. niedostępny log
//       przebiegów) wychodzi z handlera i staje się 500 frameworka, bez wpisu
//       do `job_runner_runs`. Fail-loud jest tu obronny (pg_net i tak ignoruje
//       odpowiedź), ale diagnoza takiej awarii nie ma śladu w bazie - dowodem
//       jest tu asercja na PROPAGACJI wyjątku.
//   Z3. Prawdziwy `secretsEqual` (strażnik długości przed `timingSafeEqual`)
//       nie ma własnego testu jednostkowego w repo - najbliższy dowód jest
//       statyczny (`-preview-secrets.test.ts`) i dotyczy innych tras. Ten plik
//       tej luki nie zamyka (moduł jest tu atrapowany), tylko ją nazywa;
//       wierność atrapy jest warunkiem sensu dowodu z punktu 4.
//
// RODO. Zero prawdziwych osób i treści: sekrety są losowane w każdym przebiegu
// (`node:crypto`) i nie ma ich w repo ani w logu; adresy IP - dane osobowe -
// pochodzą wyłącznie z prywatnej przestrzeni 10.0.0.0/8 i z dokumentacyjnej
// TEST-NET-2 (198.51.100.0/24, RFC 5737), więc nie należą do nikogo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import type { JobsTickResult } from "@/lib/server/jobsTick.server";
import type { SchedulerSource } from "@/lib/jobs/scheduler";

// --- atrapy granic ----------------------------------------------------------

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

const db = vi.hoisted(() => ({ current: null as SupabaseFromStub | null }));

/**
 * Klient service role jako JEDEN obiekt o stabilnej tożsamości. To celowe:
 * dowód „dyspozytor dostał właśnie ten klient" jest asercją `toBe`, a nie
 * asercją na kształcie - kształt miałby też klient anonimowy.
 */
const admin = vi.hoisted(() => ({
  client: { from: (table: string) => db.current!.from(table) },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin.client }));

/**
 * Granica dyspozytora ticku. `secretsEqual` jest atrapą WIERNĄ (porównanie
 * długości przed `timingSafeEqual`) i zapisuje argumenty, więc widać, czy
 * trasa podaje mu gołe sekrety. `verdict` pozwala narzucić odpowiedź niezależnie
 * od treści - tylko tak da się odróżnić „trasa pyta helper" od „trasa i tak
 * porównuje sama".
 */
const jobs = vi.hoisted(() => {
  const state = {
    /** Wywołania dyspozytora: z jakim klientem i z jakim `meta`. */
    calls: [] as { admin: unknown; meta: Record<string, unknown> }[],
    /** Pary podane do porównania sekretów, w kolejności. */
    secretChecks: [] as [string, string][],
    /** `null` = wierne porównanie stałoczasowe; wartość = werdykt narzucony. */
    verdict: null as boolean | null,
    /** Ładunek, który dyspozytor oddaje endpointowi. */
    result: null as unknown,
    /** Wyjątek dyspozytora - dowód, że handler nie ma własnego `try`. */
    throws: null as Error | null,
    reset(): void {
      state.calls.length = 0;
      state.secretChecks.length = 0;
      state.verdict = null;
      state.result = null;
      state.throws = null;
    },
  };
  return state;
});

vi.mock("@/lib/server/jobsTick.server", () => ({
  runJobsTick: (client: unknown, meta: Record<string, unknown>): Promise<unknown> => {
    jobs.calls.push({ admin: client, meta });
    return jobs.throws ? Promise.reject(jobs.throws) : Promise.resolve(jobs.result);
  },
  secretsEqual: async (a: string, b: string): Promise<boolean> => {
    jobs.secretChecks.push([a, b]);
    if (jobs.verdict !== null) return jobs.verdict;
    const { timingSafeEqual } = await import("node:crypto");
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  },
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/jobs-tick";

const handlers = routeServerHandlers(Route);
const postHandler = handlers.POST!;

// --- stałe scenariusza ------------------------------------------------------

/** Sekret ŻYWY, losowany na każdy przebieg pliku - nie da się go utrwalić. */
const SECRET = randomBytes(24).toString("hex");
/** Ta sama DŁUGOŚĆ, inna treść: dowód, że odmowa nie jest o długości bufora. */
const WRONG_SECRET = randomBytes(24).toString("hex");

const NOW = new Date("2026-09-03T07:31:00.000Z");
const URL_TICK = "https://neweuropeanstrategies.com/api/public/jobs-tick";

/** Kubełek limitera z pliku trasy: `capacity: 10`, `refillPerSec: 0.5`. */
const CAPACITY = 10;

/**
 * Realistyczny ładunek jednego ticku - z polami `error`, bo pominięcia
 * (cykl pracy, budżet czasu) są normalnym stanem wyniku, nie awarią HTTP.
 */
function tickResult(): JobsTickResult {
  return {
    newsletter: { fired: 1, continued: 0, sent: 12 },
    emailQueue: { sent: 3, failed: 0, suppressed: 1, dlq: 0, duplicates: 0, stopped: null },
    push: { claimed: 4, sent: 4 },
    digestDaily: { claimed: 2, sent: 2 },
    digestWeekly: { claimed: 0, sent: 0 },
    eventReminders: 1,
    crmTaskReminders: 0,
    linkCheck: { postsScanned: 5, linksChecked: 41, broken: 0, archived: 0, alerted: 0 },
    integrations: { claimed: 0, delivered: 0, failed: 0 },
    semanticIndex: { scanned: 8, embedded: 8 },
    profileIndex: { scanned: 2, embedded: 2, pruned: 0 },
    clubThreadIndex: { error: "skipped_duty_cycle" },
    clubScheduler: {
      groups_opened: 0,
      groups_closed: 0,
      roles_expired: 0,
      invitations_expired: 0,
      threads_dormant: 0,
      hotness_refreshed: 0,
    },
  };
}

// --- pomocnicy żądania ------------------------------------------------------

/**
 * Każde żądanie z INNEGO adresu. Limiter jest stanem MODUŁU wspólnym dla całego
 * pliku, a zegar zamrożony - bez unikalnych adresów kolejne testy zjadałyby
 * sobie kubełek i padały zależnie od kolejności wykonania.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface CallOptions {
  /** `null`/brak = żadnego nagłówka `x-jobs-secret`. */
  secret?: string | null;
  /** Wartość nagłówka `x-cron-source` (`undefined` = brak nagłówka). */
  source?: string;
  /** Pojedynczy adres w `x-forwarded-for`. */
  ip?: string;
  /** CAŁA lista `x-forwarded-for` - do dowodu o pierwszym wpisie. */
  forwardedFor?: string;
  /** `x-real-ip` zamiast `x-forwarded-for` - drugie źródło adresu. */
  realIp?: string;
  /** Żądanie BEZ nagłówka adresu - wspólny kubełek `unknown`. */
  noIp?: boolean;
}

function buildRequest(options: CallOptions): Request {
  const headers = new Headers();
  if (options.forwardedFor !== undefined) headers.set("x-forwarded-for", options.forwardedFor);
  else if (options.realIp !== undefined) headers.set("x-real-ip", options.realIp);
  else if (!options.noIp) headers.set("x-forwarded-for", options.ip ?? nextIp());
  if (options.secret !== null && options.secret !== undefined) {
    headers.set("x-jobs-secret", options.secret);
  }
  if (options.source !== undefined) headers.set("x-cron-source", options.source);
  return new Request(URL_TICK, { method: "POST", headers, body: "{}" });
}

function post(options: CallOptions = {}): Promise<Response> {
  req.current = buildRequest(options);
  return postHandler({ request: req.current });
}

/** Autoryzowany tick - punkt wyjścia dowodów ścieżki szczęśliwej. */
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

/** Ile razy trasa sięgnęła po tabelę z sekretem. */
function settingsReads(): number {
  return db.current!.chainsFor("job_runner_settings").length;
}

// --- zasiew -----------------------------------------------------------------

/** `undefined` = brak wiersza (`maybeSingle()` -> `null`); `"error"` = padnięty odczyt. */
function seedSettings(row?: { enabled: boolean; secret: string } | "error"): void {
  const stub = supabaseFromStub();
  stub.setResponse("job_runner_settings", () =>
    row === "error" ? fail("job_runner_settings unreachable", "57014") : ok(row ?? null),
  );
  db.current = stub;
}

beforeEach(() => {
  // Zegar zamrożony: dolewka żetonów ma się dziać WYŁĄCZNIE wtedy, gdy test
  // przesunie czas jawnie, a nie przez to, ile trwał sam przebieg.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  jobs.reset();
  jobs.result = tickResult();
  seedSettings({ enabled: true, secret: SECRET });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Odmowa musi być CAŁKOWITA. Sam kod odpowiedzi byłby zgodny również ze
 * światem, w którym endpoint najpierw wysłał kolejkę, a dopiero potem spojrzał
 * na bramkę - dlatego każdy dowód bramki kończy się tym wywołaniem.
 */
function nicSieNieStalo(): void {
  expect(jobs.calls).toEqual([]);
}

/** Wyczerpuje kubełek adresu autoryzowanymi tickami (wszystkie muszą przejść). */
async function drainBucket(ip: string): Promise<void> {
  for (let i = 0; i < CAPACITY; i += 1) {
    const res = await tick({ ip });
    expect(res.status).toBe(200);
  }
}

// ===========================================================================
// POWIERZCHNIA TRASY
// ===========================================================================
describe("powierzchnia trasy /api/public/jobs-tick", () => {
  it("wystawia WYŁĄCZNIE POST - sonda GET nie potrafi uruchomić ticku", () => {
    // To nie kosmetyka: gdyby tick dał się odpalić GET-em, każdy uptime robot
    // (i każdy prefetch linku) stałby się drugim harmonogramem, a sekret
    // wylądowałby w query stringu logów proxy.
    expect(Object.keys(handlers)).toEqual(["POST"]);
  });
});

// ===========================================================================
// BRAMKA 1: NAGŁÓWEK SEKRETU
// ===========================================================================
describe("bramka sekretu: brak nagłówka `x-jobs-secret`", () => {
  it("BRAK nagłówka - 401, tick nie ruszył i tabela z sekretem NIE jest czytana", async () => {
    const res = await post({ secret: null });

    expect(res.status).toBe(401);
    nicSieNieStalo();
    // Kolejność jest treścią dowodu: anonimowy skan nie może zmuszać aplikacji
    // do odczytu tabeli service role przy każdym pukaniu.
    expect(settingsReads()).toBe(0);
    expect(jobs.secretChecks).toEqual([]);
  });

  it("PUSTY nagłówek jest traktowany jak brak sekretu, nie jak sekret pusty", async () => {
    // Wariant istotny osobno: `headers.get()` zwraca tu `""` (nie `null`), więc
    // domyślka `?? ""` NIE działa - odmowę wydaje dopiero warunek `!provided`.
    const res = await post({ secret: "" });

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(settingsReads()).toBe(0);
    expect(jobs.secretChecks).toEqual([]);
  });

  it("401 bramki nie niesie ani ciała, ani nagłówków odpowiedzi ticku", async () => {
    const res = await post({ secret: null });

    expect(res.status).toBe(401);
    await expect(res.text()).resolves.toBe("");
    expect(res.headers.get("Content-Type")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});

// ===========================================================================
// BRAMKA 2: PRZEŁĄCZNIK job_runner_settings
// ===========================================================================
describe("bramka przełącznika `job_runner_settings.enabled`", () => {
  it("czyta SINGLETON id=1 i tylko kolumny `enabled, secret` - raz na tick", async () => {
    // Wąski `select` jest tu regułą, nie stylem: `base_url` i telemetria
    // stemplowana przez cron nie mają po co przechodzić przez proces workera,
    // a odczyt musi trafiać w jedyny dopuszczony wiersz (CHECK id = 1).
    const res = await tick();

    expect(res.status).toBe(200);
    const chain = db.current!.lastChain("job_runner_settings");
    expect(chain?.argsOf("select")).toEqual(["enabled, secret"]);
    expect(chain?.argsOf("eq")).toEqual(["id", 1]);
    expect(chain?.has("maybeSingle")).toBe(true);
    expect(settingsReads()).toBe(1);
  });

  it("`enabled: false` - 401, zero pracy i sekret NIE jest nawet porównywany", async () => {
    // Zwarcie `||` jest treścią: operator, który wyłączył runnera, nie chce
    // żadnej pracy - a i nie ma powodu wpuszczać zgadującego do porównania.
    seedSettings({ enabled: false, secret: SECRET });

    const res = await tick();

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(jobs.secretChecks).toEqual([]);
    // Tabela BYŁA czytana - odmowa pochodzi z jej treści, nie z braku odczytu.
    expect(settingsReads()).toBe(1);
  });

  it("BRAK wiersza ustawień (`maybeSingle()` -> null) - 401 fail-closed", async () => {
    // Świeża baza bez zasiewu wiersza konfiguracji nie może być stanem
    // „wpuszczamy każdego", bo `settings?.enabled` na `null` jest `undefined`.
    seedSettings();

    const res = await tick();

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(jobs.secretChecks).toEqual([]);
  });

  it("PADNIĘTY odczyt ustawień też daje 401, a nie przejście dalej", async () => {
    // Trasa świadomie ignoruje `error` (destrukturyzuje tylko `data`), więc
    // niedostępna tabela wygląda jak brak wiersza. To jest fail-closed - ale
    // tylko dlatego, że `data` jest wtedy `null`; test pilnuje tej zależności.
    seedSettings("error");

    const res = await tick();

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(jobs.secretChecks).toEqual([]);
  });
});

// ===========================================================================
// BRAMKA 3: ZGODNOŚĆ SEKRETU
// ===========================================================================
describe("bramka sekretu: porównanie w stałym czasie", () => {
  it("zły sekret TEJ SAMEJ długości - 401 i zero pracy", async () => {
    // Warunek sensu tego testu: równa długość. Gdyby zły sekret był krótszy,
    // odmowa dowodziłaby tylko tego, że kod porównuje długości.
    expect(WRONG_SECRET).toHaveLength(SECRET.length);
    expect(WRONG_SECRET).not.toBe(SECRET);

    const res = await post({ secret: WRONG_SECRET });

    expect(res.status).toBe(401);
    nicSieNieStalo();
  });

  it("do porównania idą GOŁE sekrety: podany nagłówek przeciw sekretowi z tabeli", async () => {
    // Bliźniacza trasa podglądu poczty miała tu defekt K9: porównywała CAŁY
    // nagłówek (z prefiksem `Bearer`) z sekretem. Tu asercja jest na
    // argumentach, więc dołożenie jakiejkolwiek otoczki zapali ten test.
    await post({ secret: WRONG_SECRET });

    expect(jobs.secretChecks).toEqual([[WRONG_SECRET, SECRET]]);
  });

  it("o odmowie decyduje WERDYKT `secretsEqual`, a nie porównanie w trasie", async () => {
    // Ten test zabija mutanta `provided === settings.secret`: helper mówi
    // „zgoda" dla sekretu, który zwykłe `===` odrzuciłoby. Jeśli praca ruszyła,
    // decyzja NAPRAWDĘ pochodzi z helpera stałoczasowego.
    jobs.verdict = true;

    const res = await post({ secret: WRONG_SECRET });

    expect(res.status).toBe(200);
    expect(jobs.calls).toHaveLength(1);
    expect(jobs.secretChecks).toEqual([[WRONG_SECRET, SECRET]]);
  });

  it("i odwrotnie: werdykt odmowny blokuje pracę nawet dla sekretu identycznego", async () => {
    jobs.verdict = false;

    const res = await tick();

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(jobs.secretChecks).toEqual([[SECRET, SECRET]]);
  });

  it("sekret INNEJ długości kończy się 401, a nie wyjątkiem `timingSafeEqual`", async () => {
    // `crypto.timingSafeEqual` RZUCA `RangeError` na buforach różnej długości.
    // Bez strażnika `bufA.length === bufB.length` w helperze ta ścieżka dałaby
    // 500, czyli wyciek sygnału „twój sekret ma inną długość niż prawdziwy".
    const krotki = SECRET.slice(0, 7);
    expect(krotki.length).not.toBe(SECRET.length);

    const res = await post({ secret: krotki });

    expect(res.status).toBe(401);
    nicSieNieStalo();
    expect(jobs.secretChecks).toEqual([[krotki, SECRET]]);
  });
});

// ===========================================================================
// LIMITER PO ADRESIE KLIENTA (kubełek 10, dolewka 0,5 żetonu/s)
// ===========================================================================
describe("limiter po adresie klienta", () => {
  it("kubełek przepuszcza DOKŁADNIE 10 ticków, 11. dostaje 429 bez żadnej pracy", async () => {
    const ip = "198.51.100.11";
    await drainBucket(ip);
    const przed = jobs.calls.length;
    const odczyty = settingsReads();

    const res = await tick({ ip });

    expect(res.status).toBe(429);
    expect(jobs.calls).toHaveLength(przed);
    expect(settingsReads()).toBe(odczyty);
  });

  it("429 nie ma ciała ani nagłówków - to sygnał transportowy, nie odpowiedź", async () => {
    const ip = "198.51.100.12";
    await drainBucket(ip);

    const res = await tick({ ip });

    expect(res.status).toBe(429);
    await expect(res.text()).resolves.toBe("");
    expect(res.headers.get("Content-Type")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("limiter stoi PRZED bramką sekretu - wyczerpany kubełek nie pyta o sekret", async () => {
    // Świadomy zapis kontraktu, nie pochwała: zgadywanie sekretu kosztuje
    // żetony, ale JEDNOCZEŚNIE zalew z adresu crona potrafi wypchnąć legalny
    // tick na 429. Dowód, że kolejność jest taka, a nie odwrotna: wyczerpany
    // kubełek nie dotyka tabeli z sekretem i nie woła helpera porównania.
    const ip = "198.51.100.13";
    for (let i = 0; i < CAPACITY; i += 1) {
      const res = await post({ secret: WRONG_SECRET, ip });
      expect(res.status).toBe(401);
    }
    const odczyty = settingsReads();
    const porownania = jobs.secretChecks.length;

    const res = await tick({ ip });

    expect(res.status).toBe(429);
    expect(settingsReads()).toBe(odczyty);
    expect(jobs.secretChecks).toHaveLength(porownania);
    nicSieNieStalo();
  });

  it("kubełek jest PO ADRESIE: drugi adres ma własny zapas żetonów", async () => {
    const ip = "198.51.100.14";
    await drainBucket(ip);
    expect((await tick({ ip })).status).toBe(429);

    const res = await tick({ ip: "198.51.100.15" });

    expect(res.status).toBe(200);
    expect(jobs.calls).toHaveLength(CAPACITY + 1);
  });

  it("adres bierze się z PIERWSZEGO wpisu `x-forwarded-for`, nie z całej listy", async () => {
    // Za edge proxy nagłówek jest listą: `klient, proxy1, proxy2`. Gdyby
    // kluczem był cały nagłówek, wystarczyłoby dopisać dowolne proxy, żeby
    // dostać świeży kubełek - czyli limitu by nie było.
    const klient = "198.51.100.16";
    for (let i = 0; i < CAPACITY; i += 1) {
      const res = await tick({ forwardedFor: `${klient}, 10.0.0.${i + 1}` });
      expect(res.status).toBe(200);
    }

    const res = await tick({ forwardedFor: `${klient}, 10.0.0.99, 10.0.1.7` });

    expect(res.status).toBe(429);
  });

  it("`x-real-ip` trafia do TEGO SAMEGO kubełka co `x-forwarded-for`", async () => {
    // Dwa nagłówki, jeden klient: gdyby były dwoma kluczami, ten sam napastnik
    // dostałby podwójny limit przez samą zmianę nagłówka.
    const klient = "198.51.100.17";
    for (let i = 0; i < CAPACITY; i += 1) {
      const res = await tick({ realIp: klient });
      expect(res.status).toBe(200);
    }

    const res = await tick({ ip: klient });

    expect(res.status).toBe(429);
  });

  it("żądanie BEZ nagłówka adresu wpada do wspólnego kubełka, nie omija limitu", async () => {
    for (let i = 0; i < CAPACITY; i += 1) {
      const res = await tick({ noIp: true });
      expect(res.status).toBe(200);
    }

    const res = await tick({ noIp: true });

    expect(res.status).toBe(429);
  });

  it("dolewka to 0,5 żetonu/s: po 1 s wciąż 429, po 2 s tick przechodzi", async () => {
    // Dowód, że limit jest KUBEŁKIEM (dolewanym w czasie), a nie licznikiem
    // „10 na zawsze": po odblokowaniu ścieżka podstawowa musi wrócić sama,
    // bez restartu workera.
    const ip = "198.51.100.18";
    await drainBucket(ip);
    expect((await tick({ ip })).status).toBe(429);

    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    expect((await tick({ ip })).status).toBe(429);

    vi.setSystemTime(new Date(NOW.getTime() + 3_000));
    const res = await tick({ ip });

    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// ŚCIEŻKA SZCZĘŚLIWA: CO DOKŁADNIE DOSTAJE DYSPOZYTOR
// ===========================================================================
describe("ścieżka szczęśliwa: wywołanie dyspozytora ticku", () => {
  it("dyspozytor dostaje klienta SERVICE ROLE, dokładnie raz na żądanie", async () => {
    const res = await tick();

    expect(res.status).toBe(200);
    expect(jobs.calls).toHaveLength(1);
    // Tożsamość, nie kształt: to musi być obiekt eksportowany jako
    // `supabaseAdmin` z `client.server`, a nie klient anonimowy o tym samym
    // interfejsie (ten drugi nie ma prawa czytać kolejek ani logu przebiegów).
    expect(jobs.calls[0]!.admin).toBe(admin.client);
  });

  it("BRAK nagłówka `x-cron-source` znaczy `pg_cron` - ścieżka podstawowa", async () => {
    // Migracja 20260713170000 strzelała bez tego nagłówka; domyślka jest tym,
    // co ratuje panel od twierdzenia „cron bazy nie żyje".
    await tick();

    expect(jobs.calls[0]!.meta).toEqual({ source: "pg_cron" });
  });

  it("`meta` niesie WYŁĄCZNIE źródło - endpoint publiczny nie ma aktora", async () => {
    // Ślad audytowy (`tenantId`, `actorId`) ma prawo istnieć tylko dla ticku
    // ręcznego z panelu; wpisanie go tutaj byłoby wymyśleniem sprawcy.
    await tick();

    expect(Object.keys(jobs.calls[0]!.meta)).toEqual(["source"]);
  });

  const zrodla: ReadonlyArray<[string, SchedulerSource]> = [
    ["pg_cron", "pg_cron"],
    ["PG_CRON", "pg_cron"],
    ["github-actions", "github_actions"],
    ["github", "github_actions"],
    ["  postgres  ", "pg_cron"],
    ["admin", "admin"],
    ["dev", "dev"],
    ["zapier-webhook", "external"],
  ];

  it.each(zrodla)(
    "nagłówek `x-cron-source: %s` idzie do dyspozytora jako `%s`",
    async (naglowek, oczekiwane) => {
      await tick({ source: naglowek });

      expect(jobs.calls[0]!.meta).toEqual({ source: oczekiwane });
    },
  );

  it("ZNALEZISKO Z1: PUSTY `x-cron-source` daje `external`, nie `pg_cron`", async () => {
    // Domyślka `?? "pg_cron"` łapie tylko BRAK nagłówka. Pusta wartość
    // przechodzi do normalizacji i - jako nieznane źródło - spada na
    // `external`, więc przebieg księguje się obcemu źródłu, a panel czyta to
    // jako „ścieżka podstawowa milczy". Asertujemy zachowanie ISTNIEJĄCE.
    await tick({ source: "" });

    expect(jobs.calls[0]!.meta).toEqual({ source: "external" });
  });
});

// ===========================================================================
// ODPOWIEDŹ 200
// ===========================================================================
describe("odpowiedź ticku", () => {
  it("200 niesie DOKŁADNIE wynik dyspozytora jako JSON, bez koperty", async () => {
    const oczekiwany = tickResult();
    jobs.result = oczekiwany;

    const res = await tick();

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toEqual(oczekiwany);
  });

  it("200 deklaruje `application/json` i `Cache-Control: no-store`", async () => {
    // `no-store` nie jest ozdobą: bez niego pośrednik mógłby oddać cronowi
    // migawkę poprzedniego ticku, a wynik niesie stan kolejek wysyłkowych.
    const res = await tick();

    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("wynik z polami `error` też jest 200 - awaria joba nie jest awarią HTTP", async () => {
    // Kontrakt świadomy: pg_net i tak ignoruje odpowiedź, więc sygnał awarii
    // mieszka w `public.job_runner_runs` (zapis wewnątrz dyspozytora), a nie
    // w kodzie odpowiedzi. Gdyby ktoś zmapował błędy joba na 5xx, ten test
    // zapali się i wymusi rozmowę o tym, kto to właściwie czyta.
    const zPorazkami: JobsTickResult = {
      ...tickResult(),
      push: { error: "vapid_not_configured" },
      emailQueue: { error: "resend_500" },
    };
    jobs.result = zPorazkami;

    const res = await tick();

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toEqual(zPorazkami);
  });

  it("ZNALEZISKO Z2: wyjątek dyspozytora WYCHODZI z handlera (brak `try`)", async () => {
    // Trasa nie ma własnego `try`, więc np. niedostępny log przebiegów kończy
    // się 500 frameworka i przebiegiem bez śladu w bazie. Fail-loud jest tu
    // obronny, ale diagnoza takiej awarii nie ma gdzie usiąść - asercja
    // utrwala zachowanie ISTNIEJĄCE, żeby zmiana była decyzją.
    jobs.throws = new Error("job_runner_runs unreachable");

    await expect(tick()).rejects.toThrow("job_runner_runs unreachable");
    expect(jobs.calls).toHaveLength(1);
  });
});
