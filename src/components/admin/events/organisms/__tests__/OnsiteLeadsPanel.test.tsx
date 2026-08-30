// Organizm „LEADY SPONSORÓW" - ekran, z którego wychodzi plik z danymi
// kontaktowymi uczestników.
//
// DLACZEGO TEN PLIK PATRZY OSTRZEJ NIŻ INNE PANELE. Tutaj nie chodzi o wygląd
// listy, tylko o to, KOMU wolno wysłać czyj adres. Zgoda w wierszu jest
// MIGAWKĄ z chwili skanu przy stoisku, a plik eksportu opuszcza system - błąd
// na tym ekranie nie psuje widoku, tylko rozsyła dane osobowe.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI, a awaria NIE MOŻE mówić „nie ma
//      żadnych skanów": sponsor po takim komunikacie zgłasza reklamację, że
//      urządzenie nie zapisywało - i wysyła wolontariusza po drugi skan.
//   2. BRAK ZGODY JEST ODZNACZONY WPROST. To nie jest ozdoba wiersza, tylko
//      granica prawna - wiersz bez zgody wygląda INACZEJ niż wiersz ze zgodą.
//   3. EKSPORT NIE UŻYWA WIERSZY Z EKRANU. Lista jest stronicowana (i po
//      przejściu na drugą stronę pokazuje inne wiersze), a plik ma zawierać
//      WSZYSTKIE skany - dlatego dowodzimy, że dane do pliku biorą się
//      z osobnego wywołania bazy, a nie z tablicy `rows`.
//   4. FILTR SPONSORA JEDZIE ZARÓWNO DO LISTY, JAK I DO EKSPORTU. Plik zrobiony
//      przy zawężonym widoku, a zawierający cudze leady, to wyciek do
//      konkurencji stojącej o dwa stoiska dalej.
//   5. PUSTY WYNIK EKSPORTU NIE POBIERA PLIKU. Zero wierszy kończy się
//      informacją, a nie zerobajtowym plikiem, który sponsor uzna za awarię.
//   6. ODMOWA BAZY PRZY EKSPORCIE KOŃCZY SIĘ ZDANIEM, a nie cichym brakiem
//      pliku w folderze pobierania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Budowy pliku (`buildLeadExport`,
// `leadExportCells`, BOM w CSV) - ma własny plik `lib/events/__tests__/
// leadExport.test.ts`; tutaj jest atrapą, bo przedmiotem dowodu jest to, CO
// panel do niej wysyła i czy w ogóle woła pobranie. (2) Słownika odmów bazy.
// (3) Formatu daty ostatniego skanu - `toLocaleString` zależy od wersji ICU.
//
// RODO: wszystkie dane w fixtureʼach są zmyślone, a adresy - gdyby kiedyś
// weszły do asercji - mają zostać w domenie `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type { LeadExportRow, LeadScanRow, LeadScansQuery } from "@/lib/events/onsiteApi";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";

/** Sponsor tak, jak czyta go panel - trzy kolumny z sygnatury RPC. */
type SponsorOpcja = Pick<EventSponsorRow, "id" | "snapshot_name" | "crm_name">;

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  sponsorzy: [] as unknown[] | undefined,
  zapytania: [] as unknown[],
  /** Wejścia eksportu - dowód, że plik pyta bazę, a nie ekran. */
  eksportWejscia: [] as unknown[],
  eksportWynik: [] as unknown[],
  eksportBlad: null as unknown,
  eksportPending: false,
  buildWejscia: [] as unknown[],
  pobrania: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));

vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Budowa pliku ma własny plik testowy i ciągnie `xlsx` (kilkaset kilobajtów
// przy każdym uruchomieniu). Tutaj liczy się WEJŚCIE do niej i to, czy panel
// w ogóle wywołuje pobranie.
vi.mock("@/lib/events/leadExport", () => ({
  buildLeadExport: (rows: unknown, options: unknown) => {
    h.buildWejscia.push({ rows, options });
    return Promise.resolve({ fileName: "leady-2026-09-01.csv", mimeType: "text/csv", data: "x" });
  },
  downloadLeadExport: (file: unknown) => {
    h.pobrania.push(file);
  },
}));

// Radix Select nie otwiera listy pod happy-dom. Atrapa przenosi z wyzwalacza
// `id`, `aria-label` i `aria-labelledby` - bez tego ostatniego droplisty
// stopki paginacji byłyby bezimienne, czyli asercja dostępności zgłaszałaby
// błąd, którego w produkcji nie ma.
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

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: () => ({ data: h.sponsorzy, isLoading: false, error: null }),
}));

vi.mock("@/lib/events/useEventOnsite", () => ({
  useLeadScans: (query: LeadScansQuery) => {
    h.zapytania.push(query);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useLeadExport: () => ({
    mutateAsync: (input: unknown) => {
      h.eksportWejscia.push(input);
      return h.eksportBlad === null
        ? Promise.resolve(h.eksportWynik)
        : Promise.reject(h.eksportBlad);
    },
    isPending: h.eksportPending,
  }),
}));

import { OnsiteLeadsPanel } from "@/components/admin/events/organisms/OnsiteLeadsPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const SPONSOR = "22222222-2222-4222-8222-222222222222";
const INNY_SPONSOR = "33333333-3333-4333-8333-333333333333";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_lead_scans_list` oddaje `company`, `device_label` i `note` jako
 * NULL (skan bez firmy w profilu, skan wpisany ręcznie bez urządzenia), a
 * wygenerowany typ obiecuje `string`. Organizm ma na to jawny filtr
 * `part !== null && part !== ""`, więc fixtura musi umieć oddać `null`.
 */
const BRAK_NAPISU = null as unknown as string;

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `number`.
 *
 * `interest_rating` jest opcjonalną oceną wystawianą przez obsługę stoiska -
 * brak oceny to NULL, a organizm ma na to jawny warunek `=== null`.
 */
const BRAK_OCENY = null as unknown as number;

/** Skan leada ZE ZGODĄ - wiersz, który wolno wysłać sponsorowi. */
function lead(overrides: Partial<LeadScanRow> = {}): LeadScanRow {
  return {
    company: "Instytut Analiz",
    consent: true,
    consent_snapshot_at: "2026-09-01T09:10:00.000Z",
    device_id: "44444444-4444-4444-8444-444444444444",
    device_label: "Skaner stoisko 12",
    first_name: "Anna",
    first_scanned_at: "2026-09-01T09:10:00.000Z",
    id: "55555555-5555-4555-8555-555555555555",
    interest_rating: 4,
    last_name: "Kowalska",
    last_scanned_at: "2026-09-01T11:40:00.000Z",
    note: BRAK_NAPISU,
    person_id: "66666666-6666-4666-8666-666666666666",
    scan_count: 1,
    sponsor_id: SPONSOR,
    sponsor_name: "Firma Alfa",
    total_count: 1,
    ...overrides,
  };
}

/** Wiersz eksportu - kontakt ujawnia BAZA, panel go tylko przekazuje dalej. */
function wierszEksportu(overrides: Partial<LeadExportRow> = {}): LeadExportRow {
  return {
    company: "Instytut Analiz",
    consent: true,
    consent_snapshot_at: "2026-09-01T09:10:00.000Z",
    device_label: "Skaner stoisko 12",
    email: "anna.kowalska@example.com",
    first_name: "Anna",
    first_scanned_at: "2026-09-01T09:10:00.000Z",
    interest_rating: 4,
    job_title: "Analityczka",
    last_name: "Kowalska",
    last_scanned_at: "2026-09-01T11:40:00.000Z",
    note: BRAK_NAPISU,
    phone: "+48000000000",
    scan_count: 1,
    sponsor_name: "Firma Alfa",
    ...overrides,
  };
}

function sponsor(overrides: Partial<SponsorOpcja> = {}): SponsorOpcja {
  return { id: SPONSOR, snapshot_name: "Firma Alfa", crm_name: "Alfa sp. z o.o.", ...overrides };
}

function panel() {
  return render(<OnsiteLeadsPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liście leadów`);
  return found;
};

const filtrSponsora = (): HTMLSelectElement =>
  screen.getByRole("combobox", { name: `${T}.filters.sponsor` });

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const ostatnieZapytanie = (): LeadScansQuery =>
  h.zapytania[h.zapytania.length - 1] as LeadScansQuery;

beforeEach(() => {
  h.lang = "pl";
  h.rows = [lead()];
  h.isLoading = false;
  h.listError = null;
  h.sponsorzy = [sponsor()];
  h.zapytania = [];
  h.eksportWejscia = [];
  h.eksportWynik = [wierszEksportu()];
  h.eksportBlad = null;
  h.eksportPending = false;
  h.buildWejscia = [];
  h.pobrania = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastInfo.mockClear();
});

describe("cztery stany listy leadów", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego wiersza", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.leads.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.leads.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że skanów nie ma", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.leads.empty`)).toBeNull();
  });

  it("brak skanów to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.leads.empty`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
  });

  it("wiersze rysują się bez komunikatów zastępczych", () => {
    panel();

    expect(wiersze()).toHaveLength(1);
    expect(screen.queryByText(`${T}.leads.empty`)).toBeNull();
  });
});

describe("wiersz leada", () => {
  it("pokazuje osobę, firmę, sponsora i urządzenie", () => {
    panel();

    expect(within(wiersz()).getByText("Anna Kowalska")).toBeTruthy();
    expect(wiersz().textContent).toContain("Instytut Analiz · Firma Alfa · Skaner stoisko 12");
  });

  it("skan bez urządzenia nie rysuje pustego separatora", () => {
    h.rows = [lead({ device_label: BRAK_NAPISU })];
    panel();

    expect(wiersz().textContent).toContain("Instytut Analiz · Firma Alfa");
    expect(wiersz().textContent).not.toContain("· ·");
  });

  it("ZGODA i BRAK ZGODY to dwa różne napisy, a nie dwa odcienie tej samej odznaki", () => {
    h.rows = [lead(), lead({ id: "bez-zgody", consent: false, first_name: "Piotr" })];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.labels.consent`)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.labels.noConsent`)).toBeTruthy();
  });

  it("brak oceny zainteresowania nie rysuje odznaki z pustą liczbą", () => {
    h.rows = [lead({ interest_rating: BRAK_OCENY })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.interest`);
  });

  it("wystawiona ocena stoi w wierszu razem z liczbą", () => {
    h.rows = [lead({ interest_rating: 5 })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.interest: 5`);
  });

  it("pojedynczy skan nie dostaje licznika - licznik ma znaczyć „był tu znowu”", () => {
    h.rows = [lead({ scan_count: 1 })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.scans`);
  });

  it("powtórzone podejście do stoiska jest odznaczone liczbą skanów", () => {
    h.rows = [lead({ scan_count: 4 })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.scans: 4`);
  });

  it('strażnik `?? ""` przy nazwisku trzyma - inaczej na liście stanęłoby „null null”', () => {
    // UCZCIWIE: DZIŚ ta sytuacja nie może zajść - `admin_event_lead_scans_list`
    // łączy `event_people` INNER JOIN-em, a imię i nazwisko są tam NOT NULL.
    // Wygenerowany typ tego nie wyraża, a organizm ma jawny `?? ""`; ten
    // przypadek pilnuje strażnika na wypadek zmiany złączenia.
    h.rows = [lead({ first_name: BRAK_NAPISU, last_name: BRAK_NAPISU })];
    panel();

    expect(wiersz().querySelector("p")?.textContent).toBe("");
  });
});

describe("filtr sponsora", () => {
  it("domyślnie lista pyta o WSZYSTKICH sponsorów, czyli bez warunku", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({
      eventId: WYDARZENIE,
      sponsorId: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("wybór sponsora jedzie do bazy identyfikatorem", () => {
    panel();
    fireEvent.change(filtrSponsora(), { target: { value: SPONSOR } });

    expect(ostatnieZapytanie().sponsorId).toBe(SPONSOR);
  });

  it("powrót na „wszyscy” ZDEJMUJE warunek zamiast wysyłać `__all__`", () => {
    panel();
    fireEvent.change(filtrSponsora(), { target: { value: SPONSOR } });
    fireEvent.change(filtrSponsora(), { target: { value: "__all__" } });

    expect(ostatnieZapytanie().sponsorId).toBeUndefined();
  });

  it("droplista podpisuje sponsora nazwą migawki, a nie identyfikatorem", () => {
    panel();

    expect(Array.from(filtrSponsora().options).map((option) => option.textContent)).toEqual([
      `${T}.filters.all`,
      "Firma Alfa",
    ]);
  });

  it("sponsor bez migawki spada na nazwę z CRM", () => {
    h.sponsorzy = [sponsor({ snapshot_name: "" })];
    panel();

    expect(Array.from(filtrSponsora().options).map((option) => option.textContent)).toContain(
      "Alfa sp. z o.o.",
    );
  });

  it("sponsor bez żadnej nazwy jest podpisany identyfikatorem, a nie pustką", () => {
    h.sponsorzy = [sponsor({ snapshot_name: "", crm_name: "" })];
    panel();

    expect(Array.from(filtrSponsora().options).map((option) => option.textContent)).toContain(
      SPONSOR,
    );
  });

  it("nieodczytana lista sponsorów zostawia sam wybór „wszyscy”", () => {
    h.sponsorzy = undefined;
    panel();

    expect(Array.from(filtrSponsora().options).map((option) => option.value)).toEqual(["__all__"]);
  });

  it("zmiana sponsora wraca na pierwszą stronę", () => {
    h.rows = [lead({ total_count: 500 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "4" },
    });
    expect(ostatnieZapytanie().offset).toBe(150);

    fireEvent.change(filtrSponsora(), { target: { value: SPONSOR } });
    expect(ostatnieZapytanie().offset).toBe(0);
  });
});

describe("paginacja", () => {
  it("łączna liczba jest brana z wiersza, a nie z długości strony", () => {
    h.rows = [lead({ total_count: 320 })];
    panel();

    expect(screen.getByText("admin.pagination.range(end=50,start=1,total=320)")).toBeTruthy();
  });

  it("pusta strona nie rysuje stopki paginacji", () => {
    h.rows = [];
    panel();

    expect(screen.queryByText(/admin\.pagination\.range/)).toBeNull();
  });

  it("zmiana rozmiaru strony wraca na pierwszą i zmienia limit", () => {
    h.rows = [lead({ total_count: 320 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.perPage" }), {
      target: { value: "100" },
    });

    expect(ostatnieZapytanie()).toMatchObject({ limit: 100, offset: 0 });
  });
});

describe("eksport pliku dla sponsora", () => {
  it("plik bierze dane Z BAZY, a nie z wierszy widocznych na ekranie", async () => {
    h.rows = [lead({ first_name: "Anna", total_count: 320 })];
    h.eksportWynik = [
      wierszEksportu({ first_name: "Barbara" }),
      wierszEksportu({ first_name: "Cezary" }),
    ];
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.buildWejscia).toHaveLength(1));
    const wejscie = h.buildWejscia[0] as { rows: LeadExportRow[] };
    expect(wejscie.rows.map((row) => row.first_name)).toEqual(["Barbara", "Cezary"]);
  });

  it("eksport CSV woła budowę pliku z formatem, językiem i prefiksem nazwy", async () => {
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.buildWejscia).toHaveLength(1));
    const wejscie = h.buildWejscia[0] as { options: Record<string, unknown> };
    expect(wejscie.options).toMatchObject({
      format: "csv",
      lang: "pl",
      prefix: `${T}.leads.exportPrefix`,
    });
    expect(typeof wejscie.options.nowIso).toBe("string");
  });

  it("drugi przycisk robi ten sam plik w formacie arkusza", async () => {
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportXlsx`));

    await waitFor(() => expect(h.buildWejscia).toHaveLength(1));
    expect((h.buildWejscia[0] as { options: { format: string } }).options.format).toBe("xlsx");
  });

  it("po angielsku plik jest budowany po angielsku", async () => {
    h.lang = "en";
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.buildWejscia).toHaveLength(1));
    expect((h.buildWejscia[0] as { options: { lang: string } }).options.lang).toBe("en");
  });

  it("gotowy plik LĄDUJE NA DYSKU i kończy się potwierdzeniem z liczbą wierszy", async () => {
    h.eksportWynik = [wierszEksportu(), wierszEksportu({ first_name: "Barbara" })];
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.pobrania).toHaveLength(1));
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.leads.exportDone(count=2)`);
  });

  it("eksport respektuje filtr sponsora - plik nie może nieść cudzych leadów", async () => {
    h.sponsorzy = [sponsor(), sponsor({ id: INNY_SPONSOR, snapshot_name: "Firma Beta" })];
    panel();
    fireEvent.change(filtrSponsora(), { target: { value: INNY_SPONSOR } });
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.eksportWejscia).toHaveLength(1));
    expect(h.eksportWejscia[0]).toEqual({ sponsorId: INNY_SPONSOR });
  });

  it("przy „wszyscy” eksport nie wysyła żadnego zawężenia", async () => {
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.eksportWejscia).toHaveLength(1));
    expect(h.eksportWejscia[0]).toEqual({ sponsorId: undefined });
  });

  it("zero wierszy kończy się informacją i NIE pobiera pustego pliku", async () => {
    h.eksportWynik = [];
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() => expect(h.toastInfo).toHaveBeenCalledWith(`${T}.leads.exportEmpty`));
    expect(h.pobrania).toHaveLength(0);
    expect(h.buildWejscia).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa bazy kończy się zdaniem, a nie cichym brakiem pliku", async () => {
    h.eksportBlad = new Error("permission_denied: brak dostępu");
    panel();
    fireEvent.click(przycisk(`${T}.leads.exportCsv`));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:permission_denied: brak dostępu"),
    );
    expect(h.pobrania).toHaveLength(0);
  });

  it("w trakcie eksportu OBA przyciski są zgaszone, a pierwszy mówi „trwa”", () => {
    h.eksportPending = true;
    panel();

    expect(przycisk(`${T}.leads.exportRunning`)).toBeDisabled();
    expect(przycisk(`${T}.leads.exportXlsx`)).toBeDisabled();
    expect(screen.queryByRole("button", { name: `${T}.leads.exportCsv` })).toBeNull();
  });
});

describe("dostępność", () => {
  it("lista leadów nie ma naruszeń dostępności", async () => {
    h.rows = [lead({ total_count: 320 })];
    const { container } = panel();
    await screen.findByText("Anna Kowalska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusta lista też nie ma naruszeń dostępności", async () => {
    h.rows = [];
    const { container } = panel();
    await screen.findByText(`${T}.leads.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
