// Udostępnianie zaznaczonego cytatu (A3): zaznaczenie tekstu w treści wpisu
// wywołuje pływający pasek "Udostępnij na X / LinkedIn / Kopiuj cytat" nad
// zaznaczeniem - najkrótsza droga analiza -> post w social mediach (wzorzec
// Medium/NYT, nieobecny u konkurencji think-tankowej).
//
// Zasady:
//   - działa wyłącznie wewnątrz kontenera treści (containerRef) - zaznaczenia
//     w komentarzach/sidebarze nie wywołują paska,
//   - limit długości cytatu (600 znaków; do X przycinamy do limitu 280
//     z miejscem na URL, którego X liczy jako 23 znaki),
//   - pointerdown na pasku NIE czyści zaznaczenia (preventDefault) - klik
//     w akcję działa na żywym zaznaczeniu,
//   - czysto kliencki (document.getSelection) - SSR renderuje null.
import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "@/components/atoms/XIcon";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { Copy, Check, Quote, Linkedin } from "@/lib/lucide-shim";
import { SITE_NAME } from "@/lib/seo/meta";

const COPY_TEXTS = {
  pl: {
    shareX: "Udostępnij cytat na X",
    shareLinkedin: "Udostępnij na LinkedIn",
    copy: "Kopiuj cytat",
    copied: "Skopiowano cytat",
    region: "Udostępnij zaznaczony cytat",
  },
  en: {
    shareX: "Share quote on X",
    shareLinkedin: "Share on LinkedIn",
    copy: "Copy quote",
    copied: "Quote copied",
    region: "Share selected quote",
  },
} as const;

const MIN_QUOTE_LEN = 8;
const MAX_QUOTE_LEN = 600;
/** X liczy każdy URL jako 23 znaki; zostawiamy też cudzysłowy i separator. */
const X_TEXT_BUDGET = 280 - 23 - 6;

interface BarState {
  quote: string;
  top: number;
  left: number;
}

export function QuoteShareBar({
  containerRef,
  url,
  lang,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  url: string;
  lang: "pl" | "en";
}) {
  const t = COPY_TEXTS[lang];
  const [state, setState] = useState<BarState | null>(null);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  const readSelection = useCallback((): BarState | null => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const container = containerRef.current;
    if (!container) return null;
    const range = sel.getRangeAt(0);
    // Zaznaczenie musi zaczynać się i kończyć wewnątrz treści wpisu.
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return null;
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (quote.length < MIN_QUOTE_LEN || quote.length > MAX_QUOTE_LEN) return null;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      quote,
      // Pozycja fixed: nad zaznaczeniem, wyśrodkowana; clamp do viewportu.
      top: Math.max(8, rect.top - 44),
      left: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90),
    };
  }, [containerRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let raf = 0;
    const onSelectionChange = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => setState(readSelection()));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", onSelectionChange, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onSelectionChange);
      window.cancelAnimationFrame(raf);
    };
  }, [readSelection]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  if (!state) return null;

  const openShare = (href: string) => {
    window.open(href, "_blank", "noopener,noreferrer,width=640,height=520");
  };

  const onShareX = () => {
    const quote =
      state.quote.length > X_TEXT_BUDGET
        ? `${state.quote.slice(0, X_TEXT_BUDGET - 1).trimEnd()}…`
        : state.quote;
    const text = `„${quote}”`;
    openShare(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    );
  };

  const onShareLinkedin = () => {
    // LinkedIn share-offsite przyjmuje tylko URL; cytat kopiujemy do schowka,
    // żeby dało się go wkleić w okno posta.
    void navigator.clipboard.writeText(`„${state.quote}”`).catch(() => undefined);
    openShare(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`„${state.quote}” - ${SITE_NAME}, ${url}`);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* schowek zablokowany - zaznaczenie wciąż można skopiować ręcznie */
    }
  };

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t.region}
      // preventDefault na pointerdown: klik w pasek nie może zdjąć zaznaczenia
      // zanim odpali się akcja.
      onPointerDown={(e) => e.preventDefault()}
      className="no-print fixed z-[80] -translate-x-1/2 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 backdrop-blur px-1 py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
      style={{ top: state.top, left: state.left }}
    >
      <span className="px-1.5 text-muted-foreground" aria-hidden="true">
        <Quote className="h-3.5 w-3.5" />
      </span>
      <button
        type="button"
        onClick={onShareX}
        aria-label={t.shareX}
        title={t.shareX}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onShareLinkedin}
        aria-label={t.shareLinkedin}
        title={t.shareLinkedin}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition"
      >
        <BrandIcon name="linkedin" fallback={Linkedin} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={copied ? t.copied : t.copy}
        title={copied ? t.copied : t.copy}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
