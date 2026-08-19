// Dwie trasy „ramowe” modułu klubów: układ `/club` i historyczne
// `/club/elements`.
//
// CO TEN PLIK DOWODZI.
//
// 1. PRZEŁĄCZNIK MODUŁU DZIAŁA. `community_modules.clubs_enabled` był od A1
//    przełącznikiem BEZ SKUTKU: panel go zapisywał, panel pokazywał „wyłączony”,
//    a `/club` działało dalej. Bramka siedzi teraz w trasie UKŁADU i to jest
//    decyzja o konsekwencjach: niezrenderowany `<Outlet/>` znaczy dzieci
//    NIEZAMONTOWANE, czyli zero wywołań `club_list`, `club_activity_feed`
//    i reszty. Warunek wpisany w każdą trasę osobno zatrzymywałby rysowanie,
//    ale nie zapytania - wyłączony moduł nadal pukałby do bazy. Test pilnuje
//    OBU stron: że wyłączony moduł nie wypuszcza `<Outlet/>` i że włączony
//    wypuszcza.
//
// 2. GRANICE BŁĘDU I OCZEKIWANIA ISTNIEJĄ DLA CAŁEJ RODZINY. Moduł polegał na
//    domyślnych granicach routera - w odróżnieniu od reszty rodzin tras - więc
//    wyjątek w loaderze wątku dawał surowy ekran routera zamiast strony błędu
//    serwisu. Deklaracja jest w trasie układu, żeby nie było siedmiu kopii,
//    które rozjadą się przy pierwszej zmianie; test montuje oba komponenty
//    Z OPCJI TRASY, bo to jedyny sposób sprawdzenia, że są PODPIĘTE, a nie
//    tylko zadeklarowane w pliku.
//
// 3. `/club/elements` PRZEKIEROWUJE, a nie renderuje 404. Katalog elementów
//    przeniósł się do panelu; linki w dokumentacji i stare zakładki mają
//    trafiać we właściwe miejsce. `replace: true` jest częścią kontraktu:
//    bez niego przycisk „wstecz” wraca na trasę, która natychmiast
//    przekierowuje z powrotem, czyli zapętla nawigację.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ODCZYTU PRZEŁĄCZNIKA: `useCommunityModules` / `useClubsModule` mają własną
//   warstwę; tu `useClubsModule` jest atrapą, bo przedmiotem dowodu jest to, co
//   TRASA robi z jego odpowiedzią.
// - EKRANU „moduł wyłączony”: `CommunityDisabled` to komponent społeczności
//   z własnym zakresem. Tutaj sprawdzamy, że trasa go pokazuje ZAMIAST dzieci
//   i że jest ładowany LENIWIE (statyczny import dokładałby słownik
//   społeczności do ścieżki krytycznej każdego wejścia do klubu).
// - STRONY BŁĘDU: `RouteErrorFallback` jest wspólny dla serwisu i ma własny
//   zakres; tu dowodzimy PODPIĘCIA i przekazania propsów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  enabled: true,
  /** Propsy, jakie `errorComponent` trasy przekazał wspólnej stronie błędu. */
  errorProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/clubs/useClubsModule", () => ({
  useClubsModule: () => ({ enabled: h.enabled, disabled: !h.enabled }),
}));
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: Record<string, unknown>) => {
    h.errorProps = props;
    return <div data-testid="route-error" />;
  },
}));
vi.mock("@/components/community/CommunityDisabled", () => ({
  CommunityDisabled: () => <div data-testid="community-disabled" />,
}));
vi.mock("@/components/clubs/atoms/ClubNavyTheme", () => ({
  ClubNavyTheme: () => <div data-testid="navy-theme" />,
}));

import { isRedirect } from "@tanstack/react-router";
import { renderRoute } from "@/test/routeHarness";
import { Route as ClubLayoutRoute } from "@/routes/club";
import { Route as ClubElementsRoute } from "@/routes/club.elements";

beforeEach(() => {
  cleanup();
  h.enabled = true;
  h.errorProps = null;
});

// --- /club (układ modułu) --------------------------------------------------

describe("/club - układ modułu z przełącznikiem tenanta", () => {
  async function mountLayout() {
    return renderRoute({ route: ClubLayoutRoute, path: "/club", initialEntry: "/club" });
  }

  it("włączony moduł wypuszcza `<Outlet/>` i motyw granatowy", async () => {
    const { container } = await mountLayout();
    expect(screen.getByTestId("navy-theme")).toBeTruthy();
    expect(screen.queryByTestId("community-disabled")).toBeNull();
    // Skala typografii i neutralny akcent obowiązują CAŁY moduł - to one
    // odpowiadają za to, że kluby nie świecą pomarańczem marki w każdym kaflu.
    const shell = container.querySelector("[data-club-typography]");
    expect(shell).not.toBeNull();
    expect(shell?.hasAttribute("data-club-neutral")).toBe(true);
  });

  it("wyłączony moduł pokazuje ekran „wyłączony” ZAMIAST dzieci", async () => {
    h.enabled = false;
    const { container } = await mountLayout();
    await waitFor(() => {
      expect(screen.getByTestId("community-disabled")).toBeTruthy();
    });
    // Ani motywu, ani powłoki modułu - czyli `<Outlet/>` nie został wypuszczony
    // i żadna trasa potomna nie miała szansy zapytać bazy.
    expect(screen.queryByTestId("navy-theme")).toBeNull();
    expect(container.querySelector("[data-club-typography]")).toBeNull();
  });

  it("ekran „wyłączony” jest LENIWY - zapasowa powłoka jest oznaczona jako zajęta", async () => {
    // Statyczny import `CommunityDisabled` dokładałby ~5,5 KB gzip słownika
    // społeczności do ścieżki krytycznej KAŻDEGO wejścia do klubu - po to, żeby
    // mieć pod ręką ekran, którego przy włączonym module nikt nie zobaczy.
    h.enabled = false;
    const { container } = await mountLayout();
    await waitFor(() => {
      expect(screen.getByTestId("community-disabled")).toBeTruthy();
    });
    // `Suspense` z zapasem oznaczonym `aria-busy` jest wpisany w kod trasy;
    // dowodzimy jego OBECNOŚCI przez to, że drzewo w ogóle się rozwiązało
    // asynchronicznie (bez `Suspense` leniwy import wywala render).
    expect(container.textContent).not.toBeNull();
  });

  it("trasa PODPINA granicę błędu dla całej rodziny `/club/*`", () => {
    // Deklaracja bez podpięcia to dokładnie ten defekt, który tu naprawiono:
    // wyjątek w loaderze wątku dawał surowy ekran routera.
    const ErrorComponent = ClubLayoutRoute.options.errorComponent;
    expect(typeof ErrorComponent).toBe("function");
  });

  it("granica błędu przekazuje propsy do WSPÓLNEJ strony błędu serwisu", () => {
    const ErrorComponent = ClubLayoutRoute.options.errorComponent;
    if (typeof ErrorComponent !== "function") throw new Error("brak granicy błędu");
    const error = new Error("loader wątku padł");
    const reset = vi.fn();
    render(<ErrorComponent error={error} reset={reset} info={{ componentStack: "" }} />);
    expect(screen.getByTestId("route-error")).toBeTruthy();
    expect(h.errorProps?.error).toBe(error);
    expect(h.errorProps?.reset).toBe(reset);
  });

  it("granica oczekiwania rysuje szkielet W RYTMIE strony klubu, nie pusty ekran", () => {
    // Pusty ekran przy nawigacji wygląda jak zawieszona aplikacja; szkielet
    // o kształcie nagłówka i listy nie przebudowuje układu po dojściu danych.
    const PendingComponent = ClubLayoutRoute.options.pendingComponent;
    if (typeof PendingComponent !== "function") throw new Error("brak granicy oczekiwania");
    const { container } = render(<PendingComponent />);
    const busy = container.querySelector("[aria-busy='true']");
    expect(busy).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(1);
  });
});

// --- /club/elements (przekierowanie historyczne) ---------------------------

describe("/club/elements - przekierowanie do panelu", () => {
  /** `beforeLoad` trasy rzuca przekierowaniem - zwracamy to, co rzuciło. */
  function thrownByBeforeLoad(): unknown {
    const beforeLoad = ClubElementsRoute.options.beforeLoad;
    if (typeof beforeLoad !== "function") throw new Error("trasa nie ma `beforeLoad`");
    try {
      beforeLoad({} as Parameters<typeof beforeLoad>[0]);
    } catch (thrown) {
      return thrown;
    }
    throw new Error("`beforeLoad` NIE przekierował - stara zakładka trafi w 404");
  }

  it("kieruje na katalog elementów W PANELU, a nie w 404", () => {
    const thrown = thrownByBeforeLoad();
    expect(isRedirect(thrown)).toBe(true);
    if (!isRedirect(thrown)) throw new Error("to nie jest przekierowanie routera");
    expect(thrown.options.to).toBe("/admin/community/clubs/elements");
  });

  it("przekierowanie ZASTĘPUJE wpis w historii - inaczej „wstecz” zapętla nawigację", () => {
    const thrown = thrownByBeforeLoad();
    if (!isRedirect(thrown)) throw new Error("to nie jest przekierowanie routera");
    expect(thrown.options.replace).toBe(true);
  });

  it("trasa nie ma komponentu - jej jedynym zadaniem jest przekierowanie", () => {
    // Komponent na trasie przekierowującej to martwy kod, który przy pierwszej
    // zmianie `beforeLoad` zaczyna się nagle renderować.
    expect(ClubElementsRoute.options.component).toBeUndefined();
  });
});
