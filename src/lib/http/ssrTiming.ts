// Czysta część telemetrii SSR (współdzielona przez grafy klienta i serwera):
// typy + budowa nagłówka Server-Timing. Część server-only (licznik round-tripów
// per żądanie na getRequest/WeakMap) żyje w `ssrTiming.server.ts` i jest
// ładowana WYŁĄCZNIE dynamicznie za bramką `import.meta.env.SSR` - statyczny
// import `@tanstack/react-start/server` z modułu osiągalnego w grafie klienta
// (documentCache.server -> start.ts) zatrzymuje build na import-protection.
//
// Obserwowalność cache'u dokumentów i TTFB (plan PSI 85/95, P0.4 = SC-1 z trzema
// poprawkami werdyktu): `nes-layer` (który poziom podał dokument) i `colo`
// (kolonia Cloudflare) w nagłówku, a w linii logu - licznik żądań izolatu
// (`isoReq`, flaga zimnego startu), `ray`, zgrubna klasa UA, flaga
// zdegradowanego MISS-a i `streamMs` (koniec body, mierzony owijką strumienia
// w `src/server.ts`). Wszystko tutaj to czyste funkcje: kształt nagłówka
// i linii jest testowalny bez runtime'u Workers.
//
// Poprawki po recenzji P0.4: owijka końca body ma bezpiecznik czasowy (linia
// nie ginie, gdy body nie skończy się w porę: nikt go nie czyta ani nie
// anuluje albo czytelnik jest bardzo wolny), linia niesie wynik odroczonego
// zapisu (`store`) i flagę `coldEntry` (żądanie weszło, zanim import entry się
// rozstrzygnął).
import { isBotUserAgent } from "./botFilter";

export interface SsrDbTiming {
  /** Liczba round-tripów HTTP do PostgREST/RPC w trakcie renderu. */
  count: number;
  /** Suma czasów wszystkich round-tripów (ms). Równoległe fale się nakładają,
   *  więc to miara KOSZTU, nie latencji ściany zegara. */
  totalMs: number;
}

/**
 * Faza potoku żądania mierzona ZEGAREM ŚCIENNYM, nie kosztem.
 *
 * PO CO OSOBNY TYP OBOK `SsrDbTiming`. Dotychczasowe `db;dur` mierzy WYŁĄCZNIE
 * plan anon (wspólny fetch klienta publicznego) i WYŁĄCZNIE sumę kosztów, a
 * nie czas ścienny. Poza jego zasięgiem zostaje cały odcinek PRZED routerem:
 * katalog tenantów i indeks przekierowań idą planem service-role, SZEREGOWO
 * (host -> tenant, potem reguły) i - co najważniejsze - PRZED konsultacją
 * NES Edge Cache, więc nawet gorące trafienie w cache dokumentów nie ratuje
 * czytelnika przed tym czekaniem.
 *
 * Skutek praktyczny przed tą zmianą: przy TTFB p75 = 2,5-3,2 s na produkcji
 * nagłówek `Server-Timing` pozwalał odróżnić render (`ssr;dur`) od reszty
 * (`app;dur` z `src/server.ts`), ale NIE pozwalał powiedzieć, czy ta reszta
 * to odczyt routingu na zimnym izolacie, czy sama sieć. Diagnoza sprowadzała
 * się więc do zgadywania - a zlecenie wydania mówi wprost: „zprofiluj,
 * wyszukaj zapytania > 500 ms".
 */
export interface SsrPhaseTiming {
  /**
   * Nazwa metryki Server-Timing. MUSI być tokenem (litery, cyfry, `-`, `_`) -
   * wartość z niedozwolonym znakiem psuje parsowanie CAŁEGO nagłówka
   * w przeglądarce, więc `buildServerTimingValue` takie wpisy odrzuca.
   */
  name: string;
  /** Czas ŚCIENNY fazy w ms. */
  durationMs: number;
}

/** Token metryki Server-Timing wg RFC 7230 (podzbiór, bezpiecznie wąski). */
const METRIC_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Poziom, który PODAŁ dokument: pamięć izolatu (`L1`), Cache API kolonii
 * (`L2`) albo pełny render (`render`). Status `nes-edge` mówi „czy z cache'a",
 * a dopiero warstwa mówi „z którego": HIT z L2 to świeży izolat grzany
 * kolonią, a nie gorący izolat - bez tego rozróżnienia udział zimnych izolatów
 * w HIT-ach jest niewidoczny.
 */
export type NesCacheLayer = "L1" | "L2" | "render";

const NES_CACHE_LAYERS: ReadonlySet<string> = new Set<NesCacheLayer>(["L1", "L2", "render"]);

function isNesCacheLayer(value: string | undefined): value is NesCacheLayer {
  return value !== undefined && NES_CACHE_LAYERS.has(value);
}

/**
 * Zbuduj wartość nagłówka Server-Timing dla dokumentu SSR: status NES Edge
 * Cache + czas renderu + (jeśli zmierzono) koszt bazy + (na HIT/STALE) wiek
 * serwowanego wpisu. Czysta funkcja - testowalna bez Response.
 */
export function buildServerTimingValue(
  status: string,
  renderMs?: number,
  db?: SsrDbTiming | null,
  /** Wiek wpisu cache w ms (HIT/STALE) - `nes-age;dur=` dla korelacji RUM:
   *  bez niego nie da się odróżnić świeżego trafienia od dokumentu z końca
   *  okna SWR przy analizie regresji LCP. */
  cacheAgeMs?: number,
  /**
   * Fazy potoku zmierzone zegarem ściennym (dziś: `edge-routing`). Dopisywane
   * NA KOŃCU i pomijane, gdy pusta - kolejność istniejących metryk i kształt
   * nagłówka dla wołających sprzed tej zmiany zostają bajt w bajt te same.
   */
  phases?: readonly SsrPhaseTiming[] | null,
  /**
   * Poziom, który podał dokument (`nes-layer;desc=`). Dopisywany NA SAMYM
   * KOŃCU i pomijany, gdy brak - jak fazy: nagłówek wołających sprzed tej
   * zmiany zostaje bajt w bajt ten sam, a `nes-edge` dalej stoi pierwszy.
   */
  layer?: NesCacheLayer | null,
): string {
  const parts = [`nes-edge;desc="${status}"`];
  if (typeof renderMs === "number" && Number.isFinite(renderMs) && renderMs >= 0) {
    parts.push(`ssr;dur=${renderMs.toFixed(1)}`);
  }
  if (
    db &&
    Number.isSafeInteger(db.count) &&
    db.count > 0 &&
    Number.isFinite(db.totalMs) &&
    db.totalMs >= 0
  ) {
    parts.push(`db;dur=${db.totalMs.toFixed(1)};desc="n=${db.count}"`);
  }
  if (typeof cacheAgeMs === "number" && Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0) {
    parts.push(`nes-age;dur=${Math.round(cacheAgeMs)}`);
  }
  for (const phase of phases ?? []) {
    // Nazwa spoza tokenu psuje parsowanie CAŁEGO nagłówka, więc pomijamy wpis
    // zamiast wypuścić go „jakoś" - telemetria nie może zepsuć diagnostyki,
    // której służy.
    if (!METRIC_NAME_RE.test(phase.name)) continue;
    if (!Number.isFinite(phase.durationMs) || phase.durationMs < 0) continue;
    parts.push(`${phase.name};dur=${phase.durationMs.toFixed(1)}`);
  }
  // Wartość spoza listy NIE trafia do nagłówka - opis w cudzysłowie przyjąłby
  // wszystko, ale RUM (P0.6) i zapytania logów mają dostać zamknięty słownik.
  if (layer && isNesCacheLayer(layer)) parts.push(`nes-layer;desc="${layer}"`);
  return parts.join(", ");
}

// ── Kolonia, ray, klasa UA (pola żądania, bez PII) ─────────────────────────

/** Kod kolonii Cloudflare = kod IATA lotniska (trzy wielkie litery). */
const COLO_RE = /^[A-Z]{3}$/;
/** `cf-ray`: identyfikator heksadecymalny, opcjonalnie z sufiksem kolonii. */
const RAY_RE = /^[0-9a-f]{8,32}(?:-[A-Z]{3})?$/i;

/**
 * Kolonia, która obsłużyła żądanie: `request.cf.colo` (Workers), a gdy go nie
 * ma (testy, dev, warstwa dispatch hostingu bez `cf`) - sufiks nagłówka
 * żądania `cf-ray` (`<id>-WAW`). Pole OPCJONALNE: null, gdy żadne źródło nie
 * daje poprawnego kodu - lepiej brak klucza niż śmieć w histogramie per colo.
 * Kolonia i tak jest publiczna (sufiks `cf-ray` w odpowiedzi), więc to nie PII.
 */
export function resolveRequestColo(cf: unknown, cfRay: string | null | undefined): string | null {
  if (typeof cf === "object" && cf !== null && "colo" in cf && typeof cf.colo === "string") {
    const colo = cf.colo.trim().toUpperCase();
    if (COLO_RE.test(colo)) return colo;
  }
  const ray = sanitizeRay(cfRay);
  if (!ray) return null;
  const dash = ray.lastIndexOf("-");
  if (dash < 0) return null;
  const suffix = ray.slice(dash + 1).toUpperCase();
  return COLO_RE.test(suffix) ? suffix : null;
}

/**
 * `cf-ray` żądania do linii logu - klucz korelacji z zewnętrznymi sondami
 * (curl/PSI: `time_starttransfer` po ray) i z innymi liniami tego samego
 * wywołania (np. `[ssr-resilient]`). Wszystko spoza kształtu ray-a odpada:
 * nagłówek od klienta poza Cloudflare jest dowolnym napisem.
 */
export function sanitizeRay(value: string | null | undefined): string | null {
  const ray = value?.trim() ?? "";
  return RAY_RE.test(ray) ? ray : null;
}

/**
 * Zgrubna klasa user-agenta - JEDYNA informacja o UA, która trafia do logu
 * (nigdy sam napis). `lighthouse` osobno, bo to on (PSI, Lighthouse CI) jest
 * celem planu i bo dostaje wariant dokumentu dla automatów (render `allReady`,
 * nie strumień) - MISS z tej klasy zasiewa cache wariantem bota.
 */
export type UaClass = "browser" | "bot" | "lighthouse";

const LIGHTHOUSE_UA_RE = /lighthouse|pagespeed/i;

export function classifyUserAgent(userAgent: string | null | undefined): UaClass {
  if (LIGHTHOUSE_UA_RE.test(userAgent ?? "")) return "lighthouse";
  // Ta sama lista co filtr beaconów: brak nagłówka też jest automatem.
  return isBotUserAgent(userAgent) ? "bot" : "browser";
}

/**
 * Wartość Server-Timing dopisywana w `src/server.ts` ZA nagłówkiem potoku
 * routera: czas startu entry, czas obsługi do oddania Response i (gdy znana)
 * kolonia. Kształt `server-init`/`app` bez zmian względem wersji sprzed
 * kolonii - bez kolonii wynik jest bajt w bajt dawnym napisem.
 *
 * ŚWIADOMIE BEZ metryki końca strumienia: nagłówki wychodzą PRZED body,
 * a trailerów HTTP tu nie ma, więc `streamMs` żyje wyłącznie w logu.
 */
export function buildEntryServerTimingValue(
  serverInitMs: number,
  appMs: number,
  colo?: string | null,
): string {
  const value = `server-init;dur=${serverInitMs}, app;dur=${appMs}`;
  return colo && COLO_RE.test(colo) ? `${value}, colo;desc="${colo}"` : value;
}

// ── Koniec strumienia body (streamMs) ──────────────────────────────────────

/** Jak skończył się strumień body: normalnie albo przerwaniem (błąd/anulowanie). */
export type BodyEndOutcome = "done" | "aborted";

export interface ObserveBodyEndOptions {
  /**
   * Bezpiecznik telemetrii (recenzja P0.4, MAJOR 1): po tylu ms od utworzenia
   * owijki koniec zgłasza się sam jako `aborted`, jeśli body do tej pory ani
   * się nie domknęło, ani nie zostało anulowane. Strumień płynie dalej
   * nietknięty - bezpiecznik zamyka WYŁĄCZNIE telemetrię, nie dokument.
   * Brak / wartość nieskończona / niedodatnia = bez bezpiecznika.
   */
  fuseMs?: number;
}

/**
 * Lustro strumienia `source`, które zgłasza JEDEN raz jego koniec: `done`
 * tuż PRZED domknięciem (jak `TransformStream.flush()` - kto doczytał body do
 * końca, ma już linię logu), `aborted` przy błędzie źródła albo NATYCHMIAST
 * przy anulowaniu przez konsumenta.
 *
 * DLACZEGO WŁASNY STRUMIEŃ CIĄGNIONY, A NIE `TransformStream` + `pipeTo`.
 * Przy `pipeTo` sygnał zerwania przychodzi dopiero wtedy, gdy rozstrzygnie się
 * anulowanie źródła - a źródłem dokumentu MISS jest gałąź `tee()` zapisu do
 * cache'a, której `cancel()` z definicji (Streams, ReadableStreamDefaultTee)
 * czeka, aż anulowana zostanie TAKŻE druga gałąź albo źródło się skończy.
 * Kolektor zapisu czyta swoją gałąź do końca renderu, więc zerwany klient
 * dostawałby linię logu po czasie renderu albo - przy wiszącym źródle - wcale.
 * Ciągnięcie z `highWaterMark: 0` daje to samo, co tożsamościowy transform:
 * te same obiekty Uint8Array, chunk czytany ze źródła dopiero na żądanie
 * konsumenta (backpressure bez zmian), a `cancel` dochodzi do źródła.
 *
 * Owijamy WYŁĄCZNIE gotową odpowiedź na zewnątrz egzekutora middleware
 * (`src/server.ts`, za `applyDeferredDocumentStore` i `guardDocumentResponse`)
 * - podmiana body wewnątrz łańcucha to mechanizm incydentu ~61 s (patrz
 * documentCache.server.ts). `onEnd` nie może zerwać strumienia: wyjątek
 * z telemetrii jest połykany.
 *
 * `onEnd` dla `done` może oddać thenable: czytelnik zobaczy wtedy `done`
 * dopiero po jego rozstrzygnięciu (odrzucenie połykane), więc kto doczytał
 * body, ma już linię logu także wtedy, gdy linia czeka na decyzję magazynu
 * (`src/server.ts`). Wołający odpowiada za to, żeby to czekanie było KRÓTKIE -
 * ono wstrzymuje koniec body czytelnika. `aborted` nigdy nie czeka.
 *
 * Bezpiecznik (`options.fuseMs`) zgłasza `aborted` sam: na Workers zerwanie
 * klienta nie gwarantuje, że `cancel()` się wykona, a body, którego nikt nie
 * czyta ani nie anuluje, nie dałoby linii wcale. Liczy się od utworzenia
 * owijki, a owijka idzie w tempie konsumenta, więc odpala też przy bardzo
 * wolnym czytelniku, który do tej pory nie doczytał: strumień płynie wtedy
 * dalej i dochodzi w całości, tylko telemetria ma już `aborted`. Flaga
 * `reported` gwarantuje jedno zgłoszenie niezależnie od tego, co przyjdzie
 * pierwsze.
 */
export function observeBodyEnd(
  source: ReadableStream<Uint8Array>,
  onEnd: (outcome: BodyEndOutcome) => unknown,
  options: ObserveBodyEndOptions = {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let reported = false;
  let fuse: ReturnType<typeof setTimeout> | undefined;
  const report = (outcome: BodyEndOutcome): PromiseLike<void> | undefined => {
    if (reported) return undefined;
    reported = true;
    if (fuse !== undefined) clearTimeout(fuse);
    fuse = undefined;
    try {
      const pending = onEnd(outcome);
      if (isThenable(pending)) return Promise.resolve(pending).then(noop, noop);
    } catch {
      /* telemetria nie może zerwać dokumentu */
    }
    return undefined;
  };
  const fuseMs = options.fuseMs;
  if (typeof fuseMs === "number" && Number.isFinite(fuseMs) && fuseMs > 0) {
    fuse = setTimeout(() => void report("aborted"), fuseMs);
  }
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          report("aborted");
          controller.error(error);
          return;
        }
        if (chunk.done) {
          const pending = report("done");
          if (pending) await pending;
          try {
            controller.close();
          } catch {
            /* konsument anulował w trakcie czekania na linię logu */
          }
          return;
        }
        controller.enqueue(chunk.value);
      },
      cancel(reason) {
        report("aborted");
        // Jak strażnik dokumentu: odrzucone anulowanie źródła nie ma dokąd
        // pójść (konsument już odszedł), więc nie wypuszczamy go wyżej.
        return reader.cancel(reason).catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function noop(): void {}

// ── Wynik odroczonego zapisu NES Edge Cache ────────────────────────────────

/**
 * Co magazyn dokumentów ZROBIŁ z MISS-em, który zarejestrował do zapisu
 * (recenzja P0.4, MAJOR 2). Zgłasza to `applyDeferredDocumentStore`
 * (documentCache.server.ts) w chwili decyzji:
 *   - `stored`   - wpis wylądował w L1 (L2 dopisuje się w tle),
 *   - `degraded` - polityka zapisu odmówiła: dyrektywa trasy zawęziła się na
 *                  granicy handlera albo dopiero W TRAKCIE strumieniowania,
 *   - `oversize` - dokument większy niż limit wpisu,
 *   - `failed`   - strumień renderu padł, zanim kopia się zebrała.
 * Słownik żyje tutaj, przy linii logu, żeby magazyn i linia mówiły tym samym
 * zamkniętym zbiorem wartości.
 */
export type DocumentStoreOutcome = "stored" | "degraded" | "oversize" | "failed";

const DOCUMENT_STORE_OUTCOMES: ReadonlySet<string> = new Set<DocumentStoreOutcome>([
  "stored",
  "degraded",
  "oversize",
  "failed",
]);

/**
 * Etap, na którym polityka zapisu odrzuciła MISS pełnego dokumentu (R7c):
 *   - `loader`  - `private, no-store` widoczne już w middleware (odporny
 *                 loader zdegradował render przed jego zwrotem),
 *   - `handler` - dyrektywa trasy zawężona dopiero na granicy handlera,
 *   - `stream`  - zawężona W TRAKCIE strumieniowania (np. chrome po flushu).
 * Ten sam słownik niesie pierścień decyzji (`degradedAt` w
 * documentCache.server.ts) i linia logu dokumentu.
 */
export type DegradationStage = "loader" | "handler" | "stream";

/** Etapy odkrywane PO decyzji middleware - zgłasza je `applyDeferredDocumentStore`. */
export type LateDegradationStage = Exclude<DegradationStage, "loader">;

const DEGRADATION_STAGES: ReadonlySet<string> = new Set<DegradationStage>([
  "loader",
  "handler",
  "stream",
]);

// ── Log dokumentu do Workers Logs (audyt 0.1 / F40) ─────────────────────────
//
// Warstwa hostingu ZDEJMUJE `Server-Timing` i `x-nes-cache` z odpowiedzi
// wychodzącej, więc rozkład TTFB na fazy (start izolatu, routing krawędziowy,
// render, baza) i udział HIT/STALE/MISS/BYPASS w ruchu nie docierają ani do
// przeglądarki, ani do RUM. Jedynym miejscem, w którym te liczby przeżywają,
// jest strumień logów Workers - stąd jedna linia JSON per dokument HTML,
// budowana tu jako czysta funkcja, żeby jej kształt był testowalny bez
// runtime'u i żeby `src/server.ts` nie parsował nagłówka „na miejscu".

/** Jedna metryka nagłówka Server-Timing po sparsowaniu. */
export interface ServerTimingEntry {
  name: string;
  /** `dur=` w ms; brak, gdy metryka jest sama nazwą lub `dur` nie jest liczbą. */
  durationMs?: number;
  /** `desc=` bez cudzysłowów. */
  description?: string;
}

/**
 * Parser Server-Timing wystarczający dla nagłówków, które SAMI wystawiamy
 * (`buildServerTimingValue` + `server-init`/`app` z `src/server.ts`): metryki
 * po przecinku, parametry po średniku, `desc` w cudzysłowach. Przecinek
 * wewnątrz cudzysłowu nie rozcina metryki. Nigdy nie rzuca - wpis, którego nie
 * da się odczytać, jest pomijany, bo log nie może zerwać potoku dokumentu.
 */
export function parseServerTiming(header: string | null | undefined): ServerTimingEntry[] {
  if (!header) return [];
  const metrics: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      metrics.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  metrics.push(current);

  const out: ServerTimingEntry[] = [];
  for (const raw of metrics) {
    const [name, ...params] = raw.split(";").map((part) => part.trim());
    if (!name || !METRIC_NAME_RE.test(name)) continue;
    const entry: ServerTimingEntry = { name };
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq < 0) continue;
      const key = param.slice(0, eq).trim().toLowerCase();
      const value = param
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
      if (key === "dur") {
        const dur = Number.parseFloat(value);
        if (Number.isFinite(dur) && dur >= 0) entry.durationMs = dur;
      } else if (key === "desc") {
        entry.description = value;
      }
    }
    out.push(entry);
  }
  return out;
}

/** Linia logu dokumentu - klucze stałe, żeby zapytania w Workers Logs były proste. */
export interface DocumentLogLine {
  kind: "doc";
  /** Sama ścieżka: bez query string, bez hosta - zero PII i zero tokenów z `?`. */
  path: string;
  status: number;
  /**
   * Status NES Edge Cache z `x-nes-cache` (HIT/STALE/MISS/BYPASS) albo null.
   * Null ma też strona 500 ze ścieżki `catch` w `src/server.ts` - dla KAŻDEGO
   * żądania, które tam padło (także /api i zasoby idące przez worker), bo
   * strona błędu to HTML.
   */
  cache: string | null;
  /** Czy to syntetyczne odświeżenie wpisu w tle, a nie żądanie czytelnika. */
  revalidation: boolean;
  serverInitMs: number;
  appMs: number;
  /**
   * Od wejścia żądania do KOŃCA body (ta sama baza co `appMs`), mierzone
   * owijką strumienia w `src/server.ts`; `streamMs - appMs` = ogon
   * strumieniowania. Brak klucza: odpowiedź bez body (HEAD, 204), strona 500
   * ze ścieżki `catch` (body to napis) albo rewalidacja w tle (nikt jej nie
   * czyta). Po bezpieczniku owijki ≈ `appMs` + 22 000: bezpiecznik liczy się
   * od powrotu handlera, a `streamMs` od wejścia żądania. Linie bezpiecznika
   * rozpoznaje więc `streamEnd: "aborted"` ze `streamMs - appMs` ≈ 22 000,
   * nie samo `streamMs`.
   */
  streamMs?: number;
  /**
   * Tylko gdy body NIE domknęło się normalnie: zerwanie klienta, błąd źródła
   * albo bezpiecznik (body niedoczytane do końca w 22 s od powrotu handlera:
   * nikt go nie czyta ani nie anuluje albo czytelnik jest bardzo wolny -
   * wtedy dokument dochodzi później w całości, a linia zostaje `aborted`).
   */
  streamEnd?: "aborted";
  /** Poziom, który podał dokument (`nes-layer` z Server-Timing potoku). */
  layer?: NesCacheLayer;
  /** Kolonia Cloudflare (`request.cf.colo` albo sufiks `cf-ray`). */
  colo?: string;
  /**
   * Numer żądania w tym izolacie (1 = pierwsze = zimny start). Brak klucza na
   * rewalidacji w tle - ona nie jest żądaniem, które przyszło do izolatu.
   */
  isoReq?: number;
  /**
   * Sekundy od PIERWSZEGO żądania tego izolatu (znacznik brany leniwie przy
   * pierwszym żądaniu, nie w zasięgu modułu: zegar Workers nie biegnie
   * w czasie czystej pracy CPU, więc „wiek modułu" byłby fikcją).
   */
  isoAgeS?: number;
  /**
   * Czy żądanie weszło, zanim import bundla entry się rozstrzygnął. Przy
   * współbieżnym zimnym starcie wszystkie żądania czekające na ten sam import
   * płacą zimny start, a `isoReq == 1` ma tylko pierwsze. Obok `isoReq`, z tym
   * samym brakiem klucza na rewalidacji w tle.
   */
  coldEntry?: boolean;
  /** Zgrubna klasa UA - nigdy sam napis user-agenta. */
  uaClass?: UaClass;
  /**
   * `cf-ray` żądania: klucz korelacji z sondami zewnętrznymi i liniami
   * wywołania. Rewalidacja w tle niesie `ray` żądania, które ją wyzwoliło
   * (linii STALE albo zdegradowanego MISS-a czytelnika), więc jedna wartość
   * `ray` to wtedy dwie linie - deduplikacja po `ray` musi rozróżniać
   * `revalidation`.
   */
  ray?: string;
  /**
   * Tylko dla MISS-a pełnego dokumentu (200, HTML): czy render wyszedł
   * zdegradowany, czyli polityka zapisu odmówiła mu wspólnego cache'a -
   * z nagłówków (`private, no-store` z odpornego loadera) ALBO z decyzji
   * magazynu (`store: "degraded"`, dyrektywa zawężona w trakcie
   * strumieniowania). Ta sama definicja co odświeżenie po degradacji
   * w documentCache.server.ts. KTÓRY loader się zdegradował, mówi linia
   * `[ssr-resilient] ... for <etykieta>` z tego samego wywołania (korelacja
   * po wywołaniu Workers / `ray`). Gdy linia nie ma `store`, `degraded`
   * pochodzi wyłącznie z nagłówków. MISS 200 bez `streamEnd`, z `degraded:
   * false` i bez `store` znaczy: decyzja magazynu była nieznana w chwili
   * zapisu linii (typowo strażnik domknął body, gdy render jeszcze trwał),
   * więc degradacji odkrytej później ta linia nie widzi.
   */
  degraded?: boolean;
  /**
   * Tylko przy `degraded: true`: etap degradacji (`DegradationStage`, R7c).
   * `loader` - nagłówki zdegradowane już w middleware; `handler`/`stream` -
   * decyzja magazynu (`store: "degraded"`). KTÓRY loader, mówi nadal linia
   * `[ssr-resilient]` z tego samego wywołania.
   */
  degradedAt?: DegradationStage;
  /**
   * Wynik samotestu L2 izolatu, który obsłużył dokument (R7b): `true` - nazwany
   * cache (albo `caches.default`) przeszedł zapis i odczyt, `false` - nie
   * przeszedł i L2 jest w tym izolacie wyłączone. Brak klucza: samotest trwa
   * albo nie dotyczy (runtime bez `caches.open`, poza Workers). Bez tego pola
   * brak `layer: "L2"` nie odróżnia martwego magazynu od braku wpisu.
   */
  l2Verified?: boolean;
  /**
   * Wynik odroczonego zapisu (`DocumentStoreOutcome`), gdy magazyn
   * zarejestrował ten MISS do zapisu i decyzja zapadła przed linią. Brak
   * klucza: odpowiedź nie była kandydatem do zapisu (HIT, BYPASS, `no-store`
   * z nagłówków) albo linia wyszła wcześniej (zerwanie, bezpiecznik,
   * zamknięcie wymuszone przez strażnika, gdy render wciąż trwa).
   */
  store?: DocumentStoreOutcome;
  edgeRoutingMs?: number;
  ssrMs?: number;
  dbMs?: number;
  dbCount?: number;
}

/** Próbka licznika izolatu z `src/server.ts` (patrz `isoReq`/`isoAgeS`/`coldEntry`). */
export interface IsolateSample {
  isoReq: number;
  isoAgeS: number;
  coldEntry?: boolean;
}

export interface DocumentLogInput {
  path: string;
  status: number;
  cacheStatus: string | null | undefined;
  /** Wartość nagłówka Server-Timing zbudowana przez potok routera. */
  serverTiming: string | null | undefined;
  serverInitMs: number;
  appMs: number;
  revalidation?: boolean;
  streamMs?: number;
  streamEnd?: BodyEndOutcome;
  colo?: string | null;
  isolate?: IsolateSample | null;
  /** Surowy nagłówek `user-agent` - do logu trafia WYŁĄCZNIE jego klasa. */
  userAgent?: string | null;
  /** Surowy nagłówek `cf-ray` - do logu trafia tylko po walidacji kształtu. */
  cfRay?: string | null;
  degraded?: boolean;
  /** Etap degradacji - do linii trafia tylko przy `degraded: true` i ze słownika. */
  degradedAt?: DegradationStage | null;
  /** Wynik samotestu L2 izolatu; null/undefined = trwa albo nie dotyczy. */
  l2Verified?: boolean | null;
  /** Wynik odroczonego zapisu - do linii trafia tylko wartość ze słownika. */
  storeOutcome?: DocumentStoreOutcome | null;
}

/** Ścieżka w logu ma górny limit - URL od klienta może mieć kilobajty. */
const LOG_PATH_MAX = 2048;

/**
 * Zbuduj linię logu dokumentu. Fazy z Server-Timing są opcjonalne: brak
 * metryki = brak klucza (nie zero), żeby w logach dało się odróżnić „render
 * trwał 0 ms" od „tego żądania render nie dotyczył" (HIT z cache).
 * `dbCount` czyta `desc="n=18"` metryki `db` - kontrakt `buildServerTimingValue`.
 * Ta sama zasada dla pól żądania: brak/nieczytelne źródło = brak klucza.
 */
export function buildDocumentLogLine(input: DocumentLogInput): DocumentLogLine {
  const line: DocumentLogLine = {
    kind: "doc",
    path: input.path.slice(0, LOG_PATH_MAX),
    status: input.status,
    cache: input.cacheStatus || null,
    revalidation: input.revalidation === true,
    serverInitMs: safeMs(input.serverInitMs),
    appMs: safeMs(input.appMs),
  };
  if (typeof input.streamMs === "number") line.streamMs = safeMs(input.streamMs);
  if (input.streamEnd === "aborted") line.streamEnd = "aborted";
  for (const entry of parseServerTiming(input.serverTiming)) {
    if (entry.name === "edge-routing" && entry.durationMs !== undefined) {
      line.edgeRoutingMs = entry.durationMs;
    } else if (entry.name === "ssr" && entry.durationMs !== undefined) {
      line.ssrMs = entry.durationMs;
    } else if (entry.name === "db" && entry.durationMs !== undefined) {
      line.dbMs = entry.durationMs;
      const count = /^n=(\d+)$/.exec(entry.description ?? "");
      if (count) line.dbCount = Number.parseInt(count[1], 10);
    } else if (entry.name === "nes-layer" && isNesCacheLayer(entry.description)) {
      line.layer = entry.description;
    }
  }
  if (input.colo && COLO_RE.test(input.colo)) line.colo = input.colo;
  const isolate = input.isolate;
  if (isolate && Number.isSafeInteger(isolate.isoReq) && isolate.isoReq > 0) {
    line.isoReq = isolate.isoReq;
    line.isoAgeS = Math.round(safeMs(isolate.isoAgeS));
    if (typeof isolate.coldEntry === "boolean") line.coldEntry = isolate.coldEntry;
  }
  if (input.userAgent !== undefined) line.uaClass = classifyUserAgent(input.userAgent);
  const ray = sanitizeRay(input.cfRay);
  if (ray) line.ray = ray;
  if (typeof input.degraded === "boolean") line.degraded = input.degraded;
  if (line.degraded === true && input.degradedAt && DEGRADATION_STAGES.has(input.degradedAt)) {
    line.degradedAt = input.degradedAt;
  }
  if (typeof input.l2Verified === "boolean") line.l2Verified = input.l2Verified;
  const store = input.storeOutcome;
  if (store && DOCUMENT_STORE_OUTCOMES.has(store)) line.store = store;
  return line;
}

function safeMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
