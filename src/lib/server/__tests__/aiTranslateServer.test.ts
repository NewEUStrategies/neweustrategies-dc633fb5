// Tłumaczenie segmentów PL->EN przez bramkę AI (`aiTranslate.server.ts`).
//
// PO CO TEN PLIK ISTNIEJE. Ten moduł tłumaczy TREŚĆ PUBLIKOWANĄ (artykuły,
// strony, bloki buildera) i do 04.09.2026 miał 0/42 linii i 0/6 funkcji.
// Zero pokrycia znaczyło tu, że najgroźniejsza awaria tego modułu przechodzi
// przez CI niezauważona: PRZESUNIĘTE TŁUMACZENIA. Model dostaje tablicę
// segmentów i musi oddać tablicę tej samej długości w tej samej kolejności;
// gdy oddaje o jeden mniej, a kod tego nie sprawdzi, każdy akapit dostaje
// tłumaczenie SĄSIADA - tekst wygląda poprawnie po angielsku i jest w całości
// nieprawdziwy. Komentarz :6-8 mówi wprost: lepszy retry niż przesunięcie.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   1. `chunkSegments` (czysta, eksportowana) - podział po budżecie znaków
//      z zachowaniem KOLEJNOŚCI i kompletności.
//   2. `translateSegmentsPlToEn` - brak wejścia i brak klucza kończą się BEZ
//      dotknięcia sieci, a wiele porcji leci SEKWENCYJNIE (:102-103: spójność
//      terminologii ważniejsza niż kilka sekund).
//   3. `stripFences` (prywatna, dowodzona przez wynik modelu) - odpowiedź
//      w ogrodzeniu kodu parsuje się tak samo jak bez niego.
//   4. Każdy twardy błąd kontraktu ODDZIELNIE, po komunikacie - to on trafia do
//      logu i po nim rozpoznaje się, czy retry ma sens.
//   5. Kształt żądania do bramki (model, temperatura, dwie wiadomości, nagłówek
//      autoryzacji).
//
// GRANICE, KTÓRE ATRAPUJEMY: WYŁĄCZNIE globalny `fetch` i `process.env`.
// BEZWZGLĘDNIE żaden test nie wychodzi do sieci i nie niesie prawdziwego
// klucza - `LOVABLE_API_KEY` to zawsze "test-key". PRAWDZIWE zostają
// `chunkSegments`, `translateChunk`, `stripFences`, `translateSegmentsPlToEn`,
// prompt systemowy i składanie ciała żądania: to one są przedmiotem dowodu.
//
// UWAGA O STAŁYCH MODUŁU. `GATEWAY_URL` i `MODEL` są czytane z `process.env`
// PRZY ŁADOWANIU MODUŁU (:9-11), więc `vi.stubEnv` ich już nie zmieni - i to
// jest powód, dla którego test przypina WARTOŚCI DOMYŚLNE. `LOVABLE_API_KEY`
// jest czytany w środku funkcji, więc jego podmiana działa per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkSegments, translateSegmentsPlToEn } from "@/lib/server/aiTranslate.server";

/** Domyślne stałe modułu - przypięte, bo repo nie ustawia tych zmiennych. */
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const CHUNK_CHAR_BUDGET = 24_000;

const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

// --- pomoc: odpowiedzi bramki ------------------------------------------------

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Poprawna odpowiedź modelu: czysta tablica JSON tłumaczeń. */
function translated(segments: readonly string[]): Response {
  return completion(JSON.stringify(segments));
}

function jsonBody(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Odpowiedź, z której nie da się odczytać ciała. Realna przy zerwanym
 * połączeniu w połowie strumienia - kod musi wtedy zbudować komunikat bez
 * szczegółu, a nie przewrócić się na odczycie szczegółu.
 */
function unreadableResponse(status: number): Response {
  const stub = {
    ok: false,
    status,
    text: () => Promise.reject(new Error("stream closed")),
    json: () => Promise.reject(new Error("stream closed")),
  };
  return stub as unknown as Response;
}

// --- pomoc: czytanie wysłanego żądania ---------------------------------------

interface GatewayRequestBody {
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
}

function isGatewayRequestBody(value: unknown): value is GatewayRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.model === "string" &&
    typeof row.temperature === "number" &&
    Array.isArray(row.messages)
  );
}

function bodyOf(call: number): GatewayRequestBody {
  const init = fetchMock.mock.calls[call]?.[1];
  const raw = init?.body;
  if (typeof raw !== "string") throw new Error(`test: żądanie ${call} nie ma ciała tekstowego`);
  const parsed: unknown = JSON.parse(raw);
  if (!isGatewayRequestBody(parsed)) throw new Error("test: nieoczekiwany kształt żądania");
  return parsed;
}

/** Segmenty wysłane w żądaniu nr `call` (treść wiadomości użytkownika). */
function sentSegments(call: number): unknown {
  return JSON.parse(bodyOf(call).messages[1].content);
}

function headersOf(call: number): Headers {
  return new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chunkSegments", () => {
  it("puste wejście daje pustą listę porcji", () => {
    // Brak porcji znaczy „nie ma o co pytać bramki". Jedna PUSTA porcja
    // byłaby płatnym żądaniem z tablicą zero segmentów.
    expect(chunkSegments([])).toEqual([]);
  });

  it("mieści całą treść w jednej porcji, gdy budżet na to pozwala", () => {
    expect(chunkSegments(["Pierwszy akapit.", "Drugi akapit."])).toEqual([
      ["Pierwszy akapit.", "Drugi akapit."],
    ]);
  });

  it("dzieli po budżecie znaków, zachowując kolejność segmentów", () => {
    // KOLEJNOŚĆ JEST TU CAŁĄ TREŚCIĄ. Wynik tłumaczenia jest sklejany z porcji
    // po kolei i wraca do wywołującego jako tablica indeksowana pozycją
    // segmentu - przetasowanie porcji przypisałoby akapitom obce tłumaczenia.
    expect(chunkSegments(["aaa", "bbb", "ccc", "ddd"], 6)).toEqual([
      ["aaa", "bbb"],
      ["ccc", "ddd"],
    ]);
  });

  it("segment dłuższy niż budżet trafia do WŁASNEJ porcji", () => {
    // Bez tego wyjątku (`current.length > 0` w warunku) pojedynczy długi
    // akapit dawałby porcję pustą i nieskończoną pętlę prób jego zmieszczenia.
    // Nadmiarowo długi segment jedzie sam - gateway sam powie, czy zmieścił.
    expect(chunkSegments(["ab", "x".repeat(50), "cd"], 5)).toEqual([
      ["ab"],
      ["x".repeat(50)],
      ["cd"],
    ]);
  });

  it("jedyny segment ponad budżet nadal daje jedną porcję, a nie zero", () => {
    expect(chunkSegments(["x".repeat(99)], 10)).toEqual([["x".repeat(99)]]);
  });

  it("nie gubi ani nie duplikuje segmentów przy dowolnym podziale", () => {
    // Asercja na SPŁASZCZENIU jest osobnym dowodem niż asercja na kształcie
    // porcji: podział wolno zmienić (budżet, heurystyka), zgubić segment - nie.
    const segments = Array.from({ length: 25 }, (_value, index) => `Segment ${index}`);

    expect(chunkSegments(segments, 30).flat()).toEqual(segments);
  });

  it("domyślny budżet obowiązuje przy wołaniu bez drugiego argumentu", () => {
    // Domyślna wartość parametru (:76) jest częścią kontraktu: tak woła
    // `chunkSegments` sama `translateSegmentsPlToEn`. Para segmentów po połowie
    // budżetu mieści się DOKŁADNIE (granica jest domykająca: `> budget`),
    // a jeden znak więcej wymusza drugą porcję - to przypina i wartość
    // domyślną, i stronę nierówności.
    const half = "x".repeat(CHUNK_CHAR_BUDGET / 2);

    expect(chunkSegments([half, half])).toHaveLength(1);
    expect(chunkSegments([half, half, "z"])).toHaveLength(2);
  });
});

describe("translateSegmentsPlToEn - warunki wstępne", () => {
  it("puste wejście zwraca pustą tablicę BEZ dotknięcia sieci", async () => {
    // Asercja na LICZBIE WYWOŁAŃ `fetch`, bo tylko ona odróżnia „nie było co
    // tłumaczyć" od „zapłacono za żądanie z pustą tablicą". Ta ścieżka jest
    // częsta: publikacja strony bez tekstowych bloków.
    await expect(translateSegmentsPlToEn([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak LOVABLE_API_KEY rzuca komunikatem DWUJĘZYCZNYM i nie woła bramki", async () => {
    // Komunikat trafia do panelu redakcyjnego, gdzie pracuje redakcja polska
    // i angielska - dlatego jest dwujęzyczny i dlatego jest przedmiotem
    // asercji. Wyjście do sieci bez klucza skończyłoby się 401 i komunikatem
    // „AI gateway 401", z którego nikt nie wywnioskuje braku konfiguracji.
    vi.stubEnv("LOVABLE_API_KEY", "");

    await expect(translateSegmentsPlToEn(["Tekst"])).rejects.toThrow(/brak LOVABLE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("komunikat o braku klucza niesie też część angielską", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");

    await expect(translateSegmentsPlToEn(["Tekst"])).rejects.toThrow(
      /AI translation unavailable/,
    );
  });
});

describe("translateSegmentsPlToEn - kształt żądania", () => {
  it("wysyła model, temperaturę i dwie wiadomości pod adres bramki", async () => {
    // Temperatura 0,2 to decyzja produktowa: tłumaczenie ma być powtarzalne,
    // a nie twórcze. Dwie wiadomości (system + user) to kontrakt promptu -
    // zlanie ich w jedną gubi reguły o zachowaniu tagów HTML i Markdownu.
    fetchMock.mockResolvedValue(translated(["First paragraph."]));

    await translateSegmentsPlToEn(["Pierwszy akapit."]);

    const body = bodyOf(0);
    expect(fetchMock.mock.calls[0][0]).toBe(GATEWAY_URL);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(body.model).toBe(MODEL);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("prompt systemowy nakazuje zachowanie tagów i stałą liczbę segmentów", async () => {
    // Te dwie reguły promptu odpowiadają dwóm twardym błędom niżej: bez nich
    // model zwraca komentarz albo zjada tag i cała partia idzie do retry.
    fetchMock.mockResolvedValue(translated(["First."]));

    await translateSegmentsPlToEn(["Pierwszy."]);

    const system = bodyOf(0).messages[0].content;
    expect(system).toContain("Preserve ALL inline HTML tags");
    expect(system).toContain("same length, same order");
  });

  it("segmenty jadą jako tablica JSON w wiadomości użytkownika", async () => {
    // Model MUSI dostać tablicę, nie zlepiony tekst: to tablica pozwala mu
    // oddać odpowiedź, którą da się przypisać do segmentów po indeksie.
    fetchMock.mockResolvedValue(translated(["First.", "Second."]));

    await translateSegmentsPlToEn(["Pierwszy.", "Drugi."]);

    expect(sentSegments(0)).toEqual(["Pierwszy.", "Drugi."]);
  });

  it("niesie klucz w nagłówku Authorization jako Bearer", async () => {
    fetchMock.mockResolvedValue(translated(["First."]));

    await translateSegmentsPlToEn(["Pierwszy."]);

    expect(headersOf(0).get("Authorization")).toBe("Bearer test-key");
    expect(headersOf(0).get("Content-Type")).toBe("application/json");
  });
});

describe("translateSegmentsPlToEn - wiele porcji", () => {
  /** Dwa segmenty po 20 000 znaków: budżet 24 000 wymusza dwie porcje. */
  const LONG_A = "a".repeat(20_000);
  const LONG_B = "b".repeat(20_000);

  it("scala wyniki porcji w JEDNEJ kolejności z wejściem", async () => {
    fetchMock
      .mockResolvedValueOnce(translated(["EN-A"]))
      .mockResolvedValueOnce(translated(["EN-B"]));

    await expect(translateSegmentsPlToEn([LONG_A, LONG_B])).resolves.toEqual(["EN-A", "EN-B"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentSegments(0)).toEqual([LONG_A]);
    expect(sentSegments(1)).toEqual([LONG_B]);
  });

  it("woła bramkę SEKWENCYJNIE, nie równolegle", async () => {
    // TO JEST TREŚĆ TEGO TESTU (komentarz :102-103). Równoległość byłaby
    // szybsza i BŁĘDNA: model utrzymuje spójność terminologii w obrębie
    // rozmowy, a gateway ma własne limity równoległości - dwa strzały naraz
    // kończą się 429 i retry całego artykułu. Znaczniki wejścia i wyjścia
    // rozstrzygają to jednoznacznie: `Promise.all` dałby [start, start, ...].
    const order: string[] = [];
    let index = 0;
    fetchMock.mockImplementation(async () => {
      const id = ++index;
      order.push(`start-${id}`);
      await Promise.resolve();
      order.push(`end-${id}`);
      return translated([`EN-${id}`]);
    });

    await translateSegmentsPlToEn([LONG_A, LONG_B]);

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("awaria DRUGIEJ porcji przerywa całość - nie oddaje połowy tłumaczenia", async () => {
    // Częściowy wynik byłby najgorszą z możliwych odpowiedzi: wywołujący
    // dostałby tablicę krótszą od wejścia i przypisał tłumaczenia do złych
    // segmentów. Rzut oddaje decyzję o retry wyżej.
    fetchMock
      .mockResolvedValueOnce(translated(["EN-A"]))
      .mockResolvedValueOnce(jsonBody({ error: "rate limited" }, 429));

    await expect(translateSegmentsPlToEn([LONG_A, LONG_B])).rejects.toThrow(/AI gateway 429/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("stripFences - odpowiedź modelu w ogrodzeniu kodu", () => {
  it("parsuje odpowiedź owiniętą w ```json", async () => {
    // Prompt zakazuje ogrodzeń, ale modele je dokładają - to najczęstsza
    // rozbieżność między instrukcją i zachowaniem. Bez zdjęcia płotków każda
    // taka odpowiedź lądowałaby jako „non-JSON", czyli cała publikacja
    // wywracałaby się na kosmetyce formatu.
    fetchMock.mockResolvedValue(completion('```json\n["First paragraph."]\n```'));

    await expect(translateSegmentsPlToEn(["Pierwszy akapit."])).resolves.toEqual([
      "First paragraph.",
    ]);
  });

  it("parsuje odpowiedź owiniętą w samo ``` (bez języka)", async () => {
    fetchMock.mockResolvedValue(completion('```\n["First."]\n```'));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).resolves.toEqual(["First."]);
  });

  it("parsuje odpowiedź BEZ ogrodzenia", async () => {
    // Ścieżka zgodna z promptem - musi działać tak samo, żeby zdejmowanie
    // płotków nie okazało się warunkiem poprawności.
    fetchMock.mockResolvedValue(completion('["First."]'));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).resolves.toEqual(["First."]);
  });

  it("znosi białe znaki wokół odpowiedzi i wokół ogrodzenia", async () => {
    fetchMock.mockResolvedValue(completion('\n\n```json\n\n  ["First."]  \n\n```\n'));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).resolves.toEqual(["First."]);
  });

  it("komentarz DOKLEJONY po ogrodzeniu jest błędem, a nie cichym obcięciem", async () => {
    // Ogrodzenie zdejmujemy tylko wtedy, gdy obejmuje CAŁĄ odpowiedź
    // (regex zakotwiczony na `$`). Model, który dopisał zdanie od siebie,
    // mógł też zmienić treść tablicy - lepszy twardy błąd i retry niż zgadywanie,
    // która część odpowiedzi jest tłumaczeniem.
    fetchMock.mockResolvedValue(completion('```json\n["First."]\n```\nHope this helps!'));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway returned non-JSON translation payload",
    );
  });
});

describe("translateSegmentsPlToEn - twarde błędy kontraktu", () => {
  it("odpowiedź nie-OK niesie status i szczegół z ciała", async () => {
    // Status i szczegół decydują o tym, czy retry ma sens (429/5xx) czy nie
    // (400/401). Bez nich w logu zostaje samo „tłumaczenie nie działa".
    fetchMock.mockResolvedValue(new Response("upstream model overloaded", { status: 503 }));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway 503: upstream model overloaded",
    );
  });

  it("szczegół błędu jest PRZYCIĘTY do 300 znaków", async () => {
    // Bramka potrafi oddać stronę HTML albo zrzut promptu. Bez limitu ten
    // szczegół idzie do logu przebiegu joba i do odpowiedzi endpointu - czyli
    // jeden błąd potrafiłby wypełnić kolumnę błędu megabajtem tekstu.
    fetchMock.mockResolvedValue(new Response("x".repeat(500), { status: 502 }));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      `AI gateway 502: ${"x".repeat(300)}`,
    );
  });

  it("nieczytelne ciało odpowiedzi nadal daje komunikat ze statusem", async () => {
    // `res.text()` potrafi odrzucić (zerwany strumień). Rzut Z WNĘTRZA obsługi
    // błędu zamieniłby rozpoznawalny „AI gateway 500" w losowy błąd sieci.
    fetchMock.mockResolvedValue(unreadableResponse(500));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow("AI gateway 500:");
  });

  it("pusta treść odpowiedzi to `empty completion`", async () => {
    // Model odpowiedział 200, ale nic nie napisał (filtr treści, ucięty
    // strumień). Bez tego sprawdzenia `JSON.parse(undefined)` dałby błąd
    // składni i mylącą diagnozę „model zwraca nie-JSON".
    fetchMock.mockResolvedValue(jsonBody({ choices: [{ message: { content: "" } }] }, 200));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway returned empty completion",
    );
  });

  it("brak `choices` w odpowiedzi też jest `empty completion`", async () => {
    fetchMock.mockResolvedValue(jsonBody({ usage: { total_tokens: 0 } }, 200));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway returned empty completion",
    );
  });

  it("treść nie-JSON to `non-JSON translation payload`", async () => {
    // Najczęstsza gadatliwość modelu: „Oto tłumaczenie:" przed tablicą.
    // Osobny komunikat, bo osobna przyczyna - do naprawy promptem, nie retry.
    fetchMock.mockResolvedValue(completion("Oto tłumaczenie: First."));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway returned non-JSON translation payload",
    );
  });

  it("poprawny JSON, który NIE jest tablicą, to `malformed translation array`", async () => {
    // Model potrafi oddać `{"translations": [...]}`. To poprawny JSON, więc
    // sprawdzenie kształtu musi być osobne - inaczej `parsed.length` byłoby
    // `undefined` i porównanie długości przepuściłoby taką odpowiedź.
    fetchMock.mockResolvedValue(completion('{"translations":["First."]}'));

    await expect(translateSegmentsPlToEn(["Pierwszy."])).rejects.toThrow(
      "AI gateway returned malformed translation array",
    );
  });

  it("tablica z elementem nie-string też jest `malformed`", async () => {
    // Element `null` albo obiekt trafiłby dalej jako treść publikowana
    // i wylądował w bazie jako „null" w polu angielskim.
    fetchMock.mockResolvedValue(completion('["First.", null]'));

    await expect(translateSegmentsPlToEn(["Pierwszy.", "Drugi."])).rejects.toThrow(
      "AI gateway returned malformed translation array",
    );
  });

  it("NIEZGODNA LICZBA segmentów jest twardym błędem z oboma licznikami", async () => {
    // TO JEST NAJWAŻNIEJSZA ASERCJA CAŁEGO PLIKU (komentarz :6-8). Model
    // zjadł jeden segment - gdyby kod tego nie sprawdził, każdy akapit od
    // miejsca zgubienia dostałby tłumaczenie SĄSIADA. Wynik czyta się po
    // angielsku bez zarzutu i jest w całości nieprawdziwy: to awaria, której
    // nikt nie zauważy przy przeglądzie, a która trafia do publikacji.
    // Oba liczniki w komunikacie są treścią - po nich widać skalę rozjazdu.
    fetchMock.mockResolvedValue(translated(["First."]));

    await expect(translateSegmentsPlToEn(["Pierwszy.", "Drugi."])).rejects.toThrow(
      "AI gateway returned 1 segments, expected 2",
    );
  });

  it("segment NADMIAROWY jest błędem dokładnie tak samo", async () => {
    // Kierunek rozjazdu nie ma znaczenia: model, który rozbił jeden akapit na
    // dwa, też zniszczył przypisanie tłumaczeń do segmentów.
    fetchMock.mockResolvedValue(translated(["First.", "Second.", "Third."]));

    await expect(translateSegmentsPlToEn(["Pierwszy.", "Drugi."])).rejects.toThrow(
      "AI gateway returned 3 segments, expected 2",
    );
  });

  it("zgodna liczba segmentów przechodzi - łącznie z pustym tłumaczeniem", async () => {
    // Kontrola liczby nie ma prawa odrzucać pustego stringa: segment
    // zawierający wyłącznie znacznik albo liczbę wraca z modelu bez zmiany
    // i to jest poprawna odpowiedź, a nie „brak tłumaczenia".
    fetchMock.mockResolvedValue(translated(["", "<b>2026</b>"]));

    await expect(translateSegmentsPlToEn(["", "<b>2026</b>"])).resolves.toEqual([
      "",
      "<b>2026</b>",
    ]);
  });
});
