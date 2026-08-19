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
  "preparing" | "synthesizing" | "streaming" | "ready" | "cached" | "loading";

/**
 * Etykieta etapu konwersji. `idle` i `error` degradują do generycznego
 * „generuję audio" - to stan, w którym pasek nie ma o czym informować
 * szczegółowo (błąd ma własny, osobny komunikat).
 */
export function ttsStageKey(stage: TtsStage): TtsStageKey {
  switch (stage) {
    case "preparing":
      return "preparing";
    case "synthesizing":
      return "synthesizing";
    case "streaming":
      return "streaming";
    case "ready":
      return "ready";
    case "cached":
      return "cached";
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

/** Stan przycisku odtwarzania - wspólny dla obu wariantów etykiety. */
export interface PlayPauseState {
  loading: boolean;
  playing: boolean;
  paused: boolean;
}

/** Klucze wariantu „odsłuchaj/wznów" - karta w sidebarze i przycisk w treści. */
export type ListenLabelKey = "loading" | "pause" | "resume" | "listen";

/** Klucze wariantu transportowego - dolny pasek odtwarzacza. */
export type TransportLabelKey = "loading" | "pause" | "play";

/**
 * Etykieta przycisku w wariancie „odsłuchaj". Kolejność warunków jest istotna:
 * „generuję" wygrywa nad „pauza", bo w trakcie syntezy przycisk NIE pauzuje -
 * jest zablokowany, a etykieta musi mówić, na co czytelnik czeka.
 *
 * Rozróżnienie „wznów" i „odsłuchaj" jest tu potrzebne, bo karta pokazuje pozycję
 * odtwarzania: czytelnik musi wiedzieć, czy wróci w miejsce, w którym przerwał.
 */
export function playPauseKey(state: PlayPauseState): ListenLabelKey {
  if (state.loading) return "loading";
  if (state.playing) return "pause";
  return state.paused ? "resume" : "listen";
}

/**
 * Etykieta przycisku w wariancie transportowym (dolny pasek). Pasek nie
 * rozróżnia „wznów" od „odtwórz" - stoi zawsze przy AKTYWNYM materiale, więc
 * druga etykieta niosłaby tę samą informację co widoczna pozycja odtwarzania.
 */
export function transportLabelKey(state: PlayPauseState): TransportLabelKey {
  if (state.loading) return "loading";
  return state.playing ? "pause" : "play";
}

/** Klucz etykiety przycisku pobierania - stan trwającego pobrania ma własny. */
export function downloadKey(downloading: boolean): "downloading" | "download" {
  return downloading ? "downloading" : "download";
}
