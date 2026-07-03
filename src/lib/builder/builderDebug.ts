// Module-singleton coordinator for the builder's visual debug overlay.
//
// Why this exists: the public BuilderRenderer is mounted several times on a
// single page (site header, page content, site footer, …). Previously each
// instance injected its own ~11 KB inline `<style>` of debug rules and rendered
// its own floating "Debug" toggle button - so the homepage shipped ~34 KB of
// duplicated dead CSS and stacked three toggle buttons on top of each other.
//
// This store hoists that concern out of the component:
//   - the *static* responsive/safety CSS now lives in the global stylesheet
//     (loaded once, cached) - not here,
//   - the *debug-only* CSS + toggle button are owned by exactly ONE instance
//     (the "primary", the first still-mounted renderer) and only mount on the
//     client when debug is actually toggled on / in dev,
//   - the debug flag is shared, so toggling it lights up every renderer's
//     `data-debug` attribute at once.
//
// SSR-safe: the server snapshot is always `false`/non-primary, so no debug
// markup is emitted during server rendering and there is no hydration mismatch.
import { useEffect, useId, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
/** Ordered list of live renderer tokens; the lowest is the overlay owner. */
const live: string[] = [];
/** Lazily resolved on first client read (URL `?debug=` / localStorage). */
let enabled: boolean | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Initial debug state: `?debug=1|0` wins, else the persisted toggle. */
export function readInitialDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("debug");
    if (q === "1") return true;
    if (q === "0") return false;
    return window.localStorage.getItem("builder-debug") === "1";
  } catch {
    return false;
  }
}

function getEnabled(): boolean {
  if (enabled === null) enabled = readInitialDebug();
  return enabled;
}

function getServerEnabled(): boolean {
  return false;
}

/** Flip the shared debug flag, persist it, and notify every renderer. */
export function toggleBuilderDebug(): void {
  enabled = !getEnabled();
  try {
    window.localStorage.setItem("builder-debug", enabled ? "1" : "0");
  } catch {
    /* ignore – private mode / disabled storage */
  }
  emit();
}

function register(token: string): () => void {
  live.push(token);
  live.sort();
  emit();
  return () => {
    const i = live.indexOf(token);
    if (i >= 0) live.splice(i, 1);
    emit();
  };
}

export interface BuilderDebugState {
  /** Shared on/off flag - drives every renderer's `data-debug` attribute. */
  debug: boolean;
  /** True for the single instance that owns the overlay (toggle + debug CSS). */
  isPrimary: boolean;
}

/**
 * Subscribe a BuilderRenderer instance to the shared debug state. Registration
 * happens after mount (client only), so the overlay-owning "primary" is chosen
 * deterministically and the toggle/debug CSS render exactly once per page.
 */
export function useBuilderDebug(): BuilderDebugState {
  const token = useId();
  const debug = useSyncExternalStore(subscribe, getEnabled, getServerEnabled);
  const isPrimary = useSyncExternalStore(subscribe, () => live[0] === token, getServerEnabled);
  useEffect(() => register(token), [token]);
  return { debug, isPrimary };
}

/** Test-only: reset module state between cases. */
export function __resetBuilderDebugForTests(): void {
  listeners.clear();
  live.length = 0;
  enabled = null;
}
