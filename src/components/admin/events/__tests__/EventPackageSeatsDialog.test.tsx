// Molekuła „Miejsca w zamówieniu" - PULA MIEJSC I JEDNORAZOWE ZAPROSZENIA.
//
// TOKEN JEST KLUCZEM DO ZAPISU NA CUDZE NAZWISKO. Baza trzyma wyłącznie jego
// skrót, więc odnośnik istnieje dokładnie raz - w odpowiedzi RPC. Kto go nie
// skopiuje w tej chwili, musi wystawić zaproszenie ponownie. Stąd dwie reguły,
// których pilnuje ten plik: odnośnik ZOSTAJE na ekranie do czasu jawnej zmiany
// kontekstu i NIE POJAWIA SIĘ, gdy zaproszenie nie doszło.
//
// CO TEN PLIK DOWODZI.
//   1. ZAMKNIĘTY DIALOG NIE PYTA O MIEJSCA - zapytanie dostaje `null`, więc
//      lista cudzego zamówienia nie wisi w pamięci ekranu.
//   2. TRZY STANY LISTY MAJĄ TRZY WIDOKI (w locie / odmowa / pustka). Odmowa
//      wyglądająca jak pustka to nieprawda o stanie bazy.
//   3. CZTERY STANY MIEJSCA MAJĄ CZTERY ZESTAWY AKCJI. Miejsce PRZYPISANE nie
//      ma jak dostać drugiego zaproszenia, a WOLNE i COFNIĘTE nie ma czego
//      cofać. Stan spoza słownika degraduje się do „wolne", a nie do pustki.
//   4. WIERSZ BEZ NAZWISKA I BEZ ADRESU POKAZUJE MYŚLNIK, nie pustkę - wiersz
//      z samym znacznikiem czyta się jak awaria panelu.
//   5. ZAPROSZENIE WALIDUJE ADRES I OKRES WAŻNOŚCI PRZED WYSŁANIEM, a liczba
//      dni jedzie jako LICZBA, nie jako tekst z pola.
//   6. UDANE ZAPROSZENIE POKAZUJE PEŁNY ODNOŚNIK (z tokenem zakodowanym do
//      adresu URL), czyści formularz i zamyka go; ODMOWA nie pokazuje żadnego
//      odnośnika i ZOSTAWIA wpisany adres.
//   7. ZAMKNIĘCIE DIALOGU ZDEJMUJE ODNOŚNIK I CZYŚCI FORMULARZ.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Hooków (`usePackageSeats`,
// `useInvitePackageSeat`, `useRevokePackageSeat`) i unieważniania cache - są
// zamockowane na poziomie MODUŁU, bo przedmiotem dowodu jest to, CO molekuła do
// nich wysyła i co robi z odpowiedzią. (2) Słownika odmów bazy
// (`adminRegistrationErrorMessage`) - ma własny plik. (3) Molekuł `AdminForm*`
// i `AdminCatalogListState` - mają własne pliki.
//
// Radix Dialog nie działa pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SALES_IDS, packageSeatRow } from "@/test/events/adminSalesRows";
import type { EventPackageSeatRow, PackageSeatInviteInput } from "@/lib/events/packagesApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co molekuła przekazuje. */
interface Wynik<T> {
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  seatQueries: [] as (string | null)[],
  /** `undefined` = zapytanie jeszcze nie oddało danych - tak robi react-query. */
  rows: undefined as EventPackageSeatRow[] | undefined,
  isLoading: false,
  queryError: null as Error | null,
  invitePending: false,
  invites: [] as {
    vars: PackageSeatInviteInput;
    wynik: Wynik<{ seatId: string; inviteToken: string }>;
  }[],
  revokes: [] as { id: string; wynik: Wynik<boolean> }[],
  eventIds: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Klient bazy jest tu ładowany wyłącznie tranzytem - molekuła bierze z tego
// modułu `packageInviteUrl`, czystą funkcję sklejającą adres zaproszenia,
// i to ONA ma zostać prawdziwa.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => undefined } }));
// Słownik odmów bazy ma własny plik testowy; tutaj potrzebny jest wyłącznie
// dowód, że odmowa DOCHODZI do organizatora zdaniem, a nie kodem `23514`.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/lib/events/useEventPackages", () => ({
  usePackageSeats: (orderId: string | null) => {
    h.seatQueries.push(orderId);
    return { data: h.rows, isLoading: h.isLoading, error: h.queryError };
  },
  useInvitePackageSeat: (eventId: string) => {
    h.eventIds.push(eventId);
    return {
      isPending: h.invitePending,
      mutate: (
        vars: PackageSeatInviteInput,
        wynik: Wynik<{ seatId: string; inviteToken: string }>,
      ) => {
        h.invites.push({ vars, wynik });
      },
    };
  },
  useRevokePackageSeat: (eventId: string) => {
    h.eventIds.push(eventId);
    return {
      isPending: false,
      mutate: (id: string, wynik: Wynik<boolean>) => {
        h.revokes.push({ id, wynik });
      },
    };
  },
}));

import { EventPackageSeatsDialog } from "@/components/admin/events/molecules/EventPackageSeatsDialog";

const onOpenChange = vi.fn();
const clipboard = vi.fn<(text: string) => Promise<void>>();

const S = "adminEventRegistration.packages.seats.";

interface Wejscie {
  open?: boolean;
  orderId?: string | null;
}

function renderuj(props: Wejscie = {}) {
  const pelne = (wejscie: Wejscie) => (
    <EventPackageSeatsDialog
      open={wejscie.open ?? true}
      onOpenChange={onOpenChange}
      eventId={SALES_IDS.event}
      orderId={wejscie.orderId === undefined ? SALES_IDS.order : wejscie.orderId}
    />
  );
  const wynik = render(pelne(props));
  return {
    ...wynik,
    przerysuj: (next: Wejscie) => wynik.rerender(pelne({ ...props, ...next })),
  };
}

/** Wiersz miejsca po widocznym stanie („Wolne", „Zaproszone"...). */
function wiersz(index = 0): HTMLElement {
  const li = screen.getAllByRole("listitem")[index];
  if (li === undefined) throw new Error(`brak wiersza numer ${index}`);
  return li;
}

const przyciskZaproszenia = (li: HTMLElement) =>
  within(li).getByRole("button", { name: `${S}inviteAction` });
const przyciskCofniecia = (li: HTMLElement) =>
  within(li).getByRole("button", { name: `${S}revokeAction` });
const przyciskWyslania = () => screen.getByRole("button", { name: `${S}send` });
const poleAdresu = () => screen.getByLabelText(`${S}inviteEmail`);
const poleNazwiska = () => screen.getByLabelText(`${S}inviteName`);
const poleDni = () => screen.getByLabelText(`${S}validDays`);

/** Otwiera formularz zaproszenia przy wskazanym wierszu. */
function otworzZaproszenie(index = 0) {
  fireEvent.click(przyciskZaproszenia(wiersz(index)));
}

beforeEach(() => {
  h.seatQueries = [];
  h.rows = [packageSeatRow()];
  h.isLoading = false;
  h.queryError = null;
  h.invitePending = false;
  h.invites = [];
  h.revokes = [];
  h.eventIds = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  onOpenChange.mockClear();
  clipboard.mockClear();
  clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});

describe("EventPackageSeatsDialog - zapytanie i trzy stany listy", () => {
  it("dialog zamknięty NIE renderuje treści i NIE pyta o miejsca", () => {
    // Zapytanie z otwartym identyfikatorem zamówienia trzymałoby w pamięci
    // ekranu listę, której nikt nie ogląda - i odświeżałoby ją przy każdym
    // unieważnieniu gałęzi wydarzenia.
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.seatQueries.every((id) => id === null)).toBe(true);
  });

  it("dialog otwarty pyta o WSKAZANE zamówienie i mówi, po co tu jesteśmy", () => {
    renderuj();
    expect(screen.getByText(`${S}title`)).toBeInTheDocument();
    expect(screen.getByText(`${S}subtitle`)).toBeInTheDocument();
    expect(h.seatQueries).toContain(SALES_IDS.order);
    // Obie mutacje pracują na WYDARZENIU, nie na zamówieniu - unieważniają
    // całą gałąź, w tym listę zgłoszeń.
    expect(h.eventIds.every((id) => id === SALES_IDS.event)).toBe(true);
  });

  it("wczytywanie mówi „wczytywanie”, nie „brak miejsc”", () => {
    // Zapytanie w locie nie ma jeszcze ŻADNYCH danych (`undefined`), a nie
    // pustą listę - i to jest ten stan, w którym „brak miejsc" byłoby kłamstwem.
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${S}loading`)).toBeInTheDocument();
    expect(screen.queryByText(`${S}empty`)).not.toBeInTheDocument();
  });

  it("odmowa bazy pokazuje ZDANIE ze słownika, a nie pustą listę", () => {
    h.rows = undefined;
    h.queryError = new Error("permission denied for function admin_event_package_seats_list");
    renderuj();
    expect(
      screen.getByText("odmowa:permission denied for function admin_event_package_seats_list"),
    ).toBeInTheDocument();
    expect(screen.queryByText(`${S}empty`)).not.toBeInTheDocument();
  });

  it("pustka po udanym wczytaniu mówi trzecią rzecz i nie rysuje wierszy", () => {
    h.rows = [];
    renderuj();
    expect(screen.getByText(`${S}empty`)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("EventPackageSeatsDialog - cztery stany miejsca", () => {
  it("miejsce WOLNE można zaprosić, ale nie ma czego cofać", () => {
    renderuj();
    const li = wiersz();
    expect(within(li).getByText(`${S}states.free`)).toBeInTheDocument();
    expect(przyciskZaproszenia(li)).toBeInTheDocument();
    expect(within(li).queryByRole("button", { name: `${S}revokeAction` })).toBeNull();
  });

  it("miejsce ZAPROSZONE ma obie akcje i pokazuje termin ważności zaproszenia", () => {
    // Termin jest tu jedyną informacją o tym, czy zaproszenie jeszcze działa -
    // bez niego organizator wystawia drugie „na wszelki wypadek".
    h.rows = [
      packageSeatRow({
        state: "invited",
        invite_email: "gosc@firma.test",
        invite_expires_at: "2026-09-12T10:00:00.000Z",
      }),
    ];
    renderuj();
    const li = wiersz();
    expect(within(li).getByText(`${S}states.invited`)).toBeInTheDocument();
    expect(within(li).getByText("gosc@firma.test")).toBeInTheDocument();
    expect(
      within(li).getByText(/^adminEventRegistration\.packages\.seats\.expiresAt\(date=.+\)$/),
    ).toBeInTheDocument();
    expect(przyciskZaproszenia(li)).toBeInTheDocument();
    expect(przyciskCofniecia(li)).toBeInTheDocument();
  });

  it("miejsce PRZYPISANE nie ma jak dostać drugiego zaproszenia", () => {
    // Uczestnik jest już zapisany; drugie zaproszenie na to samo miejsce
    // znaczyłoby dwa zapisy z jednej puli.
    h.rows = [packageSeatRow({ state: "assigned", attendee_name: "Anna Kowalska" })];
    renderuj();
    const li = wiersz();
    expect(within(li).getByText(`${S}states.assigned`)).toBeInTheDocument();
    expect(within(li).getByText("Anna Kowalska")).toBeInTheDocument();
    expect(within(li).queryByRole("button", { name: `${S}inviteAction` })).toBeNull();
    expect(przyciskCofniecia(li)).toBeInTheDocument();
  });

  it("miejsce COFNIĘTE wraca do puli - można je zaprosić ponownie, nie cofnąć drugi raz", () => {
    h.rows = [packageSeatRow({ state: "revoked", invite_email: "byly@firma.test" })];
    renderuj();
    const li = wiersz();
    expect(within(li).getByText(`${S}states.revoked`)).toBeInTheDocument();
    expect(przyciskZaproszenia(li)).toBeInTheDocument();
    expect(within(li).queryByRole("button", { name: `${S}revokeAction` })).toBeNull();
  });

  it("stan spoza słownika degraduje się do „wolne”, a nie do pustego znacznika", () => {
    // Kolumna jest tekstem, nie enumem klienta - nowa wartość dopisana
    // w migracji nie może zostawić wiersza bez etykiety i bez akcji.
    h.rows = [packageSeatRow({ state: "pending_something" })];
    renderuj();
    const li = wiersz();
    expect(within(li).getByText(`${S}states.free`)).toBeInTheDocument();
    expect(przyciskZaproszenia(li)).toBeInTheDocument();
  });

  it("miejsce bez nazwiska i bez adresu pokazuje MYŚLNIK, nie pustkę", () => {
    renderuj();
    expect(within(wiersz()).getByText("-")).toBeInTheDocument();
  });

  it("nazwisko wygrywa z adresem, a nazwisko PUSTE spada z powrotem do adresu", () => {
    // Import z pustą kolumną nazwiska (nie `null`) dawał wiersz z samym
    // znacznikiem - dlatego warunek sprawdza obie postaci braku.
    h.rows = [
      packageSeatRow({
        state: "invited",
        attendee_name: "Jan Nowak",
        invite_email: "jan@firma.test",
      }),
      packageSeatRow({
        id: SALES_IDS.otherSeat,
        state: "invited",
        attendee_name: "",
        invite_email: "puste@firma.test",
      }),
    ];
    renderuj();
    expect(within(wiersz(0)).getByText("Jan Nowak")).toBeInTheDocument();
    expect(within(wiersz(0)).queryByText("jan@firma.test")).toBeNull();
    expect(within(wiersz(1)).getByText("puste@firma.test")).toBeInTheDocument();
  });

  it("termin ważności NIE pokazuje się przy miejscu, które nie jest zaproszone", () => {
    // Data przy miejscu przypisanym mówiłaby o zaproszeniu, które już się
    // skończyło przyjęciem - i sugerowałaby, że coś wygasa.
    h.rows = [
      packageSeatRow({
        state: "assigned",
        attendee_name: "Anna Kowalska",
        invite_expires_at: "2026-09-12T10:00:00.000Z",
      }),
    ];
    renderuj();
    expect(screen.queryByText(/expiresAt/)).toBeNull();
  });
});

describe("EventPackageSeatsDialog - wystawienie zaproszenia", () => {
  it("formularz otwiera się pod wierszem i zamyka ponownym kliknięciem", () => {
    renderuj();
    expect(screen.queryByLabelText(`${S}inviteEmail`)).toBeNull();

    otworzZaproszenie();
    expect(poleAdresu()).toBeInTheDocument();
    expect(poleDni()).toHaveValue("14");

    otworzZaproszenie();
    expect(screen.queryByLabelText(`${S}inviteEmail`)).toBeNull();
  });

  it("pusty adres nie krzyczy, ale i nie pozwala wysłać", () => {
    // Komunikat przy polu, którego nikt jeszcze nie tknął, uczy ignorować
    // komunikaty - wystarczy, że przycisk jest nieczynny.
    renderuj();
    otworzZaproszenie();
    expect(screen.queryByText("adminEventRegistration.errors.packageSeatEmail")).toBeNull();
    expect(przyciskWyslania()).toBeDisabled();

    fireEvent.click(przyciskWyslania());
    expect(h.invites).toHaveLength(0);
  });

  it.each([
    ["gosc", "bez znaku małpy"],
    ["gosc@firma", "bez kropki w domenie"],
    ["gosc@firma.t", "domena jednoznakowa"],
  ])("adres „%s” pokazuje komunikat i blokuje wysyłkę (%s)", (adres) => {
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: adres } });

    expect(screen.getByText("adminEventRegistration.errors.packageSeatEmail")).toBeInTheDocument();
    expect(przyciskWyslania()).toBeDisabled();
  });

  it.each([
    ["0", "zaproszenie ważne zero dni"],
    ["91", "ponad trzy miesiące"],
    ["", "pole puste"],
    ["7,5", "przecinek zamiast liczby całkowitej"],
    ["tydzień", "tekst niebędący liczbą"],
  ])("okres ważności „%s” blokuje wysyłkę (%s)", (dni) => {
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.change(poleDni(), { target: { value: dni } });

    expect(
      screen.getByText("adminEventRegistration.errors.packageSeatValidDays"),
    ).toBeInTheDocument();
    expect(przyciskWyslania()).toBeDisabled();
    fireEvent.click(przyciskWyslania());
    expect(h.invites).toHaveLength(0);
  });

  it("granice okresu ważności są DOMKNIĘTE - jeden dzień i dziewięćdziesiąt przechodzą", () => {
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });

    fireEvent.change(poleDni(), { target: { value: "1" } });
    expect(przyciskWyslania()).toBeEnabled();
    fireEvent.change(poleDni(), { target: { value: "90" } });
    expect(przyciskWyslania()).toBeEnabled();
  });

  it("wysyłka niesie miejsce, przycięty adres, nazwisko i liczbę dni jako LICZBĘ", () => {
    // `valid_days: "14"` przeszłoby przez jsonb i wróciło odmową typu bez
    // nazwy kolumny.
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "  gosc@firma.test  " } });
    fireEvent.change(poleNazwiska(), { target: { value: "  Jan Nowak  " } });
    fireEvent.change(poleDni(), { target: { value: "30" } });
    fireEvent.click(przyciskWyslania());

    expect(h.invites).toHaveLength(1);
    expect(h.invites[0].vars).toEqual({
      seatId: SALES_IDS.seat,
      inviteEmail: "gosc@firma.test",
      inviteName: "Jan Nowak",
      validDays: 30,
    });
  });

  it("trwająca wysyłka blokuje przycisk - jedno miejsce nie dostaje dwóch tokenów", () => {
    const { przerysuj } = renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.click(przyciskWyslania());
    expect(h.invites).toHaveLength(1);

    h.invitePending = true;
    przerysuj({});

    expect(przyciskWyslania()).toBeDisabled();
    fireEvent.click(przyciskWyslania());
    expect(h.invites).toHaveLength(1);
  });
});

describe("EventPackageSeatsDialog - token wraca RAZ", () => {
  it("sukces pokazuje PEŁNY odnośnik z tokenem zakodowanym do adresu", () => {
    // Token bywa napisem z ukośnikiem albo plusem - wklejony do adresu bez
    // zakodowania daje odnośnik prowadzący donikąd, a drugiego już nie będzie.
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.change(poleNazwiska(), { target: { value: "Jan Nowak" } });
    fireEvent.click(przyciskWyslania());

    act(() => h.invites[0].wynik.onSuccess({ seatId: SALES_IDS.seat, inviteToken: "tok/en+1" }));

    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}toasts.invited`);
    expect(screen.getByText(`${S}tokenTitle`)).toBeInTheDocument();
    expect(screen.getByText(`${S}tokenHint`)).toBeInTheDocument();
    expect(
      screen.getByText(`${window.location.origin}/events/invite/tok%2Fen%2B1`),
    ).toBeInTheDocument();
  });

  it("sukces zamyka i czyści formularz - następne zaproszenie zaczyna od pustego pola", () => {
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.change(poleNazwiska(), { target: { value: "Jan Nowak" } });
    fireEvent.click(przyciskWyslania());
    act(() => h.invites[0].wynik.onSuccess({ seatId: SALES_IDS.seat, inviteToken: "abc" }));

    expect(screen.queryByLabelText(`${S}inviteEmail`)).toBeNull();

    otworzZaproszenie();
    expect(poleAdresu()).toHaveValue("");
    expect(poleNazwiska()).toHaveValue("");
  });

  it("kopiowanie oddaje schowkowi DOKŁADNIE pokazany odnośnik i mówi o tym", async () => {
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.click(przyciskWyslania());
    act(() => h.invites[0].wynik.onSuccess({ seatId: SALES_IDS.seat, inviteToken: "abc" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${S}copyAction` }));
    });

    expect(clipboard).toHaveBeenCalledWith(`${window.location.origin}/events/invite/abc`);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}toasts.copied`);
  });

  it("otwarcie formularza przy innym miejscu ZDEJMUJE poprzedni odnośnik", () => {
    // Odnośnik zostawiony pod nowym formularzem wygląda, jakby dotyczył tego
    // miejsca - a jest kluczem do zapisu wystawionym komu innemu.
    h.rows = [packageSeatRow(), packageSeatRow({ id: SALES_IDS.otherSeat })];
    renderuj();
    otworzZaproszenie(0);
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.click(przyciskWyslania());
    act(() => h.invites[0].wynik.onSuccess({ seatId: SALES_IDS.seat, inviteToken: "abc" }));
    expect(screen.getByText(`${S}tokenTitle`)).toBeInTheDocument();

    otworzZaproszenie(1);
    expect(screen.queryByText(`${S}tokenTitle`)).toBeNull();
  });

  it("ODMOWA nie pokazuje żadnego odnośnika i zostawia wpisany adres", () => {
    // Odnośnik po nieudanym zaproszeniu byłby kluczem, którego baza nie zna -
    // wysłany gościowi kończy się „zaproszenie nieważne" bez żadnego śladu.
    renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.click(przyciskWyslania());

    act(() => h.invites[0].wynik.onError(new Error("seat_not_free: taken")));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_not_free: taken");
    expect(screen.queryByText(`${S}tokenTitle`)).toBeNull();
    expect(poleAdresu()).toHaveValue("gosc@firma.test");
  });

  it("zamknięcie dialogu zdejmuje odnośnik i czyści formularz", () => {
    const { przerysuj } = renderuj();
    otworzZaproszenie();
    fireEvent.change(poleAdresu(), { target: { value: "gosc@firma.test" } });
    fireEvent.change(poleDni(), { target: { value: "45" } });
    fireEvent.click(przyciskWyslania());
    act(() => h.invites[0].wynik.onSuccess({ seatId: SALES_IDS.seat, inviteToken: "abc" }));

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(screen.queryByText(`${S}tokenTitle`)).toBeNull();
    otworzZaproszenie();
    expect(poleAdresu()).toHaveValue("");
    expect(poleDni()).toHaveValue("14");
  });
});

describe("EventPackageSeatsDialog - cofnięcie miejsca", () => {
  it("cofnięcie niesie identyfikator MIEJSCA i mówi o skutku", () => {
    h.rows = [packageSeatRow({ state: "invited", invite_email: "gosc@firma.test" })];
    renderuj();
    fireEvent.click(przyciskCofniecia(wiersz()));

    expect(h.revokes).toHaveLength(1);
    expect(h.revokes[0].id).toBe(SALES_IDS.seat);

    act(() => h.revokes[0].wynik.onSuccess(true));
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}toasts.revoked`);
  });

  it("odmowa cofnięcia jedzie tym samym słownikiem, co odmowa listy", () => {
    h.rows = [packageSeatRow({ state: "assigned", attendee_name: "Anna Kowalska" })];
    renderuj();
    fireEvent.click(przyciskCofniecia(wiersz()));

    act(() => h.revokes[0].wynik.onError(new Error("seat_already_used: 1")));
    expect(h.toastError).toHaveBeenCalledWith("odmowa:seat_already_used: 1");
  });

  it("przełączenie formularza na INNE miejsce NIE niesie adresu poprzedniego", () => {
    // Formularz zaproszenia jest jeden na całą listę, a rysuje się POD
    // wierszem - wygląda więc, jakby należał do tego miejsca. Zanim to
    // naprawiono, adres wpisany dla miejsca pierwszego zostawał po
    // przełączeniu na drugie, przycisk „Wyślij" był od razu czynny, a jedno
    // kliknięcie wystawiało klucz do zapisu na cudze nazwisko - pod inne
    // miejsce, niż chciał organizator.
    h.rows = [packageSeatRow(), packageSeatRow({ id: SALES_IDS.otherSeat })];
    renderuj();
    otworzZaproszenie(0);
    fireEvent.change(poleAdresu(), { target: { value: "pierwszy@firma.test" } });

    otworzZaproszenie(0);
    otworzZaproszenie(1);

    expect(poleAdresu()).toHaveValue("");
  });
});
