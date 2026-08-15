// Regresja widgetów auth (login / register / lost-password / reset-password).
//
// Ten obszar miał cztery klasy błędów, które ten plik przybija na stałe:
//  1. przełączniki czytane idiomem `data.showX !== false` - string "0" jest
//     prawdziwy, więc wyłączenie pola nie działało (każdy toggle jest tu
//     testowany zarówno booleanem `false`, jak i legacy stringiem "0"),
//  2. rozjazd kluczy schemat <-> komponent (showPasswordConfirm vs
//     showConfirmPassword, newsletterOptIn vs showNewsletterOptIn, consentText
//     vs consentLabel) - każdy działa z OBU stron,
//  3. warianty card/flat/inline renderujące się identycznie,
//  4. martwe ustawienia (etykiety, pola rejestracji, OAuth, komunikaty).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
// Widoki auth czytają ustawienia przez react-query (useRegistrationFields ->
// useNewsletterSettings), więc każdy render potrzebuje własnego QueryClienta.
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  guard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInOAuth: vi.fn(),
  resetForEmail: vi.fn(),
  updateUser: vi.fn(),
  session: { current: null as unknown },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.defaultValue === "string" ? opts.defaultValue : key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => h.navigate,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.guard }));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => h.signIn(...args),
      signUp: (...args: unknown[]) => h.signUp(...args),
      signInWithOAuth: (...args: unknown[]) => h.signInOAuth(...args),
      resetPasswordForEmail: (...args: unknown[]) => h.resetForEmail(...args),
      updateUser: (...args: unknown[]) => h.updateUser(...args),
      getSession: async () => ({ data: { session: h.session.current }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import {
  LoginFormView,
  RegisterFormView,
  LostPasswordFormView,
  ResetPasswordFormView,
} from "../AuthFormBlocks";
import { readAuthVariant, readAuthFlag, pickAuthText } from "@/lib/content-model/authFormSettings";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { WIDGETS } from "@/lib/builder/registry";

type Data = Record<string, unknown>;
type Lang = "pl" | "en";

const login = (data: Data = {}, lang: Lang = "pl") =>
  render(<LoginFormView data={data} lang={lang} />);
const register = (data: Data = {}, lang: Lang = "pl") =>
  render(<RegisterFormView data={data} lang={lang} />);
const lost = (data: Data = {}, lang: Lang = "pl") =>
  render(<LostPasswordFormView data={data} lang={lang} />);
const reset = (data: Data = {}, lang: Lang = "pl") =>
  render(<ResetPasswordFormView data={data} lang={lang} />);

const byId = (id: string): HTMLInputElement => {
  const el = document.getElementById(id);
  expect(el, `input #${id}`).toBeTruthy();
  return el as HTMLInputElement;
};
const typeInto = (id: string, value: string) => {
  fireEvent.change(byId(id), { target: { value } });
};
const shell = (): HTMLElement => {
  const el = document.querySelector("section.auth-shell");
  expect(el, "auth shell").toBeTruthy();
  return el as HTMLElement;
};
const form = (): HTMLFormElement => {
  const el = document.querySelector("form");
  expect(el, "form").toBeTruthy();
  return el as HTMLFormElement;
};

beforeEach(() => {
  h.navigate.mockReset();
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.signInOAuth.mockReset().mockResolvedValue({ error: null });
  h.resetForEmail.mockReset().mockResolvedValue({ error: null });
  h.updateUser.mockReset().mockResolvedValue({ error: null });
  h.session.current = { user: { id: "u1" } };
});

afterEach(() => cleanup());

/* ------------------------------------------------------------------ helpers */

describe("koercja ustawień auth (funkcje czyste)", () => {
  it("readAuthFlag rozumie legacy stringi i boolean", () => {
    expect(readAuthFlag({ a: "0" }, ["a"], true)).toBe(false);
    expect(readAuthFlag({ a: "1" }, ["a"], false)).toBe(true);
    expect(readAuthFlag({ a: false }, ["a"], true)).toBe(false);
    expect(readAuthFlag({}, ["a"], true)).toBe(true);
  });

  it("readAuthFlag przechodzi na alias, gdy kanoniczny klucz nie niesie wartości", () => {
    expect(
      readAuthFlag(
        { showConfirmPassword: "1" },
        ["showPasswordConfirm", "showConfirmPassword"],
        false,
      ),
    ).toBe(true);
    // Kanoniczny klucz wygrywa z aliasem.
    expect(
      readAuthFlag(
        { showPasswordConfirm: false, showConfirmPassword: true },
        ["showPasswordConfirm", "showConfirmPassword"],
        true,
      ),
    ).toBe(false);
    // Wartość nierozpoznana nie blokuje aliasu.
    expect(
      readAuthFlag(
        { showPasswordConfirm: {}, showConfirmPassword: "1" },
        ["showPasswordConfirm", "showConfirmPassword"],
        false,
      ),
    ).toBe(true);
  });

  it("readAuthVariant zawęża do wariantów, które renderer umie narysować", () => {
    expect(readAuthVariant("flat")).toBe("flat");
    expect(readAuthVariant("inline")).toBe("inline");
    expect(readAuthVariant("plain")).toBe("flat");
    expect(readAuthVariant("split")).toBe("card");
    expect(readAuthVariant("cokolwiek")).toBe("card");
    expect(readAuthVariant(undefined)).toBe("card");
  });

  it("pickAuthText czyta pierwszy niepusty alias", () => {
    expect(
      pickAuthText({ consentLabel_pl: "stare" }, ["consentText", "consentLabel"], "pl", "f"),
    ).toBe("stare");
    expect(
      pickAuthText(
        { consentText_pl: "nowe", consentLabel_pl: "stare" },
        ["consentText", "consentLabel"],
        "pl",
        "f",
      ),
    ).toBe("nowe");
    expect(pickAuthText({ consentText_pl: "   " }, ["consentText"], "pl", "f")).toBe("f");
  });
});

/* ------------------------------------------------------------------ warianty */

describe("warianty powłoki - każdy renderuje się inaczej", () => {
  it("card ma ramkę, cień i wąską kolumnę", () => {
    login({ variant: "card" });
    const el = shell();
    expect(el.dataset.authVariant).toBe("card");
    expect(el.className).toContain("border");
    expect(el.className).toContain("shadow-sm");
    expect(el.className).toContain("max-w-md");
  });

  it("flat nie ma ramki ani cienia", () => {
    login({ variant: "flat" });
    const el = shell();
    expect(el.dataset.authVariant).toBe("flat");
    expect(el.className).not.toContain("shadow-sm");
    expect(el.className).not.toContain("rounded-xl");
    expect(el.className).toContain("max-w-md");
  });

  it("inline jest kompaktowy, szeroki i układa pola w siatkę", () => {
    login({ variant: "inline" });
    const el = shell();
    expect(el.dataset.authVariant).toBe("inline");
    expect(el.className).toContain("max-w-3xl");
    expect(form().className).toContain("sm:grid-cols-2");
    // Elementy pełnej szerokości dostają span na obie kolumny.
    expect(document.querySelector(".sm\\:col-span-2")).toBeTruthy();
  });

  it("card i flat zachowują układ pionowy (space-y), nie siatkę", () => {
    login({ variant: "card" });
    expect(form().className).toContain("space-y-4");
    expect(form().className).not.toContain("grid-cols");
  });

  it("legacy plain -> flat, legacy split -> card", () => {
    login({ variant: "plain" });
    expect(shell().dataset.authVariant).toBe("flat");
    cleanup();
    login({ variant: "split" });
    expect(shell().dataset.authVariant).toBe("card");
  });

  it("wariant działa w każdym z czterech widgetów", () => {
    register({ variant: "inline" });
    expect(shell().dataset.authVariant).toBe("inline");
    cleanup();
    lost({ variant: "flat" });
    expect(shell().dataset.authVariant).toBe("flat");
    cleanup();
    reset({ variant: "inline" });
    expect(shell().dataset.authVariant).toBe("inline");
  });
});

/* ------------------------------------------------------------------ login */

describe("login-form: przełączniki naprawdę ukrywają pola", () => {
  const rememberVisible = () => screen.queryByText("authForms.remember") !== null;
  const forgotVisible = () => screen.queryByText("authForms.forgot") !== null;
  const registerVisible = () => screen.queryByText("authForms.registerLink") !== null;
  const googleVisible = () => screen.queryByRole("button", { name: "authForms.google" }) !== null;
  const pwToggleVisible = () =>
    screen.queryByRole("button", { name: "authForms.showPassword" }) !== null;

  it("domyślnie pokazuje wszystko", () => {
    login();
    expect(rememberVisible()).toBe(true);
    expect(forgotVisible()).toBe(true);
    expect(registerVisible()).toBe(true);
    expect(googleVisible()).toBe(true);
    expect(pwToggleVisible()).toBe(true);
  });

  for (const off of [false, "0", "nie", 0] as const) {
    it(`ukrywa "zapamiętaj mnie" dla wartości ${JSON.stringify(off)}`, () => {
      login({ showRemember: off });
      expect(rememberVisible()).toBe(false);
    });
  }

  it("ukrywa przycisk pokaż hasło (boolean i legacy string)", () => {
    login({ showShowPassword: false });
    expect(pwToggleVisible()).toBe(false);
    cleanup();
    login({ showShowPassword: "0" });
    expect(pwToggleVisible()).toBe(false);
  });

  it("ukrywa link odzyskiwania hasła (boolean i legacy string)", () => {
    login({ showForgot: false });
    expect(forgotVisible()).toBe(false);
    cleanup();
    login({ showForgot: "0" });
    expect(forgotVisible()).toBe(false);
  });

  it("ukrywa link rejestracji (boolean i legacy string)", () => {
    login({ showRegister: false });
    expect(registerVisible()).toBe(false);
    cleanup();
    login({ showRegister: "0" });
    expect(registerVisible()).toBe(false);
  });

  it("ukrywa logowanie Google (boolean i legacy string)", () => {
    login({ showOAuthGoogle: false });
    expect(googleVisible()).toBe(false);
    cleanup();
    login({ showOAuthGoogle: "0" });
    expect(googleVisible()).toBe(false);
  });

  it("gdy oba elementy wiersza pomocniczego są wyłączone, wiersz znika", () => {
    login({ showRemember: "0", showForgot: "0" });
    expect(rememberVisible()).toBe(false);
    expect(forgotVisible()).toBe(false);
  });

  it("honoruje własne etykiety pól i checkboxa", () => {
    login({
      emailLabel_pl: "Adres służbowy",
      passwordLabel_pl: "Tajne hasło",
      rememberLabel_pl: "Nie wylogowuj mnie",
    });
    expect(screen.getByLabelText("Adres służbowy")).toBeTruthy();
    expect(screen.getByLabelText("Tajne hasło")).toBeTruthy();
    expect(screen.getByText("Nie wylogowuj mnie")).toBeTruthy();
  });

  it("honoruje adresy linków", () => {
    login({ forgotHref: "/odzyskaj", registerHref: "/rejestracja" });
    expect(screen.getByText("authForms.forgot").getAttribute("href")).toBe("/odzyskaj");
    expect(screen.getByText("authForms.registerLink").getAttribute("href")).toBe("/rejestracja");
  });

  it("loguje przez Supabase po poprawnym submicie", async () => {
    login();
    typeInto("auth-email", "a@b.pl");
    typeInto("auth-password", "haslo1234");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signIn).toHaveBeenCalledTimes(1));
    expect(h.signIn).toHaveBeenCalledWith({ email: "a@b.pl", password: "haslo1234" });
    expect(h.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("blokuje submit bez kompletu danych", async () => {
    login();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.required"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("przycisk Google wywołuje OAuth", async () => {
    login();
    fireEvent.click(screen.getByRole("button", { name: "authForms.google" }));
    await waitFor(() => expect(h.signInOAuth).toHaveBeenCalledTimes(1));
  });
});

/* ------------------------------------------------------------------ register */

describe("register-form: konfigurowalny zestaw pól", () => {
  // Widoczność pól bierze się teraz z globalnego rejestru rejestracji
  // (`useRegistrationFields`), a ustawienia widgetu tylko go nadpisują.
  it("domyślnie idzie za globalnym rejestrem pól; powtórka hasła zostaje wyłączona", () => {
    register();
    expect(document.getElementById("reg-first-name")).toBeTruthy();
    expect(document.getElementById("reg-last-name")).toBeTruthy();
    expect(document.getElementById("reg-email")).toBeTruthy();
    expect(document.getElementById("reg-password")).toBeTruthy();
    expect(document.getElementById("reg-phone")).toBeTruthy();
    expect(document.getElementById("reg-company")).toBeTruthy();
    expect(document.getElementById("reg-confirm")).toBeNull();
  });

  it("ustawienie widgetu wygrywa z rejestrem i ukrywa telefon oraz firmę", () => {
    register({ showPhone: false, showCompany: "0" });
    expect(document.getElementById("reg-phone")).toBeNull();
    expect(document.getElementById("reg-company")).toBeNull();
  });

  it("pokazuje telefon i firmę po włączeniu (boolean i legacy string)", () => {
    register({ showPhone: true, showCompany: "1" });
    expect(document.getElementById("reg-phone")).toBeTruthy();
    expect(document.getElementById("reg-company")).toBeTruthy();
  });

  it("ukrywa imię i nazwisko po wyłączeniu (także legacy string '0')", () => {
    register({ showFirstName: "0", showLastName: false });
    expect(document.getElementById("reg-first-name")).toBeNull();
    expect(document.getElementById("reg-last-name")).toBeNull();
    // E-mail jest strukturalny - zostaje.
    expect(document.getElementById("reg-email")).toBeTruthy();
  });

  it("respektuje legacy klucz showName dla imienia i nazwiska", () => {
    register({ showName: "0" });
    expect(document.getElementById("reg-first-name")).toBeNull();
    expect(document.getElementById("reg-last-name")).toBeNull();
  });

  it("przełącznik require steruje atrybutem required", () => {
    register({ showPhone: true, requirePhone: true, requireFirstName: "0" });
    expect(byId("reg-phone").required).toBe(true);
    expect(byId("reg-first-name").required).toBe(false);
  });

  it("etykiety pól pochodzą z ustawień, z fallbackiem na tłumaczenia", () => {
    register(
      {
        showPhone: true,
        firstNameLabel_pl: "Twoje imię",
        phoneLabel_pl: "Numer kontaktowy",
      },
      "pl",
    );
    expect(screen.getByLabelText("Twoje imię")).toBeTruthy();
    expect(screen.getByLabelText("Numer kontaktowy")).toBeTruthy();
    // Fallback: klucz tłumaczenia nie istnieje w mocku, więc wchodzi defaultValue.
    expect(screen.getByLabelText("Nazwisko")).toBeTruthy();
  });

  it("etykiety fallback są dwujęzyczne", () => {
    register({ showCompany: true }, "en");
    expect(screen.getByLabelText("Last name")).toBeTruthy();
    expect(screen.getByLabelText("Company")).toBeTruthy();
  });
});

describe("register-form: rozjazdy kluczy działają z obu stron", () => {
  it("showPasswordConfirm (nowy klucz) pokazuje powtórkę hasła", () => {
    register({ showPasswordConfirm: true });
    expect(document.getElementById("reg-confirm")).toBeTruthy();
  });

  it("showConfirmPassword (stary klucz) nadal pokazuje powtórkę hasła", () => {
    register({ showConfirmPassword: true });
    expect(document.getElementById("reg-confirm")).toBeTruthy();
  });

  it("legacy string '1' w starym kluczu też działa", () => {
    register({ showConfirmPassword: "1" });
    expect(document.getElementById("reg-confirm")).toBeTruthy();
  });

  it("newsletterOptIn (schemat) i showNewsletterOptIn (komponent) sterują tym samym", () => {
    register({ newsletterOptIn: "0" });
    expect(screen.queryByText("authForms.newsletterOptIn")).toBeNull();
    cleanup();
    register({ showNewsletterOptIn: false });
    expect(screen.queryByText("authForms.newsletterOptIn")).toBeNull();
    cleanup();
    register({});
    expect(screen.queryByText("authForms.newsletterOptIn")).not.toBeNull();
  });

  it("newsletterLabel z ustawień zastępuje tłumaczenie", () => {
    register({ newsletterLabel_pl: "Chcę biuletyn co piątek" });
    expect(screen.getByText("Chcę biuletyn co piątek")).toBeTruthy();
    expect(screen.queryByText("authForms.newsletterOptIn")).toBeNull();
  });

  it("consentText (schemat) renderuje własną treść RODO, z linkami markdown", () => {
    register({
      consentText_pl: "Zgoda wg [Polityki prywatności](/polityka).",
    });
    expect(screen.getByText("Polityki prywatności").getAttribute("href")).toBe("/polityka");
    expect(screen.queryByText("authForms.consentDefault")).toBeNull();
  });

  it("consentLabel (stary klucz) nadal działa jako fallback", () => {
    register({ consentLabel_pl: "Stara zgoda" });
    expect(screen.getByText("Stara zgoda")).toBeTruthy();
  });

  it("requireConsent wyłącza wiersz zgody (boolean i legacy string)", () => {
    register({ requireConsent: false });
    expect(screen.queryByText("authForms.consentDefault")).toBeNull();
    cleanup();
    register({ requireConsent: "0" });
    expect(screen.queryByText("authForms.consentDefault")).toBeNull();
  });

  it("odrzuca niebezpieczny schemat w linku zgody", () => {
    register({ consentText_pl: "Zgoda [tutaj](javascript:alert(1))." });
    expect(screen.getByText(/Zgoda/).querySelector("a")).toBeNull();
  });
});

describe("register-form: OAuth Google", () => {
  it("domyślnie renderuje przycisk Google, spójnie z logowaniem", () => {
    register();
    expect(screen.getByRole("button", { name: "authForms.google" })).toBeTruthy();
  });

  it("wyłączenie ukrywa przycisk (boolean i legacy string)", () => {
    register({ showOAuthGoogle: false });
    expect(screen.queryByRole("button", { name: "authForms.google" })).toBeNull();
    cleanup();
    register({ showOAuthGoogle: "0" });
    expect(screen.queryByRole("button", { name: "authForms.google" })).toBeNull();
  });

  it("klik wywołuje signInWithOAuth", async () => {
    register();
    fireEvent.click(screen.getByRole("button", { name: "authForms.google" }));
    await waitFor(() => expect(h.signInOAuth).toHaveBeenCalledTimes(1));
  });
});

describe("register-form: walidacja i payload", () => {
  const fillMinimal = () => {
    typeInto("reg-first-name", "Jan");
    typeInto("reg-last-name", "Kowalski");
    typeInto("reg-email", "jan@example.com");
    typeInto("reg-password", "haslo12345");
  };

  it("blokuje submit przy pustym wymaganym polu", async () => {
    register({ requireFirstName: true });
    typeInto("reg-email", "jan@example.com");
    typeInto("reg-password", "haslo12345");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.required"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("nie blokuje, gdy pole jest wyłączone jako wymagane", async () => {
    register({ requireFirstName: false, requireLastName: false, requireConsent: false });
    typeInto("reg-email", "jan@example.com");
    typeInto("reg-password", "haslo12345");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
  });

  it("wymaga zgodnej powtórki hasła, gdy pole jest włączone", async () => {
    register({ showPasswordConfirm: true, requireConsent: false });
    fillMinimal();
    typeInto("reg-confirm", "inne-haslo");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.passwordsMismatch"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("wymaga zgody RODO, gdy requireConsent jest włączone", async () => {
    register();
    fillMinimal();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.consentRequired"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("wysyła metadane z realnie skonfigurowanych pól", async () => {
    register({
      showPhone: true,
      showCompany: true,
      requireConsent: false,
      newsletterOptIn: false,
      redirectTo: "/panel",
    });
    fillMinimal();
    typeInto("reg-phone", "+48 600 100 200");
    typeInto("reg-company", "NES");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const payload = h.signUp.mock.calls[0][0] as {
      email: string;
      password: string;
      options: { data: Record<string, unknown> };
    };
    expect(payload.email).toBe("jan@example.com");
    expect(payload.password).toBe("haslo12345");
    expect(payload.options.data.first_name).toBe("Jan");
    expect(payload.options.data.last_name).toBe("Kowalski");
    expect(payload.options.data.full_name).toBe("Jan Kowalski");
    expect(payload.options.data.phone).toBe("+48 600 100 200");
    expect(payload.options.data.company).toBe("NES");
    expect(payload.options.data.signup_type).toBe("reader");
    expect(h.navigate).toHaveBeenCalledWith({ to: "/panel" });
  });

  it("nie wysyła telefonu ani firmy, gdy pola są wyłączone", async () => {
    register({ requireConsent: false });
    fillMinimal();
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const data = (h.signUp.mock.calls[0][0] as { options: { data: Record<string, unknown> } })
      .options.data;
    expect(data.phone).toBeUndefined();
    expect(data.company).toBeUndefined();
    expect(data.custom_fields).toBeUndefined();
  });
});

describe("register-form: pola dodatkowe (customFields)", () => {
  const customFields = [
    '{"id":"branza","type":"select","labelPl":"Branża","required":true,"options":[{"value":"fintech","labelPl":"Fintech"}]}',
    '{"id":"notatka","type":"textarea","labelPl":"Notatka"}',
    '{"id":"nip","type":"text","labelPl":"NIP"}',
  ];

  it("renderuje pola z konfiguracji", () => {
    register({ customFields });
    expect(screen.getByLabelText("Branża")).toBeTruthy();
    expect(screen.getByLabelText("Notatka")).toBeTruthy();
    expect(screen.getByLabelText("NIP")).toBeTruthy();
  });

  it("waliduje pola wymagane i blokuje wysyłkę", async () => {
    register({ customFields, requireConsent: false });
    typeInto("reg-first-name", "Jan");
    typeInto("reg-last-name", "Kowalski");
    typeInto("reg-email", "jan@example.com");
    typeInto("reg-password", "haslo12345");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.required"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("dokłada wypełnione wartości do metadanych konta", async () => {
    register({ customFields, requireConsent: false });
    typeInto("reg-first-name", "Jan");
    typeInto("reg-last-name", "Kowalski");
    typeInto("reg-email", "jan@example.com");
    typeInto("reg-password", "haslo12345");
    fireEvent.change(document.getElementById("custom_branza") as HTMLSelectElement, {
      target: { value: "fintech" },
    });
    fireEvent.change(document.getElementById("custom_nip") as HTMLInputElement, {
      target: { value: "1234567890" },
    });
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const data = (h.signUp.mock.calls[0][0] as { options: { data: Record<string, unknown> } })
      .options.data;
    expect(data.custom_fields).toEqual({ branza: "fintech", nip: "1234567890" });
  });
});

/* ------------------------------------------------------------------ lost password */

describe("lost-password-form: martwe ustawienia ożyły", () => {
  it("honoruje własną etykietę e-maila", () => {
    lost({ emailLabel_pl: "Adres do kontaktu" });
    expect(screen.getByLabelText("Adres do kontaktu")).toBeTruthy();
  });

  it("po wysłaniu pokazuje własny komunikat sukcesu", async () => {
    lost({ successText_pl: "Sprawdź skrzynkę firmową." });
    typeInto("lost-email", "a@b.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Sprawdź skrzynkę firmową.")).toBeTruthy());
    expect(screen.queryByText("authForms.resetSuccess")).toBeNull();
  });

  it("bez własnego komunikatu wraca do tłumaczenia", async () => {
    lost();
    typeInto("lost-email", "a@b.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("authForms.resetSuccess")).toBeTruthy());
  });

  it("honoruje adres powrotu do logowania", () => {
    lost({ loginHref: "/wejscie" });
    expect(screen.getByText("authForms.backToSignin").getAttribute("href")).toBe("/wejscie");
  });
});

/* ------------------------------------------------------------------ reset password */

describe("reset-password-form: przełączniki i komunikaty", () => {
  const waitReady = () =>
    waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());

  it("domyślnie pokazuje powtórkę hasła", async () => {
    reset();
    await waitReady();
    expect(document.getElementById("rs-confirm")).toBeTruthy();
  });

  it("showPasswordConfirm '0' realnie ukrywa powtórkę (legacy string)", async () => {
    reset({ showPasswordConfirm: "0" });
    await waitReady();
    expect(document.getElementById("rs-confirm")).toBeNull();
  });

  it("stary klucz showConfirmPassword nadal ukrywa powtórkę", async () => {
    reset({ showConfirmPassword: false });
    await waitReady();
    expect(document.getElementById("rs-confirm")).toBeNull();
  });

  it("requirePasswordConfirm steruje atrybutem required", async () => {
    reset({ requirePasswordConfirm: "0" });
    await waitReady();
    expect(byId("rs-confirm").required).toBe(false);
  });

  it("honoruje własne etykiety hasła i powtórki", async () => {
    reset({ passwordLabel_pl: "Nowy klucz", passwordConfirmLabel_pl: "Powtórz klucz" });
    await waitReady();
    expect(screen.getByLabelText("Nowy klucz")).toBeTruthy();
    expect(screen.getByLabelText("Powtórz klucz")).toBeTruthy();
  });

  it("ukrywa przycisk pokaż hasło po wyłączeniu", async () => {
    reset({ showShowPassword: "0" });
    await waitReady();
    expect(screen.queryByRole("button", { name: "authForms.showPassword" })).toBeNull();
  });

  it("egzekwuje minimalną długość hasła z ustawień", async () => {
    reset({ minLength: 12 });
    await waitReady();
    typeInto("rs-password", "krotkie11");
    typeInto("rs-confirm", "krotkie11");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("authForms.tooShort"));
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("pokazuje własny komunikat po zapisaniu hasła", async () => {
    reset({ successText_pl: "Hasło zmienione, zaloguj się ponownie." });
    await waitReady();
    typeInto("rs-password", "haslo123456");
    typeInto("rs-confirm", "haslo123456");
    fireEvent.submit(form());
    await waitFor(() => expect(h.updateUser).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Hasło zmienione, zaloguj się ponownie.")).toBeTruthy();
  });

  it("bez sesji odzyskiwania pokazuje komunikat o braku tokenu", async () => {
    h.session.current = null;
    reset();
    await waitFor(() => expect(screen.getByText("authForms.noToken")).toBeTruthy());
    expect(document.getElementById("rs-password")).toBeNull();
  });
});

/* ------------------------------------------------------------------ kontrakt schematu */

describe("kontrakt schemat <-> komponent", () => {
  const AUTH_TYPES = [
    "login-form",
    "register-form",
    "lost-password-form",
    "reset-password-form",
  ] as const;

  it("żaden przełącznik auth nie jest już selectem '0'/'1'", () => {
    for (const type of AUTH_TYPES) {
      const fields = WIDGET_SCHEMAS[type] ?? [];
      const stringToggles = fields.filter(
        (f) =>
          /^(show|require)[A-Z]/.test(f.key) &&
          (f.type !== "bool" || typeof f.default !== "boolean"),
      );
      expect(
        stringToggles.map((f) => f.key),
        `${type} ma nie-boolowskie przełączniki`,
      ).toEqual([]);
    }
  });

  it("schemat oferuje tylko warianty, które renderer umie narysować", () => {
    for (const type of AUTH_TYPES) {
      const variant = (WIDGET_SCHEMAS[type] ?? []).find((f) => f.key === "variant");
      expect(variant, `${type} bez pola variant`).toBeTruthy();
      for (const option of variant?.options ?? []) {
        expect(readAuthVariant(option.value)).toBe(option.value);
      }
    }
  });

  it("kanoniczne klucze rozjazdów są w schemacie", () => {
    const registerKeys = new Set((WIDGET_SCHEMAS["register-form"] ?? []).map((f) => f.key));
    for (const key of [
      "showPasswordConfirm",
      "requirePasswordConfirm",
      "newsletterOptIn",
      "consentText",
      "showFirstName",
      "showLastName",
      "showPhone",
      "showCompany",
      "showOAuthGoogle",
    ]) {
      expect(registerKeys.has(key), `register-form bez ${key}`).toBe(true);
    }
    const resetKeys = new Set((WIDGET_SCHEMAS["reset-password-form"] ?? []).map((f) => f.key));
    expect(resetKeys.has("showPasswordConfirm")).toBe(true);
    expect(resetKeys.has("successText")).toBe(true);
    expect(resetKeys.has("minLength")).toBe(true);
  });

  it("defaulty palety nie zapisują już przełączników jako stringów", () => {
    for (const type of AUTH_TYPES) {
      const widget = WIDGETS.find((w) => w.type === type);
      expect(widget, `brak widgetu ${type}`).toBeTruthy();
      const defaults = widget?.defaults() ?? {};
      for (const [key, value] of Object.entries(defaults)) {
        if (!/^(show|require)[A-Z]/.test(key)) continue;
        expect(typeof value, `${type}.${key} = ${JSON.stringify(value)}`).toBe("boolean");
      }
    }
  });

  it("login-form nie oferuje już martwych pól", () => {
    const keys = new Set((WIDGET_SCHEMAS["login-form"] ?? []).map((f) => f.key));
    // customFields nie miało dokąd trafić przy logowaniu.
    expect(keys.has("customFields")).toBe(false);
    // "Zapamiętaj mnie" to checkbox: bez require/placeholder.
    expect(keys.has("requireRemember")).toBe(false);
    expect(keys.has("rememberPlaceholder")).toBe(false);
    expect(keys.has("rememberLabel")).toBe(true);
  });
});
