// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Krok platnosci zapisu z FAKTURA NA FIRME: dane nabywcy zapisujemy jako
// prosbe o fakture do TEGO zgloszenia ZANIM otworzy sie kasa. Niepoprawne dane
// albo odmowa bazy zatrzymuja przejscie do kasy (kupujacy poprawia, zamiast
// wracac z platnosci z dokumentem na zle dane). Bez zaznaczenia faktury kasa
// otwiera sie jak dotad - reszte kroku platnosci testuja pliki potwierdzenia.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  checkout: vi.fn(),
  navigate: vi.fn(),
  session: { user: { id: "u-1" } } as { user: { id: string } } | null,
  dialog: null as { clientSecret: string | null; onOpenChange: (open: boolean) => void } | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.checkout,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/billing/checkout.functions", () => ({ createCheckoutOrder: {} }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: (props: {
    clientSecret: string | null;
    onOpenChange: (open: boolean) => void;
  }) => {
    h.dialog = props;
    return props.clientSecret === null ? null : (
      <div data-testid="checkout">{props.clientSecret}</div>
    );
  },
}));
vi.mock("@/lib/events/eventCodeMemory", () => ({ recallEventCode: () => "" }));
const invoices = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));
vi.mock("@/lib/events/myEventInvoicesApi", () => invoices);
const billing = vi.hoisted(() => ({
  fetchMyBillingProfile: vi.fn(),
  upsertMyBillingProfile: vi.fn(),
}));
vi.mock("@/lib/billing/queries", () => billing);

const { RegistrationPayAction } =
  await import("@/components/events/registration/molecules/RegistrationPayAction");

function renderPay(ownedByCaller?: boolean) {
  return renderWithQueryClient(
    <RegistrationPayAction
      ownedByCaller={ownedByCaller}
      registrationId="reg-1"
      eventId="ev-1"
      ticketTypeId="tt-1"
      amountCents={12300}
      currency="PLN"
      returnPath="/events/kongres-27/register"
    />,
  );
}

function fillBuyer(): void {
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.name"), {
    target: { value: "Acme Sp. z o.o." },
  });
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.taxId"), {
    target: { value: "5260250274" },
  });
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.address"), {
    target: { value: "ul. Morska 5" },
  });
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.postalCode"), {
    target: { value: "80-001" },
  });
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.city"), {
    target: { value: "Gdansk" },
  });
}

const PAY = "eventRegistration.payment.payNow";

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { user: { id: "u-1" } };
  h.dialog = null;
  billing.fetchMyBillingProfile.mockResolvedValue(null);
  invoices.fetchMyInvoiceSources.mockResolvedValue([]);
  h.checkout.mockResolvedValue({ ok: true, mode: "mock", orderId: "ord-1" });
});

describe("RegistrationPayAction + faktura na firme", () => {
  it("bez faktury kasa otwiera sie od razu, bez zapisu prosby", async () => {
    renderPay();
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
    expect(invoices.saveInvoiceRequest).not.toHaveBeenCalled();
    expect(invoices.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });

  it("niepoprawne dane nabywcy zatrzymuja kase", async () => {
    renderPay();
    fireEvent.click(screen.getByLabelText("eventInvoices.request.toggle"));
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    expect(await screen.findByText("eventInvoices.request.fixErrors")).toBeTruthy();
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it("poprawne dane: najpierw prosba do tego zgloszenia, potem kasa", async () => {
    invoices.saveInvoiceRequest.mockResolvedValue("req-1");
    renderPay();
    fireEvent.click(screen.getByLabelText("eventInvoices.request.toggle"));
    fillBuyer();
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
    expect(invoices.saveInvoiceRequest).toHaveBeenCalledWith(
      { registrationId: "reg-1" },
      expect.objectContaining({ name: "Acme Sp. z o.o.", taxId: "5260250274" }),
    );
    expect(invoices.saveInvoiceRequest.mock.invocationCallOrder[0]).toBeLessThan(
      h.checkout.mock.invocationCallOrder[0],
    );
  });

  it("odmowa zapisu prosby: zdanie kupujacego, kasa zamknieta", async () => {
    invoices.saveInvoiceRequest.mockRejectedValue(new Error("request_window_closed: x"));
    renderPay();
    fireEvent.click(screen.getByLabelText("eventInvoices.request.toggle"));
    fillBuyer();
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    expect(await screen.findByText("eventInvoices.errors.requestWindowClosed")).toBeTruthy();
    expect(h.checkout).not.toHaveBeenCalled();
  });
});

describe("RegistrationPayAction - zapis prosby w toku i galezie kasy", () => {
  it("zapis danych do faktury w toku blokuje przycisk platnosci", async () => {
    invoices.saveInvoiceRequest.mockReturnValue(new Promise(() => {}));
    renderPay();
    fireEvent.click(screen.getByLabelText("eventInvoices.request.toggle"));
    fillBuyer();
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: PAY })).toHaveProperty("disabled", true),
    );
    expect(screen.getByText("eventInvoices.request.saving")).toBeTruthy();
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it("gosc i cudze zgloszenie: bez bloku faktury i bez zapytan o dane nabywcy", async () => {
    h.session = null;
    const guest = renderPay();
    expect(screen.queryByLabelText("eventInvoices.request.toggle")).toBeNull();
    expect(screen.getByText("eventRegistration.payment.accountRequiredTitle")).toBeTruthy();
    guest.unmount();
    h.session = { user: { id: "u-1" } };
    renderPay(false);
    expect(screen.getByText("eventRegistration.payment.notOwnerBody")).toBeTruthy();
    expect(screen.queryByLabelText("eventInvoices.request.toggle")).toBeNull();
    expect(invoices.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });

  it("odrzucony kod rabatowy: komunikat przy kodzie, kasa zamknieta", async () => {
    h.checkout.mockResolvedValue({ ok: false, mode: "coupon", error: "coupon_invalid" });
    renderPay();
    fireEvent.change(screen.getByPlaceholderText("eventRegistration.payment.promoPlaceholder"), {
      target: { value: "zly" },
    });
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    expect(await screen.findByText("eventRegistration.payment.promoError")).toBeTruthy();
    expect(h.checkout.mock.calls[0]?.[0]).toMatchObject({ data: { coupon_code: "ZLY" } });
  });

  it("kasa operatora: okno platnosci z sekretem, zamkniecie je czysci", async () => {
    h.checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_test" });
    renderPay();
    fireEvent.click(screen.getByRole("button", { name: PAY }));
    expect((await screen.findByTestId("checkout")).textContent).toBe("cs_test");
    act(() => h.dialog?.onOpenChange(true));
    expect(screen.getByTestId("checkout")).toBeTruthy();
    act(() => h.dialog?.onOpenChange(false));
    await waitFor(() => expect(screen.queryByTestId("checkout")).toBeNull());
  });
});
