// Ekran PO zapisie na wydarzenie - i JEDYNA droga stąd do kasy.
//
// CO TEN PLIK DOWODZI (każdy punkt to błąd, który kosztuje pieniądze):
//
// 1. NIEZAPŁACONE ZGŁOSZENIE MA CO ZROBIĆ Z INFORMACJĄ „nie masz wejściówki".
//    Do migracji `20260830090000` ten ekran pokazywał zdanie o braku
//    wejściówki i na tym kończył: bez przycisku, bez odnośnika, bez niczego.
//    Uczestnik wychodził z ekranu, na którym nie da się zapłacić.
// 2. ŁADUNEK DO KASY NIESIE KOMPLET IDENTYFIKATORÓW. `registration_id` jest
//    kluczem dowiązania wpłaty; bez niego `payments_apply_event_ticket_outcome`
//    dopasowuje po OSOBIE z `LIMIT 1` po dacie utworzenia i uczestnik z dwoma
//    zgłoszeniami na to samo wydarzenie dostaje bilet przypięty do najnowszego
//    wiersza - niekoniecznie tego, za który zapłacił.
// 3. KWOTY NIGDY NIE WYSYŁAMY. Ekran ją POKAZUJE, a liczy ją baza
//    (`event_ticket_checkout_quote`). Asercja czyta ładunek żądania w całości,
//    więc doklejenie kwoty od klienta zapali ten test.
// 4. GOŚĆ BEZ KONTA NIE DOSTAJE MARTWEGO PRZYCISKU. `createCheckoutOrder` stoi
//    za `requireSupabaseAuth`, a księgowanie wpłaty wymaga
//    `payment_orders.user_id` - więc gość widzi zdanie z POWODEM i odnośnik do
//    logowania, a nie kontrolkę, która go wyrzuci.
// 5. KAŻDA ODMOWA WYCENY MA WŁASNE ZDANIE. `ticket_not_available`,
//    `ticket_included_in_plan`, `sold_out`, `sales_closed` - cztery różne
//    stany świata, cztery różne komunikaty, a nie jedno „spróbuj ponownie".
// 6. ZGŁOSZENIE ZAPŁACONE NIE POKAZUJE KASY. `paymentRequired === false` nie
//    ma prawa wyrenderować przycisku „Zapłać".
//
// ATRAPA OBEJMUJE WYŁĄCZNIE GRANICE: wywołanie server fn, sesję, modal
// operatora i środowisko bramki. Mapper odmów (`ticketCheckoutRefusal` ->
// `admissionQuoteMessageKey`) JEDZIE PRAWDZIWY, bo to on wiąże kod błędu ze
// zdaniem na ekranie. i18n jest zamockowane kluczami (parytetu PL/EN pilnuje
// osobna bramka słowników), ale KWOTĘ liczy `Intl`, nie słownik - więc kwoty
// asertujemy dosłownie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { RegistrationResult } from "@/lib/events/publicRegistrationApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const checkout = vi.fn();
const navigate = vi.fn();
const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
const stripe = vi.hoisted(() => ({
  environment: (): string => "sandbox",
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => navigate,
}));

// Podmieniamy WYLACZNIE `useServerFn`: reszta pakietu (m.in.
// `createIsomorphicFn`, na ktorym stoi runtime jezyka) musi zostac prawdziwa,
// inaczej pol modulu i18n nie da sie zaimportowac.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => checkout,
}));

// Moduł server fn ciągnie middleware Supabase i `@/lib/stripe.server` - w teście
// przeglądarkowym potrzebna jest wyłącznie jego TOŻSAMOŚĆ, którą `useServerFn`
// zamienia na wywołanie.
vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: auth.session }) }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => stripe.environment() }));

// Modal operatora ciągnie SDK Stripe. Test dowodzi, że sesja DO NIEGO TRAFIA -
// nie tego, jak SDK rysuje formularz karty.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret }: { clientSecret: string | null }) =>
    clientSecret === null ? null : <div data-testid="checkout-modal">{clientSecret}</div>,
}));

const { RegistrationConfirmation } =
  await import("@/components/events/registration/RegistrationConfirmation");

const SLUG = "kongres-cee";
const REGISTRATION_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "33333333-3333-3333-3333-333333333333";

function result(over: Partial<RegistrationResult> = {}): RegistrationResult {
  return {
    registrationId: REGISTRATION_ID,
    eventId: EVENT_ID,
    personId: "44444444-4444-4444-4444-444444444444",
    status: "pending",
    decisionSource: null,
    waitlistPosition: null,
    ticketTypeId: TICKET_ID,
    qrToken: null,
    manageToken: null,
    paymentRequired: true,
    paymentStatus: "unpaid",
    amountCents: 15000,
    currency: "PLN",
    ...over,
  };
}

function renderConfirmation(over: Partial<RegistrationResult> = {}, eventId?: string | null) {
  return renderWithQueryClient(
    <RegistrationConfirmation
      result={result(over)}
      slug={SLUG}
      eventId={eventId}
      cancelled={false}
      cancelling={false}
      onCancel={() => {}}
    />,
  );
}

beforeEach(() => {
  checkout.mockReset();
  navigate.mockReset();
  auth.session = { user: { id: "u-1" } };
  stripe.environment = () => "sandbox";
});

describe("RegistrationConfirmation - stan oczekiwania na wpłatę", () => {
  it("pokazuje kwotę i ZOSTAWIA zdanie o braku wejściówki", () => {
    renderConfirmation();

    // Kwota liczona przez `Intl`, nie przez słownik - stąd dosłowna asercja.
    // Pada DOKŁADNIE RAZ: molekuła kasy jej nie powtarza.
    expect(screen.getAllByText(/150,00/)).toHaveLength(1);
    expect(screen.getByText("eventRegistration.result.paymentNoTicketYet")).toBeInTheDocument();
  });

  it("bez kwoty mówi ogólnie, a nie „0,00 zł”", () => {
    renderConfirmation({ amountCents: null, currency: null });

    expect(screen.getByText("eventRegistration.result.paymentHint")).toBeInTheDocument();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  });

  it("zgłoszenie NIE czekające na wpłatę nie pokazuje kasy", () => {
    renderConfirmation({
      paymentRequired: false,
      paymentStatus: "paid",
      status: "approved",
      qrToken: "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj",
    });

    expect(screen.queryByText("eventRegistration.payment.payNow")).not.toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderConfirmation();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("RegistrationConfirmation - klik do kasy", () => {
  it("wysyła KOMPLET identyfikatorów i NIE wysyła kwoty", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_123" });
    renderConfirmation();

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    const payload = checkout.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data).toEqual({
      kind: "one_time",
      event_id: EVENT_ID,
      ticket_type_id: TICKET_ID,
      registration_id: REGISTRATION_ID,
      success_path: `/events/${SLUG}`,
      cancel_path: `/events/${SLUG}`,
      environment: "sandbox",
    });
    // `toEqual` wyżej jest asercją o CAŁYM ładunku, ale kwota jest tu na tyle
    // ważna, że dostaje własne, czytelne zdanie w raporcie z testów.
    expect(payload.data).not.toHaveProperty("amount_cents");
  });

  it("sesja operatora trafia do modala kasy", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_777" });
    renderConfirmation();

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    expect(await screen.findByTestId("checkout-modal")).toHaveTextContent("cs_777");
  });

  it("tryb mock (dev bez dostawcy) prowadzi na stronę potwierdzenia zamówienia", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "mock", orderId: "o-1", url: "/x" });
    renderConfirmation();

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/checkout/success",
        search: { order: "o-1", mock: 1 },
      }),
    );
  });

  it("bez `event_id` przycisk jest MARTWY, a nie prowadzi do kasy bez wydarzenia", () => {
    renderConfirmation({ eventId: null }, null);

    expect(screen.getByText("eventRegistration.payment.payNow").closest("button")).toBeDisabled();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("bierze `event_id` z formularza, gdy backend go nie oddał", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_1" });
    renderConfirmation({ eventId: null }, EVENT_ID);

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    const payload = checkout.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(payload.data.event_id).toBe(EVENT_ID);
  });
});

describe("RegistrationConfirmation - odmowy wyceny", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["ticket_not_available", "eventPackages.quoteReasons.not_found"],
    ["ticket_included_in_plan", "eventPackages.quoteReasons.ticket_included_in_plan"],
    ["ticket_sold_out: no seats left", "eventPackages.quoteReasons.sold_out"],
    ["ticket_sales_closed: sales are closed", "eventPackages.quoteReasons.sales_closed"],
    ["ticket_sales_not_open", "eventPackages.quoteReasons.sales_not_open"],
    [
      "registration_not_payable:event_mismatch",
      "eventPackages.quoteReasons.registration_not_payable",
    ],
    ["cos_zupelnie_innego", "eventPackages.quoteReasons.unknown"],
  ];

  for (const [message, key] of cases) {
    it(`„${message}" ma własne zdanie na ekranie`, async () => {
      checkout.mockRejectedValue(new Error(message));
      renderConfirmation();

      fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

      expect(await screen.findByText(key)).toBeInTheDocument();
    });
  }

  it("odmowa `ok: false` z serwera też dostaje zdanie", async () => {
    checkout.mockResolvedValue({ ok: false, mode: "unconfigured", error: "billing_unconfigured" });
    renderConfirmation();

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    expect(
      await screen.findByText("eventPackages.quoteReasons.payments_unavailable"),
    ).toBeInTheDocument();
  });

  it("brak konfiguracji bramki po stronie przeglądarki nie wywraca ekranu", async () => {
    stripe.environment = () => {
      throw new Error("payments_not_configured");
    };
    renderConfirmation();

    fireEvent.click(screen.getByText("eventRegistration.payment.payNow"));

    expect(
      await screen.findByText("eventPackages.quoteReasons.payments_unavailable"),
    ).toBeInTheDocument();
    expect(checkout).not.toHaveBeenCalled();
  });
});

describe("RegistrationConfirmation - gość bez konta", () => {
  beforeEach(() => {
    auth.session = null;
  });

  it("dostaje POWÓD i odnośnik do logowania zamiast martwego przycisku", () => {
    renderConfirmation();

    expect(screen.getByText("eventRegistration.payment.accountRequiredTitle")).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.payment.accountRequiredBody")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.payment.payNow")).not.toBeInTheDocument();
    expect(screen.getByText("eventRegistration.payment.signIn").closest("a")).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("widzi kwotę, o którą chodzi - żeby wiedział, po co się loguje", () => {
    renderConfirmation();
    // Kwota pada RAZ, w zdaniu nagłówkowym: molekuła kasy jej nie powtarza,
    // bo dwie kwoty pod sobą czytają się jak dwie różne należności.
    expect(
      screen.getByText("eventRegistration.result.paymentHintAmount(amount=150,00 zł)"),
    ).toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = renderConfirmation();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
