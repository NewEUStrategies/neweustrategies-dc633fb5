// Zakup PAKIETU GRUPOWEGO oczami płatnika: oferta, wycena, zamówienie,
// rozdanie miejsc. Ten ekran dotyka PIENIĘDZY, więc każdy przypadek poniżej
// odpowiada błędowi, który kosztuje kupującego albo organizatora.
//
// CO TEN PLIK DOWODZI:
// 1. GROSZE SĄ GROSZAMI. `price_cents` dzieli się przez 100 i dostaje walutę
//    ze SWOJEGO wiersza - pomyłka o dwa rzędy wielkości albo doklejone „zł"
//    do ceny w euro wygląda na ekranie jak zwykła kwota.
// 2. STAWKA WYMAGAJĄCA POTWIERDZENIA NIE JEST DO KUPIENIA BEZ POTWIERDZENIA.
//    Kupujący bez uprawnienia widzi plakietkę, powód odmowy z wyceny i MARTWY
//    przycisk - nie zamówienie po cenie, która mu się nie należy.
// 3. WYPRZEDANE ZOSTAJE WYPRZEDANE (`packages_left === 0`), a brak limitu
//    (`null`) nie udaje zera.
// 4. JEDNO KLIKNIĘCIE TO JEDNO ZAMÓWIENIE. Drugie kliknięcie w czasie zapisu
//    to druga faktura za ten sam pakiet.
// 5. ODNOŚNIK ZAPROSZENIA NIESIE TOKEN Z ODPOWIEDZI BAZY. Baza trzyma tylko
//    jego skrót - odnośnik zmyślony po stronie przeglądarki nie otworzy
//    nikomu miejsca, a pokazujemy go dokładnie raz.
//
// ATRAPA OBEJMUJE WYŁĄCZNIE SIEĆ (`admissionApi`), a nie haki: `useQuery`
// i `useMutation` jadą prawdziwe, w prawdziwym `QueryClientProvider`, bo to
// one decydują o stanach „wczytywanie", „odmowa" i „zapis w toku", które ten
// ekran pokazuje. i18n jest zamockowane kluczami - parytetu PL/EN pilnuje
// osobna bramka słowników, a KWOTY liczy `Intl`, nie słownik, więc kwoty
// asertujemy dosłownie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type {
  AdmissionQuote,
  AdmissionQuoteOk,
  AdmissionQuoteReason,
  BuyerSeatInvite,
  BuyerSeatInviteInput,
  EventPackageOfferRow,
  MyPackageOrderRow,
  MyPackageSeatRow,
  PackagePurchaseInput,
  PackagePurchaseResult,
} from "@/lib/events/admissionApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const lang = vi.hoisted(() => ({ current: "pl" }));
const writeText = vi.fn<(value: string) => Promise<void>>();

const api = vi.hoisted(() => ({
  fetchPackagesOffer: vi.fn(),
  fetchMyPackageOrders: vi.fn(),
  fetchMyPackageSeats: vi.fn(),
  quoteAdmission: vi.fn(),
  purchasePackage: vi.fn(),
  inviteMyPackageSeat: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => lang.current),
);

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

// Podmieniamy SAME wywołania sieciowe; mappery odmów (`admissionQuoteMessageKey`)
// zostają prawdziwe, bo to one wiążą powód z bazy ze zdaniem na ekranie.
vi.mock("@/lib/events/admissionApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/admissionApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventPackagesPurchase } =
  await import("@/components/events/packages/EventPackagesPurchase");

const SLUG = "kongres-cee";

/** Kolumny wygenerowanego typu są nienullowalne, choć RPC oddaje tu `NULL`. */
const BRAK = null as unknown as string;
const BEZ_LIMITU = null as unknown as number;

function offer(over: Partial<EventPackageOfferRow> = {}): EventPackageOfferRow {
  return {
    id: "pkg-1",
    key: "team-5",
    event_id: "e1",
    audience: "company",
    name_pl: "Pakiet firmowy",
    name_en: "Company package",
    description_pl: "Pięć miejsc dla zespołu",
    description_en: "Five seats for the team",
    currency: "PLN",
    price_cents: 129900,
    seats: 5,
    packages_left: 3,
    qualifies: true,
    requires_verification: false,
    min_tier_rank: 0,
    sales_from: "2026-01-01T00:00:00Z",
    sales_to: "2026-09-01T00:00:00Z",
    sort_order: 1,
    ticket_type_id: "tt-1",
    ...over,
  };
}

function quoteOk(over: Partial<AdmissionQuoteOk> = {}): AdmissionQuoteOk {
  return {
    ok: true,
    kind: "package",
    eventId: "e1",
    audience: "company",
    seats: 5,
    currency: "PLN",
    priceCents: 129900,
    discountCents: 0,
    totalCents: 129900,
    couponCode: null,
    seatsLeft: 3,
    ...over,
  };
}

function quoteRefused(reason: AdmissionQuoteReason): AdmissionQuote {
  return { ok: false, reason, detail: {} };
}

function order(over: Partial<MyPackageOrderRow> = {}): MyPackageOrderRow {
  return {
    id: "ord-1",
    event_id: "e1",
    event_slug: SLUG,
    event_title: "Kongres CEE 2026",
    package_id: "pkg-1",
    package_name_pl: "Pakiet firmowy",
    package_name_en: "Company package",
    amount_cents: 499900,
    currency: "PLN",
    discount_cents: 0,
    buyer_email: "biuro@acme.example",
    status: "paid",
    seats_total: 5,
    seats_free: 2,
    seats_invited: 1,
    seats_assigned: 2,
    created_at: "2026-08-01T10:00:00Z",
    ...over,
  };
}

function seat(over: Partial<MyPackageSeatRow> = {}): MyPackageSeatRow {
  return {
    id: "seat-1",
    package_order_id: "ord-1",
    state: "free",
    attendee_name: BRAK,
    invite_email: BRAK,
    invite_name: BRAK,
    invite_expires_at: BRAK,
    invite_sent_at: BRAK,
    assigned_at: BRAK,
    revoked_at: BRAK,
    ...over,
  };
}

function renderPurchase() {
  return renderWithQueryClient(<EventPackagesPurchase slug={SLUG} />);
}

/** Wybór pakietu na liście - karta jest przyciskiem z nazwą w treści. */
async function pick(name: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name }));
}

function buyButton(): HTMLElement {
  return screen.getByRole("button", { name: /eventPackages\.buy(Action|Pending)/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  lang.current = "pl";
  api.fetchPackagesOffer.mockResolvedValue([offer()]);
  api.fetchMyPackageOrders.mockResolvedValue([]);
  api.fetchMyPackageSeats.mockResolvedValue([]);
  api.quoteAdmission.mockResolvedValue(quoteOk());
  api.purchasePackage.mockResolvedValue({
    orderId: "ord-1",
    seats: 5,
    currency: "PLN",
    totalCents: 129900,
    discountCents: 0,
    status: "pending",
  } satisfies PackagePurchaseResult);
  api.inviteMyPackageSeat.mockResolvedValue({
    seatId: "seat-1",
    inviteToken: "Tok3n-Z-Bazy_9",
    expiresAt: "2026-09-01T00:00:00Z",
  } satisfies BuyerSeatInvite);
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

describe("EventPackagesPurchase - oferta i ceny", () => {
  it("grosze zamieniają się w kwotę w walucie SWOJEGO wiersza", async () => {
    // Dwie pułapki naraz: dzielenie przez 100 (129900 gr to 1299 zł, nie 129 900 zł)
    // i waluta brana z pakietu, a nie na sztywno - oferta bywa dwuwalutowa.
    api.fetchPackagesOffer.mockResolvedValue([
      offer(),
      offer({
        id: "pkg-2",
        name_pl: "Pakiet delegacji",
        currency: "EUR",
        price_cents: 45000,
        seats: 10,
      }),
    ]);
    renderPurchase();

    expect(await screen.findByText("1299,00 zł")).toBeInTheDocument();
    expect(screen.getByText("450,00 €")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seats(count=5)")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seats(count=10)")).toBeInTheDocument();
  });

  it("wersja angielska formatuje TĘ SAMĄ kwotę po angielsku i bierze angielską nazwę", async () => {
    // Kwota nie idzie przez słownik, tylko przez `Intl` - gdyby ekran ignorował
    // język, Anglik zobaczyłby „1299,00 zł" zamiast „PLN 1,299.00".
    lang.current = "en";
    renderPurchase();

    expect(await screen.findByText("PLN 1,299.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Company package/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pakiet firmowy/ })).toBeNull();
  });

  it("pusta nazwa w języku ekranu spada na drugi język, zamiast zostawić dziurę", async () => {
    // Organizator opisuje pakiet zwykle w jednym języku, a brakującą kolumnę
    // RPC oddaje jako `NULL` albo puste pole. Pusty napis na karcie zostawiłby
    // przycisk „kup" bez informacji, co się kupuje. Drugi pakiet nie ma opisu
    // w ŻADNYM języku - i to też musi się narysować, tylko bez opisu.
    api.fetchPackagesOffer.mockResolvedValue([
      offer({ name_pl: BRAK, description_pl: "   " }),
      offer({
        id: "pkg-2",
        name_pl: "Pakiet bez opisu",
        name_en: BRAK,
        description_pl: BRAK,
        description_en: BRAK,
      }),
    ]);
    renderPurchase();

    expect(await screen.findByRole("button", { name: /Company package/ })).toBeInTheDocument();
    expect(screen.getByText("Five seats for the team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pakiet bez opisu/ })).toBeInTheDocument();
  });

  it("po angielsku brakujące tłumaczenie spada na polską nazwę", async () => {
    // Odwrotny kierunek tej samej reguły. Bez niego anglojęzyczny kupujący
    // widziałby kartę bez nazwy - a pakiety opisane tylko po polsku to norma.
    lang.current = "en";
    api.fetchPackagesOffer.mockResolvedValue([offer({ name_en: "  ", description_en: "" })]);
    renderPurchase();

    expect(await screen.findByRole("button", { name: /Pakiet firmowy/ })).toBeInTheDocument();
    expect(screen.getByText("Pięć miejsc dla zespołu")).toBeInTheDocument();
  });

  it("wyprzedany pakiet mówi „zostało 0”, a brak limitu nie udaje zera", async () => {
    // `packages_left === null` znaczy „bez limitu zestawów"; potraktowane jak
    // liczba dałoby kupującemu komunikat „pozostałe zestawy: " bez wartości.
    api.fetchPackagesOffer.mockResolvedValue([
      offer({ packages_left: 0 }),
      offer({ id: "pkg-2", name_pl: "Pakiet otwarty", packages_left: BEZ_LIMITU }),
    ]);
    renderPurchase();

    expect(await screen.findByText("eventPackages.packagesLeft(count=0)")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.packagesUnlimited")).toBeInTheDocument();
  });

  it("pusta oferta mówi wprost, że pakietów nie ma", async () => {
    api.fetchPackagesOffer.mockResolvedValue([]);
    renderPurchase();

    expect(await screen.findByText("eventPackages.empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pakiet firmowy/ })).toBeNull();
  });

  it("do czasu odpowiedzi bazy ekran mówi, że pracuje", async () => {
    // Bez tego stanu pusta lista przez sekundę wygląda jak „nie ma pakietów"
    // i kupujący zamyka stronę, zanim oferta dojedzie.
    api.fetchPackagesOffer.mockReturnValue(new Promise<EventPackageOfferRow[]>(() => {}));
    renderPurchase();

    expect((await screen.findAllByText("eventPackages.loading")).length).toBeGreaterThan(0);
    expect(screen.queryByText("eventPackages.empty")).toBeNull();
  });

  it("błąd zapytania o ofertę NIE stawia niczego do kupienia", async () => {
    // Zapytanie padło - na ekranie nie ma ani jednej karty ani formularza
    // płatnika. To jedyna rzecz, którą ten ekran dziś robi w tej sytuacji
    // poprawnie; o samym komunikacie mówi `it.fails` na końcu pliku.
    api.fetchPackagesOffer.mockRejectedValue(new Error("PGRST301: JWT expired"));
    renderPurchase();

    await waitFor(() => expect(screen.queryAllByText("eventPackages.loading")).toHaveLength(0));
    expect(screen.queryByRole("button", { name: /Pakiet firmowy/ })).toBeNull();
    expect(screen.queryByLabelText("eventPackages.buyerName")).toBeNull();
  });
});

describe("EventPackagesPurchase - uprawnienie do stawki", () => {
  it("kupujący UPRAWNIONY do stawki widzi plakietkę i czynny przycisk zakupu", async () => {
    api.fetchPackagesOffer.mockResolvedValue([
      offer({ requires_verification: true, qualifies: true, audience: "academic" }),
    ]);
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(screen.getByText("eventPackages.qualified")).toBeInTheDocument();
    await waitFor(() => expect(buyButton()).toBeEnabled());
  });

  it("kupujący NIEUPRAWNIONY nie zamówi stawki wymagającej potwierdzenia", async () => {
    // Najdroższy błąd tego ekranu: pakiet akademicki albo delegacyjny kupiony
    // przez kogoś, komu ta stawka się nie należy. Wycena odmawia
    // (`audience_not_verified`), więc przycisk MUSI zostać martwy, a powód
    // musi stać na ekranie - inaczej kupujący widzi tylko „nic się nie dzieje".
    api.fetchPackagesOffer.mockResolvedValue([
      offer({ requires_verification: true, qualifies: false, audience: "academic" }),
    ]);
    api.quoteAdmission.mockResolvedValue(quoteRefused("audience_not_verified"));
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(screen.getByText("eventPackages.notQualified")).toBeInTheDocument();
    expect(
      await screen.findByText("eventPackages.quoteReasons.audience_not_verified"),
    ).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();

    fireEvent.click(buyButton());
    expect(api.purchasePackage).not.toHaveBeenCalled();
  });

  it("pakiet BEZ weryfikacji nie straszy plakietką uprawnienia", async () => {
    // Plakietka „stawka wymaga potwierdzenia" przy zwykłym pakiecie odstrasza
    // kupującego od czegoś, co może kupić od ręki.
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(screen.queryByText("eventPackages.qualified")).toBeNull();
    expect(screen.queryByText("eventPackages.notQualified")).toBeNull();
  });

  it("wyprzedany pakiet ma powód odmowy zamiast czynnego przycisku", async () => {
    api.fetchPackagesOffer.mockResolvedValue([offer({ packages_left: 0 })]);
    api.quoteAdmission.mockResolvedValue(quoteRefused("sold_out"));
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(await screen.findByText("eventPackages.quoteReasons.sold_out")).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
  });

  it("przed odpowiedzią wyceny nie da się kupić „w ciemno”", async () => {
    // Przycisk czynny przed wyceną wysyłałby zamówienie po cenie, której
    // kupujący jeszcze nie widział.
    api.quoteAdmission.mockReturnValue(new Promise<AdmissionQuote>(() => {}));
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(buyButton()).toBeDisabled();
    expect(screen.getAllByText("eventPackages.loading").length).toBeGreaterThan(0);
  });
});

describe("EventPackagesPurchase - wycena i zamówienie", () => {
  it("rabat jest osobnym wierszem, a „do zapłaty” jest kwotą PO rabacie", async () => {
    // Trzy kwoty naraz i każda z innego pola. Podmiana `totalCents` na
    // `priceCents` daje ekran, na którym rabat jest widoczny, ale nic nie zmienia.
    api.quoteAdmission.mockResolvedValue(
      quoteOk({ priceCents: 129900, discountCents: 30000, totalCents: 99900 }),
    );
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(await screen.findByText("eventPackages.totalLabel")).toBeInTheDocument();
    expect(screen.getByText("-300,00 zł")).toBeInTheDocument();
    expect(screen.getByText("999,00 zł")).toBeInTheDocument();
  });

  it("wycena bez rabatu nie rysuje pustego wiersza rabatu", async () => {
    renderPurchase();
    await pick(/Pakiet firmowy/);

    expect(await screen.findByText("eventPackages.priceLabel")).toBeInTheDocument();
    expect(screen.queryByText("eventPackages.discountLabel")).toBeNull();
  });

  it("wycena bez waluty spada na walutę pakietu, a nie na złotówki", async () => {
    // Wiersz wyceny bez waluty przy pakiecie w euro pokazałby „450,00 zł" -
    // ta sama liczba, cztery razy mniej pieniędzy.
    api.fetchPackagesOffer.mockResolvedValue([offer({ currency: "EUR", price_cents: 45000 })]);
    api.quoteAdmission.mockResolvedValue(
      quoteOk({ currency: "", priceCents: 45000, discountCents: 5000, totalCents: 40000 }),
    );
    renderPurchase();
    await pick(/Pakiet firmowy/);

    // Karta oferty i wiersz „cena pakietu" - obie kwoty w euro pakietu.
    await waitFor(() => expect(screen.getAllByText("450,00 €")).toHaveLength(2));
    expect(screen.getByText("-50,00 €")).toBeInTheDocument();
    expect(screen.getByText("400,00 €")).toBeInTheDocument();
  });

  it("kod rabatowy jedzie do wyceny dopiero po „Przelicz”", async () => {
    // Przeliczanie przy każdym znaku zasypałoby bazę zapytaniami o kody, które
    // jeszcze nie istnieją - i pokazywało „nie znamy takiego kodu" w trakcie
    // wpisywania poprawnego.
    renderPurchase();
    await pick(/Pakiet firmowy/);
    await waitFor(() => expect(api.quoteAdmission).toHaveBeenCalledWith({ packageId: "pkg-1" }));

    fireEvent.change(screen.getByLabelText("eventPackages.couponLabel"), {
      target: { value: "  PARTNER2026  " },
    });
    expect(api.quoteAdmission).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "eventPackages.couponApply" }));
    await waitFor(() =>
      expect(api.quoteAdmission).toHaveBeenCalledWith({
        packageId: "pkg-1",
        couponCode: "PARTNER2026",
      }),
    );
  });

  it("zamówienie niesie dane płatnika i zastosowany kod", async () => {
    // Faktura powstaje z tych trzech pól. Zgubiona nazwa płatnika albo notatka
    // do faktury oznacza korektę i telefon do biura.
    renderPurchase();
    await pick(/Pakiet firmowy/);

    fireEvent.change(screen.getByLabelText("eventPackages.buyerName"), {
      target: { value: "Acme sp. z o.o." },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.buyerEmail"), {
      target: { value: "biuro@acme.example" },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.invoiceNote"), {
      target: { value: "PO 2026/114" },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.couponLabel"), {
      target: { value: "PARTNER2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventPackages.couponApply" }));
    await waitFor(() => expect(buyButton()).toBeEnabled());
    fireEvent.click(buyButton());

    await waitFor(() => expect(api.purchasePackage).toHaveBeenCalledTimes(1));
    expect(api.purchasePackage).toHaveBeenCalledWith(
      {
        packageId: "pkg-1",
        buyerName: "Acme sp. z o.o.",
        buyerEmail: "biuro@acme.example",
        companyId: null,
        invoiceNote: "PO 2026/114",
        couponCode: "PARTNER2026",
      } satisfies PackagePurchaseInput,
      // React Query dokłada mutacji własny kontekst jako drugi argument.
      expect.anything(),
    );
  });

  it("podwójne kliknięcie NIE składa dwóch zamówień", async () => {
    // Zapis do bazy trwa; niecierpliwe drugie kliknięcie to druga rezerwacja
    // zestawu i druga faktura za to samo.
    let release: (value: PackagePurchaseResult) => void = () => {};
    api.purchasePackage.mockImplementation(
      () =>
        new Promise<PackagePurchaseResult>((resolve) => {
          release = resolve;
        }),
    );
    renderPurchase();
    await pick(/Pakiet firmowy/);
    await waitFor(() => expect(buyButton()).toBeEnabled());

    fireEvent.click(buyButton());
    await waitFor(() => expect(buyButton()).toBeDisabled());
    expect(screen.getByText("eventPackages.buyPending")).toBeInTheDocument();
    fireEvent.click(buyButton());

    expect(api.purchasePackage).toHaveBeenCalledTimes(1);
    release({
      orderId: "ord-1",
      seats: 5,
      currency: "PLN",
      totalCents: 129900,
      discountCents: 0,
      status: "pending",
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("eventPackages.toasts.purchased"),
    );
  });

  it("udany zakup zamyka formularz i otwiera rozdawanie miejsc w NOWYM zamówieniu", async () => {
    // Płatnik ma iść dalej: nazwiska uzupełnia się po zakupie. Zostawiony
    // formularz zapraszałby do zamówienia drugiego pakietu.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    renderPurchase();
    await pick(/Pakiet firmowy/);
    await waitFor(() => expect(buyButton()).toBeEnabled());
    fireEvent.click(buyButton());

    await waitFor(() => expect(api.fetchMyPackageSeats).toHaveBeenCalledWith("ord-1"));
    expect(screen.queryByLabelText("eventPackages.buyerName")).toBeNull();
    expect(screen.getByText("eventPackages.seatsTitle")).toBeInTheDocument();
  });

  it("odmowa zakupu mówi zdaniem ze słownika, a nieznana - zdaniem ogólnym", async () => {
    // Głowa komunikatu plpgsql (`sold_out: ...`) jest kluczem, nie treścią dla
    // człowieka; klucz spoza listy nie może udawać znanego powodu, bo
    // podpowiadałby czynność, która niczego nie naprawi.
    api.purchasePackage.mockRejectedValueOnce(new Error("sold_out: no packages left"));
    renderPurchase();
    await pick(/Pakiet firmowy/);
    await waitFor(() => expect(buyButton()).toBeEnabled());
    fireEvent.click(buyButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("eventPackages.errors.sold_out"));

    api.purchasePackage.mockRejectedValueOnce("naruszenie ograniczenia bazy");
    fireEvent.click(buyButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("eventPackages.errors.unknown"));
  });
});

describe("EventPackagesPurchase - moje zamówienia i miejsca", () => {
  it("brak zamówień mówi to wprost, a wczytywanie pokazuje pracę", async () => {
    api.fetchMyPackageOrders.mockReturnValue(new Promise<MyPackageOrderRow[]>(() => {}));
    const pending = renderPurchase();
    expect(await screen.findByText("eventPackages.ordersTitle")).toBeInTheDocument();
    expect(screen.queryByText("eventPackages.ordersEmpty")).toBeNull();
    pending.unmount();

    api.fetchMyPackageOrders.mockResolvedValue([]);
    renderPurchase();
    expect(await screen.findByText("eventPackages.ordersEmpty")).toBeInTheDocument();
  });

  it("błąd zapytania o zamówienia nie pokazuje żadnego zamówienia", async () => {
    // Padnięte zapytanie zostawia `data` puste. Ekran nie ma prawa dorysować
    // tu niczego z pamięci podręcznej - płatnik rozdaje miejsca z listy, która
    // musi być aktualna albo nie istnieć wcale. (Że komunikat jest wtedy taki
    // sam jak przy braku zamówień - patrz `it.fails` niżej.)
    api.fetchMyPackageOrders.mockRejectedValue(new Error("PGRST301: JWT expired"));
    renderPurchase();

    await waitFor(() => expect(screen.queryAllByText("eventPackages.loading")).toHaveLength(0));
    expect(screen.queryByRole("button", { name: "eventPackages.manageSeats" })).toBeNull();
    expect(screen.queryByText(/eventPackages\.seatsFree/)).toBeNull();
  });

  it("zamówienie pokazuje zapłaconą kwotę, status i rozliczenie miejsc", async () => {
    // Płatnik wraca na tę stronę po to, żeby zobaczyć, ile miejsc zostało do
    // rozdania - te trzy liczby to całe rozliczenie zamówienia.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    renderPurchase();

    expect(await screen.findByText("Kongres CEE 2026 · 4999,00 zł")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.orderStatus.paid")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seatsFree(count=2)")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seatsInvited(count=1)")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seatsAssigned(count=2)")).toBeInTheDocument();
  });

  it("rozdawanie miejsc otwiera się i zamyka, a miejsce podpisuje się tym, co ma", async () => {
    // Miejsce ma trzy możliwe podpisy (uczestnik, zaproszony z nazwiska, sam
    // adres) i czwarty stan - wolne. Bez pełnego łańcucha `??` lista pokazuje
    // pustkę przy miejscach, które są zajęte.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    api.fetchMyPackageSeats.mockResolvedValue([
      seat({ id: "s1", state: "assigned", attendee_name: "Anna Kowalska" }),
      seat({
        id: "s2",
        state: "invited",
        invite_name: "Jan Nowak",
        invite_email: "jan@acme.example",
      }),
      seat({ id: "s3", state: "invited", invite_email: "ola@acme.example" }),
      seat({ id: "s4", state: "free" }),
    ]);
    renderPurchase();
    fireEvent.click(await screen.findByRole("button", { name: "eventPackages.manageSeats" }));

    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("Jan Nowak")).toBeInTheDocument();
    expect(screen.getByText("ola@acme.example")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("eventPackages.seatState.assigned")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "eventPackages.manageSeats" }));
    expect(screen.queryByText("Anna Kowalska")).toBeNull();
  });

  it("zaproszenie bez poprawnego adresu NIE rusza do bazy", async () => {
    // Baza odrzuca taki wpis błędem `invalid_email`, ale dopiero po zajęciu
    // miejsca w kolejce; sprawdzenie u siebie zostawia komunikat przy polu,
    // a nie w znikającym powiadomieniu.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    renderPurchase();
    fireEvent.click(await screen.findByRole("button", { name: "eventPackages.manageSeats" }));

    fireEvent.change(screen.getByLabelText("eventPackages.inviteEmail"), {
      target: { value: "anna(at)acme.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventPackages.inviteAction" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "eventPackages.errors.invalid_email",
    );
    expect(api.inviteMyPackageSeat).not.toHaveBeenCalled();
  });

  it("odnośnik zaproszenia powstaje z TOKENU Z ODPOWIEDZI bazy", async () => {
    // Token wraca dokładnie raz (baza trzyma sam skrót), więc odnośnik musi go
    // nieść wprost. Adres zbudowany z czegokolwiek innego - identyfikatora
    // miejsca, maila - nie otworzy zaproszonemu niczego.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    renderPurchase();
    fireEvent.click(await screen.findByRole("button", { name: "eventPackages.manageSeats" }));

    fireEvent.change(screen.getByLabelText("eventPackages.inviteEmail"), {
      target: { value: "anna@acme.example" },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.inviteName"), {
      target: { value: "Anna Kowalska" },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.inviteDays"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventPackages.inviteAction" }));

    await waitFor(() =>
      expect(api.inviteMyPackageSeat).toHaveBeenCalledWith(
        {
          orderId: "ord-1",
          email: "anna@acme.example",
          name: "Anna Kowalska",
          expiresInDays: 30,
        } satisfies BuyerSeatInviteInput,
        expect.anything(),
      ),
    );

    const link = `${window.location.origin}/events/invite/Tok3n-Z-Bazy_9`;
    expect(await screen.findByText(link)).toBeInTheDocument();
    expect(screen.getByText("eventPackages.inviteLinkHint")).toBeInTheDocument();
    // Pola czyszczą się po wysłaniu - inaczej drugie kliknięcie zaprosiłoby
    // tę samą osobę na kolejne miejsce z puli.
    expect(screen.getByLabelText("eventPackages.inviteEmail")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "eventPackages.copyAction" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(toast.success).toHaveBeenCalledWith("eventPackages.toasts.copied");
  });

  it("ważność wpisana literami NIE zeruje zaproszenia - jedzie wartość domyślna", async () => {
    // Pole liczbowe puszcza pusty napis i wklejony tekst. `Number.parseInt`
    // daje wtedy NaN, a zaproszenie z NaN dni baza odrzuca albo - gorzej -
    // wystawia z datą wygaśnięcia w przeszłości.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    renderPurchase();
    fireEvent.click(await screen.findByRole("button", { name: "eventPackages.manageSeats" }));

    fireEvent.change(screen.getByLabelText("eventPackages.inviteEmail"), {
      target: { value: "anna@acme.example" },
    });
    fireEvent.change(screen.getByLabelText("eventPackages.inviteDays"), {
      target: { value: "trzydzieści" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventPackages.inviteAction" }));

    await waitFor(() =>
      expect(api.inviteMyPackageSeat).toHaveBeenCalledWith(
        expect.objectContaining({ expiresInDays: 14 }),
        expect.anything(),
      ),
    );
  });

  it("odmowa zaproszenia zostaje PRZY FORMULARZU, nie w powiadomieniu", async () => {
    // Powiadomienie znika po trzech sekundach, a płatnik rozdaje miejsca
    // z listą nazwisk w drugiej ręce - musi móc wrócić wzrokiem do powodu.
    api.fetchMyPackageOrders.mockResolvedValue([order()]);
    api.inviteMyPackageSeat.mockRejectedValue(new Error("no_free_seat: order is full"));
    renderPurchase();
    fireEvent.click(await screen.findByRole("button", { name: "eventPackages.manageSeats" }));

    fireEvent.change(screen.getByLabelText("eventPackages.inviteEmail"), {
      target: { value: "anna@acme.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventPackages.inviteAction" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("eventPackages.errors.no_free_seat");
    expect(screen.queryByText("eventPackages.inviteLinkTitle")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // DEFEKT PRODUKCYJNY (stan pożądany, nie stan faktyczny).
  //
  // `EventPackagesPurchase.tsx` czyta z zapytań wyłącznie `isLoading` i `data`
  // (`offerQ.data ?? []`, `ordersQ.data ?? []`), więc PADNIĘTE zapytanie -
  // wygasła sesja, brak sieci, odmowa uprawnień - wygląda identycznie jak
  // wydarzenie bez pakietów: „To wydarzenie nie oferuje pakietów grupowych".
  // Kupujący nie ma czego ponowić, a organizator dostaje zgłoszenie „nie
  // sprzedajecie pakietów". Naprawa (gałąź `isError` z możliwością ponowienia)
  // należy do zmiany komponentu, nie do testu.
  // ---------------------------------------------------------------------
  it("błąd zapytania o ofertę NIE udaje braku pakietów", async () => {
    api.fetchPackagesOffer.mockRejectedValue(new Error("PGRST301: JWT expired"));
    renderPurchase();

    // Zapytanie się rozstrzygnęło (zniknął stan pracy) - i dopiero teraz pytamy
    // o treść: awaria NIE MOŻE mówić „to wydarzenie nie oferuje pakietów".
    await waitFor(() => expect(screen.queryAllByText("eventPackages.loading")).toHaveLength(0));
    expect(screen.queryByText("eventPackages.empty")).toBeNull();
  });
});
