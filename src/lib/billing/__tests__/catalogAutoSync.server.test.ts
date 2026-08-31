// Automatyczna synchronizacja katalogu - WARSTWA SERWEROWA (54,2% linii,
// 37% gałęzi, 27 niepokrytych linii do 31.08.2026).
//
// CZEGO NIE POKRYWAŁ ISTNIEJĄCY TEST. `catalogAutoSync.test.ts` bada CZYSTĄ
// decyzję („czy odtwarzać katalog") i robi to dobrze. Poza zasięgiem został
// cały moduł serwerowy, czyli to, co tę decyzję WYKONUJE: liczenie odcisków,
// stan dla panelu, zapis wyniku ręcznej synchronizacji oraz - najważniejsze -
// zachowanie przy AWARII OPERATORA i przy CZĘŚCIOWEJ porażce.
//
// DLACZEGO TO PILNUJE PIENIĘDZY. Ten moduł wisi na ścieżce każdego zakupu
// (webhook, checkout). Trzy stany, w których jego pomyłka kosztuje wprost:
//   1. ROZJAZD CEN. Cennik w bazie mówi 79 zł, u operatora wisi 89 zł. Odcisk
//      treści cennika jest jedynym automatem, który to wyłapuje - a liczy się
//      go z `access_plans`, więc błąd odczytu bazy MUSI dawać `null`
//      („nie wiem"), a nie odcisk zbudowany z pustej listy planów, który
//      wyglądałby jak prawdziwa zmiana i uruchamiał synchronizację w kółko.
//   2. BRAK ODPOWIEDNIKA U OPERATORA. Po restarcie integracji cen nie ma -
//      pierwsze wejście musi je odtworzyć, zanim klient zobaczy „cena nie
//      istnieje" w koszyku.
//   3. AWARIA OPERATORA. Nieudana synchronizacja NIE MOŻE zapisać odcisku
//      cennika: zapisany odcisk znaczy „wdrożone", więc kolejne wejścia
//      przestałyby próbować, a rozjazd cen zostałby na stałe.
//
// Atrapy stoją na GRANICACH: klient Supabase i SDK operatora (`stripe.server`).
// `catalogSync.server` i `catalogReap.server` biegną PRAWDZIWYM kodem - to
// sąsiedzi z tego samego modułu, nie granice systemu.
//
// KLUCZE: `getConnectionApiKey` jest atrapą i oddaje wartość jawnie testową -
// żaden prawdziwy sekret nie jest tu potrzebny ani używany.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import { ok, fail, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import type { CatalogSyncReport } from "@/lib/billing/catalogSync.server";

let db: SupabaseFromStub;

/** Klucz połączenia per środowisko - test podmienia go, żeby ruszyć odcisk. */
const connectionKey: Record<string, string> = {
  sandbox: "test_klucz_sandbox",
  live: "test_klucz_live",
};

/** Wiersze z Stripe'a widziane przez synchronizację (puste = katalog do odtworzenia). */
const stripeState: {
  products: Array<{ id: string; metadata: Record<string, string> }>;
  prices: Array<Record<string, unknown>>;
  created: Array<{ kind: "product" | "price"; payload: Record<string, unknown> }>;
  updated: Array<{ id: string; payload: Record<string, unknown> }>;
  failOn: string | null;
} = { products: [], prices: [], created: [], updated: [], failOn: null };

/** Odpowiedź `list`/`search` SDK: i awaitowalna (`.data`), i asynchronicznie iterowalna. */
function stripeList(rows: unknown[]) {
  return {
    data: rows,
    then: (onOk: (value: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: rows }).then(onOk),
    [Symbol.asyncIterator]: async function* () {
      for (const row of rows) yield row;
    },
  };
}

// Atrapa wchodzi na GRANICY SDK, a NIE na naszym wrapperze - dokładnie jak
// w `diagnostics.server.test.ts` obok. Powód jest tu wyjątkowo konkretny:
// `getIntegrationState`, `recordManualSync` i `runEnsure` wciągają klienta
// serwisowego DWOMA równoległymi gałęziami `Promise.all` (stan + odcisk
// cennika). Przy podmianie samego `client.server` jedna z tych gałęzi potrafi
// dostać moduł ORYGINALNY (leniwy Proxy), a że `catalogFingerprint` łyka
// wyjątki i oddaje `null`, test „zielenił się" na pustym odcisku zamiast
// czegokolwiek dowodzić. Podmiana `createClient` obejmuje obie gałęzie
// niezależnie od kolejności importów i przy okazji przechodzi przez
// PRAWDZIWY wrapper (łącznie z wymogiem klucza serwisowego).
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => db.from(table) }),
}));

vi.mock("@/lib/stripe.server", () => ({
  getConnectionApiKey: (env: string) => connectionKey[env] ?? "test_klucz_domyslny",
  createStripeClient: () => {
    if (stripeState.failOn) throw new Error(stripeState.failOn);
    return {
      products: {
        search: () => Promise.resolve({ data: stripeState.products }),
        list: () => stripeList(stripeState.products),
        create: (payload: Record<string, unknown>) => {
          stripeState.created.push({ kind: "product", payload });
          return Promise.resolve({ id: `prod_${String(payload.name)}` });
        },
        update: (id: string, payload: Record<string, unknown>) => {
          stripeState.updated.push({ id, payload });
          return Promise.resolve({ id });
        },
      },
      prices: {
        list: () => stripeList(stripeState.prices),
        create: (payload: Record<string, unknown>) => {
          stripeState.created.push({ kind: "price", payload });
          return Promise.resolve({ id: "price_nowa" });
        },
        update: (id: string, payload: Record<string, unknown>) => {
          stripeState.updated.push({ id, payload });
          return Promise.resolve({ id });
        },
      },
    };
  },
}));

const {
  __resetAutoSyncCacheForTests,
  catalogFingerprint,
  ensureCatalogSynced,
  getIntegrationState,
  integrationFingerprint,
  recordManualSync,
} = await import("@/lib/billing/catalogAutoSync.server");

/** Plan z `access_plans` w kształcie czytanym przez odcisk cennika. */
function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tier_key: "pro",
    interval: "month",
    price_cents: 9900,
    currency: "PLN",
    name_pl: "Pro",
    name_en: "Pro",
    description_pl: "Dostęp do analiz",
    trial_days: 0,
    active: true,
    volume_threshold_seats: null,
    volume_price_cents: null,
    ...overrides,
  };
}

/** Wiersz `payment_integration_state` - stan zapisany po ostatniej synchronizacji. */
function stateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fingerprint: "odcisk-stary",
    catalog_fingerprint: "cennik-stary",
    last_synced_at: new Date().toISOString(),
    last_status: "ok",
    last_reason: "first_run",
    last_error: null,
    last_report: null,
    ...overrides,
  };
}

/** Ładunek `upsert` zapisany do stanu integracji (albo `undefined`, gdy nic nie zapisano). */
function stateWrite(): Record<string, unknown> | undefined {
  const chain = db.chainsFor("payment_integration_state").find((c) => c.has("upsert"));
  const args = chain?.argsOf("upsert")?.[0];
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined;
}

/** Raport synchronizacji w kształcie oddawanym przez `syncBillingCatalog`. */
function report(overrides: Partial<CatalogSyncReport> = {}): CatalogSyncReport {
  return {
    environment: "sandbox",
    ranAt: "2026-08-30T10:00:00.000Z",
    items: [
      { priceId: "pro_monthly", productId: "plan_pro", product: "ok", price: "ok" },
      { priceId: "plus_monthly", productId: "plan_plus", product: "ok", price: "ok" },
    ],
    archived: [],
    created: 0,
    updated: 0,
    failed: 0,
    ...overrides,
  };
}

beforeEach(() => {
  // Wrapper klienta serwisowego wymaga tych zmiennych - wartości SYNTETYCZNE,
  // bo prawdziwy klient i tak jest atrapą (`createClient` wyżej).
  vi.stubEnv("SUPABASE_URL", "https://projekt-testowy.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-syntetyczny");
  db = supabaseFromStub();
  db.setResponse("access_plans", ok([planRow()]));
  db.setResponse("payment_integration_state", ok(null));
  stripeState.products = [];
  stripeState.prices = [];
  stripeState.created = [];
  stripeState.updated = [];
  stripeState.failOn = null;
  connectionKey.sandbox = "test_klucz_sandbox";
  connectionKey.live = "test_klucz_live";
  __resetAutoSyncCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("odcisk integracji", () => {
  it("jest skrótem, a NIE kluczem - sekret nie może wyciec do bazy", async () => {
    // Odcisk ląduje w `payment_integration_state`, czyli w zwykłej tabeli
    // czytanej przez panel. Gdyby powstawał z klucza w sposób odwracalny
    // (albo gdyby go zawierał), klucz połączenia z operatorem wyciekłby do
    // widoku administracyjnego i do każdej kopii bazy.
    const fingerprint = await integrationFingerprint("sandbox");

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).not.toContain(connectionKey.sandbox);
  });

  it("zmiana klucza (restart integracji) zmienia odcisk", async () => {
    const before = await integrationFingerprint("live");
    connectionKey.live = "test_klucz_po_rotacji";
    const after = await integrationFingerprint("live");

    expect(after).not.toBe(before);
  });

  it("to samo konto w DWÓCH środowiskach ma DWA różne odciski", async () => {
    // Odcisk wchodzi do klucza stanu razem ze środowiskiem. Gdyby ten sam
    // klucz dawał ten sam odcisk w sandboxie i na produkcji, synchronizacja
    // sandboxa „zaliczałaby" produkcję jako aktualną.
    connectionKey.sandbox = "ten_sam_klucz";
    connectionKey.live = "ten_sam_klucz";

    expect(await integrationFingerprint("sandbox")).not.toBe(await integrationFingerprint("live"));
  });
});

describe("odcisk treści cennika", () => {
  it("zmiana kwoty planu w bazie zmienia odcisk", async () => {
    // To jest cały mechanizm wykrywania ROZJAZDU CEN: cennik zmieniony
    // w panelu (albo migracją) ma sam z siebie uruchomić synchronizację.
    const before = await catalogFingerprint();

    db.setResponse("access_plans", ok([planRow({ price_cents: 7900 })]));
    const after = await catalogFingerprint();

    expect(before).toMatch(/^[0-9a-f]{16}$/);
    expect(after).not.toBe(before);
  });

  it("plan bez odpowiednika w cenniku kodu nie psuje odcisku", async () => {
    // `BILLING_CATALOG` i `access_plans` mogą się rozjechać w obie strony.
    // Pozycja katalogu bez planu w bazie jest liczona jako NIEAKTYWNA, a nie
    // pomijana - inaczej usunięcie planu z bazy nie zmieniłoby odcisku i cena
    // zostałaby u operatora na zawsze.
    db.setResponse("access_plans", ok([]));
    const bezPlanow = await catalogFingerprint();

    db.setResponse("access_plans", ok([planRow()]));
    const zPlanem = await catalogFingerprint();

    expect(bezPlanow).toMatch(/^[0-9a-f]{16}$/);
    expect(zPlanem).not.toBe(bezPlanow);
  });

  it("ODMOWA odczytu planów daje `null`, a nie odcisk z pustej listy", async () => {
    // Kluczowa różnica: `null` znaczy „nie wiem" i NIE wymusza synchronizacji.
    // Odcisk policzony z pustej listy po błędzie RLS wyglądałby jak zmiana
    // cennika, więc każde wejście na ścieżkę płatności odpalałoby pełną
    // synchronizację u operatora - w kółko, przy każdym zapytaniu.
    db.setResponse("access_plans", fail("permission denied for table access_plans"));

    expect(await catalogFingerprint()).toBeNull();
  });
});

describe("stan integracji dla panelu", () => {
  it("rozjazd odcisku widać wprost, a nie dopiero po nieudanym zakupie", async () => {
    db.setResponse("payment_integration_state", ok(stateRow({ fingerprint: "odcisk-obcy" })));

    const state = await getIntegrationState("live");

    expect(state.environment).toBe("live");
    expect(state.fingerprint).toBe("odcisk-obcy");
    expect(state.fingerprintCurrent).toBe(false);
    expect(state.catalogCurrent).toBe(false);
    expect(db.lastChain("payment_integration_state")?.argsOf("eq")).toEqual([
      "environment",
      "live",
    ]);
  });

  it("zgodny stan jest raportowany jako aktualny", async () => {
    const fingerprint = await integrationFingerprint("live");
    const catalog = await catalogFingerprint();
    db.setResponse(
      "payment_integration_state",
      ok(stateRow({ fingerprint, catalog_fingerprint: catalog })),
    );

    const state = await getIntegrationState("live");

    expect(state.fingerprintCurrent).toBe(true);
    expect(state.catalogCurrent).toBe(true);
  });

  it("brak policzonego odcisku cennika NIE jest raportowany jako rozjazd", async () => {
    // Gdy baza nie odpowiada, panel ma pokazać „nie wiem" jako stan zgodny -
    // czerwony alarm przy każdej awarii odczytu nauczyłby operatora go
    // ignorować.
    db.setResponse("access_plans", fail("connection reset"));
    db.setResponse("payment_integration_state", ok(stateRow({ catalog_fingerprint: null })));

    const state = await getIntegrationState("live");

    expect(state.catalogCurrent).toBe(true);
  });

  it("pusty wiersz stanu (pierwsze uruchomienie) nie wywraca odczytu", async () => {
    db.setResponse("payment_integration_state", ok(null));

    const state = await getIntegrationState("sandbox");

    expect(state).toMatchObject({
      fingerprint: null,
      catalogFingerprint: null,
      lastSyncedAt: null,
      lastStatus: null,
      lastReport: null,
      fingerprintCurrent: false,
    });
  });
});

describe("zapis ręcznej synchronizacji z panelu", () => {
  it("udana synchronizacja odświeża oba odciski i oznacza powód `manual`", async () => {
    await recordManualSync("sandbox", report());

    const write = stateWrite();
    expect(write).toMatchObject({
      environment: "sandbox",
      last_status: "ok",
      last_reason: "manual",
      last_error: null,
      last_synced_at: "2026-08-30T10:00:00.000Z",
    });
    expect(write?.["fingerprint"]).toBe(await integrationFingerprint("sandbox"));
    expect(write?.["catalog_fingerprint"]).toBe(await catalogFingerprint());
    // Klucz konfliktu jest jedyną gwarancją JEDNEGO wiersza na środowisko.
    expect(db.lastChain("payment_integration_state")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "environment",
    });
  });

  it("ręczna synchronizacja zeruje debounce - kolejne wejście nie pyta bazy", async () => {
    // Po ręcznym przebiegu stan jest świeży z definicji. Ponowne pytanie bazy
    // przy najbliższym zakupie byłoby czystym marnotrawstwem zapytań.
    await recordManualSync("sandbox", report());
    const chainsAfterManual = db.chains.length;

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome).toEqual({ environment: "sandbox", ran: false, reason: null, report: null });
    expect(db.chains).toHaveLength(chainsAfterManual);
  });

  // DEFEKT (nie naprawiam - zakres zadania to testy, nie kod produkcyjny).
  //
  // CO JEST ZŁE. Ścieżka automatyczna ma tę regułę zapisaną wprost w kodzie
  // i w komentarzu (`catalogAutoSync.server.ts:227`): „Odcisk cennika
  // zapisujemy dopiero po udanej synchronizacji - inaczej częściowa porażka
  // uznałaby zmieniony cennik za wdrożony" - i faktycznie zapisuje
  // `catalog_fingerprint` tylko przy statusie `ok`. `recordManualSync` (ta sama
  // tabela, ten sam odcisk, tylko wywołane z przycisku w panelu) zapisuje go
  // BEZWARUNKOWO, nawet dla raportu z pozycjami `failed`.
  //
  // DLACZEGO TO RYZYKO. Zapisany odcisk cennika znaczy „ten cennik jest
  // u operatora wdrożony". Po częściowo nieudanej synchronizacji z panelu
  // automat przestaje widzieć rozjazd (`catalog_changed` nigdy się nie
  // odpali), więc cena, która NIE zsynchronizowała się u operatora, zostaje
  // rozjechana na stałe - do następnej zmiany cennika albo rotacji klucza.
  // Objaw dla klienta: koszyk pokazuje jedną kwotę, operator pobiera drugą.
  // Naprawa to jedna linia (`catalog_fingerprint: syncStatusFrom(report) ===
  // "ok" ? catalog : <zapisany>`), ale to zmiana KODU PRODUKCYJNEGO.
  it.fails(
    "częściowo nieudana synchronizacja ręczna NIE oznacza cennika jako wdrożony",
    async () => {
      const partial = report({
        items: [
          { priceId: "pro_monthly", productId: "plan_pro", product: "ok", price: "ok" },
          { priceId: "plus_monthly", productId: "plan_plus", product: "failed", price: "failed" },
        ],
        failed: 1,
      });

      await recordManualSync("sandbox", partial);

      // ASERCJA DOCELOWA: status `partial` ma zostać zapisany (to jest
      // poprawne), ale odcisk cennika NIE - bo cennik nie jest wdrożony.
      expect(stateWrite()).toMatchObject({ last_status: "partial" });
      expect(stateWrite()?.["catalog_fingerprint"]).toBeNull();
    },
  );
});

describe("ensureCatalogSynced - kiedy synchronizacja RUSZA", () => {
  it("pierwsze uruchomienie odtwarza brakujące pozycje u operatora", async () => {
    // Po restarcie integracji u operatora nie ma ani produktów, ani cen -
    // aplikacja zna wyłącznie czytelne identyfikatory. Bez tego przebiegu
    // pierwszy klient dostaje w koszyku „cena nie istnieje".
    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome.ran).toBe(true);
    expect(outcome.reason).toBe("first_run");
    expect(outcome.report?.created).toBeGreaterThan(0);
    expect(stripeState.created.some((c) => c.kind === "price")).toBe(true);

    const write = stateWrite();
    expect(write).toMatchObject({ environment: "sandbox", last_status: "ok", last_error: null });
    // Po udanym przebiegu ZAPISUJEMY odcisk cennika - to on wycisza kolejne
    // wejścia aż do następnej zmiany cennika.
    expect(write?.["catalog_fingerprint"]).toBe(await catalogFingerprint());
  });

  it("rozjazd cennika po wdrożeniu wymusza synchronizację mimo świeżego stanu", async () => {
    const fingerprint = await integrationFingerprint("sandbox");
    db.setResponse(
      "payment_integration_state",
      ok(stateRow({ fingerprint, catalog_fingerprint: "cennik-sprzed-wdrozenia" })),
    );

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome.reason).toBe("catalog_changed");
    expect(outcome.ran).toBe(true);
  });

  it("wymuszenie z panelu synchronizuje nawet przy zgodnym stanie", async () => {
    const fingerprint = await integrationFingerprint("sandbox");
    const catalog = await catalogFingerprint();
    db.setResponse(
      "payment_integration_state",
      ok(stateRow({ fingerprint, catalog_fingerprint: catalog })),
    );

    const outcome = await ensureCatalogSynced("sandbox", { force: true });

    expect(outcome.ran).toBe(true);
    expect(outcome.reason).toBe("integration_restarted");
  });
});

describe("ensureCatalogSynced - kiedy synchronizacja ODMAWIA", () => {
  it("zgodny i świeży stan nie generuje ANI JEDNEGO żądania do operatora", async () => {
    // Ta funkcja wisi na ścieżce każdego zakupu. Synchronizacja „na wszelki
    // wypadek" oznaczałaby kilkanaście żądań do operatora przy każdym
    // kliknięciu „Kup".
    const fingerprint = await integrationFingerprint("sandbox");
    const catalog = await catalogFingerprint();
    db.setResponse(
      "payment_integration_state",
      ok(stateRow({ fingerprint, catalog_fingerprint: catalog })),
    );

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome).toEqual({ environment: "sandbox", ran: false, reason: null, report: null });
    expect(stripeState.created).toHaveLength(0);
    expect(stateWrite()).toBeUndefined();
  });

  it("BACKOFF po porażce: kolejne wejście nie ponawia od razu", async () => {
    // Nieudana synchronizacja bez backoffu zapętliłaby się na ścieżce zakupu
    // (każde wejście widzi „stan nieudany" i próbuje od nowa). Ponowienie
    // przychodzi dopiero po `CATALOG_SYNC_RETRY_MS`.
    const fingerprint = await integrationFingerprint("sandbox");
    const catalog = await catalogFingerprint();
    db.setResponse(
      "payment_integration_state",
      ok(
        stateRow({
          fingerprint,
          catalog_fingerprint: catalog,
          last_status: "failed",
          last_synced_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
    );

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBeNull();
    expect(stripeState.created).toHaveLength(0);
  });

  it("po upływie backoffu porażka JEST ponawiana", async () => {
    const fingerprint = await integrationFingerprint("sandbox");
    const catalog = await catalogFingerprint();
    db.setResponse(
      "payment_integration_state",
      ok(
        stateRow({
          fingerprint,
          catalog_fingerprint: catalog,
          last_status: "failed",
          last_synced_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        }),
      ),
    );

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome.reason).toBe("retry_after_failure");
    expect(outcome.ran).toBe(true);
  });

  it("DEBOUNCE izolatu: drugie wejście w oknie 5 minut nie pyta nawet bazy", async () => {
    await ensureCatalogSynced("sandbox");
    const chainsAfterFirst = db.chains.length;

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome).toEqual({ environment: "sandbox", ran: false, reason: null, report: null });
    expect(db.chains).toHaveLength(chainsAfterFirst);
  });

  it("dwa równoległe zakupy dzielą JEDEN przebieg synchronizacji", async () => {
    // Bez dedupe dwadzieścia równoległych zakupów po restarcie integracji
    // wysłałoby dwadzieścia kompletów żądań do operatora (i dwadzieścia razy
    // założyłoby te same ceny).
    const [first, second] = await Promise.all([
      ensureCatalogSynced("sandbox"),
      ensureCatalogSynced("sandbox"),
    ]);

    expect(first).toBe(second);
    expect(db.chainsFor("payment_integration_state").filter((c) => c.has("upsert"))).toHaveLength(
      1,
    );
  });

  it("awaria operatora zapisuje PORAŻKĘ i NIE oznacza cennika jako wdrożonego", async () => {
    // Najważniejszy przypadek tego pliku. Gdyby nieudany przebieg zapisał
    // odcisk cennika, automat uznałby rozjazd za wdrożony i nigdy więcej by
    // go nie tknął - a klient płaciłby kwotę inną niż z cennika.
    stripeState.failOn = "STRIPE_SANDBOX_API_KEY is not configured";

    const outcome = await ensureCatalogSynced("sandbox");

    expect(outcome.ran).toBe(false);
    expect(outcome.report).toBeNull();
    expect(outcome.reason).toBe("first_run");
    expect(outcome.error).toContain("STRIPE_SANDBOX_API_KEY");

    const write = stateWrite();
    expect(write).toMatchObject({
      environment: "sandbox",
      last_status: "failed",
      last_error: "STRIPE_SANDBOX_API_KEY is not configured",
    });
    // Odcisk połączenia zostaje TAKI, JAKI BYŁ (nie „zaliczamy" restartu),
    // a odcisku cennika nie zapisujemy w ogóle.
    expect(write).not.toHaveProperty("catalog_fingerprint");
    expect(write?.["fingerprint"]).toBeNull();
  });

  it("po awarii operatora stan pozostaje niezgodny - panel dalej widzi rozjazd", async () => {
    stripeState.failOn = "connection refused";
    db.setResponse("payment_integration_state", ok(stateRow({ fingerprint: "odcisk-stary" })));

    await ensureCatalogSynced("live");

    expect(stateWrite()?.["fingerprint"]).toBe("odcisk-stary");
    expect(stateWrite()?.["last_status"]).toBe("failed");
  });
});
