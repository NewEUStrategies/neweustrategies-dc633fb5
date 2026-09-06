// DYSPOZYTOR ZADAŃ TŁA: `runJobsTick` + `runJobStep` z `jobsTick.server.ts`.
//
// PO CO TEN PLIK ISTNIEJE. `runJobsTick` jest JEDYNYM miejscem, w którym
// spotyka się cała praca wychodząca aplikacji: kampanie newslettera, dren
// kolejek pocztowych (pgmq), push, digesty dzienne i tygodniowe, przypomnienia
// o wydarzeniach i zadaniach CRM, skaner martwych linków, dostawy webhooków,
// trzy kolejki embeddingów i harmonogram Discussion Club. Woła go pg_cron
// (co minutę, przez POST /api/public/jobs-tick), siatka bezpieczeństwa repo
// i panel admina. Do 04.09.2026 sam dyspozytor miał 2/19 funkcji pokrycia
// (7/49 linii, 3/38 gałęzi) - bo WSZYSCY jego konsumenci go atrapują:
// `-jobs-tick.test.ts` dowodzi warstwy HTTP z atrapą `runJobsTick`, a dwa
// istniejące pliki obok dotykają tylko `secretsEqual` i `everyNthMinute`.
// Skutek: każda z poniższych zmian przechodziła przez CI bez śladu.
//   * przestawienie KOLEJNOŚCI jobów - kosztowne sieciowo wchodzą przed
//     wysyłki, więc przy wyczerpaniu budżetu pomijane są maile i push,
//     a nie skaner linków (dokładnie odwrotnie niż mówi komentarz :157-159),
//   * zdjęcie własnego, krótszego deadline'u drenu poczty - jedna duża kolejka
//     po awarii dostawcy zjada cały budżet ticku i zagładza przypomnienia,
//   * zamiana `skipped_duty_cycle` / `skipped_time_budget` na zwykły błąd -
//     scheduler alarmuje przy KAŻDYM ticku, więc operator uczy się ignorować
//     alarm i przestaje widzieć realną awarię,
//   * ucieczka wyjątku z jednego joba - jeden padnięty kanał zabiera dwanaście
//     pozostałych, choć komentarz :7 obiecuje niezależność,
//   * brak wpisu heartbeatu albo wpis z `ok:true` przy awarii - pg_net jest
//     fire-and-forget, więc `public.job_runner_runs` to JEDYNY sposób, żeby
//     odróżnić „kolejka pusta" od „nikt nie woła dyspozytora".
//
// CO JEST PRZEDMIOTEM DOWODU. Dyspozytor sam nie wysyła ani jednego maila -
// jego treścią jest KOLEJNOŚĆ, BRAMKOWANIE, BUDŻET i RAPORT. Dowodzimy więc
// dokładnie tego:
//   1. że joby biegną w jednej, przypiętej kolejności, w której wszystkie
//      wysyłki i przypomnienia wyprzedzają joby kosztowne sieciowo,
//   2. że cykl pracy (5 / 15 / 60 minut zegara UTC) wpuszcza i pomija
//      dokładnie te joby, które ma - i że pominięcie NIE jest awarią,
//   3. że po wyczerpaniu budżetu 25 s KOLEJNE joby są POMIJANE, a nie
//      wykonywane (asercja na tym, czego atrapa NIE zobaczyła),
//   4. że dren poczty dostaje własny, o 15 s wcześniejszy deadline,
//   5. że awaria jednego joba nie zabiera pozostałych, a jej przyczyna
//      dojeżdża do logu przebiegów sklejona przez `"; "`,
//   6. że KAŻDY tick - czysty i z awarią - zostawia wpis heartbeatu z klientem
//      service role podanym z zewnątrz (`recordJobRun` nie tworzy własnego).
//
// JAK ASERTUJEMY. Przez SKUTEK, nie przez zwrócony obiekt. Kształt
// `{ error: "skipped_time_budget" }` w wyniku jest zgodny również ze światem,
// w którym job SIĘ WYKONAŁ, a ktoś tylko nadpisał pole - dlatego każdy dowód
// o pomijaniu patrzy na to, czy atrapa joba została W OGÓLE zawołana
// (`jobs.steps()`), a nie tylko na treść wyniku. Kolejność mierzymy w JEDNEJ
// liście wywołań, bo kolejność jest tu treścią, nie kosmetyką.
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO (granica atrapy = moduł z własnym
// dowodem). Siedem modułów - cztery z importów GÓRNYCH i trzy wciągane
// `await import(...)` w środku ticku:
//   * `@/lib/newsletter-campaigns.functions`, `@/lib/email/queueDrain.server`,
//     `@/lib/notifications/dispatch.server` - realna poczta, Resend i VAPID;
//   * `@/lib/server/linkCheck.server`, `@/lib/integrations/dispatch.functions`,
//     `@/lib/server/embeddings.server` - realna sieć wychodząca i model
//     embeddingów (każdy ma własny plik testowy obok);
//   * `@/lib/server/jobScheduler.server` - log przebiegów; atrapa jest tu
//     INSTRUMENTEM POMIAROWYM, bo dowodzimy TREŚCI raportu i TOŻSAMOŚCI
//     przekazanego klienta, czego z prawdziwym RPC nie dałoby się odczytać.
// PRAWDZIWE zostają: `runJobsTick`, `runJobStep`, `everyNthMinute`, oba
// budżety czasu, składanie `JobsTickResult` oraz `@/lib/jobs/scheduler`
// (moduł BEZ ani jednego importu - `countTickFailures`,
// `normalizeSchedulerSource`). To one są przedmiotem dowodu, więc atrapowanie
// ich zamieniłoby ten plik w test atrapy - i to jest ta sama reguła, która
// zostawiła dyspozytor bez pokrycia na trzy miesiące.
//
// GRANICE DOWODU - CZEGO TEN PLIK NIE UDAJE.
//   * Nie dowodzi, że dren poczty HONORUJE podany deadline - dowodzi, że go
//     DOSTAJE. Honorowanie jest zachowaniem `drainEmailQueues` i mieszka
//     w jego własnym teście; tu byłoby dowodem na atrapie.
//   * Nie dowodzi idempotencji ani braku dublowania pracy przy nakładających
//     się tickach - jedynym mechanizmem jest `FOR UPDATE SKIP LOCKED`
//     w Postgresie, a jego dowód należy do pgTAP.
//   * Nie mierzy czasu rzeczywistego. Zegar jest ZAMROŻONY (`vi.useFakeTimers`)
//     i przesuwany z testu przez zaczep `beforeStep` - dokładnie w chwili,
//     w której dany job zaczyna pracę. Zaczep jest polem rejestru, a nie
//     bezpośrednim wywołaniem `vi.setSystemTime`, bo fabryka `vi.hoisted` jest
//     wynoszona nad importy i nie wolno w niej sięgać po zaimportowane
//     referencje (ten sam wzorzec co w `-community-cron.test.ts`).
//
// ZAREJESTROWANE DEFEKTY (`it.fails`, każdy z kontrolą dodatnią obok):
//   D1. Bramki cyklu pracy czytają zegar OSOBNO, job po jobie, więc jeden tick
//       potrafi podjąć SPRZECZNE decyzje o tym samym oknie 5-minutowym.
//   D2. `runJobsTick` nie chroni się przed rzutem z `recordJobRun`, choć
//       komentarz :268 obiecuje, że zapis „nie może unieważnić pracy, która
//       już się wykonała".
//
// BEZ SIECI, BEZ POCZTY, BEZ SEKRETÓW. Wszystkie granice wychodzące są
// atrapami, żaden test nie tworzy klienta Supabase ani nie czyta env.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceClock } from "@/test/time";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { JobRunReport } from "@/lib/server/jobScheduler.server";
import type { SupabaseFromStub, SupabaseResult, SupabaseRpcStub } from "@/test/supabase";

// --- wartości zwracane przez atrapy -----------------------------------------
// Muszą powstać w `vi.hoisted`, bo fabryki `vi.mock` są wynoszone NAD zwykłe
// deklaracje `const` - inaczej pierwszy tick czytałby je przed inicjalizacją.
// Każda ma inną, rozpoznawalną treść: to dzięki temu asercja „wynik joba X
// wylądował w polu X" jest dowodem, a nie zgadywaniem po kształcie.
const fixtures = vi.hoisted(() => ({
  newsletter: { fired: 1, continued: 2, sent: 3 },
  drain: { sent: 11, failed: 1, suppressed: 2, dlq: 0, duplicates: 3, stopped: null },
  push: { claimed: 9, sent: 8 },
  digestDaily: { claimed: 4, sent: 4 },
  digestWeekly: { claimed: 2, sent: 2 },
  eventReminders: 7,
  crmTaskReminders: 5,
  linkCheck: { postsScanned: 6, linksChecked: 41, broken: 2, archived: 1, alerted: 1 },
  integrations: { claimed: 7, delivered: 6, failed: 1 },
  semanticIndex: { scanned: 24, embedded: 20 },
  profileIndex: { scanned: 16, embedded: 12, pruned: 5 },
  clubThreadIndex: { scanned: 16, embedded: 9, pruned: 2 },
}));

/**
 * Rejestr jobów. JEDNA funkcja `run` obsługuje wszystkie granice wychodzące,
 * więc kolejność wywołań jest mierzalna w JEDNEJ liście - a kolejność jest
 * treścią tego modułu, nie kosmetyką.
 *
 * `note` jest wejściem dla jobów, które nie mają własnej granicy modułowej:
 * harmonogram klubów woła `admin.rpc("club_scheduler_tick")` wprost, więc
 * ląduje w tej samej liście przez odpowiedź atrapy RPC. Bez tego kolejność
 * dałoby się przypiąć tylko dla dwunastu z trzynastu jobów.
 */
const jobs = vi.hoisted(() => {
  const state = {
    calls: [] as { step: string; args: readonly unknown[] }[],
    /** Joby, które mają rzucić `Error`: nazwa kroku -> komunikat. */
    failures: new Map<string, string>(),
    /** Joby rzucające czymś, co NIE jest `Error` (napis, obiekt). */
    rawFailures: new Map<string, unknown>(),
    /** Zaczep budżetu czasu: odpalany w chwili startu pracy danego joba. */
    beforeStep: null as ((step: string) => void) | null,
    note(step: string, args: readonly unknown[]): void {
      state.beforeStep?.(step);
      state.calls.push({ step, args });
    },
    run(step: string, args: readonly unknown[], value: unknown): Promise<unknown> {
      state.note(step, args);
      if (state.rawFailures.has(step)) return Promise.reject(state.rawFailures.get(step));
      const failure = state.failures.get(step);
      if (failure !== undefined) return Promise.reject(new Error(failure));
      return Promise.resolve(value);
    },
    steps(): string[] {
      return state.calls.map((c) => c.step);
    },
    /** Argumenty PIERWSZEGO wywołania joba (undefined, gdy go nie było). */
    argsOf(step: string): readonly unknown[] | undefined {
      return state.calls.find((c) => c.step === step)?.args;
    },
    reset(): void {
      state.calls.length = 0;
      state.failures.clear();
      state.rawFailures.clear();
      state.beforeStep = null;
    },
  };
  return state;
});

/** Log przebiegów - jedyne wyjście heartbeatu, więc jedyne miejsce asercji. */
const scheduler = vi.hoisted(() => ({
  runs: [] as JobRunReport[],
  /** Drugi argument `recordJobRun` - dowód, że klient przychodzi z zewnątrz. */
  clients: [] as unknown[],
  /** Komunikat, którym zapis heartbeatu ma odmówić (defekt D2). */
  failure: null as string | null,
}));

// --- atrapy granic: cztery importy GÓRNE ------------------------------------

vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  tickNewsletterCampaigns: (admin: unknown, opts: unknown) =>
    jobs.run("newsletter", [admin, opts], fixtures.newsletter),
}));

vi.mock("@/lib/email/queueDrain.server", () => ({
  drainEmailQueues: (admin: unknown, opts: unknown) =>
    jobs.run("emailQueue", [admin, opts], fixtures.drain),
}));

vi.mock("@/lib/notifications/dispatch.server", () => ({
  processPushJobs: (limit: number) => jobs.run("push", [limit], fixtures.push),
  // Nazwa kroku idzie po POLU WYNIKU, nie po częstotliwości, żeby lista
  // kolejności czytała się tak samo jak `JobsTickResult`. Sama częstotliwość
  // jest zapisana w argumentach, więc „daily trafił do digestDaily" pozostaje
  // sprawdzalne osobno.
  processDigests: (frequency: string, limit: number) =>
    frequency === "weekly"
      ? jobs.run("digestWeekly", [frequency, limit], fixtures.digestWeekly)
      : jobs.run("digestDaily", [frequency, limit], fixtures.digestDaily),
  runEventReminders: () => jobs.run("eventReminders", [], fixtures.eventReminders),
  runCrmTaskReminders: () => jobs.run("crmTaskReminders", [], fixtures.crmTaskReminders),
}));

vi.mock("@/lib/server/jobScheduler.server", () => ({
  recordJobRun: (report: JobRunReport, client?: unknown): Promise<void> => {
    scheduler.runs.push(report);
    scheduler.clients.push(client);
    return scheduler.failure === null
      ? Promise.resolve()
      : Promise.reject(new Error(scheduler.failure));
  },
}));

// --- atrapy granic: trzy importy DYNAMICZNE ---------------------------------
// `vi.mock` podstawia moduł niezależnie od tego, czy wchodzi górnym importem,
// czy `await import(...)` w środku funkcji - te trzy są wciągane dopiero
// w ticku, żeby nie weszły do bundla trasy.

vi.mock("@/lib/server/linkCheck.server", () => ({
  runLinkCheckBatch: (admin: unknown, postsLimit: number) =>
    jobs.run("linkCheck", [admin, postsLimit], fixtures.linkCheck),
}));

vi.mock("@/lib/integrations/dispatch.functions", () => ({
  runIntegrationDispatch: (limit: number) =>
    jobs.run("integrations", [limit], fixtures.integrations),
}));

vi.mock("@/lib/server/embeddings.server", () => ({
  runSemanticIndexBatch: (admin: unknown, batch: number) =>
    jobs.run("semanticIndex", [admin, batch], fixtures.semanticIndex),
  runProfileSemanticIndexBatch: (admin: unknown, batch: number, options: unknown) =>
    jobs.run("profileIndex", [admin, batch, options], fixtures.profileIndex),
  runClubThreadIndexBatch: (admin: unknown, batch: number, options: unknown) =>
    jobs.run("clubThreadIndex", [admin, batch, options], fixtures.clubThreadIndex),
}));

import { fail, ok, supabaseFromStub, supabaseRpcStub } from "@/test/supabase";
import { runJobsTick, type JobsTickMeta, type JobsTickResult } from "../jobsTick.server";

// --- atrapa klienta service role --------------------------------------------

/** Powierzchnia klienta, której dotyka dyspozytor: `rpc` oraz - biernie - `from`. */
interface AdminSurface {
  from: (table: string) => unknown;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
}

/**
 * STRAŻNIK, nie rzutowanie: samo `as unknown as SupabaseClient` przepuściłoby
 * atrapę bez ogniwa `rpc`, czyli test „zdałby" tam, gdzie harmonogram klubów
 * nie miałby czym wykonać wywołania - i pominięcie wyglądałoby jak sukces.
 */
function isDbClient(candidate: AdminSurface): candidate is AdminSurface & SupabaseClient<Database> {
  return typeof candidate.from === "function" && typeof candidate.rpc === "function";
}

function adminClient(from: SupabaseFromStub, rpc: SupabaseRpcStub): SupabaseClient<Database> {
  const candidate: AdminSurface = { from: from.from, rpc: rpc.rpc };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniw from()/rpc()");
  return candidate;
}

// --- stałe scenariusza ------------------------------------------------------

/**
 * Pełna, przypięta kolejność jobów jednego ticku. Kolejność jest KONTRAKTEM
 * (komentarz :157-159): tanie DB-only najpierw, kosztowne sieciowo na końcu,
 * bo to one mają być pomijane pierwsze przy wyczerpaniu budżetu.
 */
const FULL_ORDER = [
  "newsletter",
  "emailQueue",
  "push",
  "digestDaily",
  "digestWeekly",
  "eventReminders",
  "crmTaskReminders",
  "linkCheck",
  "integrations",
  "semanticIndex",
  "profileIndex",
  "clubThreadIndex",
  "clubScheduler",
] as const;

/** Joby, które MUSZĄ się wykonać, dopóki tick ma budżet: poczta i przypomnienia. */
const CRITICAL_SENDS = [
  "newsletter",
  "emailQueue",
  "push",
  "digestDaily",
  "digestWeekly",
  "eventReminders",
  "crmTaskReminders",
] as const;

/** Joby kosztowne sieciowo - kandydaci do pominięcia jako PIERWSI. */
const NETWORK_COSTLY = [
  "linkCheck",
  "integrations",
  "semanticIndex",
  "profileIndex",
  "clubThreadIndex",
] as const;

/** Joby bramkowane co 5 minut (`everyNthMinute(5)`). */
const FIVE_MINUTE_JOBS = ["digestDaily", "digestWeekly", "semanticIndex", "clubScheduler"] as const;
/** Joby bramkowane co 15 minut (`everyNthMinute(15)`). */
const FIFTEEN_MINUTE_JOBS = ["linkCheck", "profileIndex", "clubThreadIndex"] as const;
/** Joby biegnące w KAŻDYM ticku - bez bramki cyklu pracy. */
const EVERY_MINUTE_JOBS = [
  "newsletter",
  "emailQueue",
  "push",
  "eventReminders",
  "crmTaskReminders",
  "integrations",
] as const;

/** Kompletny wiersz z `club_scheduler_tick` - wszystkie sześć liczników. */
const CLUB_ROW = {
  groups_opened: 2,
  groups_closed: 1,
  roles_expired: 3,
  invitations_expired: 4,
  threads_dormant: 5,
  hotness_refreshed: 6,
} as const;

// --- harness -----------------------------------------------------------------

let from: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let admin: SupabaseClient<Database>;
/** Odpowiedź `club_scheduler_tick`; podmieniana w testach normalizacji. */
let clubTick: SupabaseResult = ok(CLUB_ROW);

/**
 * Zamrożone „teraz" w UTC. Minuta jest JEDYNYM wejściem bramki cyklu pracy,
 * więc każdy test podaje ją wprost - to czyni bramkowanie sprawdzalnym bez
 * czekania na zegar i bez zależności od strefy maszyny CI.
 */
function at(minute: number, second = 0, ms = 0): Date {
  return new Date(Date.UTC(2026, 8, 4, 10, minute, second, ms));
}

function tickAt(minute: number, meta?: JobsTickMeta): Promise<JobsTickResult> {
  vi.setSystemTime(at(minute));
  // Wywołanie JEDNOARGUMENTOWE, gdy testu nie interesuje meta - żeby domyślna
  // wartość parametru (`meta = {}`, źródło `external`) była realnie wykonywana,
  // a nie obchodzona przez jawne `{}` z testu.
  return meta === undefined ? runJobsTick(admin) : runJobsTick(admin, meta);
}

/** Job „trwa" `ms`: przesuwa zamrożony zegar w chwili startu swojej pracy. */
function slowJob(step: string, ms: number): void {
  jobs.beforeStep = (current) => {
    if (current === step) advanceClock(ms);
  };
}

/**
 * Komunikat błędu joba albo `null`, gdy job zwrócił dane. Pozwala pisać
 * asercje o pomijaniu bez rzutowania unii `T | { error: string }`.
 */
function jobError(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("error" in value)) return null;
  const error = (value as { error: unknown }).error;
  return typeof error === "string" ? error : null;
}

/** Wynik joba po nazwie pola - wspólne wejście dla asercji tabelarycznych. */
function slot(result: JobsTickResult, key: string): unknown {
  return (result as unknown as Record<string, unknown>)[key];
}

/** Pozycja joba w liście wywołań (-1, gdy nie był wołany). */
function orderOf(step: string): number {
  return jobs.steps().indexOf(step);
}

/** Wiersz, który poszedł do `public.job_runner_runs`. */
function lastRun(): JobRunReport {
  const run = scheduler.runs.at(-1);
  if (!run) throw new Error("test: żaden przebieg nie trafił do logu");
  return run;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at(0));
  jobs.reset();
  scheduler.runs.length = 0;
  scheduler.clients.length = 0;
  scheduler.failure = null;
  from = supabaseFromStub();
  rpc = supabaseRpcStub();
  clubTick = ok(CLUB_ROW);
  // Odpowiedź RPC dopisuje harmonogram klubów do TEJ SAMEJ listy wywołań, co
  // pozostałe dwanaście jobów - inaczej kolejność ostatniego joba byłaby
  // niemierzalna, a to właśnie on jest pomijany pierwszy.
  rpc.setResponse("club_scheduler_tick", (call) => {
    jobs.note("clubScheduler", [call.name]);
    return clubTick;
  });
  admin = adminClient(from, rpc);
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// KOLEJNOŚĆ JOBÓW
// ===========================================================================
describe("kolejność jobów jest kontraktem, nie kosmetyką", () => {
  it("pełny tick (minuta 0) wykonuje trzynaście jobów w przypiętej kolejności", async () => {
    // Minuta 0 otwiera WSZYSTKIE bramki (0 % 5 = 0 % 15 = 0 % 60 = 0), więc
    // to jedyny moment, w którym kolejność da się przypiąć w całości.
    await tickAt(0);

    expect(jobs.steps()).toEqual([...FULL_ORDER]);
  });

  it("wszystkie wysyłki i przypomnienia wyprzedzają joby kosztowne sieciowo", async () => {
    // To jest DLACZEGO tej kolejności, a nie sama lista: przy wyczerpaniu
    // budżetu pomijane są joby z KOŃCA. Gdyby skaner linków albo embeddingi
    // weszły przed dren poczty, tick pod obciążeniem przestałby wysyłać maile,
    // a dalej mieliłby sieć - i lista wyżej przeszłaby po samej permutacji.
    await tickAt(0);

    const lastSend = Math.max(...CRITICAL_SENDS.map(orderOf));
    const firstCostly = Math.min(...NETWORK_COSTLY.map(orderOf));
    expect(lastSend).toBeLessThan(firstCostly);
  });

  it("newsletter i dren poczty są PIERWSZE - link do logowania starzeje się najszybciej", async () => {
    await tickAt(0);

    expect(jobs.steps().slice(0, 3)).toEqual(["newsletter", "emailQueue", "push"]);
  });

  it("wynik każdego joba ląduje w SWOIM polu wyniku", async () => {
    // Trzynaście pól i trzynaście różnych treści: gdyby dwa joby wpisywały się
    // w to samo pole (albo pole zostało przestawione przy dopisywaniu nowego
    // joba), panel admina raportowałby cudzy licznik jako swój.
    const result = await tickAt(0);

    expect(result).toEqual({
      newsletter: fixtures.newsletter,
      emailQueue: fixtures.drain,
      push: fixtures.push,
      digestDaily: fixtures.digestDaily,
      digestWeekly: fixtures.digestWeekly,
      eventReminders: fixtures.eventReminders,
      crmTaskReminders: fixtures.crmTaskReminders,
      linkCheck: fixtures.linkCheck,
      integrations: fixtures.integrations,
      semanticIndex: fixtures.semanticIndex,
      profileIndex: fixtures.profileIndex,
      clubThreadIndex: fixtures.clubThreadIndex,
      clubScheduler: CLUB_ROW,
    });
  });

  it("klient service role dojeżdża do jobów, które go potrzebują - ten sam obiekt", async () => {
    // `toBe`, nie `toEqual`: chodzi o TOŻSAMOŚĆ. Job, który dostałby klienta
    // anonimowego (albo własnego, zbudowanego po drodze), widziałby bazę przez
    // RLS i cicho nic nie robił - a wynik wyglądałby jak „pusta kolejka".
    await tickAt(0);

    for (const step of [
      "newsletter",
      "emailQueue",
      "linkCheck",
      "semanticIndex",
      "profileIndex",
      "clubThreadIndex",
    ]) {
      expect(jobs.argsOf(step)?.[0]).toBe(admin);
    }
  });

  it("rozmiary partii są przypięte - to one dzielą budżet jednego ticku", async () => {
    await tickAt(0);

    expect(jobs.argsOf("push")).toEqual([100]);
    expect(jobs.argsOf("digestDaily")).toEqual(["daily", 50]);
    expect(jobs.argsOf("digestWeekly")).toEqual(["weekly", 50]);
    expect(jobs.argsOf("linkCheck")?.[1]).toBe(6);
    expect(jobs.argsOf("integrations")).toEqual([20]);
    expect(jobs.argsOf("semanticIndex")?.[1]).toBe(24);
    expect(jobs.argsOf("profileIndex")?.[1]).toBe(16);
    expect(jobs.argsOf("clubThreadIndex")?.[1]).toBe(16);
  });

  it("dyspozytor NIE dotyka tabel wprost - cała jego baza to jeden RPC", async () => {
    // Gdyby ktoś dołożył tu odczyt tabeli „na skróty", omijałby moduł, który
    // ma własny test i własne zakresowanie po tenancie. Atrapa łańcucha nie ma
    // zaplanowanej ANI JEDNEJ odpowiedzi, więc taki odczyt wróciłby błędem -
    // ale zapaliłby się dopiero tutaj, na pustej liście łańcuchów.
    await tickAt(0);

    expect(from.chains).toEqual([]);
    expect(rpc.names()).toEqual(["club_scheduler_tick"]);
  });
});

// ===========================================================================
// CYKL PRACY (duty cycle)
// ===========================================================================
describe("cykl pracy: 5 / 15 / 60 minut zegara UTC", () => {
  it("minuta 0 otwiera wszystkie bramki", async () => {
    const result = await tickAt(0);

    for (const key of FULL_ORDER) expect(jobError(slot(result, key))).toBeNull();
  });

  it("minuta 5: piątki ruszają, piętnastki dostają `skipped_duty_cycle`", async () => {
    const result = await tickAt(5);

    for (const key of FIVE_MINUTE_JOBS) expect(jobError(slot(result, key))).toBeNull();
    for (const key of FIFTEEN_MINUTE_JOBS) {
      expect(slot(result, key)).toEqual({ error: "skipped_duty_cycle" });
    }
  });

  it("minuta 3: biegną TYLKO joby co-minutowe, reszta jest bramkowana", async () => {
    const result = await tickAt(3);

    // Asercja na liście WYWOŁAŃ, nie na wyniku: pominięty job nie może zostać
    // zawołany „na próbę" i dopiero potem nadpisany kształtem pominięcia -
    // to by kosztowało dokładnie ten ruch HTTP, którego bramka ma oszczędzić.
    expect(jobs.steps()).toEqual([...EVERY_MINUTE_JOBS]);
    for (const key of [...FIVE_MINUTE_JOBS, ...FIFTEEN_MINUTE_JOBS]) {
      expect(slot(result, key)).toEqual({ error: "skipped_duty_cycle" });
    }
  });

  it("minuta 0 pełnej godziny włącza sprzątanie wektorów (`prune: true`)", async () => {
    // `everyNthMinute(60)` jest prawdziwe wyłącznie przy minucie 0, czyli raz
    // na godzinę. Sprzątanie po opt-oucie z katalogu osób jest operacją czysto
    // bazową - tanią, ale nie ma sensu co 15 minut.
    await tickAt(0);

    expect(jobs.argsOf("profileIndex")?.[2]).toEqual({ prune: true });
    expect(jobs.argsOf("clubThreadIndex")?.[2]).toEqual({ prune: true });
  });

  it("minuta 30 indeksuje, ale NIE sprząta (`prune: false`)", async () => {
    // Kontrola dodatnia do testu wyżej: `prune` musi być decyzją bramki
    // 60-minutowej, a nie stałą wartością przypadkiem zgodną z oczekiwaniem.
    await tickAt(30);

    expect(jobs.argsOf("profileIndex")?.[2]).toEqual({ prune: false });
    expect(jobs.argsOf("clubThreadIndex")?.[2]).toEqual({ prune: false });
  });

  it("POMINIĘCIE TO NIE AWARIA - przebieg jest `ok`, log bez przyczyny", async () => {
    // Najważniejsza asercja tej sekcji. Praca jest watermarkowa i claimowana,
    // więc pominięty job wraca w następnym oknie. Gdyby pominięcie liczyło się
    // jako awaria, scheduler alarmowałby przez 4 minuty z 5 - a operator
    // nauczyłby się ignorować alarm i przestał widzieć realną awarię.
    await tickAt(3);

    expect(lastRun()).toMatchObject({ ok: true, error: null });
  });
});

// ===========================================================================
// BUDŻET CZASU (JOBS_TICK_DEADLINE_MS = 25 s)
// ===========================================================================
describe("budżet czasu jednego ticku", () => {
  it("po przekroczeniu budżetu KOLEJNE joby nie są nawet wołane", async () => {
    // Zaczep przesuwa zegar DOKŁADNIE w chwili, w której push zaczyna pracę,
    // więc push się wykonuje (bramka budżetu jest sprawdzana PRZED wywołaniem),
    // a wszystko po nim ma zastać budżet już wyczerpany.
    slowJob("push", 25_001);

    const result = await tickAt(0);

    expect(jobs.steps()).toEqual(["newsletter", "emailQueue", "push"]);
    for (const key of FULL_ORDER.slice(3)) {
      expect(slot(result, key)).toEqual({ error: "skipped_time_budget" });
    }
  });

  it("pominięcie z budżetu to NIE pominięcie z cyklu pracy - komunikaty są rozłączne", async () => {
    // Oba kształty są „nie-awarią", ale znaczą co innego: `skipped_duty_cycle`
    // to zaplanowany rytm, `skipped_time_budget` to tick, który nie zmieścił
    // się w minucie. Zlanie ich w jeden komunikat odebrałoby operatorowi
    // jedyny sygnał, że budżet trzeba podnieść albo partie zmniejszyć.
    slowJob("push", 25_001);

    const result = await tickAt(0);

    // Minuta 0 otwiera wszystkie bramki, więc KAŻDE pominięcie tutaj musi być
    // budżetowe - żadne nie może udawać rytmu.
    for (const key of FULL_ORDER.slice(3)) {
      expect(jobError(slot(result, key))).toBe("skipped_time_budget");
    }
  });

  it("GRANICA: dokładnie 25 000 ms jeszcze mieści się w budżecie", async () => {
    // Warunek jest `>`, nie `>=`. Test pilnuje, żeby przypadkowa zmiana na
    // `>=` nie ucinała jednego joba na każdym ticku, który wyrobi się co do
    // milisekundy - i żeby granica była decyzją, nie skutkiem ubocznym.
    slowJob("push", 25_000);

    const result = await tickAt(0);

    expect(jobs.steps()).toEqual([...FULL_ORDER]);
    expect(jobError(result.digestDaily)).toBeNull();
  });

  it("GRANICA: 25 001 ms już nie mieści się", async () => {
    slowJob("push", 25_001);

    const result = await tickAt(0);

    expect(jobError(result.digestDaily)).toBe("skipped_time_budget");
  });

  it("wyczerpanie budżetu na PIERWSZYM jobie pomija dwanaście pozostałych", async () => {
    slowJob("newsletter", 30_000);

    const result = await tickAt(0);

    expect(jobs.steps()).toEqual(["newsletter"]);
    expect(result.newsletter).toEqual(fixtures.newsletter);
    for (const key of FULL_ORDER.slice(1)) {
      expect(slot(result, key)).toEqual({ error: "skipped_time_budget" });
    }
  });

  it("POMINIĘCIE Z BUDŻETU TO NIE AWARIA - log ma `ok:true` i realny czas", async () => {
    slowJob("push", 25_001);

    await tickAt(0);

    expect(lastRun()).toMatchObject({ ok: true, error: null, durationMs: 25_001 });
  });
});

// ===========================================================================
// DREN POCZTY: WŁASNY, KRÓTSZY DEADLINE
// ===========================================================================
describe("dren kolejek pocztowych ma własny budżet (EMAIL_DRAIN_DEADLINE_MS = 10 s)", () => {
  it("dostaje deadline ABSOLUTNY, 10 s od startu ticku, i limit 60 wiadomości", async () => {
    // Bez własnego, wcześniejszego limitu jeden dren po awarii dostawcy
    // (kolejka liczona w tysiącach) zjadłby cały budżet 25 s i zagłodził
    // przypomnienia oraz push - a te są w tym ticku PO nim. Deadline jest
    // absolutny (`startedAt + 10 000`), nie względny, bo dren mierzy go
    // własnym zegarem, nie licznikiem wiadomości.
    await tickAt(0);

    expect(jobs.argsOf("emailQueue")?.[1]).toEqual({
      maxMessages: 60,
      deadlineAt: at(0).getTime() + 10_000,
    });
  });

  it("dren oddaje sterowanie 15 s PRZED końcem budżetu ticku", async () => {
    // Ta asercja nazywa RÓŻNICĘ dwóch stałych, bo to ona jest treścią: 15 s
    // rezerwy zostaje na dziesięć jobów, które idą po drenie. Zrównanie obu
    // deadline'ów (albo podniesienie drenu do 25 s) przeszłoby przez test
    // wyżej, gdyby patrzył tylko na „jakiś" deadline.
    await tickAt(0);

    const opts = jobs.argsOf("emailQueue")?.[1];
    const deadlineAt = (opts as { deadlineAt?: unknown } | undefined)?.deadlineAt;
    expect(typeof deadlineAt).toBe("number");
    // Budżet ticku to 25 000 ms od `startedAt` (dowiedziony w sekcji wyżej
    // przez zachowanie, nie przez odczyt stałej), a dren kończy na 10 000.
    expect(Number(deadlineAt) - at(0).getTime()).toBe(10_000);
    expect(25_000 - (Number(deadlineAt) - at(0).getTime())).toBe(15_000);
  });

  it("GRANICA DOWODU: honorowanie deadline'u należy do drenu, nie do dyspozytora", async () => {
    // Dyspozytor może wyłącznie PODAĆ budżet - dren jest atrapą, więc nic tu
    // nie dowodzi, że go dotrzyma. Ten test przypina jedyną rzecz, którą
    // dyspozytor kontroluje: że opcje wchodzą razem z klientem, w jednym
    // wywołaniu. Dowód dotrzymania mieszka w teście `drainEmailQueues`.
    await tickAt(0);

    const args = jobs.argsOf("emailQueue");
    expect(args).toHaveLength(2);
    expect(args?.[0]).toBe(admin);
  });
});

// ===========================================================================
// runJobStep: IZOLACJA AWARII
// ===========================================================================
describe("runJobStep: awaria jednego joba nie zabiera pozostałych", () => {
  it("rzut `Error` staje się `{ error: komunikat }`, a tick jedzie dalej", async () => {
    // Obietnica z komentarza :7 („błąd jednego nie blokuje pozostałych") jest
    // tu dowodzona przez LISTĘ WYWOŁAŃ: wszystkie trzynaście jobów startuje,
    // choć trzeci z nich rzucił.
    jobs.failures.set("push", "web-push: 503 od dostawcy");

    const result = await tickAt(0);

    expect(result.push).toEqual({ error: "web-push: 503 od dostawcy" });
    expect(jobs.steps()).toEqual([...FULL_ORDER]);
    expect(result.emailQueue).toEqual(fixtures.drain);
    expect(result.crmTaskReminders).toBe(fixtures.crmTaskReminders);
    expect(result.clubScheduler).toEqual(CLUB_ROW);
  });

  it("rzut NAPISEM (nie-`Error`) staje się `{ error }` z jego treścią", async () => {
    // `throw "tekst"` w bibliotece zewnętrznej albo w kodzie przepisanym
    // z JS-a nie jest hipotetyczny. Gałąź `String(err)` istnieje właśnie po to,
    // żeby taki rzut nie wyszedł z dyspozytora jako `undefined`.
    jobs.rawFailures.set("eventReminders", "kolejka przypomnień odmówiła");

    const result = await tickAt(0);

    expect(result.eventReminders).toEqual({ error: "kolejka przypomnień odmówiła" });
    expect(jobs.steps()).toEqual([...FULL_ORDER]);
  });

  it("rzut OBIEKTEM daje `[object Object]` - przyczyna ginie i to jest przypięte", async () => {
    // Nie upiększamy tego. `String({})` to jedyna uczciwa rzecz, jaką
    // dyspozytor może zrobić z rzutem, który nie jest `Error`, ale skutek jest
    // taki, że log przebiegów dostaje wpis bez żadnej informacji. Wniosek jest
    // dla MIEJSCA RZUTU (ma rzucać `Error`), nie dla tej gałęzi - a przypięcie
    // sprawia, że ewentualna zmiana na serializację JSON będzie decyzją.
    jobs.rawFailures.set("crmTaskReminders", { code: "42501", table: "crm_tasks" });

    const result = await tickAt(0);

    expect(result.crmTaskReminders).toEqual({ error: "[object Object]" });
    expect(lastRun().error).toBe("crmTaskReminders: [object Object]");
  });

  it('DWIE awarie sklejają się przez `"; "` w kolejności pól wyniku', async () => {
    jobs.failures.set("push", "web-push: 503");
    jobs.rawFailures.set("integrations", "outbox: brak grantu");

    await tickAt(0);

    expect(lastRun()).toMatchObject({
      ok: false,
      error: "push: web-push: 503; integrations: outbox: brak grantu",
    });
  });

  it("pominięcia NIE wchodzą do sklejonej przyczyny", async () => {
    // Minuta 3 pomija siedem jobów z cyklu pracy, a push rzuca. W logu ma być
    // JEDNA przyczyna - inaczej każdy zwykły tick wyglądałby jak katastrofa
    // z siedmioma błędami i nikt by nie odróżnił awarii od rytmu.
    jobs.failures.set("push", "web-push: 503");

    await tickAt(3);

    expect(lastRun()).toMatchObject({ ok: false, error: "push: web-push: 503" });
  });
});

// ===========================================================================
// HARMONOGRAM KLUBÓW: RPC club_scheduler_tick
// ===========================================================================
describe("harmonogram klubów: jeden RPC, sześć liczników", () => {
  it("woła `club_scheduler_tick` BEZ argumentów i przepisuje wszystkie liczniki", async () => {
    // Nazwa funkcji jest kontraktem: pomyłka w niej nie zapala `tsc` w żadnym
    // czytelnym miejscu, a skutkiem jest cicho stojący harmonogram klubów
    // (grupy się nie otwierają, kadencje ról nie wygasają).
    const result = await tickAt(0);

    const call = rpc.lastCall("club_scheduler_tick");
    expect(call?.args).toBeUndefined();
    expect(result.clubScheduler).toEqual(CLUB_ROW);
  });

  it("normalizuje liczniki: napisy, `null` i BRAK klucza dają liczby", async () => {
    // `n()` istnieje, bo `jsonb` z RPC nie gwarantuje typu: PostgREST potrafi
    // oddać `numeric` jako napis, a nowy licznik dołożony w migracji nie
    // istnieje w starszym wierszu. Bez normalizacji panel admina pokazywałby
    // `"3"` obok `3` albo `undefined` w miejscu zera.
    clubTick = ok({
      groups_opened: 2,
      groups_closed: "3",
      roles_expired: null,
      threads_dormant: 5,
      hotness_refreshed: 6,
    });

    const result = await tickAt(0);

    expect(result.clubScheduler).toEqual({
      groups_opened: 2,
      groups_closed: 3,
      roles_expired: 0,
      // Klucza NIE BYŁO w wierszu - `Number(undefined ?? 0)` daje 0, nie NaN.
      invitations_expired: 0,
      threads_dormant: 5,
      hotness_refreshed: 6,
    });
  });

  it("pusty wynik RPC (`data: null`) daje sześć zer, nie `undefined`", async () => {
    // `data ?? {}` jest jedyną rzeczą, która stoi między pustą zwrotką funkcji
    // a szóstką `undefined` w logu przebiegów.
    clubTick = ok(null);

    const result = await tickAt(0);

    expect(result.clubScheduler).toEqual({
      groups_opened: 0,
      groups_closed: 0,
      roles_expired: 0,
      invitations_expired: 0,
      threads_dormant: 0,
      hotness_refreshed: 0,
    });
  });

  it("licznik NIELICZBOWY przechodzi jako NaN - granica normalizacji", async () => {
    // Przypięte, nie naprawiane: `Number("kilka")` to NaN, a NaN w `jsonb`
    // serializuje się do `null`. Źródłem takiego wiersza może być tylko własna
    // funkcja SECURITY DEFINER, więc wniosek jest dla niej - ale gdyby ktoś
    // dołożył tu `Number.isFinite`, ten test się zapali i wymusi rozmowę.
    clubTick = ok({ ...CLUB_ROW, threads_dormant: "kilka" });

    const result = await tickAt(0);

    expect(result.clubScheduler).toEqual({ ...CLUB_ROW, threads_dormant: NaN });
  });

  it("odmowa bazy jest łapana jako `{ error }` i NIE zabija ticku", async () => {
    // `if (error) throw error` rzuca `PostgrestError`, który DZIEDZICZY po
    // `Error`, więc do logu dojeżdża komunikat, a nie `[object Object]`.
    clubTick = fail("permission denied for function club_scheduler_tick", "42501");

    const result = await tickAt(0);

    expect(result.clubScheduler).toEqual({
      error: "permission denied for function club_scheduler_tick",
    });
    expect(result.push).toEqual(fixtures.push);
    expect(lastRun()).toMatchObject({
      ok: false,
      error: "clubScheduler: permission denied for function club_scheduler_tick",
    });
  });

  it("bramka 5 minut jest PRZED wywołaniem RPC - minuta 3 nie rusza bazy", async () => {
    await tickAt(3);

    expect(rpc.names()).toEqual([]);
  });
});

// ===========================================================================
// HEARTBEAT: public.job_runner_runs
// ===========================================================================
describe("heartbeat: każdy tick zostawia wpis w logu przebiegów", () => {
  it('czysty tick: `ok:true`, `error:null`, `job:"all"`, źródło `external`', async () => {
    // `external` jest domyślne, gdy meta jest pusta - dokładnie jak
    // normalizacja w `record_job_run()`. Wywołanie jednoargumentowe, żeby
    // domyślna wartość parametru była naprawdę wykonana.
    await tickAt(0);

    expect(scheduler.runs).toHaveLength(1);
    expect(lastRun()).toMatchObject({
      source: "external",
      job: "all",
      ok: true,
      error: null,
      tenantId: null,
      actorId: null,
    });
  });

  it("wpis niesie DOKŁADNIE ten obiekt wyniku, który dostał wołający", async () => {
    // `toBe`: log i odpowiedź HTTP muszą być tą samą prawdą. Kopia „prawie
    // taka sama" (np. bez pól pominiętych) sprawiłaby, że panel admina
    // pokazuje coś innego niż zwróciła trasa - i nie dałoby się tego wykryć.
    const result = await tickAt(0);

    expect(lastRun().result).toBe(result);
  });

  it("`recordJobRun` dostaje klienta Z ZEWNĄTRZ - nie tworzy własnego", async () => {
    // Drugi argument jest tu jedyną obroną przed sytuacją, w której log
    // przebiegów montuje sobie osobnego klienta (własne env, własny pool,
    // własny tryb awarii) w kodzie wołanym co minutę.
    await tickAt(0);

    expect(scheduler.clients).toHaveLength(1);
    expect(scheduler.clients[0]).toBe(admin);
  });

  it("źródło i ślad audytowy ręcznego ticku przechodzą z meta bez zmian", async () => {
    // Tick z panelu admina musi być odróżnialny od crona bazy, bo inaczej
    // panel „widzi żywy harmonogram" po tym, że operator sam kliknął przycisk.
    await tickAt(0, {
      source: "admin",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actorId: "22222222-2222-4222-8222-222222222222",
    });

    expect(lastRun()).toMatchObject({
      source: "admin",
      job: "all",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actorId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("meta bez źródła spada do `external`, a `null`-e w meta nie znikają", async () => {
    await tickAt(0, { tenantId: null, actorId: null });

    expect(lastRun()).toMatchObject({ source: "external", tenantId: null, actorId: null });
  });

  it("tick z awarią też trafia do logu - z `ok:false` i przyczyną", async () => {
    // To jest cel całego heartbeatu: pg_net jest fire-and-forget, więc bez
    // tego wpisu awaria jednego kanału jest niewidzialna, a awaria całego
    // harmonogramu wygląda identycznie jak pusta kolejka.
    jobs.failures.set("semanticIndex", "embeddings: 429 rate limit");

    await tickAt(0);

    expect(scheduler.runs).toHaveLength(1);
    expect(lastRun()).toMatchObject({
      ok: false,
      error: "semanticIndex: embeddings: 429 rate limit",
    });
  });

  it("awaria joba NIE przerywa ticku ani nie wycieka do wołającego", async () => {
    // `runJobsTick` nigdy nie rzuca: trasa publiczna ma oddać 200 z wynikiem
    // per job, a nie 500, przez które cron uznałby całą minutę za straconą.
    jobs.failures.set("newsletter", "resend: 401");
    jobs.rawFailures.set("linkCheck", "fetch failed");

    const result = await tickAt(0);

    expect(jobError(result.newsletter)).toBe("resend: 401");
    expect(jobError(result.linkCheck)).toBe("fetch failed");
    expect(result.emailQueue).toEqual(fixtures.drain);
  });

  it("`durationMs` mierzy czas ticku, a nie sumę deklarowanych budżetów", async () => {
    slowJob("integrations", 1_234);

    await tickAt(0);

    expect(lastRun().durationMs).toBe(1_234);
  });
});

// ===========================================================================
// ZAREJESTROWANE DEFEKTY
// ===========================================================================
describe("D1: bramki cyklu pracy czytają zegar OSOBNO, job po jobie", () => {
  it("kontrola dodatnia: bez przesunięcia zegara cała czwórka 5-minutowa decyduje ZGODNIE", () => {
    // Ta kontrola jest warunkiem sensu `it.fails` niżej: dowodzi, że mechanizm
    // pomiaru (lista pominięć w jednej minucie) działa, więc rozjazd niżej
    // bierze się z PRZESUNIĘCIA ZEGARA, a nie z błędu w teście.
    return tickAt(5).then((result) => {
      const skips = FIVE_MINUTE_JOBS.filter(
        (key) => jobError(slot(result, key)) === "skipped_duty_cycle",
      );
      expect(skips).toEqual([]);
    });
  });

  it.fails(
    "DEFEKT: tick, który przekroczy minutę, podejmuje SPRZECZNE decyzje o tym samym oknie",
    async () => {
      // Każda bramka woła `everyNthMinute(n)` z DOMYŚLNYM `new Date()`, więc
      // czyta zegar w chwili swojej ewaluacji, a nie w chwili startu ticku.
      // Tick startujący pod koniec minuty 5 policzy `digestsDue` jako prawdę,
      // a bramkę embeddingów i harmonogramu klubów - już w minucie 6 - jako
      // fałsz. Skutek: digesty poszły „w oknie 5-minutowym", a indeks
      // semantyczny i harmonogram klubów to okno przegapiły i czekają do
      // minuty 10. Nie jest to hipoteza: sam dren poczty ma budżet 10 s, więc
      // przekroczenie minuty jest w tym ticku zachowaniem NORMALNYM.
      //
      // Naprawa to jeden znacznik czasu na tick (`const now = new Date()`
      // przy `startedAt` i przekazywanie go do `everyNthMinute`), a nie
      // podnoszenie budżetów. Test ma się zapalić dopiero po tej zmianie.
      vi.setSystemTime(at(5, 59, 500));
      slowJob("digestDaily", 1_000);

      const result = await runJobsTick(admin);

      const skips = FIVE_MINUTE_JOBS.filter(
        (key) => jobError(slot(result, key)) === "skipped_duty_cycle",
      );
      // Albo całe okno jest otwarte, albo całe zamknięte - stan pośredni
      // znaczy, że jeden tick miał dwa różne „teraz".
      expect(skips.length === 0 || skips.length === FIVE_MINUTE_JOBS.length).toBe(true);
    },
  );

  it("pomiar defektu D1: dziś digesty ruszają, a indeks i kluby są pomijane", async () => {
    // Kontrola dodatnia z drugiej strony - pokazuje, CO dokładnie mierzy
    // `it.fails` wyżej, żeby po naprawie nikt nie musiał tego odtwarzać.
    vi.setSystemTime(at(5, 59, 500));
    slowJob("digestDaily", 1_000);

    const result = await runJobsTick(admin);

    expect(jobError(result.digestDaily)).toBeNull();
    expect(jobError(result.digestWeekly)).toBeNull();
    expect(jobError(result.semanticIndex)).toBe("skipped_duty_cycle");
    expect(jobError(result.clubScheduler)).toBe("skipped_duty_cycle");
  });
});

describe("D2: zapis heartbeatu nie jest odgrodzony od pracy, którą raportuje", () => {
  it("kontrola dodatnia: przy sprawnym zapisie tick zwraca wynik", async () => {
    const result = await tickAt(0);

    expect(result.push).toEqual(fixtures.push);
  });

  it.fails(
    "DEFEKT: rzut z `recordJobRun` unieważnia wynik pracy, która JUŻ się wykonała",
    async () => {
      // Komentarz :268 mówi wprost: „Zapis jest best-effort i nie może
      // unieważnić pracy, która już się wykonała". W kodzie nie ma jednak
      // ŻADNEGO `try` wokół `await recordJobRun(...)` - cała ta gwarancja jest
      // scedowana na sąsiada, który dziś faktycznie łyka każdy wyjątek
      // wewnątrz siebie. Dopóki tak jest, defekt jest STRUKTURALNY, nie żywy:
      // wystarczy jednak, że sąsiad zacznie rzucać przed swoim `try` (dziś
      // robi tam dynamiczny import klienta) albo że ktoś dołoży `throw`
      // w warstwie klienta, i tick oddaje 500 po tym, jak wysłał całą pocztę.
      // Cron uzna minutę za straconą, a wysyłki nie da się już „odwołać".
      //
      // Naprawa: `try { await recordJobRun(...) } catch (err) { console.error }`
      // w `runJobsTick` - gwarancja ma stać tam, gdzie jest obiecana.
      scheduler.failure = "record_job_run: connection reset";

      await expect(tickAt(0)).resolves.toMatchObject({ push: fixtures.push });
    },
  );

  it("pomiar defektu D2: praca została wykonana, a mimo to tick nie oddaje wyniku", async () => {
    // Kontrola dodatnia: wszystkie trzynaście jobów naprawdę pobiegło, więc
    // `it.fails` wyżej nie mierzy „ticku, który nic nie zrobił".
    scheduler.failure = "record_job_run: connection reset";

    await expect(tickAt(0)).rejects.toThrow("record_job_run: connection reset");
    expect(jobs.steps()).toEqual([...FULL_ORDER]);
  });
});
