// Mobile-only pasek akcji pod paskiem Quick View (czas czytania + aktualizacja):
// odsłuchanie artykułu (TTS) i pobranie go (dialog druku -> "Zapisz jako PDF").
// Na desktopie te same akcje są dostępne w pływającym pasku udostępniania,
// więc komponent jest renderowany wyłącznie poniżej breakpointu `sm`.
//
// Odsłuch steruje GLOBALNYM playerem (`/api/public/post-tts`), a nie własnym
// elementem audio: mobile i desktop dzielą jedno źródło audio, jeden cache
// blobów w sesji i jeden KANONICZNY głos wpisu. Wcześniej ten przycisk wołał
// redakcyjny `/api/tts` z tekstem zeskrobanym z DOM i głosem wpisanym w kod
// klienta - dla czytelnika kończyło się to 403, a dla kosztu było kolejną
// niekeszowaną ścieżką syntezy (audyt 2026-08-03).
//
// Import przycisku jest STATYCZNY, choć poprzednik (`TtsPlayer`) był lazy:
// zmierzone na tym drzewie, wariant lazy dokładał do bundla publicznego więcej
// (osobny chunk 0,9 KB + stub dynamicznego importu w entry 1,4 KB) niż sam
// komponent w entry (0,65 KB). Cały jego graf zależności (globalny player,
// MorphPlayPause, sonner) i tak jest już w entry, bo provider montuje się w
// `__root`, więc nie ma tu czego odłożyć na później.
//
// Oba przyciski rzędu składa JEDEN atom (`post/atoms/ArticleActionButton`).
// Wcześniej ten plik trzymał lokalną stałą `ACTION_CLASS` - dokładną kopię
// łańcucha klas z `ArticleListenButton`, która zgubiła `disabled:opacity-60`,
// więc przycisk pobierania nie miał stanu wyłączonego.
import { Download } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import { ArticleListenButton } from "@/components/audio/ArticleListenButton";
import { ArticleActionButton } from "@/components/post/atoms/ArticleActionButton";
import "@/lib/i18n-post-experience";

interface Props {
  lang: "pl" | "en";
  /** Wpis, którego dotyczą akcje. Bez id nie ma czego odsłuchać. */
  postId: string;
  title: string;
  author?: string | null;
  /** Wgrany MP3 dla tego języka (pomija ElevenLabs). */
  audioUrl?: string | null;
}

export function MobileArticleActions({ lang, postId, title, author, audioUrl }: Props) {
  // Napisy idą w języku ARTYKUŁU, nie interfejsu - dotyczą TEJ treści.
  const { t: translate } = useTranslation();
  const t = (key: string) => translate(`postExperience.actions.${key}`, { lng: lang });

  return (
    <div
      className="no-print mb-6 grid grid-cols-2 gap-2 border-b border-border/60 pb-4 sm:hidden"
      data-mobile-article-actions
    >
      <ArticleListenButton
        postId={postId}
        lang={lang}
        title={title}
        author={author ?? null}
        audioUrl={audioUrl ?? null}
      />
      <ArticleActionButton icon={Download} label={t("download")} onClick={() => window.print()} />
    </div>
  );
}
