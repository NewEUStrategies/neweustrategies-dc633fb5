// Widget "onboarding-form": wieloetapowy brief wysyłany przez utwardzone
// submitContactMessage. Testujemy maszynę kroków (walidacja bramkuje "Dalej"),
// budowę wiadomości (tylko wypełnione pola), zgodę RODO, ścieżki sukcesu
// i błędu wysyłki oraz warianty konfiguracji widgetu (i18n, akcent, wskaźnik).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  submit: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => h.submit,
}));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: {} }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

import { OnboardingFormView } from "../OnboardingFormView";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "../frame";

function renderWidget(c: WidgetContent = {}, lang: Lang = "pl") {
  return render(<OnboardingFormView c={c} lang={lang} />);
}

const typeInto = (id: string, value: string) => {
  const el = document.getElementById(id);
  expect(el, `input #${id}`).toBeTruthy();
  fireEvent.change(el!, { target: { value } });
};

const nextBtn = () => screen.getByRole("button", { name: /Dalej/ });
const backBtn = () => screen.getByRole("button", { name: /Wstecz/ });

/** Przechodzi kroki 1-5 minimalnym kompletem wymaganych pól. */
function walkToRequirements() {
  typeInto("ob-name", "Jan Analityk");
  typeInto("ob-email", "jan@example.com");
  fireEvent.click(nextBtn()); // -> professional
  typeInto("ob-profession", "Analityk polityk publicznych");
  fireEvent.click(nextBtn()); // -> goals
  fireEvent.click(screen.getByRole("button", { name: "Budowa marki" }));
  fireEvent.click(nextBtn()); // -> design (nic wymaganego)
  fireEvent.click(nextBtn()); // -> budget
  fireEvent.click(screen.getByRole("button", { name: "10 000-30 000 PLN" }));
  fireEvent.click(nextBtn()); // -> requirements
}

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("OnboardingFormView - maszyna kroków", () => {
  it("bramkuje 'Dalej' walidacją kroku (imię + poprawny e-mail)", () => {
    renderWidget();

    expect(screen.getByText("Brief projektu")).toBeInTheDocument();
    expect(screen.getByText(/Krok 1 z 6: Dane kontaktowe/)).toBeInTheDocument();
    expect(backBtn()).toBeDisabled();
    expect(nextBtn()).toBeDisabled();

    typeInto("ob-name", "Jan");
    typeInto("ob-email", "nie-mail");
    expect(nextBtn()).toBeDisabled();

    typeInto("ob-email", "jan@example.com");
    expect(nextBtn()).toBeEnabled();

    fireEvent.click(nextBtn());
    expect(screen.getByText(/Krok 2 z 6: Profil zawodowy/)).toBeInTheDocument();
    // Powrót działa i nie gubi danych kroku 1.
    fireEvent.click(backBtn());
    expect((document.getElementById("ob-email") as HTMLInputElement).value).toBe("jan@example.com");
  });

  it("wysyła brief z wypełnionych pól i pokazuje ekran podziękowania", async () => {
    renderWidget({ heading_pl: "Wycena projektu", intro_pl: "Parę pytań." });

    expect(screen.getByText("Parę pytań.")).toBeInTheDocument();
    walkToRequirements();

    // Multi-wybór: zaznacz i odznacz jedną funkcję, zostaw drugą.
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Newsletter" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    typeInto("ob-additional", "Start we wrześniu");

    const submitBtn = screen.getByRole("button", { name: /Wyślij zgłoszenie/ });
    expect(submitBtn).toBeDisabled(); // zgoda wymagana
    fireEvent.click(screen.getByRole("checkbox", { name: /Zgadzam się na kontakt/ }));
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload).toMatchObject({
      name: "Jan Analityk",
      email: "jan@example.com",
      subject: "Wycena projektu",
      consent: true,
      lang: "pl",
      formName: "Wycena projektu",
      source: "onboarding-form",
    });
    // company puste -> undefined (nie pusty string).
    expect(payload.company).toBeUndefined();
    // Wiadomość zawiera tylko wypełnione pola.
    expect(payload.message).toContain("Stanowisko / rola: Analityk polityk publicznych");
    expect(payload.message).toContain("Główny cel: Budowa marki");
    expect(payload.message).toContain("Budżet: 10 000-30 000 PLN");
    expect(payload.message).toContain("Funkcje: Newsletter");
    expect(payload.message).toContain("Dodatkowe informacje: Start we wrześniu");
    expect(payload.message).not.toContain("Branża:");
    expect(payload.message).not.toContain("Inspiracje");

    await screen.findByText("Zgłoszenie przyjęte");
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("porażka wysyłki zostawia formularz i pokazuje toast błędu", async () => {
    h.submit.mockRejectedValueOnce(new Error("rate limited"));
    renderWidget();

    walkToRequirements();
    fireEvent.click(screen.getByRole("checkbox", { name: /Zgadzam się na kontakt/ }));
    fireEvent.click(screen.getByRole("button", { name: /Wyślij zgłoszenie/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // Bez ekranu podziękowania - użytkownik może ponowić.
    expect(screen.queryByText("Zgłoszenie przyjęte")).toBeNull();
    expect(screen.getByRole("button", { name: /Wyślij zgłoszenie/ })).toBeEnabled();
  });

  it("requireConsent=false: bez checkboxa zgody, wysyłka od razu możliwa", async () => {
    renderWidget({ requireConsent: false });

    walkToRequirements();
    expect(screen.queryByRole("checkbox", { name: /Zgadzam się/ })).toBeNull();
    const submitBtn = screen.getByRole("button", { name: /Wyślij zgłoszenie/ });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    // Kontrakt serwera: consent zawsze true (bramka UI albo brak wymogu).
    expect(h.submit.mock.calls[0][0].data.consent).toBe(true);
  });

  it("konfiguracja widgetu: akcent, ukryty wskaźnik, własna etykieta wysyłki, EN", () => {
    const { container } = renderWidget(
      {
        accentColor: "#ff0055",
        showStepIndicator: false,
        submitLabel_en: "Send brief",
        heading_en: "Project intake",
      },
      "en",
    );

    expect(screen.getByText("Project intake")).toBeInTheDocument();
    // Wskaźnik "Step 1 of 6" schowany.
    expect(screen.queryByText(/Step 1 of 6/)).toBeNull();
    // Zmienna CSS akcentu ustawiona na wrapperze.
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.style.getPropertyValue("--ob-accent")).toBe("#ff0055");
    expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
  });

  it("wybory jednokrotne podświetlają aktywną opcję (aria-pressed)", () => {
    renderWidget();
    typeInto("ob-name", "Jan");
    typeInto("ob-email", "jan@example.com");
    fireEvent.click(nextBtn());

    const opt = screen.getByRole("button", { name: "3-5 lat" });
    expect(opt).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(opt);
    expect(opt).toHaveAttribute("aria-pressed", "true");
    // Zmiana wyboru przenosi zaznaczenie.
    fireEvent.click(screen.getByRole("button", { name: "10+ lat" }));
    expect(opt).toHaveAttribute("aria-pressed", "false");
  });
});
