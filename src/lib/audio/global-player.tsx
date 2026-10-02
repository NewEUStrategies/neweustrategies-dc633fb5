// Globalny odtwarzacz audio TTS artykułów - POWŁOKA.
//
// Provider montuje się w `__root` na KAŻDEJ stronie, a do 2026-10-02 niósł
// w chunku wejściowym cały silnik (~13,7 kB źródeł: element `<audio>`,
// fetcher TTS ze strumieniowaniem postępu, cache blobów, pamięć pozycji,
// Media Session), choć anonimowy czytelnik strony głównej nigdy go nie woła.
// Tutaj zostaje wyłącznie to, co MUSI istnieć od pierwszego renderu: typy,
// kontekst, hook i bezczynna fasada. Silnik (`global-player-engine.tsx`)
// dociąga się `React.lazy` dopiero przy pierwszym użyciu (`loadAndPlay`,
// `download`), a do tego czasu fasada zgłasza stan „loading" dla czekającego
// nagrania - czyli przycisk „odsłuchaj" reaguje natychmiast, tak jak dotąd.
//
// PARYTET SSR: serwer i pierwszy render klienta widzą IDENTYCZNE poddrzewo
// (`Provider` + `null` + dzieci). Silnik wchodzi wyłącznie po interakcji,
// nigdy w hydratacji. Silnik NIE OWIJA dzieci - jest bezgłowym rodzeństwem,
// które publikuje swoją wartość do powłoki; gdyby stanął nad dziećmi, jego
// montaż przemontowałby całą stronę (zmiana typu węzła nad `<Outlet>`).
import {
  Component,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { DEFAULT_PLAYBACK_RATE, clampPlaybackRate } from "@/lib/audio/playbackRate";

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
  "idle" | "preparing" | "synthesizing" | "streaming" | "ready" | "cached" | "error";

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

export interface AudioTrackState extends AudioTrackMeta {
  blobUrl: string;
}

export interface GlobalPlayerContextValue {
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
  /** Przewinięcie względne (np. ±15 s) - clamp do [0, duration]. */
  skip: (deltaSeconds: number) => void;
  /** Tempo odtwarzania - wspólna preferencja wszystkich playerów (localStorage). */
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  close: () => void;
  download: (meta?: AudioTrackMeta) => Promise<void>;
}

export const INITIAL_TTS: TtsProgress = {
  stage: "idle",
  percent: 0,
  bytes: 0,
  totalBytes: null,
  elapsedMs: 0,
};

/**
 * Polecenie wydane fasadzie, ZANIM silnik się załadował. Silnik wykonuje je
 * w kolejności zaraz po utworzeniu elementu `<audio>` - czyli kliknięcie
 * „odsłuchaj" na zimnym starcie kończy się odtwarzaniem, a nie zgubionym
 * gestem. Zarówno `play`, jak i `download` wołają dziś płatną syntezę przez
 * ten sam fetcher silnika, więc oba muszą czekać na niego, nie na siebie.
 */
export type PendingAudioCommand =
  { kind: "play"; meta: AudioTrackMeta } | { kind: "download"; meta: AudioTrackMeta };

export const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

/** Bezczynna wartość - wspólna dla fasady, SSR i renderu poza providerem. */
const IDLE_VALUE: GlobalPlayerContextValue = {
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
  skip: () => {},
  playbackRate: DEFAULT_PLAYBACK_RATE,
  setPlaybackRate: () => {},
  close: () => {},
  download: async () => {},
};

// Silnik poza chunkiem wejściowym. Nazwany eksport -> `default`, jak reszta
// leniwych granic w `__root`.
const GlobalAudioEngine = lazy(() =>
  import("./global-player-engine").then((m) => ({ default: m.GlobalAudioEngine })),
);

interface EngineGateProps {
  children: ReactNode;
  onLoadError: (error: Error) => void;
}

/**
 * Granica wyłącznie dla NIEUDANEGO POBRANIA CHUNKU silnika (sieć padła między
 * bootem a kliknięciem). Bez niej wyjątek `React.lazy` szedłby do globalnej
 * granicy błędu w `__root` i podmieniał całą, poprawnie wyrenderowaną stronę
 * na ekran awarii - za niedostępny odtwarzacz. Tu kończy się stanem `error`
 * fasady, który pasek audio pokazuje jako toast.
 */
class EngineLoadGate extends Component<EngineGateProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onLoadError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function GlobalAudioPlayerProvider({ children }: { children: ReactNode }) {
  // Wartość opublikowana przez silnik - od pierwszej publikacji jest JEDYNYM
  // źródłem prawdy; fasada służy tylko do chwili jego załadowania.
  const [engineValue, setEngineValue] = useState<GlobalPlayerContextValue | null>(null);
  const [engineWanted, setEngineWanted] = useState(false);
  // Czytelnik czeka na silnik: fasada zgłasza `loading` + etap `preparing`,
  // czyli DOKŁADNIE pierwszy stan, który silnik sam przyjmuje w `loadAndPlay`
  // przed pobraniem nagrania (`isActive` jest tam `false` aż do `setTrack`).
  // Parytet z silnikiem jest ważniejszy niż „ładniejszy" stan przejściowy:
  // inna wartość tutaj dałaby mrugnięcie przycisku w chwili przejęcia.
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Tempo ustawione przed silnikiem - silnik czyta zapisaną preferencję sam,
  // tutaj tylko odbicie w UI (patrz `setPlaybackRate` fasady).
  const [facadeRate, setFacadeRate] = useState(DEFAULT_PLAYBACK_RATE);
  // Ref, nie stan: kolejkę czyta silnik w efekcie montażu, a jej zmiana nie ma
  // prawa przerenderować całej strony pod providerem.
  const commandsRef = useRef<PendingAudioCommand[]>([]);

  const requestEngine = useCallback((command: PendingAudioCommand) => {
    commandsRef.current.push(command);
    setPending(true);
    setLoadError(null);
    setEngineWanted(true);
  }, []);

  const onEngineLoadError = useCallback((error: Error) => {
    console.error("[global-player] nie udało się załadować silnika audio", error);
    setLoadError("Nie udało się załadować odtwarzacza / Audio player failed to load");
    setPending(false);
    commandsRef.current = [];
  }, []);

  const facade = useMemo<GlobalPlayerContextValue>(
    () => ({
      ...IDLE_VALUE,
      status: loadError ? "error" : pending ? "loading" : "idle",
      error: loadError,
      tts: pending ? { ...INITIAL_TTS, stage: "preparing" } : INITIAL_TTS,
      loadAndPlay: async (meta) => requestEngine({ kind: "play", meta }),
      // Bez `meta` nie ma czego pobrać - silnik nie został jeszcze załadowany,
      // więc nie ma też bieżącego nagrania.
      download: async (meta) => {
        if (meta) requestEngine({ kind: "download", meta });
      },
      playbackRate: facadeRate,
      // Preferencję tempa utrwala dopiero silnik (wspólny zapis w localStorage
      // dzieje się przy pierwszym nagraniu) - tu wystarczy odbicie w UI.
      setPlaybackRate: (rate) => setFacadeRate(clampPlaybackRate(rate)),
      close: () => {
        setPending(false);
        setLoadError(null);
      },
    }),
    [facadeRate, loadError, pending, requestEngine],
  );

  // Stałe DWA sloty dzieci (`null | silnik`, dzieci), żeby montaż silnika nie
  // przesunął indeksu `children` i nie przemontował poddrzewa strony.
  return (
    <GlobalPlayerContext.Provider value={engineValue ?? facade}>
      {engineWanted ? (
        <EngineLoadGate onLoadError={onEngineLoadError}>
          <Suspense fallback={null}>
            <GlobalAudioEngine onValue={setEngineValue} commandsRef={commandsRef} />
          </Suspense>
        </EngineLoadGate>
      ) : null}
      {children}
    </GlobalPlayerContext.Provider>
  );
}

export function useGlobalAudioPlayer(): GlobalPlayerContextValue {
  const ctx = useContext(GlobalPlayerContext);
  // Fallback no-op - używane w SSR / poza providerem, żeby nie wybuchać.
  return ctx ?? IDLE_VALUE;
}

export function formatAudioTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
