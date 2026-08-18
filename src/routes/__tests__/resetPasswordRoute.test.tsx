// Trasa `/reset-password` - lądowisko linku odzyskiwania hasła z e-maila
// Supabase. Token recovery żyje w window.location.hash/search, NIE w search
// params routera (detectSessionInUrl supabase-js sam go tam wymienia na
// sesję) - stąd testy ustawiają realny hash przeglądarki, a nie initialEntry.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  getSessionResult: { data: { session: null as unknown } },
  updateUser: vi.fn().mockResolvedValue({ error: null }),
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  settingsOverrides: {} as Record<string, unknown>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => Promise.resolve(h.getSessionResult),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
      signOut: (...a: unknown[]) => h.signOutMock(...a),
    },
  },
}));
vi.mock("@/hooks/useAuthSettings", async () => {
  const { AUTH_DEFAULTS } = await import("@/lib/authSettings");
  return { useAuthSettings: () => ({ ...AUTH_DEFAULTS, ...h.settingsOverrides }) };
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));

import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as ResetPasswordRoute } from "@/routes/reset-password";

const PATH = "/reset-password";

async function mount(entry = PATH) {
  // `getSession()` rozstrzyga się mikrozadaniem PO synchronicznym renderze -
  // act() wokół całego montowania łapie tę aktualizację stanu efektu.
  let view!: ReturnType<typeof renderRoute> extends Promise<infer T> ? T : never;
  await act(async () => {
    view = await renderRoute({ route: ResetPasswordRoute, path: PATH, initialEntry: entry });
  });
  return view;
}

function setHash(hash: string) {
  window.history.pushState(null, "", `${PATH}${hash}`);
}

/** Label ma brak `htmlFor`/`id` (nie jest to opakowanie inputu) - jedyny
 * stabilny sposób odróżnienia pól to ich kolejność w formularzu. */
function passwordFields() {
  const [password, confirm] = Array.from(document.querySelectorAll<HTMLInputElement>("form input"));
  return { password, confirm };
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.authCb = null;
  h.getSessionResult = { data: { session: null } };
  h.updateUser.mockReset().mockResolvedValue({ error: null });
  h.signOutMock.mockReset().mockResolvedValue({ error: null });
  h.settingsOverrides = {};
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.navigate.mockClear();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  window.history.pushState(null, "", PATH);
  await i18n.changeLanguage("pl");
});

describe("trasa /reset-password - head", () => {
  it("nie wpuszcza wyszukiwarek na stronę resetu hasła", async () => {
    const view = await mount();

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("trasa /reset-password - faza weryfikacji", () => {
  it("pokazuje komunikat weryfikacji, gdy sesja jeszcze nie rozstrzygnęła", async () => {
    // getSession() nigdy się nie rozstrzyga w tym teście - liczy się stan tuż po montowaniu.
    h.getSessionResult = new Promise(() => {}) as never;
    await mount();

    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();
  });

  it("bez tokenu recovery: krótki deadline (4s) przełącza w stan nieprawidłowy", async () => {
    vi.useFakeTimers();
    h.getSessionResult = new Promise(() => {}) as never;
    await mount();

    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.getByText("Link wygasł lub jest nieprawidłowy")).toBeInTheDocument();
    const requestNew = screen.getByRole("link", { name: "Wyślij nowy link" });
    expect(requestNew.getAttribute("href")).toContain("/login");
    expect(requestNew.getAttribute("href")).toContain("mode=reset");
    const backToLogin = screen.getByRole("link", { name: "Wróć do logowania" });
    expect(backToLogin.getAttribute("href")).toContain("/login");
    expect(backToLogin.getAttribute("href")).toContain("mode=signin");
  });

  it("z tokenem recovery w hashu: długi deadline (20s) przed przełączeniem w nieprawidłowy", async () => {
    setHash("#access_token=abc&type=recovery");
    vi.useFakeTimers();
    h.getSessionResult = new Promise(() => {}) as never;
    await mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.getByText("Link wygasł lub jest nieprawidłowy")).toBeInTheDocument();
  });
});

describe("trasa /reset-password - faza gotowa (formularz)", () => {
  it("getSession z sesją odsłania formularz nowego hasła i miernik siły", async () => {
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
    await mount();

    expect(await screen.findByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
    expect(screen.getByText("Nowe hasło")).toBeInTheDocument();
    expect(screen.getByText("Powtórz hasło")).toBeInTheDocument();
    const { password } = passwordFields();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(password, { target: { value: "abc" } });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("przełącznik pokaż/ukryj hasło zmienia typ pola hasła", async () => {
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
    await mount();
    await screen.findByRole("heading", { name: "Ustaw nowe hasło" });

    const { password } = passwordFields();
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Pokaż hasło" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Ukryj hasło" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("listener PASSWORD_RECOVERY odsłania formularz nawet gdy getSession zwraca null", async () => {
    h.getSessionResult = { data: { session: null } };
    await mount();

    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();
    await act(async () => {
      h.authCb!("PASSWORD_RECOVERY", { user: { id: "u1" } });
    });

    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
  });

  it("listener SIGNED_IN też odsłania formularz", async () => {
    h.getSessionResult = { data: { session: null } };
    await mount();

    await act(async () => {
      h.authCb!("SIGNED_IN", { user: { id: "u1" } });
    });

    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
  });
});

describe("trasa /reset-password - walidacja formularza", () => {
  beforeEach(() => {
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
  });

  it("hasło krótsze niż 8 znaków: toast błędu, bez wywołania updateUser", async () => {
    await mount();
    await screen.findByRole("heading", { name: "Ustaw nowe hasło" });

    // fireEvent.submit na formularzu (nie klik przycisku) - inputy mają natywny
    // `minLength=8`, który zablokowałby zdarzenie submit przed dotarciem do
    // walidacji komponentu; tu interesuje nas WŁAŚNIE ta walidacja.
    const { password, confirm } = passwordFields();
    fireEvent.change(password, { target: { value: "short1" } });
    fireEvent.change(confirm, { target: { value: "short1" } });
    fireEvent.submit(password.closest("form") as HTMLFormElement);

    expect(h.toastError).toHaveBeenCalledWith("Hasło musi mieć co najmniej 8 znaków.");
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("niezgodne hasła: toast błędu, bez wywołania updateUser", async () => {
    await mount();
    await screen.findByRole("heading", { name: "Ustaw nowe hasło" });

    const { password, confirm } = passwordFields();
    fireEvent.change(password, { target: { value: "haslo1234" } });
    fireEvent.change(confirm, { target: { value: "inne12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz nowe hasło" }));

    expect(h.toastError).toHaveBeenCalledWith("Hasła nie są identyczne.");
    expect(h.updateUser).not.toHaveBeenCalled();
  });
});

describe("trasa /reset-password - zapis nowego hasła", () => {
  beforeEach(() => {
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
  });

  async function fillAndSubmit(pass = "haslo1234") {
    await mount();
    await screen.findByRole("heading", { name: "Ustaw nowe hasło" });
    const { password, confirm } = passwordFields();
    fireEvent.change(password, { target: { value: pass } });
    fireEvent.change(confirm, { target: { value: pass } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz nowe hasło" }));
    });
  }

  it("sukces: updateUser, signOut innych sesji, toast sukcesu, nawigacja na domyślne '/'", async () => {
    await fillAndSubmit("haslo1234");

    await waitFor(() => expect(h.updateUser).toHaveBeenCalledWith({ password: "haslo1234" }));
    await waitFor(() => expect(h.signOutMock).toHaveBeenCalledWith({ scope: "others" }));
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Hasło zmienione. Pozostałe sesje zostały wylogowane.",
    );
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.navigate.mock.calls.at(-1)?.[0]).toMatchObject({ to: "/" });
  });

  it("nawiguje na settings.logged_in_redirect_url, gdy jest ścieżką wewnętrzną", async () => {
    h.settingsOverrides = { logged_in_redirect_url: "/moje-konto" };
    await fillAndSubmit("haslo1234");

    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    const call = h.navigate.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(call)).toContain("/moje-konto");
  });

  it("porażka: toast błędu z komunikatem, signOut nie jest wywołany, formularz wraca do gotowego", async () => {
    h.updateUser.mockResolvedValue({ error: new Error("weak password") });
    await fillAndSubmit("haslo1234");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("weak password"));
    expect(h.signOutMock).not.toHaveBeenCalled();
    const submit = screen.getByRole("button", { name: "Zapisz nowe hasło" });
    expect(submit).not.toBeDisabled();
  });

  it("odrzucenie wartością inną niż Error: toast z domyślnym tekstem 'Error'", async () => {
    h.updateUser.mockRejectedValue("not-an-error-instance");
    await fillAndSubmit("haslo1234");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
  });
});

describe("trasa /reset-password - i18n", () => {
  it("po angielsku pokazuje angielskie napisy", async () => {
    await i18n.changeLanguage("en");
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
    await mount();

    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();

    const { password, confirm } = passwordFields();
    fireEvent.change(password, { target: { value: "short1" } });
    fireEvent.change(confirm, { target: { value: "short1" } });
    fireEvent.submit(password.closest("form") as HTMLFormElement);
    expect(h.toastError).toHaveBeenCalledWith("Password must be at least 8 characters.");

    fireEvent.change(password, { target: { value: "haslo1234" } });
    fireEvent.change(confirm, { target: { value: "inne12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    expect(h.toastError).toHaveBeenCalledWith("Passwords do not match.");
  });

  it("po angielsku bez tokenu i po deadline pokazuje angielski stan nieprawidłowy", async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    h.getSessionResult = new Promise(() => {}) as never;
    await mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    expect(screen.getByText("This link is invalid or has expired")).toBeInTheDocument();
  });
});
