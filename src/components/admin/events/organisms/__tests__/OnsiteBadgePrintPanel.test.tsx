// Organizm „GENERATOR IDENTYFIKATORÓW" - wybór osób i wysłanie ich na papier.
//
// DLACZEGO TEN PLIK PATRZY TAK OSTRO NA TREŚĆ WYDRUKU. Wydanie partii ROTUJE
// kod QR: `admin_event_badge_batch` nadpisuje skrót kodu, więc poprzedni
// identyfikator tej osoby przestaje wpuszczać. Wydruk z pomyłką nie jest więc
// zmarnowaną kartką - to człowiek, który stoi przy bramce z martwym kodem.
//
// CO TEN PLIK DOWODZI.
//   1. TO, CO IDZIE NA PAPIER, JEST CZYTANE Z WIERSZA ODDANEGO PRZEZ BAZĘ,
//      a nie z wiersza wyszukiwarki ani z niczego zmyślonego w komponencie.
//      Dowodzimy tego wierszem ROZBIEŻNYM: lista wyszukiwania pokazuje jedno
//      nazwisko, partia z bazy oddaje inne - i to DRUGIE ma stanąć na karcie.
//      `buildBadgePrintDocument` jest tu PRAWDZIWY, bo inaczej ten dowód
//      dotyczyłby atrapy.
//   2. PARTIA WYCHODZI DOPIERO PO KLIKNIĘCIU. Żadnego wydania „w tle" przy
//      renderze - inaczej samo wejście na zakładkę unieważniałoby kody.
//   3. OKNO DRUKU OTWIERA SIĘ PRZED `await`. Przeglądarka wiąże `window.open`
//      z gestem użytkownika; zablokowane okienko kończy się zdaniem, a NIE
//      cichym wydaniem partii, po którym nikt niczego nie wydrukował.
//   4. KOD JAWNY ŻYJE TYLKO W PAMIĘCI. Trafia do obrazka QR w dokumencie druku;
//      osoba bez zapisu (bez kodu) dostaje kartę z napisem zamiast kodu.
//   5. ODMOWA BAZY ZAMYKA OKNO DRUKU. Puste okienko zostawione na ekranie to
//      wydruk pustej strony na papierze identyfikatorowym.
//   6. REJESTR WYDRUKÓW ZAPISUJE SIĘ PO FAKCIE, PER OSOBA, a jego błąd NIE
//      cofa już wydanych kodów - zgłaszamy go i idziemy dalej.
//   7. ROZMIAR KARTY BIERZE SIĘ Z SZABLONU, a bez szablonu - z wartości
//      zapasowej modułu; jedno i drugie widać w wygenerowanym dokumencie.
//
// JEDEN DEFEKT UDOKUMENTOWANY JAKO `it.fails` przy ostrzeżeniu o powtórnym
// wydruku i jeden przy powodzie wydruku (opisy przy przypadkach).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Składni dokumentu druku i tabel rozmiarów -
// mają własne pliki `lib/events/__tests__/badgeSheet.test.ts`; tutaj są
// PRAWDZIWE, ale asercje dotyczą wyłącznie tego, CZY dane z wiersza tam
// docierają. (2) Generatora QR - `qrcode` jest atrapą oddającą przewidywalny
// napis, bo przedmiotem dowodu jest to, CO trafia do kodu.
//
// RODO: dane w fixture'ach są zmyślone; adresy - gdyby były potrzebne - mają
// zostać w domenie `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { BADGE_PRINT_REASONS } from "@/lib/events/onsiteEnums";
import type { BadgeBatch, BadgeCard } from "@/lib/events/badgeSheet";
import type { BadgePrintInput, BadgeTemplateRow, CheckinSearchRow } from "@/lib/events/onsiteApi";

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  szablony: [] as unknown[] | undefined,
  zapytania: [] as unknown[],
  partie: [] as unknown[],
  partiaWynik: null as unknown,
  partiaBlad: null as unknown,
  partiaPending: false,
  rejestr: [] as unknown[],
  rejestrBlad: null as unknown,
  /** Wszystko, co panel wpisał do okna druku. */
  napisane: [] as string[],
  oknoZamkniete: 0,
  oknoWydrukowane: 0,
  /** `false` = przeglądarka zablokowała wyskakujące okienko. */
  oknoOtwieralne: true,
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

// Generator kodu QR oddaje przewidywalny napis - dowodzimy, CO panel do niego
// wysyła i czy wynik dochodzi do dokumentu druku, a nie jak wygląda bitmapa.
vi.mock("qrcode", () => {
  const toDataURL = (value: string) => Promise.resolve(`data:image/png;kod=${value}`);
  return { default: { toDataURL }, toDataURL };
});

// Radix Checkbox nie przełącza się pod happy-dom bez pointer API, a zaznaczanie
// osób jest tu całą treścią zachowania. Atrapa zachowuje `aria-label`, po
// którym wiersz da się znaleźć nazwiskiem - dokładnie jak w produkcji.
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
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
      aria-label={reszta["aria-label"]}
      checked={checked === true}
      onChange={() => onCheckedChange?.(checked !== true)}
    />
  ),
}));

// Radix Select nie otwiera listy pod happy-dom. Atrapa przenosi z wyzwalacza
// `id`, `aria-label` i `aria-labelledby`, więc droplista szablonów zachowuje
// nazwę dostępną.
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

vi.mock("@/lib/events/useEventOnsite", () => ({
  useCheckinSearch: (eventId: string, q: string) => {
    h.zapytania.push({ eventId, q });
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useBadgeTemplates: () => ({ data: h.szablony, isLoading: false, error: null }),
  useIssueBadgeBatch: () => ({
    mutateAsync: (input: unknown) => {
      h.partie.push(input);
      return h.partiaBlad === null ? Promise.resolve(h.partiaWynik) : Promise.reject(h.partiaBlad);
    },
    isPending: h.partiaPending,
  }),
  useRecordBadgePrint: () => ({
    mutateAsync: (input: BadgePrintInput) => {
      h.rejestr.push(input);
      return h.rejestrBlad === null ? Promise.resolve({}) : Promise.reject(h.rejestrBlad);
    },
    isPending: false,
  }),
}));

import { OnsiteBadgePrintPanel } from "@/components/admin/events/organisms/OnsiteBadgePrintPanel";

const T = "adminEventOnsite.print";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const TYTUL = "Kongres CEE 2026";
const OSOBA = "22222222-2222-4222-8222-222222222222";
const INNA_OSOBA = "33333333-3333-4333-8333-333333333333";
const SZABLON = "44444444-4444-4444-8444-444444444444";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_checkin_search` oddaje `company`, `job_title`, `group_name_pl`
 * i `registration_id` jako NULL (osoba bez firmy w profilu, bez grupy, bez
 * zapisu), a wygenerowany typ obiecuje `string`. Organizm ma na to jawne
 * warunki (`filter((part) => part !== null)`, `badgeLocalized(... ) === null`),
 * więc fixtura musi umieć oddać właśnie `null`.
 */
const BRAK = null as unknown as string;

/** Osoba z listy wyszukiwania - z niej bierze się WYŁĄCZNIE identyfikator. */
function osoba(overrides: Partial<CheckinSearchRow> = {}): CheckinSearchRow {
  return {
    badge_printed: false,
    company: "Instytut Analiz",
    first_name: "Anna",
    group_name_en: "Speakers",
    group_name_pl: "Prelegenci",
    job_title: "Analityczka",
    last_checkin_at: BRAK,
    last_checkin_direction: BRAK,
    last_name: "Kowalska",
    person_id: OSOBA,
    registration_id: "55555555-5555-4555-8555-555555555555",
    registration_status: "approved",
    ticket_name_en: "Standard",
    ticket_name_pl: "Standardowy",
    ...overrides,
  };
}

/** Karta z partii oddanej przez bazę - TO ona ląduje na papierze. */
function karta(overrides: Partial<BadgeCard> = {}): BadgeCard {
  return {
    personId: OSOBA,
    firstName: "Anna",
    lastName: "Kowalska",
    jobTitle: "Analityczka",
    company: "Instytut Analiz",
    registrationId: "55555555-5555-4555-8555-555555555555",
    registrationStatus: "approved",
    ticketNamePl: "Standardowy",
    ticketNameEn: "Standard",
    groupNamePl: "Prelegenci",
    groupNameEn: "Speakers",
    groupColor: "#ff8800",
    qrCode: "kod-anny",
    ...overrides,
  };
}

function partia(badges: BadgeCard[] = [karta()], templateId: string | null = null): BadgeBatch {
  return {
    eventId: WYDARZENIE,
    templateId,
    issuedAt: "2026-09-01T08:00:00.000Z",
    badges,
  };
}

/** Szablon A6 pionowy z kodem QR - wymiary 105 × 148 mm. */
function szablon(overrides: Partial<BadgeTemplateRow> = {}): BadgeTemplateRow {
  return {
    background_color: "#f0f0f0",
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

function panel() {
  return render(<OnsiteBadgePrintPanel eventId={WYDARZENIE} eventTitle={TYTUL} />);
}

const pole = (): HTMLElement => screen.getByLabelText(`${T}.searchLabel`);

const dropListaSzablonow = (): HTMLSelectElement =>
  screen.getByRole("combobox", { name: `${T}.templateLabel` });

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liście osób`);
  return found;
};

/** Wpisanie frazy dłuższej niż dwa znaki - inaczej lista w ogóle się nie rysuje. */
function szukaj(fraza = "Kowalska"): void {
  fireEvent.change(pole(), { target: { value: fraza } });
}

const zaznacz = (nazwa: string): void => {
  fireEvent.click(screen.getByRole("checkbox", { name: nazwa }));
};

const dokument = (): string => h.napisane.join("");

beforeEach(() => {
  h.lang = "pl";
  h.rows = [osoba()];
  h.isLoading = false;
  h.listError = null;
  h.szablony = [];
  h.zapytania = [];
  h.partie = [];
  h.partiaWynik = partia();
  h.partiaBlad = null;
  h.partiaPending = false;
  h.rejestr = [];
  h.rejestrBlad = null;
  h.napisane = [];
  h.oknoZamkniete = 0;
  h.oknoWydrukowane = 0;
  h.oknoOtwieralne = true;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();

  // Okno druku jest jedynym efektem ubocznym tego organizmu. Atrapa notuje
  // WSZYSTKO, co panel do niego wpisał - na tym stoi dowód „treść z wiersza".
  vi.stubGlobal("open", () =>
    h.oknoOtwieralne
      ? {
          document: {
            write: (html: string) => h.napisane.push(html),
            close: () => undefined,
          },
          focus: () => undefined,
          print: () => {
            h.oknoWydrukowane += 1;
          },
          close: () => {
            h.oknoZamkniete += 1;
          },
        }
      : null,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wyszukiwanie osób", () => {
  it("przed wpisaniem dwóch znaków panel prosi o frazę i NIE rysuje listy", () => {
    panel();

    expect(screen.getByText(`${T}.searchHint`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
  });

  it("jeden znak to nadal za mało - baza odmawia krótszym frazom", () => {
    panel();
    szukaj("K");

    expect(screen.getByText(`${T}.searchHint`)).toBeTruthy();
  });

  it("sama spacja nie jest frazą", () => {
    panel();
    szukaj("   ");

    expect(screen.getByText(`${T}.searchHint`)).toBeTruthy();
  });

  it("fraza jedzie do zapytania taka, jaką wpisano", () => {
    panel();
    szukaj("Kowalska");

    expect(h.zapytania[h.zapytania.length - 1]).toEqual({
      eventId: WYDARZENIE,
      q: "Kowalska",
    });
  });

  it("wczytywanie mówi „szukam” i nie rysuje wierszy", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();
    szukaj();

    expect(screen.getByText(`${T}.searchLoading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że nikogo nie znaleziono", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();
    szukaj();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.searchEmpty`)).toBeNull();
  });

  it("brak trafień to „nikogo nie znaleziono”, a nie awaria", () => {
    h.rows = [];
    panel();
    szukaj();

    expect(screen.getByText(`${T}.searchEmpty`)).toBeTruthy();
  });

  it("brak awarii wyrażony jako `undefined` (nie `null`) też nie jest awarią", () => {
    h.listError = undefined;
    h.rows = [];
    panel();
    szukaj();

    expect(screen.getByText(`${T}.searchEmpty`)).toBeTruthy();
  });
});

describe("wiersz osoby na liście wyboru", () => {
  it("mówi imię, nazwisko, stanowisko i firmę", () => {
    panel();
    szukaj();

    expect(within(wiersz()).getByText("Anna Kowalska")).toBeTruthy();
    expect(wiersz().textContent).toContain("Analityczka · Instytut Analiz");
  });

  it("osoba bez firmy nie rysuje pustego separatora", () => {
    h.rows = [osoba({ company: BRAK })];
    panel();
    szukaj();

    expect(wiersz().textContent).toContain("Analityczka");
    expect(wiersz().textContent).not.toContain("·");
  });

  it("grupa jest odznaczona po polsku", () => {
    panel();
    szukaj();

    expect(within(wiersz()).getByText("Prelegenci")).toBeTruthy();
  });

  it("po angielsku ta sama grupa ma angielską nazwę", () => {
    h.lang = "en";
    panel();
    szukaj();

    expect(within(wiersz()).getByText("Speakers")).toBeTruthy();
    expect(within(wiersz()).queryByText("Prelegenci")).toBeNull();
  });

  it("grupa bez nazwy w języku interfejsu spada na drugi język", () => {
    h.rows = [osoba({ group_name_pl: "" })];
    panel();
    szukaj();

    expect(within(wiersz()).getByText("Speakers")).toBeTruthy();
  });

  it("osoba bez grupy nie rysuje pustej odznaki", () => {
    h.rows = [osoba({ group_name_pl: BRAK, group_name_en: BRAK })];
    panel();
    szukaj();

    expect(within(wiersz()).queryByText("Prelegenci")).toBeNull();
  });

  it("osoba z już wydrukowanym identyfikatorem jest odznaczona", () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, badge_printed: true })];
    panel();
    szukaj();

    expect(within(wiersz(0)).queryByText(`${T}.alreadyPrinted`)).toBeNull();
    expect(within(wiersz(1)).getByText(`${T}.alreadyPrinted`)).toBeTruthy();
  });
});

describe("zaznaczanie i przyciski", () => {
  it("bez zaznaczenia licznik pokazuje zero, a wydruk jest zgaszony", () => {
    panel();
    szukaj();

    expect(screen.getByText(`${T}.selected(count=0)`)).toBeTruthy();
    expect(przycisk(`${T}.generate`)).toBeDisabled();
    expect(przycisk(`${T}.clear`)).toBeDisabled();
  });

  it("zaznaczenie osoby podnosi licznik i odblokowuje wydruk", () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");

    expect(screen.getByText(`${T}.selected(count=1)`)).toBeTruthy();
    expect(przycisk(`${T}.generate`)).toBeEnabled();
  });

  it("„zaznacz wszystkich” bierze wszystkie WIDOCZNE wiersze", () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, first_name: "Piotr", last_name: "Nowak" })];
    panel();
    szukaj();
    fireEvent.click(przycisk(`${T}.selectAll`));

    expect(screen.getByText(`${T}.selected(count=2)`)).toBeTruthy();
  });

  it("bez wierszy „zaznacz wszystkich” jest zgaszone", () => {
    h.rows = [];
    panel();
    szukaj();

    expect(przycisk(`${T}.selectAll`)).toBeDisabled();
  });

  it("„wyczyść” zdejmuje zaznaczenie do zera", () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.clear`));

    expect(screen.getByText(`${T}.selected(count=0)`)).toBeTruthy();
  });

  it("odznaczenie tej samej osoby wraca do zera", () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    zaznacz("Anna Kowalska");

    expect(screen.getByText(`${T}.selected(count=0)`)).toBeTruthy();
  });

  it("wydawanie partii w locie zmienia napis przycisku i go gasi", () => {
    h.partiaPending = true;
    panel();
    szukaj();
    zaznacz("Anna Kowalska");

    expect(przycisk(`${T}.generating`)).toBeDisabled();
    expect(screen.queryByRole("button", { name: `${T}.generate` })).toBeNull();
  });
});

describe("ostrzeżenie o powtórnym wydruku", () => {
  it("bez zaznaczenia osoby z wydrukiem ostrzeżenia nie ma", () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, badge_printed: true, first_name: "Piotr" })];
    panel();
    szukaj();
    zaznacz("Anna Kowalska");

    expect(screen.queryByText(`${T}.reprintWarning`)).toBeNull();
  });

  it("zaznaczenie osoby, która ma już wydruk, zapala ostrzeżenie", () => {
    h.rows = [osoba({ badge_printed: true })];
    panel();
    szukaj();
    zaznacz("Anna Kowalska");

    expect(screen.getByText(`${T}.reprintWarning`)).toBeTruthy();
  });

  it.fails(
    "DEFEKT: ostrzeżenie patrzy TYLKO na widoczne wiersze - osoba zaznaczona w poprzednim wyszukiwaniu zostaje w partii, ale ostrzeżenie o niej znika",
    () => {
      // `reprintRisk` liczy się z `rows` (bieżąca strona wyników), a
      // `selectedIds` żyje dalej po zmianie frazy. Skutek: operator zaznacza
      // osobę z wydrukiem, szuka kogoś innego - i ostrzeżenie gaśnie, choć
      // partia nadal obejmuje tamtą osobę. Wydanie ROTUJE jej kod QR, więc
      // identyfikator, który ma w ręku, przestaje wpuszczać, a nikt jej o tym
      // nie uprzedził. Licznik obok („zaznaczono: 1") mówi wtedy prawdę,
      // a ostrzeżenie - nie.
      h.rows = [osoba({ badge_printed: true })];
      const { rerender } = panel();
      szukaj("Kowalska");
      zaznacz("Anna Kowalska");
      expect(screen.getByText(`${T}.reprintWarning`)).toBeTruthy();

      h.rows = [osoba({ person_id: INNA_OSOBA, first_name: "Piotr", last_name: "Nowak" })];
      rerender(<OnsiteBadgePrintPanel eventId={WYDARZENIE} eventTitle={TYTUL} />);
      szukaj("Nowak");

      expect(screen.getByText(`${T}.selected(count=1)`)).toBeTruthy();
      expect(screen.getByText(`${T}.reprintWarning`)).toBeTruthy();
    },
  );
});

describe("wydanie partii i dokument druku", () => {
  it("sama zmiana frazy NIE wydaje partii - kody rotują dopiero po kliknięciu", () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");

    expect(h.partie).toHaveLength(0);
  });

  it("ładunek niesie identyfikatory ZAZNACZONYCH osób i wydarzenie", async () => {
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, first_name: "Piotr", last_name: "Nowak" })];
    panel();
    szukaj();
    zaznacz("Piotr Nowak");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.partie).toHaveLength(1));
    expect(h.partie[0]).toEqual({
      eventId: WYDARZENIE,
      personIds: [INNA_OSOBA],
      templateId: undefined,
    });
  });

  it("NA PAPIERZE stoi nazwisko z PARTII, a nie to z listy wyszukiwania", async () => {
    // Wiersz ROZBIEŻNY: wyszukiwarka pokazuje „Anna Kowalska", ale baza oddaje
    // w partii „Barbara Zielińska" (np. po poprawce danych). Karta ma nieść
    // wersję z bazy - to ona jest podstawą wydania kodu.
    h.partiaWynik = partia([karta({ firstName: "Barbara", lastName: "Zielińska" })]);
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("Barbara Zielińska");
    expect(dokument()).not.toContain("Anna Kowalska");
  });

  it("karta niesie stanowisko, firmę, grupę, bilet i tytuł wydarzenia z wiersza", async () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    const html = dokument();
    expect(html).toContain(TYTUL);
    expect(html).toContain("Analityczka");
    expect(html).toContain("Instytut Analiz");
    expect(html).toContain("Prelegenci");
    expect(html).toContain("Standardowy");
  });

  it("po angielsku na karcie stoją angielskie nazwy grupy i biletu", async () => {
    h.lang = "en";
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("Speakers");
    expect(dokument()).toContain("Standard");
  });

  it("kod QR powstaje Z KODU ODDANEGO PRZEZ BAZĘ i ląduje w dokumencie", async () => {
    h.partiaWynik = partia([karta({ qrCode: "kod-anny" })]);
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("data:image/png;kod=kod-anny");
  });

  it("osoba BEZ kodu (bez zapisu) dostaje kartę z napisem zamiast kodu", async () => {
    h.partiaWynik = partia([karta({ qrCode: null })]);
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain(`${T}.noCode`);
    expect(dokument()).not.toContain("data:image/png");
  });

  it("okno druku dostaje polecenie wydruku i zamknięcia dokumentu", async () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.oknoWydrukowane).toBe(1));
    expect(h.oknoZamkniete).toBe(0);
  });

  it("udane wydanie potwierdza liczbą kart i CZYŚCI zaznaczenie", async () => {
    h.partiaWynik = partia([karta(), karta({ personId: INNA_OSOBA, firstName: "Piotr" })]);
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.done(count=2)`));
    expect(screen.getByText(`${T}.selected(count=0)`)).toBeTruthy();
  });

  it("kliknięcie bez zaznaczenia NIE otwiera okna ani nie wydaje partii", () => {
    panel();
    szukaj();
    fireEvent.click(przycisk(`${T}.generate`));

    expect(h.partie).toHaveLength(0);
    expect(h.napisane).toHaveLength(0);
  });
});

describe("okno zablokowane przez przeglądarkę", () => {
  it("zablokowane okienko kończy się zdaniem i NIE wydaje partii", async () => {
    h.oknoOtwieralne = false;
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(`${T}.popupBlocked`));
    expect(h.partie).toHaveLength(0);
    expect(h.rejestr).toHaveLength(0);
  });
});

describe("odmowa bazy przy wydaniu partii", () => {
  it("zamyka okno druku i mówi, co odmówiło", async () => {
    h.partiaBlad = new Error("template_missing: this event has no default badge template");
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.oknoZamkniete).toBe(1));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:template_missing: this event has no default badge template",
    );
    expect(h.napisane).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po odmowie zaznaczenie ZOSTAJE - operator poprawia szablon i klika znowu", async () => {
    h.partiaBlad = new Error("template_missing: this event has no default badge template");
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.oknoZamkniete).toBe(1));
    expect(screen.getByText(`${T}.selected(count=1)`)).toBeTruthy();
  });
});

describe("rejestr wydruków po fakcie", () => {
  it("zapisuje się PER OSOBA, z identyfikatorem z partii", async () => {
    h.partiaWynik = partia([karta(), karta({ personId: INNA_OSOBA, firstName: "Piotr" })]);
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.rejestr).toHaveLength(2));
    expect((h.rejestr as BadgePrintInput[]).map((item) => item.personId)).toEqual([
      OSOBA,
      INNA_OSOBA,
    ]);
  });

  it("błąd rejestru NIE cofa wydanych kodów - zgłaszamy go i kończymy sukcesem", async () => {
    h.rejestrBlad = new Error("person_not_found: person does not exist in this organisation");
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.done(count=1)`));
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:person_not_found: person does not exist in this organisation",
    );
    expect(h.oknoZamkniete).toBe(0);
  });

  it.fails(
    "DEFEKT: powód wydruku `initial` jest spoza słownika `BADGE_PRINT_REASONS`, więc baza go MILCZĄCO podmienia",
    async () => {
      // `event_badge_prints_reason_values` dopuszcza pięć wartości:
      // first_issue, reprint_lost, reprint_damaged, data_correction,
      // bulk_preprint. `_event_badge_print_write` normalizuje wszystko inne
      // (`v_reason NOT IN (...)` -> first_issue albo reprint_lost). Wysłany
      // stąd `initial` nigdy więc nie dojedzie do rejestru, a partia wydana
      // hurtowo powinna zapisać się jako `bulk_preprint` - to jest wartość,
      // którą baza zna i którą panel „Identyfikatory" umie pokazać.
      panel();
      szukaj();
      zaznacz("Anna Kowalska");
      fireEvent.click(przycisk(`${T}.generate`));

      await waitFor(() => expect(h.rejestr).toHaveLength(1));
      expect(BADGE_PRINT_REASONS as readonly string[]).toContain(
        (h.rejestr[0] as BadgePrintInput).reason,
      );
    },
  );
});

describe("szablon i rozmiar karty", () => {
  it("bez szablonu droplista ma sam wpis „brak szablonu”", () => {
    h.szablony = [];
    panel();

    expect(Array.from(dropListaSzablonow().options).map((option) => option.value)).toEqual([
      "__none__",
    ]);
  });

  it("szablony są podpisane nazwą i formatem papieru WIELKIMI literami", () => {
    h.szablony = [szablon()];
    panel();

    expect(Array.from(dropListaSzablonow().options).map((option) => option.textContent)).toEqual([
      `${T}.templateMissing`,
      "Identyfikator gościa (A6)",
    ]);
  });

  it("nieodczytana lista szablonów zostawia sam wpis „brak szablonu”", () => {
    h.szablony = undefined;
    panel();

    expect(Array.from(dropListaSzablonow().options)).toHaveLength(1);
  });

  it("bez wybranego szablonu ładunek NIE niesie identyfikatora szablonu", async () => {
    h.szablony = [szablon()];
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.partie).toHaveLength(1));
    expect(h.partie[0]).toMatchObject({ templateId: undefined });
  });

  it("wybrany szablon jedzie do wydania partii I do rejestru wydruku", async () => {
    h.szablony = [szablon()];
    panel();
    fireEvent.change(dropListaSzablonow(), { target: { value: SZABLON } });
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.rejestr).toHaveLength(1));
    expect(h.partie[0]).toMatchObject({ templateId: SZABLON });
    expect((h.rejestr[0] as BadgePrintInput).templateId).toBe(SZABLON);
  });

  it("bez szablonu karta ma rozmiar zapasowy modułu (105 × 148 mm)", async () => {
    panel();
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("width: 105mm");
    expect(dokument()).toContain("height: 148mm");
  });

  it("szablon POZIOMY obraca kartę - to ten sam papier, nie inny", async () => {
    h.szablony = [szablon({ orientation: "landscape" })];
    panel();
    fireEvent.change(dropListaSzablonow(), { target: { value: SZABLON } });
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("width: 148mm");
    expect(dokument()).toContain("height: 105mm");
  });

  it("szablon z wyłączonym kodem QR drukuje kartę BEZ kodu i bez napisu zastępczego", async () => {
    h.szablony = [szablon({ show_qr: false })];
    panel();
    fireEvent.change(dropListaSzablonow(), { target: { value: SZABLON } });
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).not.toContain("data:image/png");
    expect(dokument()).not.toContain(`${T}.noCode`);
  });

  it("kolor tła szablonu trafia na kartę", async () => {
    h.szablony = [szablon({ background_color: "#123456" })];
    panel();
    fireEvent.change(dropListaSzablonow(), { target: { value: SZABLON } });
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.napisane).toHaveLength(1));
    expect(dokument()).toContain("#123456");
  });

  it("powrót na „brak szablonu” zdejmuje identyfikator z ładunku", async () => {
    h.szablony = [szablon()];
    panel();
    fireEvent.change(dropListaSzablonow(), { target: { value: SZABLON } });
    fireEvent.change(dropListaSzablonow(), { target: { value: "__none__" } });
    szukaj();
    zaznacz("Anna Kowalska");
    fireEvent.click(przycisk(`${T}.generate`));

    await waitFor(() => expect(h.partie).toHaveLength(1));
    expect(h.partie[0]).toMatchObject({ templateId: undefined });
  });
});

describe("dostępność", () => {
  it("ekran z listą osób nie ma naruszeń dostępności", async () => {
    h.szablony = [szablon()];
    h.rows = [osoba(), osoba({ person_id: INNA_OSOBA, badge_printed: true, first_name: "Piotr" })];
    const { container } = panel();
    szukaj();
    await screen.findByText("Anna Kowalska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ekran przed wpisaniem frazy też nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findByText(`${T}.searchHint`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
