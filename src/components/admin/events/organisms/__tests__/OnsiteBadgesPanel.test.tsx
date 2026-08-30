// Organizm „IDENTYFIKATORY" - szablony wydruku i rejestr tego, co już wyszło
// z drukarki.
//
// CO TEN PLIK DOWODZI.
//   1. DWIE LISTY MAJĄ DWA NIEZALEŻNE KOMPLETY STANÓW. Szablony i rejestr
//      wydruków to osobne zapytania: awaria jednego nie ma prawa wygasić
//      drugiego ani podszyć się pod jego pustkę. Awaria rejestru mówiąca
//      „nic jeszcze nie drukowano" kończy się drugim wydrukiem tej samej osoby
//      - a wydanie identyfikatora ROTUJE kod QR, więc poprzedni przestaje
//      wpuszczać.
//   2. WYDRUK ZE STAREJ WERSJI SZABLONU JEST ODZNACZONY. `template_version <
//      template_current_version` znaczy „ten identyfikator wygląda inaczej niż
//      dzisiejszy szablon"; bez odznaki organizator szuka usterki drukarki.
//      Granica jest ostra i ma trzy przypadki: starsza, równa, nowsza.
//   3. LICZNIK WYDRUKÓW STOI PRZY SZABLONIE. Szablon z wydrukami to odmowa
//      `template_in_use` - liczba w wierszu zamienia odmowę bazy w decyzję
//      podjętą PRZED kliknięciem kosza.
//   4. KASOWANIE JEST ZA POTWIERDZENIEM i idzie z identyfikatorem TEGO wiersza,
//      nie pierwszego z listy. Bez potwierdzenia mutacja nie wychodzi wcale.
//   5. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA - inaczej redaktor traci wypełnione
//      pola szablonu; sukces zamyka i czyści tryb edycji.
//   6. `total_count` PRZYCHODZI W WIERSZU rejestru, a strona zmienia OFFSET.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) FORMULARZA szablonu - ma własny, obszerny
// plik `BadgeTemplateDialog.test.tsx`; tutaj jest atrapą, bo przedmiotem
// dowodu jest to, Z CZYM panel go otwiera i co robi z wynikiem. (2) Słownika
// odmów bazy. (3) Formatu daty wydruku - `toLocaleString` zależy od wersji ICU.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type {
  BadgePrintRow,
  BadgePrintsQuery,
  BadgeTemplateInput,
  BadgeTemplateRow,
} from "@/lib/events/onsiteApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  szablony: [] as unknown[] | undefined,
  szablonyLoading: false,
  szablonyError: null as unknown,
  wydruki: [] as unknown[] | undefined,
  wydrukiLoading: false,
  wydrukiError: null as unknown,
  zapytaniaWydrukow: [] as unknown[],
  zapisy: [] as unknown[],
  zapisBlad: null as unknown,
  zapisPending: false,
  kasowania: [] as string[],
  kasowanieBlad: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Select (stopka paginacji rejestru) nie otwiera listy pod happy-dom.
// Atrapa przenosi z wyzwalacza `id`, `aria-label` i `aria-labelledby` - to
// ostatnie jest jedyną nazwą dostępną droplist paginacji.
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  interface WyzwalaczProps {
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  }
  const jestWyzwalacz = (node: ReactNode): node is ReactElement<WyzwalaczProps> =>
    react.isValidElement<WyzwalaczProps>(node) &&
    ("aria-label" in node.props || "aria-labelledby" in node.props || "id" in node.props);
  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange?: (next: string) => void;
      disabled?: boolean;
      children?: ReactNode;
    }) => {
      const parts = react.Children.toArray(children);
      const wyzwalacz = parts.find(jestWyzwalacz);
      const tresc = parts.filter((part) => part !== wyzwalacz);
      return (
        <select
          id={wyzwalacz?.props.id}
          aria-label={wyzwalacz?.props["aria-label"]}
          aria-labelledby={wyzwalacz?.props["aria-labelledby"]}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {value === undefined ? <option value="" /> : null}
          {tresc}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

// Okno potwierdzenia: treść istnieje TYLKO przy otwartym oknie (Radix nie
// montuje portalu), a „Anuluj" zamyka je tą samą drogą co Radix - przez
// `onOpenChange`. Bez tego „bez potwierdzenia nic nie leci" byłoby dowodem
// na atrapę, a nie na organizm.
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
      return (
        <div>
          {/* Radix woła `onOpenChange(true)` przy przechwyceniu fokusa; happy-dom
              tej ścieżki nie wywoła, a to ona decyduje, czy wybrany do skasowania
              wiersz przetrwa. */}
          <button
            type="button"
            data-testid="okno-otworz"
            aria-label="atrapa: przechwycenie fokusa przez Radix"
            onClick={() => onOpenChange?.(true)}
          />
          {children}
        </div>
      );
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

// Formularz szablonu ma WŁASNY plik testowy (formaty papieru, wymiary, kolor
// tła, kod QR). Tutaj interesuje nas wyłącznie STYK: z czym panel go otwiera
// i co robi z ładunkiem.
vi.mock("@/components/admin/events/molecules/BadgeTemplateDialog", () => ({
  BadgeTemplateDialog: ({
    open,
    onOpenChange,
    eventId,
    template,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    template: BadgeTemplateRow | null;
    isSaving: boolean;
    onSubmit: (input: BadgeTemplateInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-szablonu"
        data-szablon={template === null ? "nowy" : template.id}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: template === null ? undefined : template.id,
              eventId,
              name: "Identyfikator gościa",
              paperFormat: "a6",
              orientation: "portrait",
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
        {/* Radix zgłasza `onOpenChange(true)` przy ponownym przechwyceniu fokusa -
            to ta ścieżka decyduje, czy edytowany szablon przetrwa. */}
        <button type="button" data-testid="formularz-otworz" onClick={() => onOpenChange(true)} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventOnsite", () => ({
  useBadgeTemplates: () => ({
    data: h.szablony,
    isLoading: h.szablonyLoading,
    error: h.szablonyError,
  }),
  useBadgePrints: (query: BadgePrintsQuery) => {
    h.zapytaniaWydrukow.push(query);
    return { data: h.wydruki, isLoading: h.wydrukiLoading, error: h.wydrukiError };
  },
  useSaveBadgeTemplate: () => ({
    mutate: (input: BadgeTemplateInput, wynik: Wynik<string>) => {
      h.zapisy.push(input);
      if (h.zapisBlad === null) wynik.onSuccess?.("ok");
      else wynik.onError?.(h.zapisBlad);
    },
    isPending: h.zapisPending,
  }),
  useDeleteBadgeTemplate: () => ({
    mutate: (id: string, wynik: Wynik<boolean>) => {
      h.kasowania.push(id);
      if (h.kasowanieBlad === null) wynik.onSuccess?.(true);
      else wynik.onError?.(h.kasowanieBlad);
    },
    isPending: false,
  }),
}));

import { OnsiteBadgesPanel } from "@/components/admin/events/organisms/OnsiteBadgesPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const SZABLON = "22222222-2222-4222-8222-222222222222";
const INNY_SZABLON = "33333333-3333-4333-8333-333333333333";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_badge_prints_list` oddaje `device_label` (wydruk z panelu nie ma
 * urządzenia), `printed_by_name` (wydruk z urządzenia nie ma operatora) oraz
 * imiona osób bez profilu jako NULL. Organizm ma na to jawny filtr
 * `part !== null && part !== ""`, więc fixtura musi umieć oddać `null`.
 */
const BRAK = null as unknown as string;

/** Szablon domyślny, jeszcze nigdy niedrukowany. */
function szablon(overrides: Partial<BadgeTemplateRow> = {}): BadgeTemplateRow {
  return {
    background_color: "#ffffff",
    background_image_url: BRAK,
    created_at: "2026-08-01T10:00:00.000Z",
    double_fold: false,
    elements: [],
    event_id: WYDARZENIE,
    height_mm: 148,
    id: SZABLON,
    is_default: true,
    last_printed_at: BRAK,
    name: "Identyfikator gościa",
    orientation: "portrait",
    paper_format: "a6",
    printed_people_count: 0,
    prints_count: 0,
    qr_size_mm: 24,
    show_qr: true,
    stale_prints_count: 0,
    updated_at: "2026-08-01T10:00:00.000Z",
    version: 1,
    width_mm: 105,
    ...overrides,
  };
}

/** Wydruk z aktualnej wersji szablonu. */
function wydruk(overrides: Partial<BadgePrintRow> = {}): BadgePrintRow {
  return {
    company: "Instytut Analiz",
    copies: 1,
    device_id: BRAK,
    device_label: BRAK,
    first_name: "Anna",
    id: "44444444-4444-4444-8444-444444444444",
    last_name: "Kowalska",
    note: BRAK,
    person_id: "55555555-5555-4555-8555-555555555555",
    printed_at: "2026-09-01T08:15:00.000Z",
    printed_by: "66666666-6666-4666-8666-666666666666",
    printed_by_name: "Obsługa rejestracji",
    reason: "first_issue",
    registration_id: "77777777-7777-4777-8777-777777777777",
    registration_status: "approved",
    template_current_version: 3,
    template_id: SZABLON,
    template_name: "Identyfikator gościa",
    template_version: 3,
    total_count: 1,
    ...overrides,
  };
}

function panel() {
  return render(<OnsiteBadgesPanel eventId={WYDARZENIE} />);
}

/**
 * Sekcję rozpoznajemy po JEJ NAGŁÓWKU, a nie po kolejności list na ekranie:
 * przy wczytywaniu jednej z dwóch list „pierwsza lista w drzewie" należy już
 * do drugiej sekcji i asercja mierzyłaby nie to, co trzeba.
 */
const sekcja = (klucz: string): HTMLElement => {
  const naglowek = screen.getByRole("heading", { level: 3, name: `${T}.badges.${klucz}` });
  const rodzic = naglowek.parentElement;
  if (rodzic === null) throw new Error(`sekcja ${klucz} nie ma kontenera`);
  return rodzic;
};

const wierszeSzablonow = (): HTMLElement[] =>
  within(sekcja("templatesTitle")).queryAllByRole("listitem");

const wierszeWydrukow = (): HTMLElement[] =>
  within(sekcja("printsTitle")).queryAllByRole("listitem");

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-szablonu" });

const okno = (): HTMLElement => screen.getByRole("alertdialog");

beforeEach(() => {
  h.lang = "pl";
  h.szablony = [szablon()];
  h.szablonyLoading = false;
  h.szablonyError = null;
  h.wydruki = [wydruk()];
  h.wydrukiLoading = false;
  h.wydrukiError = null;
  h.zapytaniaWydrukow = [];
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy szablonów", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego szablonu", () => {
    h.szablonyLoading = true;
    h.szablony = undefined;
    panel();

    expect(screen.getByText(`${T}.badges.loading`)).toBeTruthy();
    expect(wierszeSzablonow()).toHaveLength(0);
    expect(screen.queryByText(`${T}.badges.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że szablonów nie ma", () => {
    h.szablony = undefined;
    h.szablonyError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.badges.empty`)).toBeNull();
  });

  it("brak szablonów to „pusto”, a nie awaria", () => {
    h.szablony = [];
    panel();

    expect(screen.getByText(`${T}.badges.empty`)).toBeTruthy();
  });

  it("awaria SZABLONÓW nie gasi rejestru wydruków - to dwa osobne zapytania", () => {
    h.szablony = undefined;
    h.szablonyError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("Anna Kowalska")).toBeTruthy();
  });
});

describe("cztery stany rejestru wydruków", () => {
  it("zapytanie w locie mówi „wczytywanie rejestru”", () => {
    h.wydrukiLoading = true;
    h.wydruki = undefined;
    panel();

    expect(screen.getByText(`${T}.badges.printsLoading`)).toBeTruthy();
    expect(screen.queryByText(`${T}.badges.printsEmpty`)).toBeNull();
  });

  it("awaria rejestru NIE MOŻE mówić „nic nie drukowano”", () => {
    h.wydruki = undefined;
    h.wydrukiError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.badges.printsEmpty`)).toBeNull();
  });

  it("pusty rejestr to „nic jeszcze nie drukowano”, a nie awaria", () => {
    h.wydruki = [];
    panel();

    expect(screen.getByText(`${T}.badges.printsEmpty`)).toBeTruthy();
  });

  it("brak awarii wyrażony jako `undefined` (nie `null`) też nie jest awarią", () => {
    // Warstwa danych oddaje `null`, ale organizm pilnuje OBU wartości - hook
    // podmieniony w teście albo inna wersja React Query mogą dać `undefined`,
    // a wtedy „brak błędu" nie ma prawa zamienić się w komunikat odmowy.
    h.szablonyError = undefined;
    h.wydrukiError = undefined;
    h.szablony = [];
    h.wydruki = [];
    panel();

    expect(screen.getByText(`${T}.badges.empty`)).toBeTruthy();
    expect(screen.getByText(`${T}.badges.printsEmpty`)).toBeTruthy();
  });

  it("awaria REJESTRU nie gasi listy szablonów", () => {
    h.wydruki = undefined;
    h.wydrukiError = new Error("permission_denied: brak dostępu");
    panel();

    expect(wierszeSzablonow()).toHaveLength(1);
  });
});

describe("wiersz szablonu", () => {
  it("mówi nazwę, format papieru, orientację i wersję", () => {
    panel();
    const wiersz = wierszeSzablonow()[0];

    expect(within(wiersz).getByText("Identyfikator gościa")).toBeTruthy();
    expect(wiersz.textContent).toContain(`${T}.paperFormats.a6`);
    expect(wiersz.textContent).toContain(`${T}.orientations.portrait`);
    expect(wiersz.textContent).toContain("v1");
  });

  it("szablon domyślny jest odznaczony, a pozostałe nie", () => {
    h.szablony = [szablon(), szablon({ id: INNY_SZABLON, is_default: false, name: "Prasa" })];
    panel();

    expect(within(wierszeSzablonow()[0]).getByText(`${T}.badges.isDefault`)).toBeTruthy();
    expect(within(wierszeSzablonow()[1]).queryByText(`${T}.badges.isDefault`)).toBeNull();
  });

  it("licznik wydruków stoi przy szablonie - to on rozstrzyga o kasowaniu", () => {
    h.szablony = [szablon({ prints_count: 128 })];
    panel();

    expect(wierszeSzablonow()[0].textContent).toContain(`${T}.stats.badgesPrinted: 128`);
  });

  it("szablon bez ani jednego starego wydruku nie dostaje odznaki starej wersji", () => {
    h.szablony = [szablon({ stale_prints_count: 0 })];
    panel();

    expect(wierszeSzablonow()[0].textContent).not.toContain(`${T}.badges.staleVersion`);
  });

  it("choćby JEDEN wydruk ze starej wersji odznacza szablon", () => {
    h.szablony = [szablon({ stale_prints_count: 1 })];
    panel();

    expect(within(wierszeSzablonow()[0]).getByText(`${T}.badges.staleVersion`)).toBeTruthy();
  });
});

describe("formularz szablonu", () => {
  it("bez kliknięcia formularza nie ma na ekranie", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "formularz-szablonu" })).toBeNull();
  });

  it("„dodaj” otwiera formularz PUSTY, a nie z ostatnio edytowanym szablonem", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));

    expect(formularz().getAttribute("data-szablon")).toBe("nowy");
  });

  it("ołówek otwiera formularz z TYM wierszem", () => {
    h.szablony = [szablon(), szablon({ id: INNY_SZABLON, name: "Prasa" })];
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[1]).getByRole("button", { name: `${T}.badges.dialog.editTitle` }),
    );

    expect(formularz().getAttribute("data-szablon")).toBe(INNY_SZABLON);
  });

  it("po edycji „dodaj” znowu otwiera pusty formularz - tryb edycji jest czyszczony", () => {
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.dialog.editTitle` }),
    );
    fireEvent.click(screen.getByTestId("formularz-zamknij"));
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));

    expect(formularz().getAttribute("data-szablon")).toBe("nowy");
  });

  it("ponowne zgłoszenie otwarcia NIE czyści edytowanego szablonu", () => {
    // Radix zgłasza `onOpenChange(true)` przy przechwyceniu fokusa. Gdyby
    // organizm czyścił tryb edycji na każdą zmianę, a nie tylko na zamknięcie,
    // wpisane pola nagle dotyczyłyby NOWEGO szablonu.
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.dialog.editTitle` }),
    );
    fireEvent.click(screen.getByTestId("formularz-otworz"));

    expect(formularz().getAttribute("data-szablon")).toBe(SZABLON);
  });

  it("zapis w locie jedzie do formularza jako stan „zapisuję”", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));

    expect(formularz().getAttribute("data-zapis")).toBe("true");
  });

  it("udany zapis potwierdza zdaniem i ZAMYKA formularz", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.zapisy).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.badges.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-szablonu" })).toBeNull();
  });

  it("odmowa bazy NIE zamyka formularza - redaktor nie traci wypełnionych pól", () => {
    h.zapisBlad = new Error("template_in_use: 12 prints");
    panel();
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:template_in_use: 12 prints");
    expect(screen.getByRole("dialog", { name: "formularz-szablonu" })).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("edycja wysyła identyfikator wiersza, a nowy szablon nie wysyła żadnego", () => {
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.dialog.editTitle` }),
    );
    fireEvent.click(screen.getByTestId("formularz-zapisz"));
    fireEvent.click(przycisk(`${T}.actions.addTemplate`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect((h.zapisy[0] as BadgeTemplateInput).id).toBe(SZABLON);
    expect((h.zapisy[1] as BadgeTemplateInput).id).toBeUndefined();
  });
});

describe("kasowanie szablonu", () => {
  it("kosz sam z siebie NIC nie kasuje - najpierw pada pytanie", () => {
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.deleteConfirm` }),
    );

    expect(h.kasowania).toHaveLength(0);
    expect(within(okno()).getByText(`${T}.badges.deleteConfirm`)).toBeTruthy();
  });

  it("potwierdzenie kasuje TEN wiersz, nie pierwszy z listy", () => {
    h.szablony = [szablon(), szablon({ id: INNY_SZABLON, name: "Prasa" })];
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[1]).getByRole("button", { name: `${T}.badges.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.kasowania).toEqual([INNY_SZABLON]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.badges.toasts.deleted`);
  });

  it("przechwycenie fokusa przez Radix nie gubi wiersza wybranego do skasowania", () => {
    h.szablony = [szablon(), szablon({ id: INNY_SZABLON, name: "Prasa" })];
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[1]).getByRole("button", { name: `${T}.badges.deleteConfirm` }),
    );
    fireEvent.click(screen.getByTestId("okno-otworz"));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.kasowania).toEqual([INNY_SZABLON]);
  });

  it("anulowanie zamyka pytanie i nie wysyła nic do bazy", () => {
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.cancel` }));

    expect(h.kasowania).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("odmowa `template_in_use` kończy się zdaniem i zamyka pytanie", () => {
    h.kasowanieBlad = new Error("template_in_use: 12 prints");
    panel();
    fireEvent.click(
      within(wierszeSzablonow()[0]).getByRole("button", { name: `${T}.badges.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:template_in_use: 12 prints");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("wiersz rejestru wydruków", () => {
  it("mówi kto, z jakiego szablonu i kto drukował", () => {
    panel();
    const wiersz = wierszeWydrukow()[0];

    expect(within(wiersz).getByText("Anna Kowalska")).toBeTruthy();
    expect(wiersz.textContent).toContain("Identyfikator gościa · Obsługa rejestracji");
  });

  it("wydruk z urządzenia niesie etykietę urządzenia", () => {
    h.wydruki = [wydruk({ device_label: "Drukarka rejestracja 2", printed_by_name: BRAK })];
    panel();

    expect(wierszeWydrukow()[0].textContent).toContain(
      "Identyfikator gościa · Drukarka rejestracja 2",
    );
  });

  it("wydruk z AKTUALNEJ wersji szablonu nie jest odznaczony jako stary", () => {
    h.wydruki = [wydruk({ template_version: 3, template_current_version: 3 })];
    panel();

    expect(wierszeWydrukow()[0].textContent).not.toContain(`${T}.badges.staleVersion`);
  });

  it("wydruk ze STARSZEJ wersji szablonu jest odznaczony", () => {
    h.wydruki = [wydruk({ template_version: 2, template_current_version: 3 })];
    panel();

    expect(within(wierszeWydrukow()[0]).getByText(`${T}.badges.staleVersion`)).toBeTruthy();
  });

  it("liczba kopii stoi w wierszu - dwie kopie to nie to samo, co dwa wydruki", () => {
    h.wydruki = [wydruk({ copies: 2 })];
    panel();

    expect(wierszeWydrukow()[0].textContent).toContain("×2");
  });

  it('strażnik `?? ""` przy nazwisku trzyma - inaczej w rejestrze stanęłoby „null null”', () => {
    // UCZCIWIE: DZIŚ ta sytuacja nie może zajść - `admin_event_badge_prints_list`
    // łączy `event_people` INNER JOIN-em, a imię i nazwisko są tam NOT NULL.
    // Wygenerowany typ tego nie wyraża, a organizm ma jawny `?? ""`; ten
    // przypadek pilnuje strażnika na wypadek zmiany złączenia.
    h.wydruki = [wydruk({ first_name: BRAK, last_name: BRAK })];
    panel();

    expect(wierszeWydrukow()[0].querySelector("p")?.textContent).toBe("");
  });
});

describe("paginacja rejestru", () => {
  it("pierwsza strona pyta o pięćdziesiąt... a właściwie o dwadzieścia wierszy od zera", () => {
    panel();

    expect(h.zapytaniaWydrukow[0]).toEqual({ eventId: WYDARZENIE, limit: 20, offset: 0 });
  });

  it("łączna liczba jest brana z wiersza, a nie z długości strony", () => {
    h.wydruki = [wydruk({ total_count: 240 })];
    panel();

    expect(screen.getByText("admin.pagination.range(end=20,start=1,total=240)")).toBeTruthy();
  });

  it("pusty rejestr nie rysuje stopki paginacji", () => {
    h.wydruki = [];
    panel();

    expect(screen.queryByText(/admin\.pagination\.range/)).toBeNull();
  });

  it("zmiana strony przesuwa offset o pełną stronę", () => {
    h.wydruki = [wydruk({ total_count: 240 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "4" },
    });

    const ostatnie = h.zapytaniaWydrukow[h.zapytaniaWydrukow.length - 1] as BadgePrintsQuery;
    expect(ostatnie.offset).toBe(60);
  });

  it("zmiana rozmiaru strony wraca na pierwszą stronę", () => {
    h.wydruki = [wydruk({ total_count: 240 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.perPage" }), {
      target: { value: "100" },
    });

    const ostatnie = h.zapytaniaWydrukow[h.zapytaniaWydrukow.length - 1] as BadgePrintsQuery;
    expect(ostatnie).toMatchObject({ limit: 100, offset: 0 });
  });
});

describe("dostępność", () => {
  it("obie listy razem nie mają naruszeń dostępności", async () => {
    h.wydruki = [wydruk({ total_count: 240 })];
    const { container } = panel();
    await screen.findByText("Anna Kowalska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("obie listy puste też nie mają naruszeń dostępności", async () => {
    h.szablony = [];
    h.wydruki = [];
    const { container } = panel();
    await screen.findByText(`${T}.badges.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
