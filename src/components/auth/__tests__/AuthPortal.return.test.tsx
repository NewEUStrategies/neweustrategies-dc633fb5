// AuthPortal w lejku czytelnika (S3, P15/P16/P18): powrót po zalogowaniu na
// treść (`next`, sanitizowany tu - trasa przepuszcza go tylko kształtem),
// kasa wybranego planu, `emailRedirectTo` przez `/auth/callback?next=`,
// źródło rejestracji z intencji oraz zdarzenia `signup_completed` /
// `login_completed` wyłącznie przy zgodzie analitycznej. Wygląd bez zmian
// (AGENTS: wspólna powłoka z homepage).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { AUTH_DEFAULTS } from "@/lib/authSettings";

const PLAN = "11111111-1111-4111-8111-111111111111";

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
  track: vi.fn(),
  consent: true,
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

vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

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
  h.settings = { ...AUTH_DEFAULTS };
  h.reg = makeReg();
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.mfaRequired.mockReset().mockResolvedValue(false);
  h.track.mockReset();
  h.consent = true;
});

describe("AuthPortal - powrót po zalogowaniu (P15)", () => {
  it("sesja + next: wraca na artykuł razem z zapytaniem i kotwicą", () => {
    h.authState = { session: { user: { id: "u1" } }, loading: false };
    render(<AuthPortal next="/analizy/tekst?ref=nl#sekcja" intent="paywall" />);
    expect(h.navigate).toHaveBeenCalledWith({
      href: "/analizy/tekst?ref=nl#sekcja",
      replace: true,
    });
  });

  it.each([
    "//evil.com",
    "https://evil.com/x",
    "/\\evil.com",
    "%2F%2Fevil.com",
    "/%2F%2Fevil.com",
    "/login?next=/x",
    "javascript:alert(1)",
  ])("odrzuca cel spoza serwisu albo pętlę logowania: %s", (next) => {
    h.authState = { session: { user: { id: "u1" } }, loading: false };
    render(<AuthPortal next={next} />);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("plan bez next: kasa tego planu", () => {
    h.authState = { session: { user: { id: "u1" } }, loading: false };
    render(<AuthPortal planId={PLAN} intent="pricing" />);
    expect(h.navigate).toHaveBeenCalledWith({ href: `/checkout/${PLAN}`, replace: true });
  });

  it("bez kontekstu: strona główna, jak dotąd", () => {
    h.authState = { session: { user: { id: "u1" } }, loading: false };
    render(<AuthPortal />);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/" });
  });
});

describe("AuthPortal - rejestracja z kontekstem (P15/P16)", () => {
  it("emailRedirectTo przez /auth/callback?next=, źródło z intencji, signup_completed", async () => {
    const { container } = render(
      <AuthPortal initialMode="signup" next="/analizy/tekst" intent="paywall" />,
    );
    fillSignup();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const call = h.signUp.mock.calls[0]?.[0] as {
      options: { emailRedirectTo: string; data: Record<string, unknown> };
    };
    expect(call.options.emailRedirectTo).toBe(
      `${window.location.origin}/auth/callback?next=${encodeURIComponent("/analizy/tekst")}`,
    );
    expect(call.options.data.signup_source).toBe("paywall");
    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith(
        expect.objectContaining({ type: "signup_completed", name: "signup_completed" }),
      ),
    );
  });

  it("bez kontekstu: przekierowanie z ustawień i źródło auth_page", async () => {
    const { container } = render(<AuthPortal initialMode="signup" />);
    fillSignup();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    const call = h.signUp.mock.calls[0]?.[0] as {
      options: { emailRedirectTo: string; data: Record<string, unknown> };
    };
    expect(call.options.emailRedirectTo).toBe(`${window.location.origin}/`);
    expect(call.options.data.signup_source).toBe("auth_page");
  });

  it("bez zgody analitycznej: rejestracja i logowanie bez zdarzeń klienta", async () => {
    h.consent = false;
    const { container } = render(<AuthPortal />);
    fillSignin();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(h.signIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.track).not.toHaveBeenCalled();
  });

  it("logowanie przy zgodzie: login_completed z intencją", async () => {
    const { container } = render(<AuthPortal intent="club" />);
    fillSignin();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith(
        expect.objectContaining({ type: "login_completed", meta: { intent: "club" } }),
      ),
    );
  });
});
