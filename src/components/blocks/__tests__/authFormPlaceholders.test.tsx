// Placeholdery pól auth: `emailPlaceholder`, `passwordPlaceholder`,
// `passwordConfirmPlaceholder` i placeholdery pól rejestracji były liczone w
// komponencie, ale NIGDY nie trafiały do kontrolki wejścia - `FloatingInput`
// wycinał ten prop, bo etykieta pływająca opierała się na `placeholder=" "`.
//
// Ten plik jeździ po PRAWDZIWYM atomie (bez mocka), więc pilnuje całej ścieżki:
// ustawienie widgetu -> widok -> atrybut w DOM. Pole bez ustawionego
// placeholdera musi dostać spacer (`FLOATING_LABEL_SPACER`), inaczej etykieta
// pływająca nigdy nie wróciłaby do stanu spoczynku.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  guard: vi.fn(),
  session: { current: null as unknown },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.defaultValue === "string" ? opts.defaultValue : key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.guard }));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
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
import { FLOATING_LABEL_SPACER } from "@/components/ui/floating-input";

const placeholderOf = (id: string): string | null => {
  const el = document.getElementById(id);
  expect(el, `input #${id}`).toBeTruthy();
  return (el as HTMLInputElement).getAttribute("placeholder");
};

beforeEach(() => {
  h.session.current = { user: { id: "u1" } };
});
afterEach(() => cleanup());

describe("login-form przekazuje placeholdery do kontrolki", () => {
  it("używa wartości z ustawień", () => {
    render(
      <LoginFormView
        data={{ emailPlaceholder_pl: "jan@firma.pl", passwordPlaceholder_pl: "min. 8 znaków" }}
        lang="pl"
      />,
    );
    expect(placeholderOf("auth-email")).toBe("jan@firma.pl");
    expect(placeholderOf("auth-password")).toBe("min. 8 znaków");
  });

  it("e-mail ma sensowny domyślny placeholder, hasło zostaje przy spacerze", () => {
    render(<LoginFormView data={{}} lang="pl" />);
    expect(placeholderOf("auth-email")).toBe("name@example.com");
    expect(placeholderOf("auth-password")).toBe(FLOATING_LABEL_SPACER);
  });

  it("respektuje język panelu", () => {
    render(<LoginFormView data={{ emailPlaceholder_en: "you@company.com" }} lang="en" />);
    expect(placeholderOf("auth-email")).toBe("you@company.com");
  });
});

describe("register-form przekazuje placeholdery każdego pola", () => {
  it("bierze je z ustawień widgetu", () => {
    render(
      <RegisterFormView
        data={{
          showPhone: true,
          showPasswordConfirm: true,
          firstNamePlaceholder_pl: "np. Jan",
          phonePlaceholder_pl: "+48 ...",
          passwordPlaceholder_pl: "silne hasło",
          passwordConfirmPlaceholder_pl: "jeszcze raz",
        }}
        lang="pl"
      />,
    );
    expect(placeholderOf("reg-first-name")).toBe("np. Jan");
    expect(placeholderOf("reg-phone")).toBe("+48 ...");
    expect(placeholderOf("reg-password")).toBe("silne hasło");
    expect(placeholderOf("reg-confirm")).toBe("jeszcze raz");
  });

  it("bez ustawień wchodzą dwujęzyczne fallbacki", () => {
    render(<RegisterFormView data={{}} lang="en" />);
    expect(placeholderOf("reg-first-name")).toBe("John");
    expect(placeholderOf("reg-last-name")).toBe("Doe");
    expect(placeholderOf("reg-email")).toBe("name@example.com");
  });

  it("pole bez sensownego fallbacku dostaje spacer, nie pusty atrybut", () => {
    render(<RegisterFormView data={{ showCompany: true }} lang="pl" />);
    expect(placeholderOf("reg-company")).toBe(FLOATING_LABEL_SPACER);
  });
});

describe("lost-password-form i reset-password-form", () => {
  it("lost-password przekazuje placeholder e-maila", () => {
    render(<LostPasswordFormView data={{ emailPlaceholder_pl: "adres@firma.pl" }} lang="pl" />);
    expect(placeholderOf("lost-email")).toBe("adres@firma.pl");
  });

  it("reset-password przekazuje placeholdery hasła i powtórki", async () => {
    render(
      <ResetPasswordFormView
        data={{
          passwordPlaceholder_pl: "min. 8 znaków",
          passwordConfirmPlaceholder_pl: "powtórz",
        }}
        lang="pl"
      />,
    );
    await vi.waitFor(() => expect(document.getElementById("rs-password")).toBeTruthy());
    expect(placeholderOf("rs-password")).toBe("min. 8 znaków");
    expect(placeholderOf("rs-confirm")).toBe("powtórz");
  });
});
