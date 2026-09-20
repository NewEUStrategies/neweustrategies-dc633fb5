/**
 * `ImpersonationBanner` - jedyne widoczne ostrzeżenie, że super-admin ogląda
 * serwis JAKO ktoś inny. Baner jedzie na KAŻDEJ stronie publicznej (SiteChrome),
 * więc dowód dotyczy trzech rzeczy:
 *   1. MILCZY, dopóki trybu nie ma - żaden pusty pasek nie ma prawa zjeść
 *      górnej krawędzi strony zwykłemu czytelnikowi;
 *   2. WCHODZI SAM, gdy stan zmieni się poza Reactem (zapis w sessionStorage).
 *      Od 2026-09-20 ścieżką główną jest ODCZYT PRZY MONTAŻU plus zdarzenia
 *      (`storage`, `visibilitychange`), a odpytywanie co 1,5 s zostało już
 *      TYLKO dla personelu: baner jedzie na każdej stronie publicznej, więc
 *      czytelnik-anonim nie ma prawa płacić za timer, którego nigdy nie
 *      zobaczy (audyt CWV, F38). Dowód na to jest tu osobnym przypadkiem;
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
  /** Rola widza - bramka odpytywania cyklicznego. */
  isStaff: false,
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

// Baner czyta z kontekstu autoryzacji WYŁĄCZNIE `isStaff` (bramka timera);
// prawdziwy provider ciągnąłby Supabase i sesję, czyli całą warstwę danych.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isStaff: h.isStaff }),
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
  h.isStaff = false;
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

  it("PERSONELOWI odpytuje stan cyklicznie - zapis w tej karcie idzie poza Reactem", async () => {
    // `sessionStorage` nie emituje zdarzenia do własnego dokumentu, więc dla
    // kogoś, kto może podszywanie WŁĄCZYĆ, interwał zostaje siatką bezpieczeństwa.
    h.isStaff = true;
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

  it("CZYTELNIKOWI nie zakłada ŻADNEGO timera (baner jest na każdej stronie)", async () => {
    // To jest cała stawka poprawki F38: interwał co 1,5 s na każdej publicznej
    // stronie płacił każdy czytelnik, choć baner dotyczy wyłącznie personelu.
    vi.useFakeTimers();
    render(<ImpersonationBanner />);
    await act(async () => {
      await Promise.resolve();
    });

    // Liczba timerów, nie atrapa na `setInterval`: podmiana globalnej funkcji
    // pod zainstalowanymi zegarami rozjeżdża przywracanie w `afterEach`.
    expect(vi.getTimerCount()).toBe(0);

    h.state = STATE;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("zdarzenie `storage` przeczytuje stan bez żadnego odpytywania", async () => {
    render(<ImpersonationBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    h.state = STATE;
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("powrót do karty (`visibilitychange`) też przeczytuje stan", async () => {
    render(<ImpersonationBanner />);
    await act(async () => {
      await Promise.resolve();
    });

    h.state = STATE;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
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
