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
import {
  downloadKey,
  playPauseKey,
  transportLabelKey,
  ttsStageKey,
  ttsStagePercent,
} from "@/lib/audio/ttsStage";

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
    expect(keys).toEqual(["preparing", "synthesizing", "streaming", "ready", "cached"]);
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
    expect(ttsStageKey("cached")).toBe("cached");
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

describe("playPauseKey - etykieta przycisku odsłuchu", () => {
  it("GENERUJĘ wygrywa nad pauzą - w trakcie syntezy przycisk nie pauzuje", () => {
    expect(playPauseKey({ loading: true, playing: true, paused: false })).toBe("loading");
    expect(playPauseKey({ loading: true, playing: false, paused: true })).toBe("loading");
  });

  it("odtwarzanie daje `pause`", () => {
    expect(playPauseKey({ loading: false, playing: true, paused: false })).toBe("pause");
    expect(playPauseKey({ loading: false, playing: true, paused: true })).toBe("pause");
  });

  it("rozróżnia WZNÓW i ODSŁUCHAJ - karta pokazuje pozycję, więc to różne obietnice", () => {
    expect(playPauseKey({ loading: false, playing: false, paused: true })).toBe("resume");
    expect(playPauseKey({ loading: false, playing: false, paused: false })).toBe("listen");
  });

  it("stan spoczynku NIE jest tym samym kluczem co odtwarzanie (a11y: różne akcje)", () => {
    const idle = playPauseKey({ loading: false, playing: false, paused: false });
    const playing = playPauseKey({ loading: false, playing: true, paused: false });
    expect(idle).not.toBe(playing);
    expect(idle).toBe("listen");
  });
});

describe("transportLabelKey - etykieta dolnego paska", () => {
  it("pasek NIE rozróżnia wznów/odtwórz - stoi zawsze przy aktywnym materiale", () => {
    expect(transportLabelKey({ loading: false, playing: false, paused: true })).toBe("play");
    expect(transportLabelKey({ loading: false, playing: false, paused: false })).toBe("play");
  });

  it("odtwarzanie daje `pause`, generowanie `loading`", () => {
    expect(transportLabelKey({ loading: false, playing: true, paused: false })).toBe("pause");
    expect(transportLabelKey({ loading: true, playing: true, paused: false })).toBe("loading");
  });

  it("oba warianty zgadzają się co do pauzy i generowania, różnią się startem", () => {
    const state = { loading: false, playing: false, paused: true };
    expect(transportLabelKey(state)).not.toBe(playPauseKey(state));
    expect(transportLabelKey({ ...state, playing: true })).toBe(
      playPauseKey({ ...state, playing: true }),
    );
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
