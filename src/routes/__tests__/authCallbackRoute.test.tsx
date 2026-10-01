// Trasa `/auth/callback` - strona, na którą wraca magic link i link
// zaproszenia po weryfikacji tokenu u dostawcy. Do 2026-10-01 stała na 0%
// razem z `/auth/activate`, choć to ona decyduje, czy kliknięcie w mail
// kończy się zalogowaniem, czy wiecznym spinnerem.
//
// Czego pilnuje ten plik:
//   * sesja z DOWOLNEGO z dwóch źródeł (zdarzenie `onAuthStateChange` albo
//     sondowanie `getSession`) przenosi na `/welcome` - DOKŁADNIE RAZ i z
//     `replace: true`, żeby „wstecz" nie wracało na zużyty link,
//   * po MAX_WAIT_MS bez sesji strona mówi, że link jest nieważny, i przestaje
//     sondować; spóźniona sesja nadal przenosi dalej,
//   * błąd w adresie (`?error=` z `/auth/activate`, `#error_code=` od dostawcy)
//     to JEDNO sprawdzenie sesji zamiast 8 sekund sondowania: brak sesji daje
//     komunikat od razu, a ISTNIEJĄCA sesja przenosi na `/welcome` - supabase-js
//     nie kasuje zapisanej sesji przy nieudanym logowaniu z adresu, więc
//     zalogowany użytkownik klikający drugi raz to samo zaproszenie nie może
//     dostać polecenia proszenia administratora o nowy link (regresja wykryta
//     w przeglądzie PR #429 i odtworzona na prawdziwym supabase-js 2.116),
//   * odrzucony odczyt sesji to brak sesji, nie nieobsłużony wyjątek,
//   * po odmontowaniu nic nie nawiguje i nic nie zostaje zasubskrybowane.
//
// Komponent renderujemy wprost z `Route.options.component`: jedyną zależnością
// routera jest `useNavigate`, a przedmiotem dowodu są jego argumenty.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";

type AuthListener = (event: string, session: Session | null) => void;

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  language: "pl" as string | undefined,
  listeners: [] as ((event: string, session: unknown) => void)[],
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ i18n: { language: h.language }, t: (k: string) => k }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession, onAuthStateChange: h.onAuthStateChange } },
}));

import { routeMeta } from "@/test/routeHarness";
import { Route } from "@/routes/auth.callback";

const MAX_WAIT_MS = 8_000;
const POLL_MS = 250;

const SESSION = { user: { id: "u-1" } } as Session;
const WELCOME = { to: "/welcome", search: { mode: undefined }, replace: true };

function sessionResult(session: Session | null) {
  return Promise.resolve({ data: { session }, error: null });
}

function emitAuth(event: string, session: Session | null) {
  act(() => {
    for (const listener of h.listeners) (listener as AuthListener)(event, session);
  });
}

function mount(url = "/auth/callback") {
  window.history.replaceState({}, "", url);
  const Page = Route.options.component;
  if (!Page) throw new Error("test: trasa bez komponentu");
  return render(<Page />);
}

beforeEach(() => {
  vi.useFakeTimers();
  h.language = "pl";
  h.listeners = [];
  h.navigate.mockReset();
  h.unsubscribe.mockReset();
  h.getSession.mockReset().mockImplementation(() => sessionResult(null));
  h.onAuthStateChange.mockReset().mockImplementation((listener: AuthListener) => {
    h.listeners.push(listener as (event: string, session: unknown) => void);
    return { data: { subscription: { unsubscribe: h.unsubscribe } } };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("/auth/callback - opcje trasy", () => {
  it("nie trafia do indeksu i nie renderuje się na serwerze (sesja żyje w przeglądarce)", async () => {
    const meta = await routeMeta(Route);
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(Route.options.ssr).toBe(false);
  });
});

describe("/auth/callback - oczekiwanie na sesję", () => {
  it("pokazuje spinner i nie nawiguje, dopóki sesji nie ma", async () => {
    mount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));

    expect(screen.getByText("Aktywujemy Twoje konto…")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(h.getSession).toHaveBeenCalledTimes(3);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("zdarzenie sesji przenosi na /welcome z replace i zatrzymuje sondowanie", async () => {
    mount();
    emitAuth("SIGNED_IN", SESSION);

    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("zdarzenie bez użytkownika (np. INITIAL_SESSION bez sesji) nie nawiguje", async () => {
    mount();
    emitAuth("INITIAL_SESSION", null);
    emitAuth("TOKEN_REFRESHED", { user: null } as unknown as Session);

    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("sondowanie znajduje sesję -> jedna nawigacja, nawet gdy potem przyjdzie zdarzenie", async () => {
    h.getSession
      .mockImplementationOnce(() => sessionResult(null))
      .mockImplementation(() => sessionResult(SESSION));
    mount();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);

    // Regresja: przed 2026-10-01 każde źródło wołało `navigate` osobno, a
    // sondowanie biegło dalej co 250 ms aż do odmontowania.
    emitAuth("SIGNED_IN", SESSION);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.getSession).toHaveBeenCalledTimes(2);
  });
});

describe("/auth/callback - przekroczenie czasu", () => {
  it("po MAX_WAIT_MS pokazuje komunikat o nieważnym linku i przestaje sondować", async () => {
    mount();
    await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS + POLL_MS));

    expect(screen.getByRole("heading", { name: "Link aktywacyjny jest nieważny" })).toBeTruthy();
    expect(
      screen.getByText(
        "Poproś administratora o ponowne wysłanie zaproszenia i otwórz link jeszcze raz.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Aktywujemy Twoje konto…")).toBeNull();

    const calls = h.getSession.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 8));
    expect(h.getSession).toHaveBeenCalledTimes(calls);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("nie poddaje się przed czasem - tuż przed granicą wciąż czeka", async () => {
    mount();
    await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS));

    expect(screen.getByText("Aktywujemy Twoje konto…")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("spóźniona sesja po przekroczeniu czasu nadal przenosi na /welcome", async () => {
    mount();
    await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS + POLL_MS));
    expect(screen.getByRole("heading")).toBeTruthy();

    emitAuth("SIGNED_IN", SESSION);
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);
    expect(h.unsubscribe).not.toHaveBeenCalled();
  });
});

const ERROR_URLS = [
  ["odmowa z /auth/activate (?error=invalid_link)", "/auth/callback?error=invalid_link"],
  [
    "brak konfiguracji (?error=activation_unavailable)",
    "/auth/callback?error=activation_unavailable",
  ],
  [
    "wygasły token u dostawcy (#error=...&error_code=otp_expired)",
    "/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  ],
  ["sam kod błędu we fragmencie", "/auth/callback#error_code=otp_expired"],
] as const;

describe("/auth/callback - błąd w adresie powrotu", () => {
  it.each(ERROR_URLS)(
    "%s, brak sesji -> komunikat po jednym sprawdzeniu, bez sondowania",
    async (_label, url) => {
      mount(url);
      await act(() => vi.advanceTimersByTimeAsync(0));

      expect(screen.getByRole("heading", { name: "Link aktywacyjny jest nieważny" })).toBeTruthy();
      expect(screen.queryByText("Aktywujemy Twoje konto…")).toBeNull();
      expect(h.getSession).toHaveBeenCalledTimes(1);

      // Żadnego sondowania przez MAX_WAIT_MS - jedno sprawdzenie rozstrzyga.
      await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS + POLL_MS));
      expect(h.getSession).toHaveBeenCalledTimes(1);
      expect(h.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(ERROR_URLS)(
    "%s, ISTNIEJĄCA sesja -> /welcome, bez komunikatu o nieważnym linku",
    async (_label, url) => {
      // Regresja z przeglądu PR #429: zalogowany użytkownik klika drugi raz
      // to samo zaproszenie, dostawca odsyła `otp_expired`, a supabase-js
      // zostawia zapisaną sesję. Ten użytkownik ma trafić na stronę powitalną.
      h.getSession.mockImplementation(() => sessionResult(SESSION));
      mount(url);
      await act(() => vi.advanceTimersByTimeAsync(0));

      expect(h.navigate).toHaveBeenCalledTimes(1);
      expect(h.navigate).toHaveBeenCalledWith(WELCOME);
      expect(screen.queryByRole("heading")).toBeNull();
    },
  );

  it("istniejąca sesja z INITIAL_SESSION przy błędzie w adresie -> jedna nawigacja", async () => {
    let resolveCheck: (value: Awaited<ReturnType<typeof sessionResult>>) => void = () => {};
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );
    mount("/auth/callback#error_code=otp_expired");

    emitAuth("INITIAL_SESSION", SESSION);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);

    // Spóźniona odpowiedź jednorazowego sprawdzenia nie dokłada komunikatu
    // ani drugiej nawigacji.
    await act(async () => {
      resolveCheck({ data: { session: null }, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("odrzucony odczyt sesji przy błędzie w adresie -> komunikat, nie wyjątek", async () => {
    h.getSession.mockImplementation(() => Promise.reject(new Error("storage unavailable")));
    mount("/auth/callback?error=invalid_link");
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("heading", { name: "Link aktywacyjny jest nieważny" })).toBeTruthy();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("spóźniona sesja po komunikacie z błędu w adresie nadal przenosi na /welcome", async () => {
    mount("/auth/callback#error_code=otp_expired");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("heading")).toBeTruthy();

    emitAuth("SIGNED_IN", SESSION);
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);
    expect(h.unsubscribe).not.toHaveBeenCalled();
  });

  it("odmontowanie przed odpowiedzią sprawdzenia -> ani nawigacji, ani komunikatu", async () => {
    let resolveCheck: (value: Awaited<ReturnType<typeof sessionResult>>) => void = () => {};
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const view = mount("/auth/callback?error=invalid_link");
    view.unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCheck({ data: { session: SESSION }, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("token sesji we fragmencie (sukces dostawcy) NIE jest traktowany jak błąd", async () => {
    mount("/auth/callback#access_token=abc&refresh_token=def&type=invite");
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));

    expect(screen.getByText("Aktywujemy Twoje konto…")).toBeTruthy();
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);
    // Ścieżka bez błędu sonduje, a nie sprawdza raz.
    expect(h.getSession).toHaveBeenCalledTimes(2);
  });
});

describe("/auth/callback - odrzucony odczyt sesji podczas sondowania", () => {
  it("nie kończy oczekiwania przed czasem i po MAX_WAIT_MS pokazuje komunikat", async () => {
    h.getSession.mockImplementation(() => Promise.reject(new Error("storage unavailable")));
    mount();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(screen.getByText("Aktywujemy Twoje konto…")).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS));
    expect(screen.getByRole("heading", { name: "Link aktywacyjny jest nieważny" })).toBeTruthy();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("/auth/callback - odmontowanie", () => {
  it("wypisuje subskrypcję, zatrzymuje sondowanie i ignoruje spóźnioną odpowiedź", async () => {
    let resolveLate: (value: Awaited<ReturnType<typeof sessionResult>>) => void = () => {};
    h.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    const view = mount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(h.getSession).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLate({ data: { session: SESSION }, error: null });
      await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    });
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });
});

describe("/auth/callback - język", () => {
  it("po angielsku: oczekiwanie i komunikat o nieważnym linku", async () => {
    h.language = "en-GB";
    mount();
    expect(screen.getByText("Activating your account…")).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(MAX_WAIT_MS + POLL_MS));
    expect(
      screen.getByRole("heading", { name: "Activation link is no longer valid" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Ask an administrator to resend the invitation, then open the link again."),
    ).toBeTruthy();
  });

  it("bez ustawionego języka mówi po polsku", () => {
    h.language = undefined;
    mount();
    expect(screen.getByText("Aktywujemy Twoje konto…")).toBeTruthy();
  });
});
