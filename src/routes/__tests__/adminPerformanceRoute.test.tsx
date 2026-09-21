// Trasa `/admin/performance` - 0/8 linii, 0/3 funkcji.
//
// PO CO TESTOWAĆ OŚMIOLINIJKOWĄ TRASĘ. Bo cała jej treść to SKLEJENIE, a
// sklejenie jest tu kontraktem adresu, nie detalem:
//
//   1. AKTYWNA ZAKŁADKA ŻYJE W ADRESIE (`?tab=errors`), więc jest linkowalna.
//      Nagłówek trasy obiecuje to wprost. `validateSearch` przyjmuje TRZY
//      wartości i musi odrzucić każdą inną - parametr wzięty z adresu bez
//      walidacji trafia prosto do `Tabs value=`, a Radix na nieznanej wartości
//      nie pokazuje ŻADNEJ zakładki. Czyli podrzucony `?tab=<cokolwiek>` daje
//      pustą stronę panelu.
//   2. DOMYŚLNA ZAKŁADKA NIE ZAPISUJE SIĘ W ADRESIE. Przejście na „Web Vitals"
//      czyści `tab`, a nie ustawia `tab=vitals` - inaczej ten sam widok miałby
//      dwa adresy i wpisy w historii mnożyłyby się przy każdym przełączeniu.
//   3. NAWIGACJA JEST `replace`. Klikanie zakładek nie ma zaśmiecać przycisku
//      „wstecz" - po trzech przełączeniach jedno cofnięcie musi wyprowadzić
//      z trasy, a nie odtwarzać kolejno poprzednie zakładki.
//   4. TEN SAM PULPIT W DWÓCH MIEJSCACH. Nagłówek trasy obiecuje, że zakładka
//      „Web Vitals" niesie DOKŁADNIE ten sam `VitalsBiDashboard`, co
//      `/admin/analytics` - obietnica bez testu wraca przy pierwszym
//      rozgałęzieniu layoutu.
//
// GRANICE. Atrapowane są trzy pulpity (mają własne, pełne pliki testowe -
// `vitalsBiDashboard.test.tsx`, `clientErrorsDashboard.test.tsx`,
// `edgeCacheCard.test.tsx`) oraz i18n. Prawdziwe biegną: `validateSearch`
// trasy, `Tabs` Radiksa i `Route.useNavigate()`, czyli dokładnie ta warstwa,
// której sam render komponentu nie dotyka.
//
// CZEGO TEN TEST NIE DOWODZI: uprawnień. Zestaw middleware trasy pilnuje
// bramka statyczna `check:authz-snapshot`, a nie render - w teście nie ma
// sesji, więc „użytkownik bez roli sztabowej" nie jest tu rozstrzygalny.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/components/admin/analytics/VitalsBiDashboard", () => ({
  VitalsBiDashboard: () => <div data-testid="pulpit-vitals" />,
}));
vi.mock("@/components/admin/analytics/ClientErrorsDashboard", () => ({
  ClientErrorsDashboard: () => <div data-testid="pulpit-bledow" />,
}));
vi.mock("@/components/admin/performance/EdgeCacheCard", () => ({
  EdgeCacheCard: () => <div data-testid="karta-cache" />,
}));

import { renderRoute, routeSearchValidator } from "@/test/routeHarness";
import { Route as PerformanceRoute } from "@/routes/admin.performance";

const PATH = "/admin/performance";

beforeEach(() => {
  cleanup();
  h.lang = "pl";
});

// ---------------------------------------------------------------------------
describe("kontrakt adresu", () => {
  const validate = routeSearchValidator(PerformanceRoute);

  it("przyjmuje TRZY znane zakładki", () => {
    expect(validate({ tab: "vitals" })).toEqual({ tab: "vitals" });
    expect(validate({ tab: "errors" })).toEqual({ tab: "errors" });
    expect(validate({ tab: "cache" })).toEqual({ tab: "cache" });
  });

  it("nieznana zakładka z adresu jest ZERWANA do `undefined`, nie przepuszczona", () => {
    // Wartość przepuszczona wprost do `Tabs value=` daje panel bez ŻADNEJ
    // widocznej zakładki - czyli podrzucony adres wywraca stronę.
    for (const tab of ["cokolwiek", "", "VITALS", 7, null, ["errors"], { tab: "errors" }]) {
      expect(validate({ tab })).toEqual({ tab: undefined });
    }
  });

  it("brak parametru jest poprawny - trasa ma domyślną zakładkę", () => {
    expect(validate({})).toEqual({ tab: undefined });
  });
});

// ---------------------------------------------------------------------------
describe("render zakładek", () => {
  it("bez parametru pokazuje pulpit RUM, a nie pozostałe dwa", async () => {
    await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: PATH });

    expect(screen.getByTestId("pulpit-vitals")).toBeTruthy();
    expect(screen.queryByTestId("pulpit-bledow")).toBeNull();
    expect(screen.queryByTestId("karta-cache")).toBeNull();
  });

  it("`?tab=errors` z adresu otwiera telemetrię błędów - zakładka JEST linkowalna", async () => {
    await renderRoute({
      route: PerformanceRoute,
      path: PATH,
      initialEntry: `${PATH}?tab=errors`,
    });

    expect(screen.getByTestId("pulpit-bledow")).toBeTruthy();
    expect(screen.queryByTestId("pulpit-vitals")).toBeNull();
  });

  it("`?tab=cache` z adresu otwiera kartę cache'a krawędziowego", async () => {
    await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: `${PATH}?tab=cache` });

    expect(screen.getByTestId("karta-cache")).toBeTruthy();
  });

  it("NIEZNANA zakładka w adresie spada na domyślną, a nie na pustą stronę", async () => {
    const view = await renderRoute({
      route: PerformanceRoute,
      path: PATH,
      initialEntry: `${PATH}?tab=nie-ma-takiej`,
    });

    expect(screen.getByTestId("pulpit-vitals")).toBeTruthy();
    expect(view.search()).toEqual({ tab: undefined });
  });

  it("nagłówek i podtytuł idą ze SŁOWNIKA, nie z tekstu wpisanego w komponencie", async () => {
    await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: PATH });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "admin.performance.title",
    );
    expect(screen.getByText("admin.performance.subtitle")).toBeTruthy();
  });

  it("wszystkie trzy zakładki mają dostępne nazwy - lista jest osiągalna klawiaturą", async () => {
    await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: PATH });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect((tab.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Radix aktywuje `TabsTrigger` na `mouseDown` (oraz klawiaturą), NIE na
// `click` - `fireEvent.click` nie wywołałby `onValueChange` i test „przechodziłby"
// na braku nawigacji. Ten sam wzorzec w repo: `PatternPicker.test.tsx`,
// `TocSettingsPanel.test.tsx`.
describe("przełączanie zakładek zapisuje się w adresie", () => {
  it("wybór zakładki niedomyślnej WPISUJE ją do adresu", async () => {
    const view = await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: PATH });

    await act(async () => {
      fireEvent.mouseDown(screen.getAllByRole("tab")[1]);
    });

    await vi.waitFor(() => expect(screen.getByTestId("pulpit-bledow")).toBeTruthy());
    expect(view.search()).toEqual({ tab: "errors" });
  });

  it("powrót na zakładkę DOMYŚLNĄ CZYŚCI parametr - jeden widok, jeden adres", async () => {
    // `tab=vitals` w adresie dałoby drugi adres tego samego widoku i mnożyłoby
    // wpisy w historii przy każdym przełączeniu.
    const view = await renderRoute({
      route: PerformanceRoute,
      path: PATH,
      initialEntry: `${PATH}?tab=cache`,
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getAllByRole("tab")[0]);
    });

    await vi.waitFor(() => expect(view.search()).toEqual({ tab: undefined }));
    expect(screen.getByTestId("pulpit-vitals")).toBeTruthy();
  });

  it("każda z trzech zakładek montuje SWÓJ pulpit i tylko jego", async () => {
    const view = await renderRoute({ route: PerformanceRoute, path: PATH, initialEntry: PATH });

    await act(async () => {
      fireEvent.mouseDown(screen.getAllByRole("tab")[2]);
    });
    await vi.waitFor(() => expect(view.search()).toEqual({ tab: "cache" }));
    expect(screen.getByTestId("karta-cache")).toBeTruthy();
    expect(screen.queryByTestId("pulpit-vitals")).toBeNull();
    expect(screen.queryByTestId("pulpit-bledow")).toBeNull();
  });
});
