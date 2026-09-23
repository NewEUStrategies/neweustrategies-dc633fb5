// Organizm „Bilety wydarzenia" - NARZĘDZIA STUDIA: wyszukiwarka, menu wiersza,
// kopia biletu i wygląd biletu zapisywany obok samego biletu.
//
// CO TEN PLIK DOWODZI.
//   1. WYSZUKIWARKA ŁAPIE NAZWĘ I KLUCZ bez względu na wielkość liter, a brak
//      trafień mówi „brak wyników" - NIE „nie ma biletów", bo bilety są, tylko
//      nie pasują do wpisanego tekstu.
//   2. KOPIA BILETU JEST NIEAKTYWNA I MA WOLNY KLUCZ. Klucz jest unikalny
//      w obrębie wydarzenia, więc kopia dostaje `<klucz>_copy`, a gdyby weszła
//      od razu do sprzedaży, uczestnicy widzieliby dwa identyczne bilety.
//      Wygląd oryginału (ukrycie, etykieta ceny, zapis grupowy) jedzie za kopią
//      pod NOWYM identyfikatorem - inaczej kopia wyglądałaby inaczej niż wzór.
//   3. KOPIOWANIE DO SCHOWKA MÓWI, CZY SIĘ UDAŁO. Przeglądarka potrafi odmówić
//      dostępu do schowka; organizator, który nie dostał sygnału, wkleiłby
//      w mailu stary adres.
//   4. ADRES REJESTRACJI POJAWIA SIĘ TYLKO, GDY PANEL ZNA ADRES WYDARZENIA.
//      Bez niego link byłby do nikąd, więc pozycji menu po prostu nie ma.
//   5. ZAPIS FORMULARZA ZAPISUJE TEŻ WYGLĄD pod identyfikatorem, który oddała
//      baza, a odmowa zapisu wyglądu dochodzi do organizatora zdaniem.
//   6. WIERSZ POKAZUJE WYGLĄD: ukryty bilet mówi „ukryty", bilet z zapisem
//      grupowym ma plakietkę, a nazwa grupy biletów idzie w języku interfejsu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Listy, przełącznika, kasowania i trasy
// formularza - ma je `EventTicketsPanel.test.tsx`. Reguł klucza kopii
// (`duplicateTicketKey`) i wyszukiwania - tabele przypadków są
// w `lib/events/__tests__/ticketPresentation.test.ts`; tutaj zostają PRAWDZIWE,
// bo dowodzimy, że panel przez nie przechodzi.
//
// Radix Popover i Switch nie działają pod happy-dom bez pełnego pointer API.
// Atrapa Popover trzyma PRAWDZIWY kontrakt sterowania: treść istnieje tylko przy
// `open`, a wyzwalacz przełącza stan przez `onOpenChange`, więc zamknięcie menu
// po wyborze pozycji jest dowodem na panel, nie na atrapę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";
import type { TicketPresentation } from "@/lib/events/ticketPresentation";

type WynikZapisu = { onSuccess?: (ticketId: string) => void; onError?: (error: unknown) => void };
type WynikWygladu = { onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  rows: [] as EventTicketRow[],
  saveCalls: [] as EventTicketInput[],
  saveError: null as Error | null,
  savedId: "nowy-bilet",
  looks: new Map<string, TicketPresentation>(),
  lookCalls: [] as { ticketId: string; value: TicketPresentation }[],
  lookError: null as Error | null,
  presentationSaves: [] as { ticketId: string; value: TicketPresentation }[],
  presentationFails: false,
  refetch: vi.fn(),
  clipboard: [] as string[],
  clipboardFails: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/http/host", () => ({ browserPublicOrigin: () => "https://nes.example" }));
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, "aria-label": etykieta }: { checked?: boolean; "aria-label"?: string }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={etykieta}
      checked={checked === true}
      readOnly
    />
  ),
}));

vi.mock("@/components/ui/popover", () => {
  const Menu = createContext<{ open: boolean; toggle: () => void }>({
    open: false,
    toggle: () => undefined,
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children?: ReactNode;
    }) => (
      <Menu.Provider value={{ open, toggle: () => onOpenChange(!open) }}>{children}</Menu.Provider>
    ),
    PopoverTrigger: ({ children }: { children?: ReactNode; asChild?: boolean }) => {
      const menu = useContext(Menu);
      return (
        <span data-testid="menu-wyzwalacz" onClickCapture={menu.toggle}>
          {children}
        </span>
      );
    },
    PopoverContent: ({ children }: { children?: ReactNode }) =>
      useContext(Menu).open ? <div data-testid="menu-tresc">{children}</div> : null,
  };
});

// Formularz biletu ma własny plik testowy. Tu liczy się STYK: czy panel podaje
// mu wygląd edytowanego biletu i czy daje mu „duplikuj" tylko przy edycji.
vi.mock("@/components/admin/events/molecules/EventTicketDialog", () => ({
  EventTicketDialog: ({
    open,
    ticket,
    onSubmit,
    presentation,
    onDuplicate,
    eventId,
  }: {
    open: boolean;
    ticket: EventTicketRow | null;
    onSubmit: (input: EventTicketInput, look: TicketPresentation) => void;
    presentation?: TicketPresentation;
    onDuplicate?: () => void;
    eventId: string;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-biletu"
        data-bilet={ticket === null ? "nowy" : ticket.id}
        data-ukryty={presentation === undefined ? "brak" : String(presentation.isHidden)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit(
              { ...ladunek(), eventId, id: ticket === null ? null : ticket.id },
              { ...WYGLAD_UKRYTY, priceLabelPl: "od 99 zł" },
            )
          }
        />
        {onDuplicate === undefined ? null : (
          <button type="button" data-testid="formularz-duplikuj" onClick={onDuplicate} />
        )}
      </div>
    ),
}));

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: () => ({ data: h.rows, isLoading: false, error: null }),
  useSaveEventTicket: () => ({
    mutate: (input: EventTicketInput, wynik: WynikZapisu) => {
      h.saveCalls.push(input);
      if (h.saveError === null) wynik.onSuccess?.(h.savedId);
      else wynik.onError?.(h.saveError);
    },
    isPending: false,
  }),
  useDeleteEventTicket: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/events/ticketPresentation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/ticketPresentation")>();
  return {
    ...actual,
    useTicketPresentation: () => ({ data: h.looks, refetch: h.refetch }),
    useSaveTicketPresentation: () => ({
      mutate: (args: { ticketId: string; value: TicketPresentation }, wynik: WynikWygladu) => {
        h.lookCalls.push(args);
        if (h.lookError !== null) wynik.onError?.(h.lookError);
      },
      isPending: false,
    }),
    saveTicketPresentation: async (ticketId: string, value: TicketPresentation) => {
      h.presentationSaves.push({ ticketId, value });
      if (h.presentationFails) throw new Error("presentation_denied");
      return true;
    },
  };
});

import { EventTicketsPanel } from "@/components/admin/events/organisms/EventTicketsPanel";
import { DEFAULT_TICKET_PRESENTATION } from "@/lib/events/ticketPresentation";
import { SALES_IDS, eventTicketRow } from "@/test/events/adminSalesRows";

const T = "adminEventRegistration.tickets";
const S = `${T}.studio`;

const WYGLAD_UKRYTY: TicketPresentation = {
  ...DEFAULT_TICKET_PRESENTATION,
  isHidden: true,
  groupRegistrationEnabled: true,
};

function ladunek(): EventTicketInput {
  return {
    id: null,
    eventId: SALES_IDS.event,
    key: "nowy_bilet",
    namePl: "Nowy",
    nameEn: "New",
    descriptionPl: "",
    descriptionEn: "",
    priceCents: 0,
    currency: "PLN",
    quota: null,
    salesFrom: null,
    salesTo: null,
    minTierRank: 0,
    requiresApproval: false,
    groupId: null,
    isActive: true,
    sortOrder: 10,
    earlyBirdPriceCents: null,
    earlyBirdUntil: null,
    accessCodeHint: "",
    waitlistEnabled: true,
    benefitsPl: [],
    benefitsEn: [],
    priceSchedule: [],
  };
}

/** `null` = panel NIE zna adresu wydarzenia (np. wydarzenie jeszcze bez adresu). */
function panel(eventSlug: string | null = "forum") {
  return render(<EventTicketsPanel eventId={SALES_IDS.event} eventSlug={eventSlug ?? undefined} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("row").slice(1);

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na ekranie`);
  return found;
};

const szukaj = (tekst: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: `${S}.search` }), {
    target: { value: tekst },
  });

const otworzMenu = (index = 0) =>
  fireEvent.click(within(wiersz(index)).getByRole("button", { name: `${S}.moreActions` }));

const pozycja = (nazwa: string): HTMLElement => screen.getByRole("menuitem", { name: nazwa });

const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-biletu" });

/** Obietnice schowka i zapisu wyglądu rozstrzygają się po mikrozadaniach. */
async function dokoncz() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.lang = "pl";
  h.rows = [eventTicketRow()];
  h.saveCalls = [];
  h.saveError = null;
  h.savedId = "nowy-bilet";
  h.looks = new Map();
  h.lookCalls = [];
  h.lookError = null;
  h.presentationSaves = [];
  h.presentationFails = false;
  h.refetch.mockClear();
  h.clipboard = [];
  h.clipboardFails = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (h.clipboardFails) throw new Error("clipboard_denied");
        h.clipboard.push(value);
      },
    },
  });
});

describe("wyszukiwarka biletów", () => {
  beforeEach(() => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket, key: "vip_pass", name_pl: "Karnet VIP" }),
      eventTicketRow({
        id: SALES_IDS.otherTicket,
        key: "student",
        name_pl: "Bilet studencki",
        name_en: "Student ticket",
      }),
    ];
  });

  it("bez wpisanego tekstu pokazuje wszystkie bilety", () => {
    panel();

    expect(wiersze()).toHaveLength(2);
  });

  it("małe litery znajdują nazwę zapisaną wielkimi", () => {
    panel();

    szukaj("vip");

    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("Karnet VIP")).toBeTruthy();
  });

  it("klucz biletu też jest szukany", () => {
    panel();

    szukaj("STUDENT");

    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("student")).toBeTruthy();
  });

  it("brak trafień mówi „brak wyników”, a NIE „nie ma biletów”", () => {
    panel();

    szukaj("nie-ma-takiego");

    expect(wiersze()).toHaveLength(0);
    expect(screen.getByText(`${S}.noResults`)).toBeTruthy();
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
  });

  it("wyczyszczenie pola przywraca pełną listę", () => {
    panel();
    szukaj("vip");

    szukaj("");

    expect(wiersze()).toHaveLength(2);
  });
});

describe("wiersz biletu - nazwa i wygląd", () => {
  it("kliknięcie nazwy otwiera formularz TEGO biletu razem z jego wyglądem", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket }),
      eventTicketRow({ id: SALES_IDS.otherTicket, name_pl: "Drugi" }),
    ];
    h.looks = new Map([[SALES_IDS.otherTicket, WYGLAD_UKRYTY]]);
    panel();

    fireEvent.click(within(wiersz(1)).getByRole("button", { name: "Drugi" }));

    expect(formularz().getAttribute("data-bilet")).toBe(SALES_IDS.otherTicket);
    expect(formularz().getAttribute("data-ukryty")).toBe("true");
  });

  it("bilet bez zapisanego wyglądu otwiera się z wyglądem domyślnym", () => {
    panel();

    fireEvent.click(within(wiersz()).getByRole("button", { name: "Karnet VIP" }));

    expect(formularz().getAttribute("data-ukryty")).toBe("false");
  });

  it("nowy bilet NIE dostaje cudzego wyglądu", () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: `${T}.addAction` }));

    expect(formularz().getAttribute("data-bilet")).toBe("nowy");
    expect(formularz().getAttribute("data-ukryty")).toBe("brak");
  });

  it("bilet bez nazwy w języku interfejsu pokazuje swój klucz", () => {
    h.lang = "en";
    h.rows = [eventTicketRow({ name_en: "", key: "bez_nazwy" })];
    panel();

    expect(within(wiersz()).getByRole("button", { name: "bez_nazwy" })).toBeTruthy();
  });

  it("ukryty bilet mówi „ukryty” i ma plakietkę zapisu grupowego", () => {
    h.looks = new Map([[SALES_IDS.ticket, WYGLAD_UKRYTY]]);
    panel();

    expect(within(wiersz()).getByText(`${S}.hidden`)).toBeTruthy();
    expect(within(wiersz()).getByText(`${S}.groupRegistration`)).toBeTruthy();
    expect(within(wiersz()).queryByText(`${S}.visible`)).toBeNull();
  });

  it("widoczny bilet bez zapisu grupowego nie ma tej plakietki", () => {
    panel();

    expect(within(wiersz()).getByText(`${S}.visible`)).toBeTruthy();
    expect(within(wiersz()).queryByText(`${S}.groupRegistration`)).toBeNull();
  });

  it("nazwa grupy biletów idzie po polsku w polskim interfejsie", () => {
    h.rows = [eventTicketRow({ group_name_pl: "Partnerzy", group_name_en: "Partners" })];
    panel();

    expect(within(wiersz()).getByText("Partnerzy")).toBeTruthy();
    expect(within(wiersz()).queryByText("Partners")).toBeNull();
  });

  it("nazwa grupy biletów idzie po angielsku w angielskim interfejsie", () => {
    h.lang = "en";
    h.rows = [eventTicketRow({ group_name_pl: "Partnerzy", group_name_en: "Partners" })];
    panel();

    expect(within(wiersz()).getByText("Partners")).toBeTruthy();
    expect(within(wiersz()).queryByText("Partnerzy")).toBeNull();
  });
});

describe("menu wiersza", () => {
  it("menu jest zamknięte, dopóki nikt go nie otworzy", () => {
    panel();

    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("otwarte menu ma trzy pozycje, gdy panel zna adres wydarzenia", () => {
    panel();

    otworzMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      `${S}.duplicate`,
      `${S}.copyUrl`,
      `${S}.ticketId`,
    ]);
  });

  it("bez adresu wydarzenia NIE ma pozycji „kopiuj link”", () => {
    panel(null);

    otworzMenu();

    expect(screen.queryByRole("menuitem", { name: `${S}.copyUrl` })).toBeNull();
    expect(pozycja(`${S}.ticketId`)).toBeTruthy();
  });

  it("drugie kliknięcie wyzwalacza zamyka menu", () => {
    panel();
    otworzMenu();

    otworzMenu();

    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("menu jednego wiersza nie otwiera menu drugiego", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket }),
      eventTicketRow({ id: SALES_IDS.otherTicket }),
    ];
    panel();

    otworzMenu(1);

    expect(within(wiersz(0)).queryByRole("menuitem")).toBeNull();
    expect(within(wiersz(1)).getAllByRole("menuitem")).toHaveLength(3);
  });
});

describe("kopiowanie do schowka", () => {
  it("„kopiuj link” wkleja adres rejestracji z kluczem biletu i mówi, że się udało", async () => {
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.copyUrl`));
    await dokoncz();

    expect(h.clipboard).toEqual(["https://nes.example/events/forum/register?ticket=vip_pass"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}.copied`);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("„identyfikator biletu” wkleja identyfikator wiersza", async () => {
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.ticketId`));
    await dokoncz();

    expect(h.clipboard).toEqual([SALES_IDS.ticket]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}.copied`);
  });

  it("odmowa schowka mówi to wprost i NIE udaje sukcesu", async () => {
    h.clipboardFails = true;
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.ticketId`));
    await dokoncz();

    expect(h.toastError).toHaveBeenCalledWith(`${S}.copyFailed`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("kopia biletu", () => {
  beforeEach(() => {
    h.rows = [eventTicketRow({ sort_order: 30 })];
    h.looks = new Map([[SALES_IDS.ticket, WYGLAD_UKRYTY]]);
    h.savedId = "kopia-id";
  });

  it("kopia z menu jest NIEAKTYWNA, ma wolny klucz, dopisek w nazwie i miejsce na końcu", async () => {
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.duplicate`));
    await dokoncz();

    expect(h.saveCalls).toHaveLength(1);
    expect(h.saveCalls[0]).toMatchObject({
      id: null,
      eventId: SALES_IDS.event,
      key: "vip_pass_copy",
      namePl: `Karnet VIP${S}.duplicateSuffixPl`,
      nameEn: `VIP pass${S}.duplicateSuffixEn`,
      isActive: false,
      sortOrder: 40,
    });
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("klucz kopii omija klucze już zajęte w tym wydarzeniu", async () => {
    h.rows = [
      eventTicketRow({ key: "vip_pass" }),
      eventTicketRow({ id: SALES_IDS.otherTicket, key: "vip_pass_copy" }),
    ];
    panel();
    otworzMenu(0);

    fireEvent.click(pozycja(`${S}.duplicate`));
    await dokoncz();

    expect(h.saveCalls[0]?.key).toBe("vip_pass_copy2");
  });

  it("wygląd oryginału jedzie za kopią pod NOWYM identyfikatorem i lista się odświeża", async () => {
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.duplicate`));
    await dokoncz();

    expect(h.presentationSaves).toEqual([{ ticketId: "kopia-id", value: WYGLAD_UKRYTY }]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}.duplicated`);
  });

  it("odmowa zapisu wyglądu kopii mówi to zdaniem i NIE odświeża listy", async () => {
    h.presentationFails = true;
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.duplicate`));
    await dokoncz();

    expect(h.toastError).toHaveBeenCalledWith("odmowa:presentation_denied");
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it("odmowa zapisu samej kopii nie próbuje zapisać wyglądu", async () => {
    h.saveError = new Error("tickets: duplicate_key");
    panel();
    otworzMenu();

    fireEvent.click(pozycja(`${S}.duplicate`));
    await dokoncz();

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tickets: duplicate_key");
    expect(h.presentationSaves).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("„duplikuj” w formularzu edycji kopiuje TEN bilet i zamyka formularz", async () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.editor.editTitle` }));

    fireEvent.click(screen.getByTestId("formularz-duplikuj"));
    await dokoncz();

    expect(h.saveCalls[0]).toMatchObject({ key: "vip_pass_copy", isActive: false });
    expect(screen.queryByRole("dialog", { name: "formularz-biletu" })).toBeNull();
  });

  it("formularz NOWEGO biletu nie ma „duplikuj” - nie ma czego kopiować", () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: `${T}.addAction` }));

    expect(screen.queryByTestId("formularz-duplikuj")).toBeNull();
  });
});

describe("zapis formularza razem z wyglądem", () => {
  it("wygląd zapisuje się pod identyfikatorem oddanym przez bazę", () => {
    h.savedId = "zapisany-id";
    panel();
    fireEvent.click(screen.getByRole("button", { name: `${T}.addAction` }));

    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.lookCalls).toEqual([
      { ticketId: "zapisany-id", value: { ...WYGLAD_UKRYTY, priceLabelPl: "od 99 zł" } },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.toasts.saved`);
  });

  it("odmowa zapisu wyglądu dochodzi do organizatora zdaniem", () => {
    h.lookError = new Error("presentation: forbidden");
    panel();
    fireEvent.click(screen.getByRole("button", { name: `${T}.addAction` }));

    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:presentation: forbidden");
  });

  it("odmowa zapisu biletu NIE zapisuje wyglądu", () => {
    h.saveError = new Error("tickets: duplicate_key");
    panel();
    fireEvent.click(screen.getByRole("button", { name: `${T}.addAction` }));

    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.lookCalls).toEqual([]);
    expect(formularz()).toBeTruthy();
  });
});
