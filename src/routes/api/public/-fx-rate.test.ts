// Publiczny kurs EUR/PLN: GET + POST /api/public/fx-rate.
//
// PO CO TEN PLIK ISTNIEJE. Ten endpoint oddaje LICZBĘ, przez którą mnożymy
// kwoty pokazywane w cenniku i w kasie. Do 31.08.2026 stał na zerze (0% linii,
// 0 z 5 funkcji), więc żadna z jego czterech decyzji nie była dotknięta testem:
//   1. GET jest publiczny, ale limitowany (30/min per adres) i FAIL-OPEN -
//      blip bazy nie może zablokować kasy;
//   2. POST (wymuszone odświeżenie) jest ADMIN-ONLY i limitowany FAIL-CLOSED -
//      tu odmowa jest pożądana, bo POST wypycha ruch na zewnętrzne API NBP;
//   3. gdy dostawca kursu (NBP) nie odpowiada albo oddaje śmieci, endpoint MUSI
//      zachować ostatni znany kurs i oznaczyć go jako nieświeży - NIGDY nie
//      wolno mu oddać zera, NaN-a ani wartości z odpowiedzi, której nie
//      zrozumiał;
//   4. nagłówki cache muszą być KRÓTSZE, gdy kurs nie jest świeży, inaczej CDN
//      utrwaliłby awaryjną wartość na sześć godzin.
//
// JAK ASERTUJEMY. `GET` oddaje `200` także wtedy, gdy NBP jest niedostępne, więc
// kod odpowiedzi nie odróżnia „mam świeży kurs" od „dostawca padł". Dowody
// opierają się więc na SKUTKU: jaka liczba trafiła do `eurPln`, jakie `status`
// i `stale`, ile razy poszedł fetch do dostawcy, jaki `Cache-Control` dostał CDN.
//
// GRANICE, KTÓRE ATRAPUJEMY: `fetch` (dostawca kursu NBP), klient Supabase
// (licznik limitu) i konstruktor klienta `@supabase/supabase-js` (weryfikacja
// tokenu i roli). PRAWDZIWE zostają: moduł kursu `@/lib/billing/fxRate` z całym
// retry/backoffem i TTL, limiter `rate-limit.server` z jego trybami fail-open /
// fail-closed oraz `RateLimitError`. To one są przedmiotem dowodu.
//
// ZERO SIECI: `fetch` jest podmieniony w bloku `vi.hoisted`, czyli PRZED
// importem modułu kursu - a ten na starcie (w środowisku z `window`) sam
// rozgrzewa cache. Bez tej kolejności suita wychodziłaby do api.nbp.pl.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- granica 1: dostawca kursu ---------------------------------------------

type NbpMode =
  | "ok"
  | "http-500"
  | "http-404"
  | "network-down"
  | "html-instead-of-json"
  | "empty-rates"
  | "mid-not-a-number"
  | "mid-zero"
  | "mid-negative";

const nbp = vi.hoisted(() => {
  const state = {
    mode: "ok" as NbpMode,
    mid: 4.2789,
    effectiveDate: "2026-08-31",
    /** Ile razy kod produkcyjny realnie poszedł do dostawcy. */
    calls: 0,
    urls: [] as string[],
  };

  const impl: typeof fetch = (input) => {
    state.calls += 1;
    state.urls.push(input instanceof Request ? input.url : String(input));
    const json = (payload: unknown, status = 200): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    switch (state.mode) {
      case "http-500":
        return Promise.resolve(new Response("", { status: 500 }));
      case "http-404":
        return Promise.resolve(new Response("", { status: 404 }));
      case "network-down":
        return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
      case "html-instead-of-json":
        // Typowa awaria u dostawcy: strona błędu operatora zamiast JSON-a.
        return Promise.resolve(
          new Response("<html><body>503 Service Unavailable</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
        );
      case "empty-rates":
        return json({ table: "A", rates: [] });
      case "mid-not-a-number":
        return json({ rates: [{ mid: "4,2789", effectiveDate: state.effectiveDate }] });
      case "mid-zero":
        return json({ rates: [{ mid: 0, effectiveDate: state.effectiveDate }] });
      case "mid-negative":
        return json({ rates: [{ mid: -4.2789, effectiveDate: state.effectiveDate }] });
      default:
        return json({
          table: "A",
          currency: "euro",
          code: "EUR",
          rates: [{ no: "168/A/NBP/2026", effectiveDate: state.effectiveDate, mid: state.mid }],
        });
    }
  };

  globalThis.fetch = impl;
  return state;
});

// --- granica 2: licznik limitu (service role) -------------------------------

const limiter = vi.hoisted(() => ({
  /**
   * `allow` = przepuść, `deny` = odmów, `error` = licznik oddaje błąd
   * PostgREST, `throw` = padnięcie transportu (klient rzuca wyjątkiem, np. gdy
   * brakuje konfiguracji połączenia). Dwie ostatnie ścieżki są RÓŻNE i kod
   * traktuje je inaczej - stąd osobne warianty.
   */
  outcome: "allow" as "allow" | "deny" | "error" | "throw",
  calls: [] as { scope: unknown; subject: unknown; max: unknown; window: unknown }[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== "rate_limit_hit") {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
      }
      limiter.calls.push({
        scope: args._scope,
        subject: args._subject,
        max: args._max,
        window: args._window_minutes,
      });
      if (limiter.outcome === "throw") throw new Error("rate_limits transport died");
      if (limiter.outcome === "error") {
        return Promise.resolve({ data: null, error: { message: "rate_limits unavailable" } });
      }
      return Promise.resolve({
        data: [{ allowed: limiter.outcome === "allow" }],
        error: null,
      });
    },
  },
}));

// --- granica 3: weryfikacja tokenu i roli (klient anon z bearerem) ----------

const session = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  userError: null as { message: string } | null,
  /** Wynik `has_role(_user_id, 'admin')` - świadomie `unknown`, bo RPC bywa `null`. */
  isAdmin: true as unknown,
  /** Nagłówki, z jakimi zbudowano klienta - dowód, że token trafia do weryfikacji. */
  clientHeaders: [] as unknown[],
  roleCalls: [] as { fn: string; args: unknown }[],
  getUserTokens: [] as unknown[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: unknown, _key: unknown, options: { global?: { headers?: unknown } }) => {
    session.clientHeaders.push(options?.global?.headers);
    return {
      auth: {
        getUser: (token: unknown) => {
          session.getUserTokens.push(token);
          return Promise.resolve({
            data: { user: session.userError ? null : session.user },
            error: session.userError,
          });
        },
      },
      rpc: (fn: string, args: unknown) => {
        session.roleCalls.push({ fn, args });
        return Promise.resolve({ data: session.isAdmin, error: null });
      },
    };
  },
}));

import { getFxState, setEurPlnRateForTests, ensureFxRateLoaded } from "@/lib/billing/fxRate";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/fx-rate";

const handlers = routeServerHandlers(Route);
const GET = handlers.GET!;
const POST = handlers.POST!;

/**
 * Moduł kursu rozgrzewa się SAM przy imporcie (w środowisku z `window`).
 * Domykamy ten lot tutaj, zanim ruszy pierwszy test - inaczej jego rozwiązanie
 * wpadłoby w środek losowego przypadku i nadpisało stan modułu.
 */
await ensureFxRateLoaded();

/** Kotwica z modułu kursu - wartość, którą oddajemy, dopóki NBP nie odpowie. */
const ANCHOR_EUR_PLN = 4.3257;
const NOW = new Date("2026-08-31T12:00:00.000Z");

// --- pomocnicy --------------------------------------------------------------

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://neweuropeanstrategies.com${path}`, { method: "GET", headers });
}

/**
 * Wywołanie handlera z DOMKNIĘCIEM backoffu. Nieudany fetch uruchamia w module
 * kursu sekwencję 250 ms / 750 ms / 2 s; bez przewinięcia zegara test wisiałby
 * trzy sekundy na każdym przypadku awarii dostawcy (a przy zamrożonym czasie -
 * w nieskończoność).
 */
async function call(handler: typeof GET, req: Request): Promise<Response> {
  const pending = handler({ request: req });
  await vi.advanceTimersByTimeAsync(3_500);
  return pending;
}

function get(
  path = "/api/public/fx-rate",
  headers: Record<string, string> = {},
): Promise<Response> {
  return call(GET, request(path, headers));
}

function post(headers: Record<string, string> = {}): Promise<Response> {
  return call(
    POST,
    new Request("https://neweuropeanstrategies.com/api/public/fx-rate", {
      method: "POST",
      headers,
    }),
  );
}

async function body(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed !== null && typeof parsed === "object" ? { ...parsed } : {};
}

/** Nagłówek autoryzacji z syntetycznym tokenem - NIGDY prawdziwym sekretem. */
const BEARER = { authorization: "Bearer syntetyczny.token.testowy" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  nbp.mode = "ok";
  nbp.mid = 4.2789;
  nbp.effectiveDate = "2026-08-31";
  nbp.calls = 0;
  nbp.urls.length = 0;
  limiter.outcome = "allow";
  limiter.calls.length = 0;
  session.user = { id: "11111111-1111-4111-8111-111111111111" };
  session.userError = null;
  session.isAdmin = true;
  session.clientHeaders.length = 0;
  session.roleCalls.length = 0;
  session.getUserTokens.length = 0;
  // Stan modułu kursu wraca do „kurs nie pochodzi z NBP" (źródło `override`),
  // dzięki czemu KAŻDY test startuje z niewygasłego cache i sam decyduje, czy
  // dostawca odpowie. To jedyny publiczny reset, jaki moduł udostępnia.
  setEurPlnRateForTests(ANCHOR_EUR_PLN);
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// GET - kurs dostępny
// ===========================================================================
describe("GET: kurs dostępny u dostawcy", () => {
  it("oddaje kurs z NBP, datę obowiązywania i status `ok`", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({
      status: "ok",
      eurPln: 4.2789,
      effectiveDate: "2026-08-31",
      source: "nbp",
      lastError: null,
      lastAttempts: 1,
      stale: false,
    });
  });

  it("pyta DOKŁADNIE tabelę A NBP dla EUR - nie dowolny adres z żądania", async () => {
    await get("/api/public/fx-rate?source=https://zly.example.org/kurs");

    expect(nbp.calls).toBe(1);
    expect(nbp.urls).toEqual(["https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json"]);
  });

  it("świeży kurs dostaje DŁUGI cache publiczny (30 min klient / 6 h CDN)", async () => {
    const res = await get();

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=1800, s-maxage=21600");
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("znaczniki czasu są ISO albo `null` - ciało jest serializowalne bez straty", async () => {
    const payload = await body(await get());

    expect(payload.fetchedAt).toBe(NOW.toISOString());
    expect(payload.lastSuccessAt).toBe(NOW.toISOString());
  });

  it("ZIMNY start: brak znacznika czasu serializuje się jako `null`, nie jako epoka 1970", async () => {
    // `fetchedAt`/`lastSuccessAt` to epoch w milisekundach, a `0` znaczy
    // „jeszcze nic". Bez strażnika `? ... : null` klient dostałby datę
    // 1970-01-01 i wyświetliłby ją jako prawdziwy moment pobrania kursu.
    // Handler wołamy BEZ przewijania zegara - udany fetch nie potrzebuje
    // żadnego timera, więc czas zostaje na zerze.
    vi.setSystemTime(new Date(0));
    setEurPlnRateForTests(ANCHOR_EUR_PLN);

    const payload = await body(await GET({ request: request("/api/public/fx-rate") }));

    expect(payload).toMatchObject({ status: "ok", eurPln: 4.2789 });
    expect(payload.fetchedAt).toBeNull();
    expect(payload.lastSuccessAt).toBeNull();
  });

  it("endpoint zna WYŁĄCZNIE parę EUR/PLN - `?currency=USD` niczego nie zmienia", async () => {
    // Nie ma tu obsługi innych walut i nie wolno jej udawać: kwoty w kasie są
    // przeliczane tylko między PLN a EUR. Żądanie o walutę spoza tej pary ma
    // dostać ten sam ładunek, a nie kurs, którego nikt nie pobrał.
    const domyslny = await body(await get());
    const zWalutą = await body(await get("/api/public/fx-rate?currency=USD&to=CHF"));

    expect(Object.keys(zWalutą).sort()).toEqual(Object.keys(domyslny).sort());
    expect(zWalutą).toMatchObject({ eurPln: 4.2789, source: "nbp" });
    expect(Object.keys(zWalutą)).not.toContain("usdPln");
  });
});

// ===========================================================================
// GET - dostawca niedostępny albo zwraca śmieci
// ===========================================================================
describe("GET: awaria dostawcy kursu", () => {
  it.each<[string, NbpMode]>([
    ["sieć nie odpowiada", "network-down"],
    ["HTTP 500", "http-500"],
    ["HTTP 404", "http-404"],
  ])("%s - zachowujemy ostatni znany kurs zamiast oddać zero", async (_label, mode) => {
    nbp.mode = mode;

    const payload = await body(await get());

    expect(payload).toMatchObject({ eurPln: ANCHOR_EUR_PLN, status: "fallback" });
    expect(payload.eurPln).not.toBe(0);
    expect(payload.lastError).toEqual(expect.any(String));
  });

  it.each<[string, NbpMode]>([
    ["HTML zamiast JSON-a", "html-instead-of-json"],
    ["pusta tablica kursów", "empty-rates"],
    ["`mid` jako napis", "mid-not-a-number"],
    ["`mid` równy zero", "mid-zero"],
    ["`mid` ujemny", "mid-negative"],
  ])("dostawca oddaje ŚMIECI (%s) - wartość NIE jest przyjmowana", async (_label, mode) => {
    // Najgroźniejsza gałąź całego modułu: przyjęty `0`, `NaN` albo `"4,2789"`
    // przeliczyłby ceny w kasie na bezsens (albo na zero) i pobrał od klienta
    // złą kwotę. Odmowa przyjęcia jest tu ważniejsza niż świeżość.
    nbp.mode = mode;

    const payload = await body(await get());

    expect(payload.eurPln).toBe(ANCHOR_EUR_PLN);
    expect(payload.source).not.toBe("nbp");
    expect(Number.isFinite(Number(payload.eurPln))).toBe(true);
    expect(Number(payload.eurPln)).toBeGreaterThan(0);
  });

  it("po awarii cache publiczny jest KRÓTKI - CDN nie utrwala złego stanu na 6 h", async () => {
    nbp.mode = "network-down";

    const res = await get();

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
  });

  it("moduł ponawia 4 razy (1 próba + 3 backoffy), a nie w nieskończoność", async () => {
    nbp.mode = "network-down";

    const payload = await body(await get());

    expect(nbp.calls).toBe(4);
    expect(payload.lastAttempts).toBe(4);
  });

  it("odzyskanie dostawcy po awarii wraca do statusu `ok` bez restartu procesu", async () => {
    nbp.mode = "network-down";
    await get();

    nbp.mode = "ok";
    nbp.mid = 4.4;
    const payload = await body(await get());

    expect(payload).toMatchObject({ status: "ok", eurPln: 4.4, lastError: null });
  });

  it("kurs POBRANY wcześniej, a potem przeterminowany i niepobieralny, jest `stale`", async () => {
    // To jest scenariusz produkcyjny „NBP leży od rana": mamy wczorajszy kurs,
    // wolno go dalej podawać, ale konsument MUSI wiedzieć, że jest nieświeży.
    await get();
    expect(getFxState().source).toBe("nbp");

    vi.setSystemTime(new Date(NOW.getTime() + 7 * 60 * 60 * 1000));
    nbp.mode = "network-down";
    const res = await get();
    const payload = await body(res);

    expect(payload).toMatchObject({ status: "stale", source: "nbp", eurPln: 4.2789, stale: true });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
  });
});

// ===========================================================================
// GET - cache i deduplikacja
// ===========================================================================
describe("GET: cache modułu (TTL 6 h) i deduplikacja lotów", () => {
  it("drugie żądanie w oknie TTL NIE puka do dostawcy", async () => {
    await get();
    expect(nbp.calls).toBe(1);

    const payload = await body(await get());

    expect(nbp.calls).toBe(1);
    expect(payload).toMatchObject({ status: "ok", eurPln: 4.2789 });
  });

  it("po upływie TTL (6 h) żądanie odświeża kurs", async () => {
    await get();
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 60 * 1000 + 1000));
    nbp.mid = 4.5;

    const payload = await body(await get());

    expect(nbp.calls).toBe(2);
    expect(payload).toMatchObject({ eurPln: 4.5 });
  });

  it("cache jest wspólny dla GET i dla wymuszenia - po POST kolejny GET nie fetchuje", async () => {
    await post(BEARER);
    expect(nbp.calls).toBe(1);

    const payload = await body(await get());

    expect(nbp.calls).toBe(1);
    expect(payload).toMatchObject({ status: "ok", eurPln: 4.2789 });
  });

  // NIEPOKRYTE ŚWIADOMIE: deduplikacja DWÓCH RÓWNOLEGŁYCH żądań (`inflight`
  // w `@/lib/billing/fxRate`). Wymagałaby dwóch jednoczesnych wywołań handlera,
  // a w tej wersji vitest równoległy `await import()` atrapowanego modułu
  // (`rate-limit.server` sięga tak po klienta bazy) oddaje modułowi PRAWDZIWY
  // klient - test padałby na ograniczeniu harnessu, nie na kodzie. Sama
  // deduplikacja jest własnością modułu kursu, nie tej trasy.
});

// ===========================================================================
// GET - limiter (fail-open)
// ===========================================================================
describe("GET: limit 30/min per adres, świadomie FAIL-OPEN", () => {
  /** Podmiot policzony TĄ SAMĄ funkcją, której używa kod produkcyjny. */
  const podmiot = (headers: Record<string, string>): string =>
    requestRateSubject(new Headers(headers));

  it("limit liczony jest per ADRES, w zakresie `fx-rate:get`, 30 na minutę", async () => {
    await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.7" });

    expect(limiter.calls).toEqual([
      {
        scope: "fx-rate:get",
        subject: podmiot({ "x-forwarded-for": "203.0.113.7" }),
        max: 30,
        window: 1,
      },
    ]);
  });

  it("kubełek ROZRÓŻNIA dzwoniących, choć nie zapisuje ich adresów", async () => {
    // Sedno rozdziału kubełków: dwa różne adresy dostają dwa różne podmioty,
    // a ten sam adres - ten sam podmiot. Skrót jest deterministyczny, więc
    // limit działa tak samo jak przy surowym adresie.
    await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.7" });
    await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.8" });
    await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.7" });

    expect(limiter.calls[0]?.subject).not.toEqual(limiter.calls[1]?.subject);
    expect(limiter.calls[2]?.subject).toEqual(limiter.calls[0]?.subject);
  });

  it("pierwszy wpis `x-forwarded-for` wygrywa nad łańcuchem proxy", async () => {
    await get("/api/public/fx-rate", { "x-forwarded-for": " 203.0.113.9 , 10.0.0.1 , 10.0.0.2" });

    expect(limiter.calls[0]).toMatchObject({
      subject: podmiot({ "x-forwarded-for": "203.0.113.9" }),
    });
  });

  it("bez `x-forwarded-for` bierzemy `cf-connecting-ip`", async () => {
    await get("/api/public/fx-rate", { "cf-connecting-ip": "198.51.100.4" });

    expect(limiter.calls[0]).toMatchObject({
      subject: podmiot({ "cf-connecting-ip": "198.51.100.4" }),
    });
  });

  it("`cf-connecting-ip` WYGRYWA z `x-forwarded-for`, bo tego klient nie podrobi", async () => {
    // Zmiana świadoma wraz z przejściem na `requestRateSubject`: za Cloudflare
    // `x-forwarded-for` jest nagłówkiem od klienta, więc jego pierwszeństwo
    // dawałoby darmowe obejście limitu przez podstawienie dowolnego adresu.
    await get("/api/public/fx-rate", {
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "203.0.113.7",
    });

    expect(limiter.calls[0]).toMatchObject({
      subject: podmiot({ "cf-connecting-ip": "198.51.100.4" }),
    });
  });

  it("bez żadnego nagłówka adresu wpadamy do WSPÓLNEGO kubełka `unknown`", async () => {
    // Brak adresu nie może być obejściem limitu - lepszy wspólny kubełek niż
    // darmowy kanał do NBP przez nasz serwer.
    await get();

    expect(limiter.calls[0]).toMatchObject({ subject: podmiot({}) });
    expect(limiter.calls[0]?.subject).toBe(requestRateSubject(new Headers()));
  });

  it("PRZEKROCZONY limit oddaje 429, nie rusza dostawcy i nie jest cachowany", async () => {
    limiter.outcome = "deny";

    const res = await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.10" });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(body(res)).resolves.toMatchObject({ status: "rate_limited" });
    // Najważniejszy skutek: odmowa NIE wygenerowała ruchu do NBP.
    expect(nbp.calls).toBe(0);
  });

  it("AWARIA licznika PRZEPUSZCZA żądanie - kasa nie może paść przez blip liczników", async () => {
    limiter.outcome = "error";

    const res = await get();

    expect(res.status).toBe(200);
    await expect(body(res)).resolves.toMatchObject({ status: "ok", eurPln: 4.2789 });
  });

  it("licznik, który RZUCA (a nie oddaje błędu), NIE jest łapany - to inna ścieżka niż fail-open", async () => {
    // Rozróżnienie warte testu: „fail-open" w `rate-limit.server` dotyczy
    // wyłącznie odpowiedzi z polem `error`. Wyjątek z samego klienta (np. brak
    // konfiguracji połączenia w izolacie) przechodzi przez handler nietknięty,
    // bo `GET` nie ma własnego `try`. Ten test przypina stan faktyczny, żeby
    // ewentualna zmiana obudowy była decyzją, a nie skutkiem ubocznym.
    limiter.outcome = "throw";

    await expect(GET({ request: request("/api/public/fx-rate") })).rejects.toThrow(
      "rate_limits transport died",
    );
    expect(nbp.calls).toBe(0);
  });

  /**
   * DEFEKT NAPRAWIONY 31.08.2026 (`src/routes/api/public/fx-rate.ts`).
   *
   * CO BYŁO ZŁE. `GET` przekazywał do licznika SUROWY adres IP jako
   * `subjectId`, a licznik zapisuje go do tabeli `rate_limits`. Tymczasem repo
   * ma na dokładnie ten przypadek osobny moduł `@/lib/server/rateSubject.server`
   * z komentarzem otwierającym: „`rate_limits` nie jest miejscem na dane
   * osobowe: wyciek tej tabeli nie może dać listy adresów IP". Publiczna
   * ścieżka darowizn tego modułu używała (`requestRateSubject`), publiczna
   * ścieżka kursu - nie.
   *
   * JAKIE TO BYŁO RYZYKO. Adres IP jest daną osobową w rozumieniu RODO. Tabela
   * `rate_limits` stawała się przez to rejestrem „kto i kiedy odwiedzał
   * cennik", o nieokreślonym okresie retencji i bez podstawy w rejestrze
   * czynności. To ryzyko zgodnościowe, a nie estetyka: ta sama tabela dla
   * innych zakresów trzymała już wyłącznie solone skróty, więc audyt zobaczyłby
   * niespójność.
   *
   * JAK ZOSTAŁO NAPRAWIONE. `subjectId` liczy `requestRateSubject(headers)` -
   * ta sama funkcja, co na pozostałych publicznych bramkach. Kubełek nadal
   * jest per dzwoniący (skrót jest deterministyczny), zmienia się wyłącznie to,
   * co ląduje w tabeli. Skutek wdrożeniowy jest znany i opisany przy kodzie:
   * klucz kubełka się zmienia, więc istniejące liczniki `fx-rate:get`
   * przestają pasować - przy oknie jednej minuty to jedno okno bez limitu,
   * a stare wiersze wygasają same.
   */
  it("podmiot limitu NIE niesie surowego adresu IP", async () => {
    await get("/api/public/fx-rate", { "x-forwarded-for": "203.0.113.55" });

    expect(String(limiter.calls[0]?.subject)).not.toContain("203.0.113.55");
    // Prefiks rodzaju zostaje jawny, żeby dało się czytać metryki zakresu -
    // to jest kontrakt `requestRateSubject`, nie przypadek.
    expect(String(limiter.calls[0]?.subject)).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("ciało odpowiedzi NIE zawiera adresu klienta ani nagłówków żądania", async () => {
    const res = await get("/api/public/fx-rate", {
      "x-forwarded-for": "203.0.113.77",
      "user-agent": "syntetyczny-klient/1.0",
    });
    const text = await res.text();

    expect(text).not.toContain("203.0.113.77");
    expect(text).not.toContain("syntetyczny-klient");
  });
});

// ===========================================================================
// POST - wymuszone odświeżenie: autoryzacja i odmowa
// ===========================================================================
describe("POST: wymuszone odświeżenie jest ADMIN-ONLY", () => {
  it("BRAK nagłówka autoryzacji - 401 i zero ruchu do dostawcy", async () => {
    const res = await post();

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toMatchObject({ status: "unauthorized" });
    expect(nbp.calls).toBe(0);
    expect(session.clientHeaders).toEqual([]);
  });

  it.each([
    ["schemat Basic", "Basic YWRtaW46YWRtaW4="],
    ["goły token bez schematu", "syntetyczny.token.testowy"],
    ["samo słowo Bearer", "Bearer"],
    ["Bearer z pustą wartością", "Bearer   "],
  ])("%s nie jest tokenem - 401 i zero ruchu do dostawcy", async (_label, header) => {
    const res = await post({ authorization: header });

    expect(res.status).toBe(401);
    expect(nbp.calls).toBe(0);
  });

  it("schemat `bearer` małymi literami JEST akceptowany (nagłówki są bezwzględne)", async () => {
    const res = await post({ authorization: "bearer syntetyczny.token.testowy" });

    expect(res.status).toBe(200);
    expect(session.getUserTokens).toEqual(["syntetyczny.token.testowy"]);
  });

  it("NIEWAŻNA sesja (token odrzucony przez weryfikację) - 401", async () => {
    session.userError = { message: "invalid JWT" };

    const res = await post(BEARER);

    expect(res.status).toBe(401);
    await expect(body(res)).resolves.toMatchObject({ status: "unauthorized" });
    expect(nbp.calls).toBe(0);
  });

  it("token bez użytkownika (anon) - 401", async () => {
    session.user = null;

    const res = await post(BEARER);

    expect(res.status).toBe(401);
    expect(nbp.calls).toBe(0);
  });

  it("token trafia do klienta W NAGŁÓWKU, a rola jest sprawdzana przez `has_role`", async () => {
    // Dowód, że weryfikacja idzie przez PODPISANY token, a nie przez treść
    // przesłaną przez klienta: identyfikator do `has_role` bierzemy z wyniku
    // `getUser`, nie z ciała żądania.
    await post(BEARER);

    expect(session.clientHeaders).toEqual([{ Authorization: "Bearer syntetyczny.token.testowy" }]);
    expect(session.roleCalls).toEqual([
      {
        fn: "has_role",
        args: { _user_id: "11111111-1111-4111-8111-111111111111", _role: "admin" },
      },
    ]);
  });

  it("zalogowany BEZ roli admina - 403 i zero ruchu do dostawcy", async () => {
    session.isAdmin = false;

    const res = await post(BEARER);

    expect(res.status).toBe(403);
    await expect(body(res)).resolves.toMatchObject({ status: "forbidden" });
    expect(nbp.calls).toBe(0);
  });

  it.each([
    ["null z RPC", null],
    ["undefined z RPC", undefined],
    ["napis 'true'", "true"],
    ["jedynka", 1],
  ])("odpowiedź roli %s NIE jest traktowana jak `true` - 403", async (_label, value) => {
    // `isAdmin !== true` to porównanie ścisłe i to jest tu regułą: `1` albo
    // `"true"` z bazy nie może otwierać ścieżki administracyjnej.
    session.isAdmin = value;

    const res = await post(BEARER);

    expect(res.status).toBe(403);
    expect(nbp.calls).toBe(0);
  });
});

// ===========================================================================
// POST - limiter (fail-closed) i skutek odświeżenia
// ===========================================================================
describe("POST: limit 6/min per admin, świadomie FAIL-CLOSED", () => {
  it("limit liczony jest per UŻYTKOWNIK w zakresie `fx-rate:force`", async () => {
    await post(BEARER);

    expect(limiter.calls).toEqual([
      {
        scope: "fx-rate:force",
        subject: requestRateSubject(null, "11111111-1111-4111-8111-111111111111"),
        max: 6,
        window: 1,
      },
    ]);
  });

  it("podmiot limitu POST też nie niesie surowego identyfikatora konta", async () => {
    // Ta sama reguła, co w GET, i ten sam moduł: `rate_limits` nie ma trzymać
    // ani adresów, ani identyfikatorów kont. Kubełek pozostaje per konto -
    // liczy się rozróżnialność, nie czytelność wpisu.
    await post(BEARER);

    expect(String(limiter.calls[0]?.subject)).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(String(limiter.calls[0]?.subject)).toMatch(/^user:[0-9a-f]{32}$/);
  });

  it("PRZEKROCZONY limit oddaje 429 i NIE puka do dostawcy", async () => {
    limiter.outcome = "deny";

    const res = await post(BEARER);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(nbp.calls).toBe(0);
  });

  it("AWARIA licznika ODMAWIA - odwrotnie niż GET, bo POST kosztuje ruch u dostawcy", async () => {
    // To jest cała różnica między dwiema bramkami tego pliku i dlatego ma
    // własny test: GET przy padniętym liczniku przepuszcza (kasa ma działać),
    // POST przy padniętym liczniku odmawia (nie wolno stracić limitu na
    // wymuszony ruch do NBP).
    limiter.outcome = "error";

    const res = await post(BEARER);

    expect(res.status).toBe(429);
    await expect(body(res)).resolves.toMatchObject({ status: "rate_limited" });
    expect(nbp.calls).toBe(0);
  });

  it("błąd INNY niż limit nie jest przebierany za 429 - leci do wołającego", async () => {
    // Handler zamienia na `429` wyłącznie `RateLimitError`. Każdy inny wyjątek
    // ma polecieć dalej: udawanie „przekroczono limit" przy awarii infrastruktury
    // wysyłałoby administratora na ślepy tor diagnostyczny.
    limiter.outcome = "throw";

    await expect(
      POST({
        request: new Request("https://neweuropeanstrategies.com/api/public/fx-rate", {
          method: "POST",
          headers: BEARER,
        }),
      }),
    ).rejects.toThrow("rate_limits transport died");
    expect(nbp.calls).toBe(0);
  });

  it("odświeżenie OMIJA cache modułu - to jest cały sens tego przycisku", async () => {
    await get();
    expect(nbp.calls).toBe(1);
    nbp.mid = 4.61;

    const payload = await body(await post(BEARER));

    expect(nbp.calls).toBe(2);
    expect(payload).toMatchObject({ status: "ok", eurPln: 4.61 });
  });

  it("odpowiedź POST nigdy nie jest cachowana", async () => {
    const res = await post(BEARER);

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("odświeżenie przy PADNIĘTYM dostawcy oddaje `fallback` i zachowuje ostatni kurs", async () => {
    await get();
    nbp.mode = "network-down";

    const payload = await body(await post(BEARER));

    expect(payload).toMatchObject({ status: "fallback", eurPln: 4.2789, source: "nbp" });
    expect(payload.lastError).toEqual(expect.any(String));
  });

  it("odświeżenie przy ŚMIECIACH od dostawcy nie podmienia kursu", async () => {
    await get();
    nbp.mode = "mid-not-a-number";

    const payload = await body(await post(BEARER));

    expect(payload).toMatchObject({ eurPln: 4.2789, status: "fallback" });
  });
});
