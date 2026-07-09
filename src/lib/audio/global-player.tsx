// Globalny odtwarzacz audio TTS artykułów. Trzyma jedną instancję
// HTMLAudioElement na cały czas życia aplikacji (provider mount w __root),
// dzięki czemu użytkownik może nawigować między stronami bez utraty ciągłości
// odtwarzania. Ładowanie audio idzie przez `/api/public/post-tts`, blob URL
// jest keszowany per postId+lang, żeby pobieranie MP3 nie generowało audio
// drugi raz.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface AudioTrackMeta {
  postId: string;
  lang: "pl" | "en";
  title: string;
  author?: string | null;
  authorHref?: string | null;
  postHref: string;
}

export type AudioStatus = "idle" | "loading" | "playing" | "paused" | "error";

/**
 * Etapy konwersji tekst -> audio przez ElevenLabs.
 * - idle: brak aktywnej konwersji
 * - preparing: żądanie wysyłane, serwer pobiera treść wpisu
 * - synthesizing: ElevenLabs generuje audio (czekamy na pierwsze bajty)
 * - streaming: strumieniowanie audio do przeglądarki
 * - ready: gotowe do odtwarzania
 * - cached: audio już było w cache (natychmiastowe)
 * - error: błąd na dowolnym etapie
 */
export type TtsStage =
  | "idle"
  | "preparing"
  | "synthesizing"
  | "streaming"
  | "ready"
  | "cached"
  | "error";

export interface TtsProgress {
  stage: TtsStage;
  /** 0-100 - procentowy postęp jeśli znany (streaming). */
  percent: number;
  /** Odebrane bajty (streaming). */
  bytes: number;
  /** Total bajty jeśli serwer podał Content-Length. */
  totalBytes: number | null;
  /** ms od startu konwersji, do wyświetlenia telemetrii. */
  elapsedMs: number;
}

interface AudioTrackState extends AudioTrackMeta {
  blobUrl: string;
}

interface GlobalPlayerContextValue {
  status: AudioStatus;
  track: AudioTrackState | null;
  currentTime: number;
  duration: number;
  progress: number;
  error: string | null;
  /** Aktualny etap konwersji TTS (dla widgetów pokazujących postęp). */
  tts: TtsProgress;
  /** True, gdy `postId` jest aktualnie załadowany (niezależnie od stanu play/pause). */
  isActive: (postId: string, lang: "pl" | "en") => boolean;
  loadAndPlay: (meta: AudioTrackMeta) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  seekPct: (pct: number) => void;
  close: () => void;
  download: (meta?: AudioTrackMeta) => Promise<void>;
}

const INITIAL_TTS: TtsProgress = {
  stage: "idle",
  percent: 0,
  bytes: 0,
  totalBytes: null,
  elapsedMs: 0,
};


const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

// Cache blob URL na sesję. Ten sam artykuł ⇒ ten sam blob (bez ponownego TTS).
const audioBlobCache = new Map<string, string>();

function cacheKey(postId: string, lang: "pl" | "en"): string {
  return `${postId}:${lang}`;
}

function sanitizeFilename(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-_ ]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "artykul"
  );
}

export function GlobalAudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [track, setTrack] = useState<AudioTrackState | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tts, setTts] = useState<TtsProgress>(INITIAL_TTS);


  // Lazy audio element - tworzymy w efekcie, żeby nie ruszać `Audio` w SSR.
  useEffect(() => {
    if (audioRef.current || typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("play", () => setStatus("playing"));
    audio.addEventListener("pause", () => {
      if (!audio.ended) setStatus("paused");
    });
    audio.addEventListener("ended", () => {
      setStatus("paused");
      setCurrentTime(0);
    });
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration || 0));
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("error", () => {
      setStatus("error");
      setError("Nie udało się odtworzyć audio");
    });
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  const fetchBlob = useCallback(
    async (postId: string, lang: "pl" | "en"): Promise<string> => {
      const key = cacheKey(postId, lang);
      const cached = audioBlobCache.get(key);
      if (cached) {
        setTts({
          stage: "cached",
          percent: 100,
          bytes: 0,
          totalBytes: null,
          elapsedMs: 0,
        });
        return cached;
      }

      const startedAt = performance.now();
      setTts({
        stage: "preparing",
        percent: 0,
        bytes: 0,
        totalBytes: null,
        elapsedMs: 0,
      });

      const res = await fetch("/api/public/post-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, lang }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setTts({
          stage: "error",
          percent: 0,
          bytes: 0,
          totalBytes: null,
          elapsedMs: performance.now() - startedAt,
        });
        throw new Error(msg || `HTTP ${res.status}`);
      }

      // Nagłówki dostępne → ElevenLabs zaczął strumieniować bajty.
      const totalHeader = res.headers.get("content-length");
      const totalBytes = totalHeader ? Number(totalHeader) : null;
      setTts({
        stage: "synthesizing",
        percent: 0,
        bytes: 0,
        totalBytes,
        elapsedMs: performance.now() - startedAt,
      });

      // Preferuj streaming reader, żeby móc pokazać progress. Fallback do
      // `res.blob()` gdy body nie jest czytelne (np. stary browser).
      let blob: Blob;
      const body = res.body;
      if (body && typeof body.getReader === "function") {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        let announcedStreaming = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            if (!announcedStreaming) {
              announcedStreaming = true;
            }
            setTts({
              stage: "streaming",
              percent:
                totalBytes && totalBytes > 0
                  ? Math.min(99, Math.round((received / totalBytes) * 100))
                  : 0,
              bytes: received,
              totalBytes,
              elapsedMs: performance.now() - startedAt,
            });
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
      } else {
        blob = await res.blob();
      }

      const url = URL.createObjectURL(blob);
      audioBlobCache.set(key, url);
      setTts({
        stage: "ready",
        percent: 100,
        bytes: blob.size,
        totalBytes: totalBytes ?? blob.size,
        elapsedMs: performance.now() - startedAt,
      });
      return url;
    },
    [],
  );


  const loadAndPlay = useCallback(
    async (meta: AudioTrackMeta) => {
      const audio = audioRef.current;
      if (!audio) return;
      // Jeśli ten sam track ⇒ tylko play.
      if (track && track.postId === meta.postId && track.lang === meta.lang) {
        try {
          await audio.play();
        } catch {
          /* auto-play może być zablokowany - user musi kliknąć jeszcze raz */
        }
        return;
      }
      setStatus("loading");
      setError(null);
      try {
        const blobUrl = await fetchBlob(meta.postId, meta.lang);
        audio.src = blobUrl;
        audio.currentTime = 0;
        setTrack({ ...meta, blobUrl });
        setCurrentTime(0);
        setDuration(0);
        await audio.play();
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Błąd ładowania audio");
      }
    },
    [track, fetchBlob],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        /* noop */
      }
    } else {
      audio.pause();
    }
  }, [track]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, seconds));
  }, []);

  const seekPct = useCallback((pct: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = (Math.max(0, Math.min(100, pct)) / 100) * audio.duration;
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    setTrack(null);
    setStatus("idle");
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const download = useCallback(
    async (meta?: AudioTrackMeta) => {
      const target: AudioTrackMeta | AudioTrackState | null = meta ?? track;
      if (!target) return;
      const existingBlob = (target as AudioTrackState).blobUrl;
      const url = existingBlob ?? (await fetchBlob(target.postId, target.lang));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(target.title)}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [track, fetchBlob],
  );



  const isActive = useCallback(
    (postId: string, lang: "pl" | "en") =>
      !!track && track.postId === postId && track.lang === lang,
    [track],
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const value = useMemo<GlobalPlayerContextValue>(
    () => ({
      status,
      track,
      currentTime,
      duration,
      progress,
      error,
      tts,
      isActive,
      loadAndPlay,
      toggle,
      seek,
      seekPct,
      close,
      download,
    }),
    [
      status,
      track,
      currentTime,
      duration,
      progress,
      error,
      tts,
      isActive,
      loadAndPlay,
      toggle,
      seek,
      seekPct,
      close,
      download,
    ],
  );


  return <GlobalPlayerContext.Provider value={value}>{children}</GlobalPlayerContext.Provider>;
}

export function useGlobalAudioPlayer(): GlobalPlayerContextValue {
  const ctx = useContext(GlobalPlayerContext);
  if (!ctx) {
    // Fallback no-op - używane w SSR / poza providerem, żeby nie wybuchać.
    return {
      status: "idle",
      track: null,
      currentTime: 0,
      duration: 0,
      progress: 0,
      error: null,
      tts: INITIAL_TTS,
      isActive: () => false,

      loadAndPlay: async () => {},
      toggle: async () => {},
      seek: () => {},
      seekPct: () => {},
      close: () => {},
      download: async () => {},
    };
  }
  return ctx;
}

export function formatAudioTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
