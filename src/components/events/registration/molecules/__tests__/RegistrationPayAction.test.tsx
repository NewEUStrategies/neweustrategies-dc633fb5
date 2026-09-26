// Molekuła kasy wejściówki - PODGLĄD KWOTY, kod rabatowy i droga do kasy.
//
// ZGŁOSZENIE WŁAŚCICIELA: „kod na stałą kwotę odejmuje się raz od całego
// zamówienia". Kasa liczyła grupę poprawnie, ale ŻADEN ekran przed nakładką
// Stripe tego nie pokazywał - molekuła mówiła cenę jednego miejsca bez kodu.
// Ten plik dowodzi, że:
//   1. rozbicie to „Miejsca: 3 × 100 zł", „Kod: -20 zł × 3", „Do zapłaty:
//      240 zł" - z PODGLĄDU kasy, a nie z ceny miejsca;
//   2. odmowa kodu pada PRZED otwarciem kasy (podgląd), a kod wpisany bez
//      „Zastosuj" i tak trafia do podglądu przy „Zapłać";
//   3. kod TYLKO odsłaniający bilety (zapamiętany z linku) nie blokuje
//      płatności: znika z pola z jednym zdaniem wyjaśnienia;
//   4. dopisanie gości (udana mutacja na ekranie) przelicza rozbicie.
//
// ATRAPY TYLKO NA GRANICACH: obie server fn (tożsamość + `useServerFn`), sesja,
// modal operatora, środowisko bramki. `useQuery` jedzie prawdziwy, w świeżym
// kliencie. i18n to echo kluczy, ale KWOTY liczy `Intl` - asertujemy dosłownie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const checkout = vi.fn();
const quote = vi.fn();
const navigate = vi.fn();
const auth = vi.hoisted(() => ({
  session: { user: { id: "u-1" } } as { user: { id: string } } | null,
}));
const memory = vi.hoisted(() => ({ code: "" }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => navigate,
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "quoteEventTicketCheckout" ? quote : checkout,
}));

vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@/lib/billing/eventTicketQuote.functions", () => ({
  quoteEventTicketCheckout: { name: "quoteEventTicketCheckout" },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: auth.session }) }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));

vi.mock("@/lib/events/eventCodeMemory", () => ({ recallEventCode: () => memory.code }));

// Modal operatora: przyciski udają zamknięcie i ponowne otwarcie ramki.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({
    clientSecret,
    onOpenChange,
  }: {
    clientSecret: string | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    clientSecret === null ? null : (
      <div data-testid="checkout-modal">
        {clientSecret}
        <button type="button" onClick={() => onOpenChange(true)}>
          modal-open
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          modal-close
        </button>
      </div>
    ),
}));

const { RegistrationPayAction } =
  await import("@/components/events/registration/molecules/RegistrationPayAction");

const REGISTRATION_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "33333333-3333-3333-3333-333333333333";

function quoteResult(over: Record<string, unknown> = {}) {
  return {
    seats: 1,
    unitCents: 10000,
    subtotalCents: 10000,
    currency: "PLN",
    coupon: null,
    discountCents: 0,
    totalCents: 10000,
    couponError: null,
    ...over,
  };
}

/** Grupa trzech osób po 100 zł z kodem kwotowym -20 zł od miejsca. */
const GROUP_FIXED = quoteResult({
  seats: 3,
  subtotalCents: 30000,
  coupon: { code: "MINUS20", kind: "fixed", percent: null, perSeatCents: 2000 },
  discountCents: 6000,
  totalCents: 24000,
});

function renderAction(over: Partial<Parameters<typeof RegistrationPayAction>[0]> = {}) {
  return renderWithQueryClient(
    <RegistrationPayAction
      registrationId={REGISTRATION_ID}
      eventId={EVENT_ID}
      ticketTypeId={TICKET_ID}
      amountCents={10000}
      currency="PLN"
      returnPath="/events/kongres"
      {...over}
    />,
  );
}

function promoInput(): HTMLInputElement {
  return screen.getByPlaceholderText("eventRegistration.payment.promoPlaceholder");
}

function type(value: string): void {
  fireEvent.change(promoInput(), { target: { value } });
}

function click(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

const APPLY = "eventRegistration.payment.promoApply";
const PAY = "eventRegistration.payment.payNow";

beforeEach(() => {
  checkout.mockReset();
  quote.mockReset();
  navigate.mockReset();
  quote.mockResolvedValue(quoteResult());
  auth.session = { user: { id: "u-1" } };
  memory.code = "";
});

describe("RegistrationPayAction - rozbicie kwoty z podglądu kasy", () => {
  it("grupa z kodem kwotowym: „3 × 100 zł”, „-20 zł × 3”, „do zapłaty 240 zł”", async () => {
    quote.mockResolvedValue(GROUP_FIXED);
    renderAction();

    expect(
      await screen.findByText("eventRegistration.payment.amountDue(amount=240,00 zł)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("eventRegistration.payment.quoteSeats(count=3,unit=100,00 zł)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "eventRegistration.payment.quoteCodeFixed(code=MINUS20,count=3,perSeat=20,00 zł)",
      ),
    ).toBeInTheDocument();
    // Cena JEDNEGO miejsca z bazy nie udaje kwoty do zapłaty.
    expect(
      screen.queryByText("eventRegistration.payment.amountDue(amount=100,00 zł)"),
    ).not.toBeInTheDocument();
  });

  it("podgląd liczy zgłoszenie, wydarzenie i wejściówkę - bez kodu nie wysyła pustego kodu", async () => {
    renderAction();

    await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));
    expect(quote.mock.calls[0]?.[0]).toEqual({
      data: { event_id: EVENT_ID, ticket_type_id: TICKET_ID, registration_id: REGISTRATION_ID },
    });
  });

  it("jedno miejsce: bez wiersza miejsc, sama kwota do zapłaty", async () => {
    renderAction();

    expect(
      await screen.findByText("eventRegistration.payment.amountDue(amount=100,00 zł)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/quoteSeats/)).not.toBeInTheDocument();
  });

  it("kod kwotowy na jednym miejscu to po prostu kwota rabatu", async () => {
    quote.mockResolvedValue(
      quoteResult({
        coupon: { code: "MINUS20", kind: "fixed", percent: null, perSeatCents: 2000 },
        discountCents: 2000,
        totalCents: 8000,
      }),
    );
    renderAction();

    expect(
      await screen.findByText(
        "eventRegistration.payment.quoteCodeAmount(amount=20,00 zł,code=MINUS20)",
      ),
    ).toBeInTheDocument();
  });

  it("kod kwotowy bez kwoty na miejsce też pokazuje samą kwotę rabatu", async () => {
    quote.mockResolvedValue(
      quoteResult({
        seats: 2,
        coupon: { code: "X", kind: "fixed", percent: null, perSeatCents: null },
        discountCents: 4000,
        totalCents: 16000,
      }),
    );
    renderAction();

    expect(
      await screen.findByText("eventRegistration.payment.quoteCodeAmount(amount=40,00 zł,code=X)"),
    ).toBeInTheDocument();
  });

  it("kod procentowy mówi procent i kwotę", async () => {
    quote.mockResolvedValue(
      quoteResult({
        seats: 3,
        coupon: { code: "PROC10", kind: "percent", percent: 10, perSeatCents: null },
        discountCents: 3000,
        totalCents: 27000,
      }),
    );
    renderAction();

    expect(
      await screen.findByText(
        "eventRegistration.payment.quoteCodePercent(amount=30,00 zł,code=PROC10,percent=10)",
      ),
    ).toBeInTheDocument();
  });

  it("kod procentowy bez procentu w odpowiedzi nie wymyśla go - zostaje kwota", async () => {
    quote.mockResolvedValue(
      quoteResult({
        coupon: { code: "P", kind: "percent", percent: null, perSeatCents: null },
        discountCents: 500,
        totalCents: 9500,
      }),
    );
    renderAction();

    expect(
      await screen.findByText("eventRegistration.payment.quoteCodeAmount(amount=5,00 zł,code=P)"),
    ).toBeInTheDocument();
  });

  it("w trakcie liczenia mówi „liczymy kwotę”, a nie cenę jednego miejsca", () => {
    quote.mockReturnValue(new Promise(() => {}));
    renderAction();

    expect(screen.getByText("eventRegistration.payment.quoteLoading")).toBeInTheDocument();
    expect(screen.queryByText(/amountDue/)).not.toBeInTheDocument();
  });

  it("odmowa podglądu to zdanie odmowy - to samo, co powiedziałaby kasa", async () => {
    quote.mockRejectedValue(new Error("registration_not_payable:seats_unavailable"));
    renderAction();

    expect(
      await screen.findByText("eventPackages.quoteReasons.group_seats_unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.payment.quoteLoading")).not.toBeInTheDocument();
  });

  it("`showAmount=false` nie pokazuje żadnej kwoty", async () => {
    quote.mockResolvedValue(GROUP_FIXED);
    renderAction({ showAmount: false });

    await waitFor(() => expect(quote).toHaveBeenCalled());
    expect(screen.queryByText(/amountDue|quoteSeats|quoteLoading/)).not.toBeInTheDocument();
  });

  it("bez kompletu identyfikatorów: kwota z bazy, martwe przyciski, żadnego podglądu", () => {
    renderAction({ ticketTypeId: null });

    expect(
      screen.getByText("eventRegistration.payment.amountDue(amount=100,00 zł)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PAY })).toBeDisabled();
    expect(screen.getByRole("button", { name: APPLY })).toBeDisabled();
    expect(quote).not.toHaveBeenCalled();
  });
});

describe("RegistrationPayAction - kod rabatowy", () => {
  it("„Zastosuj” przelicza podgląd z kodem i pokazuje rozbicie", async () => {
    renderAction();
    await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));
    quote.mockResolvedValue(GROUP_FIXED);

    type(" minus20 ");
    click(APPLY);

    await waitFor(() =>
      expect(quote).toHaveBeenLastCalledWith({
        data: {
          event_id: EVENT_ID,
          ticket_type_id: TICKET_ID,
          registration_id: REGISTRATION_ID,
          coupon_code: "MINUS20",
        },
      }),
    );
    expect(
      await screen.findByText("eventRegistration.payment.amountDue(amount=240,00 zł)"),
    ).toBeInTheDocument();
  });

  it("„Zastosuj” z tym samym kodem liczy podgląd jeszcze raz", async () => {
    renderAction();
    await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));

    click(APPLY);

    await waitFor(() => expect(quote).toHaveBeenCalledTimes(2));
  });

  it("odmowa kodu pada PRZED kasą - bez klikania „Zapłać”", async () => {
    quote.mockImplementation(async ({ data }: { data: { coupon_code?: string } }) =>
      data.coupon_code ? quoteResult({ couponError: "expired" }) : quoteResult(),
    );
    renderAction();
    type("STARY");
    click(APPLY);

    expect(await screen.findByText("eventRegistration.payment.promoError")).toBeInTheDocument();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("kod z linku, który TYLKO odsłania bilety, znika z pola i nie blokuje płatności", async () => {
    memory.code = "odslon";
    quote.mockImplementation(async ({ data }: { data: { coupon_code?: string } }) =>
      data.coupon_code ? quoteResult({ couponError: "no_discount" }) : quoteResult(),
    );
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_1" });
    renderAction();

    expect(
      await screen.findByText("eventRegistration.payment.promoRevealOnly(code=ODSLON)"),
    ).toBeInTheDocument();
    expect(promoInput().value).toBe("");
    expect(screen.queryByText("eventRegistration.payment.promoError")).not.toBeInTheDocument();

    click(PAY);
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    expect(checkout.mock.calls[0]?.[0]).not.toHaveProperty("data.coupon_code");
  });

  it("odpowiedź „bez rabatu” bez kodu w polu niczego nie czyści", async () => {
    quote.mockResolvedValue(quoteResult({ couponError: "no_discount" }));
    renderAction();

    await waitFor(() => expect(quote).toHaveBeenCalled());
    expect(screen.queryByText(/promoRevealOnly/)).not.toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.payment.promoError")).not.toBeInTheDocument();
  });

  it("nowy kod po zdjęciu kodu bez rabatu chowa zdanie wyjaśnienia", async () => {
    memory.code = "ODSLON";
    quote.mockImplementation(async ({ data }: { data: { coupon_code?: string } }) =>
      data.coupon_code === "ODSLON" ? quoteResult({ couponError: "no_discount" }) : quoteResult(),
    );
    renderAction();
    await screen.findByText("eventRegistration.payment.promoRevealOnly(code=ODSLON)");

    type("MINUS20");
    click(APPLY);

    await waitFor(() => expect(screen.queryByText(/promoRevealOnly/)).not.toBeInTheDocument());
  });
});

describe("RegistrationPayAction - klik do kasy", () => {
  it("kod wpisany bez „Zastosuj” jedzie do kasy i do podglądu", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_42" });
    renderAction({ intent: "resume" });
    await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));

    type("minus20");
    click("eventRegistration.payment.resume");

    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1));
    expect(checkout.mock.calls[0]?.[0]).toEqual({
      data: {
        kind: "one_time",
        event_id: EVENT_ID,
        ticket_type_id: TICKET_ID,
        registration_id: REGISTRATION_ID,
        success_path: "/events/kongres",
        cancel_path: "/events/kongres",
        environment: "sandbox",
        coupon_code: "MINUS20",
      },
    });
    await waitFor(() =>
      expect(quote).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ coupon_code: "MINUS20" }) }),
      ),
    );
    expect(await screen.findByTestId("checkout-modal")).toHaveTextContent("cs_42");

    // Ramka otwarta dalej nie gubi sesji; zamknięta - chowa modal.
    click("modal-open");
    expect(screen.getByTestId("checkout-modal")).toBeInTheDocument();
    click("modal-close");
    expect(screen.queryByTestId("checkout-modal")).not.toBeInTheDocument();
  });

  it("w trakcie otwierania kasy przycisk mówi „otwieramy kasę” i jest wyłączony", async () => {
    let finish: (value: unknown) => void = () => {};
    checkout.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAction();

    click(PAY);

    const busy = await screen.findByRole("button", { name: "eventRegistration.payment.paying" });
    expect(busy).toBeDisabled();
    await act(async () => finish({ ok: true, mode: "stripe", clientSecret: "cs_2" }));
  });

  it("kasa odrzuca kod - zdanie o kodzie, bez modala", async () => {
    checkout.mockResolvedValue({ ok: false, mode: "coupon", error: "limit_reached" });
    renderAction();

    type("RAZ");
    click(PAY);

    expect(await screen.findByText("eventRegistration.payment.promoError")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-modal")).not.toBeInTheDocument();
  });

  it("kasa mówi „kod bez rabatu” - kod znika i płatność idzie dalej bez niego", async () => {
    checkout
      .mockResolvedValueOnce({ ok: false, mode: "coupon", error: "no_discount" })
      .mockResolvedValueOnce({ ok: true, mode: "stripe", clientSecret: "cs_bez_kodu" });
    renderAction();

    type("ODSLON");
    click(PAY);

    expect(await screen.findByTestId("checkout-modal")).toHaveTextContent("cs_bez_kodu");
    expect(checkout).toHaveBeenCalledTimes(2);
    expect(checkout.mock.calls[0]?.[0]).toHaveProperty("data.coupon_code", "ODSLON");
    expect(checkout.mock.calls[1]?.[0]).not.toHaveProperty("data.coupon_code");
    expect(
      screen.getByText("eventRegistration.payment.promoRevealOnly(code=ODSLON)"),
    ).toBeInTheDocument();
    expect(promoInput().value).toBe("");
  });

  it("odmowa `ok: false` spoza kodu dostaje zdanie ze słownika odmów", async () => {
    checkout.mockResolvedValue({ ok: false, mode: "unconfigured", error: "billing_unconfigured" });
    renderAction();

    click(PAY);

    expect(
      await screen.findByText("eventPackages.quoteReasons.payments_unavailable"),
    ).toBeInTheDocument();
  });

  it("wyjątek kasy wygrywa z odmową podglądu - na ekranie jedno zdanie", async () => {
    quote.mockRejectedValue(new Error("ticket_sold_out"));
    checkout.mockRejectedValue(new Error("ticket_sales_closed"));
    renderAction();
    await screen.findByText("eventPackages.quoteReasons.sold_out");

    click(PAY);

    expect(await screen.findByText("eventPackages.quoteReasons.sales_closed")).toBeInTheDocument();
    expect(screen.queryByText("eventPackages.quoteReasons.sold_out")).not.toBeInTheDocument();
  });

  it("tryb mock prowadzi na stronę potwierdzenia zamówienia", async () => {
    checkout.mockResolvedValue({ ok: true, mode: "mock", orderId: "o-1", url: "/x" });
    renderAction();

    click(PAY);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/checkout/success",
        search: { order: "o-1", mock: 1 },
      }),
    );
  });
});

describe("RegistrationPayAction - dopisanie gości przelicza rozbicie", () => {
  it("udana mutacja na ekranie odświeża podgląd, nieudana - nie", async () => {
    const { queryClient } = renderAction();
    await waitFor(() => expect(quote).toHaveBeenCalledTimes(1));
    quote.mockResolvedValue(GROUP_FIXED);

    // Nieudana mutacja (np. odrzuceni goście) niczego nie zmienia w zamówieniu.
    await act(async () => {
      await queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: async () => {
            throw new Error("group_too_large");
          },
        })
        .execute(undefined)
        .catch(() => undefined);
    });
    expect(quote).toHaveBeenCalledTimes(1);

    // Udana (goście dopisani) - rozbicie liczy się od nowa.
    await act(async () => {
      await queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: async () => ({ added: 2 }) })
        .execute(undefined);
    });
    expect(
      await screen.findByText("eventRegistration.payment.quoteSeats(count=3,unit=100,00 zł)"),
    ).toBeInTheDocument();
  });
});

describe("RegistrationPayAction - bez sesji i cudze zgłoszenie", () => {
  it("gość bez konta: powód, odnośnik do logowania i kwota z bazy - bez podglądu", () => {
    auth.session = null;
    renderAction();

    expect(screen.getByText("eventRegistration.payment.accountRequiredTitle")).toBeInTheDocument();
    expect(
      screen.getByText("eventRegistration.payment.amountDue(amount=100,00 zł)"),
    ).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.payment.signIn").closest("a")).toHaveAttribute(
      "href",
      "/login",
    );
    expect(quote).not.toHaveBeenCalled();
  });

  it("gość bez konta z `showAmount=false` nie dostaje kwoty", () => {
    auth.session = null;
    renderAction({ showAmount: false });

    expect(screen.queryByText(/amountDue/)).not.toBeInTheDocument();
  });

  it("cudze zgłoszenie: zdanie o innym koncie, bez kasy i bez podglądu", () => {
    renderAction({ ownedByCaller: false });

    expect(screen.getByText("eventRegistration.payment.notOwnerBody")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PAY })).not.toBeInTheDocument();
    expect(quote).not.toHaveBeenCalled();
  });

  it("bez wydarzenia z formularza kod z pamięci nie jest czytany", () => {
    memory.code = "ZAPAMIETANY";
    renderAction({ eventId: null });

    expect(promoInput().value).toBe("");
  });
});
