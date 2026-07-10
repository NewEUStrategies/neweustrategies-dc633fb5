import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitContactMessage = vi.fn();

vi.mock("@tanstack/react-start", () => ({
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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Imię i nazwisko"), {
    target: { value: "Jan Kowalski" },
  });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "jan@example.com" } });
  fireEvent.change(screen.getByLabelText("Wiadomość"), {
    target: { value: "Cześć, mam pytanie." },
  });
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

  it("never calls the server fn when required fields are empty", () => {
    render(<ContactForm lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(submitContactMessage).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
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
});
