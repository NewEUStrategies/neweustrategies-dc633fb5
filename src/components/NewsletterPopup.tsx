// Popup REJESTRACJI konta (newsletter to w nim wyłącznie opcjonalny checkbox)
// w trzech układach:
// - "showcase" - galeria kadrów + formularz, 1:1 z projektem referencyjnym
// - "stacked"  - klasyczny dialog (okładka u góry, formularz pod nią)
// - "split"    - grafika po lewej, formularz po prawej
// Triggery: delay / scroll / exit-intent. Frequency gating w localStorage.
// Paleta: ciemna / jasna / automatyczna (motyw strony) - patrz popupDesign.
// Mountowany globalnie w __root.tsx.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useLocation } from "@tanstack/react-router";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { NewsletterForm } from "@/components/NewsletterForm";
import { PopupSignupForm } from "@/components/PopupSignupForm";
import { trackNewsletterPopupEvent } from "@/lib/newsletter/popupTelemetry";
import { SignupPopupPanel } from "@/components/popups/SignupPopupPanel";
import "@/lib/i18n-signup-popup";
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { X, Send } from "@/lib/lucide-shim";
import { useFocusTrap } from "@/lib/a11y/useFocusTrap";
import { useTheme } from "@/components/ThemeProvider";
import { requestOverlaySlot, cancelOverlayRequest } from "@/lib/overlayCoordinator";
import {
  effectivePopupMode,
  popupPaletteVars,
  resolvePopupDesign,
  resolvePopupPalette,
} from "@/lib/newsletter/popupDesign";

const LS_KEY = "nl_popup_last";

// Per-visit guard: once the popup has been granted a slot in this app session,
// never re-arm its trigger on client-side navigation (mirrors PopupHost's
// shownRef). Survives route changes; resets on a full reload.
let shownThisSession = false;

function shouldShow(freqDays: number): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return true;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return true;
  const ms = Math.max(1, freqDays) * 86_400_000;
  return Date.now() - ts > ms;
}

function markDismissed() {
  try {
    window.localStorage.setItem(LS_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

export function NewsletterPopup() {
  const { data: s } = useNewsletterSettings();
  const { theme } = useTheme();
  const { i18n, t } = useTranslation();

  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const releaseSlotRef = useRef<(() => void) | null>(null);
  useFocusTrap(panelRef, open);

  // Jeden jezyk dla calego popupu: kod dla dzieci i serwera oraz wybor tresci
  // z blizniaczych kolumn. Dotad ta sama derywacja powtarzala sie w siedmiu
  // miejscach jako `lang`.
  const lang = uiLang(i18n.language);

  useEffect(() => {
    // Popup rejestracji jest niezależny od trybu newslettera (`mode`) - ten
    // steruje wyłącznie formularzem newslettera. Jedyną bramką jest własny
    // przełącznik popupu w Admin -> Popupy.
    if (!s?.popup_enabled) return;

    if (loc.pathname.startsWith("/admin") || loc.pathname.startsWith("/auth")) return;
    if (shownThisSession) return;
    if (!shouldShow(s.popup_frequency_days)) return;

    // "impression" = popup kwalifikuje się do pokazania na tej odsłonie
    // (wszystkie bramki przeszły); "open" = faktycznie się pojawił.
    trackNewsletterPopupEvent({
      event: "impression",
      lang: lang,
      layout: s.popup_layout,
      source: "popup",
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    let onScroll: (() => void) | null = null;
    let onMouseLeave: ((e: MouseEvent) => void) | null = null;
    let disposed = false;

    // The trigger only ASKS to open - the overlay coordinator defers the
    // grant behind the consent banner / another marketing overlay.
    const trigger = () => {
      void requestOverlaySlot("newsletter-popup", { marketing: true, priority: 0 }).then(
        (release) => {
          if (disposed) {
            release();
            return;
          }
          shownThisSession = true;
          releaseSlotRef.current = release;
          setOpen(true);
          trackNewsletterPopupEvent({
            event: "open",
            lang: lang,
            layout: s.popup_layout,
            source: "popup",
          });
        },
      );
    };

    if (s.popup_trigger === "delay") {
      timer = setTimeout(trigger, Math.max(1, s.popup_delay_seconds) * 1000);
    } else if (s.popup_trigger === "scroll") {
      onScroll = () => {
        const doc = document.documentElement;
        const total = doc.scrollHeight - doc.clientHeight;
        if (total <= 0) return;
        const pct = (window.scrollY / total) * 100;
        if (pct >= Math.max(1, s.popup_scroll_percent)) {
          trigger();
          if (onScroll) window.removeEventListener("scroll", onScroll);
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    } else if (s.popup_trigger === "exit-intent") {
      onMouseLeave = (e: MouseEvent) => {
        if (e.clientY <= 0) {
          trigger();
          if (onMouseLeave) document.removeEventListener("mouseleave", onMouseLeave);
        }
      };
      document.addEventListener("mouseleave", onMouseLeave);
    }

    return () => {
      disposed = true;
      cancelOverlayRequest("newsletter-popup");
      if (timer) clearTimeout(timer);
      if (onScroll) window.removeEventListener("scroll", onScroll);
      if (onMouseLeave) document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [s, loc.pathname, lang]);

  // `pickLocalized` zamiast recznego warunku: puste tlumaczenie (albo ciag
  // z samych spacji) siega po drugi jezyk, zamiast pokazac popup bez tytulu.
  const title = pickLocalized(s, "popup_title", lang);
  const desc = pickLocalized(s, "popup_description", lang);
  const close = useCallback(() => {
    markDismissed();
    setOpen(false);
    releaseSlotRef.current?.();
    releaseSlotRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!s?.popup_enabled || !open) return null;
  // Popup nie zamyka się sam: po udanym zapisie zostaje otwarty z komunikatem
  // sukcesu, a użytkownik zamyka go świadomie (X lub Esc).
  const onSuccess = () => {
    markDismissed();
  };

  const showcase = s.popup_layout === "showcase";
  const split = s.popup_layout === "split";
  const eyebrow = pickLocalized(s, "popup_eyebrow", lang) || "Newsletter";

  // Paleta: kolumny = wariant ciemny, popup_design.light = jasny, "auto"
  // podąża za motywem strony. Jedna funkcja obsługuje wszystkie układy.
  const design = resolvePopupDesign(s.popup_design);
  const mode = effectivePopupMode(design, theme);
  const palette = resolvePopupPalette(s, mode);
  const radiusPx = Math.max(0, s.popup_border_radius_px ?? 6);
  const popupStyle: React.CSSProperties = {
    backgroundColor: palette.bg,
    color: palette.fg,
    borderRadius: `${radiusPx}px`,
    ...popupPaletteVars(palette, radiusPx),
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nl-popup-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in"
      style={{ backgroundColor: palette.overlay }}
      onClick={close}
    >
      {showcase ? (
        // Panel showcase w całości pochodzi ze wspólnego komponentu - dokładnie
        // ten sam markup renderuje podgląd w panelu admina.
        // Na telefonie panel przewija się w pionie; `overflow-x-clip`
        // + `overscroll-contain` odbierają mu przy tym możliwość przesuwania
        // w poziomie (samo `overflow-y: auto` wymusza `overflow-x: auto`).
        <div
          ref={panelRef}
          className="my-4 w-full max-h-[92vh] overflow-y-auto overflow-x-clip overscroll-contain md:overflow-visible"
          style={{ maxWidth: `${design.panel.maxWidthPx}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <SignupPopupPanel
            settings={s}
            lang={lang}
            mode={mode}
            onClose={close}
            onSuccess={onSuccess}
            titleId="nl-popup-title"
          />
        </div>
      ) : (
        <div
          ref={panelRef}
          className={
            split
              ? "relative w-full max-w-4xl my-4 max-h-[92vh] overflow-y-auto md:overflow-hidden shadow-2xl border border-white/10 grid grid-cols-1 md:grid-cols-2"
              : "relative w-full max-w-lg my-4 max-h-[92vh] overflow-y-auto shadow-2xl border border-white/10"
          }
          style={popupStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={close}
            className="absolute top-3 right-3 z-20 h-9 w-9 rounded-[6px] bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            style={{ color: palette.fg }}
          >
            <X className="w-4 h-4" />
          </button>

          {s.popup_doc ? (
            <div className="p-6 lg:p-8 space-y-3 md:max-h-[92vh] md:overflow-y-auto">
              <NewsletterDocRenderer doc={s.popup_doc} settings={s} lang={lang} source="popup" />
            </div>
          ) : split ? (
            <>
              <div
                className="relative h-40 sm:h-56 md:h-auto md:min-h-[560px] bg-cover bg-center"
                style={{
                  backgroundImage: s.popup_side_image_url
                    ? `url(${s.popup_side_image_url})`
                    : `linear-gradient(135deg, ${palette.gradFrom}, ${palette.gradTo})`,
                }}
                aria-hidden="true"
              >
                {!s.popup_side_image_url && (
                  <div className="absolute inset-0 flex items-center justify-center p-6 md:p-8 text-center">
                    <div className="space-y-2">
                      <div
                        className="text-[10px] sm:text-xs uppercase tracking-[0.3em]"
                        style={{ color: palette.muted }}
                      >
                        {eyebrow}
                      </div>
                      <div
                        className="font-display text-xl sm:text-2xl md:text-3xl"
                        style={{ color: palette.fg }}
                      >
                        {title}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 sm:p-6 md:p-8 lg:p-10 md:max-h-[92vh] md:overflow-y-auto">
                <div className="flex items-start justify-between gap-3 mb-2 pr-10 md:pr-0">
                  <h2
                    id="nl-popup-title"
                    className="font-display text-2xl sm:text-3xl leading-tight"
                  >
                    {title}
                  </h2>
                  <Send
                    className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 mt-1"
                    style={{ color: palette.accent }}
                  />
                </div>
                {desc && (
                  <p className="text-sm mb-5 leading-relaxed" style={{ color: palette.muted }}>
                    {desc}
                  </p>
                )}
                <PopupSignupForm settings={s} lang={lang} onSuccess={onSuccess} />
              </div>
            </>
          ) : (
            <>
              {s.popup_cover_url && (
                <img
                  src={s.popup_cover_url}
                  alt=""
                  loading="lazy"
                  className="w-full aspect-[16/7] object-cover"
                />
              )}
              <div className="p-6 lg:p-8 space-y-3">
                <h2 id="nl-popup-title" className="font-display text-2xl">
                  {title}
                </h2>
                {desc && (
                  <p className="text-sm" style={{ color: palette.muted }}>
                    {desc}
                  </p>
                )}
                {s.popup_extended_fields ||
                s.popup_mailing_lists.length > 0 ||
                s.popup_require_terms ? (
                  <PopupSignupForm settings={s} lang={lang} onSuccess={onSuccess} />
                ) : (
                  <NewsletterForm lang={lang} source="popup" variant="inline" />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
