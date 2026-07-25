/**
 * Kanarek sanitizera przeglądarkowego: sprawdza, czy silnik NAPRAWDĘ usuwa
 * wykonywalny markup, i - gdy nie usuwa - przełącza `sanitizeHtml` w tryb
 * FAIL-CLOSED (treść leci jako zaescape'owany tekst) zamiast przepuszczać
 * niesanityzowany HTML.
 *
 * PRZYCZYNA ŹRÓDŁOWA (odtworzona, nie hipotetyczna):
 * DOMPurify od 3.4.8 hartuje się przed podmianą prototypów - `nodeName` czyta
 * przez `lookupGetter(Node.prototype, 'nodeName')` i wywołuje ten getter na
 * każdym węźle, zamiast czytać `currentNode.nodeName`. Jest to poprawne wobec
 * SPECYFIKACJI (DOM definiuje `nodeName` na `Node.prototype`), ale środowiska
 * emulujące DOM mogą definiować `nodeName` na klasie POCHODNEJ. Wtedy getter z
 * `Node.prototype` zwraca dla elementu pusty string, `tagName` wychodzi pusty,
 * dopasowanie do allowlisty NIE zachodzi i `<script>` / `<style>` / `<iframe>`
 * PRZEŻYWA sanityzację - także przy jawnym `FORBID_TAGS`.
 *
 * Zmierzone (dompurify 3.4.7 vs 3.4.8-3.4.12, ten sam wejściowy HTML):
 *   jsdom      - 3.4.7 i 3.4.12 identyczne, `<script>` usuwany;
 *   happy-dom  - 3.4.7 usuwa, >= 3.4.8 zwraca `ok<script>alert(1)</script>`.
 *
 * Dlatego samo przypięcie wersji (package.json: dompurify bez `^`) NIE
 * wystarcza jako jedyna mitygacja: chroni od dziś, ale nie chroni przed
 * dowolnym innym silnikiem DOM o niespecyfikacyjnym kształcie prototypów
 * (webview, shim, przyszły runtime testowy). Kanarek zamienia "cicho otwarte"
 * na "dowodliwie zamknięte" NIEZALEŻNIE od wersji biblioteki i środowiska.
 *
 * Koszt: jedna sanityzacja krótkiego stringa na cały cykl życia dokumentu
 * (wynik jest cache'owany), zero zależności, zero bajtów w bundlu SSR.
 */

/**
 * Ładunki kanarka - JEDEN WEKTOR NA PRZYPADEK.
 *
 * Celowo NIE jest to jeden zbiorczy string: parsery emulujące DOM przestawiają
 * rodzeństwo po elemencie raw-text (zmierzone: pod happy-dom nawet sprawny
 * DOMPurify 3.4.7 zwraca `<style>` ocalały, gdy poprzedza go `<script>`), więc
 * zbiorczy ładunek badałby parser, a nie sanitizer, i dawałby FAŁSZYWE ALARMY.
 * Minimalne, niezależne przypadki mierzą dokładnie to, co trzeba: czy silnik
 * usuwa daną klasę wykonywalnego markup.
 */
const CANARY_CASES: readonly string[] = [
  "<p>ok</p><script>alert(1)</script>",
  "<p>ok</p><style>x{}</style>",
  // Bez atrybutu `src` - happy-dom wykonałby na nim PRAWDZIWY fetch.
  "<p>ok</p><iframe></iframe>",
  '<p>ok</p><img src=x onerror="alert(1)">',
];

/** Markup / atrybuty, których w wyniku być NIE MOŻE. */
const CANARY_LEAK_RE = /<\s*\/?\s*(?:script|style|iframe)\b|\bon[a-z]+\s*=/i;

export type SanitizerEngineStatus = "healthy" | "degraded";

export interface SanitizerEngineProbe {
  status: SanitizerEngineStatus;
  /** Powód degradacji - do diagnostyki w raporcie obserwowalności. */
  reason: string;
  /** Wynik przypadku, który zawiódł (obcięty). Pusty dla sprawnego silnika. */
  output: string;
}

const HEALTHY: SanitizerEngineProbe = { status: "healthy", reason: "", output: "" };

/**
 * Uruchamia kanarka na przekazanej funkcji sanityzującej. Czysta i bezstanowa -
 * stan (cache + raportowanie) trzyma `assertSanitizerEngine`.
 *
 * Silnik jest sprawny, gdy dla KAŻDEGO przypadku jednocześnie:
 *  - nie przepuścił wykonywalnego markup ani inline-handlera,
 *  - zachował bezpieczną treść (`ok`) ORAZ jej znacznik (`<p>`). Druga część to
 *    niezależny sygnał tej samej awarii: zdegradowany DOMPurify gubił `<p>`,
 *    a zwracanie samego tekstu oznacza sanitizer, który zjadłby cały artykuł.
 */
export function probeSanitizerEngine(sanitize: (dirty: string) => string): SanitizerEngineProbe {
  for (const input of CANARY_CASES) {
    let output: string;
    try {
      output = sanitize(input);
    } catch (error) {
      // Silnik, który rzuca na poprawnym wejściu, jest z definicji niesprawny.
      return {
        status: "degraded",
        reason: `throw: ${error instanceof Error ? error.message : "unknown"}`,
        output: "",
      };
    }
    if (CANARY_LEAK_RE.test(output)) {
      return { status: "degraded", reason: `leak: ${input}`, output };
    }
    if (!output.includes("ok") || !output.includes("<p>")) {
      return { status: "degraded", reason: `lost safe markup: ${input}`, output };
    }
  }
  return HEALTHY;
}

let cached: SanitizerEngineProbe | null = null;
let reported = false;

/**
 * Zwraca (i zapamiętuje) status silnika sanityzacji. Wywoływane przy każdym
 * `sanitizeHtml` w przeglądarce; kanarek liczy się tylko raz.
 */
export function assertSanitizerEngine(sanitize: (dirty: string) => string): SanitizerEngineStatus {
  cached ??= probeSanitizerEngine(sanitize);
  if (cached.status === "degraded" && !reported) {
    reported = true;
    reportDegradedEngine(cached);
  }
  return cached.status;
}

/** Reset - wyłącznie dla testów, żeby kanarek dał się przebadać wielokrotnie. */
export function resetSanitizerEngineProbe(): void {
  cached = null;
  reported = false;
}

/**
 * Degradacja sanitizera jest zdarzeniem BEZPIECZEŃSTWA, nie kosmetycznym: musi
 * trafić do telemetrii, a nie tylko do konsoli. Import raportu jest dynamiczny,
 * żeby zwykła ścieżka sanityzacji nie ciągnęła transportu obserwowalności.
 */
function reportDegradedEngine(probe: SanitizerEngineProbe): void {
  const message =
    "sanitizeHtml: silnik DOMPurify nie usuwa wykonywalnego markup w tym środowisku - " +
    "przechodzę w tryb fail-closed (treść HTML renderowana jako tekst).";
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const { buildErrorPayload, observabilityEndpoint, sendBeaconPayload } =
        await import("@/lib/observability/report");
      sendBeaconPayload(
        observabilityEndpoint(),
        buildErrorPayload(
          new Error(message),
          "react_error_boundary",
          window.location?.pathname ?? "/",
          Date.now(),
          {
            kind: "sanitizer_engine_degraded",
            reason: probe.reason,
            canaryOutput: probe.output.slice(0, 200),
          },
        ),
      );
    } catch {
      /* telemetria jest best-effort - nigdy nie może zerwać sanityzacji */
    }
  })();
}

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Wyjście trybu fail-closed: HTML zamieniony na WIDOCZNY TEKST. Ta sama
 * filozofia, co model awarii serwerowego walkera (lib/ssrSanitizeHtml): przy
 * rozbieżności parsera degradujemy do zaescape'owanego tekstu, nigdy do markup.
 */
export function escapeHtmlToText(dirty: string): string {
  return dirty.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}
