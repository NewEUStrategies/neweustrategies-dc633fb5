// Organizm „POLA FORMULARZA ZGLOSZENIA" - lista pytan, ktore uczestnik zobaczy
// przy zapisie na wydarzenie.
//
// PO CO TEN PLIK ISTNIEJE. Ta lista jest jedynym miejscem, z ktorego widac
// CALY formularz zgloszenia naraz - i jedynym, w ktorym da sie go po cichu
// zepsuc jednym klikieciem. Trzy powody, dla ktorych to nie jest zwykla lista
// katalogowa:
//
//   1. KLUCZ POLA JEST ZAMROZONY, A ODPOWIEDZI LEZA POD NIM. Zlozone
//      zgloszenia trzymaja odpowiedzi w JSON-ie pod kluczem pola, wiec
//      usuniecie definicji NIE kasuje tresci, a zmiana klucza zamienilaby
//      setki odpowiedzi w dane bez pytania. Usuniecie musi wiec prowadzic
//      przez potwierdzenie, a nie przez ikone kosza.
//   2. PRZELACZNIK „AKTYWNE" WYSYLA CALY WIERSZ, bo RPC zapisu jest upsertem.
//      To jest miejsce, w ktorym jedno klikniecie gubi WARIANTY ODPOWIEDZI,
//      REGULE KWALIFIKUJACA albo ADRES DOKUMENTU ZGODY - dowodzimy tego pelnym
//      ladunkiem, a nie pojedyncza flaga.
//   3. PYTANIE KWALIFIKUJACE ODRZUCA ZGLOSZENIA AUTOMATYCZNIE. Pole, ktore to
//      robi, nie moze wygladac na liscie jak zwykle pytanie o stanowisko -
//      znacznik w wierszu jest jedynym ostrzezeniem, jakie dostaje organizator.
//
// CZTERY STANY LISTY MAJA CZTERY WIDOKI, a awaria NIE MOZE mowic „formularz nie
// ma jeszcze zadnego pola": organizator zaklada wtedy DRUGIE pole o tym samym
// kluczu i dostaje odmowe unikalnosci zamiast listy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) FORMULARZA pola - to molekula
// `RegistrationFieldDialog`; tutaj stoi atrapa i liczy sie STYK: z czym panel
// ja otwiera i co robi z ladunkiem, ktory od niej dostaje. (2) Tabel konwersji
// szkicu (`registrationFieldDraft`) - maja wlasny plik; tutaj dowodzimy, ze
// przelacznik przepuszcza przez nie CALY wiersz i nic po drodze nie ginie.
// (3) Slownika odmow bazy (`adminRegistrationErrors`).
//
// ZAWEZENIE NAJEMCA. Lista, zapis i usuniecie ida przez RPC
// (`admin_event_registration_fields_list`, `..._field_upsert`,
// `..._field_delete`), wiec asertujemy NAZWE FUNKCJI i LADUNEK; samo zawezenie
// tenantem siedzi w SQL (`assert_editor_tenant`, `WHERE f.tenant_id = v_tenant`)
// i pilnuje go bramka `check:sql-tenant-scope`.
//
// RODO: pytania i warianty odpowiedzi syntetyczne, adresy wylacznie
// `example.org`, zadnych danych uczestnikow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MouseEventHandler, ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type {
  EventRegistrationFieldRow,
  RegistrationFieldInput,
} from "@/lib/events/registrationsApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  lang: "pl",
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Mapowanie odmow bazy ma wlasny plik testowy, a jego prawdziwa wersja ciagnie
// pelna instancje i18n. Tutaj liczy sie wylacznie to, ze panel pokazuje TO,
// co mapowanie zwrocilo.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Switch nie przelacza sie pod happy-dom bez pelnego API wskaznika,
// a przelacznik „pole aktywne" jest tu glowna akcja zapisu w wierszu.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

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
      disabled,
    }: {
      children?: ReactNode;
      onClick?: MouseEventHandler<HTMLButtonElement>;
      disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// Formularz pola ma WLASNY dom (molekula `molecules/RegistrationFieldDialog`).
// Tutaj jest atrapa i liczy sie STYK: z czym panel go otwiera i co robi
// z ladunkiem, ktory od niego dostaje.
//
// `isSaving` stoi w kontrakcie atrapy, ale nie ma na nim asercji: okno „zapis
// w toku" trwa tyle, co mikrozadanie miedzy `mutate` a odpowiedzia atrapy RPC,
// wiec nie da sie go zobaczyc ani synchronicznie, ani przez `waitFor`.
vi.mock("@/components/admin/events/molecules/RegistrationFieldDialog", () => ({
  RegistrationFieldDialog: ({
    open,
    onOpenChange,
    eventId,
    field,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    field: EventRegistrationFieldRow | null;
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: RegistrationFieldInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-pola"
        data-pole={field === null ? "nowy" : field.id}
        data-kolejnosc={String(nextSortOrder)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: field === null ? null : field.id,
              eventId,
              key: field === null ? "instytucja" : field.key,
              fieldType: "text",
              labelPl: "Instytucja",
              labelEn: "Institution",
              helpPl: "",
              helpEn: "",
              consentUrlPl: "",
              consentUrlEn: "",
              isRequired: true,
              options: [],
              sortOrder: nextSortOrder,
              isQualifying: false,
              qualifyOperator: "none",
              qualifyValue: null,
              qualifyOutcome: "approval",
              isActive: true,
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

const { RegistrationFieldsPanel } =
  await import("@/components/admin/events/organisms/RegistrationFieldsPanel");

const T = "adminEventRegistration.form.";
const LISTA_RPC = "admin_event_registration_fields_list";
const ZAPIS_RPC = "admin_event_registration_field_upsert";
const KASOWANIE_RPC = "admin_event_registration_field_delete";

const WYDARZENIE = "3f1a0c8e-0000-4000-8000-000000000042";
const POLE = "7c2b0000-0000-4000-8000-000000000001";
const INNE_POLE = "7c2b0000-0000-4000-8000-000000000002";

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Wiersz `admin_event_registration_fields_list` - 22 kolumny sygnatury RPC.
 *
 * Domyslnie pole PROSTE: tekst, wymagane, aktywne, bez reguly kwalifikujacej.
 * Test, ktory chce reguly albo wariantow odpowiedzi, doklada je nadpisaniem.
 */
function polePytania(
  overrides: Partial<EventRegistrationFieldRow> = {},
): EventRegistrationFieldRow {
  return {
    answers_count: 12,
    consent_url_en: "",
    consent_url_pl: "",
    created_at: "2026-08-01T10:00:00.000Z",
    event_id: WYDARZENIE,
    field_type: "text",
    help_en: "Employer or organisation.",
    help_pl: "Instytucja albo firma.",
    id: POLE,
    is_active: true,
    is_qualifying: false,
    is_required: true,
    key: "instytucja",
    label_en: "Institution",
    label_pl: "Instytucja",
    options: [],
    qualify_operator: "none",
    qualify_outcome: "approval",
    qualify_value: null,
    sort_order: 10,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function panel() {
  return render(
    <Provider>
      <RegistrationFieldsPanel eventId={WYDARZENIE} />
    </Provider>,
  );
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liscie pol`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const przelacznik = (index = 0): HTMLElement => within(wiersz(index)).getByRole("switch");
const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-pola" });
const okno = (): HTMLElement => screen.getByRole("alertdialog");

/** Ladunek ostatniego zapisu jako slownik - bez rzutowania na typ RPC. */
function ladunek(): Record<string, unknown> {
  const call = stub().lastCall(ZAPIS_RPC);
  if (call === undefined) throw new Error("test: zapis nie dojechal do bazy");
  const arg = call.arg("p_payload");
  if (arg === null || typeof arg !== "object") {
    throw new Error("test: ladunek zapisu nie jest obiektem");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) out[key] = value;
  return out;
}

/** Lista wczytana - kazdy przypadek zaczyna sie od widocznego wiersza. */
async function czekajNaListe(): Promise<void> {
  await waitFor(() => expect(wiersze().length).toBeGreaterThan(0));
}

async function czekajNaZapis(): Promise<void> {
  await waitFor(() => expect(stub().lastCall(ZAPIS_RPC)).toBeDefined());
}

function daneListy(rows: readonly EventRegistrationFieldRow[]): void {
  stub().setData(LISTA_RPC, rows);
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.lang = "pl";
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  daneListy([polePytania()]);
  stub().setData(ZAPIS_RPC, POLE);
  stub().setData(KASOWANIE_RPC, null);
});

afterEach(cleanup);

describe("RegistrationFieldsPanel - cztery stany listy", () => {
  it("zapytanie w locie mowi „wczytywanie” i nie rysuje ani jednego pola", async () => {
    panel();

    expect(screen.getByText(`${T}loading`)).toBeInTheDocument();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}empty`)).toBeNull();
    await czekajNaListe();
  });

  it("awaria pokazuje odmowe bazy i NIE mowi, ze formularz nie ma pol", async () => {
    // „Nie ma zadnego pola" po nieudanym zapytaniu to nieprawda o stanie bazy.
    // Organizator zaklada wtedy pole o kluczu, ktory juz istnieje, i dostaje
    // odmowe unikalnosci zamiast listy.
    stub().setError(LISTA_RPC, "forbidden: not an event admin", "42501");
    panel();

    await waitFor(() =>
      expect(screen.getByText("odmowa:forbidden: not an event admin")).toBeInTheDocument(),
    );
    expect(screen.queryByText(`${T}empty`)).toBeNull();
    expect(wiersze()).toHaveLength(0);
  });

  it("brak pol to „pusto”, a nie awaria - i mowi, co sie wtedy dzieje z zapisem", async () => {
    daneListy([]);
    panel();

    await waitFor(() => expect(screen.getByText(`${T}empty`)).toBeInTheDocument());
    expect(wiersze()).toHaveLength(0);
  });

  it("lista z danymi rysuje po jednym wierszu na pole i zostawia przycisk dodawania", async () => {
    daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "stanowisko" })]);
    panel();

    await czekajNaListe();
    expect(wiersze()).toHaveLength(2);
    expect(przycisk(`${T}addAction`)).toBeInTheDocument();
  });

  it("lista pyta o pola DOKLADNIE tego wydarzenia - `p_event_id` jest calym filtrem klienta", async () => {
    // Zawezenie najemcem robi SQL (`assert_editor_tenant`); klient odpowiada
    // wylacznie za wydarzenie, a pomylka w tym argumencie pokazalaby
    // organizatorowi cudzy formularz.
    panel();

    await czekajNaListe();
    expect(stub().lastCall(LISTA_RPC)?.arg("p_event_id")).toBe(WYDARZENIE);
  });
});

describe("RegistrationFieldsPanel - wiersz pola", () => {
  it("mowi etykiete w jezyku interfejsu i pokazuje klucz techniczny", async () => {
    panel();

    await czekajNaListe();
    expect(within(wiersz()).getByText("Instytucja")).toBeInTheDocument();
    expect(within(wiersz()).getByText("instytucja")).toBeInTheDocument();
  });

  it("po angielsku etykieta jest angielska - klucz techniczny zostaje ten sam", async () => {
    h.lang = "en";
    panel();

    await czekajNaListe();
    expect(within(wiersz()).getByText("Institution")).toBeInTheDocument();
    expect(within(wiersz()).getByText("instytucja")).toBeInTheDocument();
  });

  it("POLE WYMAGANE JEST OZNACZONE, a nieobowiazkowe nie nosi tego znacznika", async () => {
    // Bez znacznika organizator nie wie, ktore pytanie zatrzyma zgloszenie -
    // a to jest jedyna roznica miedzy „pytamy" a „nie przepuscimy bez tego".
    daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "uwagi", is_required: false })]);
    panel();

    await czekajNaListe();
    expect(within(wiersz(0)).getByText(`${T}columns.required`)).toBeInTheDocument();
    expect(within(wiersz(1)).queryByText(`${T}columns.required`)).toBeNull();
  });

  it("PYTANIE KWALIFIKUJACE ma wlasny znacznik - odrzuca zgloszenia automatycznie", async () => {
    daneListy([
      polePytania({ is_qualifying: true, qualify_operator: "is_true", qualify_outcome: "reject" }),
      polePytania({ id: INNE_POLE, key: "uwagi" }),
    ]);
    panel();

    await czekajNaListe();
    expect(within(wiersz(0)).getByText(`${T}columns.qualifying`)).toBeInTheDocument();
    expect(within(wiersz(1)).queryByText(`${T}columns.qualifying`)).toBeNull();
  });

  it("typ pola stoi w wierszu jako nazwa ze slownika, nie jako wartosc kolumny", async () => {
    daneListy([polePytania({ field_type: "consent", key: "zgoda_rodo" })]);
    panel();

    await czekajNaListe();
    expect(
      within(wiersz()).getByText("adminEventRegistration.fieldTypes.consent"),
    ).toBeInTheDocument();
  });

  it("LICZBA ODPOWIEDZI stoi w wierszu - bez niej usuniecie pola jest strzalem w ciemno", async () => {
    // Definicja znika, odpowiedzi zostaja w zgloszeniach. Licznik jest jedynym
    // miejscem, z ktorego widac, ile tresci wlasnie osieroci to usuniecie.
    daneListy([
      polePytania({ answers_count: 12 }),
      polePytania({ id: INNE_POLE, key: "uwagi", answers_count: 0 }),
    ]);
    panel();

    await czekajNaListe();
    expect(within(wiersz(0)).getByText(`${T}columns.answers: 12`)).toBeInTheDocument();
    expect(within(wiersz(1)).getByText(`${T}columns.answers: 0`)).toBeInTheDocument();
  });

  it("KOLUMNA PUSTA Z BAZY nie wywraca wiersza - licznik mowi zero, a kolejnosc nie jest „NaN”", async () => {
    // `admin_event_registration_fields_list` oddaje `answers_count`
    // i `sort_order` z kolumn NULL-owalnych, a generator typow opisuje
    // `RETURNS TABLE` jako kolumny niepuste - dlatego pole sprzed migracji
    // porzadkujacej wchodzi tu kanalem `unknown` atrapy RPC, dokladnie tak, jak
    // wchodzi z sieci. Bez oslon panelu licznik zostawilby puste miejsce przy
    // slowie „odpowiedzi", a podpowiedz kolejnosci nowego pola dojechalaby do
    // RPC jako „NaN" - czyli zalozenie kolejnego pytania konczyloby sie odmowa.
    const przedMigracja: Record<string, unknown> = {
      ...polePytania(),
      answers_count: null,
      sort_order: null,
    };
    stub().setData(LISTA_RPC, [przedMigracja]);
    panel();
    await czekajNaListe();

    expect(within(wiersz()).getByText(`${T}columns.answers: 0`)).toBeInTheDocument();

    fireEvent.click(przycisk(`${T}addAction`));
    expect(formularz()).toHaveAttribute("data-kolejnosc", "100");
  });

  it("KOLEJNOSC WIERSZY JEST KOLEJNOSCIA Z BAZY - panel jej nie przestawia", async () => {
    // Sortowanie robi RPC (`ORDER BY f.sort_order, f.key`), bo TA SAMA kolejnosc
    // rysuje formularz uczestnika. Sortowanie w pamieci panelu rozjechaloby
    // podglad organizatora z tym, co zobaczy zapisujacy sie.
    daneListy([
      polePytania({ id: POLE, key: "instytucja", label_pl: "Instytucja", sort_order: 10 }),
      polePytania({ id: INNE_POLE, key: "stanowisko", label_pl: "Stanowisko", sort_order: 20 }),
    ]);
    panel();

    await czekajNaListe();
    expect(within(wiersz(0)).getByText("Instytucja")).toBeInTheDocument();
    expect(within(wiersz(1)).getByText("Stanowisko")).toBeInTheDocument();
  });
});

describe("RegistrationFieldsPanel - przelacznik „pole aktywne” wysyla CALY wiersz", () => {
  it("wylaczenie niesie KOMPLET kolumn, a nie sama flage", async () => {
    // RPC zapisu jest upsertem: pole pominiete w ladunku to pole wyczyszczone
    // w bazie. Jedno klikniecie moze wiec po cichu skasowac podpowiedz,
    // kolejnosc albo regule kwalifikujaca.
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(ladunek()).toEqual({
      id: POLE,
      field_type: "text",
      label_pl: "Instytucja",
      label_en: "Institution",
      help_pl: "Instytucja albo firma.",
      help_en: "Employer or organisation.",
      consent_url_pl: "",
      consent_url_en: "",
      is_required: true,
      options: [],
      sort_order: 10,
      is_qualifying: false,
      qualify_operator: "none",
      qualify_value: null,
      qualify_outcome: "approval",
      is_active: false,
    });
  });

  it("KLUCZ NIE JEDZIE W LADUNKU pola istniejacego - odpowiedzi leza pod nim", async () => {
    // `admin_event_registration_field_upsert` czyta `key` tylko przy zakladaniu
    // pola. Wyslanie go przy edycji otwieraloby droge do przemianowania klucza,
    // pod ktorym leza juz zlozone odpowiedzi.
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(Object.keys(ladunek())).not.toContain("key");
    expect(Object.keys(ladunek())).not.toContain("event_id");
    // Same asercje przeczace przeszlyby TAKZE nad ladunkiem pustym, a pusty
    // ladunek w upsercie to wyczyszczony wiersz. Dwie ponizsze mowia, ze
    // wywolanie nadal trafia w to pole i niesie zmiane, o ktora chodzilo.
    expect(ladunek().id).toBe(POLE);
    expect(ladunek().is_active).toBe(false);
  });

  it("wlaczenie pola wylaczonego idzie ta sama droga", async () => {
    daneListy([polePytania({ is_active: false })]);
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(ladunek().is_active).toBe(true);
  });

  it("LISTA WYBORU nie traci wariantow odpowiedzi przy przelaczeniu", async () => {
    // Wariant zgubiony w ladunku to wariant skasowany w bazie - a odpowiedzi
    // zlozone pod jego wartoscia zostaja bez etykiety.
    daneListy([
      polePytania({
        field_type: "select",
        key: "sektor",
        options: [
          { value: "gov", label_pl: "Administracja", label_en: "Government" },
          { value: "ngo", label_pl: "Organizacja pozarzadowa", label_en: "NGO" },
        ],
      }),
    ]);
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(ladunek().options).toEqual([
      { value: "gov", label_pl: "Administracja", label_en: "Government" },
      { value: "ngo", label_pl: "Organizacja pozarzadowa", label_en: "NGO" },
    ]);
  });

  it("REGULA KWALIFIKUJACA przezywa przelaczenie razem z lista wartosci", async () => {
    // Regula porownuje z TABLICA dla operatora `in`. Wyslanie napisu tam, gdzie
    // SQL czyta tablice, daje bramke, ktora nigdy sie nie spelnia - czyli
    // wyglada na dzialajaca i przepuszcza wszystkich.
    daneListy([
      polePytania({
        field_type: "select",
        key: "sektor",
        options: [
          { value: "gov", label_pl: "Administracja", label_en: "Government" },
          { value: "ngo", label_pl: "Organizacja pozarzadowa", label_en: "NGO" },
        ],
        is_qualifying: true,
        qualify_operator: "in",
        qualify_value: ["gov", "ngo"],
        qualify_outcome: "auto_approve",
      }),
    ]);
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(ladunek().is_qualifying).toBe(true);
    expect(ladunek().qualify_operator).toBe("in");
    expect(ladunek().qualify_value).toEqual(["gov", "ngo"]);
    expect(ladunek().qualify_outcome).toBe("auto_approve");
  });

  it("POLE ZGODY nie gubi adresow dokumentu przy przelaczeniu - to tresc prawna", async () => {
    daneListy([
      polePytania({
        field_type: "consent",
        key: "zgoda_rodo",
        consent_url_pl: "https://example.org/zgoda-pl",
        consent_url_en: "https://example.org/zgoda-en",
      }),
    ]);
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await czekajNaZapis();
    expect(ladunek().consent_url_pl).toBe("https://example.org/zgoda-pl");
    expect(ladunek().consent_url_en).toBe("https://example.org/zgoda-en");
  });

  it("przelacznik dotyka DOKLADNIE swojego wiersza", async () => {
    daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "stanowisko", sort_order: 20 })]);
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik(1));

    await czekajNaZapis();
    expect(ladunek().id).toBe(INNE_POLE);
  });

  it("odmowa bazy przy przelaczniku konczy sie ZDANIEM, nie cisza", async () => {
    stub().setError(ZAPIS_RPC, "forbidden: not an event admin", "42501");
    panel();
    await czekajNaListe();

    fireEvent.click(przelacznik());

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: not an event admin"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("RegistrationFieldsPanel - formularz pola, styk z panelem", () => {
  it("„Dodaj pole” otwiera PUSTY formularz z podpowiedziana kolejnoscia", async () => {
    daneListy([polePytania({ sort_order: 120 })]);
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));

    expect(formularz()).toHaveAttribute("data-pole", "nowy");
    expect(formularz()).toHaveAttribute("data-kolejnosc", "130");
  });

  it("KOLEJNOSC NOWEGO POLA LICZY SIE Z NAJWIEKSZEJ, nie z ostatniego wiersza listy", async () => {
    // Gdyby podpowiedz brala kolejnosc ostatniego wiersza, nowe pole wpadloby
    // w srodek formularza - a kolejnosc pytan jest trescia redakcyjna.
    daneListy([
      polePytania({ id: POLE, key: "instytucja", sort_order: 300 }),
      polePytania({ id: INNE_POLE, key: "stanowisko", sort_order: 120 }),
    ]);
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));

    expect(formularz()).toHaveAttribute("data-kolejnosc", "310");
  });

  it("pusty formularz startuje od setki, a nie od zera", async () => {
    daneListy([]);
    panel();
    await waitFor(() => expect(screen.getByText(`${T}empty`)).toBeInTheDocument());

    fireEvent.click(przycisk(`${T}addAction`));

    expect(formularz()).toHaveAttribute("data-kolejnosc", "100");
  });

  it("olowek otwiera formularz TEGO wiersza", async () => {
    daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "stanowisko", sort_order: 20 })]);
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}editor.editTitle` }));

    expect(formularz()).toHaveAttribute("data-pole", INNE_POLE);
  });

  it("udany zapis zamyka formularz i mowi o tym wlasnym kluczem", async () => {
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${T}toasts.saved`));
    expect(screen.queryByRole("dialog", { name: "formularz-pola" })).toBeNull();
  });

  it("NOWE POLE niesie klucz i wydarzenie - jedno i drugie tylko przy zakladaniu", async () => {
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await czekajNaZapis();
    expect(ladunek().key).toBe("instytucja");
    expect(ladunek().event_id).toBe(WYDARZENIE);
    expect(ladunek().id).toBeNull();
  });

  it("ODMOWA ZAPISU NIE ZAMYKA formularza - wpisana praca zostaje na ekranie", async () => {
    stub().setError(ZAPIS_RPC, "duplicate_key: field key already used", "23505");
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:duplicate_key: field key already used"),
    );
    expect(formularz()).toBeInTheDocument();
  });

  it("zamkniecie formularza przez uzytkownika nie wysyla niczego", async () => {
    panel();
    await czekajNaListe();

    fireEvent.click(przycisk(`${T}addAction`));
    fireEvent.click(screen.getByTestId("formularz-zamknij"));

    expect(screen.queryByRole("dialog", { name: "formularz-pola" })).toBeNull();
    expect(stub().callsFor(ZAPIS_RPC)).toHaveLength(0);
  });
});

describe("RegistrationFieldsPanel - usuniecie pola prowadzi przez potwierdzenie", () => {
  it("kosz NIE kasuje od razu - najpierw pyta", async () => {
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}editor.deleteAction` }));

    expect(okno()).toBeInTheDocument();
    expect(stub().callsFor(KASOWANIE_RPC)).toHaveLength(0);
  });

  it("potwierdzenie mowi WPROST, ze zlozone odpowiedzi zostaja w zgloszeniach", async () => {
    // Definicja znika, tresc zostaje - i to jest wlasciwe zachowanie, ale
    // organizator musi je uslyszec PRZED klikieciem, a nie odkryc w eksporcie.
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}editor.deleteAction` }));

    expect(within(okno()).getByText(`${T}editor.deleteConfirm`)).toBeInTheDocument();
  });

  it("potwierdzenie kasuje TEN wiersz i mowi o tym", async () => {
    daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "stanowisko", sort_order: 20 })]);
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}editor.deleteAction` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}editor.deleteAction` }));

    await waitFor(() => expect(stub().lastCall(KASOWANIE_RPC)).toBeDefined());
    expect(stub().lastCall(KASOWANIE_RPC)?.arg("_id")).toBe(INNE_POLE);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${T}toasts.deleted`));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("odmowa bazy przy usunieciu jest ZDANIEM i nie udaje sukcesu", async () => {
    stub().setError(KASOWANIE_RPC, "field_in_use: 12 answer(s)", "23503");
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}editor.deleteAction` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}editor.deleteAction` }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:field_in_use: 12 answer(s)"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rezygnacja z potwierdzenia nie kasuje niczego", async () => {
    panel();
    await czekajNaListe();

    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}editor.deleteAction` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}editor.cancelAction` }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(stub().callsFor(KASOWANIE_RPC)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: potwierdzenie usuniecia NIE MOWI, KTOREGO POLA DOTYCZY. Okno niesie
  // wylacznie zdanie ogolne („Usunac definicje pola? Zlozone odpowiedzi
  // zostana..."), a przyciski kosza w kazdym wierszu sa identyczne i bezimienne
  // (ta sama ikona, ta sama nazwa dostepna). Przy formularzu o kilkunastu
  // pytaniach organizator potwierdza w ciemno: okno nie powtarza ani etykiety,
  // ani klucza, ani liczby odpowiedzi, ktore wlasnie osieroci. Usuniecie nie ma
  // cofniecia - definicja z wariantami odpowiedzi i regula kwalifikujaca znika
  // z bazy, a odtworzyc trzeba ja recznie.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: potwierdzenie usuniecia nie nazywa pola - przy kilkunastu pytaniach organizator potwierdza w ciemno",
    async () => {
      daneListy([polePytania(), polePytania({ id: INNE_POLE, key: "stanowisko", sort_order: 20 })]);
      panel();
      await czekajNaListe();

      fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}editor.deleteAction` }));

      expect(within(okno()).getByText(/stanowisko/)).toBeInTheDocument();
    },
  );
});

describe("RegistrationFieldsPanel - dostepnosc", () => {
  it("lista pol nie ma naruszen axe", async () => {
    daneListy([
      polePytania(),
      polePytania({ id: INNE_POLE, key: "stanowisko", is_qualifying: true, sort_order: 20 }),
    ]);
    const { container } = panel();
    await czekajNaListe();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan pusty i stan awarii tez nie maja naruszen axe", async () => {
    daneListy([]);
    const pusty = panel();
    await waitFor(() => expect(screen.getByText(`${T}empty`)).toBeInTheDocument());
    const bezPol = await axeViolations(pusty.container);
    expect(bezPol, summarize(bezPol)).toEqual([]);
    pusty.unmount();

    stub().setError(LISTA_RPC, "forbidden: not an event admin", "42501");
    const awaria = panel();
    await waitFor(() =>
      expect(screen.getByText("odmowa:forbidden: not an event admin")).toBeInTheDocument(),
    );
    const naruszenia = await axeViolations(awaria.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("obie ikony wiersza maja nazwy - inaczej czytnik oglasza dwa bezimienne przyciski", async () => {
    panel();
    await czekajNaListe();

    expect(
      within(wiersz()).getByRole("button", { name: `${T}editor.editTitle` }),
    ).toBeInTheDocument();
    expect(
      within(wiersz()).getByRole("button", { name: `${T}editor.deleteAction` }),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: przelacznik „pole aktywne" dostaje w KAZDYM wierszu te sama
  // etykiete. Osoba korzystajaca z czytnika slyszy N razy „Pole aktywne" i nie
  // wie, KTORE pytanie wlasnie zdejmuje z formularza zgloszenia. axe tego nie
  // zlapie: formalnie kazdy przelacznik MA nazwe. Etykieta powinna niesc
  // etykiete pola. To ten sam defekt, ktory jest juz zarejestrowany na liscie
  // poziomow sponsorskich (`SponsorTiersPanel.test.tsx`) - wspolna przyczyna
  // siedzi we wzorcu wiersza listy, nie w tym jednym ekranie.
  //
  // MIERZYMY ROZNICE NAZW, a nie liczbe trafien po nazwie wspolnej: zapytanie
  // o nazwe wspolna po poprawce nie znalazloby NICZEGO i wpis rejestru zostalby
  // czerwony takze nad kodem juz naprawionym.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: przelaczniki „aktywne” w dwoch wierszach maja IDENTYCZNA nazwe - czytnik nie mowi, ktorego pytania dotycza",
    async () => {
      daneListy([
        polePytania({ label_pl: "Instytucja" }),
        polePytania({ id: INNE_POLE, key: "stanowisko", label_pl: "Stanowisko", sort_order: 20 }),
      ]);
      panel();
      await czekajNaListe();

      const nazwy = [przelacznik(0), przelacznik(1)].map((s) => s.getAttribute("aria-label"));
      expect(new Set(nazwy).size).toBe(2);
    },
  );
});

// ---------------------------------------------------------------------------
// DEFEKT: pole zgody nie pokazuje ANI JEDNEGO ze swoich dwoch dokumentow.
// Zgoda jest trescia prawna w DWOCH wersjach jezykowych (`consent_url_pl`,
// `consent_url_en`), obie sa opcjonalne (kolumny maja DEFAULT '') i obie
// wchodza do formularza uczestnika. Wiersz listy nie niesie zadnej z nich, wiec
// pole z dokumentem WYLACZNIE po polsku wyglada dokladnie tak samo jak pole
// z kompletem - a uczestnik anglojezyczny dostaje pytanie o zgode bez tresci,
// na ktora sie godzi. Jedyny sposob, zeby to zauwazyc, to otworzyc kazde pole
// zgody po kolei.
// ---------------------------------------------------------------------------
describe("RegistrationFieldsPanel - dokument zgody", () => {
  it.fails(
    "DEFEKT: wiersz pola zgody nie pokazuje dokumentu - brak wersji angielskiej jest niewidoczny",
    async () => {
      daneListy([
        polePytania({
          field_type: "consent",
          key: "zgoda_rodo",
          label_pl: "Zgoda na przetwarzanie",
          consent_url_pl: "https://example.org/zgoda-pl",
          consent_url_en: "",
        }),
      ]);
      panel();
      await czekajNaListe();

      expect(within(wiersz()).getByText(/zgoda-pl/)).toBeInTheDocument();
    },
  );
});
