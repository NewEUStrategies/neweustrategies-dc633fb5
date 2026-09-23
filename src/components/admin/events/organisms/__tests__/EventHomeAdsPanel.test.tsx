// Organizm „Reklama na stronie głównej wydarzenia" - tabela reklam (obraz, grupy
// docelowe, wyświetlenia, kliknięcia, status) i okno dodawania/edycji z grupami
// docelowymi i harmonogramem emisji.
//
// CO TEN PLIK DOWODZI.
//   1. WIERSZ POKAZUJE REKLAMĘ TAK, JAK JĄ ZOBACZY ODWIEDZAJĄCY. Obraz idzie pod
//      adresem marki (nie technicznym hostem magazynu) z tekstem alternatywnym,
//      obok liczniki wyświetleń i kliknięć oraz plakietka „aktywna"/„wstrzymana".
//      Pusta lista - także zapytanie jeszcze w locie - mówi zdaniem, że reklam
//      nie ma, zamiast rysować pustą tabelę.
//   2. GRUPY DOCELOWE MAJĄ NAZWY W JĘZYKU PANELU, z przejściem na drugi język,
//      gdy tłumaczenia brak. Reklama bez grup trafia do „wszystkich", a grupa
//      usunięta z wydarzenia nie zostawia w wierszu pustej pozycji.
//   3. USUWANIE WYMAGA POTWIERDZENIA. Pytanie jest oznaczone jako destrukcyjne,
//      zgoda usuwa WŁAŚCIWĄ reklamę, odmowa nie dotyka bazy, a błąd bazy kończy
//      się komunikatem, nie ciszą.
//   4. OKNO NIE ZAPISUJE BŁĘDNEJ REKLAMY. Walidacja szkicu zatrzymuje zapis
//      i mówi zdaniem przy KAŻDYM złym polu; poprawny szkic idzie do zapisu
//      w komplecie (grupy, harmonogram, przełącznik), sukces zamyka okno,
//      a odmowa bazy go NIE zamyka - organizator nie traci wypełnionych pól.
//   5. HARMONOGRAM PILNUJE KOLEJNOŚCI. Koniec emisji równy początkowi albo
//      wcześniejszy blokuje zapis; wyczyszczenie daty zdejmuje ograniczenie
//      (do zapisu idzie pusty napis, nie `null`). Daty liczą się od
//      zamrożonego zegara, bo pole daty bierze „teraz" z `new Date()`.
//   6. KAŻDE OTWARCIE OKNA ZACZYNA OD WŁAŚCIWEGO SZKICU. Nowa reklama - puste
//      pola, aktywna, bez grup i dat; edycja - dane wiersza i jego
//      identyfikator. Szkic i komunikaty błędów z poprzedniego otwarcia nie
//      wracają.
//   7. JĘZYK PANELU DOCIERA DO PÓL. Pola daty formatują i podpisują się po
//      polsku albo po angielsku (także dla „en-GB"), a pola wyboru grup
//      mają nazwy w języku panelu.
//   8. PANEL PRACUJE NA SWOIM WYDARZENIU - każdy hook dostaje jego
//      identyfikator, a szkic zapisu niesie go dalej.
//   9. WALIDUJE PANEL, NIE PRZEGLĄDARKA, A BŁĄD JEST PRZYPIĘTY DO POLA.
//      Formularz ma `noValidate`, więc link bez schematu dochodzi do
//      `validateHomeAd` i dostaje komunikat panelu w języku panelu - przed
//      poprawką natywna walidacja `type="url"` zatrzymywała wysłanie dymkiem
//      w języku przeglądarki i komunikatu panelu nie było. Każdy komunikat
//      (oba obrazy, link, koniec emisji) jest opisem SWOJEGO pola
//      (`aria-describedby`), a pole ma `aria-invalid`; pole bez błędu nie ma
//      ani jednego, ani drugiego.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabeli reguł `validateHomeAd`/`isHttpsUrl` - ma
// ją `src/lib/events/sponsorBoardApi.test.ts`. Tutaj walidacja zostaje
// PRAWDZIWA (częściowy mock modułu), bo przedmiotem dowodu jest to, że okno
// przez nią przechodzi i pokazuje jej werdykt. Zapytań RPC - hooki są atrapą,
// liczy się to, z czym panel je woła. Wnętrza `ImageUrlField` (trzy stany
// podglądu, biblioteka mediów) - ma je `authAdminComponents.test.tsx`.
//
// ATRAPY. `ImageUrlField` i `DateTimePicker` są PRAWDZIWE (Radix Popover
// i kalendarz działają pod happy-dom od `fireEvent.click`). Atrapą jest tylko:
// `MediaPickerDialog` (sięga do biblioteki mediów przez Supabase), Radix
// Switch (nie przełącza się pod happy-dom bez pełnego pointer API - atrapa
// z `@/test/reactStubs`) i `confirmDialog` (okno potwierdzenia rysuje
// `AppDialogHost` z korzenia aplikacji, którego tu nie ma).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { ConfirmDialogRequest } from "@/lib/appDialogs";
import type { EventHomeAdRow, HomeAdInput } from "@/lib/events/sponsorBoardApi";
import type { EventGroupRow } from "@/lib/events/termsGroupsApi";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";

type Wynik = { onSuccess?: () => void; onError?: (error: unknown) => void };
type Pytanie = Omit<ConfirmDialogRequest, "kind">;

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  ads: [] as EventHomeAdRow[] | undefined,
  groups: [] as EventGroupRow[] | undefined,
  hookEventIds: { ads: [] as string[], groups: [] as string[], save: [] as string[] },
  removeEventIds: [] as string[],
  saveCalls: [] as HomeAdInput[],
  saveError: null as Error | null,
  savePending: false,
  deleteCalls: [] as string[],
  deleteError: null as Error | null,
  confirmCalls: [] as Pytanie[],
  confirmAnswer: true,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (pytanie: Pytanie) => {
    h.confirmCalls.push(pytanie);
    return h.confirmAnswer;
  },
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: (eventId: string) => {
    h.hookEventIds.groups.push(eventId);
    return { data: h.groups };
  },
}));
vi.mock("@/lib/events/sponsorBoardApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/sponsorBoardApi")>();
  return {
    ...actual,
    useHomeAds: (eventId: string) => {
      h.hookEventIds.ads.push(eventId);
      return { data: h.ads };
    },
    useSaveHomeAd: (eventId: string) => {
      h.hookEventIds.save.push(eventId);
      return {
        mutate: (input: HomeAdInput, wynik: Wynik) => {
          h.saveCalls.push(input);
          if (h.saveError === null) wynik.onSuccess?.();
          else wynik.onError?.(h.saveError);
        },
        isPending: h.savePending,
      };
    },
    useDeleteHomeAd: (eventId: string) => {
      h.removeEventIds.push(eventId);
      return {
        mutate: (id: string, wynik: Wynik) => {
          h.deleteCalls.push(id);
          if (h.deleteError === null) wynik.onSuccess?.();
          else wynik.onError?.(h.deleteError);
        },
      };
    },
  };
});

import { EventHomeAdsPanel } from "@/components/admin/events/organisms/EventHomeAdsPanel";

// Pole daty bierze „teraz" z `new Date()` (przycisk „Teraz", dzień w kalendarzu
// dziedziczy godzinę bieżącą), a kalendarz otwiera się na bieżącym miesiącu -
// oba muszą widzieć tę samą, zamrożoną chwilę.
freezeClock();

const A = "sponsorBoard.ads";
const OBRAZ = "https://cdn.example.org/reklamy/baner.webp";
const OBRAZ_MOBILNY = "https://cdn.example.org/reklamy/plansza.webp";
const LINK = "https://sponsor.example.org/oferta";
// Etykiety obu pól obrazu. Do 2026-09 etykieta `ImageUrlField` NIE była
// związana z polem (`htmlFor`), więc test szukał pól po wspólnym placeholderze
// i rozróżniał je kolejnością - czyli dokładnie tak, jak nie potrafi tego
// czytnik ekranu. Organizm wiąże dziś etykietę z polem przez `useId`, więc pole
// znajduje się po NAZWIE, a pomyłka w powiązaniu oblewa test.
const ETYKIETY_OBRAZOW = [`${A}.image`, `${A}.imageMobile`] as const;

function reklama(patch: Partial<EventHomeAdRow> = {}): EventHomeAdRow {
  return {
    id: "ad1",
    image_url: OBRAZ,
    image_mobile_url: "",
    link_url: LINK,
    alt_text: "Baner sponsora",
    group_ids: [],
    starts_at: "",
    ends_at: "",
    is_active: true,
    views: 120,
    clicks: 7,
    sort_order: 0,
    ...patch,
  };
}

function grupa(id: string, name_pl: string, name_en: string): EventGroupRow {
  return {
    id,
    event_id: "ev1",
    key: id,
    name_pl,
    name_en,
    description_pl: "",
    description_en: "",
    color: "#336699",
    attendee_visibility: "registered",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: false,
    is_default: false,
    is_system: false,
    min_tier_rank: 0,
    members_count: 0,
    primary_members_count: 0,
    extra_members_count: 0,
    tickets_count: 0,
    sort_order: 0,
    created_at: relativeIso(-30 * DZIEN),
    updated_at: relativeIso(-30 * DZIEN),
  };
}

function panel() {
  return render(<EventHomeAdsPanel eventId="ev1" />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("row").slice(1);

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na ekranie`);
  return found;
};

// Popover kalendarza też ma rolę „dialog", ale bez nazwy - okno reklamy
// rozpoznajemy po tytule.
const okno = (): HTMLElement => screen.getByRole("dialog", { name: /^sponsorBoard\.ads\.dialog/ });

function kliknij(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

function wpisz(pole: HTMLElement, wartosc: string): void {
  act(() => {
    fireEvent.change(pole, { target: { value: wartosc } });
  });
}

const poleObrazu = (index: 0 | 1): HTMLElement =>
  within(okno()).getByLabelText(ETYKIETY_OBRAZOW[index]);

const poleLinku = (): HTMLElement => within(okno()).getByLabelText(`${A}.link`);

const zapisz = () => kliknij(within(okno()).getByRole("button", { name: `${A}.save` }));

const otworzNowa = () => kliknij(screen.getByRole("button", { name: `${A}.add` }));

const otworzEdycje = (index = 0) =>
  kliknij(within(wiersz(index)).getByRole("button", { name: `${A}.edit` }));

/** Otwiera kalendarz pola daty i zwraca jego dymek. */
function kalendarz(etykieta: string): HTMLElement {
  kliknij(screen.getByLabelText(etykieta));
  const dymek = screen.getAllByRole("dialog").find((d) => d !== okno());
  if (dymek === undefined) throw new Error(`kalendarz pola ${etykieta} się nie otworzył`);
  return dymek;
}

/** Escape zamyka najwyższą warstwę, czyli dymek kalendarza, a nie okno reklamy. */
function zamknijKalendarz(): void {
  act(() => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
}

/** Ustawia pole daty na „teraz" przyciskiem w kalendarzu. */
function ustawTeraz(etykieta: string, przycisk = "Teraz"): void {
  kliknij(within(kalendarz(etykieta)).getByRole("button", { name: przycisk }));
  zamknijKalendarz();
}

/** Wybiera dzień bieżącego miesiąca w kalendarzu pola daty. */
function ustawDzien(etykieta: string, dzien: number): void {
  kliknij(within(kalendarz(etykieta)).getByText(String(dzien)));
  zamknijKalendarz();
}

async function usun(index = 0): Promise<void> {
  await act(async () => {
    fireEvent.click(within(wiersz(index)).getByRole("button", { name: `${A}.remove` }));
  });
}

const grupaWOknie = (nazwa: string): HTMLElement =>
  within(okno()).getByRole("checkbox", { name: nazwa });

beforeEach(() => {
  h.lang = "pl";
  h.ads = [reklama()];
  h.groups = [
    grupa("g1", "Goście VIP", "VIP guests"),
    grupa("g2", "", "Press"),
    grupa("g3", "Wolontariusze", ""),
  ];
  h.hookEventIds = { ads: [], groups: [], save: [] };
  h.removeEventIds = [];
  h.saveCalls = [];
  h.saveError = null;
  h.savePending = false;
  h.deleteCalls = [];
  h.deleteError = null;
  h.confirmCalls = [];
  h.confirmAnswer = true;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("lista reklam", () => {
  it("brak reklam mówi zdaniem, że ich nie ma, i nie rysuje przycisków wiersza", () => {
    h.ads = [];
    panel();
    expect(within(wiersz()).getByText(`${A}.empty`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: `${A}.edit` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${A}.remove` })).toBeNull();
  });

  it("zapytanie w locie (brak danych reklam i grup) to też pusta lista, a nie awaria", () => {
    h.ads = undefined;
    h.groups = undefined;
    panel();
    expect(screen.getByText(`${A}.empty`)).toBeTruthy();
    otworzNowa();
    expect(within(okno()).queryAllByRole("checkbox")).toEqual([]);
  });

  it("wiersz pokazuje obraz z tekstem alternatywnym, liczniki i plakietkę aktywnej reklamy", () => {
    panel();
    const w = within(wiersz());
    expect(w.getByRole("img", { name: "Baner sponsora" }).getAttribute("src")).toBe(OBRAZ);
    expect(w.getByText("120")).toBeTruthy();
    expect(w.getByText("7")).toBeTruthy();
    expect(w.getByText(`${A}.active`)).toBeTruthy();
    expect(w.queryByText(`${A}.paused`)).toBeNull();
  });

  it("obraz z magazynu mediów idzie pod adresem marki, a nie technicznym hostem", () => {
    h.ads = [
      reklama({
        image_url: "https://abc.supabase.co/storage/v1/object/public/media/reklamy/baner.webp",
      }),
    ];
    panel();
    expect(within(wiersz()).getByRole("img").getAttribute("src")).toBe(
      "https://neweuropeanstrategies.com/media/reklamy/baner.webp",
    );
  });

  it("reklama wyłączona ma plakietkę wstrzymania", () => {
    h.ads = [reklama({ is_active: false })];
    panel();
    expect(within(wiersz()).getByText(`${A}.paused`)).toBeTruthy();
    expect(within(wiersz()).queryByText(`${A}.active`)).toBeNull();
  });

  it("reklama bez grup docelowych trafia do wszystkich odwiedzających", () => {
    panel();
    expect(within(wiersz()).getByText(`${A}.allGroups`)).toBeTruthy();
  });

  it("grupy docelowe mają polskie nazwy z przejściem na angielską, a usunięta grupa znika", () => {
    h.ads = [reklama({ group_ids: ["g1", "g2", "usunieta", "g3"] })];
    panel();
    expect(within(wiersz()).getByText("Goście VIP, Press, Wolontariusze")).toBeTruthy();
  });

  it("po angielsku grupy docelowe mają angielskie nazwy z przejściem na polską", () => {
    h.lang = "en";
    h.ads = [reklama({ group_ids: ["g1", "g2", "usunieta", "g3"] })];
    panel();
    expect(within(wiersz()).getByText("VIP guests, Press, Wolontariusze")).toBeTruthy();
  });

  it("panel czyta i zapisuje reklamy oraz grupy SWOJEGO wydarzenia", () => {
    panel();
    expect(new Set(h.hookEventIds.ads)).toEqual(new Set(["ev1"]));
    expect(new Set(h.hookEventIds.groups)).toEqual(new Set(["ev1"]));
    expect(new Set(h.hookEventIds.save)).toEqual(new Set(["ev1"]));
    expect(new Set(h.removeEventIds)).toEqual(new Set(["ev1"]));
  });
});

describe("usuwanie reklamy", () => {
  beforeEach(() => {
    h.ads = [reklama(), reklama({ id: "ad2", alt_text: "Druga reklama" })];
  });

  it("kosz pyta o potwierdzenie destrukcyjne i po zgodzie usuwa WŁAŚCIWĄ reklamę", async () => {
    panel();
    await usun(1);
    expect(h.confirmCalls).toEqual([{ title: `${A}.remove`, destructive: true }]);
    expect(h.deleteCalls).toEqual(["ad2"]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${A}.deleted`);
  });

  it("odmowa w oknie potwierdzenia niczego nie usuwa i niczego nie ogłasza", async () => {
    h.confirmAnswer = false;
    panel();
    await usun(0);
    expect(h.confirmCalls).toHaveLength(1);
    expect(h.deleteCalls).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odmowa bazy przy usuwaniu kończy się komunikatem błędu", async () => {
    h.deleteError = new Error("in use");
    panel();
    await usun(0);
    expect(h.deleteCalls).toEqual(["ad1"]);
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.error");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("okno nowej reklamy", () => {
  it("startuje od pustego szkicu: tytuł tworzenia, puste pola, aktywna, bez grup i dat", () => {
    panel();
    otworzNowa();
    expect(within(okno()).getByRole("heading", { name: `${A}.dialogNew` })).toBeTruthy();
    expect(poleObrazu(0)).toHaveProperty("value", "");
    expect(poleObrazu(1)).toHaveProperty("value", "");
    expect(poleLinku()).toHaveProperty("value", "");
    expect(within(okno()).getByLabelText(`${A}.alt`)).toHaveProperty("value", "");
    expect(within(okno()).getByRole("switch", { name: `${A}.isActive` })).toHaveProperty(
      "checked",
      true,
    );
    for (const nazwa of ["Goście VIP", "Press", "Wolontariusze"]) {
      expect(grupaWOknie(nazwa).getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.getByLabelText(`${A}.startsAt`).textContent).toBe("Wybierz datę i godzinę");
    expect(screen.getByLabelText(`${A}.endsAt`).textContent).toBe("Wybierz datę i godzinę");
  });

  it("kadr podglądu obrazu komputerowego jest pionowym banerem, a mobilnego - ekranem telefonu", () => {
    panel();
    otworzNowa();
    const kadry = Array.from(okno().querySelectorAll<HTMLElement>("[style]"))
      .map((el) => el.style.aspectRatio)
      .filter((kadr) => kadr !== "");
    expect(kadry).toEqual(["1 / 2", "9 / 16"]);
  });

  it("zapis bez obrazu jest zablokowany, a okno mówi, że trzeba wybrać obraz", () => {
    panel();
    otworzNowa();
    zapisz();
    expect(within(okno()).getAllByText(`${A}.imageInvalid`)).toHaveLength(1);
    expect(within(okno()).queryByText(`${A}.linkInvalid`)).toBeNull();
    expect(within(okno()).queryByText(`${A}.endsInvalid`)).toBeNull();
    expect(h.saveCalls).toEqual([]);
  });

  it("adres bez https w obu obrazach i w linku daje komunikat przy KAŻDYM z tych pól", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), "http://cdn.example.org/baner.webp");
    wpisz(poleObrazu(1), "http://cdn.example.org/plansza.webp");
    wpisz(poleLinku(), "http://sponsor.example.org/oferta");
    zapisz();
    expect(within(okno()).getAllByText(`${A}.imageInvalid`)).toHaveLength(2);
    expect(within(okno()).getByText(`${A}.linkInvalid`)).toBeTruthy();
    expect(h.saveCalls).toEqual([]);
  });

  it("link bez schematu dostaje komunikat PANELU przypięty do pola, a zapis stoi", () => {
    // ZMIANA ASERCJI (2026-09). Ten test przypinał wcześniej defekt: „link,
    // który nie jest adresem, zatrzymuje już natywna walidacja pola typu url".
    // Natywna walidacja blokowała wysłanie dymkiem w języku przeglądarki,
    // `validateHomeAd` nie dostawał głosu, a `sponsorBoard.ads.linkInvalid`
    // nie pojawiał się nigdy. Formularz ma dziś `noValidate`: to samo wejście
    // kończy się komunikatem panelu, związanym z polem.
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    wpisz(poleLinku(), "sponsor.example.org");
    zapisz();
    expect(within(okno()).getByText(`${A}.linkInvalid`)).toBeTruthy();
    expect(poleLinku()).toHaveAccessibleDescription(`${A}.linkInvalid`);
    expect(poleLinku().getAttribute("aria-invalid")).toBe("true");
    expect(h.saveCalls).toEqual([]);
  });

  it("formularz okna oddaje walidację aplikacji (`noValidate`), a link zostaje polem typu url", () => {
    panel();
    otworzNowa();
    const formularz = okno().querySelector("form");
    expect(formularz?.noValidate).toBe(true);
    // Typ `url` zostaje dla klawiatury ekranowej - reguły trzyma `validateHomeAd`.
    expect(poleLinku().getAttribute("type")).toBe("url");
  });

  it("komunikat KAŻDEGO złego pola jest opisem SWOJEGO pola, a pole ma `aria-invalid`", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), "http://cdn.example.org/baner.webp");
    wpisz(poleObrazu(1), "ftp://cdn.example.org/plansza.webp");
    wpisz(poleLinku(), "http://sponsor.example.org/oferta");
    ustawTeraz(`${A}.startsAt`);
    ustawTeraz(`${A}.endsAt`);
    zapisz();
    for (const pole of [poleObrazu(0), poleObrazu(1)]) {
      expect(pole).toHaveAccessibleDescription(`${A}.imageInvalid`);
      expect(pole.getAttribute("aria-invalid")).toBe("true");
    }
    expect(poleLinku()).toHaveAccessibleDescription(`${A}.linkInvalid`);
    const koniec = screen.getByLabelText(`${A}.endsAt`);
    expect(koniec).toHaveAccessibleDescription(`${A}.endsInvalid`);
    expect(koniec.getAttribute("aria-invalid")).toBe("true");
    // Początek emisji nie jest błędny - komunikat o kolejności należy do końca.
    expect(screen.getByLabelText(`${A}.startsAt`).hasAttribute("aria-invalid")).toBe(false);
    expect(h.saveCalls).toEqual([]);
  });

  it("pola bez błędu nie mają `aria-invalid` ani opisu błędu", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(1), OBRAZ_MOBILNY);
    wpisz(poleLinku(), LINK);
    zapisz();
    expect(poleObrazu(0).getAttribute("aria-invalid")).toBe("true");
    for (const pole of [poleObrazu(1), poleLinku(), screen.getByLabelText(`${A}.endsAt`)]) {
      expect(pole.hasAttribute("aria-invalid")).toBe(false);
      expect(pole).not.toHaveAccessibleDescription();
    }
  });

  it("zły obraz mobilny blokuje zapis, choć obraz komputerowy jest poprawny", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    wpisz(poleObrazu(1), "ftp://cdn.example.org/plansza.webp");
    zapisz();
    expect(within(okno()).getAllByText(`${A}.imageInvalid`)).toHaveLength(1);
    expect(h.saveCalls).toEqual([]);
  });

  it("koniec emisji równy początkowi blokuje zapis zdaniem o kolejności dat", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    ustawTeraz(`${A}.startsAt`);
    ustawTeraz(`${A}.endsAt`);
    zapisz();
    expect(within(okno()).getByText(`${A}.endsInvalid`)).toBeTruthy();
    expect(h.saveCalls).toEqual([]);
  });

  it("koniec emisji przed początkiem blokuje zapis", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    // FIXED_NOW to 15.06.2099 - początek jutro, koniec „teraz".
    ustawDzien(`${A}.startsAt`, 16);
    ustawTeraz(`${A}.endsAt`);
    zapisz();
    expect(within(okno()).getByText(`${A}.endsInvalid`)).toBeTruthy();
    expect(h.saveCalls).toEqual([]);
  });

  it("poprawny szkic idzie do zapisu w komplecie jako NOWA reklama, a okno się zamyka", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    wpisz(poleObrazu(1), OBRAZ_MOBILNY);
    wpisz(poleLinku(), LINK);
    wpisz(within(okno()).getByLabelText(`${A}.alt`), "Baner partnera");
    kliknij(grupaWOknie("Goście VIP"));
    kliknij(grupaWOknie("Wolontariusze"));
    ustawTeraz(`${A}.startsAt`);
    ustawDzien(`${A}.endsAt`, 16);
    kliknij(within(okno()).getByRole("switch", { name: `${A}.isActive` }));
    zapisz();
    expect(h.saveCalls).toEqual([
      {
        id: undefined,
        eventId: "ev1",
        imageUrl: OBRAZ,
        imageMobileUrl: OBRAZ_MOBILNY,
        linkUrl: LINK,
        altText: "Baner partnera",
        groupIds: ["g1", "g3"],
        startsAt: relativeIso(0),
        endsAt: relativeIso(DZIEN),
        isActive: false,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${A}.saved`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sam obraz wystarczy: puste pola opcjonalne nie blokują zapisu", () => {
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    zapisz();
    expect(h.saveCalls[0]).toMatchObject({
      imageMobileUrl: "",
      linkUrl: "",
      groupIds: [],
      startsAt: "",
      endsAt: "",
      isActive: true,
    });
  });

  it("odmowa bazy NIE zamyka okna - wpisane pola zostają, a komunikat mówi o błędzie", () => {
    h.saveError = new Error("rls");
    panel();
    otworzNowa();
    wpisz(poleObrazu(0), OBRAZ);
    wpisz(poleLinku(), LINK);
    zapisz();
    expect(h.saveCalls).toHaveLength(1);
    expect(h.toastError).toHaveBeenCalledWith("sponsorBoard.toasts.error");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(poleLinku()).toHaveProperty("value", LINK);
    expect(poleObrazu(0)).toHaveProperty("value", OBRAZ);
  });

  it("poprawienie szkicu po błędzie zdejmuje komunikat walidacji", () => {
    h.saveError = new Error("rls");
    panel();
    otworzNowa();
    zapisz();
    expect(within(okno()).getByText(`${A}.imageInvalid`)).toBeTruthy();
    wpisz(poleObrazu(0), OBRAZ);
    zapisz();
    expect(within(okno()).queryByText(`${A}.imageInvalid`)).toBeNull();
  });

  it("w trakcie zapisu przycisk zapisu jest zgaszony", () => {
    h.savePending = true;
    panel();
    otworzNowa();
    expect(within(okno()).getByRole("button", { name: `${A}.save` })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("anulowanie zamyka okno bez zapisu", () => {
    panel();
    otworzNowa();
    kliknij(within(okno()).getByRole("button", { name: `${A}.cancel` }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.saveCalls).toEqual([]);
  });

  it("Escape zamyka okno tą samą drogą co anulowanie", () => {
    panel();
    otworzNowa();
    fireEvent.keyDown(okno(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.saveCalls).toEqual([]);
  });

  it("ponowne otwarcie po anulowaniu zaczyna od czystego szkicu, bez starych komunikatów", () => {
    panel();
    otworzNowa();
    wpisz(poleLinku(), "http://sponsor.example.org/oferta");
    zapisz();
    expect(within(okno()).getByText(`${A}.linkInvalid`)).toBeTruthy();
    kliknij(within(okno()).getByRole("button", { name: `${A}.cancel` }));
    otworzNowa();
    expect(poleLinku()).toHaveProperty("value", "");
    expect(within(okno()).queryByText(`${A}.linkInvalid`)).toBeNull();
    expect(within(okno()).queryByText(`${A}.imageInvalid`)).toBeNull();
  });
});

describe("okno edycji reklamy", () => {
  beforeEach(() => {
    h.ads = [
      reklama({
        image_mobile_url: OBRAZ_MOBILNY,
        group_ids: ["g1", "g3"],
        starts_at: relativeIso(-DZIEN),
        ends_at: relativeIso(5 * DZIEN),
        is_active: false,
      }),
    ];
  });

  it("otwiera się wypełnione danymi wiersza", () => {
    panel();
    otworzEdycje();
    expect(within(okno()).getByRole("heading", { name: `${A}.dialogEdit` })).toBeTruthy();
    expect(poleObrazu(0)).toHaveProperty("value", OBRAZ);
    expect(poleObrazu(1)).toHaveProperty("value", OBRAZ_MOBILNY);
    expect(poleLinku()).toHaveProperty("value", LINK);
    expect(within(okno()).getByLabelText(`${A}.alt`)).toHaveProperty("value", "Baner sponsora");
    expect(grupaWOknie("Goście VIP").getAttribute("aria-checked")).toBe("true");
    expect(grupaWOknie("Press").getAttribute("aria-checked")).toBe("false");
    expect(grupaWOknie("Wolontariusze").getAttribute("aria-checked")).toBe("true");
    expect(within(okno()).getByRole("switch", { name: `${A}.isActive` })).toHaveProperty(
      "checked",
      false,
    );
    // FIXED_NOW to 15.06.2099, południe UTC: od wczoraj do za pięć dni.
    expect(screen.getByLabelText(`${A}.startsAt`).textContent).toMatch(/^14 cze 2099/);
    expect(screen.getByLabelText(`${A}.endsAt`).textContent).toMatch(/^20 cze 2099/);
  });

  it("zapis bez zmian niesie identyfikator reklamy i jej dane", () => {
    panel();
    otworzEdycje();
    zapisz();
    expect(h.saveCalls).toEqual([
      {
        id: "ad1",
        eventId: "ev1",
        imageUrl: OBRAZ,
        imageMobileUrl: OBRAZ_MOBILNY,
        linkUrl: LINK,
        altText: "Baner sponsora",
        groupIds: ["g1", "g3"],
        startsAt: relativeIso(-DZIEN),
        endsAt: relativeIso(5 * DZIEN),
        isActive: false,
      },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("odznaczenie grupy zdejmuje ją z celu, a zaznaczenie innej dopisuje ją na końcu", () => {
    panel();
    otworzEdycje();
    kliknij(grupaWOknie("Goście VIP"));
    kliknij(grupaWOknie("Press"));
    zapisz();
    expect(h.saveCalls[0]?.groupIds).toEqual(["g3", "g2"]);
  });

  it("wyczyszczenie dat zdejmuje ograniczenie emisji - do zapisu idzie pusty napis", () => {
    panel();
    otworzEdycje();
    for (const etykieta of [`${A}.startsAt`, `${A}.endsAt`]) {
      kliknij(within(screen.getByLabelText(etykieta)).getByRole("button", { name: "Wyczyść" }));
      expect(screen.getByLabelText(etykieta).textContent).toBe("Wybierz datę i godzinę");
    }
    zapisz();
    expect(h.saveCalls[0]).toMatchObject({ startsAt: "", endsAt: "" });
  });

  it("zmiana linku i włączenie reklamy trafiają do zapisu", () => {
    panel();
    otworzEdycje();
    wpisz(poleLinku(), "https://sponsor.example.org/nowa");
    kliknij(within(okno()).getByRole("switch", { name: `${A}.isActive` }));
    zapisz();
    expect(h.saveCalls[0]).toMatchObject({
      id: "ad1",
      linkUrl: "https://sponsor.example.org/nowa",
      isActive: true,
    });
  });

  it("nowa reklama po anulowanej edycji nie dziedziczy danych edytowanego wiersza", () => {
    panel();
    otworzEdycje();
    kliknij(within(okno()).getByRole("button", { name: `${A}.cancel` }));
    otworzNowa();
    expect(within(okno()).getByRole("heading", { name: `${A}.dialogNew` })).toBeTruthy();
    expect(poleObrazu(0)).toHaveProperty("value", "");
    expect(grupaWOknie("Goście VIP").getAttribute("aria-checked")).toBe("false");
    zapisz();
    expect(h.saveCalls).toEqual([]);
  });
});

describe("język panelu w oknie", () => {
  beforeEach(() => {
    h.ads = [reklama({ starts_at: relativeIso(-DZIEN) })];
  });

  it("po angielsku (także „en-GB”) daty mają format i podpisy angielskie", () => {
    h.lang = "en-GB";
    panel();
    otworzEdycje();
    expect(screen.getByLabelText(`${A}.startsAt`).textContent).toMatch(/^Jun 14, 2099/);
    expect(screen.getByLabelText(`${A}.endsAt`).textContent).toBe("Pick date and time");
    expect(
      within(screen.getByLabelText(`${A}.startsAt`)).getByRole("button", { name: "Clear" }),
    ).toBeTruthy();
    ustawTeraz(`${A}.endsAt`, "Now");
    zapisz();
    expect(h.saveCalls[0]).toMatchObject({ startsAt: relativeIso(-DZIEN), endsAt: relativeIso(0) });
  });

  it("po angielsku pola wyboru grup mają angielskie nazwy z przejściem na polską", () => {
    h.lang = "en";
    panel();
    otworzEdycje();
    expect(grupaWOknie("VIP guests")).toBeTruthy();
    expect(grupaWOknie("Press")).toBeTruthy();
    expect(grupaWOknie("Wolontariusze")).toBeTruthy();
  });

  it("po polsku pola wyboru grup mają polskie nazwy z przejściem na angielską", () => {
    panel();
    otworzEdycje();
    expect(grupaWOknie("Goście VIP")).toBeTruthy();
    expect(grupaWOknie("Press")).toBeTruthy();
    expect(within(okno()).queryByRole("checkbox", { name: "VIP guests" })).toBeNull();
  });
});
