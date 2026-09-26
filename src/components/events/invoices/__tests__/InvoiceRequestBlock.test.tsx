// "Potrzebuje faktury na firme" przy zakupie. Organizm tylko rysuje stan
// kontrolera (logike zapisu testuje useInvoiceRequestController.test.tsx):
// wystawiona faktura zamiast formularza, przelacznik, podpowiedz z profilu,
// "zapamietaj", stany zapisu i odmowy.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BillingProfile } from "@/lib/billing/types";
import { emptyBuyerDraft, validateBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import type { InvoiceRequestController } from "@/lib/events/useInvoiceRequestController";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { InvoiceRequestBlock } =
  await import("@/components/events/invoices/organisms/InvoiceRequestBlock");

const PROFILE: BillingProfile = {
  id: "bp",
  user_id: "u",
  tenant_id: "t",
  full_name: "Anna",
  company: "Acme",
  tax_id: "5260250274",
  email: null,
  phone: null,
  address_line1: null,
  address_line2: null,
  city: null,
  postal_code: null,
  region: null,
  country_code: "PL",
  is_company: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function controller(overrides: Partial<InvoiceRequestController> = {}): InvoiceRequestController {
  const buyer = emptyBuyerDraft();
  return {
    wanted: false,
    setWanted: vi.fn(),
    buyer,
    setBuyer: vi.fn(),
    remember: false,
    setRemember: vi.fn(),
    errors: validateBuyerDraft(buyer),
    showErrors: false,
    invoicedNumber: null,
    hasExistingRequest: false,
    profile: null,
    prefillFromProfile: vi.fn(),
    saving: false,
    failureKey: null,
    validate: vi.fn(() => true),
    commit: vi.fn(async () => true),
    ...overrides,
  };
}

describe("InvoiceRequestBlock", () => {
  it("faktura juz wystawiona: sam komunikat z numerem, bez formularza", () => {
    render(<InvoiceRequestBlock controller={controller({ invoicedNumber: "FV/2026/09/0001" })} />);
    expect(screen.getByRole("status").textContent).toBe(
      "eventInvoices.request.invoiced(number=FV/2026/09/0001)",
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("zwiniety: przelacznik z opisem, zaznaczenie idzie do kontrolera", () => {
    const value = controller();
    render(<InvoiceRequestBlock controller={value} />);
    const toggle = screen.getByLabelText("eventInvoices.request.toggle");
    expect(toggle.getAttribute("aria-describedby")).toMatch(/-hint$/);
    expect(screen.queryByText("eventInvoices.buyer.legend")).toBeNull();
    fireEvent.click(toggle);
    expect(value.setWanted).toHaveBeenCalledWith(true);
  });

  it("rozwiniety: istniejaca prosba, podpowiedz z profilu, zapamietaj", () => {
    const value = controller({ wanted: true, hasExistingRequest: true, profile: PROFILE });
    render(<InvoiceRequestBlock controller={value} />);
    expect(screen.getByText("eventInvoices.request.existing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "eventInvoices.request.prefill" }));
    expect(value.prefillFromProfile).toHaveBeenCalledWith(PROFILE);
    fireEvent.click(screen.getByLabelText("eventInvoices.request.remember"));
    expect(value.setRemember).toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.city"), {
      target: { value: "Gdansk" },
    });
    expect(value.setBuyer).toHaveBeenCalledWith(expect.objectContaining({ city: "Gdansk" }));
  });

  it("bez profilu nie ma przycisku podpowiedzi; zapis w toku blokuje pola", () => {
    render(<InvoiceRequestBlock controller={controller({ wanted: true, saving: true })} />);
    expect(screen.queryByRole("button", { name: "eventInvoices.request.prefill" })).toBeNull();
    expect(screen.getByText("eventInvoices.request.saving")).toBeTruthy();
    expect((screen.getByLabelText("eventInvoices.buyer.city") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("bledy po probie i odmowa bazy jako alerty", () => {
    render(
      <InvoiceRequestBlock
        controller={controller({
          wanted: true,
          showErrors: true,
          failureKey: "eventInvoices.errors.requestWindowClosed",
        })}
      />,
    );
    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts).toEqual([
      "eventInvoices.request.fixErrors",
      "eventInvoices.errors.requestWindowClosed",
    ]);
  });

  it("poprawne dane po probie: bez alertu o bledach", () => {
    const buyer = {
      ...emptyBuyerDraft(),
      name: "Acme",
      taxId: "5260250274",
      address: "ul. Morska 5",
      postalCode: "80-001",
      city: "Gdansk",
    };
    render(
      <InvoiceRequestBlock
        controller={controller({
          wanted: true,
          showErrors: true,
          buyer,
          errors: validateBuyerDraft(buyer),
        })}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dostepnosc: brak naruszen axe", async () => {
    const { container } = render(
      <InvoiceRequestBlock
        controller={controller({ wanted: true, profile: PROFILE, showErrors: true })}
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
