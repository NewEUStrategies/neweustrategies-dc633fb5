// Lazy iframe dla quizu - defer bootowania ciężkiego iframe'a, żeby
// pierwszy render /quiz (header, tło, sidebar udostępniania) był
// gotowy natychmiast.
//
// Strategia:
//  1. SSR/pierwszy render → placeholder z tą samą wysokością co iframe
//     (brak layout shift), plus mały spinner + label ładowania.
//  2. Po hydracji: gdy kontener pojawi się w viewport (IntersectionObserver)
//     lub w idle callback → montujemy iframe z `loading="lazy"`.
//  3. Native `loading="lazy"` pozostawiamy jako dodatkową warstwę
//     obrony dla przypadków, gdy kontener wjeżdża w viewport później.
//
// Efekt: header i tło pozostają czytelne od razu, a mobile nie płaci
// za pobranie zewnętrznego bundla quizu przed pierwszym paintem.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  src: string;
  title: string;
  className?: string;
  /** Fallback dla przeglądarek bez IntersectionObserver: montuj po ilu ms. */
  fallbackDelayMs?: number;
};

export function LazyQuizIframe({ src, title, className, fallbackDelayMs = 250 }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = containerRef.current;
    if (!el) return;

    // Preferuj requestIdleCallback → montuj po pierwszym paincie,
    // gdy główny wątek jest wolny.
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;

    let cancelled = false;
    let timeoutId: number | undefined;
    let observer: IntersectionObserver | undefined;

    const mount = () => {
      if (cancelled) return;
      setMounted(true);
    };

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              mount();
              observer?.disconnect();
              break;
            }
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(el);
    }

    // Awaryjny mount po idle/fallback delay - nawet jeśli IO nie wystrzeli.
    if (typeof idle === "function") {
      idle(mount, { timeout: fallbackDelayMs + 500 });
    } else {
      timeoutId = window.setTimeout(mount, fallbackDelayMs);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [mounted, fallbackDelayMs]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {!loaded && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-white/80"
          aria-hidden={mounted ? "true" : undefined}
        >
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
            role="status"
            aria-label={t("common.loading")}
          />
          <span className="text-xs font-medium tracking-wide">{t("common.loading")}</span>
        </div>
      )}
      {mounted && (
        <iframe
          src={src}
          className={className}
          allow="clipboard-write"
          loading="lazy"
          title={title}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
