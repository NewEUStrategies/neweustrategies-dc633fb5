// First-use coachmark overlay. Client-only (portals to document.body). For the
// active step it locates the `[data-tour="…"]` element, dims everything except
// a rounded spotlight around it, and renders a positioned tooltip card
// (title / body / step-of / back / next / skip). Esc and backdrop-click
// dismiss; arrow keys navigate; focus moves into the card; respects
// prefers-reduced-motion. A step with no anchor (or a missing anchor) renders a
// centered modal card instead of a spotlight.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "@/lib/lucide-shim";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { TourController, TourPlacement } from "@/lib/onboarding/types";
import { Button } from "@/components/ui/button";

type Rect = { top: number; left: number; width: number; height: number };

const CARD_W = 300;
const GAP = 12;
const MARGIN = 12;

function computeCardPos(
  rect: Rect | null,
  placement: TourPlacement | undefined,
  cardH: number,
  vw: number,
  vh: number,
): { top: number; left: number } {
  // Anchorless / not-found → centered modal.
  if (!rect) {
    return {
      top: Math.max(MARGIN, vh / 2 - cardH / 2),
      left: Math.max(MARGIN, vw / 2 - CARD_W / 2),
    };
  }
  const side = placement ?? "bottom";
  let top = 0;
  let left = 0;
  switch (side) {
    case "top":
      top = rect.top - cardH - GAP;
      left = rect.left + rect.width / 2 - CARD_W / 2;
      break;
    case "bottom":
      top = rect.top + rect.height + GAP;
      left = rect.left + rect.width / 2 - CARD_W / 2;
      break;
    case "left":
      left = rect.left - CARD_W - GAP;
      top = rect.top + rect.height / 2 - cardH / 2;
      break;
    case "right":
      left = rect.left + rect.width + GAP;
      top = rect.top + rect.height / 2 - cardH / 2;
      break;
  }
  // Flip to the opposite side when the preferred side overflows.
  if (side === "top" && top < MARGIN) top = rect.top + rect.height + GAP;
  else if (side === "bottom" && top + cardH > vh - MARGIN) top = rect.top - cardH - GAP;
  if (side === "left" && left < MARGIN) left = rect.left + rect.width + GAP;
  else if (side === "right" && left + CARD_W > vw - MARGIN) left = rect.left - CARD_W - GAP;
  // Clamp inside the viewport.
  left = Math.max(MARGIN, Math.min(left, vw - CARD_W - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - cardH - MARGIN));
  return { top, left };
}

export function CoachmarkTour({ controller }: { controller: TourController }) {
  const { active, currentStep, stepIndex, totalSteps, next, prev, skip, finish } = controller;
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);
  const isLast = stepIndex + 1 >= totalSteps;

  // Measure the anchor for the active step, and re-read (but never re-scroll)
  // on resize/scroll. The one-time scrollIntoView is deliberately kept OUT of
  // the resize/scroll handler: a handler that itself scrolls would fight the
  // user's own scrolling (snap-back) and re-trigger during the smooth-scroll
  // animation. So we scroll the anchor into view once when the step activates,
  // then the listeners only update the rect via getBoundingClientRect().
  useLayoutEffect(() => {
    if (!active || !currentStep?.anchor) {
      setRect(null);
      return;
    }
    const anchor = currentStep.anchor;
    const reposition = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
      if (!el) {
        setRect(null);
        return null;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      return el;
    };
    // Scroll the anchor into view exactly once per step activation…
    const el = reposition();
    el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    // …then only re-read the rect on resize/scroll (no further scrolling).
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [active, currentStep, reduced, stepIndex]);

  // Keep the measured card height in sync (body copy varies per step).
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [currentStep, rect]);

  // Esc dismisses; arrows navigate; focus the card on open.
  useEffect(() => {
    if (!active) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, skip, next, prev]);

  if (!active || !currentStep || typeof document === "undefined") return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const pad = 6;
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;
  const pos = computeCardPos(rect, currentStep.placement, cardH, vw, vh);
  const transition = reduced ? "none" : "all 180ms ease";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(currentStep.titleKey)}
      className="fixed inset-0 z-[100]"
    >
      {/* Backdrop — dims the page; click dismisses. When a spotlight is present
          the dimming is drawn by the spotlight's huge box-shadow instead, so
          the backdrop stays transparent to keep the cut-out crisp. */}
      <div
        className="absolute inset-0"
        style={{ background: spotlight ? "transparent" : "rgba(0,0,0,0.55)" }}
        onClick={skip}
        aria-hidden
      />
      {spotlight ? (
        <div
          style={{
            position: "fixed",
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 8,
            transition,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        tabIndex={-1}
        style={{ position: "fixed", top: pos.top, left: pos.left, width: CARD_W, transition }}
        className="rounded-lg border border-border bg-popover text-popover-foreground shadow-xl p-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{t(currentStep.titleKey)}</h3>
          <button
            type="button"
            onClick={skip}
            aria-label={t("admin.onboarding.common.close")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t(currentStep.bodyKey)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t("admin.onboarding.common.stepOf", {
              current: stepIndex + 1,
              total: totalSteps,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={skip}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("admin.onboarding.common.skip")}
            </button>
            {stepIndex > 0 && (
              <Button size="sm" variant="outline" onClick={prev}>
                {t("admin.onboarding.common.back")}
              </Button>
            )}
            <Button size="sm" onClick={isLast ? finish : next}>
              {isLast ? t("admin.onboarding.common.done") : t("admin.onboarding.common.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
