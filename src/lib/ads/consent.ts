// Usercentrics-style consent (CMP-lite).
// - Kategorie: necessary / functional / analytics / marketing.
// - Trwały zapis w localStorage + mirror w cookie (nes_cookie_consent), więc
//   decyzja przetrwa wyczyszczenie localStorage / przejście do subdomen SSR.
// - Zalogowany użytkownik = synchronizacja z profiles.prefs.consent.
// - Tryb podglądu (session-scoped) pozwala testować różne zgody bez czyszczenia
//   trwałych danych - override żyje w sessionStorage i nadpisuje state tylko
//   dla useEffectiveConsent()/useCategoryGranted().

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const CONSENT_VERSION = 2;
const STORAGE_KEY = "consent:v2";
const LEGACY_KEY = "consent:marketing";
const COOKIE_NAME = "nes_cookie_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 365 dni
const PREVIEW_KEY = "consent:preview";
const EVENT = "consent-change";
const PREVIEW_EVENT = "consent-preview-change";
export const OPEN_PREFS_EVENT = "consent-open-preferences";

export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export interface ConsentState {
  version: number;
  ts: number;
  categories: Record<ConsentCategory, boolean>;
  /** Skąd pochodzi ostatnia decyzja - przydatne przy mergowaniu profil/local. */
  source?: "local" | "profile";
}

function defaultConsent(granted: boolean): ConsentState {
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

// -------------------- Cookie helpers --------------------

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

// -------------------- Persistence --------------------

function readLocal(): ConsentState | null {
  if (typeof window === "undefined") return null;
  // 1) Preferuj świeże localStorage
  const fresh = safeParse(window.localStorage.getItem(STORAGE_KEY));
  if (fresh) return fresh;
  // 2) Fallback: cookie (przetrwa wyczyszczenie localStorage)
  const cookie = safeParse(readCookie(COOKIE_NAME));
  if (cookie) {
    // Re-hydrate localStorage z cookie, tak aby dalsze operacje były spójne.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cookie));
    } catch {
      /* private mode */
    }
    return cookie;
  }
  // 3) Migracja ze starego klucza marketingowego
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
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
  // Mirror do cookie - długoterminowy nośnik decyzji.
  writeCookie(COOKIE_NAME, JSON.stringify(state), COOKIE_MAX_AGE);
  window.dispatchEvent(new Event(EVENT));
}

function setConsent(categories: Partial<Record<ConsentCategory, boolean>>) {
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
  void syncConsentToProfile(next);
  return next;
}

function clearConsent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  deleteCookie(COOKIE_NAME);
  window.dispatchEvent(new Event(EVENT));
}

// -------------------- Profile sync --------------------

async function syncConsentToProfile(state: ConsentState): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const { data: ownRows } = await supabase.rpc("get_own_profile");
    const prevPrefs = (ownRows?.[0]?.prefs ?? {}) as Record<string, unknown>;
    const nextPrefs = { ...prevPrefs, consent: { ...state, source: "profile" } };
    await supabase.from("profiles").update({ prefs: nextPrefs }).eq("id", uid);
  } catch {
    /* offline / brak uprawnień */
  }
}

async function hydrateConsentFromProfile(): Promise<ConsentState | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const { data: ownRows } = await supabase.rpc("get_own_profile");
    const prefs = (ownRows?.[0]?.prefs ?? {}) as Record<string, unknown>;
    const remote = safeParse(JSON.stringify(prefs.consent ?? null));
    const local = readLocal();
    if (remote && (!local || remote.ts > local.ts)) {
      writeLocal({ ...remote, source: "profile" });
      return remote;
    }
    if (!remote && local) {
      await syncConsentToProfile(local);
    }
    return local ?? remote;
  } catch {
    return null;
  }
}

// -------------------- Preview mode --------------------

export interface ConsentPreview {
  categories: Record<ConsentCategory, boolean>;
}

function readPreview(): ConsentPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentPreview>;
    const cats = parsed.categories ?? ({} as Record<string, boolean>);
    return {
      categories: {
        necessary: true,
        functional: !!cats.functional,
        analytics: !!cats.analytics,
        marketing: !!cats.marketing,
      },
    };
  } catch {
    return null;
  }
}

export function setConsentPreview(cats: Partial<Record<ConsentCategory, boolean>>): void {
  if (typeof window === "undefined") return;
  const next: ConsentPreview = {
    categories: {
      necessary: true,
      functional: !!cats.functional,
      analytics: !!cats.analytics,
      marketing: !!cats.marketing,
    },
  };
  window.sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(PREVIEW_EVENT));
}

export function clearConsentPreview(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PREVIEW_KEY);
  window.dispatchEvent(new Event(PREVIEW_EVENT));
}

export function isConsentPreviewRequested(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return url.searchParams.get("consent-preview") === "1";
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
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") {
        void hydrateConsentFromProfile().then((r) => {
          if (r) setState(r);
        });
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

  const acceptAll = useCallback(
    () => save({ functional: true, analytics: true, marketing: true }),
    [save],
  );
  const rejectAll = useCallback(
    () => save({ functional: false, analytics: false, marketing: false }),
    [save],
  );

  return {
    state,
    decided: mounted ? !!state : true,
    mounted,
    save,
    acceptAll,
    rejectAll,
    clear: clearConsent,
  };
}

/**
 * Zwraca aktywny stan zgód: jeśli tryb podglądu jest ustawiony, override wygrywa;
 * inaczej zwraca trwały zapis. Skrypty analityczne/marketingowe podłączają się
 * właśnie do tej funkcji, żeby preview realnie wpływał na runtime.
 */
export function useEffectiveConsent(): {
  categories: Record<ConsentCategory, boolean>;
  preview: boolean;
  mounted: boolean;
} {
  const { state, mounted } = useConsent();
  const [preview, setPreview] = useState<ConsentPreview | null>(() => readPreview());
  useEffect(() => {
    const sync = () => setPreview(readPreview());
    window.addEventListener(PREVIEW_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREVIEW_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const categories = preview?.categories ??
    state?.categories ?? {
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    };

  return { categories, preview: !!preview, mounted };
}

export function useCategoryGranted(cat: ConsentCategory): boolean {
  const { categories } = useEffectiveConsent();
  return !!categories[cat];
}

// -------- Backward compat (marketing-only API) --------

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
