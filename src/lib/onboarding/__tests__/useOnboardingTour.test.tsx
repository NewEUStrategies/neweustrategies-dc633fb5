// STEROWNIK PRZEWODNIKA: kto go włącza, kiedy milczy na zawsze i co pamięta.
//
// CO TEN PLIK DOWODZI. Hak jest jedynym miejscem, które decyduje o tym, czy
// redaktor zobaczy coachmarki - i o tym, czy zobaczy je PONOWNIE. Do tej pory
// 0% pokrycia, więc żadna z jego reguł nie miała dowodu:
//
//   1. START DOPIERO PO KLATCE. Hak nie włącza nakładki w tym samym przebiegu,
//      w którym się montuje, bo kotwice `data-tour` buildera jeszcze nie stoją
//      w drzewie. Gdyby włączał od razu, PIERWSZY krok mierzyłby nieistniejący
//      element i zamiast reflektora nad biblioteką widgetów pokazywałby kartę
//      na środku ekranu - dokładnie ten defekt, którego nakładka ma unikać.
//   2. ZAPAMIĘTANIE ZAKOŃCZENIA. Zamknięcie i dojście do końca zapisują to samo:
//      przewodnik nie ma prawa wrócić przy następnym wejściu do edytora. Bez
//      tego każde otwarcie posta wita redaktora tą samą wycieczką.
//   3. BRAMKI (`enabled`, `autoStart`, pusta lista kroków). Uruchomienie
//      przewodnika, gdy dane panelu jeszcze się wczytują, pokazuje reflektor nad
//      szkieletem interfejsu.
//   4. NAWIGACJA. `next` na OSTATNIM kroku kończy wycieczkę (a nie wychodzi za
//      tablicę), `prev` nie schodzi pod zero, `start` odtwarza od początku
//      wbrew zapisanemu zamknięciu (przycisk „pokaż przewodnik ponownie").
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - TRWAŁOŚCI I AWARII MAGAZYNU (uszkodzony wpis, tryb prywatny, SSR, kształt
//   klucza): `src/lib/onboarding/__tests__/tourStorageResilience.test.ts`.
// - RYSOWANIA I DOSTĘPNOŚCI NAKŁADKI (reflektor, pozycja dymka, Escape, axe):
//   `src/components/admin/onboarding/__tests__/CoachmarkTour.test.tsx`.
// - TREŚCI KROKÓW I PARYTETU PL/EN: `src/lib/onboarding/__tests__/tours.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { BUILDER_TOUR_STEPS } from "@/lib/onboarding/tours";
import { dismissTour, isTourDismissed } from "@/lib/onboarding/tourStorage";
import { useOnboardingTour } from "@/lib/onboarding/useOnboardingTour";

const ID = "builder";
/** Prawdziwe kroki produkcyjne - trzy wystarczają na całą nawigację. */
const KROKI = BUILDER_TOUR_STEPS.slice(0, 3);

/** Czeka na JEDNĄ klatkę animacji - hak odkłada start właśnie o tyle. */
async function poKlatce(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("automatyczny start", () => {
  it("świeży przewodnik NIE jest aktywny w przebiegu montowania, a dopiero po klatce", async () => {
    // Odwrotna kolejność (aktywny od razu) mierzyłaby kotwice, których jeszcze
    // nie ma w drzewie - patrz punkt 1 nagłówka.
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    expect(result.current.active).toBe(false);
    expect(result.current.currentStep).toBeNull();
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.currentStep).toEqual(KROKI[0]);
    expect(result.current.totalSteps).toBe(3);
    expect(result.current.stepIndex).toBe(0);
  });

  it("ZAMKNIĘTY wcześniej przewodnik nie startuje sam", async () => {
    dismissTour(ID);
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await poKlatce();
    expect(result.current.active).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  it("`enabled: false` wstrzymuje start, a przełączenie na `true` go wypuszcza", async () => {
    // Tak panel czeka na wczytanie danych: reflektor nad szkieletem interfejsu
    // pokazuje redaktorowi puste prostokąty i tłumaczy je jako funkcje.
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useOnboardingTour({ id: ID, steps: KROKI, enabled }),
      { initialProps: { enabled: false } },
    );
    await poKlatce();
    expect(result.current.active).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.active).toBe(true));
  });

  it("`autoStart: false` nie startuje sam, ale `start()` nadal działa", async () => {
    const { result } = renderHook(() =>
      useOnboardingTour({ id: ID, steps: KROKI, autoStart: false }),
    );
    await poKlatce();
    expect(result.current.active).toBe(false);
    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.currentStep).toEqual(KROKI[0]);
  });

  it("PUSTA lista kroków nie włącza nakładki bez treści", async () => {
    // Nakładka z `currentStep === null` byłaby ciemnym ekranem bez dymka.
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: [] }));
    await poKlatce();
    expect(result.current.active).toBe(false);
    expect(result.current.totalSteps).toBe(0);
    expect(result.current.currentStep).toBeNull();
  });

  it("odmontowanie PRZED klatką anuluje zaplanowany start", async () => {
    // Bez `cancelAnimationFrame` React dostałby `setState` na odmontowanym
    // komponencie przy każdym szybkim przejściu między zakładkami panelu.
    const anuluj = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    unmount();
    expect(anuluj).toHaveBeenCalledTimes(1);
    await poKlatce();
  });

  it("zablokowany magazyn nie blokuje przewodnika - startuje jak dla nowego konta", async () => {
    // `isTourDismissed` w gałęzi `catch` mówi „nie widziano", więc przewodnik
    // działa także w trybie prywatnym (tylko bez pamięci).
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(isTourDismissed(ID)).toBe(false);
  });
});

describe("nawigacja", () => {
  it("`next` idzie w przód, `prev` w tył", async () => {
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(1);
    expect(result.current.currentStep).toEqual(KROKI[1]);
    act(() => result.current.prev());
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.currentStep).toEqual(KROKI[0]);
  });

  it("`prev` na pierwszym kroku zostaje na zerze (żadnego ujemnego indeksu)", async () => {
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.prev());
    act(() => result.current.prev());
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.active).toBe(true);
  });

  it("`next` na OSTATNIM kroku kończy wycieczkę i zapisuje to na trwałe", async () => {
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.active).toBe(true);
    act(() => result.current.next());
    expect(result.current.active).toBe(false);
    // Indeks NIE wychodzi za tablicę - zostaje na ostatnim kroku.
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.currentStep).toBeNull();
    expect(isTourDismissed(ID)).toBe(true);
  });
});

describe("zamknięcie i pamięć", () => {
  it("`skip` gasi nakładkę i zapisuje zamknięcie", async () => {
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.skip());
    expect(result.current.active).toBe(false);
    expect(isTourDismissed(ID)).toBe(true);
  });

  it("`finish` zapisuje to samo co `skip` - to jedna i ta sama funkcja", async () => {
    // „Pomiń" i „Gotowe" mają w tym module IDENTYCZNE skutki: przewodnik nie
    // wróci. Test pilnuje, żeby rozdzielenie ich (np. „pomiń tylko dziś")
    // było zmianą ZAMIERZONĄ, a nie skutkiem ubocznym refaktoru.
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.skip).toBe(result.current.finish);
    act(() => result.current.finish());
    expect(isTourDismissed(ID)).toBe(true);
  });

  it("po zakończeniu PONOWNE wejście do edytora nie pokazuje przewodnika", async () => {
    const pierwsze = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(pierwsze.result.current.active).toBe(true));
    act(() => pierwsze.result.current.finish());
    pierwsze.unmount();

    const drugie = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await poKlatce();
    expect(drugie.result.current.active).toBe(false);
  });

  it("`start()` odtwarza wycieczkę OD POCZĄTKU wbrew zapisanemu zamknięciu", async () => {
    // To jest przycisk „pokaż przewodnik ponownie": musi zadziałać, mimo że
    // flaga zamknięcia siedzi w magazynie.
    const { result } = renderHook(() => useOnboardingTour({ id: ID, steps: KROKI }));
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.next());
    act(() => result.current.finish());
    expect(isTourDismissed(ID)).toBe(true);

    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.stepIndex).toBe(0);
    // STAN FAKTYCZNY: odtworzenie NIE czyści flagi zamknięcia (do tego jest
    // `resetTour`). Skutek jest pożądany: po odświeżeniu strony przewodnik
    // znów milczy, bo odtworzenie było jednorazowe i ręczne.
    expect(isTourDismissed(ID)).toBe(true);
  });

  it("zmiana wycieczki (inne `id`) startuje osobno, choć poprzednia jest zamknięta", async () => {
    dismissTour("builder");
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useOnboardingTour({ id, steps: KROKI }),
      { initialProps: { id: "builder" } },
    );
    await poKlatce();
    expect(result.current.active).toBe(false);
    rerender({ id: "blocks" });
    await waitFor(() => expect(result.current.active).toBe(true));
  });
});

describe("kroki, które znikają w trakcie", () => {
  it("STAN FAKTYCZNY: skrócenie listy kroków gasi dymek, ale wycieczka zostaje włączona", async () => {
    // Opis rzeczywistości, nie życzenie. Dzisiejsze wywołania (`Builder.tsx`,
    // `PostBlockEditor.tsx`) podają STAŁE tablice z `tours.ts`, więc ta ścieżka
    // jest niedostępna z produkcji. Gdyby jednak ktoś zaczął filtrować kroki po
    // uprawnieniach (a to jest naturalny następny krok tego modułu), to:
    // `active` zostaje `true`, `currentStep` staje się `null`, nakładka nie
    // rysuje NIC - i nie ma czym jej zamknąć, więc zamknięcie nigdy się nie
    // zapisze i przewodnik wróci przy następnym wejściu. Ten test jest po to,
    // żeby taka zmiana od razu tu zaświeciła.
    const { result, rerender } = renderHook(
      ({ steps }: { steps: typeof KROKI }) => useOnboardingTour({ id: ID, steps }),
      { initialProps: { steps: KROKI } },
    );
    await waitFor(() => expect(result.current.active).toBe(true));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(2);

    rerender({ steps: KROKI.slice(0, 1) });
    expect(result.current.active).toBe(true);
    expect(result.current.currentStep).toBeNull();
    expect(result.current.totalSteps).toBe(1);
    expect(isTourDismissed(ID)).toBe(false);
  });
});
