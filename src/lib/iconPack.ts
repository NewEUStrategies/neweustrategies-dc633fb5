// Tiny subscribable store for icon pack preference.
// Default is "lucide"; Font Awesome is a backup option.
import { useSyncExternalStore } from "react";

export type IconPack = "lucide" | "fontawesome";

const STORAGE_KEY = "nes.iconPack";
let current: IconPack = "lucide";

// Hydrate from localStorage on client (sync, before first render).
if (typeof window !== "undefined") {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "lucide" || stored === "fontawesome") current = stored;
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getIconPack(): IconPack {
  return current;
}

export function setIconPack(next: IconPack) {
  if (next === current) return;
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useIconPack(): IconPack {
  return useSyncExternalStore(subscribe, getIconPack, () => "lucide");
}
