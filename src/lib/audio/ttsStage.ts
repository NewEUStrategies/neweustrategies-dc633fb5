// Reguły opisu etapu konwersji tekst -> mowa i etykiet transportu odtwarzacza.
//
// DLACZEGO OSOBNY MODUŁ: te same dwa `switch`-e stały w DWÓCH KOPIACH -
// w `GlobalAudioBar` i w `SidebarListenCard`, każdy jako IIFE wewnątrz
// komponentu, każdy nad własnym słownikiem `COPY`. Dwie kopie tej samej reguły
// nad dwoma słownikami to gwarancja rozjazdu przy dodaniu etapu: jeden pasek
// pokazywałby nowy stan, drugi generyczne „Generuję audio…".
//
// Funkcje zwracają KLUCZ, nie napis - dzięki temu test reguły nie zależy od
// copy, a odmiana i tłumaczenie EN zostają w słowniku (zasada z refaktoru czatu:
// „funkcje pomocnicze zwracają deskryptory albo klucz i18n, nigdy gotowy tekst").

import type { TtsStage } from "@/lib/audio/global-player";

/** Klucz etykiety etapu w słowniku odtwarzacza (bez prefiksu przestrzeni). */
export type TtsStageKey =
  | "stagePreparing"
  | "stageSynthesizing"
  | "stageStreaming"
  | "stageReady"
  | "stageCached"
  | "loading";

/**
 * Etykieta etapu konwersji. `idle` i `error` degradują do generycznego
 * „generuję audio" - to stan, w którym pasek nie ma o czym informować
 * szczegółowo (błąd ma własny, osobny komunikat).
 */
export function ttsStageKey(stage: TtsStage): TtsStageKey {
  switch (stage) {
    case "preparing":
      return "stagePreparing";
    case "synthesizing":
      return "stageSynthesizing";
    case "streaming":
      return "stageStreaming";
    case "ready":
      return "stageReady";
    case "cached":
      return "stageCached";
    default:
      return "loading";
  }
}

/**
 * Procent do pokazania na pasku postępu - albo `null`, gdy nie ma czego
 * pokazywać.
 *
 * Postęp jest wiarygodny WYŁĄCZNIE w etapie `streaming` i tylko gdy serwer
 * podał `Content-Length` (inaczej `percent` zostaje na zerze). Pasek postępu
 * pokazujący 0% przez pół minuty syntezy jest gorszy niż brak paska - czytelnik
 * czyta go jako „zawieszone".
 */
export function ttsStagePercent(progress: { stage: TtsStage; percent: number }): number | null {
  return progress.stage === "streaming" && progress.percent > 0 ? progress.percent : null;
}

/** Klucz etykiety przycisku odtwarzania/pauzy. */
export type PlayPauseKey = "loading" | "pause" | "resume" | "listen" | "play";

/**
 * Etykieta głównego przycisku. Kolejność warunków jest istotna: „generuję"
 * wygrywa nad „pauza", bo w trakcie syntezy przycisk NIE pauzuje - jest
 * zablokowany, a etykieta musi mówić, na co czytelnik czeka.
 */
export function playPauseKey(state: {
  loading: boolean;
  playing: boolean;
  paused: boolean;
  /** Warianty „wznów/odsłuchaj" (karta, przycisk) vs „pauza/odtwórz" (pasek). */
  variant?: "listen" | "transport";
}): PlayPauseKey {
  if (state.loading) return "loading";
  if (state.playing) return "pause";
  if (state.variant === "transport") return "play";
  return state.paused ? "resume" : "listen";
}

/** Klucz etykiety przycisku pobierania - stan trwającego pobrania ma własny. */
export function downloadKey(downloading: boolean): "downloading" | "download" {
  return downloading ? "downloading" : "download";
}
