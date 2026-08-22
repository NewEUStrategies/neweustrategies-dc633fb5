// Trasa `/reset-password` - lądowisko linku odzyskiwania hasła z e-maila
// Supabase. Token recovery żyje w window.location.hash/search, NIE w search
// params routera (detectSessionInUrl supabase-js sam go tam wymienia na
// sesję) - stąd testy ustawiają realny hash przeglądarki, a nie initialEntry.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  getSessionResult: { data: { session: null as unknown } },
  /** Gdy ustawione, `getSession()` czeka, aż test je zwolni (bez timerów). */
  getSessionDeferred: null as null | Promise<{ data: { session: unknown } }>,
  /** Wspólna atrapa odpięcia nasłuchu - dowód na sprzątanie po odmontowaniu. */
  unsubscribe: vi.fn(),
  /**
   * Adres żądania widziany przez `head()`. Pusty ciąg = zachowanie domyślne
   * (`head()` bierze wtedy własny fallback `/reset-password`, czyli wariant PL),
   * bo pod vitestem `getRequestUrl()` nie ma ani żądania serwera, ani okna.
   */
  requestUrl: "",
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
        return { data: { subscription: { unsubscribe: h.unsubscribe } } };
      },
      getSession: () => h.getSessionDeferred ?? Promise.resolve(h.getSessionResult),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
      signOut: (...a: unknown[]) => h.signOutMock(...a),
    },
  },
}));
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
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
import { renderRoute, routeHead } from "@/test/routeHarness";
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
  h.getSessionDeferred = null;
  h.unsubscribe.mockClear();
  h.requestUrl = "";
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

// ─── DOBICIE GAŁĘZI (etap 7b) ────────────────────────────────────────────────
// Poniższe grupy dotyczą trzech rzeczy, których wcześniejsze testy nie ruszały,
// a każda z nich zostawia człowieka bez konta, jeśli się zepsuje:
//   * nagłówek strony w wersji angielskiej (`head()` czyta JĘZYK Z ADRESU, nie
//     z i18n, więc wariant EN to osobna ścieżka kodu),
//   * ROZRÓŻNIENIE zdarzeń nasłuchu: formularz nowego hasła wolno odsłonić
//     WYŁĄCZNIE przy sesji odzyskiwania, nie przy dowolnym zdarzeniu auth,
//   * wyścigi domknięcia: odpowiedź, która dojechała po opuszczeniu strony albo
//     po odsłonięciu formularza, nie może przestawić fazy pod palcami.

describe("trasa /reset-password - nagłówek w wersji angielskiej", () => {
  it("prefiks /en w adresie daje angielski tytuł, opis i znacznik języka", () => {
    // `head()` NIE czyta `i18n.language` - bierze język z adresu żądania
    // (`activeLang`). Gdyby ta gałąź się zepsuła, użytkownik EN dostałby
    // w zakładce i w podglądzie linku polski tytuł strony resetu hasła.
    h.requestUrl = "https://example.org/en/reset-password";
    const head = routeHead(ResetPasswordRoute);

    expect(head.meta).toContainEqual({ title: "Reset password - New European Strategies" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Set a new password for your New European Strategies account.",
    });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "en" });
    // Strona odzyskiwania konta nie wchodzi do wyszukiwarek w ŻADNYM języku.
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("bez prefiksu językowego nagłówek jest polski", () => {
    h.requestUrl = "https://example.org/reset-password";
    const head = routeHead(ResetPasswordRoute);

    expect(head.meta).toContainEqual({ title: "Reset hasła - New European Strategies" });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "pl" });
  });
});

describe("trasa /reset-password - które zdarzenie odsłania formularz", () => {
  it("zdarzenie odzyskiwania BEZ sesji nie odsłania formularza nowego hasła", async () => {
    // Formularz zmiany hasła wolno pokazać tylko przy realnej sesji z linku.
    // Odsłonięcie go bez sesji kończy się „nie udało się zapisać" po wpisaniu
    // nowego hasła - człowiek myśli, że zmienił hasło, a nie zmienił.
    h.getSessionResult = { data: { session: null } };
    await mount();

    await act(async () => {
      h.authCb?.("PASSWORD_RECOVERY", null);
    });

    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ustaw nowe hasło" })).not.toBeInTheDocument();
  });

  it("zdarzenie niezwiązane z odzyskiwaniem nie odsłania formularza, choć ma sesję", async () => {
    // Odświeżenie tokenu zalogowanej osoby (inna karta) nie jest zgodą na
    // zmianę hasła bez linku z e-maila.
    h.getSessionResult = { data: { session: null } };
    await mount();

    await act(async () => {
      h.authCb?.("TOKEN_REFRESHED", { user: { id: "u1" } });
    });

    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();
  });

  it("powtórne zdarzenie nie kasuje hasła wpisanego w odsłonięty formularz", async () => {
    // supabase-js potrafi wysłać SIGNED_IN kilka razy (odświeżenie tokenu tuż
    // po wymianie). Gdyby faza wracała do „checking", formularz zniknąłby
    // z ekranu razem z wpisanym hasłem.
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
    await mount();
    await screen.findByRole("heading", { name: "Ustaw nowe hasło" });

    const { password } = passwordFields();
    fireEvent.change(password, { target: { value: "haslo1234" } });

    await act(async () => {
      h.authCb?.("SIGNED_IN", { user: { id: "u1" } });
    });

    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
    expect(passwordFields().password).toHaveValue("haslo1234");
  });
});

describe("trasa /reset-password - wyścigi po opuszczeniu strony", () => {
  it("odmontowanie odpina nasłuch sesji", async () => {
    h.getSessionResult = { data: { session: null } };
    const view = await mount();

    expect(h.unsubscribe).not.toHaveBeenCalled();
    view.unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("zdarzenie sesji, które dojechało po opuszczeniu strony, nie wskrzesza formularza", async () => {
    h.getSessionResult = { data: { session: null } };
    const view = await mount();
    view.unmount();

    await act(async () => {
      h.authCb?.("PASSWORD_RECOVERY", { user: { id: "u1" } });
    });

    expect(document.body.textContent).not.toContain("Ustaw nowe hasło");
  });

  it("getSession rozstrzygnięty po opuszczeniu strony nie wskrzesza formularza", async () => {
    // Realny przypadek: wolna odpowiedź /auth/v1/user, a człowiek w tym czasie
    // wraca na stronę logowania. Sesja dojeżdża do już odmontowanego widoku.
    let release: (value: { data: { session: unknown } }) => void = () => {};
    h.getSessionDeferred = new Promise((resolve) => {
      release = resolve;
    });
    const view = await mount();
    expect(screen.getByText("Weryfikujemy link resetujący…")).toBeInTheDocument();

    view.unmount();
    await act(async () => {
      release({ data: { session: { user: { id: "u1" } } } });
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Ustaw nowe hasło");
  });

  it("getSession rozstrzygnięty PO odsłonięciu formularza nie przestawia fazy", async () => {
    // Kolejność w produkcji bywa odwrotna do oczekiwanej: nasłuch dostaje
    // PASSWORD_RECOVERY szybciej niż rozstrzyga się getSession(). Późniejsza
    // odpowiedź nie może przerysować ekranu pod palcami.
    let release: (value: { data: { session: unknown } }) => void = () => {};
    h.getSessionDeferred = new Promise((resolve) => {
      release = resolve;
    });
    await mount();

    await act(async () => {
      h.authCb?.("PASSWORD_RECOVERY", { user: { id: "u1" } });
    });
    const { password } = passwordFields();
    fireEvent.change(password, { target: { value: "haslo1234" } });

    await act(async () => {
      release({ data: { session: { user: { id: "u1" } } } });
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
    expect(passwordFields().password).toHaveValue("haslo1234");
  });
});

describe("trasa /reset-password - deadline kontra formularz na ekranie", () => {
  it("deadline nie zamienia odsłoniętego formularza w komunikat o wygaśnięciu", async () => {
    // To jest najważniejszy test tej grupy: deadline (4 s / 20 s) NIE jest
    // czyszczony po odsłonięciu formularza, tylko dojeżdża w tle. Gdyby
    // przestawiał fazę bezwarunkowo, człowiek wpisujący hasło zobaczyłby po
    // czterech sekundach „link wygasł" - i musiałby zamawiać nowy link, mimo
    // że sesja odzyskiwania była poprawna.
    vi.useFakeTimers();
    h.getSessionResult = { data: { session: { user: { id: "u1" } } } };
    await mount();
    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();

    const { password, confirm } = passwordFields();
    fireEvent.change(password, { target: { value: "haslo1234" } });
    fireEvent.change(confirm, { target: { value: "haslo1234" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });

    expect(screen.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeInTheDocument();
    expect(screen.queryByText("Link wygasł lub jest nieprawidłowy")).not.toBeInTheDocument();
    expect(passwordFields().password).toHaveValue("haslo1234");
  });

  it("sesja po deadline nie odsłania już formularza - OPIS STANU FAKTYCZNEGO", async () => {
    // To nie jest życzenie, tylko zapis rzeczywistości: po przejściu w fazę
    // „invalid" `setPhase` zwraca poprzednią fazę, więc spóźniona sesja NIE
    // przywraca formularza. Zachowanie jest świadome (deadline jest ostateczny)
    // i wyjście dla człowieka istnieje - przycisk „Wyślij nowy link" zostaje na
    // ekranie. Asercja pilnuje, żeby ta reguła nie zmieniła się przypadkiem.
    vi.useFakeTimers();
    h.getSessionResult = { data: { session: null } };
    await mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
    });
    expect(screen.getByText("Link wygasł lub jest nieprawidłowy")).toBeInTheDocument();

    await act(async () => {
      h.authCb?.("PASSWORD_RECOVERY", { user: { id: "u1" } });
    });

    expect(screen.getByText("Link wygasł lub jest nieprawidłowy")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ustaw nowe hasło" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wyślij nowy link" })).toBeInTheDocument();
  });
});
