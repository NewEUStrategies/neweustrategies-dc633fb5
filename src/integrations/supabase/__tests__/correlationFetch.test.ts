// @vitest-environment node
//
// ŚLAD AUDYTOWY "KLIK -> ZDARZENIA": nagłówek `x-correlation-id` dopinany do
// KAŻDEGO wywołania PostgREST/RPC (`fetchWithTenantHostAndCorrelation`).
//
// PO CO TEN PLIK ISTNIEJE. Ten wrapper jest jedynym miejscem, w którym
// identyfikator korelacji wychodzi z przeglądarki/SSR do bazy: po stronie DB
// `public.request_correlation_id()` czyta go z GUC `request.headers`, a emitery
// zapisują w `domain_events.correlation_id`. Jeśli nagłówek nie pojedzie,
// zdarzenia i tak powstaną - tylko BEZ powiązania z akcją użytkownika. Awaria
// jest więc CICHA: mutacja się udaje, UI nie protestuje, a ślad audytowy rwie
// się dokładnie w miejscu, w którym miał odpowiadać na pytanie „kto to zrobił
// i którym kliknięciem". Do 04.09.2026 plik miał 0,00% pokrycia (0/7 linii,
// 0/12 gałęzi, 0/1 funkcji): był wpinany do `createClient` w `client.ts`,
// a `client.ts` jest w testach powszechnie podmieniany atrapą, więc żaden
// przebieg nie wykonał tych siedmiu linii ani razu.
//
// CO JEST PRZEDMIOTEM DOWODU. Siedem linii tego pliku niesie dwanaście
// gałęzi - czyli prawie każda decyzja tu waży. Przybijamy cztery reguły:
//   1. BRAK korelacji = fetch przechodzi NIETKNIĘTY. Nie powstaje nawet obiekt
//      `Headers`: wrapper oddaje transportowi DOKŁADNIE te same argumenty
//      (dowód przez tożsamość `init`, nie przez porównanie zawartości).
//   2. Korelacja obecna = nagłówek dopięty tą wartością, którą widzi
//      `currentCorrelationId()` w chwili wywołania.
//   3. Nagłówek USTAWIONY PRZEZ WYWOŁUJĄCEGO ma pierwszeństwo (`if (!headers
//      .has(...))`). Nadpisywanie zabrałoby wywołującemu możliwość spięcia
//      wielu żądań jednym, własnym identyfikatorem - a to jest cały sens
//      korelacji przy operacjach wielozapytaniowych.
//   4. DWA KSZTAŁTY wywołania transportu, których nie wolno pomieszać:
//        * `input` jest `Request` i NIE MA `init` -> transport dostaje JEDEN
//          argument, nowy `Request` zbudowany z nagłówkami;
//        * w każdym innym przypadku -> DWA argumenty, `{ ...init, headers }`,
//          z zachowaniem pozostałych pól `init` (`method`, `body`, `signal`).
//      Zamiana tych kształtów nie jest kosmetyczna: `{ ...init }` przy
//      `init === undefined` na obiekcie `Request` gubiłoby metodę i ciało
//      żądania, czyli zamieniałoby mutację w odczyt.
//
// CZEGO TU NIE ATRAPUJEMY. `@/lib/realtime/correlationContext` jest PRAWDZIWY:
// stała `CORRELATION_HEADER`, stos korelacji i `runWithCorrelation` działają
// jak w produkcji, a testy wchodzą w stan „korelacja aktywna" tak samo jak
// mutacje w aplikacji - wywołując wrapper WEWNĄTRZ `runWithCorrelation`.
// Atrapa `currentCorrelationId` pozwoliłaby ustawić dowolną wartość, ale
// zerwałaby jedyne wiązanie, o które w tym pliku chodzi: że wrapper czyta ten
// sam stos, który zapisuje `runWithCorrelation`. Atrapowana jest WYŁĄCZNIE
// warstwa transportu (`./tenant-host-fetch`) - ona ma własny, zielony plik
// (`tenantHostFetch.test.ts`), a tutaj jest punktem obserwacyjnym: po jej
// argumentach poznajemy, co wrapper naprawdę wysłał.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchWithTenantHost: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  // Globalny `fetch` MUSI być atrapą: gdyby podmiana `./tenant-host-fetch` nie
  // złapała (np. po zmianie specyfikatora importu), prawdziwy transport
  // poszedłby do sieci. Ta atrapa rzuca, więc taka pomyłka jest czerwona,
  // a nie cicha.
  globalFetch: vi.fn(() => {
    throw new Error("test: żaden test w tym pliku nie ma prawa dotknąć sieci");
  }),
}));

vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: h.fetchWithTenantHost,
}));

import { CORRELATION_HEADER, runWithCorrelation } from "@/lib/realtime/correlationContext";
import { fetchWithTenantHostAndCorrelation } from "../correlation-fetch";

// --- dane syntetyczne -------------------------------------------------------

/** Identyfikator korelacji - syntetyczny, w kształcie UUID v4. */
const KORELACJA = "00000000-0000-4000-8000-0000000000c1";
/** Identyfikator, który wywołujący dopiął SAM, przed wejściem w wrapper. */
const KORELACJA_WYWOLUJACEGO = "00000000-0000-4000-8000-0000000000c2";
const URL_REST = "https://db.example.com/rest/v1/posts";
const KLUCZ_ANON = "anon-key-testowy";

/** Odpowiedź, którą oddaje atrapa transportu - do dowodu o wartości zwracanej. */
let odpowiedzTransportu: Response;

beforeEach(() => {
  vi.clearAllMocks();
  odpowiedzTransportu = new Response("ok");
  h.fetchWithTenantHost.mockResolvedValue(odpowiedzTransportu);
  vi.stubGlobal("fetch", h.globalFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- odczyt tego, co wrapper wysłał do transportu ---------------------------

/** Ostatnie wywołanie atrapy transportu razem z LICZBĄ argumentów. */
function ostatnieWywolanie(): [input: RequestInfo | URL, init?: RequestInit] {
  const calls = h.fetchWithTenantHost.mock.calls;
  expect(calls.length, "transport nie został wywołany").toBeGreaterThan(0);
  return calls[calls.length - 1];
}

/** Nagłówki, z jakimi poszłoby żądanie - z `init` albo z obiektu `Request`. */
function naglowki(): Headers {
  const [input, init] = ostatnieWywolanie();
  if (init?.headers) return new Headers(init.headers);
  if (input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

describe("kontrakt nagłówka", () => {
  it("nazwa nagłówka to dokładnie `x-correlation-id`", () => {
    // Nazwa jest przybita PO OBU stronach granicy: w bazie
    // `public.request_correlation_id()` czyta `request.headers ->> 'x-correlation-id'`.
    // Zmiana tej stałej w TypeScripcie nie wywala niczego w CI, a po stronie DB
    // po prostu przestaje trafiać - dlatego wartość jest tu asercją, nie
    // parametrem branym ze źródła w ciemno.
    expect(CORRELATION_HEADER).toBe("x-correlation-id");
  });
});

describe("bez aktywnej korelacji - żądanie przechodzi nietknięte", () => {
  it("oddaje transportowi TE SAME argumenty (bez budowania Headers)", async () => {
    // Poza `runWithCorrelation` `currentCorrelationId()` zwraca null. Dowód
    // przez TOŻSAMOŚĆ obiektu `init`: gdyby wrapper wchodził w ścieżkę
    // `{ ...init, headers }`, dostalibyśmy nową referencję. Chodzi o to, żeby
    // odczyty publiczne (a to większość ruchu) nie płaciły niczego za mechanizm
    // audytu, którego nie używają.
    const init: RequestInit = { method: "GET", headers: { apikey: KLUCZ_ANON } };

    const odpowiedz = await fetchWithTenantHostAndCorrelation(URL_REST, init);

    const [input, przekazanyInit] = ostatnieWywolanie();
    expect(ostatnieWywolanie()).toHaveLength(2);
    expect(input).toBe(URL_REST);
    expect(przekazanyInit).toBe(init);
    expect(naglowki().has(CORRELATION_HEADER)).toBe(false);
    expect(odpowiedz).toBe(odpowiedzTransportu);
    expect(h.globalFetch).not.toHaveBeenCalled();
  });

  it("bez `init` też nie dokłada niczego - transport dostaje `undefined`", async () => {
    // Wariant „gołego" wywołania: brak korelacji ORAZ brak `init`. Wrapper nie
    // ma prawa wymyślić tu obiektu opcji - supabase-js dokłada swoje nagłówki
    // wcześniej, a puste `{}` w tym miejscu zamazałoby ten fakt.
    await fetchWithTenantHostAndCorrelation(URL_REST);

    expect(ostatnieWywolanie()).toEqual([URL_REST, undefined]);
  });

  it("PUSTE id korelacji jest traktowane jak brak śladu", async () => {
    // `runWithCorrelation("")` wkłada na stos pusty łańcuch, więc
    // `currentCorrelationId()` oddaje wartość FAŁSZYWĄ i wrapper idzie ścieżką
    // przelotową. To jest zachowanie pożądane, nie niedopatrzenie: nagłówek
    // z pustą wartością zapisałby w `domain_events.correlation_id` puste id,
    // czyli ślad WYGLĄDAJĄCY na kompletny i bezużyteczny w śledztwie. Lepiej
    // nie zapisać nic i mieć widoczną dziurę.
    const init: RequestInit = { method: "POST" };

    await runWithCorrelation("", () => fetchWithTenantHostAndCorrelation(URL_REST, init));

    expect(ostatnieWywolanie()[1]).toBe(init);
    expect(naglowki().has(CORRELATION_HEADER)).toBe(false);
  });
});

describe("z aktywną korelacją - nagłówek dopięty", () => {
  it("id bierze się ze STOSU `runWithCorrelation`, nie z argumentu wywołania", async () => {
    // To jedyne wiązanie, które w tym pliku naprawdę się liczy: mutacja
    // opakowana w `runWithCorrelation` musi wysłać TO id. Gdyby wrapper czytał
    // inny stos (albo gdyby atrapa udawała stan), test byłby zielony przy
    // rozjechanym mechanizmie.
    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(URL_REST));

    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("`input` jako string zostaje przekazany bez zmian, opcje to samo `headers`", async () => {
    // Ścieżka `{ ...init, headers }` przy `init === undefined`: rozłożenie
    // `undefined` jest legalne i daje obiekt z JEDNYM polem. Asercja na liście
    // kluczy pilnuje, żeby wrapper nie zaczął tu dokładać własnych opcji
    // (`method`, `cache`), których wywołujący nie poprosił.
    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(URL_REST));

    const [input, init] = ostatnieWywolanie();
    expect(input).toBe(URL_REST);
    expect(Object.keys(init ?? {})).toEqual(["headers"]);
    expect(init?.headers).toBeInstanceOf(Headers);
  });

  it("`input` jako URL zostaje tym samym obiektem URL", async () => {
    // supabase-js woła fetch również z obiektem `URL`. Gdyby wrapper zamieniał
    // go na string (albo na `Request`), transport straciłby możliwość doklejenia
    // hosta tenanta tak, jak to robi dzisiaj.
    const url = new URL(URL_REST);

    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(url));

    const [input] = ostatnieWywolanie();
    expect(input).toBe(url);
    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("nagłówki wywołującego z `init.headers` zostają zachowane", async () => {
    // `apikey` i `Authorization` to nagłówki, bez których PostgREST odrzuca
    // żądanie. Dopięcie korelacji nie może ich zgubić - dlatego `new Headers`
    // dostaje źródło, a nie pusty obiekt.
    await runWithCorrelation(KORELACJA, () =>
      fetchWithTenantHostAndCorrelation(URL_REST, {
        headers: { apikey: KLUCZ_ANON, Authorization: "Bearer token-testowy" },
      }),
    );

    const naglowkiZadania = naglowki();
    expect(naglowkiZadania.get("apikey")).toBe(KLUCZ_ANON);
    expect(naglowkiZadania.get("authorization")).toBe("Bearer token-testowy");
    expect(naglowkiZadania.get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("pozostałe pola `init` (metoda, ciało) przechodzą nietknięte", async () => {
    // `init` BEZ `headers`: źródłem nagłówków jest wtedy `undefined`
    // (a nie `Request`, bo `input` jest stringiem). Kluczowe jest to, że
    // wrapper ROZKŁADA `init`, a nie podmienia: mutacja bez `method: "POST"`
    // i bez ciała byłaby zwykłym odczytem, więc zapis po prostu by nie nastąpił.
    const body = JSON.stringify({ title: "Wpis testowy" });

    await runWithCorrelation(KORELACJA, () =>
      fetchWithTenantHostAndCorrelation(URL_REST, { method: "POST", body }),
    );

    const [, init] = ostatnieWywolanie();
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("nagłówek USTAWIONY przez wywołującego NIE jest nadpisywany", async () => {
    // Pierwszeństwo wywołującego. Wywołujący, który sam spina kilka żądań
    // jednym identyfikatorem (import, migracja, operacja wsadowa), musi móc to
    // zrobić także wewnątrz `runWithCorrelation` - inaczej wrapper rozsypałby
    // mu ślad na tyle identyfikatorów, ile było zapytań.
    await runWithCorrelation(KORELACJA, () =>
      fetchWithTenantHostAndCorrelation(URL_REST, {
        headers: { [CORRELATION_HEADER]: KORELACJA_WYWOLUJACEGO },
      }),
    );

    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA_WYWOLUJACEGO);
  });
});

describe("kształt wywołania transportu - `Request` kontra `init`", () => {
  it("`Request` BEZ `init`: transport dostaje JEDEN argument - nowy Request", async () => {
    // Ścieżka `new Request(input, { headers })`. Dowód liczy ARGUMENTY, bo to
    // jedyna rzecz, która odróżnia ten kształt od drugiego: gdyby wrapper
    // poszedł tu przez `{ ...init, headers }`, `init` byłoby `{ headers }`
    // bez metody i ciała ORYGINALNEGO `Request`, czyli POST zamieniłby się
    // w GET, a zapis do bazy nie doszedłby do skutku.
    const zadanie = new Request(URL_REST, {
      method: "POST",
      headers: { apikey: KLUCZ_ANON },
      body: JSON.stringify({ title: "Wpis testowy" }),
    });

    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(zadanie));

    const wywolanie = ostatnieWywolanie();
    expect(wywolanie).toHaveLength(1);
    const [input] = wywolanie;
    expect(input).toBeInstanceOf(Request);
    // Nowy obiekt (nagłówków istniejącego `Request` nie da się dopisać),
    // ale ta sama treść żądania.
    expect(input).not.toBe(zadanie);
    if (!(input instanceof Request)) throw new Error("test: transport dostał inny kształt");
    expect(input.url).toBe(zadanie.url);
    expect(input.method).toBe("POST");
    expect(input.headers.get("apikey")).toBe(KLUCZ_ANON);
    expect(input.headers.get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("`Request` BEZ `init` z własnym nagłówkiem korelacji - wartość zostaje", async () => {
    // Przecięcie dwóch reguł: źródłem nagłówków jest `input.headers`,
    // a pierwszeństwo ma wywołujący.
    const zadanie = new Request(URL_REST, {
      headers: { [CORRELATION_HEADER]: KORELACJA_WYWOLUJACEGO },
    });

    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(zadanie));

    expect(ostatnieWywolanie()).toHaveLength(1);
    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA_WYWOLUJACEGO);
  });

  it("`Request` Z `init`: transport dostaje DWA argumenty, a `init` jest źródłem nagłówków", async () => {
    // Drugi kształt. `Request` zostaje TĄ SAMĄ referencją (transport dokłada
    // swoje nagłówki do `init`), a nagłówki biorą się z `init.headers` -
    // NIE z `Request`. Dowód przez kolizję: oba źródła podają `apikey` o innej
    // wartości, więc widać, które wygrało.
    const zadanie = new Request(URL_REST, { headers: { apikey: "klucz-z-requesta" } });
    const init: RequestInit = { method: "POST", headers: { apikey: "klucz-z-inita" } };

    await runWithCorrelation(KORELACJA, () => fetchWithTenantHostAndCorrelation(zadanie, init));

    const wywolanie = ostatnieWywolanie();
    expect(wywolanie).toHaveLength(2);
    expect(wywolanie[0]).toBe(zadanie);
    expect(wywolanie[1]).not.toBe(init);
    expect(wywolanie[1]?.method).toBe("POST");
    expect(naglowki().get("apikey")).toBe("klucz-z-inita");
    expect(naglowki().get(CORRELATION_HEADER)).toBe(KORELACJA);
  });

  it("odpowiedź transportu wraca do wywołującego bez zmian", async () => {
    // Wrapper jest przezroczysty dla odpowiedzi także na ścieżce z korelacją -
    // supabase-js czyta z niej status i ciało, więc podmiana obiektu zepsułaby
    // każde zapytanie.
    const odpowiedz = await runWithCorrelation(KORELACJA, () =>
      fetchWithTenantHostAndCorrelation(new Request(URL_REST)),
    );

    expect(odpowiedz).toBe(odpowiedzTransportu);
  });
});
