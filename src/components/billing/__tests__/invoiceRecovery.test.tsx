import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { InvoiceCrmSyncCard } from "../organisms/InvoiceCrmSyncCard";
import { InvoiceLedgerCard } from "../organisms/InvoiceLedgerCard";

const h = vi.hoisted(() => ({
  company: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  documents: vi.fn(),
  pdf: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  language: "pl",
  signedIn: true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.language } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.signedIn ? { user: { id: "member" } } : null }),
}));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("@/lib/billing/invoices.functions", () => ({
  fetchMyCrmCompany: h.company,
  importMyCrmCompany: h.pull,
  pushMyBillingToCrm: h.push,
  generateMyInvoicePdf: h.pdf,
}));
vi.mock("@/lib/billing/queries", () => ({ fetchMyBillingDocuments: h.documents }));

beforeEach(() => {
  vi.clearAllMocks();
  h.signedIn = true;
  h.language = "pl";
  h.company.mockResolvedValue({
    ok: true,
    company: {
      name: "Fundacja New European Strategies",
      taxId: "123",
      addressLine1: "Test 1",
      postalCode: "00-001",
      city: "Warszawa",
    },
  });
  h.pull.mockResolvedValue({ ok: true });
  h.push.mockResolvedValue({ ok: true });
  h.documents.mockResolvedValue([]);
  h.pdf.mockResolvedValue({
    ok: true,
    result: { base64: btoa("%PDF-1.7"), fileName: "invoice.pdf" },
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:invoice");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("invoice CRM recovery", () => {
  it.each(["pull", "push"] as const)(
    "performs explicit %s and refreshes company data",
    async (direction) => {
      renderWithQueryClient(<InvoiceCrmSyncCard />);
      await screen.findByText("Fundacja New European Strategies");
      fireEvent.click(screen.getByRole("button", { name: `invoices.crm.${direction}` }));
      await waitFor(() => expect(h.success).toHaveBeenCalled());
      expect(h[direction]).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(h.company).toHaveBeenCalledTimes(2));
    },
  );
  it.each(["business", "transport"])("recovers controls after %s failure", async (failure) => {
    if (failure === "business") h.pull.mockResolvedValue({ ok: false, error: "generic" });
    else h.pull.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(<InvoiceCrmSyncCard />);
    fireEvent.click(screen.getByRole("button", { name: "invoices.crm.pull" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("invoices.crm.errors.generic"));
    expect(screen.getByRole("button", { name: "invoices.crm.pull" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(h.success).not.toHaveBeenCalled();
  });
  it("does not fetch company data without a session", () => {
    h.signedIn = false;
    renderWithQueryClient(<InvoiceCrmSyncCard />);
    expect(h.company).not.toHaveBeenCalled();
  });
});

describe("invoice ledger recovery", () => {
  const document = {
    id: "doc-1",
    issued_at: "2026-09-01",
    number: "INV-1",
    amount_cents: 1200,
    currency: "PLN",
    status: "paid",
    pdf_url: "https://example.com/original.pdf",
    hosted_url: null,
  };
  it("shows an empty ledger", async () => {
    renderWithQueryClient(<InvoiceLedgerCard />);
    expect(await screen.findByText("invoices.ledger.empty")).toBeTruthy();
  });
  it.each(["pl", "en"])("downloads the PDF in %s and releases its object URL", async (language) => {
    h.language = language;
    h.documents.mockResolvedValue([document]);
    renderWithQueryClient(<InvoiceLedgerCard />);
    const button = await screen.findByRole("button", { name: "invoices.ledger.download" });
    expect(
      screen.getByRole("link", { name: "invoices.ledger.original" }).getAttribute("href"),
    ).toBe(document.pdf_url);
    fireEvent.click(button);
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("invoices.ledger.ready"));
    expect(h.pdf).toHaveBeenCalledWith({ data: { documentId: "doc-1", locale: language } });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:invoice");
    expect(globalThis.document.querySelector("a[download]")).toBeNull();
  });
  it.each(["business", "transport"])("reports %s errors and permits retry", async (failure) => {
    h.documents.mockResolvedValue([
      { ...document, number: null, pdf_url: null, hosted_url: "https://example.com/invoice" },
    ]);
    if (failure === "business") h.pdf.mockResolvedValue({ ok: false, error: "missing" });
    else h.pdf.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(<InvoiceLedgerCard />);
    fireEvent.click(await screen.findByRole("button", { name: "invoices.ledger.download" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("invoices.ledger.error"));
    expect(
      screen.getByRole("button", { name: "invoices.ledger.download" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
