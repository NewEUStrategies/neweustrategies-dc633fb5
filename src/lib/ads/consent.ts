// Usercentrics-style consent (CMP-lite).
// - Kategorie: necessary / functional / analytics / marketing.
// - Trwały zapis w localStorage + mirror w cookie (nes_cookie_consent), więc
//   decyzja przetrwa wyczyszczenie localStorage / przejście do subdomen SSR.
// - Zalogowany użytkownik = synchronizacja z profiles.prefs.consent ORAZ
//   audytowany ślad każdej decyzji w rejestrze RODO user_consents/
//   user_consent_events (IP/UA/wersja/źródło/GPC) przez registryBridge -
//   unifikacja CMP z rejestrem zgód (audyt M15/M19).
// - Global Privacy Control: `Sec-GPC: 1` / `navigator.globalPrivacyControl`
//   KLAMRUJE kategorie analytics i marketing na "nie", niezależnie od tego, co
//   leży w localStorage. Klamra jest zdejmowana wyłącznie świadomym override'em
//   (jawna zgoda podjęta przy widocznej nocie o GPC - znacznik `gpcOverrideAt`).
//   Zasady i uzasadnienie prawne: `src/lib/consent/gpc.ts`.
// - Tryb podglądu (session-scoped) pozwala testować różne zgody bez czyszczenia
//   trwałych danych - override żyje w sessionStorage i nadpisuje state tylko
//   dla useEffectiveConsent()/useCategoryGranted(). GPC obowiązuje TAKŻE w
//   podglądzie: podglądem testuje się layout banera, nie obchodzi się opt-outu.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  clampCategoriesForGpc,
  isGpcClampedCategory,
  isGpcHonored,
  type GpcSignal,
  GPC_CLAMPED_CMP_CATEGORIES as GPC_CLAMPED_CATEGORIES,
  GPC_INACTIVE,
} from "@/lib/consent/gpc";
import { notifyGpcChange, readGpcSignal, subscribeGpc } from "@/lib/consent/gpcClient";
import type { ConsentDecisionSource } from "@/lib/consent/registryBridge";

const CONSENT_VERSION = 2;
const STORAGE_KEY = "consent:v2";
const LEGACY_KEY = "consent:marketing";
const COOKIE_NAME = "nes_cookie_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 365 dni
const PREVIEW_KEY = "consent:preview";
const EVENT = "consent-change";
const PREVIEW_EVENT = "consent-preview-change";
export const OPEN_PREFS_EVENT = "consent-open-preferences";

// Klik "ustawienia cookies" może paść, ZANIM leniwy chunk ConsentBanner
// (React.lazy w __root) zdąży się pobrać i zarejestrować listener
// OPEN_PREFS_EVENT - jednorazowe zdarzenie okienne przepadłoby bez śladu.
// Dyspozytor odkłada więc żądanie w stanie modułu (ten plik jest w chunku
// wejściowym), a baner konsumuje je przy montażu.
let pendingOpenPrefs = false;

/**
 * Otwórz panel preferencji zgód. Bezpieczne także PRZED zamontowaniem baneru:
 * żądanie czeka w stanie modułu i baner odtworzy je zaraz po montażu.
 */
export function requestConsentPreferences(): void {
  if (typeof window === "undefined") return;
  pendingOpenPrefs = true;
  window.dispatchEvent(new CustomEvent(OPEN_PREFS_EVENT));
}

/** Konsumpcja odłożonego żądania otwarcia preferencji (woła ConsentBanner). */
export function consumeOpenPrefsRequest(): boolean {
  const pending = pendingOpenPrefs;
  pendingOpenPrefs = false;
  return pending;
}

export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export interface ConsentState {
  version: number;
  ts: number;
  categories: Record<ConsentCategory, boolean>;
  /** Skąd pochodzi ostatnia decyzja - przydatne przy mergowaniu profil/local. */
  source?: "local" | "profile";
  /**
   * Znacznik ŚWIADOMEGO override'u sygnału GPC: ustawiany wyłącznie wtedy, gdy
   * użytkownik jawnie włączył klamrowaną kategorię przy AKTYWNYM sygnale (a
   * więc przy widocznej nocie o GPC w banerze). Brak znacznika = GPC wygrywa,
   * także nad zgodą zapisaną przed pojawieniem się sygnału.
   */
  gpcOverrideAt?: number;
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
      // Znacznik override'u musi PRZEŻYĆ round-trip przez localStorage/cookie/
      // profil - inaczej świadoma zgoda użytkownika z GPC znikałaby przy każdym
      // przeładowaniu i baner wracałby w nieskończoność.
      ...(typeof v.gpcOverrideAt === "number" && Number.isFinite(v.gpcOverrideAt)
        ? { gpcOverrideAt: v.gpcOverrideAt }
        : {}),
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
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
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

/**
 * Czy TA decyzja jest świadomym override'em sygnału GPC: użytkownik włącza
 * którąkolwiek klamrowaną kategorię, mając aktywny sygnał (a więc widząc notę
 * GPC w banerze - to ta sama flaga steruje notą i klamrą).
 */
function decisionOverridesGpc(
  categories: Partial<Record<ConsentCategory, boolean>>,
  signal: GpcSignal,
): boolean {
  if (!signal.active) return false;
  return GPC_CLAMPED_CATEGORIES.some((cat) => !!categories[cat]);
}

function setConsent(
  categories: Partial<Record<ConsentCategory, boolean>>,
  decisionSource: ConsentDecisionSource = "cmp_banner",
) {
  const prev = readLocal();
  const signal = readGpcSignal();
  // INWARIANT znacznika override'u (od niego zależy `isGpcOverrideValid`):
  // znacznik istnieje TYLKO wtedy, gdy OSTATNIA decyzja była świadomym
  // override'em. Każda inna decyzja go zdejmuje - także podjęta przy wyłączonym
  // sygnale, bo inaczej ponowne włączenie GPC trafiałoby na nieaktualną zgodę
  // i klamra nigdy by nie wróciła.
  const gpcOverrideAt = decisionOverridesGpc(categories, signal) ? Date.now() : undefined;
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
    ...(gpcOverrideAt ? { gpcOverrideAt } : {}),
  };
  writeLocal(next);
  void syncConsentToProfile(next);
  // Zmiana ważności override'u przestawia klamrę dla całego runtime - rozgłoś ją
  // tym samym kanałem, którym idą zmiany samego sygnału.
  if (!!prev?.gpcOverrideAt !== !!gpcOverrideAt) notifyGpcChange();
  // Audytowany ślad decyzji (tylko zalogowani, tylko zmienione kategorie).
  // Dynamiczny import: most nie obciąża chunka wejściowego, a błąd sieci
  // nigdy nie blokuje samej decyzji cookie.
  void import("@/lib/consent/registryBridge")
    .then((m) => m.syncCmpDecisionToRegistry(prev, next, decisionSource, signal.active))
    .catch(() => {
      /* offline / chunk load error */
    });
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
    // getSession() czyta lokalnie z pamięci klienta Supabase (bez requestu do
    // Auth API) - te same tokeny, na których polega AuthProvider z __root.tsx.
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
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
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id;
    if (!uid) return null;
    const { data: ownRows } = await supabase.rpc("get_own_profile");
    const prefs = (ownRows?.[0]?.prefs ?? {}) as Record<string, unknown>;
    const remote = safeParse(JSON.stringify(prefs.consent ?? null));
    const local = readLocal();
    let resolved: ConsentState | null;
    if (remote && (!local || remote.ts > local.ts)) {
      writeLocal({ ...remote, source: "profile" });
      resolved = remote;
    } else {
      if (!remote && local) await syncConsentToProfile(local);
      resolved = local ?? remote;
    }
    if (resolved) {
      // Backfill rejestru RODO sterowany BRAKIEM wpisów cookies_* w rejestrze
      // (nie brakiem prefs.consent w profilu): obejmuje zarówno decyzję podjętą
      // anonimowo, która właśnie zyskuje podmiot, jak i konta sprzed unifikacji,
      // które mają prefs.consent, ale zero śladu w audycie. Deduplikacja
      // (wiele instancji useConsent na ten sam event auth) i kolejkowanie są
      // wewnątrz mostu.
      const state = resolved;
      const signal = readGpcSignal();
      void import("@/lib/consent/registryBridge")
        .then(async (m) => {
          await m.backfillRegistryOnLogin(state, uid, signal.active);
          // Sygnał GPC jest sprzeciwem (art. 21 RODO) i wycofaniem zgody
          // (art. 7 ust. 3) - musi zostawić ślad w rejestrze, a nie tylko
          // zaklamrować runtime. Dopisujemy go PO backfillu, żeby wycofanie
          // było w audycie chronologicznie po stanie, który wycofuje.
          if (isGpcHonored(signal, state)) await m.syncGpcSignalToRegistry(uid);
        })
        .catch(() => {
          /* best-effort */
        });
    }
    return resolved;
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

/**
 * Sygnał GPC jako stan Reacta. SSR zwraca `GPC_INACTIVE` (serwer nie zna
 * `navigator`, a klamra i tak nie zmienia treści dokumentu - patrz
 * `gpc.server.ts`), klient dociąga prawdę przy pierwszym efekcie, przed
 * jakimkolwiek wstrzyknięciem skryptu (ConsentScriptInjector też działa z
 * efektu). Zero migotania, zero rozjazdu hydratacji.
 */
export function useGpcSignal(): GpcSignal {
  const [signal, setSignal] = useState<GpcSignal>(GPC_INACTIVE);
  useEffect(() => {
    const sync = () => setSignal(readGpcSignal());
    sync();
    return subscribeGpc(sync);
  }, []);
  return signal;
}

/**
 * Czy sygnał GPC jest REALNIE honorowany w tej karcie (aktywny i bez świadomego
 * override'u). Jedno źródło prawdy dla wszystkiego, co bramkuje: klamry
 * kategorii CMP, klamry kluczy rejestru (`useConsents`) i not w UI.
 */
export function useGpcHonored(): boolean {
  const gpc = useGpcSignal();
  const [state, setState] = useState<ConsentState | null>(null);
  useEffect(() => {
    const sync = () => setState(readLocal());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return isGpcHonored(gpc, state);
}

/** Wariant non-hook `useGpcHonored` - dla kodu spoza drzewa Reacta. */
export function isGpcCurrentlyHonored(): boolean {
  if (typeof window === "undefined") return false;
  return isGpcHonored(readGpcSignal(), readLocal());
}

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

  const save = useCallback(
    (
      cats: Partial<Record<ConsentCategory, boolean>>,
      decisionSource: ConsentDecisionSource = "cmp_banner",
    ) => {
      const next = setConsent(cats, decisionSource);
      setState(next);
    },
    [],
  );

  const acceptAll = useCallback(
    (decisionSource: ConsentDecisionSource = "cmp_banner") =>
      save({ functional: true, analytics: true, marketing: true }, decisionSource),
    [save],
  );
  const rejectAll = useCallback(
    (decisionSource: ConsentDecisionSource = "cmp_banner") =>
      save({ functional: false, analytics: false, marketing: false }, decisionSource),
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
 * inaczej zwraca trwały zapis. Na wynik nakładana jest klamra GPC - skrypty
 * analityczne/marketingowe podłączają się właśnie do tej funkcji, więc podgląd
 * realnie wpływa na runtime, a sygnał opt-outu nie da się nim obejść.
 */
export function useEffectiveConsent(): {
  categories: Record<ConsentCategory, boolean>;
  preview: boolean;
  mounted: boolean;
  /** Sygnał GPC tej karty (aktywny/nieaktywny + nośnik). */
  gpc: GpcSignal;
  /** Czy sygnał jest realnie honorowany (aktywny i bez świadomego override'u). */
  gpcHonored: boolean;
} {
  const { state, mounted } = useConsent();
  const gpc = useGpcSignal();
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

  const gpcHonored = isGpcHonored(gpc, state);
  // useMemo, żeby tożsamość obiektu kategorii nie zmieniała się co render -
  // konsumenci (ConsentScriptInjector) trzymają go w zależnościach efektów.
  const categories = useMemo(() => {
    const raw = preview?.categories ??
      state?.categories ?? {
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
      };
    return clampCategoriesForGpc(raw, gpcHonored);
  }, [preview?.categories, state?.categories, gpcHonored]);

  return { categories, preview: !!preview, mounted, gpc, gpcHonored };
}

export function useCategoryGranted(cat: ConsentCategory): boolean {
  const { categories } = useEffectiveConsent();
  return !!categories[cat];
}

/**
 * Non-hook, poza-Reactowy odczyt aktywnej zgody dla danej kategorii.
 * Uwzględnia tryb podglądu (sessionStorage), trwały zapis (localStorage) ORAZ
 * klamrę GPC. Używany m.in. przez silnik analityki
 * (`src/lib/analytics/track.ts`), gdzie beacony wysyłane są z event-handlerów
 * spoza drzewa Reacta - dlatego klamra MUSI być tu, a nie tylko w hookach:
 * inaczej bramkowanie UI i bramkowanie beaconów rozjechałyby się.
 */
export function hasCategoryConsent(cat: ConsentCategory): boolean {
  if (cat === "necessary") return true;
  if (typeof window === "undefined") return false;
  const state = readLocal();
  if (isGpcClampedCategory(cat) && isGpcHonored(readGpcSignal(), state)) return false;
  const preview = readPreview();
  if (preview) return !!preview.categories[cat];
  return !!state?.categories?.[cat];
}

export function hasAnalyticsConsent(): boolean {
  return hasCategoryConsent("analytics");
}

// -------- Backward compat (marketing-only API) --------

export function useMarketingConsent() {
  const { state, decided, save } = useConsent();
  const gpc = useGpcSignal();
  // Stare API też przechodzi przez klamrę - inaczej powierzchnie, które nadal go
  // używają, byłyby jedyną furtką obchodzącą sygnał opt-outu.
  const granted = !!state?.categories.marketing && !isGpcHonored(gpc, state);
  return {
    granted,
    decided,
    grant: () => save({ ...(state?.categories ?? {}), marketing: true }),
    deny: () => save({ ...(state?.categories ?? {}), marketing: false }),
  };
}
