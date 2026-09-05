// Atom „Dodaj do koszyka" - jedyne wejście do listy zakupowej czytelnika.
//
// CO TU JEST PRZYPINANE I DLACZEGO. Ten przycisk niczego nie płaci, ale to on
// decyduje, JAKI ładunek zobaczy później kasa: `CartPanel` wysyła do serwera
// `event_id` i `ticket_type_id` DOKŁADNIE z zapisanej tu notatki. Cztery rzeczy
// mogą tu pójść źle niezauważenie:
//
//   1. TOŻSAMOŚĆ POZYCJI. `cartItemId` skleja wydarzenie z rodzajem wejściówki,
//      a bilet bez cennika (`ticketTypeId === null`) dostaje sufiks `default`.
//      Gdyby dwa różne bilety tego samego wydarzenia dostały ten sam
//      identyfikator, drugie dodanie po cichu nadpisałoby pierwsze - dlatego
//      identyfikator jest tu asercją, a nie szczegółem.
//
//   2. KOMPLET ŁADUNKU. Kwota, waluta, slug i obie wersje językowe nazw
//      wędrują do magazynu w całości; ich brak widać dopiero na stronie
//      koszyka (pusty tytuł, zły adres powrotu ze Stripe'a).
//
//   3. STAN „JUŻ W KOSZYKU". Przycisk po dodaniu ma się WYŁĄCZYĆ - inaczej
//      kupujący klika drugi raz i nie wie, czy coś się stało.
//
//   4. DRUGA KARTA PRZEGLĄDARKI. Magazyn synchronizuje się zdarzeniem
//      `storage`; przycisk musi to zobaczyć, bo inaczej pokazuje „Dodaj",
//      podczas gdy pozycja już leży w koszyku.
//
// CO JEST ATRAPOWANE: wyłącznie `sonner` (powiadomienia) i `react-i18next`
// - ten drugi PRAWDZIWYM tłumaczem (`realT`), żeby asercja mierzyła słownik,
// a nie napis przepisany do testu. MAGAZYN KOSZYKA JEST PRAWDZIWY: to lekki
// moduł na `useSyncExternalStore` + `localStorage`, więc atrapowanie go
// zamieniłoby test w sprawdzanie własnej atrapy.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// FABRYKA NIC NIE IMPORTUJE - skrót przez `reactI18nextMock` zakleszcza plik
// (fabryka sięgałaby po `@/lib/i18n`, a ten importuje właśnie mockowany moduł).
// Prawdziwy tłumacz wjeżdża zwykłym importem na górze i jest wstrzykiwany niżej.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import { AddToCartButton, type AddToCartInput } from "@/components/cart/atoms/AddToCartButton";
import { CART_STORAGE_KEY, type CartItem } from "@/lib/cart/cartStore";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-cart";

h.fixedT = realT;

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function ticket(overrides: Partial<AddToCartInput> = {}): AddToCartInput {
  return {
    eventId: EVENT_ID,
    slug: "szczyt-energetyczny",
    titlePl: "Szczyt energetyczny",
    titleEn: "Energy Summit",
    ticketTypeId: TICKET_ID,
    ticketNamePl: "Wejściówka standard",
    ticketNameEn: "Standard pass",
    priceCents: 12_000,
    currency: "PLN",
    ...overrides,
  };
}

/** Zawartość magazynu tak, jak leży w przeglądarce - bez pośrednictwa hooka. */
function storedCart(): CartItem[] {
  const raw = window.localStorage.getItem(CART_STORAGE_KEY);
  return raw === null ? [] : (JSON.parse(raw) as CartItem[]);
}

/**
 * Wymusza odczyt magazynu z `localStorage` TYM SAMYM zdarzeniem, którym koszyk
 * synchronizuje karty przeglądarki. Potrzebne, bo migawka modułu żyje dłużej
 * niż pojedynczy test - a przy okazji jest to jedyny sposób, żeby przypiąć
 * ścieżkę „druga karta dołożyła pozycję".
 */
function syncFromOtherTab(items: CartItem[]): void {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: CART_STORAGE_KEY }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("dodanie biletu odkłada KOMPLETNĄ notatkę zakupową", () => {
  it("klik zapisuje pozycję z kwotą, walutą, slugiem i obiema wersjami nazw", () => {
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));

    const stored = storedCart();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: `${EVENT_ID}:${TICKET_ID}`,
      kind: "event_ticket",
      eventId: EVENT_ID,
      ticketTypeId: TICKET_ID,
      slug: "szczyt-energetyczny",
      titlePl: "Szczyt energetyczny",
      titleEn: "Energy Summit",
      ticketNamePl: "Wejściówka standard",
      ticketNameEn: "Standard pass",
      priceCents: 12_000,
      currency: "PLN",
    });
  });

  it("potwierdzenie dodania pochodzi ze słownika, nie z kodu komponentu", () => {
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));

    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(realT("pl")("cart.added"));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("bilet BEZ cennika dostaje tożsamość z sufiksem `default`, nie `null`", () => {
    // Wydarzenie bez rodzajów wejściówek ma `ticketTypeId === null`. Sklejenie
    // identyfikatora wprost z `null` dałoby napis „…:null" i dwa różne klucze
    // na tę samą pozycję po stronie odczytu.
    render(<AddToCartButton item={ticket({ ticketTypeId: null })} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));

    expect(storedCart()[0]).toMatchObject({ id: `${EVENT_ID}:default`, ticketTypeId: null });
  });

  it("chwila dodania jest znacznikiem ISO zegara, nie napisem z kodu", () => {
    // Znacznik decyduje o wygasaniu notatki (`pruneCart`, 30 dni), więc musi
    // być prawdziwą chwilą. Zegar jest zamrożony, żeby asercja była na wartości.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:15:00.000Z"));
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));

    expect(storedCart()[0].addedAt).toBe("2026-03-01T10:15:00.000Z");
  });
});

describe("przycisk mówi, w jakim stanie jest pozycja", () => {
  it("po dodaniu zamienia się w potwierdzenie i jest wyłączony", () => {
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));

    const inCart = screen.getByRole("button", { name: realT("pl")("cart.inCart") });
    expect(inCart).toBeDisabled();
    expect(screen.queryByRole("button", { name: realT("pl")("cart.addToCart") })).toBeNull();
  });

  it("wyłączony przycisk nie dokłada pozycji drugi raz", () => {
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.addToCart") }));
    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.inCart") }));

    expect(storedCart()).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("pozycja dołożona w DRUGIEJ KARCIE przełącza przycisk bez przeładowania", () => {
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);
    expect(screen.getByRole("button", { name: realT("pl")("cart.addToCart") })).toBeEnabled();

    syncFromOtherTab([
      {
        id: `${EVENT_ID}:${TICKET_ID}`,
        kind: "event_ticket",
        eventId: EVENT_ID,
        slug: "szczyt-energetyczny",
        titlePl: "Szczyt energetyczny",
        titleEn: "Energy Summit",
        ticketTypeId: TICKET_ID,
        ticketNamePl: "Wejściówka standard",
        ticketNameEn: "Standard pass",
        priceCents: 12_000,
        currency: "PLN",
        addedAt: new Date().toISOString(),
      },
    ]);

    expect(screen.getByRole("button", { name: realT("pl")("cart.inCart") })).toBeDisabled();
  });
});

describe("wariant angielski", () => {
  it("napis zachęty i potwierdzenie idą z angielskiego słownika", () => {
    h.lang = "en";
    render(<AddToCartButton item={ticket()} />);
    syncFromOtherTab([]);

    const add = screen.getByRole("button", { name: realT("en")("cart.addToCart") });
    expect(add.textContent).toContain("Add to cart");
    expect(add.textContent).not.toContain("Dodaj do koszyka");

    fireEvent.click(add);

    expect(h.toastSuccess).toHaveBeenCalledWith(realT("en")("cart.added"));
    expect(screen.getByRole("button", { name: realT("en")("cart.inCart") }).textContent).toContain(
      "In cart",
    );
  });
});
