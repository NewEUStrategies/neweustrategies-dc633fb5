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
// `MediaRecorder`, `SpeechRecognition` i `fetch`. `AudioContext`
// i `requestAnimationFrame` są tylko liczone: nagrywanie nie stawia już grafu
// Web Audio ani pętli klatek (dawny VAD liczył RMS co klatkę i wynik
// wyrzucał, bo ciszy celowo nie wolno kończyć nagrania).
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
  /** Obietnica zwrócona przez `onstop` - test sprawdza, że się nie odrzuca. */
  lastStop?: void | Promise<void>;
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
};

function installMediaRecorder() {
  class FakeMediaRecorder implements RecorderInstance {
    static isTypeSupported = (m: string) => ctl.supportedMimes.includes(m);
    ondataavailable: RecorderInstance["ondataavailable"] = null;
    onstop: RecorderInstance["onstop"] = null;
    mimeType?: string;
    lastStop?: void | Promise<void>;
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
      this.lastStop = this.onstop?.();
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
}

interface SpeechEvent {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence?: number } }>;
}

interface SpeechInstance {
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
  /** Ile razy wystartowała sesja - auto-wznowienia w onend też się liczą. */
  starts: number;
  stopped: boolean;
  aborted: boolean;
}

const speeches: SpeechInstance[] = [];
/** `endOnStop: false` = realny silnik: po stop() przychodzi jeszcze wynik
 *  dla nagranego już dźwięku, a `end` dopiero, gdy test go odpali (`end`). */
const speechCtl = { available: true, startThrows: false, endOnStop: true };

function installSpeechRecognition() {
  class FakeSpeechRecognition implements SpeechInstance {
    lang = "";
    interimResults = false;
    continuous = false;
    maxAlternatives = 0;
    onresult: SpeechInstance["onresult"] = null;
    onend: SpeechInstance["onend"] = null;
    onerror: SpeechInstance["onerror"] = null;
    starts = 0;
    stopped = false;
    aborted = false;
    constructor() {
      speeches.push(this);
    }
    start() {
      if (speechCtl.startThrows) throw new Error("odmowa");
      this.starts += 1;
    }
    stop() {
      this.stopped = true;
      if (speechCtl.endOnStop) this.onend?.();
    }
    // Jak Chrome: abort() nic nie zgłasza synchronicznie, później przychodzi
    // `error: aborted` i `end`. Uchwyty są czytane w chwili zdarzenia, więc
    // test widzi, czy hook odpiął je przed abort().
    abort() {
      this.stopped = true;
      this.aborted = true;
      void Promise.resolve().then(() => {
        this.onerror?.({ error: "aborted" });
        this.onend?.();
      });
    }
  }
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
}

/** [transkrypcja, isFinal, confidence] - domyślnie finał 0.9, interim 0. */
type Seg = [string, boolean, number?];

/** Zdarzenie jak z Chrome w trybie ciągłym: CAŁA lista wyników sesji -
 *  finały zostają w niej do końca sesji, za nimi bieżący interim. */
function emit(rec: SpeechInstance, segs: Seg[]) {
  act(() => {
    rec.onresult?.({
      results: segs.map(([transcript, isFinal, confidence]) => ({
        isFinal,
        0: { transcript, confidence: confidence ?? (isFinal ? 0.9 : 0) },
      })),
    });
  });
}
const fail = (rec: SpeechInstance, error: string) => act(() => rec.onerror?.({ error }));
const end = (rec: SpeechInstance) => act(() => rec.onend?.());

/** Ile grafów Web Audio postawił hook. Atrapa jest pełna (źródło, filtr,
 *  analizator), żeby dawny kod VAD też przez nią przechodził. */
let audioContexts = 0;

function installAudio() {
  const analyser = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0),
  };
  class FakeAudioContext {
    state = "running";
    constructor() {
      audioContexts += 1;
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

let raf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  tracks.length = 0;
  recorders.length = 0;
  speeches.length = 0;
  audioContexts = 0;
  Object.assign(ctl, {
    recorderThrows: false,
    startThrows: false,
    supportedMimes: ["audio/webm;codecs=opus"],
    blobSize: 4000,
  });
  speechCtl.available = true;
  speechCtl.startThrows = false;
  speechCtl.endOnStop = true;

  getUserMedia.mockReset().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  installMediaRecorder();
  installSpeechRecognition();
  installAudio();

  raf = vi.fn(() => 1);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(raf as never);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

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

  // Dawny VAD stawiał graf Web Audio i pętlę `requestAnimationFrame`, która
  // co klatkę liczyła RMS z 1024 próbek przez całe nagranie (do 5 min) - a
  // wynik wyrzucała, bo ciszy celowo nie wolno kończyć nagrania.
  it("nagrywanie NIE stawia grafu Web Audio ani pętli klatek", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(result.current.listening).toBe(true);
    expect(audioContexts).toBe(0);
    expect(raf).not.toHaveBeenCalled();
  });
});

describe("useVoiceSearch - cisza nie kończy nagrania", () => {
  it("30 s nie zamyka nagrania; bezpiecznik 5 min tak", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
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

  it("ANONIM nie nagrywa W PRÓŻNIĘ - bez sesji nie ma prośby o mikrofon ani wysyłki", async () => {
    // Ten przypadek dokumentował wcześniej DEFEKT: anonim dostawał nagrywanie
    // (zgoda na mikrofon, czerwona dioda), a po zatrzymaniu `/api/stt` i tak
    // wymagało sesji - fraza nigdy nie wracała. Teraz anonim idzie w Web Speech.
    h.getSession.mockResolvedValue({ data: { session: null } });
    const { opts } = await recordAndStop();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(speeches).toHaveLength(1);
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

  it("OFFLINE: odrzucony fetch nie zostawia nieobsłużonego odrzucenia ani „zajęte”", async () => {
    // `onstop` miał try/finally bez catch: zerwane połączenie (albo
    // zablokowany magazyn sesji) kończyło się nieobsłużonym odrzuceniem
    // obietnicy - szum w telemetrii błędów JS.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result, opts } = await recordAndStop();
    await expect(recorders[0].lastStop).resolves.toBeUndefined();
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(opts.onText).not.toHaveBeenCalled();
    expect(opts.onFinal).not.toHaveBeenCalled();
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

/** Start dyktowania przez Web Speech (odmowa mikrofonu = fallback). */
async function startFallback(over: Partial<VoiceSearchOptions> = {}) {
  getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
  const opts = options(over);
  const hook = renderHook(() => useVoiceSearch(opts));
  await act(async () => hook.result.current.toggle());
  return { ...hook, opts, rec: speeches.at(-1)! };
}

describe("useVoiceSearch - fallback Web Speech API", () => {
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

  // Dawniej „wynik OSTATECZNY zatwierdza frazę" - i to przypinało defekt:
  // w trybie ciągłym finał zostaje w `results` do końca sesji, więc KAŻDE
  // kolejne zdarzenie zatwierdzało frazę od nowa.
  it("wynik OSTATECZNY trafia do pola od razu, a frazę zatwierdza dopiero stop", async () => {
    const { result, opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({
        results: [
          { isFinal: false, 0: { transcript: "polityka " } },
          { isFinal: true, 0: { transcript: "energetyczna" } },
        ],
      });
    });
    expect(opts.onText).toHaveBeenCalledWith("polityka energetyczna");
    expect(opts.onFinal).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna");
  });

  it("PUSTY wynik nie czyści pola frazy - ani w trakcie, ani po stopie", async () => {
    const { result, opts, rec } = await startFallback();
    act(() => {
      rec.onresult?.({ results: [{ isFinal: true, 0: { transcript: "   " } }] });
    });
    act(() => result.current.toggle());
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

  it("koniec rozpoznawania po ciszy WZNAWIA nasłuch; gasi go dopiero stop", async () => {
    const { result, rec } = await startFallback();
    act(() => rec.onend?.());
    expect(result.current.listening).toBe(true);
    act(() => result.current.toggle());
    act(() => rec.onend?.());
    expect(result.current.listening).toBe(false);
  });

  // Dawniej „błąd jest cichy - stan gasi dopiero onend, który zawsze
  // przychodzi". Kod błędu był ignorowany, a WebKit po odmowie zgody `end`
  // nie przysyła wcale. Cichy jest tylko błąd ciszy.
  it("`no-speech` jest cichy: nasłuch trwa, a koniec sesji ją wznawia", async () => {
    const { result, rec } = await startFallback();
    act(() => vi.advanceTimersByTime(8000));
    fail(rec, "no-speech");
    expect(result.current.listening).toBe(true);
    end(rec);
    expect(rec.starts).toBe(2);
    act(() => result.current.stop());
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

// Tryb ciągły (`continuous = true`): `e.results` to CAŁA sesja, finały
// zostają w liście do jej końca. Kod sprzed poprawki wołał onFinal, gdy
// w liście był JAKIKOLWIEK finał - czyli przy każdym zdarzeniu po pierwszym
// finale. Na /search to seria nawigacji, wpisów w „ostatnich" i wywołań
// `log_search_query`, w widgecie seria `search_autosuggest`. Kontrakt jest ten
// sam co w ścieżce serwerowej: jedno dyktowanie (start -> stop) = jeden submit.
describe("useVoiceSearch - Web Speech w trybie ciągłym: jedno dyktowanie = jeden submit", () => {
  it("REGRESJA: po pierwszym finale kolejne zdarzenia NIE zatwierdzają frazy - submit raz, po stopie", async () => {
    const { result, opts, rec } = await startFallback();
    const words = "polityka energetyczna unii europejskiej".split(" ");
    const finals: Seg[] = [];
    let events = 0;
    for (const [i, w] of words.entries()) {
      const lead = i ? " " : "";
      for (let n = 1; n < w.length; n += 2) {
        emit(rec, [...finals, [lead + w.slice(0, n), false]]);
        events++;
      }
      finals.push([lead + w, true]);
      emit(rec, [...finals]);
      events++;
    }
    expect(events).toBeGreaterThanOrEqual(20);
    expect(opts.onFinal).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna unii europejskiej");
    expect(opts.onText).toHaveBeenLastCalledWith("polityka energetyczna unii europejskiej");
  });

  it("wynik dosłany PO stop() (przed onend) trafia do frazy; mikrofon gaśnie od razu", async () => {
    speechCtl.endOnStop = false;
    const { result, opts, rec } = await startFallback();
    emit(rec, [["polityka", false]]);
    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
    expect(result.current.busy).toBe(true);
    emit(rec, [["polityka energetyczna", true]]);
    expect(opts.onFinal).not.toHaveBeenCalled();
    end(rec);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna");
    expect(result.current.busy).toBe(false);
  });

  it("klik w trakcie dosyłania wyniku NIE startuje drugiego rozpoznawania", async () => {
    // Dawniej stop zerował referencję od razu: nowy start szedł równolegle,
    // a spóźniony `end` starej instancji gasił `listening` nowej.
    speechCtl.endOnStop = false;
    const { result, rec } = await startFallback();
    act(() => result.current.toggle());
    await act(async () => result.current.toggle());
    expect(speeches).toHaveLength(1);
    end(rec);
    expect(result.current.listening).toBe(false);
    await act(async () => result.current.toggle());
    expect(speeches).toHaveLength(2);
    expect(result.current.listening).toBe(true);
  });

  it("auto-wznowienie sesji NIE gubi wcześniej podyktowanych słów", async () => {
    // Wznowiona sesja zaczyna od pustej listy wyników - bez bufora pole
    // pokazywało tylko ostatni odcinek i tylko on szedł do wyszukiwania.
    const { result, opts, rec } = await startFallback();
    emit(rec, [["polityka", true]]);
    act(() => vi.advanceTimersByTime(9000));
    fail(rec, "no-speech");
    end(rec);
    expect(rec.starts).toBe(2);
    expect(result.current.listening).toBe(true);
    emit(rec, [["energetyczna", true]]);
    expect(opts.onText).toHaveBeenLastCalledWith("polityka energetyczna");
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna");
  });

  it.each([
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "language-not-supported",
    "aborted",
  ])("błąd %s KOŃCZY dyktowanie - bez pętli start -> błąd -> koniec", async (code) => {
    const { result, rec } = await startFallback();
    fail(rec, code);
    end(rec);
    expect(rec.starts).toBe(1);
    expect(result.current.listening).toBe(false);
  });

  it("WebKit: odmowa zgody BEZ onend i tak gasi nasłuch", async () => {
    const { result, rec } = await startFallback();
    fail(rec, "not-allowed");
    expect(result.current.listening).toBe(false);
  });

  it("błąd krytyczny w trakcie dyktowania zatwierdza zebraną frazę RAZ", async () => {
    const { opts, rec } = await startFallback();
    emit(rec, [["unia europejska", false]]);
    fail(rec, "audio-capture");
    end(rec);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia europejska");
  });

  it("seria natychmiastowych końców (Brave: `network`) kończy dyktowanie zamiast kręcić pętlę", async () => {
    const { result, rec } = await startFallback();
    for (let i = 0; i < 5; i++) {
      fail(rec, "network");
      end(rec);
    }
    expect(rec.starts).toBe(3);
    expect(result.current.listening).toBe(false);
  });

  it("cisza (`no-speech` co ~8 s) wznawia sesję - nasłuch trwa aż do stopu", async () => {
    const { result, rec } = await startFallback();
    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(8000));
      fail(rec, "no-speech");
      end(rec);
    }
    expect(rec.starts).toBe(6);
    expect(result.current.listening).toBe(true);
  });

  it("sesja Z WYNIKIEM nie jest pustym obrotem: Android kończy po każdej wypowiedzi, tekst rośnie", async () => {
    const { result, opts, rec } = await startFallback();
    for (const w of ["unia", "europejska", "traktat", "lizbonski"]) {
      emit(rec, [[w, true]]);
      end(rec);
    }
    expect(rec.starts).toBe(5);
    expect(result.current.listening).toBe(true);
    expect(opts.onText).toHaveBeenLastCalledWith("unia europejska traktat lizbonski");
    expect(opts.onFinal).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia europejska traktat lizbonski");
  });

  it("wznowienie, które rzuca, kończy dyktowanie i zatwierdza frazę RAZ", async () => {
    const { result, opts, rec } = await startFallback();
    emit(rec, [["unia", true]]);
    expect(opts.onFinal).not.toHaveBeenCalled();
    speechCtl.startThrows = true;
    act(() => vi.advanceTimersByTime(9000));
    end(rec);
    expect(result.current.listening).toBe(false);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia");
  });

  it("bezpiecznik 5 min kończy też Web Speech i zatwierdza frazę RAZ", async () => {
    const { result, opts, rec } = await startFallback();
    emit(rec, [["unia", false]]);
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(rec.stopped).toBe(true);
    expect(result.current.listening).toBe(false);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia");
  });

  it("silnik, który po stop() NIE przyśle onend, nie zostawia hooka w „zajęte”", async () => {
    speechCtl.endOnStop = false;
    const { result, opts, rec } = await startFallback();
    emit(rec, [["unia", false]]);
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.busy).toBe(false);
    expect(result.current.listening).toBe(false);
    expect(rec.aborted).toBe(true);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia");
  });

  it("pusty wynik po stopie (nomatch) NIE kasuje podyktowanej frazy", async () => {
    speechCtl.endOnStop = false;
    const { result, opts, rec } = await startFallback();
    emit(rec, [["unia", false]]);
    act(() => result.current.toggle());
    emit(rec, [["", true]]);
    end(rec);
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia");
  });

  it("powtórzony identyczny interim NIE woła onText ponownie", async () => {
    const { opts, rec } = await startFallback();
    emit(rec, [["unia", false]]);
    emit(rec, [["unia", false]]);
    emit(rec, [["unia ", false]]);
    expect(opts.onText).toHaveBeenCalledTimes(1);
  });

  it("Android Chrome <158: rosnące hipotezy jako finały z confidence 0 nie dublują słów", async () => {
    const { result, opts, rec } = await startFallback();
    const list: Seg[] = [];
    for (const t of ["pol", "polityka", "polityka energetyczna"]) {
      list.push([t, true, 0]);
      emit(rec, [...list]);
    }
    list.push(["polityka energetyczna", true, 0.92]);
    emit(rec, [...list]);
    expect(opts.onText).toHaveBeenLastCalledWith("polityka energetyczna");
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("polityka energetyczna");
  });

  it("finał z pewnością > 0 skleja się normalnie („w” + „wschodniej” bez zwijania)", async () => {
    const { opts, rec } = await startFallback();
    emit(rec, [
      ["w", true, 0.8],
      [" wschodniej Europie", false],
    ]);
    expect(opts.onText).toHaveBeenLastCalledWith("w wschodniej Europie");
  });

  it("finał z confidence 0, po którym idzie INTERIM, nie jest zwijany", async () => {
    const { opts, rec } = await startFallback();
    emit(rec, [
      ["w", true, 0],
      [" wschodniej", false],
    ]);
    expect(opts.onText).toHaveBeenLastCalledWith("w wschodniej");
  });

  it("ODMONTOWANIE w trakcie dyktowania: spóźnione zdarzenia nie piszą do pola ani nie zatwierdzają", async () => {
    const { opts, rec, unmount } = await startFallback();
    emit(rec, [["unia", false]]);
    const lateResult = rec.onresult;
    const lateEnd = rec.onend;
    unmount();
    expect(rec.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    lateResult?.({ results: [{ isFinal: true, 0: { transcript: "unia europejska" } }] });
    lateEnd?.();
    expect(opts.onText).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).not.toHaveBeenCalled();
  });

  it("ODMONTOWANIE po stopie, przed onend: abort i zero zwrotek, także ze spóźnionego zdarzenia", async () => {
    // Stop zerował referencję, więc sprzątanie odmontowania nie miało już
    // czego przerwać, a spóźniony `end` zatwierdzał frazę spod innej strony.
    speechCtl.endOnStop = false;
    const { result, opts, rec, unmount } = await startFallback();
    emit(rec, [["unia", false]]);
    act(() => result.current.toggle());
    const lateResult = rec.onresult;
    const lateEnd = rec.onend;
    unmount();
    expect(rec.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    lateResult?.({ results: [{ isFinal: true, 0: { transcript: "unia europejska" } }] });
    lateEnd?.();
    expect(opts.onFinal).not.toHaveBeenCalled();
    expect(opts.onText).toHaveBeenCalledTimes(1);
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
    expect(speeches[0].stopped).toBe(true);
  });

  it("odmontowanie bez rozpoczętego nagrania nie rzuca", () => {
    const { unmount } = renderHook(() => useVoiceSearch(options()));
    expect(() => unmount()).not.toThrow();
  });
});

describe("useVoiceSearch - anonim (serwerowe STT wymaga sesji)", () => {
  beforeEach(() => {
    h.getSession.mockResolvedValue({ data: { session: null } });
  });

  it("ANONIM dyktuje przez Web Speech i fraza WRACA do pola, a po stopie do wyszukiwania", async () => {
    const opts = options();
    const { result } = renderHook(() => useVoiceSearch(opts));
    await act(async () => result.current.toggle());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(true);
    act(() => speeches[0].onresult?.({ results: [{ isFinal: true, 0: { transcript: "unia" } }] }));
    expect(opts.onText).toHaveBeenCalledWith("unia");
    // Jak w ścieżce serwerowej: submit dopiero po stopie, raz.
    expect(opts.onFinal).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(opts.onFinal).toHaveBeenCalledTimes(1);
    expect(opts.onFinal).toHaveBeenCalledWith("unia");
  });

  it("błąd odczytu sesji traktowany jak anonim - Web Speech, bez mikrofonu", async () => {
    h.getSession.mockRejectedValue(new Error("storage zablokowany"));
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(speeches).toHaveLength(1);
  });

  it("anonim BEZ Web Speech nie dostaje przycisku - jedyną drogą byłoby STT z sesją", async () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await waitFor(() => expect(result.current.supported).toBe(false));
    await act(async () => result.current.toggle());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("ZALOGOWANY bez Web Speech nadal ma przycisk - transkrypcja serwerowa działa", async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.supported).toBe(true);
  });
});

describe("useVoiceSearch - współbieżność startu i odmontowanie w locie", () => {
  /** getUserMedia wisi (dialog zgody) do ręcznego zwolnienia. */
  function pendingPermission() {
    let grant: (s: MediaStream) => void = () => {};
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((r) => (grant = r)));
    return (s: MediaStream) => grant(s);
  }

  it("DRUGI toggle podczas dialogu zgody NIE otwiera drugiego strumienia", async () => {
    const grant = pendingPermission();
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.toggle();
      result.current.toggle();
      await Promise.resolve();
    });
    await act(async () => {
      grant(fakeStream());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
    expect(result.current.listening).toBe(true);
  });

  it("po zakończonym starcie toggle znów działa - blokada nie zostaje na stałe", async () => {
    const { result } = renderHook(() => useVoiceSearch(options()));
    await act(async () => result.current.toggle());
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.listening).toBe(false);
    await act(async () => result.current.toggle());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.listening).toBe(true);
  });

  it("ODMONTOWANIE podczas dialogu zgody zwalnia mikrofon przyznany już po wyjściu", async () => {
    const grant = pendingPermission();
    const { result, unmount } = renderHook(() => useVoiceSearch(options()));
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    unmount();
    const late = fakeStream();
    await act(async () => {
      grant(late);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tracks[tracks.length - 1].stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
    // I nie startuje też Web Speech pod nieistniejącą już stroną.
    expect(speeches).toHaveLength(0);
  });

  it("ODMONTOWANIE w trakcie nagrania NIE wysyła go i NIE zatwierdza frazy", async () => {
    const opts = options();
    const { result, unmount } = renderHook(() => useVoiceSearch(opts));
    await act(async () => result.current.toggle());
    expect(recorders).toHaveLength(1);
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Wcześniej `onstop` odpalony przez sprzątanie wysyłał nagranie, a `onFinal`
    // nawigował z powrotem na /search spod strony, na którą użytkownik przeszedł.
    expect(fetch).not.toHaveBeenCalled();
    expect(opts.onFinal).not.toHaveBeenCalled();
  });

  it("transkrypcja, która wróci PO odmontowaniu, jest wyrzucana", async () => {
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((r) => (release = r))),
    );
    const opts = options();
    const { result, unmount } = renderHook(() => useVoiceSearch(opts));
    await act(async () => result.current.toggle());
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      release({ ok: true, json: () => Promise.resolve({ text: "spóźniona" }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(opts.onText).not.toHaveBeenCalled();
    expect(opts.onFinal).not.toHaveBeenCalled();
  });
});
