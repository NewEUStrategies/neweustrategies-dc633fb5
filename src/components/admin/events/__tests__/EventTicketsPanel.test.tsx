// Organizm „Bilety wydarzenia" - SKLEJENIE listy, przełącznika i dwóch operacji.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI: wczytywanie, awaria, pustka,
//      wiersze. Awaria pokazująca komunikat pustki to udokumentowana klasa
//      błędu tego modułu - „nie ma żadnego biletu" po nieudanym zapytaniu każe
//      organizatorowi założyć DRUGI bilet o tym samym kluczu, a klucz jest
//      unikalny w obrębie wydarzenia. Dlatego awaria ma tu WŁASNY przypadek
//      z kontrapunktem: napis o pustce nie ma prawa się pojawić.
//   2. WIERSZ MÓWI TO, CZEGO NIE WIDAĆ PO SAMEJ CENIE. Pula bez liczby
//      sprzedanych nie mówi nic o tym, czy da się ją bezpiecznie obniżyć (RPC
//      odmawia zejścia poniżej sprzedanych), a cena obowiązująca DZIŚ jest
//      osobną liczbą liczoną w bazie. Każdy z tych napisów ma swój przypadek
//      i swój kontrapunkt „gdy nie ma czego pokazać, nie ma napisu".
//   3. PRZEŁĄCZNIK „AKTYWNY" WYSYŁA CAŁY WIERSZ, bo RPC zapisu jest UPSERT-em -
//      to jest miejsce, w którym cena, pula i klucz dają się zgubić po cichu.
//   4. KASOWANIE JEST ZA POTWIERDZENIEM. Dowodzimy obu stron: bez potwierdzenia
//      mutacja NIE wychodzi, po potwierdzeniu wychodzi z właściwym
//      identyfikatorem, a odmowa (`ticket_in_use`) kończy się zdaniem.
//   5. NOWY BILET DOSTAJE MIEJSCE NA KOŃCU LISTY, policzone z wierszy - dwa
//      bilety o tej samej kolejności ustawiają się losowo przy każdym odczycie.
//   6. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA - inaczej organizator traci
//      czternaście wypełnionych pól.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) FORMULARZA biletu - ma własny, obszerny plik
// `EventTicketDialog.test.tsx`; tutaj jest atrapą, bo przedmiotem dowodu jest
// to, z czym panel go OTWIERA i co robi z wynikiem. (2) REGUŁ szkicu
// (`ticketDraftFromRow`, `ticketDraftToInput`) - tabele przypadków są
// w `lib/events/__tests__/ticketDraft.test.ts`; tutaj zostają PRAWDZIWE, bo
// dowodzimy, że przełącznik przepuszcza przez nie CAŁY wiersz. (3) SŁOWNIKA
// ODMÓW - ma `eventErrorMaps.test.ts`; tu jest atrapą.
//
// ATRAPA PRZYCISKU - RZECZ DO ZROZUMIENIA PRZED CZYTANIEM ASERCJI. Prawdziwy
// `Button` oddaje `disabled` natywnemu przyciskowi, a React nie woła wtedy
// handlera. Atrapa trzyma stan zgaszenia w `aria-disabled` i handler PUSZCZA
// (wzór z `ClubMembersTab.test.tsx`), więc asercje „przycisk zgaszony" patrzą
// na `aria-disabled`, a nie na `disabled`.
//
// Radix AlertDialog i Switch nie działają pod happy-dom bez pełnego pointer API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";

type Wynik = { onSuccess?: () => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  saveCalls: [] as unknown[],
  saveError: null as unknown,
  savePending: false,
  removeCalls: [] as string[],
  removeError: null as unknown,
  removePending: false,
  eventIds: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Słownik odmów bazy ma własny plik testowy; tutaj liczy się wyłącznie to, że
// odmowa DOCHODZI do organizatora zdaniem, a nie kodem `23514`.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "",
  Button: ({
    children,
    disabled,
    onClick,
    type,
    ...reszta
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    type?: "button" | "submit" | "reset";
    variant?: string;
    size?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <button
      type={type ?? "button"}
      aria-label={reszta["aria-label"]}
      aria-disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...reszta
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={reszta["aria-label"]}
      checked={checked === true}
      onChange={() => onCheckedChange?.(checked !== true)}
    />
  ),
}));

// Okno potwierdzenia: treść istnieje TYLKO przy otwartym oknie (portal nie jest
// montowany), a „Anuluj" zamyka je tą samą drogą co Radix - przez `onOpenChange`.
// Bez tego „bez potwierdzenia nic nie leci" byłoby dowodem na atrapę.
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
      stan.open ? <div role="alertdialog">{children}</div> : null,
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
      disabled,
    }: {
      children?: ReactNode;
      onClick?: MouseEventHandler<HTMLButtonElement>;
      disabled?: boolean;
    }) => (
      <button type="button" aria-disabled={disabled === true} onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularz biletu ma WŁASNY plik testowy (czternaście pól, grosze, trzy stany
// kodu dostępu). Tutaj interesuje nas wyłącznie STYK: z czym panel go otwiera
// i co robi z ładunkiem, więc atrapa wystawia te wartości wprost.
vi.mock("@/components/admin/events/molecules/EventTicketDialog", () => ({
  EventTicketDialog: ({
    open,
    onOpenChange,
    eventId,
    ticket,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    ticket: EventTicketRow | null;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: EventTicketInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-biletu"
        data-bilet={ticket === null ? "nowy" : ticket.id}
        data-kolejnosc={String(nextSortOrder)}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() => onSubmit({ ...LADUNEK, eventId, id: ticket === null ? null : ticket.id })}
        />
        <button
          type="button"
          data-testid="formularz-zamknij"
          onClick={() => onOpenChange(false)}
        />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useEventTickets: (eventId: string) => {
    h.eventIds.push(eventId);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useSaveEventTicket: () => ({
    mutate: (input: EventTicketInput, wynik: Wynik) => {
      h.saveCalls.push(input);
      if (h.saveError === null) wynik.onSuccess?.();
      else wynik.onError?.(h.saveError);
    },
    isPending: h.savePending,
  }),
  useDeleteEventTicket: () => ({
    mutate: (id: string, wynik: Wynik) => {
      h.removeCalls.push(id);
      if (h.removeError === null) wynik.onSuccess?.();
      else wynik.onError?.(h.removeError);
    },
    isPending: h.removePending,
  }),
}));

import { EventTicketsPanel } from "@/components/admin/events/organisms/EventTicketsPanel";
import { SALES_IDS, eventTicketRow } from "@/test/events/adminSalesRows";

/** Minimalny ładunek formularza - liczy się TRASA, nie zawartość (ma swój plik). */
const LADUNEK: EventTicketInput = {
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

const T = "adminEventRegistration.tickets";

function panel() {
  return render(<EventTicketsPanel eventId={SALES_IDS.event} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na ekranie`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

/** Kosz W WIERSZU - ten sam napis nosi tytuł okna i przycisk potwierdzenia. */
const kosz = (index = 0): HTMLElement =>
  within(wiersz(index)).getByRole("button", { name: `${T}.editor.deleteAction` });

const okno = (): HTMLElement => screen.getByRole("alertdialog");

const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-biletu" });

beforeEach(() => {
  h.lang = "pl";
  h.rows = [eventTicketRow()];
  h.isLoading = false;
  h.listError = null;
  h.saveCalls = [];
  h.saveError = null;
  h.savePending = false;
  h.removeCalls = [];
  h.removeError = null;
  h.removePending = false;
  h.eventIds = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy biletów", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego wiersza", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
  });

  // TO JEST UDOKUMENTOWANA KLASA BŁĘDU TEGO MODUŁU. „Nie ma żadnego biletu" po
  // nieudanym zapytaniu każe założyć bilet, który już istnieje - a klucz biletu
  // jest unikalny w obrębie wydarzenia, więc zapis kończy się odmową, której
  // organizator nie umie połączyć z przyczyną.
  it("AWARIA pokazuje odmowę i NIE pokazuje komunikatu pustki", () => {
    h.listError = new Error("tickets: odmowa RPC");
    h.rows = undefined;
    panel();

    expect(screen.getByText("odmowa:tickets: odmowa RPC")).toBeTruthy();
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
    expect(wiersze()).toHaveLength(0);
  });

  it("pustka po udanym wczytaniu mówi to wprost", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.empty`)).toBeTruthy();
    expect(screen.queryByText(`${T}.loading`)).toBeNull();
  });

  it("dane rysują wiersz z nazwą i kluczem biletu", () => {
    h.rows = [eventTicketRow({ name_pl: "Karnet VIP", key: "vip_pass" })];
    panel();

    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("Karnet VIP")).toBeTruthy();
    expect(within(wiersz()).getByText("vip_pass")).toBeTruthy();
  });

  it("zapytanie idzie po identyfikator TEGO wydarzenia", () => {
    panel();

    expect(h.eventIds[0]).toBe(SALES_IDS.event);
  });

  it("po angielsku wiersz bierze nazwę angielską", () => {
    h.lang = "en";
    h.rows = [eventTicketRow({ name_pl: "Karnet VIP", name_en: "VIP pass" })];
    panel();

    expect(within(wiersz()).getByText("VIP pass")).toBeTruthy();
    expect(within(wiersz()).queryByText("Karnet VIP")).toBeNull();
  });
});

describe("co niesie wiersz biletu", () => {
  // BILET DARMOWY TO NIE „0,00 zł". Kwota zero w kolumnie ceny czyta się jak
  // pomyłka w konfiguracji, a „bezpłatny" jest decyzją organizatora.
  it("bilet bezpłatny mówi „bezpłatny”, a płatny pokazuje kwotę", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket, price_cents: 0, effective_price_cents: 0 }),
      eventTicketRow({ id: SALES_IDS.otherTicket, price_cents: 1999, effective_price_cents: 1999 }),
    ];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.free`)).toBeTruthy();
    // Grosze na złote - pomyłka o jedno zero widać w asercji od razu.
    expect(within(wiersz(1)).getByText(/19,99/)).toBeTruthy();
  });

  // CENA OBOWIĄZUJĄCA DZIŚ LICZY SIĘ W BAZIE, nie w przeglądarce - zegar
  // przeglądarki bywa przestawiony, a to on decydowałby o promocji.
  it("cena obowiązująca DZIŚ pokazuje się tylko wtedy, gdy różni się od podstawowej", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket, price_cents: 1999, effective_price_cents: 999 }),
      eventTicketRow({ id: SALES_IDS.otherTicket, price_cents: 1999, effective_price_cents: 1999 }),
    ];
    panel();

    expect(within(wiersz(0)).getByText(/tickets\.effectivePrice\(price=/)).toBeTruthy();
    expect(within(wiersz(1)).queryByText(/tickets\.effectivePrice/)).toBeNull();
  });

  it("bilet bez policzonej ceny obowiązującej nie pokazuje drugiej kwoty", () => {
    h.rows = [
      eventTicketRow({ effective_price_cents: undefined as unknown as number, price_cents: 1999 }),
    ];
    panel();

    expect(within(wiersz()).queryByText(/tickets\.effectivePrice/)).toBeNull();
  });

  // PULA BEZ LICZBY SPRZEDANYCH nie mówi nic o tym, czy da się ją bezpiecznie
  // obniżyć - a RPC odmawia zejścia poniżej sprzedanych.
  it("pula stoi obok liczby sprzedanych, a brak puli znaczy „bez limitu”", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket, quota: 50, sold_count: 12 }),
      eventTicketRow({ id: SALES_IDS.otherTicket, quota: null, sold_count: 0 }),
    ];
    panel();

    expect(within(wiersz(0)).getByText("50")).toBeTruthy();
    expect(within(wiersz(0)).getByText(/columns\.sold/)).toBeTruthy();
    expect(within(wiersz(0)).getByText(/12/)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.unlimitedQuota`)).toBeTruthy();
  });

  // ZERO SPRZEDANYCH TO NIE BRAK ODPOWIEDZI. Wiersz bez liczby wygląda jak
  // uszkodzony, a „0" mówi wprost, że pulę można jeszcze zmniejszyć do zera.
  it("bilet bez policzonej sprzedaży pokazuje zero, a nie pustkę", () => {
    h.rows = [
      eventTicketRow({
        quota: undefined as unknown as number,
        sold_count: undefined as unknown as number,
      }),
    ];
    panel();

    expect(within(wiersz()).getByText(`${T}.unlimitedQuota`)).toBeTruthy();
    expect(within(wiersz()).getByText(/columns\.sold.*0/)).toBeTruthy();
  });

  // OKNO SPRZEDAŻY MA CZTERY STANY i cztery różne napisy. „Od-do" wpisane tam,
  // gdzie termin jest tylko jeden, obiecuje granicę, której nie ma.
  it.each([
    ["bez okna", { sales_from: "", sales_to: "" }, [`${T}.noWindow`], [`${T}.windowFrom`]],
    [
      "od terminu",
      { sales_from: "2026-08-01T10:00:00.000Z", sales_to: "" },
      [`${T}.windowFrom`],
      [`${T}.windowTo`, `${T}.noWindow`],
    ],
    [
      "do terminu",
      { sales_from: "", sales_to: "2026-09-01T10:00:00.000Z" },
      [`${T}.windowTo`],
      [`${T}.windowFrom`, `${T}.noWindow`],
    ],
    [
      "od i do",
      { sales_from: "2026-08-01T10:00:00.000Z", sales_to: "2026-09-01T10:00:00.000Z" },
      [`${T}.windowFrom`, `${T}.windowTo`],
      [`${T}.noWindow`],
    ],
  ])("okno sprzedaży „%s” ma własny napis", (_nazwa, kolumny, obecne, nieobecne) => {
    h.rows = [eventTicketRow(kolumny as Partial<EventTicketRow>)];
    panel();

    for (const fragment of obecne) {
      expect(within(wiersz()).getByText(new RegExp(fragment.replace(/\./g, "\\.")))).toBeTruthy();
    }
    for (const fragment of nieobecne) {
      expect(within(wiersz()).queryByText(new RegExp(fragment.replace(/\./g, "\\.")))).toBeNull();
    }
  });

  // CZTERY PLAKIETKI, CZTERY RÓŻNE REGUŁY SPRZEDAŻY. Każda z nich zmienia to,
  // co zobaczy uczestnik, więc żadna nie ma prawa pojawić się „na wszelki wypadek".
  it("plakietki progu, kodu, braku kolejki i zatwierdzania stoją TYLKO gdy dotyczą", () => {
    h.rows = [
      eventTicketRow({
        id: SALES_IDS.ticket,
        early_bird_until: "2026-08-20T10:00:00.000Z",
        has_access_code: true,
        waitlist_enabled: false,
        requires_approval: true,
      }),
      eventTicketRow({
        id: SALES_IDS.otherTicket,
        early_bird_until: null as unknown as string,
        has_access_code: false,
        waitlist_enabled: true,
        requires_approval: false,
      }),
    ];
    panel();

    const pierwszy = within(wiersz(0));
    expect(pierwszy.getByText(/tickets\.earlyBirdBadge\(date=/)).toBeTruthy();
    expect(pierwszy.getByText(`${T}.accessCodeBadge`)).toBeTruthy();
    expect(pierwszy.getByText(`${T}.noWaitlistBadge`)).toBeTruthy();
    expect(pierwszy.getByText(`${T}.columns.approval`)).toBeTruthy();

    const drugi = within(wiersz(1));
    expect(drugi.queryByText(/tickets\.earlyBirdBadge/)).toBeNull();
    expect(drugi.queryByText(`${T}.accessCodeBadge`)).toBeNull();
    expect(drugi.queryByText(`${T}.noWaitlistBadge`)).toBeNull();
    expect(drugi.queryByText(`${T}.columns.approval`)).toBeNull();
  });

  // KOLUMNY, KTÓRYCH RPC NIE ODDAŁO, to NIE „false". Plakietka „bez kolejki"
  // przy bilecie, o którym nic nie wiadomo, kłamie o regule sprzedaży.
  it("kolumny nieoddane przez RPC nie zapalają plakietek", () => {
    h.rows = [
      eventTicketRow({
        early_bird_until: undefined as unknown as string,
        has_access_code: undefined as unknown as boolean,
        waitlist_enabled: undefined as unknown as boolean,
      }),
    ];
    panel();

    expect(within(wiersz()).queryByText(/tickets\.earlyBirdBadge/)).toBeNull();
    expect(within(wiersz()).queryByText(`${T}.accessCodeBadge`)).toBeNull();
    expect(within(wiersz()).queryByText(`${T}.noWaitlistBadge`)).toBeNull();
  });
});

describe("przełącznik „aktywny” w wierszu", () => {
  // RPC ZAPISU JEST UPSERT-EM, więc przełącznik wysyła CAŁY wiersz. To jest to
  // miejsce, w którym cena, pula i klucz dają się zgubić po cichu - i dlatego
  // asercja patrzy na cały ładunek, a nie na samą flagę.
  it("wyłączenie biletu wysyła CAŁY wiersz razem ze zmienioną flagą", () => {
    h.rows = [
      eventTicketRow({
        id: SALES_IDS.ticket,
        key: "vip_pass",
        name_pl: "Karnet VIP",
        price_cents: 1999,
        quota: 50,
        is_active: true,
      }),
    ];
    panel();

    fireEvent.click(within(wiersz()).getByRole("switch", { name: `${T}.editor.active` }));

    expect(h.saveCalls).toHaveLength(1);
    const ladunek = h.saveCalls[0] as EventTicketInput;
    expect(ladunek.isActive).toBe(false);
    expect(ladunek.id).toBe(SALES_IDS.ticket);
    expect(ladunek.eventId).toBe(SALES_IDS.event);
    expect(ladunek.key).toBe("vip_pass");
    expect(ladunek.namePl).toBe("Karnet VIP");
    expect(ladunek.priceCents).toBe(1999);
    expect(ladunek.quota).toBe(50);
  });

  it("włączenie wyłączonego biletu jedzie w drugą stronę", () => {
    h.rows = [eventTicketRow({ is_active: false })];
    panel();

    fireEvent.click(within(wiersz()).getByRole("switch", { name: `${T}.editor.active` }));

    expect((h.saveCalls[0] as EventTicketInput).isActive).toBe(true);
  });

  // ODMOWA MUSI BYĆ SŁYSZALNA. Przełącznik wraca do stanu z bazy przy następnym
  // odczycie, więc bez komunikatu wygląda to jak przypadkowe drgnięcie ekranu.
  it("odmowa zapisu przełącznika mówi to wprost i NIE udaje sukcesu", () => {
    h.saveError = new Error("tickets: quota_below_sold: 12");
    panel();

    fireEvent.click(within(wiersz()).getByRole("switch", { name: `${T}.editor.active` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tickets: quota_below_sold: 12");
    // Przełącznik NIE jest zapisem formularza - udany toast zapisu byłby tu
    // komunikatem o operacji, której organizator nie wykonywał.
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("udany zapis przełącznika NIE pokazuje toastu zapisu formularza", () => {
    panel();

    fireEvent.click(within(wiersz()).getByRole("switch", { name: `${T}.editor.active` }));

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("formularz biletu", () => {
  it("formularz jest zamknięty, dopóki nikt go nie otworzy", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "formularz-biletu" })).toBeNull();
  });

  // NOWY BILET LĄDUJE NA KOŃCU LISTY. Dwa bilety o tej samej kolejności
  // ustawiają się losowo przy każdym odczycie - a to jest kolejność, którą
  // uczestnik widzi w kasie.
  it("„dodaj” otwiera PUSTY formularz z miejscem na końcu listy", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket, sort_order: 10 }),
      eventTicketRow({ id: SALES_IDS.otherTicket, sort_order: 40 }),
    ];
    panel();

    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularz().getAttribute("data-bilet")).toBe("nowy");
    expect(formularz().getAttribute("data-kolejnosc")).toBe("50");
  });

  it("pierwszy bilet wydarzenia dostaje kolejność 10", () => {
    h.rows = [];
    panel();

    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularz().getAttribute("data-kolejnosc")).toBe("10");
  });

  it("bilet BEZ kolejności nie psuje wyliczenia miejsca dla następnego", () => {
    h.rows = [eventTicketRow({ sort_order: undefined as unknown as number })];
    panel();

    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularz().getAttribute("data-kolejnosc")).toBe("10");
  });

  it("ołówek w wierszu otwiera formularz TEGO biletu", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket }),
      eventTicketRow({ id: SALES_IDS.otherTicket }),
    ];
    panel();

    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.editor.editTitle` }));

    expect(formularz().getAttribute("data-bilet")).toBe(SALES_IDS.otherTicket);
  });

  // PO EDYCJI „DODAJ" MUSI ZNOWU ZNACZYĆ „DODAJ". Formularz otwarty z poprzednim
  // biletem nadpisałby go zamiast założyć nowy.
  it("po edycji „dodaj” otwiera znowu PUSTY formularz", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.editor.editTitle` }));
    fireEvent.click(screen.getByTestId("formularz-zamknij"));

    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularz().getAttribute("data-bilet")).toBe("nowy");
  });

  it("udany zapis nazywa skutek i ZAMYKA formularz", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.editor.editTitle` }));

    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.saveCalls).toHaveLength(1);
    expect((h.saveCalls[0] as EventTicketInput).id).toBe(SALES_IDS.ticket);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-biletu" })).toBeNull();
  });

  // ODMOWA NIE ZAMYKA FORMULARZA - inaczej organizator traci czternaście
  // wypełnionych pól i musi zacząć od nowa, nie wiedząc, co poszło źle.
  it("odmowa zapisu ZOSTAWIA formularz otwarty i mówi, co się stało", () => {
    h.saveError = new Error("tickets: duplicate_key");
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tickets: duplicate_key");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(formularz()).toBeTruthy();
  });

  it("trwający zapis dojeżdża do formularza, żeby ten zablokował przycisk", () => {
    h.savePending = true;
    panel();
    fireEvent.click(przycisk(`${T}.addAction`));

    expect(formularz().getAttribute("data-zapis")).toBe("true");
  });
});

describe("kasowanie biletu", () => {
  it("kosz NIE kasuje od razu - najpierw pyta i mówi, kiedy to zadziała", () => {
    panel();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(kosz());

    expect(within(okno()).getByText(`${T}.editor.deleteConfirm`)).toBeTruthy();
    expect(h.removeCalls).toEqual([]);
  });

  it("rezygnacja zamyka okno i NIE kasuje niczego", () => {
    panel();
    fireEvent.click(kosz());

    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.editor.cancelAction` }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.removeCalls).toEqual([]);
  });

  it("potwierdzenie kasuje TEN bilet, nazywa skutek i zamyka okno", () => {
    h.rows = [
      eventTicketRow({ id: SALES_IDS.ticket }),
      eventTicketRow({ id: SALES_IDS.otherTicket }),
    ];
    panel();
    fireEvent.click(kosz(1));

    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.editor.deleteAction` }));

    expect(h.removeCalls).toEqual([SALES_IDS.otherTicket]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.toasts.deleted`);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // `ticket_in_use` TO NAJCZĘSTSZA ODMOWA TEGO EKRANU: baza nie pozwala skasować
  // biletu, którego używa choćby jedno zgłoszenie. Okno zamyka się mimo odmowy -
  // ponowne kliknięcie kosza i tak skończyłoby się tym samym błędem, a otwarte
  // okno nad komunikatem wygląda, jakby operacja jeszcze trwała.
  it("odmowa kasowania mówi to wprost i też zamyka okno", () => {
    h.removeError = new Error("tickets: ticket_in_use");
    panel();
    fireEvent.click(kosz());

    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.editor.deleteAction` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tickets: ticket_in_use");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Wiersz ZOSTAJE - lista bez skasowanego biletu byłaby nieprawdą o bazie.
    expect(wiersze()).toHaveLength(1);
  });

  it("trwające kasowanie GASI przycisk potwierdzenia", () => {
    h.removePending = true;
    panel();
    fireEvent.click(kosz());

    expect(
      within(okno()).getByRole("button", { name: `${T}.editor.deleteAction` }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
