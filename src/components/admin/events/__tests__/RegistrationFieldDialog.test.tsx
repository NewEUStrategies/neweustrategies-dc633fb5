// Molekuła „pole formularza zapisu" - TYP POLA RZĄDZI CAŁĄ RESZTĄ OKNA.
//
// To jest ekran, na którym powstaje FORMULARZ WYPEŁNIANY PRZEZ UCZESTNIKÓW.
// Pomyłka nie kończy się tutaj brzydkim widokiem, tylko setkami zgłoszeń
// z odpowiedzią, której nie da się odczytać albo której nie da się udzielić.
//
// CO TEN PLIK DOWODZI.
//   1. KLUCZ JEST ZAMROŻONY PO ZAPISIE. Odpowiedzi złożonych zgłoszeń leżą
//      w JSON-ie pod tym kluczem; zmiana zamieniłaby je w dane bez pytania.
//      Pole musi być odcięte w trybie poprawiania - i tylko tam.
//   2. WZÓR KLUCZA JEST PILNOWANY PRZY ZAKŁADANIU. Klucz ze spacją albo
//      z wielkiej litery baza sprowadza do małych liter, a w odpowiedziach
//      zostaje pod inną nazwą, niż widział redaktor.
//   3. KAŻDY Z DZIESIĘCIU TYPÓW POLA MA WŁASNY PRZYPADEK. Lista wyboru wymaga
//      wariantów, zgoda wymaga odnośnika do dokumentu, reszta nie ma ani
//      jednego, ani drugiego. Kolumna widoczna przy niewłaściwym typie to
//      obietnica bez pokrycia.
//   4. ZMIANA TYPU PRZESTAWIA CZĘŚCI ZALEŻNE, a warianty po poprzednim typie
//      NIE JADĄ do zapisu. Osierocone warianty przy polu tekstowym zostają
//      w bazie i wracają przy następnej zmianie typu.
//   5. LISTA BEZ ANI JEDNEGO WARIANTU NIE DA SIĘ ZAPISAĆ. Uczestnik dostałby
//      listę, z której nie da się nic wybrać - i nie złoży zgłoszenia.
//   6. DWA WARIANTY O TEJ SAMEJ WARTOŚCI NIE PRZECHODZĄ. Wartość trafia do
//      odpowiedzi zgłoszenia; duplikat scala dwie różne odpowiedzi w jedną.
//   7. REGUŁA KWALIFIKUJĄCA POKAZUJE SIĘ TYLKO WŁĄCZONA i jest NIEPODZIELNA:
//      włączona bez operatora albo z operatorem bez wartości nie przechodzi.
//      Bramka, która wygląda na działającą i przepuszcza wszystkich, jest
//      gorsza niż brak bramki.
//   8. WARTOŚĆ WARUNKU MA POSTAĆ, W JAKIEJ SQL JĄ PORÓWNUJE: lista dla
//      `in`/`not_in`, liczba dla progów, `null` tam, gdzie operator z niczym
//      nie porównuje.
//   9. NIEPEŁNY FORMULARZ NIE WOŁA WARSTWY ZAPISU - asercja na atrapie.
//  10. OTWARCIE DLA INNEGO WIERSZA NIE NIESIE POPRZEDNIEGO.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej (`fieldDraftIssue`,
// `fieldDraftToInput`, `qualifyValueJson`, odczyt wiersza) - tabele przypadków
// są w `lib/events/__tests__/registrationFieldDraft.test.ts`; tutaj dowodzimy,
// że okno ich UŻYWA, KTÓRE pole pokazuje przy odmowie i co wysyła. (2) Zapisu
// RPC i tego, że baza zna ten sam zbiór typów - molekuła dostaje `onSubmit`
// w propsie, a zgodności słowników pilnuje `dbEnumParity`.
//
// Radix Dialog i Radix Select nie działają pod happy-dom bez pełnego pointer
// API - oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  REGISTRATION_FIELD_TYPES,
  type EventRegistrationFieldRow,
  type RegistrationFieldInput,
  type RegistrationFieldType,
} from "@/lib/events/registrationsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Klient bazy nie jest przedmiotem dowodu, a jego moduł domaga się konfiguracji
// środowiska przy imporcie - okno bierze z `registrationsApi` wyłącznie SŁOWNIKI.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

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

const { RegistrationFieldDialog } =
  await import("@/components/admin/events/molecules/RegistrationFieldDialog");

const WYDARZENIE = "7b3c9d44-1111-4222-8333-444455556666";
const E = "adminEventRegistration.form.editor.";
const BLAD = "adminEventRegistration.errors.";
const KOLEJNOSC = 100;

// Wiersz pola tak, jak oddaje go RPC listy. `help_*` i `consent_url_*` są
// w bazie NULLOWALNE - pole bez podpowiedzi to przypadek DOMYŚLNY.
const BAZOWY_WIERSZ: Record<string, unknown> = {
  id: "fld-1",
  event_id: WYDARZENIE,
  key: "sector",
  field_type: "text",
  label_pl: "Sektor",
  label_en: "Sector",
  help_pl: null,
  help_en: null,
  consent_url_pl: null,
  consent_url_en: null,
  is_required: false,
  options: [],
  is_qualifying: false,
  qualify_operator: "none",
  qualify_value: null,
  qualify_outcome: "approval",
  is_active: true,
  sort_order: 10,
  answers_count: 0,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

function pole(overrides: Partial<EventRegistrationFieldRow> = {}): EventRegistrationFieldRow {
  return { ...BAZOWY_WIERSZ, ...overrides } as EventRegistrationFieldRow;
}

function renderuj(
  props: { open?: boolean; field?: EventRegistrationFieldRow | null; nextSortOrder?: number } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: RegistrationFieldInput) => void>();
  const stan = {
    open: props.open ?? true,
    field: props.field ?? null,
    nextSortOrder: props.nextSortOrder ?? KOLEJNOSC,
    isSaving: false,
  };
  const drzewo = () => (
    <RegistrationFieldDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      eventId={WYDARZENIE}
      field={stan.field}
      nextSortOrder={stan.nextSortOrder}
      isSaving={stan.isSaving}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(drzewo());
  const przerysuj = (zmiana: Partial<typeof stan>) => {
    Object.assign(stan, zmiana);
    wynik.rerender(drzewo());
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const klucz = () => screen.getByLabelText(`${E}key`);
const typ = () => screen.getByLabelText(`${E}type`);
const etykietaPl = () => screen.getByLabelText(`${E}labelPl`);
const etykietaEn = () => screen.getByLabelText(`${E}labelEn`);
const podpowiedzPl = () => screen.getByLabelText(`${E}helpPl`);
const kolejnosc = () => screen.getByLabelText(`${E}sortOrder`);
const zgodaPl = () => screen.getByLabelText(`${E}consentUrlPl`);
const regula = () => screen.getByRole("switch", { name: `${E}qualifying` });
const operator = () => screen.getByLabelText(`${E}operator`);
const wartoscWarunku = () => screen.getByLabelText(`${E}value`);
const werdykt = () => screen.getByLabelText(`${E}outcome`);
const dodajWariant = () => screen.getByRole("button", { name: new RegExp(`${E}addOption`) });
const wariantWartosc = (index = 0) => screen.getAllByLabelText(`${E}optionValue`)[index];
const wariantPl = (index = 0) => screen.getAllByLabelText(`${E}optionLabelPl`)[index];
const wariantEn = (index = 0) => screen.getAllByLabelText(`${E}optionLabelEn`)[index];
const usunWariant = (index = 0) =>
  screen.getAllByRole("button", { name: `${E}removeOption` })[index];
const zapisz = () => screen.getByRole("button", { name: `${E}saveAction` });
const anuluj = () => screen.getByRole("button", { name: `${E}cancelAction` });

/** Minimum, którego wymaga każde pole: klucz techniczny i etykieta w obu językach. */
function wypelnijMinimum(key = "sector") {
  fireEvent.change(klucz(), { target: { value: key } });
  fireEvent.change(etykietaPl(), { target: { value: "Sektor" } });
  fireEvent.change(etykietaEn(), { target: { value: "Sector" } });
}

/** Dokłada jeden gotowy wariant odpowiedzi do listy wyboru. */
function dodajGotowyWariant(index: number, value: string) {
  fireEvent.click(dodajWariant());
  fireEvent.change(wariantWartosc(index), { target: { value } });
  fireEvent.change(wariantPl(index), { target: { value: `${value} pl` } });
  fireEvent.change(wariantEn(index), { target: { value: `${value} en` } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RegistrationFieldDialog - otwarcie, tryb i pozostałość", () => {
  it("okno ZAMKNIĘTE nie renderuje formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${E}createTitle`)).not.toBeInTheDocument();
  });

  it("TRYB ZAKŁADANIA: klucz jest PUSTY i EDYTOWALNY, pole startuje jako tekstowe", () => {
    renderuj();
    expect(screen.getByRole("heading", { name: `${E}createTitle` })).toBeInTheDocument();
    expect(klucz()).toHaveValue("");
    expect(klucz()).toBeEnabled();
    expect(typ()).toHaveValue("text");
    expect(kolejnosc()).toHaveValue(String(KOLEJNOSC));
    expect(screen.getByRole("switch", { name: `${E}active` })).toBeChecked();
    expect(screen.getByRole("switch", { name: `${E}required` })).not.toBeChecked();
    expect(regula()).not.toBeChecked();
  });

  it("TRYB POPRAWIANIA: KLUCZ JEST ZAMROŻONY, reszta wartości pochodzi z wiersza", () => {
    // Odpowiedzi złożonych zgłoszeń leżą w JSON-ie pod tym kluczem. Gdyby pole
    // dało się edytować, jedna literówka zamieniłaby setki odpowiedzi w dane
    // bez pytania - i nikt by tego nie zauważył, bo zgłoszenia dalej się liczą.
    renderuj({
      field: pole({
        key: "sector",
        field_type: "select",
        label_pl: "Sektor",
        label_en: "Sector",
        help_pl: "Wybierz jeden",
        options: [{ value: "energy", label_pl: "Energia", label_en: "Energy" }],
        is_required: true,
        is_active: false,
        sort_order: 30,
      }),
    });

    expect(screen.getByRole("heading", { name: `${E}editTitle` })).toBeInTheDocument();
    expect(klucz()).toHaveValue("sector");
    expect(klucz()).toBeDisabled();
    expect(typ()).toHaveValue("select");
    expect(podpowiedzPl()).toHaveValue("Wybierz jeden");
    expect(wariantWartosc()).toHaveValue("energy");
    expect(kolejnosc()).toHaveValue("30");
    expect(screen.getByRole("switch", { name: `${E}required` })).toBeChecked();
    expect(screen.getByRole("switch", { name: `${E}active` })).not.toBeChecked();
  });

  it("OTWARCIE DLA INNEGO WIERSZA nie niesie ani wartości, ani WARIANTÓW poprzedniego", () => {
    // Regresja, którą to łapie: poprawiane pole tekstowe „Stanowisko" dostaje
    // warianty listy „Sektor" - i zapisuje je pod swoim identyfikatorem.
    const { przerysuj } = renderuj({
      field: pole({
        key: "sector",
        field_type: "select",
        options: [{ value: "energy", label_pl: "Energia", label_en: "Energy" }],
      }),
    });
    expect(wariantWartosc()).toHaveValue("energy");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      field: pole({ id: "fld-2", key: "job_title", label_pl: "Stanowisko", label_en: "Job title" }),
    });

    expect(klucz()).toHaveValue("job_title");
    expect(typ()).toHaveValue("text");
    expect(screen.queryByLabelText(`${E}optionValue`)).not.toBeInTheDocument();
  });

  it("przejście z POPRAWIANIA do ZAKŁADANIA odblokowuje klucz i czyści formularz", () => {
    const { przerysuj } = renderuj({ field: pole({ key: "sector", label_pl: "Sektor" }) });
    przerysuj({ open: false });
    przerysuj({ open: true, field: null });

    expect(screen.getByRole("heading", { name: `${E}createTitle` })).toBeInTheDocument();
    expect(klucz()).toHaveValue("");
    expect(klucz()).toBeEnabled();
    expect(etykietaPl()).toHaveValue("");
  });

  it("ZMIANA WIERSZA PRZY ZAMKNIĘTYM OKNIE nie przestawia formularza", () => {
    // Efekt wychodzi wcześnie, gdy okno jest zamknięte. Bez tego wyjścia
    // odświeżenie listy pod zamkniętym oknem kasowałoby pracę redaktora.
    const { przerysuj } = renderuj({ open: false, field: pole({ label_pl: "Sektor" }) });
    przerysuj({ open: true });
    fireEvent.change(etykietaPl(), { target: { value: "Sektor gospodarki" } });

    przerysuj({ open: false });
    przerysuj({ field: pole({ label_pl: "Sektor" }) });
    przerysuj({ open: true });

    expect(etykietaPl()).toHaveValue("Sektor");
  });

  it("przeliczenie kolejności przy OTWARTYM oknie NIE kasuje pracy redaktora", () => {
    // Zanim to naprawiono, efekt zasiewający formularz miał `nextSortOrder`
    // w tablicy zależności, a tę wartość wylicza panel z listy pól. Gdy lista
    // odświeżyła się przy otwartym oknie (odzyskanie fokusu przeglądarki, pole
    // dodane przez drugiego redaktora), liczba się zmieniała, efekt biegł
    // ponownie i ZASIEWAŁ formularz od nowa - wpisana etykieta, warianty
    // i reguła ginęły w trakcie pisania, bez żadnego komunikatu. Zasiew zależy
    // teraz od OTWARCIA i TOŻSAMOŚCI wiersza, a nie od liczby, którą okno
    // tylko czyta.
    const { przerysuj } = renderuj();
    wypelnijMinimum();
    przerysuj({ nextSortOrder: 110 });
    expect(etykietaPl()).toHaveValue("Sektor");
  });
});

describe("RegistrationFieldDialog - klucz techniczny", () => {
  const zleKlucze: { opis: string; klucz: string }[] = [
    { opis: "wielka litera", klucz: "Sector" },
    { opis: "spacja", klucz: "sektor gospodarki" },
    { opis: "myślnik", klucz: "sektor-gospodarki" },
    { opis: "cyfra na początku", klucz: "1sektor" },
    { opis: "jeden znak", klucz: "s" },
    { opis: "pusty", klucz: "" },
  ];

  it.each(zleKlucze)("klucz odrzucony: $opis nie wysyła żądania", ({ klucz: wartosc }) => {
    // Baza sprowadza klucz do małych liter i obcina spacje, więc odpowiedzi
    // uczestników wylądowałyby pod NAZWĄ, której redaktor nigdy nie widział.
    const { onSubmit } = renderuj();
    fireEvent.change(etykietaPl(), { target: { value: "Sektor" } });
    fireEvent.change(etykietaEn(), { target: { value: "Sector" } });
    fireEvent.change(klucz(), { target: { value: wartosc } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidKey`)).toBeInTheDocument();
  });

  it("poprawny klucz przechodzi i jedzie OBCIĘTY z białych znaków", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(etykietaPl(), { target: { value: "Sektor" } });
    fireEvent.change(etykietaEn(), { target: { value: "Sector" } });
    fireEvent.change(klucz(), { target: { value: "  sektor_2  " } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].key).toBe("sektor_2");
  });

  it("W TRYBIE POPRAWIANIA wzór klucza nie jest już sprawdzany", () => {
    // Klucz historyczny może nie pasować do dzisiejszego wzoru; pole i tak jest
    // odcięte, a blokada zapisu uwięziłaby redaktora na polu, którego nie da
    // się poprawić.
    const { onSubmit } = renderuj({ field: pole({ key: "Stary-Klucz" }) });
    fireEvent.change(etykietaPl(), { target: { value: "Sektor gospodarki" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ id: "fld-1", key: "Stary-Klucz" });
  });
});

describe("RegistrationFieldDialog - typ pola rządzi resztą okna", () => {
  const zWariantami: readonly RegistrationFieldType[] = ["select", "multiselect"];

  it.each(REGISTRATION_FIELD_TYPES)(
    "typ „%s”: warianty tylko dla list, odnośnik zgody tylko dla zgody",
    (rodzaj) => {
      renderuj();
      fireEvent.change(typ(), { target: { value: rodzaj } });

      const maMiecWarianty = zWariantami.includes(rodzaj);
      expect(screen.queryByText(`${E}options`) !== null).toBe(maMiecWarianty);
      expect(screen.queryByLabelText(`${E}consentUrlPl`) !== null).toBe(rodzaj === "consent");
      // Podpowiedź mówi, CO ten typ znaczy dla uczestnika - i musi zmieniać się
      // razem z typem, inaczej opisuje poprzedni wybór.
      expect(
        screen.getByText(`adminEventRegistration.fieldTypeHints.${rodzaj}`),
      ).toBeInTheDocument();
    },
  );

  it.each(REGISTRATION_FIELD_TYPES)("typ „%s” dojeżdża do żądania zapisu", (rodzaj) => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: rodzaj } });
    if (zWariantami.includes(rodzaj)) dodajGotowyWariant(0, "energy");
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].fieldType).toBe(rodzaj);
  });

  it("ZMIANA TYPU Z LISTY NA TEKST chowa warianty i NIE wysyła ich do bazy", () => {
    // Bez jawnego zdjęcia warianty zostają w kolumnie `options` pola
    // tekstowego i wracają przy następnej zmianie typu - jako lista, której
    // nikt świadomie nie ułożył.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");

    fireEvent.change(typ(), { target: { value: "text" } });
    expect(screen.queryByLabelText(`${E}optionValue`)).not.toBeInTheDocument();

    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].options).toEqual([]);
  });

  it("powrót do listy PRZYWRACA wpisane warianty - praca redaktora nie ginie", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");
    fireEvent.change(typ(), { target: { value: "text" } });
    fireEvent.change(typ(), { target: { value: "multiselect" } });

    expect(wariantWartosc()).toHaveValue("energy");
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].options).toEqual([
      { value: "energy", label_pl: "energy pl", label_en: "energy en" },
    ]);
  });
});

describe("RegistrationFieldDialog - warianty odpowiedzi", () => {
  it("LISTA BEZ ANI JEDNEGO WARIANTU nie da się zapisać", () => {
    // Uczestnik dostałby listę, z której nie da się nic wybrać - a pole
    // wymagane bez wariantów blokuje CAŁE zgłoszenie.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidOptions`)).toBeInTheDocument();
  });

  it("wariant z PUSTĄ WARTOŚCIĄ nie liczy się jako wariant", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    fireEvent.click(dodajWariant());
    fireEvent.change(wariantPl(), { target: { value: "Bez wartości" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidOptions`)).toBeInTheDocument();
  });

  it("DWA WARIANTY O TEJ SAMEJ WARTOŚCI nie przechodzą", () => {
    // Wartość techniczna trafia do odpowiedzi zgłoszenia. Duplikat scala dwie
    // różne odpowiedzi w jedną i nie da się już powiedzieć, co uczestnik wybrał.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");
    dodajGotowyWariant(1, "energy");
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}duplicateKey`)).toBeInTheDocument();
  });

  it("wariant bez etykiety w JEDNYM języku nie przechodzi", () => {
    // Uczestnik czytający serwis po angielsku zobaczyłby pustą pozycję listy.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    fireEvent.click(dodajWariant());
    fireEvent.change(wariantWartosc(), { target: { value: "energy" } });
    fireEvent.change(wariantPl(), { target: { value: "Energia" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidOptions`)).toBeInTheDocument();
  });

  it("KOSZ usuwa DOKŁADNIE ten wariant, przy którym stoi", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");
    dodajGotowyWariant(1, "transport");
    dodajGotowyWariant(2, "health");

    fireEvent.click(usunWariant(1));

    expect(screen.getAllByLabelText(`${E}optionValue`)).toHaveLength(2);
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].options).toEqual([
      { value: "energy", label_pl: "energy pl", label_en: "energy en" },
      { value: "health", label_pl: "health pl", label_en: "health en" },
    ]);
  });

  it("wartości i etykiety wariantów jadą OBCIĘTE z białych znaków", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "multiselect" } });
    fireEvent.click(dodajWariant());
    fireEvent.change(wariantWartosc(), { target: { value: "  energy  " } });
    fireEvent.change(wariantPl(), { target: { value: "  Energia  " } });
    fireEvent.change(wariantEn(), { target: { value: "  Energy  " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].options).toEqual([
      { value: "energy", label_pl: "Energia", label_en: "Energy" },
    ]);
  });
});

describe("RegistrationFieldDialog - odnośnik dokumentu zgody", () => {
  it("pole zgody pyta o odnośnik, a pole tekstowe nie ma takiej kolumny", () => {
    // Przy zgodzie odnośnik jest wymogiem RODO: uczestnik musi móc przeczytać
    // treść, na którą się godzi. Przy polu tekstowym byłby martwą kolumną.
    renderuj();
    expect(screen.queryByLabelText(`${E}consentUrlPl`)).not.toBeInTheDocument();
    fireEvent.change(typ(), { target: { value: "consent" } });
    expect(zgodaPl()).toHaveAttribute("placeholder", "https://");
  });

  it("odnośnik zgody inny niż https:// nie przechodzi", () => {
    // `javascript:` w tym miejscu byłoby odnośnikiem wykonującym kod na
    // stronie zapisu; baza przepuszcza wyłącznie `https://`.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "consent" } });
    fireEvent.change(zgodaPl(), { target: { value: "http://example.test/rodo" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidConsentUrl`)).toBeInTheDocument();
  });

  it("pole zgody BEZ odnośnika przechodzi - odnośnik jest nieobowiązkowy", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "consent" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ fieldType: "consent", consentUrlPl: "" });
  });

  it("poprawny odnośnik jedzie OBCIĘTY w obu językach", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "consent" } });
    fireEvent.change(zgodaPl(), { target: { value: " https://example.test/rodo-pl " } });
    fireEvent.change(screen.getByLabelText(`${E}consentUrlEn`), {
      target: { value: "https://example.test/gdpr-en" },
    });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      consentUrlPl: "https://example.test/rodo-pl",
      consentUrlEn: "https://example.test/gdpr-en",
    });
  });

  it("REGRESJA: zły odnośnik zgody NIE blokuje zapisu po zmianie typu na tekstowy", () => {
    // Zanim to naprawiono, `fieldDraftIssue` sprawdzał odnośnik zgody
    // NIEZALEŻNIE od typu pola, choć okno rysuje te dwie kolumny WYŁĄCZNIE
    // przy typie `consent`. Redaktor, który zaczął od zgody, wpisał `http://…`,
    // a potem zmienił typ na tekst, klikał „Zapisz" i NIE DZIAŁO SIĘ NIC:
    // żądania nie było, komunikatu nie było, a pola, które blokowało zapis, nie
    // było na ekranie. Jedynym wyjściem był powrót do typu `consent`
    // i skasowanie odnośnika - o czym nikt się nie dowiadywał. Ta sama pułapka
    // dotyczyła wariantów listy (test niżej).
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "consent" } });
    fireEvent.change(zgodaPl(), { target: { value: "http://example.test/rodo" } });
    fireEvent.change(typ(), { target: { value: "text" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("REGRESJA: zduplikowany wariant NIE blokuje zapisu po zmianie typu na tekstowy", () => {
    // Warianty nie jadą do bazy przy typie bez listy (`options: []`), ale
    // sprawdzenie duplikatów i pustych etykiet biegło dla KAŻDEGO typu.
    // Skutek był jak wyżej: martwy przycisk „Zapisz" i niewidoczna przyczyna.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");
    dodajGotowyWariant(1, "energy");
    fireEvent.change(typ(), { target: { value: "text" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("RegistrationFieldDialog - reguła kwalifikująca", () => {
  it("WYŁĄCZONA reguła nie pokazuje ani operatora, ani wartości, ani werdyktu", () => {
    // Operator i wartość widoczne przy wyłączonej regule sugerują, że coś już
    // bramkuje zgłoszenia - a nie bramkuje nic. To najgorszy rodzaj pomyłki na
    // formularzu, który odrzuca ludzi.
    renderuj();
    expect(screen.queryByLabelText(`${E}operator`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${E}value`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${E}outcome`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${E}outcomePrecedence`)).not.toBeInTheDocument();
  });

  it("WŁĄCZONA reguła odsłania operator, wartość, werdykt i notkę o pierwszeństwie", () => {
    renderuj();
    fireEvent.click(regula());
    expect(operator()).toHaveValue("none");
    expect(wartoscWarunku()).toBeInTheDocument();
    expect(werdykt()).toHaveValue("approval");
    expect(screen.getByText(`${E}outcomePrecedence`)).toBeInTheDocument();
    expect(
      screen.getByText("adminEventRegistration.qualifyOutcomeHints.approval"),
    ).toBeInTheDocument();
  });

  it("reguła WŁĄCZONA BEZ OPERATORA nie przechodzi", () => {
    // Baza odrzuca pole kwalifikujące bez operatora
    // (`event_registration_fields_qualify_complete`), a odmowa CHECK-a wraca
    // bez nazwy pola - więc komunikat musi powstać tutaj.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(regula());
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}invalidRequest`)).toBeInTheDocument();
  });

  it("operator PORÓWNUJĄCY bez wartości nie przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(regula());
    fireEvent.change(operator(), { target: { value: "equals" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(wartoscWarunku()).toHaveAttribute("aria-invalid", "true");
  });

  it("operator, który z NICZYM nie porównuje, CHOWA pole wartości i przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(regula());
    fireEvent.change(operator(), { target: { value: "is_true" } });
    expect(screen.queryByLabelText(`${E}value`)).not.toBeInTheDocument();

    fireEvent.click(zapisz());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      isQualifying: true,
      qualifyOperator: "is_true",
      qualifyValue: null,
    });
  });

  it("operator LISTOWY wysyła wartości z osobnych linii jako TABLICĘ", () => {
    // `in` porównuje w SQL-u z tablicą. Wysłany napis dałby regułę, która
    // NIGDY się nie spełnia - czyli bramkę wyglądającą na działającą
    // i przepuszczającą wszystkich.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(regula());
    fireEvent.change(operator(), { target: { value: "in" } });
    fireEvent.change(wartoscWarunku(), { target: { value: " energia \n\n transport " } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0].qualifyValue).toEqual(["energia", "transport"]);
  });

  it("PRÓG jedzie jako LICZBA, nie jako napis", () => {
    // `gte` na napisie porównałoby leksykograficznie i „9" byłoby większe
    // od „10" - próg wpuszczałby dokładnie odwrotnych ludzi.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "number" } });
    fireEvent.click(regula());
    fireEvent.change(operator(), { target: { value: "gte" } });
    fireEvent.change(wartoscWarunku(), { target: { value: "10" } });
    fireEvent.change(werdykt(), { target: { value: "auto_approve" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      qualifyValue: 10,
      qualifyOutcome: "auto_approve",
    });
    expect(
      screen.getByText("adminEventRegistration.qualifyOutcomeHints.auto_approve"),
    ).toBeInTheDocument();
  });

  it("WYŁĄCZENIE reguły zdejmuje operator i wartość z żądania", () => {
    // Reguła wyłączona, ale z operatorem w bazie, jest bramką-widmem: nie widać
    // jej w oknie, a CHECK „kompletnej reguły" nadal ją zna.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(regula());
    fireEvent.change(operator(), { target: { value: "equals" } });
    fireEvent.change(wartoscWarunku(), { target: { value: "energia" } });
    fireEvent.click(regula());
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      isQualifying: false,
      qualifyOperator: "none",
      qualifyValue: null,
    });
  });
});

describe("RegistrationFieldDialog - etykiety, kolejność i ładunek", () => {
  it("BŁĘDY NIE POKAZUJĄ SIĘ przed pierwszą próbą zapisu", () => {
    renderuj();
    expect(screen.queryByText(`${BLAD}invalidKey`)).not.toBeInTheDocument();
    expect(klucz()).not.toHaveAttribute("aria-invalid");

    fireEvent.click(zapisz());
    expect(klucz()).toHaveAttribute("aria-invalid", "true");
  });

  it("etykieta jest wymagana w OBU językach i błąd stoi przy właściwym polu", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(klucz(), { target: { value: "sector" } });
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(etykietaPl()).toHaveAttribute("aria-invalid", "true");
    expect(etykietaEn()).not.toHaveAttribute("aria-invalid");

    fireEvent.change(etykietaPl(), { target: { value: "Sektor" } });
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(etykietaEn()).toHaveAttribute("aria-invalid", "true");
  });

  it("kolejność, która nie jest liczbą, nie wysyła żądania", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(kolejnosc(), { target: { value: "pierwsze" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(kolejnosc()).toHaveAttribute("aria-invalid", "true");
  });

  it("NOWE pole niesie identyfikator wydarzenia, pusty identyfikator i obcięte napisy", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(klucz(), { target: { value: "sector" } });
    fireEvent.change(etykietaPl(), { target: { value: "  Sektor  " } });
    fireEvent.change(etykietaEn(), { target: { value: "  Sector  " } });
    fireEvent.change(podpowiedzPl(), { target: { value: "  W jakiej branży pracujesz  " } });
    fireEvent.click(screen.getByRole("switch", { name: `${E}required` }));
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      id: null,
      eventId: WYDARZENIE,
      key: "sector",
      fieldType: "text",
      labelPl: "Sektor",
      labelEn: "Sector",
      helpPl: "W jakiej branży pracujesz",
      helpEn: "",
      consentUrlPl: "",
      consentUrlEn: "",
      isRequired: true,
      options: [],
      sortOrder: KOLEJNOSC,
      isQualifying: false,
      qualifyOperator: "none",
      qualifyValue: null,
      qualifyOutcome: "approval",
      isActive: true,
    });
  });

  it("WYŁĄCZENIE pola i podpowiedź angielska dojeżdżają do żądania", () => {
    // Pole wyłączone znika z formularza uczestnika, ale zostaje w bazie razem
    // z odpowiedziami - to jedyny sposób, żeby zdjąć pytanie z formularza i nie
    // stracić tego, co ludzie już odpowiedzieli.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(screen.getByLabelText(`${E}helpEn`), {
      target: { value: "  Which sector do you work in  " },
    });
    fireEvent.click(screen.getByRole("switch", { name: `${E}active` }));
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      helpEn: "Which sector do you work in",
      isActive: false,
    });
  });

  it("POPRAWIANE pole niesie własny identyfikator", () => {
    const { onSubmit } = renderuj({ field: pole({ id: "fld-77", sort_order: 30 }) });
    fireEvent.change(etykietaPl(), { target: { value: "Sektor gospodarki" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: "fld-77",
      eventId: WYDARZENIE,
      sortOrder: 30,
      labelPl: "Sektor gospodarki",
    });
  });
});

describe("RegistrationFieldDialog - zapis w locie i wyjście", () => {
  it("trwający zapis odcina OBA przyciski i nie przepuszcza drugiego żądania", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.click(zapisz());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    fireEvent.click(zapisz());
    fireEvent.click(anuluj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("okno NIE zamyka się samo po wysłaniu - odmowa zostawia pracę na ekranie", () => {
    // Molekuła nie zna wyniku zapisu; zamknięcie należy do panelu. Gdyby
    // zamykała się sama, odmowa bazy kasowałaby wypełniony formularz razem
    // z ułożoną listą wariantów.
    const { onOpenChange } = renderuj();
    wypelnijMinimum();
    fireEvent.change(typ(), { target: { value: "select" } });
    dodajGotowyWariant(0, "energy");
    fireEvent.click(zapisz());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(klucz()).toHaveValue("sector");
    expect(wariantWartosc()).toHaveValue("energy");
  });

  it("anulowanie zamyka okno BEZ żądania zapisu", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
