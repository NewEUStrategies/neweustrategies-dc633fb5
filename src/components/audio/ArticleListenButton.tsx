// Molekuła: kompaktowy przycisk "Odsłuchaj artykuł" sterujący GLOBALNYM
// playerem (ten sam, którego używa karta w sidebarze i dolny pasek).
//
// PRZYCZYNA ZRODLOWA (audyt 2026-08-03, amplifikacja kosztu TTS): mobilny
// przycisk odsłuchu szedł wcześniej przez `TtsPlayer` -> `/api/tts`, czyli
// endpoint REDAKCYJNY (staff-only) z tekstem zeskrobanym z DOM oraz głosem i
// modelem wpisanymi na sztywno w kodzie klienta. Dla czytelnika kończyło się to
// błędem 403, a dla kosztu - kolejną, całkowicie NIEKESZOWANĄ ścieżką syntezy
// (klucz cache zależał od zeskrobanego tekstu). Teraz mobile korzysta z tej
// samej kanonicznej ścieżki co desktop: `/api/public/post-tts` z payloadem
// `{ postId, lang }`, jeden głos na wpis i jeden plik w cache.
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/lib/lucide-shim";
import { MorphPlayPause } from "@/components/audio/MorphPlayPause";
import { useGlobalAudioPlayer, type AudioTrackMeta } from "@/lib/audio/global-player";

const COPY = {
  pl: {
    listen: "Odsłuchaj artykuł",
    pause: "Pauza",
    resume: "Wznów",
    loading: "Generuję audio…",
    error: "Nie udało się wygenerować audio",
  },
  en: {
    listen: "Listen to article",
    pause: "Pause",
    resume: "Resume",
    loading: "Generating audio…",
    error: "Could not generate audio",
  },
} as const;

interface ArticleListenButtonProps {
  postId: string;
  lang: "pl" | "en";
  title: string;
  author?: string | null;
  /** Wgrany MP3 dla tego języka - wtedy ElevenLabs nie jest wołany wcale. */
  audioUrl?: string | null;
  className?: string;
}

export function ArticleListenButton({
  postId,
  lang,
  title,
  author,
  audioUrl,
  className,
}: ArticleListenButtonProps) {
  const t = COPY[lang];
  const player = useGlobalAudioPlayer();
  const isThis = player.isActive(postId, lang);
  const loading = isThis && player.status === "loading";
  const playing = isThis && player.status === "playing";
  const paused = isThis && player.status === "paused";

  // Jeden toast na PRZEJSCIE w stan błędu (wspólny `id` z pozostałymi
  // playerami deduplikuje komunikat, gdy na stronie jest ich kilka).
  const prevStatusRef = useRef(player.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = player.status;
    if (prev !== "error" && player.status === "error") {
      toast.error(player.error ?? t.error, { id: "tts-error" });
    }
  }, [player.status, player.error, t.error]);

  const meta: AudioTrackMeta = useMemo(
    () => ({
      postId,
      lang,
      title,
      author: author ?? null,
      audioUrl: audioUrl ?? null,
      postHref:
        typeof window !== "undefined" ? window.location.pathname + window.location.search : "/",
    }),
    [postId, lang, title, author, audioUrl],
  );

  const label = loading ? t.loading : playing ? t.pause : paused ? t.resume : t.listen;

  return (
    <button
      type="button"
      onClick={() => {
        if (loading) return;
        if (isThis) void player.toggle();
        else void player.loadAndPlay(meta);
      }}
      aria-label={label}
      aria-busy={loading || undefined}
      className={
        className ??
        "inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border bg-background px-3 text-[12px] font-semibold tracking-tight text-foreground transition-colors hover:bg-muted hover:text-brand active:scale-[0.98] disabled:opacity-60"
      }
    >
      {loading ? (
        <Loader2 className="h-[14px] w-[14px] animate-spin text-brand" aria-hidden />
      ) : (
        <MorphPlayPause playing={playing} className="h-[14px] w-[14px] text-brand" />
      )}
      <span>{label}</span>
    </button>
  );
}
