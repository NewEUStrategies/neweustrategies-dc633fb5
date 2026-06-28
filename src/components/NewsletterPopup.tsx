// Popup newslettera z dwoma układami:
// - "stacked" - klasyczny dialog (okładka u góry, formularz pod nią)
// - "split"   - grafika po lewej, formularz po prawej (jak konferencyjny landing)
// Triggery: delay / scroll / exit-intent. Frequency gating w localStorage.
// Mountowany globalnie w __root.tsx.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { NewsletterForm } from "@/components/NewsletterForm";
import { NewsletterPopupForm } from "@/components/NewsletterPopupForm";
import { X, Send } from "@/lib/lucide-shim";

const LS_KEY = "nl_popup_last";

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
  try { window.localStorage.setItem(LS_KEY, String(Date.now())); } catch { /* noop */ }
}

export function NewsletterPopup() {
  const { data: s } = useNewsletterSettings();
  const { i18n } = useTranslation();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const isPl = (i18n.language ?? "pl").startsWith("pl");

  useEffect(() => {
    if (!s?.popup_enabled || !s.enabled) return;
    if (loc.pathname.startsWith("/admin") || loc.pathname.startsWith("/auth")) return;
    if (!shouldShow(s.popup_frequency_days)) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let onScroll: (() => void) | null = null;
    let onMouseLeave: ((e: MouseEvent) => void) | null = null;

    const trigger = () => setOpen(true);

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
      if (timer) clearTimeout(timer);
      if (onScroll) window.removeEventListener("scroll", onScroll);
      if (onMouseLeave) document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [s, loc.pathname]);

  if (!s?.popup_enabled || !open) return null;

  const title = isPl ? s.popup_title_pl : s.popup_title_en;
  const desc = isPl ? s.popup_description_pl : s.popup_description_en;
  const close = () => { markDismissed(); setOpen(false); };
  const onSuccess = () => { markDismissed(); setTimeout(() => setOpen(false), 1800); };

  const split = s.popup_layout === "split";
  const eyebrow = isPl ? (s.popup_eyebrow_pl || "Newsletter") : (s.popup_eyebrow_en || "Newsletter");
  const radius = `${Math.max(0, s.popup_border_radius_px ?? 16)}px`;
  const popupStyle: React.CSSProperties = {
    backgroundColor: s.popup_bg_color || "#0a0a0a",
    color: s.popup_text_color || "#ffffff",
    borderRadius: radius,
    // CSS vars consumed by NewsletterPopupForm and child elements
    ["--nl-bg" as string]: s.popup_bg_color || "#0a0a0a",
    ["--nl-fg" as string]: s.popup_text_color || "#ffffff",
    ["--nl-muted" as string]: s.popup_muted_color || "#b8b8b8",
    ["--nl-accent" as string]: s.popup_accent_color || "#f97316",
    ["--nl-accent-fg" as string]: s.popup_accent_text_color || "#ffffff",
    ["--nl-radius" as string]: radius,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nl-popup-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in"
      style={{ backgroundColor: s.popup_overlay_color || "rgba(0,0,0,0.7)" }}
      onClick={close}
    >
      <div
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
          aria-label={isPl ? "Zamknij" : "Close"}
          onClick={close}
          className="absolute top-3 right-3 z-20 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          style={{ color: s.popup_text_color || "#ffffff" }}
        >
          <X className="w-4 h-4" />
        </button>

        {split ? (
          <>
            <div
              className="relative h-40 sm:h-56 md:h-auto md:min-h-[560px] bg-cover bg-center"
              style={{
                backgroundImage: s.popup_side_image_url
                  ? `url(${s.popup_side_image_url})`
                  : `linear-gradient(135deg, ${s.popup_accent_color || "#f97316"}, ${s.popup_bg_color || "#0a0a0a"})`,
              }}
              aria-hidden="true"
            >
              {!s.popup_side_image_url && (
                <div className="absolute inset-0 flex items-center justify-center p-6 md:p-8 text-center">
                  <div className="space-y-2">
                    <div className="text-[10px] sm:text-xs uppercase tracking-[0.3em]" style={{ color: s.popup_muted_color || "#b8b8b8" }}>
                      {eyebrow}
                    </div>
                    <div className="font-display text-xl sm:text-2xl md:text-3xl" style={{ color: s.popup_text_color || "#ffffff" }}>{title}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-5 sm:p-6 md:p-8 lg:p-10 md:max-h-[92vh] md:overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-2 pr-10 md:pr-0">
                <h2 id="nl-popup-title" className="font-display text-2xl sm:text-3xl leading-tight">{title}</h2>
                <Send className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 mt-1" style={{ color: s.popup_accent_color || "#f97316" }} />
              </div>
              {desc && <p className="text-sm mb-5 leading-relaxed" style={{ color: s.popup_muted_color || "#b8b8b8" }}>{desc}</p>}
              <NewsletterPopupForm settings={s} lang={isPl ? "pl" : "en"} onSuccess={onSuccess} />
            </div>
          </>
        ) : (
          <>
            {s.popup_cover_url && (
              <img src={s.popup_cover_url} alt="" loading="lazy" className="w-full aspect-[16/7] object-cover" />
            )}
            <div className="p-6 lg:p-8 space-y-3">
              <h2 id="nl-popup-title" className="font-display text-2xl">{title}</h2>
              {desc && <p className="text-sm" style={{ color: s.popup_muted_color || "#b8b8b8" }}>{desc}</p>}
              {s.popup_extended_fields || s.popup_mailing_lists.length > 0 || s.popup_require_terms ? (
                <NewsletterPopupForm settings={s} lang={isPl ? "pl" : "en"} onSuccess={onSuccess} />
              ) : (
                <NewsletterForm lang={isPl ? "pl" : "en"} source="popup" variant="inline" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
