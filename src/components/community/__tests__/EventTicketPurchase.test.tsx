// Zakup biletu na wydarzenie - 51 linii ŚCIEŻKI PŁATNICZEJ, do dziś 0% pokrycia.
//
// PRZEDMIOTEM DOWODU JEST PIENIĄDZ I STAN, NIE RENDER. Ten komponent jest
// jedynym miejscem w publicznej części serwisu, w którym klik czytelnika
// zakłada zamówienie u operatora płatności. Cztery rzeczy mogą tu pójść źle
// tak, że nikt tego nie zauważy w code review:
//
//   1. RZĄD WIELKOŚCI. Cena leży w bazie w GROSZACH. Pominięcie dzielenia
//      przez sto zamienia „1,00 zł" w „100,00 zł" i odwrotnie - a napis na
//      przycisku jest jedyną informacją o kwocie, jaką kupujący widzi PRZED
//      wejściem do kasy. Dlatego asercje kwot są tu na literałach
//      (`1,00 zł`, `100,00 zł`), a nie na wyniku tej samej funkcji, którą
//      liczy komponent - inaczej test potwierdzałby sam siebie.
//
//   2. DWIE SESJE Z JEDNEGO ZAMIARU. Podwójny klik w „Kup bilet" nie może
//      założyć dwóch zamówień. Strażnikiem jest stan `busy` i `disabled`
//      przycisku; test mierzy LICZBĘ WYWOŁAŃ `createCheckoutOrder`, bo tylko
//      ona jest skutkiem, a nie wyglądem.
//
//   3. SKĄD POCHODZI ADRES KASY. `clientSecret` i `orderId` mają przyjść
//      Z ODPOWIEDZI SERWERA i trafić dalej co do znaku. Gdyby klient sklejał
//      je sam (albo cache'ował poprzednie), kupujący płaciłby za cudze
//      zamówienie. Atrapa modala wystawia otrzymany sekret w DOM właśnie po
//      to, żeby dało się to porównać.
//
//   4. TRZY ŚCIEŻKI KATALOGU CZŁONKOSTW. Bilet WLICZONY w plan prowadzi do
//      ZAPISU (`rsvp_event`), a nie do kasy - wysłanie takiego członka do
//      checkoutu kończy się zamówieniem na zero. Bilet ZNIŻKOWY liczy kwotę
//      z puli i pokazuje cenę katalogową obok. Bilet PEŁNOPŁATNY idzie do
//      kasy. Każda z nich ma tu własny opis.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * `@tanstack/react-start` -> `useServerFn` zwraca przekazaną funkcję, więc
//     atrapy server fn (`createCheckoutOrder`, `getMyTicketAllowance`) są
//     wywoływane pod własnymi nazwami i widać, KTÓRA z nich poszła;
//   * `@/lib/community/publicQueries` - `rsvpEvent` woła Supabase po sieci;
//   * `@/lib/stripe` - prawdziwy moduł dociąga SDK operatora;
//   * modal kasy i przycisk koszyka - to osobne powierzchnie z własnymi
//     testami; tutaj interesuje nas WYŁĄCZNIE to, co komponent im podaje;
//   * `react-i18next` - PRAWDZIWY tłumacz (`realT`), żeby asercja mierzyła
//     słownik, a nie napis przepisany do testu.
//
// GRANICA DOWODU: nic tutaj nie dowodzi autoryzacji ani tego, że serwer
// policzy tę samą kwotę. Bramkę trzyma `rsvp_event` i `createCheckoutOrder`
// (własne testy warstwy serwerowej); ten plik odpowiada wyłącznie za to, co
// widzi i klika kupujący.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { EmbeddedCheckoutDialogProps } from "@/components/checkout/checkoutDialogChunk";
import type { AddToCartInput } from "@/components/cart/atoms/AddToCartButton";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
  session: null as { user: { id: string } } | null,
  stripeEnv: "sandbox" as "sandbox" | "live",
  checkout: vi.fn(),
  loadAllowance: vi.fn(),
  rsvp: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  claimed: vi.fn(),
}));

// FABRYKA NIC NIE IMPORTUJE - udokumentowany skrót
// `vi.mock("react-i18next", async () => (...).reactI18nextMock(lang))` ZAKLESZCZA
// ten plik: fabryka sięgałaby po `@/lib/i18n`, a ten importuje właśnie mockowany
// moduł (sprawdzone: przebieg wisi bez jednej linii logu aż do zabicia procesu;
// ten sam wniosek ma `community/__tests__/ReputationLevelChip.test.tsx`).
// Prawdziwy tłumacz wjeżdża zwykłym importem NA GÓRZE i jest wstrzykiwany do
// atrapy po jego rozwiązaniu.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
// Częściowa atrapa: reszta pakietu (`createIsomorphicFn`, na którym stoi
// `@/lib/i18n`) musi zostać prawdziwa. Podmieniamy WYŁĄCZNIE `useServerFn`,
// i to na identyczność - dzięki temu atrapy server fn są wołane pod własnymi
// nazwami i w asercji widać, KTÓRA z nich poszła.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => h.stripeEnv }));
vi.mock("@/lib/billing/checkout.functions", () => ({ createCheckoutOrder: h.checkout }));
vi.mock("@/lib/events/ticketAllowance.functions", () => ({
  getMyTicketAllowance: h.loadAllowance,
}));
vi.mock("@/lib/community/publicQueries", () => ({ rsvpEvent: h.rsvp }));
// Atrapa modala WYSTAWIA sekret w atrybucie - to jedyny sposób, żeby udowodnić,
// że do kasy poszła wartość z odpowiedzi serwera, a nie sklejona na kliencie.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret, onOpenChange }: EmbeddedCheckoutDialogProps) =>
    clientSecret === null ? null : (
      <div data-testid="checkout-dialog" data-client-secret={clientSecret}>
        <button type="button" onClick={() => onOpenChange(false)}>
          zamknij kase
        </button>
        {/* Radix zgłasza `onOpenChange(true)` także przy PONOWNYM otwarciu tego
            samego modala - komponent musi to zignorować, a nie skasować sekret. */}
        <button type="button" onClick={() => onOpenChange(true)}>
          zglos otwarcie kasy
        </button>
      </div>
    ),
}));
// Koszyk odkłada bilet jako notatkę - tutaj liczy się WYŁĄCZNIE kwota, którą
// dostaje: musi być tą samą, którą pokazuje przycisk zakupu.
vi.mock("@/components/cart/atoms/AddToCartButton", () => ({
  AddToCartButton: ({ item }: { item: AddToCartInput }) => (
    <button
      type="button"
      data-testid="add-to-cart"
      data-price={String(item.priceCents)}
      data-currency={item.currency}
      data-event={item.eventId}
    >
      do koszyka
    </button>
  ),
}));

import {
  EventTicketPurchase,
  type EventTicketPurchaseProps,
} from "@/components/community/EventTicketPurchase";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { EVENT_IDS } from "@/test/events/fixtures";
import "@/lib/i18n-community";
import "@/lib/i18n-profile";

h.fixedT = realT;

const SLUG = "szczyt-energetyczny";

/** Odpowiedź RPC `my_ticket_allowance` w kształcie, jaki widzi klient. */
function allowanceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    granted: 0,
    used: 0,
    discount_pct: 0,
    scope: "none",
    org_id: null,
    period_start: null,
    period_end: null,
    ...overrides,
  };
}

function renderPurchase(overrides: Partial<EventTicketPurchaseProps> = {}) {
  return renderWithQueryClient(
    <EventTicketPurchase
      eventId={EVENT_IDS.event}
      slug={SLUG}
      priceCents={12000}
      currency="PLN"
      lang={h.lang}
      hasTicket={false}
      isPast={false}
      isFull={false}
      onClaimed={h.claimed}
      {...overrides}
    />,
  );
}

/**
 * Obietnica z zewnętrznym spustem - potrzebna tam, gdzie test musi ZATRZYMAĆ
 * odpowiedź w locie (podwójny klik, odmontowanie w trakcie). Ten sam idiom co
 * `src/components/admin/seo/__tests__/UrlInspectionWidget.test.tsx`.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Spacja nierozdzielająca z `Intl` sprowadzona do zwykłej - patrz asercja zniżki. */
function normalizeSpaces(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Domknięcie odczytu puli biletów. PIERWSZY render pokazuje pełną cenę (pusta
 * pula), więc asercja bez tego czekania mierzy stan SPRZED odpowiedzi serwera.
 * `act` księguje aktualizację stanu po odpowiedzi - bez niego React zgłasza
 * „update was not wrapped in act", a to jest ostrzeżenie o teście, który
 * kończy się w połowie renderu.
 */
async function settle(): Promise<void> {
  if (h.session) await waitFor(() => expect(h.loadAllowance).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

/** Przycisk zakupu po ustaleniu się puli - pula jest asynchroniczna. */
async function buyButton(): Promise<HTMLElement> {
  await settle();
  return screen.findByRole("button", { name: /Kup bilet|Buy ticket|Brak miejsc|Sold out/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.session = { user: { id: EVENT_IDS.user } };
  h.stripeEnv = "sandbox";
  // Domyślnie: żadnej puli i żadnej zniżki, czyli pełna cena katalogowa.
  h.loadAllowance.mockResolvedValue(allowanceRow());
  h.checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_x", orderId: "o_x" });
});

describe("kiedy kasy nie ma w ogóle", () => {
  it("bilet już opłacony zastępuje kasę potwierdzeniem", async () => {
    // Po webhooku RSVP jest „going" - pokazanie wtedy przycisku zakupu byłoby
    // zaproszeniem do zapłacenia drugi raz za to samo miejsce.
    const { container } = renderPurchase({ hasTicket: true });
    await settle();
    expect(container.textContent).toContain("Bilet opłacony");
    expect(screen.queryByRole("button")).toBeNull();
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it("potwierdzenie mówi po angielsku, gdy strona jest angielska", async () => {
    h.lang = "en";
    const { container } = renderPurchase({ hasTicket: true, lang: "en" });
    await settle();
    expect(container.textContent).toContain("Ticket paid");
    expect(container.textContent).not.toContain("Bilet opłacony");
  });

  it("wydarzenie z przeszłości nie renderuje niczego", async () => {
    const { container } = renderPurchase({ isPast: true });
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it("potwierdzenie biletu wygrywa z datą przeszłą", async () => {
    // Kolejność ma znaczenie: uczestnik archiwalnego wydarzenia dalej chce
    // widzieć, że bilet był opłacony (bilet jest dowodem, nie zaproszeniem).
    const { container } = renderPurchase({ hasTicket: true, isPast: true });
    await settle();
    expect(container.textContent).toContain("Bilet opłacony");
  });
});

describe("kwota na przycisku jest wyliczona z danych, nie z literału", () => {
  it("sto groszy to ZŁOTÓWKA, nie sto złotych", async () => {
    // Klasyczne miejsce na błąd o rząd wielkości. Asercja jest na literale,
    // bo użycie `formatMoney` po obu stronach udowodniłoby tylko, że dwa razy
    // wywołano tę samą funkcję.
    renderPurchase({ priceCents: 100 });
    const text = (await buyButton()).textContent ?? "";
    expect(text).toContain("1,00");
    expect(text).not.toContain("100,00");
  });

  it("dziesięć tysięcy groszy to sto złotych - zero na końcu nie ginie", async () => {
    renderPurchase({ priceCents: 10_000 });
    expect((await buyButton()).textContent).toContain("100,00");
  });

  it("waluta i separator idą z danych i z języka strony", async () => {
    h.lang = "en";
    renderPurchase({ priceCents: 12_000, currency: "EUR", lang: "en" });
    const text = (await buyButton()).textContent ?? "";
    expect(text).toContain("€120.00");
    expect(text).not.toContain("zł");
  });

  it("cały napis przycisku pochodzi ze słownika, nie z kodu komponentu", async () => {
    renderPurchase({ priceCents: 12_000 });
    const expected = realT("pl")("community.events.buyTicket", { price: "120,00 zł" });
    expect((await buyButton()).textContent).toBe(expected);
  });

  it("koszyk dostaje DOKŁADNIE tę kwotę, którą widzi kupujący", async () => {
    renderPurchase({ priceCents: 12_000, currency: "EUR" });
    await buyButton();
    const cart = screen.getByTestId("add-to-cart");
    expect(cart).toHaveAttribute("data-price", "12000");
    expect(cart).toHaveAttribute("data-currency", "EUR");
    expect(cart).toHaveAttribute("data-event", EVENT_IDS.event);
  });
});

describe("jeden zamiar zakupu to jedno zamówienie", () => {
  it("podwójny klik nie zakłada dwóch sesji płatności", async () => {
    // Strażnikiem jest `busy` + `disabled`. Mierzymy SKUTEK (liczbę wywołań
    // server fn), bo to on kosztuje kupującego pieniądze.
    const session = deferred<{ ok: true; mode: "stripe"; clientSecret: string; orderId: string }>();
    h.checkout.mockReturnValue(session.promise);
    renderPurchase();
    const button = await buyButton();
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(h.checkout).toHaveBeenCalledTimes(1);
    session.resolve({ ok: true, mode: "stripe", clientSecret: "cs_once", orderId: "o_1" });
    await screen.findByTestId("checkout-dialog");
  });

  it("po nieudanej próbie przycisk wraca do gry", async () => {
    h.checkout.mockResolvedValue({ ok: false, reason: "provider_mode" });
    renderPurchase();
    const button = await buyButton();
    fireEvent.click(button);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("awaria tworzenia sesji nie przenosi nigdzie kupującego", () => {
  it("odmowa serwera daje komunikat i zero przekierowań", async () => {
    h.checkout.mockResolvedValue({ ok: false, reason: "provider_mode" });
    renderPurchase();
    fireEvent.click(await buyButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(realT("pl")("checkout.paymentsNotConfigured")),
    );
    expect(screen.queryByTestId("checkout-dialog")).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("wyjątek sieciowy jest łapany tym samym komunikatem", async () => {
    h.checkout.mockRejectedValue(new Error("network down"));
    renderPurchase();
    fireEvent.click(await buyButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(realT("pl")("checkout.paymentsNotConfigured")),
    );
    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("checkout-dialog")).toBeNull();
  });

  it("niezalogowany nie zakłada zamówienia, tylko dostaje prośbę o logowanie", async () => {
    h.session = null;
    renderPurchase();
    fireEvent.click(await buyButton());
    expect(h.checkout).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("Zaloguj się, aby kupić bilet.");
    expect(h.loadAllowance).not.toHaveBeenCalled();
  });

  it("prośba o logowanie mówi po angielsku na angielskiej stronie", async () => {
    h.session = null;
    h.lang = "en";
    renderPurchase({ lang: "en" });
    fireEvent.click(await buyButton());
    expect(h.toastError).toHaveBeenCalledWith("Sign in to purchase a ticket.");
  });
});

describe("adres kasy pochodzi z odpowiedzi serwera", () => {
  it("sekret sesji trafia do modala co do znaku", async () => {
    h.checkout.mockResolvedValue({
      ok: true,
      mode: "stripe",
      clientSecret: "cs_test_from_server_9f2",
      orderId: EVENT_IDS.order,
    });
    renderPurchase();
    fireEvent.click(await buyButton());
    const dialog = await screen.findByTestId("checkout-dialog");
    expect(dialog).toHaveAttribute("data-client-secret", "cs_test_from_server_9f2");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("zamknięcie modala kasuje sekret, więc nie da się go użyć ponownie", async () => {
    renderPurchase();
    fireEvent.click(await buyButton());
    await screen.findByTestId("checkout-dialog");
    fireEvent.click(screen.getByRole("button", { name: "zamknij kase" }));
    await waitFor(() => expect(screen.queryByTestId("checkout-dialog")).toBeNull());
  });

  it("ponowne zgłoszenie otwarcia nie kasuje sekretu sesji", async () => {
    // `onOpenChange(true)` przychodzi od biblioteki modala także wtedy, gdy
    // kasa JUŻ jest otwarta. Skasowanie sekretu w tej gałęzi zamykałoby kasę
    // w połowie płatności.
    renderPurchase();
    fireEvent.click(await buyButton());
    const dialog = await screen.findByTestId("checkout-dialog");
    fireEvent.click(screen.getByRole("button", { name: "zglos otwarcie kasy" }));
    expect(screen.getByTestId("checkout-dialog")).toBe(dialog);
    expect(dialog).toHaveAttribute("data-client-secret", "cs_x");
  });

  it("tryb atrapy prowadzi na potwierdzenie z NUMEREM ZAMÓWIENIA OD SERWERA", async () => {
    h.checkout.mockResolvedValue({ ok: true, mode: "mock", orderId: EVENT_IDS.order });
    renderPurchase();
    fireEvent.click(await buyButton());
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: "/checkout/success",
        search: { order: EVENT_IDS.order, mock: 1 },
      }),
    );
    expect(screen.queryByTestId("checkout-dialog")).toBeNull();
  });

  it("zamówienie niesie wydarzenie, ścieżki powrotu i środowisko bramki", async () => {
    h.stripeEnv = "live";
    renderPurchase();
    fireEvent.click(await buyButton());
    await waitFor(() =>
      expect(h.checkout).toHaveBeenCalledWith({
        data: {
          kind: "one_time",
          event_id: EVENT_IDS.event,
          success_path: `/events/${SLUG}`,
          cancel_path: `/events/${SLUG}`,
          environment: "live",
        },
      }),
    );
  });
});

describe("brak miejsc zamyka obie ścieżki", () => {
  it("wyprzedane wydarzenie ma przycisk zablokowany i bez ceny", async () => {
    renderPurchase({ isFull: true });
    const button = await buyButton();
    expect(button).toBeDisabled();
    expect(button.textContent).toBe(realT("pl")("community.events.soldOut"));
    expect(button.textContent).not.toContain("120,00");
  });

  it("wyprzedane wydarzenie nie pozwala nawet odłożyć biletu do koszyka", async () => {
    renderPurchase({ isFull: true });
    await buyButton();
    expect(screen.queryByTestId("add-to-cart")).toBeNull();
  });

  it("wyprzedana pula planu też nie pozwala odebrać biletu", async () => {
    // Napis „Brak miejsc" niesie TAKŻE ścieżka pełnopłatna, a pierwszy render
    // (pula jeszcze nie wróciła) jest właśnie pełnopłatny. Dowodem, że patrzymy
    // na ścieżkę WLICZONEGO biletu, jest licznik puli obok przycisku.
    h.loadAllowance.mockResolvedValue(allowanceRow({ granted: 1, used: 0, scope: "personal" }));
    renderPurchase({ isFull: true });
    await screen.findByText(/Bilet wliczony w Twoje członkostwo/);
    const button = screen.getByRole("button", {
      name: realT("pl")("community.events.soldOut"),
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(h.rsvp).not.toHaveBeenCalled();
    expect(h.checkout).not.toHaveBeenCalled();
  });
});

describe("bilet wliczony w plan prowadzi do ZAPISU, nie do kasy", () => {
  const personalPool = () =>
    h.loadAllowance.mockResolvedValue(allowanceRow({ granted: 2, used: 1, scope: "personal" }));

  it("członek z pulą dostaje przycisk odbioru i licznik pozostałych biletów", async () => {
    personalPool();
    renderPurchase();
    const button = await screen.findByRole("button", {
      name: realT("pl")("community.events.claimIncludedTicket"),
    });
    expect(button).toBeEnabled();
    expect(screen.getByText(/Pozostało w tym roku: 1/)).toBeInTheDocument();
    expect(screen.queryByTestId("add-to-cart")).toBeNull();
  });

  it("pula organizacji nazywa się inaczej niż pula własna", async () => {
    h.loadAllowance.mockResolvedValue(
      allowanceRow({ granted: 5, used: 2, scope: "organisation", org_id: EVENT_IDS.otherEvent }),
    );
    renderPurchase();
    await screen.findByRole("button", {
      name: realT("pl")("community.events.claimIncludedTicket"),
    });
    expect(
      screen.getByText(realT("pl")("community.events.ticketPoolOrg", { remaining: 3 })),
    ).toBeInTheDocument();
  });

  it("odbiór biletu woła rsvp_event, a nie kasę", async () => {
    personalPool();
    h.rsvp.mockResolvedValue({ status: "going", going: 12, waitlist: 0, waitlist_position: null });
    renderPurchase();
    fireEvent.click(
      await screen.findByRole("button", {
        name: realT("pl")("community.events.claimIncludedTicket"),
      }),
    );
    await waitFor(() => expect(h.rsvp).toHaveBeenCalledWith(EVENT_IDS.event, "going"));
    expect(h.checkout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(realT("pl")("community.events.ticketClaimed")),
    );
    expect(h.claimed).toHaveBeenCalledTimes(1);
  });

  it("pełna sala przy odbiorze daje pozycję na liście rezerwowej, nie sukces wejścia", async () => {
    personalPool();
    h.rsvp.mockResolvedValue({ status: "waitlist", going: 30, waitlist: 4, waitlist_position: 4 });
    renderPurchase();
    fireEvent.click(
      await screen.findByRole("button", {
        name: realT("pl")("community.events.claimIncludedTicket"),
      }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        realT("pl")("community.events.toastWaitlist", { position: 4 }),
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith(realT("pl")("community.events.ticketClaimed"));
    expect(h.claimed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ticket required", "community.events.ticketRequired"],
    ["chatham house rule", "community.events.rsvpTierError"],
    ["membership required", "community.events.rsvpTierError"],
    ["event is full", "community.events.rsvpFull"],
    ["cokolwiek innego", "community.events.rsvpError"],
  ])("odmowa bazy %s mapuje się na własny komunikat", async (message, key) => {
    // Baza odmawia z RÓŻNYCH powodów (brak biletu, warstwa, Chatham House,
    // brak miejsc). Jeden komunikat na wszystkie kazałby członkowi zgadywać,
    // czy ma dokupić bilet, czy podnieść plan.
    personalPool();
    h.rsvp.mockRejectedValue(new Error(message));
    renderPurchase();
    fireEvent.click(
      await screen.findByRole("button", {
        name: realT("pl")("community.events.claimIncludedTicket"),
      }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(realT("pl")(key)));
    expect(h.claimed).not.toHaveBeenCalled();
  });

  it("odmowa bez obiektu Error też kończy się komunikatem, a nie białym ekranem", async () => {
    personalPool();
    h.rsvp.mockRejectedValue("ticket required");
    renderPurchase();
    fireEvent.click(
      await screen.findByRole("button", {
        name: realT("pl")("community.events.claimIncludedTicket"),
      }),
    );
    // Napis bez `Error` nie ma `.message`, więc mapowanie musi spaść na ogólny
    // komunikat - a nie wywalić render.
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(realT("pl")("community.events.rsvpError")),
    );
  });

  it("awaria odczytu puli degraduje do PEŁNEJ ceny, nie do darmowego biletu", async () => {
    // Kierunek degradacji jest regułą bezpieczeństwa: błąd sieci nie może
    // rozdawać wejściówek.
    h.loadAllowance.mockRejectedValue(new Error("rpc down"));
    renderPurchase();
    const button = await buyButton();
    expect(button.textContent).toContain("120,00");
    expect(
      screen.queryByRole("button", {
        name: realT("pl")("community.events.claimIncludedTicket"),
      }),
    ).toBeNull();
  });

  it("kształt odpowiedzi spoza kontraktu też znaczy PEŁNA cena", async () => {
    h.loadAllowance.mockResolvedValue(["nie taki kształt"]);
    renderPurchase();
    expect((await buyButton()).textContent).toContain("120,00");
  });
});

describe("zniżka stawki ulgowej", () => {
  it("liczy połowę ceny i pokazuje obok cenę katalogową", async () => {
    h.loadAllowance.mockResolvedValue(allowanceRow({ discount_pct: 50, scope: "personal" }));
    renderPurchase({ priceCents: 12_000 });
    // Adnotacja o zniżce pojawia się DOPIERO po odczycie puli - dopiero wtedy
    // wolno czytać kwotę. Bez tego test mierzyłby pierwszy render, czyli cenę
    // katalogową, i świeciłby zielono na złej kwocie.
    await screen.findByText(/Zniżka 50%/);
    const text = (await buyButton()).textContent ?? "";
    expect(text).toContain("60,00");
    expect(text).not.toContain("120,00");
    // Porównanie na ZNORMALIZOWANYCH odstępach: `Intl` wstawia przed symbolem
    // waluty spację nierozdzielającą, a Testing Library normalizuje ją przy
    // wyszukiwaniu po tekście - bez tego asercja mierzyłaby kodowanie spacji,
    // a nie treść zdania.
    const hint = await screen.findByText(/Zniżka 50%/);
    expect(normalizeSpaces(hint.textContent)).toBe(
      normalizeSpaces(
        realT("pl")("community.events.ticketMemberDiscount", { pct: 50, full: "120,00 zł" }),
      ),
    );
  });

  it("koszyk dostaje kwotę PO zniżce, a nie katalogową", async () => {
    h.loadAllowance.mockResolvedValue(allowanceRow({ discount_pct: 50, scope: "personal" }));
    renderPurchase({ priceCents: 12_000 });
    // Adnotacja o zniżce pojawia się DOPIERO po odczycie puli - dopiero wtedy
    // wolno czytać kwotę. Bez tego test mierzyłby pierwszy render, czyli cenę
    // katalogową, i świeciłby zielono na złej kwocie.
    await screen.findByText(/Zniżka 50%/);
    await buyButton();
    expect(screen.getByTestId("add-to-cart")).toHaveAttribute("data-price", "6000");
  });
});

describe("wydarzenie bezpłatne", () => {
  it("KONTROLA DODATNIA: wydarzenie płatne pokazuje ścieżkę płatną", async () => {
    // Sąsiedni, poprawny przypadek. Dowodzi, że zapytanie „czy jest przycisk
    // Kup bilet" w ogóle potrafi znaleźć ten przycisk - czyli że test poniżej
    // pada z powodu zachowania komponentu, a nie z powodu złego selektora.
    renderPurchase({ priceCents: 12_000 });
    expect(await screen.findByRole("button", { name: /Kup bilet/ })).toBeInTheDocument();
  });

  it("bezpłatnego biletu nie da się odłożyć do koszyka", async () => {
    // Ta połowa reguły JEST zaimplementowana - koszyk zna tylko bilety płatne.
    renderPurchase({ priceCents: 0 });
    await buyButton();
    expect(screen.queryByTestId("add-to-cart")).toBeNull();
  });

  it.fails("ZNALEZISKO: wydarzenie bezpłatne nie proponuje kasy na zero złotych", async () => {
    // Kontrakt: `ticketOffer` zwraca `{ kind: "free" }` dla ceny 0 i null,
    // a mimo to komponent renderuje „Kup bilet - 0,00 zł" prowadzący do
    // `createCheckoutOrder`. Serwer takie zamówienie odrzuca, więc kupujący
    // dostaje ścianę zamiast miejsca. Właściwym wyjściem jest ścieżka zapisu
    // (jak przy bilecie wliczonym) albo brak kontrolki.
    renderPurchase({ priceCents: 0 });
    await screen.findByRole("button");
    expect(screen.queryByRole("button", { name: /Kup bilet|0,00/ })).toBeNull();
  });
});

describe("dostępność", () => {
  it("ścieżka płatna nie ma naruszeń axe", async () => {
    const { container } = renderPurchase({ priceCents: 12_000 });
    await buyButton();
    await settle();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ścieżka biletu wliczonego nie ma naruszeń axe", async () => {
    h.loadAllowance.mockResolvedValue(allowanceRow({ granted: 1, used: 0, scope: "personal" }));
    const { container } = renderPurchase();
    await screen.findByRole("button", {
      name: realT("pl")("community.events.claimIncludedTicket"),
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("potwierdzenie opłaconego biletu jest ogłaszane czytnikowi ekranu", async () => {
    const { container } = renderPurchase({ hasTicket: true });
    await settle();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
