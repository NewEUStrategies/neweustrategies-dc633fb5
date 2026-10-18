// Diagnostyka integracji płatności - 0 z 19 funkcji pokrytych do 18.08.2026.
//
// To warstwa serwerowa narzędzia, którym gasi się pożary: pięć kontroli
// odpowiadających na pytanie „dlaczego zakup nie nadał uprawnień". Wartość tego
// modułu jest odwrotnie proporcjonalna do jego niezawodności - kontrola, która
// świeci zielono przy zepsutej integracji, jest GORSZA niż jej brak, bo kieruje
// operatora w złe miejsce.
//
// Trzy rzeczy pilnowane najmocniej:
//
//   1. BRAMKA DOSTĘPU. `assertAdmin` przepuszcza WYŁĄCZNIE `has_role() === true`
//      - `null` z RPC (brak wiersza, brak uprawnień do funkcji) nie może
//      przechodzić jako „pewnie admin".
//   2. STANY KONTROLI. Każda z pięciu kontroli ma trzy możliwe stany i granice
//      między nimi są tu wyliczone jawnie - w tym różnica między `warn`
//      („nie wiem, bo bramka nieskonfigurowana") i `error` („wiem, że źle").
//   3. IDEMPOTENCJA SYNCHRONIZACJI KUPONÓW. Kod jest kluczem naturalnym po obu
//      stronach; istniejący rabat NIE MOŻE być tworzony po raz drugi, bo klient
//      dostałby dwa rabaty na jeden kod.
//   4. ZAWĘŻENIE KODÓW NA WSPÓLNYM KONCIE (audyt PAY-06). Kod jedzie tylko od
//      najemcy z polem kodu Stripe, kod planowy dostaje produkty swoich planów
//      (a bez nich nie jedzie wcale), a kontrola zdarzeń mówi, których typów
//      odbiornik nie subskrybuje.
//
// ŻADNE żądanie nie wychodzi do Stripe - klient operatora jest atrapą.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    configured: { current: true },
    hasRole: { current: true as unknown },
    // Najemca wołającego czytany z `profiles` - ta sama płaszczyzna, po której
    // autoryzuje `has_role` (`current_tenant_id()` czyta to samo pole).
    tenant: { current: "tenant-alfa" as unknown },
    /** Wiązanie hosta żądania: `null` = brak wskazówki (dev, podgląd). */
    binding: { current: null as { id: string } | null },
    rpc: vi.fn(),
    // `null` jest tu równie prawdziwym kształtem co pusta tablica: PostgREST
    // oddaje `data: null` przy zerowym wyniku, a diagnostyka MUSI to przeżyć.
    coupons: { current: [] as Array<Record<string, unknown>> | null },
    webhookRows: { current: [] as Array<Record<string, unknown>> | null },
    endpoints: { current: [] as Array<Record<string, unknown>> },
    /** Wiersz `checkout_settings` najemcy (`maybeSingle`). */
    checkoutSettings: { current: null as Record<string, unknown> | null },
    /** Plany najemcy czytane przy zawężaniu kodów planowych. */
    plans: { current: [] as Array<Record<string, unknown>> | null },
    endpointsThrow: { current: false },
    prices: { current: new Map<string, { id: string; product?: unknown }>() },
    pricesThrow: { current: false },
    /** `lookup_keys` każdego `prices.list` - operator przyjmuje najwyżej 10. */
    priceListCalls: [] as string[][],
    promoByCode: { current: new Map<string, string>() },
    promoThrows: { current: false },
    createdCoupons: [] as Array<Record<string, unknown>>,
    createdPromos: [] as Array<Record<string, unknown>>,
    /** Drugi argument wywołań operatora (`RequestOptions`, klucz idempotencji). */
    couponOptions: [] as unknown[],
    promoOptions: [] as unknown[],
    /** Parametry każdego `promotionCodes.list` - tabela pyta o aktywne kopie. */
    promoListCalls: [] as Array<Record<string, unknown>>,
    couponCreateThrows: { current: false },
    chains: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  };

  /**
   * Atrapa klienta serwisowego. Zbudowana TUTAJ, a nie w fabryce `vi.mock`:
   * `diagnostics.server` wciąga klienta DYNAMICZNIE (`await import`) wewnątrz
   * `admin()`, a fabryka domykająca się nad lokalnymi zmiennymi nie zawsze
   * dochodzi do takiego importu. Ten sam układ ma działający
   * `reconcile.server.test.ts`.
   */
  const supabaseAdmin = {
    from: (table: string) => {
      const entry = { table, filters: [] as Array<[string, unknown]> };
      state.chains.push(entry);
      const link: Record<string, unknown> = {};
      for (const method of ["select", "order", "limit"]) link[method] = () => link;
      for (const method of ["eq", "gte", "in"]) {
        link[method] = (column: string, value: unknown) => {
          entry.filters.push([column, value]);
          return link;
        };
      }
      // `.filter(kolumna, operator, wartość)` zapisujemy w kształcie PostgREST.
      link.filter = (column: string, operator: string, value: unknown) => {
        entry.filters.push([column, `${operator}.${String(value)}`]);
        return link;
      };
      // Odczyt profilu wołającego (`resolveUserTenantId`) kończy się ogniwem
      // terminalnym, a nie `await` na łańcuchu - atrapa musi je znać.
      link.maybeSingle = () =>
        Promise.resolve({
          data:
            table === "profiles"
              ? { tenant_id: state.tenant.current as string | null }
              : table === "checkout_settings"
                ? state.checkoutSettings.current
                : null,
          error: null,
        });
      link.then = (onFulfilled?: (value: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "b2b_coupons"
              ? state.coupons.current
              : table === "access_plans"
                ? state.plans.current
                : state.webhookRows.current,
          error: null,
        }).then(onFulfilled);
      return link;
    },
    rpc: (fn: string, args?: Record<string, unknown>) => {
      state.rpc(fn, args);
      return Promise.resolve(
        fn === "current_tenant_id"
          ? { data: state.tenant.current, error: null }
          : { data: state.hasRole.current, error: null },
      );
    },
  };

  /**
   * Atrapa klienta operatora - żadne żądanie nie wychodzi do sieci.
   *
   * `prices.list` jest tu po to, żeby katalog przechodził przez PRAWDZIWE
   * `resolvePricesByLookupKeys` (mapowanie `lookup_key` -> cena). Test sprawdza
   * wtedy realną regułę, a nie własną atrapę tej reguły.
   */
  const stripe = {
    prices: {
      // Kontrakt operatora, nie wygoda atrapy: `lookup_keys` przyjmuje NAJWYŻEJ
      // 10 kluczy (dokumentacja `prices.list`), a odpowiedź zawiera wyłącznie
      // ceny o kluczach z zapytania. Atrapa, która oddawała cały katalog na
      // każde pytanie, przepuściła katalog 11 pozycji pytany jednym żądaniem.
      list: (params: { lookup_keys?: string[] }) => {
        const keys = params.lookup_keys ?? [];
        state.priceListCalls.push(keys);
        if (state.pricesThrow.current) return Promise.reject(new Error("stripe padł"));
        if (keys.length > 10) {
          return Promise.reject(
            Object.assign(new Error("You can only pass up to 10 lookup_keys."), {
              type: "StripeInvalidRequestError",
            }),
          );
        }
        return Promise.resolve({
          data: [...state.prices.current.entries()]
            .filter(([lookupKey]) => keys.includes(lookupKey))
            .map(([lookupKey, price]) => ({
              id: price.id,
              lookup_key: lookupKey,
              product: price.product ?? null,
            })),
        });
      },
    },
    webhookEndpoints: {
      list: () =>
        state.endpointsThrow.current
          ? Promise.reject(new Error("stripe padł"))
          : Promise.resolve({ data: state.endpoints.current }),
    },
    promotionCodes: {
      list: (params: { code: string }) => {
        state.promoListCalls.push(params);
        const { code } = params;
        if (state.promoThrows.current) return Promise.reject(new Error("stripe padł"));
        const id = state.promoByCode.current.get(code);
        return Promise.resolve({ data: id ? [{ id }] : [] });
      },
      create: (payload: Record<string, unknown>, options?: unknown) => {
        state.createdPromos.push(payload);
        state.promoOptions.push(options);
        return Promise.resolve({ id: "promo_new" });
      },
    },
    coupons: {
      create: (payload: Record<string, unknown>, options?: unknown) => {
        if (state.couponCreateThrows.current) return Promise.reject(new Error("odmowa"));
        state.createdCoupons.push(payload);
        state.couponOptions.push(options);
        return Promise.resolve({ id: "coupon_new" });
      },
    },
  };

  return { ...state, supabaseAdmin, stripe };
});

// Atrapa wchodzi na GRANICY SDK, nie na naszym wrapperze. `diagnostics.server`
// wciąga klienta serwisowego dynamicznie (`await import` w `admin()`),
// a `client.server` jest plikiem GENEROWANYM, który eksportuje `supabaseAdmin`
// przez Proxy tworzące klienta leniwie - podmiana samego wrappera nie dochodzi
// do tego importu. Mockowanie `createClient` jest przy okazji wierniejsze:
// przechodzi przez prawdziwy wrapper (łącznie z kontrolą zmiennych
// środowiskowych), więc test pilnuje też tego, że klucz serwisowy jest wymagany.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => h.supabaseAdmin }));

// PŁASZCZYZNA HOSTA. Host jest w tej bramce wyłącznie KONTROLĄ SPÓJNOŚCI -
// zakres bierze się z profilu. Atrapa oddaje samo wiązanie domeny, bez
// fallbacku na najemcę domyślnego (to rozróżnienie trzyma przy życiu dev
// i podgląd - patrz `src/lib/server/callerTenant.server.ts`).
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "panel.example.test",
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveDomainBinding: async () => ({
    tenant: h.binding.current,
    directoryPopulated: h.binding.current !== null,
  }),
}));

// Atrapa na GRANICY SDK operatora, nie na naszym wrapperze - z tego samego
// powodu, co przy Supabase. Dodatkowa korzyść: przez `getStripeClient`
// przechodzi PRAWDZIWY kod, więc test pilnuje też wymagania kluczy
// środowiskowych i przepięcia transportu na bramkę konektorów.
vi.mock("stripe", () => {
  class StripeStub {
    constructor() {
      // Konstruktor zwracający obiekt podmienia instancję - `new Stripe(...)`
      // w `getStripeClient` daje wprost naszą atrapę.
      return h.stripe as unknown as StripeStub;
    }
    static createFetchHttpClient() {
      return {};
    }
  }
  return { default: StripeStub };
});

vi.mock("@/lib/billing/mockMode.server", () => ({
  paymentsConfiguredServer: () => h.configured.current,
}));

import {
  assertAdmin,
  assertAdminWithTenant,
  assertSuperAdmin,
  buildPaymentsDiagnostics,
  missingWebhookEventTypes,
  syncCouponDiscounts,
} from "@/lib/billing/diagnostics.server";
import { BILLING_CATALOG } from "@/lib/billing/catalog";
import { STRIPE_WEBHOOK_EVENT_TYPES } from "@/lib/billing/stripeEventTypes";

/** Klient admina z atrapy - `assertAdmin` przyjmuje go parametrem. */
function adminClient(): Parameters<typeof assertAdmin>[0] {
  return h.supabaseAdmin as unknown as Parameters<typeof assertAdmin>[0];
}

const APP_WEBHOOK_URL = "https://example.test/api/public/payments/webhook";

/** Najemca wołającego - diagnostyka jest liczona WYŁĄCZNIE w jego zakresie. */
const TENANT = "tenant-alfa";

const checkById = (diag: Awaited<ReturnType<typeof buildPaymentsDiagnostics>>, id: string) =>
  diag.checks.find((check) => check.id === id)!;

beforeEach(() => {
  // Wrapper klienta serwisowego wymaga tych zmiennych - wartości SYNTETYCZNE,
  // bo prawdziwy klient i tak jest atrapą (`createClient` wyżej).
  vi.stubEnv("SUPABASE_URL", "https://projekt-testowy.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-syntetyczny");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "sk_test_syntetyczny");
  vi.stubEnv("STRIPE_LIVE_API_KEY", "sk_live_syntetyczny");
  vi.stubEnv("LOVABLE_API_KEY", "platforma-syntetyczna");
  h.configured.current = true;
  h.hasRole.current = true;
  h.tenant.current = TENANT;
  h.binding.current = null;
  h.rpc.mockReset();
  h.coupons.current = [];
  h.webhookRows.current = [];
  h.endpoints.current = [];
  h.endpointsThrow.current = false;
  // Najemca z WŁĄCZONYM polem kodu Stripe - inaczej synchronizacja niczego nie
  // wypycha (domyślne PAY-06). Przypadki „pole wyłączone" ustawiają to jawnie.
  h.checkoutSettings.current = { allow_promotion_codes: true };
  h.plans.current = [];
  h.prices.current = new Map(
    BILLING_CATALOG.map((entry) => [entry.priceId, { id: `price_${entry.priceId}` }]),
  );
  h.pricesThrow.current = false;
  h.priceListCalls.length = 0;
  h.promoByCode.current = new Map();
  h.promoThrows.current = false;
  h.createdCoupons.length = 0;
  h.createdPromos.length = 0;
  h.couponOptions.length = 0;
  h.promoOptions.length = 0;
  h.promoListCalls.length = 0;
  h.couponCreateThrows.current = false;
  h.chains.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertAdmin - bramka dostępu do diagnostyki", () => {
  it("przepuszcza administratora I ODDAJE jego najemcę", async () => {
    h.hasRole.current = true;

    await expect(assertAdmin(adminClient(), "user-admin")).resolves.toEqual({ tenantId: TENANT });
    expect(h.rpc).toHaveBeenCalledWith("has_role", { _user_id: "user-admin", _role: "admin" });
  });

  it("odrzuca zwykłego użytkownika", async () => {
    h.hasRole.current = false;

    await expect(assertAdmin(adminClient(), "user-me")).rejects.toThrow("forbidden");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("`null` z RPC NIE przechodzi jako „pewnie admin”", async () => {
    h.hasRole.current = null;

    await expect(assertAdmin(adminClient(), "user-me")).rejects.toThrow("forbidden");
  });

  it("wartość prawdziwa, ale nie `true`, też nie przechodzi", async () => {
    h.hasRole.current = "admin";

    await expect(assertAdmin(adminClient(), "user-me")).rejects.toThrow("forbidden");
  });
});

describe("assertSuperAdmin - bramka uzgadniania i ponowienia z dziennika", () => {
  // Uzgadnianie czyta dziennik `payment_webhook_events` (RLS: `is_super_admin()`)
  // i odtwarza zdarzenia operatora. Do audytu wyd. 12 stało za rolą `admin`,
  // czyli o szczebel niżej niż ponowienie z tego samego dziennika.
  it("pyta o rolę `super_admin` i oddaje najemcę z profilu", async () => {
    h.hasRole.current = true;

    await expect(assertSuperAdmin(adminClient(), "user-root")).resolves.toEqual({
      tenantId: TENANT,
    });
    expect(h.rpc).toHaveBeenCalledWith("has_role", {
      _user_id: "user-root",
      _role: "super_admin",
    });
  });

  it("odmawia, gdy rola nie jest dokładnie `true` - zanim dotknie profilu", async () => {
    for (const value of [false, null, "super_admin"]) {
      h.hasRole.current = value;
      h.chains.length = 0;
      await expect(assertSuperAdmin(adminClient(), "user-admin")).rejects.toThrow("forbidden");
      expect(h.chains).toHaveLength(0);
    }
  });

  it("błąd RPC roli to odmowa, nie przepustka", async () => {
    const client = {
      rpc: async () => ({ data: true, error: { message: "permission denied for function" } }),
    } as unknown as Parameters<typeof assertSuperAdmin>[0];

    await expect(assertSuperAdmin(client, "user-root")).rejects.toThrow("forbidden");
  });
});

describe("assertAdminWithTenant - bramka, która ODDAJE najemcę", () => {
  // CO BYŁO ZŁE. Bramka zwracała `void`, więc handler musiał pamiętać
  // o zakresie najemcy z własnej głowy - i nie pamiętał: kondycja dziennika
  // webhooków była liczona po CAŁEJ tabeli, spod `service_role`, czyli
  // z pominięciem RLS. Gorzej: warstwa danych rozstrzygała najemcę DRUGI RAZ,
  // z hosta żądania, więc rola autoryzowała się w obszarze A, a dane szły z B.
  //
  // JAK NAPRAWIONE. Najemca jest CZĘŚCIĄ WYNIKU bramki i pochodzi z PROFILU
  // wołającego - z tego samego pola, które czyta `current_tenant_id()` przy
  // autoryzacji roli. Host bierze udział wyłącznie jako kontrola spójności.
  //
  // `assertAdminWithTenant` jest dziś aliasem `assertAdmin`; obie nazwy
  // MUSZĄ znaczyć jedno i to samo, bo druga implementacja byłaby drugim
  // źródłem prawdy.
  it("oddaje najemcę z profilu, dopiero PO kontroli roli", async () => {
    await expect(assertAdminWithTenant(adminClient(), "user-admin")).resolves.toEqual({
      tenantId: TENANT,
    });

    // Jedno RPC: rola. Najemca czytany jest z `profiles`, a nie osobną funkcją.
    expect(h.rpc.mock.calls.map((call) => call[0])).toEqual(["has_role"]);
    expect(h.chains.map((chain) => chain.table)).toEqual(["profiles"]);
    expect(h.chains[0]?.filters).toEqual([["id", "user-admin"]]);
  });

  it("brak roli admina NIE pyta nawet o najemcę", async () => {
    // Kolejność jest wiążąca: zwykły zalogowany ma dostać odmowę, zanim
    // cokolwiek pójdzie do bazy.
    h.hasRole.current = false;

    await expect(assertAdminWithTenant(adminClient(), "user-me")).rejects.toThrow("forbidden");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.chains).toHaveLength(0);
  });

  it("nierozwiązany najemca to ODMOWA, nie zgoda na wszystko", async () => {
    // Fail-closed. Gdyby brak najemcy przechodził, admin bez profilu dostawałby
    // diagnostykę liczoną po wszystkich obszarach - czyli dokładnie ten stan,
    // który ta bramka ma zamknąć.
    h.tenant.current = null;

    await expect(assertAdminWithTenant(adminClient(), "user-admin")).rejects.toThrow(
      "No tenant for current user",
    );
  });

  it("pusty identyfikator najemcy też nie przechodzi", async () => {
    h.tenant.current = "";

    await expect(assertAdminWithTenant(adminClient(), "user-admin")).rejects.toThrow(
      "No tenant for current user",
    );
  });

  it("host wiążący się z INNYM najemcą zamyka ścieżkę", async () => {
    // To jest sedno poprawki: rola przechodzi (admin obszaru A), ale żądanie
    // przyszło na domenę obszaru B. Zakres NIE MOŻE pójść za hostem, a sama
    // niespójność jest podejrzana na tyle, że kończy się odmową.
    h.binding.current = { id: "tenant-beta" };

    await expect(assertAdminWithTenant(adminClient(), "user-admin")).rejects.toThrow(
      "TENANT/HOST_MISMATCH",
    );
  });

  it("host bez wiązania (dev, podgląd) przepuszcza na najemcy profilowego", async () => {
    // ANTYREGRESJA: bez tej gałęzi diagnostyka padałaby na localhoście
    // i `*.pages.dev` każdemu adminowi spoza najemcy domyślnego.
    h.binding.current = null;

    await expect(assertAdminWithTenant(adminClient(), "user-admin")).resolves.toEqual({
      tenantId: TENANT,
    });
  });
});

describe("buildPaymentsDiagnostics - kontrola bramki płatności", () => {
  it("skonfigurowana bramka daje stan „ok” z nazwą środowiska", async () => {
    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "gateway_configured")).toMatchObject({
      state: "ok",
      detail: "sandbox",
    });
    expect(diag.environment).toBe("sandbox");
  });

  it("BRAK KLUCZY to `error`, nie ostrzeżenie", async () => {
    h.configured.current = false;

    const diag = await buildPaymentsDiagnostics("live", TENANT);

    expect(checkById(diag, "gateway_configured")).toMatchObject({
      state: "error",
      detail: "missing_keys",
    });
    expect(diag.destinations).toEqual([]);
  });

  it("bez kluczy NIE pyta operatora o katalog ani odbiorniki", async () => {
    h.configured.current = false;

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.catalog).toEqual([]);
    expect(diag.destinations).toEqual([]);
  });
});

describe("buildPaymentsDiagnostics - kontrola odbiornika zdarzeń", () => {
  it("odbiornik naszej aplikacji, aktywny, daje „ok” i pokazuje adres", async () => {
    h.endpoints.current = [
      { id: "we_1", url: APP_WEBHOOK_URL, status: "enabled", enabled_events: ["a", "b"] },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_endpoint")).toMatchObject({
      state: "ok",
      detail: APP_WEBHOOK_URL,
    });
    expect(diag.destinations[0]).toMatchObject({ active: true, events: 2 });
  });

  it("ODBIORNIK WYŁĄCZONY to ostrzeżenie, nie „ok”", async () => {
    h.endpoints.current = [
      { id: "we_1", url: APP_WEBHOOK_URL, status: "disabled", enabled_events: [] },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_endpoint").state).toBe("warn");
    expect(diag.destinations[0].active).toBe(false);
  });

  it("BRAK NASZEGO ODBIORNIKA to `error` - zdarzenia nie mają gdzie dojść", async () => {
    h.endpoints.current = [
      { id: "we_obcy", url: "https://obcy.test/hook", status: "enabled", enabled_events: ["x"] },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_endpoint")).toMatchObject({ state: "error", detail: "1" });
    expect(diag.destinations).toHaveLength(1);
  });

  it("awaria odczytu odbiorników nie wywala raportu - lista jest pusta", async () => {
    h.endpointsThrow.current = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.destinations).toEqual([]);
    expect(checkById(diag, "webhook_endpoint")).toMatchObject({ state: "error", detail: "0" });
    consoleError.mockRestore();
  });

  it("odbiornik bez adresu nie wywraca dopasowania", async () => {
    h.endpoints.current = [{ id: "we_1", url: null, status: "enabled", enabled_events: null }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.destinations[0]).toMatchObject({ url: "", events: 0 });
    expect(checkById(diag, "webhook_endpoint").state).toBe("error");
  });
});

describe("buildPaymentsDiagnostics - kontrola katalogu cen", () => {
  it("kompletny katalog daje „ok” i licznik pełny", async () => {
    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);
    const total = BILLING_CATALOG.length;

    expect(checkById(diag, "catalog")).toMatchObject({
      state: "ok",
      detail: `${total}/${total}`,
    });
    expect(diag.catalog.every((entry) => entry.providerPriceId)).toBe(true);
  });

  // DEFEKT (2026-10-18): katalog ma 11 pozycji (od dołożenia trzech cykli
  // Partnera Biznesowego), a sonda pytała operatora o WSZYSTKIE klucze jednym
  // `prices.list`. Operator przyjmuje najwyżej 10 `lookup_keys` i odrzuca
  // żądanie - sonda kończyła się w `catch`, a diagnostyka pokazywała CAŁY
  // katalog jako brakujący (`0/11`, `error`) przy kompletnym cenniku u operatora.
  it("katalog dłuższy niż limit operatora (10 kluczy) jest pytany PACZKAMI i rozwiązuje się cały", async () => {
    expect(BILLING_CATALOG.length).toBeGreaterThan(10);

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(h.priceListCalls.length).toBeGreaterThan(1);
    expect(h.priceListCalls.every((keys) => keys.length <= 10)).toBe(true);
    // Każdy klucz pytany dokładnie raz - paczki się nie nakładają.
    expect(h.priceListCalls.flat().sort()).toEqual(
      BILLING_CATALOG.map((entry) => entry.priceId).sort(),
    );
    expect(diag.catalog.map((entry) => entry.providerPriceId)).toEqual(
      BILLING_CATALOG.map((entry) => `price_${entry.priceId}`),
    );
  });

  it("BRAKUJĄCA CENA u operatora to `error` z liczbą braków", async () => {
    const [first, ...rest] = BILLING_CATALOG;
    h.prices.current = new Map(
      rest.map((entry) => [entry.priceId, { id: `price_${entry.priceId}` }]),
    );

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);
    const total = BILLING_CATALOG.length;

    expect(checkById(diag, "catalog")).toMatchObject({
      state: "error",
      detail: `${total - 1}/${total}`,
    });
    expect(
      diag.catalog.find((entry) => entry.priceId === first.priceId)?.providerPriceId,
    ).toBeNull();
  });

  it("AWARIA sondowania katalogu nie udaje kompletności - wszystko na `null`", async () => {
    h.pricesThrow.current = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.catalog.every((entry) => entry.providerPriceId === null)).toBe(true);
    expect(checkById(diag, "catalog").state).toBe("error");
    consoleError.mockRestore();
  });

  it("każdy wpis katalogu niesie warstwę i cykl - bez tego braku nie da się naprawić", async () => {
    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.catalog[0]).toMatchObject({
      priceId: BILLING_CATALOG[0].priceId,
      tierKey: BILLING_CATALOG[0].tierKey,
      interval: BILLING_CATALOG[0].interval,
    });
    expect(diag.catalog).toHaveLength(BILLING_CATALOG.length);
  });
});

describe("buildPaymentsDiagnostics - kondycja dziennika zdarzeń", () => {
  it("brak zdarzeń: błędów zero („ok”), ale RUCH ostrzega", async () => {
    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_failures")).toMatchObject({ state: "ok", detail: "0/0" });
    // Cisza w dzienniku znaczy „nie wiem, czy działa" - to ostrzeżenie.
    expect(checkById(diag, "webhook_traffic")).toMatchObject({ state: "warn", detail: "-" });
  });

  it("policzone stany i średni czas obsługi", async () => {
    h.webhookRows.current = [
      { status: "processed", created_at: "2026-08-18T10:00:00.000Z", duration_ms: 100 },
      { status: "processed", created_at: "2026-08-18T09:00:00.000Z", duration_ms: 200 },
      { status: "failed", created_at: "2026-08-18T08:00:00.000Z", duration_ms: null },
      { status: "skipped", created_at: "2026-08-18T07:00:00.000Z", duration_ms: 50 },
      { status: "received", created_at: "2026-08-18T06:00:00.000Z", duration_ms: -1 },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.webhooks).toMatchObject({
      total: 5,
      processed: 2,
      failed: 1,
      skipped: 1,
      received: 1,
      lastEventAt: "2026-08-18T10:00:00.000Z",
    });
    // Średnia z 100, 200 i 50 - czas ujemny i `null` nie wchodzą do średniej.
    expect(diag.webhooks.avgDurationMs).toBe(117);
  });

  it("brak czasów obsługi daje `null`, nie zero", async () => {
    h.webhookRows.current = [
      { status: "processed", created_at: "2026-08-18T10:00:00.000Z", duration_ms: null },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.webhooks.avgDurationMs).toBeNull();
    expect(diag.webhooks.total).toBe(1);
  });

  it("JAKIKOLWIEK BŁĄD w dzienniku to `error` z proporcją", async () => {
    h.webhookRows.current = [
      { status: "processed", created_at: "2026-08-18T10:00:00.000Z", duration_ms: 10 },
      { status: "failed", created_at: "2026-08-18T09:00:00.000Z", duration_ms: 10 },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_failures")).toMatchObject({ state: "error", detail: "1/2" });
    expect(checkById(diag, "webhook_traffic").state).toBe("ok");
  });

  it("dziennik czytany jest per ŚRODOWISKO i tylko z ostatniego tygodnia", async () => {
    await buildPaymentsDiagnostics("live", TENANT);

    const chain = h.chains.find((entry) => entry.table === "payment_webhook_events")!;
    expect(chain.filters).toContainEqual(["environment", "live"]);
    expect(chain.filters.some(([column]) => column === "created_at")).toBe(true);
  });

  it("dziennik jest też zawężony do NAJEMCY, nie tylko do środowiska", async () => {
    // Klient jest serwisowy, więc omija RLS - jedynym zakresem jest ten filtr.
    // Asercja stoi na kontrakcie ZAPYTANIA, bo moduł nie wybiera kolumny
    // `tenant_id`: po samym wyniku nie da się odróżnić najemców.
    await buildPaymentsDiagnostics("live", TENANT);

    const chain = h.chains.find((entry) => entry.table === "payment_webhook_events")!;
    expect(chain.filters).toContainEqual(["tenant_id", TENANT]);
  });
});

describe("buildPaymentsDiagnostics - kupony B2B wobec rabatów operatora", () => {
  it("kupon procentowy jest opisany jako procentowy", async () => {
    h.coupons.current = [
      {
        code: "nes10",
        active: true,
        discount_kind: "percent",
        discount_percent: 10,
        redemptions_count: 3,
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0]).toMatchObject({
      code: "NES10",
      discountKind: "percent",
      discountPercent: 10,
      timesRedeemed: 3,
    });
  });

  it("KOD jest normalizowany do wielkich liter (klucz naturalny po obu stronach)", async () => {
    h.coupons.current = [{ code: "mixedCase", active: true, discount_kind: "percent" }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].code).toBe("MIXEDCASE");
    expect(diag.coupons[0].code).not.toBe("mixedCase");
  });

  it("kupon kwotowy niesie kwotę i walutę", async () => {
    h.coupons.current = [
      {
        code: "FIX50",
        active: true,
        discount_kind: "fixed",
        discount_cents: 5000,
        currency: "EUR",
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0]).toMatchObject({
      discountKind: "fixed",
      discountCents: 5000,
      currency: "EUR",
    });
  });

  it("BRAK RABATU u operatora to `null`, nie błąd - powstaje przy pierwszym użyciu", async () => {
    h.coupons.current = [{ code: "NOWY", active: true, discount_kind: "percent" }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].providerDiscountId).toBeNull();
    expect(diag.coupons).toHaveLength(1);
  });

  it("istniejący rabat u operatora jest raportowany identyfikatorem", async () => {
    h.coupons.current = [{ code: "ZNANY", active: true, discount_kind: "percent" }];
    h.promoByCode.current.set("ZNANY", "promo_znany");

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].providerDiscountId).toBe("promo_znany");
  });

  it("awaria odczytu rabatu nie wywala raportu (kupon zostaje z `null`)", async () => {
    h.coupons.current = [{ code: "PADNIETY", active: true, discount_kind: "percent" }];
    h.promoThrows.current = true;

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].providerDiscountId).toBeNull();
    expect(diag.coupons[0].code).toBe("PADNIETY");
  });

  it("kupon nadający warstwę niesie warstwę i długość nadania", async () => {
    h.coupons.current = [
      {
        code: "VIP",
        active: true,
        discount_kind: "percent",
        grants_tier_key: "member",
        grants_duration_days: 90,
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0]).toMatchObject({ grantsTierKey: "member", grantsDurationDays: 90 });
  });

  it("kupon nieaktywny jest oznaczony jako nieaktywny, nie pomijany", async () => {
    h.coupons.current = [{ code: "STARY", active: false, discount_kind: "percent" }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].active).toBe(false);
    expect(diag.coupons).toHaveLength(1);
  });

  it("tabela kuponów jest w zakresie NAJEMCY admina - klient serwisowy omija RLS", async () => {
    h.coupons.current = [{ code: "SWOJ", active: true, discount_kind: "percent" }];

    await buildPaymentsDiagnostics("sandbox", TENANT);

    const chain = h.chains.find((entry) => entry.table === "b2b_coupons")!;
    expect(chain.filters).toContainEqual(["tenant_id", TENANT]);
  });

  it("kod ogólny: `countedAtCheckout` fałsz i pytanie o KAŻDY kod promocyjny operatora", async () => {
    h.coupons.current = [
      {
        code: "OGOLNY",
        active: true,
        discount_kind: "percent",
        event_ids: [],
        applies_discount: true,
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].countedAtCheckout).toBe(false);
    expect(h.promoListCalls).toEqual([{ code: "OGOLNY", limit: 1 }]);
  });

  it("kod WYDARZENIA jest liczony w naszej kasie - u operatora szukamy tylko AKTYWNEJ kopii", async () => {
    h.coupons.current = [
      {
        code: "kongres-50",
        active: true,
        discount_kind: "fixed",
        discount_cents: 5000,
        event_ids: ["22222222-2222-2222-2222-222222222222"],
      },
    ];
    h.promoByCode.current.set("KONGRES-50", "promo_stary");

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0]).toMatchObject({
      code: "KONGRES-50",
      countedAtCheckout: true,
      // Aktywna kopia z dawnej synchronizacji - panel każe ją wyłączyć.
      providerDiscountId: "promo_stary",
    });
    expect(h.promoListCalls).toEqual([{ code: "KONGRES-50", limit: 1, active: true }]);
  });

  it("kod BEZ RABATU też jest liczony w naszej kasie", async () => {
    h.coupons.current = [
      { code: "ODSLON", active: true, discount_kind: "percent", applies_discount: false },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].countedAtCheckout).toBe(true);
  });

  it("kupon z pustym kodem nie jest pytany u operatora", async () => {
    h.coupons.current = [{ code: "", active: true, discount_kind: "percent" }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons[0].providerDiscountId).toBeNull();
    expect(diag.coupons[0].code).toBe("");
  });
});

describe("syncCouponDiscounts - IDEMPOTENCJA", () => {
  it("ISTNIEJĄCY rabat nie jest tworzony po raz drugi", async () => {
    h.coupons.current = [{ code: "ISTNIEJE", discount_kind: "percent", discount_percent: 10 }];
    h.promoByCode.current.set("ISTNIEJE", "promo_1");

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1 - 1, existing: 1, failed: 0, skipped: 0 });
    expect(h.createdCoupons).toHaveLength(0);
  });

  it("brakujący rabat jest tworzony raz, z kodem jako kluczem", async () => {
    h.coupons.current = [{ code: "nowy", discount_kind: "percent", discount_percent: 25 }];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdPromos[0]).toMatchObject({ code: "NOWY" });
  });

  it("kupon PROCENTOWY jedzie z procentem, bez kwoty", async () => {
    h.coupons.current = [{ code: "P30", discount_kind: "percent", discount_percent: 30 }];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdCoupons[0]).toMatchObject({ percent_off: 30, duration: "once" });
    expect(h.createdCoupons[0]).not.toHaveProperty("amount_off");
  });

  it("kupon KWOTOWY jedzie z kwotą i walutą małymi literami", async () => {
    h.coupons.current = [
      { code: "K50", discount_kind: "fixed", discount_cents: 5000, currency: "PLN" },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdCoupons[0]).toMatchObject({ amount_off: 5000, currency: "pln" });
    expect(h.createdCoupons[0]).not.toHaveProperty("percent_off");
  });

  it("kwota UJEMNA jest przycinana do zera, nie wysyłana operatorowi", async () => {
    h.coupons.current = [
      { code: "UJEMNY", discount_kind: "fixed", discount_cents: -100, currency: "PLN" },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdCoupons[0]).toMatchObject({ amount_off: 0 });
    expect(h.createdCoupons[0].amount_off).not.toBe(-100);
  });

  it("data ważności jedzie jako znacznik sekundowy", async () => {
    h.coupons.current = [
      {
        code: "DOKIEDY",
        discount_kind: "percent",
        discount_percent: 10,
        valid_until: "2026-12-31T00:00:00.000Z",
      },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdPromos[0].expires_at).toBe(
      Math.floor(Date.parse("2026-12-31T00:00:00.000Z") / 1000),
    );
    expect(typeof h.createdPromos[0].expires_at).toBe("number");
  });

  it("bez daty ważności rabat nie dostaje pustego pola wygaśnięcia", async () => {
    h.coupons.current = [{ code: "BEZTERMINU", discount_kind: "percent", discount_percent: 10 }];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdPromos[0]).not.toHaveProperty("expires_at");
    expect(h.createdPromos[0]).toMatchObject({ code: "BEZTERMINU" });
  });

  it("limit użyć jedzie tylko wtedy, gdy jest ustawiony", async () => {
    h.coupons.current = [
      { code: "LIMIT", discount_kind: "percent", discount_percent: 10, max_redemptions: 5 },
      { code: "BEZLIMITU", discount_kind: "percent", discount_percent: 10 },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdPromos[0]).toMatchObject({ max_redemptions: 5 });
    expect(h.createdPromos[1]).not.toHaveProperty("max_redemptions");
  });

  it("AWARIA jednego kuponu nie przerywa synchronizacji pozostałych", async () => {
    h.coupons.current = [
      { code: "PIERWSZY", discount_kind: "percent", discount_percent: 10 },
      { code: "DRUGI", discount_kind: "percent", discount_percent: 10 },
    ];
    h.couponCreateThrows.current = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 2, skipped: 0 });
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("kupon z pustym kodem jest POMIJANY, nie liczony jako porażka", async () => {
    h.coupons.current = [
      { code: "", discount_kind: "percent", discount_percent: 10 },
      { code: "OK", discount_kind: "percent", discount_percent: 10 },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdPromos).toHaveLength(1);
  });

  it("synchronizacja bierze WYŁĄCZNIE kupony aktywne", async () => {
    h.coupons.current = [{ code: "AKTYWNY", discount_kind: "percent", discount_percent: 10 }];

    await syncCouponDiscounts("sandbox", TENANT);

    const chain = h.chains.find((entry) => entry.table === "b2b_coupons")!;
    expect(chain.filters).toContainEqual(["active", true]);
  });

  it("pusty zbiór kuponów daje same zera, nie wyjątek", async () => {
    h.coupons.current = [];

    expect(await syncCouponDiscounts("sandbox", TENANT)).toEqual({
      created: 0,
      existing: 0,
      failed: 0,
      skipped: 0,
    });
    expect(h.createdPromos).toHaveLength(0);
  });
});

describe("syncCouponDiscounts - CO NIE JEDZIE do operatora", () => {
  // Kod ze studia wydarzenia liczy NASZA kasa - rabat kwotowy od każdego
  // miejsca, zakres biletu, limit użyć, wiersz realizacji. Jego kopia w Stripe
  // była rabatem `amount_off` zdejmowanym RAZ z całej sesji: właściciel
  // wpisywał kod w nakładce operatora i widział „kod odjął się raz od całego
  // zamówienia", a baza o tym nie wiedziała.
  it("kupony TYLKO najemcy admina - klient serwisowy omija RLS", async () => {
    h.coupons.current = [{ code: "SWOJ", discount_kind: "percent", discount_percent: 10 }];

    await syncCouponDiscounts("sandbox", TENANT);

    const chain = h.chains.find((entry) => entry.table === "b2b_coupons")!;
    expect(chain.filters).toContainEqual(["tenant_id", TENANT]);
  });

  it("kody wydarzeń i kody bez rabatu odpadają W ZAPYTANIU - przed `limit(200)`", async () => {
    // Filtr po stronie klienta liczył się PO limicie: najemca z setkami kodów
    // wydarzeń wypychał z okna synchronizacji kody ogólne.
    await syncCouponDiscounts("sandbox", TENANT);

    const chain = h.chains.find((entry) => entry.table === "b2b_coupons")!;
    expect(chain.filters).toContainEqual(["applies_discount", true]);
    expect(chain.filters).toContainEqual(["event_ids", "eq.{}"]);
  });

  it("kod WYDARZENIA (niepuste `event_ids`) jest pomijany - bez kuponu i bez kodu promocyjnego", async () => {
    h.coupons.current = [
      {
        code: "KONGRES-50",
        discount_kind: "fixed",
        discount_cents: 5000,
        currency: "PLN",
        event_ids: ["22222222-2222-2222-2222-222222222222"],
      },
      { code: "OGOLNY", discount_kind: "percent", discount_percent: 10, event_ids: [] },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdPromos.map((promo) => promo.code)).toEqual(["OGOLNY"]);
    expect(h.createdCoupons).toHaveLength(1);
  });

  it("kod BEZ RABATU (tylko odsłania bilety) jest pomijany", async () => {
    // Obie kwoty NULL: kopia w Stripe byłaby rabatem zero albo, przy
    // domyślnym procencie, darmową wejściówką.
    h.coupons.current = [
      { code: "ODSLON", discount_kind: "percent", discount_percent: null, applies_discount: false },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdPromos).toHaveLength(0);
  });

  it("wiersz bez kolumn zakresu (starszy schemat) jest traktowany jak kod ogólny", async () => {
    h.coupons.current = [{ code: "STARY", discount_kind: "percent", discount_percent: 5 }];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
  });

  it("nazwa kuponu mieści się w limicie Stripe (40 znaków) także dla długiego kodu", async () => {
    h.coupons.current = [
      {
        code: "PARTNER-STRATEGICZNY-2026-EDYCJA-JESIENNA",
        discount_kind: "percent",
        discount_percent: 5,
      },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    const name = String(h.createdCoupons[0]?.name);
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.startsWith("Kupon PARTNER-STRATEGICZNY")).toBe(true);
    expect(h.createdPromos[0]).toMatchObject({ code: "PARTNER-STRATEGICZNY-2026-EDYCJA-JESIENNA" });
  });
});

describe("PUSTA odpowiedź bazy - `null` zamiast tablicy", () => {
  // Diagnostyka to narzędzie, którym gasi się pożar. Jeżeli sama wywali się
  // na `null` z PostgREST-a, administrator zostaje bez jedynej kontrolki w
  // chwili, w której naprawdę jej potrzebuje. Kontrolka ma pokazać ZERO,
  // nie zniknąć.
  it("brak wierszy dziennika zdarzeń daje zerową kondycję, nie wyjątek", async () => {
    h.webhookRows.current = null;

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.webhooks.total).toBe(0);
    expect(diag.webhooks.lastEventAt).toBeNull();
  });

  it("brak kuponów w bazie daje pustą listę porównania z operatorem", async () => {
    h.coupons.current = null;

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons).toEqual([]);
  });

  it("synchronizacja przy `null` z bazy nie próbuje niczego tworzyć", async () => {
    h.coupons.current = null;

    expect(await syncCouponDiscounts("sandbox", TENANT)).toEqual({
      created: 0,
      existing: 0,
      failed: 0,
      skipped: 0,
    });
    expect(h.createdCoupons).toHaveLength(0);
  });
});

describe("KUPON Z DZIURAMI - kolumny, które przyszły puste", () => {
  it("kupon BEZ KODU nie jest wysyłany operatorowi", async () => {
    // Kod jest kluczem naturalnym po obu stronach. Rabat utworzony pod pustym
    // kodem byłby nie do odnalezienia i nie do wycofania.
    h.coupons.current = [
      { code: null, discount_kind: "percent", discount_percent: 10 },
      { code: "PRAWIDLOWY", discount_kind: "percent", discount_percent: 10 },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdPromos).toHaveLength(1);
    expect(h.createdPromos[0]).toMatchObject({ code: "PRAWIDLOWY" });
  });

  it("kupon bez kodu pokazuje się w kontrolce jako PUSTY, nie jako „null”", async () => {
    // Kontrolka ma pokazać, że taki wiersz w bazie jest - to defekt do
    // naprawienia, a nie coś do ukrycia przed administratorem.
    h.coupons.current = [{ code: null, discount_kind: "percent", discount_percent: 10 }];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(diag.coupons).toHaveLength(1);
    expect(diag.coupons[0].code).toBe("");
    expect(diag.coupons[0].providerDiscountId).toBeNull();
  });

  it("kupon PROCENTOWY bez procentu jedzie jako zero, nie jako `undefined`", async () => {
    // `percent_off: undefined` operator odrzuca błędem walidacji - cała
    // synchronizacja liczyłaby wtedy porażkę zamiast utworzyć rabat zerowy,
    // który administrator od razu widzi i poprawia.
    h.coupons.current = [{ code: "BEZPROCENTU", discount_kind: "percent", discount_percent: null }];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdCoupons[0]).toMatchObject({ percent_off: 0 });
  });

  it("kupon KWOTOWY bez kwoty i waluty schodzi na zero i PLN", async () => {
    h.coupons.current = [
      { code: "BEZKWOTY", discount_kind: "fixed", discount_cents: null, currency: null },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdCoupons[0]).toMatchObject({ amount_off: 0, currency: "pln" });
  });
});

describe("buildPaymentsDiagnostics - subskrybowane typy zdarzeń (audyt PAY-06)", () => {
  // Zdarzenie spoza subskrypcji odbiornika NIE PRZYCHODZI wcale. Brak
  // `checkout.session.expired` to rezerwacje kuponów, które nigdy nie wracają
  // do puli; brak `charge.dispute.closed` - spór, którego rozstrzygnięcie nie
  // przywraca ani nie zamyka dostępu. Kontrola musi wymienić brakujące typy
  // z nazwy, bo to operator włącza je w panelu Stripe.
  it("odbiornik z kompletem obsługiwanych typów daje „ok” i pustą listę braków", async () => {
    h.endpoints.current = [
      {
        id: "we_1",
        url: APP_WEBHOOK_URL,
        status: "enabled",
        enabled_events: [...STRIPE_WEBHOOK_EVENT_TYPES],
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);
    const total = STRIPE_WEBHOOK_EVENT_TYPES.length;

    expect(checkById(diag, "webhook_events")).toEqual({
      id: "webhook_events",
      state: "ok",
      detail: `${total}/${total}`,
    });
    expect(diag.missingWebhookEvents).toEqual([]);
  });

  it("`*` u operatora znaczy wszystkie zdarzenia - niczego nie brakuje", async () => {
    h.endpoints.current = [
      { id: "we_1", url: APP_WEBHOOK_URL, status: "enabled", enabled_events: ["*"] },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_events").state).toBe("ok");
    expect(diag.missingWebhookEvents).toEqual([]);
  });

  it("BRAK `checkout.session.expired` i `charge.dispute.closed` to ostrzeżenie z ich nazwami", async () => {
    const enabled = STRIPE_WEBHOOK_EVENT_TYPES.filter(
      (type) => type !== "checkout.session.expired" && type !== "charge.dispute.closed",
    );
    h.endpoints.current = [
      { id: "we_1", url: APP_WEBHOOK_URL, status: "enabled", enabled_events: enabled },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);
    const total = STRIPE_WEBHOOK_EVENT_TYPES.length;

    expect(checkById(diag, "webhook_events")).toMatchObject({
      state: "warn",
      detail: `${total - 2}/${total}`,
    });
    expect(diag.missingWebhookEvents).toEqual([
      "checkout.session.expired",
      "charge.dispute.closed",
    ]);
    expect(diag.destinations[0]?.missingEvents).toEqual(diag.missingWebhookEvents);
  });

  it("obcy odbiornik z kompletem zdarzeń nie zasłania braków NASZEGO", async () => {
    h.endpoints.current = [
      { id: "we_obcy", url: "https://obcy.test/hook", status: "enabled", enabled_events: ["*"] },
      {
        id: "we_1",
        url: APP_WEBHOOK_URL,
        status: "enabled",
        enabled_events: ["checkout.session.completed"],
      },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_events").state).toBe("warn");
    expect(diag.missingWebhookEvents).toContain("invoice.paid");
    expect(diag.missingWebhookEvents).not.toContain("checkout.session.completed");
  });

  it("liczą się AKTYWNE odbiorniki: wyłączona stara kopia bez zdarzeń nie świeci", async () => {
    h.endpoints.current = [
      { id: "we_stary", url: APP_WEBHOOK_URL, status: "disabled", enabled_events: [] },
      { id: "we_1", url: APP_WEBHOOK_URL, status: "enabled", enabled_events: ["*"] },
    ];

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_events").state).toBe("ok");
    expect(diag.missingWebhookEvents).toEqual([]);
  });

  it("brak naszego odbiornika to `error` - zdarzenia nie mają dokąd dojść", async () => {
    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_events")).toMatchObject({
      state: "error",
      detail: "no_endpoint",
    });
  });

  it("bez kluczy bramki kontrola zdarzeń ostrzega, zamiast zgadywać", async () => {
    h.configured.current = false;

    const diag = await buildPaymentsDiagnostics("sandbox", TENANT);

    expect(checkById(diag, "webhook_events").state).toBe("warn");
    expect(diag.missingWebhookEvents).toEqual([]);
  });

  it("missingWebhookEventTypes: lista w kolejności obsługiwanych typów", () => {
    expect(missingWebhookEventTypes(["*"])).toEqual([]);
    expect(missingWebhookEventTypes([])).toEqual([...STRIPE_WEBHOOK_EVENT_TYPES]);
  });
});

describe("syncCouponDiscounts - zawężenie kodów na WSPÓLNYM koncie (audyt PAY-06)", () => {
  const PLAN_PRO = "aaaaaaaa-0000-4000-8000-0000000000aa";
  const PLAN_LAB = "aaaaaaaa-0000-4000-8000-0000000000bb";

  it("najemca BEZ pola kodu Stripe: nic nie jedzie do operatora, kody liczą się jako pominięte", async () => {
    // Najemca, który pola nie włączył, nie ma gdzie przyjąć kodu, a kopia na
    // wspólnym koncie zadziałałaby u każdego najemcy z włączonym polem.
    h.checkoutSettings.current = { allow_promotion_codes: false };
    h.coupons.current = [
      { id: "c1", code: "PIERWSZY", discount_kind: "percent", discount_percent: 10 },
      { id: "c2", code: "DRUGI", discount_kind: "percent", discount_percent: 10 },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 0, skipped: 2 });
    expect(h.createdCoupons).toHaveLength(0);
    expect(h.createdPromos).toHaveLength(0);
    expect(h.promoListCalls).toHaveLength(0);
    const settings = h.chains.find((entry) => entry.table === "checkout_settings")!;
    expect(settings.filters).toContainEqual(["tenant_id", TENANT]);
  });

  it("brak wiersza ustawień (domyślne) też niczego nie wypycha - fail-closed", async () => {
    h.checkoutSettings.current = null;
    h.coupons.current = [{ id: "c1", code: "KOD", discount_kind: "percent", discount_percent: 5 }];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 0, skipped: 1 });
    expect(h.createdPromos).toHaveLength(0);
  });

  it("kod i kupon niosą metadane `{ source, tenant_id, coupon_id }`", async () => {
    h.coupons.current = [
      { id: "c-ogolny", code: "OGOLNY", discount_kind: "percent", discount_percent: 10 },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    const metadata = { source: "b2b_coupon_sync", tenant_id: TENANT, coupon_id: "c-ogolny" };
    expect(h.createdPromos[0]).toMatchObject({ metadata });
    expect(h.createdCoupons[0]).toMatchObject({ metadata });
  });

  it("kod PLANOWY dostaje `applies_to.products` z produktem ceny katalogowej planu", async () => {
    h.coupons.current = [
      {
        id: "c-pro",
        code: "PROMO-PRO",
        discount_kind: "fixed",
        discount_cents: 2000,
        currency: "PLN",
        plan_ids: [PLAN_PRO],
      },
    ];
    h.plans.current = [{ id: PLAN_PRO, tier_key: "pro", interval: "month" }];
    h.prices.current.set("pro_monthly", { id: "price_pro", product: { id: "prod_pro" } });

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 0 });
    expect(h.createdCoupons[0]).toMatchObject({ applies_to: { products: ["prod_pro"] } });
    // Plany czytane w zakresie najemcy - klient serwisowy omija RLS.
    const plans = h.chains.find((entry) => entry.table === "access_plans")!;
    expect(plans.filters).toContainEqual(["tenant_id", TENANT]);
    expect(plans.filters).toContainEqual(["id", [PLAN_PRO]]);
  });

  it("kod planowy z planem BEZ rozwiązanego produktu NIE jedzie (fail-closed)", async () => {
    // Bez `applies_to` kod działałby u operatora na KAŻDY produkt wspólnego
    // konta - także na plany, których kupon w bazie nie obejmuje.
    h.coupons.current = [
      {
        id: "c-mix",
        code: "MIX",
        discount_kind: "percent",
        discount_percent: 20,
        plan_ids: [PLAN_PRO, PLAN_LAB],
      },
      { id: "c-ogolny", code: "OGOLNY", discount_kind: "percent", discount_percent: 10 },
    ];
    // Plan Lab nie istnieje u najemcy (albo nie ma ceny) - produktu brak.
    h.plans.current = [{ id: PLAN_PRO, tier_key: "pro", interval: "month" }];
    h.prices.current.set("pro_monthly", { id: "price_pro", product: "prod_pro" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 1, existing: 0, failed: 0, skipped: 1 });
    expect(h.createdPromos.map((promo) => promo.code)).toEqual(["OGOLNY"]);
    expect(h.createdCoupons[0]).not.toHaveProperty("applies_to");
    consoleError.mockRestore();
  });

  it("kod PRZED datą startu nie jedzie - operator nie zna `valid_from`", async () => {
    h.coupons.current = [
      {
        id: "c-jutro",
        code: "JUTRO",
        discount_kind: "percent",
        discount_percent: 10,
        valid_from: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 0, skipped: 1 });
    expect(h.createdPromos).toHaveLength(0);
  });

  it("kod po terminie i kod z wyczerpanym limitem nie jadą", async () => {
    h.coupons.current = [
      {
        id: "c-stary",
        code: "STARY",
        discount_kind: "percent",
        discount_percent: 10,
        valid_until: new Date(Date.now() - 86_400_000).toISOString(),
      },
      {
        id: "c-pelny",
        code: "PELNY",
        discount_kind: "percent",
        discount_percent: 10,
        max_redemptions: 5,
        redemptions_count: 5,
      },
    ];

    const result = await syncCouponDiscounts("sandbox", TENANT);

    expect(result).toEqual({ created: 0, existing: 0, failed: 0, skipped: 2 });
  });

  it("limit użyć u operatora to RESZTA limitu z bazy, nie pełny limit", async () => {
    // Liczniki bazy i operatora są rozłączne - pełny limit u operatora
    // podwajałby pulę kodu, który w bazie jest już w połowie zużyty.
    h.coupons.current = [
      {
        id: "c-limit",
        code: "LIMIT",
        discount_kind: "percent",
        discount_percent: 10,
        max_redemptions: 10,
        redemptions_count: 4,
      },
    ];

    await syncCouponDiscounts("sandbox", TENANT);

    expect(h.createdPromos[0]).toMatchObject({ max_redemptions: 6 });
  });

  it("kupon i kod operatora dostają klucze idempotencji - stałe dla tych samych parametrów", async () => {
    h.coupons.current = [
      { id: "c-klucz", code: "KLUCZ", discount_kind: "percent", discount_percent: 10 },
    ];

    await syncCouponDiscounts("sandbox", TENANT);
    await syncCouponDiscounts("sandbox", TENANT);

    const [firstCoupon, secondCoupon] = h.couponOptions as Array<{ idempotencyKey: string }>;
    const [firstPromo] = h.promoOptions as Array<{ idempotencyKey: string }>;
    expect(firstCoupon?.idempotencyKey).toMatch(/^b2b_coupon_sync:c-klucz:coupon:[0-9a-f]{24}$/);
    expect(firstPromo?.idempotencyKey).toMatch(
      /^b2b_coupon_sync:c-klucz:promotion_code:[0-9a-f]{24}$/,
    );
    // Ponowiony przebieg z tymi samymi parametrami = ten sam klucz (operator
    // odda ten sam kupon zamiast drugiego).
    expect(secondCoupon?.idempotencyKey).toBe(firstCoupon?.idempotencyKey);
  });

  it("zmieniony kupon dostaje NOWY klucz - operator odrzuca klucz z innymi parametrami", async () => {
    h.coupons.current = [
      { id: "c-klucz", code: "KLUCZ", discount_kind: "percent", discount_percent: 10 },
    ];
    await syncCouponDiscounts("sandbox", TENANT);
    h.coupons.current = [
      { id: "c-klucz", code: "KLUCZ", discount_kind: "percent", discount_percent: 15 },
    ];
    await syncCouponDiscounts("sandbox", TENANT);

    const [first, second] = h.couponOptions as Array<{ idempotencyKey: string }>;
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });
});
