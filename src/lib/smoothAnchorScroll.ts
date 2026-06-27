type ScrollCancel = () => void;

interface SmoothAnchorScrollOptions {
  offset?: number;
  minDuration?: number;
  maxDuration?: number;
  updateHash?: boolean;
  onFinish?: () => void;
}

let activeScrollCancel: ScrollCancel | null = null;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function getAnchorScrollOffset(defaultOffset = 80): number {
  if (typeof document === "undefined") return defaultOffset;
  const header = document.querySelector<HTMLElement>("[data-site-header], header[role='banner'], header");
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
  const nextState = currentState && typeof currentState === "object" && !Array.isArray(currentState)
    ? { ...(currentState as Record<string, unknown>), __hashScrollIntoViewOptions: false }
    : { __hashScrollIntoViewOptions: false };
  window.history.replaceState(nextState, "", nextUrl);
}

function disableRouterHashScrollForCurrentEntry(): void {
  if (typeof window === "undefined") return;
  replaceUrlWithHashScrollDisabled(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function cancelSmoothAnchorScroll(): void {
  activeScrollCancel?.();
  activeScrollCancel = null;
}

export function smoothScrollToAnchor(id: string, options: SmoothAnchorScrollOptions = {}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;

  cancelSmoothAnchorScroll();

  const minDuration = options.minDuration ?? 360;
  const maxDuration = options.maxDuration ?? 980;
  const updateHash = options.updateHash ?? true;
  const offset = options.offset ?? getAnchorScrollOffset();
  disableRouterHashScrollForCurrentEntry();
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

  const targetTop = (): number => Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
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
    if (updateHash) replaceHashPreservingRouterState(id);
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

  const duration = clamp(Math.abs(initialDistance) * 0.42, minDuration, maxDuration);
  const startTime = window.performance.now();

  const step = (now: number): void => {
    if (cancelled) return;
    const elapsed = now - startTime;
    const progress = clamp(elapsed / duration, 0, 1);
    const dynamicTarget = targetTop();
    if (Math.abs(dynamicTarget - latestTarget) > 0.5) latestTarget = dynamicTarget;
    const nextTop = startTop + (latestTarget - startTop) * easeInOutCubic(progress);
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