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
      className="no-print mb-6 grid grid-cols-2 gap-2 border-b border-border/60 pb-4 sm:hidden"
      data-mobile-article-actions
    >
      <Suspense
        fallback={
          <span className="inline-flex h-8 items-center justify-center rounded-[5px] border border-border bg-background text-[12px] font-semibold tracking-tight opacity-60">
            {t.listen}
          </span>
        }
      >
        <span className="[&>div]:w-full [&_button]:w-full [&_button]:justify-center [&_button]:h-8 [&_button]:gap-1.5 [&_button]:rounded-[5px] [&_button]:border-border [&_button]:bg-background [&_button]:px-3 [&_button]:py-0 [&_button]:text-[12px] [&_button]:font-semibold [&_button]:tracking-tight [&_button_svg]:h-[14px] [&_button_svg]:w-[14px]">
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
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border bg-background px-3 text-[12px] font-semibold tracking-tight text-foreground transition-colors hover:bg-muted hover:text-brand active:scale-[0.98]"
      >
        <Download className="h-[14px] w-[14px] text-brand" aria-hidden />
        <span>{t.download}</span>
      </button>

    </div>
  );
}
