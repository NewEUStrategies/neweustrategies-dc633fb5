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

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const joinPhrase = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);

/** Tekst bieżącej sesji. W trybie ciągłym `results` to CAŁA sesja: finały
 *  zostają w liście do końca, za nimi bieżący interim - składamy wszystko od
 *  zera. Wyniki łączy pojedyncza spacja: Chrome desktop dokleja spację wiodącą
 *  sam, ale WebKit i segmenty Androida oddają transkrypcje przycięte, więc
 *  pauza w zdaniu sklejała dwa słowa w jedno. Android Chrome <158 oddaje każdą
 *  hipotezę rosnącego zdania jako osobny finał z confidence 0: taki wynik,
 *  który następny finał tylko przedłuża o kolejne słowa, pomijamy, zamiast
 *  dublować słowa. Granica słowa, nie znaku: niezależne segmenty (WebKit oddaje
 *  każdą wypowiedź osobno) „w" + „Warszawie" nie mogą zgubić przyimka. */
function sessionTranscript(results: ArrayLike<SpeechRecognitionResultLike>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = r?.[0]?.transcript ?? "";
    if (!t.trim()) continue;
    const next = i + 1 < results.length ? results[i + 1] : undefined;
    if (r.isFinal && r[0].confidence === 0 && next?.isFinal) {
      const cur = norm(t);
      const following = norm(next[0]?.transcript ?? "");
      if (following === cur || following.startsWith(`${cur} `)) continue;
    }
    parts.push(t.trim());
  }
  return parts.join(" ").replace(/\s+/g, " ");
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
    if (hardStopTimerRef.current) window.clearTimeout(hardStopTimerRef.current);
    hardStopTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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
      } catch {
        // Offline albo zablokowany magazyn sesji - bez frazy, jak przy błędzie
        // bramki (`onstop` jest async: bez catch to nieobsłużone odrzucenie).
      } finally {
        setBusy(false);
      }
    };

    // Cisza NIE kończy nagrania - tylko stop albo ten bezpiecznik. Dawny VAD
    // (graf Web Audio + pętla klatek liczącą RMS) niczego już nie sterował.
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
