// „Twoje dane" (/profile/privacy): eksport kopii danych (RODO art. 15 i 20)
// oraz usunięcie konta (art. 17) z notą retencyjną.
//
// Test celowo używa PRAWDZIWEJ instancji i18n i NIE rejestruje słownika
// z zewnątrz - bo to jest awaria, którą ma udowodnić. Klucze
// `profile.security.*` mieszkają wyłącznie w leniwym `i18n-profile.ts`,
// a trasa /profile/privacy rejestrowała tylko słownik sieci kontaktów. Przy
// wejściu wprost na tę stronę karta usuwania konta pokazywała SUROWE ścieżki
// kluczy, a karta eksportu spadała na `defaultValue` starszy niż słownik.
// Z mockiem `t` zwracającym klucz obie awarie byłyby niewidoczne.
//
// Reszta testów pilnuje zachowań, które przy błędzie kosztują dane albo
// bezpieczeństwo: potwierdzenie usunięcia bez hasła, hasło zostające w stanie
// po zamknięciu dialogu, wylogowanie i wyjście z konta po skutecznym usunięciu,
// oraz liczba zachowanych dowodów płatności podana LICZBĄ (art. 12 RODO).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";

type DeleteResult = { retainedEvidence: number };

const h = vi.hoisted(() => ({
  exportMyData: vi.fn(),
  deleteMyAccount: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/profile/export.functions", () => ({
  exportMyData: (): Promise<unknown> => h.exportMyData(),
}));

vi.mock("@/lib/account.functions", () => ({
  deleteMyAccount: (input: { data: { password: string } }): Promise<DeleteResult> =>
    h.deleteMyAccount(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: (): Promise<void> => h.signOut() } },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { DataRightsSection } from "@/components/profile/privacy/DataRightsSection";

/** Klucze, których obecność w drzewie DOM oznacza brak tłumaczenia. */
const KEYS = [
  "profile.security.export.title",
  "profile.security.export.subtitle",
  "profile.security.export.scopeNote",
  "profile.security.export.download",
  "profile.security.danger.title",
  "profile.security.danger.subtitle",
  "profile.security.danger.button",
  "profile.security.danger.retentionTitle",
  "profile.security.danger.retentionBody",
] as const;

const DIALOG_KEYS = [
  "profile.security.danger.confirmTitle",
  "profile.security.danger.confirmBody",
  "profile.security.danger.passwordLabel",
  "profile.security.danger.cancel",
  "profile.security.danger.confirm",
] as const;

let createdUrls = 0;
let revokedUrls = 0;

beforeEach(() => {
  h.exportMyData.mockReset();
  h.deleteMyAccount.mockReset();
  h.signOut.mockReset().mockResolvedValue(undefined);
  h.navigate.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  createdUrls = 0;
  revokedUrls = 0;
  URL.createObjectURL = () => {
    createdUrls += 1;
    return "blob:mock";
  };
  URL.revokeObjectURL = () => {
    revokedUrls += 1;
  };
});

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

// Etykiety bierzemy ze SŁOWNIKA, nie z literałów w teście: inaczej zmiana
// brzmienia (bez zmiany klucza) fałszywie czerwieni bramkę, a dwie różne
// etykiety mieszkające blisko siebie („Usuń konto" jako tytuł karty i „Usuń
// konto na stałe" jako przycisk) łatwo pomylić dopasowaniem po fragmencie.
const label = (key: string): string => i18n.t(`profile.security.${key}`);

/** Otwiera dialog usunięcia konta i zwraca pole hasła. */
function openDeleteDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: label("danger.button") }));
  return screen.getByLabelText(label("danger.passwordLabel"));
}

function confirmButton(): HTMLElement {
  return screen.getByRole("button", { name: label("danger.confirm") });
}

describe("DataRightsSection - tłumaczenia", () => {
  it("po polsku nie renderuje ani jednej surowej ścieżki klucza", async () => {
    await i18n.changeLanguage("pl");
    const { container } = render(<DataRightsSection />);
    for (const key of KEYS) expect(container.textContent).not.toContain(key);
    // Sekcja rejestruje słownik sama - nikt z zewnątrz tego nie robi.
    expect(screen.getByText("Twoje dane (RODO)")).toBeInTheDocument();
  });

  it("po angielsku pokazuje angielski podtytuł, nie polską kopię zapasową", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(<DataRightsSection />);
    for (const key of KEYS) expect(container.textContent).not.toContain(key);
    expect(screen.getByText("Your data (GDPR)")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Pobierz kopię danych osobowych");
  });

  it("podtytuł eksportu wymienia kluby dyskusyjne - stary `defaultValue` ich nie miał", async () => {
    // Konkretny dowód rozjazdu: słownik nadążył za zakresem eksportu, a kopia
    // w komponencie nie. Użytkownik czytał listę, w której brakowało sekcji.
    await i18n.changeLanguage("pl");
    const { container } = render(<DataRightsSection />);
    expect(container.textContent).toContain("kluby dyskusyjne");
    await i18n.changeLanguage("en");
    const { container: enContainer } = render(<DataRightsSection />);
    expect(enContainer.textContent).toContain("discussion clubs");
  });

  it("dialog potwierdzenia też jest przetłumaczony w całości", async () => {
    await i18n.changeLanguage("pl");
    render(<DataRightsSection />);
    openDeleteDialog();
    const dialog = await screen.findByRole("alertdialog");
    for (const key of [...DIALOG_KEYS, ...KEYS]) {
      expect(dialog.textContent).not.toContain(key);
    }
  });
});

describe("DataRightsSection - eksport danych", () => {
  it("składa plik JSON i zwalnia adres blob po pobraniu", async () => {
    await i18n.changeLanguage("pl");
    h.exportMyData.mockResolvedValue({ profile: { id: "u1" } });
    render(<DataRightsSection />);

    fireEvent.click(screen.getByRole("button", { name: label("export.download") }));
    await waitFor(() => expect(h.exportMyData).toHaveBeenCalledTimes(1));
    // Wyciek adresu blob trzyma cały eksport w pamięci karty do zamknięcia.
    await waitFor(() => expect(revokedUrls).toBe(createdUrls));
    expect(createdUrls).toBe(1);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("nieudany eksport pokazuje komunikat i odblokowuje przycisk", async () => {
    await i18n.changeLanguage("pl");
    h.exportMyData.mockRejectedValue(new Error("boom"));
    render(<DataRightsSection />);
    const button = screen.getByRole("button", { name: label("export.download") });

    fireEvent.click(button);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    // Przycisk nie może zostać w stanie „Przygotowywanie..." po błędzie.
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});

describe("DataRightsSection - usunięcie konta", () => {
  it("nie pozwala potwierdzić bez hasła", async () => {
    await i18n.changeLanguage("pl");
    render(<DataRightsSection />);
    openDeleteDialog();
    expect(confirmButton()).toBeDisabled();
    expect(h.deleteMyAccount).not.toHaveBeenCalled();
  });

  it("po skutecznym usunięciu wylogowuje i wychodzi na stronę główną", async () => {
    await i18n.changeLanguage("pl");
    h.deleteMyAccount.mockResolvedValue({ retainedEvidence: 0 });
    render(<DataRightsSection />);
    const password = openDeleteDialog();

    fireEvent.change(password, { target: { value: "sekret123" } });
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(h.deleteMyAccount).toHaveBeenCalledWith({
        data: { password: "sekret123" },
      }),
    );
    // Konto już nie istnieje - lokalna sesja musi zniknąć, inaczej aplikacja
    // pracuje dalej na tokenie nieistniejącego użytkownika.
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("podaje LICZBĘ zachowanych dowodów płatności, gdy jakieś zostają", async () => {
    await i18n.changeLanguage("pl");
    h.deleteMyAccount.mockResolvedValue({ retainedEvidence: 3 });
    render(<DataRightsSection />);
    const password = openDeleteDialog();

    fireEvent.change(password, { target: { value: "sekret123" } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    const message = String(h.toastSuccess.mock.calls[0][0]);
    expect(message).toContain("3");
    expect(message).not.toContain("profile.security.danger");
  });

  it("bez zachowanych dowodów nie dokłada prawniczej adnotacji", async () => {
    await i18n.changeLanguage("pl");
    h.deleteMyAccount.mockResolvedValue({ retainedEvidence: 0 });
    render(<DataRightsSection />);
    const password = openDeleteDialog();

    fireEvent.change(password, { target: { value: "sekret123" } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    expect(String(h.toastSuccess.mock.calls[0][0])).not.toContain("3");
  });

  it("nieudane usunięcie pokazuje komunikat serwera i nie wylogowuje", async () => {
    await i18n.changeLanguage("pl");
    h.deleteMyAccount.mockRejectedValue(new Error("Nieprawidłowe hasło"));
    render(<DataRightsSection />);
    const password = openDeleteDialog();

    fireEvent.change(password, { target: { value: "zle-haslo" } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Nieprawidłowe hasło"));
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("zamknięcie dialogu czyści hasło ze stanu", async () => {
    // Hasło zostające w stanie po anulowaniu wraca przy kolejnym otwarciu -
    // wpisane raz, potwierdzalne jednym kliknięciem bez ponownego uwierzytelnienia.
    await i18n.changeLanguage("pl");
    render(<DataRightsSection />);
    const password = openDeleteDialog();
    fireEvent.change(password, { target: { value: "sekret123" } });

    fireEvent.click(screen.getByRole("button", { name: label("danger.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    const reopened = openDeleteDialog();
    expect(reopened).toHaveValue("");
  });
});
