// Trasa `/checkout/$planId` - sklejenie całego lejka zakupu planu.
//
// Test montuje PRAWDZIWĄ trasę w routerze pamięciowym, więc przechodzi przez tę
// samą drogę, co kupujący: parametr ścieżki -> zapytanie o plan -> bramka
// tożsamości -> dane do faktury -> kupon -> waluta prezentacji -> sesja u
// operatora -> osadzona ramka płatności. Zamockowana jest wyłącznie granica
// sieci (Supabase, server functions, SDK operatora) - reguły biznesowe
// (katalog cen, konwersja walut, obietnice checkoutu, izolacja tenantów) biegną
// prawdziwym kodem, bo to one decydują, ile i za co kupujący zapłaci.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AccessPlan, BillingProfile } from "@/lib/billing/types";
import type { ValidateCouponResult } from "@/lib/billing/coupons";
import { DEFAULT_CHECKOUT_SETTINGS, type CheckoutSettings } from "@/lib/billing/checkoutSettings";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  authLoading: false,
  tenantId: null as string | null,
  plan: null as unknown,
  planError: null as Error | null,
  billing: null as unknown,
  settings: null as unknown,
  coupon: null as unknown,
  planCheckout: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  preloadStripeSdk: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    tenantId: h.tenantId,
    loading: h.authLoading,
    roles: [],
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
// Granica sieci: dane planu i profilu rozliczeniowego.
vi.mock("@/lib/billing/queries", () => ({
  fetchPlanById: async () => {
    if (h.planError) throw h.planError;
    return h.plan;
  },
  fetchMyBillingProfile: async () => h.billing,
}));
vi.mock("@/hooks/useCheckoutSettings", () => ({
  useCheckoutSettings: () => ({ data: h.settings }),
}));
// Kupon: prawdziwy widget, podstawiony wyłącznie wynik RPC.
vi.mock("@/hooks/useValidateCoupon", () => ({
  useValidateCoupon: () => ({
    result: null,
    loading: false,
    validate: async () => h.coupon,
    reset: () => {},
  }),
}));
// `useCheckout` biegnie PRAWDZIWY (locale + środowisko + kształt payloadu),
// podstawiona jest dopiero server function po drugiej stronie granicy.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/stripeCheckout.functions", () => ({
  createPlanCheckoutSession: (args: unknown) => h.planCheckout(args),
  createAdhocCheckoutSession: vi.fn(),
}));
// Kurs NBP: moduł sam strzela do api.nbp.pl przy imporcie w przeglądarce, a test
// ma być deterministyczny i BEZ sieci - stały kurs 4,00 daje jawne przeliczenie
// 99,00 PLN -> 24,75 EUR.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));
vi.mock("@/lib/stripe", () => ({
  isPaymentsConfigured: () => true,
  getStripeEnvironment: () => "sandbox" as const,
  getStripeEnvironmentSafe: () => "sandbox" as const,
  preloadStripeSdk: h.preloadStripeSdk,
}));
// Ramka operatora ma własny test granicy leniwego chunku - tutaj jest sondą,
// żeby nie ściągać SDK Stripe do testu trasy.
vi.mock("@/components/checkout/EmbeddedCheckoutFrame", () => ({
  EmbeddedCheckoutFrame: ({ clientSecret }: { clientSecret: string }) => (
    <div data-testid="checkout-frame" data-secret={clientSecret} />
  ),
}));
// Formularz danych do faktury ma własny test - tu liczy się tylko to, że lejek
// pokazuje go W MIEJSCU, zamiast wyrzucać kupującego na /profile/billing.
vi.mock("@/components/billing/molecules/BillingProfileForm", () => ({
  BillingProfileForm: ({ submitLabel }: { submitLabel?: string }) => (
    <form data-testid="billing-form">
      <button type="button">{submitLabel}</button>
    </form>
  ),
}));

import i18n from "@/lib/i18n";
import { formatMoney } from "@/lib/billing/types";
import { renderRoute } from "@/test/routeHarness";
import { Route as PlanRoute } from "@/routes/checkout.$planId";

const PATH = "/checkout/$planId";
const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function plan(over: Partial<AccessPlan> = {}): AccessPlan {
  return {
    id: PLAN_ID,
    tenant_id: TENANT,
    name_pl: "Plan Pro",
    name_en: "Pro plan",
    description_pl: "Pełny dostęp do analiz.",
    description_en: "Full access to the analyses.",
    price_cents: 9900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 1,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: "pro",
    ...over,
  };
}

function billingProfile(over: Partial<BillingProfile> = {}): BillingProfile {
  return {
    address_line1: "Krucza 1",
    address_line2: null,
    city: "Warszawa",
    postal_code: "00-001",
    country_code: "PL",
    full_name: "Anna Nowak",
    company: null,
    tax_id: null,
    is_company: false,
    ...over,
  } as BillingProfile;
}

function couponResult(over: Partial<ValidateCouponResult> = {}): ValidateCouponResult {
  return {
    ok: true,
    error: null,
    coupon_id: "c-1",
    discount_cents: 1900,
    final_cents: 8000,
    label: "-19 zł",
    discount_kind: "amount",
    discount_percent: null,
    ...over,
  } as ValidateCouponResult;
}

async function mount(planId = PLAN_ID) {
  return renderRoute({ route: PlanRoute, path: PATH, initialEntry: `/checkout/${planId}` });
}

/** Kupujący z kompletem danych - domyślny stan „gotowy do zapłaty". */
function signedInBuyer(): void {
  h.session = { user: { id: "u-1" } };
  h.tenantId = TENANT;
  h.billing = billingProfile();
}

const payButton = () => screen.getByRole("button", { name: /Zapłać/ });

/** Intl wstawia twardą spację - porównujemy tekst po normalizacji białych znaków. */
const flat = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ");
const money = (cents: number, currency = "PLN", lang = "pl") =>
  flat(formatMoney(cents, currency, lang));
const showsMoney = (el: Element | null, cents: number, currency = "PLN", lang = "pl") =>
  flat(el?.textContent).includes(money(cents, currency, lang));

beforeAll(async () => {
  await i18n.changeLanguage("pl");
  // FxRateNotice odpytuje własny endpoint kursu - w teście odpowiada kanon.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "ok",
        eurPln: 4,
        effectiveDate: "2026-08-13",
        source: "nbp",
        fetchedAt: "2026-08-14T06:00:00.000Z",
        lastSuccessAt: "2026-08-14T06:00:00.000Z",
        lastError: null,
        lastAttempts: 1,
        stale: false,
      }),
    ),
  );
});

beforeEach(() => {
  h.session = null;
  h.authLoading = false;
  h.tenantId = null;
  h.plan = plan();
  h.planError = null;
  h.billing = null;
  h.settings = DEFAULT_CHECKOUT_SETTINGS satisfies CheckoutSettings;
  h.coupon = couponResult();
  h.planCheckout.mockReset().mockResolvedValue({
    ok: true,
    clientSecret: "cs_test_123",
    orderId: "ord_1",
  });
  h.toast.error.mockReset();
  h.preloadStripeSdk.mockReset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /checkout/$planId - sklejenie i bramka tożsamości", () => {
  it("nie wpuszcza wyszukiwarek na stronę płatności", async () => {
    signedInBuyer();
    const view = await mount();

    expect(view.currentPath()).toBe(`/checkout/${PLAN_ID}`);
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("gość widzi bramkę tożsamości zamiast planu i kwoty", async () => {
    await mount();

    expect(screen.getByText("Dokończ zakup")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mam konto/ })).toHaveAttribute(
      "href",
      "/login?mode=signin",
    );
    // Żadna kwota ani nazwa planu nie może wyciec przed uwierzytelnieniem -
    // zamówienie, dostęp i faktura muszą mieć trwałego właściciela.
    expect(screen.queryByText("Plan Pro")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapłać/ })).not.toBeInTheDocument();
  });

  it("czeka z decyzją, dopóki sesja się ładuje", async () => {
    h.authLoading = true;
    await mount();

    expect(screen.getByLabelText("loading")).toBeInTheDocument();
    expect(screen.queryByText("Dokończ zakup")).not.toBeInTheDocument();
  });

  it("przekazuje `planId` ze ścieżki do zapytania o plan", async () => {
    signedInBuyer();
    const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    h.plan = plan({ id: other, name_pl: "Plan Zespół", tier_key: "team" });
    const view = await mount(other);

    expect(view.currentPath()).toBe(`/checkout/${other}`);
    expect(await screen.findByText("Plan Zespół")).toBeInTheDocument();
  });
});

describe("trasa /checkout/$planId - podsumowanie zamówienia", () => {
  it("składa podsumowanie planu z ceną, opisem i obietnicami checkoutu", async () => {
    signedInBuyer();
    await mount();

    expect(await screen.findByText("Plan Pro")).toBeInTheDocument();
    expect(screen.getByText("Pełny dostęp do analiz.")).toBeInTheDocument();
    expect(showsMoney(payButton(), 9900)).toBe(true);
    // Obietnice liczy ta sama czysta funkcja, którą serwer rozwija w sesji.
    expect(screen.getByText(/Kod rabatowy wpiszesz/)).toBeInTheDocument();
    expect(screen.getByText(/NIP\/VAT ID do faktury/)).toBeInTheDocument();
    expect(screen.getByText(/Fakturę pobierzesz/)).toBeInTheDocument();
  });

  it("pokazuje okres próbny tylko dla planu cyklicznego", async () => {
    signedInBuyer();
    h.plan = plan({ trial_days: 14 });
    await mount();

    expect(await screen.findByText(/Pierwsze 14 dni za darmo/)).toBeInTheDocument();
    cleanup();

    h.plan = plan({ trial_days: 14, interval: "one_time" });
    await mount();
    expect(screen.queryByText(/Pierwsze 14 dni za darmo/)).not.toBeInTheDocument();
  });

  it("nieznany plan kończy się komunikatem, a nie pustą kartą", async () => {
    signedInBuyer();
    h.plan = null;
    await mount();

    expect(await screen.findByText("Nie znaleziono planu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapłać/ })).not.toBeInTheDocument();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Nie znaleziono planu."));
  });

  it("awaria odczytu planu nie wywala trasy", async () => {
    // Padnięte zapytanie o plan to nie `isSuccess`, więc toast nie leci - ale
    // kupujący musi zobaczyć komunikat, a nie pustą kartę bez wyjaśnienia.
    signedInBuyer();
    h.planError = new Error("network down");
    await mount();

    expect(await screen.findByText("Nie znaleziono planu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapłać/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("network down");
  });

  it("brak danych do faktury blokuje płatność i podstawia formularz w lejku", async () => {
    h.session = { user: { id: "u-1" } };
    h.tenantId = TENANT;
    h.billing = null;
    await mount();

    expect(await screen.findByTestId("billing-form")).toBeInTheDocument();
    expect(screen.getByText("Uzupełnij dane rozliczeniowe.")).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
  });

  it("komplet danych do faktury odblokowuje płatność i pokazuje je w podsumowaniu", async () => {
    signedInBuyer();
    h.billing = billingProfile({
      is_company: true,
      company: "ACME sp. z o.o.",
      tax_id: "5252445767",
    });
    await mount();

    expect(await screen.findByText("ACME sp. z o.o.")).toBeInTheDocument();
    expect(screen.getByText(/NIP: 5252445767/)).toBeInTheDocument();
    expect(payButton()).toBeEnabled();
  });
});

describe("trasa /checkout/$planId - izolacja obszarów roboczych", () => {
  // Autorytetem jest polityka `plans public read`: odczyt idzie przez
  // `public_tenant_id()`, czyli tenanta PRZEGLĄDANEJ domeny. Trasa nie ma więc
  // własnego porównania tenantów - te dwa testy pilnują OBU stron tej reguły.

  it("plan spoza przeglądanego obszaru roboczego w ogóle nie wraca z odczytu", async () => {
    // Tak wygląda ten przypadek w rzeczywistości: RLS nie wypuszcza wiersza,
    // `fetchPlanById` zwraca null. Trasa ma wtedy pokazać komunikat i NIE dać
    // się opłacić - żadna nazwa ani cena z cudzego obszaru nie trafia na ekran.
    signedInBuyer();
    h.plan = null;
    await mount();

    expect(await screen.findByText("Nie znaleziono planu.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("99,00");
    expect(screen.queryByRole("button", { name: /Zapłać/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Nie znaleziono planu."));
    expect(h.planCheckout).not.toHaveBeenCalled();
  });

  it("kupujący z innym tenantem domowym kupuje plan przeglądanej domeny", async () => {
    // REGRESJA (recenzja PR #229): na zweryfikowanym hoście tenanta B czytelnik
    // z tenantem domowym A legalnie kupuje plan B - `public_tenant_id()` przy
    // poświadczeniu krawędzi rozstrzyga tenanta HOSTA, nie profilu. Klient, który
    // porównałby `plan.tenant_id` z `useAuth().tenantId`, zamieniłby ten zakup
    // w „nie znaleziono planu". Ta asercja trzyma tę drogę otwartą.
    h.session = { user: { id: "u-1" } };
    h.tenantId = OTHER_TENANT;
    h.billing = billingProfile();
    h.plan = plan({ tenant_id: TENANT });
    await mount();

    expect(await screen.findByText("Plan Pro")).toBeInTheDocument();
    expect(payButton()).toBeEnabled();

    fireEvent.click(payButton());
    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
  });
});

describe("trasa /checkout/$planId - sesja płatności", () => {
  it("tworzy sesję z ceną z katalogu, adresem powrotu i językiem interfejsu", async () => {
    signedInBuyer();
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));

    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
    expect(h.planCheckout).toHaveBeenCalledWith({
      data: {
        planId: PLAN_ID,
        // `pro` + `month` -> wpis katalogu, a nie kwota z formularza klienta.
        priceId: "pro_monthly",
        couponCode: undefined,
        returnUrl: `${window.location.origin}/checkout/success`,
        environment: "sandbox",
        locale: "pl",
      },
    });
  });

  it("osadza ramkę operatora z sekretem sesji i banerem trybu testowego", async () => {
    signedInBuyer();
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));

    const frame = await screen.findByTestId("checkout-frame");
    expect(frame).toHaveAttribute("data-secret", "cs_test_123");
    expect(screen.getByRole("status")).toHaveTextContent(/tryb testowy/i);
  });

  it("rozgrzewa chunk ramki na intencję zakupu, jeszcze przed kliknięciem", async () => {
    signedInBuyer();
    await mount();

    fireEvent.pointerEnter(await screen.findByRole("button", { name: /Zapłać/ }));

    expect(h.preloadStripeSdk).toHaveBeenCalled();
    expect(screen.queryByTestId("checkout-frame")).not.toBeInTheDocument();
  });

  it("plan spoza katalogu cen nie tworzy sesji", async () => {
    signedInBuyer();
    h.plan = plan({ tier_key: null });
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "Bramka płatności nie jest jeszcze skonfigurowana. Skontaktuj się z administratorem.",
      ),
    );
    expect(h.planCheckout).not.toHaveBeenCalled();
    expect(screen.queryByTestId("checkout-frame")).not.toBeInTheDocument();
  });

  it("wyczerpany limit kuponu tłumaczy się komunikatem o kuponie", async () => {
    signedInBuyer();
    h.planCheckout.mockResolvedValue({ ok: false, error: "limit_reached" });
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("Nie udało się zastosować kuponu."),
    );
    expect(screen.queryByTestId("checkout-frame")).not.toBeInTheDocument();
  });

  it("awaria po stronie operatora nie pokazuje surowego błędu i odblokowuje przycisk", async () => {
    signedInBuyer();
    h.planCheckout.mockRejectedValue(new Error("stripe: secret key rotated"));
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: /Zapłać/ }));

    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(h.toast.error.mock.calls.flat().join(" ")).not.toContain("secret key");
    expect(document.body.textContent).not.toContain("stripe:");
    await waitFor(() => expect(payButton()).toBeEnabled());
  });
});

describe("trasa /checkout/$planId - kupon B2B", () => {
  it("przenosi rabat do podsumowania i do sesji operatora", async () => {
    signedInBuyer();
    await mount();
    await screen.findByText("Plan Pro");

    const coupon = screen.getByPlaceholderText("np. NES-B2B-10");
    fireEvent.change(coupon, { target: { value: "nes-b2b-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));

    // Kwota do zapłaty schodzi o rabat; wartość sprzed rabatu zostaje przekreślona.
    await waitFor(() => expect(showsMoney(payButton(), 8000)).toBe(true));
    expect(
      screen.getByText((content) => flat(content) === money(9900), { selector: ".line-through" }),
    ).toBeInTheDocument();

    fireEvent.click(payButton());
    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
    // Kod jedzie w postaci znormalizowanej - kwotę i tak przelicza serwer.
    expect(h.planCheckout.mock.calls[0][0].data.couponCode).toBe("NES-B2B-10");
  });

  it("odrzucony kupon nie zmienia kwoty do zapłaty", async () => {
    signedInBuyer();
    h.coupon = couponResult({ ok: false, error: "expired", discount_cents: 0, final_cents: 9900 });
    await mount();
    await screen.findByText("Plan Pro");

    fireEvent.change(screen.getByPlaceholderText("np. NES-B2B-10"), {
      target: { value: "STARY-KOD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));

    expect(await screen.findByText("Ten kupon wygasł.")).toBeInTheDocument();
    expect(showsMoney(payButton(), 9900)).toBe(true);
  });
});

describe("trasa /checkout/$planId - i18n i waluta prezentacji", () => {
  it("po angielsku rozlicza w EUR po kursie NBP i mówi po angielsku do operatora", async () => {
    await i18n.changeLanguage("en");
    signedInBuyer();
    await mount();

    expect(await screen.findByText("Pro plan")).toBeInTheDocument();
    const pay = screen.getByRole("button", { name: /Pay/ });
    // 99,00 PLN po kursie NBP (tu: 4,00) -> 24,75 EUR. Ta sama funkcja liczy
    // kwoty na /pricing i /support, więc kupujący nie widzi dwóch różnych cen.
    expect(showsMoney(pay, 2475, "EUR", "en")).toBe(true);
    expect(pay).not.toHaveTextContent("zł");
    // Pasek kursu pojawia się WYŁĄCZNIE w wariancie EUR.
    expect(await screen.findByText(/1 EUR = /)).toBeInTheDocument();

    fireEvent.click(pay);
    await waitFor(() => expect(h.planCheckout).toHaveBeenCalledTimes(1));
    expect(h.planCheckout.mock.calls[0][0].data.locale).toBe("en");
  });

  it("po polsku nie pokazuje paska kursu walutowego", async () => {
    signedInBuyer();
    await mount();

    expect(await screen.findByText("Plan Pro")).toBeInTheDocument();
    expect(screen.queryByText(/1 EUR = /)).not.toBeInTheDocument();
  });
});

describe("trasa /checkout/$planId - ustawienia checkoutu tenanta", () => {
  it("nie obiecuje kodów promocyjnych, gdy tenant je wyłączył", async () => {
    signedInBuyer();
    h.settings = { ...DEFAULT_CHECKOUT_SETTINGS, allow_promotion_codes: false };
    await mount();

    expect(await screen.findByText("Plan Pro")).toBeInTheDocument();
    expect(screen.queryByText(/Kod rabatowy wpiszesz/)).not.toBeInTheDocument();
  });

  it("obiecuje automatyczny VAT dopiero na płaszczyźnie sprzedawcy", async () => {
    signedInBuyer();
    h.settings = { ...DEFAULT_CHECKOUT_SETTINGS, automatic_tax: true };
    await mount();

    const summary = await screen.findByText("Podsumowanie");
    const card = summary.closest("div[class*='sticky']") ?? document.body;
    expect(within(card as HTMLElement).getByText(/VAT zostanie naliczony/)).toBeInTheDocument();
  });
});
