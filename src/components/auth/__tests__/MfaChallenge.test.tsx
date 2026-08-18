// MfaChallenge: modal AAL2 step-up wspólny dla /login i popupu logowania.
// Powierzchnia MFA startowała z 2,3% pokrycia - ten plik pilnuje kontraktu
// komponentu: walidację kodu PRZED/PO factorId, ścieżkę anulowania (sign-out +
// wyczyszczone pole) oraz ponowne pobranie factorId po każdym otwarciu.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";

const h = vi.hoisted(() => ({
  factorId: "factor-1" as string | null,
  getFactorId: vi.fn(),
  verify: vi.fn(),
  signOutMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/auth/mfa", () => ({
  getVerifiedTotpFactorId: () => h.getFactorId(),
  verifyTotpCode: (factorId: string, code: string) => h.verify(factorId, code),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: h.signOutMock } },
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError } }));

import { MfaChallenge } from "@/components/auth/MfaChallenge";

const t = (key: string) => i18n.t(key);

/** Odpal mikrozadania kolejki po renderze, żeby `getVerifiedTotpFactorId().then(...)` zdążył ustawić stan PRZED asercją/interakcją. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.factorId = "factor-1";
  h.getFactorId.mockReset().mockImplementation(() => Promise.resolve(h.factorId));
  h.verify.mockReset().mockResolvedValue(undefined);
  h.signOutMock.mockReset().mockResolvedValue({ error: null });
  h.toastError.mockClear();
});

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

function codeInput() {
  return screen.getByLabelText(t("profile.security.mfa.challenge.codeLabel"));
}

function verifyButton() {
  return screen.getByRole("button", { name: t("profile.security.mfa.challenge.verify") });
}

function cancelButton() {
  return screen.getByRole("button", { name: t("profile.security.mfa.challenge.cancel") });
}

describe("MfaChallenge - widoczność", () => {
  it("open=false: brak dialogu i pola kodu w drzewie dostępności", () => {
    render(<MfaChallenge open={false} onVerified={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t("profile.security.mfa.challenge.codeLabel")),
    ).not.toBeInTheDocument();
  });

  it("open=true: renderuje tytuł, opis i pole 6-cyfrowego kodu", () => {
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(t("profile.security.mfa.challenge.title"))).toBeInTheDocument();
    expect(screen.getByText(t("profile.security.mfa.challenge.description"))).toBeInTheDocument();
    const input = codeInput();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("maxlength", "6");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });
});

describe("MfaChallenge - pole kodu", () => {
  it("znaki niebędące cyframi są usuwane od razu przy wpisywaniu", () => {
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: "12a3bc45" } });
    expect(input).toHaveValue("12345");
  });
});

describe("MfaChallenge - walidacja i weryfikacja", () => {
  it("kod inny niż 6 cyfr: toast o nieprawidłowym kodzie, weryfikacja nie jest wywołana", async () => {
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(codeInput(), { target: { value: "123" } });
    fireEvent.click(verifyButton());
    expect(h.toastError).toHaveBeenCalledWith(t("profile.security.mfa.invalidCode"));
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("poprawny kod, ale brak factorId: toast o braku aplikacji, weryfikacja nie jest wywołana", async () => {
    h.factorId = null;
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    fireEvent.click(verifyButton());
    expect(h.toastError).toHaveBeenCalledWith(t("profile.security.mfa.challenge.noFactor"));
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("poprawny kod z realnym factorId: wywołuje verifyTotpCode, onVerified i czyści pole", async () => {
    const onVerified = vi.fn();
    render(<MfaChallenge open={true} onVerified={onVerified} onCancel={vi.fn()} />);
    await flush();
    const input = codeInput();
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(verifyButton());
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(h.verify).toHaveBeenCalledWith("factor-1", "123456");
    expect(input).toHaveValue("");
  });

  it("verifyTotpCode odrzucone Errorem: toast z treścią błędu, onVerified nie wywołane, przycisk wraca do użycia", async () => {
    h.verify.mockRejectedValueOnce(new Error("Kod wygasł"));
    const onVerified = vi.fn();
    render(<MfaChallenge open={true} onVerified={onVerified} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(codeInput(), { target: { value: "123456" } });
    const submit = verifyButton();
    fireEvent.click(submit);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Kod wygasł"));
    expect(onVerified).not.toHaveBeenCalled();
    expect(submit).not.toBeDisabled();
  });

  it("verifyTotpCode odrzucone wartością inną niż Error: pokazuje domyślny tłumaczony komunikat", async () => {
    h.verify.mockRejectedValueOnce("boom");
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    fireEvent.change(codeInput(), { target: { value: "654321" } });
    fireEvent.click(verifyButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("profile.security.mfa.challenge.failed")),
    );
  });
});

describe("MfaChallenge - anulowanie", () => {
  it("przycisk Anuluj wylogowuje, czyści pole kodu i wywołuje onCancel", async () => {
    const onCancel = vi.fn();
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={onCancel} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: "111111" } });
    fireEvent.click(cancelButton());
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(h.signOutMock).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });

  it("zamknięcie dialogu przez Escape idzie tą samą ścieżką co Anuluj", async () => {
    const onCancel = vi.fn();
    render(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={onCancel} />);
    const input = codeInput();
    fireEvent.change(input, { target: { value: "222222" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(h.signOutMock).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });
});

describe("MfaChallenge - ponowne otwarcie", () => {
  it("przełączenie open true -> false -> true odpytuje ponownie o factorId i zaczyna z czystym polem", async () => {
    const { rerender } = render(
      <MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />,
    );
    await flush();
    expect(h.getFactorId).toHaveBeenCalledTimes(1);
    fireEvent.change(codeInput(), { target: { value: "333333" } });
    expect(codeInput()).toHaveValue("333333");

    rerender(<MfaChallenge open={false} onVerified={vi.fn()} onCancel={vi.fn()} />);
    rerender(<MfaChallenge open={true} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await flush();

    expect(h.getFactorId).toHaveBeenCalledTimes(2);
    expect(codeInput()).toHaveValue("");
  });
});
