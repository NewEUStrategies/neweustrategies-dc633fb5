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
//
// Reguły (limity długości, budżet znaków dla X, adresy udostępnień, treść
// schowka) żyją w czystym module `lib/post/quoteSelection`. Powód jest twardy:
// bez PRAWDZIWEGO zaznaczenia w prawdziwym DOM-ie ten komponent nie renderuje
// niczego (`if (!state) return null`), więc dowód poprawności tekstu, który
// czytelnik wkleja w imieniu redakcji, wymagałby sterowania
// `window.getSelection()`. Trzy identyczne przyciski ikonowe scala atom
// `atoms/PostIconButton`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@/components/atoms/XIcon";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { Copy, Check, Quote, Linkedin } from "@/lib/lucide-shim";
import { SITE_NAME } from "@/lib/seo/meta";
import { PostIconButton } from "@/components/post/atoms/PostIconButton";
import {
  attributedQuote,
  clipboardQuote,
  linkedinShareUrl,
  quoteBarState,
  xShareUrl,
  type QuoteBarState,
} from "@/lib/post/quoteSelection";
import "@/lib/i18n-post-experience";

export function QuoteShareBar({
  containerRef,
  url,
  lang,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  url: string;
  lang: "pl" | "en";
}) {
  // Napisy idą w języku ARTYKUŁU, nie interfejsu - dotyczą TEJ treści.
  const { t: translate } = useTranslation();
  const t = (key: string) => translate(`postExperience.quoteShare.${key}`, { lng: lang });
  const [state, setState] = useState<QuoteBarState | null>(null);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  const readSelection = useCallback((): QuoteBarState | null => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const container = containerRef.current;
    if (!container) return null;
    const range = sel.getRangeAt(0);
    // Zaznaczenie musi zaczynać się i kończyć wewnątrz treści wpisu.
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return null;
    }
    // Limity długości i pozycję paska rozstrzyga reguła, nie komponent.
    return quoteBarState(sel.toString(), range.getBoundingClientRect(), window.innerWidth);
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
    openShare(xShareUrl(state.quote, url));
  };

  const onShareLinkedin = () => {
    // LinkedIn share-offsite przyjmuje tylko URL; cytat kopiujemy do schowka,
    // żeby dało się go wkleić w okno posta.
    void navigator.clipboard.writeText(clipboardQuote(state.quote)).catch(() => undefined);
    openShare(linkedinShareUrl(url));
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(attributedQuote(state.quote, SITE_NAME, url));
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
      aria-label={t("region")}
      // preventDefault na pointerdown: klik w pasek nie może zdjąć zaznaczenia
      // zanim odpali się akcja.
      onPointerDown={(e) => e.preventDefault()}
      className="no-print fixed z-[80] -translate-x-1/2 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 backdrop-blur px-1 py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
      style={{ top: state.top, left: state.left }}
    >
      <span className="px-1.5 text-muted-foreground" aria-hidden="true">
        <Quote className="h-3.5 w-3.5" />
      </span>
      <PostIconButton label={t("shareX")} onClick={onShareX}>
        <XIcon className="h-3.5 w-3.5" />
      </PostIconButton>
      <PostIconButton label={t("shareLinkedin")} onClick={onShareLinkedin}>
        <BrandIcon name="linkedin" fallback={Linkedin} className="h-3.5 w-3.5" />
      </PostIconButton>
      <PostIconButton label={copied ? t("copied") : t("copy")} onClick={() => void onCopy()}>
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
      </PostIconButton>
    </div>
  );
}
