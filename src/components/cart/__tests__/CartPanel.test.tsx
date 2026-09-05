// Koszyk uczestnika - ŚCIEŻKA PIENIĘDZY od odłożonej notatki do kasy.
//
// PRZEDMIOTEM DOWODU JEST KWOTA I ŁADUNEK, NIE RENDER. `CartPanel` to jedyne
// miejsce, w którym lista notatek zakupowych zamienia się w zamówienie
// u operatora płatności. Pięć rzeczy potrafi tu pójść źle tak, że code review
// tego nie zobaczy:
//
//   1. SUMA. Kwoty leżą w GROSZACH i mogą być w RÓŻNYCH walutach naraz
//      (PLN i EUR). Zsumowanie ich razem albo pominięcie dzielenia przez sto
//      daje liczbę, która wygląda wiarygodnie i jest fałszywa. Asercje sum są
//      tu na LITERAŁACH („170,00 zł"), a nie na wyniku `formatMoney` - inaczej
//      test potwierdzałby sam siebie.
//
//   2. PRZELICZENIE PO ZMIANIE LISTY. Usunięcie pozycji musi zmienić SUMĘ
//      i licznik, a nie tylko zniknąć wiersz. Dlatego po każdej operacji
//      czytamy kwotę, nie obecność węzła.
//
//   3. ŁADUNEK DO KASY. Do serwera jedzie WYŁĄCZNIE wskazanie pozycji
//      (`event_id`, `ticket_type_id`) plus ścieżki powrotu i środowisko bramki
//      - nigdy kwota z przeglądarki. Kod rabatowy jest tylko napisem: ma
//      dojechać przycięty i wersalikami albo nie dojechać wcale.
//
//   4. STAN PUSTY. Pusty koszyk (także po usunięciu OSTATNIEJ pozycji) to
//      osobny ekran z wyjściem do wydarzeń, a nie awaria ani pusta lista
//      z formularzem rabatu.
//
//   5. ADRES KASY. `clientSecret` ma pochodzić Z ODPOWIEDZI SERWERA i trafić
//      do modala co do znaku; tryb atrapy prowadzi na potwierdzenie
//      z NUMEREM ZAMÓWIENIA OD SERWERA.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` -> `useServerFn` zwraca przekazaną funkcję, więc
//     atrapa `createCheckoutOrder` jest wołana pod własną nazwą;
//   * `@/lib/billing/checkout.functions`, `@/lib/stripe`, `@/hooks/useAuth`
//     - warstwa sieci, SDK operatora i sesja;
//   * modal kasy - osobna powierzchnia z własnymi testami; atrapa WYSTAWIA
//     otrzymany sekret w DOM, bo tylko tak da się dowieść, skąd pochodzi;
//   * `@tanstack/react-router` - `Link` bez routera rzuca; `useNavigate` jest
//     spy'em, żeby dało się zmierzyć przekierowanie;
//   * `react-i18next` - PRAWDZIWY tłumacz (`realT`), więc asercje mierzą
//     słownik, a nie napis przepisany do testu.
//
// MAGAZYN KOSZYKA JEST PRAWDZIWY (`useCart` + `localStorage`): to lekki moduł
// na `useSyncExternalStore`, więc atrapowanie go zamieniłoby test w sprawdzanie
// własnej atrapy. Pozycje wstawiamy zdarzeniem `storage` - tym samym, którym
// koszyk synchronizuje karty przeglądarki.
//
// GRANICA DOWODU: nic tutaj nie dowodzi, że serwer policzy tę samą kwotę ani
// że kod rabatowy istnieje - to sprawa `createCheckoutOrder` i jego testów.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EmbeddedCheckoutDialogProps } from "@/components/checkout/checkoutDialogChunk";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  session: null as { user: { id: string } } | null,
  stripeEnv: "sandbox" as "sandbox" | "live",
  checkout: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// FABRYKA NIC NIE IMPORTUJE - skrót przez `reactI18nextMock` zakleszcza plik
// (fabryka sięgałaby po `@/lib/i18n`, a ten importuje właśnie mockowany moduł).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
// Częściowa atrapa: reszta pakietu (`createIsomorphicFn`, na którym stoi
// `@/lib/i18n`) musi zostać prawdziwa.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => h.stripeEnv }));
vi.mock("@/lib/billing/checkout.functions", () => ({ createCheckoutOrder: h.checkout }));
// Atrapa modala WYSTAWIA sekret w atrybucie - to jedyny sposób, żeby dowieść,
// że do kasy poszła wartość z odpowiedzi serwera, a nie sklejona na kliencie.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret, onOpenChange }: EmbeddedCheckoutDialogProps) =>
    clientSecret === null ? null : (
      <div data-testid="checkout-dialog" data-client-secret={clientSecret}>
        <button type="button" onClick={() => onOpenChange(false)}>
          zamknij kase
        </button>
        <button type="button" onClick={() => onOpenChange(true)}>
          zglos otwarcie kasy
        </button>
      </div>
    ),
}));

import { CartPanel } from "@/components/cart/organisms/CartPanel";
import { CART_STORAGE_KEY, type CartItem } from "@/lib/cart/cartStore";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-cart";

h.fixedT = realT;

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
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
    addedAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

/** Druga pozycja - inne wydarzenie, żeby tożsamości się nie zlewały. */
function secondItem(overrides: Partial<CartItem> = {}): CartItem {
  return item({
    id: `${OTHER_EVENT_ID}:default`,
    eventId: OTHER_EVENT_ID,
    ticketTypeId: null,
    slug: "forum-cee",
    titlePl: "Forum CEE",
    titleEn: "CEE Forum",
    ticketNamePl: "",
    ticketNameEn: "",
    priceCents: 5_000,
    ...overrides,
  });
}

/** `Intl` wstawia spację nierozdzielającą przed symbolem waluty. */
function normalizeSpaces(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Montuje panel i wstawia pozycje TYM SAMYM zdarzeniem, którym koszyk
 * synchronizuje karty przeglądarki. Migawka magazynu jest modułowa, więc żyje
 * dłużej niż jeden test - to jedyny sposób, żeby każdy przypadek startował
 * z własnej, znanej listy.
 */
function renderPanel(items: CartItem[] = []) {
  const view = render(<CartPanel />);
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: CART_STORAGE_KEY }));
  });
  return view;
}

/** Wiersz sumy dla danej waluty - po napisie ze słownika, nie po klasie CSS. */
function totalLine(currency: string): string {
  const label = realT(h.lang)("cart.total", { currency });
  return normalizeSpaces(
    screen.getByText((_, node) => normalizeSpaces(node?.textContent).startsWith(`${label}:`), {
      selector: "p",
    }).textContent,
  );
}

/** Obietnica z zewnętrznym spustem - do zatrzymania odpowiedzi w locie. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.session = { user: { id: "55555555-5555-4555-8555-555555555555" } };
  h.stripeEnv = "sandbox";
  h.checkout.mockResolvedValue({
    ok: true,
    mode: "stripe",
    clientSecret: "cs_x",
    orderId: ORDER_ID,
  });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("pusty koszyk jest stanem, nie awarią", () => {
  it("pokazuje komunikat pustki i wyjście do listy wydarzeń", () => {
    renderPanel([]);

    expect(screen.getByText(realT("pl")("cart.empty"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: realT("pl")("cart.browseEvents") })).toHaveAttribute(
      "href",
      "/events",
    );
    expect(screen.queryAllByTestId("cart-line")).toHaveLength(0);
  });

  it("nie pokazuje ani pola rabatu, ani podsumowania, gdy nie ma czego sumować", () => {
    // Formularz rabatu nad pustą listą to zaproszenie do wpisania kodu,
    // którego nie da się użyć.
    renderPanel([]);

    expect(screen.queryByLabelText(realT("pl")("cart.promoLabel"))).toBeNull();
    expect(screen.queryByRole("button", { name: realT("pl")("cart.clear") })).toBeNull();
  });

  it("pusty koszyk mówi po angielsku na angielskiej stronie", () => {
    h.lang = "en";
    renderPanel([]);

    expect(screen.getByText("Your cart is empty. Add tickets from an event page.")).toBeVisible();
    expect(screen.queryByText(realT("pl")("cart.empty"))).toBeNull();
  });
});

describe("SUMA jest liczona z pozycji, nie przepisana", () => {
  it("dwie pozycje w tej samej walucie dają jedną sumę i poprawny licznik", () => {
    // 12 000 gr + 5 000 gr = 170,00 zł. Asercja na literale: użycie
    // `formatMoney` po obu stronach dowiodłoby tylko, że dwa razy wywołano
    // tę samą funkcję.
    renderPanel([item(), secondItem()]);

    expect(screen.getAllByTestId("cart-line")).toHaveLength(2);
    expect(totalLine("PLN")).toBe("Razem (PLN): 170,00 zł");
    expect(screen.getByText(realT("pl")("cart.itemsCount", { count: 2 }))).toBeInTheDocument();
  });

  it("sto groszy to ZŁOTÓWKA, nie sto złotych", () => {
    renderPanel([item({ priceCents: 100 })]);

    expect(totalLine("PLN")).toBe("Razem (PLN): 1,00 zł");
  });

  it("waluty NIE są sumowane razem - każda ma własny wiersz", () => {
    // Zsumowanie PLN z EUR dałoby liczbę wyglądającą wiarygodnie i fałszywą.
    renderPanel([item(), secondItem({ currency: "EUR" })]);

    expect(totalLine("PLN")).toBe("Razem (PLN): 120,00 zł");
    expect(totalLine("EUR")).toBe("Razem (EUR): 50,00 €");
  });

  it("cena W WIERSZU jest ceną TEJ pozycji, a nie kwotą z podsumowania", () => {
    // Wiersz i stopka biorą kwotę z tego samego pola, ale przez DWA OSOBNE
    // wywołania `formatMoney`. Pomyłka w wierszu (kwota sumy zamiast ceny
    // pozycji, waluta sąsiada) nie ruszyłaby ani jednej asercji na
    // podsumowaniu - dlatego obie kwoty są tu czytane osobno, po wierszach.
    renderPanel([item(), secondItem({ currency: "EUR" })]);

    const [first, second] = screen.getAllByTestId("cart-line");
    expect(normalizeSpaces(within(first).getByText(/zł$/).textContent)).toBe("120,00 zł");
    expect(normalizeSpaces(within(second).getByText(/€$/).textContent)).toBe("50,00 €");
  });

  it("wiersze sum idą alfabetycznie po walucie, więc kolejność jest stabilna", () => {
    renderPanel([item(), secondItem({ currency: "EUR" })]);

    const labels = screen
      .getAllByText(/^Razem \(/, { selector: "p" })
      .map((node) => normalizeSpaces(node.textContent).slice(0, 11));
    expect(labels).toEqual(["Razem (EUR)", "Razem (PLN)"]);
  });

  it("usunięcie pozycji PRZELICZA sumę i licznik, a nie tylko chowa wiersz", () => {
    renderPanel([item(), secondItem()]);
    expect(totalLine("PLN")).toBe("Razem (PLN): 170,00 zł");

    fireEvent.click(screen.getAllByRole("button", { name: realT("pl")("cart.remove") })[1]);

    expect(screen.getAllByTestId("cart-line")).toHaveLength(1);
    expect(totalLine("PLN")).toBe("Razem (PLN): 120,00 zł");
    expect(screen.getByText(realT("pl")("cart.itemsCount", { count: 1 }))).toBeInTheDocument();
    expect(h.toastSuccess).toHaveBeenCalledWith(realT("pl")("cart.removed"));
  });

  it("suma po angielsku używa angielskiego formatu waluty", () => {
    h.lang = "en";
    renderPanel([item()]);

    expect(totalLine("PLN")).toBe("Total (PLN): PLN 120.00");
  });
});

describe("lista pozycji opisuje bilet w języku strony", () => {
  it("po polsku łączy tytuł wydarzenia z nazwą wejściówki", () => {
    renderPanel([item()]);

    expect(screen.getByText("Szczyt energetyczny - Wejściówka standard")).toBeInTheDocument();
  });

  it("po angielsku bierze angielskie kolumny, nie tłumaczy polskich", () => {
    h.lang = "en";
    renderPanel([item()]);

    expect(screen.getByText("Energy Summit - Standard pass")).toBeInTheDocument();
    expect(screen.queryByText(/Wejściówka standard/)).toBeNull();
  });

  it("pozycja bez nazwy wejściówki pokazuje sam tytuł, bez wiszącego myślnika", () => {
    renderPanel([secondItem()]);

    expect(screen.getByText("Forum CEE")).toBeInTheDocument();
  });

  it("każdy wiersz prowadzi na stronę SWOJEGO wydarzenia", () => {
    renderPanel([item(), secondItem()]);

    const links = screen.getAllByRole("link", { name: realT("pl")("cart.openEvent") });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/events/szczyt-energetyczny",
      "/events/forum-cee",
    ]);
  });
});

describe("opróżnianie koszyka wraca do stanu pustego", () => {
  it("usunięcie OSTATNIEJ pozycji pokazuje ekran pustki, a nie pustą listę", () => {
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.remove") }));

    expect(screen.getByText(realT("pl")("cart.empty"))).toBeInTheDocument();
    expect(screen.queryAllByTestId("cart-line")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: realT("pl")("cart.clear") })).toBeNull();
  });

  it("przycisk czyszczenia usuwa WSZYSTKIE pozycje i potwierdza to komunikatem", () => {
    renderPanel([item(), secondItem()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.clear") }));

    expect(screen.getByText(realT("pl")("cart.empty"))).toBeInTheDocument();
    expect(h.toastSuccess).toHaveBeenCalledWith(realT("pl")("cart.cleared"));
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe("[]");
  });
});

describe("do kasy jedzie WSKAZANIE POZYCJI, nie kwota z przeglądarki", () => {
  it("zamówienie niesie wydarzenie, rodzaj biletu, ścieżki powrotu i środowisko bramki", async () => {
    h.stripeEnv = "live";
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() =>
      expect(h.checkout).toHaveBeenCalledWith({
        data: {
          kind: "one_time",
          event_id: EVENT_ID,
          ticket_type_id: TICKET_ID,
          success_path: "/events/szczyt-energetyczny",
          cancel_path: "/cart",
          environment: "live",
        },
      }),
    );
  });

  it("płatność dotyczy KLIKNIĘTEJ pozycji, nie pierwszej z brzegu", async () => {
    renderPanel([item(), secondItem()]);

    fireEvent.click(screen.getAllByRole("button", { name: realT("pl")("cart.pay") })[1]);

    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
    expect(h.checkout).toHaveBeenCalledWith({
      data: expect.objectContaining({ event_id: OTHER_EVENT_ID, ticket_type_id: null }),
    });
  });

  it("pusty kod rabatowy NIE dokłada pola do ładunku", async () => {
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
    const payload = h.checkout.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(payload.data).not.toHaveProperty("coupon_code");
  });

  it("wpisany kod jedzie PRZYCIĘTY i WERSALIKAMI", async () => {
    // Kod jest tylko napisem - zniżkę liczy serwer. Jedyne, za co odpowiada
    // przeglądarka, to nie zepsuć go spacjami z wklejki.
    renderPanel([item()]);

    fireEvent.change(screen.getByLabelText(realT("pl")("cart.promoLabel")), {
      target: { value: "  nes2026  " },
    });
    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() =>
      expect(h.checkout).toHaveBeenCalledWith({
        data: expect.objectContaining({ coupon_code: "NES2026" }),
      }),
    );
  });

  it("pole rabatu pokazuje wpisaną wartość, więc kupujący widzi, co wyśle", () => {
    renderPanel([item()]);

    const promo = screen.getByLabelText(realT("pl")("cart.promoLabel"));
    fireEvent.change(promo, { target: { value: "nes2026" } });

    expect(promo).toHaveValue("nes2026");
  });
});

describe("adres kasy pochodzi z odpowiedzi serwera", () => {
  it("sekret sesji trafia do modala co do znaku", async () => {
    h.checkout.mockResolvedValue({
      ok: true,
      mode: "stripe",
      clientSecret: "cs_test_from_server_9f2",
      orderId: ORDER_ID,
    });
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    const dialog = await screen.findByTestId("checkout-dialog");
    expect(dialog).toHaveAttribute("data-client-secret", "cs_test_from_server_9f2");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("zamknięcie modala kasuje sekret, więc nie da się go użyć ponownie", async () => {
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));
    await screen.findByTestId("checkout-dialog");
    fireEvent.click(screen.getByRole("button", { name: "zamknij kase" }));

    await waitFor(() => expect(screen.queryByTestId("checkout-dialog")).toBeNull());
  });

  it("ponowne zgłoszenie otwarcia NIE kasuje sekretu sesji", async () => {
    // Biblioteka modala zgłasza `onOpenChange(true)` także wtedy, gdy kasa JUŻ
    // jest otwarta; skasowanie sekretu w tej gałęzi zamykałoby kasę w połowie.
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));
    const dialog = await screen.findByTestId("checkout-dialog");
    fireEvent.click(screen.getByRole("button", { name: "zglos otwarcie kasy" }));

    expect(screen.getByTestId("checkout-dialog")).toBe(dialog);
    expect(dialog).toHaveAttribute("data-client-secret", "cs_x");
  });

  it("tryb atrapy prowadzi na potwierdzenie z NUMEREM ZAMÓWIENIA OD SERWERA", async () => {
    h.checkout.mockResolvedValue({ ok: true, mode: "mock", orderId: ORDER_ID });
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: "/checkout/success",
        search: { order: ORDER_ID, mock: 1 },
      }),
    );
    expect(screen.queryByTestId("checkout-dialog")).toBeNull();
  });
});

describe("nieudana próba płatności nie zostawia kupującego w zawieszeniu", () => {
  it("niezalogowany dostaje prośbę o logowanie i ZERO zamówień", () => {
    h.session = null;
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    expect(h.checkout).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(realT("pl")("cart.signInToPay"));
  });

  it("prośba o logowanie mówi po angielsku na angielskiej stronie", () => {
    h.session = null;
    h.lang = "en";
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("en")("cart.pay") }));

    expect(h.toastError).toHaveBeenCalledWith("Sign in to complete the purchase.");
  });

  it("odmowa z powodu kodu rabatowego ma WŁASNY komunikat", async () => {
    // Jeden komunikat na wszystkie odmowy kazałby kupującemu zgadywać, czy
    // problem jest z kodem, czy z płatnością.
    h.checkout.mockResolvedValue({ ok: false, mode: "coupon" });
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(realT("pl")("cart.promoError")));
    expect(screen.queryByTestId("checkout-dialog")).toBeNull();
  });

  it("każda inna odmowa serwera daje komunikat o płatności", async () => {
    h.checkout.mockResolvedValue({ ok: false, mode: "provider" });
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(realT("pl")("cart.payError")));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("wyjątek sieciowy jest łapany tym samym komunikatem, bez białego ekranu", async () => {
    h.checkout.mockRejectedValue(new Error("network down"));
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(realT("pl")("cart.payError")));
    expect(screen.getAllByTestId("cart-line")).toHaveLength(1);
  });

  it("po nieudanej próbie przycisk wraca do gry", async () => {
    h.checkout.mockResolvedValue({ ok: false, mode: "provider" });
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: realT("pl")("cart.pay") })).toBeEnabled(),
    );
  });
});

describe("jeden zamiar zakupu to jedno zamówienie", () => {
  it("w trakcie otwierania kasy przycisk zmienia napis i jest wyłączony", async () => {
    const session = deferred<{ ok: true; mode: "stripe"; clientSecret: string; orderId: string }>();
    h.checkout.mockReturnValue(session.promise);
    renderPanel([item()]);

    fireEvent.click(screen.getByRole("button", { name: realT("pl")("cart.pay") }));

    const busy = await screen.findByRole("button", { name: realT("pl")("cart.paying") });
    expect(busy).toBeDisabled();

    await act(async () => {
      session.resolve({ ok: true, mode: "stripe", clientSecret: "cs_once", orderId: ORDER_ID });
    });
    expect(h.checkout).toHaveBeenCalledTimes(1);
  });

  it("blokada dotyczy TYLKO płaconej pozycji - resztę koszyka da się dalej obsłużyć", async () => {
    const session = deferred<{ ok: true; mode: "stripe"; clientSecret: string; orderId: string }>();
    h.checkout.mockReturnValue(session.promise);
    renderPanel([item(), secondItem()]);

    fireEvent.click(screen.getAllByRole("button", { name: realT("pl")("cart.pay") })[0]);

    await screen.findByRole("button", { name: realT("pl")("cart.paying") });
    expect(screen.getByRole("button", { name: realT("pl")("cart.pay") })).toBeEnabled();

    await act(async () => {
      session.resolve({ ok: true, mode: "stripe", clientSecret: "cs_once", orderId: ORDER_ID });
    });
  });
});
