// Wejście do portalu klienta operatora - 0 z 5 funkcji pokrytych do 18.08.2026.
//
// Portal jest jedynym miejscem, w którym klient zmienia metodę płatności,
// pobiera faktury i anuluje subskrypcję poza naszym UI. Jeśli przycisk milczy
// albo otwiera pustkę, klient nie ma jak nic z tego zrobić - dlatego test
// pilnuje przede wszystkim ODCZYTU BŁĘDU Z ŁADUNKU: server fn zwraca
// `{ error: "no_customer" }` BEZ rzucania, więc react-query widzi „sukces"
// i tylko jawne sprawdzenie w `onSuccess` ratuje komunikat.
//
// Sanityzacja ścieżki powrotu (`safeReturnPath`) ma własny test jednostkowy
// (`returnPath.test.ts`) i tego nie duplikujemy - tu sprawdzamy UŻYCIE:
// czy przycisk w ogóle przez nią przepuszcza adres, zamiast wysyłać surowy.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  result: { current: {} as Record<string, unknown> },
  portal: vi.fn(),
  toastError: vi.fn(),
  opened: [] as Array<{ url: string; target: string; features: string }>,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub();
});

vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "sandbox" }));

vi.mock("@/utils/payments.functions", () => ({
  createStripePortalSession: (arg: unknown) => h.portal(arg),
}));

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: (m: string) => h.toastError(m) },
}));

import { CustomerPortalButton } from "@/components/billing/molecules/CustomerPortalButton";

const sentReturnPath = (): unknown =>
  (h.portal.mock.calls[0]?.[0] as { data: { returnPath: unknown } } | undefined)?.data.returnPath;

beforeEach(() => {
  h.result.current = { url: "https://portal.example.test/session" };
  h.portal.mockReset().mockImplementation(() => Promise.resolve(h.result.current));
  h.toastError.mockReset();
  h.opened.length = 0;
  vi.stubGlobal("open", (url: string, target: string, features: string) => {
    h.opened.push({ url, target, features });
    return null;
  });
});

describe("CustomerPortalButton - wygląd i stan", () => {
  it("domyślnie pokazuje etykietę zarządzania subskrypcją", () => {
    renderWithQueryClient(<CustomerPortalButton />);

    expect(screen.getByText("profile.subscription.portal.manage")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });

  it("własna etykieta wypiera domyślną", () => {
    renderWithQueryClient(<CustomerPortalButton label="Otwórz portal" />);

    expect(screen.getByText("Otwórz portal")).toBeTruthy();
    expect(screen.queryByText("profile.subscription.portal.manage")).toBeNull();
  });

  it("wyłączony z zewnątrz nie wysyła żądania", () => {
    renderWithQueryClient(<CustomerPortalButton disabled />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(h.portal).not.toHaveBeenCalled();
  });

  it("w trakcie tworzenia sesji blokuje przycisk i zmienia etykietę", async () => {
    // Sesja nierozstrzygnięta - przycisk zostaje w stanie oczekiwania.
    h.portal.mockImplementation(() => new Promise(() => {}));
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.portal.opening")).toBeTruthy(),
    );
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});

describe("CustomerPortalButton - ścieżka powrotu", () => {
  it("PRZEPUSZCZA adres przez sanityzację - podana ścieżka względna przechodzi", async () => {
    renderWithQueryClient(<CustomerPortalButton returnPath="/profile/plan?tab=faktury" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.portal).toHaveBeenCalledTimes(1));
    expect(sentReturnPath()).toBe("/profile/plan?tab=faktury");
  });

  it("adres absolutny na obcy host NIE wychodzi do operatora", async () => {
    renderWithQueryClient(<CustomerPortalButton returnPath="https://zly.example/phish" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.portal).toHaveBeenCalledTimes(1));
    expect(sentReturnPath()).toBe("/profile/plan");
    expect(sentReturnPath()).not.toContain("zly.example");
  });

  it("bez podanej ścieżki bierze bieżący adres okna", async () => {
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.portal).toHaveBeenCalledTimes(1));
    expect(typeof sentReturnPath()).toBe("string");
    expect(String(sentReturnPath()).startsWith("/")).toBe(true);
  });

  it("środowisko operatora jedzie razem z żądaniem", async () => {
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.portal).toHaveBeenCalledTimes(1));
    const payload = h.portal.mock.calls[0]?.[0] as { data: { environment: string } };
    expect(payload.data.environment).toBe("sandbox");
  });
});

describe("CustomerPortalButton - wynik", () => {
  it("otwiera portal w nowej karcie bez dostępu do okna źródłowego", async () => {
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toEqual({
      url: "https://portal.example.test/session",
      target: "_blank",
      features: "noopener,noreferrer",
    });
  });

  it("BRAK KONTA U OPERATORA ma osobny komunikat", async () => {
    h.result.current = { error: "no_customer" };
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.noCustomer"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("inny błąd operatora nie otwiera karty", async () => {
    h.result.current = { error: "portal_failed" };
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("odpowiedź bez adresu jest traktowana jako błąd, nie jako sukces", async () => {
    h.result.current = {};
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("wyjątek transportu też kończy się komunikatem, nie ciszą", async () => {
    h.portal.mockRejectedValue(new Error("sieć padła"));
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.portal.error"),
    );
    expect(h.opened).toHaveLength(0);
  });

  it("po nieudanej próbie przycisk wraca do stanu gotowego", async () => {
    h.portal.mockRejectedValue(new Error("sieć padła"));
    renderWithQueryClient(<CustomerPortalButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("profile.subscription.portal.manage")).toBeTruthy();
  });
});
