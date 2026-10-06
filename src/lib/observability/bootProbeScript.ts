// SONDA BOOTU - klasyczny, inline'owy skrypt w `<head>`, PIERWSZY w dokumencie.
//
// CO ŁAPIE I DLACZEGO NIC INNEGO TEGO NIE ŁAPIE.
//
// Incydent 2026-07-20 to RZUT W TRAKCIE INICJALIZACJI CHUNKU VENDOROWEGO, czyli
// PRZED wykonaniem ciała modułu wejściowego. Handler zainstalowany w module
// (a tym bardziej w efekcie montowania Reacta, jak dotychczasowe przechwytywanie
// błędów w korzeniu) w tym scenariuszu NIGDY SIĘ NIE URUCHOMI - instaluje się po
// zdarzeniu, którego ma pilnować. Skrypt KLASYCZNY (nie `type="module"`) wykonuje
// się natychmiast, przed każdym skryptem modułowym, i przeżywa rzut w entry.
//
// Do tej pory jedynym śladem takiej awarii był `console.warn` z budżetu
// hydratacji, którego nikt nie zbiera, a globalne przechwytywanie błędów
// startowało z efektu montowania I ZA ZGODĄ ANALITYCZNĄ - czyli po zdarzeniu.
//
// PRYWATNOŚĆ: sonda WYŁĄCZNIE BUFORUJE w pamięci strony. Zero sieci, zero
// ciasteczek, zero storage - bufor, który nigdy nie opuszcza strony, nie jest
// przetwarzaniem danych. Wysyłką zajmuje się `lib/observability`, już za istniejącą
// bramką zgody analitycznej: dopiero tam bufor jest opróżniany i beaconowany.
// Dlatego sama sonda NIE MA bramki zgody i mieć jej nie powinna.
//
// LIMIT 20 WPISÓW jest celowy: pętla rzucająca w każdej klatce nie może zjeść
// pamięci karty, którą ma zdiagnozować.
//
// `__nesBootDead` to sygnał POZYTYWNY dla martwej hydratacji: jeśli po 15 s od
// STARTU BOOTU flaga gotowości (`lib/watchdog/appReady`) nadal nie jest
// ustawiona, zapisujemy czas (ms od `__nesBootT0`). Tym jednym polem można
// odróżnić „wolno" od „nie ożyło" - czego przed 2026-09-01 nie dawało się
// odróżnić niczym.
//
// START BOOTU, NIE PIERWSZY BAJT (P2.1, krok 4). Od boot po LCP loader
// (`lib/boot/bootLoaderScript.ts`) wstawia wejście dopiero po wpisie LCP, a w
// skrajnym razie po DOMContentLoaded + 3 s; na wolnym łączu zegar liczony od
// tego skryptu zgłaszałby martwy boot zdrowym stronom (werdykt boot-js C3,
// pkt 5). Dlatego zegar uzbraja `window.__nesBootArm()` - woła ją loader
// w chwili bootu - a zapasowo sama sonda przy DOMContentLoaded + 3 s (twardy
// limit loadera), żeby dokument bez loadera (dev) albo z loaderem, który nie
// ruszył, nadal dostał sygnał. Uzbrojenie jest jednorazowe; `__nesBootS` to
// chwila uzbrojenia.
//
// Kształt (jedno IIFE, wszystko w `try`) jest kopią doktryny
// `lib/theme/themeInitScript.ts`: skrypt w `<head>` nie ma prawa wywrócić
// dokumentu, cokolwiek się w nim stanie.

/** Ile milisekund bez flagi gotowości uznajemy za martwy boot. */
/**
 * Kształt jednego wpisu bufora - JEDNO źródło prawdy dla skryptu (który pisze)
 * i dla `initObservability` (który czyta i wysyła).
 *
 * Pola są jednoliterowe, bo ten obiekt powstaje w skrypcie inline'owym
 * w `<head>` KAŻDEGO dokumentu: dłuższe nazwy to bajty na ścieżce
 * render-blocking, a bufor nigdy nie opuszcza strony w tej postaci
 * (`observability/index.ts` odtwarza z niego `Error`).
 */
export interface BootProbeEntry {
  /** Komunikat błędu. */
  readonly m?: string;
  /** Stos, jeśli był dostępny. */
  readonly s?: string;
  /** Plik źródłowy ze zdarzenia `error`. */
  readonly f?: string;
}

/**
 * Rozszerzenie `Window` - ten sam wzorzec, co `lib/watchdog/appReady.ts`
 * i `lib/watchdog/previewWatchdog.ts`. Bez niego każdy czytelnik bufora musiał
 * rzutować `window`, a `as unknown as` omija kontrolę typów tak samo jak `as any`
 * (bramka `check:unknown-casts`). Deklaracja stoi TUTAJ, bo to ten moduł
 * definiuje, co skrypt na `window` zapisuje.
 */
declare global {
  interface Window {
    __nesBootErrors?: BootProbeEntry[];
    __nesBootT0?: number;
    __nesBootDead?: number;
    /** Uzbraja watchdog martwego bootu (woła loader bootu w chwili startu). */
    __nesBootArm?: () => void;
    /** Chwila uzbrojenia watchdoga (`Date.now()`). */
    __nesBootS?: number;
  }
}

export const BOOT_DEAD_TIMEOUT_MS = 15_000;

/**
 * Zapasowe uzbrojenie watchdoga: DOMContentLoaded + tyle ms. Równe twardemu limitowi loadera
 * bootu (`BOOT_HARD_CAP_MS` w `lib/boot/bootLoaderScript.ts`, parytet pilnuje test sondy).
 */
export const BOOT_ARM_FALLBACK_MS = 3_000;

/** Maksymalna liczba zbuforowanych błędów - zapora przed pętlą rzucającą. */
export const BOOT_ERROR_BUFFER_LIMIT = 20;

// FILTR U ŹRÓDŁA (2026-09-02). Sonda żyje przez CAŁE życie karty, więc bez
// bramki buforowała także zdarzenia DŁUGO po starcie aplikacji i wysyłała je
// jako „[boot] ...": 75 wpisów „[boot] undefined" w panelu błędów pochodziło
// z anulowanych żądań i odrzuceń bez komunikatu. Teraz sonda:
//   - milknie, gdy `__nesAppReady` jest ustawione (boot się udał),
//   - odrzuca puste komunikaty i znany szum (aborty, ResizeObserver).
export const BOOT_PROBE_SCRIPT = `(function(){try{var w=window,d=document;w.__nesBootErrors=[];w.__nesBootT0=Date.now();var bad=function(m){return !m||m==="undefined"||m==="null"||/aborted|resizeobserver loop|^script error/i.test(m)};var p=function(m,s,f){try{if(w.__nesAppReady)return;var t=m==null?"":String(m);if(bad(t))return;if(w.__nesBootErrors.length<${BOOT_ERROR_BUFFER_LIMIT})w.__nesBootErrors.push({m:t,s:String(s||""),f:f||""})}catch(_){}};w.addEventListener("error",function(e){p((e.error&&e.error.message)||e.message,e.error&&e.error.stack,e.filename)},true);w.addEventListener("unhandledrejection",function(e){p((e.reason&&e.reason.message)||e.reason,e.reason&&e.reason.stack)},true);var a=w.__nesBootArm=function(){if(w.__nesBootS)return;w.__nesBootS=Date.now();w.setTimeout(function(){if(!w.__nesAppReady)w.__nesBootDead=Date.now()-w.__nesBootT0},${BOOT_DEAD_TIMEOUT_MS})};var z=function(){w.setTimeout(a,${BOOT_ARM_FALLBACK_MS})};d.readyState==="loading"?d.addEventListener("DOMContentLoaded",z):z()}catch(_){}})();`;
