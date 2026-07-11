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
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { announcePlayback, subscribePlayback } from "@/lib/audio/playbackBus";

export interface AudioTrackMeta {
  postId: string;
  lang: "pl" | "en";
  title: string;
  author?: string | null;
  authorHref?: string | null;
  postHref: string;
  /**
   * Wgrany plik MP3 (per język). Gdy podany, fetcher pobiera bezpośrednio ten
   * URL i pomija endpoint /api/public/post-tts - ElevenLabs nie jest wywoływany.
   * Fallback (brak audioUrl) generuje narrację AI jak dotąd.
   */
  audioUrl?: string | null;
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

// Górny limit trzymanych blobów. Zapobiega nieograniczonemu wzrostowi pamięci
// w długiej sesji - najstarsze wpisy są usuwane, a ich blob URL zwalniane.
const MAX_CACHED_BLOBS = 12;

function cacheKey(postId: string, lang: "pl" | "en"): string {
  return `${postId}:${lang}`;
}

/**
 * Wybór źródła audio dla wpisu w danym języku. Gdy wgrany jest MP3 dla tego
 * języka - pobieramy plik bezpośrednio (GET, ElevenLabs pomijany). W przeciwnym
 * razie odpalamy TTS przez `/api/public/post-tts` z payloadem `{ postId, lang }`.
 * Eksportowane, żeby móc testować kryterium "fallback do ElevenLabs tylko gdy
 * brak wgranego audio dla danego języka" bez montowania całego providera.
 */
export function resolveAudioFetch(
  postId: string,
  lang: "pl" | "en",
  audioUrl: string | null | undefined,
): { url: string; init: RequestInit; usesElevenLabs: boolean } {
  const trimmed = audioUrl?.trim();
  if (trimmed) {
    return { url: trimmed, init: { method: "GET" }, usesElevenLabs: false };
  }
  return {
    url: "/api/public/post-tts",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, lang }),
    },
    usesElevenLabs: true,
  };
}

/**
 * Zapisuje blob URL do cache, zwalniając (revokeObjectURL) stary URL gdy dany
 * klucz jest nadpisywany oraz gdy najstarsze wpisy są eksmitowane po
 * przekroczeniu `MAX_CACHED_BLOBS`. `keepUrl` chroni aktualnie odtwarzany blob
 * przed zwolnieniem, gdyby akurat miał zostać eksmitowany.
 */
function setCachedBlob(key: string, url: string, keepUrl?: string | null): void {
  const previous = audioBlobCache.get(key);
  if (previous && previous !== url) {
    URL.revokeObjectURL(previous);
  }
  audioBlobCache.set(key, url);
  while (audioBlobCache.size > MAX_CACHED_BLOBS) {
    const oldestKey = audioBlobCache.keys().next().value;
    if (oldestKey === undefined || oldestKey === key) break;
    const oldestUrl = audioBlobCache.get(oldestKey);
    audioBlobCache.delete(oldestKey);
    if (oldestUrl && oldestUrl !== url && oldestUrl !== keepUrl) {
      URL.revokeObjectURL(oldestUrl);
    }
  }
}

// Trwałość pozycji odtwarzania (localStorage). Klucz per tożsamość audio
// (postId+lang), spójny z formatem `cacheKey`. Wszystkie dostępy chronione pod
// kątem SSR i trybu prywatnego.
const POSITION_KEY_PREFIX = "audio-pos:";
// Poniżej tego progu (s) nie zapisujemy/nie przywracamy - offset jest trywialny.
const POSITION_MIN_SECONDS = 5;
// Odstęp od końca (s), przy którym uznajemy materiał za "prawie skończony".
const POSITION_END_MARGIN = 5;
// Throttle zapisu pozycji (ms).
const POSITION_SAVE_INTERVAL = 5000;

function positionKey(postId: string, lang: "pl" | "en"): string {
  return `${POSITION_KEY_PREFIX}${postId}:${lang}`;
}

function readStoredPosition(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredPosition(key: string, seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.floor(seconds)));
  } catch {
    /* private mode / quota - ignorujemy */
  }
}

function clearStoredPosition(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/** Czy pozycja `t` w materiale o długości `dur` warta jest zapisania/przywrócenia. */
function isRestorablePosition(t: number, dur: number): boolean {
  if (t <= POSITION_MIN_SECONDS) return false;
  if (Number.isFinite(dur) && dur > 0 && t >= dur - POSITION_END_MARGIN) return false;
  return true;
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

  // Unikalny identyfikator tego playera na szynie arbitrażu odtwarzania.
  const playerId = useId();
  const playerIdRef = useRef(playerId);
  // Kontroler przerywający trwające pobieranie TTS przy szybkiej zmianie wpisu.
  const fetchAbortRef = useRef<AbortController | null>(null);
  // Klucz localStorage dla pozycji aktualnie załadowanego materiału.
  const posKeyRef = useRef<string | null>(null);
  // Pozycja do przywrócenia po załadowaniu metadanych (null gdy nic nie czeka).
  const pendingRestoreRef = useRef<number | null>(null);
  // Znacznik czasu ostatniego zapisu pozycji (throttle).
  const lastSaveRef = useRef(0);

  // Lazy audio element - tworzymy w efekcie, żeby nie ruszać `Audio` w SSR.
  useEffect(() => {
    if (audioRef.current || typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "none";

    const persistPosition = (t: number) => {
      const key = posKeyRef.current;
      if (!key || pendingRestoreRef.current !== null) return;
      if (isRestorablePosition(t, audio.duration)) writeStoredPosition(key, t);
    };

    audio.addEventListener("play", () => {
      setStatus("playing");
      // Ogłaszamy start - inne odtwarzacze (PodcastPlayer) się zatrzymają.
      announcePlayback(playerIdRef.current);
    });
    audio.addEventListener("pause", () => {
      if (!audio.ended) {
        setStatus("paused");
        persistPosition(audio.currentTime);
      }
    });
    audio.addEventListener("ended", () => {
      setStatus("paused");
      setCurrentTime(0);
      // Materiał wysłuchany do końca - kasujemy zapamiętaną pozycję.
      const key = posKeyRef.current;
      if (key) clearStoredPosition(key);
    });
    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration || 0);
      // Jednorazowe przywrócenie pozycji dla świeżo załadowanego materiału.
      const restore = pendingRestoreRef.current;
      if (restore !== null) {
        if (isRestorablePosition(restore, audio.duration)) {
          try {
            audio.currentTime = restore;
            setCurrentTime(restore);
          } catch {
            /* seek może się nie udać dla niektórych źródeł - ignorujemy */
          }
        }
        pendingRestoreRef.current = null;
      }
    });
    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
      // Throttlowany zapis pozycji (co ~POSITION_SAVE_INTERVAL ms).
      const now = Date.now();
      if (now - lastSaveRef.current >= POSITION_SAVE_INTERVAL) {
        lastSaveRef.current = now;
        persistPosition(audio.currentTime);
      }
    });
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

  // Arbitraż odtwarzania: gdy zagra inny player, pauzujemy globalny.
  useEffect(() => {
    const unsubscribe = subscribePlayback((activeId) => {
      if (activeId !== playerId) audioRef.current?.pause();
    });
    return unsubscribe;
  }, [playerId]);

  const fetchBlob = useCallback(
    async (postId: string, lang: "pl" | "en", audioUrl?: string | null): Promise<string> => {
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

      // Szybka zmiana wpisu ⇒ anulujemy poprzednie pobieranie, żeby nie ścigały
      // się równoległe fetch-e. Zachowujemy zwykły, same-origin POST (bez CORS).
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      const startedAt = performance.now();
      setTts({
        stage: "preparing",
        percent: 0,
        bytes: 0,
        totalBytes: null,
        elapsedMs: 0,
      });

      try {
        // Wybór źródła: wgrany MP3 (bezpośredni GET) albo TTS (ElevenLabs).
        // Helper `resolveAudioFetch` gwarantuje, że dla języka z wgranym plikiem
        // ElevenLabs nie jest wywoływany - kryterium weryfikowane przez testy.
        const src = resolveAudioFetch(postId, lang, audioUrl);
        const res = await fetch(src.url, { ...src.init, signal: controller.signal });

      if (!res.ok) {
        // Wyczerpany limit / rate-limit dostają jednoznaczne, dwujęzyczne
        // komunikaty (402 = przekroczony budżet TTS, 429 = zbyt częste próby).
        // Pozostałe błędy zachowują dotychczasowe zachowanie (treść serwera).
        if (res.status === 402) {
          throw new Error("Wyczerpano limit lektora / TTS quota exceeded");
        }
        if (res.status === 429) {
          throw new Error("Zbyt wiele prób, spróbuj za chwilę / Too many attempts");
        }
        const msg = await res.text().catch(() => "");
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
      // Cache + zwolnienie starego/eksmitowanego bloba (chronimy aktywny).
      setCachedBlob(key, url, audioRef.current?.src ?? null);
      setTts({
        stage: "ready",
        percent: 100,
        bytes: blob.size,
        totalBytes: totalBytes ?? blob.size,
        elapsedMs: performance.now() - startedAt,
      });
      return url;
    } catch (e) {
      // Przerwane przez nowsze żądanie - cicho, nowe pobieranie steruje UI.
      if (controller.signal.aborted) throw e;
      setTts({
        stage: "error",
        percent: 0,
        bytes: 0,
        totalBytes: null,
        elapsedMs: performance.now() - startedAt,
      });
      throw e;
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
    }
  }, []);

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
      // Zapisz pozycję wychodzącego materiału zanim podmienimy źródło (zmiana
      // `src` nie zawsze emituje zdarzenie `pause`).
      if (
        posKeyRef.current &&
        !audio.ended &&
        isRestorablePosition(audio.currentTime, audio.duration)
      ) {
        writeStoredPosition(posKeyRef.current, audio.currentTime);
      }
      const key = positionKey(meta.postId, meta.lang);
      setStatus("loading");
      setError(null);
      try {
        const blobUrl = await fetchBlob(meta.postId, meta.lang, meta.audioUrl ?? null);
        audio.src = blobUrl;
        // Zaplanuj jednorazowe przywrócenie pozycji po `loadedmetadata`.
        posKeyRef.current = key;
        pendingRestoreRef.current = readStoredPosition(key);
        lastSaveRef.current = 0;
        setTrack({ ...meta, blobUrl });
        setCurrentTime(0);
        setDuration(0);
        await audio.play();
      } catch (e) {
        // Przerwane przez nowszy loadAndPlay - nie pokazujemy błędu.
        if (e instanceof Error && e.name === "AbortError") return;
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
      // Zapisz pozycję zanim wyczyścimy źródło (zdarzenie `pause` bywa
      // asynchroniczne i currentTime zdąży się wyzerować).
      const key = posKeyRef.current;
      if (key && !audio.ended && isRestorablePosition(audio.currentTime, audio.duration)) {
        writeStoredPosition(key, audio.currentTime);
      }
      audio.pause();
      audio.src = "";
    }
    posKeyRef.current = null;
    pendingRestoreRef.current = null;
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
      const url =
        existingBlob ?? (await fetchBlob(target.postId, target.lang, target.audioUrl ?? null));
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

  // Media Session API - lockscreen / klawisze multimedialne + metadane na
  // mobile. Feature-detect + no-op na SSR / w nieobsługiwanych przeglądarkach.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!track) {
      ms.metadata = null;
      ms.playbackState = "none";
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.author ?? undefined,
      });
    } catch {
      /* MediaMetadata niedostępne - pomijamy metadane */
    }
    ms.playbackState = status === "playing" ? "playing" : "paused";
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* akcja nieobsługiwana w tej przeglądarce */
      }
    };
    setHandler("play", () => {
      void audioRef.current?.play();
    });
    setHandler("pause", () => {
      audioRef.current?.pause();
    });
    setHandler("seekbackward", () => {
      const a = audioRef.current;
      if (a) seek(a.currentTime - 15);
    });
    setHandler("seekforward", () => {
      const a = audioRef.current;
      if (a) seek(a.currentTime + 15);
    });
    setHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seek(details.seekTime);
    });
  }, [track, status, seek]);

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
