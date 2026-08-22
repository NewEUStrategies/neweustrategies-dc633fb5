// CO DOWODZI TEN PLIK
//
// Publiczny webhook `/api/public/hooks/refresh-og-image`
// (`src/routes/api/public/hooks.refresh-og-image.ts`) - do 22.08.2026 ZERO
// wykonanych linii, a to jedyna trasa w serwisie, która BEZ sesji użytkownika
// zapisuje do `profiles`. Dowodzone są cztery rzeczy o wysokiej konsekwencji:
//
//   1. ODMOWA PRZED JAKĄKOLWIEK PRACĄ. Brak `OG_REFRESH_SECRET` (endpoint
//      wyłączony) kończy się 501 BEZ odczytu ciała żądania i BEZ sięgnięcia po
//      klienta service-role. Asercja jest na LICZBIE wywołań atrap, nie na
//      samym kodzie odpowiedzi - „501, ale najpierw czytam ciało i otwieram
//      połączenie service-role" byłoby darmowym kanałem obciążania bazy z
//      internetu.
//   2. BRAMKA PODPISU. Każdy fałszywy podpis (zły hex, hex innej długości -
//      na których `timingSafeEqual` RZUCA, pusty napis, podpis innego sluga,
//      podpis z innego sekretu) to 401 i ZERO zapisu. Podpisy w teście liczy
//      PRAWDZIWY `createHmac`, więc test nie potwierdza własnego hexa.
//   3. BRAMKA CIAŁA przed bramką podpisu: nie-JSON, brak `slug`, `slug` pusty,
//      za długi albo ze znakami spoza `[a-z0-9-]` (`/`, spacja, `../`) dają 400
//      nawet z POPRAWNYM podpisem - czyli nie da się tą trasą przemycić
//      ścieżki ani wzorca do filtra.
//   4. KONTRAKT ODPOWIEDZI, na którym stoi wołający (CI / cron): 404 dla
//      nieistniejącego sluga, 500 z komunikatem bazy, 200 z `{ok, slug,
//      version}`, gdzie `version` pochodzi z `updated_at` WIERSZA (a przy jego
//      braku - z bieżącego czasu), oraz IDEMPOTENCJA: dwa identyczne żądania
//      to dwa `update` i ZERO `insert`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//
//   * `e2e/seo.spec.ts` - żaden z jego 15 testów nie dotyka tego endpointu
//     (bez sekretu i podpisu jest on dla e2e nieosiągalny). Sam SKUTEK bumpa,
//     czyli obecność i absolutność `og:image` w `<head>`, dowodzą tam bajtami
//     na żywym SSR testy `head contract on /`, `/en`, `/blog` i `/qa` - tutaj
//     nie ma ani `<head>`, ani SSR, ani jednego żądania sieciowego: handler
//     jest wołany wprost przez `routeServerHandlers`.
//   * `src/lib/seo/__tests__/ogImage.test.ts` - semantyka `ogVersionFromIso` i
//     `withOgVersion` (doklejanie `?v=`, no-op dla `data:` i URL z `?`). Tutaj
//     sprawdzana jest tylko LICZBA, którą webhook raportuje wołającemu.
//   * `src/routes/author.$slug.tsx` - użycie wersji w `head()` profilu autora.
//   * RLS i uprawnienia `profiles` - domena pgTAP; PostgREST jest tu atrapą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";

const stan = vi.hoisted(() => ({
  /**
   * Ile razy kod produkcyjny sięgnął po klienta service-role. Getter na
   * eksporcie atrapy, bo trasa robi `const { supabaseAdmin } = await
   * import(...)` DOPIERO po przejściu bramek - a właśnie „czy w ogóle sięgnął"
   * jest tu przedmiotem dowodu.
   */
  dostepyDoKlienta: 0,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    stan.dostepyDoKlienta += 1;
    return { from: db.from };
  },
}));

import { Route } from "@/routes/api/public/hooks.refresh-og-image";

const db = supabaseFromStub();

const SEKRET = "sekret-webhooka-og-2026";
const SLUG = "anna-kowalska";
const ADRES = "https://neweuropeanstrategies.com/api/public/hooks/refresh-og-image";

/** Prawdziwy HMAC-SHA256 nad slugiem - hexa nie zapisujemy ręcznie. */
function podpis(slug: string, sekret: string = SEKRET): string {
  return createHmac("sha256", sekret).update(slug).digest("hex");
}

/** Żądanie webhooka; `sygnatura: null` = brak nagłówka `x-og-signature`. */
function zadanie(cialo: string, sygnatura: string | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (sygnatura !== null) headers.set("x-og-signature", sygnatura);
  return new Request(ADRES, { method: "POST", headers, body: cialo });
}

function wyslij(request: Request): Promise<Response> {
  return routeServerHandlers(Route).POST({ request });
}

/** Żądanie poprawne pod każdym względem - punkt wyjścia dla ścieżki zdrowej. */
function poprawneZadanie(slug: string = SLUG): Request {
  return zadanie(JSON.stringify({ slug }), podpis(slug));
}

/** Łańcuch PostgREST dla `profiles` - z wyjaśnieniem, gdy trasa go nie tknęła. */
function lancuchProfili(): RecordedChain {
  const chain = db.lastChain("profiles");
  if (!chain) throw new Error("test: trasa nie dotknęła tabeli `profiles`");
  return chain;
}

let poprzedniSekret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  stan.dostepyDoKlienta = 0;
  poprzedniSekret = process.env.OG_REFRESH_SECRET;
  process.env.OG_REFRESH_SECRET = SEKRET;
  // Trasa czyta zegar dwa razy (`new Date().toISOString()` w zapisie i
  // `Date.now()` w spadku wersji), więc bez ustalonego czasu ani jedna asercja
  // na `updated_at`/`version` nie byłaby deterministyczna.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (poprzedniSekret === undefined) delete process.env.OG_REFRESH_SECRET;
  else process.env.OG_REFRESH_SECRET = poprzedniSekret;
});

describe("webhook refresh-og-image - odmowa przed pracą", () => {
  it("bez sekretu w env: 501, bez odczytu ciała i bez klienta service-role", async () => {
    delete process.env.OG_REFRESH_SECRET;
    const request = poprawneZadanie();
    const czytanieCiala = vi.spyOn(request, "text");

    const res = await wyslij(request);

    expect(res.status).toBe(501);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "OG_REFRESH_SECRET not configured" });
    // Sens „odmowy PRZED jakąkolwiek pracą": ładunek nie został nawet wczytany.
    expect(czytanieCiala).not.toHaveBeenCalled();
    expect(stan.dostepyDoKlienta).toBe(0);
    expect(db.chains).toHaveLength(0);
  });

  it("żądanie bez nagłówka podpisu: 401 i ZERO zapisu", async () => {
    const res = await wyslij(zadanie(JSON.stringify({ slug: SLUG }), null));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
    expect(stan.dostepyDoKlienta).toBe(0);
    expect(db.chains).toHaveLength(0);
  });
});

describe("webhook refresh-og-image - bramka podpisu", () => {
  it.each([
    ["zły hex poprawnej długości", "0".repeat(64)],
    // `timingSafeEqual` RZUCA na buforach różnej długości - stąd `ab.length
    // === bb.length` w kodzie. Bez tej gałęzi trasa oddawałaby 500 zamiast 401.
    ["hex o INNEJ długości", podpis(SLUG).slice(0, 32)],
    ["pusty napis", ""],
    ["napis, który nie jest hexem", "zzzz"],
    ["podpis INNEGO sluga", podpis("jan-nowak")],
    ["podpis z innego sekretu", podpis(SLUG, "podrobiony-sekret")],
  ])("%s -> 401 i zero zapisu", async (_opis, sygnatura) => {
    const res = await wyslij(zadanie(JSON.stringify({ slug: SLUG }), sygnatura));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
    expect(stan.dostepyDoKlienta).toBe(0);
    expect(db.chains).toHaveLength(0);
  });
});

describe("webhook refresh-og-image - bramka ciała", () => {
  it.each([
    ["ciało nie jest JSON-em", "to nie jest json"],
    ["JSON bez pola slug", JSON.stringify({ autor: SLUG })],
    ["slug pusty", JSON.stringify({ slug: "" })],
    ["slug dłuższy niż 120 znaków", JSON.stringify({ slug: "a".repeat(121) })],
    ["slug ze slashem", JSON.stringify({ slug: "anna/kowalska" })],
    ["slug ze spacją", JSON.stringify({ slug: "anna kowalska" })],
    ["slug z wyjściem w górę katalogu", JSON.stringify({ slug: "../sekret" })],
    ["JSON, który nie jest obiektem", "[]"],
    ["JSON null", "null"],
  ])("%s -> 400, nawet z POPRAWNYM podpisem sluga", async (_opis, cialo) => {
    // Podpis jest tu prawidłowy dla `SLUG`: dowodzimy, że walidacja ciała
    // wyprzedza bramkę podpisu i że żaden z tych ładunków nie dojdzie do filtra.
    const res = await wyslij(zadanie(cialo, podpis(SLUG)));

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(stan.dostepyDoKlienta).toBe(0);
    expect(db.chains).toHaveLength(0);
  });
});

describe("webhook refresh-og-image - kontrakt odpowiedzi", () => {
  it("sukces: 200, wersja z WIERSZA i zapis `updated_at` w ISO pod filtrem sluga", async () => {
    // `updated_at` z bazy jest CELOWO inne niż czas żądania: dowodzi, że
    // `version` czyta wiersz, a nie zegar procesu obsługującego żądanie.
    db.setResponse("profiles", ok({ id: "u-1", slug: SLUG, updated_at: "2026-01-15T08:00:00Z" }));

    const res = await wyslij(poprawneZadanie());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      slug: SLUG,
      version: Date.parse("2026-01-15T08:00:00Z"),
    });

    const chain = lancuchProfili();
    expect(stan.dostepyDoKlienta).toBe(1);
    // Zapis: dokładnie jedna kolumna, znacznik w ISO z ustalonego zegara.
    expect(chain.argsOf("update")).toEqual([{ updated_at: "2026-02-03T10:15:00.000Z" }]);
    expect(chain.argsOf("eq")).toEqual(["slug", SLUG]);
    expect(chain.argsOf("select")).toEqual(["id, slug, updated_at"]);
    expect(chain.has("maybeSingle")).toBe(true);
    // Nigdy `insert`: webhook odświeża istniejący profil, nie zakłada nowego.
    expect(chain.has("insert")).toBe(false);
  });

  it("brak `updated_at` w odpowiedzi bazy: wersja spada na bieżący czas", async () => {
    db.setResponse("profiles", ok({ id: "u-1", slug: SLUG, updated_at: null }));

    const res = await wyslij(poprawneZadanie());

    expect(res.status).toBe(200);
    // Ustalony zegar: 2026-02-03T10:15:00Z = 1770113700000.
    expect(await res.json()).toEqual({ ok: true, slug: SLUG, version: 1770113700000 });
  });

  it("nieistniejący slug: 404 (a nie ciche 200 z wersją z zegara)", async () => {
    db.setResponse("profiles", ok(null));

    const res = await wyslij(poprawneZadanie("nie-ma-takiego-autora"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    // Zapytanie POSZŁO - 404 jest wnioskiem z pustego wyniku, nie z bramki.
    expect(lancuchProfili().argsOf("eq")).toEqual(["slug", "nie-ma-takiego-autora"]);
  });

  it("błąd bazy: 500 z komunikatem PostgREST", async () => {
    db.setResponse("profiles", fail("permission denied for table profiles", "42501"));

    const res = await wyslij(poprawneZadanie());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "permission denied for table profiles" });
  });
});

describe("webhook refresh-og-image - idempotencja", () => {
  it("dwa identyczne żądania: dwa razy 200, dwa `update`, zero `insert`", async () => {
    // Ten sam podpis i to samo ciało - dokładnie tak wygląda ponowienie z CI
    // albo drugie kliknięcie w cronie. Wiersz jest jeden, więc drugie żądanie
    // nie może go zduplikować; nowa `version` bierze się WYŁĄCZNIE z
    // `updated_at` oddanego przez bazę.
    const znaczniki = ["2026-02-03T10:15:00.000Z", "2026-02-03T11:30:00.000Z"];
    let nr = 0;
    db.setResponse("profiles", () => {
      const updated_at = znaczniki[Math.min(nr, znaczniki.length - 1)];
      nr += 1;
      return ok({ id: "u-1", slug: SLUG, updated_at });
    });

    const pierwsza = await wyslij(poprawneZadanie());
    const druga = await wyslij(poprawneZadanie());

    expect([pierwsza.status, druga.status]).toEqual([200, 200]);
    const wersje = [await pierwsza.json(), await druga.json()].map(
      (body: { version: number }) => body.version,
    );
    expect(wersje).toEqual([Date.parse(znaczniki[0]), Date.parse(znaczniki[1])]);
    expect(wersje[1]).toBeGreaterThan(wersje[0]);

    const lancuchy = db.chainsFor("profiles");
    expect(lancuchy).toHaveLength(2);
    expect(lancuchy.every((c) => c.has("update"))).toBe(true);
    expect(lancuchy.some((c) => c.has("insert"))).toBe(false);
    expect(stan.dostepyDoKlienta).toBe(2);
  });
});
