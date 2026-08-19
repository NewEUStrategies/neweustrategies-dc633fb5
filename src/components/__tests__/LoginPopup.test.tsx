// POPUP LOGOWANIA - 0% linii do 19.08.2026.
//
// To jest ten popup, który otwiera się z każdej „akcji zastrzeżonej" w
// serwisie. Stał w całości nieprzetestowany, mimo że skleja cztery rzeczy,
// z których każda potrafi zepsuć logowanie po cichu:
//   * zaporę brute force (błąd zapory ma zostać ZAMIENIONY na komunikat,
//     a nie wyciec jako surowy tekst z serwera),
//   * przekierowanie na własną stronę logowania, gdy popup jest wyłączony -
//     z regułą, że tylko adres wewnętrzny idzie routerem,
//   * wyścig `mfaPending`: sesja pojawia się natychmiast po zalogowaniu,
//     a popup NIE MOŻE się zamknąć, dopóki nie wiadomo, czy potrzebny jest
//     drugi składnik,
//   * wyłącznik publicznej rejestracji.
//
// `t` zwraca KLUCZ (atrapa i18n), więc asercje sprawdzają, że komunikaty idą
// przez słownik, a nie że ktoś wpisał napis w kodzie.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { reactI18nextStub } from "@/test/i18nStub";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";

const h = vi.hoisted(() => ({
  session: null as unknown,
  settings: {} as Record<string, unknown>,
  theme: "light",
  navigate: vi.fn(),
  guard: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  mfaRequired: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  assign: vi.fn(),
  lang: "pl",
}));

vi.mock("react-i18next", () => reactI18nextStub(() => h.lang));
vi.mock("@/lib/i18n-public", () => ({}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.guard }));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/lib/auth/mfa", () => ({ isMfaChallengeRequired: () => h.mfaRequired() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/hooks/useAuthSettings", () => ({ useAuthSettings: () => h.settings }));
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: h.theme }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (a: unknown) => h.signIn(a),
      signUp: (a: unknown) => h.signUp(a),
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { error: (m: unknown) => h.toastError(m), success: (m: unknown) => h.toastSuccess(m) },
}));
// Atrapa drugiego składnika: wystawia przyciski, żeby dało się dojechać do
// obu wyjść (potwierdzenie i rezygnacja) bez testowania samego MfaChallenge -
// on ma własny próg i własny plik testowy.
vi.mock("@/components/auth/MfaChallenge", () => ({
  MfaChallenge: ({
    open,
    onVerified,
    onCancel,
  }: {
    open: boolean;
    onVerified: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="mfa">
        <button type="button" onClick={onVerified}>
          mfa-ok
        </button>
        <button type="button" onClick={onCancel}>
          mfa-anuluj
        </button>
      </div>
    ) : null,
}));

const { LoginPopup } = await import("@/components/LoginPopup");
const { openLoginPopup } = await import("@/lib/loginPopupBus");

function settingsWith(overrides: Partial<AuthSettings> = {}): Record<string, unknown> {
  return { ...AUTH_DEFAULTS, ...overrides };
}

/** Montuje popup i otwiera go szyną zdarzeń - tak jak robi to produkcja. */
async function openPopup(arg?: Parameters<typeof openLoginPopup>[0]) {
  render(<LoginPopup />);
  await act(async () => {
    openLoginPopup(arg ?? "signin");
  });
}

function fillCredentials(email = "ktos@example.test", password = "haslo-12345") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("authForms.passwordLabel"), {
    target: { value: password },
  });
}

beforeEach(() => {
  h.session = null;
  h.settings = settingsWith();
  h.theme = "light";
  h.navigate.mockReset();
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.mfaRequired.mockReset().mockResolvedValue(false);
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.assign.mockReset();
  h.lang = "pl";
  vi.stubGlobal("location", { origin: "https://serwis.example.test", assign: h.assign });
});

describe("LoginPopup - otwieranie i treść nagłówka", () => {
  it("zamknięty popup nie renderuje formularza", () => {
    render(<LoginPopup />);

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByTestId("mfa")).toBeNull();
  });

  it("szyna zdarzeń otwiera popup w trybie logowania", async () => {
    await openPopup("signin");

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: AUTH_DEFAULTS.signin_label_pl })).toBeTruthy();
  });

  it("nagłówek i opis biorą się z ustawień redakcji, w języku strony", async () => {
    h.settings = settingsWith({
      popup_heading_pl: "Witaj z powrotem",
      popup_description_pl: "Zaloguj się, aby zapisywać.",
    });

    await openPopup("signin");

    expect(screen.getByText("Witaj z powrotem")).toBeTruthy();
    expect(screen.getByText("Zaloguj się, aby zapisywać.")).toBeTruthy();
  });

  it("wywołanie z akcji zastrzeżonej NADPISUJE nagłówek i opis", async () => {
    // Tak działa „Zapisz artykuł" - popup ma tłumaczyć, po co się logujemy.
    await openPopup({ mode: "signin", title: "Zapisz artykuł", description: "Wróć do niego." });

    expect(screen.getByText("Zapisz artykuł")).toBeTruthy();
    expect(screen.getByText("Wróć do niego.")).toBeTruthy();
  });

  it("tryb ciemny bierze logo dla ciemnego motywu", async () => {
    h.theme = "dark";
    h.settings = settingsWith({ form_logo_url: "/jasne.svg", form_logo_url_dark: "/ciemne.svg" });

    await openPopup("signin");

    expect(screen.getByRole("presentation").getAttribute("src")).toBe("/ciemne.svg");
  });

  it("brak wariantu ciemnego SPADA na logo jasne, zamiast znikać", async () => {
    // Instalacja skonfigurowana przed dodaniem wariantu dark ma dalej logo.
    h.theme = "dark";
    h.settings = settingsWith({ form_logo_url: "/jasne.svg", form_logo_url_dark: "" });

    await openPopup("signin");

    expect(screen.getByRole("presentation").getAttribute("src")).toBe("/jasne.svg");
  });
});

describe("LoginPopup - popup wyłączony w ustawieniach", () => {
  it("adres WEWNĘTRZNY idzie routerem, bez twardego przeładowania", async () => {
    h.settings = settingsWith({ popup_enabled: false, custom_login_url: "/czlonkostwo/login" });

    await openPopup("signin");

    expect(h.navigate).toHaveBeenCalledWith({ to: "/czlonkostwo/login" });
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("pełny adres http(s) to twarda nawigacja - zewnętrzny dostawca tożsamości", async () => {
    h.settings = settingsWith({
      popup_enabled: false,
      custom_login_url: "https://idp.example.test/login",
    });

    await openPopup("signin");

    expect(h.assign).toHaveBeenCalledWith("https://idp.example.test/login");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("adres protokołowo-względny NIE jest wewnętrzny - spada na /login", async () => {
    // "//evil.example" wygląda jak ścieżka, a jest cudzym hostem.
    h.settings = settingsWith({ popup_enabled: false, custom_login_url: "//evil.example" });

    await openPopup("signup");

    expect(h.navigate).toHaveBeenCalledWith({ to: "/login", search: { mode: "signup" } });
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("pusty adres własny spada na /login z zachowaniem trybu", async () => {
    h.settings = settingsWith({ popup_enabled: false, custom_login_url: "   " });

    await openPopup("signup");

    expect(h.navigate).toHaveBeenCalledWith({ to: "/login", search: { mode: "signup" } });
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

describe("LoginPopup - logowanie hasłem", () => {
  it("przed Supabase pyta zaporę brute force, w trybie `login`", async () => {
    await openPopup("signin");
    fillCredentials();

    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signIn).toHaveBeenCalled());
    expect(h.guard).toHaveBeenCalledWith({
      data: { kind: "login", email: "ktos@example.test" },
    });
  });

  it("poprawne logowanie zamyka popup i potwierdza KLUCZEM ze słownika", async () => {
    await openPopup("signin");
    fillCredentials();

    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("auth.signinOk"));
    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
  });

  it("PRZEKROCZONY LIMIT prób pokazuje komunikat ze słownika, nie tekst z serwera", async () => {
    // Surowe „auth: rate_limited" w toastcie byłoby wyciekiem komunikatu
    // serwerowego i nie przetłumaczyłoby się na angielski.
    h.guard.mockRejectedValue(new Error("auth: rate_limited"));

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.rateLimited"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("BŁĘDNE WEJŚCIE zapory też mapuje się na klucz", async () => {
    h.guard.mockRejectedValue(new Error("auth: invalid_input:email"));

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.invalidInput"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("NIEZNANY błąd zapory leci dalej, zamiast być przemilczany", async () => {
    h.guard.mockRejectedValue(new Error("network down"));

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("network down"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("ZŁE POŚWIADCZENIA pokazują błąd i ZOSTAWIAJĄ popup otwarty", async () => {
    // Zamknięcie popupu przy złym haśle kasowałoby wpisane dane.
    h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Invalid login credentials"));
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});

describe("LoginPopup - wyścig z drugim składnikiem (MFA)", () => {
  it("gdy wymagany jest drugi składnik, popup NIE zamyka się po samym haśle", async () => {
    // To jest ten wyścig: sesja aal1 pojawia się natychmiast po zalogowaniu,
    // a efekt „jest sesja -> zamknij" zamknąłby okno przed wpisaniem kodu.
    h.mfaRequired.mockResolvedValue(true);

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(screen.getByTestId("mfa")).toBeTruthy());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("potwierdzenie drugiego składnika zamyka popup i potwierdza sukces", async () => {
    h.mfaRequired.mockResolvedValue(true);

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    await waitFor(() => expect(screen.getByTestId("mfa")).toBeTruthy());

    // Radix ustawia `aria-hidden` na rodzeństwie otwartego dialogu, więc
    // atrapa MFA nie istnieje w drzewie ról - szukamy jej po tekście.
    fireEvent.click(screen.getByText("mfa-ok"));

    expect(h.toastSuccess).toHaveBeenCalledWith("auth.signinOk");
    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
  });

  it("rezygnacja z drugiego składnika zamyka popup BEZ potwierdzenia sukcesu", async () => {
    h.mfaRequired.mockResolvedValue(true);

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    await waitFor(() => expect(screen.getByTestId("mfa")).toBeTruthy());

    fireEvent.click(screen.getByText("mfa-anuluj"));

    expect(h.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
  });

  it("istniejąca sesja zamyka otwarty popup samoczynnie", async () => {
    h.session = { user: { id: "u1" } };

    await openPopup("signin");

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(h.signIn).not.toHaveBeenCalled();
  });
});

describe("LoginPopup - rejestracja", () => {
  it("przełącznik prowadzi z logowania do rejestracji i z powrotem", async () => {
    await openPopup("signin");

    fireEvent.click(screen.getByRole("button", { name: "authForms.noAccount" }));
    expect(screen.getByLabelText("authForms.nameLabel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "authForms.haveAccount" }));
    expect(screen.queryByLabelText("authForms.nameLabel")).toBeNull();
  });

  it("WYŁĄCZONA rejestracja publiczna ukrywa przełącznik", async () => {
    h.settings = settingsWith({ allow_public_signup: false });

    await openPopup("signin");

    expect(screen.queryByRole("button", { name: "authForms.noAccount" })).toBeNull();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("WYŁĄCZONA rejestracja odrzuca próbę wysłania formularza kluczem ze słownika", async () => {
    // Popup otwarty w trybie signup wprost z szyny - z pominięciem przełącznika.
    h.settings = settingsWith({ allow_public_signup: false });

    await openPopup("signup");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.signupDisabled"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("rejestracja rozbija imię i nazwisko na osobne pola profilu", async () => {
    await openPopup("signup");
    fireEvent.change(screen.getByLabelText("authForms.nameLabel"), {
      target: { value: "  Anna Maria Kowalska  " },
    });
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    const data = h.signUp.mock.calls[0]![0].options.data;
    expect(data.first_name).toBe("Anna");
    expect(data.last_name).toBe("Maria Kowalska");
    expect(data.signup_type).toBe("reader");
  });

  it("BRAK imienia daje nazwę wyświetlaną z części adresu e-mail", async () => {
    await openPopup("signup");
    fillCredentials("nowy@example.test");
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    const data = h.signUp.mock.calls[0]![0].options.data;
    expect(data.display_name).toBe("nowy");
    expect(data.last_name).toBe("");
  });

  it("adres potwierdzenia NIE przyjmuje wartości spoza serwisu", async () => {
    // `logged_in_redirect_url` spoza „/" nie może wyciec do maila
    // potwierdzającego jako cel przekierowania.
    h.settings = settingsWith({ logged_in_redirect_url: "https://evil.example" });

    await openPopup("signup");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0]![0].options.emailRedirectTo).toBe("https://serwis.example.test/");
  });

  it("wewnętrzny adres po zalogowaniu trafia do adresu potwierdzenia", async () => {
    h.settings = settingsWith({ logged_in_redirect_url: "/panel" });

    await openPopup("signup");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0]![0].options.emailRedirectTo).toBe(
      "https://serwis.example.test/panel",
    );
  });

  it("BŁĄD rejestracji zostawia popup otwarty z komunikatem", async () => {
    h.signUp.mockResolvedValue({ error: new Error("User already registered") });

    await openPopup("signup");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("User already registered"));
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("rejestracja pyta zaporę w trybie `signup`, nie `login`", async () => {
    await openPopup("signup");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.guard).toHaveBeenCalledWith({
      data: { kind: "signup", email: "ktos@example.test" },
    });
  });
});

describe("LoginPopup - dostępność pola hasła", () => {
  it("przełącznik podglądu zmienia typ pola i własną etykietę", async () => {
    await openPopup("signin");
    const toggle = screen.getByRole("button", { name: "authForms.showPassword" });

    fireEvent.click(toggle);

    expect(screen.getByLabelText("authForms.passwordLabel").getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "authForms.hidePassword" })).toBeTruthy();
  });

  it("rejestracja wymaga dłuższego hasła niż logowanie", async () => {
    await openPopup("signup");

    expect(screen.getByLabelText("authForms.passwordLabel").getAttribute("minlength")).toBe("8");
    expect(screen.getByLabelText("authForms.passwordLabel").getAttribute("autocomplete")).toBe(
      "new-password",
    );
  });
});

describe("LoginPopup - wersja angielska i odrzucenia spoza klasy Error", () => {
  it("nagłówek, opis i etykieta przycisku biorą warianty EN", async () => {
    // Wariant EN żyje w OSOBNYCH kolumnach ustawień, nie w słowniku i18n -
    // więc to jedyne miejsce, gdzie da się go sprawdzić.
    h.lang = "en";
    h.settings = settingsWith({
      popup_heading_en: "Welcome back",
      popup_description_en: "Sign in to bookmark.",
      signin_label_en: "Sign in",
    });

    await openPopup("signin");

    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText("Sign in to bookmark.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("etykieta rejestracji też ma wariant EN", async () => {
    h.lang = "en";
    h.settings = settingsWith({ signup_label_en: "Create account" });

    await openPopup("signup");

    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByLabelText("authForms.nameLabel")).toBeTruthy();
  });

  it("odrzucenie zapory NIE będące `Error` nie wywala formularza", async () => {
    // Server fn potrafi odrzucić surowym obiektem; `guardErr.message` byłoby
    // wtedy `undefined` i mapowanie komunikatu musi to przeżyć.
    h.guard.mockRejectedValue({ code: "boom" });

    await openPopup("signin");
    fillCredentials();
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});
