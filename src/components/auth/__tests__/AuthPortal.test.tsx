// AuthPortal: JEDYNY komponent, który obsługuje /login oraz
// /membership-registration - logowanie, rejestrację i reset hasła w jednym
// formularzu przełączanym stanem `mode`. Do 2026-08-18 pokrycie tego pliku
// wynosiło 0,4%, mimo że to jedyna brama wejścia do konta na całej
// powierzchni publicznej (guard brute-force, MFA step-up, metadane
// rejestracji trafiające do triggera `handle_new_user`).
//
// Konwencje jak w Paywall.test.tsx: `h = vi.hoisted(...)` na cały stan
// mutowalny mocków, RouterLinkStub zamiast routera, PRAWDZIWA instancja
// i18next (AuthPortal rejestruje własny słownik jako side effect importu).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { AUTH_DEFAULTS } from "@/lib/authSettings";
import { buildSignupMetadata } from "@/lib/auth/registrationFields";

const h = vi.hoisted(() => ({
  authState: { session: null, loading: false } as { session: unknown; loading: boolean },
  navigate: vi.fn(),
  theme: "light" as "light" | "dark",
  toggleTheme: vi.fn(),
  settings: {} as any,
  reg: {} as any,
  guard: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPwd: vi.fn(),
  mfaRequired: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mfaOnVerified: null as null | (() => void),
  mfaOnCancel: null as null | (() => void),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
// Token dla useServerFn - realny moduł ciągnie warstwę serwerową, której test
// komponentu nie potrzebuje.
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.authState }));
vi.mock("@/hooks/useAuthSettings", () => ({ useAuthSettings: () => h.settings }));
// Logo (renderowane w rail) czyta branding przez ten hook - realna wersja
// odpala react-query + supabase.from(), niepotrzebne tu i asynchroniczne
// (źródło ostrzeżeń act() niezwiązanych z żadną akcją w teście).
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (_key: string, defaults: unknown) => defaults,
}));
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: h.toggleTheme }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => h.signIn(...a),
      signUp: (...a: unknown[]) => h.signUp(...a),
      resetPasswordForEmail: (...a: unknown[]) => h.resetPwd(...a),
    },
  },
}));
vi.mock("@/lib/auth/mfa", () => ({ isMfaChallengeRequired: () => h.mfaRequired() }));
vi.mock("@/lib/auth/registrationFields", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/registrationFields")>()),
  useRegistrationFields: () => h.reg,
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/auth/MfaChallenge", () => ({
  MfaChallenge: (props: { open: boolean; onVerified: () => void; onCancel: () => void }) => {
    h.mfaOnVerified = props.onVerified;
    h.mfaOnCancel = props.onCancel;
    return props.open ? <div data-testid="mfa-challenge-stub" /> : null;
  },
}));

import { AuthPortal } from "@/components/auth/AuthPortal";

const t = (key: string) => i18n.t(key);

// Etykieta z fixture reg.label() bywa prefiksem innego, niezwiązanego
// aria-label (np. przycisk "Pokaż hasło" zawiera "hasło" jako podciąg tekstu
// etykiety "Hasło *") - kotwiczymy dopasowanie na początku stringa.
function startsWith(text: string): RegExp {
  return new RegExp(`^${text}`);
}

function makeReg() {
  const visible = [
    { key: "email", enabled: true, required: true },
    { key: "password", enabled: true, required: true },
    { key: "password_confirm", enabled: true, required: true },
    { key: "first_name", enabled: true, required: true },
    { key: "last_name", enabled: true, required: false },
  ] as Array<{ key: string; enabled: boolean; required: boolean }>;
  const get = (key: string) => visible.find((f) => f.key === key);
  return {
    fields: visible,
    visible,
    get,
    isEnabled: (key: string) => get(key)?.enabled === true,
    isRequired: (key: string) => get(key)?.required === true,
    label: (key: string, fallback?: string) => fallback ?? key,
    placeholder: () => "",
  };
}

function renderPortal() {
  return render(<AuthPortal />);
}

// `submit()` w AuthPortal jest async (guard -> supabase -> ewentualny MFA) i ma
// więcej niż jeden hop mikrozadań po zdarzeniu submit - opakowanie w
// `act(async () => fireEvent.submit(...))` kończy się, gdy synchroniczna
// część handlera dobiegnie końca, więc PÓŹNIEJSZE aktualizacje stanu (catch,
// toast, setBusy(false)) i tak lądują poza tym act() i sypią ostrzeżeniem.
// `fireEvent` już opakowuje własną (synchroniczną) część w act(); resztę
// wchłania kolejny `await waitFor(...)` w każdym teście.
function submitForm(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

function switchTo(label: string) {
  fireEvent.click(screen.getAllByRole("button", { name: label })[0]);
}

function fillSignin(email = "reader@example.com", password = "haslo1234") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText(t("authPortal.passwordPlaceholder")), {
    target: { value: password },
  });
}

// FieldBox dopisuje " *" do etykiety wymaganego pola (patrz ui/field-box.tsx),
// więc etykiety z fixture reg.label() ("email", "first_name"...) trzeba
// dopasowywać częściowo (exact: false), nie w formie dokładnego stringa.
/** `opts.firstName === null` pozostawia pole puste (test walidacji). */
function fillSignup(
  opts: { firstName?: string | null; password?: string; confirm?: string; email?: string } = {},
) {
  fireEvent.change(screen.getByLabelText(startsWith("email")), {
    target: { value: opts.email ?? "reader@example.com" },
  });
  const [pw, pwConfirm] = screen.getAllByLabelText(startsWith(t("authPortal.password")));
  fireEvent.change(pw, { target: { value: opts.password ?? "s3cret123" } });
  fireEvent.change(pwConfirm, { target: { value: opts.confirm ?? opts.password ?? "s3cret123" } });
  if (opts.firstName !== null) {
    fireEvent.change(screen.getByLabelText(startsWith("first_name")), {
      target: { value: opts.firstName ?? "Anna" },
    });
  }
  fireEvent.change(screen.getByLabelText(startsWith("last_name")), {
    target: { value: "Kowalska" },
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.authState = { session: null, loading: false };
  h.navigate.mockClear();
  h.theme = "light";
  h.toggleTheme.mockClear();
  h.settings = { ...AUTH_DEFAULTS };
  h.reg = makeReg();
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.resetPwd.mockReset().mockResolvedValue({ error: null });
  h.mfaRequired.mockReset().mockResolvedValue(false);
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.mfaOnVerified = null;
  h.mfaOnCancel = null;
});

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("AuthPortal - przełączanie trybu", () => {
  it("domyślnie renderuje pola logowania (e-mail + hasło, bez potwierdzenia)", () => {
    const { container } = renderPortal();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t("authPortal.passwordPlaceholder"))).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it("rail/tab rejestracji przełącza na pola z reg.visible", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));
    expect(screen.getByLabelText(startsWith("email"))).toBeInTheDocument();
    expect(screen.getByLabelText(startsWith("first_name"))).toBeInTheDocument();
    expect(screen.getByLabelText(startsWith("last_name"))).toBeInTheDocument();
    expect(screen.getAllByLabelText(startsWith(t("authPortal.password")))).toHaveLength(2);
  });

  it("rail/tab resetu pokazuje tylko e-mail i podpowiedź, bez pola hasła", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    expect(screen.getByText(t("authPortal.resetSub"))).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("rail rejestracji -> rail logowania wraca do pól logowania", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    switchTo(t("authPortal.signin"));
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });
});

describe("AuthPortal - układ", () => {
  it("login_position 'center' chowa ilustrację hero", () => {
    h.settings.login_position = "center";
    renderPortal();
    expect(screen.queryByText(AUTH_DEFAULTS.hero_title_pl)).not.toBeInTheDocument();
  });

  it("login_position 'left' pokazuje ilustrację hero", () => {
    h.settings.login_position = "left";
    renderPortal();
    expect(screen.getByText(AUTH_DEFAULTS.hero_title_pl)).toBeInTheDocument();
  });

  it("login_position 'right' (domyślny) pokazuje ilustrację hero", () => {
    h.settings.login_position = "right";
    renderPortal();
    expect(screen.getByText(AUTH_DEFAULTS.hero_title_pl)).toBeInTheDocument();
  });
});

describe("AuthPortal - link powrotu na stronę", () => {
  it("show_back_to_home=false chowa link", () => {
    h.settings.show_back_to_home = false;
    renderPortal();
    expect(screen.queryByText(t("authPortal.backHome"))).not.toBeInTheDocument();
  });

  it("show_back_to_home=true pokazuje link do /", () => {
    h.settings.show_back_to_home = true;
    renderPortal();
    expect(screen.getByText(t("authPortal.backHome"))).toHaveAttribute("href", "/");
  });
});

describe("AuthPortal - przełącznik języka", () => {
  it("show_language_switcher=false chowa przyciski PL/EN", () => {
    h.settings.show_language_switcher = false;
    renderPortal();
    expect(screen.queryByRole("button", { name: "PL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "EN" })).not.toBeInTheDocument();
  });

  it("show_language_switcher=true: klik EN zmienia język interfejsu, klik PL wraca", async () => {
    h.settings.show_language_switcher = true;
    renderPortal();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(i18n.language).toBe("en"));

    fireEvent.click(screen.getByRole("button", { name: "PL" }));
    await waitFor(() => expect(i18n.language).toBe("pl"));
  });
});

describe("AuthPortal - stylizacja tła strony", () => {
  it("login_bg_color/login_bg_url z ustawień trafiają do stylu inline kontenera", () => {
    h.settings.login_bg_color = "#123456";
    h.settings.login_bg_url = "https://cdn.example.com/bg.jpg";
    const { container } = renderPortal();
    const root = container.firstChild as HTMLElement;
    expect(root.style.backgroundColor).toBe("#123456");
    expect(root.style.backgroundImage).toContain("https://cdn.example.com/bg.jpg");
  });

  it("puste ustawienia tła nie dodają żadnego inline stylu", () => {
    const { container } = renderPortal();
    const root = container.firstChild as HTMLElement;
    expect(root.style.backgroundColor).toBe("");
    expect(root.style.backgroundImage).toBe("");
  });
});

describe("AuthPortal - nawigacja pomocnicza między trybami", () => {
  function mobileTabsScope() {
    return within(document.querySelector("main") as HTMLElement);
  }

  it("zakładki mobilne (osobne od szynki desktopowej) też przełączają tryb", () => {
    const { container } = renderPortal();
    // Pierwsze dopasowanie w <main> to zawsze wiersz zakładek mobilnych -
    // podpowiedź "Zarejestruj się" (signUpLink) w trybie signin renderuje się
    // NIŻEJ, w tym samym <main>, z tą samą etykietą.
    fireEvent.click(mobileTabsScope().getAllByRole("button", { name: t("authPortal.signup") })[0]);
    expect(screen.getByLabelText(startsWith("first_name"))).toBeInTheDocument();
    fireEvent.click(mobileTabsScope().getAllByRole("button", { name: t("authPortal.reset") })[0]);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("podpowiedź pod formularzem logowania przełącza na rejestrację", () => {
    renderPortal();
    fireEvent.click(
      mobileTabsScope().getAllByRole("button", { name: t("authPortal.signUpLink") })[1],
    );
    expect(screen.getByLabelText(startsWith("first_name"))).toBeInTheDocument();
  });

  it("podpowiedź pod formularzem rejestracji przełącza z powrotem na logowanie", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fireEvent.click(
      mobileTabsScope().getAllByRole("button", { name: t("authPortal.signInLink") })[1],
    );
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it("odnośnik powrotu z resetu prowadzi z powrotem do logowania", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("authPortal.back")) }));
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
  });

  it("'zapomniałeś hasła' przy logowaniu przełącza na reset", () => {
    const { container } = renderPortal();
    fireEvent.click(screen.getByRole("button", { name: t("authPortal.forgot") }));
    expect(screen.getByText(t("authPortal.resetSub"))).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("przełącznik pokaż/ukryj hasło (logowanie) zmienia typ pola i aria-label", () => {
    renderPortal();
    const input = screen.getByPlaceholderText(t("authPortal.passwordPlaceholder"));
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: t("authPortal.showPw") }));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: t("authPortal.hidePw") }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("przełącznik pokaż/ukryj hasło (rejestracja) działa na głównym polu hasła", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));
    const [pw] = screen.getAllByLabelText(startsWith(t("authPortal.password")));
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: t("authPortal.showPw") }));
    expect(pw).toHaveAttribute("type", "text");
  });
});

describe("AuthPortal - przełącznik trybu (jasny/ciemny)", () => {
  it("klik przełącznika wywołuje toggleTheme", () => {
    renderPortal();
    fireEvent.click(screen.getByRole("button", { name: t("common.preview.darkMode") }));
    expect(h.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("theme='dark': etykieta przełącznika proponuje jasny motyw", () => {
    h.theme = "dark";
    renderPortal();
    expect(screen.getByRole("button", { name: t("common.preview.lightMode") })).toBeInTheDocument();
  });
});

describe("AuthPortal - przekierowanie po zalogowaniu", () => {
  it("sesja + loading=false -> navigate({ to: '/' })", () => {
    h.authState = { session: { user: { id: "u1" } }, loading: false };
    renderPortal();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("loading=true nie wywołuje navigate mimo obecnej sesji", () => {
    h.authState = { session: { user: { id: "u1" } }, loading: true };
    renderPortal();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("AuthPortal - logowanie", () => {
  it("happy path: sukces bez MFA daje toast i realne dane w signIn", async () => {
    const { container } = renderPortal();
    fillSignin("user@example.com", "haslo1234");
    submitForm(container);

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(t("authPortal.toasts.signedIn")),
    );
    expect(h.signIn).toHaveBeenCalledWith({ email: "user@example.com", password: "haslo1234" });
  });

  it("wymagane MFA: pokazuje wyzwanie i dopiero po weryfikacji daje toast sukcesu", async () => {
    h.mfaRequired.mockResolvedValue(true);
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    expect(await screen.findByTestId("mfa-challenge-stub")).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();

    act(() => h.mfaOnVerified?.());
    expect(h.toastSuccess).toHaveBeenCalledWith(t("authPortal.toasts.signedIn"));
  });

  it("wymagane MFA, anulowane: żadnego toastu sukcesu, wyzwanie się zamyka", async () => {
    h.mfaRequired.mockResolvedValue(true);
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    expect(await screen.findByTestId("mfa-challenge-stub")).toBeInTheDocument();
    act(() => h.mfaOnCancel?.());
    expect(screen.queryByTestId("mfa-challenge-stub")).not.toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("guard: rate_limited daje przetłumaczony toast, signIn nie jest wywołany", async () => {
    h.guard.mockRejectedValue(new Error("auth: rate_limited"));
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("authPortal.errors.rateLimited")),
    );
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("guard: invalid_input daje przetłumaczony toast, signIn nie jest wywołany", async () => {
    h.guard.mockRejectedValue(new Error("auth: invalid_input:email"));
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("authPortal.errors.invalidInput")),
    );
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("guard: nieznany błąd przechodzi bez zmian, toast pokazuje oryginalny komunikat", async () => {
    h.guard.mockRejectedValue(new Error("boom-unexpected"));
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom-unexpected"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("odrzucenie wartością inną niż Error: toast z domyślnym tekstem 'Error'", async () => {
    h.guard.mockRejectedValue("not-an-error-instance");
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
  });

  it("supabase: signIn zwraca error -> toast z jego komunikatem, bez navigate", async () => {
    h.signIn.mockResolvedValue({ error: new Error("bad credentials") });
    const { container } = renderPortal();
    fillSignin();
    submitForm(container);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("bad credentials"));
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("AuthPortal - rejestracja", () => {
  it("wyłączona rejestracja: toast signupDisabled, signUp nie jest wywołany", async () => {
    h.settings.allow_public_signup = false;
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup();
    submitForm(container);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("authPortal.errors.signupDisabled")),
    );
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("brak wymaganego pola: toast missingFields, signUp nie jest wywołany", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup({ firstName: null });
    submitForm(container);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("authPortal.errors.missingFields")),
    );
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("niezgodne hasła: toast passwordMismatch, signUp nie jest wywołany", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup({ password: "haslo1234", confirm: "inne-haslo" });
    submitForm(container);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(t("authPortal.errors.passwordMismatch")),
    );
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("supabase: signUp zwraca error -> toast z jego komunikatem, bez toastu sukcesu", async () => {
    h.signUp.mockResolvedValue({ error: new Error("email already registered") });
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup();
    submitForm(container);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("email already registered"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("happy path: signUp dostaje metadane z REALNEGO buildSignupMetadata", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup({ email: "reader@example.com", password: "s3cret123", firstName: "Anna" });
    submitForm(container);

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(t("authPortal.toasts.accountCreated")),
    );
    const expectedMetadata = buildSignupMetadata(
      {
        email: "reader@example.com",
        firstName: "Anna",
        lastName: "Kowalska",
        job: "",
        company: "",
        linkedin: "",
        phone: "",
      },
      { lang: "pl", source: "auth_page" },
    );
    expect(h.signUp).toHaveBeenCalledWith({
      email: "reader@example.com",
      password: "s3cret123",
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: expectedMetadata,
      },
    });
  });

  it("emailRedirectTo używa wewnętrznego redirectu z ustawień, gdy skonfigurowany", async () => {
    h.settings.logged_in_redirect_url = "/witaj";
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fillSignup();
    submitForm(container);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      `${window.location.origin}/witaj`,
    );
  });
});

describe("AuthPortal - reset hasła", () => {
  it("happy path: resetPasswordForEmail z redirectTo, toast i powrót do logowania", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "reader@example.com" } });
    submitForm(container);

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(t("authPortal.toasts.resetSent")),
    );
    expect(h.resetPwd).toHaveBeenCalledWith("reader@example.com", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Powrót do "signin": pole hasła jest znowu widoczne.
    await waitFor(() =>
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1),
    );
  });

  it("błąd resetu: toast z komunikatem, tryb pozostaje na reset", async () => {
    h.resetPwd.mockResolvedValue({ error: new Error("boom") });
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "reader@example.com" } });
    submitForm(container);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom"));
    expect(screen.getByText(t("authPortal.resetSub"))).toBeInTheDocument();
  });
});

// ============================================================================
// DOBICIE GAŁĘZI - kontrakt pojedynczego pola rejestracji
// ----------------------------------------------------------------------------
// Fixture `makeReg()` wyżej wystawia tylko e-mail, hasła i imię/nazwisko, więc
// łańcuchy ternary wybierające `type` i `autoComplete` dla POZOSTAŁYCH pól
// (telefon, LinkedIn, firma, stanowisko) nigdy nie były wykonane. To nie
// kosmetyka:
//   * `type="tel"` na numerze telefonu decyduje o tym, czy telefon pokaże
//     klawiaturę numeryczną - przy `type="text"` użytkownik mobilny wstukuje
//     numer na klawiaturze QWERTY;
//   * `autoComplete` (given-name / family-name / organization /
//     organization-title / tel) decyduje o tym, czy menedżer haseł i
//     autouzupełnianie przeglądarki umieją wypełnić formularz jednym
//     kliknięciem. Zły token to ręczne przepisywanie ośmiu pól, a w formularzu
//     rejestracji przekłada się to wprost na porzucenie rejestracji.
// Dlatego asercja idzie po KONTRAKCIE KAŻDEGO POLA, a nie po jednym przykładzie.
// Klucze pochodzą z POPUP_FIELD_KEYS (`@/lib/newsletter/popupFields`) - to
// prawdziwy, zamknięty rejestr pól rejestracji, nie wymyślone nazwy.

/** Pełny rejestr pól rejestracji - wszystkie prawdziwe klucze włączone. */
function makeWideReg() {
  const visible: Array<{ key: string; enabled: boolean; required: boolean }> = [
    { key: "email", enabled: true, required: true },
    { key: "password", enabled: true, required: true },
    { key: "password_confirm", enabled: true, required: true },
    { key: "first_name", enabled: true, required: true },
    { key: "last_name", enabled: true, required: false },
    { key: "job", enabled: true, required: false },
    { key: "company", enabled: true, required: false },
    { key: "phone", enabled: true, required: false },
    { key: "linkedin", enabled: true, required: false },
    // Te dwa klucze siatka rejestracji ODFILTROWUJE (lista newslettera i zgoda
    // marketingowa nie są polami tekstowymi) - trzymamy je w fixture właśnie,
    // żeby dowieść, że filtr działa.
    { key: "list", enabled: true, required: false },
    { key: "newsletter_optin", enabled: true, required: false },
  ];
  const get = (key: string) => visible.find((f) => f.key === key);
  return {
    fields: visible,
    visible,
    get,
    isEnabled: (key: string) => get(key)?.enabled === true,
    isRequired: (key: string) => get(key)?.required === true,
    label: (key: string, fallback?: string) => fallback ?? key,
    placeholder: () => "",
  };
}

/** Pole rejestracji po etykiecie z fixture (`reg.label` zwraca sam klucz). */
function regInput(key: string): HTMLInputElement {
  return screen.getByLabelText(startsWith(key)) as HTMLInputElement;
}

describe("AuthPortal - kontrakt pól rejestracji (klawiatura i autouzupełnianie)", () => {
  beforeEach(() => {
    h.reg = makeWideReg();
  });

  it("type pola odpowiada treści: tel dla telefonu, url dla LinkedIn, email dla e-maila, text dla reszty", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));

    const expected: Array<[string, string]> = [
      ["email", "email"],
      ["phone", "tel"],
      ["linkedin", "url"],
      ["first_name", "text"],
      ["last_name", "text"],
      ["job", "text"],
      ["company", "text"],
    ];
    for (const [key, type] of expected) {
      expect(regInput(key)).toHaveAttribute("type", type);
    }
    // Oba pola haseł są maskowane, dopóki użytkownik nie kliknie "pokaż".
    for (const pw of screen.getAllByLabelText(startsWith(t("authPortal.password")))) {
      expect(pw).toHaveAttribute("type", "password");
    }
  });

  it("autoComplete pola jest tokenem WHATWG właściwym dla tego pola (spadek: off)", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));

    const expected: Array<[string, string]> = [
      ["email", "email"],
      ["first_name", "given-name"],
      ["last_name", "family-name"],
      ["company", "organization"],
      ["job", "organization-title"],
      ["phone", "tel"],
      // LinkedIn nie ma standardowego tokenu autouzupełniania - łańcuch spada
      // na "off", żeby przeglądarka nie wstrzykiwała tu adresu ani firmy.
      ["linkedin", "off"],
    ];
    for (const [key, token] of expected) {
      expect(regInput(key)).toHaveAttribute("autocomplete", token);
    }
    for (const pw of screen.getAllByLabelText(startsWith(t("authPortal.password")))) {
      expect(pw).toHaveAttribute("autocomplete", "new-password");
    }
  });

  it("pola 'list' i 'newsletter_optin' nie trafiają do siatki jako pola tekstowe", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));
    expect(screen.queryByLabelText(startsWith("list"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(startsWith("newsletter_optin"))).not.toBeInTheDocument();
  });

  it("e-mail i LinkedIn zajmują całą szerokość siatki, krótkie pola po pół", () => {
    renderPortal();
    switchTo(t("authPortal.signup"));
    // Klasa siedzi na kontenerze pola (input-group), nie na samym <input>.
    expect(regInput("email").parentElement).toHaveClass("sm:col-span-2");
    expect(regInput("linkedin").parentElement).toHaveClass("sm:col-span-2");
    expect(regInput("first_name").parentElement).not.toHaveClass("sm:col-span-2");
  });

  it("szerszy zestaw pól trafia do metadanych rejestracji (stanowisko, firma, telefon, LinkedIn)", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.signup"));
    fireEvent.change(regInput("email"), { target: { value: "anna@example.com" } });
    const [pw, pwConfirm] = screen.getAllByLabelText(startsWith(t("authPortal.password")));
    fireEvent.change(pw, { target: { value: "s3cret123" } });
    fireEvent.change(pwConfirm, { target: { value: "s3cret123" } });
    fireEvent.change(regInput("first_name"), { target: { value: "Anna" } });
    fireEvent.change(regInput("last_name"), { target: { value: "Kowalska" } });
    fireEvent.change(regInput("job"), { target: { value: "Analityk" } });
    fireEvent.change(regInput("company"), { target: { value: "NES" } });
    fireEvent.change(regInput("phone"), { target: { value: "+48600000000" } });
    fireEvent.change(regInput("linkedin"), {
      target: { value: "https://linkedin.com/in/anna" },
    });
    submitForm(container);

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.data).toEqual(
      buildSignupMetadata(
        {
          email: "anna@example.com",
          firstName: "Anna",
          lastName: "Kowalska",
          job: "Analityk",
          company: "NES",
          phone: "+48600000000",
          linkedin: "https://linkedin.com/in/anna",
        },
        { lang: "pl", source: "auth_page" },
      ),
    );
  });
});

// ============================================================================
// DOBICIE GAŁĘZI - odnośniki prawne pod formularzem
// ----------------------------------------------------------------------------
// `settings.privacy_url || "/polityka-prywatnosci"` i analogiczny regulamin
// mają ramię FALLBACKU, którego nie dotykał żaden test, bo AUTH_DEFAULTS zawsze
// podaje adres. Tenant, który wyczyści te pola w Admin → Strona logowania,
// dostałby pod formularzem `<a href="">`: klik = przeładowanie tej samej strony
// i utrata wpisanych danych rejestracji, dokładnie w miejscu, w którym prawo
// wymaga DZIAŁAJĄCEGO odnośnika do polityki prywatności i regulaminu.
describe("AuthPortal - odnośniki prawne", () => {
  it("puste privacy_url/terms_url spadają na wbudowane ścieżki, nie na href=''", () => {
    h.settings = { ...AUTH_DEFAULTS, privacy_url: "", terms_url: "" };
    renderPortal();
    const privacy = screen.getByRole("link", { name: t("authPortal.legalPrivacy") });
    const terms = screen.getByRole("link", { name: t("authPortal.legalTerms") });
    expect(privacy).toHaveAttribute("href", "/polityka-prywatnosci");
    expect(terms).toHaveAttribute("href", "/regulamin");
    expect(privacy.getAttribute("href")).not.toBe("");
    expect(terms.getAttribute("href")).not.toBe("");
  });

  it("skonfigurowane adresy z ustawień wygrywają z wbudowanymi ścieżkami", () => {
    h.settings = {
      ...AUTH_DEFAULTS,
      privacy_url: "https://example.org/privacy",
      terms_url: "https://example.org/terms",
    };
    renderPortal();
    expect(screen.getByRole("link", { name: t("authPortal.legalPrivacy") })).toHaveAttribute(
      "href",
      "https://example.org/privacy",
    );
    expect(screen.getByRole("link", { name: t("authPortal.legalTerms") })).toHaveAttribute(
      "href",
      "https://example.org/terms",
    );
  });
});

// ============================================================================
// ŚCIEŻKI ADRESU E-MAIL W TRYBIE RESETU
// ----------------------------------------------------------------------------
// UWAGA: AuthPortal NIE MA magic linka ani OTP (brak `signInWithOtp`, brak
// licznika odstępu między wysyłkami). Tryby to signin / signup / reset, gdzie
// reset wysyła link do zmiany hasła przez `resetPasswordForEmail`. Poniższe
// testy dowodzą tych zachowań na trybie, który w tym komponencie ISTNIEJE.
describe("AuthPortal - adres e-mail przy wysyłce linku resetującego", () => {
  it("adres bez @ nie przechodzi natywnej walidacji - przeglądarka blokuje wysyłkę", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bezmalpy.example.com" } });
    // `type="email"` + `required` to jedyna bramka po stronie klienta; formularz
    // nie da się wysłać, więc do Supabase nie leci śmieciowy adres, a
    // użytkownik widzi natywną podpowiedź przy polu.
    expect(input).toHaveAttribute("type", "email");
    expect(input.validity.typeMismatch).toBe(true);
    expect((container.querySelector("form") as HTMLFormElement).checkValidity()).toBe(false);
  });

  it("puste pole e-maila blokuje wysyłkę jako wymagane", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.validity.valueMissing).toBe(true);
    expect((container.querySelector("form") as HTMLFormElement).checkValidity()).toBe(false);
  });

  it("poprawny adres przechodzi walidację pola", () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "reader@example.com" } });
    expect((container.querySelector("form") as HTMLFormElement).checkValidity()).toBe(true);
  });

  it("adres z wielkimi literami trafia do Supabase w formie wpisanej przez użytkownika", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Reader@Example.COM" } });
    submitForm(container);

    // Stan faktyczny, NIE defekt: klient nie normalizuje wielkości liter i nie
    // musi - Supabase Auth traktuje adresy bez rozróżniania wielkości liter po
    // swojej stronie, więc link resetujący trafia do tego samego konta.
    // Test pilnuje, żeby nikt nie wstawił tu "ulepszenia" w postaci
    // toLowerCase() bez zmiany guardu brute-force, który liczy koszyki po
    // dokładnie tym samym stringu.
    await waitFor(() => expect(h.resetPwd).toHaveBeenCalled());
    expect(h.resetPwd).toHaveBeenCalledWith("Reader@Example.COM", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    expect(h.guard).toHaveBeenCalledWith({
      data: { kind: "reset", email: "Reader@Example.COM" },
    });
  });

  it("ponowna wysyłka linku nie jest blokowana w kliencie, ale każda idzie przez guard", async () => {
    const { container } = renderPortal();
    switchTo(t("authPortal.reset"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "reader@example.com" } });
    submitForm(container);
    // Po sukcesie portal wraca na logowanie - użytkownik, który chce ponowić
    // wysyłkę, wchodzi w reset jeszcze raz (adres pozostaje wpisany).
    await waitFor(() =>
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1),
    );
    switchTo(t("authPortal.reset"));
    submitForm(container);

    // Brak odstępu między wysyłkami po stronie klienta to świadomy podział
    // odpowiedzialności: limit stoi na serwerze (preAuthGuard + limity
    // Supabase), a KAŻDA próba przechodzi przez guard, więc powtarzanie
    // wysyłki nie jest otwartą furtką.
    await waitFor(() => expect(h.resetPwd).toHaveBeenCalledTimes(2));
    expect(h.guard).toHaveBeenCalledTimes(2);
    expect(h.guard.mock.calls.every((c) => c[0].data.kind === "reset")).toBe(true);
  });

  it("przejście signin -> reset -> signup zachowuje wpisany adres e-mail", () => {
    renderPortal();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "reader@example.com" } });
    switchTo(t("authPortal.reset"));
    expect(screen.getByRole("textbox")).toHaveValue("reader@example.com");
    switchTo(t("authPortal.signup"));
    // W rejestracji e-mail to pole z siatki (FieldBox), a nie jedyny textbox.
    expect(screen.getByLabelText(startsWith("email"))).toHaveValue("reader@example.com");
    switchTo(t("authPortal.signin"));
    expect(screen.getByRole("textbox")).toHaveValue("reader@example.com");
  });
});
