// Obietnice checkoutu vs rzeczywistość sesji Stripe.
//
// Audyt wykazał, że strona /checkout obiecywała kupującemu flagi (kod
// promocyjny, automatyczny VAT, NIP), które nigdy nie trafiały do sesji.
// Te testy pilnują niezmiennika: lista pokazuje WYŁĄCZNIE to, co poleci do
// operatora - i milknie, gdy dana rzecz w sesji nie wystąpi.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutAssurances } from "@/components/checkout/CheckoutAssurances";
import type { CheckoutSettings } from "@/lib/billing/checkoutSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SETTINGS: CheckoutSettings = {
  allow_promotion_codes: true,
  automatic_tax: false,
  tax_id_collection: true,
  billing_address_collection: "auto",
  invoice_creation: true,
};

describe("CheckoutAssurances", () => {
  it("bez ustawień nie obiecuje niczego", () => {
    const { container } = render(<CheckoutAssurances settings={undefined} mode="subscription" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tryb operatora rozliczeniowego: kupon, VAT, NIP i faktura", () => {
    render(<CheckoutAssurances settings={SETTINGS} mode="subscription" />);
    expect(screen.getByText("checkout.promoHint")).toBeInTheDocument();
    expect(screen.getByText("checkout.taxIdHint")).toBeInTheDocument();
    expect(screen.getByText("checkout.invoiceHint")).toBeInTheDocument();
    // VAT nalicza operator rozliczeniowy - obietnica należy się kupującemu.
    expect(screen.getByText("checkout.taxHint")).toBeInTheDocument();
  });

  it("zastosowany kupon B2B chowa obietnicę pola kodu promocyjnego", () => {
    render(<CheckoutAssurances settings={SETTINGS} mode="subscription" hasDiscount />);
    expect(screen.queryByText("checkout.promoHint")).toBeNull();
    expect(screen.getByText("checkout.taxIdHint")).toBeInTheDocument();
  });

  it("własny Stripe Tax dokłada obietnicę automatycznego VAT", () => {
    render(
      <CheckoutAssurances settings={{ ...SETTINGS, automatic_tax: true }} mode="subscription" />,
    );
    expect(screen.getByText("checkout.taxHint")).toBeInTheDocument();
  });

  it("wszystko wyłączone -> zostaje tylko to, co robi operator rozliczeniowy", () => {
    render(
      <CheckoutAssurances
        settings={{
          allow_promotion_codes: false,
          automatic_tax: false,
          tax_id_collection: false,
          billing_address_collection: "auto",
          invoice_creation: false,
        }}
        mode="payment"
      />,
    );
    expect(screen.queryByText("checkout.promoHint")).toBeNull();
    expect(screen.getByText("checkout.taxHint")).toBeInTheDocument();
    expect(screen.getByText("checkout.taxIdHint")).toBeInTheDocument();
    expect(screen.getByText("checkout.invoiceHint")).toBeInTheDocument();
  });
});
