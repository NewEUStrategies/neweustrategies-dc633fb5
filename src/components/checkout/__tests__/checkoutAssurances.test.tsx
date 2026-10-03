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

// Płaszczyzna SPRZEDAWCY (własny Stripe Tax): tu nikt nie wystawia faktury ani
// nie zbiera NIP-u „z urzędu" - obietnica należy się wyłącznie wtedy, gdy
// sprzedawca włączył dany parametr sesji. Obietnica bez pokrycia to kupujący
// firmowy, który płaci, licząc na fakturę VAT, której nigdy nie dostanie.
describe("CheckoutAssurances - płaszczyzna sprzedawcy", () => {
  const MERCHANT_BARE: CheckoutSettings = {
    allow_promotion_codes: false,
    automatic_tax: true,
    tax_id_collection: false,
    billing_address_collection: "auto",
    invoice_creation: false,
  };

  const items = () => screen.getAllByRole("listitem").map((li) => li.textContent);

  it("płatność jednorazowa bez faktur i bez NIP obiecuje wyłącznie automatyczny VAT", () => {
    render(<CheckoutAssurances settings={MERCHANT_BARE} mode="payment" />);

    expect(items()).toEqual(["checkout.taxHint"]);
  });

  it("płatność jednorazowa z włączoną fakturą obiecuje fakturę", () => {
    render(
      <CheckoutAssurances settings={{ ...MERCHANT_BARE, invoice_creation: true }} mode="payment" />,
    );

    expect(items()).toEqual(["checkout.taxHint", "checkout.invoiceHint"]);
  });

  it("subskrypcja jest fakturowana zawsze - nawet przy wyłączonej fladze faktury", () => {
    render(<CheckoutAssurances settings={MERCHANT_BARE} mode="subscription" />);

    expect(items()).toEqual(["checkout.taxHint", "checkout.invoiceHint"]);
  });

  it("zbieranie NIP u sprzedawcy obiecuje pole NIP/VAT ID", () => {
    render(
      <CheckoutAssurances
        settings={{ ...MERCHANT_BARE, tax_id_collection: true }}
        mode="payment"
      />,
    );

    expect(items()).toEqual(["checkout.taxHint", "checkout.taxIdHint"]);
  });

  it("własna klasa kontenera zastępuje domyślną (osadzenie w innym układzie)", () => {
    render(<CheckoutAssurances settings={MERCHANT_BARE} mode="payment" className="mt-2 text-sm" />);

    expect(screen.getByRole("list")).toHaveClass("mt-2", "text-sm");
    expect(screen.getByRole("list")).not.toHaveClass("border-t");
  });
});
