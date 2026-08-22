// MOST CMP -> REJESTR RODO: strona ASYNCHRONICZNA (`registryBridge.ts` - 27%).
//
// CO JUŻ JEST POKRYTE, A CZEGO NIE. `registryBridge.test.ts` i
// `gpcRegistry.test.ts` pokrywają CZYSTE funkcje modułu (mapowanie kategorii,
// `diffCmpCategories`, `buildRegistryEntries`, `buildGpcWithdrawalEntries`,
// `gpcWithdrawalsNeeded`, `normalizeDecisionSource`). Ten plik pokrywa to,
// czego tamte świadomie nie dotykają: ORKIESTRACJĘ - kolejkę zapisów,
// deduplikację, wykrycie języka, metadane decyzji, backfill przy logowaniu
// i wycofanie wymuszone sygnałem GPC. To tu mieszkają defekty, które
// unieważniają ślad audytowy, a nie te, które psują mapę kluczy.
//
// TRZY ZDANIA, KTÓRE TEN PLIK MA UDOWODNIĆ:
//
//   1. WYCOFANIE ZGODY PROPAGUJE SIĘ. Zdjęcie kategorii analitycznej dochodzi
//      do rejestru z wartością `given: false` - dla WSZYSTKICH klamrowanych
//      kluczy, także tych, których CMP nie zna (`personalization`), i także
//      wtedy, gdy klucz doszedł do katalogu po fakcie.
//   2. KOLEJNOŚĆ AUDYTU = KOLEJNOŚĆ DECYZJI. Dwie szybkie decyzje to dwa
//      niezależne żądania; bez kolejki FIFO starszy, wolniejszy zapis mógłby
//      nadpisać nowszą decyzję i pomieszać chronologię. Kolejka nie może też
//      PĘKAĆ na błędzie jednego zadania.
//   3. REJESTR NIE JEST WARUNKIEM DZIAŁANIA CMP. Brak sesji, offline i błąd
//      serwera nie mogą rzucić - decyzja cookie jest już trwała lokalnie,
//      a rejestr jest najlepszym możliwym śladem, nie bramką.
//
// PLUS: JEDNA DECYZJA = JEDEN IDENTYFIKATOR. Kliknięcie „Zapisz” zmieniające
// trzy kategorie musi dać w audycie JEDNĄ decyzję o trzech kategoriach, a nie
// trzy niezależne zdarzenia. To `withDecisionMetadata`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - RPC `set_user_consent`: utwardzony SECURITY DEFINER z własnym pgTAP
//   (`consent_evidence_hardening_test.sql`). Tabele intake są zamknięte dla
//   klienta (inwariant `check:sql-anon-insert`), więc test na atrapie nie
//   odtwarza tych reguł - sprawdza, CO aplikacja do niego wysyła.
// - BRAMKOWANIA SKRYPTÓW: stan runtime zgód zapisuje ścieżka CMP
//   (`src/lib/ads/consent.ts`), a rejestr NIGDY nie jest źródłem prawdy dla
//   bramkowania. Ten plik nie sprawdza, czy skrypt się wykonał.
// - MAPY KATEGORII i WERSJI KATALOGU: `registryBridge.test.ts`.
//
// RODO: żadnych realnych danych osobowych ani adresów IP w fixture'ach.
// Identyfikatory użytkowników są umowne, adres strony to `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsentState } from "@/lib/ads/consent";

const h = vi.hoisted(() => ({
  /** Partie wpisów, jakie most wysłał do warstwy serwerowej. */
  bulkCalls: [] as { entries: Record<string, unknown>[] }[],
  /** Kolejność ZAKOŃCZENIA zapisów - dowód działania kolejki FIFO. */
  completed: [] as string[],
  /** Ile razy most zapytał rejestr o obecny stan. */
  listCalls: 0,
  /** Odpowiedź `listMyConsents`. */
  registryRows: [] as { consent_key: string; given: boolean }[],
  /** Gdy ustawione, `setMyConsentsBulk` rzuca tym błędem. */
  bulkError: null as Error | null,
  /** Gdy ustawione, `listMyConsents` rzuca tym błędem. */
  listError: null as Error | null,
  /**
   * Ręcznie zwalniane zapisy: gdy `true`, każde `setMyConsentsBulk` czeka na
   * `release()`. Pozwala dowieść kolejności FIFO BEZ `setTimeout`.
   */
  gate: false,
  releases: [] as (() => void)[],
  /** Sesja widziana przez most - `null` = użytkownik niezalogowany. */
  sessionUserId: "11111111-1111-4111-8111-111111111111" as string | null,
  /** Gdy `true`, `auth.getSession()` rzuca (offline). */
  sessionThrows: false,
}));

vi.mock("@/lib/consents.functions", () => ({
  setMyConsentsBulk: async ({ data }: { data: { entries: Record<string, unknown>[] } }) => {
    h.bulkCalls.push(data);
    const label = String(data.entries[0]?.key ?? "?");
    if (h.gate) {
      await new Promise<void>((resolve) => h.releases.push(resolve));
    }
    if (h.bulkError) throw h.bulkError;
    h.completed.push(label);
    return { saved: data.entries.map((entry) => String(entry.key)) };
  },
  listMyConsents: async () => {
    h.listCalls += 1;
    if (h.listError) throw h.listError;
    return h.registryRows;
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (h.sessionThrows) throw new Error("offline");
        return {
          data: {
            session: h.sessionUserId ? { user: { id: h.sessionUserId } } : null,
          },
        };
      },
    },
  },
}));

import {
  AUDITABLE_CMP_CATEGORIES,
  CMP_TO_REGISTRY,
  CONSENT_BANNER_VERSION,
  REGISTRY_SYNC_EVENT,
  backfillRegistryOnLogin,
  syncCmpDecisionToRegistry,
  syncGpcSignalToRegistry,
  withDecisionMetadata,
  type RegistryEntry,
} from "@/lib/consent/registryBridge";
import { GPC_CLAMPED_REGISTRY_KEYS } from "@/lib/consent/gpc";

/** Ustalona data bazowa - żadnego `Date.now()`. */
const BASE_TS = 1767225600000; // 2026-01-01T00:00:00Z
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

function state(
  cats: Partial<Record<"functional" | "analytics" | "marketing", boolean>>,
): ConsentState {
  return {
    version: 2,
    ts: BASE_TS,
    categories: {
      necessary: true,
      functional: !!cats.functional,
      analytics: !!cats.analytics,
      marketing: !!cats.marketing,
    },
  };
}

/** Wszystkie wpisy ze wszystkich partii, spłaszczone. */
function allEntries(): Record<string, unknown>[] {
  return h.bulkCalls.flatMap((call) => call.entries);
}

function entryFor(key: string): Record<string, unknown> | undefined {
  return allEntries().find((entry) => entry.key === key);
}

beforeEach(() => {
  h.bulkCalls = [];
  h.completed = [];
  h.listCalls = 0;
  h.registryRows = [];
  h.bulkError = null;
  h.listError = null;
  h.gate = false;
  h.releases = [];
  h.sessionUserId = USER;
  h.sessionThrows = false;
  // Flagi deduplikacji żyją w localStorage - każdy test startuje na czysto.
  window.localStorage.clear();
  document.documentElement.lang = "pl";
});

afterEach(() => {
  // Zwolnij ewentualne zawieszone zapisy, żeby nie przeciekły do kolejnego testu.
  for (const release of h.releases) release();
  h.releases = [];
});

// ---------------------------------------------------------------------------
// 1. WYCOFANIE ZGODY PROPAGUJE SIĘ DO REJESTRU.
// ---------------------------------------------------------------------------

describe("syncCmpDecisionToRegistry - wycofanie i udzielenie zgody", () => {
  it("zdjęcie kategorii analitycznej dociera do rejestru jako `given: false`", async () => {
    // Wycofanie zgody (art. 7 ust. 3 RODO) musi mieć ślad audytowy, nie tylko
    // skutek w runtime. Bez tego nie da się dowieść, KIEDY zgoda przestała
    // obowiązywać - a to jest pytanie, które zadaje organ nadzorczy.
    await syncCmpDecisionToRegistry(
      state({ analytics: true, marketing: true }),
      state({ analytics: false, marketing: true }),
      "cmp_banner",
    );
    expect(h.bulkCalls).toHaveLength(1);
    // Zmieniła się JEDNA kategoria, więc w audycie jest JEDEN wpis - zero szumu.
    expect(h.bulkCalls[0].entries).toHaveLength(1);
    expect(entryFor("cookies_analytics")).toMatchObject({
      key: "cookies_analytics",
      given: false,
      source: "cmp_banner",
    });
  });

  it("udzielenie zgody dociera jako `given: true`", async () => {
    await syncCmpDecisionToRegistry(state({}), state({ analytics: true }), "profile_privacy");
    expect(entryFor("cookies_analytics")).toMatchObject({ given: true, source: "profile_privacy" });
  });

  it("PIERWSZA decyzja loguje WSZYSTKIE trzy kategorie jedną partią", async () => {
    // Brak poprzedniego stanu = każda kategoria jest świeżą decyzją; wszystkie
    // muszą wylądować w audycie, także te odrzucone.
    await syncCmpDecisionToRegistry(null, state({ functional: true }), "cmp_banner");
    expect(h.bulkCalls).toHaveLength(1);
    expect(h.bulkCalls[0].entries).toHaveLength(AUDITABLE_CMP_CATEGORIES.length);
    for (const category of AUDITABLE_CMP_CATEGORIES) {
      expect(entryFor(CMP_TO_REGISTRY[category]), `brak wpisu dla ${category}`).toBeTruthy();
    }
    expect(entryFor("cookies_functional")).toMatchObject({ given: true });
    expect(entryFor("cookies_analytics")).toMatchObject({ given: false });
  });

  it("decyzja BEZ ZMIAN nie dotyka rejestru - i nie pyta nawet o sesję", async () => {
    // Ponowny klik „Zapisz” nie jest nową decyzją. Zapis bez zmian zamieniłby
    // historię zgód w log kliknięć, a każdy wpis niesie IP i UA.
    const same = state({ analytics: true });
    await syncCmpDecisionToRegistry(same, state({ analytics: true }), "cmp_banner");
    expect(h.bulkCalls).toHaveLength(0);
  });

  it("BRAK SESJI nie zapisuje niczego i NIE RZUCA", async () => {
    // Decyzja anonimowa jest trwała lokalnie; rejestr dostanie ją przy
    // logowaniu (backfill). Rzut zablokowałby zamknięcie banera.
    h.sessionUserId = null;
    await expect(
      syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner"),
    ).resolves.toBeUndefined();
    expect(h.bulkCalls).toHaveLength(0);
  });

  it("AWARIA odczytu sesji (offline) nie rzuca", async () => {
    h.sessionThrows = true;
    await expect(
      syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner"),
    ).resolves.toBeUndefined();
    expect(h.bulkCalls).toHaveLength(0);
  });

  it("BŁĄD ZAPISU po stronie serwera nie rzuca - rejestr jest best-effort", async () => {
    h.bulkError = new Error("not_authorized");
    await expect(
      syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner"),
    ).resolves.toBeUndefined();
    // Próba BYŁA - cichy brak próby byłby czymś innym niż cicha porażka.
    expect(h.bulkCalls).toHaveLength(1);
  });

  it("źródło decyzji jest SANITYZOWANE - przypadkowy `MouseEvent` schodzi na baner", async () => {
    // `acceptAll`/`rejectAll` bywają podpinane wprost pod `onClick`, więc
    // pierwszym argumentem może być zdarzenie. Nieznane źródło w kolumnie
    // audytu byłoby wartością, której nikt nie potrafi zinterpretować.
    // BEZ RZUTOWANIA. Typ parametru zabrania tu obiektu zdarzenia, ale runtime
    // nie - a to właśnie ta różnica jest przedmiotem testu. Wywołanie idzie
    // więc przez interfejs z metodą (składnia metodowa jest w TS biwariantna,
    // więc przypisanie funkcji o WĘŻSZYM parametrze jest legalne), a nie przez
    // `as unknown as`, które kasowałoby kontrolę typów w całym wyrażeniu.
    interface LooseSync {
      call(prev: null, next: ConsentState, source: unknown): Promise<void>;
    }
    const loose: LooseSync = { call: syncCmpDecisionToRegistry };
    await loose.call(null, state({ analytics: true }), { type: "click" });
    expect(entryFor("cookies_analytics")).toMatchObject({ source: "cmp_banner" });
  });

  it("znacznik GPC schodzi do wpisu - i domyślnie jest `false`, nie wymyślany", async () => {
    // Kolumna `user_consent_events.gpc` odpowiada na pytanie „czy zgoda została
    // udzielona WBREW sygnałowi opt-outu". Wymyślone `true` byłoby zarzutem
    // wobec użytkownika; wymyślone `false` ukryciem sygnału.
    await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner", true);
    expect(entryFor("cookies_analytics")).toMatchObject({ gpc: true });

    h.bulkCalls = [];
    await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
    expect(entryFor("cookies_analytics")).toMatchObject({ gpc: false });
  });

  it("język jest wykrywany z atrybutu dokumentu - `en`, `pl` i brak rozpoznania", async () => {
    // Wersja treści, na którą ktoś się zgodził, ma język. Zapis bez języka nie
    // pozwala odtworzyć, JAKI tekst zgody osoba widziała.
    for (const [lang, expected] of [
      ["en-GB", "en"],
      ["pl-PL", "pl"],
      ["de", undefined],
      ["", undefined],
    ] as const) {
      h.bulkCalls = [];
      document.documentElement.lang = lang;
      await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
      expect(entryFor("cookies_analytics")?.lang, `lang=${lang}`).toBe(expected);
    }
  });

  it("po zapisie leci ZDARZENIE synchronizacji - panele odświeżają swoje zapytania", async () => {
    // Panel `/profile/privacy` czyta rejestr własnym zapytaniem; bez tego
    // zdarzenia pokazywałby stan sprzed decyzji do najbliższego przeładowania.
    const seen: string[] = [];
    const listener = () => seen.push(REGISTRY_SYNC_EVENT);
    window.addEventListener(REGISTRY_SYNC_EVENT, listener);
    try {
      await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
      expect(seen).toEqual([REGISTRY_SYNC_EVENT]);
    } finally {
      window.removeEventListener(REGISTRY_SYNC_EVENT, listener);
    }
  });

  it("zdarzenie NIE leci, gdy zapis się nie udał", async () => {
    h.bulkError = new Error("not_authorized");
    const seen: string[] = [];
    const listener = () => seen.push(REGISTRY_SYNC_EVENT);
    window.addEventListener(REGISTRY_SYNC_EVENT, listener);
    try {
      await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener(REGISTRY_SYNC_EVENT, listener);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. JEDNA DECYZJA = JEDEN IDENTYFIKATOR.
// ---------------------------------------------------------------------------

describe("withDecisionMetadata - metadane wspólne dla partii", () => {
  function entries(...keys: string[]): RegistryEntry[] {
    return keys.map((key) => ({ key, given: false, version: "2.0" }));
  }

  it("wszystkie wpisy JEDNEJ decyzji dostają TEN SAM identyfikator", () => {
    // Bez wspólnego id audytor widziałby trzy niezależne zdarzenia zamiast
    // jednej decyzji obejmującej trzy kategorie - i nie umiałby odpowiedzieć,
    // ile razy użytkownik naprawdę podejmował decyzję.
    const stamped = withDecisionMetadata(
      entries("cookies_functional", "cookies_analytics", "cookies_marketing"),
    );
    const ids = new Set(stamped.map((entry) => entry.decisionId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTypeOf("string");
  });

  it("DWIE decyzje dostają RÓŻNE identyfikatory", () => {
    const first = withDecisionMetadata(entries("cookies_analytics"))[0].decisionId;
    const second = withDecisionMetadata(entries("cookies_analytics"))[0].decisionId;
    expect(first).not.toBe(second);
  });

  it("wersja banera jest wyprowadzona z katalogu, nie z drugiego licznika", () => {
    // Jeden licznik: bump treści banera przez wersję kategorii cookie
    // automatycznie odcina stare decyzje w audycie.
    const stamped = withDecisionMetadata(entries("cookies_analytics"));
    expect(stamped[0].bannerVersion).toBe(CONSENT_BANNER_VERSION);
    expect(CONSENT_BANNER_VERSION).toMatch(/^cmp-v/);
  });

  it("adres strony jest bez części zapytania - ta może nieść dane osobowe", () => {
    // `?email=` albo `?token=` w kolumnie audytu byłoby wyciekiem przez ślad,
    // który powstaje właśnie po to, żeby chronić dane.
    window.history.replaceState({}, "", "/regulamin?email=ktos@example.org&utm=x");
    try {
      const stamped = withDecisionMetadata(entries("cookies_analytics"));
      expect(stamped[0].pageUrl).toContain("/regulamin");
      expect(stamped[0].pageUrl).not.toContain("email");
      expect(stamped[0].pageUrl).not.toContain("?");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("metadane JUŻ USTAWIONE nie są nadpisywane", () => {
    // Wpis przygotowany wyżej (np. przez backfill z własnym id decyzji) musi
    // zachować swoją tożsamość - inaczej dwie różne decyzje scalają się w jedną.
    const stamped = withDecisionMetadata([
      {
        key: "cookies_analytics",
        given: false,
        version: "2.0",
        decisionId: "33333333-3333-4333-8333-333333333333",
        bannerVersion: "cmp-v1.0",
        pageUrl: "https://example.org/inna",
      },
    ]);
    expect(stamped[0]).toMatchObject({
      decisionId: "33333333-3333-4333-8333-333333333333",
      bannerVersion: "cmp-v1.0",
      pageUrl: "https://example.org/inna",
    });
  });

  it("BRAK `crypto.randomUUID` nie blokuje decyzji - identyfikator zostaje pusty", () => {
    // Starsze przeglądarki (i konteksty niezabezpieczone) nie mają
    // `randomUUID`. Rzut w tym miejscu zabiłby zapis decyzji cookie, więc
    // identyfikator jest OPCJONALNY: audyt straci grupowanie kategorii, ale
    // sama decyzja i jej wersja zostaną zapisane.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const stamped = withDecisionMetadata([
        { key: "cookies_analytics", given: false, version: "2.0" },
      ]);
      expect(stamped[0].decisionId).toBeUndefined();
      // Reszta metadanych MUSI dojść - brak jednego pola nie może zabrać resztę.
      expect(stamped[0].bannerVersion).toBe(CONSENT_BANNER_VERSION);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
  });

  it("`randomUUID` rzucające wyjątkiem też nie blokuje decyzji", () => {
    // W kontekście niezabezpieczonym `crypto` istnieje, ale `randomUUID`
    // rzuca - to inna gałąź niż brak metody.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: {
        randomUUID: () => {
          throw new Error("insecure context");
        },
      },
      configurable: true,
    });
    try {
      const stamped = withDecisionMetadata([
        { key: "cookies_analytics", given: false, version: "2.0" },
      ]);
      expect(stamped[0].decisionId).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
      else Reflect.deleteProperty(globalThis, "crypto");
    }
  });

  it("metadane docierają do warstwy serwerowej razem z decyzją", async () => {
    await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
    const entry = entryFor("cookies_analytics");
    expect(entry?.bannerVersion).toBe(CONSENT_BANNER_VERSION);
    expect(entry?.decisionId).toBeTypeOf("string");
  });
});

// ---------------------------------------------------------------------------
// 3. KOLEJNOŚĆ AUDYTU = KOLEJNOŚĆ DECYZJI.
// ---------------------------------------------------------------------------

describe("kolejka zapisów - chronologia audytu", () => {
  it("dwa szybkie zapisy wychodzą SZEREGOWO, w kolejności decyzji", async () => {
    // Dowód bez `setTimeout`: bramka wstrzymuje pierwszy zapis, drugi zostaje
    // wywołany dopiero po jego zwolnieniu. Gdyby zapisy leciały równolegle,
    // `bulkCalls` miałoby dwa wpisy PRZED zwolnieniem.
    h.gate = true;
    const first = syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
    const second = syncCmpDecisionToRegistry(
      state({ analytics: true }),
      state({ analytics: false }),
      "profile_privacy",
    );
    // Czekamy, aż pierwszy zapis dojdzie do bramki.
    await vi.waitFor(() => expect(h.releases).toHaveLength(1));
    expect(h.bulkCalls).toHaveLength(1);

    h.releases[0]();
    await vi.waitFor(() => expect(h.releases).toHaveLength(2));
    expect(h.bulkCalls).toHaveLength(2);
    h.releases[1]();

    await Promise.all([first, second]);
    // Kolejność ZAKOŃCZENIA odpowiada kolejności decyzji.
    expect(h.completed).toEqual(["cookies_functional", "cookies_analytics"]);
  });

  it("BŁĄD jednego zapisu NIE PĘKA kolejki - następne decyzje przechodzą", async () => {
    // Zadania łykają własne błędy, a łańcuch łapie odrzucenie. Bez tego jedna
    // porażka sieci zamykałaby rejestr do końca sesji karty - i to bez śladu.
    h.bulkError = new Error("network");
    await syncCmpDecisionToRegistry(null, state({ analytics: true }), "cmp_banner");
    h.bulkError = null;
    await syncCmpDecisionToRegistry(
      state({ analytics: true }),
      state({ analytics: false }),
      "profile_privacy",
    );
    expect(h.bulkCalls).toHaveLength(2);
    expect(h.completed).toEqual(["cookies_analytics"]);
  });
});

// ---------------------------------------------------------------------------
// 4. BACKFILL PRZY LOGOWANIU.
// ---------------------------------------------------------------------------

describe("backfillRegistryOnLogin - konto bez śladu w audycie", () => {
  it("PUSTY rejestr dostaje wpisy dla wszystkich trzech kategorii", async () => {
    // Dwa przypadki naraz: decyzja podjęta anonimowo, która właśnie zyskała
    // podmiot, oraz konto sprzed unifikacji (profil zsynchronizowany, zero
    // śladu w audycie). Późniejsze zapisy diffują tylko ZMIENIONE kategorie,
    // więc bez backfillu nietknięte nigdy nie dostałyby wpisu.
    h.registryRows = [];
    await backfillRegistryOnLogin(state({ analytics: true }), USER);
    expect(h.listCalls).toBe(1);
    expect(h.bulkCalls).toHaveLength(1);
    expect(h.bulkCalls[0].entries).toHaveLength(AUDITABLE_CMP_CATEGORIES.length);
    expect(entryFor("cookies_analytics")).toMatchObject({
      given: true,
      source: "login_sync",
    });
  });

  it("uzupełnia TYLKO BRAKUJĄCE klucze - istniejących wpisów nie nadpisuje", async () => {
    // Świadomy zakres: rozjazd wartości domyka pierwsza jawna decyzja. Nadpisanie
    // istniejącego wpisu stanem z TEGO urządzenia zmieniłoby cudzą decyzję.
    h.registryRows = [{ consent_key: "cookies_analytics", given: false }];
    await backfillRegistryOnLogin(state({ analytics: true, marketing: true }), USER);
    const keys = h.bulkCalls[0].entries.map((entry) => entry.key);
    expect(keys).not.toContain("cookies_analytics");
    expect(keys).toContain("cookies_marketing");
    expect(keys).toContain("cookies_functional");
  });

  it("KOMPLETNY rejestr nie generuje żadnego zapisu", async () => {
    h.registryRows = AUDITABLE_CMP_CATEGORIES.map((category) => ({
      consent_key: CMP_TO_REGISTRY[category],
      given: true,
    }));
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.bulkCalls).toHaveLength(0);
    // Ale flaga „zrobione” i tak zostaje - nie pytamy rejestru w każdej sesji.
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.listCalls).toBe(1);
  });

  it("drugie logowanie tego samego użytkownika NIE powtarza backfillu", async () => {
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.listCalls).toBe(1);
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.listCalls).toBe(1);
  });

  it("INNY użytkownik ma WŁASNĄ flagę - konto na wspólnym urządzeniu też dostaje ślad", async () => {
    // Flaga per użytkownik, nie per przeglądarka: na komputerze współdzielonym
    // drugie konto nie może odziedziczyć „zrobione” po pierwszym.
    await backfillRegistryOnLogin(state({}), USER);
    await backfillRegistryOnLogin(state({}), OTHER_USER);
    expect(h.listCalls).toBe(2);
  });

  it("RÓWNOLEGŁE wywołania dla tego samego użytkownika dają JEDEN zapis", async () => {
    // Wiele instancji `useConsent` reaguje na ten sam event auth (`__root`,
    // baner, wstrzykiwacz skryptów) - bez mapy in-flight rejestr dostawałby
    // trzy identyczne partie.
    const runs = [
      backfillRegistryOnLogin(state({ analytics: true }), USER),
      backfillRegistryOnLogin(state({ analytics: true }), USER),
      backfillRegistryOnLogin(state({ analytics: true }), USER),
    ];
    // Wszystkie trzy wywołania oddają TĘ SAMĄ obietnicę.
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    await Promise.all(runs);
    expect(h.listCalls).toBe(1);
    expect(h.bulkCalls).toHaveLength(1);
  });

  it("PUSTY identyfikator użytkownika nic nie robi", async () => {
    await backfillRegistryOnLogin(state({}), "");
    expect(h.listCalls).toBe(0);
  });

  it("AWARIA odczytu rejestru NIE ustawia flagi - spróbujemy ponownie", async () => {
    // Bez tego jedna awaria sieci przy logowaniu na zawsze zabierałaby temu
    // kontu ślad audytowy.
    h.listError = new Error("offline");
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.listCalls).toBe(1);

    h.listError = null;
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.listCalls).toBe(2);
    expect(h.bulkCalls).toHaveLength(1);
  });

  it("AWARIA zapisu też NIE ustawia flagi", async () => {
    h.bulkError = new Error("not_authorized");
    await backfillRegistryOnLogin(state({}), USER);
    h.bulkError = null;
    await backfillRegistryOnLogin(state({}), USER);
    expect(h.bulkCalls).toHaveLength(2);
  });

  it("znacznik GPC przechodzi do wpisów backfillu", async () => {
    await backfillRegistryOnLogin(state({ analytics: true }), USER, true);
    expect(entryFor("cookies_analytics")).toMatchObject({ gpc: true });
  });

  it("niedostępny localStorage (tryb prywatny) nie blokuje backfillu", async () => {
    // W trybie prywatnym `localStorage` potrafi RZUCAĆ przy każdym dostępie.
    // Backfill musi wtedy działać (bez deduplikacji między sesjami), a nie
    // wywalać obsługi zdarzenia auth.
    const store = window.localStorage;
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    Object.defineProperty(window, "localStorage", { value: throwing, configurable: true });
    try {
      await backfillRegistryOnLogin(state({ analytics: true }), USER);
      expect(h.bulkCalls).toHaveLength(1);
    } finally {
      Object.defineProperty(window, "localStorage", { value: store, configurable: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. WYCOFANIE WYMUSZONE SYGNAŁEM GPC.
// ---------------------------------------------------------------------------

describe("syncGpcSignalToRegistry - sygnał przeglądarki jako wycofanie zgody", () => {
  it("pusty rejestr dostaje wycofanie dla WSZYSTKICH klamrowanych kluczy", async () => {
    // Sygnał GPC jest sprzeciwem (art. 21 RODO) i wycofaniem zgody
    // (art. 7 ust. 3), więc musi mieć ślad z wersją i źródłem - nie tylko
    // efekt w runtime. Zakres obejmuje `personalization`, którego CMP nie zna.
    h.registryRows = [];
    await syncGpcSignalToRegistry(USER);
    expect(h.bulkCalls).toHaveLength(1);
    const keys = h.bulkCalls[0].entries.map((entry) => entry.key);
    for (const key of GPC_CLAMPED_REGISTRY_KEYS) {
      expect(keys, `brak wycofania dla ${key}`).toContain(key);
    }
    // `functional` NIE jest klamrowane - preferencje UI nie opuszczają
    // przeglądarki, więc sygnał ich nie dotyczy.
    expect(keys).not.toContain("cookies_functional");
  });

  it("każde wycofanie niesie źródło `gpc_signal` i znacznik `gpc: true`", async () => {
    // Audytor musi widzieć, że zgodę zdjął SYGNAŁ PRZEGLĄDARKI, a nie klik
    // w banerze - to dwie różne podstawy w dokumentacji zgodności.
    await syncGpcSignalToRegistry(USER);
    for (const entry of allEntries()) {
      expect(entry.given, `${entry.key}: wycofanie musi być \`false\``).toBe(false);
      expect(entry.source).toBe("gpc_signal");
      expect(entry.gpc).toBe(true);
      expect(entry.version, `${entry.key}: brak wersji treści`).toBeTypeOf("string");
    }
  });

  it("klucze JUŻ WYCOFANE są pomijane - zero powtórzeń w audycie", async () => {
    // Sygnał nie zmienia się między nawigacjami; powtarzanie wycofania
    // zamieniłoby historię decyzji w log nawigacji.
    h.registryRows = GPC_CLAMPED_REGISTRY_KEYS.map((key) => ({ consent_key: key, given: false }));
    await syncGpcSignalToRegistry(USER);
    expect(h.bulkCalls).toHaveLength(0);
  });

  it("wycofuje TYLKO klucze, które nadal stoją jako udzielone", async () => {
    const [first, ...rest] = GPC_CLAMPED_REGISTRY_KEYS;
    h.registryRows = [
      { consent_key: first, given: false },
      ...rest.map((key) => ({ consent_key: key, given: true })),
    ];
    await syncGpcSignalToRegistry(USER);
    const keys = h.bulkCalls[0].entries.map((entry) => entry.key);
    expect(keys).not.toContain(first);
    for (const key of rest) expect(keys).toContain(key);
  });

  it("drugie wywołanie dla tego samego użytkownika nie powtarza zapisu", async () => {
    await syncGpcSignalToRegistry(USER);
    expect(h.listCalls).toBe(1);
    await syncGpcSignalToRegistry(USER);
    expect(h.listCalls).toBe(1);
  });

  it("RÓWNOLEGŁE wywołania oddają tę samą obietnicę", async () => {
    const runs = [syncGpcSignalToRegistry(USER), syncGpcSignalToRegistry(USER)];
    expect(runs[1]).toBe(runs[0]);
    await Promise.all(runs);
    expect(h.bulkCalls).toHaveLength(1);
  });

  it("pusty identyfikator użytkownika nic nie robi", async () => {
    await syncGpcSignalToRegistry("");
    expect(h.listCalls).toBe(0);
  });

  it("AWARIA nie ustawia flagi - sygnał dostanie ślad przy następnym evencie", async () => {
    h.listError = new Error("offline");
    await syncGpcSignalToRegistry(USER);
    h.listError = null;
    await syncGpcSignalToRegistry(USER);
    expect(h.listCalls).toBe(2);
    expect(h.bulkCalls).toHaveLength(1);
  });

  it("niedostępny localStorage nie blokuje wycofania", async () => {
    const store = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
      configurable: true,
    });
    try {
      await syncGpcSignalToRegistry(USER);
      expect(h.bulkCalls).toHaveLength(1);
    } finally {
      Object.defineProperty(window, "localStorage", { value: store, configurable: true });
    }
  });

  it("wycofanie GPC idzie TĄ SAMĄ kolejką co decyzje - chronologia zostaje", async () => {
    // Wycofanie musi być w audycie chronologicznie PO stanie, który wycofuje,
    // więc backfill i sygnał nie mogą się wyprzedzić.
    h.registryRows = [];
    const backfill = backfillRegistryOnLogin(state({ analytics: true }), USER);
    const gpc = syncGpcSignalToRegistry(USER);
    await Promise.all([backfill, gpc]);
    expect(h.bulkCalls).toHaveLength(2);
    // Pierwsza partia to backfill (`login_sync`), druga to wycofanie.
    expect(h.bulkCalls[0].entries[0].source).toBe("login_sync");
    expect(h.bulkCalls[1].entries[0].source).toBe("gpc_signal");
  });
});
