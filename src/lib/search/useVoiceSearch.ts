// Dyktowanie frazy wyszukiwarki (Web Speech API). Progressive enhancement:
// `supported` jest false na serwerze i w przeglądarkach bez SpeechRecognition
// (Firefox) - UI wtedy chowa przycisk mikrofonu. `supported` ustawia się
// dopiero w efekcie, żeby render hydratacji zgadzał się z SSR.
//
// Jedno nagranie na start(): transkrypcje cząstkowe płyną do onText (podgląd
// w polu na żywo), finał dodatkowo do onFinal (rodzic decyduje: submit czy
// tylko wpisanie). Koniec/błąd nagrania zawsze gasi `listening`.
import { useCallback, useEffect, useRef, useState } from "react";

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

export interface VoiceSearchOptions {
  lang: "pl" | "en";
  /** Strumień transkrypcji (cząstkowe + finalna) - zwykle setter pola frazy. */
  onText: (text: string) => void;
  /** Tylko finalna transkrypcja - np. submit frazy. */
  onFinal?: (text: string) => void;
}

export interface VoiceSearch {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useVoiceSearch({ lang, onText, onFinal }: VoiceSearchOptions): VoiceSearch {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Callbacki w refach: instancja nagrania nie restartuje się przy re-renderze.
  const onTextRef = useRef(onText);
  const onFinalRef = useRef(onFinal);
  onTextRef.current = onText;
  onFinalRef.current = onFinal;

  useEffect(() => {
    setSupported(speechRecognitionCtor() !== null);
  }, []);

  useEffect(
    () => () => {
      recRef.current?.abort();
      recRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    // stop() (nie abort) - pozwala API domknąć nagranie finalnym wynikiem.
    recRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang === "en" ? "en-US" : "pl-PL";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let text = "";
      let hasFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        text += result[0]?.transcript ?? "";
        if (result.isFinal) hasFinal = true;
      }
      const phrase = text.trim();
      if (!phrase) return;
      onTextRef.current(phrase);
      if (hasFinal) onFinalRef.current?.(phrase);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      // onend przychodzi po onerror; sprzątanie jest tam.
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      // np. start() w trakcie innego nagrania - zostajemy w stanie spoczynku.
    }
  }, [lang]);

  return { supported, listening, toggle, stop };
}
