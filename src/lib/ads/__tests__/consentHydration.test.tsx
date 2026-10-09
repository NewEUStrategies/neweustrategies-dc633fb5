// Sygnal zmiany zgody (`src/lib/ads/consent.ts`): hydracja z profilu, odpornosc
// odczytu i izolacja awarii mostow dynamicznych.
//
// PO CO OSOBNY PLIK. `consent.test.tsx` atrapuje `onAuthStateChange` jako
// no-op, wiec cala galaz "zalogowany uzytkownik wchodzi na strone" - scalenie
// decyzji z profilu z decyzja lokalna, backfill rejestru RODO, slad sygnalu GPC
// - nie wykonywala sie w zadnym tescie (pomiar: 46/60 funkcji, 59,8% galezi).
// Tu sesja Supabase emituje zdarzenia naprawde, a mosty `registryBridge`
// i `adAttributionStore` sa atrapami, zeby dalo sie zobaczyc, CO i Z JAKIM
// podmiotem do nich trafia - i ze ich awaria nie zatrzymuje decyzji cookie.
//
// PRAWDZIWE zostaja: localStorage, sessionStorage, cookie, zdarzenia okna
// i sygnal GPC (nosnik cookie, jak w przegladarce).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";

const UID = "22222222-2222-2222-2222-222222222222";

const sb = vi.hoisted(() => ({
  userId: null as string | null,
  /** `undefined` = profil bez wiersza (RPC oddaje pusta tablice). */
  prefs: {} as Record<string, unknown> | undefined,
  sessionError: null as Error | null,
  updateError: null as Error | null,
  rpcCalls: 0,
  updates: [] as Record<string, unknown>[],
  authListeners: [] as ((event: string) => void)[],
}));

const bridge = vi.hoisted(() => ({
  sync: vi.fn(async (..._args: unknown[]) => {}),
  backfill: vi.fn(async (..._args: unknown[]) => {}),
  gpc: vi.fn(async (..._args: unknown[]) => {}),
  prune: vi.fn((..._args: unknown[]) => {}),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (sb.sessionError) throw sb.sessionError;
        return {
          data: sb.userId ? { session: { user: { id: sb.userId } } } : { session: null },
        };
      },
      onAuthStateChange: (cb: (event: string) => void) => {
        sb.authListeners.push(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                sb.authListeners = sb.authListeners.filter((l) => l !== cb);
              },
            },
          },
        };
      },
    },
    rpc: async () => {
      sb.rpcCalls += 1;
      return { data: sb.prefs === undefined ? [] : [{ prefs: sb.prefs }], error: null };
    },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        sb.updates.push(payload);
        return {
          eq: async () => {
            if (sb.updateError) throw sb.updateError;
            return { data: null, error: null };
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/consent/registryBridge", () => ({
  syncCmpDecisionToRegistry: bridge.sync,
  backfillRegistryOnLogin: bridge.backfill,
  syncGpcSignalToRegistry: bridge.gpc,
}));

vi.mock("@/lib/analytics/adAttributionStore", () => ({
  pruneAdAttributionForConsent: bridge.prune,
}));

import {
  consumeOpenPrefsRequest,
  hasCategoryConsent,
  hasConsentDecision,
  isConsentPreviewRequested,
  OPEN_PREFS_EVENT,
  requestConsentPreferences,
  useCategoryGranted,
  useConsent,
  useEffectiveConsent,
  useGpcHonored,
  useMarketingConsent,
  type ConsentState,
} from "@/lib/ads/consent";

const STORAGE_KEY = "consent:v2";
const COOKIE_NAME = "nes_cookie_consent";
const PREVIEW_KEY = "consent:preview";

function stored(cats: Partial<Record<string, boolean>>, ts: number, extra = {}): ConsentState {
  return {
    version: 2,
    ts,
    categories: {
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
      ...cats,
    },
    ...extra,
  };
}

function writeLocalState(state: unknown): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readLocalState(): ConsentState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as ConsentState);
}

function enableGpc(): void {
  document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
}

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/**
 * Zablokowany magazyn tak, jak blokuje go przegladarka: rzuca juz SAM dostep do
 * `window.localStorage` (ramka z blokada danych stron trzecich, wylaczone dane
 * witryny), a nie dopiero `getItem`.
 */
function blockLocalStorage(): void {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });
}

/** Supabase emituje zdarzenie sesji KAZDEMU zapisanemu sluchaczowi - jak w kliencie. */
function emitAuth(event: string): void {
  for (const listener of [...sb.authListeners]) listener(event);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearCookies();
  sb.userId = null;
  sb.prefs = {};
  sb.sessionError = null;
  sb.updateError = null;
  sb.rpcCalls = 0;
  sb.updates = [];
  sb.authListeners = [];
  bridge.sync.mockReset().mockResolvedValue(undefined);
  bridge.backfill.mockReset().mockResolvedValue(undefined);
  bridge.gpc.mockReset().mockResolvedValue(undefined);
  bridge.prune.mockReset();
});

afterEach(() => {
  clearCookies();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// ---------------------------------------------------------------------------
describe("hydracja decyzji z profilu przy zdarzeniu sesji", () => {
  it("profil NOWSZY niz zapis lokalny wygrywa i zapisuje sie lokalnie ze zrodlem 'profile'", async () => {
    sb.userId = UID;
    writeLocalState(stored({ marketing: false }, 1_000));
    sb.prefs = { consent: stored({ marketing: true, analytics: true }, 2_000) };
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(result.current.state?.categories.marketing).toBe(true));
    expect(readLocalState()).toMatchObject({ ts: 2_000, source: "profile" });
    // Decyzja przyszla Z profilu - odsylanie jej z powrotem byloby pustym zapisem.
    expect(sb.updates).toEqual([]);
  });

  it("zapis lokalny NOWSZY niz profil zostaje, a profil nie jest nadpisywany wstecz", async () => {
    sb.userId = UID;
    writeLocalState(stored({ marketing: true }, 5_000));
    sb.prefs = { consent: stored({ marketing: false }, 1_000) };
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("INITIAL_SESSION"));

    await waitFor(() => expect(bridge.backfill).toHaveBeenCalled());
    expect(result.current.state?.categories.marketing).toBe(true);
    expect(readLocalState()?.ts).toBe(5_000);
    expect(sb.updates).toEqual([]);
  });

  it("decyzja anonimowa zyskuje podmiot: brak zgody w profilu -> zapis lokalny trafia do profilu", async () => {
    sb.userId = UID;
    sb.prefs = { theme: "dark" };
    writeLocalState(stored({ analytics: true }, 3_000));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    const prefs = sb.updates[0]!["prefs"] as Record<string, unknown>;
    expect(prefs["theme"]).toBe("dark");
    expect(prefs["consent"]).toMatchObject({ ts: 3_000, source: "profile" });
  });

  it("profil bez wiersza (RPC oddaje pusta liste) traktowany jak brak decyzji, nie jak wywrotka", async () => {
    sb.userId = UID;
    sb.prefs = undefined;
    writeLocalState(stored({ functional: true }, 3_000));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    expect(sb.updates[0]!["prefs"]).toMatchObject({ consent: { ts: 3_000 } });
  });

  it("awaria zapisu decyzji anonimowej do profilu nie uniewaznia hydracji", async () => {
    sb.userId = UID;
    sb.updateError = new Error("permission denied");
    writeLocalState(stored({ analytics: true }, 3_000));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    // Stan lokalny obowiazuje dalej i backfill rejestru i tak rusza.
    await waitFor(() => expect(bridge.backfill).toHaveBeenCalledTimes(1));
    expect(sb.updates).toHaveLength(1);
    expect(bridge.backfill.mock.calls[0]![0]).toMatchObject({ ts: 3_000 });
  });

  it("ani profil, ani urzadzenie nie maja decyzji: stan zostaje pusty, rejestr nie jest ruszany", async () => {
    sb.userId = UID;
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(sb.rpcCalls).toBe(1));
    await vi.dynamicImportSettled();
    expect(result.current.state).toBeNull();
    expect(bridge.backfill).not.toHaveBeenCalled();
    expect(sb.updates).toEqual([]);
  });

  it("niezalogowany: zdarzenie sesji nie odpytuje profilu", async () => {
    writeLocalState(stored({ marketing: true }, 1_000));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("INITIAL_SESSION"));
    await vi.dynamicImportSettled();

    expect(sb.rpcCalls).toBe(0);
    expect(bridge.backfill).not.toHaveBeenCalled();
  });

  it("zdarzenie niezwiazane z tozsamoscia (TOKEN_REFRESHED) nie hydratuje", async () => {
    sb.userId = UID;
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("TOKEN_REFRESHED"));
    await vi.dynamicImportSettled();

    expect(sb.rpcCalls).toBe(0);
  });

  it("awaria odczytu sesji nie zmienia stanu i nie wycieka wyjatkiem", async () => {
    sb.userId = UID;
    sb.sessionError = new Error("offline");
    writeLocalState(stored({ marketing: true }, 1_000));
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));
    await vi.dynamicImportSettled();

    expect(result.current.state?.categories.marketing).toBe(true);
    expect(sb.rpcCalls).toBe(0);
  });

  it("odpiecie hooka konczy nasluch sesji", async () => {
    const { unmount } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    unmount();

    expect(sb.authListeners).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("single-flight: wiele instancji useConsent, jeden odczyt profilu", () => {
  it("INITIAL_SESSION do pieciu instancji kosztuje JEDEN get_own_profile i jeden zapis", async () => {
    sb.userId = UID;
    writeLocalState(stored({ analytics: true }, 3_000));
    // Baner, wstrzykiwacz skryptow i trzy sloty reklamowe - kazdy z wlasnym
    // nasluchem sesji, jak na prawdziwej stronie.
    const hooks = [
      renderHook(() => useConsent()),
      renderHook(() => useEffectiveConsent()),
      renderHook(() => useMarketingConsent()),
      renderHook(() => useMarketingConsent()),
      renderHook(() => useMarketingConsent()),
    ];
    await waitFor(() => expect(sb.authListeners).toHaveLength(5));

    act(() => emitAuth("INITIAL_SESSION"));

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    await vi.dynamicImportSettled();
    // Jeden odczyt na CALA hydracje - takze zapis decyzji anonimowej do profilu
    // korzysta z `prefs` juz odczytanych, zamiast pytac drugi raz.
    expect(sb.rpcCalls).toBe(1);
    expect(bridge.backfill).toHaveBeenCalledTimes(1);
    expect(hooks[0]!.result.current).toMatchObject({ state: { ts: 3_000 } });
  });

  it("zdarzenie PO rozstrzygnieciu poprzedniego startuje swiezy odczyt", async () => {
    sb.userId = UID;
    sb.prefs = { consent: stored({ marketing: true }, 2_000) };
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("INITIAL_SESSION"));
    await waitFor(() => expect(result.current.state?.ts).toBe(2_000));

    sb.prefs = { consent: stored({ marketing: false }, 9_000) };
    act(() => emitAuth("USER_UPDATED"));

    await waitFor(() => expect(result.current.state?.ts).toBe(9_000));
    expect(sb.rpcCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("backfill rejestru RODO i slad sygnalu GPC po zalogowaniu", () => {
  it("backfill dostaje rozstrzygniety stan, podmiot i flage sygnalu", async () => {
    sb.userId = UID;
    writeLocalState(stored({ marketing: true }, 4_000));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(bridge.backfill).toHaveBeenCalledTimes(1));
    const [state, uid, gpcActive] = bridge.backfill.mock.calls[0]!;
    expect(state).toMatchObject({ ts: 4_000 });
    expect(uid).toBe(UID);
    expect(gpcActive).toBe(false);
    expect(bridge.gpc).not.toHaveBeenCalled();
  });

  it("honorowany GPC zostawia slad wycofania PO backfillu - chronologia audytu", async () => {
    sb.userId = UID;
    enableGpc();
    writeLocalState(stored({ marketing: true }, 4_000));
    const order: string[] = [];
    bridge.backfill.mockImplementation(async () => {
      order.push("backfill");
    });
    bridge.gpc.mockImplementation(async () => {
      order.push("gpc");
    });
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(bridge.gpc).toHaveBeenCalledWith(UID));
    expect(order).toEqual(["backfill", "gpc"]);
    expect(bridge.backfill.mock.calls[0]![2]).toBe(true);
  });

  it("swiadomy override GPC NIE generuje wycofania - decyzja uzytkownika wygrywa", async () => {
    sb.userId = UID;
    enableGpc();
    writeLocalState(stored({ marketing: true }, 4_000, { gpcOverrideAt: 4_000 }));
    renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(bridge.backfill).toHaveBeenCalled());
    await vi.dynamicImportSettled();
    expect(bridge.gpc).not.toHaveBeenCalled();
  });

  it("awaria backfillu jest polknieta - hydracja i tak oddaje stan", async () => {
    sb.userId = UID;
    sb.prefs = { consent: stored({ analytics: true }, 7_000) };
    bridge.backfill.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useConsent());
    await waitFor(() => expect(sb.authListeners).toHaveLength(1));

    act(() => emitAuth("SIGNED_IN"));

    await waitFor(() => expect(result.current.state?.ts).toBe(7_000));
    await vi.dynamicImportSettled();
    expect(bridge.gpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("decyzja zalogowanego, ktorego profil nie ma jeszcze wiersza prefs", () => {
  it("decyzja trafia do profilu jako jedyny klucz prefs", async () => {
    sb.userId = UID;
    sb.prefs = undefined;
    const { result } = renderHook(() => useConsent());

    act(() => result.current.acceptAll());

    await waitFor(() => expect(sb.updates).toHaveLength(1));
    expect(Object.keys(sb.updates[0]!["prefs"] as object)).toEqual(["consent"]);
  });
});

describe("awaria mostow dynamicznych nie zatrzymuje decyzji cookie", () => {
  it("odrzucony zapis do rejestru: decyzja jest zapisana lokalnie i w ciasteczku", async () => {
    bridge.sync.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useConsent());

    act(() => result.current.acceptAll("profile_privacy"));
    await vi.dynamicImportSettled();

    expect(bridge.sync).toHaveBeenCalledTimes(1);
    expect(bridge.sync.mock.calls[0]![2]).toBe("profile_privacy");
    expect(readLocalState()?.categories.marketing).toBe(true);
    expect(document.cookie).toContain(`${COOKIE_NAME}=`);
  });

  it("wyjatek sprzatania atrybucji nie cofa odmowy", async () => {
    bridge.prune.mockImplementation(() => {
      throw new Error("chunk load");
    });
    const { result } = renderHook(() => useConsent());

    act(() => result.current.rejectAll());
    await vi.dynamicImportSettled();

    expect(bridge.prune).toHaveBeenCalledWith({ analytics: false, marketing: false });
    expect(readLocalState()?.categories.marketing).toBe(false);
    expect(hasConsentDecision()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("odpornosc odczytu zgody", () => {
  it("uszkodzone %-kodowanie ciasteczka to brak decyzji, a nie URIError w renderze", () => {
    document.cookie = `${COOKIE_NAME}=%E0%A4%A; path=/`;

    expect(() => hasCategoryConsent("analytics")).not.toThrow();
    expect(hasCategoryConsent("analytics")).toBe(false);
    expect(hasConsentDecision()).toBe(false);
    const { result } = renderHook(() => useConsent());
    expect(result.current.state).toBeNull();
  });

  it("zablokowany localStorage (SecurityError): decyzja wraca z ciasteczka", async () => {
    const { result } = renderHook(() => useConsent());
    act(() => result.current.save({ analytics: true, marketing: true }));
    blockLocalStorage();

    expect(() => hasCategoryConsent("marketing")).not.toThrow();
    expect(hasCategoryConsent("marketing")).toBe(true);
    expect(hasConsentDecision()).toBe(true);
  });

  it("zablokowany localStorage bez ciasteczka: brak decyzji, bez wyjatku", () => {
    blockLocalStorage();

    expect(hasConsentDecision()).toBe(false);
    expect(hasCategoryConsent("necessary")).toBe(true);
  });

  it("uszkodzony JSON pod kluczem zgody to brak decyzji", () => {
    window.localStorage.setItem(STORAGE_KEY, "{nie-json");

    expect(hasConsentDecision()).toBe(false);
    expect(hasCategoryConsent("analytics")).toBe(false);
  });

  it("zapis o wersji nie-liczbowej jest odrzucany", () => {
    writeLocalState({ version: "2", ts: 1, categories: { marketing: true } });

    expect(hasConsentDecision()).toBe(false);
  });

  it("zapis bez kategorii znaczy odmowe wszystkiego poza niezbednymi", () => {
    writeLocalState({ version: 2, ts: 1 });

    expect(hasConsentDecision()).toBe(true);
    expect(hasCategoryConsent("functional")).toBe(false);
    expect(hasCategoryConsent("necessary")).toBe(true);
  });

  it("brak znacznika czasu dostaje biezacy - scalanie z profilem ma po czym porownac", () => {
    writeLocalState({ version: 2, categories: { analytics: true } });
    const before = Date.now();

    const { result } = renderHook(() => useConsent());

    expect(result.current.state?.ts).toBeGreaterThanOrEqual(before);
  });

  it("nieskonczony gpcOverrideAt nie jest override'em - klamra GPC zostaje", () => {
    enableGpc();
    window.localStorage.setItem(
      STORAGE_KEY,
      '{"version":2,"ts":1,"categories":{"marketing":true},"gpcOverrideAt":1e999}',
    );

    expect(hasCategoryConsent("marketing")).toBe(false);
  });

  it("uszkodzony JSON podgladu w sessionStorage jest ignorowany", () => {
    writeLocalState(stored({ analytics: true }, 1));
    window.sessionStorage.setItem(PREVIEW_KEY, "{nie-json");

    expect(hasCategoryConsent("analytics")).toBe(true);
  });

  it("podglad bez kategorii znaczy odmowe - nie dziedziczy trwalej zgody", () => {
    writeLocalState(stored({ analytics: true }, 1));
    window.sessionStorage.setItem(PREVIEW_KEY, "{}");

    expect(hasCategoryConsent("analytics")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("ciasteczko decyzji na HTTPS", () => {
  it("na https ciasteczko dostaje atrybut Secure, na http nie", () => {
    const writes: string[] = [];
    // `cookie` jest akcesorem na prototypie dokumentu - szukamy go w łańcuchu,
    // żeby zapis nadal trafiał do prawdziwego magazynu ciasteczek.
    let proto: object | null = document;
    let descriptor: PropertyDescriptor | undefined;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, "cookie");
      proto = Object.getPrototypeOf(proto);
    }
    const realSet = descriptor!.set!;
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      writes.push(value);
      realSet.call(document, value);
    });
    const { result } = renderHook(() => useConsent());

    act(() => result.current.acceptAll());
    const http = writes.filter((w) => w.startsWith(`${COOKIE_NAME}=`));
    expect(http.at(-1)).not.toContain("Secure");

    vi.stubGlobal("location", { protocol: "https:" });
    act(() => result.current.rejectAll());
    const https = writes.filter((w) => w.startsWith(`${COOKIE_NAME}=`));
    expect(https.at(-1)).toMatch(/; Secure$/);
  });
});

// ---------------------------------------------------------------------------
describe("useGpcHonored - jedno zrodlo prawdy dla klamr i not", () => {
  it("aktywny sygnal bez override'u jest honorowany", async () => {
    enableGpc();

    const { result } = renderHook(() => useGpcHonored());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("swiadoma zgoda przy aktywnym sygnale zdejmuje klamre w calej karcie", async () => {
    enableGpc();
    const honored = renderHook(() => useGpcHonored());
    const consent = renderHook(() => useConsent());
    await waitFor(() => expect(honored.result.current).toBe(true));

    act(() => consent.result.current.acceptAll());

    await waitFor(() => expect(honored.result.current).toBe(false));
  });

  it("decyzja z innej karty (zdarzenie storage) przywraca klamre", async () => {
    enableGpc();
    writeLocalState(stored({ marketing: true }, 1, { gpcOverrideAt: 1 }));
    const { result } = renderHook(() => useGpcHonored());
    await waitFor(() => expect(result.current).toBe(false));

    window.localStorage.removeItem(STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("bez sygnalu nic nie jest honorowane", async () => {
    const { result } = renderHook(() => useGpcHonored());

    await waitFor(() => expect(result.current).toBe(false));
  });
});

// ---------------------------------------------------------------------------
describe("useCategoryGranted i stare API marketingowe", () => {
  it("useCategoryGranted czyta kategorie po klamrze GPC", async () => {
    enableGpc();
    writeLocalState(stored({ functional: true, analytics: true }, 1));

    const functional = renderHook(() => useCategoryGranted("functional"));
    const analytics = renderHook(() => useCategoryGranted("analytics"));

    expect(functional.result.current).toBe(true);
    await waitFor(() => expect(analytics.result.current).toBe(false));
  });

  it("deny() cofa wylacznie marketing, reszta decyzji zostaje", async () => {
    writeLocalState(stored({ functional: true, analytics: true, marketing: true }, 1));
    const { result } = renderHook(() => useMarketingConsent());

    act(() => result.current.deny());

    await waitFor(() => expect(result.current.granted).toBe(false));
    expect(readLocalState()?.categories).toMatchObject({ functional: true, analytics: true });
  });

  it("deny() bez wczesniejszej decyzji zapisuje odmowe, a nie wyjatek", async () => {
    const { result } = renderHook(() => useMarketingConsent());

    act(() => result.current.deny());

    await waitFor(() => expect(result.current.decided).toBe(true));
    expect(result.current.granted).toBe(false);
    expect(readLocalState()?.categories.marketing).toBe(false);
  });

  it("grant() bez wczesniejszej decyzji zapisuje sam marketing", async () => {
    const { result } = renderHook(() => useMarketingConsent());

    act(() => result.current.grant());

    await waitFor(() => expect(result.current.granted).toBe(true));
    expect(readLocalState()?.categories).toMatchObject({ functional: false, analytics: false });
  });
});

// ---------------------------------------------------------------------------
describe("otwarcie preferencji i tryb podgladu z adresu", () => {
  it("zadanie otwarcia preferencji czeka w stanie modulu i jest konsumowane raz", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_PREFS_EVENT, listener);

    requestConsentPreferences();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeOpenPrefsRequest()).toBe(true);
    expect(consumeOpenPrefsRequest()).toBe(false);
    window.removeEventListener(OPEN_PREFS_EVENT, listener);
  });

  it("?consent-preview=1 wlacza zadanie podgladu, inne wartosci nie", () => {
    window.history.replaceState({}, "", "/wpis?consent-preview=1");
    expect(isConsentPreviewRequested()).toBe(true);

    window.history.replaceState({}, "", "/wpis?consent-preview=0");
    expect(isConsentPreviewRequested()).toBe(false);

    window.history.replaceState({}, "", "/wpis");
    expect(isConsentPreviewRequested()).toBe(false);
  });
});
