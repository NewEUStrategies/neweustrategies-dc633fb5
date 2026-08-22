// Warstwa semantyczna wyszukiwania: kiedy wektory NAPRAWDE trafiaja do bazy,
// a kiedy indekser cicho nic nie robi.
//
// CO TO DOWODZI. Wyszukiwanie semantyczne jest ADDYTYWNE - gdy bramka
// embeddingow milczy, uzytkownik dostaje same wyniki FTS i nie widzi zadnego
// bledu. To najgorszy mozliwy uklad do diagnozy: "nic nie znalazlo" wyglada
// identycznie jak "nie mielismy czym szukac". Dlatego ten plik przypina
// FAKTYCZNY stan degradacji i rozdziela stany, ktore w panelu wygladaja tak
// samo:
//   * BRAK KLUCZA i twarde "nie wspieram" (400/401/403/404) => `null`, bez
//     wyjatku i bez logu, a partia oddaje JAWNE `skipped` (to jedyny slad, po
//     ktorym czlowiek moze poznac, ze indeks nie rosnie);
//   * limit dostawcy (429) i 5xx => WYJATEK, zeby tick ponowil, i BEZ
//     wyciszenia bramki na godzine (inaczej chwilowy limit kosztowalby godzine
//     indeksowania);
//   * odpowiedz w nieoczekiwanym ksztalcie (`data: []`, brak `embedding`, zly
//     wymiar wektora) => WYJATEK, a nie zapis uszkodzonego wektora do bazy
//     (uszkodzony wektor nie boli od razu - psuje sasiedztwo wynikow po cichu);
//   * pusta kolejka i BLAD kolejki => dwa rozne wyniki (zero zamiast wyjatku
//     znaczyloby "wszystko zaindeksowane" przy padnietej bazie);
//   * sprzatanie (`prune`) idzie PRZED embedowaniem, wiec opt-out z katalogu
//     dziala takze w ticku, w ktorym bramka jest niedostepna.
// Zegar jest ustalony, bo `updated_at` idzie do bazy, a wyciszenie bramki liczy
// sie z `Date.now()` - test godzinnego okna musi umiec przesunac czas, nie
// czekac.
//
// CZEGO SWIADOMIE NIE DUBLUJE.
//   * `semanticSearch` / `embedPeopleQuery` (strona ODCZYTU: dokladka wektorowa
//     do rankingu FTS, degradacja przy `null`) ma
//     `src/lib/search/__tests__/searchFunctions.test.ts` - tam `embedTexts` jest
//     atrapa; tutaj sprawdzam sam `embedTexts` i strone ZAPISU;
//   * kadencji ticku (co 5 / co 15 / co 60 minut, budzet joba) - to
//     `everyNthMinute` i `src/lib/server/__tests__/jobsTickDutyCycle.test.ts`;
//   * tresci samych funkcji SQL kolejki (`posts_needing_embeddings`,
//     `profiles_needing_embeddings`, `club_threads_needing_embeddings`,
//     `club_upsert_thread_embedding` - w tym walidacji 768 wymiarow po stronie
//     bazy i autorytatywnego `tenant_id`) - to nalezy do pgTAP-a; tu dowodze
//     wylacznie tego, ze indekser wola te funkcje z takimi NAZWAMI ARGUMENTOW,
//     bo zgubiony argument przechodzi przez `tsc` i przez przeglad;
//   * uprawnien: zadna z tych funkcji nie jest server fn i nie ma wlasnej
//     kontroli dostepu - dostaja klienta service-role od jobs-tick (cron).
//     Powierzchnie uzytkownika (`semantic.functions.ts`, `peopleSemantic`,
//     `clubSemantic`) maja swoje middleware i swoje testy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

/** Klucz jest ATRAPA - w tresci testu nie ma i nie moze byc sekretu. */
const API_KEY = "klucz-testowy-nie-sekret";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";
const NOW = "2026-08-21T10:00:00.000Z";
const DIMS = 768;
const TENANT = "tenant-1";

const h = vi.hoisted(() => ({
  fetchMock: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

type EmbeddingsModule = typeof import("@/lib/server/embeddings.server");

/**
 * Modul trzyma STAN MIEDZY WYWOLANIAMI (`providerUnavailableUntil` - godzinne
 * wyciszenie bramki po twardej odmowie). Kazdy przypadek musi wiec dostac
 * swiezy modul, inaczej jeden test z 401 wyciszalby bramke wszystkim
 * nastepnym i te "przechodzilyby" bez zadnego zapytania.
 */
async function loadModule(): Promise<EmbeddingsModule> {
  vi.resetModules();
  return import("@/lib/server/embeddings.server");
}

/** Powierzchnia klienta service-role, ktorej dotyka indekser. */
interface DbSurface {
  from: (table: string) => unknown;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * STRAZNIK, nie rzutowanie. `as unknown as SupabaseClient` przepuscilby atrape
 * bez `rpc` - czyli test "zdalby" tam, gdzie kod nie mialby czym wywolac
 * funkcji kolejki.
 */
function isDbClient(candidate: DbSurface): candidate is DbSurface & SupabaseClient<Database> {
  return typeof candidate.from === "function" && typeof candidate.rpc === "function";
}

function adminClient(from: SupabaseFromStub, rpc: SupabaseRpcStub): SupabaseClient<Database> {
  const candidate: DbSurface = { from: from.from, rpc: rpc.rpc };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie from() i rpc()");
  return candidate;
}

/** Wektor o zadanej dlugosci - wartosci deterministyczne, bez losowosci. */
function vector(length = DIMS): number[] {
  return Array.from({ length }, (_, i) => i / 10_000);
}

function gatewayResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: new Headers({ "content-type": "application/json" }),
  });
}

function embeddingsPayload(vectors: number[][]): unknown {
  return { data: vectors.map((embedding, index) => ({ index, embedding })) };
}

/** Cialo ostatniego zapytania do bramki, odczytane bez rzutowan. */
function lastRequestBody(): unknown {
  const body = h.fetchMock.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== "string") throw new Error("test: cialo zapytania nie jest tekstem JSON");
  return JSON.parse(body);
}

/** Wiersz, ktory indekser upsertuje do tabeli wektorow. */
interface EmbeddingRow {
  tenant_id: string;
  content_hash: string;
  embedding: string;
  updated_at: string;
}

function isEmbeddingRows(value: unknown): value is EmbeddingRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "embedding" in row &&
        typeof row.embedding === "string" &&
        "updated_at" in row &&
        typeof row.updated_at === "string",
    )
  );
}

function upsertedRows(stub: SupabaseFromStub, table: string): EmbeddingRow[] {
  const chain = stub.chainsFor(table).find((c) => c.has("upsert"));
  const payload = chain?.argsOf("upsert")?.[0];
  if (!isEmbeddingRows(payload)) throw new Error(`test: brak upsertu wektorow w ${table}`);
  return payload;
}

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal("fetch", h.fetchMock);
  vi.stubEnv("LOVABLE_API_KEY", API_KEY);
  h.fetchMock.mockReset();
  h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload([vector()])));
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ======================================================================= */

describe("embedTexts - kontrakt zapytania do bramki", () => {
  it("pusta lista tekstow to pusta odpowiedz BEZ zapytania do bramki", async () => {
    const { embedTexts } = await loadModule();

    await expect(embedTexts([])).resolves.toEqual([]);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("jedno zapytanie POST z modelem, wymiarem i tekstami partii", async () => {
    const { embedTexts, EMBEDDING_DIMS } = await loadModule();
    h.fetchMock.mockImplementation(async () =>
      gatewayResponse(embeddingsPayload([vector(), vector()])),
    );

    const result = await embedTexts(["polityka energetyczna", "rozszerzenie UE"]);

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe(GATEWAY);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    });
    expect(lastRequestBody()).toEqual({
      model: "text-embedding-3-small",
      input: ["polityka energetyczna", "rozszerzenie UE"],
      dimensions: EMBEDDING_DIMS,
    });
    expect(result).toHaveLength(2);
  });

  it("wymiar wektora to 768 - jedna kolumna vector(768) obsluguje oba modele", async () => {
    const { EMBEDDING_DIMS } = await loadModule();

    expect(EMBEDDING_DIMS).toBe(DIMS);
  });

  it("kolejnosc wektorow bierze sie z pola index, nie z kolejnosci odpowiedzi", async () => {
    const { embedTexts } = await loadModule();
    const pierwszy = vector();
    const drugi = vector().map((n) => n + 1);
    h.fetchMock.mockImplementation(async () =>
      gatewayResponse({
        data: [
          { index: 1, embedding: drugi },
          { index: 0, embedding: pierwszy },
        ],
      }),
    );

    const result = await embedTexts(["a", "b"]);

    expect(result?.[0]).toEqual(pierwszy);
    expect(result?.[1]).toEqual(drugi);
  });

  it("wiersz bez pola index laduje na swojej pozycji z odpowiedzi", async () => {
    const { embedTexts } = await loadModule();
    const jedyny = vector();
    h.fetchMock.mockImplementation(async () => gatewayResponse({ data: [{ embedding: jedyny }] }));

    await expect(embedTexts(["a"])).resolves.toEqual([jedyny]);
  });
});

describe("embedTexts - degradacja i stany dostawcy", () => {
  it("BRAK KLUCZA: null bez wyjatku, bez logu i BEZ zapytania do bramki", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { embedTexts } = await loadModule();

    // Stan FAKTYCZNY, przypiety swiadomie: brak klucza nie krzyczy. Jedyny
    // slad, jaki dostaje czlowiek, powstaje warstwe wyzej - w `skipped`
    // zwracanym przez partie indeksera (test nizej).
    await expect(embedTexts(["a"])).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it.each([400, 401, 403, 404])(
    "%i (twarde 'nie wspieram'): null i wyciszenie bramki na godzine",
    async (status) => {
      const { embedTexts } = await loadModule();
      h.fetchMock.mockImplementation(async () => new Response(null, { status }));

      await expect(embedTexts(["a"])).resolves.toBeNull();
      expect(h.fetchMock).toHaveBeenCalledTimes(1);

      // Drugie wolanie w tej samej godzinie NIE pyta bramki po raz drugi.
      await expect(embedTexts(["b"])).resolves.toBeNull();
      expect(h.fetchMock).toHaveBeenCalledTimes(1);

      // Po godzinie proba jest ponawiana - wyciszenie nie jest trwale.
      vi.setSystemTime(new Date(Date.parse(NOW) + 60 * 60 * 1000 + 1));
      h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload([vector()])));
      await expect(embedTexts(["c"])).resolves.toHaveLength(1);
      expect(h.fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("429 (limit dostawcy) RZUCA i NIE wycisza bramki - tick ma ponowic", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => new Response("rate limited", { status: 429 }));

    await expect(embedTexts(["a"])).rejects.toThrow("Embeddings gateway 429: rate limited");

    await expect(embedTexts(["b"])).rejects.toThrow("Embeddings gateway 429");
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx rzuca z fragmentem odpowiedzi obcietym do 200 znakow", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => new Response("x".repeat(500), { status: 503 }));

    await expect(embedTexts(["a"])).rejects.toThrow(`Embeddings gateway 503: ${"x".repeat(200)}`);
  });

  it("5xx z urwanym ciałem nadal raportuje sam status - bez wtornego wyjatku", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => {
      const urwane = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("polaczenie zerwane w trakcie czytania"));
        },
      });
      return new Response(urwane, { status: 503 });
    });

    await expect(embedTexts(["a"])).rejects.toThrow("Embeddings gateway 503:");
  });

  it("blad sieci propaguje sie do wolajacego (tick ma sie ponowic)", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockRejectedValue(new Error("fetch failed"));

    await expect(embedTexts(["a"])).rejects.toThrow("fetch failed");
  });
});

describe("embedTexts - odpowiedz w nieoczekiwanym ksztalcie", () => {
  it("odpowiedz bez pola data liczy sie jako zero wektorow i RZUCA", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => gatewayResponse({}));

    await expect(embedTexts(["a"])).rejects.toThrow("Embeddings gateway returned 0/1 vectors");
  });

  it("data: [] przy niepustym wejsciu RZUCA, a nie zwraca pustej listy", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => gatewayResponse({ data: [] }));

    await expect(embedTexts(["a", "b"])).rejects.toThrow("Embeddings gateway returned 0/2 vectors");
  });

  it("mniej wektorow niz tekstow RZUCA z licznikiem obu stron", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload([vector()])));

    await expect(embedTexts(["a", "b"])).rejects.toThrow("Embeddings gateway returned 1/2 vectors");
  });

  it("wiersz bez pola embedding RZUCA jako wektor o zerowym wymiarze", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => gatewayResponse({ data: [{ index: 0 }] }));

    await expect(embedTexts(["a"])).rejects.toThrow("Embedding dims 0 != 768");
  });

  it("zla dlugosc wektora RZUCA, zamiast wpuscic go do kolumny vector(768)", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload([vector(512)])));

    await expect(embedTexts(["a"])).rejects.toThrow("Embedding dims 512 != 768");
  });

  it("odpowiedz, ktora nie jest JSON-em, propaguje blad parsowania", async () => {
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () => new Response("<html>502</html>", { status: 200 }));

    await expect(embedTexts(["a"])).rejects.toThrow();
  });

  it.fails("index poza zakresem nie moze wypuscic tablicy z dziurami", async () => {
    // DEFEKT (zglaszany, nie naprawiany): src/lib/server/embeddings.server.ts:62-70.
    // Mechanizm: `out[r.index ?? i] = vec` zapisuje wektor pod indeksem
    // PODANYM PRZEZ DOSTAWCE, a jedyna kontrola to `rows.length ===
    // texts.length` (linia 59). Odpowiedz z `index` poza zakresem partii
    // przechodzi wiec walidacje, a funkcja zwraca `number[][]` z dziurami -
    // typ klamie, bo pod indeksem 0 jest `undefined`.
    // Konsekwencja dla uzytkownika: `runSemanticIndexBatch` robi z tego
    // `toVectorLiteral(undefined)` i tick pada na `TypeError: Cannot read
    // properties of undefined (reading 'join')` - komunikat, ktory nie mowi
    // ani ze winna jest bramka, ani ze partia nie zostala zaindeksowana.
    // Przy zlosliwym/zbugowanym dostawcy caly indeks stoi, a wyszukiwanie
    // semantyczne po cichu nie ma czym szukac.
    // Dlaczego to decyzja czlowieka: naprawa to wybor polityki (odrzucic cala
    // partie z jasnym bledem, zignorowac wiersz z bledym indeksem, czy wrocic
    // do kolejnosci z odpowiedzi) - kazda inaczej wplywa na to, co tick uzna
    // za "zaindeksowane".
    const { embedTexts } = await loadModule();
    h.fetchMock.mockImplementation(async () =>
      gatewayResponse({ data: [{ index: 7, embedding: vector() }] }),
    );

    const result = await embedTexts(["a"]);

    expect(result).toHaveLength(1);
  });

  it.fails(
    "zawieszona bramka nie moze zawiesic ticku - zapytanie potrzebuje limitu czasu",
    async () => {
      // DEFEKT (zglaszany, nie naprawiany): src/lib/server/embeddings.server.ts:33-44.
      // Mechanizm: `fetch` do bramki idzie BEZ `AbortController` i bez `signal`
      // (inaczej niz sonda linkow, ktora ma `FETCH_TIMEOUT_MS`, i inaczej niz
      // odpytanie archiwum). Bramka, ktora przyjmuje polaczenie i nie odpowiada,
      // zawiesza `embedTexts` na czas nieokreslony.
      // Konsekwencja dla uzytkownika: minutowy tick jobow czeka na jedna partie
      // embeddingow, wiec razem z nim staja WSZYSTKIE pozostale joby tej samej
      // iteracji (digesty, monitor linkow, dren outboxu, harmonogram klubow) -
      // awaria jednego dostawcy zatrzymuje cala automatyke, nie tylko
      // wyszukiwanie semantyczne.
      // Dlaczego to decyzja czlowieka: trzeba wybrac limit i jego skutek
      // (przerwanie = wyjatek i ponowienie w kolejnym ticku, czy `null` i
      // wyciszenie jak przy twardej odmowie), a takze rozstrzygnac, czy budzet
      // ma byc wspolny dla calego joba.
      const { embedTexts } = await loadModule();
      h.fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
      let settled = false;
      void embedTexts(["a"]).then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(120_000);

      expect(settled).toBe(true);
    },
  );
});

describe("runSemanticIndexBatch - wektory wpisow", () => {
  const queue = [
    { post_id: "post-1", tenant_id: TENANT, content_hash: "hash-1", embed_text: "Analiza A" },
    { post_id: "post-2", tenant_id: TENANT, content_hash: "hash-2", embed_text: "Analiza B" },
  ];

  it("PUSTA kolejka: zero zapytan do bramki i zero zapisow", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", []);

    const result = await runSemanticIndexBatch(adminClient(db, rpc));

    expect(result).toEqual({ scanned: 0, embedded: 0 });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(db.chains).toEqual([]);
  });

  it("kolejka wpisow zwrocona jako null znaczy pusto, nie awarie", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", null);

    const result = await runSemanticIndexBatch(adminClient(db, rpc));

    expect(result).toEqual({ scanned: 0, embedded: 0 });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("BLAD kolejki: wyjatek z komunikatem bazy, nie ciche zero", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setError("posts_needing_embeddings", "function does not exist", "42883");

    await expect(runSemanticIndexBatch(adminClient(db, rpc))).rejects.toThrow(
      "function does not exist",
    );
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(db.chains).toEqual([]);
  });

  it("kolejka jest pytana przez RPC z nazwanym argumentem _limit", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", []);

    await runSemanticIndexBatch(adminClient(db, rpc), 24);

    const call = rpc.lastCall("posts_needing_embeddings");
    expect(rpc.names()).toEqual(["posts_needing_embeddings"]);
    expect(call?.has("_limit")).toBe(true);
    expect(call?.arg("_limit")).toBe(24);
  });

  it("sukces: literal pgvector, znacznik czasu i upsert po post_id", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", queue);
    const wektory = [vector(), vector().map((n) => n + 1)];
    h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload(wektory)));
    db.setResponse("post_embeddings", ok(null));

    const result = await runSemanticIndexBatch(adminClient(db, rpc));

    expect(lastRequestBody()).toMatchObject({ input: ["Analiza A", "Analiza B"] });
    const rows = upsertedRows(db, "post_embeddings");
    expect(rows).toEqual([
      {
        post_id: "post-1",
        tenant_id: TENANT,
        content_hash: "hash-1",
        embedding: `[${wektory[0].join(",")}]`,
        updated_at: NOW,
      },
      {
        post_id: "post-2",
        tenant_id: TENANT,
        content_hash: "hash-2",
        embedding: `[${wektory[1].join(",")}]`,
        updated_at: NOW,
      },
    ]);
    expect(db.lastChain("post_embeddings")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "post_id",
    });
    expect(result).toEqual({ scanned: 2, embedded: 2 });
  });

  it("bramka niedostepna: partia oddaje JAWNE skipped i NIE dotyka tabeli wektorow", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", queue);

    const result = await runSemanticIndexBatch(adminClient(db, rpc));

    expect(result).toEqual({
      scanned: 2,
      embedded: 0,
      skipped: "embeddings provider unavailable",
    });
    expect(db.chains).toEqual([]);
  });

  it("wpis bez tekstu do embedowania jedzie jako pusty tekst, nie jest pomijany", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", [
      { post_id: "post-1", tenant_id: TENANT, content_hash: "h", embed_text: null },
    ]);
    db.setResponse("post_embeddings", ok(null));

    await runSemanticIndexBatch(adminClient(db, rpc));

    expect(lastRequestBody()).toMatchObject({ input: [""] });
  });

  it("BLAD upsertu wektorow rzuca - partia nie moze raportowac sukcesu", async () => {
    const { runSemanticIndexBatch } = await loadModule();
    rpc.setData("posts_needing_embeddings", queue.slice(0, 1));
    db.setResponse("post_embeddings", fail("deadlock detected", "40P01"));

    await expect(runSemanticIndexBatch(adminClient(db, rpc))).rejects.toThrow("deadlock detected");
  });
});

describe("runProfileSemanticIndexBatch - wektory profili", () => {
  const queue = [
    {
      profile_id: "profil-1",
      tenant_id: TENANT,
      content_hash: "hash-p1",
      embed_text: "Ekspert energetyki",
    },
  ];

  it("prog kompletnosci profilu jest przekazany kolejce jako nazwany argument", async () => {
    const { runProfileSemanticIndexBatch, PROFILE_EMBEDDING_MIN_COMPLETENESS } = await loadModule();
    rpc.setData("profiles_needing_embeddings", []);

    await runProfileSemanticIndexBatch(adminClient(db, rpc), 16);

    const call = rpc.lastCall("profiles_needing_embeddings");
    expect(call?.arg("_limit")).toBe(16);
    expect(call?.arg("_min_completeness")).toBe(PROFILE_EMBEDDING_MIN_COMPLETENESS);
    expect(PROFILE_EMBEDDING_MIN_COMPLETENESS).toBe(40);
  });

  it("SPRZATANIE idzie PRZED embedowaniem i dziala nawet przy niedostepnej bramce", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("prune_profile_embeddings", 3);
    rpc.setData("profiles_needing_embeddings", queue);

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc), 16, { prune: true });

    // Kolejnosc jest tu tresciowa: opt-out z katalogu musi zniknac
    // z wyszukiwania w TYM ticku, nawet gdy nic nie da sie policzyc.
    expect(rpc.names()).toEqual(["prune_profile_embeddings", "profiles_needing_embeddings"]);
    expect(result).toEqual({
      scanned: 1,
      embedded: 0,
      pruned: 3,
      skipped: "embeddings provider unavailable",
    });
    expect(db.chains).toEqual([]);
  });

  it("bez opcji prune sprzatanie nie jest wolane wcale", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("profiles_needing_embeddings", []);

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc));

    expect(rpc.names()).toEqual(["profiles_needing_embeddings"]);
    expect(result).toEqual({ scanned: 0, embedded: 0, pruned: undefined });
  });

  it("sprzatanie zwracajace nie-liczbe liczy sie jako zero usunietych", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("prune_profile_embeddings", null);
    rpc.setData("profiles_needing_embeddings", []);

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc), 16, { prune: true });

    expect(result.pruned).toBe(0);
  });

  it("BLAD sprzatania rzuca, zanim cokolwiek pojdzie do bramki", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setError("prune_profile_embeddings", "permission denied", "42501");

    await expect(
      runProfileSemanticIndexBatch(adminClient(db, rpc), 16, { prune: true }),
    ).rejects.toThrow("permission denied");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("PUSTA kolejka profili nie gubi licznika sprzatania", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("prune_profile_embeddings", 2);
    rpc.setData("profiles_needing_embeddings", []);

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc), 16, { prune: true });

    expect(result).toEqual({ scanned: 0, embedded: 0, pruned: 2 });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("kolejka profili zwrocona jako null znaczy pusto, nie awarie", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("profiles_needing_embeddings", null);

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc));

    expect(result).toEqual({ scanned: 0, embedded: 0, pruned: undefined });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("profil bez tekstu do embedowania jedzie jako pusty tekst", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("profiles_needing_embeddings", [
      { profile_id: "profil-1", tenant_id: TENANT, content_hash: "h", embed_text: null },
    ]);
    db.setResponse("profile_embeddings", ok(null));

    await runProfileSemanticIndexBatch(adminClient(db, rpc));

    expect(lastRequestBody()).toMatchObject({ input: [""] });
  });

  it("BLAD kolejki profili rzuca komunikatem bazy", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setError("profiles_needing_embeddings", "relation does not exist", "42P01");

    await expect(runProfileSemanticIndexBatch(adminClient(db, rpc))).rejects.toThrow(
      "relation does not exist",
    );
  });

  it("sukces: upsert po profile_id z literalem pgvector", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("profiles_needing_embeddings", queue);
    db.setResponse("profile_embeddings", ok(null));

    const result = await runProfileSemanticIndexBatch(adminClient(db, rpc));

    const rows = upsertedRows(db, "profile_embeddings");
    expect(rows[0]).toEqual({
      profile_id: "profil-1",
      tenant_id: TENANT,
      content_hash: "hash-p1",
      embedding: `[${vector().join(",")}]`,
      updated_at: NOW,
    });
    expect(db.lastChain("profile_embeddings")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "profile_id",
    });
    expect(result).toEqual({ scanned: 1, embedded: 1, pruned: undefined });
  });

  it("BLAD upsertu profili rzuca", async () => {
    const { runProfileSemanticIndexBatch } = await loadModule();
    rpc.setData("profiles_needing_embeddings", queue);
    db.setResponse("profile_embeddings", fail("null value in column tenant_id", "23502"));

    await expect(runProfileSemanticIndexBatch(adminClient(db, rpc))).rejects.toThrow(
      "null value in column tenant_id",
    );
  });
});

describe("runClubThreadIndexBatch - wektory watkow klubowych", () => {
  const queue = [
    { thread_id: "watek-1", source: "Dyskusja o CBAM", source_hash: "hash-w1" },
    { thread_id: "watek-2", source: "Dyskusja o AI Act", source_hash: "hash-w2" },
  ];

  it("kolejka watkow uzywa argumentu p_limit (nie _limit jak wpisy i profile)", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_threads_needing_embeddings", []);

    const result = await runClubThreadIndexBatch(adminClient(db, rpc), 16);

    const call = rpc.lastCall("club_threads_needing_embeddings");
    expect(call?.keys()).toEqual(["p_limit"]);
    expect(call?.arg("p_limit")).toBe(16);
    expect(result).toEqual({ scanned: 0, embedded: 0, pruned: undefined });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("zapis idzie RPC-em z wektorem jako TABLICA, nie literalem tekstowym", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_threads_needing_embeddings", queue);
    rpc.setData("club_upsert_thread_embedding", null);
    const wektory = [vector(), vector().map((n) => n + 1)];
    h.fetchMock.mockImplementation(async () => gatewayResponse(embeddingsPayload(wektory)));

    const result = await runClubThreadIndexBatch(adminClient(db, rpc));

    expect(rpc.names()).toEqual([
      "club_threads_needing_embeddings",
      "club_upsert_thread_embedding",
      "club_upsert_thread_embedding",
    ]);
    const pierwszy = rpc.callsFor("club_upsert_thread_embedding")[0];
    expect(pierwszy.keys()).toEqual(["p_thread_id", "p_embedding", "p_source_hash"]);
    expect(pierwszy.arg("p_thread_id")).toBe("watek-1");
    expect(pierwszy.arg("p_embedding")).toEqual(wektory[0]);
    expect(pierwszy.arg("p_source_hash")).toBe("hash-w1");
    // Tabela `club_thread_embeddings` NIE jest ruszana bezposrednio - tenant
    // i walidacja wymiaru naleza do funkcji SQL.
    expect(db.chains).toEqual([]);
    expect(result).toEqual({ scanned: 2, embedded: 2, pruned: undefined });
  });

  it("BLAD zapisu jednego watku przerywa partie zamiast raportowac sukces", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_threads_needing_embeddings", queue);
    rpc.setResponse("club_upsert_thread_embedding", (call) =>
      call.arg("p_thread_id") === "watek-2" ? fail("wrong vector dimensions") : ok(null),
    );
    h.fetchMock.mockImplementation(async () =>
      gatewayResponse(embeddingsPayload([vector(), vector()])),
    );

    await expect(runClubThreadIndexBatch(adminClient(db, rpc))).rejects.toThrow(
      "wrong vector dimensions",
    );
  });

  it("sprzatanie watkow idzie PRZED embedowaniem, takze przy niedostepnej bramce", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_prune_thread_embeddings", 5);
    rpc.setData("club_threads_needing_embeddings", queue);

    const result = await runClubThreadIndexBatch(adminClient(db, rpc), 16, { prune: true });

    expect(rpc.names()).toEqual([
      "club_prune_thread_embeddings",
      "club_threads_needing_embeddings",
    ]);
    expect(result).toEqual({
      scanned: 2,
      embedded: 0,
      pruned: 5,
      skipped: "embeddings provider unavailable",
    });
  });

  it("BLAD sprzatania watkow rzuca przed odczytem kolejki", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setError("club_prune_thread_embeddings", "permission denied", "42501");

    await expect(
      runClubThreadIndexBatch(adminClient(db, rpc), 16, { prune: true }),
    ).rejects.toThrow("permission denied");
    expect(rpc.names()).toEqual(["club_prune_thread_embeddings"]);
  });

  it("BLAD kolejki watkow rzuca komunikatem bazy", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setError("club_threads_needing_embeddings", "relation does not exist", "42P01");

    await expect(runClubThreadIndexBatch(adminClient(db, rpc))).rejects.toThrow(
      "relation does not exist",
    );
  });

  it("kolejka watkow zwrocona jako null znaczy pusto, nie awarie", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_prune_thread_embeddings", 1);
    rpc.setData("club_threads_needing_embeddings", null);

    const result = await runClubThreadIndexBatch(adminClient(db, rpc), 16, { prune: true });

    expect(result).toEqual({ scanned: 0, embedded: 0, pruned: 1 });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("sprzatanie watkow zwracajace nie-liczbe liczy sie jako zero", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_prune_thread_embeddings", "iles");
    rpc.setData("club_threads_needing_embeddings", []);

    const result = await runClubThreadIndexBatch(adminClient(db, rpc), 16, { prune: true });

    expect(result.pruned).toBe(0);
  });

  it("watek bez tresci jedzie jako pusty tekst", async () => {
    const { runClubThreadIndexBatch } = await loadModule();
    rpc.setData("club_threads_needing_embeddings", [
      { thread_id: "watek-1", source: null, source_hash: "h" },
    ]);
    rpc.setData("club_upsert_thread_embedding", null);

    await runClubThreadIndexBatch(adminClient(db, rpc));

    expect(lastRequestBody()).toMatchObject({ input: [""] });
  });
});
