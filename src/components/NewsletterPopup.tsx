// Renders a one-shot popup (delay / scroll-percent / exit-intent triggers).
// Re-shows after `popup_frequency_days`. Uses localStorage to remember last
// dismissal/conversion per browser. Mounted globally in __root.tsx.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "@tanstack/react-router";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { NewsletterForm } from "@/components/NewsletterForm";
import { X } from "@/lib/lucide-shim";

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
    // Don't show in admin/auth pages.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nl-popup-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-foreground/60 backdrop-blur-sm animate-in fade-in"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg bg-card text-foreground rounded-xl shadow-2xl overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={isPl ? "Zamknij" : "Close"}
          onClick={close}
          className="absolute top-3 right-3 z-10 h-9 w-9 rounded-full bg-background/80 hover:bg-background flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
        {s.popup_cover_url ? (
          <img
            src={s.popup_cover_url}
            alt=""
            loading="lazy"
            className="w-full aspect-[16/7] object-cover"
          />
        ) : null}
        <div className="p-6 lg:p-8 space-y-3">
          <h2 id="nl-popup-title" className="font-display text-2xl">{title}</h2>
          {desc ? <p className="text-sm text-muted-foreground">{desc}</p> : null}
          <NewsletterForm lang={isPl ? "pl" : "en"} source="popup" variant="inline" />
        </div>
      </div>
    </div>
  );
}
