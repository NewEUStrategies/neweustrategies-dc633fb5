// Synchronizacja zgód CMP z profilem użytkownika (`profiles.prefs.consent`) i most
// do rejestru RODO. RYZYKO: to jedyne miejsce, w którym decyzja o zgodzie opuszcza
// przeglądarkę - a cała ścieżka jest asynchroniczna, „fire-and-forget" (`void
// syncConsentToProfile(...)`, `void import(...)`) i w całości owinięta w `catch {}`.
// Każdy błąd tej warstwy jest więc NIEWIDOCZNY: nie rzuca, nie loguje, nie zmienia
// UI - a mimo to potrafi skasować cudze preferencje albo WSKRZESIĆ wycofaną zgodę
// marketingową na drugim urządzeniu.
//
// CO TEN PLIK DOWODZI.
//   1. Gość (brak sesji) nie generuje ANI JEDNEGO zapytania do bazy przy zapisie
//      zgody. Asercja idzie na LICZNIK łańcuchów i wywołań RPC, nie na kształt
//      wyniku - bo funkcja zwraca `void` i przy błędzie wygląda identycznie jak
//      przy sukcesie. `tsc` nie widzi tu nic, recenzja czyta „jest early return".
//   2. Zapis z sesją SKLEJA prefs (`{...prevPrefs, consent}`) i zawęża update
//      przez `.eq("id", uid)`. Zgubione ogniwo `.eq` to zapis do CUDZEGO profilu -
//      błąd, który przechodzi przez typy, bo łańcuch PostgREST jest luźny.
//   3. DEFEKT (j2): błąd RPC `get_own_profile` jest ignorowany, `prevPrefs` schodzi
//      do `{}` i update NADPISUJE CAŁĄ kolumnę `prefs` samym kluczem `consent`.
//      Dowód stoi na ARGUMENTACH `.update()`, nie na wyniku.
//   4. Rozstrzyganie remote vs local po `ts` z OSTRYM `>`: równy znacznik oddaje
//      wygraną LOCAL. Jedna litera (`>` vs `>=`) decyduje, czy zgoda z profilu
//      nadpisze świeższą decyzję z tej karty.
//   5. DEFEKT (k2): gdy remote ISTNIEJE, ale jest STARSZY od local, nowsza decyzja
//      lokalna NIGDY nie jedzie do profilu (warunek wymaga BRAKU remote).
//   6. KOLEJNOŚĆ wywołań mostu: `backfillRegistryOnLogin` PRZED
//      `syncGpcSignalToRegistry` (`await` gwarantuje chronologię audytu).
//      Asercja na TABLICY KOLEJNOŚCI, nie na „został wywołany".
//   7. DEFEKT (H-D3): `clearConsent` nie propaguje wycofania ani do profilu, ani do
//      rejestru - najbliższe zdarzenie auth wskrzesza usuniętą zgodę z profilu.
//   8. Hydratacja jest osiągalna WYŁĄCZNIE przez callback przekazany do
//      `supabase.auth.onAuthStateChange`, wyłącznie dla SIGNED_IN / INITIAL_SESSION /
//      USER_UPDATED, a subskrypcja jest zwalniana przy unmount.
//   9. Trzy krawędzie udokumentowane bez `it.fails` (H-D4/H-D5/H-D6) - kontrakty do
//      świadomego przyjęcia albo domknięcia.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `src/lib/consent/__tests__/gpcCmpClamp.test.ts` - klamra GPC na `hasCategoryConsent`
//     i `isGpcCurrentlyHonored`. Tu sygnał GPC jest tylko WEJŚCIEM do kolejności mostu.
//   * `src/lib/consent/__tests__/registryBridgeSync.test.ts` i `registryBridge.test.ts` -
//     cała logika mostu (diff, metadane, kolejka FIFO, deduplikacja backfillu, flagi
//     localStorage). Ten plik asertuje wyłącznie FAKT, ARGUMENTY i KOLEJNOŚĆ wywołań.
//   * `src/lib/consent/__tests__/gpc.test.ts` - czysty rdzeń GPC.
//   * write-path (znacznik override'u, dwa nośniki, tryb prywatny), migracja legacy,
//     fallback cookie i tryb podglądu - osobne pliki tego zlecenia.
//
// CO JEST PODMIENIONE ATRAPĄ I DLACZEGO.
//   * `@/integrations/supabase/client` - BEZWZGLĘDNIE: realny moduł woła
//     `resolveSupabasePublicConfig()` na poziomie modułu i rzuca „Missing Supabase
//     environment variable(s)", więc bez atrapy `consent.ts` się nie zaimportuje.
//     Atrapa dokłada `onAuthStateChange`, którego nie ma w `supabaseAuthStub` -
//     i to jest JEDYNA droga do `hydrateConsentFromProfile`.
//   * `@/lib/consent/registryBridge` - realny most wciąga dynamicznie
//     `@/lib/consents.functions`, a ten na poziomie modułu woła `createServerFn`
//     z `@tanstack/react-start`. Atrapa ze spyami daje jednocześnie obserwowalność
//     ARGUMENTÓW i KOLEJNOŚCI, czego realny most (z własną kolejką) nie da.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import {
  fail,
  ok,
  supabaseAuthStub,
  supabaseFromStub,
  supabaseRpcStub,
  type SupabaseAuthStub,
  type SupabaseFromStub,
  type SupabaseRpcStub,
} from "@/test/supabase";
import {
  hasCategoryConsent,
  isGpcCurrentlyHonored,
  useConsent,
  useMarketingConsent,
  type ConsentCategory,
  type ConsentState,
} from "@/lib/ads/consent";

/** Spy mostu rejestru: zapisuje ARGUMENTY i wspólną KOLEJNOŚĆ wywołań. */
interface BridgeSpy {
  order: string[];
  syncCmpCalls: unknown[][];
  backfillCalls: unknown[][];
  gpcCalls: unknown[][];
  /** Wymuszenie awarii backfillu (odrzucony promise z wnętrza `.then`). */
  failBackfill: boolean;
}

const h = vi.hoisted(() => ({
  auth: null as unknown as SupabaseAuthStub,
  rpc: null as unknown as SupabaseRpcStub,
  from: null as unknown as SupabaseFromStub,
  bridge: null as unknown as BridgeSpy,
  /** Callbacki przechwycone z `onAuthStateChange` - JEDYNE wejście do hydratacji. */
  authCbs: [] as Array<(event: string) => void>,
  getSessionCalls: 0,
  unsubscribes: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => {
        h.getSessionCalls += 1;
        return h.auth.getSession();
      },
      // `supabaseAuthStub` nie zna `onAuthStateChange`, a bez kształtu
      // `{ data: { subscription: { unsubscribe } } }` cleanup w useConsent rzuca.
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authCbs.push(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                h.unsubscribes += 1;
              },
            },
          },
        };
      },
    },
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.rpc(name, args),
    from: (table: string) => h.from.from(table),
  },
}));

vi.mock("@/lib/consent/registryBridge", () => ({
  syncCmpDecisionToRegistry: (...args: unknown[]) => {
    h.bridge.order.push("syncCmp");
    h.bridge.syncCmpCalls.push(args);
    return Promise.resolve();
  },
  backfillRegistryOnLogin: (...args: unknown[]) => {
    h.bridge.order.push("backfill");
    h.bridge.backfillCalls.push(args);
    return h.bridge.failBackfill
      ? Promise.reject(new Error("test: rejestr niedostępny"))
      : Promise.resolve();
  },
  syncGpcSignalToRegistry: (...args: unknown[]) => {
    h.bridge.order.push("gpcWithdrawal");
    h.bridge.gpcCalls.push(args);
    return Promise.resolve();
  },
}));

const STORAGE_KEY = "consent:v2";
const COOKIE_NAME = "nes_cookie_consent";
/** 2026-01-01T00:00:00Z - ta sama stała, co w pozostałych testach tego obszaru. */
const BASE_TS = 1_767_225_600_000;
const NEWER_TS = BASE_TS + 60_000;
const OLDER_TS = BASE_TS - 60_000;

type Cats = Partial<Record<ConsentCategory, boolean>>;

function consentState(ts: number, cats: Cats, extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    ts,
    categories: {
      necessary: true,
      functional: !!cats.functional,
      analytics: !!cats.analytics,
      marketing: !!cats.marketing,
    },
    ...extra,
  };
}

/** Zapisuje decyzję TYLKO w localStorage - cookie zostaje puste na potrzeby asercji. */
function persistLocal(ts: number, cats: Cats, extra: Record<string, unknown> = {}): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consentState(ts, cats, extra)));
}

function readStored(): (ConsentState & Record<string, unknown>) | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ConsentState & Record<string, unknown>) : null;
}

function readConsentCookie(): ConsentState | null {
  const m = document.cookie.match(/(?:^|; )nes_cookie_consent=([^;]*)/);
  return m ? (JSON.parse(decodeURIComponent(m[1])) as ConsentState) : null;
}

function setNavigatorGpc(active: boolean | undefined): void {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    get: () => active,
  });
}

function clearAllCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/**
 * Odpluskwia łańcuch floating promises: `setConsent` robi `void
 * syncConsentToProfile(...)` ORAZ `void import(...)`, więc między wywołaniem
 * a zapytaniem do bazy jest kilka makrozadań (getSession -> rpc -> from ->
 * writeLocal -> setState). Pojedyncze `await Promise.resolve()` NIE wystarcza.
 */
async function settle(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Jedno zdarzenie auth dociera do WSZYSTKICH zarejestrowanych instancji hooka. */
async function fireAuth(event: string): Promise<void> {
  await act(async () => {
    for (const cb of [...h.authCbs]) cb(event);
    await settle();
  });
}

function resetStubs(uid: string | null): void {
  h.auth = supabaseAuthStub(uid);
  h.rpc = supabaseRpcStub();
  h.from = supabaseFromStub();
  h.bridge = {
    order: [],
    syncCmpCalls: [],
    backfillCalls: [],
    gpcCalls: [],
    failBackfill: false,
  };
  h.authCbs = [];
  h.getSessionCalls = 0;
  h.unsubscribes = 0;
}

/** Domyślny profil: prefs z `theme`/`notifications`, tabela `profiles` przyjmuje zapis. */
function planProfile(prefs: Record<string, unknown>): void {
  h.rpc.setData("get_own_profile", [{ prefs }]);
  h.from.setResponse("profiles", ok(null));
}

function updatedPrefs(): Record<string, unknown> | undefined {
  const payload = h.from.lastChain("profiles")?.argsOf("update")?.[0] as
    { prefs?: Record<string, unknown> } | undefined;
  return payload?.prefs;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearAllCookies();
  setNavigatorGpc(undefined);
  resetStubs("u1");
});

afterEach(() => {
  clearAllCookies();
  setNavigatorGpc(undefined);
});

// ---------------------------------------------------------------------------
// syncConsentToProfile
// ---------------------------------------------------------------------------

describe("syncConsentToProfile - wypchnięcie decyzji do profilu", () => {
  it("gość bez sesji NIE wykonuje ani jednego zapytania do bazy, a decyzja zostaje lokalnie", async () => {
    resetStubs(null);
    const { result } = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      result.current.save({ analytics: true });
      await settle();
    });

    // Asercja na LICZNIKACH: funkcja zwraca void, więc jedyny obserwowalny
    // kontrakt „nie ruszamy bazy" to zero wywołań RPC i zero łańcuchów.
    expect(h.getSessionCalls).toBeGreaterThan(0);
    expect(h.rpc.calls).toHaveLength(0);
    expect(h.from.chains).toHaveLength(0);
    // ...a sama decyzja i tak jest trwała na obu nośnikach.
    expect(readStored()?.categories.analytics).toBe(true);
    expect(readConsentCookie()?.categories.analytics).toBe(true);
  });

  it("z sesją: sync czyta prefs przez get_own_profile i pisze update ZAWĘŻONY do własnego id", async () => {
    planProfile({ theme: "dark", notifications: { email: true } });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      result.current.acceptAll();
      await settle();
    });

    expect(h.rpc.names()).toEqual(["get_own_profile"]);
    const prefs = updatedPrefs();
    // Sklejka, nie podmiana: pozostałe preferencje muszą przeżyć zapis zgody.
    expect(prefs?.theme).toBe("dark");
    expect(prefs?.notifications).toEqual({ email: true });
    const consent = prefs?.consent as ConsentState;
    expect(consent.source).toBe("profile");
    expect(consent.categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    });
    // Zgubione `.eq` to zapis do CUDZEGO profilu - `tsc` tego nie widzi.
    expect(h.from.lastChain("profiles")?.argsOf("eq")).toEqual(["id", "u1"]);
  });

  // DEFEKT j2. Ten `it.fails` i sąsiedni test STANU FAKTYCZNEGO poniżej opisują
  // tę samą lukę z dwóch stron - po naprawie USUWA SIĘ JE RAZEM.
  it.fails(
    "błąd RPC get_own_profile POWINIEN wstrzymać zapis prefs - inaczej zgoda kasuje pozostałe preferencje",
    async () => {
      h.rpc.setError("get_own_profile", "permission denied", "42501");
      h.from.setResponse("profiles", ok(null));
      const { result } = renderHookWithQueryClient(() => useConsent());

      await act(async () => {
        result.current.acceptAll();
        await settle();
      });

      // OCZEKIWANIE: nie znam poprzednich prefs, więc nie mam prawa nadpisać
      // całej kolumny. Poprawka = przerwać na `error` z RPC (albo merge po
      // stronie serwera). Dziś pole `error` jest ignorowane, `data` jest null,
      // `prevPrefs` schodzi do `{}` i update leci mimo wszystko.
      expect(h.from.chainsFor("profiles")).toHaveLength(0);
    },
  );

  it("STAN FAKTYCZNY (defekt j2): przy błędzie RPC update nadpisuje CAŁĄ kolumnę prefs samym kluczem consent", async () => {
    // Profil zawierał motyw i ustawienia powiadomień; RPC odmawia (RLS / brak
    // wiersza / chwilowa awaria), a zapis zgody i tak jedzie - i je kasuje.
    h.rpc.setError("get_own_profile", "permission denied", "42501");
    h.from.setResponse("profiles", ok(null));
    const { result } = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      result.current.acceptAll();
      await settle();
    });

    const prefs = updatedPrefs();
    expect(Object.keys(prefs ?? {})).toEqual(["consent"]);
    expect(prefs?.theme).toBeUndefined();
    expect(prefs?.notifications).toBeUndefined();
    // Stan LOKALNY przeżywa - dlatego użytkownik nie ma szansy tego zauważyć.
    expect(result.current.state?.categories.analytics).toBe(true);
    expect(readStored()?.categories.analytics).toBe(true);
  });

  it("awaria update profilu nie rzuca, nie cofa stanu lokalnego i NIE kasuje śladu audytowego", async () => {
    h.rpc.setData("get_own_profile", [{ prefs: { theme: "dark" } }]);
    h.from.setResponse("profiles", fail("network"));
    const { result } = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      result.current.save({ analytics: true }, "profile_privacy");
      await settle();
    });

    expect(result.current.state?.categories.analytics).toBe(true);
    expect(readStored()?.categories.analytics).toBe(true);
    // Most rejestru jest niezależną gałęzią - awaria profilu jej nie ubija.
    expect(h.bridge.syncCmpCalls).toHaveLength(1);
    expect(h.bridge.syncCmpCalls[0][2]).toBe("profile_privacy");
  });
});

// ---------------------------------------------------------------------------
// Brama zdarzeń auth - jedyne wejście do hydratacji
// ---------------------------------------------------------------------------

describe("hydrateConsentFromProfile - brama zdarzeń auth", () => {
  it("wylogowanie i odświeżenie tokenu NIE generują żadnego zapytania ani nie ruszają decyzji", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: true });
    planProfile({});
    const { result } = renderHookWithQueryClient(() => useConsent());
    const before = window.localStorage.getItem(STORAGE_KEY);

    await fireAuth("SIGNED_OUT");
    await fireAuth("TOKEN_REFRESHED");
    await fireAuth("PASSWORD_RECOVERY");

    expect(h.rpc.calls).toHaveLength(0);
    expect(h.from.chains).toHaveLength(0);
    expect(h.getSessionCalls).toBe(0);
    // Wylogowanie NIE czyści zgody - decyzja jest własnością przeglądarki.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(result.current.state?.categories.marketing).toBe(true);
  });

  it("SIGNED_IN, INITIAL_SESSION i USER_UPDATED uruchamiają dokładnie jedno get_own_profile", async () => {
    for (const event of ["SIGNED_IN", "INITIAL_SESSION", "USER_UPDATED"]) {
      resetStubs("u1");
      window.localStorage.clear();
      clearAllCookies();
      planProfile({});
      const { unmount } = renderHookWithQueryClient(() => useConsent());

      await fireAuth(event);

      expect(h.rpc.callsFor("get_own_profile"), `zdarzenie ${event}`).toHaveLength(1);
      unmount();
    }
  });

  it("unmount zwalnia subskrypcję onAuthStateChange", async () => {
    planProfile({});
    const { unmount } = renderHookWithQueryClient(() => useConsent());
    expect(h.authCbs).toHaveLength(1);
    expect(h.unsubscribes).toBe(0);

    unmount();

    // Bez `{ data: { subscription: { unsubscribe } } }` cleanup by tu rzucił -
    // dlatego atrapa musi odwzorować pełny kształt zwrotki Supabase.
    expect(h.unsubscribes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rozstrzyganie remote vs local
// ---------------------------------------------------------------------------

describe("hydrateConsentFromProfile - rozstrzyganie remote vs local po ts", () => {
  it("NOWSZY remote nadpisuje local na obu nośnikach i oznacza źródło jako profile", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
    planProfile({
      consent: consentState(NEWER_TS, { functional: true, analytics: true, marketing: true }),
    });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(result.current.state?.categories.analytics).toBe(true);
    expect(readStored()?.ts).toBe(NEWER_TS);
    expect(readStored()?.source).toBe("profile");
    // writeLocal pisze OBA nośniki - inaczej cookie odtworzyłoby starą decyzję.
    expect(readConsentCookie()?.ts).toBe(NEWER_TS);
    // Remote wygrał, więc nie ma po co pisać do profilu.
    expect(h.from.chainsFor("profiles")).toHaveLength(0);
  });

  it("RÓWNY ts oddaje wygraną LOCAL (warunek ma ostry '>'), a localStorage zostaje bajt w bajt", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
    const before = window.localStorage.getItem(STORAGE_KEY);
    planProfile({
      consent: consentState(BASE_TS, { functional: true, analytics: true, marketing: true }),
    });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    // Jedna litera (`>` vs `>=`) decyduje o tym, czy profil nadpisze świeższą
    // decyzję z tej karty. Przy remisie wygrywa to, co użytkownik widzi TERAZ.
    expect(result.current.state?.categories.analytics).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(readConsentCookie()).toBeNull();
  });

  it("STARSZY remote nie rusza decyzji lokalnej", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
    const before = window.localStorage.getItem(STORAGE_KEY);
    planProfile({
      consent: consentState(OLDER_TS, { functional: true, analytics: true, marketing: true }),
    });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(result.current.state?.categories.marketing).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("BRAK remote + istniejący local: decyzja lokalna jedzie do profilu dokładnie raz", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: false });
    planProfile({ theme: "dark" });
    renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(h.from.chainsFor("profiles")).toHaveLength(1);
    const prefs = updatedPrefs();
    expect(prefs?.theme).toBe("dark");
    expect((prefs?.consent as ConsentState).categories).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: false,
    });
  });

  it("BRAK remote i BRAK local: zero zapisów do profilu i zero wołań mostu rejestru", async () => {
    planProfile({});
    renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    // `resolved === null` - nie ma czego backfillować, więc audyt też milczy.
    expect(h.from.chainsFor("profiles")).toHaveLength(0);
    expect(h.bridge.order).toEqual([]);
  });

  // DEFEKT k2. `it.fails` + sąsiedni test STANU FAKTYCZNEGO - USUWAĆ RAZEM.
  it.fails(
    "nowsza decyzja lokalna POWINNA trafić do profilu także wtedy, gdy remote istnieje, ale jest starszy",
    async () => {
      // Realny scenariusz: użytkownik wycofał zgodę marketingową anonimowo
      // (nowszy local), a na koncie leży starsza zgoda z poprzedniej sesji.
      persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
      planProfile({
        consent: consentState(OLDER_TS, { functional: true, analytics: true, marketing: true }),
      });
      renderHookWithQueryClient(() => useConsent());

      await fireAuth("INITIAL_SESSION");

      // OCZEKIWANIE: warunek push-a powinien brzmieć „brak remote LUB local
      // nowszy", a nie tylko „brak remote". Dziś gałąź `else` robi zapis
      // WYŁĄCZNIE dla `!remote && local`, więc profil zostaje przedawniony.
      expect(h.from.chainsFor("profiles")).toHaveLength(1);
    },
  );

  it("STAN FAKTYCZNY (defekt k2): profil zostaje z przedawnioną zgodą, a drugie urządzenie odtwarza ją w PEŁNYM zakresie", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
    planProfile({
      consent: consentState(OLDER_TS, { functional: true, analytics: true, marketing: true }),
    });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    // Ta karta honoruje nowsze wycofanie...
    expect(result.current.state?.categories.marketing).toBe(false);
    // ...ale profil nigdy się o nim nie dowiedział.
    expect(h.from.chainsFor("profiles")).toHaveLength(0);

    // Drugie urządzenie = ten sam profil, ZERO stanu lokalnego.
    window.localStorage.clear();
    clearAllCookies();
    await fireAuth("INITIAL_SESSION");

    // Wycofana zgoda „odżywa" - także marketing.
    expect(result.current.state?.categories.marketing).toBe(true);
    expect(readStored()?.categories.analytics).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kolejność wywołań mostu rejestru RODO
// ---------------------------------------------------------------------------

describe("hydrateConsentFromProfile - most rejestru RODO", () => {
  it("backfill rejestru leci PRZED wycofaniem GPC, z sygnałem i identyfikatorem podmiotu", async () => {
    setNavigatorGpc(true);
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: true });
    planProfile({
      consent: consentState(BASE_TS, { functional: true, analytics: true, marketing: true }),
    });
    renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    // KOLEJNOŚĆ, nie tylko obecność: `await` przed warunkiem gwarantuje, że
    // audyt widzi najpierw stan, a potem jego wycofanie sygnałem GPC.
    expect(h.bridge.order).toEqual(["backfill", "gpcWithdrawal"]);
    expect(h.bridge.backfillCalls[0][1]).toBe("u1");
    expect(h.bridge.backfillCalls[0][2]).toBe(true);
    expect((h.bridge.backfillCalls[0][0] as ConsentState).ts).toBe(BASE_TS);
    expect(h.bridge.gpcCalls[0]).toEqual(["u1"]);
  });

  it("świadomy override sygnału zdejmuje wycofanie GPC, ale NIE zdejmuje backfillu", async () => {
    setNavigatorGpc(true);
    persistLocal(
      BASE_TS,
      { functional: true, analytics: true, marketing: true },
      { gpcOverrideAt: BASE_TS + 1_000 },
    );
    planProfile({
      consent: consentState(BASE_TS, { functional: true, analytics: true, marketing: true }),
    });
    renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(h.bridge.order).toEqual(["backfill"]);
    // Sygnał nadal JEST aktywny - most dostaje o tym informację, mimo że
    // wycofania nie zapisujemy (użytkownik świadomie je nadpisał).
    expect(h.bridge.backfillCalls[0][2]).toBe(true);
  });

  it("bez sygnału GPC leci sam backfill, z gpcActive=false", async () => {
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: true });
    planProfile({
      consent: consentState(BASE_TS, { functional: true, analytics: true, marketing: true }),
    });
    renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(h.bridge.order).toEqual(["backfill"]);
    expect(h.bridge.backfillCalls[0][2]).toBe(false);
  });

  it("awaria mostu rejestru nie rzuca i nie psuje rozstrzygniętego stanu zgód", async () => {
    h.bridge.failBackfill = true;
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: false });
    const before = window.localStorage.getItem(STORAGE_KEY);
    planProfile({
      consent: consentState(BASE_TS, { functional: true, analytics: false, marketing: false }),
    });
    const { result } = renderHookWithQueryClient(() => useConsent());

    await fireAuth("INITIAL_SESSION");

    expect(result.current.state?.categories.analytics).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(h.bridge.order).toEqual(["backfill"]);
    expect(h.bridge.gpcCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEFEKT H-D3: wycofanie zgody nie opuszcza przeglądarki
// ---------------------------------------------------------------------------

describe("clearConsent - propagacja wycofania", () => {
  function planResurrection() {
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: true });
    planProfile({
      theme: "dark",
      consent: consentState(NEWER_TS, { functional: true, analytics: true, marketing: true }),
    });
  }

  // DEFEKT H-D3 - najpoważniejszy na tej powierzchni. `it.fails` + sąsiedni test
  // STANU FAKTYCZNEGO poniżej - USUWAĆ RAZEM po naprawie.
  it.fails(
    "wyczyszczenie zgód POWINNO być wycofaniem: nie wolno, by najbliższe zdarzenie auth wskrzesiło usuniętą zgodę",
    async () => {
      planResurrection();
      const { result } = renderHookWithQueryClient(() => useConsent());

      await act(async () => {
        result.current.clear();
        await settle();
      });
      expect(result.current.state).toBeNull();

      // Zalogowany użytkownik odświeża stronę - to jest INITIAL_SESSION.
      await fireAuth("INITIAL_SESSION");

      // OCZEKIWANIE 1: wycofanie jest DECYZJĄ, więc `clearConsent` musi (jak
      // `setConsent`) wypchnąć ją do `profiles.prefs.consent`. Wtedy remote nie
      // istnieje i nie ma czego wskrzeszać.
      expect(result.current.state).toBeNull();
      expect(readStored()).toBeNull();
      // OCZEKIWANIE 2: wycofanie zgody musi zostawić ślad w rejestrze RODO -
      // art. 7 ust. 3 wymaga, by wycofanie było równie udokumentowane jak
      // udzielenie. Dziś most nie jest wołany wcale.
      expect(h.bridge.syncCmpCalls).toHaveLength(1);
    },
  );

  it("STAN FAKTYCZNY (defekt H-D3): clear() nie pisze ani do profilu, ani do rejestru, a INITIAL_SESSION przywraca zgodę wraz z marketingiem", async () => {
    planResurrection();
    const { result } = renderHookWithQueryClient(() => useConsent());

    await act(async () => {
      result.current.clear();
      await settle();
    });

    // Lokalnie wycofanie działa: oba nośniki puste, baner wraca.
    expect(result.current.state).toBeNull();
    expect(readStored()).toBeNull();
    expect(readConsentCookie()).toBeNull();
    // Ale nic nie opuściło przeglądarki: zero zapisów i zero śladu w audycie.
    expect(h.from.chainsFor("profiles")).toHaveLength(0);
    expect(h.bridge.syncCmpCalls).toHaveLength(0);

    await fireAuth("INITIAL_SESSION");

    // Zgoda wraca w PEŁNYM zakresie - także marketing, którego użytkownik
    // właśnie się pozbył. Z jego perspektywy „wyczyść zgody" nie zadziałało.
    expect(result.current.state?.categories.marketing).toBe(true);
    expect(readStored()?.source).toBe("profile");
    expect(readStored()?.ts).toBe(NEWER_TS);
  });
});

// ---------------------------------------------------------------------------
// Krawędzie udokumentowane (bez it.fails): kontrakty do przyjęcia albo domknięcia
// ---------------------------------------------------------------------------

describe("udokumentowane krawędzie warstwy synchronizacji", () => {
  it("H-D4: grant() ze starego API marketingowego MINTUJE override GPC, choć nic nie dowodzi, że użytkownik widział notę", async () => {
    // `gpc.ts` deklaruje, że obecność `gpcOverrideAt` sama dowodzi widocznej
    // noty o GPC. Implementacja sprawdza WYŁĄCZNIE `signal.active`, więc każda
    // powierzchnia „włącz reklamy" zdejmie sygnał bez pokazania czegokolwiek.
    // Dziś jedyny konsument (`AdSlot`) czyta tylko `granted` i nie woła grant() -
    // szkoda jest utajona, ale kontrakt trzeba przyjąć świadomie.
    setNavigatorGpc(true);
    persistLocal(BASE_TS, { functional: true, analytics: false, marketing: false });
    planProfile({});
    const { result } = renderHookWithQueryClient(() => useMarketingConsent());

    await act(async () => {
      result.current.grant();
      await settle();
    });

    const override = readStored()?.gpcOverrideAt;
    expect(typeof override).toBe("number");
    expect(override as number).toBeGreaterThan(0);
    expect(isGpcCurrentlyHonored()).toBe(false);
    expect(hasCategoryConsent("marketing")).toBe(true);
  });

  it("H-D5: PIERWSZY render klienta widzi zgodę z localStorage, choć SSR wyrenderował ją jako nieznaną", async () => {
    // `useState(() => readLocal())` czyta nośnik już w inicjalizatorze, a
    // `decided: mounted ? !!state : true` udaje odpowiedź serwerową. Skutek:
    // dla osoby ze zgodą marketingową SSR rysuje zasłonę, a pierwszy render
    // klienta - slot reklamowy. To jest rozjazd hydratacji u konsumenta
    // (`AdSlot` nie bramkuje się `mounted`).
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: true });
    planProfile({});
    const seen: Array<{ mounted: boolean; hasState: boolean; granted: boolean }> = [];

    renderHookWithQueryClient(() => {
      const consent = useConsent();
      const marketing = useMarketingConsent();
      seen.push({
        mounted: consent.mounted,
        hasState: consent.state !== null,
        granted: marketing.granted,
      });
      return consent;
    });

    // PIERWSZY render: efekty jeszcze nie poszły (`mounted === false`), a stan
    // jest już wczytany - czyli inaczej niż w HTML z serwera.
    expect(seen[0].mounted).toBe(false);
    expect(seen[0].hasState).toBe(true);
    expect(seen[0].granted).toBe(true);
  });

  it("H-D6: jedno zdarzenie auth przy DWÓCH instancjach hooka wykonuje zapis do profilu DWA razy - brak deduplikacji", async () => {
    // Deduplikacja istnieje tylko w moście rejestru (`backfillInFlight`),
    // nie dla zapisu do profilu. W produkcji instancji jest więcej niż dwie
    // (__root, baner, injector, panele, każdy AdSlot), a nadpisania są
    // idempotentne - szkody funkcjonalnej nie ma, jest zwielokrotniony ruch.
    persistLocal(BASE_TS, { functional: true, analytics: true, marketing: false });
    planProfile({ theme: "dark" });
    renderHookWithQueryClient(() => useConsent());
    renderHookWithQueryClient(() => useConsent());
    expect(h.authCbs).toHaveLength(2);

    await fireAuth("INITIAL_SESSION");

    // Dwa niezależne odczyty profilu i DWA niezależne zapisy tej samej wartości.
    // Świadomie NIE liczymy tu wywołań mostu rejestru: jego deduplikacja
    // (`backfillInFlight`) jest jego własnym kontraktem i ma swój test.
    expect(h.from.chainsFor("profiles")).toHaveLength(2);
    expect(h.rpc.callsFor("get_own_profile")).toHaveLength(4);
  });
});
