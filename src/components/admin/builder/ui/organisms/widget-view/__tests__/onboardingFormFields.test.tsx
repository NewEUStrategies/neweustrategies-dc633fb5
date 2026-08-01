// OnboardingFormView: komplet pól briefu. Test podstawowy przechodzi kroki
// minimalnym zestawem - tu wypełniamy KAŻDE pole (firma, doświadczenie,
// branża, grupa docelowa, typy treści, preferencje kolorów/stylu, inspiracje,
// harmonogram) i weryfikujemy, że wszystkie trafiają do zbudowanej wiadomości.
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

const typeInto = (id: string, value: string) => {
  const el = document.getElementById(id);
  expect(el, `input #${id}`).toBeTruthy();
  fireEvent.change(el!, { target: { value } });
};

const nextBtn = () => screen.getByRole("button", { name: /Dalej/ });

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(cleanup);

describe("OnboardingFormView - pełny brief", () => {
  it("collects every optional field across all six steps into the message", async () => {
    render(<OnboardingFormView c={{}} lang="pl" />);

    // Krok 1: dane kontaktowe z firmą.
    typeInto("ob-name", "Jan Analityk");
    typeInto("ob-email", "jan@example.com");
    typeInto("ob-company", "NES Sp. z o.o.");
    fireEvent.click(nextBtn());

    // Krok 2: profil zawodowy z doświadczeniem i branżą.
    typeInto("ob-profession", "Analityk");
    fireEvent.click(screen.getByRole("button", { name: "3-5 lat" }));
    typeInto("ob-industry", "Energetyka");
    fireEvent.click(nextBtn());

    // Krok 3: cele z grupą docelową i typami treści.
    fireEvent.click(screen.getByRole("button", { name: "Budowa marki" }));
    typeInto("ob-audience", "Decydenci UE");
    fireEvent.click(screen.getByRole("checkbox", { name: "Raporty" }));
    fireEvent.click(nextBtn());

    // Krok 4: preferencje designu i inspiracje.
    fireEvent.click(screen.getByRole("button", { name: "Stonowany" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimalistyczny" }));
    typeInto("ob-inspirations", "politico.eu");
    fireEvent.click(nextBtn());

    // Krok 5: budżet i harmonogram.
    fireEvent.click(screen.getByRole("button", { name: "10 000-30 000 PLN" }));
    fireEvent.click(screen.getByRole("button", { name: "1-3 miesiące" }));
    fireEvent.click(nextBtn());

    // Krok 6: wymagania + zgoda + wysyłka.
    fireEvent.click(screen.getByRole("checkbox", { name: "Newsletter" }));
    typeInto("ob-additional", "Deadline: wrzesień");
    fireEvent.click(screen.getByRole("checkbox", { name: /Zgadzam się na kontakt/ }));
    fireEvent.click(screen.getByRole("button", { name: /Wyślij zgłoszenie/ }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.company).toBe("NES Sp. z o.o.");
    const msg: string = payload.message;
    expect(msg).toContain("Doświadczenie: 3-5 lat");
    expect(msg).toContain("Branża: Energetyka");
    expect(msg).toContain("Grupa docelowa: Decydenci UE");
    expect(msg).toContain("Rodzaje treści: Raporty");
    expect(msg).toContain("Preferowana kolorystyka: Stonowany");
    expect(msg).toContain("Styl: Minimalistyczny");
    expect(msg).toContain("Inspiracje (linki): politico.eu");
    expect(msg).toContain("Termin realizacji: 1-3 miesiące");
    expect(msg).toContain("Funkcje: Newsletter");
    expect(msg).toContain("Dodatkowe informacje: Deadline: wrzesień");
  });
});
