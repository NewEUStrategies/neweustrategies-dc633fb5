// Monitor linkow wychodzacych: co redakcja zobaczy w panelu jako "martwy
// przypis", i kiedy w ogole dostanie o tym powiadomienie.
//
// CO TO DOWODZI. Ten skan decyduje o wiarygodnosci przypisow w opublikowanych
// analizach - a jego wynik jest dla czlowieka NIEWERYFIKOWALNY (nikt nie
// klika 50 odnosnikow, zeby sprawdzic monitor). Dlatego sprawdzam tu skutki,
// nie wywolania:
//   * czym rozni sie "link padl" od "monitor nie chcial/nie mogl sprawdzic":
//     404/500 to martwy link, 403/429/999 to zywy-ale-bramkowany, przekroczony
//     czas to brak statusu, a bramka egress w ogole nie wypuszcza zapytania;
//   * ze przekierowanie NIE jest sledzone (`redirect: "manual"`), czyli petla
//     przekierowan jest niemozliwa z konstrukcji, a nie z licznika skokow;
//   * ze martwy link dostaje GOTOWY adres migawki Internet Archive (redakcja
//     ma podmienic przypis, nie usuwac go), z rozroznieniem "pytalismy i nie
//     ma migawki" od "nie pytalismy wcale" (limit odpytan na porcje);
//   * ze pusta kolejka wpisow i BLAD odczytu kolejki to dwa rozne wyniki -
//     zero zamiast wyjatku znaczyloby, ze awaria bazy wyglada jak "wszystko
//     sprawdzone, nic do roboty";
//   * ze alert progowy odzywa sie do adminow tenanta raz, a awaria samego
//     alertu nie uniewaznia skanu, ktory juz sie wykonal.
// Zegar jest ustalony, bo do bazy ida znaczniki czasu (`checked_at`,
// `archive_checked_at`, `outbound_links_checked_at`) i granica rotacji
// (`outbound_links_checked_at.lt.<data>`) - test ma dowodzic tresci filtra,
// a nie tego, ze dwa wywolania `new Date()` daly tyle samo.
//
// CZEGO SWIADOMIE NIE DUBLUJE.
//   * czystej polityki alertu i parsowania odpowiedzi archive.org
//     (`shouldAlertBrokenLinks`, `parseWaybackAvailability`,
//     `waybackAvailabilityUrl`, histereza, cooldown) - to ma wlasny plik
//     `src/lib/content/__tests__/brokenLinkPolicy.test.ts`; tutaj sprawdzam
//     wylacznie to, co skan z tych decyzji ROBI z danymi;
//   * polityki bramki SSRF - `assertPublicHttpUrl` ma
//     `src/lib/http/__tests__/egressGuard.test.ts`. Tu chodzi PRAWDZIWA bramka
//     (z podmienionym `node:dns/promises`, wiec bez ruchu do resolvera), bo
//     interesuje mnie jedno: ze jej odmowa zatrzymuje sonde PRZED `fetch`.
//     Podmiana samej bramki byla tu pulapka: `probe` wciaga ja DYNAMICZNIE
//     z pieciu sond naraz, a przy takim wyscigu podmiana modulu obejmuje
//     dokladnie JEDNO wywolanie - pozostale cztery wchodzily w prawdziwy
//     modul i robily prawdziwe zapytania DNS (test milczal, bo prawdziwa
//     bramka po prostu odrzucala adresy testowe). Atrapa na poziomie
//     `node:dns/promises` jest importem statycznym, wiec tego wyscigu nie ma;
//   * kadencji joba (co ile minut leci porcja i jaki ma budzet) - to
//     `everyNthMinute` i `src/lib/server/__tests__/jobsTickDutyCycle.test.ts`;
//   * uprawnien: `runLinkCheckBatch` nie jest server fn i nie ma wlasnej
//     kontroli dostepu - dostaje z gory klienta service-role, bo kolumny
//     `posts.content_*` sa dla klientow odciete. Wolajacym jest jobs-tick
//     (cron) oraz panel `admin.link-monitor` przez `linkMonitor.functions.ts`
//     za middleware - i tam nalezy dowod autoryzacji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  fail,
  ok,
  okCount,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  fetchMock: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
  /** Atrapa resolwera DNS - jedyne wyjscie prawdziwej bramki egress do systemu. */
  lookup: vi.fn<(host: string, options: { all: true }) => Promise<Array<{ address: string }>>>(),
}));

vi.mock("node:dns/promises", () => ({ default: { lookup: h.lookup } }));

import { extractExternalUrls, runLinkCheckBatch } from "@/lib/server/linkCheck.server";

const TENANT = "tenant-1";
const POST = "post-1";
const NOW = "2026-08-21T10:00:00.000Z";
/** 7 dni wstecz - granica rotacji z `RECHECK_AFTER_DAYS`. */
const DUE_BEFORE = "2026-08-14T10:00:00.000Z";
const OWN = ["neweuropeanstrategies.com", "www.neweuropeanstrategies.com", "localhost"] as const;
const ARCHIVE_PREFIX = "https://archive.org/wayback/available";
const DEAD = "https://obcy.test/raport-2019.pdf";

/** Powierzchnia klienta service-role, ktorej dotyka ten modul. */
interface FromSurface {
  from: (table: string) => unknown;
}

/**
 * STRAZNIK, nie rzutowanie: `as unknown as SupabaseClient` przepuscilby atrape
 * bez ogniwa `from`, czyli test "zdalby" tam, gdzie kod nie mialby czym
 * wykonac zapytania.
 */
function isDbClient(candidate: FromSurface): candidate is FromSurface & SupabaseClient<Database> {
  return typeof candidate.from === "function";
}

function adminClient(stub: SupabaseFromStub): SupabaseClient<Database> {
  const candidate: FromSurface = { from: stub.from };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniwa from()");
  return candidate;
}

/** Wpis w kolejce skanu - tylko kolumny, ktore kod naprawde czyta. */
interface QueuePost {
  id: string;
  tenant_id: string;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
}

function post(overrides: Partial<QueuePost> = {}): QueuePost {
  return {
    id: POST,
    tenant_id: TENANT,
    content_pl: null,
    content_en: null,
    builder_data: null,
    blocks_data: null,
    ...overrides,
  };
}

/** Wiersz raportu, jaki kod upsertuje do `outbound_link_checks`. */
interface CheckRow {
  tenant_id: string;
  post_id: string;
  url: string;
  ok: boolean;
  status_code: number | null;
  error: string | null;
  checked_at: string;
  archive_url: string | null;
  archive_timestamp: string | null;
  archive_checked_at: string | null;
}

function isCheckRow(value: unknown): value is CheckRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "post_id" in value &&
    typeof value.post_id === "string"
  );
}

function isCheckRows(value: unknown): value is CheckRow[] {
  return Array.isArray(value) && value.every(isCheckRow);
}

/**
 * Wszystkie wiersze upsertowane w tej porcji. Sklejam WSZYSTKIE lancuchy
 * upsertu, bo kod zapisuje raport falami po `CONCURRENCY` linkow - czytanie
 * tylko pierwszej fali ukrywaloby zachowanie na dalszych (m.in. limit odpytan
 * archiwum).
 */
function upsertedRows(stub: SupabaseFromStub): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const chain of stub.chainsFor("outbound_link_checks")) {
    if (!chain.has("upsert")) continue;
    const payload = chain.argsOf("upsert")?.[0];
    if (!isCheckRows(payload)) throw new Error("test: upsert raportu w nieznanym ksztalcie");
    rows.push(...payload);
  }
  if (rows.length === 0) throw new Error("test: kod nie upsertowal zadnego wiersza raportu");
  return rows;
}

function rowFor(stub: SupabaseFromStub, url: string): CheckRow {
  const row = upsertedRows(stub).find((r) => r.url === url);
  if (!row) throw new Error(`test: brak wiersza raportu dla ${url}`);
  return row;
}

/* --------------------------- atrapy sieci ------------------------------- */

interface FetchPlan {
  probe?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  archive?: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

function snapshotResponse(): Response {
  return new Response(
    JSON.stringify({
      archived_snapshots: {
        closest: {
          available: true,
          url: "http://web.archive.org/web/20190101120000/https://obcy.test/raport-2019.pdf",
          timestamp: "20190101120000",
        },
      },
    }),
    { status: 200, headers: new Headers({ "content-type": "application/json" }) },
  );
}

/** Odpowiedz "nie mam migawki" - PUSTY obiekt, nie blad. */
function noSnapshotResponse(_url?: string, _init?: RequestInit): Response {
  return new Response(JSON.stringify({ archived_snapshots: {} }), { status: 200 });
}

function routeFetch(plan: FetchPlan = {}): void {
  h.fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith(ARCHIVE_PREFIX)) {
      return (plan.archive ?? noSnapshotResponse)(input, init);
    }
    return (plan.probe ?? (() => new Response(null, { status: 200 })))(input, init);
  });
}

/** Ile razy kod odpytal archive.org (a nie sam link). */
function archiveCalls(): string[] {
  return h.fetchMock.mock.calls
    .map(([input]) => input)
    .filter((url) => url.startsWith(ARCHIVE_PREFIX));
}

function probeCalls(): string[] {
  return h.fetchMock.mock.calls
    .map(([input]) => input)
    .filter((url) => !url.startsWith(ARCHIVE_PREFIX));
}

/* ------------------------- plan bazy danych ---------------------------- */

interface DbPlan {
  queue?: SupabaseResult;
  upsertChecks?: SupabaseResult;
  brokenTotal?: SupabaseResult;
  alertState?: SupabaseResult;
  admins?: SupabaseResult;
  onUserRoles?: () => never;
}

let db: SupabaseFromStub;
let warn: ReturnType<typeof vi.spyOn>;

function planDb(plan: DbPlan = {}): void {
  db.setResponse("posts", (chain: RecordedChain) =>
    chain.has("update") ? ok(null) : (plan.queue ?? ok([post()])),
  );
  db.setResponse("outbound_link_checks", (chain: RecordedChain) => {
    if (chain.has("upsert")) return plan.upsertChecks ?? ok(null);
    if (chain.has("delete")) return ok(null);
    return plan.brokenTotal ?? okCount(0);
  });
  db.setResponse("outbound_link_alerts", (chain: RecordedChain) =>
    chain.has("select") ? (plan.alertState ?? ok(null)) : ok(null),
  );
  db.setResponse("user_roles", () => {
    if (plan.onUserRoles) plan.onUserRoles();
    return plan.admins ?? ok([]);
  });
  db.setResponse("notifications", () => ok(null));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal("fetch", h.fetchMock);
  db = supabaseFromStub();
  h.fetchMock.mockReset();
  h.lookup.mockReset();
  // Kazdy host testowy rozwiazuje sie na publiczny adres - inaczej prawdziwa
  // bramka odrzucilaby go jako niesprawdzalny (`blocked_url:dns`) i test
  // "sprawdzilby" cos innego, niz zamierza.
  h.lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
  routeFetch();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ======================================================================= */

describe("warunki wstepne testu", () => {
  it("kazda sonda przechodzi przez atrape resolwera - suita nie rusza DNS ani sieci", async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `https://obcy-${i}.test/a`);
    planDb({ queue: ok([post({ content_pl: urls.join(" ") })]) });

    await runLinkCheckBatch(adminClient(db));

    expect(h.lookup.mock.calls.map(([host]) => host)).toEqual([
      "obcy-0.test",
      "obcy-1.test",
      "obcy-2.test",
      "obcy-3.test",
      "obcy-4.test",
    ]);
    expect(probeCalls()).toHaveLength(5);
  });
});

describe("extractExternalUrls - co w ogole idzie do sprawdzenia", () => {
  it("adresy wlasnego serwisu i jego subdomen nie sa linkami wychodzacymi", () => {
    const parts = [
      "https://neweuropeanstrategies.com/analizy/x",
      "https://www.neweuropeanstrategies.com/y",
      "https://panel.neweuropeanstrategies.com/z",
      "http://localhost:3000/dev",
      "https://obcy.test/artykul",
    ].join(" ");

    expect(extractExternalUrls([parts], OWN)).toEqual(["https://obcy.test/artykul"]);
  });

  it("mailto: i tel: nie sa linkami do sprawdzenia", () => {
    expect(
      extractExternalUrls(['<a href="mailto:biuro@obcy.test">mail</a> tel:+48221234567'], OWN),
    ).toEqual([]);
  });

  it("adres skladniowo niepoprawny jest odrzucany, nie sondowany", () => {
    expect(extractExternalUrls(["zobacz https://[niepoprawny-host"], OWN)).toEqual([]);
  });

  it("obcina ogonek interpunkcyjny i encje HTML z konca adresu", () => {
    expect(
      extractExternalUrls(["Zobacz https://obcy.test/raport. Oraz https://obcy.test/b&amp;x"], OWN),
    ).toEqual(["https://obcy.test/raport", "https://obcy.test/b"]);
  });

  it("ten sam adres w wersji PL i EN liczy sie raz", () => {
    expect(extractExternalUrls([DEAD, `<p>${DEAD}</p>`, null, undefined, ""], OWN)).toEqual([DEAD]);
  });

  it("na jeden wpis bierze najwyzej 50 linkow", () => {
    const many = Array.from({ length: 60 }, (_, i) => `https://obcy.test/a-${i}`).join(" ");

    expect(extractExternalUrls([many], OWN)).toHaveLength(50);
  });

  it("brak tresci to pusta lista, nie wyjatek", () => {
    expect(extractExternalUrls([null, undefined, ""], OWN)).toEqual([]);
  });
});

describe("runLinkCheckBatch - kolejka wpisow", () => {
  it("PUSTA kolejka: zero wpisow to zero ruchu HTTP i zero dalszych zapytan", async () => {
    planDb({ queue: ok([]) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(result).toEqual({
      postsScanned: 0,
      linksChecked: 0,
      broken: 0,
      archived: 0,
      alerted: 0,
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(db.chains).toHaveLength(1);
  });

  it("BLAD odczytu kolejki konczy sie wyjatkiem, nie cichym zerem", async () => {
    planDb({ queue: fail("permission denied for table posts", "42501") });

    await expect(runLinkCheckBatch(adminClient(db))).rejects.toThrow(
      "permission denied for table posts",
    );
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(db.chainsFor("outbound_link_checks")).toEqual([]);
  });

  it("PUSTKA jako null (a nie pusta lista) tez znaczy 'nie ma czego skanowac'", async () => {
    planDb({ queue: ok(null) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(result).toMatchObject({ postsScanned: 0, linksChecked: 0 });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("kolejka pyta o wpisy opublikowane, nieusuniete i najdawniej sprawdzone", async () => {
    planDb({ queue: ok([]) });

    await runLinkCheckBatch(adminClient(db), 6);

    const chain = db.lastChain("posts");
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("or")).toEqual([
      `outbound_links_checked_at.is.null,outbound_links_checked_at.lt.${DUE_BEFORE}`,
    ]);
    expect(chain?.argsOf("order")).toEqual([
      "outbound_links_checked_at",
      { ascending: true, nullsFirst: true },
    ]);
    expect(chain?.argsOf("limit")).toEqual([6]);
  });

  it("wpis bez linkow zewnetrznych czysci swoj raport w calosci i nie sonduje niczego", async () => {
    planDb({ queue: ok([post({ content_pl: "<p>Tekst bez odnosnikow</p>" })]) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ postsScanned: 1, linksChecked: 0, broken: 0 });
    const del = db.chainsFor("outbound_link_checks").find((c) => c.has("delete"));
    expect(del?.argsOf("eq")).toEqual(["post_id", POST]);
    expect(del?.has("not")).toBe(false);
    expect(
      db
        .chainsFor("posts")
        .find((c) => c.has("update"))
        ?.argsOf("update"),
    ).toEqual([{ outbound_links_checked_at: NOW }]);
  });

  it("linki czyta ze wszystkich silnikow tresci (PL, EN, builder, bloki)", async () => {
    planDb({
      queue: ok([
        post({
          content_pl: "https://obcy.test/pl",
          content_en: "https://obcy.test/en",
          builder_data: { src: "https://obcy.test/builder" },
          blocks_data: [{ href: "https://obcy.test/bloki" }],
        }),
      ]),
    });

    await runLinkCheckBatch(adminClient(db));

    expect(probeCalls().sort()).toEqual([
      "https://obcy.test/bloki",
      "https://obcy.test/builder",
      "https://obcy.test/en",
      "https://obcy.test/pl",
    ]);
  });
});

describe("runLinkCheckBatch - stan pojedynczego linku", () => {
  const withLink = (url = DEAD) => ({
    queue: ok([post({ content_pl: `<a href="${url}">x</a>` })]),
  });

  it("200: link zywy, bez adresu migawki i BEZ odpytania archive.org", async () => {
    planDb(withLink());
    routeFetch({ probe: () => new Response(null, { status: 200 }) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toEqual({
      tenant_id: TENANT,
      post_id: POST,
      url: DEAD,
      ok: true,
      status_code: 200,
      error: null,
      checked_at: NOW,
      archive_url: null,
      archive_timestamp: null,
      archive_checked_at: null,
    });
    expect(archiveCalls()).toEqual([]);
    expect(result).toMatchObject({ linksChecked: 1, broken: 0, archived: 0 });
  });

  it("sonda idzie GET-em z naglowkiem monitora - nie HEAD-em (403/405 dawaloby falszywy alarm)", async () => {
    planDb(withLink());

    await runLinkCheckBatch(adminClient(db));

    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(DEAD);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toEqual({
      "User-Agent": "NES-LinkMonitor/1.0 (+https://neweuropeanstrategies.com)",
    });
  });

  it("404: martwy link dostaje gotowy adres migawki Internet Archive", async () => {
    planDb(withLink());
    routeFetch({
      probe: () => new Response(null, { status: 404 }),
      archive: () => snapshotResponse(),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: 404,
      error: null,
      archive_url: "https://web.archive.org/web/20190101120000/https://obcy.test/raport-2019.pdf",
      archive_timestamp: "20190101120000",
      archive_checked_at: NOW,
    });
    expect(archiveCalls()).toEqual([`${ARCHIVE_PREFIX}?url=${encodeURIComponent(DEAD)}`]);
    expect(result).toMatchObject({ broken: 1, archived: 1 });
  });

  it("500 na serwerze zrodla to tez martwy link", async () => {
    planDb(withLink());
    routeFetch({ probe: () => new Response(null, { status: 500 }) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({ ok: false, status_code: 500 });
    expect(result.broken).toBe(1);
  });

  it("403 i 429 to 'zywy, ale bramkowany' - bez alarmu i bez szukania migawki", async () => {
    for (const status of [403, 429, 999]) {
      db = supabaseFromStub();
      h.fetchMock.mockReset();
      planDb(withLink());
      routeFetch({ probe: () => new Response(null, { status }) });

      const result = await runLinkCheckBatch(adminClient(db));

      expect(rowFor(db, DEAD)).toMatchObject({ ok: true, status_code: status });
      expect(archiveCalls()).toEqual([]);
      expect(result.broken).toBe(0);
    }
  });

  it("301 nie jest sledzone: jedno zapytanie, link liczy sie jako istniejacy", async () => {
    planDb(withLink());
    routeFetch({
      probe: () =>
        new Response(null, {
          status: 301,
          headers: new Headers({ location: "https://obcy.test/nowy" }),
        }),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(probeCalls()).toEqual([DEAD]);
    expect(rowFor(db, DEAD)).toMatchObject({ ok: true, status_code: 301 });
    expect(result.broken).toBe(0);
  });

  it("PETLA PRZEKIEROWAN jest niemozliwa z konstrukcji: 302 na siebie to jedno zapytanie", async () => {
    planDb(withLink());
    routeFetch({
      probe: (url) => new Response(null, { status: 302, headers: new Headers({ location: url }) }),
    });

    await runLinkCheckBatch(adminClient(db));

    expect(probeCalls()).toHaveLength(1);
    expect(rowFor(db, DEAD)).toMatchObject({ ok: true, status_code: 302 });
  });

  it("TIMEOUT po 6 s: brak statusu i powod przerwania, a nie 'link martwy z kodem'", async () => {
    planDb(withLink());
    routeFetch({
      probe: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
      archive: () => noSnapshotResponse(),
    });

    const running = runLinkCheckBatch(adminClient(db));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(db.chainsFor("outbound_link_checks").some((c) => c.has("upsert"))).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await running;

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: null,
      error: "This operation was aborted",
    });
    expect(result.broken).toBe(1);
  });

  it("blad sieci (DNS/TLS) zapisuje sie z komunikatem, bez statusu", async () => {
    planDb(withLink());
    routeFetch({
      probe: () => Promise.reject(new Error("getaddrinfo ENOTFOUND obcy.test")),
      archive: () => noSnapshotResponse(),
    });

    await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: null,
      error: "getaddrinfo ENOTFOUND obcy.test",
    });
  });

  it("wyjatek, ktory nie jest bledem (goly tekst), zapisuje sie jako tresc powodu", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({
      probe: () => Promise.reject("zerwane polaczenie"),
      archive: () => noSnapshotResponse(),
    });

    await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: null,
      error: "zerwane polaczenie",
    });
  });

  it("adres wewnetrzny nie dostaje ANI JEDNEGO zapytania - bramka odmawia przed sonda", async () => {
    const metadata = "https://169.254.169.254/latest/meta-data";
    const internal = "https://panel.internal/admin";
    planDb({ queue: ok([post({ content_pl: `${metadata} ${internal}` })]) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(probeCalls()).toEqual([]);
    expect(rowFor(db, metadata)).toMatchObject({
      ok: false,
      status_code: null,
      error: "blocked_url:ip",
    });
    expect(rowFor(db, internal)).toMatchObject({
      ok: false,
      status_code: null,
      error: "blocked_url:host",
    });
    expect(result.broken).toBe(2);
  });

  it("nierozwiazywalny host konczy sie odmowa (fail-closed), nie proba polaczenia", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    h.lookup.mockRejectedValue(new Error("queryA ENOTFOUND obcy.test"));

    await runLinkCheckBatch(adminClient(db));

    expect(probeCalls()).toEqual([]);
    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: null,
      error: "blocked_url:dns",
    });
  });

  it.fails("link, ktorego monitor ODMOWIL sprawdzic, nie dostaje sugestii podmiany", async () => {
    // DEFEKT (zglaszany, nie naprawiany): src/lib/server/linkCheck.server.ts.
    // Mechanizm: `probe` (linie 63-96) zwraca `ok: false, status: null` DLA
    // OBU rozlacznych przypadkow - "cel odpowiedzial bledem" i "my nie
    // wyslalismy zapytania" (bramka egress odrzuca KAZDY adres http://,
    // linie 72-74 + egressGuard.server.ts:76, bo wymaga https). Dalej `runLinkCheckBatch`
    // (linie 234-246) traktuje kazde `!ok` jednakowo: odpytuje archive.org
    // i zapisuje `archive_url`.
    // Konsekwencja dla uzytkownika: przypis http:// - w archiwalnych analizach
    // najzwyklejszy - trafia do panelu jako martwy z gotowa podpowiedzia
    // "podmien na migawke z 2019 r.", choc adres dziala. Redakcja podmienia
    // zywy przypis na kopie z archiwum i traci aktualne zrodlo, a licznik
    // `broken` (i alert progowy) liczy zdarzenia, ktorych nie bylo.
    // Dlaczego to decyzja czlowieka: trzeba wybrac polityke - probowac
    // https:// dla adresow http:// (zmiana zachowania sondy), czy zapisywac
    // trzeci stan "nie sprawdzono" (zmiana schematu i panelu). Jedno i drugie
    // wykracza poza test.
    const insecure = "http://obcy.test/raport-2009.pdf";
    planDb({ queue: ok([post({ content_pl: insecure })]) });
    routeFetch({ archive: () => snapshotResponse() });

    await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, insecure).archive_url).toBeNull();
  });
});

describe("runLinkCheckBatch - migawki archiwum", () => {
  const twenty = () =>
    ok([
      post({
        content_pl: Array.from({ length: 20 }, (_, i) => `https://obcy.test/d-${i}`).join(" "),
      }),
    ]);

  it("brak migawki: 'pytalismy i nie ma' zapisuje sie inaczej niz 'nie pytalismy'", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({ probe: () => new Response(null, { status: 404 }), archive: noSnapshotResponse });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      archive_url: null,
      archive_timestamp: null,
      // Pytanie BYLO - stad znacznik. Wiersz bez znacznika znaczy "nie pytano".
      archive_checked_at: NOW,
    });
    expect(result.archived).toBe(0);
  });

  it("awaria archive.org nie wywraca skanu ani nie gubi wyniku sondy", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({
      probe: () => new Response(null, { status: 404 }),
      archive: () => Promise.reject(new Error("archive.org 503")),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({ ok: false, status_code: 404, archive_url: null });
    expect(result).toMatchObject({ broken: 1, archived: 0, postsScanned: 1 });
  });

  it("odpowiedz archive.org z bledem HTTP daje brak migawki, nie wyjatek", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({
      probe: () => new Response(null, { status: 404 }),
      archive: () => new Response(null, { status: 429 }),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD).archive_url).toBeNull();
    expect(result.archived).toBe(0);
  });

  it("zawieszone archive.org jest przerywane po 4 s - krocej niz sonda linku", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({
      probe: () => new Response(null, { status: 404 }),
      archive: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });

    const running = runLinkCheckBatch(adminClient(db));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(db.chainsFor("outbound_link_checks").some((c) => c.has("upsert"))).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await running;

    // Skan nie ginie: wynik sondy jest zapisany, brakuje tylko podpowiedzi.
    // Znacznik jest o 4 s pozniejszy niz `NOW`, bo tyle wlasnie trwalo
    // czekanie na archiwum - to ta sama nieruchoma os czasu, tylko przesunieta
    // limitem, ktorego test dowodzi.
    expect(rowFor(db, DEAD)).toMatchObject({
      ok: false,
      status_code: 404,
      archive_url: null,
      archive_checked_at: "2026-08-21T10:00:04.000Z",
    });
    expect(result).toMatchObject({ broken: 1, archived: 0 });
  });

  it("na porcje idzie najwyzej 15 odpytan archiwum - reszte dobierze kolejny skan", async () => {
    planDb({ queue: twenty() });
    routeFetch({ probe: () => new Response(null, { status: 404 }), archive: snapshotResponse });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(archiveCalls()).toHaveLength(15);
    expect(result).toMatchObject({ broken: 20, archived: 15 });
    const withoutLookup = upsertedRows(db).filter((r) => r.archive_checked_at === null);
    expect(withoutLookup.length).toBeGreaterThan(0);
    expect(withoutLookup.every((r) => r.archive_url === null)).toBe(true);
  });

  it("link, ktory wrocil do zycia, traci adres migawki", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });
    routeFetch({ probe: () => new Response(null, { status: 200 }), archive: snapshotResponse });

    await runLinkCheckBatch(adminClient(db));

    expect(rowFor(db, DEAD)).toMatchObject({
      ok: true,
      archive_url: null,
      archive_timestamp: null,
      archive_checked_at: null,
    });
  });
});

describe("runLinkCheckBatch - zapis raportu", () => {
  it("raport jest upsertowany po parze (post_id, url) - jeden wiersz na link", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });

    await runLinkCheckBatch(adminClient(db));

    const chain = db.chainsFor("outbound_link_checks").find((c) => c.has("upsert"));
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "post_id,url" });
  });

  it("linki usuniete z tresci znikaja z raportu przy kolejnym skanie", async () => {
    planDb({ queue: ok([post({ content_pl: DEAD })]) });

    await runLinkCheckBatch(adminClient(db));

    const del = db.chainsFor("outbound_link_checks").find((c) => c.has("delete"));
    expect(del?.argsOf("eq")).toEqual(["post_id", POST]);
    expect(del?.argsOf("not")).toEqual(["url", "in", `("${DEAD}")`]);
  });

  it("nieudany upsert raportu nie wywraca skanu - znacznik wpisu i tak sie zapisuje", async () => {
    planDb({
      queue: ok([post({ content_pl: DEAD })]),
      upsertChecks: fail("deadlock detected", "40P01"),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(warn).toHaveBeenCalledWith("[link-monitor] upsert failed", "deadlock detected");
    expect(result).toMatchObject({ postsScanned: 1, linksChecked: 1 });
    expect(db.chainsFor("posts").some((c) => c.has("update"))).toBe(true);
  });
});

describe("runLinkCheckBatch - alert progowy dla redakcji", () => {
  const oneDead = () => ({ queue: ok([post({ content_pl: DEAD })]) });

  it("ponizej progu nikt nie jest powiadamiany", async () => {
    planDb({ ...oneDead(), brokenTotal: okCount(3) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(db.chainsFor("notifications")).toEqual([]);
    expect(db.chainsFor("user_roles")).toEqual([]);
    expect(result.alerted).toBe(0);
  });

  it("pierwsze przekroczenie progu powiadamia adminow tenanta i zapisuje watermark", async () => {
    planDb({
      ...oneDead(),
      brokenTotal: okCount(12),
      alertState: ok(null),
      admins: ok([{ user_id: "admin-1" }, { user_id: "admin-2" }]),
    });
    routeFetch({ probe: () => new Response(null, { status: 404 }), archive: noSnapshotResponse });

    const result = await runLinkCheckBatch(adminClient(db));

    const insert = db.chainsFor("notifications").find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toEqual([
      expect.objectContaining({
        user_id: "admin-1",
        tenant_id: TENANT,
        kind: "seo",
        href: "/admin/link-monitor",
      }),
      expect.objectContaining({ user_id: "admin-2" }),
    ]);
    const upsert = db.chainsFor("outbound_link_alerts").find((c) => c.has("upsert"));
    expect(upsert?.argsOf("upsert")).toEqual([
      { tenant_id: TENANT, broken_count: 12, notified_at: NOW },
      { onConflict: "tenant_id" },
    ]);
    expect(result.alerted).toBe(1);
  });

  it("ten sam admin w dwoch rolach dostaje jedno powiadomienie", async () => {
    planDb({
      ...oneDead(),
      brokenTotal: okCount(12),
      admins: ok([{ user_id: "admin-1" }, { user_id: "admin-1" }]),
    });

    await runLinkCheckBatch(adminClient(db));

    const insert = db.chainsFor("notifications").find((c) => c.has("insert"));
    expect(isCheckRows(insert?.argsOf("insert")?.[0])).toBe(false);
    expect(Array.isArray(insert?.argsOf("insert")?.[0])).toBe(true);
    const rows = insert?.argsOf("insert")?.[0];
    expect(Array.isArray(rows) ? rows.length : 0).toBe(1);
  });

  it("licznik zepsutych linkow bez wartosci liczy sie jako zero, nie jako alarm", async () => {
    planDb({ ...oneDead(), brokenTotal: ok(null) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(db.chainsFor("user_roles")).toEqual([]);
    expect(result.alerted).toBe(0);
  });

  it("lista adminow zwrocona jako null nie wywraca alertu ani skanu", async () => {
    planDb({ ...oneDead(), brokenTotal: okCount(12), admins: ok(null) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(db.chainsFor("notifications")).toEqual([]);
    expect(db.chainsFor("outbound_link_alerts").some((c) => c.has("upsert"))).toBe(true);
    expect(result).toMatchObject({ postsScanned: 1, alerted: 0 });
  });

  it("brak adminow: nie ma komu wyslac, ale watermark i tak sie zapisuje", async () => {
    planDb({ ...oneDead(), brokenTotal: okCount(12), admins: ok([]) });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(db.chainsFor("notifications")).toEqual([]);
    expect(db.chainsFor("outbound_link_alerts").some((c) => c.has("upsert"))).toBe(true);
    expect(result.alerted).toBe(0);
  });

  it("spadek liczby zepsutych linkow odswieza baze porownania bez powiadomienia", async () => {
    planDb({
      ...oneDead(),
      brokenTotal: okCount(4),
      alertState: ok({ broken_count: 30, notified_at: "2026-08-21T09:00:00.000Z" }),
    });

    const result = await runLinkCheckBatch(adminClient(db));

    const update = db.chainsFor("outbound_link_alerts").find((c) => c.has("update"));
    expect(update?.argsOf("update")).toEqual([{ broken_count: 4 }]);
    expect(db.chainsFor("notifications")).toEqual([]);
    expect(result.alerted).toBe(0);
  });

  it("awaria alertu nie uniewaznia skanu, ktory juz sie wykonal", async () => {
    planDb({
      ...oneDead(),
      brokenTotal: okCount(12),
      onUserRoles: () => {
        throw new Error("relation user_roles does not exist");
      },
    });

    const result = await runLinkCheckBatch(adminClient(db));

    expect(warn).toHaveBeenCalledWith("[link-monitor] threshold alert failed", expect.any(Error));
    expect(result).toMatchObject({ postsScanned: 1, linksChecked: 1, alerted: 0 });
  });
});
