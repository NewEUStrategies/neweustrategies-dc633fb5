// Organizm „PAKIETY GRUPOWE" - jedyny ekran modulu wydarzen, na ktorym stoja
// naraz OFERTA (pakiet), PIENIADZE (zamowienie) i MIEJSCA (pula do rozdania).
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY MAJA TRZY WIDOKI - OSOBNO dla pakietow i OSOBNO dla zamowien.
//      Awaria NIE MOZE mowic „to wydarzenie nie ma pakietow grupowych": po tym
//      zdaniu organizator zaklada DRUGI pakiet o tym samym kluczu i dostaje
//      odmowe unikalnosci. W sekcji zamowien ta sama pomylka jest grozniejsza:
//      „brak zamowien dla wybranego pakietu" po nieudanym zapytaniu czyta sie
//      jak „nikt nie kupil", czyli jak zgoda na wycofanie oferty.
//   2. CENA LICZY SIE Z GROSZY i respektuje WALUTE oraz JEZYK interfejsu.
//      `formatPrice` (:53) nie jest eksportowany, wiec dowodzimy go przez
//      wiersz: cena 125 000 groszy nie moze wygladac jak 125 000 zlotych,
//      pakiet w euro nie moze pokazywac zlotowek, a pakiet darmowy musi mowic
//      „0,00", a nie zostawiac pustego miejsca w kolumnie.
//   3. STRAZNIK STANU ZAMOWIENIA ODDAJE WARTOSC ZE `PACKAGE_ORDER_STATUSES`.
//      `orderStatus` (:60) tez nie jest eksportowany - dowodzimy przez pole
//      wyboru w wierszu. Stan nieznany bazie ma spasc na `pending`, a `refunded`
//      MA byc na liscie (komentarz w zrodle nazywa wprost pomylke, w ktorej
//      zamowienie zwrocone pokazywalo sie jako „oczekuje na platnosc").
//   4. PRZELACZNIK „AKTYWNY" WYSYLA CALY WIERSZ. RPC zapisu jest upsertem, wiec
//      pole pominiete w ladunku to pole wyczyszczone w bazie. To jest miejsce,
//      w ktorym jedno klikniecie po cichu gubi OKNO SPRZEDAZY, PROG
//      CZLONKOSTWA albo LIMIT - a naglowek pliku (:8-10) czyni ten przelacznik
//      PODSTAWOWYM narzedziem wycofania oferty, bo usuniecie dziala tylko dla
//      pakietu bez zamowien.
//   5. USUNIECIE IDZIE PRZEZ POTWIERDZENIE i z identyfikatorem TEGO wiersza,
//      a odmowa bazy („pakiet ma zamowienia") konczy sie zdaniem, nie cisza.
//   6. FILTR ZAMOWIEN JEDZIE DO WARSTWY DANYCH. To nie jest ukrywanie wierszy
//      w przegladarce - zapytanie o zamowienia pyta o JEDEN pakiet, wiec
//      pomylka w filtrze pokazuje cudze pieniadze albo zadne.
//   7. KAZDE ZAPYTANIE NIESIE IDENTYFIKATOR TEGO wydarzenia. Zawezenie
//      najemcem siedzi w SQL-u funkcji `admin_event_package*` (pilnuje go
//      bramka `check:sql-tenant-scope`), ale wybor WYDARZENIA jest po stronie
//      panelu i tylko tutaj da sie go pomylic.
//   8. OKNA (pakiet, zamowienie, miejsca) dostaja to, czego potrzebuja, a
//      odmowa zapisu NIE zamyka formularza - inaczej organizator traci wpisana
//      oferte razem z komunikatem.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Formularza pakietu i formularza zamowienia -
// maja wlasne pliki (`EventPackageDialog.test.tsx`, `EventPackageOrderDialog`),
// tutaj sa atrapami i liczy sie STYK. (2) Okna miejsc - `EventPackageSeatsDialog`
// jest osobnym organizmem z wlasnym zestawem zapytan; dowodzimy WEJSCIA do niego.
// (3) Slownika odmow bazy (`adminRegistrationErrors`) - ma wlasny plik i ciagnie
// realny i18next. (4) Tabel konwersji szkicu (`packageDraft`) - te ida
// PRAWDZIWE, bo przedmiotem dowodu jest to, ze przelacznik przepuszcza przez nie
// CALY wiersz i nic po drodze nie ginie. (5) Warstwy `packagesApi` - ladunek RPC
// ma swoj plik; tutaj konczymy na wejsciu do hooka.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, type RenderResult } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import {
  PACKAGE_ORDER_STATUSES,
  type EventPackageInput,
  type EventPackageOrderRow,
  type EventPackageRow,
  type PackageOrderInput,
  type PackageOrderStatus,
} from "@/lib/events/packagesApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

/** Zmiana stanu zamowienia - ladunek, ktory panel oddaje do warstwy danych. */
interface ZmianaStanu {
  id: string;
  status: PackageOrderStatus;
}

/** Bilet w atrapie - okno pakietu czyta z niego tylko tozsamosc i nazwe. */
interface Bilet {
  id: string;
  name_pl: string;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  pakiety: [] as unknown[] | undefined,
  pakietyLadowanie: false,
  pakietyBlad: null as unknown,
  zamowienia: [] as unknown[] | undefined,
  zamowieniaLadowanie: false,
  zamowieniaBlad: null as unknown,
  bilety: [] as unknown[] | undefined,
  biletyBlad: null as unknown,
  wydarzeniaHookow: [] as string[],
  zapytaniaZamowien: [] as { eventId: string; packageId: string | null }[],
  zapisy: [] as unknown[],
  zapisBlad: null as unknown,
  zapisPending: false,
  kasowania: [] as string[],
  kasowanieBlad: null as unknown,
  noweZamowienia: [] as unknown[],
  noweZamowienieBlad: null as unknown,
  noweZamowieniePending: false,
  stany: [] as ZmianaStanu[],
  stanBlad: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Slownik odmow bazy ma wlasny plik testowy i ciagnie realny i18next; tutaj
// potrzebny jest wylacznie dowod, ze odmowa DOCHODZI zdaniem.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Switch nie przelacza sie pod happy-dom bez pelnego pointer API,
// a przelacznik „aktywny" jest tu glowna droga wycofania oferty ze sprzedazy.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

// Radix Select nie renderuje opcji bez pointer API - obie droplisty (filtr
// pakietu i stan zamowienia) sa natywnymi polami, ktorych wartosc jedzie ta
// sama droga (`onValueChange`). Atrapa przepuszcza `id` i `aria-label`, wiec
// pole nadal da sie znalezc etykieta, dokladnie jak w produkcji.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const stan: { open: boolean; onOpenChange?: (open: boolean) => void } = { open: false };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="alertdialog" aria-label="potwierdzenie">
          {children}
        </div>
      ) : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" onClick={() => stan.onOpenChange?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children?: ReactNode;
      onClick?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularz pakietu ma WLASNY plik testowy. Tutaj liczy sie STYK: z czym panel
// go otwiera (nowy czy edytowany wiersz, jakie bilety, jaka kolejnosc) i co
// robi z ladunkiem, ktory formularz oddaje.
vi.mock("@/components/admin/events/molecules/EventPackageDialog", () => ({
  EventPackageDialog: ({
    open,
    onOpenChange,
    eventId,
    eventPackage,
    tickets,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    eventPackage: { id: string } | null;
    tickets: readonly Bilet[];
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: EventPackageInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-pakietu"
        data-pakiet={eventPackage === null ? "nowy" : eventPackage.id}
        data-wydarzenie={eventId}
        data-kolejnosc={String(nextSortOrder)}
        data-bilety={tickets.map((ticket) => ticket.id).join(",")}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="pakiet-zapisz"
          onClick={() =>
            onSubmit({
              id: eventPackage === null ? null : eventPackage.id,
              eventId,
              key: "delegacja_20",
              ticketTypeId: "44444444-4444-4444-8444-444444444444",
              namePl: "Delegacja 20 miejsc",
              nameEn: "Delegation of 20",
              descriptionPl: "",
              descriptionEn: "",
              audience: "company",
              seats: 20,
              priceCents: 250000,
              currency: "PLN",
              quota: null,
              salesFrom: null,
              salesTo: null,
              minTierRank: 0,
              requiresVerification: false,
              isActive: true,
              sortOrder: nextSortOrder,
            })
          }
        />
        <button type="button" data-testid="pakiet-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

vi.mock("@/components/admin/events/molecules/EventPackageOrderDialog", () => ({
  EventPackageOrderDialog: ({
    open,
    onOpenChange,
    packageId,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageId: string;
    isSaving: boolean;
    onSubmit: (input: PackageOrderInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-zamowienia"
        data-pakiet={packageId}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="zamowienie-zapisz"
          onClick={() =>
            onSubmit({
              packageId,
              // RODO: platnik syntetyczny, domena dokumentacyjna.
              buyerEmail: "delegacja@example.org",
              buyerName: "Instytut Przykladowy",
              seatsTotal: null,
              amountCents: null,
              invoiceNote: "",
            })
          }
        />
        <button
          type="button"
          data-testid="zamowienie-zamknij"
          onClick={() => onOpenChange(false)}
        />
      </div>
    ),
}));

vi.mock("@/components/admin/events/molecules/EventPackageSeatsDialog", () => ({
  EventPackageSeatsDialog: ({
    open,
    onOpenChange,
    eventId,
    orderId,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    orderId: string | null;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="okno-miejsc"
        data-wydarzenie={eventId}
        data-zamowienie={orderId ?? "brak"}
      >
        <button type="button" data-testid="miejsca-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventPackages", () => ({
  useEventPackages: (eventId: string) => {
    h.wydarzeniaHookow.push(`useEventPackages:${eventId}`);
    return { data: h.pakiety, isLoading: h.pakietyLadowanie, error: h.pakietyBlad };
  },
  usePackageOrders: (eventId: string, packageId: string | null) => {
    h.zapytaniaZamowien.push({ eventId, packageId });
    return { data: h.zamowienia, isLoading: h.zamowieniaLadowanie, error: h.zamowieniaBlad };
  },
  useSaveEventPackage: (eventId: string) => {
    h.wydarzeniaHookow.push(`useSaveEventPackage:${eventId}`);
    return {
      mutate: (input: EventPackageInput, wynik?: Wynik<string>) => {
        h.zapisy.push(input);
        if (h.zapisBlad === null) wynik?.onSuccess?.("ok");
        else wynik?.onError?.(h.zapisBlad);
      },
      isPending: h.zapisPending,
    };
  },
  useDeleteEventPackage: (eventId: string) => {
    h.wydarzeniaHookow.push(`useDeleteEventPackage:${eventId}`);
    return {
      mutate: (id: string, wynik?: Wynik<boolean>) => {
        h.kasowania.push(id);
        if (h.kasowanieBlad === null) wynik?.onSuccess?.(true);
        else wynik?.onError?.(h.kasowanieBlad);
      },
      isPending: false,
    };
  },
  useCreatePackageOrder: (eventId: string) => {
    h.wydarzeniaHookow.push(`useCreatePackageOrder:${eventId}`);
    return {
      mutate: (input: PackageOrderInput, wynik?: Wynik<string>) => {
        h.noweZamowienia.push(input);
        if (h.noweZamowienieBlad === null) wynik?.onSuccess?.("ok");
        else wynik?.onError?.(h.noweZamowienieBlad);
      },
      isPending: h.noweZamowieniePending,
    };
  },
  useSetPackageOrderStatus: (eventId: string) => {
    h.wydarzeniaHookow.push(`useSetPackageOrderStatus:${eventId}`);
    return {
      mutate: (input: ZmianaStanu, wynik?: Wynik<boolean>) => {
        h.stany.push(input);
        if (h.stanBlad === null) wynik?.onSuccess?.(true);
        else wynik?.onError?.(h.stanBlad);
      },
      isPending: false,
    };
  },
}));

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: (eventId: string) => {
    h.wydarzeniaHookow.push(`useEventTickets:${eventId}`);
    return { data: h.bilety, isLoading: false, error: h.biletyBlad };
  },
}));

const { EventPackagesPanel } =
  await import("@/components/admin/events/organisms/EventPackagesPanel");

const T = "adminEventRegistration.packages";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PAKIET = "22222222-2222-4222-8222-222222222222";
const INNY_PAKIET = "33333333-3333-4333-8333-333333333333";
const BILET = "44444444-4444-4444-8444-444444444444";
const ZAMOWIENIE = "55555555-5555-4555-8555-555555555555";
const INNE_ZAMOWIENIE = "66666666-6666-4666-8666-666666666666";

/** Cena tak, jak powinna wyjsc z groszy - z waluta wiersza i jezykiem ekranu. */
function cena(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

function pakiet(overrides: Partial<EventPackageRow> = {}): EventPackageRow {
  return {
    audience: "company",
    created_at: "2026-08-01T10:00:00.000Z",
    currency: "PLN",
    description_en: "Ten seats for one payer",
    description_pl: "Dziesiec miejsc dla jednego platnika",
    event_id: WYDARZENIE,
    id: PAKIET,
    is_active: true,
    key: "delegacja_10",
    min_tier_rank: 2,
    name_en: "Delegation of 10",
    name_pl: "Delegacja 10 miejsc",
    orders_count: 1,
    price_cents: 125000,
    quota: null,
    requires_verification: true,
    sales_from: null,
    sales_to: null,
    seats: 10,
    seats_assigned: 4,
    sold_count: 3,
    sort_order: 20,
    ticket_name_en: "Delegate",
    ticket_name_pl: "Delegat",
    ticket_type_id: BILET,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function zamowienie(overrides: Partial<EventPackageOrderRow> = {}): EventPackageOrderRow {
  return {
    amount_cents: 125000,
    // RODO: platnik i adres syntetyczne, domena dokumentacyjna.
    buyer_email: "delegacja@example.org",
    buyer_name: "Instytut Przykladowy",
    cancelled_at: "",
    created_at: "2026-08-02T09:00:00.000Z",
    currency: "PLN",
    discount_cents: 0,
    event_id: WYDARZENIE,
    id: ZAMOWIENIE,
    invoice_note: "",
    package_id: PAKIET,
    package_name_en: "Delegation of 10",
    package_name_pl: "Delegacja 10 miejsc",
    paid_at: "",
    seats_assigned: 1,
    seats_invited: 2,
    seats_total: 10,
    status: "pending",
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function bilet(overrides: Partial<Bilet> = {}): Bilet {
  return { id: BILET, name_pl: "Delegat", ...overrides };
}

let widok: RenderResult | null = null;

function panel(): RenderResult {
  widok = render(<EventPackagesPanel eventId={WYDARZENIE} />);
  return widok;
}

/**
 * Sekcje sa dwie i kolejnosc jest tresciowa: najpierw OFERTA, potem SPRZEDAZ.
 * Szukamy po sekcjach, a nie po listach, bo w stanie pustym i w stanie awarii
 * lista danej sekcji w ogole nie istnieje - a wtedy „pierwsza lista na ekranie"
 * bylaby lista z DRUGIEJ sekcji.
 */
function sekcja(index: number): HTMLElement {
  if (widok === null) throw new Error("test: panel nie zostal wyrenderowany");
  const found = widok.container.querySelectorAll("section")[index];
  if (found === undefined) throw new Error(`brak sekcji nr ${index} na ekranie pakietow`);
  return found;
}

const wierszePakietow = (): HTMLElement[] => within(sekcja(0)).queryAllByRole("listitem");

const wierszeZamowien = (): HTMLElement[] => within(sekcja(1)).queryAllByRole("listitem");

const wierszPakietu = (index = 0): HTMLElement => {
  const found = wierszePakietow()[index];
  if (found === undefined) throw new Error(`brak wiersza pakietu nr ${index}`);
  return found;
};

const wierszZamowienia = (index = 0): HTMLElement => {
  const found = wierszeZamowien()[index];
  if (found === undefined) throw new Error(`brak wiersza zamowienia nr ${index}`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const przelacznik = (index = 0): HTMLElement => within(wierszPakietu(index)).getByRole("switch");

const filtr = (): HTMLSelectElement =>
  screen.getByLabelText(`${T}.orders.filterLabel`, { selector: "select" }) as HTMLSelectElement;

const poleStanu = (index = 0): HTMLSelectElement =>
  within(wierszZamowienia(index)).getByLabelText(`${T}.orders.status`) as HTMLSelectElement;

const wartosciOpcji = (pole: HTMLSelectElement): string[] =>
  Array.from(pole.querySelectorAll("option")).map((option) => option.value);

const formularzPakietu = (): HTMLElement =>
  screen.getByRole("dialog", { name: "formularz-pakietu" });
const formularzZamowienia = (): HTMLElement =>
  screen.getByRole("dialog", { name: "formularz-zamowienia" });
const oknoMiejsc = (): HTMLElement => screen.getByRole("dialog", { name: "okno-miejsc" });
const potwierdzenie = (): HTMLElement => screen.getByRole("alertdialog");

const ostatniZapis = (): EventPackageInput => h.zapisy[h.zapisy.length - 1] as EventPackageInput;
const ostatnieZapytanieZamowien = (): { eventId: string; packageId: string | null } => {
  const found = h.zapytaniaZamowien[h.zapytaniaZamowien.length - 1];
  if (found === undefined) throw new Error("panel nie zapytal o zamowienia ani razu");
  return found;
};

beforeEach(() => {
  widok = null;
  h.lang = "pl";
  h.pakiety = [pakiet()];
  h.pakietyLadowanie = false;
  h.pakietyBlad = null;
  h.zamowienia = [zamowienie()];
  h.zamowieniaLadowanie = false;
  h.zamowieniaBlad = null;
  h.bilety = [bilet()];
  h.biletyBlad = null;
  h.wydarzeniaHookow = [];
  h.zapytaniaZamowien = [];
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.noweZamowienia = [];
  h.noweZamowienieBlad = null;
  h.noweZamowieniePending = false;
  h.stany = [];
  h.stanBlad = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("trzy stany listy pakietow", () => {
  it("zapytanie w locie mowi „wczytywanie” i nie rysuje ani jednego pakietu", () => {
    h.pakietyLadowanie = true;
    h.pakiety = undefined;
    panel();

    expect(screen.getByText(`${T}.loading`)).toBeTruthy();
    expect(wierszePakietow()).toHaveLength(0);
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowe bazy i NIE mowi, ze pakietow nie ma", () => {
    // „To wydarzenie nie ma pakietow grupowych" po nieudanym zapytaniu to
    // nieprawda o stanie oferty - organizator zaklada wtedy pakiet o tym samym
    // kluczu i dostaje odmowe unikalnosci zamiast listy.
    h.pakiety = undefined;
    h.pakietyBlad = new Error("forbidden: brak dostepu");
    panel();

    expect(screen.getByText("odmowa:forbidden: brak dostepu")).toBeTruthy();
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
  });

  it("brak pakietow to „pusto”, a nie awaria", () => {
    h.pakiety = [];
    panel();

    expect(screen.getByText(`${T}.empty`)).toBeTruthy();
    expect(wierszePakietow()).toHaveLength(0);
  });
});

describe("trzy stany listy zamowien", () => {
  it("zapytanie w locie mowi „wczytywanie” zamowien, a lista pakietow zyje dalej", () => {
    h.zamowieniaLadowanie = true;
    h.zamowienia = undefined;
    panel();

    expect(screen.getByText(`${T}.orders.loading`)).toBeTruthy();
    expect(screen.queryByText(`${T}.orders.empty`)).toBeNull();
    expect(wierszePakietow()).toHaveLength(1);
  });

  it("awaria zamowien pokazuje odmowe, a nie „brak zamowien”", () => {
    // Tu pomylka jest grozniejsza niz przy pakietach: „brak zamowien" czyta sie
    // jak „nikt nie kupil", czyli jak zgoda na skasowanie oferty - a baza
    // odmowi kasowania pakietu ze sprzedaza.
    h.zamowienia = undefined;
    h.zamowieniaBlad = new Error("forbidden: brak dostepu do zamowien");
    panel();

    expect(screen.getByText("odmowa:forbidden: brak dostepu do zamowien")).toBeTruthy();
    expect(screen.queryByText(`${T}.orders.empty`)).toBeNull();
  });

  it("brak zamowien to „pusto”", () => {
    h.zamowienia = [];
    panel();

    expect(screen.getByText(`${T}.orders.empty`)).toBeTruthy();
    expect(wierszeZamowien()).toHaveLength(0);
  });
});

describe("wiersz pakietu", () => {
  it("mowi nazwe w jezyku interfejsu, razem z odbiorca, miejscami i biletem", () => {
    panel();

    expect(within(wierszPakietu()).getByText("Delegacja 10 miejsc")).toBeTruthy();
    expect(wierszPakietu().textContent).toContain(`${T}.audiences.company`);
    expect(wierszPakietu().textContent).toContain(`${T}.seatsLabel: 10`);
    expect(wierszPakietu().textContent).toContain(`${T}.ticketLabel: Delegat`);
  });

  it("po angielsku nazwa pakietu i nazwa biletu sa angielskie", () => {
    h.lang = "en";
    panel();

    expect(within(wierszPakietu()).getByText("Delegation of 10")).toBeTruthy();
    expect(wierszPakietu().textContent).toContain(`${T}.ticketLabel: Delegate`);
  });

  it("licznik sprzedanych stoi obok limitu, a pakiet BEZ limitu mowi to wprost", () => {
    // Bez tej pary organizator nie wie, czy zostalo jeszcze cokolwiek do
    // sprzedania - a „bez limitu" to WARTOSC, nie brak danych.
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, quota: 5, sold_count: 5 })];
    panel();

    expect(wierszPakietu(0).textContent).toContain(`${T}.soldLabel: 3 / ${T}.unlimitedQuota`);
    expect(wierszPakietu(1).textContent).toContain(`${T}.soldLabel: 5 / 5`);
  });

  it("liczba miejsc PRZYPISANYCH stoi w wierszu - to ona mowi, ile pakiet juz rozdal", () => {
    panel();

    expect(wierszPakietu().textContent).toContain(`${T}.assignedLabel: 4`);
  });

  it("znak weryfikacji pojawia sie TYLKO przy pakiecie, ktory jej wymaga", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, requires_verification: false })];
    panel();

    expect(within(wierszPakietu(0)).getByText(`${T}.verificationBadge`)).toBeTruthy();
    expect(within(wierszPakietu(1)).queryByText(`${T}.verificationBadge`)).toBeNull();
  });

  it("przelacznik pokazuje STAN oferty, a nie wlasny stan poczatkowy", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, is_active: false })];
    panel();

    expect(przelacznik(0)).toHaveAttribute("aria-checked", "true");
    expect(przelacznik(1)).toHaveAttribute("aria-checked", "false");
  });

  it("kolejnosc wierszy jest kolejnoscia z bazy - panel jej nie przestawia", () => {
    // Sortowanie robi RPC (`sort_order`); sortowanie w pamieci rozjechaloby
    // liste panelu z kolejnoscia oferty na stronie publicznej.
    h.pakiety = [
      pakiet({ id: INNY_PAKIET, name_pl: "Delegacja 5 miejsc", sort_order: 40 }),
      pakiet({ name_pl: "Delegacja 10 miejsc", sort_order: 20 }),
    ];
    panel();

    expect(within(wierszPakietu(0)).getByText("Delegacja 5 miejsc")).toBeTruthy();
    expect(within(wierszPakietu(1)).getByText("Delegacja 10 miejsc")).toBeTruthy();
  });
});

// Ceny asertujemy na `textContent`, a nie przez `getByText`: `Intl` wstawia
// miedzy grupy cyfr spacje NIEROZDZIELAJACA, a domyslny normalizator biblioteki
// zamienia ja na zwykla spacje - porownanie z napisem z `Intl` przestawaloby
// pasowac przy prawidlowym renderze.
describe("cena pakietu - grosze, waluta, jezyk", () => {
  it("liczy z GROSZY, a nie pokazuje ich jak zlotowek", () => {
    // 125 000 groszy to 1 250 zl. Zgubione dzielenie robi z pakietu oferte
    // stukrotnie drozsza - i nikt tego nie zauwaza, bo napis wyglada poprawnie.
    panel();

    expect(wierszPakietu().textContent).toContain(cena(125000, "PLN", "pl"));
    expect(wierszPakietu().textContent).not.toContain(
      new Intl.NumberFormat("pl", { style: "currency", currency: "PLN" }).format(125000),
    );
  });

  it("grosze niepelnych zlotych zostaja widoczne", () => {
    h.pakiety = [pakiet({ price_cents: 1999 })];
    panel();

    expect(wierszPakietu().textContent).toMatch(/19,99/);
  });

  it("pakiet w EURO nie pokazuje zlotowek", () => {
    h.pakiety = [pakiet({ currency: "EUR" })];
    panel();

    expect(wierszPakietu().textContent).toContain(cena(125000, "EUR", "pl"));
    expect(wierszPakietu().textContent).not.toContain(cena(125000, "PLN", "pl"));
  });

  it("jezyk interfejsu decyduje o zapisie kwoty", () => {
    h.lang = "en";
    panel();

    expect(wierszPakietu().textContent).toContain(cena(125000, "PLN", "en"));
    expect(wierszPakietu().textContent).not.toContain(cena(125000, "PLN", "pl"));
  });

  it("pakiet DARMOWY mowi „zero”, a nie zostawia pustej kolumny", () => {
    h.pakiety = [pakiet({ price_cents: 0 })];
    panel();

    expect(wierszPakietu().textContent).toContain(cena(0, "PLN", "pl"));
  });

  it("kwota zamowienia idzie ta sama droga - ze wlasna waluta zamowienia", () => {
    h.zamowienia = [zamowienie({ amount_cents: 99900, currency: "EUR" })];
    panel();

    expect(wierszZamowienia().textContent).toContain(cena(99900, "EUR", "pl"));
  });
});

describe("przelacznik „aktywny” wysyla CALY wiersz", () => {
  it("wycofanie oferty niesie komplet pol, nie sama flage", () => {
    // RPC zapisu jest upsertem: pole pominiete w ladunku to pole wyczyszczone
    // w bazie. Naglowek pliku czyni ten przelacznik PODSTAWOWYM narzedziem
    // wycofania oferty, wiec jedno klikniecie nie moze gubic progu
    // czlonkostwa, waluty ani wymogu weryfikacji.
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis()).toEqual({
      id: PAKIET,
      eventId: WYDARZENIE,
      key: "delegacja_10",
      ticketTypeId: BILET,
      namePl: "Delegacja 10 miejsc",
      nameEn: "Delegation of 10",
      descriptionPl: "Dziesiec miejsc dla jednego platnika",
      descriptionEn: "Ten seats for one payer",
      audience: "company",
      seats: 10,
      priceCents: 125000,
      currency: "PLN",
      quota: null,
      salesFrom: null,
      salesTo: null,
      minTierRank: 2,
      requiresVerification: true,
      isActive: false,
      sortOrder: 20,
    });
  });

  it("wlaczenie wycofanego pakietu idzie ta sama droga", () => {
    h.pakiety = [pakiet({ is_active: false })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().isActive).toBe(true);
  });

  it("pakiet BEZ limitu zostaje bez limitu - przelacznik nie wpisuje mu zera", () => {
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().quota).toBeNull();
  });

  it("limit sprzedazy przezywa przelaczenie", () => {
    h.pakiety = [pakiet({ quota: 7 })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().quota).toBe(7);
  });

  it("OKNO SPRZEDAZY przezywa przelaczenie - z dokladnoscia do minuty", () => {
    // Okno jedzie przez pole `datetime-local` (minuty), wiec sekundy sa poza
    // rozdzielczoscia formularza; CHWILA musi zostac ta sama.
    h.pakiety = [
      pakiet({ sales_from: "2026-09-10T08:30:00.000Z", sales_to: "2026-09-30T20:00:00.000Z" }),
    ];
    panel();
    fireEvent.click(przelacznik());

    expect(Date.parse(String(ostatniZapis().salesFrom))).toBe(
      Date.parse("2026-09-10T08:30:00.000Z"),
    );
    expect(Date.parse(String(ostatniZapis().salesTo))).toBe(Date.parse("2026-09-30T20:00:00.000Z"));
  });

  it("przelacznik dotyka DOKLADNIE swojego wiersza", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, name_pl: "Delegacja 5 miejsc" })];
    panel();
    fireEvent.click(przelacznik(1));

    expect(ostatniZapis().id).toBe(INNY_PAKIET);
  });

  it("odmowa bazy przy przelaczniku konczy sie ZDANIEM, nie cisza", () => {
    // Cisza znaczy tu „oferta zdjeta ze sprzedazy", a pakiet nadal sie sprzedaje.
    h.zapisBlad = new Error("forbidden: brak uprawnien");
    panel();
    fireEvent.click(przelacznik());

    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: brak uprawnien");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("formularz pakietu - styk z panelem", () => {
  it("„Dodaj pakiet” otwiera PUSTY formularz z podpowiedziana kolejnoscia", () => {
    h.pakiety = [pakiet({ sort_order: 20 }), pakiet({ id: INNY_PAKIET, sort_order: 40 })];
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-pakiet", "nowy");
    expect(formularzPakietu()).toHaveAttribute("data-kolejnosc", "50");
    expect(formularzPakietu()).toHaveAttribute("data-wydarzenie", WYDARZENIE);
  });

  it("pusta lista daje kolejnosc od zera - pierwszy pakiet nie startuje w prozni", () => {
    h.pakiety = [];
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-kolejnosc", "10");
  });

  it("olowek otwiera formularz TEGO wiersza", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
    panel();
    fireEvent.click(within(wierszPakietu(1)).getByRole("button", { name: `${T}.editAction` }));

    expect(formularzPakietu()).toHaveAttribute("data-pakiet", INNY_PAKIET);
  });

  it("formularz dostaje LISTE BILETOW - bez niej miejsca nie maja co nadawac", () => {
    h.bilety = [bilet(), bilet({ id: INNY_PAKIET, name_pl: "Delegat plus" })];
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-bilety", `${BILET},${INNY_PAKIET}`);
  });

  it("zanim bilety dojada, formularz dostaje PUSTA liste, a nie brak wartosci", () => {
    // Formularz przechodzi po tej liscie, zeby zlozyc droplista biletow -
    // `undefined` wywrocilby okno zamiast pokazac pusta droplista.
    h.bilety = undefined;
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-bilety", "");
  });

  it("zapis w toku dojezdza do formularza - to on gasi swoje przyciski", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-zapis", "true");
  });

  it("udany zapis zamyka formularz, melduje sie i oddaje ladunek warstwie danych", () => {
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));
    fireEvent.click(screen.getByTestId("pakiet-zapisz"));

    expect(ostatniZapis().key).toBe("delegacja_20");
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-pakietu" })).toBeNull();
  });

  it("ODMOWA ZAPISU NIE ZAMYKA formularza - wpisana oferta zostaje na ekranie", () => {
    h.zapisBlad = new Error("duplicate_key: klucz zajety");
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));
    fireEvent.click(screen.getByTestId("pakiet-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:duplicate_key: klucz zajety");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Formularz ma nie tylko ZOSTAC na ekranie, ale nadal dzialac: po
    // poprawieniu klucza druga proba musi dojsc do warstwy danych, a nie
    // odbic sie od okna, ktore panel po cichu zablokowal.
    expect(formularzPakietu()).toHaveAttribute("data-pakiet", "nowy");
    fireEvent.click(screen.getByTestId("pakiet-zapisz"));
    expect(h.zapisy).toHaveLength(2);
  });

  it("zamkniecie formularza przez uzytkownika nie wysyla niczego", () => {
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));
    fireEvent.click(screen.getByTestId("pakiet-zamknij"));

    expect(screen.queryByRole("dialog", { name: "formularz-pakietu" })).toBeNull();
    expect(h.zapisy).toHaveLength(0);
  });

  it("po edycji jednego wiersza „Dodaj pakiet” wraca do PUSTEGO formularza", () => {
    // Bez tego kolejny „Dodaj" edytowalby po cichu poprzednio otwarty pakiet.
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.editAction` }));
    fireEvent.click(screen.getByTestId("pakiet-zamknij"));
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularzPakietu()).toHaveAttribute("data-pakiet", "nowy");
  });
});

describe("usuniecie pakietu - tylko przez potwierdzenie", () => {
  it("kosz nie kasuje od razu - najpierw pyta, i mowi, ze usuniecie ma warunek", () => {
    // Baza odmawia usuniecia pakietu z zamowieniami, wiec okno musi powiedziec
    // wprost, ze pakiet ze sprzedaza wylacza sie przelacznikiem.
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.deleteAction` }));

    expect(within(potwierdzenie()).getByText(`${T}.deleteTitle`)).toBeTruthy();
    expect(within(potwierdzenie()).getByText(`${T}.deleteDescription`)).toBeTruthy();
    expect(h.kasowania).toHaveLength(0);
  });

  it("potwierdzenie kasuje TEN wiersz i mowi o tym", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
    panel();
    fireEvent.click(within(wierszPakietu(1)).getByRole("button", { name: `${T}.deleteAction` }));
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${T}.deleteConfirm` }));

    expect(h.kasowania).toEqual([INNY_PAKIET]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.toasts.deleted`);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("PAKIET Z ZAMOWIENIAMI nie znika po cichu - odmowa bazy jest zdaniem", () => {
    h.kasowanieBlad = new Error("package_in_use: 2 order(s)");
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.deleteAction` }));
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${T}.deleteConfirm` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:package_in_use: 2 order(s)");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rezygnacja z potwierdzenia nie kasuje niczego", () => {
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.deleteAction` }));
    fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${T}.cancel` }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.kasowania).toHaveLength(0);
  });

  it("bez klikniecia w kosz zadnego potwierdzenia na ekranie nie ma", () => {
    panel();

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("wiersz zamowienia", () => {
  it("mowi, KTO zaplacil, a przy braku nazwy - adres poczty platnika", () => {
    h.zamowienia = [zamowienie(), zamowienie({ id: INNE_ZAMOWIENIE, buyer_name: "" })];
    panel();

    expect(within(wierszZamowienia(0)).getByText("Instytut Przykladowy")).toBeTruthy();
    expect(within(wierszZamowienia(1)).getByText("delegacja@example.org")).toBeTruthy();
  });

  it("mowi, KTOREGO pakietu dotyczy - w jezyku interfejsu", () => {
    h.lang = "en";
    panel();

    expect(wierszZamowienia().textContent).toContain("Delegation of 10");
  });

  it("pokazuje rozliczenie miejsc: przypisane, zaproszone i cala pula", () => {
    // Bez tej trojki organizator nie wie, ile miejsc z oplaconego pakietu
    // jeszcze nie ma nazwiska - a to jest cala tresc pracy przy pakiecie.
    panel();

    expect(wierszZamowienia().textContent).toContain(
      `${T}.orders.seatsSummary(assigned=1,invited=2,total=10)`,
    );
  });
});

describe("stan zamowienia - straznik listy stanow", () => {
  it("pole wyboru oferuje DOKLADNIE stany, ktore zna baza - razem ze „zwrocone”", () => {
    panel();

    expect(wartosciOpcji(poleStanu())).toEqual([...PACKAGE_ORDER_STATUSES]);
  });

  it("zamowienie ZWROCONE pokazuje sie jako zwrocone, a nie jako „oczekuje na platnosc”", () => {
    h.zamowienia = [zamowienie({ status: "refunded" })];
    panel();

    expect(poleStanu().value).toBe("refunded");
  });

  it("stan nieznany liscie spada na „pending”, a nie przecieka do pola wyboru", () => {
    // Recznie wypisane `paid`/`cancelled` gubily `refunded`; straznik czyta
    // LISTE stanow, wiec napis z przyszlej migracji nie wywraca tabeli.
    h.zamowienia = [zamowienie({ status: "chargeback" })];
    panel();

    expect(poleStanu().value).toBe("pending");
    expect(wartosciOpcji(poleStanu())).not.toContain("chargeback");
  });

  it("zmiana stanu idzie z identyfikatorem TEGO zamowienia i melduje sie", () => {
    h.zamowienia = [zamowienie(), zamowienie({ id: INNE_ZAMOWIENIE })];
    panel();
    fireEvent.change(poleStanu(1), { target: { value: "paid" } });

    expect(h.stany).toEqual([{ id: INNE_ZAMOWIENIE, status: "paid" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.orders.toasts.statusChanged`);
  });

  it("odmowa przy zmianie stanu konczy sie zdaniem - bez niej pieniadze „sa zaksiegowane”", () => {
    h.stanBlad = new Error("forbidden: brak uprawnien do zamowien");
    panel();
    fireEvent.change(poleStanu(), { target: { value: "cancelled" } });

    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: brak uprawnien do zamowien");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("filtr zamowien jedzie do warstwy danych", () => {
  it("bez filtra panel pyta o zamowienia CALEGO wydarzenia", () => {
    panel();

    expect(ostatnieZapytanieZamowien()).toEqual({ eventId: WYDARZENIE, packageId: null });
  });

  it("filtr oferuje „wszystkie pakiety” i po jednym wpisie na pakiet", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
    panel();

    expect(wartosciOpcji(filtr())).toEqual(["all", PAKIET, INNY_PAKIET]);
  });

  it("wybor pakietu ZAWEZA zapytanie, a powrot do „wszystkich” je otwiera", () => {
    // Filtr nie ukrywa wierszy w przegladarce - zapytanie pyta o JEDEN pakiet.
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
    panel();

    fireEvent.change(filtr(), { target: { value: INNY_PAKIET } });
    expect(ostatnieZapytanieZamowien()).toEqual({
      eventId: WYDARZENIE,
      packageId: INNY_PAKIET,
    });

    fireEvent.change(filtr(), { target: { value: "all" } });
    expect(ostatnieZapytanieZamowien()).toEqual({ eventId: WYDARZENIE, packageId: null });
  });

  it("etykiety filtra ida za jezykiem interfejsu", () => {
    h.lang = "en";
    panel();

    expect(within(filtr()).getByText("Delegation of 10")).toBeTruthy();
  });
});

describe("zamowienie zakladane z panelu", () => {
  it("ikona uczestnikow otwiera formularz zamowienia dla TEGO pakietu", () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
    panel();
    fireEvent.click(
      within(wierszPakietu(1)).getByRole("button", { name: `${T}.orders.addAction` }),
    );

    expect(formularzZamowienia()).toHaveAttribute("data-pakiet", INNY_PAKIET);
  });

  it("bez klikniecia formularza zamowienia na ekranie nie ma", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "formularz-zamowienia" })).toBeNull();
  });

  it("udane zalozenie zamowienia zamyka formularz i oddaje ladunek", () => {
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.orders.addAction` }));
    fireEvent.click(screen.getByTestId("zamowienie-zapisz"));

    expect(h.noweZamowienia).toEqual([
      {
        packageId: PAKIET,
        buyerEmail: "delegacja@example.org",
        buyerName: "Instytut Przykladowy",
        seatsTotal: null,
        amountCents: null,
        invoiceNote: "",
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.orders.toasts.created`);
    expect(screen.queryByRole("dialog", { name: "formularz-zamowienia" })).toBeNull();
  });

  it("odmowa NIE zamyka formularza zamowienia - dane platnika zostaja", () => {
    h.noweZamowienieBlad = new Error("package_inactive: pakiet nieaktywny");
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.orders.addAction` }));
    fireEvent.click(screen.getByTestId("zamowienie-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:package_inactive: pakiet nieaktywny");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // Okno musi zostac przy TYM pakiecie: dane platnika sa w srodku, wiec
    // zamkniecie albo przestawienie pakietu kaze wpisywac je od nowa.
    expect(formularzZamowienia()).toHaveAttribute("data-pakiet", PAKIET);
  });

  it("zapis w toku dojezdza do formularza zamowienia", () => {
    h.noweZamowieniePending = true;
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.orders.addAction` }));

    expect(formularzZamowienia()).toHaveAttribute("data-zapis", "true");
  });

  it("rezygnacja zamyka formularz zamowienia i NIE zaklada zamowienia", () => {
    // Zamkniecie musi tez zwolnic pakiet, ktorego formularz dotyczyl - inaczej
    // nastepne otwarcie zaczyna od poprzedniego platnika.
    panel();
    fireEvent.click(within(wierszPakietu()).getByRole("button", { name: `${T}.orders.addAction` }));
    fireEvent.click(screen.getByTestId("zamowienie-zamknij"));

    expect(screen.queryByRole("dialog", { name: "formularz-zamowienia" })).toBeNull();
    expect(h.noweZamowienia).toHaveLength(0);
  });
});

describe("okno miejsc", () => {
  it("otwiera sie dla TEGO zamowienia i niesie wydarzenie", () => {
    // Bez identyfikatora wydarzenia okno miejsc nie unieważni list panelu po
    // wystawieniu zaproszenia - liczniki zostana z poprzedniego stanu.
    h.zamowienia = [zamowienie(), zamowienie({ id: INNE_ZAMOWIENIE })];
    panel();
    fireEvent.click(
      within(wierszZamowienia(1)).getByRole("button", { name: `${T}.orders.manageSeats` }),
    );

    expect(oknoMiejsc()).toHaveAttribute("data-zamowienie", INNE_ZAMOWIENIE);
    expect(oknoMiejsc()).toHaveAttribute("data-wydarzenie", WYDARZENIE);
  });

  it("bez klikniecia okno miejsc nie jest zamontowane - nie pyta o niczyje miejsca", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "okno-miejsc" })).toBeNull();
  });

  it("zamkniecie okna ODPINA je od zamowienia - inaczej pyta o miejsca w tle", () => {
    // Okno miejsc ma wlasne zapytanie zawezone identyfikatorem zamowienia;
    // zostawienie identyfikatora po zamknieciu trzymaloby to zapytanie przy
    // zyciu i odswiezalo dane, ktorych nikt juz nie oglada.
    panel();
    fireEvent.click(
      within(wierszZamowienia()).getByRole("button", { name: `${T}.orders.manageSeats` }),
    );
    fireEvent.click(screen.getByTestId("miejsca-zamknij"));

    expect(screen.queryByRole("dialog", { name: "okno-miejsc" })).toBeNull();
  });
});

describe("zawezenie wydarzeniem", () => {
  it("KAZDE zapytanie i KAZDA mutacja dostaja identyfikator TEGO wydarzenia", () => {
    // Zawezenie NAJEMCA siedzi w SQL-u funkcji `admin_event_package*` (pilnuje
    // go bramka `check:sql-tenant-scope`); po stronie panelu da sie pomylic
    // wylacznie WYDARZENIE - i wtedy ekran pokazuje cudza sprzedaz.
    panel();

    // Wyliczamy hooki Z NAZWY, a nie samo „ktos dostal jakies wydarzenie":
    // hook, ktory po refaktorze przestanie pytac o wydarzenie panelu, ma tu
    // upasc razem z hookiem, ktory zniknie z ekranu.
    expect([...new Set(h.wydarzeniaHookow)].sort()).toEqual(
      [
        "useCreatePackageOrder",
        "useDeleteEventPackage",
        "useEventPackages",
        "useEventTickets",
        "useSaveEventPackage",
        "useSetPackageOrderStatus",
      ]
        .map((hook) => `${hook}:${WYDARZENIE}`)
        .sort(),
    );
    expect([...new Set(h.zapytaniaZamowien.map((query) => query.eventId))]).toEqual([WYDARZENIE]);
  });

  it("ladunek zapisu niesie wydarzenie panelu, a nie wydarzenie z wiersza", () => {
    // Wiersz przychodzi z RPC i moze niesc cokolwiek; zrodlem prawdy jest
    // wydarzenie, na ktorego ekranie stoi organizator.
    h.pakiety = [pakiet({ event_id: "99999999-9999-4999-8999-999999999999" })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().eventId).toBe(WYDARZENIE);
  });
});

describe("dostepnosc", () => {
  it("ekran z danymi nie ma naruszen axe", async () => {
    h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, name_pl: "Delegacja 5 miejsc" })];
    h.zamowienia = [zamowienie()];
    const { container } = panel();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan pusty i stan awarii tez nie maja naruszen axe", async () => {
    h.pakiety = [];
    h.zamowienia = [];
    const pusty = panel();
    const bezPakietow = await axeViolations(pusty.container);
    expect(bezPakietow, summarize(bezPakietow)).toEqual([]);
    pusty.unmount();

    h.pakiety = undefined;
    h.pakietyBlad = new Error("forbidden: brak dostepu");
    h.zamowienia = undefined;
    h.zamowieniaBlad = new Error("forbidden: brak dostepu");
    const awaria = panel();
    const naruszenia = await axeViolations(awaria.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("trzy ikony w wierszu pakietu maja nazwy - inaczej czytnik oglasza trzy bezimienne przyciski", () => {
    panel();

    // Bierzemy WSZYSTKIE przyciski wiersza, a nie trzy znane z nazwy: dopisanie
    // czwartej ikony bez etykiety ma ten test przewrocic, bo dla czytnika
    // ekranu te ikony roznia sie wylacznie nazwa, a jedna z nich kasuje pakiet.
    const nazwy = within(wierszPakietu())
      .getAllByRole("button")
      .map((guzik) => guzik.getAttribute("aria-label"));

    expect(nazwy).toEqual([`${T}.editAction`, `${T}.orders.addAction`, `${T}.deleteAction`]);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: przelacznik „aktywny" dostaje w KAZDYM wierszu te sama etykiete
  // (`packages.editor.active`). Osoba korzystajaca z czytnika slyszy N razy
  // „Aktywny" i nie wie, KTORA oferte wlasnie zdejmuje ze sprzedazy - a to jest
  // podstawowe narzedzie wycofania pakietu (naglowek pliku, :8-10). axe tego
  // nie zlapie: formalnie kazdy przelacznik MA nazwe. Etykieta powinna niesc
  // nazwe pakietu. Ten sam defekt jest zarejestrowany w `SponsorTiersPanel`.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: przelaczniki „aktywny” w dwoch wierszach maja IDENTYCZNA nazwe - czytnik nie mowi, ktorego pakietu dotycza",
    () => {
      h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET, name_pl: "Delegacja 5 miejsc" })];
      panel();

      const nazwy = wierszePakietow().map((wiersz) =>
        within(wiersz).getByRole("switch").getAttribute("aria-label"),
      );

      // Asercja opisuje stan PO naprawie, nie sam fakt duplikatu: nazwa
      // przelacznika ma niesc pakiet, ktorego dotyczy. Dzis obie sa golym
      // kluczem `editor.active`, wiec obie linie padaja.
      expect(nazwy[0]).toContain("Delegacja 10 miejsc");
      expect(nazwy[1]).toContain("Delegacja 5 miejsc");
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT: pole stanu zamowienia ma w kazdym wierszu te sama etykiete
  // („Stan") i nie mowi, KTOREGO platnika dotyczy. Konsekwencja jest tu
  // finansowa, nie kosmetyczna: dwa zamowienia obok siebie, dwa identycznie
  // nazwane pola, i „oplacone" trafia w cudze zamowienie. Etykieta powinna
  // niesc platnika albo pakiet.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: pola stanu dwoch zamowien maja IDENTYCZNA nazwe - „oplacone” da sie wpisac w cudze zamowienie",
    () => {
      h.zamowienia = [zamowienie(), zamowienie({ id: INNE_ZAMOWIENIE, buyer_name: "Fundacja X" })];
      panel();

      const nazwy = wierszeZamowien().map((wiersz) =>
        within(wiersz).getByRole("combobox").getAttribute("aria-label"),
      );

      // Nazwa pola ma niesc platnika (albo pakiet), zeby „oplacone" nie dalo
      // sie wpisac w cudze zamowienie. Dzis oba pola nazywaja sie tak samo.
      expect(nazwy[0]).toContain("Instytut Przykladowy");
      expect(nazwy[1]).toContain("Fundacja X");
    },
  );
});

describe("defekty zarejestrowane", () => {
  // ---------------------------------------------------------------------------
  // DEFEKT: pakiet WYCOFANY wyglada na liscie jak pakiet w sprzedazy. Jedynym
  // sygnalem jest pozycja przelacznika, a slownik ma na to gotowy napis
  // (`adminEventRegistration.packages.inactiveBadge`, PL i EN), ktorego zaden
  // ekran nie uzywa. Skoro usuniecie dziala tylko dla pakietu bez zamowien,
  // „nieaktywny" jest DOCELOWYM stanem wycofanej oferty i musi byc widoczny
  // z rzutu oka, a nie po sprawdzeniu kazdego przelacznika po kolei.
  // ---------------------------------------------------------------------------
  it.fails("DEFEKT: wycofany pakiet nie ma znaku „nieaktywny”, choc slownik go ma", () => {
    h.pakiety = [pakiet({ is_active: false })];
    panel();

    expect(within(wierszPakietu()).getByText(`${T}.inactiveBadge`)).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: nieudane zapytanie o BILETY jest niewidoczne. Panel oddaje do
  // formularza `ticketsQ.data ?? []`, wiec po odmowie okno pakietu pokazuje
  // PUSTA liste biletow - a bilet jest polem wymaganym. Organizator widzi
  // „wybierz bilet" nad pusta droplista i nie ma sladu, ze to zapytanie
  // padlo. Odmowa powinna dojsc zdaniem, tak jak przy pakietach i zamowieniach.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: awaria listy biletow nigdzie nie widnieje - formularz dostaje pusta liste",
    () => {
      h.bilety = [];
      h.biletyBlad = new Error("forbidden: brak dostepu do biletow");
      panel();

      expect(screen.getByText("odmowa:forbidden: brak dostepu do biletow")).toBeTruthy();
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT: filtr zamowien przezywa skasowanie pakietu, po ktorym filtruje, i od
  // tej chwili KLAMIE. Scenariusz jest osiagalny z TEGO ekranu: organizator
  // zawezil zamowienia do pakietu B, skasowal pakiet B (baza pozwala, bo B nie
  // ma zamowien), lista pakietow wrocila bez B - a `filterPackageId` nadal
  // trzyma jego identyfikator. Zapytanie pyta wiec o zamowienia pakietu, ktorego
  // nie ma (sekcja mowi „brak zamowien dla wybranego pakietu", czyli „nikt nic
  // nie kupil" na calym wydarzeniu), a kontrolka filtra pokazuje juz cos INNEGO
  // niz zawezenie zapytania, bo jej wartosc nie ma odpowiednika w opcjach.
  // Filtr powinien wracac na „wszystkie pakiety", gdy jego pakiet znika z listy.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: filtr po skasowanym pakiecie zostaje w mocy - zamowienia calego wydarzenia znikaja",
    () => {
      h.pakiety = [pakiet(), pakiet({ id: INNY_PAKIET })];
      const { rerender } = panel();

      fireEvent.change(filtr(), { target: { value: INNY_PAKIET } });
      fireEvent.click(within(wierszPakietu(1)).getByRole("button", { name: `${T}.deleteAction` }));
      fireEvent.click(within(potwierdzenie()).getByRole("button", { name: `${T}.deleteConfirm` }));

      // Odswiezenie listy po skasowaniu: pakietu INNY_PAKIET juz nie ma.
      h.pakiety = [pakiet()];
      rerender(<EventPackagesPanel eventId={WYDARZENIE} />);

      // Dwie strony tej samej prawdy, obie dzis nieprawdziwe: zapytanie ma
      // znowu objac cale wydarzenie, a kontrolka ma to pokazywac wpisem
      // „wszystkie pakiety". Wartosc filtra NIE moze byc liczona z zapytania -
      // wtedy asercja sprawdzalaby sama siebie.
      expect(ostatnieZapytanieZamowien().packageId).toBeNull();
      expect(filtr().value).toBe("all");
    },
  );
});
