// Dialog RODZAJU WYDARZENIA - osiemnascie pol, ktore ustawiaja KAZDE nowe
// wydarzenie zalozone z tego rodzaju.
//
// PO CO OSOBNY PLIK OBOK `EventTypesManager.test.tsx`. Tamten dowodzi SKLEJENIA:
// co idzie do mutacji, co sie dzieje z odpowiedzia i co widzi administrator po
// odmowie bazy (w tym po odmowie duplikatu klucza - `event_types_key_key`).
// Przez dialog przechodzi tam JEDNA sciezka: nazwa polska, nazwa angielska
// i przycisk zapisu. Pozostale SZESNASCIE pol nie bylo dotknietych ani razu,
// a kazde z nich zapisuje sie do INNEJ kolumny `event_types` - wiec pomylka
// „pole angielskie pisze do klucza polskiego" wyglada tu dokladnie tak samo jak
// poprawny formularz i nie ma jej jak zobaczyc na ekranie.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. WERSJA ROBOCZA DOSTAJE ZLE POLE. Osiemnascie handlerow `onValueChange`
//      rozni sie jednym kluczem obiektu; podmienione miejscami zapisuja opis
//      angielski do polskiego, a czas trwania do limitu miejsc. Baza przyjmie
//      obie wartosci - to poprawne liczby w poprawnych kolumnach, tylko nie tych.
//   2. ZAPIS RUSZA, ZANIM WERSJA ROBOCZA JEST GOTOWA. `eventTypeDraftIssue()`
//      ma ODCIAC przycisk przed zadaniem, bo odmowa CHECK-a wraca jako `23514`
//      bez wskazania pola - administrator dostaje wtedy „blad zapisu" i nie wie,
//      ktora z osiemnastu wartosci jest zla.
//   3. KLUCZ PRZESTAJE BYC ZAMROZONY. Klucz zmieniony po zapisie osierociłby
//      wydarzenia czytajace legacy `events.kind` - dlatego pole jest w trybie
//      edycji wylaczone. Dwa testy nizej pokazuja, ze samo wylaczenie pola tego
//      NIE ZALATWIA (patrz „defekty zarejestrowane").
//   4. WYCZYSZCZONY SELEKTOR IKONY ZOSTAWIA PUSTKE. Pusty `icon` rysuje sie jako
//      znak zapytania do momentu zapisu - dlatego czysta wartosc ma wracac do
//      ikony domyslnej, a nie do pustego napisu.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Tabel regul katalogu (`eventTypeDraftIssue`,
// `eventTypeDraftWithNamePl`, `slugifyEventTypeKey`, `eventTypeUpsertPayload`) -
// sa w `lib/events/__tests__/adminEventTypeCatalog.test.ts`; tutaj dowodzimy, ze
// dialog ich UZYWA i ze skutek widac na ekranie. (2) Mutacji, toastow i odmowy
// duplikatu z bazy - to `EventTypesManager.test.tsx`, bo dialog o nich nie wie:
// oddaje JEDNA intencje zapisu i nic poza tym. (3) Wnetrza selektora ikon
// (`LucideIconPicker`) - ciagnie caly katalog Lucide i ma wlasny plik.
//
// Radix Dialog i Radix Select nie dzialaja pod happy-dom bez pelnego API
// wskaznika - oba stoja tu jako natywne odpowiedniki o tym samym kontrakcie,
// dokladnie jak w `EventTypesManager.test.tsx`.
//
// RODO: rodzaje wydarzen to slownik redakcyjny, nie dane osobowe; nazwy sa
// mimo to syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";

import {
  EMPTY_EVENT_TYPE_DRAFT,
  EVENT_TYPE_DEFAULT_ICON,
  type EventTypeDraft,
} from "@/lib/events/adminEventTypeCatalog";

const h = vi.hoisted(() => ({
  /** Kolejne wersje robocze oddane przez `onDraftChange`. */
  zmiany: [] as EventTypeDraft[],
  /** Wersje robocze oddane przez `onSave` - to jest INTENCJA zapisu. */
  zapisy: [] as EventTypeDraft[],
  zamkniecia: 0,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

// Selektor ikony ciagnie caly katalog Lucide - tutaj liczy sie WYLACZNIE to,
// co dialog robi z oddana wartoscia (i z jej brakiem).
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (name: string | undefined) => void;
  }) => (
    <input
      id="event-type-icon"
      aria-label="selektor-ikony"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
    />
  ),
}));

// Atrapa Radiksa: `Root` renderuje dzieci zawsze, `Content` istnieje wylacznie
// przy otwartym dialogu (portal nie jest montowany). Przycisk „zamknij-dialog"
// odtwarza sciezke UZYTKOWNIKA (Escape, klik w tlo, krzyzyk) - czyli jedyna,
// ktora wola `onOpenChange`.
vi.mock("@/components/ui/dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    Dialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children: ReactNode }) =>
      open ? (
        <div role="dialog">
          {children}
          <button type="button" onClick={() => setOpen?.(false)}>
            zamknij-dialog
          </button>
        </div>
      ) : null,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

// Radix Select nie renderuje opcji bez API wskaznika - droplista jest natywna,
// a wartosc jedzie ta sama droga.
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

const { EventTypeDialog } = await import("@/components/admin/events/organisms/EventTypeDialog");

const D = "adminEvents.types.dialog.";

/** Nowy wpis katalogu - `id === null` jest jedyna roznica, ktora widzi dialog. */
function nowyRodzaj(overrides: Partial<EventTypeDraft> = {}): EventTypeDraft {
  return { ...EMPTY_EVENT_TYPE_DRAFT, ...overrides };
}

/** Wpis ISTNIEJACY - klucz jest juz w bazie i czytaja go stare wydarzenia. */
function istniejacyRodzaj(overrides: Partial<EventTypeDraft> = {}): EventTypeDraft {
  return {
    ...EMPTY_EVENT_TYPE_DRAFT,
    id: "3f1a0c8e-0000-4000-8000-000000000101",
    key: "sniadanie_prasowe",
    namePl: "Sniadanie prasowe",
    nameEn: "Press breakfast",
    ...overrides,
  };
}

/**
 * Otoczka trzymajaca wersje robocza.
 *
 * Dialog jest STEROWANY - sam nie pamieta ani jednego pola poza tym, czy klucz
 * byl tkniety. Bez otoczki, ktora oddaje zmiany z powrotem, kazdy test badalby
 * pojedyncze klikniecie w prozni, a nie sekwencje, w ktorej mieszkaja reguly
 * tego ekranu (klucz podazajacy za nazwa, walidacja gasnaca po poprawce).
 */
function Otoczka({
  start,
  isSaving = false,
}: {
  start: EventTypeDraft | null;
  isSaving?: boolean;
}) {
  const [draft, setDraft] = useState<EventTypeDraft | null>(start);
  return (
    <div>
      {/* Manager otwiera dialog, podajac NOWA wersje robocza - stad ten przycisk:
          bez niego nie da sie dowiesc, co dialog pamieta MIEDZY otwarciami. */}
      <button type="button" onClick={() => setDraft(nowyRodzaj())}>
        otworz-nowy
      </button>
      <EventTypeDialog
        draft={draft}
        isSaving={isSaving}
        onDraftChange={(next) => {
          h.zmiany.push(next);
          setDraft(next);
        }}
        onClose={() => {
          h.zamkniecia += 1;
          setDraft(null);
        }}
        onSave={(next) => h.zapisy.push(next)}
      />
    </div>
  );
}

function otworz(start: EventTypeDraft | null, isSaving = false) {
  return render(<Otoczka start={start} isSaving={isSaving} />);
}

function polePisania(id: string): HTMLInputElement | HTMLTextAreaElement {
  const node = document.getElementById(id);
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node;
  throw new Error(`brak pola tekstowego „${id}”`);
}

function droplista(id: string): HTMLSelectElement {
  const node = document.getElementById(id);
  if (node instanceof HTMLSelectElement) return node;
  throw new Error(`brak droplisty „${id}”`);
}

function przelacznik(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node instanceof HTMLElement) return node;
  throw new Error(`brak przelacznika „${id}”`);
}

function wpisz(id: string, value: string): void {
  fireEvent.change(polePisania(id), { target: { value } });
}

function wybierz(id: string, value: string): void {
  fireEvent.change(droplista(id), { target: { value } });
}

/** Ostatnia wersja robocza oddana przez dialog. */
function szkic(): EventTypeDraft {
  const last = h.zmiany.at(-1);
  if (last === undefined) throw new Error("dialog nie oddal ani jednej wersji roboczej");
  return last;
}

function przyciskZapisu(): HTMLElement {
  return screen.getByRole("button", { name: `${D}saveAction` });
}

beforeEach(() => {
  h.zmiany = [];
  h.zapisy = [];
  h.zamkniecia = 0;
});

afterEach(cleanup);

describe("tryb tworzenia kontra tryb edycji", () => {
  // DWA TYTULY, BO TO DWIE ROZNE OPERACJE. „Zapisz" nad formularzem, ktory
  // w rzeczywistosci zaklada nowy wpis, konczy sie drugim rodzajem o tej samej
  // nazwie - a rodzaju uzywanego przez wydarzenia nie da sie juz usunac.
  it("nowy wpis ma tytul tworzenia, istniejacy - tytul edycji", () => {
    otworz(nowyRodzaj());
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeTruthy();

    cleanup();
    otworz(istniejacyRodzaj());
    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeTruthy();
  });

  // KLUCZ ISTNIEJACEGO WPISU JEST ZAMROZONY. Legacy `events.kind` czyta wlasnie
  // ten napis, wiec klucz zmieniony po zapisie osieroca kazde wydarzenie, ktore
  // go uzywa. Przy tworzeniu klucz musi byc EDYTOWALNY - inaczej administrator
  // nie ma jak rozroznic dwoch rodzajow o podobnej nazwie, zanim baza odmowi
  // duplikatu (`event_types_key_key`).
  it("pole klucza jest wylaczone przy edycji i czynne przy tworzeniu", () => {
    otworz(istniejacyRodzaj());
    expect(polePisania("event-type-key")).toBeDisabled();

    cleanup();
    otworz(nowyRodzaj());
    expect(polePisania("event-type-key")).not.toBeDisabled();
  });

  // ZAMKNIETY DIALOG NIE RENDERUJE FORMULARZA. Pola zyjace poza otwarciem
  // trzymalyby wartosci poprzedniej sesji edycji - i przy nastepnym otwarciu
  // administrator zobaczylby cudzy wpis.
  it("zamkniety dialog nie ma ani jednego pola", () => {
    otworz(null);
    expect(screen.queryByLabelText(`${D}namePlLabel`)).toBeNull();
    expect(document.getElementById("event-type-key")).toBeNull();
  });
});

describe("klucz techniczny podaza za nazwa polska", () => {
  // DIAKRYTYKI SA ROZKLADANE, a nie wycinane: klucz z „Śniadanie" ma brzmiec
  // `sniadanie`, a nie `niadanie`. Klucz jest identyfikatorem w bazie i w legacy
  // `events.kind`, wiec literowka w nim zostaje na zawsze.
  it("nazwa polska ustawia klucz, dopoki nikt go nie tknal", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-name-pl", "Śniadanie prasowe");

    expect(szkic().namePl).toBe("Śniadanie prasowe");
    expect(szkic().key).toBe("sniadanie_prasowe");
  });

  // RECZNA POPRAWKA KLUCZA MA PRZEZYC DOPISANA LITERE NAZWY. Klucz podazajacy
  // bez konca kasowalby poprawke przy kazdym nacisnieciu klawisza - i wtedy nie
  // da sie zalozyc rodzaju o kluczu innym niz slug nazwy.
  it("po tknieciu pola klucza nazwa polska juz go nie nadpisuje", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-name-pl", "Debata ekspercka");
    expect(szkic().key).toBe("debata_ekspercka");

    wpisz("event-type-key", "debata_zamknieta");
    wpisz("event-type-name-pl", "Debata ekspercka wieczorna");

    expect(szkic().namePl).toBe("Debata ekspercka wieczorna");
    expect(szkic().key).toBe("debata_zamknieta");
  });

  // ZAMKNIECIE UZYTKOWNIKA (Escape, klik w tlo) ODDAJE DIALOG W STANIE
  // POCZATKOWYM. Nastepne otwarcie to NOWA praca, a nie ciag poprzedniej -
  // klucz zamrozony pamiecia poprzedniej sesji zostawilby nowy wpis bez klucza.
  it("po zamknieciu przez uzytkownika klucz znowu podaza za nazwa", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-key", "recznie_wpisany");
    fireEvent.click(screen.getByText("zamknij-dialog"));
    expect(h.zamkniecia).toBe(1);

    fireEvent.click(screen.getByText("otworz-nowy"));
    wpisz("event-type-name-pl", "Panel otwarty");

    expect(szkic().key).toBe("panel_otwarty");
  });
});

describe("osiemnascie pol pisze do osiemnastu roznych miejsc", () => {
  // POLE ANGIELSKIE PISZACE DO KLUCZA POLSKIEGO WYGLADA JAK POPRAWNE. Jedyny
  // moment, w ktorym to widac, to porownanie obu jezykow naraz.
  it("nazwy i opisy nie mieszaja jezykow", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-name-pl", "Kolacja branzowa");
    wpisz("event-type-name-en", "Industry dinner");
    wpisz("event-type-description-pl", "Spotkanie zamkniete przy stole.");
    wpisz("event-type-description-en", "Closed table meeting.");

    expect(szkic().namePl).toBe("Kolacja branzowa");
    expect(szkic().nameEn).toBe("Industry dinner");
    expect(szkic().descriptionPl).toBe("Spotkanie zamkniete przy stole.");
    expect(szkic().descriptionEn).toBe("Closed table meeting.");
  });

  // CZTERY DOMYSLNE USTAWIENIA NOWEGO WYDARZENIA. Kazde odpowiada na inne
  // pytanie (gdzie sie odbywa, jak sie zapisac, kiedy potwierdzamy, co widzi
  // gosc), wiec zamiana ich miejscami zaklada wydarzenia z cudzymi regulami.
  it("cztery droplisty ustawien domyslnych jada kazda do swojej kolumny", () => {
    otworz(nowyRodzaj());

    wybierz("event-type-format", "online");
    wybierz("event-type-registration-mode", "external");
    wybierz("event-type-registration-flow", "approval");
    wybierz("event-type-guest-mode", "hidden");

    expect(szkic().defaultFormat).toBe("online");
    expect(szkic().defaultRegistrationMode).toBe("external");
    expect(szkic().defaultRegistrationFlow).toBe("approval");
    expect(szkic().defaultGuestMode).toBe("hidden");
  });

  // TRZY PRZELACZNIKI. „Zasada Chatham House" i „wymaga biletu" zmieniaja to,
  // co wolno opublikowac i czy w ogole da sie wejsc; „dostepny" decyduje, czy
  // rodzaj widac przy zakladaniu wydarzenia.
  it("trzy przelaczniki oddaja NOWY stan, a nie stan sprzed klikniecia", () => {
    otworz(nowyRodzaj());

    fireEvent.click(przelacznik("event-type-chatham"));
    expect(szkic().defaultChathamHouse).toBe(true);

    fireEvent.click(przelacznik("event-type-ticket"));
    expect(szkic().requiresTicket).toBe(true);

    fireEvent.click(przelacznik("event-type-active"));
    expect(szkic().isActive).toBe(false);
  });

  // KOLEJNOSC W KATALOGU I PROG RANGI SA LICZBAMI, a pole tekstowe oddaje napis.
  // Napis niepoliczalny ma znaczyc ZERO, a nie `NaN` - `NaN` w kolumnie
  // `smallint` konczy sie odmowa bazy bez wskazania pola.
  it("kolejnosc i prog rangi wchodza jako liczby, a smiec jako zero", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-sort-order", "140");
    expect(szkic().sortOrder).toBe(140);

    wpisz("event-type-tier-rank", "3");
    expect(szkic().defaultMinTierRank).toBe(3);

    wpisz("event-type-tier-rank", "");
    expect(szkic().defaultMinTierRank).toBe(0);
  });

  // LIMIT MIEJSC I CZAS TRWANIA ZOSTAJA NAPISAMI w wersji roboczej, bo PUSTY
  // napis znaczy „bez limitu", a `0` znaczy „zero miejsc" - i to sa dwie rozne
  // rzeczy, ktorych pole liczbowe nie rozroznia inaczej.
  it("pusty limit i pusty czas trwania zostaja pustka, a nie zerem", () => {
    otworz(nowyRodzaj({ defaultCapacity: "120", defaultDurationMinutes: "90" }));

    wpisz("event-type-capacity", "");
    wpisz("event-type-duration", "");

    expect(szkic().defaultCapacity).toBe("");
    expect(szkic().defaultDurationMinutes).toBe("");
  });

  // WYCZYSZCZONY SELEKTOR WRACA DO IKONY DOMYSLNEJ. Pusty `icon` rysowalby sie
  // jako znak zapytania do momentu zapisu - czyli to, co administrator widzi,
  // przestaloby byc tym, co sie zapisze.
  it("wyczyszczenie ikony wraca do domyslnej, a nie do pustki", () => {
    otworz(nowyRodzaj({ icon: "Mic" }));

    fireEvent.change(screen.getByLabelText("selektor-ikony"), { target: { value: "" } });

    expect(szkic().icon).toBe(EVENT_TYPE_DEFAULT_ICON);
    expect(szkic().icon).not.toBe("");
  });
});

describe("walidacja odcina zapis PRZED zadaniem", () => {
  // ODMOWA CHECK-A WRACA JAKO `23514` BEZ WSKAZANIA POLA. Dlatego przycisk ma
  // zgasnac, a powod stanac pod formularzem - inaczej administrator dostaje
  // „blad zapisu" i sprawdza osiemnascie pol metoda prob.
  it("nazwa tylko w jednym jezyku gasi zapis i nazywa powod", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-name-pl", "Kolacja branzowa");

    expect(screen.getByRole("alert").textContent).toBe("adminEvents.types.errors.names");
    expect(przyciskZapisu()).toBeDisabled();

    fireEvent.click(przyciskZapisu());
    expect(h.zapisy).toHaveLength(0);
  });

  // OBIE NAZWY WYPELNIONE - powod znika, a przycisk oddaje JEDNA intencje
  // zapisu. Bez tego kontrapunktu asercja wyzej przechodzilaby takze wtedy,
  // gdyby zapis byl odciety zawsze.
  it("obie nazwy wypelnione oddaja wersje robocza do zapisu", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-name-pl", "Kolacja branzowa");
    wpisz("event-type-name-en", "Industry dinner");

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(przyciskZapisu());

    expect(h.zapisy).toHaveLength(1);
    expect(h.zapisy[0].namePl).toBe("Kolacja branzowa");
    expect(h.zapisy[0].nameEn).toBe("Industry dinner");
    // Klucz jedzie razem z nazwami - to on trafia na unikalny indeks
    // `event_types_key_key` i to jego administrator widzi PRZED odmowa.
    expect(h.zapisy[0].key).toBe("kolacja_branzowa");
  });

  // ZERO MIEJSC TO NIE JEST „BEZ LIMITU". Kolumna ma CHECK
  // `default_capacity IS NULL OR default_capacity > 0`, wiec zero wraca odmowa
  // bez nazwy pola - a rodzaj z zerem miejsc zakladalby wydarzenia zamkniete.
  it("zerowy limit miejsc gasi zapis", () => {
    otworz(nowyRodzaj({ namePl: "Kolacja", nameEn: "Dinner", key: "kolacja" }));

    wpisz("event-type-capacity", "0");

    expect(screen.getByRole("alert").textContent).toBe("adminEvents.types.errors.capacity");
    expect(przyciskZapisu()).toBeDisabled();
  });

  // CZAS TRWANIA MA ZAKRES Z CHECK-A `event_types_duration_range`. Minuta jest
  // pod dolna granica, wiec przechodzi tylko wtedy, gdy dialog nie pyta domeny.
  it("czas trwania spoza zakresu gasi zapis", () => {
    otworz(nowyRodzaj({ namePl: "Kolacja", nameEn: "Dinner", key: "kolacja" }));

    wpisz("event-type-duration", "1");

    expect(screen.getByRole("alert").textContent).toBe("adminEvents.types.errors.duration");
    expect(przyciskZapisu()).toBeDisabled();
  });

  // UJEMNA RANGA NIE MA ZNACZENIA W MODELU DOSTEPU - progu nizszego niz gosc
  // nie ma. Wartosc ujemna przepuszczona do bazy otwieralaby rodzaj szerzej,
  // niz zaklada najnizszy prog.
  it("ujemny prog rangi gasi zapis", () => {
    otworz(nowyRodzaj({ namePl: "Kolacja", nameEn: "Dinner", key: "kolacja" }));

    wpisz("event-type-tier-rank", "-1");

    expect(screen.getByRole("alert").textContent).toBe("adminEvents.types.errors.tierRank");
    expect(przyciskZapisu()).toBeDisabled();
  });

  // AKCENT JEDZIE DO CSS JAKO ZMIENNA, wiec CHECK bazy dopuszcza wylacznie
  // literal heksadecymalny. Nazwa koloru wpisana z reki wyladowalaby
  // w `style` jako wartosc, ktorej przegladarka nie narysuje.
  it("kolor akcentu spoza formatu heksadecymalnego gasi zapis, a poprawny go wraca", () => {
    otworz(nowyRodzaj({ namePl: "Kolacja", nameEn: "Dinner", key: "kolacja" }));

    wpisz("event-type-accent", "niebieski");
    expect(screen.getByRole("alert").textContent).toBe("adminEvents.types.errors.accentColor");
    expect(przyciskZapisu()).toBeDisabled();

    wpisz("event-type-accent", "#1D4ED8");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(przyciskZapisu()).not.toBeDisabled();
  });

  // ZAPIS W TOKU ODCINA PRZYCISK. Drugie klikniecie w trakcie zadania zaklada
  // drugi wpis o tym samym kluczu - a wtedy baza odmawia duplikatu i pierwszy
  // zapis wyglada na nieudany.
  it("zapis w toku odcina przycisk, mimo poprawnej wersji roboczej", () => {
    otworz(istniejacyRodzaj(), true);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(przyciskZapisu()).toBeDisabled();

    fireEvent.click(przyciskZapisu());
    expect(h.zapisy).toHaveLength(0);
  });

  // ANULOWANIE NIE JEST ZAPISEM. Przycisk obok „Zapisz" musi zamknac dialog
  // i NIE oddac wersji roboczej - inaczej rezygnacja zapisuje to, z czego
  // administrator wlasnie zrezygnowal.
  it("anulowanie zamyka dialog i nie oddaje niczego do zapisu", () => {
    otworz(istniejacyRodzaj());

    fireEvent.click(screen.getByRole("button", { name: `${D}cancelAction` }));

    expect(h.zamkniecia).toBe(1);
    expect(h.zapisy).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("defekty zarejestrowane", () => {
  // DEFEKT 1: PRZEMIANOWANIE ISTNIEJACEGO RODZAJU PRZESTAWIA JEGO KLUCZ.
  //
  // Naglowek pliku produkcyjnego mowi: „KLUCZ JEST ZAMROZONY PRZY EDYCJI […]
  // Zmieniony po zapisie osierociłby wydarzenia czytające legacy `events.kind`".
  // Zamrozone jest jednak WYLACZNIE POLE (`disabled={draft.id !== null}`),
  // a nie WARTOSC: pole nazwy polskiej wola
  // `eventTypeDraftWithNamePl(draft, value, keyTouched)`, a `keyTouched`
  // w trybie edycji nie ma jak stac sie prawda - pole klucza jest wylaczone,
  // wiec nie oddaje zdarzenia zmiany. Wersja robocza dostaje wiec nowy klucz
  // ze slugu nowej nazwy, a `eventTypeSaveKey` dla wpisu istniejacego oddaje
  // WPROST `draft.key`, czyli juz podmieniony. Skutek: poprawienie literowki
  // w nazwie rodzaju przepina jego klucz techniczny.
  //
  // NAPRAWA (nie robimy jej tutaj): handler nazwy polskiej ma podazac za nazwa
  // tylko dla wpisu nowego - `eventTypeDraftWithNamePl(draft, value, keyTouched
  // || draft.id !== null)` albo zwykle `{ ...draft, namePl: value }` przy
  // `draft.id !== null`.
  it("defekt: zmiana nazwy polskiej w trybie EDYCJI podmienia zamrozony klucz", () => {
    otworz(istniejacyRodzaj({ key: "sniadanie_prasowe", namePl: "Sniadanie prasowe" }));

    wpisz("event-type-name-pl", "Sniadanie prasowe (poranne)");

    // Klucz ma zostac ten sam - czytaja go wydarzenia zalozone wczesniej.
    expect(szkic().key).toBe("sniadanie_prasowe");
  });

  // DEFEKT 2: „ANULUJ" NIE ODMRAZA KLUCZA NA NASTEPNE OTWARCIE.
  //
  // `setKeyTouched(false)` siedzi WYLACZNIE w `onOpenChange`, czyli na sciezce
  // zamkniecia UZYTKOWNIKA (Escape, klik w tlo, krzyzyk). Przycisk „Anuluj"
  // w stopce wola samo `onClose`, a manager odpowiada na to `setDraft(null)` -
  // czyli zamyka dialog PROGRAMOWO, a wtedy Radix `onOpenChange` sie nie
  // odzywa. Komponent zostaje zamontowany z `keyTouched === true`, wiec przy
  // NASTEPNYM zalozeniu rodzaju klucz przestaje podazac za nazwa: administrator
  // wpisuje nazwe, pole klucza zostaje puste, a zapis gasnie na
  // `adminEvents.types.errors.key` bez slowa o przyczynie.
  //
  // NAPRAWA (nie robimy jej tutaj): stopka ma wolac te sama sciezke, co
  // zamkniecie uzytkownika (`setKeyTouched(false); onClose();`), albo
  // `keyTouched` ma sie zerowac przy KAZDYM otwarciu (efekt na `draft?.id`).
  it("defekt: „Anuluj” zostawia klucz zamrozony na nastepne otwarcie dialogu", () => {
    otworz(nowyRodzaj());

    wpisz("event-type-key", "recznie_wpisany");
    fireEvent.click(screen.getByRole("button", { name: `${D}cancelAction` }));

    fireEvent.click(screen.getByText("otworz-nowy"));
    wpisz("event-type-name-pl", "Panel otwarty");

    // Nowe otwarcie to nowa praca - klucz ma znowu podazac za nazwa.
    expect(szkic().key).toBe("panel_otwarty");
  });
});
