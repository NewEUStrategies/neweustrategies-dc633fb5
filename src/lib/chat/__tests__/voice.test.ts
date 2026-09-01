// Notatki głosowe - `pickRecordingMime` i `useVoiceRecorder`.
//
// STAWKA. Ten plik stał na 4,4% linii i 1/17 funkcji, a niesie jedyną w całym
// repo ścieżkę, która OTWIERA MIKROFON. Wyciek mikrofonu (nieodpięta ścieżka
// `MediaStreamTrack` po odmontowaniu) jest defektem, którego nie widać na
// ekranie: aplikacja wygląda poprawnie, a przeglądarka do końca sesji trzyma
// wskaźnik nagrywania. Dokładnie ten przypadek ma tu własny dowód.
//
// jsdom/happy-dom nie mają `MediaRecorder` ani `navigator.mediaDevices`, więc
// obie rzeczy są atrapami - z prawdziwym kontraktem zdarzeń
// (`ondataavailable` -> `stop()` -> `onstop`), bo to na tej kolejności stoi
// zbieranie ostatniego fragmentu nagrania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MAX_VOICE_SECONDS } from "../attachments";
import { formatVoiceDuration, pickRecordingMime, useVoiceRecorder } from "../voice";

interface FakeTrack {
  stop: () => void;
  stopped: boolean;
}

function fakeTrack(): FakeTrack {
  const track: FakeTrack = {
    stopped: false,
    stop: () => {
      track.stopped = true;
    },
  };
  return track;
}

/** Atrapa `MediaRecorder` z prawdziwą kolejnością zdarzeń stop/onstop. */
class FakeMediaRecorder {
  static supported: Set<string> = new Set();
  static instances: FakeMediaRecorder[] = [];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }

  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;
  startCalls: number[] = [];

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    this.state = "recording";
    this.startCalls.push(timeslice ?? 0);
  }

  stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }

  /** Test: dorzuć fragment nagrania (tak robi przeglądarka co `timeslice`). */
  emitChunk(data: Blob): void {
    this.ondataavailable?.({ data });
  }
}

let tracks: FakeTrack[] = [];
let getUserMedia = vi.fn();

function installMediaStack(options: { supported: string[]; deny?: boolean }): void {
  FakeMediaRecorder.supported = new Set(options.supported);
  FakeMediaRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  getUserMedia = vi.fn(async () => {
    if (options.deny) throw new Error("NotAllowedError");
    const track = fakeTrack();
    tracks.push(track);
    return { getTracks: () => [track] };
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function lastRecorder(): FakeMediaRecorder {
  const recorder = FakeMediaRecorder.instances.at(-1);
  if (!recorder) throw new Error("test: nagrywarka nie powstała");
  return recorder;
}

beforeEach(() => {
  tracks = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-18T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

describe("formatVoiceDuration", () => {
  it("formatuje mm:ss z zerem wiodącym sekund", () => {
    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(9)).toBe("0:09");
    expect(formatVoiceDuration(65)).toBe("1:05");
    expect(formatVoiceDuration(MAX_VOICE_SECONDS)).toBe("10:00");
  });

  it("ujemne i ułamkowe wartości nie produkują „-1:-5”", () => {
    expect(formatVoiceDuration(-5)).toBe("0:00");
    expect(formatVoiceDuration(12.9)).toBe("0:12");
  });
});

describe("pickRecordingMime", () => {
  it("bez MediaRecordera nie ma czym nagrywać", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickRecordingMime()).toBeNull();
  });

  it("preferuje opus w webm (Chrome/Firefox)", () => {
    installMediaStack({ supported: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] });
    expect(pickRecordingMime()).toBe("audio/webm;codecs=opus");
  });

  it("schodzi na goły webm, gdy opus nie jest wspierany", () => {
    installMediaStack({ supported: ["audio/webm", "audio/ogg"] });
    expect(pickRecordingMime()).toBe("audio/webm");
  });

  it("Safari dostaje mp4", () => {
    installMediaStack({ supported: ["audio/mp4"] });
    expect(pickRecordingMime()).toBe("audio/mp4");
  });

  it("ogg jest ostatnią deską ratunku, nie pierwszym wyborem", () => {
    installMediaStack({ supported: ["audio/ogg"] });
    expect(pickRecordingMime()).toBe("audio/ogg");
  });

  it("brak jakiegokolwiek wspieranego kontenera to null, nie zgadywanie", () => {
    installMediaStack({ supported: [] });
    expect(pickRecordingMime()).toBeNull();
  });
});

describe("useVoiceRecorder", () => {
  it("bez wspieranego kontenera hook zgłasza brak wsparcia i nie prosi o mikrofon", async () => {
    installMediaStack({ supported: [] });
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    expect(result.current.supported).toBe(false);
    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith("unsupported");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("odmowa uprawnienia wraca do stanu spoczynku z własnym powodem", async () => {
    installMediaStack({ supported: ["audio/webm"], deny: true });
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onError }));

    await act(async () => {
      await result.current.start();
    });

    expect(onError).toHaveBeenCalledWith("denied");
    expect(result.current.state).toBe("idle");
    // Odmowa nie może zostawić otwartego strumienia.
    expect(tracks).toHaveLength(0);
  });

  it("start-nagranie-zakończenie oddaje plik w BAZOWYM typie kontenera", async () => {
    installMediaStack({ supported: ["audio/webm;codecs=opus"] });
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("recording");
    // Fragmenty co sekundę - inaczej ostatnia sekunda nagrania przepada.
    expect(lastRecorder().startCalls).toEqual([1000]);

    act(() => {
      lastRecorder().emitChunk(new Blob(["dzwiek"]));
      vi.advanceTimersByTime(3000);
      vi.setSystemTime(Date.now() + 3000);
    });
    expect(result.current.elapsed).toBeGreaterThan(0);

    let voice: Awaited<ReturnType<typeof result.current.finish>> = null;
    await act(async () => {
      voice = await result.current.finish();
    });

    expect(voice).not.toBeNull();
    const recorded = voice as unknown as { file: File; durationSeconds: number };
    // `;codecs=opus` MUSI zniknąć - allowlista kubełka zna wyłącznie `audio/webm`.
    expect(recorded.file.type).toBe("audio/webm");
    expect(recorded.file.name).toMatch(/^voice-\d+\.webm$/);
    expect(recorded.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(result.current.state).toBe("idle");
    expect(tracks.every((track) => track.stopped)).toBe(true);
  });

  it("mp4 dostaje rozszerzenie m4a, nie „mp4” z typu MIME", async () => {
    installMediaStack({ supported: ["audio/mp4"] });
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      lastRecorder().emitChunk(new Blob(["dzwiek"]));
    });

    let voice: Awaited<ReturnType<typeof result.current.finish>> = null;
    await act(async () => {
      voice = await result.current.finish();
    });
    const recorded = voice as unknown as { file: File };
    expect(recorded.file.name.endsWith(".m4a")).toBe(true);
    expect(recorded.file.type).toBe("audio/mp4");
  });

  it("nagranie bez ani jednego fragmentu zwraca null, a nie pusty plik", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    let voice: Awaited<ReturnType<typeof result.current.finish>> = null;
    await act(async () => {
      voice = await result.current.finish();
    });
    expect(voice).toBeNull();
    expect(result.current.state).toBe("idle");
  });

  it("zakończenie bez rozpoczęcia nie wywraca hooka", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result } = renderHook(() => useVoiceRecorder());
    let voice: Awaited<ReturnType<typeof result.current.finish>> = null;
    await act(async () => {
      voice = await result.current.finish();
    });
    expect(voice).toBeNull();
  });

  it("anulowanie zamyka mikrofon i NIE oddaje pliku", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      lastRecorder().emitChunk(new Blob(["dzwiek"]));
    });

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.elapsed).toBe(0);
    expect(tracks.every((track) => track.stopped)).toBe(true);
    // `onstop` zostaje odpięty - anulowanie nie może dokończyć zbierania pliku.
    expect(lastRecorder().onstop).toBeNull();
  });

  it("drugi start w trakcie nagrywania jest ignorowany (jeden strumień)", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("limit długości sam kończy nagranie i oddaje je wołającemu", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const onLimitReached = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onLimitReached }));

    await act(async () => {
      await result.current.start();
    });
    act(() => {
      lastRecorder().emitChunk(new Blob(["dzwiek"]));
    });

    await act(async () => {
      vi.setSystemTime(Date.now() + (MAX_VOICE_SECONDS + 1) * 1000);
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(onLimitReached).toHaveBeenCalledTimes(1);
    const voice = onLimitReached.mock.calls[0]?.[0] as { durationSeconds: number } | null;
    expect(voice).not.toBeNull();
    // Twardy sufit lustrzany do CHECK-a w bazie - ani sekundy więcej.
    expect(voice?.durationSeconds).toBe(MAX_VOICE_SECONDS);
    expect(result.current.state).toBe("idle");
    expect(tracks.every((track) => track.stopped)).toBe(true);
  });

  it("ODMONTOWANIE w trakcie nagrywania zamyka mikrofon (wyciek niewidoczny na ekranie)", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.stopped).toBe(false);

    unmount();

    expect(tracks[0]?.stopped).toBe(true);
    expect(lastRecorder().state).toBe("inactive");
  });

  it("pusty fragment nie trafia do nagrania", async () => {
    installMediaStack({ supported: ["audio/webm"] });
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      lastRecorder().emitChunk(new Blob([]));
    });

    let voice: Awaited<ReturnType<typeof result.current.finish>> = null;
    await act(async () => {
      voice = await result.current.finish();
    });
    expect(voice).toBeNull();
  });
});
