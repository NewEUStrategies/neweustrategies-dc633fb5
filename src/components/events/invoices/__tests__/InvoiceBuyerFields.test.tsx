// Pola nabywcy faktury (sterowane). Pilnujemy: kazda zmiana wraca do
// wolajacego jako CALY szkic, bledy widac dopiero po probie wyslania
// (i sa podpiete do pola przez aria-describedby), przelacznik odbiorcy
// czysci jego pola, a zablokowany formularz nie przyjmuje wpisow.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  BUYER_ERROR_KEYS,
  emptyBuyerDraft,
  validateBuyerDraft,
  type InvoiceBuyerDraft,
} from "@/lib/events/eventInvoiceBuyerDraft";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { InvoiceBuyerFields } =
  await import("@/components/events/invoices/molecules/InvoiceBuyerFields");

function Harness({
  initial,
  showErrors = false,
  onChange,
  disabled,
}: {
  initial: InvoiceBuyerDraft;
  showErrors?: boolean;
  onChange?: (next: InvoiceBuyerDraft) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <InvoiceBuyerFields
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      errors={validateBuyerDraft(value)}
      showErrors={showErrors}
      disabled={disabled}
    />
  );
}

describe("InvoiceBuyerFields", () => {
  it("firma: pola z etykietami, zmiana wraca jako caly szkic", () => {
    const onChange = vi.fn();
    render(<Harness initial={emptyBuyerDraft()} onChange={onChange} />);
    expect(screen.getByText("eventInvoices.buyer.legend")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.name"), {
      target: { value: "Acme" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBuyerDraft(), name: "Acme" });
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.taxId"), {
      target: { value: "526" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBuyerDraft(), name: "Acme", taxId: "526" });
    const tax = screen.getByLabelText("eventInvoices.buyer.taxId");
    expect(tax.getAttribute("aria-describedby")).toMatch(/-hint$/);
    expect(screen.getByLabelText("eventInvoices.buyer.name").getAttribute("autocomplete")).toBe(
      "organization",
    );
  });

  it("osoba prywatna: inna etykieta nazwy, radio przelacza rodzaj", () => {
    const onChange = vi.fn();
    render(<Harness initial={emptyBuyerDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("eventInvoices.buyer.kindPerson"));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBuyerDraft(), isCompany: false });
    expect(
      screen.getByLabelText("eventInvoices.buyer.namePerson").getAttribute("autocomplete"),
    ).toBe("name");
    fireEvent.click(screen.getByLabelText("eventInvoices.buyer.kindCompany"));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyBuyerDraft(), isCompany: true });
  });

  it("bledy dopiero po probie wyslania, podpiete do pola", () => {
    const { rerender } = render(<Harness initial={emptyBuyerDraft()} />);
    expect(screen.queryByText(BUYER_ERROR_KEYS.nameRequired)).toBeNull();
    rerender(<Harness initial={emptyBuyerDraft()} showErrors />);
    const name = screen.getByLabelText("eventInvoices.buyer.name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const describedBy = name.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(BUYER_ERROR_KEYS.nameRequired);
    expect(screen.getByText(BUYER_ERROR_KEYS.taxIdRequired)).toBeTruthy();
    const tax = screen.getByLabelText("eventInvoices.buyer.taxId");
    expect(tax.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("odbiorca: przelacznik otwiera pola, odznaczenie je czysci", () => {
    const onChange = vi.fn();
    render(<Harness initial={emptyBuyerDraft()} onChange={onChange} />);
    expect(screen.queryByLabelText("eventInvoices.buyer.recipientName")).toBeNull();
    const toggle = screen.getByLabelText("eventInvoices.buyer.recipientToggle");
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.recipientName"), {
      target: { value: "Dzial szkolen" },
    });
    fireEvent.change(screen.getByLabelText("eventInvoices.buyer.recipientAddress"), {
      target: { value: "ul. Boczna 1" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipientName: "Dzial szkolen", recipientAddress: "ul. Boczna 1" }),
    );
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipientName: "", recipientAddress: "" }),
    );
    expect(screen.queryByLabelText("eventInvoices.buyer.recipientName")).toBeNull();
  });

  it("zapisany odbiorca otwiera sekcje od razu", () => {
    render(<Harness initial={{ ...emptyBuyerDraft(), recipientAddress: "ul. Boczna 1" }} />);
    expect(screen.getByLabelText("eventInvoices.buyer.recipientAddress")).toBeTruthy();
    expect(
      (screen.getByLabelText("eventInvoices.buyer.recipientToggle") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("zablokowany formularz", () => {
    render(<Harness initial={emptyBuyerDraft()} disabled />);
    expect((screen.getByLabelText("eventInvoices.buyer.city") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("dostepnosc: brak naruszen axe (takze z bledami)", async () => {
    const { container } = render(<Harness initial={emptyBuyerDraft()} showErrors />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
