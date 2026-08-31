// Harmonogram rozliczeń: POST /api/public/billing-cron.
//
// PO CO TEN PLIK ISTNIEJE. To jest PUBLICZNY adres, pod który każdy z internetu
// może wysłać POST-a, a za nim stoi trzy zadania dotykające PIENIĘDZY i DOSTĘPU:
//   * `runBillingReminders`      - masowa wysyłka maili do płacących klientów,
//   * `sendSeatGraceReminders`   - maile o kończącej się karencji miejsc,
//   * `expireSeatGrace`          - realne ODEBRANIE dostępu członkom zespołów.
// Jedyną bramką jest współdzielony sekret w nagłówku `x-billing-cron-secret`.
// Do 31.08.2026 ten plik nie miał ANI JEDNEGO testu (0% linii, 0 z 8 funkcji),
// czyli zdjęcie bramki albo odwrócenie porównania sekretu przechodziłoby przez
// CI bez śladu - a skutkiem byłby publiczny przycisk „wyślij mail do wszystkich
// abonentów" i „odbierz dostęp zespołom".
//
// JAK ASERTUJEMY. Endpoint zwraca `200 {ok:true}` na CAŁEJ ścieżce szczęśliwej
// niezależnie od tego, ile zadań realnie coś zrobiło, więc kod odpowiedzi sam
// w sobie nie odróżnia „cykl przebiegł" od „cykl nic nie zrobił". Dlatego każdy
// dowód opiera się na SKUTKU: czy zapytanie do bazy w ogóle poszło, jaki mail
// wyszedł (i do kogo), czy RPC wygaszające karencję zostało zawołane, jakie
// okno czasowe policzył cron. Kod odpowiedzi sprawdzamy TYLKO tam, gdzie jest
// jedynym kontraktem (401 / 429 / 500).
//
// GRANICE, KTÓRE ATRAPUJEMY: klient Supabase (service role) i dostawca poczty
// (`sendTxEmail`). WSZYSTKO inne biegnie PRAWDZIWE - `reminders.server`,
// `notifications.server`, `purchaseEffects.server`, `teamSeats.server`,
// limiter po IP i porównanie sekretu w stałym czasie. To one są przedmiotem
// dowodu, więc atrapowanie ich zamieniłoby ten plik w test atrapy.
//
// RODO: żaden adres w tym pliku nie jest prawdziwy - wyłącznie example.com /
// example.org, a asercje o mailach patrzą na typ i odbiorcę, nie na treść.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, type RecordedChain } from "@/test/supabaseChain";

// --- atrapy granic ----------------------------------------------------------

const db = vi.hoisted(() => ({
  current: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
  /** Wywołania `supabaseAdmin.rpc(...)` w kolejności - RPC nie ma w atrapie łańcucha. */
  rpcCalls: [] as string[],
  /** Odpowiedź RPC per nazwa funkcji; `throw` symuluje padnięcie połączenia. */
  rpc: new Map<string, () => { data: unknown; error: { message: string } | null }>(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.from(table),
    rpc: (fn: string) => {
      db.rpcCalls.push(fn);
      const responder = db.rpc.get(fn);
      if (!responder) return Promise.resolve({ data: null, error: { message: `no rpc ${fn}` } });
      return Promise.resolve(responder());
    },
  },
}));

const mail = vi.hoisted(() => ({
  /** Każdy mail, który dostawca poczty zobaczył: typ + odbiorca + klucz idempotencji. */
  sent: [] as { type: string; to: string; idempotencyKey: string | undefined }[],
}));

// Dostawca poczty to GRANICA - podmieniamy wyłącznie samą wysyłkę.
// `formatDate`/`formatMoney` zostają PRAWDZIWE, bo treść detali maila liczy
// kod produkcyjny i test nie ma prawa jej podmieniać.
vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return {
    ...actual,
    sendTxEmail: (input: { type: string; to: string; idempotencyKey?: string }) => {
      mail.sent.push({ type: input.type, to: input.to, idempotencyKey: input.idempotencyKey });
      return Promise.resolve({ ok: true });
    },
  };
});

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/billing-cron";

const handler = routeServerHandlers(Route).POST!;

// --- stałe scenariusza ------------------------------------------------------

const SECRET = "sekret-testowy-crona-1234567890";
/** Ten sam ROZMIAR co `SECRET` - dowodzi, że odmowa nie bierze się z długości. */
const WRONG_SECRET = "sekret-testowy-crona-0987654321";
const NOW = new Date("2026-08-31T10:00:00.000Z");
const DAY_MS = 86_400_000;

/** ISO przesunięte o `days` względem zamrożonego „teraz". */
function iso(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

// --- pomocnicy żądania ------------------------------------------------------

/**
 * Każde żądanie z INNEGO adresu. Limiter (`capacity 10`, `0,2 żetonu/s`) jest
 * stanem MODUŁU, wspólnym dla całego pliku, a czas jest zamrożony - bez
 * unikalnych adresów kolejne testy zjadałyby sobie nawzajem kubełek i padały
 * zależnie od kolejności wykonania.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.40.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface PostOptions {
  secret?: string | null;
  body?: unknown;
  rawBody?: string;
  ip?: string;
}

async function post(options: PostOptions = {}): Promise<Response> {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? nextIp() });
  if (options.secret !== null && options.secret !== undefined) {
    headers.set("x-billing-cron-secret", options.secret);
  }
  req.current = new Request("https://neweuropeanstrategies.com/api/public/billing-cron", {
    method: "POST",
    headers,
    body:
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  return handler({ request: req.current });
}

/** Autoryzowane wywołanie - domyślny punkt wyjścia większości testów. */
function run(options: Omit<PostOptions, "secret"> = {}): Promise<Response> {
  return post({ ...options, secret: SECRET });
}

/** Ciało odpowiedzi jako rekord - bez `any` w teście. */
async function body(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
}

/** Sekcja odpowiedzi jako rekord (`seatGrace`, `seatGraceReminders`). */
function section(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value !== null && typeof value === "object" ? { ...value } : {};
}

// --- zasiew bazy ------------------------------------------------------------

interface SubSeed {
  user_id: string;
  price_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_subscription_id: string;
}

interface SeatSeed {
  id: string;
  org_id: string;
  invited_email: string;
  grace_until: string;
}

/** Subskrypcja aktywna, kończąca okres w oknie przypomnienia. */
function sub(overrides: Partial<SubSeed> = {}): SubSeed {
  return {
    user_id: "user-1",
    price_id: "plus_monthly",
    status: "active",
    current_period_end: iso(3),
    cancel_at_period_end: false,
    provider_subscription_id: "sub_1",
    ...overrides,
  };
}

function seat(overrides: Partial<SeatSeed> = {}): SeatSeed {
  return {
    id: "seat-1",
    org_id: "org-1",
    invited_email: "zespol@example.com",
    grace_until: iso(7),
    ...overrides,
  };
}

interface SeedOptions {
  subscriptions?: SubSeed[] | "error";
  /** `"error"` = odmowa bazy, `"throw"` = padnięcie transportu w połowie zadania. */
  seats?: SeatSeed[] | "error" | "throw";
  /** Progi przypomnień organizacji; `null` = domyślne [7, 1]. */
  orgReminderDays?: number[] | null;
  /** Wygaszone miejsca zwrócone przez RPC; "error"/"throw" = awaria. */
  expired?: { org_id: string; seat_id: string; email: string }[] | "error" | "throw";
  /** Ceny, dla których odczyt planu MA paść (symuluje błąd bazy per rekord). */
  planLookupFailsFor?: string[];
  /** Czy istnieje profil odbiorcy - bez niego mail nie ma dokąd pójść. */
  profile?: boolean;
  jobRunner?: { enabled: boolean; secret: string } | null | "error";
}

function seed(options: SeedOptions = {}): void {
  const stub = supabaseFromStub();
  const subs = options.subscriptions ?? [];
  const seats = options.seats ?? [];
  const expired = options.expired ?? [];
  const planFails = options.planLookupFailsFor ?? [];
  const hasProfile = options.profile !== false;

  stub.setResponse("subscriptions", () =>
    subs === "error" ? fail("subscriptions unavailable", "57014") : ok(subs),
  );

  // `access_plans` obsługuje DWA różne odczyty: mapowanie ceny na plan
  // (`resolvePlanForPrice`, filtr po `tier_key`) i dociągnięcie nazwy planu do
  // maila (`loadPlan`, filtr po `id`). Jeden responder rozróżnia je po filtrze.
  stub.setResponse("access_plans", (chain: RecordedChain) => {
    const tier = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tier_key")?.args[1];
    if (typeof tier === "string") {
      if (planFails.includes(tier)) return fail("plan lookup exploded", "57014");
      return ok({
        id: `plan-${tier}`,
        tenant_id: "tenant-alfa",
        price_cents: 4900,
        currency: "PLN",
      });
    }
    return ok({
      name_pl: "Członek",
      name_en: "Member",
      price_cents: 4900,
      currency: "PLN",
      interval: "month",
    });
  });

  stub.setResponse(
    "profiles",
    ok(
      hasProfile
        ? { email: "abonent@example.com", first_name: "Anna", display_name: null, prefs: {} }
        : null,
    ),
  );
  stub.setResponse("newsletter_subscribers", ok({ language: "pl" }));

  stub.setResponse("organization_seats", () => {
    if (seats === "throw") throw new Error("seats transport died");
    return seats === "error" ? fail("seats unavailable", "57014") : ok(seats);
  });
  stub.setResponse(
    "member_organizations",
    ok(
      typeof seats === "string"
        ? []
        : [...new Set(seats.map((s) => s.org_id))].map((id) => ({
            id,
            name: "Instytut Przykładowy",
            seats_grace_reminder_days: options.orgReminderDays ?? null,
          })),
    ),
  );

  const runner = options.jobRunner;
  stub.setResponse("job_runner_settings", () => {
    if (runner === "error") throw new Error("job_runner_settings unreachable");
    return ok(runner ?? null);
  });

  db.current = stub;
  db.rpcCalls.length = 0;
  db.rpc.clear();
  db.rpc.set("org_expire_seat_grace", () => {
    if (expired === "throw") throw new Error("rpc transport died");
    if (expired === "error") return { data: null, error: { message: "rpc denied" } };
    return { data: { expired }, error: null };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("BILLING_CRON_SECRET", SECRET);
  vi.stubEnv("COMMUNITY_CRON_SECRET", "");
  mail.sent.length = 0;
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ===========================================================================
// BRAMKA SEKRETU - kto w ogóle ma prawo uruchomić cykl
// ===========================================================================
describe("autoryzacja: współdzielony sekret w nagłówku", () => {
  /**
   * Najważniejsza asercja pliku i celowo nie o kodzie odpowiedzi: dowodzimy, że
   * przy odmowie ŻADNE zadanie nie ruszyło. Sam `401` byłby zgodny również ze
   * światem, w którym cron najpierw wysyła maile, a dopiero potem sprawdza
   * sekret.
   */
  function nothingRan(): void {
    expect(db.current!.chainsFor("subscriptions")).toHaveLength(0);
    expect(db.current!.chainsFor("organization_seats")).toHaveLength(0);
    expect(db.rpcCalls).toEqual([]);
    expect(mail.sent).toEqual([]);
  }

  it("BRAK nagłówka - 401 i żadne zadanie nie ruszyło", async () => {
    const res = await post({ secret: null });

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toEqual({ error: "unauthorized" });
    nothingRan();
  });

  it("PUSTY nagłówek jest traktowany jak brak sekretu", async () => {
    const res = await post({ secret: "" });

    expect(res.status).toBe(401);
    nothingRan();
  });

  it("BŁĘDNY sekret tej samej długości - 401, nic nie ruszyło", async () => {
    expect(WRONG_SECRET).toHaveLength(SECRET.length);

    const res = await post({ secret: WRONG_SECRET });

    expect(res.status).toBe(401);
    nothingRan();
  });

  it("sekret INNEJ długości odpada bez wyjątku z `timingSafeEqual`", async () => {
    // `crypto.timingSafeEqual` RZUCA przy różnych długościach buforów, więc bez
    // wcześniejszego porównania długości ta ścieżka kończyłaby się 500 zamiast
    // 401 - czyli wyciekiem informacji „twój sekret ma inną długość".
    const res = await post({ secret: "krotki" });

    expect(res.status).toBe(401);
    nothingRan();
  });

  it("sekret będący PREFIKSEM prawdziwego nie przechodzi", async () => {
    const res = await post({ secret: SECRET.slice(0, -1) });

    expect(res.status).toBe(401);
    nothingRan();
  });

  it("POPRAWNY sekret uruchamia cykl - zapytanie o subskrypcje idzie do bazy", async () => {
    const res = await run();

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ ok: true });
    expect(db.current!.chainsFor("subscriptions")).toHaveLength(1);
  });

  it("gdy BILLING_CRON_SECRET nie jest ustawiony, wchodzi COMMUNITY_CRON_SECRET", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    vi.stubEnv("COMMUNITY_CRON_SECRET", "sekret-spolecznosciowy");

    const res = await post({ secret: "sekret-spolecznosciowy" });

    expect(res.status).toBe(200);
  });

  it("gdy BILLING_CRON_SECRET JEST ustawiony, sekret społecznościowy NIE działa", async () => {
    // Kolejność `BILLING || COMMUNITY` to reguła bezpieczeństwa, nie kosmetyka:
    // rotacja sekretu billingu nie może zostawić czynnego starego sekretu
    // drugiego harmonogramu.
    vi.stubEnv("COMMUNITY_CRON_SECRET", "sekret-spolecznosciowy");

    const res = await post({ secret: "sekret-spolecznosciowy" });

    expect(res.status).toBe(401);
  });

  it("brak sekretu w środowisku ORAZ w bazie - 401 (fail-closed)", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
    seed({ jobRunner: null });

    const res = await post({ secret: "cokolwiek" });

    expect(res.status).toBe(401);
    expect(db.current!.chainsFor("subscriptions")).toHaveLength(0);
  });
});

// ===========================================================================
// BRAMKA SEKRETU - wariant bazodanowy (pg_cron -> net.http_post)
// ===========================================================================
describe("autoryzacja: sekret runnera zadań z `job_runner_settings`", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    vi.stubEnv("COMMUNITY_CRON_SECRET", "");
  });

  it("WŁĄCZONY wpis z pasującym sekretem uruchamia cykl", async () => {
    seed({ jobRunner: { enabled: true, secret: "sekret-z-bazy" }, subscriptions: [sub()] });

    const res = await post({ secret: "sekret-z-bazy" });

    expect(res.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
  });

  it("wpis WYŁĄCZONY (`enabled:false`) nie autoryzuje, nawet z dobrym sekretem", async () => {
    seed({ jobRunner: { enabled: false, secret: "sekret-z-bazy" }, subscriptions: [sub()] });

    const res = await post({ secret: "sekret-z-bazy" });

    expect(res.status).toBe(401);
    expect(mail.sent).toEqual([]);
  });

  it("wpis z PUSTYM sekretem nie autoryzuje pustego nagłówka", async () => {
    seed({ jobRunner: { enabled: true, secret: "" } });

    const res = await post({ secret: "" });

    expect(res.status).toBe(401);
  });

  it("BRAK wiersza konfiguracyjnego - 401", async () => {
    seed({ jobRunner: null });

    const res = await post({ secret: "sekret-z-bazy" });

    expect(res.status).toBe(401);
  });

  it("AWARIA bazy przy odczycie sekretu odmawia (fail-closed), nie przepuszcza", async () => {
    // Padnięcie odczytu konfiguracji nie może być furtką: „nie wiem, kto to" ma
    // znaczyć „nie wpuszczam", a nie „wpuszczam, bo baza milczy".
    seed({ jobRunner: "error", subscriptions: [sub()] });

    const res = await post({ secret: "sekret-z-bazy" });

    expect(res.status).toBe(401);
    expect(mail.sent).toEqual([]);
  });

  it("gdy sekret środowiskowy pasuje, baza NIE jest w ogóle pytana", async () => {
    // Ścieżka „szczęśliwa" nie może dokładać odczytu tabeli z sekretem przy
    // każdym uruchomieniu - to zbędna ekspozycja i zbędny round-trip.
    vi.stubEnv("BILLING_CRON_SECRET", SECRET);

    await run();

    expect(db.current!.chainsFor("job_runner_settings")).toHaveLength(0);
  });
});

// ===========================================================================
// LIMITER PO ADRESIE
// ===========================================================================
describe("limiter po adresie klienta (kubełek 10, dolewka 0,2/s)", () => {
  it("kubełek przepuszcza DOKŁADNIE 10 żądań, 11. dostaje 429 i nie rusza zadań", async () => {
    const ip = "10.90.0.1";
    for (let i = 0; i < 10; i += 1) {
      const res = await post({ secret: SECRET, ip });
      expect(res.status).toBe(200);
    }
    const before = db.current!.chainsFor("subscriptions").length;

    const res = await post({ secret: SECRET, ip });

    expect(res.status).toBe(429);
    expect(db.current!.chainsFor("subscriptions")).toHaveLength(before);
  });

  it("limiter działa PRZED sprawdzeniem sekretu - obcy ruch też zjada kubełek", async () => {
    // Świadomy zapis kontraktu, nie pochwała: dzięki temu odgadywanie sekretu
    // kosztuje, ale JEDNOCZEŚNIE zalew z adresu harmonogramu potrafi wypchnąć
    // legalne wywołanie na 429. Ta asercja pilnuje, żeby kolejność nie zmieniła
    // się przypadkiem.
    const ip = "10.90.0.2";
    for (let i = 0; i < 10; i += 1) await post({ secret: WRONG_SECRET, ip });

    const res = await post({ secret: SECRET, ip });

    expect(res.status).toBe(429);
  });

  it("inny adres ma WŁASNY kubełek", async () => {
    for (let i = 0; i < 11; i += 1) await post({ secret: SECRET, ip: "10.91.0.1" });

    const res = await post({ secret: SECRET, ip: "10.91.0.2" });

    expect(res.status).toBe(200);
  });

  it("żądanie BEZ nagłówka adresu wpada do wspólnego kubełka, nie omija limitu", async () => {
    for (let i = 0; i < 11; i += 1) {
      req.current = new Request("https://neweuropeanstrategies.com/api/public/billing-cron", {
        method: "POST",
        headers: { "x-billing-cron-secret": SECRET },
      });
      await handler({ request: req.current });
    }

    req.current = new Request("https://neweuropeanstrategies.com/api/public/billing-cron", {
      method: "POST",
      headers: { "x-billing-cron-secret": SECRET },
    });
    const res = await handler({ request: req.current });

    expect(res.status).toBe(429);
  });
});

// ===========================================================================
// PARAMETR `leadDays` - okno przypomnień
// ===========================================================================
describe("parametr leadDays wyznacza okno przypomnień", () => {
  /** Granice okna, jakie cron faktycznie wysłał do bazy. */
  function window(): { from: unknown; to: unknown } {
    const chain = db.current!.lastChain("subscriptions")!;
    return {
      from: chain.calls.find((c) => c.method === "gte")?.args[1],
      to: chain.calls.find((c) => c.method === "lt")?.args[1],
    };
  }

  it("bez ciała żądania okno to [teraz+3d, teraz+4d)", async () => {
    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ leadDays: 3 });
    expect(window()).toEqual({ from: iso(3), to: iso(4) });
  });

  it("`leadDays: 7` przesuwa okno o siedem dni", async () => {
    const res = await run({ body: { leadDays: 7 } });

    await expect(body(res)).resolves.toMatchObject({ leadDays: 7 });
    expect(window()).toEqual({ from: iso(7), to: iso(8) });
  });

  it.each([
    ["zero", 0],
    ["ujemne", -5],
    ["ponad 30", 31],
    ["ogromne", 100_000],
  ])("leadDays %s wraca do domyślnych 3 dni", async (_label, leadDays) => {
    const res = await run({ body: { leadDays } });

    await expect(body(res)).resolves.toMatchObject({ leadDays: 3 });
    expect(window()).toEqual({ from: iso(3), to: iso(4) });
  });

  it("leadDays jako NAPIS jest ignorowany - brak niejawnej konwersji typu", async () => {
    const res = await run({ body: { leadDays: "7" } });

    await expect(body(res)).resolves.toMatchObject({ leadDays: 3 });
  });

  it("leadDays ułamkowy jest zaokrąglany, nie obcinany", async () => {
    const res = await run({ body: { leadDays: 5.6 } });

    await expect(body(res)).resolves.toMatchObject({ leadDays: 6 });
  });

  it("USZKODZONE ciało nie wywraca cyklu - domyślne 3 dni i zadania biegną", async () => {
    seed({ subscriptions: [sub()] });

    const res = await run({ rawBody: "{to nie jest json" });

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ leadDays: 3 });
    expect(mail.sent).toHaveLength(1);
  });
});

// ===========================================================================
// ZADANIE 1: przypomnienia o odnowieniu / wygaśnięciu
// ===========================================================================
describe("zadanie 1: przypomnienia o cyklu subskrypcji", () => {
  it("subskrypcja AKTYWNA w oknie dostaje mail o ODNOWIENIU", async () => {
    seed({ subscriptions: [sub()] });

    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ renewal: 1, expiring: 0, skipped: 0 });
    expect(mail.sent).toEqual([
      {
        type: "subscription_renewal_reminder",
        to: "abonent@example.com",
        idempotencyKey: `subscription_renewal_reminder:sub_1:${iso(3).slice(0, 10)}`,
      },
    ]);
  });

  it("subskrypcja ANULOWANA dostaje mail o KOŃCU dostępu, nie o odnowieniu", async () => {
    // Zła gałąź tutaj to mail „odnowimy Ci subskrypcję" wysłany komuś, kto
    // właśnie zrezygnował - czyli komunikat wprowadzający w błąd co do umowy.
    seed({ subscriptions: [sub({ status: "canceled" })] });

    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ renewal: 0, expiring: 1 });
    expect(mail.sent[0]).toMatchObject({ type: "subscription_expiring" });
  });

  it("`cancel_at_period_end` też znaczy KONIEC, mimo statusu `active`", async () => {
    seed({ subscriptions: [sub({ cancel_at_period_end: true })] });

    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ expiring: 1 });
    expect(mail.sent[0]).toMatchObject({ type: "subscription_expiring" });
  });

  it("wiersz BEZ daty końca okresu jest pomijany, nie wysyła maila z pustą datą", async () => {
    seed({ subscriptions: [sub({ current_period_end: null })] });

    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ renewal: 0, expiring: 0, skipped: 1 });
    expect(mail.sent).toEqual([]);
  });

  it("AWARIA jednego rekordu nie przerywa przebiegu - pozostali dostają maile", async () => {
    // To jest reguła „fail-soft per rekord": jeden zepsuty plan nie może
    // zablokować przypomnień całej reszcie płacących klientów.
    seed({
      subscriptions: [
        sub({ price_id: "pro_monthly", provider_subscription_id: "sub_pro" }),
        sub({ price_id: "plus_monthly", provider_subscription_id: "sub_plus" }),
      ],
      planLookupFailsFor: ["pro"],
    });

    const res = await run();

    await expect(body(res)).resolves.toMatchObject({ renewal: 1, skipped: 1 });
    expect(mail.sent).toHaveLength(1);
  });

  it("brak profilu odbiorcy - mail NIE wychodzi, a cykl nadal kończy się sukcesem", async () => {
    seed({ subscriptions: [sub()], profile: false });

    const res = await run();

    expect(res.status).toBe(200);
    expect(mail.sent).toEqual([]);
    // Rekord jest jednak policzony jako obsłużony - `notifyReminderEmail` jest
    // fail-soft i nie zgłasza „nie miałem dokąd wysłać".
    await expect(body(res)).resolves.toMatchObject({ renewal: 1, skipped: 0 });
  });

  it("KLUCZ IDEMPOTENCJI wiąże subskrypcję z datą graniczną - powtórny bieg nie zdubluje maila", async () => {
    seed({ subscriptions: [sub()] });

    await run();
    await run();

    expect(mail.sent).toHaveLength(2);
    // Dostawca poczty odsiewa duplikaty po tym kluczu, więc MUSI być identyczny.
    expect(mail.sent[0]!.idempotencyKey).toBe(mail.sent[1]!.idempotencyKey);
  });

  it("zapytanie NIE filtruje po najemcy - harmonogram jest z założenia GLOBALNY", async () => {
    // Dlatego właśnie bramka sekretu jest jedyną obroną tego adresu: nie ma tu
    // izolacji najemcy, która ograniczyłaby skutki nieuprawnionego wywołania.
    await run();

    const chain = db.current!.lastChain("subscriptions")!;
    const filtered = chain.calls
      .filter((c) => c.method === "eq" || c.method === "in")
      .map((c) => c.args[0]);
    expect(filtered).not.toContain("tenant_id");
    expect(filtered).toContain("status");
  });

  it("pusta baza - cykl kończy się zerami zamiast błędem", async () => {
    const res = await run();

    await expect(body(res)).resolves.toMatchObject({
      ok: true,
      renewal: 0,
      expiring: 0,
      skipped: 0,
    });
  });
});

// ===========================================================================
// ZADANIE 2: przypomnienia o kończącej się karencji miejsc
// ===========================================================================
describe("zadanie 2: przypomnienia o karencji miejsc zespołowych", () => {
  it("miejsce z karencją kończącą się za 7 dni dostaje przypomnienie", async () => {
    seed({ seats: [seat({ grace_until: iso(7) })] });

    const res = await run();

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({
      checked: 1,
      sent: 1,
      days: [7, 1],
      perOrg: true,
    });
    expect(mail.sent).toEqual([
      {
        type: "team_seat_grace_reminder",
        to: "zespol@example.com",
        idempotencyKey: `team-seat-grace-reminder:seat-1:${iso(7)}:7`,
      },
    ]);
  });

  it("miejsce POZA progiem (5 dni) jest sprawdzone, ale bez maila", async () => {
    seed({ seats: [seat({ grace_until: iso(5) })] });

    const res = await run();

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({ checked: 1, sent: 0 });
    expect(mail.sent).toEqual([]);
  });

  it("progi Z KONFIGURACJI organizacji wygrywają z domyślnymi", async () => {
    seed({ seats: [seat({ grace_until: iso(5) })], orgReminderDays: [5] });

    const res = await run();

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({ sent: 1 });
  });

  it("`seatGraceReminderDays` z ciała NADPISUJE progi wszystkich organizacji", async () => {
    seed({ seats: [seat({ grace_until: iso(5) })] });

    const res = await run({ body: { seatGraceReminderDays: [5] } });

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({
      sent: 1,
      days: [5],
      perOrg: false,
    });
  });

  it("nadpisanie odsiewa elementy, które nie są liczbami", async () => {
    seed({ seats: [seat({ grace_until: iso(5) })] });

    const res = await run({ body: { seatGraceReminderDays: ["5", null, 5, {}] } });

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({
      days: [5],
      perOrg: false,
    });
  });

  it("PUSTA tablica progów jest ignorowana - wracają progi per organizacja", async () => {
    seed({ seats: [seat()] });

    const res = await run({ body: { seatGraceReminderDays: [] } });

    expect(section(await body(res), "seatGraceReminders")).toMatchObject({ perOrg: true, sent: 1 });
  });

  it("WYJĄTEK w zadaniu 2 jest połknięty, a odpowiedź niesie bezpieczną domyślkę", async () => {
    // Odmowa bazy zwraca `{error}` i zadanie samo się broni; padnięcie
    // TRANSPORTU rzuca wyjątkiem i broni go dopiero `.catch()` w handlerze.
    // To dwie różne ścieżki i obie muszą kończyć się tak samo: cykl leci dalej.
    seed({ subscriptions: [sub()], seats: "throw", expired: [] });

    const res = await run();

    expect(res.status).toBe(200);
    expect(section(await body(res), "seatGraceReminders")).toEqual({
      checked: 0,
      sent: 0,
      days: [],
      perOrg: true,
    });
    expect(mail.sent.map((m) => m.type)).toContain("subscription_renewal_reminder");
    expect(db.rpcCalls).toContain("org_expire_seat_grace");
  });

  it("AWARIA zapytania o miejsca nie wywraca cyklu ani nie blokuje pozostałych zadań", async () => {
    seed({ subscriptions: [sub()], seats: "error", expired: [] });

    const res = await run();

    expect(res.status).toBe(200);
    expect(section(await body(res), "seatGraceReminders")).toMatchObject({ checked: 0, sent: 0 });
    // Przypomnienia rozliczeniowe poszły mimo awarii sąsiedniego zadania.
    expect(mail.sent.map((m) => m.type)).toContain("subscription_renewal_reminder");
    // Wygaszenie karencji też zostało wywołane.
    expect(db.rpcCalls).toContain("org_expire_seat_grace");
  });
});

// ===========================================================================
// ZADANIE 3: wygaszenie karencji (odebranie dostępu)
// ===========================================================================
describe("zadanie 3: wygaszenie karencji miejsc", () => {
  it("RPC wygaszające jest wołane i jego wynik trafia do odpowiedzi", async () => {
    seed({
      expired: [
        { org_id: "org-1", seat_id: "seat-9", email: "byly@example.com" },
        { org_id: "org-1", seat_id: "seat-10", email: "byla@example.org" },
      ],
    });

    const res = await run();

    expect(db.rpcCalls).toEqual(["org_expire_seat_grace"]);
    expect(section(await body(res), "seatGrace")).toMatchObject({ expired: 2 });
  });

  it("wygaszone miejsca dostają mail o KOŃCU dostępu", async () => {
    seed({ expired: [{ org_id: "org-1", seat_id: "seat-9", email: "byly@example.com" }] });

    await run();

    expect(mail.sent).toEqual([
      expect.objectContaining({ type: "team_seat_access_ended", to: "byly@example.com" }),
    ]);
  });

  it("BŁĄD RPC (odmowa bazy) zeruje wynik zadania, ale nie wywraca cyklu", async () => {
    seed({ subscriptions: [sub()], expired: "error" });

    const res = await run();

    expect(res.status).toBe(200);
    expect(section(await body(res), "seatGrace")).toEqual({ expired: 0, notified: 0 });
    expect(mail.sent.map((m) => m.type)).toContain("subscription_renewal_reminder");
  });

  it("WYJĄTEK w RPC (padnięcie transportu) jest połknięty - pozostałe zadania kończą się", async () => {
    // `expireSeatGrace()` jest opakowane w `.catch()`, więc nawet twarde
    // padnięcie połączenia nie zabiera przypomnień rozliczeniowych.
    seed({ subscriptions: [sub()], seats: [seat()], expired: "throw" });

    const res = await run();

    expect(res.status).toBe(200);
    expect(section(await body(res), "seatGrace")).toEqual({ expired: 0, notified: 0 });
    expect(mail.sent.map((m) => m.type)).toEqual(
      expect.arrayContaining(["subscription_renewal_reminder", "team_seat_grace_reminder"]),
    );
  });

  it("KOLEJNOŚĆ: najpierw przypomnienie o karencji, dopiero potem jej wygaszenie", async () => {
    // Ta sama doba nie może wysłać „zostało Ci 1 dzień" i „dostęp wygasł" naraz.
    seed({ seats: [seat({ grace_until: iso(1) })], expired: [] });

    await run();

    expect(mail.sent[0]).toMatchObject({ type: "team_seat_grace_reminder" });
    expect(db.current!.chainsFor("organization_seats")).toHaveLength(1);
    expect(db.rpcCalls).toEqual(["org_expire_seat_grace"]);
  });
});

// ===========================================================================
// IZOLACJA ZADAŃ - jedno padnięte zadanie a reszta cyklu
// ===========================================================================
describe("izolacja zadań w cyklu", () => {
  /**
   * DEFEKT PRODUKCYJNY - test zapisany jako `it.fails`.
   *
   * CO JEST ZŁE. Handler opakowuje w `.catch()` DWA z trzech zadań
   * (`sendSeatGraceReminders`, `expireSeatGrace`), ale `runBillingReminders`
   * biegnie NAGO wewnątrz wspólnego `try`. Wystarczy, że odczyt subskrypcji
   * odmówi (timeout puli, `statement_timeout`, chwilowy brak połączenia) i
   * `loadDueSubscriptions` rzuca, wspólny `catch` zwraca `500 cron_failed`, a
   * dwa POZOSTAŁE zadania nie startują w ogóle.
   *
   * DLACZEGO TO RYZYKO. Harmonogram chodzi RAZ NA DOBĘ. Pominięte
   * `expireSeatGrace()` znaczy, że ludzie, którym karencja minęła, zachowują
   * dostęp do treści płatnych aż do następnej doby - a pominięte
   * `sendSeatGraceReminders()` znaczy, że próg „1 dzień do końca" przepada
   * bezpowrotnie (nazajutrz zostało już 0 dni i warunek `rowDays.includes(left)`
   * nie zadziała). Jedna sekundowa czkawka bazy kosztuje więc cichą utratę
   * całego dnia obsługi zespołów - i nikt tego nie zobaczy, bo cron „tylko"
   * zwrócił 500, które i tak zwraca przy każdej innej awarii.
   *
   * DLACZEGO NIE NAPRAWIAM. Poprawka jest jednolinijkowa
   * (`runBillingReminders(leadDays).catch(...)` z domyślką jak w sąsiadach),
   * ale zmienia KONTRAKT ODPOWIEDZI endpointu: dziś awaria przypomnień daje
   * 500, po poprawce dałaby 200 z wyzerowanymi licznikami. Zewnętrzny
   * scheduler może na tym 500 opierać alarmowanie i ponowienie, więc decyzja
   * „co ma znaczyć porażka cyklu" należy do właściciela modułu rozliczeń, nie
   * do pracy testowej. Zakres tej pracy to wyłącznie dopisanie testów.
   *
   * ASERCJA DOCELOWA: po padnięciu zadania 1 zadanie 3 (wygaszenie karencji)
   * i tak zostało wywołane.
   */
  it.fails("padnięcie przypomnień NIE POWINNO zabijać wygaszenia karencji", async () => {
    seed({ subscriptions: "error", seats: [seat()], expired: [] });

    await run();

    expect(db.rpcCalls).toContain("org_expire_seat_grace");
  });

  it("stan faktyczny: padnięcie przypomnień daje 500 i zatrzymuje cały cykl", async () => {
    // Kontrapunkt do `it.fails` wyżej - dokumentuje zachowanie, które JEST,
    // żeby przyszła poprawka musiała świadomie ruszyć również ten test.
    seed({ subscriptions: "error", seats: [seat()], expired: [] });

    const res = await run();

    expect(res.status).toBe(500);
    await expect(body(res)).resolves.toEqual({ error: "cron_failed" });
    expect(db.rpcCalls).toEqual([]);
    expect(db.current!.chainsFor("organization_seats")).toHaveLength(0);
    expect(mail.sent).toEqual([]);
  });

  it("wszystkie trzy zadania w jednym udanym przebiegu raportują się osobno", async () => {
    seed({
      subscriptions: [sub()],
      seats: [seat({ grace_until: iso(1) })],
      expired: [{ org_id: "org-2", seat_id: "seat-77", email: "koniec@example.org" }],
    });

    const payload = await body(await run());

    expect(payload).toMatchObject({ ok: true, renewal: 1 });
    expect(section(payload, "seatGraceReminders")).toMatchObject({ sent: 1 });
    expect(section(payload, "seatGrace")).toMatchObject({ expired: 1 });
    expect(mail.sent.map((m) => m.type).sort()).toEqual([
      "subscription_renewal_reminder",
      "team_seat_access_ended",
      "team_seat_grace_reminder",
    ]);
  });
});

// ===========================================================================
// KONTRAKT ODPOWIEDZI
// ===========================================================================
describe("kontrakt odpowiedzi", () => {
  it("odpowiedź jest JSON-em i NIE JEST cachowana", async () => {
    const res = await run();

    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("odmowa również nie jest cachowana", async () => {
    const res = await post({ secret: WRONG_SECRET });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("odpowiedź NIE zdradza adresów odbiorców ani treści maili", async () => {
    // Ciało odpowiedzi trafia do logów schedulera - nie ma tam miejsca na dane
    // osobowe. Dowodzimy, że po pełnym przebiegu z mailami w odpowiedzi zostają
    // wyłącznie liczniki.
    seed({
      subscriptions: [sub()],
      seats: [seat({ grace_until: iso(1) })],
      expired: [{ org_id: "org-2", seat_id: "seat-77", email: "koniec@example.org" }],
    });

    const res = await run();
    const text = await res.text();

    expect(mail.sent.length).toBeGreaterThan(0);
    expect(text).not.toContain("abonent@example.com");
    expect(text).not.toContain("zespol@example.com");
    expect(text).not.toContain("koniec@example.org");
    expect(text).not.toContain("@");
  });
});
