// Preferencję „ogranicz ruch" czytamy wspólnym odczytem (`lib/a11y`), a nie
// prywatną kopią. Tamta przepuszczała rzut z `matchMedia` (np. SecurityError
// w piaskownicy), a pada on PO podmianie `scroll-behavior`/`overflow-anchor`
// na <html> i <body>, ale PRZED przewinięciem i `cleanup()` - skok do kotwicy
// nie zachodził, a strona zostawała z nadpisanymi stylami do następnego skoku.
import { prefersReducedMotion } from "@/lib/a11y/reducedMotion";

type ScrollCancel = () => void;

interface SmoothAnchorScrollOptions {
  offset?: number;
  minDuration?: number;
  maxDuration?: number;
  updateHash?: boolean;
  onFinish?: () => void;
}

const MAX_FRAME_STEP_MS = 24;

let activeScrollCancel: ScrollCancel | null = null;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function easeOutCubic(t: number): number {
  // Łagodny start (bez szarpnięcia w pierwszej klatce) i miękkie wyhamowanie
  // przy nagłówku: krzywa sinusoidalna, odpowiednik CSS `ease-in-out`.
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function getAnchorScrollOffset(defaultOffset = 80): number {
  if (typeof document === "undefined") return defaultOffset;
  const header = document.querySelector<HTMLElement>(
    "[data-site-header], header[role='banner'], header",
  );
  if (!header) return defaultOffset;
  const rect = header.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= 0) return defaultOffset;
  return Math.ceil(rect.height + 12);
}

export function replaceHashPreservingRouterState(id: string): void {
  if (typeof window === "undefined") return;
  const nextUrl = `${window.location.pathname}${window.location.search}#${id}`;
  replaceUrlWithHashScrollDisabled(nextUrl);
}

function replaceUrlWithHashScrollDisabled(nextUrl: string): void {
  if (typeof window === "undefined") return;
  const currentState: unknown = window.history.state;
  const nextState =
    currentState && typeof currentState === "object" && !Array.isArray(currentState)
      ? { ...(currentState as Record<string, unknown>), __hashScrollIntoViewOptions: false }
      : { __hashScrollIntoViewOptions: false };
  window.history.replaceState(nextState, "", nextUrl);
}

function disableRouterHashScrollForCurrentEntry(): void {
  if (typeof window === "undefined") return;
  replaceUrlWithHashScrollDisabled(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

function cancelSmoothAnchorScroll(): void {
  activeScrollCancel?.();
  activeScrollCancel = null;
}

export function smoothScrollToAnchor(id: string, options: SmoothAnchorScrollOptions = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;

  cancelSmoothAnchorScroll();

  // Nawigacja po spisie ma reagować od razu. Poprzednie 1,8 s przy długich
  // artykułach było odbierane jako opóźnienie i prowokowało kolejne kliknięcie.
  const minDuration = options.minDuration ?? 360;
  const maxDuration = options.maxDuration ?? 1100;
  const updateHash = options.updateHash ?? true;
  const offset = options.offset ?? getAnchorScrollOffset();
  disableRouterHashScrollForCurrentEntry();
  if (updateHash) replaceHashPreservingRouterState(id);
  const html = document.documentElement;
  const body = document.body;
  const previousHtmlScrollBehavior = html.style.scrollBehavior;
  const previousBodyScrollBehavior = body.style.scrollBehavior;
  const previousHtmlOverflowAnchor = html.style.overflowAnchor;
  const previousBodyOverflowAnchor = body.style.overflowAnchor;

  html.style.scrollBehavior = "auto";
  body.style.scrollBehavior = "auto";
  html.style.overflowAnchor = "none";
  body.style.overflowAnchor = "none";

  const targetTop = (): number =>
    Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
  const startTop = window.scrollY;
  let latestTarget = targetTop();
  const initialDistance = latestTarget - startTop;
  let frame = 0;
  let cleaned = false;
  let cancelled = false;

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener("wheel", onUserIntent);
    window.removeEventListener("touchstart", onUserIntent);
    window.removeEventListener("keydown", onUserIntent);
    html.style.scrollBehavior = previousHtmlScrollBehavior;
    body.style.scrollBehavior = previousBodyScrollBehavior;
    html.style.overflowAnchor = previousHtmlOverflowAnchor;
    body.style.overflowAnchor = previousBodyOverflowAnchor;
    if (activeScrollCancel === cancel) activeScrollCancel = null;
  };

  const finish = (): void => {
    options.onFinish?.();
    cleanup();
  };

  const cancel = (): void => {
    cancelled = true;
    if (frame) window.cancelAnimationFrame(frame);
    cleanup();
  };

  function onUserIntent(): void {
    cancel();
  }

  activeScrollCancel = cancel;

  if (prefersReducedMotion() || Math.abs(initialDistance) < 2) {
    window.scrollTo({ top: latestTarget, left: 0, behavior: "auto" });
    finish();
    return;
  }

  window.addEventListener("wheel", onUserIntent, { passive: true, once: true });
  window.addEventListener("touchstart", onUserIntent, { passive: true, once: true });
  window.addEventListener("keydown", onUserIntent, { passive: true, once: true });

  let segmentStart = startTop;
  let segmentDuration = clamp(Math.abs(initialDistance) * 0.34, minDuration, maxDuration);
  // Zegar wirtualny: długa klatka (montowanie sekcji pod linią zgięcia) nie
  // może przeskoczyć animacji o setki pikseli - postęp rośnie najwyżej o
  // MAX_FRAME_STEP_MS na klatkę, więc ruch zostaje ciągły nawet przy zacięciu.
  let elapsed = 0;
  let lastNow = window.performance.now();

  const step = (now: number): void => {
    if (cancelled) return;
    elapsed += clamp(now - lastNow, 0, MAX_FRAME_STEP_MS);
    lastNow = now;
    const dynamicTarget = targetTop();
    if (Math.abs(dynamicTarget - latestTarget) > 0.5) {
      // Treść nad celem zmieniła wysokość: zaczynamy nowy odcinek z bieżącej
      // pozycji zamiast przeliczać stary - brak skoku pozycji strony.
      segmentStart = window.scrollY;
      latestTarget = dynamicTarget;
      segmentDuration = Math.max(minDuration * 0.6, segmentDuration - elapsed);
      elapsed = 0;
    }
    const progress = clamp(elapsed / segmentDuration, 0, 1);
    const nextTop = segmentStart + (latestTarget - segmentStart) * easeOutCubic(progress);
    window.scrollTo({ top: nextTop, left: 0, behavior: "auto" });
    if (progress < 1) {
      frame = window.requestAnimationFrame(step);
      return;
    }
    window.scrollTo({ top: latestTarget, left: 0, behavior: "auto" });
    finish();
  };

  frame = window.requestAnimationFrame(step);
}
