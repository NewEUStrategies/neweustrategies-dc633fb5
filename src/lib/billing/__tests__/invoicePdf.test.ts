import { describe, expect, it } from "vitest";

import {
  encodePdfText,
  formatInvoiceMoney,
  invoiceTotalCents,
  pdfToBase64,
  renderInvoicePdf,
  type InvoiceData,
} from "@/lib/billing/invoicePdf";

const data: InvoiceData = {
  number: "INV-2026-001",
  issuedAt: "2026-03-01",
  currency: "PLN",
  seller: { name: "New European Strategies", taxId: "1234567890" },
  buyer: { name: "Firma Zażółć Gęślą", taxId: "9876543210", city: "Kraków" },
  lines: [
    { description: "Członkostwo - okres rozliczeniowy", quantity: 1, amountCents: 99900 },
    { description: "Bilet", quantity: 2, amountCents: 10000 },
  ],
  labels: {
    title: "Faktura",
    number: "Numer",
    issuedAt: "Data",
    seller: "Sprzedawca",
    buyer: "Nabywca",
    taxId: "NIP",
    description: "Opis",
    quantity: "Ilość",
    amount: "Kwota",
    total: "Razem",
    paid: "Zapłacono",
  },
};

describe("invoicePdf", () => {
  it("sumuje pozycje faktury", () => {
    expect(invoiceTotalCents(data.lines)).toBe(109900);
  });

  it("formatuje kwotę z groszami", () => {
    expect(formatInvoiceMoney(99900, "PLN")).toContain("999");
  });

  it("escapuje znaki sterujące składni PDF", () => {
    expect(encodePdfText("A(B)C\\D")).toBe("A\\(B\\)C\\\\D");
  });

  it("renderuje poprawny nagłówek i stopkę pliku PDF", () => {
    const bytes = renderInvoicePdf(data);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("%%EOF");
    expect(text).toContain("INV-2026-001");
  });

  it("zwraca base64 możliwe do odkodowania", () => {
    const base64 = pdfToBase64(renderInvoicePdf(data));
    expect(atob(base64).startsWith("%PDF")).toBe(true);
  });
});
