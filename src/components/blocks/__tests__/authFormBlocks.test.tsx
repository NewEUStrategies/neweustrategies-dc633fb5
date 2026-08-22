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
  /** Nasłuch zdarzeń auth widgetu ustawiania hasła - test odpala go wprost. */
  authCb: null as null | ((event: string) => void),
  unsubscribe: vi.fn(),
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
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: h.unsubscribe } } };
      },
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
  h.authCb = null;
  h.unsubscribe.mockReset();
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

// ---------------------------------------------------------------------------
// ŚCIEŻKI WYSYŁKI: straż przed nadużyciem (`preAuthGuard`), błędy dostawcy
// uwierzytelnienia, logowanie przez Google, przywracanie hasła.
//
// Do tej pory ten plik dowodził KSZTAŁTU formularzy (przełączniki, etykiety,
// warianty). Zostawało to, co dzieje się po kliknięciu „Zaloguj" - a tam
// mieszkają jedyne komunikaty, które użytkownik naprawdę czyta:
//   * limit prób logowania MUSI się pokazać jako komunikat z tłumaczenia,
//     a nie jako surowy `rate_limited` z warstwy serwerowej,
//   * błąd dostawcy MUSI zejść z formularza jako tekst, nie jako cisza,
//   * podwójne kliknięcie NIE MOŻE wysłać dwóch żądań uwierzytelnienia
//     (druga próba przy aktywnym limicie blokuje konto na dłużej).
// ---------------------------------------------------------------------------

describe("logowanie - straż i błędy", () => {
  const fill = (email = "jan@firma.pl", password = "TajneHaslo1") => {
    typeInto("auth-email", email);
    typeInto("auth-password", password);
  };

  it("PUSTE pola nie wysyłają żądania uwierzytelnienia", async () => {
    login();
    fireEvent.submit(form());
    await waitFor(() => expect(h.signIn).not.toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalled();
  });

  it("BRAK hasła (sam adres) też blokuje wysyłkę", async () => {
    login();
    typeInto("auth-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signIn).not.toHaveBeenCalled());
  });

  it("poprawne dane wołają dostawcę i przekierowują po sukcesie", async () => {
    h.signIn.mockResolvedValue({ error: null });
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith({
        email: "jan@firma.pl",
        password: "TajneHaslo1",
      }),
    );
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("LIMIT prób ze straży pokazuje komunikat z tłumaczenia, nie surowy kod", async () => {
    h.guard.mockRejectedValue(new Error("rate_limited: too many attempts"));
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.rateLimited"));
    // Przy odrzuceniu przez straż dostawca NIE MOŻE zostać wywołany.
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("NIEPOPRAWNE wejście ze straży pokazuje własny komunikat", async () => {
    h.guard.mockRejectedValue(new Error("invalid_input"));
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.invalidInput"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("INNY błąd straży propaguje się jako komunikat tego błędu", async () => {
    h.guard.mockRejectedValue(new Error("awaria sieci"));
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("awaria sieci"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("błąd straży NIE-Error nie gubi komunikatu", async () => {
    h.guard.mockRejectedValue("awaria bez Error");
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("BŁĄD dostawcy pokazuje jego komunikat i NIE przekierowuje", async () => {
    h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Invalid login credentials"));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("straż jest wołana z rodzajem operacji i adresem", async () => {
    h.signIn.mockResolvedValue({ error: null });
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(h.guard).toHaveBeenCalled());
    expect(h.guard).toHaveBeenCalledWith({ data: { kind: "login", email: "jan@firma.pl" } });
  });

  it("w trakcie wysyłki przycisk jest ZABLOKOWANY (bariera przed drugą próbą)", async () => {
    let release: (v: unknown) => void = () => {};
    h.signIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    login();
    fill();
    fireEvent.submit(form());
    await waitFor(() => {
      const submitBtn = document.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(submitBtn?.disabled).toBe(true);
    });
    release({ error: null });
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  });

  it("logowanie przez Google woła dostawcę z adresem powrotu", async () => {
    h.signInOAuth.mockResolvedValue({ error: null });
    login({ showOAuthGoogle: true });
    const google = Array.from(document.querySelectorAll("button")).find((b) =>
      /google/i.test(b.textContent ?? ""),
    );
    expect(google, "przycisk Google").toBeTruthy();
    fireEvent.click(google as HTMLElement);
    await waitFor(() => expect(h.signInOAuth).toHaveBeenCalled());
    expect(h.signInOAuth.mock.calls[0][0].provider).toBe("google");
    expect(String(h.signInOAuth.mock.calls[0][0].options.redirectTo)).toContain("/");
  });

  it("BŁĄD logowania przez Google odblokowuje przycisk i pokazuje komunikat", async () => {
    h.signInOAuth.mockResolvedValue({ error: new Error("popup zamknięty") });
    login({ showOAuthGoogle: true });
    const google = Array.from(document.querySelectorAll("button")).find((b) =>
      /google/i.test(b.textContent ?? ""),
    );
    fireEvent.click(google as HTMLElement);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("popup zamknięty"));
  });

  it("wyłączone logowanie przez Google nie renderuje przycisku", () => {
    login({ showOAuthGoogle: false });
    const google = Array.from(document.querySelectorAll("button")).find((b) =>
      /google/i.test(b.textContent ?? ""),
    );
    expect(google).toBeUndefined();
  });
});

describe("przywracanie hasła - straż i błędy", () => {
  it("PUSTY adres nie wysyła żądania", async () => {
    lost();
    fireEvent.submit(form());
    await waitFor(() => expect(h.resetForEmail).not.toHaveBeenCalled());
  });

  it("poprawny adres wysyła żądanie i pokazuje potwierdzenie", async () => {
    h.resetForEmail.mockResolvedValue({ error: null });
    lost();
    typeInto("lost-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.resetForEmail).toHaveBeenCalled());
    expect(h.resetForEmail.mock.calls[0][0]).toBe("jan@firma.pl");
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });

  it("LIMIT prób pokazuje komunikat z tłumaczenia", async () => {
    h.guard.mockRejectedValue(new Error("rate_limited"));
    lost();
    typeInto("lost-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.rateLimited"));
    expect(h.resetForEmail).not.toHaveBeenCalled();
  });

  it("NIEPOPRAWNE wejście pokazuje własny komunikat", async () => {
    h.guard.mockRejectedValue(new Error("invalid_input"));
    lost();
    typeInto("lost-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("auth.invalidInput"));
  });

  it("BŁĄD dostawcy pokazuje jego komunikat", async () => {
    h.resetForEmail.mockResolvedValue({ error: new Error("nie ma takiego konta") });
    lost();
    typeInto("lost-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("nie ma takiego konta"));
  });

  it("straż jest wołana z rodzajem reset", async () => {
    h.resetForEmail.mockResolvedValue({ error: null });
    lost();
    typeInto("lost-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.guard).toHaveBeenCalled());
    expect(h.guard).toHaveBeenCalledWith({ data: { kind: "reset", email: "jan@firma.pl" } });
  });
});

describe("ustawianie nowego hasła", () => {
  it("hasło KRÓTSZE niż minimum nie jest zapisywane", async () => {
    h.session.current = { user: { id: "u-1" } };
    reset({ minLength: 8 });
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    typeInto("rs-password", "krotkie");
    fireEvent.submit(form());
    await waitFor(() => expect(h.updateUser).not.toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalled();
  });

  it("NIEZGODNE potwierdzenie hasła blokuje zapis", async () => {
    h.session.current = { user: { id: "u-1" } };
    reset({ minLength: 6, showPasswordConfirm: true });
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    typeInto("rs-password", "DobreHaslo1");
    typeInto("rs-confirm", "InneHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.updateUser).not.toHaveBeenCalled());
  });

  it("zgodne hasło o właściwej długości jest zapisywane i przekierowuje", async () => {
    h.session.current = { user: { id: "u-1" } };
    h.updateUser.mockResolvedValue({ error: null });
    reset({ minLength: 6, showPasswordConfirm: true });
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    typeInto("rs-password", "DobreHaslo1");
    typeInto("rs-confirm", "DobreHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.updateUser).toHaveBeenCalledWith({ password: "DobreHaslo1" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  });

  it("BŁĄD zapisu pokazuje komunikat dostawcy i NIE przekierowuje", async () => {
    h.session.current = { user: { id: "u-1" } };
    h.updateUser.mockResolvedValue({ error: new Error("hasło zbyt proste") });
    // Pole potwierdzenia jest domyślnie WŁĄCZONE, więc bez jego wyłączenia
    // walidacja zgodności zatrzymałaby żądanie przed dostawcą.
    reset({ minLength: 6, showPasswordConfirm: false });
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    typeInto("rs-password", "DobreHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("hasło zbyt proste"));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["minimum poniżej zakresu", 1],
    ["minimum powyżej zakresu", 999],
    ["minimum nieliczbowe", "abc"],
  ] as const)("%s jest klampowane do dozwolonego przedziału", async (_l, minLength) => {
    h.session.current = { user: { id: "u-1" } };
    reset({ minLength });
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    expect(document.querySelector("form")).toBeTruthy();
  });
});

describe("rejestracja - walidacja i wysyłka", () => {
  /**
   * Pole potwierdzenia hasła jest domyślnie WYŁĄCZONE w tym formularzu, więc
   * wypełniamy je tylko, gdy faktycznie się wyrenderowało - inaczej test mówi
   * o brakującym polu, a nie o wysyłce.
   */
  const fillBase = () => {
    typeInto("reg-email", "jan@firma.pl");
    typeInto("reg-password", "TajneHaslo1");
    if (document.getElementById("reg-confirm")) typeInto("reg-confirm", "TajneHaslo1");
  };

  it("BEZ hasła nie wysyła żądania rejestracji", async () => {
    register();
    typeInto("reg-email", "jan@firma.pl");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).not.toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalled();
  });

  it("BEZ pola WYMAGANEGO nie wysyła żądania", async () => {
    register();
    typeInto("reg-password", "TajneHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).not.toHaveBeenCalled());
  });

  it("NIEZGODNE potwierdzenie hasła blokuje rejestrację", async () => {
    register({ showPasswordConfirm: true });
    typeInto("reg-email", "jan@firma.pl");
    typeInto("reg-password", "TajneHaslo1");
    typeInto("reg-confirm", "InneHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).not.toHaveBeenCalled());
  });

  it("BRAK wymaganej zgody blokuje rejestrację", async () => {
    register({ requireConsent: true, showPasswordConfirm: false });
    typeInto("reg-email", "jan@firma.pl");
    typeInto("reg-password", "TajneHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).not.toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalled();
  });

  it("poprawne dane wysyłają rejestrację z metadanymi i przekierowują", async () => {
    h.signUp.mockResolvedValue({ error: null });
    register({ requireConsent: false });
    fillBase();
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    const payload = h.signUp.mock.calls[0][0];
    expect(payload.email).toBe("jan@firma.pl");
    expect(payload.password).toBe("TajneHaslo1");
    expect(payload.options.data).toBeTruthy();
    // Znacznik czasu przyjęcia zgody jest dowodem zgodności - musi być zapisany.
    expect(typeof payload.options.data.consent_accepted_at).toBe("string");
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  });

  it("adres jest PRZYCINANY przed wysłaniem", async () => {
    h.signUp.mockResolvedValue({ error: null });
    register({ requireConsent: false });
    typeInto("reg-email", "  jan@firma.pl  ");
    typeInto("reg-password", "TajneHaslo1");
    if (document.getElementById("reg-confirm")) typeInto("reg-confirm", "TajneHaslo1");
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    // Adres z białymi znakami na brzegach to najczęstsza wklejka ze skrzynki -
    // bez przycięcia dostawca zwraca „invalid email" na poprawnym adresie.
    expect(h.signUp.mock.calls[0][0].email).toBe("jan@firma.pl");
  });

  it("BŁĄD rejestracji pokazuje komunikat dostawcy i NIE przekierowuje", async () => {
    h.signUp.mockResolvedValue({ error: new Error("adres już zajęty") });
    register({ requireConsent: false });
    fillBase();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adres już zajęty"));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("błąd rejestracji NIE-Error nie gubi komunikatu", async () => {
    h.signUp.mockRejectedValue("awaria bez Error");
    register({ requireConsent: false });
    fillBase();
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("zapis do newslettera trafia do metadanych", async () => {
    h.signUp.mockResolvedValue({ error: null });
    register({ requireConsent: false, showNewsletterOptIn: true });
    fillBase();
    const optin = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    if (optin.length) fireEvent.click(optin[optin.length - 1]);
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.data).toBeTruthy();
  });

  it("rejestracja przez Google woła dostawcę", async () => {
    h.signInOAuth.mockResolvedValue({ error: null });
    register({ showOAuthGoogle: true });
    const google = Array.from(document.querySelectorAll("button")).find((b) =>
      /google/i.test(b.textContent ?? ""),
    );
    expect(google, "przycisk Google").toBeTruthy();
    fireEvent.click(google as HTMLElement);
    await waitFor(() => expect(h.signInOAuth).toHaveBeenCalled());
  });

  it("BŁĄD rejestracji przez Google pokazuje komunikat", async () => {
    h.signInOAuth.mockResolvedValue({ error: new Error("odmowa dostępu") });
    register({ showOAuthGoogle: true });
    const google = Array.from(document.querySelectorAll("button")).find((b) =>
      /google/i.test(b.textContent ?? ""),
    );
    fireEvent.click(google as HTMLElement);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa dostępu"));
  });

  it("pole DODATKOWE wymagane blokuje rejestrację i pokazuje błąd przy polu", async () => {
    register({
      requireConsent: false,
      customFields: [{ id: "nip", type: "text", labelPl: "NIP", required: true }],
    });
    fillBase();
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).not.toHaveBeenCalled());
  });

  it("wypełnione pole DODATKOWE trafia do metadanych", async () => {
    h.signUp.mockResolvedValue({ error: null });
    register({
      requireConsent: false,
      customFields: [{ id: "nip", type: "text", labelPl: "NIP", required: true }],
    });
    fillBase();
    const nip = document.querySelector('[name="custom_nip"]');
    if (nip) fireEvent.change(nip, { target: { value: "1234567890" } });
    fireEvent.submit(form());
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
  });
});

describe("treść zgody z linkami markdown (formularze auth)", () => {
  it("zamienia [etykieta](adres) na link zewnętrzny z rel", () => {
    register({ requireConsent: true, consentText_pl: "Akceptuję [regulamin](https://x.test/r)." });
    const link = Array.from(document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "https://x.test/r",
    );
    expect(link, "link zgody").toBeTruthy();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each(["/polityka", "mailto:biuro@x.test"])(
    "adres wewnętrzny %s zostaje linkiem BEZ target=_blank",
    (href) => {
      register({ requireConsent: true, consentText_pl: `Zobacz [tu](${href}).` });
      const link = Array.from(document.querySelectorAll("a")).find(
        (a) => a.getAttribute("href") === href,
      );
      expect(link, "link zgody").toBeTruthy();
      expect(link?.getAttribute("target")).toBeNull();
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://x.test"])(
    "adres NIEDOZWOLONY %s traci link, zachowuje tekst",
    (href) => {
      register({ requireConsent: true, consentText_pl: `Zobacz [tu](${href}).` });
      const bad = Array.from(document.querySelectorAll("a")).find((a) =>
        (a.getAttribute("href") ?? "").includes(href.split(":")[0] + ":"),
      );
      expect(bad).toBeUndefined();
      expect(document.body.textContent).toContain("tu");
    },
  );

  it("treść zgody z KILKOMA linkami renderuje każdy", () => {
    register({
      requireConsent: true,
      consentText_pl: "[A](https://a.test) oraz [B](https://b.test) i koniec.",
    });
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://a.test");
    expect(hrefs).toContain("https://b.test");
    expect(document.body.textContent).toContain("i koniec.");
  });

  it("treść zgody BEZ linków renderuje się jako czysty tekst", () => {
    register({ requireConsent: true, consentText_pl: "Zwykła zgoda" });
    expect(document.body.textContent).toContain("Zwykła zgoda");
  });
});

/* ------------------------------------------------------------------ etap 7b */
// DOBICIE GAŁĘZI I FUNKCJI. Cztery grupy rzeczy, których wcześniejsze testy nie
// dotykały, a każda z nich jest widoczna dla człowieka zakładającego konto:
//   * PODTYTUŁ nagłówka - jedyne miejsce, w którym redakcja tłumaczy, po co ten
//     formularz jest; do tej pory żaden test nie renderował go ani razu,
//   * ODSŁONIĘCIE HASŁA - przycisk „pokaż hasło" był renderowany, ale nigdy
//     KLIKNIĘTY, więc nikt nie sprawdził, czy pola faktycznie się odsłaniają
//     (przy wpisywaniu hasła z menedżera to jedyna kontrola literówki),
//   * POLA DODATKOWE w typach innych niż tekst i lista z opcjami,
//   * AWARIE ODRZUCONE WARTOŚCIĄ, KTÓRA NIE JEST `Error` - server fn i klient
//     Supabase potrafią odrzucić napisem albo obiektem; ścieżka „nie-Error"
//     musi nadal pokazać komunikat, a nie zostawić przycisk w bezruchu.

describe("nagłówek widgetu: podtytuł z ustawień", () => {
  it("podtytuł renderuje się pod tytułem w wariancie karty", () => {
    login({ subtitle_pl: "Zaloguj się, aby czytać analizy." });
    const p = document.querySelector("header p");
    expect(p?.textContent).toBe("Zaloguj się, aby czytać analizy.");
    // Wariant szeroki: podtytuł w rozmiarze podstawowym.
    expect(p?.className).toContain("text-sm");
  });

  it("wariant inline zmniejsza podtytuł, żeby zmieścił się w pasku", () => {
    login({ variant: "inline", subtitle_pl: "Krótko i na temat." });
    const p = document.querySelector("header p");
    expect(p?.textContent).toBe("Krótko i na temat.");
    expect(p?.className).toContain("text-xs");
  });

  it("bez podtytułu nagłówek nie zostawia pustego akapitu", () => {
    login();
    expect(document.querySelector("header p")).toBeNull();
    // Tytuł zostaje - jest budowany z tłumaczenia, nie z ustawień.
    expect(document.querySelector("header h2")?.textContent).toBe("authForms.signinTitle");
  });

  it("podtytuł działa w każdym z czterech widgetów", async () => {
    for (const view of [login, register, lost] as const) {
      view({ subtitle_pl: "Podtytuł" });
      expect(document.querySelector("header p")?.textContent).toBe("Podtytuł");
      cleanup();
    }
    reset({ subtitle_pl: "Podtytuł" });
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    expect(document.querySelector("header p")?.textContent).toBe("Podtytuł");
  });
});

describe("odsłonięcie hasła: logowanie", () => {
  const toggle = () => screen.getByRole("button", { name: "authForms.showPassword" });

  it("klik odsłania hasło, zmienia etykietę przycisku i ikonę", () => {
    // Bez tego przycisku człowiek nie ma jak sprawdzić hasła wklejonego
    // z menedżera - a literówka w haśle wygląda jak „złe dane logowania".
    login();
    expect(byId("auth-password").type).toBe("password");

    fireEvent.click(toggle());
    expect(byId("auth-password").type).toBe("text");
    const hideBtn = screen.getByRole("button", { name: "authForms.hidePassword" });
    expect(hideBtn).toBeTruthy();
    expect(screen.queryByRole("button", { name: "authForms.showPassword" })).toBeNull();

    fireEvent.click(hideBtn);
    expect(byId("auth-password").type).toBe("password");
    expect(toggle()).toBeTruthy();
  });

  it("odsłonięte hasło nie gubi wpisanej treści", () => {
    login();
    typeInto("auth-password", "haslo12345");
    fireEvent.click(toggle());
    expect(byId("auth-password").value).toBe("haslo12345");
  });
});

describe("checkbox „zapamiętaj mnie”", () => {
  it("klik przestawia zaznaczenie, bo domyślnie jest włączony", () => {
    login();
    const box = screen.getByRole("checkbox");
    expect(box).toHaveAttribute("data-state", "checked");
    fireEvent.click(box);
    expect(box).toHaveAttribute("data-state", "unchecked");
  });
});

describe("odsłonięcie hasła: rejestracja", () => {
  it("odsłania OBA pola naraz - hasło i jego powtórkę", () => {
    // Powtórka hasła istnieje po to, żeby wyłapać literówkę. Gdyby odsłaniało
    // się tylko pierwsze pole, człowiek nadal nie widziałby, gdzie się pomylił.
    register({ showPasswordConfirm: true });
    expect(byId("reg-password").type).toBe("password");
    expect(byId("reg-confirm").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "authForms.showPassword" }));
    expect(byId("reg-password").type).toBe("text");
    expect(byId("reg-confirm").type).toBe("text");
  });
});

describe("odsłonięcie hasła: ustawianie nowego hasła", () => {
  it("odsłania oba pola nowego hasła", async () => {
    reset();
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    expect(byId("rs-password").type).toBe("password");
    expect(byId("rs-confirm").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "authForms.showPassword" }));
    expect(byId("rs-password").type).toBe("text");
    expect(byId("rs-confirm").type).toBe("text");
  });
});

describe("treść zgody: link na samym końcu", () => {
  it("nie gubi ogona treści, gdy zgoda kończy się linkiem", () => {
    // Granica pętli: po ostatnim dopasowaniu nie zostaje już żaden tekst.
    // Błąd tutaj albo urywa treść zgody, albo dubluje jej fragment - a treść
    // zgody jest tym, na co człowiek klika „akceptuję" (rejestr RODO).
    register({
      requireConsent: true,
      consentText_pl: "Akceptuję [regulamin](https://example.org/regulamin)",
    });
    const link = Array.from(document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "https://example.org/regulamin",
    );
    expect(link?.textContent).toBe("regulamin");
    const row = link?.closest("label");
    expect(row?.textContent).toBe("Akceptuję regulamin");
  });
});

describe("pola dodatkowe: pozostałe typy", () => {
  it("pole typu checkbox renderuje się jako wiersz zgody z własną etykietą", () => {
    register({
      customFields: [
        '{"id":"zgoda_szkolenia","type":"checkbox","labelPl":"Chcę zaproszenia na szkolenia","required":true}',
      ],
    });
    const row = screen.getByText("Chcę zaproszenia na szkolenia").closest("label");
    expect(row).toBeTruthy();
    const box = row?.querySelector('[role="checkbox"]');
    expect(box).toBeTruthy();
    // Pole wymagane musi to zgłosić kontrolce, nie tylko walidacji na submicie.
    expect(box).toHaveAttribute("aria-required", "true");
  });

  it("lista BEZ opcji renderuje samą podpowiedź, a nie puste pozycje", () => {
    // Redakcja potrafi zapisać listę, zanim doda do niej opcje. Wtedy pole ma
    // zostać puste i wybieralne dopiero po uzupełnieniu, a nie wysypać render.
    register({ customFields: ['{"id":"branza","type":"select","labelPl":"Branża"}'] });
    const select = document.getElementById("custom_branza") as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect(select?.options).toHaveLength(1);
    expect(select?.options[0].textContent).toBe("newsletterForm.selectPlaceholder");
    expect(select?.options[0].disabled).toBe(true);
  });

  it("lista w wersji angielskiej bierze etykiety EN, nie polskie", () => {
    register(
      {
        customFields: [
          '{"id":"branza","type":"select","labelEn":"Sector","options":[{"value":"fintech","labelPl":"Finanse","labelEn":"Finance"}]}',
        ],
      },
      "en",
    );
    const select = document.getElementById("custom_branza") as HTMLSelectElement | null;
    expect(Array.from(select?.options ?? []).map((o) => o.textContent)).toContain("Finance");
    expect(document.body.textContent).not.toContain("Finanse");
  });

  it("opcja bez etykiety w bieżącym języku pokazuje swoją wartość, nie pustkę", () => {
    // Pusta pozycja listy jest nieklikalna wzrokiem - człowiek nie wie, co
    // wybiera. Wartość techniczna jest brzydka, ale wybieralna.
    register({
      customFields: [
        '{"id":"branza","type":"select","labelPl":"Branża","options":[{"value":"fintech","labelEn":"Finance"}]}',
      ],
    });
    const select = document.getElementById("custom_branza") as HTMLSelectElement | null;
    expect(Array.from(select?.options ?? []).map((o) => o.textContent)).toContain("fintech");
  });
});

describe("awarie odrzucone wartością, która nie jest Error", () => {
  it("logowanie przez Google: odrzucenie napisem nadal pokazuje komunikat", async () => {
    h.signInOAuth.mockRejectedValue("network down");
    login();
    fireEvent.click(screen.getByRole("button", { name: "authForms.google" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    // Przycisk musi wrócić do stanu klikalnego - inaczej jedna awaria sieci
    // zamyka logowanie przez Google do przeładowania strony.
    expect(screen.getByRole("button", { name: "authForms.google" })).not.toBeDisabled();
  });

  it("rejestracja przez Google: odrzucenie napisem nadal pokazuje komunikat", async () => {
    h.signInOAuth.mockRejectedValue("network down");
    register();
    fireEvent.click(screen.getByRole("button", { name: "authForms.google" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    expect(screen.getByRole("button", { name: "authForms.google" })).not.toBeDisabled();
  });

  it("straż przy odzyskiwaniu hasła odrzucona napisem: komunikat zamiast ciszy", async () => {
    // Odrzucenie napisem nie zawiera ani `rate_limited`, ani `invalid_input`,
    // więc straż przepuszcza je dalej jako własny wyjątek. Bez tej ścieżki
    // człowiek klika „wyślij link" i nie dowiaduje się NICZEGO.
    h.guard.mockRejectedValue("boom");
    lost();
    typeInto("lost-email", "osoba@example.com");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    expect(h.resetForEmail).not.toHaveBeenCalled();
  });

  it("zapis nowego hasła odrzucony napisem: komunikat i formularz wraca do pracy", async () => {
    h.updateUser.mockRejectedValue("boom");
    reset();
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    typeInto("rs-password", "haslo123456");
    typeInto("rs-confirm", "haslo123456");
    fireEvent.submit(form());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    expect(h.navigate).not.toHaveBeenCalled();
    // Formularz zostaje na ekranie: człowiek ma gdzie spróbować jeszcze raz.
    expect(document.getElementById("rs-password")).toBeTruthy();
  });
});

describe("sesja odzyskiwania, która dojechała po renderze", () => {
  /** Widget startuje bez sesji - dokładnie tak, jak przy wejściu z e-maila. */
  const mountWithoutSession = async (data: Data = {}) => {
    h.session.current = null;
    reset(data);
    await waitFor(() => expect(screen.getByText("authForms.noToken")).toBeTruthy());
  };

  it("zdarzenie PASSWORD_RECOVERY odsłania formularz mimo braku sesji na starcie", async () => {
    // To jest ścieżka z e-maila: klient Supabase parsuje token z hasha PO
    // pierwszym renderze. Gdyby widget nie nasłuchiwał, człowiek zostałby na
    // komunikacie „brak tokenu" z poprawnym linkiem w ręku.
    await mountWithoutSession();
    expect(h.authCb).not.toBeNull();

    await waitFor(() => expect(h.authCb).toBeTruthy());
    h.authCb?.("PASSWORD_RECOVERY");
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    expect(screen.queryByText("authForms.noToken")).toBeNull();
  });

  it("zdarzenie SIGNED_IN także odsłania formularz", async () => {
    await mountWithoutSession();
    h.authCb?.("SIGNED_IN");
    await waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
  });

  it("zdarzenie niezwiązane z odzyskiwaniem NIE odsłania formularza", async () => {
    // Wylogowanie w innej karcie nie jest zgodą na ustawienie nowego hasła.
    await mountWithoutSession();
    h.authCb?.("SIGNED_OUT");
    await waitFor(() => expect(screen.getByText("authForms.noToken")).toBeTruthy());
    expect(document.getElementById("rs-password")).toBeNull();
  });

  it("odmontowanie odpina nasłuch zdarzeń auth", async () => {
    await mountWithoutSession();
    expect(h.unsubscribe).not.toHaveBeenCalled();
    cleanup();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
