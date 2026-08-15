// Paywall: JEDYNY komponent, którym monetyzacja mówi do czytelnika. Do
// 2026-08-15 nie miał ani jednego testu, mimo że skleja cztery kontrakty
// naraz: tryby reguły dostępu (members / paid / password), warianty meteringu
// ("register" dla anonima bez puli, "exhausted" po wyczerpaniu limitu),
// lejek zakupowy (plany + zakup jednorazowy przez server fn) oraz bramkę
// hasła z tłumieniem brute-force po stronie UI. Egzekwowanie dostępu jest
// serwerowe (get_entity_content) - tu pilnujemy, żeby czytelnik ZAWSZE
// dostał właściwy komunikat i właściwe wyjście z płatnej ściany.
//
// Konwencje jak w suitach sieci kontaktów: echo kluczy i18n (asercje mierzą
// KLUCZ, nie copy - parytet PL/EN pilnują bramki słownika), RouterLinkStub
// zamiast routera, atomy fixtures z src/test/paywall.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PAYWALL_IDS,
  accessPlan,
  accessRule,
  meterSettings,
  meterState,
} from "@/test/paywall/fixtures";
import { translateKey as k } from "@/test/network/fixtures";
import { formatMoney } from "@/lib/billing/types";
import {
  formatMeterResetDate,
  type MeterState,
  type MeteringSettings,
} from "@/lib/access/metering";
import type { ContentAccessRule } from "@/hooks/useContentAccess";

type CheckoutResult =
  | { ok: true; mode: "stripe"; clientSecret: string }
  | { ok: true; mode: "mock"; orderId: string }
  | { ok: false };

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  plans: [] as unknown[],
  hint: null as { hint_pl: string | null; hint_en: string | null } | null,
  planQueries: [] as Array<{
    table: string;
    ids: readonly string[];
    active: boolean;
    order: string;
  }>,
  rpc: vi.fn(),
  navigate: vi.fn(),
  checkout: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.checkout,
}));
// Server fn jest tylko tokenem dla useServerFn - realny moduł ciągnie warstwę
// serwerową, której test komponentu nie potrzebuje.
vi.mock("@/lib/billing/checkout.functions", () => ({ createCheckoutOrder: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: (): "sandbox" => "sandbox" }));
vi.mock("sonner", () => ({ toast: { error: h.toastError } }));
// Modal osadzonej kasy ma własną suitę leniwej granicy - tu wystarczy dowód,
// że paywall podał sekret sesji dalej i że zamknięcie modala go zeruje.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({
    clientSecret,
    onOpenChange,
  }: {
    clientSecret: string | null;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="checkout-dialog">
      <span data-testid="checkout-secret">{clientSecret}</span>
      <button type="button" data-testid="checkout-close" onClick={() => onOpenChange(false)} />
    </div>
  ),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: readonly string[]) => ({
          eq: (_c: string, active: boolean) => ({
            order: (order: string) => {
              h.planQueries.push({ table, ids, active, order });
              return Promise.resolve({ data: h.plans });
            },
          }),
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => h.rpc(name, args),
  },
}));

import { Paywall } from "@/components/Paywall";

interface RenderProps {
  rule?: ContentAccessRule;
  lang?: "pl" | "en";
  fallbackText?: string | null;
  onPasswordVerify?: (password: string) => Promise<boolean>;
  passwordVerifying?: boolean;
  meterSettings?: MeteringSettings | null;
  meterApplies?: boolean;
  meterState?: MeterState | null;
}

function renderPaywall(props: RenderProps = {}) {
  const { rule = accessRule(), lang = "pl", ...rest } = props;
  return render(<Paywall rule={rule} lang={lang} {...rest} />);
}

/** Kolejność CTA mierzona treścią linków - primary stoi pierwszy w DOM. */
function linkTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a")).map((a) => a.textContent?.trim() ?? "");
}

beforeEach(() => {
  h.session = null;
  h.plans = [];
  h.hint = null;
  h.planQueries = [];
  h.rpc.mockReset().mockImplementation(() => Promise.resolve({ data: h.hint ? [h.hint] : [] }));
  h.navigate.mockClear();
  h.checkout.mockReset();
  h.toastError.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Paywall - tryby reguły dostępu (anonim)", () => {
  it("members: komunikat logowania, zaloguj jako primary przed rejestracją", () => {
    const { container } = renderPaywall({ rule: accessRule({ mode: "members" }) });
    expect(screen.getByRole("heading", { name: k("paywall.membersOnly") })).toBeInTheDocument();
    expect(screen.getByText(k("paywall.membersDesc"))).toBeInTheDocument();
    const links = linkTexts(container);
    expect(links[0]).toContain(k("paywall.signin"));
    expect(links[1]).toContain(k("paywall.signup"));
    // Obie ścieżki prowadzą do logowania - rejestrację wyróżnia tryb w search.
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a).toHaveAttribute("href", "/login");
    }
  });

  it("paid: komunikat premium, bez siatki planów i bez zakupu przed zalogowaniem", () => {
    renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    expect(screen.getByRole("heading", { name: k("paywall.paidOnly") })).toBeInTheDocument();
    expect(screen.getByText(k("paywall.paidDesc"))).toBeInTheDocument();
    // Zakup wymaga konta (checkout wiąże zamówienie z auth.uid()), więc anonim
    // dostaje wyłącznie wejście przez logowanie.
    expect(screen.queryByText(k("paywall.buy"), { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText(k("paywall.signin"))).toBeInTheDocument();
  });

  it("members z sesją: sama informacja, zero CTA (body odblokuje się z serwera)", () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    const { container } = renderPaywall({ rule: accessRule({ mode: "members" }) });
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // Poza atrapą modala kasy (zawsze zamontowany, własny przycisk zamknięcia)
    // ściana nie oferuje żadnej akcji.
    const cta = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.closest("[data-testid='checkout-dialog']") === null,
    );
    expect(cta).toHaveLength(0);
  });
});

describe("Paywall - warianty meteringu", () => {
  it("register: anonim bez puli dostaje ścianę rejestracji z odwróconymi CTA", () => {
    const { container } = renderPaywall({
      rule: accessRule({ mode: "members" }),
      meterSettings: meterSettings({ member_monthly_limit: 3, anon_monthly_limit: 0 }),
      meterApplies: true,
      meterState: null,
    });
    expect(
      screen.getByRole("heading", { name: k("paywall.meter.registerTitle") }),
    ).toBeInTheDocument();
    // Opis obiecuje konkretną pulę konta - liczba płynie z ustawień tenanta.
    expect(screen.getByText(k("paywall.meter.registerDesc", { count: 3 }))).toBeInTheDocument();
    expect(screen.getByText(k("paywall.meter.registerNote"))).toBeInTheDocument();
    // Odwrócone akcenty: rejestracja (wejście do darmowej puli) przed logowaniem.
    const links = linkTexts(container);
    expect(links[0]).toContain(k("paywall.signup"));
    expect(links[1]).toContain(k("paywall.signin"));
  });

  it("exhausted: licznik zużycia, data odnowienia i komunikat wyczerpania", () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    renderPaywall({
      rule: accessRule({ mode: "paid" }),
      meterSettings: meterSettings(),
      meterApplies: true,
      meterState: meterState({ granted: false, used: 3, monthlyLimit: 3, remaining: 0 }),
    });
    expect(
      screen.getByRole("heading", { name: k("paywall.meter.exhaustedTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(k("paywall.meter.exhaustedDesc", { used: 3, limit: 3 })),
    ).toBeInTheDocument();
    // Ten sam atom QuotaMeter co baner treści - czytelnik widzi ILE przeczytał...
    const meter = screen.getByRole("meter", { name: k("paywall.meter.progressLabel") });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemax", "3");
    expect(meter).toHaveAttribute("data-tone", "exhausted");
    // ...i KIEDY limit wróci (data z tej samej reguły co warstwa treści).
    expect(
      screen.getByText(k("paywall.meter.resetsOn", { date: formatMeterResetDate("pl") })),
    ).toBeInTheDocument();
  });

  it("exhausted z dosuniętym zużyciem: obniżony limit nie wyprowadza licznika poza skalę", () => {
    h.session = { user: { id: PAYWALL_IDS.user } };
    renderPaywall({
      rule: accessRule({ mode: "paid" }),
      meterSettings: meterSettings(),
      meterApplies: true,
      // Admin obniżył limit w trakcie miesiąca: used > monthlyLimit.
      meterState: meterState({ granted: false, used: 5, monthlyLimit: 3, remaining: 0 }),
    });
    const meter = screen.getByRole("meter", { name: k("paywall.meter.progressLabel") });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      k("paywall.meter.progressValue", { used: 3, limit: 3 }),
    );
  });

  it("bez zastosowania meteringu ściana nie zmienia komunikatu", () => {
    renderPaywall({
      rule: accessRule({ mode: "members" }),
      meterSettings: meterSettings(),
      meterApplies: false,
      meterState: null,
    });
    expect(screen.getByRole("heading", { name: k("paywall.membersOnly") })).toBeInTheDocument();
    expect(screen.queryByTestId("paywall-meter")).not.toBeInTheDocument();
  });
});

describe("Paywall - teaser", () => {
  it("ręczny teaser idzie w języku czytelnika, z wielokropkiem kontynuacji", () => {
    const bilingual = accessRule({
      mode: "paid",
      teaser_pl: "Zajawka polska",
      teaser_en: "English teaser",
    });
    const pl = renderPaywall({ rule: bilingual });
    expect(screen.getByText(/Zajawka polska/).textContent).toBe("Zajawka polska…");
    pl.unmount();
    renderPaywall({ rule: bilingual, lang: "en" });
    expect(screen.getByText(/English teaser/)).toBeInTheDocument();
    expect(screen.queryByText(/Zajawka polska/)).not.toBeInTheDocument();
  });

  it("auto-teaser: zdejmuje HTML i tnie na granicy zdania, nie w pół słowa", () => {
    // 120 znaków celu przypada za drugim zdaniem - cięcie wraca do ostatniej
    // pełnej kropki, więc czytelnik nigdy nie widzi urwanego wyrazu.
    const sentence = "To zdanie ma dokladnie czterdziesci osiem znakow.";
    const fallbackText = `<p>${sentence} ${sentence} ${sentence} ${sentence} ${sentence}</p>`;
    renderPaywall({ rule: accessRule({ mode: "paid" }), fallbackText });
    const teaser = screen.getByText(new RegExp(sentence.slice(0, 20)));
    expect(teaser.textContent).toBe(`${sentence} ${sentence}…`);
    expect(teaser.textContent).not.toContain("<p>");
  });

  it("bez teasera i bez fallbacku nie renderuje pustej zajawki", () => {
    const { container } = renderPaywall({ rule: accessRule({ mode: "paid" }) });
    expect(container.querySelector(".prose")).toBeNull();
  });
});

describe("Paywall - hasło", () => {
  const passwordRule = () =>
    accessRule({ mode: "password", entity_type: "post", entity_id: PAYWALL_IDS.entity });

  it("pobiera podpowiedź przez RPC (nigdy hash) i pokazuje ją w języku czytelnika", async () => {
    h.hint = { hint_pl: "Nazwa konferencji", hint_en: "Conference name" };
    renderPaywall({ rule: passwordRule(), onPasswordVerify: () => Promise.resolve(false) });
    expect(h.rpc).toHaveBeenCalledWith("get_password_hint", {
      _entity_type: "post",
      _entity_id: PAYWALL_IDS.entity,
    });
    expect(await screen.findByText("Nazwa konferencji")).toBeInTheDocument();
    expect(screen.getByText(k("paywall.passwordHintLabel"))).toBeInTheDocument();

    renderPaywall({
      rule: passwordRule(),
      lang: "en",
      onPasswordVerify: () => Promise.resolve(false),
    });
    expect(await screen.findByText("Conference name")).toBeInTheDocument();
  });

  it("puste hasło nie wychodzi do weryfikacji (przycisk zablokowany)", () => {
    const verify = vi.fn(() => Promise.resolve(true));
    renderPaywall({ rule: passwordRule(), onPasswordVerify: verify });
    const submit = screen.getByRole("button", { name: k("paywall.passwordSubmit") });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(verify).not.toHaveBeenCalled();
  });

  it("błędne hasło: komunikat, licznik pozostałych prób i wyczyszczone pole", async () => {
    const verify = vi.fn(() => Promise.resolve(false));
    renderPaywall({ rule: passwordRule(), onPasswordVerify: verify });
    const input = screen.getByLabelText(k("paywall.passwordPlaceholder"));
    fireEvent.change(input, { target: { value: "zle-haslo" } });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.passwordSubmit") }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(verify).toHaveBeenCalledWith("zle-haslo");
    expect(screen.getByText(k("paywall.passwordWrong"))).toBeInTheDocument();
    expect(screen.getByText(k("paywall.passwordAttemptsLeft", { count: 4 }))).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("poprawne hasło zeruje błąd i licznik prób", async () => {
    let ok = false;
    const verify = vi.fn(() => Promise.resolve(ok));
    renderPaywall({ rule: passwordRule(), onPasswordVerify: verify });
    const input = screen.getByLabelText(k("paywall.passwordPlaceholder"));

    fireEvent.change(input, { target: { value: "prawie" } });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.passwordSubmit") }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    ok = true;
    fireEvent.change(input, { target: { value: "sezamie-otworz-sie" } });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.passwordSubmit") }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("po pięciu próbach blokuje formularz na 30 s i sam go odblokowuje", async () => {
    vi.useFakeTimers();
    const verify = vi.fn(() => Promise.resolve(false));
    renderPaywall({ rule: passwordRule(), onPasswordVerify: verify });
    const input = screen.getByLabelText(k("paywall.passwordPlaceholder"));
    const submit = () =>
      act(async () => {
        fireEvent.change(input, { target: { value: "proba" } });
        fireEvent.click(screen.getByRole("button", { name: k("paywall.passwordSubmit") }));
      });

    for (let attempt = 0; attempt < 5; attempt += 1) await submit();

    // Tłumienie brute-force w UI: pełna blokada wejścia + odliczanie.
    expect(screen.getByText(k("paywall.passwordLocked", { seconds: 30 }))).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(verify).toHaveBeenCalledTimes(5);
    await submit();
    expect(verify).toHaveBeenCalledTimes(5);

    // Po upływie blokady formularz wraca z wyzerowanym licznikiem prób.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it("w trakcie weryfikacji pokazuje spinner i nie przyjmuje kolejnych prób", () => {
    const verify = vi.fn(() => Promise.resolve(true));
    renderPaywall({ rule: passwordRule(), onPasswordVerify: verify, passwordVerifying: true });
    expect(screen.getByText(k("paywall.passwordChecking"))).toBeInTheDocument();
    const input = screen.getByLabelText(k("paywall.passwordPlaceholder"));
    fireEvent.change(input, { target: { value: "haslo" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("Paywall - plany i zakup (zalogowany, tryb paid)", () => {
  beforeEach(() => {
    h.session = { user: { id: PAYWALL_IDS.user } };
  });

  it("siatka planów: nazwy i ceny w języku czytelnika, interwały, badge triala", async () => {
    h.plans = [
      accessPlan(),
      accessPlan({
        id: PAYWALL_IDS.planAlt,
        name_pl: "Roczny",
        name_en: "Yearly",
        price_cents: 39900,
        interval: "year",
        trial_days: 14,
        sort_order: 2,
      }),
    ];
    const { container } = renderPaywall({
      rule: accessRule({ mode: "paid", plan_ids: [PAYWALL_IDS.plan, PAYWALL_IDS.planAlt] }),
    });

    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    expect(screen.getByText("Roczny")).toBeInTheDocument();
    // Jeden silnik pieniędzy dla całego lejka - ta sama funkcja co /pricing.
    // (Kwota sąsiaduje w węźle z etykietą interwału, stąd asercja po treści.)
    expect(container.textContent).toContain(formatMoney(4900, "PLN", "pl"));
    expect(container.textContent).toContain(formatMoney(39900, "PLN", "pl"));
    expect(screen.getByText(k("paywall.perMonth"))).toBeInTheDocument();
    expect(screen.getByText(k("paywall.perYear"))).toBeInTheDocument();
    // Trial tylko tam, gdzie plan go deklaruje.
    expect(screen.getByText(k("paywall.trialBadge", { days: 14 }))).toBeInTheDocument();

    // Zapytanie o plany jest zawężone do reguły: tylko wskazane, aktywne,
    // w kolejności redakcyjnej (tenant odcina RLS po stronie serwera).
    expect(h.planQueries).toEqual([
      {
        table: "access_plans",
        ids: [PAYWALL_IDS.plan, PAYWALL_IDS.planAlt],
        active: true,
        order: "sort_order",
      },
    ]);

    const subscribe = screen.getAllByRole("link", { name: k("paywall.subscribe") });
    expect(subscribe[0]).toHaveAttribute("href", `/checkout/${PAYWALL_IDS.plan}`);
    expect(subscribe[1]).toHaveAttribute("href", `/checkout/${PAYWALL_IDS.planAlt}`);
  });

  it("wejście w subskrypcję zapamiętuje artykuł powrotu dla strony sukcesu", async () => {
    h.plans = [accessPlan()];
    renderPaywall({ rule: accessRule({ mode: "paid", plan_ids: [PAYWALL_IDS.plan] }) });
    // Ścieżkę łapiemy PRZED kliknięciem - strona sukcesu ma wrócić do artykułu,
    // z którego czytelnik wszedł w lejek (happy-dom nawiguje po kliknięciu).
    const articlePath = window.location.pathname;
    fireEvent.click(await screen.findByRole("link", { name: k("paywall.subscribe") }));
    expect(window.sessionStorage.getItem("checkout:returnTo")).toBe(articlePath);
  });

  it("kanoniczny lejek: odsyła do pełnego cennika zamiast ślepej odnogi", () => {
    renderPaywall({ rule: accessRule({ mode: "paid" }) });
    const seeAll = screen.getByRole("link", { name: new RegExp(k("paywall.seeAllPlans")) });
    expect(seeAll).toHaveAttribute("href", "/pricing");
    const articlePath = window.location.pathname;
    fireEvent.click(seeAll);
    expect(window.sessionStorage.getItem("checkout:returnTo")).toBe(articlePath);
  });

  it("zakup jednorazowy: cena z reguły, pełny kontrakt server fn, sekret do modala", async () => {
    h.checkout.mockResolvedValue({
      ok: true,
      mode: "stripe",
      clientSecret: "cs_test_1",
    } satisfies CheckoutResult);
    const { container } = renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    expect(container.textContent).toContain(formatMoney(1900, "PLN", "pl"));

    const articlePath = window.location.pathname;
    fireEvent.click(screen.getByRole("button", { name: k("paywall.buy") }));
    await waitFor(() =>
      expect(screen.getByTestId("checkout-secret")).toHaveTextContent("cs_test_1"),
    );
    expect(h.checkout).toHaveBeenCalledWith({
      data: {
        kind: "one_time",
        entity_type: "post",
        entity_id: PAYWALL_IDS.entity,
        success_path: "/checkout/success",
        cancel_path: "/checkout/cancel",
        environment: "sandbox",
      },
    });
    expect(window.sessionStorage.getItem("checkout:returnTo")).toBe(articlePath);

    // Zamknięcie modala zeruje sekret - porzucona sesja kasy nie może wrócić
    // na ekran przy kolejnym otwarciu z nieaktualnym clientSecret.
    fireEvent.click(screen.getByTestId("checkout-close"));
    expect(screen.getByTestId("checkout-secret")).toBeEmptyDOMElement();
  });

  it("tryb mock płatności omija modal i idzie wprost na stronę sukcesu", async () => {
    h.checkout.mockResolvedValue({
      ok: true,
      mode: "mock",
      orderId: PAYWALL_IDS.order,
    } satisfies CheckoutResult);
    renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.buy") }));
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: "/checkout/success",
        search: { order: PAYWALL_IDS.order, mock: 1 },
      }),
    );
  });

  it("odmowa checkoutu: czytelny toast i przycisk wraca do stanu zakupu", async () => {
    h.checkout.mockResolvedValue({ ok: false } satisfies CheckoutResult);
    renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.buy") }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(k("paywall.checkoutFail")));
    expect(screen.getByRole("button", { name: k("paywall.buy") })).not.toBeDisabled();
  });

  it("wyjątek transportu: ten sam toast, bez zawieszonego stanu przetwarzania", async () => {
    h.checkout.mockRejectedValue(new Error("network down"));
    renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 1900, one_time_currency: "PLN" }),
    });
    fireEvent.click(screen.getByRole("button", { name: k("paywall.buy") }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(k("paywall.checkoutFail")));
    expect(screen.queryByText(k("paywall.processing"))).not.toBeInTheDocument();
  });

  it("media nie ma zakupu jednorazowego (checkout wspiera post/page)", () => {
    renderPaywall({
      rule: accessRule({
        mode: "paid",
        entity_type: "media",
        one_time_price_cents: 1900,
        one_time_currency: "PLN",
      }),
    });
    expect(screen.queryByRole("button", { name: k("paywall.buy") })).not.toBeInTheDocument();
  });

  it("cena zerowa lub brak ceny nie renderuje kupna", () => {
    renderPaywall({ rule: accessRule({ mode: "paid", one_time_price_cents: 0 }) });
    expect(screen.queryByRole("button", { name: k("paywall.buy") })).not.toBeInTheDocument();
  });

  it("brak waluty w regule degraduje się do PLN (domyślna waluta tenanta)", () => {
    const { container } = renderPaywall({
      rule: accessRule({ mode: "paid", one_time_price_cents: 2500, one_time_currency: null }),
    });
    expect(container.textContent).toContain(formatMoney(2500, "PLN", "pl"));
  });

  it("plan one_time: etykieta jednorazowości i bez badge'a triala mimo trial_days", async () => {
    // Trial ma sens dla cyklu odnowień - jednorazowy zakup z "14 dni za darmo"
    // byłby obietnicą bez mechaniki (nie ma czego przedłużyć po trialu).
    h.plans = [
      accessPlan({
        id: "plan-lifetime",
        name_pl: "Wieczysty",
        interval: "one_time",
        trial_days: 14,
      }),
    ];
    renderPaywall({ rule: accessRule({ mode: "paid", plan_ids: ["plan-lifetime"] }) });
    expect(await screen.findByText("Wieczysty")).toBeInTheDocument();
    expect(screen.getByText(k("paywall.oneTime"))).toBeInTheDocument();
    expect(screen.queryByText(k("paywall.trialBadge", { days: 14 }))).not.toBeInTheDocument();
  });
});
