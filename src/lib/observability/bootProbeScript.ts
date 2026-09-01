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
// wykonania tego skryptu flaga gotowości (`lib/watchdog/appReady`) nadal nie jest
// ustawiona, zapisujemy czas. Tym jednym polem można odróżnić „wolno" od
// „nie ożyło" - czego przed 2026-09-01 nie dawało się odróżnić niczym.
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
  }
}

export const BOOT_DEAD_TIMEOUT_MS = 15_000;

/** Maksymalna liczba zbuforowanych błędów - zapora przed pętlą rzucającą. */
export const BOOT_ERROR_BUFFER_LIMIT = 20;

export const BOOT_PROBE_SCRIPT = `(function(){try{var w=window;w.__nesBootErrors=[];w.__nesBootT0=Date.now();var p=function(m,s,f){try{if(w.__nesBootErrors.length<${BOOT_ERROR_BUFFER_LIMIT})w.__nesBootErrors.push({m:String(m),s:String(s||""),f:f||""})}catch(_){}};w.addEventListener("error",function(e){p((e.error&&e.error.message)||e.message,e.error&&e.error.stack,e.filename)},true);w.addEventListener("unhandledrejection",function(e){p((e.reason&&e.reason.message)||e.reason,e.reason&&e.reason.stack)},true);w.setTimeout(function(){if(!w.__nesAppReady)w.__nesBootDead=Date.now()-w.__nesBootT0},${BOOT_DEAD_TIMEOUT_MS})}catch(_){}})();`;
