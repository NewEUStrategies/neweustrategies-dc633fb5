// Organizm „Kody rejestracyjne wydarzenia" - lista kodów i okno ich edycji.
//
// CO TEN PLIK DOWODZI.
//   1. WIERSZ MÓWI, CO KOD ROBI. Rabat procentowy, kwotowy, odsłonięcie ukrytych
//      biletów i zakres biletów to cztery różne efekty dla uczestnika - każdy ma
//      własny fragment opisu, a kod bez rabatu nie może obiecywać rabatu.
//   2. STATUS WYNIKA Z DAT I LIMITU, NIE Z SAMEGO PRZEŁĄCZNIKA. Kod aktywny, ale
//      po terminie, jest „wygasły"; zużyty do limitu jest „wykorzystany".
//      Statusy liczą się z zegara, więc plik zamraża „teraz".
//   3. WYSZUKIWANIE ŁAPIE KOD I NAZWĘ bez względu na wielkość liter - organizator
//      wpisuje „vip", a kod jest zapisany jako „VIP10".
//   4. OPERACJE W WIERSZU trafiają z WŁAŚCIWYM identyfikatorem: przełącznik
//      wysyła stan przeciwny do bieżącego, kosz - identyfikator wiersza,
//      kopiowanie - adres rejestracji z kodem.
//   5. OKNO NIE ZAPISUJE BŁĘDNEGO KODU. Walidacja szkicu zatrzymuje zapis
//      i mówi zdaniem, co jest nie tak; odmowa bazy nie zamyka okna, bo
//      organizator straciłby wypełnione pola.
//   6. FORMULARZ POKAZUJE TYLKO TO, CO MA SENS. Waluta tylko przy rabacie
//      kwotowym, pola rabatu tylko przy włączonym rabacie, lista biletów tylko
//      przy zakresie „wybrane".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł szkicu (`eventCodeDraftIssue`,
// `eventCodeDraftToPayload`, `eventCodeStatus`) - mają tabele przypadków
// w `lib/events/__tests__/eventCodesApi.test.ts`. Tutaj zostają PRAWDZIWE, bo
// przedmiotem dowodu jest to, że panel przez nie przechodzi. Zapytań do bazy -
// hooki są atrapą, liczy się to, z czym panel je woła.
//
// Radix Switch nie działa pod happy-dom bez pełnego pointer API - atrapa jak
// w `EventTicketsPanel.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { EventCodeDraft, EventCodeRow } from "@/lib/events/eventCodesApi";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

type Wynik = { onSuccess?: () => void; onError?: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  rows: [] as EventCodeRow[] | undefined,
  tickets: [] as { id: string; name_pl: string; name_en: string; currency: string }[],
  saveCalls: [] as { id: string | null; draft: EventCodeDraft }[],
  saveError: null as Error | null,
  savePending: false,
  toggleCalls: [] as { id: string; active: boolean }[],
  deleteCalls: [] as string[],
  deleteError: null as Error | null,
  clipboardFails: false,
  clipboard: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/http/host", () => ({ browserPublicOrigin: () => "https://nes.example" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: h.tickets }) }));
vi.mock("@/lib/events/registrationsApi", () => ({ fetchEventTickets: vi.fn() }));

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

vi.mock("@/lib/events/eventCodesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/eventCodesApi")>();
  return {
    ...actual,
    useEventCodes: () => ({ data: h.rows }),
    useSaveEventCode: () => ({
      mutate: (args: { id: string | null; draft: EventCodeDraft }, wynik: Wynik) => {
        h.saveCalls.push(args);
        if (h.saveError === null) wynik.onSuccess?.();
        else wynik.onError?.(h.saveError);
      },
      isPending: h.savePending,
    }),
    useToggleEventCode: () => ({
      mutate: (args: { id: string; active: boolean }) => {
        h.toggleCalls.push(args);
      },
    }),
    useDeleteEventCode: () => ({
      mutate: (id: string, wynik: Wynik) => {
        h.deleteCalls.push(id);
        if (h.deleteError === null) wynik.onSuccess?.();
        else wynik.onError?.(h.deleteError);
      },
    }),
  };
});

import { EventCodesPanel } from "@/components/admin/events/organisms/EventCodesPanel";

// Status kodu liczy się względem PRAWDZIWEGO zegara (`eventCodeStatus(r)` bez
// podanego „teraz"), więc daty ważności są liczone od zamrożonego `FIXED_NOW`.
freezeClock();

const C = "eventCodes";

function kod(patch: Partial<EventCodeRow> = {}): EventCodeRow {
  return {
    id: "c1",
    code: "VIP10",
    name: "Goście VIP",
    description: null,
    active: true,
    appliesDiscount: true,
    revealsHidden: false,
    discountKind: "percent",
    discountPercent: 10,
    discountCents: null,
    currency: null,
    maxRedemptions: 5,
    redemptionsCount: 1,
    validFrom: null,
    validUntil: null,
    ticketTypeIds: [],
    ...patch,
  };
}

function panel() {
  return render(<EventCodesPanel eventId="ev1" eventSlug="forum" />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("row").slice(1);

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na ekranie`);
  return found;
};

const okno = (): HTMLElement => screen.getByRole("dialog");

function wpisz(etykieta: string, wartosc: string): void {
  fireEvent.change(within(okno()).getByLabelText(etykieta), { target: { value: wartosc } });
}

function kliknij(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

beforeEach(() => {
  h.lang = "pl";
  h.rows = [kod()];
  h.tickets = [
    { id: "t1", name_pl: "Standard", name_en: "Standard pass", currency: "EUR" },
    { id: "t2", name_pl: "", name_en: "Student", currency: "EUR" },
  ];
  h.saveCalls = [];
  h.saveError = null;
  h.savePending = false;
  h.toggleCalls = [];
  h.deleteCalls = [];
  h.deleteError = null;
  h.clipboardFails = false;
  h.clipboard = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (h.clipboardFails) throw new Error("brak uprawnien");
        h.clipboard.push(text);
      },
    },
  });
});

describe("lista kodów", () => {
  it("pusta lista mówi, że kodów nie ma, i nie rysuje tabeli", () => {
    h.rows = [];
    panel();
    expect(screen.getByText(`${C}.empty`)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("brak danych (zapytanie w locie) to też pusta lista, a nie awaria", () => {
    h.rows = undefined;
    panel();
    expect(screen.getByText(`${C}.empty`)).toBeTruthy();
  });

  it("wiersz pokazuje kod, nazwę, zużycie i brak terminów", () => {
    panel();
    const w = within(wiersz());
    expect(w.getByText("VIP10")).toBeTruthy();
    expect(w.getByText("Goście VIP")).toBeTruthy();
    expect(w.getByText("1/5")).toBeTruthy();
    expect(w.getAllByText("-")).toHaveLength(2);
  });

  it("kod bez nazwy nie rysuje pustej linijki pod kodem", () => {
    h.rows = [kod({ name: null })];
    panel();
    const komorka = within(wiersz()).getByText("VIP10").parentElement;
    expect(komorka?.querySelectorAll("span")).toHaveLength(1);
  });

  it("kod bez limitu użyć pokazuje nieskończoność zamiast liczby", () => {
    h.rows = [kod({ maxRedemptions: null, redemptionsCount: 7 })];
    panel();
    expect(within(wiersz()).getByText("7/∞")).toBeTruthy();
  });

  it("terminy ważności są formatowane w języku panelu", () => {
    h.rows = [kod({ validFrom: relativeIso(-2 * DZIEN), validUntil: relativeIso(5 * DZIEN) })];
    panel();
    // FIXED_NOW to 15.06.2099, południe UTC.
    expect(within(wiersz()).getByText(/13 cze 2099/)).toBeTruthy();
    expect(within(wiersz()).getByText(/20 cze 2099/)).toBeTruthy();
  });

  it("po angielsku terminy są w formacie brytyjskim", () => {
    h.lang = "en";
    h.rows = [kod({ validFrom: relativeIso(-2 * DZIEN) })];
    panel();
    expect(within(wiersz()).getByText(/13 Jun 2099/)).toBeTruthy();
  });
});

describe("opis efektu kodu", () => {
  it.each<[string, Partial<EventCodeRow>, string]>([
    ["rabat procentowy na wszystkie bilety", {}, `-10% · ${C}.effect.all`],
    [
      "rabat kwotowy z walutą",
      { discountKind: "fixed", discountCents: 1999, currency: "PLN", discountPercent: null },
      `-19.99 PLN · ${C}.effect.all`,
    ],
    [
      "rabat kwotowy bez waluty nie zostawia spacji na końcu",
      { discountKind: "fixed", discountCents: 500, currency: null, discountPercent: null },
      `-5.00 · ${C}.effect.all`,
    ],
    [
      "rabat procentowy bez wartości liczy się jako zero",
      { discountPercent: null },
      `-0% · ${C}.effect.all`,
    ],
    [
      "rabat kwotowy bez kwoty liczy się jako zero",
      { discountKind: "fixed", discountCents: null, currency: "EUR", discountPercent: null },
      `-0.00 EUR · ${C}.effect.all`,
    ],
    [
      "samo odsłonięcie ukrytych biletów nie obiecuje rabatu",
      { appliesDiscount: false, revealsHidden: true },
      `${C}.effect.reveal · ${C}.effect.all`,
    ],
    [
      "rabat na wybrane bilety podaje ich liczbę",
      { ticketTypeIds: ["t1", "t2"] },
      `-10% · ${C}.effect.specific(count=2)`,
    ],
  ])("%s", (_nazwa, patch, opis) => {
    h.rows = [kod(patch)];
    panel();
    expect(within(wiersz()).getByText(opis)).toBeTruthy();
  });
});

describe("status kodu", () => {
  it.each<[string, Partial<EventCodeRow>, string]>([
    ["aktywny", {}, "active"],
    ["wyłączony", { active: false }, "inactive"],
    ["zużyty do limitu", { maxRedemptions: 2, redemptionsCount: 2 }, "used_up"],
    ["po terminie", { validUntil: relativeIso(-DZIEN) }, "expired"],
    ["przed startem", { validFrom: relativeIso(DZIEN) }, "scheduled"],
  ])("kod %s ma własną plakietkę", (_nazwa, patch, status) => {
    h.rows = [kod(patch)];
    panel();
    expect(within(wiersz()).getByText(`${C}.status.${status}`)).toBeTruthy();
  });
});

describe("wyszukiwanie", () => {
  beforeEach(() => {
    h.rows = [
      kod({ id: "c1", code: "VIP10", name: "Goście VIP" }),
      kod({ id: "c2", code: "PRASA", name: "Dziennikarze" }),
      kod({ id: "c3", code: "BEZNAZWY", name: null }),
    ];
  });

  const szukaj = (tekst: string) =>
    fireEvent.change(screen.getByLabelText(`${C}.search`), { target: { value: tekst } });

  it("łapie kod bez względu na wielkość liter", () => {
    panel();
    szukaj("vip");
    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("VIP10")).toBeTruthy();
  });

  it("łapie nazwę kodu", () => {
    panel();
    szukaj("dzienn");
    expect(wiersze()).toHaveLength(1);
    expect(within(wiersz()).getByText("PRASA")).toBeTruthy();
  });

  it("same spacje nie filtrują listy", () => {
    panel();
    szukaj("   ");
    expect(wiersze()).toHaveLength(3);
  });

  it("brak trafień pokazuje komunikat pustki", () => {
    panel();
    szukaj("nieistnieje");
    expect(screen.getByText(`${C}.empty`)).toBeTruthy();
  });
});

describe("operacje w wierszu", () => {
  it("przełącznik aktywnego kodu wysyła wyłączenie", () => {
    panel();
    kliknij(within(wiersz()).getByRole("switch", { name: `${C}.actions.deactivate` }));
    expect(h.toggleCalls).toEqual([{ id: "c1", active: false }]);
  });

  it("przełącznik wyłączonego kodu wysyła włączenie", () => {
    h.rows = [kod({ active: false })];
    panel();
    kliknij(within(wiersz()).getByRole("switch", { name: `${C}.actions.activate` }));
    expect(h.toggleCalls).toEqual([{ id: "c1", active: true }]);
  });

  it("kopiowanie wkłada do schowka adres rejestracji z kodem", async () => {
    panel();
    await act(async () => {
      fireEvent.click(within(wiersz()).getByRole("button", { name: `${C}.actions.copyUrl` }));
    });
    expect(h.clipboard).toEqual(["https://nes.example/events/forum/register?code=VIP10"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${C}.toasts.copied`);
  });

  it("gdy schowek odmawia, adres trafia do komunikatu, żeby dało się go przepisać", async () => {
    h.clipboardFails = true;
    panel();
    await act(async () => {
      fireEvent.click(within(wiersz()).getByRole("button", { name: `${C}.actions.copyUrl` }));
    });
    expect(h.toastError).toHaveBeenCalledWith(
      "https://nes.example/events/forum/register?code=VIP10",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("kosz usuwa właściwy kod i potwierdza to komunikatem", () => {
    panel();
    kliknij(within(wiersz()).getByRole("button", { name: `${C}.actions.delete` }));
    expect(h.deleteCalls).toEqual(["c1"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${C}.toasts.deleted`);
  });

  it("odmowa usunięcia kończy się komunikatem błędu", () => {
    h.deleteError = new Error("in use");
    panel();
    kliknij(within(wiersz()).getByRole("button", { name: `${C}.actions.delete` }));
    expect(h.toastError).toHaveBeenCalledWith(`${C}.toasts.error`);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("okno kodu", () => {
  it("nowy kod: tytuł tworzenia, pusty kod, waluta z pierwszego biletu", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    expect(within(okno()).getByText(`${C}.create`)).toBeTruthy();
    expect(within(okno()).getByLabelText(`${C}.form.code`)).toHaveProperty("value", "");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.amountOff` }));
    expect(within(okno()).getByLabelText(`${C}.form.currency`)).toHaveProperty("value", "EUR");
  });

  it("bez biletów nowy kod dostaje walutę domyślną PLN", () => {
    h.tickets = [];
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.amountOff` }));
    expect(within(okno()).getByLabelText(`${C}.form.currency`)).toHaveProperty("value", "PLN");
  });

  it("edycja otwiera okno wypełnione danymi wiersza", () => {
    panel();
    kliknij(within(wiersz()).getByRole("button", { name: `${C}.edit` }));
    expect(within(okno()).getByText(`${C}.edit`)).toBeTruthy();
    expect(within(okno()).getByLabelText(`${C}.form.code`)).toHaveProperty("value", "VIP10");
    expect(within(okno()).getByLabelText(`${C}.form.name`)).toHaveProperty("value", "Goście VIP");
  });

  it("pole kodu normalizuje wpis: bez spacji na brzegach i wielkimi literami", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    wpisz(`${C}.form.code`, "  lato24 ");
    expect(within(okno()).getByLabelText(`${C}.form.code`)).toHaveProperty("value", "LATO24");
  });

  it("adres rejestracji pojawia się dopiero z kodem i da się go skopiować", async () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    expect(within(okno()).queryByText(`${C}.form.registrationUrl`)).toBeNull();
    wpisz(`${C}.form.code`, "lato24");
    expect(
      within(okno()).getByDisplayValue("https://nes.example/events/forum/register?code=LATO24"),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(okno()).getByRole("button", { name: `${C}.form.copy` }));
    });
    expect(h.clipboard).toEqual(["https://nes.example/events/forum/register?code=LATO24"]);
  });

  it("błędny szkic NIE idzie do zapisu, a okno mówi zdaniem, co poprawić", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(within(okno()).getByRole("alert").textContent).toBe(`${C}.issues.code`);
    expect(h.saveCalls).toEqual([]);
  });

  it("poprawny szkic idzie do zapisu jako NOWY kod, a okno się zamyka", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    wpisz(`${C}.form.code`, "lato24");
    wpisz(`${C}.form.name`, "Lato");
    wpisz(`${C}.form.description`, "Kod letni");
    wpisz(`${C}.form.amount`, "15");
    wpisz(`${C}.form.quantity`, "20");
    wpisz(`${C}.form.validFrom`, "2099-06-16T10:00");
    wpisz(`${C}.form.validUntil`, "2099-06-20T10:00");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(h.saveCalls).toHaveLength(1);
    expect(h.saveCalls[0]?.id).toBeNull();
    expect(h.saveCalls[0]?.draft).toMatchObject({
      code: "LATO24",
      name: "Lato",
      description: "Kod letni",
      amount: "15",
      quantity: "20",
      validFrom: "2099-06-16T10:00",
      validUntil: "2099-06-20T10:00",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(`${C}.toasts.saved`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zapis edycji niesie identyfikator edytowanego kodu", () => {
    panel();
    kliknij(within(wiersz()).getByRole("button", { name: `${C}.edit` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(h.saveCalls[0]?.id).toBe("c1");
  });

  it("odmowa zapisu NIE zamyka okna - pola zostają", () => {
    h.saveError = new Error("duplicate");
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    wpisz(`${C}.form.code`, "lato24");
    wpisz(`${C}.form.amount`, "15");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(h.toastError).toHaveBeenCalledWith(`${C}.toasts.error`);
    expect(within(okno()).getByLabelText(`${C}.form.code`)).toHaveProperty("value", "LATO24");
  });

  it("poprawienie szkicu po błędzie zdejmuje komunikat", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(within(okno()).getByRole("alert")).toBeTruthy();
    wpisz(`${C}.form.code`, "lato24");
    wpisz(`${C}.form.amount`, "15");
    h.saveError = new Error("duplicate");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(within(okno()).queryByRole("alert")).toBeNull();
  });

  it("w trakcie zapisu przycisk zapisu jest zgaszony", () => {
    h.savePending = true;
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    expect(within(okno()).getByRole("button", { name: `${C}.form.save` })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("anulowanie zamyka okno bez zapisu", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.cancel` }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.saveCalls).toEqual([]);
  });

  it("Escape zamyka okno tą samą drogą co anulowanie", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    fireEvent.keyDown(okno(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("pola rabatu w oknie", () => {
  it("waluta jest tylko przy rabacie kwotowym i przyjmuje wielkie litery", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    expect(within(okno()).queryByLabelText(`${C}.form.currency`)).toBeNull();
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.amountOff` }));
    wpisz(`${C}.form.currency`, "usd");
    expect(within(okno()).getByLabelText(`${C}.form.currency`)).toHaveProperty("value", "USD");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.percentOff` }));
    expect(within(okno()).queryByLabelText(`${C}.form.currency`)).toBeNull();
  });

  it("wyłączenie rabatu chowa pola rabatu, a samo odsłonięcie biletów wystarcza do zapisu", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    const [rabat, odslona] = within(okno()).getAllByRole("switch");
    if (rabat === undefined || odslona === undefined) throw new Error("brak przełączników");
    kliknij(rabat);
    expect(within(okno()).queryByLabelText(`${C}.form.amount`)).toBeNull();
    kliknij(odslona);
    wpisz(`${C}.form.code`, "ukryte");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(h.saveCalls[0]?.draft).toMatchObject({ appliesDiscount: false, revealsHidden: true });
  });
});

describe("zakres biletów w oknie", () => {
  it("lista biletów jest tylko przy zakresie „wybrane”", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    expect(within(okno()).queryByLabelText("Standard")).toBeNull();
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.specificTickets` }));
    expect(within(okno()).getByLabelText("Standard")).toBeTruthy();
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.allTickets` }));
    expect(within(okno()).queryByLabelText("Standard")).toBeNull();
  });

  it("bilet bez polskiej nazwy pokazuje angielską, a nie pusty wiersz", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.specificTickets` }));
    expect(within(okno()).getByLabelText("Student")).toBeTruthy();
  });

  it("po angielsku bilety mają nazwy angielskie", () => {
    h.lang = "en";
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.specificTickets` }));
    expect(within(okno()).getByLabelText("Standard pass")).toBeTruthy();
  });

  it("bilet bez angielskiej nazwy po angielsku pokazuje polską", () => {
    h.lang = "en";
    h.tickets = [{ id: "t3", name_pl: "Wolontariusz", name_en: "", currency: "PLN" }];
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.specificTickets` }));
    expect(within(okno()).getByLabelText("Wolontariusz")).toBeTruthy();
  });

  it("zaznaczenie i odznaczenie biletu zmienia zakres wysyłany do zapisu", () => {
    panel();
    kliknij(screen.getByRole("button", { name: `${C}.create` }));
    wpisz(`${C}.form.code`, "wybrane");
    wpisz(`${C}.form.amount`, "10");
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.specificTickets` }));
    kliknij(within(okno()).getByLabelText("Standard"));
    kliknij(within(okno()).getByLabelText("Student"));
    kliknij(within(okno()).getByLabelText("Standard"));
    kliknij(within(okno()).getByRole("button", { name: `${C}.form.save` }));
    expect(h.saveCalls[0]?.draft).toMatchObject({
      ticketScope: "specific",
      ticketTypeIds: ["t2"],
    });
  });
});
