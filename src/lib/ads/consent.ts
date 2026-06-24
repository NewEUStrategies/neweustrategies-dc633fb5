// Usercentrics-style consent (CMP-lite).
// - Kategorie: necessary / functional / analytics / marketing
// - Wersjonowanie zapisu (przy zmianie polityki bumpniesz CONSENT_VERSION i banner pokaże się ponownie).
// - localStorage jako fallback; gdy użytkownik zalogowany -> sync do profiles.prefs.consent.
// - Pełna kompatybilność wstecz: useMarketingConsent() pochodzi z marketing flag.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const CONSENT_VERSION = 2;
const STORAGE_KEY = "consent:v2";
const LEGACY_KEY = "consent:marketing";
const EVENT = "consent-change";
export const OPEN_PREFS_EVENT = "consent-open-preferences";

export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export interface ConsentState {
  version: number;
  ts: number;
  categories: Record<ConsentCategory, boolean>;
  /** Skąd pochodzi ostatnia decyzja - przydatne przy mergowaniu profil/local. */
  source?: "local" | "profile";
}

export const ALL_CATEGORIES: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export function defaultConsent(granted: boolean): ConsentState {
  return {
    version: CONSENT_VERSION,
    ts: Date.now(),
    categories: {
      necessary: true,
      functional: granted,
      analytics: granted,
      marketing: granted,
    },
  };
}

function safeParse(raw: string | null): ConsentState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentState>;
    if (!v || typeof v !== "object" || typeof v.version !== "number") return null;
    if (v.version !== CONSENT_VERSION) return null;
    const cats = v.categories ?? ({} as Record<string, boolean>);
    return {
      version: v.version,
      ts: typeof v.ts === "number" ? v.ts : Date.now(),
      categories: {
        necessary: true,
        functional: !!cats.functional,
        analytics: !!cats.analytics,
        marketing: !!cats.marketing,
      },
      source: v.source,
    };
  } catch {
    return null;
  }
}

function readLocal(): ConsentState | null {
  if (typeof window === "undefined") return null;
  const fresh = safeParse(window.localStorage.getItem(STORAGE_KEY));
  if (fresh) return fresh;
  // Migracja ze starego klucza
  const legacy = window.localStorage.getItem(LEGACY_KEY);
  if (legacy === "granted" || legacy === "denied") {
    const migrated = defaultConsent(legacy === "granted");
    writeLocal(migrated);
    window.localStorage.removeItem(LEGACY_KEY);
    return migrated;
  }
  return null;
}

function writeLocal(state: ConsentState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(EVENT));
}

export function getConsent(): ConsentState | null {
  return readLocal();
}

export function hasConsentDecision(): boolean {
  return !!readLocal();
}

export function setConsent(categories: Partial<Record<ConsentCategory, boolean>>) {
  const next: ConsentState = {
    version: CONSENT_VERSION,
    ts: Date.now(),
    categories: {
      necessary: true,
      functional: !!categories.functional,
      analytics: !!categories.analytics,
      marketing: !!categories.marketing,
    },
    source: "local",
  };
  writeLocal(next);
  // Best-effort sync do profilu - nie blokujemy UI
  void syncConsentToProfile(next);
  return next;
}

export function clearConsent() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function openConsentPreferences() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_PREFS_EVENT));
}

// -------------------- Profile sync --------------------

async function syncConsentToProfile(state: ConsentState): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("prefs")
      .eq("id", uid)
      .maybeSingle();
    const prevPrefs = (profile?.prefs ?? {}) as Record<string, unknown>;
    const nextPrefs = { ...prevPrefs, consent: { ...state, source: "profile" } };
    await supabase.from("profiles").update({ prefs: nextPrefs }).eq("id", uid);
  } catch {
    /* offline / brak uprawnień - nie blokujemy */
  }
}

/** Pobiera consent z profilu zalogowanego użytkownika i wpisuje do localStorage (jeśli świeższy lub brakuje). */
export async function hydrateConsentFromProfile(): Promise<ConsentState | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("prefs")
      .eq("id", uid)
      .maybeSingle();
    const prefs = (profile?.prefs ?? {}) as Record<string, unknown>;
    const remote = safeParse(JSON.stringify(prefs.consent ?? null));
    const local = readLocal();
    if (remote && (!local || remote.ts > local.ts)) {
      writeLocal({ ...remote, source: "profile" });
      return remote;
    }
    // Jeśli lokalny istnieje, a profil jest pusty - wypchnij do profilu
    if (!remote && local) {
      await syncConsentToProfile(local);
    }
    return local ?? remote;
  } catch {
    return null;
  }
}

// -------------------- React hooks --------------------

export function useConsent() {
  const [state, setState] = useState<ConsentState | null>(() => readLocal());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setState(readLocal());
    const sync = () => setState(readLocal());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    // Po zalogowaniu - pobierz z profilu
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") {
        void hydrateConsentFromProfile().then((r) => { if (r) setState(r); });
      }
    });
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      sub.subscription.unsubscribe();
    };
  }, []);

  const save = useCallback((cats: Partial<Record<ConsentCategory, boolean>>) => {
    const next = setConsent(cats);
    setState(next);
  }, []);

  const acceptAll = useCallback(() => save({ functional: true, analytics: true, marketing: true }), [save]);
  const rejectAll = useCallback(() => save({ functional: false, analytics: false, marketing: false }), [save]);

  return {
    state,
    /** decided=false dopóki klient się nie zhydratuje, żeby uniknąć błysku banera w SSR. */
    decided: mounted ? !!state : true,
    mounted,
    save,
    acceptAll,
    rejectAll,
    clear: clearConsent,
  };
}

// -------- Backward compat (marketing-only API) --------

export function getMarketingConsent(): boolean {
  return !!readLocal()?.categories.marketing;
}

export function setMarketingConsent(granted: boolean) {
  const cur = readLocal() ?? defaultConsent(false);
  setConsent({ ...cur.categories, marketing: granted });
}

export function clearMarketingConsent() {
  clearConsent();
}

export function hasMarketingDecision(): boolean {
  return hasConsentDecision();
}

export function useMarketingConsent() {
  const { state, decided, save } = useConsent();
  const granted = !!state?.categories.marketing;
  return {
    granted,
    decided,
    grant: () => save({ ...(state?.categories ?? {}), marketing: true }),
    deny: () => save({ ...(state?.categories ?? {}), marketing: false }),
  };
}
