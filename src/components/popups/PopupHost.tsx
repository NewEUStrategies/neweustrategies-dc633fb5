// Public host for builder popups. Mounted once in __root.tsx (lazy).
//
// Every page view: pick the first active popup whose targeting matches
// (path / device / audience) and whose frequency cap allows a show, wire its
// trigger (immediate / delay / scroll / exit-intent) and render the popup's
// builder document in a modal once it fires. Dismissal is remembered in
// localStorage per popup (settings.frequencyDays).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { useAuth } from "@/hooks/useAuth";
import { X } from "@/lib/lucide-shim";
import type { Device } from "@/lib/builder/types";
import {
  evaluatePopupTargeting,
  isPopupFrequencyOk,
  markPopupDismissed,
  useActivePopups,
  type BuilderPopup,
  type PopupSettings,
} from "@/lib/builder/popups";

const WIDTH_PX: Record<PopupSettings["width"], number> = {
  sm: 420,
  md: 640,
  lg: 860,
  xl: 1080,
};

function viewportDevice(): Device {
  if (typeof window === "undefined") return "desktop";
  if (window.innerWidth < 768) return "mobile";
  if (window.innerWidth < 1024) return "tablet";
  return "desktop";
}

export function PopupHost() {
  const { i18n } = useTranslation();
  const { session } = useAuth();
  const loc = useLocation();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<BuilderPopup | null>(null);
  // Popups already shown (or dismissed) in this app session - never re-trigger
  // on client-side navigation within the same visit.
  const shownRef = useRef<Set<string>>(new Set());
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  const onAdminSurface = loc.pathname.startsWith("/admin") || loc.pathname.startsWith("/login");
  const { data: popups } = useActivePopups(mounted && !onAdminSurface);

  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";

  // First eligible popup for this page view.
  const candidate = useMemo(() => {
    if (!mounted || onAdminSurface || open || !popups?.length) return null;
    const ctx = { path: loc.pathname, device: viewportDevice(), isLoggedIn: !!session };
    return (
      popups.find(
        (p) =>
          !shownRef.current.has(p.id) &&
          p.builder_data.sections.length > 0 &&
          evaluatePopupTargeting(p.settings, ctx) &&
          isPopupFrequencyOk(p.id, p.settings.frequencyDays),
      ) ?? null
    );
  }, [mounted, onAdminSurface, open, popups, loc.pathname, session]);

  // Wire the candidate's trigger.
  useEffect(() => {
    if (!candidate) return;
    const s = candidate.settings;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onScroll: (() => void) | null = null;
    let onMouseLeave: ((e: MouseEvent) => void) | null = null;

    const fire = () => {
      shownRef.current.add(candidate.id);
      setOpen(candidate);
    };

    if (s.trigger === "immediate") {
      timer = setTimeout(fire, 400);
    } else if (s.trigger === "delay") {
      timer = setTimeout(fire, Math.max(1, s.delaySeconds) * 1000);
    } else if (s.trigger === "scroll") {
      onScroll = () => {
        const el = document.documentElement;
        const total = el.scrollHeight - el.clientHeight;
        if (total <= 0) return;
        if ((window.scrollY / total) * 100 >= s.scrollPercent) {
          fire();
          if (onScroll) window.removeEventListener("scroll", onScroll);
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    } else if (s.trigger === "exit-intent") {
      onMouseLeave = (e: MouseEvent) => {
        if (e.clientY <= 0) {
          fire();
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
  }, [candidate]);

  const close = useCallback(() => {
    setOpen((prev) => {
      if (prev) markPopupDismissed(prev.id);
      return null;
    });
  }, []);

  // Escape closes; focus lands on the close button when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const s = open.settings;

  const alignClass =
    s.position === "top"
      ? "items-start pt-10"
      : s.position === "bottom"
        ? "items-end pb-10"
        : "items-center";

  const panelStyle: CSSProperties = {
    width: "100%",
    maxWidth: `${WIDTH_PX[s.width]}px`,
    borderRadius: `${s.borderRadiusPx}px`,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={open.name}
      className={`fixed inset-0 z-[100] flex justify-center p-4 backdrop-blur-sm animate-in fade-in ${alignClass}`}
      style={{ backgroundColor: s.overlayColor }}
      onClick={s.closeOnOverlay ? close : undefined}
    >
      <div
        className="relative max-h-[92vh] overflow-y-auto bg-background text-foreground shadow-2xl border border-border animate-in zoom-in-95"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {s.showCloseButton && (
          <button
            ref={closeBtnRef}
            type="button"
            aria-label={lang === "pl" ? "Zamknij" : "Close"}
            onClick={close}
            className="absolute top-3 right-3 z-20 h-9 w-9 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <BuilderRenderer doc={open.builder_data} lang={lang} />
      </div>
    </div>
  );
}
