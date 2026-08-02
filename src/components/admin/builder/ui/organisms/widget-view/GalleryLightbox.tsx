// Lightbox galerii (organizm widoku widgetu).
//
// DLACZEGO OSOBNY PLIK: pole `lightbox` istniało w schemacie galerii, ale
// ŻADEN renderer go nie czytał - przełącznik w panelu nie robił nic. Zamiast
// usuwać ustawienie, dowozimy funkcję. Renderer galerii (SimpleWidgets) to
// jeden `case` w wielkim `switch`, więc nie może trzymać własnego stanu
// (hooki nie mogą żyć w gałęzi switcha). Dlatego lightbox jest samodzielnym
// komponentem: `GalleryLightboxZone` wnosi stan i overlay, a przez render-prop
// oddaje wrapper `trigger(index, node, className?)`, którym renderer opakowuje
// swoje kafle - bez przenoszenia layoutu galerii do tego pliku.
//
// DOSTĘPNOŚĆ (wymagania, nie ozdobniki):
//  - `role="dialog"` + `aria-modal="true"` + `aria-label` na kontenerze,
//  - pułapka focusu i przywrócenie focusu na element wyzwalający - wspólny
//    `useFocusTrap` z lib/a11y (ten sam, co Header, PopupHost, ConsentBanner),
//  - Esc zamyka, strzałki lewo/prawo przewijają (z zawijaniem), klik w tło
//    zamyka,
//  - licznik "n / N" w `aria-live="polite"`, alt zdjęcia numerowany,
//  - `prefers-reduced-motion`: zero przejść (klasa i tak ma wariant
//    `motion-reduce:`, ale hook wycina je również, gdy Tailwind nie zdąży),
//  - kontrast: tło #0a0a0a/95, tekst i ikony białe (>= 15:1), widoczny
//    `focus-visible` ring w bieli na ciemnym tle,
//  - blokada scrolla tła na czas otwarcia.
//
// DLACZEGO NIE `components/Lightbox` (yet-another-react-lightbox): tamten
// wrapper obsługuje LEGACY blok galerii (`components/blocks/GalleryBlock`) i
// ciągnie za sobą bibliotekę wraz z jej arkuszem CSS. Widgety buildera
// renderują się na praktycznie każdej stronie publicznej, więc wciągnięcie
// tej zależności do chunku `widget-view` obciążyłoby wszystkich - łącznie ze
// stronami bez galerii. Tutaj wystarczą wspólne prymitywy dostępności
// (useFocusTrap, usePrefersReducedMotion) i zero nowych zależności.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { safeImageUrl } from "@/lib/sanitize";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { Lang } from "./frame";

/** Teksty interfejsu lightboxa. Język bierzemy z `lang` widgetu - dokładnie
 *  jak reszta rendererów widoku (podgląd buildera przełącza język dokumentu,
 *  nie język panelu administratora). */
const COPY = {
  pl: {
    dialog: "Podgląd zdjęcia",
    open: (n: number, total: number) => `Powiększ zdjęcie ${n} z ${total}`,
    photo: (n: number, total: number) => `Zdjęcie ${n} z ${total}`,
    close: "Zamknij podgląd",
    prev: "Poprzednie zdjęcie",
    next: "Następne zdjęcie",
  },
  en: {
    dialog: "Photo preview",
    open: (n: number, total: number) => `Enlarge photo ${n} of ${total}`,
    photo: (n: number, total: number) => `Photo ${n} of ${total}`,
    close: "Close preview",
    prev: "Previous photo",
    next: "Next photo",
  },
} as const;

/** Ring na ciemnym tle overlaya (biały na czerni). */
const FOCUS_RING_ON_DARK =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black";

/** Ring na kaflu galerii, czyli na tle strony (kolor marki na tle motywu). */
const FOCUS_RING_ON_PAGE =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const CONTROL =
  "inline-flex items-center justify-center rounded-[6px] bg-white/10 text-white hover:bg-white/25 disabled:opacity-40";

export interface GalleryLightboxProps {
  /** Pełna lista zdjęć galerii (te same URL-e, które renderuje siatka). */
  images: readonly string[];
  /** Indeks otwartego zdjęcia; `null` (lub poza zakresem) = zamknięty. */
  index: number | null;
  lang: Lang;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}

/**
 * Sterowany (controlled) dialog pełnoekranowy. Renderuje `null`, gdy zamknięty
 * lub gdy indeks wypada poza listę - dzięki temu stan może żyć u wywołującego,
 * a komponent pozostaje czysty i testowalny bez galerii.
 */
export function GalleryLightbox({
  images,
  index,
  lang,
  onClose,
  onIndexChange,
}: GalleryLightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const total = images.length;
  const open = index !== null && index >= 0 && index < total;
  const t = COPY[lang === "en" ? "en" : "pl"];

  const step = useCallback(
    (delta: number) => {
      if (index === null || total === 0) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, total, onIndexChange],
  );

  // Focus: wejście do dialogu przy otwarciu, cykl Tab wewnątrz, powrót na
  // element wyzwalający przy zamknięciu. Wspólny hook - zero własnej kopii.
  useFocusTrap(dialogRef, open);

  // Klawiatura globalnie (nie na kontenerze): focus może stać na kontrolce
  // wewnątrz dialogu, a Esc i strzałki mają działać niezależnie od tego, gdzie.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (total < 2) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, step, total]);

  // Blokada scrolla tła: overlay przykrywa stronę, więc kółko myszy nie może
  // przewijać treści pod spodem.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || index === null || typeof document === "undefined") return null;

  const src = safeImageUrl(images[index]);
  const position = `${index + 1} / ${total}`;

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.dialog}
      data-gallery-lightbox
      data-reduced-motion={reducedMotion ? "true" : "false"}
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 p-4 sm:p-6",
        "bg-[#0a0a0a]/95 backdrop-blur-sm",
        !reducedMotion && "transition-opacity duration-200 motion-reduce:transition-none",
      )}
    >
      <div className="flex w-full max-w-[92vw] items-center justify-between gap-3">
        <span
          aria-live="polite"
          className="rounded-[4px] bg-white/10 px-2 py-1 text-[12px] font-semibold tabular-nums text-white"
        >
          {position}
        </span>
        <button
          type="button"
          data-autofocus
          aria-label={t.close}
          onClick={onClose}
          className={cn(CONTROL, FOCUS_RING_ON_DARK, "h-9 w-9")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div
        className="flex min-h-0 w-full max-w-[92vw] flex-1 items-center justify-center gap-2 sm:gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {total > 1 && (
          <button
            type="button"
            aria-label={t.prev}
            onClick={() => step(-1)}
            className={cn(CONTROL, FOCUS_RING_ON_DARK, "h-10 w-10 shrink-0")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
        )}
        {src ? (
          <img
            src={src}
            alt={t.photo(index + 1, total)}
            decoding="async"
            className={cn(
              "max-h-[78vh] max-w-full min-w-0 rounded-[6px] object-contain",
              !reducedMotion && "transition-transform duration-200 motion-reduce:transition-none",
            )}
          />
        ) : (
          <span className="text-[13px] text-white/80">{t.photo(index + 1, total)}</span>
        )}
        {total > 1 && (
          <button
            type="button"
            aria-label={t.next}
            onClick={() => step(1)}
            className={cn(CONTROL, FOCUS_RING_ON_DARK, "h-10 w-10 shrink-0")}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );

  // Portal do <body>: kafle galerii siedzą w kontenerach z `overflow-hidden`
  // (karuzela, masonry), które przycięłyby overlay renderowany in-place.
  return createPortal(overlay, document.body);
}

/**
 * Wrapper kafla galerii. Wywołujący opakowuje nim każdy obrazek:
 * `trigger(i, <WidgetMediaImage … />)`. Trzeci argument przenosi klasy
 * layoutu (np. `flex-[0_0_80%] snap-start` karuzeli) na wrapper, żeby
 * włączenie lightboxa nie zmieniło geometrii siatki.
 */
export type GalleryLightboxTrigger = (
  index: number,
  child: ReactNode,
  className?: string,
) => ReactNode;

export interface GalleryLightboxZoneProps {
  images: readonly string[];
  /** Wartość ustawienia `lightbox` po koercji `asBool`. */
  enabled: boolean;
  lang: Lang;
  children: (trigger: GalleryLightboxTrigger) => ReactNode;
}

/**
 * Stanowy host lightboxa. Renderer galerii pozostaje bezstanowy (jest gałęzią
 * `switch`), a cały stan otwarcia mieszka tutaj.
 */
export function GalleryLightboxZone({ images, enabled, lang, children }: GalleryLightboxZoneProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const t = COPY[lang === "en" ? "en" : "pl"];
  const total = images.length;

  const close = useCallback(() => setOpenIndex(null), []);

  const trigger = useCallback<GalleryLightboxTrigger>(
    (index, child, className) => {
      if (!enabled) {
        // Bez lightboxa nie dokładamy węzła bez powodu - wrapper pojawia się
        // tylko wtedy, gdy musi przenieść klasy layoutu.
        return className ? (
          <span key={index} className={cn("block", className)}>
            {child}
          </span>
        ) : (
          child
        );
      }
      return (
        <button
          key={index}
          type="button"
          aria-label={t.open(index + 1, total)}
          onClick={() => setOpenIndex(index)}
          className={cn(
            "block cursor-zoom-in appearance-none border-0 bg-transparent p-0 text-left",
            FOCUS_RING_ON_PAGE,
            className,
          )}
        >
          {child}
        </button>
      );
    },
    [enabled, t, total],
  );

  return (
    <>
      {children(trigger)}
      {enabled && (
        <GalleryLightbox
          images={images}
          index={openIndex}
          lang={lang}
          onClose={close}
          onIndexChange={setOpenIndex}
        />
      )}
    </>
  );
}
