// Molekuła „Formularz biletu" - CZĘŚĆ STUDIA: wygląd biletu, typ biletu,
// podgląd, adres rejestracji i kopia.
//
// CO TEN PLIK DOWODZI.
//   1. WYGLĄD JEDZIE OSOBNO OD BILETU. Ukrycie, etykieta ceny, zapis grupowy
//      i sposób liczenia podatku trafiają do DRUGIEGO argumentu `onSubmit` -
//      ładunek biletu ich nie niesie, bo baza trzyma je w innej tabeli.
//      Otwarcie istniejącego biletu zaczyna od JEGO wyglądu, nie od domyślnego.
//   2. „BEZPŁATNY" ZERUJE WSZYSTKO, CO KOSZTUJE: cenę, cenę promocyjną i progi
//      cenowe. Bilet oznaczony jako bezpłatny z ceną w ładunku pobrałby opłatę.
//      Wpisanie kwoty > 0 samo przełącza typ na „płatny".
//   3. ETYKIETA CENY MA DWA JĘZYKI i znika z formularza, gdy organizator ją
//      wyłączy - pole bez skutku byłoby obietnicą bez pokrycia.
//   4. ROZMIAR GRUPY JEST PRZYCIĘTY DO GRANIC (2-50), zanim dotrze do ładunku.
//   5. BŁĄD W POLU DRUGIEGO JĘZYKA PRZEŁĄCZA ZAKŁADKĘ, bo komunikat stałby
//      w niewidocznej karcie, a przycisk „nic by nie robił".
//   6. PODGLĄD MÓWI TO, CO ZOBACZY UCZESTNIK: własną etykietę, a bez niej kwotę
//      płatnego biletu albo „bezpłatny"; wyłączona etykieta - brak ceny.
//   7. ADRES REJESTRACJI I IDENTYFIKATOR ISTNIEJĄ TYLKO DLA ZAPISANEGO BILETU
//      w wydarzeniu z adresem; kopiowanie mówi, czy się udało.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Czternastu pól biletu, groszy i trzech stanów
// kodu dostępu - ma je `EventTicketDialog.test.tsx`. Podglądu jako atomu - ma
// go `EventTicketPreview.test.tsx`; tutaj liczy się, CO formularz mu podaje.
//
// Radix Dialog i Select nie działają pod happy-dom bez pełnego pointer API -
// atrapy jak w `EventTicketDialog.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SALES_IDS, eventTicketRow } from "@/test/events/adminSalesRows";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";
import type { EventGroupRow } from "@/lib/events/termsGroupsApi";
import {
  DEFAULT_TICKET_PRESENTATION,
  type TicketPresentation,
} from "@/lib/events/ticketPresentation";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  groups: [] as EventGroupRow[] | undefined,
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
vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: () => ({ data: h.groups, isLoading: false, error: null }),
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
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

import { EventTicketDialog } from "@/components/admin/events/molecules/EventTicketDialog";

const onSubmit = vi.fn<(input: EventTicketInput, look: TicketPresentation) => void>();
const onDuplicate = vi.fn();

const E = "adminEventRegistration.tickets.editor.";
const S = "adminEventRegistration.tickets.studio.";

interface Wejscie {
  ticket?: EventTicketRow | null;
  eventSlug?: string;
  presentation?: TicketPresentation;
  withDuplicate?: boolean;
}

function renderuj(props: Wejscie = {}) {
  return render(
    <EventTicketDialog
      open
      onOpenChange={vi.fn()}
      eventId={SALES_IDS.event}
      ticket={props.ticket ?? null}
      nextSortOrder={30}
      isSaving={false}
      onSubmit={onSubmit}
      eventSlug={props.eventSlug}
      presentation={props.presentation}
      onDuplicate={props.withDuplicate === true ? onDuplicate : undefined}
    />,
  );
}

function grupa(patch: Partial<EventGroupRow>): EventGroupRow {
  return {
    attendee_visibility: "all",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#000000",
    created_at: "",
    description_en: "",
    description_pl: "",
    event_id: SALES_IDS.event,
    extra_members_count: 0,
    id: "grupa-1",
    is_default: false,
    is_system: false,
    key: "partners",
    members_count: 0,
    min_tier_rank: 0,
    name_en: "Partners",
    name_pl: "Partnerzy",
    primary_members_count: 0,
    sort_order: 10,
    tickets_count: 0,
    updated_at: "",
    ...patch,
  };
}

const pole = (etykieta: string) => screen.getByLabelText(etykieta);
const wpisz = (etykieta: string, value: string) =>
  fireEvent.change(pole(etykieta), { target: { value } });
const zapisz = () => fireEvent.click(screen.getByRole("button", { name: `${E}saveAction` }));
const wybor = (etykieta: string) => screen.getByRole("radio", { name: etykieta });
const przelacznik = (etykieta: string) => screen.getByRole("switch", { name: etykieta });
const zakladka = (etykieta: string) => screen.getByRole("tab", { name: etykieta });
const podglad = () => screen.getByRole("region", { name: `${S}preview` });

/** Radix Tabs przełącza kartę na `mousedown` lewym przyciskiem. */
const przelaczZakladke = (etykieta: string) =>
  fireEvent.mouseDown(zakladka(etykieta), { button: 0, ctrlKey: false });

function wypelnijMinimum() {
  wpisz(`${E}key`, "vip_pass");
  wpisz(`${E}namePl`, "Karnet VIP");
  wpisz(`${E}nameEn`, "VIP pass");
}

function ostatni(): { input: EventTicketInput; look: TicketPresentation } {
  const call = onSubmit.mock.calls.at(-1);
  if (call === undefined) throw new Error("formularz nie wysłał niczego");
  return { input: call[0], look: call[1] };
}

async function dokoncz() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.lang = "pl";
  h.groups = [];
  h.clipboard = [];
  h.clipboardFails = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  onSubmit.mockClear();
  onDuplicate.mockClear();
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

describe("wygląd biletu jedzie drugim argumentem zapisu", () => {
  it("nowy bilet zaczyna od wyglądu domyślnego", () => {
    renderuj();
    wypelnijMinimum();

    zapisz();

    expect(ostatni().look).toEqual(DEFAULT_TICKET_PRESENTATION);
  });

  it("istniejący bilet zaczyna od SWOJEGO wyglądu", () => {
    const wyglad: TicketPresentation = {
      ...DEFAULT_TICKET_PRESENTATION,
      isHidden: true,
      priceLabelPl: "od 99 zł",
    };
    renderuj({ ticket: eventTicketRow(), presentation: wyglad });

    expect(wybor(`${S}hidden`)).toBeChecked();
    zapisz();

    expect(ostatni().look).toEqual(wyglad);
  });

  it("wybór „ukryty” i powrót do „widoczny” trafiają do wyglądu, nie do biletu", () => {
    renderuj();
    wypelnijMinimum();

    fireEvent.click(wybor(`${S}hidden`));
    zapisz();
    expect(ostatni().look.isHidden).toBe(true);
    expect(ostatni().input).not.toHaveProperty("isHidden");

    fireEvent.click(wybor(`${S}visible`));
    zapisz();
    expect(ostatni().look.isHidden).toBe(false);
  });

  it("zapis grupowy odsłania rozmiar grupy, a ten jest przycięty do granic", () => {
    renderuj();
    wypelnijMinimum();
    expect(screen.queryByLabelText(`${S}groupMaxSize`)).toBeNull();

    fireEvent.click(przelacznik(`${S}groupRegistration`));
    wpisz(`${S}groupMaxSize`, "500");
    zapisz();
    expect(ostatni().look).toMatchObject({ groupRegistrationEnabled: true, groupMaxSize: 50 });

    wpisz(`${S}groupMaxSize`, "1");
    zapisz();
    expect(ostatni().look.groupMaxSize).toBe(2);
  });

  it("sposób liczenia podatku przełącza się w obie strony", () => {
    renderuj();
    wypelnijMinimum();

    fireEvent.change(screen.getByRole("combobox", { name: `${S}taxMode` }), {
      target: { value: "exclusive" },
    });
    zapisz();
    expect(ostatni().look.taxMode).toBe("exclusive");

    fireEvent.change(screen.getByRole("combobox", { name: `${S}taxMode` }), {
      target: { value: "inclusive" },
    });
    zapisz();
    expect(ostatni().look.taxMode).toBe("inclusive");
  });
});

describe("typ biletu - bezpłatny i płatny", () => {
  it("nowy bilet jest bezpłatny", () => {
    renderuj();

    expect(wybor(`${S}free`)).toBeChecked();
    expect(wybor(`${S}paid`)).not.toBeChecked();
  });

  it("bilet z ceną w bazie otwiera się jako płatny", () => {
    renderuj({ ticket: eventTicketRow({ price_cents: 1999 }) });

    expect(wybor(`${S}paid`)).toBeChecked();
  });

  it("wpisanie kwoty > 0 samo przełącza na „płatny”, a zero z powrotem na „bezpłatny”", () => {
    renderuj();

    wpisz(`${E}priceCents`, "15000");
    expect(wybor(`${S}paid`)).toBeChecked();

    wpisz(`${E}priceCents`, "0");
    expect(wybor(`${S}free`)).toBeChecked();
  });

  it("„bezpłatny” zeruje cenę i cenę promocyjną w ładunku", () => {
    renderuj();
    wypelnijMinimum();
    wpisz(`${E}priceCents`, "15000");
    wpisz(`${E}earlyBirdPriceCents`, "9900");

    fireEvent.click(wybor(`${S}free`));
    zapisz();

    expect(ostatni().input).toMatchObject({ priceCents: 0, earlyBirdPriceCents: null });
    expect(ostatni().input.priceSchedule).toEqual([]);
  });

  it("„płatny” na bezpłatnym bilecie zmienia tylko typ i NIE rusza pól ceny", () => {
    renderuj();
    wypelnijMinimum();

    fireEvent.click(wybor(`${S}paid`));
    expect(wybor(`${S}paid`)).toBeChecked();
    wpisz(`${E}priceCents`, "15000");
    zapisz();

    expect(ostatni().input.priceCents).toBe(15000);
  });
});

describe("etykieta ceny w dwóch językach", () => {
  it("etykieta polska i angielska trafiają do wyglądu każda na swoje pole", () => {
    renderuj();
    wypelnijMinimum();

    wpisz(`${S}label (${S}tabPl)`, "od 99 zł");
    wpisz(`${S}label (${S}tabEn)`, "from 99 PLN");
    zapisz();

    expect(ostatni().look).toMatchObject({
      priceLabelPl: "od 99 zł",
      priceLabelEn: "from 99 PLN",
    });
  });

  it("wyłączona etykieta znika z formularza i z podglądu", () => {
    renderuj();
    wpisz(`${S}label (${S}tabPl)`, "od 99 zł");

    fireEvent.click(przelacznik(`${S}showLabel`));

    expect(screen.queryByLabelText(`${S}label (${S}tabPl)`)).toBeNull();
    expect(within(podglad()).queryByText("od 99 zł")).toBeNull();
    expect(within(podglad()).queryByText(`${S}free`)).toBeNull();
  });
});

describe("podgląd biletu", () => {
  it("bez etykiety bezpłatny bilet pokazuje „bezpłatny”", () => {
    renderuj();

    expect(within(podglad()).getByText(`${S}free`)).toBeTruthy();
  });

  it("bez etykiety płatny bilet pokazuje kwotę w walucie biletu", () => {
    renderuj();

    wpisz(`${E}priceCents`, "15000");

    expect(within(podglad()).getByText(/150,00/)).toBeTruthy();
    expect(within(podglad()).queryByText(`${S}free`)).toBeNull();
  });

  it("własna etykieta wygrywa z kwotą", () => {
    renderuj();
    wpisz(`${E}priceCents`, "15000");

    wpisz(`${S}label (${S}tabPl)`, "od 99 zł");

    expect(within(podglad()).getByText("od 99 zł")).toBeTruthy();
    expect(within(podglad()).queryByText(/150,00/)).toBeNull();
  });

  it("zakładka angielska przełącza podgląd na nazwę i etykietę angielską", () => {
    renderuj();
    wypelnijMinimum();
    wpisz(`${S}label (${S}tabEn)`, "from 99 PLN");

    przelaczZakladke(`${S}tabEn`);

    expect(within(podglad()).getByText("VIP pass")).toBeTruthy();
    expect(within(podglad()).getByText("from 99 PLN")).toBeTruthy();
    expect(within(podglad()).queryByText("Karnet VIP")).toBeNull();
  });

  it("powrót na zakładkę polską wraca do polskiej nazwy", () => {
    renderuj();
    wypelnijMinimum();
    przelaczZakladke(`${S}tabEn`);

    przelaczZakladke(`${S}tabPl`);

    expect(within(podglad()).getByText("Karnet VIP")).toBeTruthy();
  });
});

describe("błąd w drugim języku przełącza zakładkę", () => {
  it("brak nazwy angielskiej przy polskiej karcie przełącza na angielską", () => {
    renderuj();
    wpisz(`${E}key`, "vip_pass");
    wpisz(`${E}namePl`, "Karnet VIP");

    zapisz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(zakladka(`${S}tabEn`)).toHaveAttribute("data-state", "active");
  });

  it("brak nazwy polskiej przy angielskiej karcie przełącza na polską", () => {
    renderuj();
    wpisz(`${E}key`, "vip_pass");
    wpisz(`${E}nameEn`, "VIP pass");
    przelaczZakladke(`${S}tabEn`);

    zapisz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(zakladka(`${S}tabPl`)).toHaveAttribute("data-state", "active");
  });

  it("błąd poza polami językowymi NIE przełącza karty", () => {
    renderuj();
    wypelnijMinimum();
    przelaczZakladke(`${S}tabEn`);
    wpisz(`${E}priceCents`, "abc");

    zapisz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(zakladka(`${S}tabEn`)).toHaveAttribute("data-state", "active");
  });
});

describe("grupa uczestników biletu", () => {
  beforeEach(() => {
    h.groups = [
      grupa({ id: "grupa-1", name_pl: "Partnerzy", name_en: "Partners" }),
      grupa({ id: "grupa-2", key: "bez_nazwy", name_pl: "", name_en: "" }),
    ];
  });

  const lista = () => screen.getByRole("combobox", { name: `${S}columns.group` });

  it("lista grup mówi po polsku w polskim interfejsie, a grupa bez nazwy pokazuje klucz", () => {
    renderuj();

    const opcje = within(lista())
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual([`${S}groupPlaceholder`, "Partnerzy", "bez_nazwy"]);
  });

  it("lista grup w trakcie wczytywania ma tylko pozycję „bez grupy”", () => {
    h.groups = undefined;
    renderuj();

    expect(within(lista()).getAllByRole("option")).toHaveLength(1);
  });

  it("lista grup mówi po angielsku w angielskim interfejsie", () => {
    h.lang = "en";
    renderuj();

    expect(within(lista()).getByRole("option", { name: "Partners" })).toBeTruthy();
  });

  it("wybór grupy i powrót do „bez grupy” jadą do ładunku", () => {
    renderuj();
    wypelnijMinimum();

    fireEvent.change(lista(), { target: { value: "grupa-1" } });
    zapisz();
    expect(ostatni().input.groupId).toBe("grupa-1");

    fireEvent.change(lista(), { target: { value: "__none" } });
    zapisz();
    expect(ostatni().input.groupId).toBeNull();
  });
});

describe("adres rejestracji, identyfikator i kopia", () => {
  const bilet = () => eventTicketRow({ id: SALES_IDS.ticket, key: "vip_pass" });

  it("nowy bilet NIE ma adresu rejestracji - klucz nie jest jeszcze zapisany", () => {
    renderuj({ eventSlug: "forum" });

    expect(screen.queryByText(`${S}registrationUrl`)).toBeNull();
  });

  it("wydarzenie bez adresu NIE pokazuje adresu rejestracji", () => {
    renderuj({ ticket: bilet(), eventSlug: "" });

    expect(screen.queryByText(`${S}registrationUrl`)).toBeNull();
  });

  it("zapisany bilet pokazuje adres z kluczem i swój identyfikator", () => {
    renderuj({ ticket: bilet(), eventSlug: "forum" });

    expect(
      screen.getByText("https://nes.example/events/forum/register?ticket=vip_pass"),
    ).toBeTruthy();
    expect(screen.getByText(SALES_IDS.ticket)).toBeTruthy();
  });

  it("„kopiuj” przy adresie wkleja adres i mówi, że się udało", async () => {
    renderuj({ ticket: bilet(), eventSlug: "forum" });

    fireEvent.click(screen.getAllByRole("button", { name: `${S}copy` })[0]);
    await dokoncz();

    expect(h.clipboard).toEqual(["https://nes.example/events/forum/register?ticket=vip_pass"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${S}copied`);
  });

  it("„kopiuj” przy identyfikatorze wkleja identyfikator", async () => {
    renderuj({ ticket: bilet(), eventSlug: "forum" });

    fireEvent.click(screen.getAllByRole("button", { name: `${S}copy` })[1]);
    await dokoncz();

    expect(h.clipboard).toEqual([SALES_IDS.ticket]);
  });

  it("odmowa schowka mówi to wprost i NIE udaje sukcesu", async () => {
    h.clipboardFails = true;
    renderuj({ ticket: bilet(), eventSlug: "forum" });

    fireEvent.click(screen.getAllByRole("button", { name: `${S}copy` })[0]);
    await dokoncz();

    expect(h.toastError).toHaveBeenCalledWith(`${S}copyFailed`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("„duplikuj” istnieje tylko, gdy rodzic go poda, i woła rodzica", () => {
    const { unmount } = renderuj({ ticket: bilet(), eventSlug: "forum" });
    expect(screen.queryByRole("button", { name: `${S}duplicate` })).toBeNull();
    unmount();

    renderuj({ ticket: bilet(), eventSlug: "forum", withDuplicate: true });
    fireEvent.click(screen.getByRole("button", { name: `${S}duplicate` }));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });
});
