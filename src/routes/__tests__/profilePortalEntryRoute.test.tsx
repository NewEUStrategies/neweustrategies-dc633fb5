// WEJŚCIE DO PORTALU PŁATNOŚCI Z MAILA - `/profile/portal` (SUB-19).
//
// CO TEN PLIK DOWODZI.
//   1. LINK Z MAILA DZIAŁA PO GODZINIE. Strona nie dostaje adresu sesji
//      operatora z zewnątrz - sesję tworzy NA ŻĄDANIE, przy każdym wejściu
//      (`openMyBillingPortal`), więc czas leżenia maila w skrzynce nie gra roli.
//   2. TOŻSAMOŚĆ Z SESJI. Adres niesie wyłącznie środowisko operatora; każdy
//      inny parametr (np. podstawiony `userId`) odpada w `validateSearch`
//      i nie dociera do funkcji serwerowej.
//   3. GOŚĆ NIE GUBI CELU. Bez sesji strona otwiera logowanie W MIEJSCU,
//      a gdy sesja się pojawi - sama kontynuuje otwarcie portalu.
//   4. ODMOWY SĄ CZYTELNE. Brak klienta operatora i awaria mają własne
//      komunikaty i drogę powrotu na `/profile/plan`, nie białą stronę.
//   5. STRONA NIE TRAFIA DO WYSZUKIWARKI.
//
// GRANICE ATRAPOWANE: sesja (`useAuth`), funkcja serwerowa portalu, magistrala
// okienka logowania, i18n i nawigacja przeglądarki (`window.location`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  type Auth = { session: object | null; loading: boolean };
  let auth: Auth = { session: null, loading: false };
  const listeners = new Set<() => void>();
  return {
    /** Sesja jako zewnętrzny magazyn - zmiana (logowanie) przerysowuje stronę. */
    getAuth: (): Auth => auth,
    setAuth(next: Auth): void {
      auth = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: vi.fn(),
    login: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", async () => {
  const React = await import("react");
  return { useAuth: () => React.useSyncExternalStore(h.subscribe, h.getAuth, h.getAuth) };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/portalLink.functions", () => ({
  openMyBillingPortal: (arg: unknown) => h.open(arg),
}));
vi.mock("@/lib/loginPopupBus", () => ({
  openLoginPopup: (arg: unknown) => h.login(arg),
}));

import { renderRoute, routeMeta, routeSearchValidator } from "@/test/routeHarness";
import { Route } from "@/routes/profile_.portal";

const SESJA_PORTALU = "https://billing.stripe.test/p/session/swieza";
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  h.setAuth({ session: { user: { id: "user-1" } }, loading: false });
  h.open.mockResolvedValue({
    ok: true,
    urls: { overviewUrl: SESJA_PORTALU, updatePaymentMethodUrl: null, cancelUrl: null },
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, replace: h.replace },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

function zamontuj(entry = "/profile/portal?environment=live") {
  return renderRoute({ route: Route, path: "/profile/portal", initialEntry: entry });
}

describe("/profile/portal - sesja portalu na żądanie", () => {
  it("zalogowany właściciel: sesja powstaje PRZY WEJŚCIU i strona przekierowuje", async () => {
    await zamontuj();

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(SESJA_PORTALU));
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledWith({ data: { environment: "live" } });
  });

  it("KAŻDE wejście tworzy NOWĄ sesję - link z maila nie ma czego „zużyć”", async () => {
    // Kryterium SUB-19: link działa po godzinie. Adres w mailu jest stały,
    // a sesja (ta, która wygasa) powstaje dopiero teraz.
    await zamontuj();
    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1));
    cleanup();

    h.open.mockResolvedValue({
      ok: true,
      urls: {
        overviewUrl: "https://billing.stripe.test/p/session/kolejna",
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    });
    await zamontuj();

    await waitFor(() =>
      expect(h.replace).toHaveBeenLastCalledWith("https://billing.stripe.test/p/session/kolejna"),
    );
    expect(h.open).toHaveBeenCalledTimes(2);
  });

  it("adres przyjmuje WYŁĄCZNIE środowisko - podstawiony `userId` odpada", async () => {
    const waliduj = routeSearchValidator(Route);
    expect(waliduj({ environment: "sandbox", userId: "user-obcy" })).toEqual({
      environment: "sandbox",
    });
    expect(waliduj({ environment: "prod" })).toEqual({});

    await zamontuj("/profile/portal?environment=sandbox&userId=user-obcy");

    await waitFor(() => expect(h.open).toHaveBeenCalled());
    expect(h.open).toHaveBeenCalledWith({ data: { environment: "sandbox" } });
  });

  it("adres spoza https NIE jest otwierany", async () => {
    h.open.mockResolvedValue({
      ok: true,
      urls: { overviewUrl: "javascript:alert(1)", updatePaymentMethodUrl: null, cancelUrl: null },
    });

    await zamontuj();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(h.replace).not.toHaveBeenCalled();
  });
});

describe("/profile/portal - gość nie gubi celu wejścia", () => {
  it("bez sesji: logowanie W MIEJSCU, bez wołania funkcji serwerowej", async () => {
    h.setAuth({ session: null, loading: false });

    await zamontuj();

    expect(h.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("profile.subscription.portal.entry.signInCta"));
    expect(h.login).toHaveBeenCalledWith(expect.objectContaining({ mode: "signin" }));
  });

  it("po zalogowaniu strona SAMA kontynuuje otwarcie portalu", async () => {
    // Okienko logowania nie zmienia adresu - sesja pojawia się na tej samej
    // stronie, a strona bez dodatkowego kliknięcia prowadzi do portalu.
    h.setAuth({ session: null, loading: false });
    await zamontuj();
    expect(h.open).not.toHaveBeenCalled();

    act(() => h.setAuth({ session: { user: { id: "user-1" } }, loading: false }));

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(SESJA_PORTALU));
    expect(h.open).toHaveBeenCalledWith({ data: { environment: "live" } });
  });

  it("dopóki sesja się rozstrzyga - spinner, bez wołania funkcji serwerowej", async () => {
    h.setAuth({ session: null, loading: true });

    await zamontuj();

    expect(screen.getByLabelText("loading")).toBeTruthy();
    expect(h.open).not.toHaveBeenCalled();
  });
});

describe("/profile/portal - odmowy", () => {
  it("brak klienta operatora: własny komunikat i powrót na plan, bez ponawiania", async () => {
    h.open.mockResolvedValue({ ok: false, error: "no_customer" });

    await zamontuj();

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.portal.noCustomer")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.subscription.portal.entry.retry")).toBeNull();
    expect(
      screen.getByText("profile.subscription.portal.entry.back").closest("a")?.getAttribute("href"),
    ).toBe("/profile/plan");
  });

  it("awaria operatora: komunikat i PONOWIENIE, które tworzy nową sesję", async () => {
    h.open.mockResolvedValueOnce({ ok: false, error: "portal_failed" });

    await zamontuj();

    await waitFor(() => expect(screen.getByText("profile.subscription.portal.error")).toBeTruthy());
    fireEvent.click(screen.getByText("profile.subscription.portal.entry.retry"));

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(SESJA_PORTALU));
    expect(h.open).toHaveBeenCalledTimes(2);
  });

  it("wyjątek funkcji serwerowej nie wywraca strony", async () => {
    h.open.mockRejectedValue(new Error("network"));

    await zamontuj();

    await waitFor(() => expect(screen.getByText("profile.subscription.portal.error")).toBeTruthy());
  });
});

describe("/profile/portal - nagłówek", () => {
  it("ma tytuł i zakaz indeksacji", async () => {
    const meta = await routeMeta(Route);
    expect(meta.find((entry) => "title" in entry)?.title).toBeTruthy();
    const robots = meta.find((entry) => entry.name === "robots");
    expect(String(robots?.content)).toContain("noindex");
  });
});
