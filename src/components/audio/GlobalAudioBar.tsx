// Trwały bottom bar globalnego odtwarzacza audio. Renderowany raz w __root,
// widoczny tylko gdy w playerze siedzi jakiś track. Płynnie pojawia się gdy
// user uruchomi odsłuch, przetrwa zmiany stron.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Download, X, Share2 } from "@/lib/lucide-shim";
import { MorphPlayPause } from "@/components/audio/atoms/MorphPlayPause";
import { Rewind, FastForward } from "lucide-react";
import { formatAudioTime, useGlobalAudioPlayer } from "@/lib/audio/global-player";
import { formatPlaybackRate, nextPlaybackRate } from "@/lib/audio/playbackRate";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

import { promptDialog } from "@/lib/appDialogs";
import { downloadKey, transportLabelKey, ttsStageKey, ttsStagePercent } from "@/lib/audio/ttsStage";
import { AUDIO_FOCUS_RING, AudioIconButton } from "@/components/audio/atoms/AudioIconButton";
import { uiLang } from "@/lib/i18n/format";
import "@/lib/i18n-tts-player";
function ActionTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="rounded-[6px] text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const HeadphonesIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
    <path d="M21 14a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3v4Z" />
    <path d="M3 14a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3v4Z" />
  </svg>
);

// Pierścień fokusu przychodzi z atomu - był tu ZADEKLAROWANY DRUGI RAZ,
// obok identycznej kopii w `SidebarListenCard`.
const FOCUS_RING = AUDIO_FOCUS_RING;

export function GlobalAudioBar() {
  // Komunikaty paska idą w języku ODTWARZANEGO materiału, nie interfejsu.
  const { t, i18n } = useTranslation();
  const player = useGlobalAudioPlayer();
  const [mounted, setMounted] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Powiadomienie o nieudanej syntezie. Musi żyć nad wczesnym returnem (reguły
  // hooków) i działać nawet gdy `track` jest null - błąd na pierwszym podejściu
  // (np. 402/429) nie ustawia tracka, więc bar się nie renderuje i toast jest
  // jedynym sygnałem. Odpalamy raz na przejście statusu w "error" (poprzedni
  // status w ref). Współdzielony `id` deduplikuje toast z SidebarListenCard.
  // "idle" (nie player.status): bar jest montowany leniwie z __root dopiero
  // gdy jest track LUB status "error" - gdyby ref startował od bieżącego
  // statusu, mount prosto w "error" nie pokazałby toastu o nieudanym TTS.
  const prevStatusRef = useRef<typeof player.status>("idle");
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = player.status;
    if (prev !== "error" && player.status === "error") {
      // Efekt stoi PRZED strażnikiem `player.track`, więc język bierzemy
      // z bieżącej ścieżki, a gdy jej nie ma - z interfejsu. Poprzednia wersja
      // sklejała OBA języki w jeden komunikat („… / Could not generate audio"),
      // czyli każdy czytelnik dostawał połowę zdania w obcym języku.
      const lang = player.track?.lang ?? uiLang(i18n.language);
      toast.error(player.error ?? t("ttsPlayer.bar.error", { lng: lang }), {
        id: "tts-error",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.status, player.error, player.track?.lang]);

  if (!mounted || !player.track) return null;

  const { track } = player;
  const copy = (key: string) => t(`ttsPlayer.bar.${key}`, { lng: track.lang });
  const loading = player.status === "loading";
  const playing = player.status === "playing";
  const tts = player.tts;
  // Reguła etapu i próg wiarygodności procentu żyją w `lib/audio/ttsStage`
  // i zwracają KLUCZ, nie napis - ten sam `switch` stał wcześniej w DWÓCH
  // kopiach (tu i w drugim odtwarzaczu) nad dwoma osobnymi słownikami `COPY`,
  // więc dodanie etapu rozjeżdżało oba paski.
  const stageLabel = t(`ttsPlayer.stage.${ttsStageKey(tts.stage)}`, { lng: track.lang });
  const stagePct = ttsStagePercent(tts);
  const duration = player.duration || 0;
  const displayTime = scrub ?? player.currentTime;
  const displayPct = duration > 0 ? (displayTime / duration) * 100 : 0;

  const commitSeek = (v: number) => {
    player.seek(v);
    setScrub(null);
  };

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await player.download();
    } catch {
      toast.error(copy("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const onShare = async () => {
    // Zawsze udostępniamy link do materiału (artykułu), nie plik audio.
    const url = new URL(track.postHref, window.location.origin).toString();
    const shareData = { title: track.title, url } as ShareData;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      // Użytkownik anulował — nie fallbackujemy.
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(copy("copied"));
    } catch {
      // Ostateczny fallback: dialog z adresem do skopiowania.
      void promptDialog({ title: copy("share"), defaultValue: url, confirmLabel: "OK" });
    }
  };

  return (
    <div
      role="region"
      aria-label={copy("region")}
      className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-3 pb-3 sm:px-5 sm:pb-4">
        <div
          className={[
            "relative overflow-hidden rounded-2xl border border-border/70",
            "bg-background/85 backdrop-blur-xl",
            "shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)]",
            "animate-in slide-in-from-bottom-8 fade-in duration-500",
          ].join(" ")}
        >
          {/* Progress line na górze */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-muted/50" aria-hidden>
            <div
              className="h-full bg-brand transition-[width] duration-150"
              style={{ width: `${displayPct}%` }}
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-4 px-3 py-2.5 sm:px-4 sm:py-3">
            {/* Cofnij 15 s / play-pause / do przodu 15 s - klaster transportu
                jak w aplikacjach podcastowych. Skoki aktywne dopiero gdy audio
                ma oś czasu (nie w trakcie syntezy TTS). */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <AudioIconButton
                label={copy("back15")}
                onClick={() => player.skip(-15)}
                disabled={loading || duration <= 0}
                icon={Rewind}
                variant="outline"
              />
              <AudioIconButton
                label={copy(transportLabelKey({ loading, playing, paused: false }))}
                onClick={() => void player.toggle()}
                disabled={loading}
                pressed={playing}
                variant="primary"
                busy={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <MorphPlayPause playing={playing} />
                )}
              </AudioIconButton>
              <AudioIconButton
                label={copy("fwd15")}
                onClick={() => player.skip(15)}
                disabled={loading || duration <= 0}
                icon={FastForward}
                variant="outline"
              />
            </div>

            {/* Info + progress */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <HeadphonesIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                <a
                  href={track.postHref}
                  className={[
                    "cms-widget-title font-semibold text-foreground truncate",
                    "hover:text-brand transition-colors rounded-sm",
                    FOCUS_RING,
                  ].join(" ")}
                  title={track.title}
                >
                  {track.title}
                </a>
                {track.author && (
                  <span className="cms-widget-label hidden md:inline text-muted-foreground truncate">
                    ·{" "}
                    {track.authorHref ? (
                      <a
                        href={track.authorHref}
                        className={`hover:text-foreground transition-colors rounded-sm ${FOCUS_RING}`}
                      >
                        {track.author}
                      </a>
                    ) : (
                      track.author
                    )}
                  </span>
                )}
              </div>

              {loading ? (
                /* Postęp syntezy TTS zamiast osi czasu (mirror SidebarListenCard). */
                <div
                  className="mt-1.5 flex items-center gap-2"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                    <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
                    <span className="relative rounded-full bg-brand h-1.5 w-1.5" />
                  </span>
                  <span className="cms-widget-kicker min-w-0 truncate font-medium text-muted-foreground tabular-nums">
                    {stageLabel}
                    {stagePct !== null ? ` · ${stagePct}%` : null}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="cms-widget-kicker tabular-nums text-muted-foreground shrink-0 w-9 text-right"
                    aria-hidden
                  >
                    {formatAudioTime(displayTime)}
                  </span>

                  {/* Slider (natywny range dla pełnej a11y + klawiatury) */}
                  <div
                    className={[
                      "relative h-4 flex-1 flex items-center group",
                      "rounded-full",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                    ].join(" ")}
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted" />
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-brand"
                      style={{ width: `${displayPct}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-brand shadow ring-2 ring-background opacity-0 group-hover:opacity-100 transition"
                      style={{ left: `calc(${displayPct}% - 6px)` }}
                      aria-hidden
                    />
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={displayTime}
                      disabled={duration <= 0}
                      onChange={(e) => setScrub(Number(e.target.value))}
                      onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                      onKeyUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
                      onBlur={(e) => {
                        if (scrub !== null) commitSeek(Number(e.target.value));
                      }}
                      aria-label={copy("seek")}
                      aria-valuemin={0}
                      aria-valuemax={Math.max(duration, 0)}
                      aria-valuenow={Math.floor(displayTime)}
                      aria-valuetext={`${formatAudioTime(displayTime)} / ${formatAudioTime(duration)}`}
                      className="absolute inset-0 w-full h-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    />
                  </div>

                  <span
                    className="cms-widget-kicker tabular-nums text-muted-foreground shrink-0 w-9"
                    aria-hidden
                  >
                    {formatAudioTime(duration)}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <TooltipProvider delayDuration={200}>
                <ActionTip label={copy("speed")}>
                  <button
                    type="button"
                    onClick={() => player.setPlaybackRate(nextPlaybackRate(player.playbackRate))}
                    aria-label={`${copy("speed")}: ${formatPlaybackRate(player.playbackRate)}`}
                    className={[
                      "inline-flex h-9 min-w-9 items-center justify-center rounded-[6px] px-1.5",
                      "cms-widget-label font-semibold tabular-nums",
                      "text-muted-foreground hover:text-brand hover:bg-muted transition",
                      FOCUS_RING,
                    ].join(" ")}
                  >
                    {formatPlaybackRate(player.playbackRate)}
                  </button>
                </ActionTip>
                <ActionTip label={copy(downloadKey(downloading))}>
                  <AudioIconButton
                    label={copy(downloadKey(downloading))}
                    onClick={() => void onDownload()}
                    disabled={downloading || loading}
                    busy={downloading}
                    className="hidden xs:inline-flex disabled:cursor-not-allowed"
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Download className="h-4 w-4" aria-hidden />
                    )}
                  </AudioIconButton>
                </ActionTip>
                <ActionTip label={copy("share")}>
                  <AudioIconButton
                    label={copy("share")}
                    onClick={() => void onShare()}
                    icon={Share2}
                  />
                </ActionTip>
                <ActionTip label={copy("close")}>
                  <AudioIconButton
                    label={copy("close")}
                    onClick={() => player.close()}
                    icon={X}
                    variant="danger"
                  />
                </ActionTip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
