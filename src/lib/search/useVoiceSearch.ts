// Dyktowanie frazy wyszukiwarki. Domyślnie używa serwerowego STT (Lovable AI
// Gateway - openai/gpt-4o-mini-transcribe), który znacznie lepiej rozpoznaje
// polską i angielską mowę niż wbudowany Web Speech API. Fallback do Web Speech
// API działa dla anonimowych uzytkowników i tam, gdzie nagrywanie nie jest
// dostępne (np. brak MediaRecorder / mikrofonu).
//
// UX: jedno nagranie na start(). Podczas nagrywania `listening=true`. Po
// zatrzymaniu (ponowne kliknięcie / cisza) idzie POST na /api/stt i wynik
// płynie do onText/onFinal.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const MAX_RECORDING_MS = 30_000; // twardy sufit, żeby użytkownik nie „zapomniał" mikrofonu
const SILENCE_AFTER_SPEECH_MS = 1100; // auto-stop po ciszy, gdy juz coś powiedziano
const NO_SPEECH_TIMEOUT_MS = 6000; // gdy nic nie wykryto - zamykamy szybciej niż hard cap
const CALIBRATION_MS = 400; // pierwsze ~400ms - pomiar szumu tła
const MIN_SPEECH_MS = 250; // ile mowy musi się nazbierać, żeby uznać nagranie za sensowne
const NOISE_MULT = 2.2; // próg mowy = max(baseFloor, noiseFloor * NOISE_MULT)
const BASE_FLOOR = 0.008; // minimalny próg RMS, gdy tło jest bardzo ciche
const SPEECH_HANGOVER_MS = 180; // krótkie „przytrzymanie" po detekcji mowy - stabilizuje VAD

interface SpeechRecognitionAlternativeLike {
  transcript: string;
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
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
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
  /** Finalna transkrypcja - np. submit frazy. */
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
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(canRecord() || speechRecognitionCtor() !== null);
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

  useEffect(
    () => () => {
      speechRecRef.current?.abort();
      speechRecRef.current = null;
      try {
        recorderRef.current?.stop();
      } catch {
        // recorder juz w innym stanie - nic nie robimy
      }
      recorderRef.current = null;
      cleanup();
    },
    [cleanup],
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
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = "";
      let hasFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        text += r[0]?.transcript ?? "";
        if (r.isFinal) hasFinal = true;
      }
      const phrase = text.trim();
      if (!phrase) return;
      onTextRef.current(phrase);
      if (hasFinal) onFinalRef.current?.(phrase);
    };
    rec.onend = () => {
      speechRecRef.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      /* onend zawsze przychodzi po onerror */
    };
    try {
      rec.start();
      speechRecRef.current = rec;
      setListening(true);
      return true;
    } catch {
      return false;
    }
  }, [lang]);

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
      if (blob.size < 1500) return; // za krótkie / cisza
      setBusy(true);
      try {
        const text = await uploadForTranscription(blob);
        if (text) {
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
            silenceTimerRef.current = window.setTimeout(() => stopRecording(), wait);
          }
        } else if (elapsed > NO_SPEECH_TIMEOUT_MS) {
          // Nic sensownego się nie pojawiło - kończymy, żeby nie palić czasu ani kredytów.
          stopRecording();
          return;
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
    if (busy) return;
    if (speechRecRef.current) {
      speechRecRef.current.stop();
      return;
    }
    if (recorderRef.current) {
      stopRecording();
      return;
    }
    void (async () => {
      const ok = await startRecording();
      if (!ok) startWebSpeechFallback();
    })();
  }, [busy, startRecording, startWebSpeechFallback, stopRecording]);

  const stop = useCallback(() => {
    if (speechRecRef.current) speechRecRef.current.stop();
    else stopRecording();
  }, [stopRecording]);

  return { supported, listening, busy, toggle, stop };
}
