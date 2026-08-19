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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "@/lib/lucide-shim";
import { MorphPlayPause } from "@/components/audio/atoms/MorphPlayPause";
import { ArticleActionButton } from "@/components/post/atoms/ArticleActionButton";
import { playPauseKey } from "@/lib/audio/ttsStage";
import { useGlobalAudioPlayer, type AudioTrackMeta } from "@/lib/audio/global-player";
import "@/lib/i18n-tts-player";

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
  // Komunikaty idą w języku ARTYKUŁU, nie interfejsu: audio jest w języku
  // treści, więc etykieta przycisku musi się z nim zgadzać.
  const { t } = useTranslation();
  const copy = (key: string) => t(`ttsPlayer.listen.${key}`, { lng: lang });
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
      toast.error(player.error ?? copy("error"), { id: "tts-error" });
    }
    // `copy` zmienia się przy każdym renderze (domknięcie po `t`), więc
    // zależnością jest język, nie funkcja - inaczej efekt biłby w pętli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.status, player.error, lang]);

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

  // Etykieta wybierana REGUŁĄ zwracającą klucz, nie łańcuchem ternary w JSX -
  // ta sama reguła obsługuje kartę w sidebarze i dolny pasek.
  const label = copy(playPauseKey({ loading, playing, paused }));

  return (
    <ArticleActionButton
      icon={Loader2}
      label={label}
      busy={loading}
      onClick={() => {
        if (loading) return;
        if (isThis) void player.toggle();
        else void player.loadAndPlay(meta);
      }}
      leading={
        loading ? (
          <Loader2 className="h-[14px] w-[14px] animate-spin text-brand" aria-hidden />
        ) : (
          <MorphPlayPause playing={playing} className="h-[14px] w-[14px] text-brand" />
        )
      }
      className={className}
    />
  );
}
