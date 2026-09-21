// Strażnik strumienia DOKUMENTU SSR - ostatnia, transportowa linia obrony
// przed wiszącą odpowiedzią HTML (server-only, zero zależności poza Web API).
//
// PROBLEM (incydent "operator płatności widzi offline", 2026-07-30): produkcyjny potok
// TanStack Start trzyma strumień odpowiedzi otwarty do rozstrzygnięcia
// serializacji seroval (`transformStreamWithRouter` -> `tryFinish`). Gdy
// jakikolwiek asynchroniczny element payloadu się nie domyka, framework ubija
// strumień DOPIERO swoim wewnętrznym limitem `DEFAULT_SERIALIZATION_TIMEOUT_MS`
// = 60 000 ms - i to błędem (`controller.error`), nie zamknięciem. Efekt:
// każda strona odpowiada "kompletnie" po ~61 s, a monitor/bot (operator płatności,
// health-check) rozłącza się dużo wcześniej i raportuje stronę jako offline.
// Wewnętrzni strażnicy (queryTimeout 5 s, queryStreamGuard <=10 s) pilnują
// WŁASNYCH strumieni, ale żaden nie pilnował samej odpowiedzi HTTP.
//
// SOLUTION: opakowujemy body KAŻDEJ odpowiedzi text/html w strumień, który
// jest naszą własnością i który zamykamy deterministycznie:
//   * źródło zamyka się samo -> zamykamy (happy path, bajt w bajt identycznie),
//   * sentinel `</html>` widoczny w strumieniu -> dokument jest kompletny;
//     dajemy źródłu krótką łaskę (grace) na naturalne domknięcie i zamykamy
//     sami - to zamienia 61-sekundowy ogon w ~ćwierć sekundy,
//   * cisza między chunkami (idle) -> wewnętrzne budżety (5-10 s) już dawno
//     minęły, nic więcej nie przyjedzie; dosztukowujemy domykający ogon
//     `</body></html>` (dokument parsowalny dla crawlera) POPRZEDZONY sygnaturą
//     `<!--ssr-doc-guard:truncated ...-->`, żeby ucięcie dało się rozpoznać
//     w teście, w logu i w podglądzie źródła strony, i zamykamy,
//   * twardy limit (max) -> zamykamy bezwarunkowo.
// Każde wymuszone zamknięcie anuluje czytnik źródła (upstream sprząta swoje
// zasoby przez własny `cancel` -> `serverSsr.cleanup`) i zostawia głośny ślad
// w logach + w pierścieniu diagnostycznym (per host tenanta i ścieżka).
//
// Ważne właściwości:
//   * zero buforowania - chunki przechodzą nietknięte (ta sama Uint8Array),
//   * skan sentinela jest strumieniowy, bajtowy i bez kopii chunków
//     (case-insensitive, z 6-bajtowym przeniesieniem między chunkami),
//   * drabinka budżetów SSR pozostaje spójna: queryTimeout (5 s)
//     < queryStreamGuard.maxMs (10 s) < DOC_GUARD_IDLE_MS (12 s)
//     < DOC_GUARD_MAX_MS (20 s) << framework (60 s) - strażnik dokumentu
//     zamyka odpowiedź dopiero, gdy warstwy wewnętrzne miały swoją szansę,
//   * kill-switch środowiskowy: SSR_DOC_GUARD=off (+ nastawy przez env).
//
// Wpięcie: src/server.ts (produkcyjny entry workera) - patrz tamtejszy fetch.

/** Bajty sentinela "</html>" (litery porównywane case-insensitive). */
const HTML_END_SENTINEL = [60, 47, 104, 116, 109, 108, 62] as const;
const SENTINEL_LENGTH = HTML_END_SENTINEL.length;
/**
 * Maska case-insensitive policzona RAZ: 0x20 dla liter, 0 dla `<`, `/`, `>`.
 * Skaner robi wtedy jedno `|` na bajt, bez sprawdzania "czy to litera".
 */
const SENTINEL_MASK = HTML_END_SENTINEL.map((byte) =>
  byte >= 97 && byte <= 122 ? 32 : 0,
) as readonly number[];

const ENCODER = new TextEncoder();

/**
 * Sygnatura dokumentu UCIĘTEGO, wstawiana w dosztukowany ogon.
 *
 * PO CO: sam ogon `</body></html>` czyni dokument parsowalnym dla crawlera - i
 * dokładnie dlatego czyni go NIEODRÓŻNIALNYM od dokumentu kompletnego. Bramka
 * e2e "HTML kończy się `</html>`" nie mogła więc zafailować NIGDY: strażnik
 * dopisywał końcówkę, której test szukał (audyt 2026-08-06, wiersz "Bramka
 * kompletności SSR"). Komentarz HTML jest niewidoczny dla użytkownika i
 * ignorowany przez parsery, a jednocześnie daje maszynowo pewny dowód, że
 * dokument został domknięty przez strażnika - dla testów, logów i diagnostyki
 * produkcyjnej ("dlaczego ta strona nie ma hydratacji").
 */
export const DOC_GUARD_TRUNCATION_MARKER = "<!--ssr-doc-guard:truncated";

/** Nagłówek: ten dokument PRZESZEDŁ przez strażnika (bramka e2e sprawdza uzbrojenie). */
export const DOC_GUARD_HEADER = "x-ssr-doc-guard";

/** Ogon domykający dokument ucięty w połowie - crawler dostaje parsowalny HTML. */
function forcedCloseTail(
  reason: DocumentGuardCloseReason,
  elapsedMs: number,
  bytes: number,
): string {
  return (
    `\n${DOC_GUARD_TRUNCATION_MARKER} reason="${reason}" ms="${elapsedMs}" bytes="${bytes}"-->` +
    "\n</body></html>"
  );
}

/** Po sentinelu dokument jest kompletny - tyle łaski ma źródło na samodzielne domknięcie. */
export const DOC_GUARD_SENTINEL_GRACE_MS = 250;
/**
 * Cisza między chunkami po pierwszym bajcie. Musi być DŁUŻSZA niż wszystkie
 * wewnętrzne budżety potoku (queryTimeout 5 s, queryStreamGuard.maxMs 10 s),
 * żeby strażnik dokumentu był ostatnią deską ratunku, nie pierwszą.
 */
export const DOC_GUARD_IDLE_MS = 12_000;
/** Twardy sufit życia strumienia odpowiedzi, liczony od utworzenia strażnika. */
export const DOC_GUARD_MAX_MS = 20_000;

export type DocumentGuardCloseReason =
  "source" | "error" | "sentinel" | "idle" | "timeout" | "cancel";

export interface DocumentStreamGuardOptions {
  /** Łaska po sentinelu `</html>` na naturalne zamknięcie źródła. */
  sentinelGraceMs?: number;
  /** Maksymalna cisza między chunkami (uzbrajana po pierwszym bajcie). */
  idleMs?: number;
  /** Absolutny sufit życia strumienia. */
  maxMs?: number;
  /** Etykieta diagnostyczna - host tenanta + ścieżka. */
  label?: string;
}

/** Jedno wymuszone zamknięcie zapisane w pierścieniu diagnostycznym. */
export interface DocumentGuardIncident {
  at: string;
  label: string;
  reason: DocumentGuardCloseReason;
  elapsedMs: number;
  bytes: number;
  sawHtmlEnd: boolean;
}

export interface DocumentGuardSnapshot {
  enabled: boolean;
  guarded: number;
  closedBySource: number;
  closedByError: number;
  closedBySentinel: number;
  closedByIdle: number;
  closedByTimeout: number;
  /** Ostatnie wymuszone zamknięcia (najnowsze pierwsze). */
  incidents: DocumentGuardIncident[];
}

const stats = {
  guarded: 0,
  closedBySource: 0,
  closedByError: 0,
  closedBySentinel: 0,
  closedByIdle: 0,
  closedByTimeout: 0,
};

const INCIDENTS_LIMIT = 50;
const incidents: DocumentGuardIncident[] = [];

function recordIncident(incident: DocumentGuardIncident): void {
  incidents.unshift(incident);
  if (incidents.length > INCIDENTS_LIMIT) incidents.length = INCIDENTS_LIMIT;
}

function guardEnabled(): boolean {
  const flag =
    typeof process !== "undefined" ? (process.env.SSR_DOC_GUARD ?? "").toLowerCase() : "";
  return flag !== "off" && flag !== "0" && flag !== "false";
}

/** Nastawa czasowa z env (nazwa -> ms); wartość niedodatnia/nieliczbowa = fallback. */
function envMs(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Strumieniowy skaner sentinela `</html>`: bajtowy, case-insensitive, bez
 * kopiowania chunków. Między chunkami przenosi tylko ostatnie 6 bajtów, więc
 * sentinel rozcięty granicą chunków też zostaje wykryty.
 */
export class HtmlEndScanner {
  private tail = new Uint8Array(0);
  private found = false;

  get seen(): boolean {
    return this.found;
  }

  push(chunk: Uint8Array): boolean {
    if (this.found || chunk.length === 0) return this.found;
    const tailLength = this.tail.length;
    const total = tailLength + chunk.length;
    const byteAt = (index: number): number =>
      index < tailLength ? this.tail[index]! : chunk[index - tailLength]!;

    // Dopasowanie musi zawierać >=1 nowy bajt - starsze pozycje sprawdziły
    // poprzednie wywołania. Litery porównujemy z bitem 0x20 (case-insensitive),
    // maska jest policzona raz w SENTINEL_MASK.
    const firstStart = Math.max(0, tailLength - (SENTINEL_LENGTH - 1));
    outer: for (let start = firstStart; start <= total - SENTINEL_LENGTH; start++) {
      for (let offset = 0; offset < SENTINEL_LENGTH; offset++) {
        if ((byteAt(start + offset) | SENTINEL_MASK[offset]!) !== HTML_END_SENTINEL[offset]!) {
          continue outer;
        }
      }
      this.found = true;
      this.tail = new Uint8Array(0);
      return true;
    }

    // Przeniesienie: ostatnie (SENTINEL_LENGTH - 1) bajtów łączonego okna.
    const keep = Math.min(SENTINEL_LENGTH - 1, total);
    const carry = new Uint8Array(keep);
    for (let index = 0; index < keep; index++) carry[index] = byteAt(total - keep + index);
    this.tail = carry;
    return false;
  }
}

/**
 * Zwraca strumień lustrzany wobec `source`, z gwarancją domknięcia. Server-only.
 */
export function guardDocumentStream(
  source: ReadableStream<Uint8Array>,
  options: DocumentStreamGuardOptions = {},
): ReadableStream<Uint8Array> {
  const sentinelGraceMs =
    options.sentinelGraceMs ?? envMs("SSR_DOC_GUARD_GRACE_MS", DOC_GUARD_SENTINEL_GRACE_MS);
  const idleMs = options.idleMs ?? envMs("SSR_DOC_GUARD_IDLE_MS", DOC_GUARD_IDLE_MS);
  const maxMs = options.maxMs ?? envMs("SSR_DOC_GUARD_MAX_MS", DOC_GUARD_MAX_MS);
  const label = options.label ?? "-";

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  let bytes = 0;
  const scanner = new HtmlEndScanner();
  const openedAt = Date.now();

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  stats.guarded += 1;

  const clearTimers = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    if (hardTimer !== undefined) clearTimeout(hardTimer);
    idleTimer = graceTimer = hardTimer = undefined;
  };

  const close = (reason: DocumentGuardCloseReason): void => {
    if (closed) return;
    closed = true;
    clearTimers();

    const elapsedMs = Date.now() - openedAt;
    if (reason === "source") {
      stats.closedBySource += 1;
    } else if (reason === "cancel") {
      // Konsument (runtime/klient) zerwał połączenie - nic do raportowania.
      stats.closedBySource += 1;
    } else {
      if (reason === "error") stats.closedByError += 1;
      if (reason === "sentinel") stats.closedBySentinel += 1;
      if (reason === "idle") stats.closedByIdle += 1;
      if (reason === "timeout") stats.closedByTimeout += 1;
      recordIncident({
        at: new Date().toISOString(),
        label,
        reason,
        elapsedMs,
        bytes,
        sawHtmlEnd: scanner.seen,
      });
      console.warn(
        `[ssr-doc-guard] closed by guard (${reason}) route=${label} ` +
          `elapsedMs=${elapsedMs} bytes=${bytes} sawHtmlEnd=${scanner.seen}`,
      );
      if (!scanner.seen) {
        // Dokument ucięty przed `</html>` - dosztukuj parsowalny ogon Z SYGNATURĄ.
        // Klient po hydratacji i tak dociąga brakujące dane (kontrakt strażników
        // SSR), a sygnatura zostawia w samym dokumencie dowód ucięcia: bez niej
        // ucięta odpowiedź wygląda bajt w bajt jak kompletna.
        try {
          controller?.enqueue(ENCODER.encode(forcedCloseTail(reason, elapsedMs, bytes)));
        } catch {
          /* konsument już zniknął */
        }
      }
      // Wymuszone zamknięcie: ubij źródło, żeby upstream (transform -> React
      // -> serverSsr.cleanup) zwolnił zasoby żądania zamiast wisieć do limitu
      // frameworka.
      void reader?.cancel(new Error(`ssr-doc-guard:${reason}`)).catch(() => undefined);
    }

    try {
      controller?.close();
    } catch {
      /* już zamknięte przez runtime */
    }
  };

  const armIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => close("idle"), idleMs);
  };

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      reader = source.getReader();
      hardTimer = setTimeout(() => close("timeout"), maxMs);

      const pump = (): void => {
        reader
          ?.read()
          .then(({ done, value }) => {
            if (closed) return;
            if (done) {
              close("source");
              return;
            }
            if (value !== undefined && value.length > 0) {
              bytes += value.length;
              try {
                controller?.enqueue(value);
              } catch {
                /* konsument już zniknął - domknięcie zrobi cancel() */
              }
              if (scanner.push(value)) {
                // Kompletny dokument: krótka łaska na naturalne `done`,
                // potem zamykamy sami - bez czekania na serializację.
                if (idleTimer !== undefined) clearTimeout(idleTimer);
                idleTimer = undefined;
                if (graceTimer === undefined) {
                  graceTimer = setTimeout(() => close("sentinel"), sentinelGraceMs);
                }
              } else {
                armIdle();
              }
            }
            pump();
          })
          .catch(() => close("error"));
      };
      pump();
    },
    cancel(reason) {
      close("cancel");
      // Reader cancellation must reach React/upstream as well: otherwise a
      // disconnected client leaves the source alive with all timers cleared.
      return reader?.cancel(reason).catch(() => undefined);
    },
  });
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function requestLabel(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${url.host}${url.pathname}`;
  } catch {
    return safePathname(request.url);
  }
}

/**
 * Opakowuje odpowiedź DOKUMENTU (text/html z body) w strażnika strumienia.
 * Wszystko inne (assety, JSON serverFn, redirecty, HEAD bez body) przechodzi
 * nietknięte. Nagłówki/status są zachowane - zmienia się wyłącznie gwarancja,
 * że body ZAWSZE się kończy.
 */
export function guardDocumentResponse(
  request: Request,
  response: Response,
  options: DocumentStreamGuardOptions = {},
): Response {
  if (!guardEnabled()) return response;
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  if (!response.body || response.bodyUsed) return response;

  // Kopia nagłówków (nie mutujemy oryginalnej odpowiedzi) + ślad uzbrojenia.
  // Bez tego nagłówka asercja "dokument nie nosi sygnatury ucięcia" byłaby
  // pozorna również w drugą stronę: przechodziłaby także wtedy, gdy strażnik
  // jest wyłączony przez SSR_DOC_GUARD=off i nikt niczego nie pilnuje.
  const headers = new Headers(response.headers);
  headers.set(DOC_GUARD_HEADER, "on");

  return new Response(
    guardDocumentStream(response.body, {
      ...options,
      label: options.label ?? requestLabel(request),
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

/** Migawka do diagnostyki (testy, karta /admin/performance w przyszłości). */
export function getDocumentGuardSnapshot(): DocumentGuardSnapshot {
  return {
    enabled: guardEnabled(),
    guarded: stats.guarded,
    closedBySource: stats.closedBySource,
    closedByError: stats.closedByError,
    closedBySentinel: stats.closedBySentinel,
    closedByIdle: stats.closedByIdle,
    closedByTimeout: stats.closedByTimeout,
    incidents: [...incidents],
  };
}

/** Hak testowy: wyzeruj liczniki i pierścień incydentów. */
export function resetDocumentGuardForTests(): void {
  stats.guarded = 0;
  stats.closedBySource = 0;
  stats.closedByError = 0;
  stats.closedBySentinel = 0;
  stats.closedByIdle = 0;
  stats.closedByTimeout = 0;
  incidents.length = 0;
}
