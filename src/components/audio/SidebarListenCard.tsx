// Widget odsłuchu w sidebarze - premium "Studio Hi-Fi" karta nad "Spis treści".
// Steruje globalnym playerem: pierwsze kliknięcie ładuje audio i uruchamia
// odtwarzanie, kolejne przełączają play/pause. Po zmianie strony bottom bar
// przejmuje kontrolę bez utraty ciągłości.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Headphones } from "@/lib/lucide-shim";
import { MorphPlayPause } from "@/components/audio/atoms/MorphPlayPause";
import { AnimatedDownloadIcon } from "@/components/audio/atoms/AnimatedDownloadIcon";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatAudioTime,
  useGlobalAudioPlayer,
  type AudioTrackMeta,
} from "@/lib/audio/global-player";
import { downloadKey, transportLabelKey, ttsStageKey, ttsStagePercent } from "@/lib/audio/ttsStage";
import { AUDIO_FOCUS_RING } from "@/components/audio/atoms/AudioIconButton";
import "@/lib/i18n-tts-player";

interface SidebarListenCardProps {
  postId: string;
  lang: "pl" | "en";
  title: string;
  author?: string | null;
  authorHref?: string | null;
  postHref?: string;
  /** Szacowany czas czytania w min - do estymacji długości audio. */
  readMinutes?: number | null;
  /**
   * Wgrany MP3 dla tego języka. Gdy podany, sidebar player pomija ElevenLabs
   * TTS i odtwarza bezpośrednio ten plik. Brak = fallback do syntezowanego
   * lektora AI.
   */
  audioUrl?: string | null;
  /**
   * Wariant wizualny. `compact` (domyślny) to karta sidebaru z małym
   * przyciskiem play. `full-width` to mobilny przycisk tekstowy na całą
   * szerokość z ikoną słuchawek, używany pod sekcją share/recommend.
   */
  variant?: "compact" | "full-width";
}

// Pierścień fokusu przychodzi z atomu. Tu i w `GlobalAudioBar` stała była
// ZADEKLAROWANA OSOBNO - dwie kopie jedynej rzeczy, która odpowiada za
// widoczność fokusu klawiatury w całym odtwarzaczu.
const FOCUS_RING = AUDIO_FOCUS_RING;

/** Deterministyczny kształt fali (procent wysokości) - stabilny w SSR i obu motywach. */
const WAVE_BARS: readonly number[] = Array.from({ length: 48 }, (_, i) =>
  Math.round(28 + 52 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21))),
);

export function SidebarListenCard({
  postId,
  lang,
  title,
  author,
  authorHref,
  postHref,
  readMinutes,
  audioUrl,
  variant = "compact",
}: SidebarListenCardProps) {
  // Komunikaty idą w języku ARTYKUŁU, nie interfejsu (audio jest w języku treści).
  const { t } = useTranslation();
  const copy = (key: string, params?: Record<string, unknown>) =>
    t(`ttsPlayer.card.${key}`, { lng: lang, ...params });
  // Napisy WSPÓLNE z dolnym paskiem - jedna sekcja słownika, jedno źródło prawdy.
  const shared = (key: string) => t(`ttsPlayer.transport.${key}`, { lng: lang });
  const player = useGlobalAudioPlayer();
  const isThis = player.isActive(postId, lang);
  const loading = isThis && player.status === "loading";
  const playing = isThis && player.status === "playing";
  const errored = isThis && player.status === "error";
  const tts = player.tts;
  // Reguła etapu i próg wiarygodności procentu żyją w `lib/audio/ttsStage`
  // i zwracają KLUCZ, nie napis - ten sam `switch` stał wcześniej w DWÓCH
  // kopiach (tu i w drugim odtwarzaczu) nad dwoma osobnymi słownikami `COPY`,
  // więc dodanie etapu rozjeżdżało oba paski.
  const stageLabel = t(`ttsPlayer.stage.${ttsStageKey(tts.stage)}`, { lng: lang });
  const stagePct = ttsStagePercent(tts);

  const [scrub, setScrub] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Powiadomienie o nieudanej syntezie. Odpalamy dokładnie raz na przejście
  // statusu w "error" (poprzedni status trzymany w ref, żeby nie strzelać przy
  // każdym renderze). Współdzielony `id` deduplikuje toast z GlobalAudioBar,
  // który reaguje na to samo przejście globalnego statusu.
  const prevStatusRef = useRef(player.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = player.status;
    if (prev !== "error" && player.status === "error") {
      toast.error(player.error ?? shared("error"), { id: "tts-error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.status, player.error, lang]);

  const meta: AudioTrackMeta = useMemo(
    () => ({
      postId,
      lang,
      title,
      author: author ?? null,
      authorHref: authorHref ?? null,
      audioUrl: audioUrl ?? null,
      postHref:
        postHref ??
        (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"),
    }),
    [postId, lang, title, author, authorHref, postHref, audioUrl],
  );

  const approxMin =
    readMinutes && readMinutes > 0 ? Math.max(1, Math.round(readMinutes * 1.15)) : null;

  // Gdy wpis ma wgrany MP3, czytamy jego czas trwania z metadanych - bez
  // uruchamiania pobierania całego pliku - dzięki temu w sidebarze widać realny
  // czas nagrania jeszcze przed pierwszym kliknięciem Play.
  const [prefetchedDuration, setPrefetchedDuration] = useState<number | null>(null);
  useEffect(() => {
    setPrefetchedDuration(null);
    if (!audioUrl || typeof window === "undefined") return;
    const el = document.createElement("audio");
    let released = false;
    // Element służy WYŁĄCZNIE do odczytu metadanych, więc zwalniamy go po
    // odczycie, po limicie czasu i przy odmontowaniu. Samo zdjęcie `src` NIE
    // przerywa trwającego pobrania - dopiero `load()` na elemencie bez źródła
    // (ten sam wzorzec co w global-player). Wcześniej limit czasu tylko
    // ignorował wynik, a zapytanie o plik szło dalej.
    const release = () => {
      if (released) return;
      released = true;
      window.clearTimeout(timer);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeAttribute("src");
      el.load();
    };
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setPrefetchedDuration(el.duration);
      release();
    };
    el.preload = "metadata";
    el.addEventListener("loadedmetadata", onMeta);
    el.src = audioUrl;
    const timer = window.setTimeout(release, 8000);
    return release;
  }, [audioUrl]);

  const duration = isThis ? player.duration : 0;
  const currentTime = isThis ? player.currentTime : 0;
  const displayTime = scrub ?? currentTime;
  const displayPct = duration > 0 ? (displayTime / duration) * 100 : 0;
  const showProgress = isThis && duration > 0;

  const onPrimary = () => {
    if (loading) return;
    if (isThis) void player.toggle();
    else void player.loadAndPlay(meta);
  };

  const commitSeek = (v: number) => {
    player.seek(v);
    setScrub(null);
  };

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await player.download(meta);
    } catch {
      toast.error(shared("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const currentLabel = formatAudioTime(displayTime);
  const totalLabel =
    duration > 0
      ? formatAudioTime(duration)
      : prefetchedDuration && prefetchedDuration > 0
        ? formatAudioTime(prefetchedDuration)
        : approxMin
          ? copy("approx", { min: approxMin })
          : "--:--";

  return (
    <aside
      aria-label={copy("label")}
      className="group/card relative overflow-hidden rounded-[6px] border border-border/70 bg-background p-4 shadow-sm transition-shadow duration-300 hover:shadow-md"
    >
      {/* Cienka linia akcentu u góry - sygnatura marki, rośnie podczas odtwarzania. */}
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left bg-brand transition-transform duration-500 ease-out",
          playing ? "scale-x-100" : "scale-x-[0.18]",
        ].join(" ")}
      />
      {/* Section label */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="cms-widget-note font-semibold tracking-[0.2em] uppercase text-muted-foreground whitespace-nowrap">
          {copy("label")}
        </h3>
        <div className="h-px flex-1 bg-border/60" />
        {/* Headphones informują o możliwości odsłuchu / narracji AI - ukrywamy
            gdy jest wgrany MP3 (wtedy odtwarzamy oryginał, ElevenLabs nie jest używany). */}
        {!audioUrl && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={copy("aiNarration")}
                  className={[
                    "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full",
                    "text-muted-foreground/70 hover:text-brand transition-colors",
                    FOCUS_RING,
                  ].join(" ")}
                >
                  <Headphones className="h-3 w-3" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="rounded-[6px]">
                {copy("aiNarration")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Main row: play + time/progress */}
      <div className={variant === "full-width" ? "flex flex-col gap-3" : "flex items-center gap-3"}>
        {variant === "full-width" ? (
          <button
            type="button"
            onClick={onPrimary}
            disabled={loading}
            aria-label={shared(transportLabelKey({ loading, playing, paused: !playing && isThis }))}
            aria-pressed={playing}
            data-playing={playing ? "true" : "false"}
            className={[
              "listen-play-toggle inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px]",
              "bg-brand text-background transition-all",
              "hover:brightness-110 active:scale-[0.98] disabled:opacity-70",
              "cms-widget-label font-semibold tracking-tight",
              FOCUS_RING,
            ].join(" ")}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <span className="relative size-4 shrink-0" aria-hidden>
                <MorphPlayPause playing={playing} />
              </span>
            )}
            <span>
              {loading
                ? shared("loading")
                : playing
                  ? shared("pause")
                  : isThis
                    ? shared("play")
                    : copy("listen")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPrimary}
            disabled={loading}
            aria-label={shared(transportLabelKey({ loading, playing, paused: !playing && isThis }))}
            aria-pressed={playing}
            data-playing={playing ? "true" : "false"}
            className={[
              "listen-play-toggle shrink-0 h-11 w-11 rounded-[14px]",
              // Wariant "soft rounding": kwadrat z miękkim zaokrągleniem,
              // delikatne wypełnienie w tonie marki, ikona w kolorze marki;
              // tint pogłębia się na najechaniu.
              "border transition-all duration-300",
              "shadow-sm hover:shadow-md active:scale-95 disabled:opacity-70",
              playing
                ? "bg-brand text-background ring-4 ring-brand/15 border-brand"
                : "border-brand/20 bg-brand/[0.10] text-brand hover:bg-brand/[0.18] hover:border-brand/35",
              FOCUS_RING,
            ].join(" ")}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MorphPlayPause playing={playing} />
            )}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="cms-widget-label font-semibold tabular-nums tracking-tight text-foreground">
              {showProgress ? currentLabel : loading ? "…" : "00:00"}
            </span>
            <span className="cms-widget-note tabular-nums text-muted-foreground">
              / {totalLabel}
            </span>
          </div>

          {/* Slider */}
          <div className="relative h-4 flex items-center">
            {/* Subtelne fale audio: warstwa bazowa + warstwa postępu przycięta do % */}
            <div
              aria-hidden
              className="absolute inset-0 flex items-center justify-between gap-px text-foreground/25"
            >
              {WAVE_BARS.map((h, i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-current"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div
              aria-hidden
              className="absolute inset-0 flex items-center justify-between gap-px text-brand transition-[clip-path] duration-150"
              style={{ clipPath: `inset(0 ${100 - displayPct}% 0 0)` }}
            >
              {WAVE_BARS.map((h, i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-current"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>

            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={displayTime}
              disabled={!showProgress}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
              onBlur={(e) => {
                if (scrub !== null) commitSeek(Number(e.target.value));
              }}
              aria-label={shared("seek")}
              aria-valuemin={0}
              aria-valuemax={Math.max(duration, 0)}
              aria-valuenow={Math.floor(displayTime)}
              aria-valuetext={`${currentLabel} / ${formatAudioTime(duration)}`}
              className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed rounded-[6px] ${FOCUS_RING}`}
            />
          </div>
        </div>
      </div>

      {/* Footer: download + status/retry */}
      <div className="mt-3 pt-3 flex items-center justify-between border-t border-border/50">
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading || loading}
          aria-label={shared(downloadKey(downloading))}
          title={shared("download")}
          className={[
            "inline-flex items-center gap-1.5 rounded-[6px] text-muted-foreground",
            "hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            FOCUS_RING,
          ].join(" ")}
        >
          <AnimatedDownloadIcon downloading={downloading} className="h-3.5 w-3.5" />
          <span className="cms-widget-note font-semibold tracking-[0.15em] uppercase">
            {shared("download")}
          </span>
        </button>

        {errored ? (
          <button
            type="button"
            onClick={() => void player.loadAndPlay(meta)}
            className={`cms-widget-kicker font-semibold text-brand underline hover:no-underline rounded-[6px] ${FOCUS_RING}`}
          >
            {copy("retry")}
          </button>
        ) : loading ? (
          <div className="flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
              <span className="relative rounded-full bg-brand h-1.5 w-1.5" />
            </span>
            <span className="cms-widget-note font-medium text-muted-foreground tabular-nums">
              {stageLabel}
              {stagePct !== null ? ` · ${stagePct}%` : null}
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
