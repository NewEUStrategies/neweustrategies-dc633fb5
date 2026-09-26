// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Zakup pakietu z FAKTURA NA FIRME: dane nabywcy sa strukturalne, walidowane
// PRZED zamowieniem, a po zamowieniu zapisane jako prosba o fakture do TEGO
// zamowienia (`packageOrderId` z odpowiedzi bazy). Sekcja zakupu znika po
// zamowieniu, wiec wynik zapisu mowi toast - odmowa nie przepada po cichu.
// Bez zaznaczenia faktury zakup dziala jak dotad (osobny plik testow zakupu).
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

const admission = vi.hoisted(() => ({
  fetchPackagesOffer: vi.fn(),
  fetchMyPackageOrders: vi.fn(),
  fetchMyPackageSeats: vi.fn(),
  quoteAdmission: vi.fn(),
  purchasePackage: vi.fn(),
  inviteMyPackageSeat: vi.fn(),
}));
vi.mock("@/lib/events/admissionApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/admissionApi")>()),
  ...admission,
}));
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

const { toast } = await import("sonner");
const { EventPackagesPurchase } =
  await import("@/components/events/packages/EventPackagesPurchase");

beforeEach(() => {
  vi.clearAllMocks();
  admission.fetchPackagesOffer.mockResolvedValue([
    {
      id: "pkg-1",
      key: "team-5",
      event_id: "e1",
      audience: "company",
      name_pl: "Pakiet firmowy",
      name_en: "Company package",
      description_pl: "",
      description_en: "",
      currency: "PLN",
      price_cents: 50000,
      seats: 5,
      packages_left: 3,
      qualifies: true,
      requires_verification: false,
      min_tier_rank: 0,
      sales_from: "2026-01-01T00:00:00Z",
      sales_to: "2099-01-01T00:00:00Z",
      sort_order: 1,
      ticket_type_id: "tt-1",
    },
  ]);
  admission.fetchMyPackageOrders.mockResolvedValue([]);
  admission.fetchMyPackageSeats.mockResolvedValue([]);
  admission.quoteAdmission.mockResolvedValue({
    ok: true,
    kind: "package",
    eventId: "e1",
    audience: "company",
    seats: 5,
    currency: "PLN",
    priceCents: 50000,
    discountCents: 0,
    totalCents: 50000,
    couponCode: null,
    seatsLeft: 3,
  });
  admission.purchasePackage.mockResolvedValue({
    orderId: "ord-9",
    seats: 5,
    currency: "PLN",
    totalCents: 50000,
    discountCents: 0,
    status: "pending",
  });
  billing.fetchMyBillingProfile.mockResolvedValue(null);
  invoices.fetchMyInvoiceSources.mockResolvedValue([]);
});

async function openPurchaseWithInvoice(): Promise<HTMLElement> {
  renderWithQueryClient(<EventPackagesPurchase slug="kongres-27" />);
  fireEvent.click(await screen.findByRole("button", { name: /Pakiet firmowy/ }));
  fireEvent.change(screen.getByLabelText("eventPackages.buyerName"), { target: { value: "Anna" } });
  fireEvent.change(screen.getByLabelText("eventPackages.buyerEmail"), {
    target: { value: "anna@example.com" },
  });
  fireEvent.click(screen.getByLabelText("eventInvoices.request.toggle"));
  const buy = screen.getByRole("button", { name: /eventPackages\.buy(Action|Pending)/ });
  await waitFor(() => expect(buy).toHaveProperty("disabled", false));
  return buy;
}

function fillBuyer(): void {
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.name"), {
    target: { value: "Acme Sp. z o.o." },
  });
  fireEvent.change(screen.getByLabelText("eventInvoices.buyer.taxId"), {
    target: { value: "526-025-02-74" },
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

describe("EventPackagesPurchase + faktura na firme", () => {
  it("niepoprawne dane nabywcy zatrzymuja zamowienie", async () => {
    const buy = await openPurchaseWithInvoice();
    fireEvent.click(buy);
    expect(await screen.findByText("eventInvoices.request.fixErrors")).toBeTruthy();
    expect(admission.purchasePackage).not.toHaveBeenCalled();
  });

  it("po zamowieniu prosba o fakture trafia do TEGO zamowienia", async () => {
    invoices.saveInvoiceRequest.mockResolvedValue("req-1");
    const buy = await openPurchaseWithInvoice();
    fillBuyer();
    fireEvent.click(buy);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("eventInvoices.request.saved"));
    expect(admission.purchasePackage).toHaveBeenCalledTimes(1);
    expect(invoices.saveInvoiceRequest).toHaveBeenCalledWith(
      { packageOrderId: "ord-9" },
      expect.objectContaining({ name: "Acme Sp. z o.o.", taxId: "526-025-02-74", city: "Gdansk" }),
    );
  });

  it("odmowa zapisu prosby po zamowieniu = toast z droga do profilu", async () => {
    invoices.saveInvoiceRequest.mockRejectedValue(new Error("rate_limited: x"));
    const buy = await openPurchaseWithInvoice();
    fillBuyer();
    fireEvent.click(buy);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("eventInvoices.request.saveFailedAfterPurchase"),
    );
    expect(toast.success).toHaveBeenCalledWith("eventPackages.toasts.purchased");
  });
});
