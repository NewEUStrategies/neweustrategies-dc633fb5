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

// Radix Select nie działa w jsdom bez pełnego pointer API - w teście
// zamieniamy atom na natywny <select>, reguły walidacji pilnuje schemat.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    onValueChange,
    options,
    error,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: React.ReactNode }[];
    error?: string | null;
    "aria-label"?: string;
  }) => (
    <>
      <select
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {String(option.label)}
          </option>
        ))}
      </select>
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));

// Oferty pochodzą z katalogu i18n (fallback) - bez react-query w teście.
vi.mock("@/lib/careers/useCareerContent", async () => {
  const catalog = await vi.importActual<typeof import("@/lib/careers/catalog")>(
    "@/lib/careers/catalog",
  );
  return {
    useCareerOffers: () => ({
      offers: catalog.fallbackOffers(((key: string) => key) as never),
      isLoading: false,
    }),
    useCareerSection: () => ({ visible: true }),
  };
});

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
  fillContact();
}

function fillContact() {
  fireEvent.change(screen.getByLabelText(/careers\.form\.phone/), {
    target: { value: "+48 600 100 200" },
  });
  fireEvent.change(screen.getByLabelText(/careers\.form\.linkedin/), {
    target: { value: "linkedin.com/in/jan-kowalski" },
  });
  // CV jest obowiązkowe - w teście podajemy link zamiast wgrywać plik.
  fireEvent.change(screen.getByLabelText(/careers\.form\.cvUrl/), {
    target: { value: "drive.google.com/file/cv-jan" },
  });
}

function fillFit(role = "analyst_economy") {
  fireEvent.change(screen.getByLabelText(/careers\.form\.department/), {
    target: { value: "analysis" },
  });
  fireEvent.change(screen.getByLabelText(/careers\.form\.role$/), { target: { value: role } });
  fireEvent.change(screen.getByLabelText(/careers\.form\.seniority/), {
    target: { value: "mid" },
  });
  fireEvent.change(screen.getByLabelText(/careers\.form\.start/), {
    target: { value: "month" },
  });
}

const LONG_MESSAGE =
  "Chcę prowadzić linię gospodarczą i rozwijać analizy regulacyjne dla naszych klientów.";

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
    expect(toastError).toHaveBeenCalledWith("careers.form.errors.summary");
    expect(screen.getByText("careers.form.errors.firstNameRequired")).toBeInTheDocument();
    expect(screen.getByText("careers.form.errors.phoneRequired")).toBeInTheDocument();
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toBeInTheDocument();

    fillAbout();
    fireEvent.change(screen.getByLabelText(/careers\.form\.email/), {
      target: { value: "to-nie-email" },
    });
    nextStep();
    expect(screen.getByText("careers.form.errors.emailInvalid")).toBeInTheDocument();
  });

  it("wymaga kompletu danych dopasowania (krok 2) - bez nich CRM traci kontekst", () => {
    renderForm();
    fillAbout();
    nextStep();
    nextStep();
    expect(screen.getByText("careers.form.errors.departmentRequired")).toBeInTheDocument();
    expect(screen.getByText("careers.form.errors.seniorityRequired")).toBeInTheDocument();
    expect(screen.getByText("careers.form.fitOptional")).toBeInTheDocument();
  });

  it("przechodzi kroki, wymaga wiadomości i zgody, wysyła komplet danych rekrutacyjnych", async () => {
    renderForm("analyst_economy");

    // Preselekcja z karty roli widoczna od razu.
    expect(screen.getByText(/careers\.roles\.analyst_economy\.title/)).toBeInTheDocument();

    fillAbout();
    nextStep(); // -> Dopasowanie
    expect(screen.getByText("careers.form.fitOptional")).toBeInTheDocument();
    fillFit();
    nextStep(); // -> Wiadomość

    const submitButton = screen.getByRole("button", { name: /careers\.form\.submit/ });
    // Wiadomość jest opcjonalna - blokuje wyłącznie brak zgody.
    fireEvent.click(submitButton);
    expect(screen.getByText("careers.form.errors.consentRequired")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/careers\.form\.message/), {
      target: { value: LONG_MESSAGE },
    });
    fireEvent.click(submitButton);
    expect(screen.getByText("careers.form.errors.consentRequired")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton);

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const payload = (submitSpy.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0]
      .data;
    expect(payload.name).toBe("Jan Kowalski");
    expect(payload.email).toBe("jan.kowalski@example.com");
    expect(payload.phone).toBe("+48 600 100 200");
    expect(payload.formName).toBe("careers-application");
    expect(payload.lang).toBe("pl");
    expect(payload.custom).toMatchObject({
      department: "analysis",
      role: "analyst_economy",
      seniority: "mid",
      start: "month",
      linkedin: "linkedin.com/in/jan-kowalski",
      cv_url: "drive.google.com/file/cv-jan",
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

  it("wysyła zgłoszenie bez 'Dlaczego Ty' - z streszczeniem dopasowania w treści", async () => {
    // REGRESJA: `message` jest wymagane w zod server-fn, w polityce pól tenanta
    // (contact_form.message required) i w kolumnie. Pole „Dlaczego Ty" jest
    // jednak w kreatorze OPCJONALNE, więc puste zgłoszenie wywracało wysyłkę i
    // kandydat widział wyłącznie „nie udało się wysłać" - nic się nie zapisywało.
    renderForm("analyst_economy");
    fillAbout();
    nextStep();
    fillFit();
    nextStep();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.submit/ }));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const payload = (submitSpy.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0]
      .data;
    const message = String(payload.message);
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).toContain("Analizy");
    expect(message).toContain("Specjalista");
    expect(message).toContain("W ciągu miesiąca");
    expect(await screen.findByText("careers.form.success.title")).toBeInTheDocument();
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

  it("skok stepperem W PRZÓD ponownie waliduje krok 'O Tobie'", () => {
    renderForm();
    fillAbout();
    nextStep(); // odwiedzamy "Dopasowanie"

    // Powrót i wyczyszczenie wymaganego pola po drodze.
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.steps\.about/ }));
    fireEvent.change(screen.getByLabelText(/careers\.form\.email/), { target: { value: "" } });

    // Skok w przód do odwiedzonego kroku jest zablokowany walidacją.
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.steps\.fit/ }));
    expect(toastError).toHaveBeenCalledWith("careers.form.errors.summary");
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toBeInTheDocument();

    // Po uzupełnieniu skok przechodzi.
    fireEvent.change(screen.getByLabelText(/careers\.form\.email/), {
      target: { value: "jan.kowalski@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.steps\.fit/ }));
    expect(screen.getByText("careers.form.fitOptional")).toBeInTheDocument();
  });

  it("nowa intencja aplikowania (applySignal) przywraca formularz po sukcesie", async () => {
    const onRoleChange = vi.fn();
    const { rerender } = render(
      <CareersApplyForm
        id="careers-application"
        lang="pl"
        selectedRoleId={null}
        onRoleChange={onRoleChange}
        applySignal={0}
      />,
    );

    fillAbout();
    nextStep();
    fillFit("open");
    nextStep();
    fireEvent.change(screen.getByLabelText(/careers\.form\.message/), {
      target: { value: LONG_MESSAGE },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /careers\.form\.submit/ }));
    expect(await screen.findByText("careers.form.success.title")).toBeInTheDocument();

    // CTA "Aplikuj spontanicznie" nie zmienia roli (null -> null) - formularz
    // wraca wyłącznie dzięki rosnącemu licznikowi intencji.
    rerender(
      <CareersApplyForm
        id="careers-application"
        lang="pl"
        selectedRoleId={null}
        onRoleChange={onRoleChange}
        applySignal={1}
      />,
    );
    expect(screen.queryByText("careers.form.success.title")).toBeNull();
    expect(screen.getByLabelText(/careers\.form\.firstName/)).toHaveValue("");
  });

  it("nie ma naruszeń axe (krok 1)", async () => {
    const { container } = renderForm();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
