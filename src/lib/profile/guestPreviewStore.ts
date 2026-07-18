// Shared store for the "view as guest" preview on /profile. Toggle lives on
// the profile.index page but the layout (profile.tsx) also needs to react to
// hide the sidebar so the user sees the full public-facing composition.
//
// SSR-safe: initial value is always `false`; subscribers hydrate on the
// client. useSyncExternalStore keeps React 19 concurrent-safe.
import { useSyncExternalStore } from "react";

let previewAsGuest = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return previewAsGuest;
}

function getServerSnapshot(): boolean {
  return false;
}

export function setGuestPreview(next: boolean): void {
  if (previewAsGuest === next) return;
  previewAsGuest = next;
  for (const l of listeners) l();
}

export function useGuestPreview(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
