// Ścieżka ZAPISU i TRWAŁOŚCI decyzji o zgodach (CMP-lite `src/lib/ads/consent.ts`).
// Ryzykiem nie jest tu render, a to, CO ZOSTAJE ZAPISANE i co z tego zapisu
// odczyta następny runtime: znacznik świadomego override'u sygnału GPC, mirror
// w cookie, migracja starego klucza i odporność na uszkodzone/cudze dane.
// Warstwa RODO: każdy defekt na tej ścieżce to albo zgoda, której nikt nie
// zbierał, albo opt-out, który przestał obowiązywać.
//
// CO TEN PLIK DOWODZI.
//   1. INWARIANT `gpcOverrideAt`: znacznik istnieje TYLKO wtedy, gdy OSTATNIA
//      decyzja była świadomym override'em przy aktywnym sygnale; każda inna
//      decyzja go ZDEJMUJE - także podjęta przy WYŁĄCZONYM sygnale. Obiekt
//      `next` w setConsent budowany jest od zera, więc `prev.gpcOverrideAt`
//      nigdy nie jest przepisywany - to przechodzi przez tsc i przegląd
//      (jednego pola po prostu nie ma), a łapie to wyłącznie test czytający
//      zapisany JSON po dwóch decyzjach z rzędu.
//   2. Rozgłoszenie zmiany klamry: `consent-gpc-change` leci TYLKO przy zmianie
//      WAŻNOŚCI override'u, a nie przy każdym zapisie - asercja na LICZNIKU
//      zdarzeń, bo "zostało wywołane" przepuściłoby zdarzenie na każdy klik.
//   3. Klamra GPC na powierzchniach HOOKOWYCH (useEffectiveConsent,
//      useCategoryGranted, useGpcHonored, useMarketingConsent): analytics i
//      marketing na "nie" niezależnie od localStorage, także dla zgody zapisanej
//      PRZED pojawieniem się sygnału i także w trybie podglądu.
//   4. Dwa nośniki: localStorage `consent:v2` i cookie `nes_cookie_consent` mają
//      tę samą treść, a wyczyszczenie localStorage nie gubi decyzji - odczyt z
//      cookie RE-HYDRATUJE localStorage. Bez re-hydratacji następna decyzja
//      liczyłaby `prev = null` i wysłała do audytu fałszywą "pierwszą decyzję".
//   5. Migracja klucza `consent:marketing` ROZSZERZA zakres zgody: legacy
//      "granted" (tylko marketing) włącza także functional i analytics. Test
//      fiksuje obecne zachowanie i nazywa ryzyko (art. 7 RODO).
//   6. safeParse odsiewa obcą wersję, śmieci, null, liczbę i tablicę BEZ
//      wyjątku, wymusza `necessary: true` i koercję do boolean - ale pole
//      `source` przechodzi BEZ WALIDACJI, a nieliczbowy `ts` jest cicho
//      podmieniany na `Date.now()` (obie krawędzie zafiksowane jawnie).
//   7. Klucze prototypowe w cudzym zapisie NIE włączają analytics ani marketing
//      (hipoteza defektu OBALONA - test regresyjny broni odczytu po literałach)
//      oraz utajona krawędź: `hasCategoryConsent("constructor")` zwraca true.
//   8. Odporność zapisu: rzucający localStorage nie gubi decyzji (cookie leci,
//      zdarzenie leci), a awaria dynamicznego importu mostu rejestru nie
//      unieważnia decyzji i nie generuje nieobsłużonego odrzucenia.
//   9. DEFEKTY (it.fails): H-D1 - `readLocal` czyta localStorage BEZ try/catch,
//      więc rzucający nośnik wywraca odczyt zgód (mimo poprawnego cookie);
//      H-D2 - `setConsentPreview`/`clearConsentPreview` nie chronią się przed
//      rzucającym sessionStorage. Przy każdym `it.fails` stoi SĄSIEDNI zwykły
//      `it` opisujący STAN FAKTYCZNY - po naprawie produkcji usuwa się OBA.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `src/lib/consent/__tests__/gpcCmpClamp.test.ts` - klamra na ODCZYCIE
//     non-hook (hasCategoryConsent/hasAnalyticsConsent/isGpcCurrentlyHonored),
//     podgląd kontra sygnał, `gpcOverrideAt: 0` fail-closed, cookie `nes_gpc`
//     jako nośnik. Tutaj celujemy w ZAPIS znacznika i w HOOKI.
//   * `src/lib/consent/__tests__/gpc.test.ts` - czysty rdzeń GPC (parser,
//     clampCategoriesForGpc, isGpcOverrideValid/isGpcHonored).
//   * `src/lib/consent/__tests__/registryBridgeSync.test.ts` - cała logika
//     mostu (diff, metadane, kolejka, backfill). Stąd asertujemy wyłącznie
//     FAKT wywołania i PRZEKAZANE ARGUMENTY.
//   * synchronizacja z profilem i hydratacja z `onAuthStateChange` - osobny
//     plik warstwy profilu; tutaj sesja jest zawsze pusta, więc zapis do
//     `profiles` nigdy nie startuje.
//   * dyspozytor `OPEN_PREFS_EVENT` - `src/routes/__tests__/profileSurfaceRoutes.test.tsx`.
//
// Atrapy: klient Supabase MUSI być podmieniony - realny moduł woła
// `resolveSupabasePublicConfig()` na poziomie modułu i rzuca bez zmiennych
// środowiskowych, więc bez atrapy `consent.ts` się nie zaimportuje. Most
// rejestru jest podmieniony, bo realny wciąga server-fn (`consents.functions`)
// - a jego logika ma własny, pełny test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseAuthStub, supabaseFromStub, supabaseRpcStub } from "@/test/supabase";
import type { ConsentCategory } from "@/lib/ads/consent";

// Stałe modułu consent.ts są PRYWATNE (nie da się ich zaimportować) - stąd
// literały. Rozjazd literału z produkcją jest tu widoczny natychmiast: test
// przestaje widzieć zapis.
const STORAGE_KEY = "consent:v2";
const LEGACY_KEY = "consent:marketing";
const COOKIE_NAME = "nes_cookie_consent";
const PREVIEW_KEY = "consent:preview";
const EVENT = "consent-change";
const GPC_EVENT = "consent-gpc-change";
const GPC_COOKIE = "nes_gpc";

type AuthStub = ReturnType<typeof supabaseAuthStub>;
type RpcStub = ReturnType<typeof supabaseRpcStub>;
type FromStub = ReturnType<typeof supabaseFromStub>;

interface SyncCall {
  readonly prev: { ts: number } | null;
  readonly next: { ts: number; categories: Record<string, boolean>; gpcOverrideAt?: number };
  readonly source: string;
  readonly gpcActive: boolean;
}

const h = vi.hoisted(() => ({
  auth: null as unknown as AuthStub,
  rpc: null as unknown as RpcStub,
  from: null as unknown as FromStub,
  authCbs: [] as Array<(event: string) => void>,
  /** Symulacja awarii transportu audytu: zadanie mostu ODRZUCA. */
  bridgeRejects: false,
  syncCalls: [] as SyncCall[],
}));

const BRIDGE_PATH = "@/lib/consent/registryBridge";

/** Most rejestru ze spyami - obserwuje FAKT i ARGUMENTY, nie powtarza jego logiki. */
function bridgeModule() {
  return {
    syncCmpDecisionToRegistry: (
      prev: SyncCall["prev"],
      next: SyncCall["next"],
      source: string,
      gpcActive: boolean,
    ) => {
      h.syncCalls.push({ prev, next, source, gpcActive });
      return h.bridgeRejects ? Promise.reject(new Error("rejestr niedostępny")) : Promise.resolve();
    },
    backfillRegistryOnLogin: () => Promise.resolve(),
    syncGpcSignalToRegistry: () => Promise.resolve(),
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => h.auth.getSession(),
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authCbs.push(cb);
        // Bez tego kształtu cleanup efektu w useConsent rzuci przy odmontowaniu.
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.rpc(name, args),
    from: (table: string) => h.from.from(table),
  },
}));

vi.mock("@/lib/consent/registryBridge", () => bridgeModule());

// -------------------- Narzędzia sterujące środowiskiem --------------------

/** Sygnał GPC z nośnika `navigator` - czytany przy KAŻDYM wywołaniu, bez cache. */
function setNavigatorGpc(active: boolean | undefined): void {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    get: () => active,
  });
}

function readTestCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Decyzja odczytana z nośnika cookie. Puste ciasteczko to BRAK decyzji:
 * `deleteCookie` ustawia `max-age=0`, co przeglądarka realizuje jako usunięcie,
 * a happy-dom - jako pustą wartość. Asercja idzie więc po TREŚCI nośnika.
 */
function cookieDecision(): string | null {
  const raw = readTestCookie(COOKIE_NAME);
  return raw === null || raw === "" ? null : raw;
}

function dropCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0`;
}

interface StoredState {
  version: number;
  ts: number;
  categories: Record<string, boolean>;
  source?: string;
  gpcOverrideAt?: number;
}

function storedState(): StoredState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredState);
}

/** Zapis "z poprzedniego runtime" - bez przechodzenia przez setConsent. */
function persist(
  cats: Partial<Record<ConsentCategory, boolean>>,
  extra: Record<string, unknown> = {},
) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: 1_735_689_600_000,
      categories: {
        necessary: true,
        functional: !!cats.functional,
        analytics: !!cats.analytics,
        marketing: !!cats.marketing,
      },
      ...extra,
    }),
  );
}

function boom(): never {
  throw new Error("SecurityError");
}

/**
 * Atrapa niedostępnego nośnika. Dwa realne warianty przeglądarki:
 *   "writes" - odczyt działa, ZAPIS jest zablokowany (tryb prywatny, quota);
 *   "all"    - blokada site data, gdzie rzuca KAŻDY dostęp.
 */
function throwingStorage(mode: "writes" | "all") {
  return {
    getItem: mode === "all" ? boom : () => null,
    setItem: boom,
    removeItem: boom,
    clear: boom,
  };
}

function withThrowingStorage(
  which: "localStorage" | "sessionStorage",
  mode: "writes" | "all",
  fn: () => void,
): void {
  const original = which === "localStorage" ? window.localStorage : window.sessionStorage;
  Object.defineProperty(window, which, { configurable: true, value: throwingStorage(mode) });
  try {
    fn();
  } finally {
    Object.defineProperty(window, which, { configurable: true, value: original });
  }
}

/** Licznik zdarzeń okna - jedyna asercja, która odróżnia "raz" od "za każdym razem". */
function countEvents(name: string): { get: () => number; stop: () => void } {
  let n = 0;
  const listener = () => {
    n += 1;
  };
  window.addEventListener(name, listener);
  return { get: () => n, stop: () => window.removeEventListener(name, listener) };
}

/**
 * Świeży moduł na każdy test: zeruje stan modułowy (`pendingOpenPrefs`) i
 * gwarantuje, że dynamiczny import mostu ponownie przejdzie przez fabrykę
 * mocka - bez tego przełącznik `bridgeThrows` byłby martwy.
 */
async function loadConsent() {
  vi.resetModules();
  return import("@/lib/ads/consent");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Cookies w happy-dom nie znikają po cleanup() - usuwamy jawnie.
  dropCookie(COOKIE_NAME);
  dropCookie(GPC_COOKIE);
  setNavigatorGpc(undefined);
  window.history.replaceState(null, "", "/");
  h.auth = supabaseAuthStub(null);
  h.rpc = supabaseRpcStub();
  h.from = supabaseFromStub();
  h.authCbs = [];
  h.bridgeRejects = false;
  h.syncCalls = [];
});

afterEach(() => {
  vi.resetModules();
});

// =====================================================================
describe("zapis decyzji: nośniki, rozgłoszenie i wycofanie", () => {
  it("decyzja trafia do DWÓCH nośników o identycznej treści (localStorage + cookie)", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.save({ functional: true, analytics: true, marketing: false });
    });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    // Cookie to długoterminowy nośnik decyzji - jego treść MUSI być tożsama z
    // localStorage, inaczej po wyczyszczeniu localStorage użytkownik dostałby
    // inną zgodę niż ta, którą kliknął.
    expect(cookieDecision()).toBe(raw);
    expect(storedState()?.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    });
    // `source: "local"` odróżnia decyzję z tej karty od zgody dociągniętej z profilu.
    expect(storedState()?.source).toBe("local");
  });

  it("necessary jest zapisane jako true nawet wtedy, gdy wywołujący próbuje je wyłączyć", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.save({ necessary: false, functional: false } as Partial<
        Record<ConsentCategory, boolean>
      >);
    });

    expect(storedState()?.categories.necessary).toBe(true);
  });

  it("rejectAll zapisuje DECYZJĘ odmowną, a nie brak decyzji (baner nie wraca)", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.rejectAll();
    });

    expect(r.result.current.state).not.toBeNull();
    expect(r.result.current.decided).toBe(true);
    expect(storedState()?.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it("każdy zapis rozgłasza dokładnie jedno 'consent-change' (odświeżenie wszystkich powierzchni)", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());
    const changes = countEvents(EVENT);
    try {
      await act(async () => {
        r.result.current.acceptAll();
      });
      expect(changes.get()).toBe(1);
      await act(async () => {
        r.result.current.rejectAll();
      });
      expect(changes.get()).toBe(2);
    } finally {
      changes.stop();
    }
  });

  it("clear() usuwa OBA nośniki i cofa hook do stanu 'brak decyzji'", async () => {
    const { useConsent } = await loadConsent();
    window.localStorage.setItem(LEGACY_KEY, "granted");
    const r = renderHookWithQueryClient(() => useConsent());
    await act(async () => {
      r.result.current.acceptAll();
    });
    expect(storedState()).not.toBeNull();

    await act(async () => {
      r.result.current.clear();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Stary klucz też schodzi - inaczej migracja natychmiast wskrzesiłaby zgodę.
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(cookieDecision()).toBeNull();
    expect(r.result.current.state).toBeNull();
    expect(r.result.current.decided).toBe(false);
  });

  it("clear() NIE czyści trybu podglądu - podgląd jest session-scoped i celowo niezależny", async () => {
    const { useConsent, useEffectiveConsent, setConsentPreview } = await loadConsent();
    const r = renderHookWithQueryClient(() => ({
      consent: useConsent(),
      effective: useEffectiveConsent(),
    }));

    await act(async () => {
      setConsentPreview({ analytics: true });
    });
    await act(async () => {
      r.result.current.consent.acceptAll();
    });
    await act(async () => {
      r.result.current.consent.clear();
    });

    expect(r.result.current.consent.state).toBeNull();
    // Decyzja produktowa do zafiksowania: podgląd przeżywa wyczyszczenie zgód.
    expect(r.result.current.effective.preview).toBe(true);
    expect(r.result.current.effective.categories.analytics).toBe(true);
  });

  it("TRYB PRYWATNY: rzucający localStorage.setItem nie gubi decyzji - cookie i zdarzenie i tak lecą", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());
    const changes = countEvents(EVENT);
    try {
      withThrowingStorage("localStorage", "writes", () => {
        expect(() =>
          r.result.current.save({ functional: true, analytics: true, marketing: false }),
        ).not.toThrow();
      });
      const cookie = cookieDecision();
      expect(cookie).not.toBeNull();
      expect(JSON.parse(cookie as string).categories.analytics).toBe(true);
      expect(changes.get()).toBe(1);
    } finally {
      changes.stop();
    }
  });
});

// =====================================================================
describe("INWARIANT gpcOverrideAt: znacznik opisuje TYLKO ostatnią decyzję", () => {
  it("acceptAll przy aktywnym sygnale ZAPISUJE znacznik override'u i zdejmuje klamrę w tym samym runtime", async () => {
    setNavigatorGpc(true);
    const { useConsent, isGpcCurrentlyHonored, hasCategoryConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.acceptAll();
    });

    const at = storedState()?.gpcOverrideAt;
    // Znacznik musi być TRWAŁY, nie tylko liczony w pamięci - inaczej po
    // przeładowaniu klamra wróciłaby i baner pytałby w nieskończoność.
    expect(typeof at).toBe("number");
    expect(at as number).toBeGreaterThan(0);
    expect(isGpcCurrentlyHonored()).toBe(false);
    expect(hasCategoryConsent("analytics")).toBe(true);
  });

  it("rejectAll przy aktywnym sygnale NIE tworzy znacznika - odmowa nigdy nie jest override'em", async () => {
    setNavigatorGpc(true);
    const { useConsent, isGpcCurrentlyHonored } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.rejectAll();
    });

    const state = storedState() as StoredState;
    expect(Object.hasOwn(state, "gpcOverrideAt")).toBe(false);
    expect(isGpcCurrentlyHonored()).toBe(true);
  });

  it("włączenie SAMEJ kategorii functional przy aktywnym sygnale NIE tworzy znacznika (functional jest poza klamrą)", async () => {
    setNavigatorGpc(true);
    const { useConsent, isGpcCurrentlyHonored, hasCategoryConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.save({ functional: true, analytics: false, marketing: false });
    });

    expect(Object.hasOwn(storedState() as StoredState, "gpcOverrideAt")).toBe(false);
    expect(isGpcCurrentlyHonored()).toBe(true);
    expect(hasCategoryConsent("functional")).toBe(true);
  });

  it("KAŻDA kolejna decyzja zdejmuje stary znacznik - także podjęta przy WYŁĄCZONYM sygnale", async () => {
    setNavigatorGpc(true);
    const { useConsent, isGpcCurrentlyHonored } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    // Krok 1: świadomy override przy aktywnym sygnale.
    await act(async () => {
      r.result.current.acceptAll();
    });
    expect(typeof storedState()?.gpcOverrideAt).toBe("number");

    // Krok 2: sygnał zniknął (rozszerzenie wyłączone), użytkownik zapisuje ponownie.
    setNavigatorGpc(undefined);
    await act(async () => {
      r.result.current.save({ functional: true, analytics: true, marketing: true });
    });
    expect(Object.hasOwn(storedState() as StoredState, "gpcOverrideAt")).toBe(false);

    // Krok 3: sygnał wraca - i klamra MUSI wrócić z nim, bo nowa decyzja
    // powstała bez noty o GPC. To dokładnie ten scenariusz, przed którym broni
    // komentarz w setConsent.
    setNavigatorGpc(true);
    expect(isGpcCurrentlyHonored()).toBe(true);
  });

  it("produkcyjna ścieżka restoreGpc z banera (analytics/marketing na 'nie') usuwa znacznik i rozgłasza JEDNO 'consent-gpc-change'", async () => {
    setNavigatorGpc(true);
    const { useConsent, isGpcCurrentlyHonored } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());
    await act(async () => {
      r.result.current.acceptAll();
    });

    const gpcEvents = countEvents(GPC_EVENT);
    try {
      // ConsentBanner.restoreGpc(): zostaw functional, oddaj sygnałowi resztę.
      await act(async () => {
        r.result.current.save({ functional: true, analytics: false, marketing: false });
      });
      expect(gpcEvents.get()).toBe(1);
    } finally {
      gpcEvents.stop();
    }
    expect(Object.hasOwn(storedState() as StoredState, "gpcOverrideAt")).toBe(false);
    expect(isGpcCurrentlyHonored()).toBe(true);
  });

  it("'consent-gpc-change' leci TYLKO przy zmianie ważności override'u, nie przy każdym zapisie", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());
    const gpcEvents = countEvents(GPC_EVENT);
    try {
      // (1) Bez sygnału: dwa zapisy z rzędu nie ruszają klamry.
      await act(async () => {
        r.result.current.acceptAll();
      });
      await act(async () => {
        r.result.current.rejectAll();
      });
      expect(gpcEvents.get()).toBe(0);

      // (2) Sygnał + override: klamra się przestawia -> jedno zdarzenie.
      setNavigatorGpc(true);
      await act(async () => {
        r.result.current.acceptAll();
      });
      expect(gpcEvents.get()).toBe(1);

      // (3) Drugi override: znacznik był i jest -> BEZ zdarzenia.
      await act(async () => {
        r.result.current.acceptAll();
      });
      expect(gpcEvents.get()).toBe(1);
    } finally {
      gpcEvents.stop();
    }
  });

  it("useMarketingConsent().grant() przy aktywnym sygnale MINTUJE override - bez żadnego dowodu, że użytkownik widział notę o GPC", async () => {
    // Dokumentacja kontraktu (H-D4), nie defekt do naprawy w tym pliku:
    // `gpc.ts` deklaruje, że obecność znacznika DOWODZI pokazania noty, a
    // setConsent sprawdza wyłącznie aktywność sygnału i wartości kategorii.
    // Dziś jedynym konsumentem tego API jest AdSlot (czyta tylko `granted`),
    // więc szkoda jest utajona - ale każda przyszła powierzchnia "włącz
    // reklamy" zdejmie sygnał opt-outu bez noty.
    setNavigatorGpc(true);
    const { useMarketingConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useMarketingConsent());
    expect(r.result.current.granted).toBe(false);

    await act(async () => {
      r.result.current.grant();
    });

    expect(typeof storedState()?.gpcOverrideAt).toBe("number");
    expect(r.result.current.granted).toBe(true);
  });

  it("useMarketingConsent().deny() zdejmuje znacznik i oddaje sygnał do honorowania", async () => {
    setNavigatorGpc(true);
    const { useMarketingConsent, isGpcCurrentlyHonored } = await loadConsent();
    const r = renderHookWithQueryClient(() => useMarketingConsent());
    await act(async () => {
      r.result.current.grant();
    });

    await act(async () => {
      r.result.current.deny();
    });

    expect(Object.hasOwn(storedState() as StoredState, "gpcOverrideAt")).toBe(false);
    expect(isGpcCurrentlyHonored()).toBe(true);
    expect(r.result.current.granted).toBe(false);
  });

  it("deny() BEZ wcześniejszej decyzji zapisuje pełną odmowę, a nie pusty obiekt kategorii", async () => {
    const { useMarketingConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useMarketingConsent());
    expect(r.result.current.decided).toBe(false);

    await act(async () => {
      r.result.current.deny();
    });

    // `state?.categories ?? {}` schodzi na pusty obiekt, a setConsent koeruje
    // brakujące pola do false - decyzja odmowna jest KOMPLETNA.
    expect(storedState()?.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
    expect(r.result.current.decided).toBe(true);
  });

  it("grant() zachowuje POZOSTAŁE kategorie (nie zeruje functional ani analytics)", async () => {
    persist({ functional: true, analytics: true, marketing: false });
    const { useMarketingConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useMarketingConsent());

    await act(async () => {
      r.result.current.grant();
    });

    expect(storedState()?.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    });
  });
});

// =====================================================================
describe("klamra GPC na powierzchniach hookowych", () => {
  it("useEffectiveConsent zeruje analytics i marketing dla zgody zapisanej PRZED pojawieniem się sygnału, zachowując functional", async () => {
    // Zgoda "z czasów sprzed sygnału" - bez znacznika override'u.
    persist({ functional: true, analytics: true, marketing: true });
    setNavigatorGpc(true);
    const { useEffectiveConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    expect(r.result.current.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: false,
      marketing: false,
    });
    expect(r.result.current.gpcHonored).toBe(true);
    expect(r.result.current.gpc).toEqual({ active: true, source: "navigator" });
  });

  it("useEffectiveConsent zwraca tę samą referencję categories między renderami (konsumenci trzymają ją w zależnościach efektów)", async () => {
    persist({ functional: true, analytics: true, marketing: true });
    const { useEffectiveConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    const first = r.result.current.categories;
    r.rerender();
    r.rerender();

    // Zmiana tożsamości obiektu = pętla re-injekcji skryptów w ConsentScriptInjector.
    expect(r.result.current.categories).toBe(first);
  });

  it("useEffectiveConsent: PODGLĄD nadpisuje functional, ale NIE obchodzi klamry dla analytics/marketing", async () => {
    persist({ functional: false, analytics: false, marketing: false });
    setNavigatorGpc(true);
    const { useEffectiveConsent, setConsentPreview } = await loadConsent();
    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    await act(async () => {
      setConsentPreview({ functional: true, analytics: true, marketing: true });
    });

    expect(r.result.current.preview).toBe(true);
    expect(r.result.current.categories.functional).toBe(true);
    // Podglądem testuje się layout banera, nie obchodzi się opt-outu.
    expect(r.result.current.categories.analytics).toBe(false);
    expect(r.result.current.categories.marketing).toBe(false);
  });

  it("useEffectiveConsent: ten sam podgląd BEZ sygnału włącza analytics (kontrola pozytywna klamry)", async () => {
    persist({ functional: false, analytics: false, marketing: false });
    const { useEffectiveConsent, setConsentPreview } = await loadConsent();
    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    await act(async () => {
      setConsentPreview({ analytics: true, marketing: true });
    });

    expect(r.result.current.categories.analytics).toBe(true);
    expect(r.result.current.categories.marketing).toBe(true);
  });

  it("useCategoryGranted odmawia analytics przy sygnale, ale nie rusza functional ani necessary", async () => {
    persist({ functional: true, analytics: true, marketing: true });
    setNavigatorGpc(true);
    const { useCategoryGranted } = await loadConsent();

    const r = renderHookWithQueryClient(() => ({
      analytics: useCategoryGranted("analytics"),
      marketing: useCategoryGranted("marketing"),
      functional: useCategoryGranted("functional"),
      necessary: useCategoryGranted("necessary"),
    }));

    expect(r.result.current).toEqual({
      analytics: false,
      marketing: false,
      functional: true,
      necessary: true,
    });
  });

  it("useGpcHonored przestaje honorować sygnał DOKŁADNIE w momencie zapisu override'u - bez remountu", async () => {
    persist({ functional: true, analytics: true, marketing: true });
    setNavigatorGpc(true);
    const { useGpcHonored, useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => ({
      honored: useGpcHonored(),
      consent: useConsent(),
    }));
    expect(r.result.current.honored).toBe(true);

    await act(async () => {
      r.result.current.consent.acceptAll();
    });

    // Powierzchnie rejestru (useConsents) i noty w UI muszą przestawić się od razu.
    expect(r.result.current.honored).toBe(false);
  });

  it("useGpcHonored zauważa włączenie sygnału w innej karcie (zdarzenie 'focus' wymusza ponowny odczyt nośników)", async () => {
    persist({ functional: true, analytics: true, marketing: true });
    const { useGpcHonored } = await loadConsent();
    const r = renderHookWithQueryClient(() => useGpcHonored());
    expect(r.result.current).toBe(false);

    setNavigatorGpc(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // Przełączenie rozszerzenia prywatnościowego jest widziane bez reloadu.
    expect(r.result.current).toBe(true);
  });

  it("useMarketingConsent: granted przechodzi przez klamrę, mimo marketing:true w localStorage", async () => {
    persist({ marketing: true });
    setNavigatorGpc(true);
    const { useMarketingConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useMarketingConsent());

    // Stare API nie może być furtką obchodzącą sygnał opt-outu.
    expect(r.result.current.granted).toBe(false);
    expect(r.result.current.decided).toBe(true);
  });
});

// =====================================================================
describe("trwałość: cookie jako nośnik zapasowy", () => {
  it("wyczyszczony localStorage nie gubi decyzji, a odczyt z cookie RE-HYDRATUJE localStorage", async () => {
    const state = {
      version: 2,
      ts: 1_735_689_600_000,
      categories: { necessary: true, functional: true, analytics: true, marketing: false },
    };
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
    window.localStorage.clear();
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(true);

    // Drugi skutek jest ISTOTĄ testu: bez re-hydratacji następna decyzja
    // liczyłaby prev = null i wysłała do audytu fałszywą "pierwszą decyzję".
    expect(storedState()).toEqual(state);
  });

  it("uszkodzony localStorage przy poprawnym cookie: wygrywa cookie i NADPISUJE śmieci", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ts: 1 }));
    const state = {
      version: 2,
      ts: 1_735_689_600_000,
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
    };
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(true);
    expect(storedState()?.version).toBe(2);
  });

  it("decyzja odtworzona z cookie zachowuje znacznik override'u (świadoma zgoda nie ginie po czyszczeniu localStorage)", async () => {
    const state = {
      version: 2,
      ts: 1_735_689_600_000,
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
      gpcOverrideAt: 1_735_689_700_000,
    };
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
    window.localStorage.clear();
    setNavigatorGpc(true);
    const { isGpcCurrentlyHonored, hasCategoryConsent } = await loadConsent();

    expect(isGpcCurrentlyHonored()).toBe(false);
    expect(hasCategoryConsent("marketing")).toBe(true);
    expect(storedState()?.gpcOverrideAt).toBe(1_735_689_700_000);
  });
});

// =====================================================================
describe("migracja starego klucza consent:marketing", () => {
  it("'granted' migruje do wersji 2, usuwa stary klucz i tworzy cookie", async () => {
    window.localStorage.setItem(LEGACY_KEY, "granted");
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    expect(r.result.current.state?.version).toBe(2);
    expect(r.result.current.state?.categories.marketing).toBe(true);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(cookieDecision()).not.toBeNull();
  });

  it("MIGRACJA ROZSZERZA ZAKRES: legacy 'granted' (tylko marketing) włącza także functional i analytics", async () => {
    // RYZYKO RODO do rozstrzygnięcia produktowego, zafiksowane tu jawnie:
    // użytkownik, który w starym API zgodził się WYŁĄCZNIE na marketing, po
    // migracji ma włączoną analitykę - to zgoda, której nigdy nie zbierano
    // (art. 7 RODO: zgoda musi być konkretna i wyrażona dla danego celu).
    // Ten test NIE jest defektem `it.fails`, bo opisuje decyzję świadomie
    // podjętą w kodzie (`defaultConsent(legacy === "granted")`); po zmianie
    // produktowej trzeba go zaktualizować razem z migracją.
    window.localStorage.setItem(LEGACY_KEY, "granted");
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    expect(r.result.current.state?.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    });
  });

  it("'denied' migruje na wszystkie kategorie 'nie', ale DECYZJA ISTNIEJE (baner nie wraca)", async () => {
    window.localStorage.setItem(LEGACY_KEY, "denied");
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    expect(r.result.current.state).not.toBeNull();
    expect(r.result.current.decided).toBe(true);
    expect(r.result.current.state?.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("migracja NIE nadaje znacznika override'u, więc sygnał GPC wygrywa nad zmigrowaną zgodą", async () => {
    window.localStorage.setItem(LEGACY_KEY, "granted");
    setNavigatorGpc(true);
    const { hasCategoryConsent, isGpcCurrentlyHonored } = await loadConsent();

    expect(isGpcCurrentlyHonored()).toBe(true);
    expect(hasCategoryConsent("marketing")).toBe(false);
    // functional jest poza klamrą - migracja realnie coś nadała.
    expect(hasCategoryConsent("functional")).toBe(true);
  });

  it.each(["true", "1", "", "GRANTED", "yes"])(
    "wartość legacy %o NIE migruje wcale - brak decyzji i stary klucz NIETKNIĘTY",
    async (legacy) => {
      window.localStorage.setItem(LEGACY_KEY, legacy);
      const { useConsent } = await loadConsent();

      const r = renderHookWithQueryClient(() => useConsent());

      expect(r.result.current.state).toBeNull();
      expect(window.localStorage.getItem(LEGACY_KEY)).toBe(legacy);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    },
  );
});

// =====================================================================
describe("odczyt uszkodzonych i cudzych zapisów (safeParse)", () => {
  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    [
      "obca wersja 1 (brak migracji - decyzja przepada świadomie)",
      '{"version":1,"ts":1,"categories":{"analytics":true}}',
    ],
    ["wersja jako string", '{"version":"2","ts":1,"categories":{"analytics":true}}'],
    ["nie-JSON", "not-json"],
    ["literalny null", "null"],
    ["tablica", "[1,2]"],
    ["liczba", "3"],
    ["pusty obiekt", "{}"],
    ["brak pola version", '{"ts":1,"categories":{"analytics":true}}'],
  ];

  it.each(REJECTED)(
    "zapis (%s) daje 'brak decyzji' i NIE rzuca - baner wraca (fail-safe)",
    async (_label, raw) => {
      window.localStorage.setItem(STORAGE_KEY, raw);
      const { useConsent, hasCategoryConsent } = await loadConsent();

      const r = renderHookWithQueryClient(() => useConsent());

      expect(r.result.current.state).toBeNull();
      expect(r.result.current.decided).toBe(false);
      expect(hasCategoryConsent("analytics")).toBe(false);
    },
  );

  it("wymusza necessary=true i koercję do boolean, a NIELICZBOWY ts cicho podmienia na 'teraz'", async () => {
    const before = Date.now();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        ts: "wczoraj",
        categories: { necessary: false, functional: "nie", analytics: 1, marketing: null },
      }),
    );
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    // "necessary: false" z cudzego zapisu nie wyłącza kategorii niezbędnej,
    // a wartości nie-boolean idą przez `!!` (string "nie" jest TRUTHY).
    expect(r.result.current.state?.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    });
    // Podmiana ts na Date.now() jest niedomkniętą krawędzią: sztuczna świeżość
    // decyduje o rozstrzyganiu remote vs local przy logowaniu.
    expect(r.result.current.state?.ts).toBeGreaterThanOrEqual(before);
  });

  it("poprawna wersja BEZ pola categories to decyzja o niczym: wszystko na 'nie', necessary nadal true", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ts: 1_735_689_600_000 }));
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    // Decyzja ISTNIEJE (baner nie wraca), ale nie nadaje żadnej zgody.
    expect(r.result.current.state).not.toBeNull();
    expect(r.result.current.state?.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it("necessary jest udzielone także PRZED jakąkolwiek decyzją - nie zależy od nośnika", async () => {
    const { hasCategoryConsent } = await loadConsent();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasCategoryConsent("necessary")).toBe(true);
    expect(hasCategoryConsent("analytics")).toBe(false);
  });

  it("pole source przechodzi BEZ WALIDACJI i jedzie dalej do cookie", async () => {
    // Niedomknięta krawędź zafiksowana jawnie: typ dopuszcza "local" | "profile",
    // ale safeParse przepisuje `v.source` bez sprawdzenia, więc obca wartość z
    // localStorage/cookie/prefs trafia do mirroru i do profilu.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        ts: 1_735_689_600_000,
        source: "cudza-warstwa",
        categories: { necessary: true, analytics: true },
      }),
    );
    const { useConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useConsent());

    expect(r.result.current.state?.source).toBe("cudza-warstwa");
  });

  it.each([
    ["string", '"123"'],
    ["null po round-tripie NaN/Infinity", "null"],
    ["zero", "0"],
    ["wartość ujemna", "-1"],
  ])(
    "gpcOverrideAt (%s) NIE zdejmuje klamry - fail-closed po stronie użytkownika",
    async (_label, rawValue) => {
      window.localStorage.setItem(
        STORAGE_KEY,
        `{"version":2,"ts":1735689600000,"categories":{"necessary":true,"functional":true,"analytics":true,"marketing":true},"gpcOverrideAt":${rawValue}}`,
      );
      setNavigatorGpc(true);
      const { isGpcCurrentlyHonored, hasCategoryConsent } = await loadConsent();

      expect(isGpcCurrentlyHonored()).toBe(true);
      expect(hasCategoryConsent("marketing")).toBe(false);
    },
  );
});

// =====================================================================
describe("klucze prototypowe w cudzym zapisie (hipoteza defektu OBALONA)", () => {
  it.each([
    [
      "__proto__ z włączonymi kategoriami",
      '{"version":2,"ts":1,"categories":{"__proto__":{"analytics":true,"marketing":true}}}',
    ],
    [
      "constructor.prototype",
      '{"version":2,"ts":1,"categories":{"constructor":{"prototype":{"marketing":true,"analytics":true}}}}',
    ],
    ["categories jako string", '{"version":2,"ts":1,"categories":"functional"}'],
  ])(
    "zapis (%s) NIE włącza analytics ani marketing i nie brudzi Object.prototype",
    async (_label, raw) => {
      // Test REGRESYJNY: safeParse czyta wyłącznie po LITERAŁACH
      // (cats.functional / cats.analytics / cats.marketing), a JSON.parse tworzy
      // "__proto__" jako WŁASNĄ właściwość danych. Odczyt po ZMIENNEJ
      // (cats[cat]) w przyszłej refaktoryzacji BYŁBY już dziurą - stąd ten test.
      window.localStorage.setItem(STORAGE_KEY, raw);
      const { hasCategoryConsent } = await loadConsent();

      expect(hasCategoryConsent("analytics")).toBe(false);
      expect(hasCategoryConsent("marketing")).toBe(false);
      expect(hasCategoryConsent("functional")).toBe(false);
      expect((({} as Record<string, unknown>).analytics as unknown) ?? null).toBeNull();
      expect(Object.hasOwn(Object.prototype, "analytics")).toBe(false);
    },
  );

  it("UTAJONA KRAWĘDŹ: hasCategoryConsent('constructor') zwraca true, bo kategoria jest indeksowana ZMIENNĄ", async () => {
    // Dokumentacja, nie defekt do naprawy: dziś żaden wywołujący nie łamie typu
    // ConsentCategory, więc szkody nie ma. Gdyby jednak nazwa kategorii kiedyś
    // pochodziła z danych (klucz rejestru, parametr URL), `state.categories[cat]`
    // oddałoby odziedziczoną funkcję - wartość TRUTHY - i włączyłoby skrypty.
    // Utwardzenie kosztuje jedną linię: sprawdzenie `cat` względem listy kategorii.
    persist({ functional: false, analytics: false, marketing: false });
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("constructor" as ConsentCategory)).toBe(true);
    // Kontrola: prawdziwe kategorie są wyłączone, więc "true" wyżej nie jest
    // przypadkową zgodą użytkownika.
    expect(hasCategoryConsent("analytics")).toBe(false);
  });
});

// =====================================================================
describe("most rejestru RODO nie może zablokować decyzji użytkownika", () => {
  it("decyzja przekazuje do mostu poprzedni i nowy stan, źródło oraz aktywność sygnału", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.save({ analytics: true }, "profile_privacy");
    });

    await vi.waitFor(() => expect(h.syncCalls).toHaveLength(1));
    expect(h.syncCalls[0].prev).toBeNull();
    expect(h.syncCalls[0].next.categories.analytics).toBe(true);
    expect(h.syncCalls[0].source).toBe("profile_privacy");
    expect(h.syncCalls[0].gpcActive).toBe(false);

    // Druga decyzja: `prev` to poprzedni stan, a aktywność sygnału jedzie do audytu.
    setNavigatorGpc(true);
    await act(async () => {
      r.result.current.rejectAll();
    });
    await vi.waitFor(() => expect(h.syncCalls).toHaveLength(2));
    // `prev` MUSI być dokładnie stanem zapisanym poprzednią decyzją - inaczej
    // diff w moście policzyłby drugą decyzję jako pierwszą.
    expect(h.syncCalls[1].prev?.ts).toBe(h.syncCalls[0].next.ts);
    expect(h.syncCalls[1].gpcActive).toBe(true);
    expect(h.syncCalls[1].source).toBe("cmp_banner");
  });

  it("BŁĄD ŁADOWANIA CHUNKU mostu nie unieważnia decyzji ani nie zostawia nieobsłużonego odrzucenia", async () => {
    // Odrzucony dynamiczny import = realny odpowiednik błędu ładowania chunku
    // (offline, wygasły deploy). `writeLocal` jest PRZED importem, więc decyzja
    // musi już być trwała.
    vi.doMock(BRIDGE_PATH, () => {
      throw new Error("chunk load error");
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { useConsent } = await loadConsent();
      const r = renderHookWithQueryClient(() => useConsent());

      await act(async () => {
        r.result.current.save({ analytics: true });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(storedState()?.categories.analytics).toBe(true);
      expect(cookieDecision()).not.toBeNull();
      expect(r.result.current.state).not.toBeNull();
      expect(h.syncCalls).toHaveLength(0);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
      vi.doMock(BRIDGE_PATH, () => bridgeModule());
    }
  });

  it("ODRZUCONY zapis do rejestru nie cofa decyzji cookie", async () => {
    h.bridgeRejects = true;
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.acceptAll();
    });
    await vi.waitFor(() => expect(h.syncCalls).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(storedState()?.categories.marketing).toBe(true);
    expect(cookieDecision()).not.toBeNull();
  });

  it("decyzja podjęta bez sesji nie generuje ANI JEDNEGO zapytania do bazy, a i tak jest trwała", async () => {
    const { useConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      r.result.current.acceptAll();
    });
    await vi.waitFor(() => expect(h.syncCalls).toHaveLength(1));

    // Gość nie generuje ruchu do profilu przy każdej decyzji cookie.
    expect(h.rpc.calls).toHaveLength(0);
    expect(h.from.chains).toHaveLength(0);
    expect(storedState()).not.toBeNull();
  });
});

// =====================================================================
describe("tryb podglądu zgód", () => {
  it("setConsentPreview zapisuje override do sessionStorage i rozgłasza go zamontowanym powierzchniom", async () => {
    const { setConsentPreview, useEffectiveConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useEffectiveConsent());
    expect(r.result.current.preview).toBe(false);

    await act(async () => {
      setConsentPreview({ analytics: true });
    });

    const raw = window.sessionStorage.getItem(PREVIEW_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).categories).toEqual({
      necessary: true,
      functional: false,
      analytics: true,
      marketing: false,
    });
    expect(r.result.current.preview).toBe(true);
    expect(r.result.current.categories.analytics).toBe(true);
    // Podgląd jest session-scoped: NIE dotyka trwałych nośników decyzji.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(cookieDecision()).toBeNull();
  });

  it("clearConsentPreview przywraca trwały zapis jako aktywną zgodę", async () => {
    persist({ functional: true, analytics: false, marketing: false });
    const { setConsentPreview, clearConsentPreview, useEffectiveConsent } = await loadConsent();
    const r = renderHookWithQueryClient(() => useEffectiveConsent());
    await act(async () => {
      setConsentPreview({ analytics: true, marketing: true });
    });
    expect(r.result.current.categories.marketing).toBe(true);

    await act(async () => {
      clearConsentPreview();
    });

    expect(window.sessionStorage.getItem(PREVIEW_KEY)).toBeNull();
    expect(r.result.current.preview).toBe(false);
    expect(r.result.current.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: false,
      marketing: false,
    });
  });

  it("uszkodzony zapis podglądu jest ignorowany, a nie wywraca odczytu zgód", async () => {
    persist({ analytics: true });
    window.sessionStorage.setItem(PREVIEW_KEY, "{niepoprawny json");
    const { useEffectiveConsent, hasCategoryConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    expect(r.result.current.preview).toBe(false);
    expect(hasCategoryConsent("analytics")).toBe(true);
  });

  it("podgląd BEZ pola categories nadal MASKUJE trwałą zgodę (wszystko na 'nie')", async () => {
    persist({ functional: true, analytics: true, marketing: true });
    window.sessionStorage.setItem(PREVIEW_KEY, "{}");
    const { useEffectiveConsent, hasCategoryConsent } = await loadConsent();

    const r = renderHookWithQueryClient(() => useEffectiveConsent());

    expect(r.result.current.preview).toBe(true);
    expect(r.result.current.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
    // Ta sama odpowiedź poza Reactem - bramkowanie beaconów nie może się rozjechać.
    expect(hasCategoryConsent("analytics")).toBe(false);
  });

  it("isConsentPreviewRequested reaguje WYŁĄCZNIE na ?consent-preview=1", async () => {
    const { isConsentPreviewRequested } = await loadConsent();
    expect(isConsentPreviewRequested()).toBe(false);

    window.history.replaceState(null, "", "/?consent-preview=1");
    expect(isConsentPreviewRequested()).toBe(true);

    // "0", "true" i puste to BRAK żądania - liberalne parsowanie włączałoby
    // narzędzie admina przypadkowym parametrem w cudzym linku.
    for (const value of ["0", "true", ""]) {
      window.history.replaceState(null, "", `/?consent-preview=${value}`);
      expect(isConsentPreviewRequested()).toBe(false);
    }
  });
});

// =====================================================================
// DEFEKTY. Każdy `it.fails` opisuje OCZEKIWANE zachowanie; obok stoi zwykły
// `it` z STANEM FAKTYCZNYM. Po naprawie produkcji usuwa się OBA razem.
// =====================================================================
describe("H-D1: readLocal czyta localStorage bez try/catch", () => {
  it.fails(
    "rzucający localStorage NIE POWINIEN unieważniać decyzji - hasCategoryConsent i isGpcCurrentlyHonored powinny sięgnąć po cookie",
    async () => {
      // OCZEKIWANIE: `readLocal` osłania `getItem` tak samo, jak `writeLocal`
      // osłania `setItem` - wtedy krok 2 (fallback cookie) w ogóle zostaje
      // osiągnięty i decyzja użytkownika obowiązuje.
      const state = {
        version: 2,
        ts: 1_735_689_600_000,
        categories: { necessary: true, functional: true, analytics: true, marketing: true },
      };
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
      const { hasCategoryConsent, isGpcCurrentlyHonored } = await loadConsent();

      withThrowingStorage("localStorage", "all", () => {
        expect(hasCategoryConsent("analytics")).toBe(true);
        expect(isGpcCurrentlyHonored()).toBe(false);
      });
    },
  );

  it("STAN FAKTYCZNY: rzucający localStorage wypuszcza SecurityError przez hasCategoryConsent i isGpcCurrentlyHonored", async () => {
    // Skutek dla użytkownika: w przeglądarce blokującej dostęp do site data rzut
    // leci do silnika analityki i eventów, a cookie, które mogłoby uratować
    // decyzję, nigdy nie zostaje odczytane.
    // USUŃ RAZEM z powyższym `it.fails` po dodaniu try/catch w readLocal.
    const state = {
      version: 2,
      ts: 1_735_689_600_000,
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
    };
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
    const { hasCategoryConsent, isGpcCurrentlyHonored } = await loadConsent();

    withThrowingStorage("localStorage", "all", () => {
      expect(() => hasCategoryConsent("analytics")).toThrow(/SecurityError/);
      expect(() => isGpcCurrentlyHonored()).toThrow(/SecurityError/);
    });
  });

  it.fails(
    "montaż useConsent przy rzucającym localStorage NIE POWINIEN wywracać drzewa Reacta",
    async () => {
      // OCZEKIWANIE: inicjalizator useState czyta przez osłonięty readLocal,
      // więc strona renderuje się (bez decyzji albo z decyzją z cookie), a nie
      // ląduje w error boundary.
      const { useConsent } = await loadConsent();

      withThrowingStorage("localStorage", "all", () => {
        expect(() => renderHookWithQueryClient(() => useConsent())).not.toThrow();
      });
    },
  );

  it("STAN FAKTYCZNY: inicjalizator useState wypuszcza SecurityError w trakcie renderu", async () => {
    // Rzut w trakcie renderu = pusty ekran (error boundary) dla każdego, kto ma
    // zablokowany dostęp do site data - a to ta sama grupa, która najbardziej
    // polega na opt-oucie.
    // USUŃ RAZEM z powyższym `it.fails`.
    const { useConsent } = await loadConsent();
    let thrown: unknown = null;

    withThrowingStorage("localStorage", "all", () => {
      try {
        renderHookWithQueryClient(() => useConsent());
      } catch (e) {
        thrown = e;
      }
    });

    expect(String(thrown)).toContain("SecurityError");
  });
});

describe("H-D2: zapisy trybu podglądu bez ochrony sessionStorage", () => {
  it.fails(
    "setConsentPreview i clearConsentPreview NIE POWINNY rzucać, gdy sessionStorage jest niedostępny",
    async () => {
      // OCZEKIWANIE: symetria z readPreview, który ma pełny try/catch - panel
      // podglądu (?consent-preview=1) nie może wywalić handlera onChange.
      const { setConsentPreview, clearConsentPreview } = await loadConsent();

      withThrowingStorage("sessionStorage", "all", () => {
        expect(() => setConsentPreview({ analytics: true })).not.toThrow();
        expect(() => clearConsentPreview()).not.toThrow();
      });
    },
  );

  it("STAN FAKTYCZNY: oba zapisy podglądu wypuszczają SecurityError", async () => {
    // Zasięg mały (narzędzie admina), koszt naprawy zerowy - ale dziś każda
    // zmiana przełącznika w panelu podglądu wywala trasę.
    // USUŃ RAZEM z powyższym `it.fails`.
    const { setConsentPreview, clearConsentPreview } = await loadConsent();

    withThrowingStorage("sessionStorage", "all", () => {
      expect(() => setConsentPreview({ analytics: true })).toThrow(/SecurityError/);
      expect(() => clearConsentPreview()).toThrow(/SecurityError/);
    });
  });
});
