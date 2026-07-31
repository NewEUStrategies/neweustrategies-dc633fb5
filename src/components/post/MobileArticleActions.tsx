// Mobile-only pasek akcji pod paskiem Quick View (czas czytania + aktualizacja):
// odsłuchanie artykułu (TTS) i pobranie go (dialog druku -> "Zapisz jako PDF").
// Na desktopie te same akcje są dostępne w pływającym pasku udostępniania,
// więc komponent jest renderowany wyłącznie poniżej breakpointu `sm`.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Download } from "@/lib/lucide-shim";

const TtsPlayer = lazy(() =>
  import("@/components/TtsPlayer").then((m) => ({ default: m.TtsPlayer })),
);

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL = "eleven_multilingual_v2";

const COPY = {
  pl: { listen: "Odsłuchaj artykuł", download: "Pobierz artykuł" },
  en: { listen: "Listen to article", download: "Download article" },
} as const;

interface Props {
  lang: "pl" | "en";
}

/** Zbiera tekst artykułu z DOM (ten sam kontrakt co widget TTS w builderze). */
function grabArticleText(host: HTMLElement | null): string {
  const root =
    host?.closest("[data-page-template='post']")?.querySelector("[data-cms-content]") ??
    document.querySelector("[data-cms-content]") ??
    document.querySelector("article") ??
    document.querySelector("main");
  if (!root) return "";
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,nav,header,footer,button,iframe").forEach((n) => n.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

export function MobileArticleActions({ lang }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const t = COPY[lang];

  useEffect(() => {
    const read = () => setText(grabArticleText(hostRef.current));
    read();
    const id = window.setTimeout(read, 400);
    return () => window.clearTimeout(id);
  }, [lang]);

  const onDownload = useCallback(() => {
    window.print();
  }, []);

  return (
    <div
      ref={hostRef}
      className="no-print mb-6 grid grid-cols-2 gap-2 sm:hidden"
      data-mobile-article-actions
    >
      <Suspense
        fallback={
          <span className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-card text-sm font-medium opacity-60">
            {t.listen}
          </span>
        }
      >
        <span className="[&_button]:w-full [&_button]:justify-center [&>div]:w-full">
          <TtsPlayer
            text={text}
            voiceId={DEFAULT_VOICE_ID}
            model={DEFAULT_MODEL}
            label={t.listen}
          />
        </span>
      </Suspense>
      <button
        type="button"
        onClick={onDownload}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border bg-card text-sm font-medium transition hover:bg-muted"
      >
        <Download className="h-4 w-4" aria-hidden />
        <span>{t.download}</span>
      </button>
    </div>
  );
}
