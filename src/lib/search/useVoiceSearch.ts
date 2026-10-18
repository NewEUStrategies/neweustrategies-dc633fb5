// Dyktowanie frazy wyszukiwarki. Domyślnie używa serwerowego STT (bramka AI
// Gateway - openai/gpt-4o-mini-transcribe), który znacznie lepiej rozpoznaje
// polską i angielską mowę niż wbudowany Web Speech API. Fallback do Web Speech
// API działa dla anonimowych uzytkowników i tam, gdzie nagrywanie nie jest
// dostępne (np. brak MediaRecorder / mikrofonu).
//
// Anonim idzie w Web Speech OD RAZU, przed prośbą o mikrofon: `/api/stt`
// odpowiada mu 401, więc nagranie bez sesji kończyło się w próżni - mikrofon
// świecił, użytkownik mówił, a fraza nigdy nie wracała do pola.
//
// UX (wspólny dla OBU ścieżek): jedno dyktowanie na start(). Podczas nagrywania
// `listening=true`. Kończy je stop (ponowne kliknięcie), bezpiecznik 5 min
// albo błąd nie do obejścia - cisza NIE. Po zakończeniu `busy=true` (POST na
// /api/stt albo ostatni wynik Web Speech), a fraza płynie do onText i RAZ do
// onFinal. Web Speech w trakcie dyktowania strumieniuje tekst do onText.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Nagrywanie trwa, aż użytkownik sam kliknie stop. Jedyny bezpiecznik to
// 5 minut, żeby porzucona karta nie trzymała mikrofonu w nieskończoność.
const MAX_RECORDING_MS = 5 * 60_000;
// Web Speech po stop() dosyła wynik dla nagranego już dźwięku i dopiero potem
// `end`. Silnik, który `end` zgubi, nie może zostawić hooka w „busy".
const FLUSH_TIMEOUT_MS = 3000;
// Sesja krótsza niż to i BEZ wyniku to „pusty obrót". Tyle pustych obrotów
// z rzędu = pętla start -> koniec (Brave zawsze odpowiada `network`). Sesja
// z wynikiem pusta nie jest: Android kończy sesję po każdej wypowiedzi.
const MIN_SESSION_MS = 1000;
const MAX_EMPTY_ENDS = 3;
// Błędy, po których wolno wznowić sesję: cisza (Chrome kończy po ~8 s) i
// chwilowa sieć. Reszta - odmowa zgody, brak lub zajęty mikrofon, język,
// `aborted` (mikrofon przejęła inna karta) - kończy dyktowanie. Wznawianie po
// nich kręciło pętlę start -> błąd -> koniec i ponawiało pytanie o zgodę.
const RESTARTABLE_ERRORS = new Set(["no-speech", "network"]);
const SILENCE_AFTER_SPEECH_MS = 1100; // auto-stop po ciszy, gdy juz coś powiedziano
const CALIBRATION_MS = 400; // pierwsze ~400ms - pomiar szumu tła
const MIN_SPEECH_MS = 250; // ile mowy musi się nazbierać, żeby uznać nagranie za sensowne
const NOISE_MULT = 2.2; // próg mowy = max(baseFloor, noiseFloor * NOISE_MULT)
const BASE_FLOOR = 0.008; // minimalny próg RMS, gdy tło jest bardzo ciche
const SPEECH_HANGOVER_MS = 180; // krótkie „przytrzymanie" po detekcji mowy - stabilizuje VAD

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Jedno dyktowanie Web Speech - od start() do onFinal. Przeżywa
 *  auto-wznowienia sesji rozpoznawania (każda zaczyna od pustej listy). */
interface WebSpeechDictation {
  rec: SpeechRecognitionLike;
  /** Tekst sesji zamkniętych przed auto-wznowieniem. */
  carried: string;
  /** Bieżąca sesja: finały i ostatni interim. */
  session: string;
  /** Ostatni tekst oddany do onText. */
  shown: string;
  sessionAt: number;
  /** Bieżąca sesja oddała niepusty tekst. */
  hadResult: boolean;
  emptyEnds: number;
  /** Stop użytkownika albo bezpiecznika - `end` już nie wznawia sesji. */
  stopping: boolean;
  done: boolean;
  capTimer: number;
  flushTimer: number | null;
}

const norm = (s: string) => s.trim().toLowerCase();
const joinPhrase = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);

/** Tekst bieżącej sesji. W trybie ciągłym `results` to CAŁA sesja: finały
 *  zostają w liście do końca, za nimi bieżący interim, a transkrypcje niosą
 *  własne spacje - sklejamy wszystko od zera. Android Chrome <158 oddaje każdą
 *  hipotezę rosnącego zdania jako osobny finał z confidence 0: taki wynik,
 *  który następny finał tylko przedłuża, pomijamy, zamiast dublować słowa. */
function sessionTranscript(results: ArrayLike<SpeechRecognitionResultLike>): string {
  let text = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = r?.[0]?.transcript ?? "";
    if (!t.trim()) continue;
    const next = i + 1 < results.length ? results[i + 1] : undefined;
    if (
      r.isFinal &&
      r[0].confidence === 0 &&
      next?.isFinal &&
      norm(next[0]?.transcript ?? "").startsWith(norm(t))
    ) {
      continue;
    }
    text += t;
  }
  return text.replace(/\s+/g, " ").trim();
}

function abortQuietly(rec: SpeechRecognitionLike) {
  try {
    rec.abort();
  } catch {
    // rozpoznawanie już zamknięte
  }
}

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Czy jest sesja z tokenem - warunek serwerowej transkrypcji (`/api/stt`
 *  wymaga zalogowania). Błąd odczytu sesji = brak sesji. */
async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session?.access_token;
  } catch {
    return false;
  }
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

export interface VoiceSearchOptions {
  lang: "pl" | "en";
  /** Strumień transkrypcji - zwykle setter pola frazy. */
  onText: (text: string) => void;
  /** Finalna transkrypcja - RAZ na dyktowanie, po jego końcu (np. submit frazy). */
  onFinal?: (text: string) => void;
}

export interface VoiceSearch {
  supported: boolean;
  listening: boolean;
  busy: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useVoiceSearch({ lang, onText, onFinal }: VoiceSearchOptions): VoiceSearch {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);

  const onTextRef = useRef(onText);
  const onFinalRef = useRef(onFinal);
  onTextRef.current = onText;
  onFinalRef.current = onFinal;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const hardStopTimerRef = useRef<number | null>(null);
  /** Dyktowanie Web Speech - trzymane aż do onFinal, także w fazie stopu
   *  (ostatni wynik w drodze): toggle w tym oknie nie startuje drugiego. */
  const dictationRef = useRef<WebSpeechDictation | null>(null);
  /** Start w locie (sesja, zgoda na mikrofon) - drugi toggle w tym oknie
   *  otwierałby DRUGI strumień, a pierwszego nikt by już nie zamknął. */
  const startingRef = useRef(false);
  /** Hook zamontowany. Każde `await` w starcie i w transkrypcji może skończyć
   *  się już po opuszczeniu strony - wtedy wynik trzeba wyrzucić. */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const speech = speechRecognitionCtor() !== null;
    const record = canRecord();
    setSupported(speech || record);
    if (speech || !record) return;
    // Bez Web Speech jedyną drogą jest serwerowe STT, a ono wymaga sesji -
    // anonim dostałby przycisk, który nic nie robi.
    let cancelled = false;
    void hasSession().then((ok) => {
      if (!cancelled && !ok) setSupported(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cleanup = useCallback(() => {
    if (analyserRafRef.current) cancelAnimationFrame(analyserRafRef.current);
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    if (hardStopTimerRef.current) window.clearTimeout(hardStopTimerRef.current);
    analyserRafRef.current = null;
    silenceTimerRef.current = null;
    hardStopTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
  }, []);

  /** JEDYNE wyjście z dyktowania Web Speech i jedyne miejsce, które woła
   *  onFinal. Idempotentne; odpina uchwyty, więc spóźnione `result`/`end`/
   *  `error` (np. po abort()) już niczego nie ruszą. */
  const finishDictation = useCallback((d: WebSpeechDictation, commit = true) => {
    if (d.done) return;
    d.done = true;
    window.clearTimeout(d.capTimer);
    if (d.flushTimer != null) window.clearTimeout(d.flushTimer);
    d.rec.onresult = null;
    d.rec.onerror = null;
    d.rec.onend = null;
    if (dictationRef.current === d) dictationRef.current = null;
    // Stan przed zwrotkami: konsument, który w onFinal rzuci albo od razu
    // wystartuje kolejne dyktowanie, zastaje hook już spójny.
    setListening(false);
    setBusy(false);
    const text = joinPhrase(d.carried, d.session);
    // Po odmontowaniu submit nawigowałby na /search spod innej strony.
    if (!commit || !text || !aliveRef.current) return;
    if (text !== d.shown) onTextRef.current(text);
    onFinalRef.current?.(text);
  }, []);

  /** Stop użytkownika albo bezpiecznika. Fraza idzie dopiero z `end`, bo
   *  przeglądarka po stop() dosyła jeszcze wynik dla nagranego dźwięku. */
  const requestStop = useCallback(
    (d: WebSpeechDictation) => {
      if (d.done || d.stopping) return;
      d.stopping = true;
      setListening(false);
      setBusy(true);
      d.flushTimer = window.setTimeout(() => {
        finishDictation(d);
        abortQuietly(d.rec);
      }, FLUSH_TIMEOUT_MS);
      try {
        d.rec.stop();
      } catch {
        finishDictation(d);
      }
    },
    [finishDictation],
  );

  useEffect(
    () => () => {
      aliveRef.current = false;
      const d = dictationRef.current;
      if (d) {
        // Odpięcie PRZED abort(): `aborted` i `end` przychodzą później.
        finishDictation(d, false);
        abortQuietly(d.rec);
      }
      try {
        recorderRef.current?.stop();
      } catch {
        // recorder juz w innym stanie - nic nie robimy
      }
      recorderRef.current = null;
      cleanup();
    },
    [cleanup, finishDictation],
  );

  const pickMimeType = (): string => {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
    for (const m of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return "";
  };

  const uploadForTranscription = useCallback(
    async (blob: Blob): Promise<string | null> => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return null; // anon -> fallback do Web Speech
      const fd = new FormData();
      const ext = blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("mpeg")
          ? "mp3"
          : blob.type.includes("wav")
            ? "wav"
            : "webm";
      fd.append("file", blob, `voice.${ext}`);
      fd.append("lang", lang);
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as { text?: string } | null;
      return (data?.text ?? "").trim() || null;
    },
    [lang],
  );

  const startWebSpeechFallback = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = lang === "en" ? "en-US" : "pl-PL";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    const d: WebSpeechDictation = {
      rec,
      carried: "",
      session: "",
      shown: "",
      sessionAt: Date.now(),
      hadResult: false,
      emptyEnds: 0,
      stopping: false,
      done: false,
      capTimer: 0,
      flushTimer: null,
    };
    // `isFinal` NIE zatwierdza frazy: finały zostają w `results` do końca
    // sesji, więc każde kolejne zdarzenie (interim następnych słów) odpalało
    // submit od nowa. Tu tylko strumień do pola; submit robi finishDictation.
    rec.onresult = (e) => {
      if (d.done) return;
      // Pusty wynik (nomatch, sam szum) nie kasuje podyktowanej frazy.
      const session = sessionTranscript(e.results);
      if (!session) return;
      d.session = session;
      d.hadResult = true;
      const text = joinPhrase(d.carried, d.session);
      if (text === d.shown) return;
      d.shown = text;
      onTextRef.current(text);
    };
    rec.onerror = (e) => {
      if (d.done) return;
      // WebKit po odmowie zgody i braku mikrofonu NIE przysyła `end`, więc
      // błąd krytyczny kończy dyktowanie od razu, tutaj.
      if (!RESTARTABLE_ERRORS.has(e?.error ?? "")) finishDictation(d);
    };
    rec.onend = () => {
      if (d.done) return;
      // Wznowiona sesja zaczyna od pustej listy - tekst tej idzie do bufora.
      d.carried = joinPhrase(d.carried, d.session);
      d.session = "";
      if (!d.stopping) {
        // Przeglądarka sama kończy sesję po ciszy - wznawiamy, dopóki
        // użytkownik nie kliknie stop.
        const now = Date.now();
        const empty = !d.hadResult && now - d.sessionAt < MIN_SESSION_MS;
        d.emptyEnds = empty ? d.emptyEnds + 1 : 0;
        d.hadResult = false;
        if (d.emptyEnds < MAX_EMPTY_ENDS) {
          try {
            rec.start();
            d.sessionAt = now;
            return;
          } catch {
            /* nie da się wznowić - kończymy */
          }
        }
      }
      finishDictation(d);
    };
    try {
      rec.start();
    } catch {
      return false;
    }
    dictationRef.current = d;
    d.capTimer = window.setTimeout(() => requestStop(d), MAX_RECORDING_MS);
    setListening(true);
    return true;
  }, [lang, finishDictation, requestStop]);

  const stopRecording = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      // recorder juz w innym stanie
    }
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (!canRecord()) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    if (!aliveRef.current) {
      // Zgoda przyszła po odmontowaniu - nikt już nie zamknie tego strumienia.
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    const mime = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      setListening(false);
      const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
      chunksRef.current = [];
      recorderRef.current = null;
      cleanup();
      // Odmontowanie zatrzymuje rekorder, a to też odpala `onstop`. Wysyłka
      // po opuszczeniu strony paliłaby kredyty, a `onFinal` (submit frazy)
      // nawigowałby z powrotem na /search spod innej strony.
      if (!aliveRef.current) return;
      if (blob.size < 1500) return; // za krótkie / cisza
      setBusy(true);
      try {
        const text = await uploadForTranscription(blob);
        if (text && aliveRef.current) {
          onTextRef.current(text);
          onFinalRef.current?.(text);
        }
      } finally {
        setBusy(false);
      }
    };

    // Adaptacyjny VAD: kalibrujemy szum tła w pierwszych ~400 ms, potem próg mowy
    // = max(BASE_FLOOR, noiseFloor * NOISE_MULT). Auto-stop dopiero po tym, jak
    // usłyszymy realną mowę (>=250 ms), z krótką „hangover" po ostatniej sylabie.
    // Highpass 90 Hz odcina buczenie klimatyzacji/wiatru, a smoothing EMA tłumi
    // pojedyncze piki (klaśnięcie, uderzenie w klawiaturę).
    try {
      const ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 90;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(highpass);
      highpass.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const startedAt = performance.now();
      let noiseFloor = BASE_FLOOR;
      let noiseSamples = 0;
      let ema = 0;
      let speechMs = 0;
      let lastVoiceAt = 0;
      let lastTick = startedAt;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        ema = ema === 0 ? rms : ema * 0.7 + rms * 0.3;
        const now = performance.now();
        const dt = now - lastTick;
        lastTick = now;
        const elapsed = now - startedAt;

        if (elapsed < CALIBRATION_MS) {
          noiseSamples += 1;
          noiseFloor = noiseFloor + (ema - noiseFloor) / noiseSamples;
          analyserRafRef.current = requestAnimationFrame(tick);
          return;
        }

        const threshold = Math.max(BASE_FLOOR, noiseFloor * NOISE_MULT);
        const isVoice = ema > threshold;
        if (isVoice) {
          speechMs += dt;
          lastVoiceAt = now;
          if (silenceTimerRef.current != null) {
            window.clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speechMs >= MIN_SPEECH_MS) {
          const sinceVoice = now - lastVoiceAt;
          if (sinceVoice > SPEECH_HANGOVER_MS && silenceTimerRef.current == null) {
            const wait = Math.max(0, SILENCE_AFTER_SPEECH_MS - (sinceVoice - SPEECH_HANGOVER_MS));
            void wait; // cisza nie kończy nagrania - tylko przycisk stop
          }
        }
        analyserRafRef.current = requestAnimationFrame(tick);
      };
      analyserRafRef.current = requestAnimationFrame(tick);
    } catch {
      // brak AudioContext - tylko twardy timeout
    }

    hardStopTimerRef.current = window.setTimeout(() => stopRecording(), MAX_RECORDING_MS);

    try {
      recorder.start();
      setListening(true);
      return true;
    } catch {
      cleanup();
      recorderRef.current = null;
      return false;
    }
  }, [cleanup, stopRecording, uploadForTranscription]);

  const toggle = useCallback(() => {
    if (busy || startingRef.current) return;
    const d = dictationRef.current;
    if (d) {
      requestStop(d);
      return;
    }
    if (recorderRef.current) {
      stopRecording();
      return;
    }
    startingRef.current = true;
    void (async () => {
      try {
        // Nagrywamy tylko wtedy, gdy ktoś to przepisze: anonim od razu
        // dostaje rozpoznawanie w przeglądarce.
        const ok = (await hasSession()) && aliveRef.current && (await startRecording());
        if (!ok && aliveRef.current) startWebSpeechFallback();
      } finally {
        startingRef.current = false;
      }
    })();
  }, [busy, requestStop, startRecording, startWebSpeechFallback, stopRecording]);

  const stop = useCallback(() => {
    const d = dictationRef.current;
    if (d) requestStop(d);
    else stopRecording();
  }, [requestStop, stopRecording]);

  return { supported, listening, busy, toggle, stop };
}
