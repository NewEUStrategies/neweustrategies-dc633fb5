/**
 * `ImpersonationBanner` - jedyne widoczne ostrzeżenie, że super-admin ogląda
 * serwis JAKO ktoś inny. Baner jedzie na KAŻDEJ stronie publicznej (SiteChrome),
 * więc dowód dotyczy trzech rzeczy:
 *   1. MILCZY, dopóki trybu nie ma - żaden pusty pasek nie ma prawa zjeść
 *      górnej krawędzi strony zwykłemu czytelnikowi;
 *   2. WCHODZI SAM, gdy tryb zacznie się w innej karcie/po przekierowaniu -
 *      komponent odpytuje stan co 1,5 s, bo start impersonacji dzieje się poza
 *      Reactem (zapis w sessionStorage);
 *   3. WYJŚCIE Z TRYBU najpierw ZAMYKA sesję po stronie serwera, a dopiero
 *      potem przeładowuje stronę - odwrotna kolejność zostawiałaby przeglądarkę
 *      z cudzą sesją po odświeżeniu.
 *
 * ATRAPY: `@/lib/admin/impersonation` (granica danych - sessionStorage +
 * wywołania serwerowe) oraz `react-i18next` (baner czyta z niej tylko język).
 * `window.location.reload` jest podmieniony, żeby happy-dom nie próbował
 * nawigować naprawdę.
 *
 * UWAGA O NAPISACH: baner NIE korzysta ze słownika - trzyma własną mapę
 * `COPY = { pl, en }` w kodzie. Asercje muszą więc cytować te napisy; to
 * ograniczenie komponentu, nie testu, i dlatego wariant językowy sprawdzamy
 * przez ROZGAŁĘZIENIE (inny napis dla "en" niż dla "pl"), a nie przez słownik.
 *
 * RODO: dane celu są zmyślone (imię i nazwisko nieistniejącej osoby).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImpersonationState } from "@/lib/admin/impersonation";

const h = vi.hoisted(() => ({
  lang: "pl" as string | undefined,
  state: null as unknown,
  stopCalls: 0,
  stopResolve: null as null | (() => void),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() {
        return h.lang;
      },
    },
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/lib/admin/impersonation", () => ({
  getImpersonationState: () => h.state,
  stopImpersonation: async () => {
    h.stopCalls += 1;
    await new Promise<void>((resolve) => {
      h.stopResolve = resolve;
    });
  },
}));

import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";

const STATE: ImpersonationState = {
  sessionId: "sesja-testowa",
  targetUserId: "uzytkownik-testowy",
  targetLabel: "Zofia Przykładowa",
  original: { access_token: "atrapa-tokenu", refresh_token: "atrapa-odswiezenia" },
};

let reload: Mock<() => void>;

beforeEach(() => {
  h.lang = "pl";
  h.state = null;
  h.stopCalls = 0;
  h.stopResolve = null;
  reload = vi.fn<() => void>();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ImpersonationBanner", () => {
  it("bez trybu podszywania nie renderuje niczego", () => {
    const { container } = render(<ImpersonationBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it("w trybie podszywania pokazuje komunikat statusu z etykietą celu", async () => {
    h.state = STATE;
    render(<ImpersonationBanner />);

    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Tryb superadmina - przegląd jako");
    expect(status).toHaveTextContent("Zofia Przykładowa");
  });

  it.each([
    ["angielskim", "en", "Super admin view - acting as", "Exit"],
    ["angielskim regionalnym", "en-GB", "Super admin view - acting as", "Exit"],
    ["polskim", "pl", "Tryb superadmina - przegląd jako", "Zakończ"],
    ["nieustawionym (spadek na polski)", undefined, "Tryb superadmina - przegląd jako", "Zakończ"],
  ])("w wariancie %s używa własnej kopii napisów", async (_opis, lang, intro, exit) => {
    h.lang = lang;
    h.state = STATE;
    render(<ImpersonationBanner />);

    expect(await screen.findByRole("status")).toHaveTextContent(intro);
    expect(screen.getByRole("button", { name: exit })).toBeInTheDocument();
  });

  it("odpytuje stan cyklicznie, więc tryb włączony w innej karcie zapala baner", async () => {
    vi.useFakeTimers();
    render(<ImpersonationBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    h.state = STATE;
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("wyjście z trybu przeładowuje stronę DOPIERO po zamknięciu sesji", async () => {
    h.state = STATE;
    render(<ImpersonationBanner />);

    fireEvent.click(await screen.findByRole("button", { name: "Zakończ" }));

    expect(h.stopCalls).toBe(1);
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      h.stopResolve?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
