// Organizm „Nowe wydarzenie" - SKLEJENIE czterech pól, reguły gotowości
// i podglądu dziedziczenia rodzaju.
//
// CO TEN PLIK DOWODZI.
//   1. NIEKOMPLETNY FORMULARZ NIE DOTYKA WARSTWY ZAPISU. Asercja idzie na
//      atrapie `onSubmit`, nie na czerwonym zdaniu: „komunikat się pokazał"
//      i „nic nie poszło do bazy" to dwa różne fakty, a tylko drugi chroni
//      katalog wydarzeń przed wierszem bez tytułu albo bez terminu.
//   2. ODMOWA POKAZUJE SIĘ PO PRÓBIE, nie od pierwszej sekundy. Zdanie „Wybierz
//      rodzaj" nad pustym jeszcze formularzem czyta się jak awaria ekranu.
//   3. RODZAJ MA WARTOŚĆ OD WEJŚCIA i PRZEPISUJE FORMAT. Kreator, który
//      startuje z pustą droplistą rodzaju, blokuje zapis polem, którego nikt
//      nie prosił o wypełnienie.
//   4. BRAK AKTYWNEGO RODZAJU BLOKUJE FORMULARZ Z INSTRUKCJĄ, a nie pustą
//      droplistą - pusta droplista wygląda na awarię.
//   5. STREFA CZASOWA JEST KOMPLETNA. Pełny katalog `Intl` NIE ZAWIERA `UTC`
//      ani nowoczesnej nazwy Kijowa, więc droplista biorąca sam katalog nie
//      pozwoliłaby założyć wydarzenia w strefie, w której organizacja pracuje.
//      To ta sama lista, co w „Informacjach ogólnych" - i o to chodzi: kreator
//      nie może oferować strefy, której panel edycji już nie zna.
//   6. MIEJSCE ZNIKA dla wydarzeń wyłącznie online - tak samo jak w bazie,
//      która zeruje wtedy miasto i kraj. Pole z góry unieważnionym zapisem
//      jest kontrolką kłamiącą o skutku.
//   7. TRWAJĄCY ZAPIS BLOKUJE PRZYCISK - podwójne kliknięcie zakłada JEDNO
//      wydarzenie, nie dwa.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabeli reguły gotowości (`eventCreateIssue`:
// kolejność sprawdzeń, wzorzec adresu zewnętrznego, zbiór formatów) - stoi
// w `eventCreateIssue.test.ts` i jest wołana na czystej funkcji. Tutaj
// sprawdzamy WYŁĄCZNIE sklejenie: że formularz tej reguły używa, że zatrzymuje
// zapis i że komunikat trafia na ekran we właściwym momencie. Nie dubluję też
// katalogu stref (`timeZoneOptions.test.ts`) ani molekuł `AdminForm*`.
//
// GDZIE KOŃCZY SIĘ TEN ORGANIZM. Obcięcie białych znaków i zamiana pustego
// pola na `null` należą do TRASY `/admin/events/new`, która buduje ładunek RPC
// z tego szkicu - formularz oddaje szkic tak, jak go zebrał, i asercje
// pilnują właśnie tego, żeby po drodze nic nie ginęło ani nie było „poprawiane"
// dwa razy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EventTypeOption } from "@/lib/events/eventTypes";
import type { EventCreateDraft } from "@/components/admin/events/organisms/EventCreateForm";

const h = vi.hoisted(() => ({
  /** Język interfejsu panelu - sterowany z testu, jak realna instancja i18n. */
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

// Droplisty stoją na Radix Select (przez `FormSelect`), a ten pod happy-dom nie
// otwiera listy bez pełnego API wskaźnika. Atrapa jest natywna i ETYKIETOWANA,
// bo przedmiotem dowodu jest to, KTÓRE wartości kreator oferuje i która z nich
// dojedzie do szkicu - nie to, jak wygląda popup.
vi.mock("@/components/atoms/FormSelect", () => {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder ?? ""}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
  return { FormSelect, default: FormSelect };
});

// Kalendarz jest popoverem Radiksa - atrapa zostawia z niego KONTRAKT: napis
// z chwilą w środku i pusty napis jako „nie podano".
vi.mock("@/components/ui/datetime-picker", () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    value: string | null;
    onChange: (iso: string | null) => void;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  ),
}));

const { EventCreateForm } = await import("@/components/admin/events/organisms/EventCreateForm");

const C = "adminEvents.list.create.";

/**
 * Rodzaj z `event_types_active`.
 *
 * `default_capacity` JEST w bazie nullowalny (`default_capacity integer`,
 * CHECK `event_types_capacity_positive` dopuszcza NULL wprost), ale generator
 * typów oddaje kolumny `RETURNS TABLE` jako nie-NULL. To samo zawężenie stoi
 * już przy wierszu administracyjnym (`EventTypeAdminRow` w `lib/events/eventTypes.ts`),
 * a wiersz PUBLICZNY - ten, którego używa kreator - go NIE MA. Dlatego brak
 * pojemności podajemy przez typ zawężony i JEDNO udokumentowane rzutowanie:
 * inaczej gałąź „bez limitu miejsc" w podglądzie dziedziczenia byłaby
 * nietestowalna, mimo że redaktor ją widzi.
 */
type RodzajOpcja = Omit<EventTypeOption, "default_capacity"> & {
  default_capacity: number | null;
};

function rodzaj(overrides: Partial<RodzajOpcja> = {}): EventTypeOption {
  const row: RodzajOpcja = {
    accent_color: "#D73953",
    default_capacity: 60,
    default_chatham_house: false,
    default_duration_minutes: 120,
    default_format: "onsite",
    default_guest_mode: "full",
    default_min_tier_rank: 0,
    default_registration_flow: "instant",
    default_registration_mode: "rsvp",
    description_en: "",
    description_pl: "",
    icon: "users",
    id: "type-okragly-stol",
    key: "roundtable",
    name_en: "Roundtable",
    name_pl: "Okrągły stół",
    requires_ticket: false,
    sort_order: 10,
    ...overrides,
  };
  return row as EventTypeOption;
}

const ONLINE_EXTERNAL = rodzaj({
  id: "type-webinar",
  key: "webinar",
  name_pl: "Webinar",
  name_en: "Webinar",
  default_format: "online",
  default_registration_mode: "external",
  default_capacity: null,
});

const onSubmit = vi.fn<(draft: EventCreateDraft) => void>();
const onCancel = vi.fn();
const onDraftChange = vi.fn<(draft: EventCreateDraft) => void>();

function formularz(options: { types?: readonly EventTypeOption[]; isSaving?: boolean } = {}) {
  return render(
    <EventCreateForm
      types={options.types ?? [rodzaj()]}
      isSaving={options.isSaving ?? false}
      onCancel={onCancel}
      onSubmit={onSubmit}
      onDraftChange={onDraftChange}
    />,
  );
}

/** Pole formularza po kluczu etykiety - dokładnie tak, jak znajduje je czytnik. */
function pole(labelKey: string): HTMLInputElement | HTMLTextAreaElement {
  const found = screen.getByLabelText(`${C}${labelKey}`);
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLTextAreaElement)) {
    throw new Error(`test: ${labelKey} nie jest polem tekstowym`);
  }
  return found;
}

function wpisz(labelKey: string, value: string): void {
  fireEvent.change(pole(labelKey), { target: { value } });
}

function droplista(labelKey: string): HTMLSelectElement {
  const found = screen.getByLabelText(`${C}${labelKey}`);
  if (!(found instanceof HTMLSelectElement))
    throw new Error(`test: ${labelKey} nie jest droplistą`);
  return found;
}

function przyciskUtworz(): HTMLButtonElement {
  const found = screen.getByRole("button", { name: `${C}submitAction` });
  if (!(found instanceof HTMLButtonElement)) throw new Error("test: zapis nie jest przyciskiem");
  return found;
}

function utworz(): void {
  fireEvent.click(przyciskUtworz());
}

/** Widoczne powody odrzucenia - klucze, nie napisy. */
function komunikaty(): string[] {
  return screen.queryAllByRole("alert").map((node) => node.textContent ?? "");
}

/** Kompletna wersja robocza wpisana ręcznie, tak jak robi to redaktor. */
function wypelnijMinimum(): void {
  wpisz("titlePlLabel", "Śniadanie eksperckie");
  wpisz("titleEnLabel", "Expert breakfast");
  wpisz("startsAtLabel", "2026-09-01T09:00");
}

function ostatniSzkic(): EventCreateDraft {
  const last = onSubmit.mock.calls.at(-1);
  if (last === undefined) throw new Error("test: warstwa zapisu nie dostała nic");
  return last[0];
}

beforeEach(() => {
  cleanup();
  h.lang = "pl";
  onSubmit.mockReset();
  onCancel.mockReset();
  onDraftChange.mockReset();
});

describe("EventCreateForm - katalog rodzajów", () => {
  it("BRAK aktywnego rodzaju mówi, co zrobić, zamiast pokazywać pustą droplistę", () => {
    formularz({ types: [] });

    expect(screen.getByText(`${C}errors.noTypes`)).toBeTruthy();
    expect(screen.queryByLabelText(`${C}titlePlLabel`)).toBeNull();
    expect(przyciskUtworz().disabled).toBe(true);
  });

  it("z pustego katalogu nadal da się WYJŚĆ - anulowanie działa", () => {
    // Ekran bez jednego czynnego przycisku jest ślepą uliczką: redaktor zostaje
    // z adresem, z którego wychodzi się wyłącznie przyciskiem przeglądarki.
    formularz({ types: [] });
    fireEvent.click(screen.getByRole("button", { name: `${C}cancelAction` }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("PIERWSZY rodzaj jest wybrany od wejścia i przepisuje SWÓJ format", () => {
    formularz();
    expect(droplista("typeLabel").value).toBe("type-okragly-stol");
    expect(droplista("formatLabel").value).toBe("onsite");
  });

  it("zmiana rodzaju PRZEPISUJE format nowego rodzaju, zamiast zostawiać stary", () => {
    // Format jest dalej edytowalny, ale redaktor ma widzieć wprost wartość,
    // którą dostanie wydarzenie - a nie tę z poprzedniego wyboru.
    formularz({ types: [rodzaj(), ONLINE_EXTERNAL] });
    fireEvent.change(droplista("typeLabel"), { target: { value: "type-webinar" } });
    expect(droplista("formatLabel").value).toBe("online");
  });

  it("rodzaj BEZ nazwy w języku interfejsu pokazuje klucz techniczny, a nie pustkę", () => {
    // Wiersz bez nazwy nie może zniknąć z droplisty - byłby rodzajem, którego
    // nie da się wybrać, choć jest aktywny.
    formularz({ types: [rodzaj({ name_pl: "", name_en: "" })] });
    const opcje = Array.from(droplista("typeLabel").options).map((option) => option.textContent);
    expect(opcje).toContain("roundtable");
  });

  it("po angielsku droplista rodzajów pokazuje nazwy ANGIELSKIE", () => {
    h.lang = "en";
    formularz({ types: [rodzaj()] });
    const opcje = Array.from(droplista("typeLabel").options).map((option) => option.textContent);
    expect(opcje).toContain("Roundtable");
    expect(opcje).not.toContain("Okrągły stół");
  });
});

describe("EventCreateForm - podgląd dziedziczenia", () => {
  it("po wybraniu rodzaju widać PIĘĆ wartości, które przepisze serwer", () => {
    // Bez tego „resztę ustawień przepisze rodzaj" jest obietnicą bez pokrycia,
    // a pierwsze zaskoczenie (wydarzenie tylko dla członków, choć nikt tego nie
    // zaznaczał) kończy zaufanie do wartości domyślnych.
    formularz();

    expect(screen.getByText(`${C}groups.inherited`)).toBeTruthy();
    expect(screen.getByText("adminEvents.registrationModes.rsvp")).toBeTruthy();
    expect(screen.getByText("adminEvents.registrationFlows.instant")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
  });

  it("rodzaj BEZ limitu miejsc mówi „bez limitu”, a nie pokazuje pustego wiersza", () => {
    formularz({ types: [ONLINE_EXTERNAL] });
    expect(screen.getByText("adminEvents.list.row.noCapacity")).toBeTruthy();
  });
});

describe("EventCreateForm - gotowość wersji roboczej", () => {
  it("KOMUNIKAT MILCZY do pierwszej próby zapisu", () => {
    formularz();
    expect(komunikaty()).toHaveLength(0);
  });

  it("pusty formularz NIE dociera do warstwy zapisu i nazywa pierwszy brak", () => {
    formularz();
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.titles`);
  });

  it("sam tytuł POLSKI nie wystarczy - wersja angielska jest osobnym polem", () => {
    formularz();
    wpisz("titlePlLabel", "Śniadanie eksperckie");
    wpisz("startsAtLabel", "2026-09-01T09:00");
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.titles`);
  });

  it("BRAK terminu nie dociera do warstwy zapisu", () => {
    // CHECK bazy tego nie pilnuje (`starts_at` ma wartość domyślną), więc to
    // jest jedyne miejsce, które chroni kalendarz przed wydarzeniem bez daty.
    formularz();
    wpisz("titlePlLabel", "Śniadanie eksperckie");
    wpisz("titleEnLabel", "Expert breakfast");
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.startsAt`);
  });

  it("koniec PRZED początkiem nie dociera do warstwy zapisu", () => {
    formularz();
    wypelnijMinimum();
    wpisz("endsAtLabel", "2026-09-01T08:00");
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.endsAt`);
  });

  it("rodzaj z zapisami ZEWNĘTRZNYMI żąda adresu i nie puszcza bez niego", () => {
    // Warunek `events_external_mode_requires_url` odrzuciłby taki wiersz
    // w bazie - formularz pyta o adres ZAWCZASU, zamiast oddawać odmowę RPC.
    formularz({ types: [ONLINE_EXTERNAL] });
    wypelnijMinimum();
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.externalUrl`);
  });

  it("adres zapisów bez `https` nie dociera do warstwy zapisu", () => {
    formularz({ types: [ONLINE_EXTERNAL] });
    wypelnijMinimum();
    wpisz("externalUrlLabel", "http://rejestracja.example.org");
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.externalUrlInvalid`);
  });

  it("poprawienie braku ZDEJMUJE komunikat i przepuszcza zapis", () => {
    formularz();
    utworz();
    expect(komunikaty()).toContain(`${C}errors.titles`);

    wypelnijMinimum();
    expect(komunikaty()).toHaveLength(0);
    utworz();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("EventCreateForm - co dostaje warstwa zapisu", () => {
  it("kompletny szkic jedzie w CAŁOŚCI, z rodzajem i formatem z droplisty", () => {
    formularz();
    wypelnijMinimum();
    wpisz("endsAtLabel", "2026-09-01T17:00");
    wpisz("cityLabel", "Bruksela");
    wpisz("countryLabel", "Belgia");
    utworz();

    expect(ostatniSzkic()).toEqual({
      eventTypeId: "type-okragly-stol",
      titlePl: "Śniadanie eksperckie",
      titleEn: "Expert breakfast",
      startsAt: "2026-09-01T09:00",
      endsAt: "2026-09-01T17:00",
      timezone: "Europe/Warsaw",
      format: "onsite",
      city: "Bruksela",
      country: "Belgia",
      externalRegistrationUrl: "",
    });
  });

  it("szkic idzie W GÓRĘ NA ŻYWO - nagłówek railu pokazuje wpisywany tytuł", () => {
    // Bez raportu w górę przejście z kreatora do studia przesuwa nagłówek
    // nawigacji: po zapisie stoi tam inna nazwa niż ta, którą redaktor widział
    // sekundę wcześniej.
    formularz();
    wpisz("titlePlLabel", "Śniadanie eksperckie");
    wpisz("startsAtLabel", "2026-09-01T09:00");

    const ostatni = onDraftChange.mock.calls.at(-1)?.[0];
    expect(ostatni?.titlePl).toBe("Śniadanie eksperckie");
    expect(ostatni?.startsAt).toBe("2026-09-01T09:00");
  });

  it("tytuł z samych spacji NIE jest tytułem", () => {
    formularz();
    wpisz("titlePlLabel", "   ");
    wpisz("titleEnLabel", "   ");
    wpisz("startsAtLabel", "2026-09-01T09:00");
    utworz();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(komunikaty()).toContain(`${C}errors.titles`);
  });

  it("adres zapisów zewnętrznych jedzie w szkicu razem z resztą", () => {
    formularz({ types: [ONLINE_EXTERNAL] });
    wypelnijMinimum();
    wpisz("externalUrlLabel", "https://rejestracja.example.org/nes-2026");
    utworz();

    expect(ostatniSzkic().externalRegistrationUrl).toBe("https://rejestracja.example.org/nes-2026");
    expect(ostatniSzkic().eventTypeId).toBe("type-webinar");
  });
});

describe("EventCreateForm - miejsce i format", () => {
  it("wydarzenie WYŁĄCZNIE ONLINE nie pyta o miasto ani o kraj", () => {
    // Baza zeruje wtedy miasto i kraj, więc pole, którego zapis jest z góry
    // unieważniony, kłamałoby o skutku.
    formularz();
    fireEvent.change(droplista("formatLabel"), { target: { value: "online" } });

    expect(screen.queryByLabelText(`${C}cityLabel`)).toBeNull();
    expect(screen.queryByLabelText(`${C}countryLabel`)).toBeNull();
    expect(screen.getByText(`${C}onlineNoPlace`)).toBeTruthy();
  });

  it("powrót na format stacjonarny PRZYWRACA pola miejsca", () => {
    formularz();
    fireEvent.change(droplista("formatLabel"), { target: { value: "online" } });
    fireEvent.change(droplista("formatLabel"), { target: { value: "hybrid" } });

    expect(screen.getByLabelText(`${C}cityLabel`)).toBeTruthy();
    expect(screen.queryByText(`${C}onlineNoPlace`)).toBeNull();
  });

  it("pole adresu zapisów pojawia się WYŁĄCZNIE przy rodzaju zewnętrznym", () => {
    formularz({ types: [rodzaj(), ONLINE_EXTERNAL] });
    expect(screen.queryByLabelText(`${C}externalUrlLabel`)).toBeNull();

    fireEvent.change(droplista("typeLabel"), { target: { value: "type-webinar" } });
    expect(screen.getByLabelText(`${C}externalUrlLabel`)).toBeTruthy();
  });
});

describe("EventCreateForm - strefa czasowa", () => {
  it("nowe wydarzenie startuje w strefie organizacji", () => {
    formularz();
    expect(droplista("timeZoneLabel").value).toBe("Europe/Warsaw");
  });

  it("droplista OFERUJE `UTC` i nowoczesną nazwę Kijowa, bez starej", () => {
    // `Intl.supportedValuesOf("timeZone")` nie zna ani `UTC`, ani `Europe/Kyiv`
    // - zna wyłącznie przestarzałe `Europe/Kiev`. Kreator, który brałby sam
    // katalog, zakładałby wydarzenia w strefach, których panel edycji już nie
    // oferuje.
    formularz();
    const opcje = Array.from(droplista("timeZoneLabel").options).map((option) => option.value);

    expect(opcje).toContain("UTC");
    expect(opcje).toContain("Europe/Kyiv");
    expect(opcje).not.toContain("Europe/Kiev");
  });

  it("wybrana strefa jedzie do szkicu i do warstwy zapisu", () => {
    formularz();
    wypelnijMinimum();
    fireEvent.change(droplista("timeZoneLabel"), { target: { value: "UTC" } });
    utworz();

    expect(ostatniSzkic().timezone).toBe("UTC");
  });
});

describe("EventCreateForm - zapis i wyjście", () => {
  it("TRWAJĄCY zapis blokuje przycisk - podwójne kliknięcie zakłada JEDNO wydarzenie", () => {
    formularz({ isSaving: true });
    wypelnijMinimum();
    utworz();
    utworz();

    expect(przyciskUtworz().disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("bez trwającego zapisu ten sam formularz PRZEPUSZCZA zapis", () => {
    // KONTRAPUNKT: bez niego test wyżej przechodziłby także na przycisku
    // zablokowanym na stałe.
    formularz({ isSaving: false });
    wypelnijMinimum();
    utworz();

    expect(przyciskUtworz().disabled).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("anulowanie CZYŚCI wersję roboczą i oddaje decyzję wywołującemu", () => {
    // Szkic zostawiony w pamięci wraca przy następnym wejściu na ekran -
    // z tytułem wydarzenia, którego nikt nie chciał założyć.
    formularz();
    wypelnijMinimum();
    fireEvent.click(screen.getByRole("button", { name: `${C}cancelAction` }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pole("titlePlLabel").value).toBe("");
    expect(pole("startsAtLabel").value).toBe("");
  });
});
