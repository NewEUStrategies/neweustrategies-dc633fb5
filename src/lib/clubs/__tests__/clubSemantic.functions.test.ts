// WEKTOR FRAZY DLA WYSZUKIWARKI DYSKUSJI - dowód, że kosztowna bramka AI stoi
// za licznikiem, a jej awaria nie wywraca wyszukiwarki.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/clubs/clubSemantic.functions.ts` jest
// jedynym miejscem modułu klubów, w którym serwer sięga po PŁATNĄ bramkę
// embeddingów w imieniu użytkownika. Nagłówek tamtego pliku opisuje trzy
// decyzje: limit per konto liczony FAIL-CLOSED (awaria licznika ma odmawiać,
// nie otwierać budżet), cache fraz w pamięci procesu (debounce wyszukiwarki nie
// może kosztować wywołania na literę) i degradację do `embedding: null`
// (wołający schodzi wtedy na czysty FTS). Do tej pory był to OPIS, nie DOWÓD:
// plik miał 25,0% pokrycia linii, 0,0% gałęzi i 0 z 2 funkcji. Historia
// sąsiedniego pliku jest tu ostrzeżeniem - `embedClubQuery` stało kiedyś
// OTWARTE DLA ANONIMA (defekt K6, audyt 12.08), czyli dowolny gość drenował
// kwotę embeddingów.
//
// CO JEST PRZEDMIOTEM DOWODU. Cała ścieżka od wejścia do wyniku: walidator zod
// (próg długości frazy wspólny z wołającym hookiem, górna zapora 200 znaków),
// kolejność decyzji w handlerze (cache PRZED licznikiem, licznik PRZED bramką),
// argumenty licznika co do znaku, wszystkie cztery wyjścia `embedding: null`
// oraz wywłaszczanie najstarszej frazy z cache po przekroczeniu 300 wpisów.
// Cache i licznik są mierzone SKUTKIEM - liczbą wywołań bramki - a nie
// zaglądaniem do prywatnej mapy modułu.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` (`serverFnStubModule`) - `createServerFn` buduje
//     obiekt wywoływalny wyłącznie przez runtime frameworka; bez podmiany
//     fabryki ciało handlera jest z vitest nieosiągalne.
//   * `@/lib/server/embeddings.server` - to jest ta PŁATNA bramka. Atrapa jest
//     tu jednocześnie LICZNIKIEM: zdanie „trafienie w cache nic nie kosztuje"
//     da się udowodnić wyłącznie zdaniem „bramka nie została wywołana ani
//     razu". Żaden test nie wychodzi do sieci.
//   * `@/lib/server/rate-limit.server` - licznik stoi na RPC do Supabase
//     (`rate_limit_hit`), więc bez atrapy każdy przypadek pytałby bazę.
//
// GRANICA DOWODU - UCZCIWIE. Autoryzację („anonim nie przechodzi") egzekwuje
// middleware `requireSupabaseAuth`, którego atrapa `createServerFn` NIE
// URUCHAMIA. Ten plik nie mówi więc „obcy się nie dostanie"; mówi „funkcja
// DEKLARUJE to middleware" - testem strukturalnym na `asServerFn(...).middleware`.
// Egzekucji pilnują dwie inne warstwy: bramka `check:authz-snapshot`
// (`src/lib/authz/authzSnapshot.generated.ts`) i `clubEgressGuards.test.ts`.
// Tak samo z limitem: dowodzimy, że licznik jest PYTANY z właściwymi
// argumentami i że jego odmowa zatrzymuje wywołanie bramki - a nie tego, że
// `rate_limit_hit` liczy poprawnie (to ma własne pgTAP).
//
// UWAGA NA STAN MIĘDZY TESTAMI. `queryCache` żyje w module, a vitest izoluje
// graf modułów PER PLIK, nie per test - dlatego KAŻDY przypadek używa własnej,
// unikatowej frazy. Wspólna fraza w dwóch testach dałaby zieleń zależną od
// kolejności wykonania, czyli test, który niczego nie pilnuje.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ClubQueryEmbedding } from "@/lib/clubs/clubSemantic.functions";
import { asServerFn } from "@/test/serverFnHarness";
import { callServerFn } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn<(opts: unknown) => Promise<boolean>>(),
  embedTexts: vi.fn<(texts: readonly string[]) => Promise<number[][] | null>>(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/server/embeddings.server", () => ({ embedTexts: h.embedTexts }));

const { embedClubQuery, CLUB_SEMANTIC_MIN_CHARS } =
  await import("@/lib/clubs/clubSemantic.functions");
// Rozgrzewka: oba moduły handler ładuje dynamicznie (`await import`) w środku
// ścieżki, więc muszą siedzieć w cache modułów, zanim ruszy pierwszy przypadek.
await import("@/lib/server/rate-limit.server");
await import("@/lib/server/embeddings.server");

const spec = asServerFn(embedClubQuery);

/** Identyfikatory testowe - zmyślone UUID-y, żadnych danych osobowych. */
const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_USER_ID = "99999999-8888-4777-8666-555555555555";

const CONTEXT = { supabase: null, userId: USER_ID };

/** Wektor bramki. Wartości bez znaczenia - liczy się tożsamość obiektu. */
const vector = (seed = 0.1): number[] => Array.from({ length: 8 }, (_, i) => seed + i / 100);

async function embed(q: string, userId: string = USER_ID): Promise<ClubQueryEmbedding> {
  return callServerFn<ClubQueryEmbedding>(embedClubQuery, { q }, { supabase: null, userId });
}

/** Ostatni obiekt argumentów przekazany licznikowi. */
function lastLimitCall(): unknown {
  const call = h.rateLimit.mock.calls.at(-1);
  if (call === undefined) throw new Error("test: licznik nie został wywołany");
  return call[0];
}

beforeEach(() => {
  h.rateLimit.mockReset();
  h.rateLimit.mockResolvedValue(true);
  h.embedTexts.mockReset();
  h.embedTexts.mockResolvedValue([vector()]);
});

// ---------------------------------------------------------------------------

describe("obudowa funkcji serwerowej: kto może wołać i z czym", () => {
  it("deklaruje requireSupabaseAuth - anonim nie ma jak drenować kwoty embeddingów", () => {
    // GRANICA: atrapa `createServerFn` nie URUCHAMIA middleware, więc to jest
    // dowód na DEKLARACJĘ, nie na egzekucję. Egzekucji pilnuje bramka
    // `check:authz-snapshot`; tu chodzi o to, żeby ogniwo nie zniknęło cicho -
    // dokładnie ono było treścią defektu K6.
    expect(spec.middleware).toContain(requireSupabaseAuth);
  });

  it("jest metodą GET - policzenie wektora frazy niczego nie zmienia w bazie", () => {
    expect(spec.method).toBe("GET");
    expect(typeof spec.validator).toBe("function");
  });

  it("próg długości frazy jest WSPÓLNY ze stałą, którą czyta hook wyszukiwarki", () => {
    // `useClubModeration` włącza zapytanie dopiero od tej długości. Rozjazd
    // między stałą a schematem oznaczałby zapytanie odrzucane przez zod przy
    // każdym naciśnięciu klawisza - i lawinę czerwieni w konsoli użytkownika.
    expect(CLUB_SEMANTIC_MIN_CHARS).toBe(4);
    expect(() => spec.validator?.({ q: "a".repeat(CLUB_SEMANTIC_MIN_CHARS - 1) })).toThrow();
    expect(spec.validator?.({ q: "a".repeat(CLUB_SEMANTIC_MIN_CHARS) })).toEqual({ q: "aaaa" });
  });

  it("walidator PRZYCINA frazę, więc same spacje nie kupują sobie długości", () => {
    expect(spec.validator?.({ q: "  korytarz  " })).toEqual({ q: "korytarz" });
    expect(() => spec.validator?.({ q: "        " })).toThrow();
    expect(() => spec.validator?.({ q: "  ab  " })).toThrow();
  });

  it("górna zapora to 200 znaków - dłuższa fraza nie dojeżdża do płatnej bramki", () => {
    expect(spec.validator?.({ q: "a".repeat(200) })).toEqual({ q: "a".repeat(200) });
    expect(() => spec.validator?.({ q: "a".repeat(201) })).toThrow();
    expect(h.embedTexts).not.toHaveBeenCalled();
  });

  it("wejście złego typu i brak pola odpada na zod, a nie w środku handlera", () => {
    expect(() => spec.validator?.({})).toThrow();
    expect(() => spec.validator?.({ q: 1234 })).toThrow();
    expect(() => spec.validator?.({ q: null })).toThrow();
    expect(() => spec.validator?.({ q: ["fraza"] })).toThrow();
    expect(() => spec.validator?.(undefined)).toThrow();
  });
});

describe("kto płaci za bramkę AI: licznik przed wywołaniem", () => {
  it("licznik jest per konto, w kubełku klubowym, na 30/min i FAIL-CLOSED", async () => {
    await embed("limit argumenty kontraktu");

    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(lastLimitCall()).toEqual({
      // Myślnik w nazwie kubełka nie jest ozdobą - bramka `clubI18nKeys`
      // czytałaby `club.semantic` jako referencję do brakującego klucza.
      scope: "club.semantic-query",
      subjectId: USER_ID,
      max: 30,
      failClosed: true,
    });
  });

  it("odmowa licznika kończy się null i bramka NIE jest pytana ani razu", async () => {
    h.rateLimit.mockResolvedValue(false);

    await expect(embed("limit przekroczony automat")).resolves.toEqual({ embedding: null });
    expect(h.embedTexts).toHaveBeenCalledTimes(0);
  });

  it("kubełek jest wiązany z WOŁAJĄCYM, więc drugie konto ma własny limit", async () => {
    await embed("limit konto pierwsze", USER_ID);
    await embed("limit konto drugie", OTHER_USER_ID);

    expect(h.rateLimit.mock.calls).toHaveLength(2);
    expect(lastLimitCall()).toMatchObject({ subjectId: OTHER_USER_ID });
  });

  it("odmowa licznika NIE zatruwa cache - kolejne wywołanie znów pyta licznik", async () => {
    const fraza = "limit odmowa potem zgoda";
    h.rateLimit.mockResolvedValueOnce(false);

    await expect(embed(fraza)).resolves.toEqual({ embedding: null });
    const drugi = await embed(fraza);

    expect(drugi.embedding).not.toBeNull();
    expect(h.rateLimit).toHaveBeenCalledTimes(2);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
  });
});

describe("degradacja: co widzi wyszukiwarka, gdy bramki nie ma", () => {
  it("wyjątek bramki daje embedding null, a nie wyjątek u wołającego", async () => {
    h.embedTexts.mockRejectedValue(new Error("gateway 503"));

    await expect(embed("degradacja wyjatek bramki")).resolves.toEqual({ embedding: null });
  });

  it("brak bramki (null zamiast tablicy) też daje null", async () => {
    h.embedTexts.mockResolvedValue(null);

    await expect(embed("degradacja brak bramki")).resolves.toEqual({ embedding: null });
  });

  it("pusta tablica wektorów daje null - to nie jest wektor zerowy", async () => {
    h.embedTexts.mockResolvedValue([]);

    await expect(embed("degradacja pusta tablica")).resolves.toEqual({ embedding: null });
  });

  it("nieudana odpowiedź NIE ląduje w cache - następna próba znów pyta bramkę", async () => {
    const fraza = "degradacja nie zatruwa cache";
    h.embedTexts.mockResolvedValueOnce(null);

    await expect(embed(fraza)).resolves.toEqual({ embedding: null });
    const v = vector(0.7);
    h.embedTexts.mockResolvedValue([v]);

    await expect(embed(fraza)).resolves.toEqual({ embedding: v });
    expect(h.embedTexts).toHaveBeenCalledTimes(2);
  });
});

describe("co dostaje klient i czego w tym nie ma", () => {
  it("ODDAJE WEKTOR KLIENTOWI - RPC leci potem z sesji użytkownika, nie z anona", async () => {
    // `club_semantic_search` liczy widoczność per wiersz po `auth.uid()`
    // wołającego, więc serwer robi tylko to, czego klient nie może zrobić
    // bezpiecznie (trzyma klucz bramki), a zapytanie idzie z sesji.
    const v = vector(0.5);
    h.embedTexts.mockResolvedValue([v]);

    const wynik = await embed("wektor wraca do klienta");

    expect(wynik.embedding).toBe(v);
  });

  it("wektor jest pochodną WPISANEJ frazy - do bramki nie jedzie nic poza nią", async () => {
    await embed("Korytarz Transportowy");

    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    expect(h.embedTexts).toHaveBeenCalledWith(["korytarz transportowy"]);
  });

  it("normalizacja obcina spacje i sprowadza do małych liter przed embedowaniem", async () => {
    await embed("   Normalizacja SPACJE i Wielkosc   ");

    expect(h.embedTexts).toHaveBeenCalledWith(["normalizacja spacje i wielkosc"]);
  });
});

describe("cache fraz: debounce wyszukiwarki nie może kosztować na literę", () => {
  it("powtórzona fraza nie kosztuje drugiego wywołania bramki ANI drugiego licznika", async () => {
    const v = vector(0.3);
    h.embedTexts.mockResolvedValue([v]);

    const pierwszy = await embed("cache powtorzona fraza");
    const drugi = await embed("cache powtorzona fraza");

    expect(pierwszy.embedding).toBe(v);
    expect(drugi.embedding).toBe(v);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
    // Licznik to round-trip do bazy - trafienie w cache nie ma go kosztować.
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("klucz cache jest znormalizowany: inna wielkość liter i spacje to ta sama fraza", async () => {
    await embed("cache klucz znormalizowany");
    await embed("  CACHE Klucz ZNORMALIZOWANY  ");

    expect(h.embedTexts).toHaveBeenCalledTimes(1);
  });

  it("cache jest WSPÓLNY dla kont - wektor frazy nie niesie niczyich danych", async () => {
    // To nie jest wyciek: wektor jest pochodną frazy, którą wołający właśnie
    // wpisał. Widoczność wątków liczy dopiero RPC, po `auth.uid()` sesji.
    await embed("cache wspolny dla kont", USER_ID);
    await embed("cache wspolny dla kont", OTHER_USER_ID);

    expect(h.embedTexts).toHaveBeenCalledTimes(1);
  });

  it("po przekroczeniu 300 wpisów wypada NAJSTARSZA fraza, a najnowsze zostają", async () => {
    const sonda = "cache sonda najstarsza fraza";
    await embed(sonda);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);

    // 300 nowych fraz = pełna pojemność cache wstawiona PO sondzie, więc
    // sonda musi z niego wypaść niezależnie od tego, co wstawiły poprzednie
    // przypadki tego pliku (mapa wywłaszcza w kolejności wstawiania).
    for (let i = 0; i < 300; i += 1) {
      await embed(`cache wypelniacz numer ${i}`);
    }
    h.embedTexts.mockClear();

    await embed(sonda);
    expect(h.embedTexts).toHaveBeenCalledTimes(1);

    // Kontrola dodatnia: wywłaszczanie zdejmuje PO JEDNYM najstarszym wpisie,
    // a nie czyści całej mapy. Ponowne wstawienie sondy wyrzuciło wypełniacz
    // nr 0 (był najstarszy), więc nr 1 musi nadal siedzieć w cache.
    await embed("cache wypelniacz numer 1");
    expect(h.embedTexts).toHaveBeenCalledTimes(1);
  });
});
