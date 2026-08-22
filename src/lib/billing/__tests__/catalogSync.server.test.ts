// Synchronizacja katalogu planów z operatorem: `access_plans` (źródło prawdy
// aplikacji) + `BILLING_CATALOG` (czytelne identyfikatory) -> produkty i ceny
// u operatora. Testujemy KONTRAKT wysyłki: co jest zakładane, co korygowane,
// czego nie ruszamy i co się dzieje, gdy operator albo konfiguracja zawiodą.
//
// Plik przejmuje też rolę skasowanego `paddleTrialPeriod.test.ts` (migracja
// Paddle -> Stripe): okres próbny z katalogu planów MUSI trafić na cenę u
// operatora - patrz describe "okres próbny".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PlanRow {
  tier_key: string | null;
  interval: string | null;
  price_cents: number | null;
  currency: string | null;
  name_pl: string | null;
  name_en: string | null;
  description_pl: string | null;
  trial_days: number | null;
  active: boolean | null;
  volume_threshold_seats: number | null;
  volume_price_cents: number | null;
}

const h = vi.hoisted(() => ({
  /** Środowiska, dla których zbudowano klienta bramki. */
  envs: [] as string[],
  /** Wstrzyknięty brak konfiguracji operatora. */
  clientError: null as Error | null,
  /** Wiersze `access_plans` zwracane przez klienta serwisowego. */
  plans: [] as unknown[],
  /** Kolumny odpytane w bazie (liczba przebiegów synchronizacji). */
  selects: [] as string[],
  /** Produkty widoczne u operatora, kluczowane po `lovable_external_id`. */
  remoteProducts: {} as Record<string, { id: string } | undefined>,
  /** Ceny widoczne u operatora, kluczowane po `lookup_key`. */
  remotePrices: {} as Record<string, Record<string, unknown> | undefined>,
  /** Awarie wyszukiwania produktu wstrzykiwane po `lovable_external_id`. */
  productSearchErrors: {} as Record<string, Error | undefined>,
  /** Czy nowo założony produkt jest od razu widoczny w wyszukiwarce operatora. */
  indexNewProducts: true,
  productSearch: vi.fn(),
  productCreate: vi.fn(),
  priceList: vi.fn(),
  priceCreate: vi.fn(),
  priceUpdate: vi.fn(),
  reap: vi.fn(),
}));

vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: (env: string) => {
    if (h.clientError) throw h.clientError;
    h.envs.push(env);
    return {
      products: { search: h.productSearch, create: h.productCreate },
      prices: { list: h.priceList, create: h.priceCreate, update: h.priceUpdate },
    };
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: (columns: string) => {
        h.selects.push(columns);
        return Promise.resolve({ data: h.plans, error: null });
      },
    }),
  },
}));

vi.mock("../catalogReap.server", () => ({
  reapOrphanCatalogEntries: (input: unknown) => h.reap(input) as Promise<unknown>,
}));

import { BILLING_CATALOG } from "@/lib/billing/catalog";
import {
  healCatalogOnce,
  syncBillingCatalog,
  trialDaysForPrice,
  type CatalogSyncReport,
} from "@/lib/billing/catalogSync.server";

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
  tier_key: "member",
  interval: "month",
  price_cents: 4900,
  currency: "PLN",
  name_pl: "Plus",
  name_en: "Plus",
  description_pl: "Opis planu",
  trial_days: null,
  active: true,
  volume_threshold_seats: null,
  volume_price_cents: null,
  ...over,
});

/** Cena, którą operator już ma dla `plus_monthly` - zgodna ze `plan()`. */
const remotePlusMonthly = (over: Record<string, unknown> = {}) => ({
  id: "price_plus_m",
  lookup_key: "plus_monthly",
  unit_amount: 4900,
  currency: "pln",
  recurring: { interval: "month", interval_count: 1 },
  metadata: {} as Record<string, string>,
  ...over,
});

const args = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map((c) => c[0] as Record<string, unknown>);

/** Parametry `prices.create` dla konkretnego czytelnego identyfikatora ceny. */
const priceCreateFor = (lookupKey: string) =>
  args(h.priceCreate).find((p) => p["lookup_key"] === lookupKey);

const itemFor = (report: CatalogSyncReport, priceId: string) =>
  report.items.find((i) => i.priceId === priceId);

const reapInput = () =>
  h.reap.mock.calls[0]?.[0] as
    | {
        env: string;
        expectedPriceIds: Set<string>;
        expectedProductIds: Set<string>;
        inactivePriceIds: Set<string>;
      }
    | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  h.envs.length = 0;
  h.selects.length = 0;
  h.clientError = null;
  h.plans = [plan()];
  h.remoteProducts = {};
  h.remotePrices = {};
  h.productSearchErrors = {};
  h.indexNewProducts = true;

  h.productSearch.mockImplementation((params: { query: string }) => {
    const externalId = /lovable_external_id'\]:'([^']+)'/.exec(params.query)?.[1] ?? "";
    const failure = h.productSearchErrors[externalId];
    if (failure) return Promise.reject(failure);
    const found = h.remoteProducts[externalId];
    return Promise.resolve({ data: found ? [found] : [] });
  });
  h.productCreate.mockImplementation((params: { metadata: Record<string, string> }) => {
    const externalId = params.metadata["lovable_external_id"] ?? "";
    const created = { id: `prod_${externalId}` };
    // Wyszukiwarka operatora jest spójna dopiero po chwili - flagą odwzorowujemy
    // oba warianty (patrz test o opóźnionym indeksie).
    if (h.indexNewProducts) h.remoteProducts[externalId] = created;
    return Promise.resolve(created);
  });
  h.priceList.mockImplementation((params: { lookup_keys?: string[] }) => {
    const found = h.remotePrices[params.lookup_keys?.[0] ?? ""];
    return Promise.resolve({ data: found ? [found] : [] });
  });
  h.priceCreate.mockImplementation((params: { lookup_key?: string }) =>
    Promise.resolve({ id: `price_new_${params.lookup_key ?? "x"}` }),
  );
  h.priceUpdate.mockResolvedValue({});
  h.reap.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncBillingCatalog - zakładanie brakujących pozycji", () => {
  it("zakłada produkt i cenę, gdy operator nie ma jeszcze katalogu", async () => {
    const report = await syncBillingCatalog("live");

    expect(h.envs).toContain("live");
    expect(args(h.productCreate)).toContainEqual({
      name: "Plus",
      description: "Opis planu",
      tax_code: "txcd_10103000",
      metadata: { lovable_external_id: "plan_plus" },
    });
    expect(priceCreateFor("plus_monthly")).toEqual({
      product: "prod_plan_plus",
      currency: "pln",
      unit_amount: 4900,
      recurring: { interval: "month", interval_count: 1 },
      lookup_key: "plus_monthly",
      nickname: "Plus (month)",
      metadata: { lovable_external_id: "plus_monthly" },
    });
    expect(itemFor(report, "plus_monthly")).toMatchObject({
      product: "created",
      price: "created",
      productId: "plan_plus",
    });
    expect(report.environment).toBe("live");
    expect(report.failed).toBe(0);
    expect(report.created).toBeGreaterThan(0);
    expect(Date.parse(report.ranAt)).not.toBeNaN();
  });

  it("nazwa spada na wersję angielską, a potem na tier; brak kwoty to zero", async () => {
    h.plans = [plan({ name_pl: null, name_en: "Member", price_cents: null, description_pl: null })];

    await syncBillingCatalog("sandbox");

    expect(args(h.productCreate)[0]).toMatchObject({ name: "Member", description: undefined });
    expect(priceCreateFor("plus_monthly")).toMatchObject({
      unit_amount: 0,
      nickname: "Member (month)",
    });
  });

  it("mapuje interwały aplikacji na słownik cykli operatora", async () => {
    h.plans = [
      plan({ tier_key: "business", interval: "two_weeks", name_pl: "Partner" }),
      plan({ tier_key: "business", interval: "quarter", name_pl: "Partner" }),
      plan({ tier_key: "member", interval: "year" }),
    ];

    await syncBillingCatalog("sandbox");

    expect(priceCreateFor("business_2w")).toMatchObject({
      recurring: { interval: "week", interval_count: 2 },
    });
    expect(priceCreateFor("business_quarterly")).toMatchObject({
      recurring: { interval: "month", interval_count: 3 },
    });
    expect(priceCreateFor("business_monthly")).toMatchObject({
      recurring: { interval: "month", interval_count: 1 },
    });
    expect(priceCreateFor("plus_annual")).toMatchObject({
      recurring: { interval: "year", interval_count: 1 },
    });
  });

  it("istniejący produkt jest ponownie użyty zamiast zakładany od nowa", async () => {
    h.remoteProducts["plan_plus"] = { id: "prod_istniejacy" };

    const report = await syncBillingCatalog("sandbox");

    expect(h.productCreate).not.toHaveBeenCalled();
    expect(priceCreateFor("plus_monthly")).toMatchObject({ product: "prod_istniejacy" });
    expect(itemFor(report, "plus_monthly")).toMatchObject({ product: "ok", price: "created" });
  });

  it("opóźniony indeks wyszukiwarki operatora zakłada produkt dwa razy w jednym przebiegu", async () => {
    // ZACHOWANIE UTRWALONE, NIE POŻĄDANE: `plus_monthly` i `plus_annual` dzielą
    // produkt `plan_plus`, a moduł nie pamięta w obrębie przebiegu, że dopiero co
    // go założył. Wyszukiwarka produktów operatora jest spójna z opóźnieniem,
    // więc drugie wyszukanie może nadal nic nie zwrócić -> duplikat produktu.
    h.indexNewProducts = false;
    h.plans = [plan({ interval: "month" }), plan({ interval: "year" })];

    await syncBillingCatalog("sandbox");

    const created = args(h.productCreate).filter(
      (p) => (p["metadata"] as Record<string, string>)["lovable_external_id"] === "plan_plus",
    );
    expect(created).toHaveLength(2);
  });
});

// Następca testu okresu próbnego skasowanego przy migracji operatora
// (dawne `paddleTrialPeriod.test.ts` - nazwa tylko w komentarzu, bo bramka CI
// nie dopuszcza żywych referencji do starego operatora).
describe("okres próbny planu w katalogu operatora", () => {
  it("trial_days z katalogu planów trafia do danych ceny wysyłanych do operatora", async () => {
    h.plans = [plan({ trial_days: 14 })];

    await syncBillingCatalog("sandbox");

    // Gdyby ta asercja padła, checkout obciążałby kartę od razu, mimo
    // `access_plans.trial_days` - dokładnie ten regres pilnował usunięty test.
    expect(priceCreateFor("plus_monthly")?.["metadata"]).toEqual({
      lovable_external_id: "plus_monthly",
      trial_days: "14",
    });
  });

  it("koryguje cenę, gdy u operatora brakuje okresu próbnego", async () => {
    h.plans = [plan({ trial_days: 14 })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly();

    const report = await syncBillingCatalog("sandbox");

    expect(h.priceUpdate).toHaveBeenCalledWith("price_plus_m", {
      metadata: { lovable_external_id: "plus_monthly", trial_days: "14" },
    });
    expect(priceCreateFor("plus_monthly")).toBeUndefined();
    expect(itemFor(report, "plus_monthly")?.price).toBe("updated");
  });

  it("nie rusza ceny, gdy kwota i okres próbny są zgodne", async () => {
    h.plans = [plan({ trial_days: 14 })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "14" } });

    const report = await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")).toBeUndefined();
    expect(h.priceUpdate).not.toHaveBeenCalled();
    expect(itemFor(report, "plus_monthly")?.price).toBe("ok");
    expect(report.updated).toBe(0);
  });

  it("zdjęcie triala w źródle prawdy czyści metadane u operatora", async () => {
    h.plans = [plan({ trial_days: null })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "14" } });

    const report = await syncBillingCatalog("sandbox");

    expect(h.priceUpdate).toHaveBeenCalledWith("price_plus_m", {
      metadata: { lovable_external_id: "plus_monthly" },
    });
    expect(itemFor(report, "plus_monthly")?.price).toBe("updated");
  });

  it("plan bez triala nie dokłada pustego trial_days", async () => {
    h.plans = [plan({ trial_days: 0 })];

    await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")?.["metadata"]).toEqual({
      lovable_external_id: "plus_monthly",
    });
  });

  it("wartość triala jest normalizowana (zaokrąglenie, brak wartości ujemnych)", async () => {
    h.plans = [plan({ trial_days: 13.6 })];
    await syncBillingCatalog("sandbox");
    expect(priceCreateFor("plus_monthly")?.["metadata"]).toMatchObject({ trial_days: "14" });

    vi.clearAllMocks();
    h.plans = [plan({ trial_days: -5 })];
    await syncBillingCatalog("sandbox");
    expect(priceCreateFor("plus_monthly")?.["metadata"]).toEqual({
      lovable_external_id: "plus_monthly",
    });
  });

  it("odtworzenie ceny po zmianie kwoty nie gubi okresu próbnego", async () => {
    h.plans = [plan({ price_cents: 5900, trial_days: 7 })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "7" } });

    await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")?.["metadata"]).toEqual({
      lovable_external_id: "plus_monthly",
      trial_days: "7",
    });
  });
});

describe("syncBillingCatalog - korekta rozjechanych pozycji", () => {
  it("zmiana kwoty zakłada nową cenę z przeniesieniem lookup_key i archiwizuje starą", async () => {
    h.plans = [plan({ price_cents: 7900 })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly();

    const report = await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")).toMatchObject({
      unit_amount: 7900,
      currency: "pln",
      lookup_key: "plus_monthly",
      transfer_lookup_key: true,
    });
    // Stara cena znika z oferty, ale NIE jest kasowana (historia transakcji).
    expect(h.priceUpdate).toHaveBeenCalledWith("price_plus_m", { active: false });
    expect(itemFor(report, "plus_monthly")?.price).toBe("updated");
    expect(report.updated).toBe(1);
  });

  it("zmiana waluty przenosi cenę na nową walutę zapisaną małymi literami", async () => {
    h.plans = [plan({ currency: "EUR" })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly();

    const report = await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")).toMatchObject({
      currency: "eur",
      unit_amount: 4900,
      transfer_lookup_key: true,
    });
    expect(itemFor(report, "plus_monthly")?.price).toBe("updated");
  });

  it("nowa nazwa planu dociera do operatora dopiero przy okazji korekty kwoty", async () => {
    h.plans = [plan({ name_pl: "Plus 2026", price_cents: 5900 })];
    h.remotePrices["plus_monthly"] = remotePlusMonthly();

    await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")).toMatchObject({ nickname: "Plus 2026 (month)" });
  });

  it("sama zmiana nazwy planu NIE dociera do operatora", async () => {
    // DEFEKT UTRWALONY: produkt jest zakładany tylko wtedy, gdy go nie ma -
    // nazwa/opis istniejącego produktu nigdy nie są korygowane, a `nickname`
    // ceny zmienia się wyłącznie przy odtwarzaniu ceny (zmiana kwoty/waluty).
    // Po zmianie nazwy planu w `access_plans` operator dalej pokazuje starą.
    h.plans = [plan({ name_pl: "Zupełnie nowa nazwa" })];
    h.remoteProducts["plan_plus"] = { id: "prod_istniejacy" };
    h.remotePrices["plus_monthly"] = remotePlusMonthly();

    const report = await syncBillingCatalog("sandbox");

    expect(h.productCreate).not.toHaveBeenCalled();
    expect(priceCreateFor("plus_monthly")).toBeUndefined();
    expect(h.priceUpdate).not.toHaveBeenCalled();
    expect(itemFor(report, "plus_monthly")).toMatchObject({ product: "ok", price: "ok" });
  });

  it("rozjechany cykl rozliczeniowy NIE jest wykrywany", async () => {
    // DEFEKT UTRWALONY: komentarz modułu (linia 7) obiecuje korektę cyklu, ale
    // `amountDrifted` porównuje wyłącznie kwotę i walutę. Cena rozliczana
    // rocznie zostaje przy `plus_monthly` na zawsze - klient płaci w innym
    // rytmie, niż pokazuje cennik.
    h.plans = [plan()];
    h.remotePrices["plus_monthly"] = remotePlusMonthly({
      recurring: { interval: "year", interval_count: 1 },
    });

    const report = await syncBillingCatalog("sandbox");

    expect(priceCreateFor("plus_monthly")).toBeUndefined();
    expect(h.priceUpdate).not.toHaveBeenCalled();
    expect(itemFor(report, "plus_monthly")?.price).toBe("ok");
  });
});

describe("syncBillingCatalog - brak planu w źródle prawdy", () => {
  it("pozycja bez planu w bazie jest pomijana, nie zgadujemy kwoty", async () => {
    h.plans = [];

    const report = await syncBillingCatalog("sandbox");

    expect(report.items).toHaveLength(BILLING_CATALOG.length);
    expect(report.items.every((i) => i.product === "skipped" && i.price === "skipped")).toBe(true);
    expect(report.items.every((i) => i.reason === "no_local_plan")).toBe(true);
    expect(h.productCreate).not.toHaveBeenCalled();
    expect(h.priceCreate).not.toHaveBeenCalled();
    expect(report.created).toBe(0);
  });

  it("wyłączony plan jest pomijany i trafia na listę do archiwizacji", async () => {
    h.plans = [plan({ active: false })];

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "plus_monthly")).toMatchObject({
      price: "skipped",
      reason: "no_local_plan",
    });
    expect(h.priceCreate).not.toHaveBeenCalled();
    expect([...(reapInput()?.inactivePriceIds ?? [])]).toContain("plus_monthly");
    expect([...(reapInput()?.expectedPriceIds ?? [])]).not.toContain("plus_monthly");
  });
});

describe("syncBillingCatalog - sprzątanie po czystym przebiegu", () => {
  it("przekazuje do archiwizacji tylko pozycje obecne w źródle prawdy", async () => {
    h.reap.mockResolvedValue([
      { kind: "price", externalId: "stary_plan", providerId: "price_x", reason: "not_in_catalog" },
    ]);

    const report = await syncBillingCatalog("sandbox");
    const input = reapInput();

    expect(input?.env).toBe("sandbox");
    expect([...(input?.expectedPriceIds ?? [])]).toEqual(
      expect.arrayContaining(["plus_monthly", "plus_annual"]),
    );
    expect([...(input?.expectedProductIds ?? [])]).toContain("plan_plus");
    expect([...(input?.inactivePriceIds ?? [])]).toContain("pro_monthly");
    expect(report.archived).toHaveLength(1);
  });

  it("awaria sprzątania nie unieważnia udanej synchronizacji", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.reap.mockRejectedValue(new Error("reap boom"));

    const report = await syncBillingCatalog("sandbox");

    expect(report.archived).toEqual([]);
    expect(report.failed).toBe(0);
    expect(itemFor(report, "plus_monthly")?.price).toBe("created");
    expect(logged).toHaveBeenCalled();
  });
});

describe("syncBillingCatalog - błędy operatora i konfiguracji", () => {
  it("błąd na jednej pozycji nie zatrzymuje pozostałych", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.plans = [plan(), plan({ tier_key: "pro", name_pl: "Pro" })];
    h.productSearchErrors["plan_plus"] = new Error("rate limited");

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "plus_monthly")).toMatchObject({
      product: "failed",
      price: "failed",
      reason: "rate limited",
    });
    // Reszta katalogu idzie dalej mimo awarii jednej pozycji.
    expect(itemFor(report, "pro_monthly")?.price).toBe("created");
    expect(report.failed).toBe(2); // plus_monthly + plus_annual (ten sam produkt)
    expect(logged).toHaveBeenCalled();
  });

  it("po nieudanym przebiegu nie archiwizujemy niczego", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.productSearchErrors["plan_plus"] = new Error("rate limited");

    const report = await syncBillingCatalog("sandbox");

    // Awaria API nie może zostać odczytana jako "plan zniknął ze źródła".
    expect(h.reap).not.toHaveBeenCalled();
    expect(report.archived).toEqual([]);
  });

  it("brak konfiguracji operatora przerywa synchronizację (błąd nie jest połykany)", async () => {
    h.clientError = new Error("STRIPE_LIVE_API_KEY is not configured");

    await expect(syncBillingCatalog("live")).rejects.toThrow(
      "STRIPE_LIVE_API_KEY is not configured",
    );
    // Bez klienta nie ma nawet zapytania do bazy - nie ma czego synchronizować.
    expect(h.selects).toHaveLength(0);
  });
});

describe("trialDaysForPrice", () => {
  it("czyta okres próbny z metadanych ceny u operatora", async () => {
    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "14" } });

    expect(await trialDaysForPrice("sandbox", "plus_monthly")).toBe(14);
    // `data.tiers` rozwijamy zawsze: bez tego cena schodkowa (próg wolumenowy
    // Zespołu) wyglądałaby jak cena bez progów i sync odtwarzałby ją w kółko.
    expect(h.priceList).toHaveBeenCalledWith({
      lookup_keys: ["plus_monthly"],
      active: true,
      limit: 1,
      expand: ["data.tiers"],
    });
  });

  it("brak ceny, brak metadanych lub wartość niedodatnia = brak triala", async () => {
    expect(await trialDaysForPrice("sandbox", "nieznana_cena")).toBeNull();

    h.remotePrices["plus_monthly"] = remotePlusMonthly();
    expect(await trialDaysForPrice("sandbox", "plus_monthly")).toBeNull();

    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "0" } });
    expect(await trialDaysForPrice("sandbox", "plus_monthly")).toBeNull();

    h.remotePrices["plus_monthly"] = remotePlusMonthly({ metadata: { trial_days: "bzdura" } });
    expect(await trialDaysForPrice("sandbox", "plus_monthly")).toBeNull();
  });
});

describe("healCatalogOnce", () => {
  it("równoległe samonaprawy dzielą jeden przebieg, kolejna rusza od nowa", async () => {
    await Promise.all([healCatalogOnce("sandbox"), healCatalogOnce("sandbox")]);
    expect(h.selects).toHaveLength(1);

    await healCatalogOnce("sandbox");
    expect(h.selects).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Katalog v6.1: cena jednorazowa (Decision Lab) i cena schodkowa (Zespół).
//
// Obie klasy weszły do katalogu przy wdrożeniu korekt audytu i obie łamią
// milczące założenie poprzedniej wersji synchronizacji: „każda cena jest
// cykliczna i płaska". Pierwsza zakładałaby u operatora subskrypcję miesięczną
// na miejsce w Decision Labie, druga - jedną stawkę bez rabatu wolumenowego.
// ---------------------------------------------------------------------------
describe("cena jednorazowa (interval one_time)", () => {
  const decisionLabPlan = (): PlanRow =>
    plan({
      tier_key: "decision_lab",
      interval: "one_time",
      price_cents: 1_600_000,
      name_pl: "Decision Lab - miejsce w cyklu",
      name_en: "Decision Lab - seat in the cycle",
    });

  it("zakłada cenę BEZ cyklu rozliczeniowego", async () => {
    h.plans = [decisionLabPlan()];

    await syncBillingCatalog("sandbox");

    const created = priceCreateFor("decision_lab_seat");
    expect(created).toBeDefined();
    expect(created?.["unit_amount"]).toBe(1_600_000);
    // Kluczowa asercja całego bloku: brak `recurring`. Z nim miejsce w cyklu
    // odnawiałoby się co miesiąc po 16 000 zł.
    expect(created).not.toHaveProperty("recurring");
  });

  it("korekta kwoty też nie dokłada cyklu", async () => {
    h.plans = [decisionLabPlan()];
    h.remotePrices["decision_lab_seat"] = {
      id: "price_dl",
      lookup_key: "decision_lab_seat",
      unit_amount: 1_200_000,
      currency: "pln",
      metadata: {},
    };

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "decision_lab_seat")?.price).toBe("updated");
    const created = priceCreateFor("decision_lab_seat");
    expect(created?.["unit_amount"]).toBe(1_600_000);
    expect(created?.["transfer_lookup_key"]).toBe(true);
    expect(created).not.toHaveProperty("recurring");
    expect(h.priceUpdate).toHaveBeenCalledWith("price_dl", { active: false });
  });
});

describe("cena schodkowa (próg wolumenowy Zespołu)", () => {
  const teamPlan = (over: Partial<PlanRow> = {}): PlanRow =>
    plan({
      tier_key: "team",
      interval: "month",
      price_cents: 8900,
      name_pl: "Zespół",
      name_en: "Team",
      volume_threshold_seats: 11,
      volume_price_cents: 7900,
      ...over,
    });

  it("zakłada cenę w trybie volume z dwoma progami", async () => {
    h.plans = [teamPlan()];

    await syncBillingCatalog("sandbox");

    const created = priceCreateFor("team_monthly_seat");
    expect(created?.["billing_scheme"]).toBe("tiered");
    expect(created?.["tiers_mode"]).toBe("volume");
    // `up_to: 10` to OSTATNIE miejsce w stawce podstawowej - próg 11 oznacza
    // „od jedenastego wszystkie po 79 zł", nie „jedenaste i kolejne".
    expect(created?.["tiers"]).toEqual([
      { up_to: 10, unit_amount: 8900 },
      { up_to: "inf", unit_amount: 7900 },
    ]);
    expect(created).not.toHaveProperty("unit_amount");
  });

  it("plan bez progu zostaje ceną płaską", async () => {
    h.plans = [teamPlan({ volume_threshold_seats: null, volume_price_cents: null })];

    await syncBillingCatalog("sandbox");

    const created = priceCreateFor("team_monthly_seat");
    expect(created?.["unit_amount"]).toBe(8900);
    expect(created).not.toHaveProperty("billing_scheme");
  });

  it("rozjazd progów u operatora jest korygowany nową ceną", async () => {
    h.plans = [teamPlan()];
    h.remotePrices["team_monthly_seat"] = {
      id: "price_team",
      lookup_key: "team_monthly_seat",
      currency: "pln",
      billing_scheme: "tiered",
      tiers_mode: "volume",
      tiers: [
        { up_to: 10, unit_amount: 8900 },
        { up_to: null, unit_amount: 8900 },
      ],
      recurring: { interval: "month", interval_count: 1 },
      metadata: {},
    };

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "team_monthly_seat")?.price).toBe("updated");
    expect(priceCreateFor("team_monthly_seat")?.["tiers"]).toEqual([
      { up_to: 10, unit_amount: 8900 },
      { up_to: "inf", unit_amount: 7900 },
    ]);
  });

  it("zgodne progi nie powodują żadnej zmiany", async () => {
    h.plans = [teamPlan()];
    h.remotePrices["team_monthly_seat"] = {
      id: "price_team",
      lookup_key: "team_monthly_seat",
      currency: "pln",
      billing_scheme: "tiered",
      tiers_mode: "volume",
      tiers: [
        { up_to: 10, unit_amount: 8900 },
        { up_to: null, unit_amount: 7900 },
      ],
      recurring: { interval: "month", interval_count: 1 },
      metadata: {},
    };

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "team_monthly_seat")?.price).toBe("ok");
    expect(priceCreateFor("team_monthly_seat")).toBeUndefined();
  });

  it("przejście z ceny płaskiej na schodkową jest wykrywane jako dryf", async () => {
    h.plans = [teamPlan()];
    h.remotePrices["team_monthly_seat"] = {
      id: "price_team_flat",
      lookup_key: "team_monthly_seat",
      unit_amount: 8900,
      currency: "pln",
      recurring: { interval: "month", interval_count: 1 },
      metadata: {},
    };

    const report = await syncBillingCatalog("sandbox");

    expect(itemFor(report, "team_monthly_seat")?.price).toBe("updated");
    expect(priceCreateFor("team_monthly_seat")?.["billing_scheme"]).toBe("tiered");
  });
});
