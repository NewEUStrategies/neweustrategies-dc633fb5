// Reguły opisu etapu syntezy i etykiet transportu. Ten sam `switch` stał
// wcześniej w DWÓCH KOPIACH - w `GlobalAudioBar` i w `SidebarListenCard` -
// każdy jako IIFE wewnątrz komponentu, nad własnym słownikiem `COPY`. Dwie
// kopie tej samej reguły nad dwoma słownikami to gwarancja rozjazdu: dodanie
// etapu pokazywałoby nowy stan na jednym pasku, a generyczne „Generuję audio…"
// na drugim.
//
// Funkcje zwracają KLUCZ i18n, nie napis - test reguły nie zależy od copy,
// a tłumaczenie EN i odmiana zostają w słowniku.
import { describe, it, expect } from "vitest";
import type { TtsStage } from "@/lib/audio/global-player";
import { downloadKey, playPauseKey, ttsStageKey, ttsStagePercent } from "@/lib/audio/ttsStage";

const ALL_STAGES: TtsStage[] = [
  "idle",
  "preparing",
  "synthesizing",
  "streaming",
  "ready",
  "cached",
  "error",
];

describe("ttsStageKey - etap konwersji tekst -> mowa", () => {
  it("każdy etap ROBOCZY ma własny, rozróżnialny klucz", () => {
    const keys = (["preparing", "synthesizing", "streaming", "ready", "cached"] as TtsStage[]).map(
      ttsStageKey,
    );
    expect(keys).toEqual([
      "stagePreparing",
      "stageSynthesizing",
      "stageStreaming",
      "stageReady",
      "stageCached",
    ]);
    expect(new Set(keys).size).toBe(5);
  });

  it("`idle` i `error` degradują do generycznego klucza (błąd ma osobny komunikat)", () => {
    expect(ttsStageKey("idle")).toBe("loading");
    expect(ttsStageKey("error")).toBe("loading");
  });

  it("KAŻDY etap z katalogu typu zwraca klucz - żaden nie wpada na undefined", () => {
    for (const stage of ALL_STAGES) {
      expect(typeof ttsStageKey(stage)).toBe("string");
      expect(ttsStageKey(stage).length).toBeGreaterThan(0);
    }
  });

  it("cache i synteza to DWA RÓŻNE komunikaty (czytelnik widzi, czy płacimy za TTS)", () => {
    expect(ttsStageKey("cached")).not.toBe(ttsStageKey("synthesizing"));
    expect(ttsStageKey("cached")).toBe("stageCached");
  });

  it("funkcja jest czysta - to samo wejście daje ten sam klucz", () => {
    expect(ttsStageKey("streaming")).toBe(ttsStageKey("streaming"));
    expect(ttsStageKey("ready")).not.toBe(ttsStageKey("streaming"));
  });
});

describe("ttsStagePercent - kiedy pasek postępu jest wiarygodny", () => {
  it("pokazuje procent WYŁĄCZNIE w etapie strumieniowania", () => {
    expect(ttsStagePercent({ stage: "streaming", percent: 42 })).toBe(42);
    expect(ttsStagePercent({ stage: "synthesizing", percent: 42 })).toBeNull();
  });

  it("procent ZEROWY daje `null` - pasek na 0% czyta się jako zawieszony", () => {
    expect(ttsStagePercent({ stage: "streaming", percent: 0 })).toBeNull();
    expect(ttsStagePercent({ stage: "streaming", percent: 1 })).toBe(1);
  });

  it("brak `Content-Length` (percent zostaje na zerze) nie rysuje paska", () => {
    expect(ttsStagePercent({ stage: "streaming", percent: 0 })).toBeNull();
    expect(ttsStagePercent({ stage: "streaming", percent: 100 })).toBe(100);
  });

  it("żaden inny etap nie rysuje paska, nawet z pełnym procentem", () => {
    for (const stage of ALL_STAGES.filter((s) => s !== "streaming")) {
      expect(ttsStagePercent({ stage, percent: 99 })).toBeNull();
    }
    expect(ttsStagePercent({ stage: "streaming", percent: 99 })).toBe(99);
  });

  it("procent ujemny (niespójna telemetria) nie rysuje paska", () => {
    expect(ttsStagePercent({ stage: "streaming", percent: -5 })).toBeNull();
    expect(ttsStagePercent({ stage: "streaming", percent: 5 })).toBe(5);
  });
});

describe("playPauseKey - etykieta głównego przycisku", () => {
  it("GENERUJĘ wygrywa nad pauzą - w trakcie syntezy przycisk nie pauzuje", () => {
    expect(playPauseKey({ loading: true, playing: true, paused: false })).toBe("loading");
    expect(playPauseKey({ loading: true, playing: false, paused: true })).toBe("loading");
  });

  it("odtwarzanie daje `pause` w obu wariantach", () => {
    expect(playPauseKey({ loading: false, playing: true, paused: false })).toBe("pause");
    expect(
      playPauseKey({ loading: false, playing: true, paused: false, variant: "transport" }),
    ).toBe("pause");
  });

  it("wariant `listen` (karta, przycisk w treści) rozróżnia WZNÓW i ODSŁUCHAJ", () => {
    expect(playPauseKey({ loading: false, playing: false, paused: true })).toBe("resume");
    expect(playPauseKey({ loading: false, playing: false, paused: false })).toBe("listen");
  });

  it("wariant `transport` (dolny pasek) ma jedną etykietę startu", () => {
    expect(
      playPauseKey({ loading: false, playing: false, paused: true, variant: "transport" }),
    ).toBe("play");
    expect(
      playPauseKey({ loading: false, playing: false, paused: false, variant: "transport" }),
    ).toBe("play");
  });

  it("stan spoczynku NIE jest tym samym kluczem co pauza (a11y: różne akcje)", () => {
    const idle = playPauseKey({ loading: false, playing: false, paused: false });
    const playing = playPauseKey({ loading: false, playing: true, paused: false });
    expect(idle).not.toBe(playing);
    expect(idle).toBe("listen");
  });
});

describe("downloadKey - etykieta pobierania", () => {
  it("trwające pobranie ma WŁASNĄ etykietę (a11y: przycisk ogłasza stan)", () => {
    expect(downloadKey(true)).toBe("downloading");
    expect(downloadKey(false)).toBe("download");
  });

  it("oba klucze są rozróżnialne", () => {
    expect(downloadKey(true)).not.toBe(downloadKey(false));
    expect(typeof downloadKey(true)).toBe("string");
  });
});
