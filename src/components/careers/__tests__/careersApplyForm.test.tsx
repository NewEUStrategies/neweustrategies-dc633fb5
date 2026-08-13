// Kreator aplikacji (/zatrudniamy): walidacja per krok, preselekcja roli
// z karty, kompletny payload do utwardzonej funkcji serwerowej i panel
// potwierdzenia zamiast tostu. i18n zamockowane kluczami (jak w pozostałych
// testach komponentów) - teksty PL/EN pilnuje bramka parzystości słowników.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

const submitSpy = vi.fn(async () => ({ ok: true }));
const toastError = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => submitSpy,
}));

vi.mock("@/lib/contact.functions", () => ({
  submitContactMessage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import { CareersApplyForm } from "@/components/careers/organisms/CareersApplyForm";

function renderForm(selectedRoleId: string | null = null) {
  const onRoleChange = vi.fn();
  const utils = render(
    <CareersApplyForm
      id="careers-application"
      lang="pl"
      selectedRoleId={selectedRoleId}
      onRoleChange={onRoleChange}
    />,
  );
  return { ...utils, onRoleChange };
}

function fillAbout() {
  fireEvent.change(screen.getByLabelText(/careers\.form\.firstName/), {
    target: { value: "Jan" },
  });
  fireEvent.change(screen.getByLabelText(/careers\.form\.lastName/), {
    target: { value: "Kowalski" },
  });
  fireEvent.change(screen.getByLabelText(/careers\.form\.email/), {
    target: { value: "jan.kowalski@example.com" },
  });
}

function nextStep() {
  fireEvent.click(screen.getByRole("button", { name: /careers\.form\.next/ }));
}

beforeEach(() => {
  submitSpy.mockClear();
  toastError.mockClear();
});

describe("CareersApplyForm: kreator 3 kroków", () => {
  it("blokuje krok 1 bez danych kontaktowych i bez poprawnego e-maila", () => {
    renderForm();
    nextStep();
    expect(toastError).toHaveBeenCalledWith("careers.form.requiredAbout");
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toBeInTheDocument();

    fillAbout();
    fireEvent.change(screen.getByLabelText(/careers\.form\.email/), {
      target: { value: "to-nie-email" },
    });
    nextStep();
    expect(toastError).toHaveBeenCalledWith("careers.form.invalidEmail");
  });

  it("przechodzi kroki, wymaga wiadomości i zgody, wysyła komplet danych rekrutacyjnych", async () => {
    renderForm("analyst_economy");

    // Preselekcja z karty roli widoczna od razu.
    expect(screen.getByText(/careers\.roles\.analyst_economy\.title/)).toBeInTheDocument();

    fillAbout();
    nextStep(); // -> Dopasowanie
    expect(screen.getByText("careers.form.fitOptional")).toBeInTheDocument();
    nextStep(); // -> Wiadomość (pola dopasowania są opcjonalne)

    const submitButton = screen.getByRole("button", { name: /careers\.form\.submit/ });
    fireEvent.click(submitButton);
    expect(toastError).toHaveBeenCalledWith("careers.form.requiredMessage");

    fireEvent.change(screen.getByLabelText(/careers\.form\.message/), {
      target: { value: "Chcę prowadzić linię gospodarczą." },
    });
    fireEvent.click(submitButton);
    expect(toastError).toHaveBeenCalledWith("careers.form.consentRequired");

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton);

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const payload = (submitSpy.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0]
      .data;
    expect(payload.name).toBe("Jan Kowalski");
    expect(payload.email).toBe("jan.kowalski@example.com");
    expect(payload.formName).toBe("careers-application");
    expect(payload.lang).toBe("pl");
    expect(payload.custom).toMatchObject({
      department: "analysis",
      role: "analyst_economy",
      seniority: "mid",
    });
    expect(payload.consents).toEqual([
      { key: "recruitment", text: "careers.form.consent", lang: "pl" },
    ]);

    // Formularz ustępuje panelowi potwierdzenia z dalszą drogą zgłoszenia.
    expect(await screen.findByText("careers.form.success.title")).toBeInTheDocument();
    expect(screen.getByText("careers.form.success.points.reply")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /careers\.form\.submit/ })).toBeNull();

    // "Wyślij kolejne zgłoszenie" wraca do pustego kroku 1.
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.success\.again/ }));
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toHaveValue("");
  });

  it("pozwala wrócić stepperem tylko do kroków odwiedzonych", () => {
    renderForm();
    fillAbout();
    nextStep();

    // Krok przyszły ("Wiadomość") jest wyłączony, powrót do kroku 1 działa.
    const messageStep = screen.getByRole("button", { name: /careers\.form\.steps\.message/ });
    expect(messageStep).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.steps\.about/ }));
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toHaveValue("Jan");
  });

  it("nie ma naruszeń axe (krok 1)", async () => {
    const { container } = renderForm();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
