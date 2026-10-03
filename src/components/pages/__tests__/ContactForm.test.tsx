import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitContactMessage = vi.fn();

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/contact.functions", () => ({
  submitContactMessage: (...args: unknown[]) => submitContactMessage(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { ContactForm } from "@/components/pages/ContactForm";

const CONSENT_PL = "Wyrażam zgodę na przetwarzanie moich danych w celu odpowiedzi na wiadomość.";

function fillFields() {
  fireEvent.change(screen.getByLabelText("Imię i nazwisko"), {
    target: { value: "Jan Kowalski" },
  });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "jan@example.com" } });
  fireEvent.change(screen.getByLabelText("Wiadomość"), {
    target: { value: "Cześć, mam pytanie." },
  });
}

function fillValidForm() {
  fillFields();
  fireEvent.click(screen.getByRole("checkbox", { name: CONSENT_PL }));
}

describe("ContactForm", () => {
  beforeEach(() => {
    submitContactMessage.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("only shows a success toast once the server call actually resolves", async () => {
    submitContactMessage.mockResolvedValueOnce({ ok: true, id: "1", emails: {} });
    render(<ContactForm lang="pl" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows an error toast - never a success toast - when the server call fails", async () => {
    submitContactMessage.mockRejectedValueOnce(new Error("policy_violation"));
    render(<ContactForm lang="pl" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("blokuje przycisk wysyłki i nie woła serwera, gdy wiadomość jest pusta", () => {
    render(<ContactForm lang="pl" />);
    const submit = screen.getByRole("button", { name: "Wyślij" });

    // Walidacja composera wyłącza przycisk, zanim dojdzie do wywołania serwera.
    expect(submit).toBeDisabled();
    fireEvent.click(submit);

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("rejects an invalid email client-side without calling the server fn", () => {
    render(<ContactForm lang="pl" />);
    fireEvent.change(screen.getByLabelText("Imię i nazwisko"), {
      target: { value: "Jan Kowalski" },
    });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Wiadomość"), {
      target: { value: "Cześć, mam pytanie." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  // ZGODA RODO (wydanie 11: „dodać realną zgodę"). Formularz wysyłał na sztywno
  // `consent: true` bez pola - rejestr zgód poświadczał coś, czego nikt nie
  // zaznaczył. Te przypadki pilnują, że zgoda jest WYRAŻANA, a nie zakładana.
  it("bez zaznaczonej zgody NIE woła serwera i mówi dlaczego", () => {
    render(<ContactForm lang="pl" />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Zaznacz zgodę na przetwarzanie danych, aby wysłać wiadomość.",
    );
    const checkbox = screen.getByRole("checkbox", { name: CONSENT_PL });
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Zaznacz zgodę");
  });

  it("pole zgody startuje NIEZAZNACZONE - zgoda nie jest domyślna", () => {
    render(<ContactForm lang="pl" />);
    expect(screen.getByRole("checkbox", { name: CONSENT_PL })).not.toBeChecked();
  });

  it("wysyła zgodę i wpis do rejestru z treścią, którą użytkownik widział", async () => {
    submitContactMessage.mockResolvedValueOnce({ ok: true, id: "1", emails: {} });
    render(<ContactForm lang="pl" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(1));
    const payload = (submitContactMessage.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(payload.consent).toBe(true);
    expect(payload.consents).toEqual([{ key: "rodo", text: CONSENT_PL, given: true, lang: "pl" }]);
  });

  it("po angielsku rejestr niesie angielską treść zgody", async () => {
    submitContactMessage.mockResolvedValueOnce({ ok: true, id: "1", emails: {} });
    render(<ContactForm lang="en" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "John Smith" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "john@example.com" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello there." } });
    const consentText = "I agree to the processing of my data in order to receive a reply.";
    fireEvent.click(screen.getByRole("checkbox", { name: consentText }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(submitContactMessage).toHaveBeenCalledTimes(1));
    const payload = (submitContactMessage.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
    expect(payload.consents).toEqual([{ key: "rodo", text: consentText, given: true, lang: "en" }]);
  });

  it("po udanej wysyłce zgoda wraca do stanu niezaznaczonego", async () => {
    // Kolejna wiadomość z tej samej karty to nowe przetwarzanie - zgoda nie
    // może „przejść" z poprzedniej wysyłki.
    submitContactMessage.mockResolvedValueOnce({ ok: true, id: "1", emails: {} });
    render(<ContactForm lang="pl" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("checkbox", { name: CONSENT_PL })).not.toBeChecked();
  });

  it("zaznaczenie zgody zdejmuje komunikat o jej braku", () => {
    render(<ContactForm lang="pl" />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: CONSENT_PL }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
