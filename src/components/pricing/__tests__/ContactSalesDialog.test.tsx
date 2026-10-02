// Okno „Porozmawiajmy" - jedyna ścieżka zakupu ofert bez checkoutu
// (korporacje, Decision Lab, warstwy w trybie `contact`).
//
// RYZYKO. Zgłoszenie z tego okna jest leadem sprzedażowym: trafia do Contact
// Center z auto-odpowiedzią i powiadomieniem działu. Ten plik pinuje to, czego
// nie pinuje `pricingSurfaces.test.tsx`:
//
//   1. OKNA NIE DA SIĘ ZAMKNĄĆ W TRAKCIE WYSYŁKI. Zamknięcie w locie odpina
//      komunikat o wyniku - klient nie wie, czy zgłoszenie doszło, i wysyła
//      je drugi raz (zdublowany lead) albo wcale.
//   2. ENTER W POLU NIE OMIJA BRAMKI. Przycisk jest wyłączony bez zgody na
//      kontakt, ale formularz da się wysłać klawiszem - zgłoszenie bez zgody to
//      przetwarzanie danych bez podstawy.
//   3. TEMAT NIESIE NAZWĘ OFERTY, o którą pyta klient (także planu bez
//      warstwy), a pole firmy nie wysyła pustego napisu do CRM.
//
// Atrapowane są wyłącznie granice: funkcja serwerowa Contact Center (przez
// `useServerFn`), toasty i słownik (echo klucza). Okno Radiksa biegnie
// prawdziwe - to ono zamyka się klawiszem Escape.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { membershipTier, reactI18nextStub } from "@/test/admin/pricingFixtures";

const h = vi.hoisted(() => ({
  submit: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.submit }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: vi.fn() }));

import { ContactSalesDialog } from "@/components/pricing/organisms/ContactSalesDialog";

type SubmitArg = { data: Record<string, unknown> };

let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  onOpenChange = vi.fn<(open: boolean) => void>();
});

function renderDialog(props: { subjectLabel?: string } = {}) {
  return render(
    <ContactSalesDialog
      open
      onOpenChange={onOpenChange}
      tier={membershipTier({ name_pl: "Korporacyjny", name_en: "Corporate" })}
      lang="pl"
      {...props}
    />,
  );
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function fill(values: {
  name?: string;
  email?: string;
  company?: string;
  message?: string;
  consent?: boolean;
}) {
  const field = (label: string, value: string | undefined) => {
    if (value !== undefined)
      fireEvent.change(within(dialog()).getByLabelText(`pricing.contactDialog.${label}`), {
        target: { value },
      });
  };
  field("name", values.name);
  field("email", values.email);
  field("company", values.company);
  field("message", values.message);
  if (values.consent) fireEvent.click(within(dialog()).getByRole("checkbox"));
}

function fillComplete(extra: { company?: string } = {}) {
  fill({
    name: "Jan Testowy",
    email: "jan@example.com",
    message: "Proszę o ofertę dla 12 osób",
    consent: true,
    ...extra,
  });
}

function submitForm() {
  const form = within(dialog())
    .getByRole("button", { name: /contactDialog\.submit/ })
    .closest("form")!;
  fireEvent.submit(form);
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

describe("ContactSalesDialog - zamykanie okna", () => {
  it("Escape zamyka okno, gdy nic nie jest w drodze", () => {
    renderDialog();

    pressEscape();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("„anuluj” zamyka okno i niczego nie wysyła", () => {
    renderDialog();
    fillComplete();

    fireEvent.click(within(dialog()).getByRole("button", { name: "pricing.contactDialog.cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("W TRAKCIE wysyłki ani Escape, ani „anuluj” nie zamykają okna", async () => {
    let release: () => void = () => {};
    h.submit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderDialog();
    fillComplete();

    submitForm();
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));

    pressEscape();
    const cancel = within(dialog()).getByRole("button", { name: "pricing.contactDialog.cancel" });
    expect(cancel).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => release());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("pricing.contactDialog.success");
  });
});

describe("ContactSalesDialog - bramka wysyłki", () => {
  it("Enter w formularzu BEZ zgody na kontakt niczego nie wysyła", () => {
    renderDialog();
    fill({ name: "Jan Testowy", email: "jan@example.com", message: "Proszę o ofertę" });

    submitForm();

    expect(h.submit).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("Enter z pustą treścią wiadomości (same spacje) też niczego nie wysyła", () => {
    renderDialog();
    fill({ name: "Jan Testowy", email: "jan@example.com", message: "   ", consent: true });

    submitForm();

    expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("ContactSalesDialog - treść zgłoszenia", () => {
  it("nazwa firmy idzie do zgłoszenia przycięta", async () => {
    renderDialog();
    fillComplete({ company: "  Example Sp. z o.o.  " });

    submitForm();

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect((h.submit.mock.calls[0][0] as SubmitArg).data.company).toBe("Example Sp. z o.o.");
  });

  it("pole firmy z samymi spacjami NIE wysyła pustego napisu do CRM", async () => {
    renderDialog();
    fillComplete({ company: "   " });

    submitForm();

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const data = (h.submit.mock.calls[0][0] as SubmitArg).data;
    expect(data.company).toBeUndefined();
  });

  it("temat nosi nazwę WARSTWY, gdy okno otwarto z karty warstwy", async () => {
    renderDialog();
    fillComplete();

    expect(within(dialog()).getByText(/contactDialog\.subject/)).toHaveTextContent("Korporacyjny");
    submitForm();

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect((h.submit.mock.calls[0][0] as SubmitArg).data.subject).toBe(
      'pricing.contactDialog.subject {"tier":"Korporacyjny"}',
    );
  });

  it("nazwa oferty bez warstwy (plan wyceniany indywidualnie) wygrywa z warstwą", async () => {
    renderDialog({ subjectLabel: "Decision Lab" });
    fillComplete();

    submitForm();

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect((h.submit.mock.calls[0][0] as SubmitArg).data.subject).toBe(
      'pricing.contactDialog.subject {"tier":"Decision Lab"}',
    );
  });

  it("zgłoszenie niesie PEŁNY adres strony (ścieżka + zapytanie), z której je wysłano", async () => {
    // Dział sprzedaży rozpoznaje po adresie, z jakiej oferty przyszedł lead
    // (karta planu, segment cennika). Stała „/pricing" albo sama ścieżka bez
    // `?audience=` gubiłyby tę informację.
    const previous = window.location.href;
    window.history.replaceState(null, "", "/plans/plan-decision-lab?audience=business");
    try {
      renderDialog();
      fillComplete();

      submitForm();

      await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
      expect((h.submit.mock.calls[0][0] as SubmitArg).data.pageUrl).toBe(
        `${window.location.origin}/plans/plan-decision-lab?audience=business`,
      );
    } finally {
      window.history.replaceState(null, "", previous);
    }
  });

  it("po udanej wysyłce formularz jest czysty - kolejne zgłoszenie nie dziedziczy danych", async () => {
    const view = renderDialog();
    fillComplete({ company: "Example" });

    submitForm();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    view.rerender(<ContactSalesDialog open onOpenChange={onOpenChange} tier={null} lang="pl" />);
    expect(within(dialog()).getByLabelText("pricing.contactDialog.name")).toHaveValue("");
    expect(within(dialog()).getByLabelText("pricing.contactDialog.company")).toHaveValue("");
    expect(within(dialog()).getByRole("checkbox")).not.toBeChecked();
  });
});
