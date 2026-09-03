// PODGLĄD LINKU KLUBOWEGO - dowód, że obrona przed SSRF naprawdę działa.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/clubs/linkPreview.functions.ts` to jedyne
// miejsce w module klubów, w którym SERWER wychodzi na sieć pod adresem
// PODANYM PRZEZ UŻYTKOWNIKA. Nagłówek tamtego pliku wykłada kompletny model
// zagrożenia i pięć warstw obrony (konto, limit żądań, bramka egress z DNS-em,
// wymuszone https, brak przekierowań, obcięcie odpowiedzi, twardy limit czasu).
// Do tej pory był to OPIS, nie DOWÓD: plik miał 9,1% pokrycia linii, 0,0%
// gałęzi i 0 z 8 funkcji. Opis obrony, którego nikt nie wykonuje, starzeje się
// razem z kodem - a historia tego właśnie pliku jest tu ostrzeżeniem: pierwsza
// wersja blokady opierała się na LIŚCIE ZAKAZANYCH NAZW i dała się obejść jedną
// domeną wskazującą na 127.0.0.1 (defekt K6, audyt 12.08).
//
// CO JEST PRZEDMIOTEM DOWODU. Cała ścieżka od wejścia do wyniku:
// walidator wejścia (zod), `resolveClubPreviewTarget`, handler server fn oraz
// cztery niewyeksportowane funkcje parsujące (`decodeEntities`, `clean`,
// `readMeta`, `absolute`). Te ostatnie nie mają eksportu, więc testujemy je
// PRZEZ handler - obserwując pola, które faktycznie trafiają do czytelnika.
// To mocniejsza asercja niż wywołanie ich wprost: mówi, co zobaczy użytkownik,
// a nie co zwraca funkcja pomocnicza.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` (`serverFnStubModule`) - `createServerFn` buduje
//     obiekt wywoływalny wyłącznie przez runtime frameworka; bez podmiany
//     fabryki ciało handlera jest nieosiągalne z vitest.
//   * globalny `fetch` - ŻADEN test nie wychodzi do sieci. Atrapa jest
//     jednocześnie LICZNIKIEM: w przypadkach „adres odrzucony" asercja brzmi
//     „fetch nie został wywołany ANI RAZU", bo dokładnie to jest treścią
//     obrony przed SSRF. Podgląd, który zwraca `null` PO wykonaniu żądania,
//     byłby dziurą, a nie obroną.
//   * `@/lib/server/rate-limit.server` - licznik stoi na RPC do Supabase.
//   * `node:dns/promises` - bramka egress ROZWIĄZUJE nazwę; podstawiamy
//     odpowiedzi resolvera zamiast pytać prawdziwy DNS.
//   * `@/lib/http/egressGuard.server` - podmieniony JAKO MODUŁ, ale decyzję
//     nadal podejmuje PRAWDZIWA `assertPublicHttpUrl` (atrapa to `vi.fn`
//     delegujący do `vi.importActual`). Świadomie NIE piszemy tu własnego
//     „stuba, który odrzuca localhost", bo taki test dowodziłby wyłącznie
//     tego, że nasz stub odrzuca localhost - czyli niczego. Atrapa modułu
//     daje LICZNIK WYWOŁAŃ (potrzebny do dowodu „przy przekroczonym limicie
//     bramka nie jest nawet pytana"), a logika pozostaje produkcyjna. Warunki
//     w kodzie produkcyjnym nie są w żadnym miejscu rozluźniane.
//
// GRANICA DOWODU - UCZCIWIE. Autoryzację („anonim nie przechodzi") egzekwuje
// middleware `requireSupabaseAuth`, którego atrapa `createServerFn` NIE
// URUCHAMIA. Ten plik nie może więc powiedzieć „obcy się nie dostanie"; może
// powiedzieć tylko „funkcja DEKLARUJE to middleware" - i mówi to testem
// strukturalnym na `asServerFn(...).middleware`. Pełnej pewności pilnują dwie
// inne warstwy: bramka statyczna `check:authz-snapshot`
// (`src/lib/authz/authzSnapshot.generated.ts`) oraz `clubEgressGuards.test.ts`.
// Tak samo z rozwiązywaniem DNS: dowodzimy, że bramka jest PYTANA i że jej
// odmowa zatrzymuje żądanie, a nie że resolver systemowy działa poprawnie.
//
// Adresy: wyłącznie domeny `.example` (RFC 2606) i TEST-NET-3 (203.0.113.0/24).
// Żaden prawdziwy host nie pojawia się w teście ani w logu.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asServerFn } from "@/test/serverFnHarness";
import { callServerFn } from "@/test/serverFn";

/** Kształt odpowiedzi, jakiego dotyka handler. Węższy niż `Response`, bo
 *  handler czyta z niej dokładnie cztery rzeczy. */
interface FakeResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  body: { getReader(): FakeReader } | null;
}

interface FakeReader {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
  cancel(): Promise<void>;
}

/** To, co handler przekazuje do `fetch` jako `init`. */
interface CapturedInit {
  method?: string;
  redirect?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type FetchStub = (input: unknown, init?: CapturedInit) => Promise<FakeResponse>;

const h = vi.hoisted(() => {
  const dns = new Map<string, readonly string[]>();
  const box: { realGuard: ((raw: string) => Promise<URL>) | null } = { realGuard: null };
  const guard = vi.fn(async (raw: string): Promise<URL> => {
    if (box.realGuard === null) throw new Error("test: bramka egress nie została podpięta");
    return box.realGuard(raw);
  });
  return {
    dns,
    box,
    guard,
    rateLimit: vi.fn(),
    fetch: vi.fn<FetchStub>(),
  };
});

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (host: string) => {
      const found = h.dns.get(host);
      if (found === undefined) throw new Error(`ENOTFOUND ${host}`);
      return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  },
}));

vi.mock("@/lib/http/egressGuard.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http/egressGuard.server")>(
    "@/lib/http/egressGuard.server",
  );
  h.box.realGuard = actual.assertPublicHttpUrl;
  return { ...actual, assertPublicHttpUrl: h.guard };
});

vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));

vi.stubGlobal("fetch", h.fetch);

const { fetchClubLinkPreview, resolveClubPreviewTarget } =
  await import("@/lib/clubs/linkPreview.functions");
// Rozgrzewka: oba moduły ładowane dynamicznie wewnątrz handlera muszą siedzieć
// w cache, zanim którykolwiek test włączy zegary atrapowane - `await import()`
// na zimno potrafi wejść w kolejkę makrozadań, a wtedy test z `useFakeTimers()`
// zawisłby z powodu narzędzia, nie z powodu kodu.
await import("@/lib/http/egressGuard.server");
await import("@/lib/server/rate-limit.server");

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 6000;
const HOST = "redakcja.example";
const TARGET = `https://${HOST}/analiza`;
const PUBLIC_IP = "203.0.113.10";
const USER_ID = "11111111-2222-4333-8444-555555555555";

const CONTEXT = { supabase: null, userId: USER_ID };

interface ClubLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Licznik tego, co strumień faktycznie oddał - serce dowodu o MAX_BYTES. */
interface BodyStats {
  getReaderCalls: number;
  reads: number;
  cancels: number;
}

function streamOf(chunks: readonly string[]): {
  body: { getReader(): FakeReader };
  stats: BodyStats;
} {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  const stats: BodyStats = { getReaderCalls: 0, reads: 0, cancels: 0 };
  let index = 0;
  const reader: FakeReader = {
    async read() {
      stats.reads += 1;
      const value = queue[index];
      if (value === undefined) return { done: true };
      index += 1;
      return { done: false, value };
    },
    async cancel() {
      stats.cancels += 1;
    },
  };
  return {
    body: {
      getReader() {
        stats.getReaderCalls += 1;
        return reader;
      },
    },
    stats,
  };
}

function makeResponse(
  chunks: readonly string[],
  init?: { contentType?: string | null; ok?: boolean; status?: number; withBody?: boolean },
): { response: FakeResponse; stats: BodyStats } {
  const { body, stats } = streamOf(chunks);
  const headers = new Headers();
  const contentType =
    init?.contentType === undefined ? "text/html; charset=utf-8" : init.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  return {
    response: {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      headers,
      body: init?.withBody === false ? null : body,
    },
    stats,
  };
}

/** Odpowiada stroną HTML i oddaje licznik strumienia. */
function serveHtml(
  chunks: readonly string[],
  init?: { contentType?: string | null; ok?: boolean; status?: number; withBody?: boolean },
): BodyStats {
  const { response, stats } = makeResponse(chunks, init);
  h.fetch.mockResolvedValue(response);
  return stats;
}

async function preview(url = TARGET): Promise<ClubLinkPreview | null> {
  return callServerFn<ClubLinkPreview | null>(fetchClubLinkPreview, { url }, CONTEXT);
}

/** Podgląd strony podanej jednym kawałkiem HTML. */
async function previewOf(html: string): Promise<ClubLinkPreview | null> {
  serveHtml([html]);
  return preview();
}

function lastRequest(): { input: unknown; init: CapturedInit | undefined } {
  const call = h.fetch.mock.calls.at(-1);
  if (call === undefined) throw new Error("test: fetch nie został wywołany");
  return { input: call[0], init: call[1] };
}

/** Dokleja spacje, aż kawałek ma dokładnie tyle bajtów (wejście jest ASCII). */
function padTo(text: string, bytes: number): string {
  if (text.length > bytes) throw new Error("test: kawałek dłuższy niż zadany rozmiar");
  return text + " ".repeat(bytes - text.length);
}

beforeEach(() => {
  h.dns.clear();
  h.dns.set(HOST, [PUBLIC_IP]);
  h.guard.mockClear();
  h.rateLimit.mockReset();
  h.rateLimit.mockResolvedValue(true);
  h.fetch.mockReset();
  h.fetch.mockImplementation(async () => {
    throw new Error("test: fetch nie miał prawa zostać tu wywołany");
  });
});

// ---------------------------------------------------------------------------

describe("czy serwerowi wolno w ogóle wyjść na sieć", () => {
  it("przy przekroczonym limicie nie pyta nawet bramki - i nie rusza z żądaniem", async () => {
    h.rateLimit.mockResolvedValue(false);

    expect(await preview()).toBeNull();
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("licznik jest FAIL-CLOSED i per konto - awaria RPC nie może otworzyć proxy", async () => {
    serveHtml(["<html><title>Analiza</title></html>"]);
    await preview();

    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "club.link-preview",
      subjectId: USER_ID,
      max: 30,
      failClosed: true,
    });
  });

  it.each([
    ["localhost", "https://localhost/panel"],
    ["pętla zwrotna po IP", "https://127.0.0.1/panel"],
    ["metadane chmury", "https://169.254.169.254/latest/meta-data/"],
    ["sieć wewnętrzna po sufiksie", "https://kasa.internal/api"],
    ["adres prywatny RFC 1918", "https://10.0.0.7/"],
    ["IPv6 loopback", "https://[::1]/"],
  ])("%s: bramka odrzuca, a fetch nie rusza ani razu", async (_nazwa, adres) => {
    expect(await preview(adres)).toBeNull();
    expect(h.guard).toHaveBeenCalledWith(adres);
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("nazwa rozwiązywana na loopback też nie przechodzi - to było obejście z defektu K6", async () => {
    h.dns.set("podglad.napastnik.example", ["127.0.0.1"]);

    expect(await preview("https://podglad.napastnik.example/")).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("nazwa z JEDNĄ prywatną odpowiedzią DNS obok publicznej też nie przechodzi", async () => {
    h.dns.set("split.napastnik.example", [PUBLIC_IP, "10.0.0.7"]);

    expect(await preview("https://split.napastnik.example/")).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("http:// jest odrzucone przez bramkę - bez TLS rebinding nie ma czym zatrzymać", async () => {
    expect(await preview("http://redakcja.example/analiza")).toBeNull();
    expect(h.guard).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("schemat, który przeszedł walidator zod, ale nie jest siecią - odpada na bramce", async () => {
    expect(await preview("javascript:alert(1)")).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("awaria DNS-u kończy się odmową, nie zgadywaniem (fail-closed)", async () => {
    expect(await preview("https://nieistnieje.example/")).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });

  it("resolveClubPreviewTarget oddaje URL dla adresu publicznego i null dla odrzuconego", async () => {
    const ok = await resolveClubPreviewTarget(`${TARGET}?utm_source=x`);
    expect(ok?.hostname).toBe(HOST);
    expect(ok?.pathname).toBe("/analiza");

    expect(await resolveClubPreviewTarget("https://127.0.0.1/")).toBeNull();
  });
});

describe("jak wygląda żądanie wychodzące", () => {
  it("idzie GET-em, bez podążania za przekierowaniem i z sygnałem przerwania", async () => {
    serveHtml(["<html><title>Analiza</title></html>"]);
    await preview();

    const { input, init } = lastRequest();
    expect(input).toBe(`${TARGET}`);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers?.accept).toContain("text/html");
    expect(init?.headers?.["user-agent"]).toContain("NewEuropeanStrategiesBot");
  });

  it("odpowiedź 30x kończy się null i DRUGIEGO żądania nie ma - skok na metadane nie ma jak nastąpić", async () => {
    const { response } = makeResponse([""], { ok: false, status: 302 });
    response.headers.set("location", "http://169.254.169.254/latest/meta-data/");
    h.fetch.mockResolvedValue(response);

    expect(await preview()).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(lastRequest().init?.redirect).toBe("manual");
  });

  it("odpowiedź 500 również kończy się null, a nie wyjątkiem", async () => {
    serveHtml(["<html></html>"], { ok: false, status: 500 });
    expect(await preview()).toBeNull();
  });

  it("błąd sieci nie wysadza wpisu - handler oddaje null", async () => {
    h.fetch.mockRejectedValue(new Error("ECONNRESET"));
    expect(await preview()).toBeNull();
  });
});

describe("ile wolno przeczytać z cudzej odpowiedzi", () => {
  it("content-type bez html: null i CIAŁO NIE JEST W OGÓLE OTWIERANE", async () => {
    const stats = serveHtml(['{ "cokolwiek": 1 }'], { contentType: "application/json" });

    expect(await preview()).toBeNull();
    expect(stats.getReaderCalls).toBe(0);
    expect(stats.reads).toBe(0);
  });

  it("brak nagłówka content-type traktujemy jak brak html", async () => {
    const stats = serveHtml(["<html><title>X</title></html>"], { contentType: null });

    expect(await preview()).toBeNull();
    expect(stats.getReaderCalls).toBe(0);
  });

  it("odpowiedź bez ciała (body === null) kończy się null", async () => {
    serveHtml([], { withBody: false });
    expect(await preview()).toBeNull();
  });

  it("po przekroczeniu 256 kB strumień jest ANULOWANY, a reszta kawałków nieprzeczytana", async () => {
    const polowa = MAX_BYTES / 2;
    const stats = serveHtml([
      padTo('<meta property="og:title" content="Kawalek pierwszy">', polowa),
      padTo("<p>drugi</p>", polowa),
      padTo('<meta property="og:description" content="Kawalek trzeci">', polowa),
    ]);

    const wynik = await preview();

    expect(stats.reads).toBe(2);
    expect(stats.cancels).toBe(1);
    expect(wynik?.title).toBe("Kawalek pierwszy");
    // Trzeci kawałek nigdy nie wjechał do pamięci, więc jego metadanych nie ma.
    expect(wynik?.description).toBeNull();
  });

  it("JEDEN nadmiarowy kawałek nie wchodzi do pamięci w całości - bufor kończy się na 256 kB", async () => {
    // REGRESJA (naprawa 02.09): limit sprawdzany był PO doklejeniu kawałka do
    // bufora, więc pojedynczy wielki kawałek (rozpakowany gzip potrafi oddać
    // megabajty naraz) trafiał do pamięci w całości, a MAX_BYTES ograniczał
    // tylko liczbę OBROTÓW pętli. Metadana schowana za progiem jest tu sondą:
    // jeżeli podgląd ją widzi, znaczy że przeczytał więcej, niż wolno mu było.
    const stats = serveHtml([
      `<html><title>Poczatek</title>${"x".repeat(MAX_BYTES)}` +
        '<meta property="og:title" content="Za progiem"></html>',
    ]);

    const wynik = await preview();

    expect(stats.reads).toBe(1);
    expect(stats.cancels).toBe(1);
    expect(wynik?.title).toBe("Poczatek");
  });

  it("odpowiedź mieszcząca się w limicie jest czytana do końca, bez anulowania", async () => {
    const stats = serveHtml(["<html>", "<title>Analiza</title>", "</html>"]);

    const wynik = await preview();

    expect(stats.cancels).toBe(0);
    // Trzy kawałki plus odczyt kończący (`done: true`).
    expect(stats.reads).toBe(4);
    expect(wynik?.title).toBe("Analiza");
  });
});

describe("limit czasu i sprzątanie po sobie", () => {
  it("sygnał jedzie z żądaniem, upływ 6 s go przerywa, a wynik to null a nie wyjątek", async () => {
    vi.useFakeTimers();
    try {
      const zapis: { signal: AbortSignal | null; timeryWTrakcie: number } = {
        signal: null,
        timeryWTrakcie: -1,
      };
      h.fetch.mockImplementation(async (_input, init) => {
        zapis.signal = init?.signal ?? null;
        zapis.timeryWTrakcie = vi.getTimerCount();
        vi.advanceTimersByTime(TIMEOUT_MS);
        const blad = new Error("The operation was aborted");
        blad.name = "AbortError";
        throw blad;
      });

      expect(await preview()).toBeNull();
      expect(zapis.timeryWTrakcie).toBe(1);
      expect(zapis.signal?.aborted).toBe(true);
      // `clearTimeout` siedzi w `finally` - po powrocie nie zostaje nic tykającego.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("na ścieżce udanej timer też jest kasowany, a nie zostawiany na 6 s", async () => {
    vi.useFakeTimers();
    try {
      serveHtml(["<html><title>Analiza</title></html>"]);
      const wynik = await preview();

      expect(wynik?.title).toBe("Analiza");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("co odczytujemy z HTML-a i co z tego zobaczy czytelnik", () => {
  it("czyta meta w OBU kolejnościach atrybutów i po property, i po name", async () => {
    const poProperty = await previewOf('<meta property="og:title" content="Po property">');
    expect(poProperty?.title).toBe("Po property");

    const contentPierwszy = await previewOf(
      '<meta content="Content pierwszy" property="og:title">',
    );
    expect(contentPierwszy?.title).toBe("Content pierwszy");

    const poName = await previewOf('<meta name="og:title" content="Po name">');
    expect(poName?.title).toBe("Po name");

    const nameOdwrocony = await previewOf('<meta content="Name odwrocony" name="twitter:title">');
    expect(nameOdwrocony?.title).toBe("Name odwrocony");
  });

  it("pierwszeństwo tytułu: og przed twitter, twitter przed znacznikiem title", async () => {
    const wszystkie = await previewOf(
      '<title>Ze znacznika</title><meta name="twitter:title" content="Z twittera">' +
        '<meta property="og:title" content="Z og">',
    );
    expect(wszystkie?.title).toBe("Z og");

    const bezOg = await previewOf(
      '<title>Ze znacznika</title><meta name="twitter:title" content="Z twittera">',
    );
    expect(bezOg?.title).toBe("Z twittera");

    const samTitle = await previewOf("<title>Ze znacznika</title>");
    expect(samTitle?.title).toBe("Ze znacznika");
  });

  it("pierwszeństwo opisu: og, potem twitter, potem zwykłe meta description", async () => {
    const bezOg = await previewOf(
      '<meta name="description" content="Zwykly opis">' +
        '<meta name="twitter:description" content="Opis z twittera">',
    );
    expect(bezOg?.description).toBe("Opis z twittera");

    const samoDescription = await previewOf('<meta name="description" content="Zwykly opis">');
    expect(samoDescription?.description).toBe("Zwykly opis");
  });

  it("strona bez OpenGraph i bez niczego: same nulle, siteName spada na hostname", async () => {
    const wynik = await previewOf("<html><body><p>Tylko tresc</p></body></html>");

    expect(wynik).toEqual({
      url: TARGET,
      title: null,
      description: null,
      image: null,
      siteName: HOST,
    });
  });

  it("og:site_name wygrywa z hostname, gdy strona się przedstawia", async () => {
    const wynik = await previewOf('<meta property="og:site_name" content="Redakcja Przykladowa">');
    expect(wynik?.siteName).toBe("Redakcja Przykladowa");
  });

  it("encje HTML są rozwijane, a nie pokazywane surowo", async () => {
    const wynik = await previewOf(
      '<meta property="og:title" content="&quot;Raport&quot; &amp; analiza &#39;A&#39;">' +
        '<meta property="og:description" content="&lt;b&gt;pogrubione&gt; &apos;cyt&apos;&nbsp;koniec">',
    );

    expect(wynik?.title).toBe("\"Raport\" & analiza 'A'");
    expect(wynik?.description).toBe("<b>pogrubione> 'cyt' koniec");
  });

  it("zwielokrotnione białe znaki zwijają się do pojedynczej spacji i są przycinane", async () => {
    const wynik = await previewOf("<title>   Analiza \n\n  korytarza \t transportowego   </title>");
    expect(wynik?.title).toBe("Analiza korytarza transportowego");
  });

  it("opis dłuższy niż 300 znaków jest ucinany na 300", async () => {
    const dlugi = "a".repeat(400);
    const wynik = await previewOf(`<meta property="og:description" content="${dlugi}">`);

    expect(wynik?.description).toHaveLength(300);
    expect(wynik?.description).toBe("a".repeat(300));
  });

  it("pole złożone z samych białych znaków to null, a nie pusty napis", async () => {
    const wynik = await previewOf(
      '<meta property="og:title" content="">' +
        '<meta name="twitter:title" content="    ">' +
        '<meta property="og:description" content="   ">',
    );

    expect(wynik?.title).toBeNull();
    expect(wynik?.description).toBeNull();
  });

  it("adres obrazka względny jest rozwijany względem CELU, nie względem wejścia", async () => {
    const wynik = await previewOf('<meta property="og:image" content="/media/okladka.png">');
    expect(wynik?.image).toBe(`https://${HOST}/media/okladka.png`);
  });

  it("twitter:image jest zapasem, gdy nie ma og:image", async () => {
    const wynik = await previewOf('<meta name="twitter:image" content="grafika/mapa.png">');
    expect(wynik?.image).toBe(`https://${HOST}/grafika/mapa.png`);
  });

  it("obrazek w schemacie javascript: jest wycinany do null", async () => {
    const wynik = await previewOf('<meta property="og:image" content="javascript:alert(1)">');
    expect(wynik?.image).toBeNull();
  });

  it("obrazek nieparsowalny jako adres to null, a nie wyjątek", async () => {
    const wynik = await previewOf('<meta property="og:image" content="http://">');
    expect(wynik?.image).toBeNull();
  });

  it("zwracany url to CEL po bramce, więc zapytanie i fragment z wejścia nie wracają na ślepo", async () => {
    serveHtml(["<title>Analiza</title>"]);
    const wynik = await callServerFn<ClubLinkPreview | null>(
      fetchClubLinkPreview,
      { url: `${TARGET}?utm_source=newsletter#sekcja` },
      CONTEXT,
    );

    expect(wynik?.url).toBe(`${TARGET}?utm_source=newsletter#sekcja`);
    expect(new URL(wynik?.url ?? "").protocol).toBe("https:");
  });
});

describe("obudowa funkcji serwerowej: wejście i deklarowane middleware", () => {
  const spec = asServerFn(fetchClubLinkPreview);

  it("deklaruje requireSupabaseAuth - anonim nie ma jak wejść na tę ścieżkę", () => {
    // GRANICA: atrapa `createServerFn` nie URUCHAMIA middleware, więc to jest
    // dowód na DEKLARACJĘ, nie na egzekucję. Egzekucji pilnuje bramka
    // `check:authz-snapshot`; tu chodzi o to, żeby ogniwo nie zniknęło cicho.
    expect(spec.middleware).toContain(requireSupabaseAuth);
    expect(spec.method).toBe("POST");
    expect(typeof spec.validator).toBe("function");
  });

  it("walidator przycina adres i przepuszcza poprawny", () => {
    expect(spec.validator?.({ url: `  ${TARGET}  ` })).toEqual({ url: TARGET });
  });

  it("wejście, które nie jest adresem, jest odrzucane przez zod", () => {
    expect(() => spec.validator?.({ url: "nie-adres" })).toThrow();
    expect(() => spec.validator?.({ url: "" })).toThrow();
    expect(() => spec.validator?.({})).toThrow();
  });

  it("adres dłuższy niż 2048 znaków jest odrzucany, zanim cokolwiek wyjdzie na sieć", () => {
    const zaDlugi = `https://${HOST}/${"a".repeat(2100)}`;
    expect(zaDlugi.length).toBeGreaterThan(2048);
    expect(() => spec.validator?.({ url: zaDlugi })).toThrow();
    expect(h.fetch).toHaveBeenCalledTimes(0);
  });
});
