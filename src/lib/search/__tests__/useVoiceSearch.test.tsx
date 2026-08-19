// Dyktowanie frazy wyszukiwarki. 366 linii, 27 funkcji, dwie NIEZALEŻNE
// ścieżki API przeglądarki i ani jednego testu do dziś.
//
// DLACZEGO RAMIONA BŁĘDÓW SĄ TU WAŻNIEJSZE OD ŚCIEŻKI SZCZĘŚLIWEJ. Ścieżka
// szczęśliwa (mikrofon działa, STT odpowiada) zdarza się na maszynie
// programisty. W realnym świecie zdarza się: odmowa zgody na mikrofon,
// przeglądarka bez MediaRecorder, przeglądarka bez Web Speech API, brak sesji
// (anonim), błąd bramki STT, cisza zamiast mowy, nagranie za krótkie, i twardy
// sufit czasu. KAŻDE z tych zdarzeń kończy się innym `return` - i to one
// decydują, czy użytkownik zobaczy tekst, czy przycisk, który „nic nie robi".
//
// HARNESS. Cała maszyneria audio jest podstawiona: `getUserMedia`,
// `MediaRecorder`, `AudioContext` z analizatorem, `SpeechRecognition`,
// `requestAnimationFrame`, `performance.now` i `fetch`. Pętla VAD jest
// napędzana RĘCZNIE (klatka po klatce, z kontrolowanym zegarem), bo tylko tak
// da się wejść w jej trzy rozłączne ramiona: kalibrację tła, wykrycie mowy
// z auto-stopem po ciszy, oraz zamknięcie po ciszy bez mowy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession } },
}));

import { useVoiceSearch, type VoiceSearchOptions } from "@/lib/search/useVoiceSearch";

// ---------------------------------------------------------------------------
// Atrapy maszynerii przeglądarki
// ---------------------------------------------------------------------------

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

const tracks: FakeTrack[] = [];

function fakeStream() {
  const track: FakeTrack = { stop: vi.fn() };
  tracks.push(track);
  return { getTracks: () => [track] } as unknown as MediaStream;
}

interface RecorderInstance {
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void | Promise<void>) | null;
  start: () => void;
  stop: () => void;
  mimeType?: string;
}

const recorders: RecorderInstance[] = [];
const ctl = {
  /** Konstruktor MediaRecorder ma rzucić (przeglądarka bez tego kodeka). */
  recorderThrows: false,
  /** `recorder.start()` ma rzucić (urządzenie zajęte). */
  startThrows: false,
  /** `isTypeSupported` - pusta lista = żaden kodek nieobsługiwany. */
  supportedMimes: ["audio/webm;codecs=opus"] as string[],
  /** Rozmiar zebranego nagrania w bajtach. */
  blobSize: 4000,
  /** AudioContext ma rzucić (brak Web Audio). */
  audioThrows: false,
  /** Bieżąca amplituda sygnału widziana przez analizator. */
  amplitude: 0,
  now: 0,
};

function installMediaRecorder() {
  class FakeMediaRecorder implements RecorderInstance {
    static isTypeSupported = (m: string) => ctl.supportedMimes.includes(m);
    ondataavailable: RecorderInstance["ondataavailable"] = null;
    onstop: RecorderInstance["onstop"] = null;
    mimeType?: string;
    constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
      if (ctl.recorderThrows) throw new Error("nieobsługiwany kodek");
      this.mimeType = opts?.mimeType;
      recorders.push(this);
    }
    start() {
      if (ctl.startThrows) throw new Error("urządzenie zajęte");
    }
    stop() {
      // PRAWDZIWY Blob, nie obiekt z polem `size`: kod produkcyjny sam składa
      // `new Blob(chunks)` i mierzy wynik, więc atrapa z gołym obiektem dawała
      // 15 bajtów („[object Object]") i nagranie było odrzucane jako za krótkie.
      this.ondataavailable?.({ data: new Blob([new Uint8Array(ctl.blobSize)]) });
      void this.onstop?.();
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
}

/** Kolejka klatek animacji - test odpala je ręcznie. */
let frames: FrameRequestCallback[] = [];

interface SpeechInstance {
  lang: string;
  onresult:
    ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const speeches: SpeechInstance[] = [];
const speechCtl = { available: true, startThrows: false };

function installSpeechRecognition() {
  class FakeSpeechRecognition implements SpeechInstance {
    lang = "";
    interimResults = false;
    continuous = false;
    maxAlternatives = 0;
    onresult: SpeechInstance["onresult"] = null;
    onend: SpeechInstance["onend"] = null;
    onerror: SpeechInstance["onerror"] = null;
    stopped = false;
    constructor() {
      speeches.push(this);
    }
    start() {
      if (speechCtl.startThrows) throw new Error("odmowa");
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
    abort() {
      this.stopped = true;
    }
  }
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
}

function installAudio() {
  const analyser = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    getFloatTimeDomainData: (buf: Float32Array) => buf.fill(ctl.amplitude),
  };
  class FakeAudioContext {
    state = "running";
    constructor() {
      if (ctl.audioThrows) throw new Error("brak Web Audio");
    }
    createMediaStreamSource = () => ({ connect: vi.fn() });
    createBiquadFilter = () => ({ type: "", frequency: { value: 0 }, connect: vi.fn() });
    createAnalyser = () => analyser;
    close = () => Promise.resolve();
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

const getUserMedia = vi.fn();

/** Zapis wywołań `FormData.append` - happy-dom NIE zachowuje trzeciego
 *  argumentu (nazwy pliku), więc `fd.get("file").name` zawsze daje "blob".
 *  Nazwa pliku niesie rozszerzenie wyliczone z kodeka, więc musi być mierzona
 *  u źródła. */
const formAppends: Array<[string, unknown, string | undefined]> = [];

/** Nazwa pliku przekazana do FormData w ostatnim wysłanym nagraniu. */
const uploadedFileName = () => formAppends.find(([k]) => k === "file")?.[2];

function options(over: Partial<VoiceSearchOptions> = {}): VoiceSearchOptions {
  return { lang: "pl", onText: vi.fn(), onFinal: vi.fn(), ...over };
}

/** Odpala jedną klatkę VAD, przesuwając zegar o `dtMs`. */
function frame(dtMs: number) {
  ctl.now += dtMs;
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(ctl.now);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  tracks.length = 0;
  recorders.length = 0;
  speeches.length = 0;
  frames = [];
  Object.assign(ctl, {
    recorderThrows: false,
    startThrows: false,
    supportedMimes: ["audio/webm;codecs=opus"],
    blobSize: 4000,
    audioThrows: false,
    amplitude: 0,
    now: 1000,
  });
  speechCtl.available = true;
  speechCtl.startThrows = false;

  getUserMedia.mockReset().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  installMediaRecorder();
  installSpeechRecognition();
  installAudio();

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockImplementation(() => ctl.now);

  formAppends.length = 0;
  vi.spyOn(FormData.prototype, "append").mockImplementation(function (
    this: FormData,
    name: string,
    value: unknown,
    fileName?: string,
  ) {
    formAppends.push([name, value, fileName]);
  } as unknown as FormData["append"]);

  h.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ text: "polityka" }) }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  // NIE `unstubAllGlobals()`: upload rozpoczęty w zakończonym już teście
  // dobiegłby wtedy do PRAWDZIWEGO fetcha happy-dom i wywalił się na
  // ECONNREFUSED jako błąd nieobsłużony. Zostawiamy nieszkodliwą atrapę.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  vi.restoreAllMocks();
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

// ---------------------------------------------------------------------------

describe("useVoiceSearch - wykrywanie wsparcia", () => {
  it("nagrywanie DOSTĘPNE - przycisk ma się pokazać", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await waitFor(() => expect(result.current.supported).toBe(true));
  });

  it("brak MediaRecorder, ale jest Web Speech - nadal wspierane", async () => {
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await waitFor(() => expect(result.current.supported).toBe(true));
  });

  it("BRAK OBU API - przycisk dyktowania nie ma się pokazać wcale", async () => {
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await Promise.resolve();
    expect(result.current.supported).toBe(false);
  });

  it("wariant webkit Web Speech też się liczy", async () => {
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const Ctor = (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Ctor;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await waitFor(() => expect(result.current.supported).toBe(true));
  });

  it("brak mediaDevices też degraduje do Web Speech", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const { result } = renderHook(() => useVoiceSearch(options()));
    await waitFor(() => expect(result.current.supported).toBe(true));
  });
});

describe("useVoiceSearch - start nagrywania", () => {
  it("start prosi o mikrofon z redukcją szumu i przechodzi w nasłuch", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(result.current.listening).toBe(true);
  });

  it("wybiera obsługiwany kodek, a przy braku wsparcia nie narzuca żadnego", async () => {
    ctl.supportedMimes = [];
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(recorders[0].mimeType).toBeUndefined();
  });

  it("ODMOWA ZGODY na mikrofon spada na Web Speech, a nie zostawia martwego przycisku", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(speeches).toHaveLength(1);
    expect(result.current.listening).toBe(true);
  });

  it("odmowa zgody PRZY BRAKU Web Speech kończy się cicho, bez zawieszonego nasłuchu", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });

  it("nieobsługiwany kodek ZWALNIA MIKROFON przed przejściem na fallback", async () => {
    ctl.recorderThrows = true;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    // Bez tego dioda mikrofonu świeciłaby się dalej mimo braku nagrywania.
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(speeches).toHaveLength(1);
  });

  it("błąd startu rekordera sprząta i schodzi na fallback", async () => {
    ctl.startThrows = true;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(true);
    expect(speeches).toHaveLength(1);
  });

  it("brak Web Audio nie blokuje nagrywania - zostaje sam twardy sufit czasu", async () => {
    ctl.audioThrows = true;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(true);
    expect(frames).toHaveLength(0);
  });
});

describe("useVoiceSearch - detektor mowy (VAD)", () => {
  async function startRecording() {
    const opts = options();
    const hook = renderHook(() => useVoiceSearch(opts));
    await act(async () => hook.result.current.toggle());
    return { ...hook, opts };
  }

  it("KALIBRACJA: pierwsze ~400 ms mierzy tło i nie zatrzymuje nagrania", async () => {
    const { result } = await startRecording();
    ctl.amplitude = 0;
    await act(async () => {
      frame(100);
      frame(100);
      frame(100);
    });
    expect(result.current.listening).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
  });

  it("MOWA, potem CISZA - auto-stop po oknie ciszy", async () => {
    const { result } = await startRecording();
    await act(async () => {
      // Kalibracja tła (cisza).
      frame(200);
      frame(250);
      // Mowa - ponad próg MIN_SPEECH_MS.
      ctl.amplitude = 0.5;
      frame(150);
      frame(150);
      // Cisza dłuższa niż hangover - uzbraja timer auto-stopu.
      ctl.amplitude = 0;
      // EMA gaśnie o 30% na klatkę: ~12 klatek schodzi pod próg mowy, kolejne
      // przekraczają „hangover" 180 ms i dopiero wtedy uzbraja się timer.
      for (let i = 0; i < 25; i++) frame(100);
    });
    await act(async () => {
      vi.advanceTimersByTime(1200);
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(false);
  });

  it("CISZA BEZ MOWY zamyka nagranie szybciej niż twardy sufit", async () => {
    const { result } = await startRecording();
    ctl.amplitude = 0;
    await act(async () => {
      // Ponad NO_SPEECH_TIMEOUT_MS (6 s), bez ani jednej klatki z mową.
      for (let i = 0; i < 14; i++) frame(500);
    });
    expect(result.current.listening).toBe(false);
    // Pętla klatek się kończy - nie pali baterii w tle.
    expect(frames).toHaveLength(0);
  });

  it("TWARDY SUFIT zamyka nagranie, gdy użytkownik zapomni o mikrofonie", async () => {
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(false);
  });
});

describe("useVoiceSearch - transkrypcja serwerowa", () => {
  async function recordAndStop(over: Partial<VoiceSearchOptions> = {}) {
    const opts = options(over);
    const hook = renderHook(() => useVoiceSearch(opts));
    await act(async () => hook.result.current.toggle());
    await act(async () => {
      hook.result.current.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    return { ...hook, opts };
  }

  it("wysyła nagranie na /api/stt z tokenem sesji i oddaje transkrypcję", async () => {
    const { opts } = await recordAndStop();
    await waitFor(() => expect(opts.onText).toHaveBeenCalledWith("polityka"));
    expect(opts.onFinal).toHaveBeenCalledWith("polityka");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe("/api/stt");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("NAGRANIE ZA KRÓTKIE nie jedzie na serwer - nie palimy kredytów na ciszę", async () => {
    ctl.blobSize = 500;
    const { opts } = await recordAndStop();
    expect(fetch).not.toHaveBeenCalled();
    expect(opts.onText).not.toHaveBeenCalled();
  });

  it("ANONIM nie ma tokenu - transkrypcja serwerowa się nie odbywa", async () => {
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { opts } = await recordAndStop();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(opts.onText).not.toHaveBeenCalled();
  });

  it("BŁĄD BRAMKI STT nie woła zwrotki i nie zostawia stanu „zajęte”", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    const { result, opts } = await recordAndStop();
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(opts.onText).not.toHaveBeenCalled();
  });

  it("niepoprawny JSON odpowiedzi nie wywraca hooka", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error("bad json")) }),
    );
    const { result, opts } = await recordAndStop();
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(opts.onText).not.toHaveBeenCalled();
  });

  it("PUSTA transkrypcja nie nadpisuje frazy użytkownika", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ text: "   " }) }),
    );
    const { opts } = await recordAndStop();
    await waitFor(() => expect(opts.onText).not.toHaveBeenCalled());
  });

  it("przekazuje język dyktowania do bramki", async () => {
    await recordAndStop({ lang: "en" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(formAppends.find(([k]) => k === "lang")?.[1]).toBe("en");
  });

  it("rozszerzenie pliku idzie za kodekiem nagrania", async () => {
    ctl.supportedMimes = ["audio/mp4"];
    await recordAndStop();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(uploadedFileName()).toBe("voice.mp4");
  });

  it("kodek mpeg daje rozszerzenie mp3", async () => {
    ctl.supportedMimes = ["audio/mpeg"];
    await recordAndStop();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(uploadedFileName()).toBe("voice.mp3");
  });

  it("brak wsparcia kodeków daje domyślne webm", async () => {
    ctl.supportedMimes = [];
    await recordAndStop();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(uploadedFileName()).toBe("voice.webm");
  });

  it("zwalnia mikrofon po zakończeniu nagrania", async () => {
    await recordAndStop();
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});

describe("useVoiceSearch - fallback Web Speech API", () => {
  async function startFallback(over: Partial<VoiceSearchOptions> = {}) {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const opts = options(over);
    const hook = renderHook(() => useVoiceSearch(opts));
    await act(async () => hook.result.current.toggle());
    return { ...hook, opts, rec: speeches.at(-1)! };
  }

  it("ustawia język rozpoznawania zgodnie z językiem interfejsu", async () => {
    const { rec } = await startFallback({ lang: "en" });
    expect(rec.lang).toBe("en-US");
    const pl = await startFallback({ lang: "pl" });
    expect(pl.rec.lang).toBe("pl-PL");
  });

  it("wynik NIEOSTATECZNY strumieniuje tekst, ale NIE zatwierdza frazy", async () => {
    const { opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({ results: [{ isFinal: false, 0: { transcript: "poli" } }] });
    });
    expect(opts.onText).toHaveBeenCalledWith("poli");
    expect(opts.onFinal).not.toHaveBeenCalled();
  });

  it("wynik OSTATECZNY zatwierdza frazę (submit wyszukiwania)", async () => {
    const { opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({
        results: [
          { isFinal: false, 0: { transcript: "polityka " } },
          { isFinal: true, 0: { transcript: "energetyczna" } },
        ],
      });
    });
    expect(opts.onText).toHaveBeenCalledWith("polityka energetyczna");
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna");
  });

  it("PUSTY wynik nie czyści pola frazy", async () => {
    const { opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({ results: [{ isFinal: true, 0: { transcript: "   " } }] });
    });
    expect(opts.onText).not.toHaveBeenCalled();
    expect(opts.onFinal).not.toHaveBeenCalled();
  });

  it("wynik bez alternatywy nie wywraca hooka", async () => {
    const { opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({
        results: [{ isFinal: true } as unknown as { isFinal: boolean; 0: { transcript: string } }],
      });
    });
    expect(opts.onText).not.toHaveBeenCalled();
  });

  it("koniec rozpoznawania GASI nasłuch - przycisk wraca do stanu spoczynku", async () => {
    const { result, rec } = await startFallback();
    expect(result.current.listening).toBe(true);
    act(() => rec.onend?.());
    expect(result.current.listening).toBe(false);
  });

  it("błąd rozpoznawania jest cichy - stan gasi dopiero onend, który zawsze przychodzi", async () => {
    const { result, rec } = await startFallback();
    act(() => rec.onerror?.());
    expect(result.current.listening).toBe(true);
    act(() => rec.onend?.());
    expect(result.current.listening).toBe(false);
  });

  it("odmowa startu rozpoznawania nie zostawia zawieszonego nasłuchu", async () => {
    speechCtl.startThrows = true;
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });
});

describe("useVoiceSearch - sterowanie", () => {
  it("PONOWNY toggle podczas nagrywania kończy nagranie", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(true);
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(false);
  });

  it("toggle podczas rozpoznawania mowy zatrzymuje rozpoznawanie", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });

  it("toggle w trakcie transkrypcji jest IGNOROWANY - bez podwójnego nagrania", async () => {
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((r) => (release = r))),
    );
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    const before = recorders.length;
    act(() => result.current.toggle());
    expect(recorders).toHaveLength(before);
    await act(async () => {
      release({ ok: true, json: () => Promise.resolve({ text: "x" }) });
      await Promise.resolve();
    });
  });

  it("stop() kończy nagrywanie", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(false);
  });

  it("stop() kończy też rozpoznawanie mowy", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it("stop() bez rozpoczętego nagrania jest bezpiecznym no-opem", () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    expect(() => act(() => result.current.stop())).not.toThrow();
  });
});

describe("useVoiceSearch - sprzątanie", () => {
  it("ODMONTOWANIE zwalnia mikrofon - inaczej dioda świeci po opuszczeniu strony", async () => {
    const { result, unmount } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    unmount();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it("odmontowanie przerywa rozpoznawanie mowy", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    const { result, unmount } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    unmount();
    expect((speeches[0] as unknown as { stopped: boolean }).stopped).toBe(true);
  });

  it("odmontowanie bez rozpoczętego nagrania nie rzuca", () => {
    const { unmount } = renderHook(() => useVoiceSearch(options()));
    expect(() => unmount()).not.toThrow();
  });
});
