// Trzy wejścia serwerowe wyszukiwarki: `globalSearch` (paleta komend),
// `semanticSearch` (dokładka wektorowa do rankingu FTS) i `embedPeopleQuery`
// (wektor frazy dla katalogu osób).
//
// DLACZEGO TO MA TEST, SKORO RANKING JEST DOWIEDZIONY W BAZIE. Dziewięć plików
// pgTAP dowodzi rankingu, operatorów i faset PO STRONIE SQL. Nikt natomiast nie
// dowodził, że TypeScript woła to poprawnie - a to tutaj mieszka granica:
// walidacja wejścia (długość frazy, limity), przekazanie parametrów do RPC,
// oraz DEGRADACJA, czyli co się dzieje, gdy bramki AI nie ma, klucza nie ma
// albo baza zwróci błąd. Wyszukiwarka nie może się wtedy wywracać - ma zejść
// na czysty FTS. Tego pgTAP nie widzi w ogóle.
//
// Operatorów FTS tu NIE sanityzujemy i nie testujemy sanityzacji: fraza jedzie
// do RPC surowa, a zamiana jej na `tsquery` (z ochroną przed składnią) jest
// w SQL-u i ma własny plik pgTAP (`search_tsquery_test.sql`). Test sprawdza
// natomiast, że TS jej po drodze NIE OKALECZA.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asServerFn } from "@/test/serverFnChain";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnChain")).reactStartMock(),
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    h.createClient(...args);
    return { rpc: h.rpc };
  },
}));

vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: vi.fn(),
}));

vi.mock("@/lib/server/embeddings.server", () => ({ embedTexts: h.embedTexts }));

import { globalSearch, type SearchHit } from "@/lib/search/search.functions";
import { semanticSearch, type SemanticHit } from "@/lib/search/semantic.functions";
import {
  embedPeopleQuery,
  PEOPLE_SEMANTIC_MIN_CHARS,
  type PeopleQueryEmbedding,
} from "@/lib/search/peopleSemantic.functions";

const quick = asServerFn<{ q: string; limit?: number }, { hits: SearchHit[] }>(globalSearch);
const semantic = asServerFn<{ q: string; limit?: number }, { hits: SemanticHit[] }>(semanticSearch);
const people = asServerFn<{ q: string }, PeopleQueryEmbedding>(embedPeopleQuery);

const ENV = { url: "https://db.example.supabase.co", key: "publishable-key" };

/** Wektor 768D - taki, jaki zwraca bramka. Wartość bez znaczenia, długość ma. */
const vector = (seed = 0.1) => Array.from({ length: 8 }, (_, i) => seed + i / 100);

beforeEach(() => {
  process.env.SUPABASE_URL = ENV.url;
  process.env.SUPABASE_PUBLISHABLE_KEY = ENV.key;
  h.rpc.mockReset();
  h.createClient.mockReset();
  h.embedTexts.mockReset();
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.embedTexts.mockResolvedValue([vector()]);
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
});

// ---------------------------------------------------------------------------
// globalSearch - szybkie wyszukiwanie tytułów dla palety komend
// ---------------------------------------------------------------------------

describe("globalSearch - walidacja wejścia", () => {
  it("ODRZUCA pustą frazę - puste zapytanie nie ma po co jechać do bazy", () => {
    expect(() => quick.validate({ q: "" })).toThrow();
    expect(() => quick.validate({ q: "   " })).toThrow();
  });

  it("przycina frazę przed walidacją - spacje nie są treścią", () => {
    expect(quick.validate({ q: "  raport  " })).toEqual({ q: "raport" });
  });

  it("ODRZUCA frazę dłuższą niż 128 znaków - to zapora, nie wyszukiwanie", () => {
    expect(() => quick.validate({ q: "a".repeat(129) })).toThrow();
    expect(quick.validate({ q: "a".repeat(128) }).q).toHaveLength(128);
  });

  it("ODRZUCA limit spoza zakresu i limit ułamkowy", () => {
    expect(() => quick.validate({ q: "x", limit: 0 })).toThrow();
    expect(() => quick.validate({ q: "x", limit: 51 })).toThrow();
    expect(() => quick.validate({ q: "x", limit: 2.5 })).toThrow();
  });

  it("przyjmuje limit z zakresu i pozwala go pominąć", () => {
    expect(quick.validate({ q: "x", limit: 50 })).toEqual({ q: "x", limit: 50 });
    expect(quick.validate({ q: "x" })).toEqual({ q: "x" });
  });

  it("NIE OKALECZA operatorów FTS - składnię rozbiera SQL, nie TypeScript", () => {
    // `search_tsquery_test.sql` dowodzi, że baza radzi sobie ze składnią;
    // zadaniem TS jest jej nie zjeść po drodze.
    const raw = '"polityka energetyczna" AND (gaz OR ropa) -sankcje';
    expect(quick.validate({ q: raw }).q).toBe(raw);
  });
});

describe("globalSearch - wywołanie bazy", () => {
  it("woła search_quick z frazą i domyślnym limitem 12", async () => {
    await quick.call({ q: "raport" });
    expect(h.rpc).toHaveBeenCalledWith("search_quick", { _q: "raport", _limit: 12 });
  });

  it("przekazuje limit podany przez wołającego", async () => {
    await quick.call({ q: "raport", limit: 8 });
    expect(h.rpc).toHaveBeenCalledWith("search_quick", { _q: "raport", _limit: 8 });
  });

  it("klient anon NIE trzyma sesji i pinuje tenanta przez tenant-host fetch", async () => {
    await quick.call({ q: "raport" });
    const [url, key, opts] = h.createClient.mock.calls[0] as [
      string,
      string,
      { auth: { persistSession: boolean }; global: { fetch: unknown } },
    ];
    expect(url).toBe(ENV.url);
    expect(key).toBe(ENV.key);
    // Sesja w kliencie serwerowym wyciekłaby między żądaniami.
    expect(opts.auth.persistSession).toBe(false);
    expect(opts.global.fetch).toBeTypeOf("function");
  });

  it("BEZ KONFIGURACJI zwraca pustkę i NIE dotyka bazy", async () => {
    delete process.env.SUPABASE_URL;
    await expect(quick.run({ q: "raport" })).resolves.toEqual({ hits: [] });
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("brak samego klucza też degraduje do pustki", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    await expect(quick.run({ q: "raport" })).resolves.toEqual({ hits: [] });
    expect(h.createClient).not.toHaveBeenCalled();
  });
});

describe("globalSearch - mapowanie wyników", () => {
  it("wpis dostaje permalink /post/<slug>, strona adres główny", async () => {
    h.rpc.mockResolvedValue({
      data: [
        { kind: "post", id: "p-1", slug: "raport", title_pl: "Raport", title_en: "Report" },
        { kind: "page", id: "pg-1", slug: "o-nas", title_pl: "O nas", title_en: "About" },
      ],
      error: null,
    });
    const { hits } = await quick.call({ q: "raport" });
    expect(hits).toEqual([
      {
        kind: "post",
        id: "p-1",
        slug: "raport",
        title_pl: "Raport",
        title_en: "Report",
        href: "/post/raport",
      },
      {
        kind: "page",
        id: "pg-1",
        slug: "o-nas",
        title_pl: "O nas",
        title_en: "About",
        href: "/o-nas",
      },
    ]);
  });

  it("nieznany rodzaj traktowany jest jak wpis - nigdy jak strona", async () => {
    // Strona dostaje adres w KORZENIU witryny, więc pomyłka w tę stronę
    // podszywałaby wpis pod adres strony statycznej.
    h.rpc.mockResolvedValue({
      data: [{ kind: "cokolwiek", id: "x", slug: "x", title_pl: "X", title_en: "X" }],
      error: null,
    });
    const { hits } = await quick.call({ q: "x" });
    expect(hits[0]).toMatchObject({ kind: "post", href: "/post/x" });
  });

  it("brak tytułu mapuje się na pusty napis, nie na null", async () => {
    h.rpc.mockResolvedValue({
      data: [{ kind: "post", id: "p", slug: "s", title_pl: null, title_en: null }],
      error: null,
    });
    const { hits } = await quick.call({ q: "x" });
    expect(hits[0]).toMatchObject({ title_pl: "", title_en: "" });
  });

  it("brak wierszy daje pustą listę", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(quick.call({ q: "x" })).resolves.toEqual({ hits: [] });
  });
});

// ---------------------------------------------------------------------------
// semanticSearch - dokładka wektorowa do rankingu FTS
// ---------------------------------------------------------------------------

describe("semanticSearch - walidacja wejścia", () => {
  it("ODRZUCA frazę krótszą niż 4 znaki - dla niej wygra i tak sam FTS", () => {
    expect(() => semantic.validate({ q: "abc" })).toThrow();
    expect(semantic.validate({ q: "abcd" })).toEqual({ q: "abcd" });
  });

  it("ODRZUCA frazę dłuższą niż 200 znaków", () => {
    expect(() => semantic.validate({ q: "a".repeat(201) })).toThrow();
  });

  it("ODRZUCA limit spoza zakresu 1-100", () => {
    expect(() => semantic.validate({ q: "abcd", limit: 0 })).toThrow();
    expect(() => semantic.validate({ q: "abcd", limit: 101 })).toThrow();
  });
});

describe("semanticSearch - ścieżka pełna i degradacja", () => {
  it("embeduje frazę i woła semantic_search_posts z domyślnym limitem 40", async () => {
    const v = vector();
    h.embedTexts.mockResolvedValue([v]);
    h.rpc.mockResolvedValue({ data: [{ post_id: "p-1", similarity: 0.87 }], error: null });
    const { hits } = await semantic.call({ q: "polityka energetyczna" });
    expect(h.embedTexts).toHaveBeenCalledWith(["polityka energetyczna"]);
    expect(h.rpc).toHaveBeenCalledWith("semantic_search_posts", { _embedding: v, _limit: 40 });
    expect(hits).toEqual([{ post_id: "p-1", similarity: 0.87 }]);
  });

  it("normalizuje frazę do embedowania (przycięcie + małe litery)", async () => {
    // Fraza UNIKALNA w tym pliku: `queryCache` jest mapą MODUŁOWĄ, więc żyje
    // między testami tak samo, jak żyje między żądaniami w procesie serwera.
    await semantic.run({ q: "  Norma LIZOWANIE frazy  " });
    expect(h.embedTexts).toHaveBeenCalledWith(["norma lizowanie frazy"]);
  });

  it("CACHE: druga taka sama fraza nie kosztuje kolejnego wywołania bramki", async () => {
    await semantic.run({ q: "fraza cache jeden" });
    await semantic.run({ q: "FRAZA CACHE JEDEN" });
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("brak konfiguracji bazy degraduje do czystego FTS, bez wołania bramki", async () => {
    delete process.env.SUPABASE_URL;
    await expect(semantic.run({ q: "fraza bez bazy" })).resolves.toEqual({ hits: [] });
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it("BŁĄD BRAMKI AI nie wywraca wyszukiwarki - zwraca pustkę, nie wyjątek", async () => {
    h.embedTexts.mockRejectedValue(new Error("gateway 503"));
    await expect(semantic.run({ q: "fraza bledna bramka" })).resolves.toEqual({ hits: [] });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("pusta odpowiedź bramki też degraduje do czystego FTS", async () => {
    h.embedTexts.mockResolvedValue(null);
    await expect(semantic.run({ q: "fraza pusta bramka" })).resolves.toEqual({ hits: [] });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("odpowiedź bramki bez wektora także degraduje", async () => {
    h.embedTexts.mockResolvedValue([]);
    await expect(semantic.run({ q: "fraza bez wektora" })).resolves.toEqual({ hits: [] });
  });

  it("BŁĄD BAZY degraduje do czystego FTS", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    await expect(semantic.run({ q: "fraza blad bazy" })).resolves.toEqual({ hits: [] });
  });

  it("brak podobieństwa w wierszu liczy się jako zero, nie jako NaN", async () => {
    h.rpc.mockResolvedValue({ data: [{ post_id: "p-1", similarity: null }], error: null });
    const { hits } = await semantic.run({ q: "fraza null similarity" });
    expect(hits).toEqual([{ post_id: "p-1", similarity: 0 }]);
  });

  it("brak wierszy daje pustą listę", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(semantic.run({ q: "fraza brak wierszy" })).resolves.toEqual({ hits: [] });
  });
});

// ---------------------------------------------------------------------------
// embedPeopleQuery - wektor frazy dla katalogu osób
// ---------------------------------------------------------------------------

describe("embedPeopleQuery", () => {
  it("próg długości frazy jest WSPÓLNY ze stałą eksportowaną dla wołających", () => {
    expect(PEOPLE_SEMANTIC_MIN_CHARS).toBe(4);
    expect(() => people.validate({ q: "a".repeat(PEOPLE_SEMANTIC_MIN_CHARS - 1) })).toThrow();
    expect(people.validate({ q: "a".repeat(PEOPLE_SEMANTIC_MIN_CHARS) })).toBeTruthy();
  });

  it("ODRZUCA frazę dłuższą niż 200 znaków", () => {
    expect(() => people.validate({ q: "a".repeat(201) })).toThrow();
  });

  it("ODDAJE WEKTOR KLIENTOWI - katalog osób pyta bazę z sesji użytkownika", async () => {
    // Serwerowy klient anon nie ma `auth.uid()`, a `search_people` skaluje dane
    // po tenancie WOŁAJĄCEGO - dlatego serwer robi tylko to, czego klient nie
    // może zrobić bezpiecznie (trzyma klucz bramki), a zapytanie leci z sesji.
    const v = vector(0.5);
    h.embedTexts.mockResolvedValue([v]);
    await expect(people.call({ q: "ekspert energetyczny" })).resolves.toEqual({ embedding: v });
    // Server fn katalogu osób NIE woła bazy w ogóle.
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("normalizuje frazę przed embedowaniem", async () => {
    await people.run({ q: "  Ekspert AI  " });
    expect(h.embedTexts).toHaveBeenCalledWith(["ekspert ai"]);
  });

  it("CACHE: powtórzona fraza nie kosztuje kolejnego wywołania bramki", async () => {
    await people.run({ q: "osoby cache jeden" });
    await people.run({ q: "OSOBY CACHE JEDEN" });
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
  });

  it("BŁĄD BRAMKI daje embedding null - katalog schodzi na czysty trigram", async () => {
    h.embedTexts.mockRejectedValue(new Error("gateway 503"));
    await expect(people.run({ q: "osoby bledna bramka" })).resolves.toEqual({ embedding: null });
  });

  it("pusta odpowiedź bramki też daje null, a nie wyjątek", async () => {
    h.embedTexts.mockResolvedValue(null);
    await expect(people.run({ q: "osoby pusta bramka" })).resolves.toEqual({ embedding: null });
  });

  it("odpowiedź bez wektora daje null", async () => {
    h.embedTexts.mockResolvedValue([]);
    await expect(people.run({ q: "osoby bez wektora" })).resolves.toEqual({ embedding: null });
  });

  it("wektor zapytania NIE NIESIE cudzych danych - jest pochodną wpisanej frazy", async () => {
    const v = vector(0.9);
    h.embedTexts.mockResolvedValue([v]);
    const out = await people.run({ q: "fraza uzytkownika" });
    expect(h.embedTexts).toHaveBeenCalledWith(["fraza uzytkownika"]);
    expect(out.embedding).toBe(v);
  });
});
