// Organizm „FIRMY WYDARZENIA" - lista przypiec, z ktorej organizator decyduje,
// ktore logotypy stana na stronie publicznej.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJA CZTERY WIDOKI. „Nie przypieto jeszcze zadnej
//      firmy" po nieudanym zapytaniu to nieprawda o stanie bazy - organizator
//      przypina firme drugi raz i dostaje odmowe unikalnosci.
//   2. FILTROWANIE I STRONICOWANIE IDZIE DO BAZY, nie do pamieci. `total_count`
//      przychodzi w wierszu, wiec licznik nie klamie po zmianie filtra;
//      filtrowanie w pamieci pokazywaloby „12 z 12" na kazdej stronie.
//   3. KAZDA ZMIANA FILTRA WRACA NA PIERWSZA STRONE - inaczej po zawezeniu
//      wyniku organizator stoi na stronie, ktorej juz nie ma.
//   4. ROZJAZD Z CRM-EM MA WLASNA ODZNAKE. `crm_drift` znaczy, ze migawka na
//      stronie publicznej rozni sie od danych firmy - i to jest DECYZJA
//      organizatora, czy ja odswiezyc.
//   5. PUBLIKACJA HURTOWA IDZIE JEDNYM RPC - dwadziescia przelacznikow to
//      dwadziescia okazji na polowiczny stan.
//   6. ODSWIEZENIE MIGAWEK MA DWA TRYBY: bez zaznaczenia dotyczy CALEGO
//      wydarzenia i NIE rusza migawek wpisanych recznie; z zaznaczeniem -
//      wskazanych firm, a osobny przycisk dopuszcza nadpisanie recznych.
//   7. MATERIALY ROZWIJAJA SIE W WIERSZU i dotycza TEGO przypiecia.
//   8. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) FORMULARZA przypiecia - ma wlasny plik
// `EventSponsorDialog.test.tsx`; tutaj jest atrapa i liczy sie STYK.
// (2) Panelu materialow - `SponsorMaterialsPanel.test.tsx`. (3) Slownika odmow
// bazy. (4) Stopki stronicowania - `AdminPagination` ma wlasne testy; tutaj
// sprawdzamy, JAKIE liczby panel jej podaje.
//
// RODO: firmy i domeny sa wymyslone, adresy wylacznie `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type {
  EventSponsorRow,
  EventSponsorTierRow,
  SponsorInput,
  SponsorsQuery,
} from "@/lib/events/sponsorsApi";

/** Ksztalt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  poziomy: [] as unknown[] | undefined,
  zapytania: [] as unknown[],
  zapisy: [] as unknown[],
  zapisBlad: null as unknown,
  zapisPending: false,
  kasowania: [] as string[],
  kasowanieBlad: null as unknown,
  publikacje: [] as unknown[],
  publikacjaBlad: null as unknown,
  publikacjaLiczba: 0,
  odswiezenia: [] as unknown[],
  odswiezenieBlad: null as unknown,
  odswiezeniePending: false,
  odswiezenieLiczba: 0,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminSponsorErrors", () => ({
  adminSponsorErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Checkbox nie przelacza sie pod happy-dom bez pointer API, a zaznaczanie
// firm jest tu cala trescia publikacji hurtowej.
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

// Stopka stronicowania ma wlasne testy i wlasnego Radiksa. Tutaj interesuja nas
// LICZBY, ktore panel jej podaje, i to, co robi z jej zwrotkami.
vi.mock("@/components/admin/molecules/AdminPagination", () => ({
  AdminPagination: ({
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
  }: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  }) => (
    <div
      data-testid="stronicowanie"
      data-strona={String(page)}
      data-rozmiar={String(pageSize)}
      data-lacznie={String(total)}
    >
      {/* Przyciski atrapy MUSZA MIEC DOSTEPNA NAZWE. Skan axe obejmuje caly
          kontener panelu, wiec bezimienny przycisk atrapy podnosilby
          `button-name` (WCAG 4.1.2) w kazdym tescie dostepnosci i podszywalby
          sie pod defekt organizmu - a prawdziwa `AdminPagination` nazywa te
          kontrolki (aria-label na strzalkach, etykieta nad wyborem rozmiaru). */}
      <button
        type="button"
        data-testid="strona-nastepna"
        aria-label="admin.pagination.next"
        onClick={() => onPageChange(page + 1)}
      />
      <button
        type="button"
        data-testid="rozmiar-50"
        aria-label="admin.pagination.perPage"
        onClick={() => onPageSizeChange(50)}
      />
    </div>
  ),
}));

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

vi.mock("@/components/admin/events/molecules/EventSponsorDialog", () => ({
  EventSponsorDialog: ({
    open,
    onOpenChange,
    eventId,
    sponsor,
    tiers,
    nextSortOrder,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    sponsor: EventSponsorRow | null;
    tiers: EventSponsorTierRow[];
    nextSortOrder: number;
    isSaving: boolean;
    onSubmit: (input: SponsorInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-przypiecia"
        data-sponsor={sponsor === null ? "nowy" : sponsor.id}
        data-kolejnosc={String(nextSortOrder)}
        data-poziomy={tiers.map((tier) => tier.id).join("|")}
        data-zapis={String(isSaving)}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: sponsor === null ? undefined : sponsor.id,
              eventId: sponsor === null ? eventId : undefined,
              snapshotName: "Alfa",
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
}));

// Panel materialow ma wlasny plik testowy - tutaj liczy sie tylko to, CZY i DLA
// KTOREGO przypiecia jest zamontowany.
vi.mock("@/components/admin/events/organisms/SponsorMaterialsPanel", () => ({
  SponsorMaterialsPanel: ({ eventId, sponsorId }: { eventId: string; sponsorId: string }) => (
    <div data-testid="materialy" data-wydarzenie={eventId} data-sponsor={sponsorId} />
  ),
}));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: (query: SponsorsQuery) => {
    h.zapytania.push(query);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useSponsorTiers: () => ({ data: h.poziomy, isLoading: false, error: null }),
  useSaveSponsor: () => ({
    mutate: (input: SponsorInput, wynik?: Wynik<string>) => {
      h.zapisy.push(input);
      if (h.zapisBlad === null) wynik?.onSuccess?.("ok");
      else wynik?.onError?.(h.zapisBlad);
    },
    isPending: h.zapisPending,
  }),
  useDeleteSponsor: () => ({
    mutate: (id: string, wynik?: Wynik<boolean>) => {
      h.kasowania.push(id);
      if (h.kasowanieBlad === null) wynik?.onSuccess?.(true);
      else wynik?.onError?.(h.kasowanieBlad);
    },
    isPending: false,
  }),
  useSetSponsorsPublished: () => ({
    mutate: (input: { ids: string[]; isPublished: boolean }, wynik?: Wynik<number>) => {
      h.publikacje.push(input);
      if (h.publikacjaBlad === null) wynik?.onSuccess?.(h.publikacjaLiczba);
      else wynik?.onError?.(h.publikacjaBlad);
    },
    isPending: false,
  }),
  useRefreshSponsorSnapshots: () => ({
    mutate: (input: unknown, wynik?: Wynik<number>) => {
      h.odswiezenia.push(input);
      if (h.odswiezenieBlad === null) wynik?.onSuccess?.(h.odswiezenieLiczba);
      else wynik?.onError?.(h.odswiezenieBlad);
    },
    isPending: h.odswiezeniePending,
  }),
}));

const { SponsorsListPanel } = await import("@/components/admin/events/organisms/SponsorsListPanel");

const T = "adminEventSponsors";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const SPONSOR = "22222222-2222-4222-8222-222222222222";
const INNY_SPONSOR = "33333333-3333-4333-8333-333333333333";
const POZIOM = "44444444-4444-4444-8444-444444444444";
const DRUGI_POZIOM = "55555555-5555-4555-8555-555555555555";

/**
 * Kolumny NULL-owalne, ktore GENERATOR typuje jako `string`.
 *
 * `admin_event_sponsors_list` oddaje `tier_id`, `tier_name_*` i `booth_label`
 * jako NULL (firma bez poziomu, bez stanowiska) - to przypadek DOMYSLNY dla
 * patrona medialnego, a nie wyjatek.
 */
const BRAK_NAPISU = null as unknown as string;

function poziom(overrides: Partial<EventSponsorTierRow> = {}): EventSponsorTierRow {
  return {
    accent_color: "#FA9346",
    benefits: [],
    created_at: "2026-08-01T10:00:00.000Z",
    description_en: "",
    description_pl: "",
    event_id: WYDARZENIE,
    id: POZIOM,
    is_active: true,
    key: "gold",
    logo_size: "lg",
    max_companies: 3,
    name_en: "Gold",
    name_pl: "Zloty",
    published_sponsors_count: 1,
    rank: 1,
    slots_left: 1,
    sort_order: 10,
    sponsors_count: 2,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function przypiecie(overrides: Partial<EventSponsorRow> = {}): EventSponsorRow {
  return {
    booth_label: "A12",
    company_id: "66666666-6666-4666-8666-666666666666",
    contacts_count: 2,
    created_at: "2026-08-01T10:00:00.000Z",
    crm_city: "Warszawa",
    crm_country: "PL",
    crm_drift: false,
    crm_drift_fields: [],
    crm_logo_url: "https://alfa.example.com/logo.png",
    crm_name: "Alfa sp. z o.o.",
    crm_website: "https://alfa.example.com",
    event_id: WYDARZENIE,
    id: SPONSOR,
    is_published: true,
    materials_count: 3,
    published_materials_count: 1,
    role: "sponsor",
    snapshot_country: "PL",
    snapshot_description_en: "",
    snapshot_description_pl: "",
    snapshot_logo_url: "https://alfa.example.com/logo.png",
    snapshot_name: "Alfa",
    snapshot_source: "crm",
    snapshot_taken_at: "2026-08-01T10:00:00.000Z",
    snapshot_website: "https://alfa.example.com",
    sort_order: 10,
    tier_accent_color: "#FA9346",
    tier_id: POZIOM,
    tier_key: "gold",
    tier_logo_size: "lg",
    tier_name_en: "Gold",
    tier_name_pl: "Zloty",
    tier_rank: 1,
    total_count: 1,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function panel() {
  return render(<SponsorsListPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liscie firm`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const zaznacz = (index = 0) =>
  fireEvent.click(within(wiersz(index)).getByRole("checkbox", { name: `${T}.sponsors.selectRow` }));
const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-przypiecia" });
const okno = (): HTMLElement => screen.getByRole("alertdialog");
const stronicowanie = (): HTMLElement => screen.getByTestId("stronicowanie");
const ostatnieZapytanie = (): SponsorsQuery => h.zapytania[h.zapytania.length - 1] as SponsorsQuery;

beforeEach(() => {
  h.lang = "pl";
  h.rows = [przypiecie()];
  h.isLoading = false;
  h.listError = null;
  h.poziomy = [poziom()];
  h.zapytania = [];
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.publikacje = [];
  h.publikacjaBlad = null;
  h.publikacjaLiczba = 0;
  h.odswiezenia = [];
  h.odswiezenieBlad = null;
  h.odswiezeniePending = false;
  h.odswiezenieLiczba = 0;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy firm", () => {
  it("zapytanie w locie mowi „wczytywanie” i nie rysuje ani jednej firmy", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.sponsors.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.sponsors.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowe bazy i NIE mowi, ze firm nie ma", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: brak dostepu");
    panel();

    expect(screen.getByText("odmowa:forbidden: brak dostepu")).toBeTruthy();
    expect(screen.queryByText(`${T}.sponsors.empty`)).toBeNull();
  });

  it("brak firm to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.sponsors.empty`)).toBeTruthy();
  });

  it("brak awarii wyrazony jako `undefined` (nie `null`) tez nie jest awaria", () => {
    h.listError = undefined;
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.sponsors.empty`)).toBeTruthy();
  });
});

describe("wiersz firmy", () => {
  it("pokazuje nazwe z MIGAWKI - to ona jedzie na strone publiczna", () => {
    panel();

    expect(within(wiersz()).getByText("Alfa")).toBeTruthy();
  });

  it("pusta migawka spada na nazwe z CRM, zeby wiersz nie byl bezimienny", () => {
    h.rows = [przypiecie({ snapshot_name: "" })];
    panel();

    expect(within(wiersz()).getByText("Alfa sp. z o.o.")).toBeTruthy();
  });

  it("poziom i stanowisko stoja obok siebie w jednej linii", () => {
    panel();

    expect(within(wiersz()).getByText("Zloty · A12")).toBeTruthy();
  });

  it("firma bez poziomu i bez stanowiska nie pokazuje samych kropek", () => {
    h.rows = [
      przypiecie({
        tier_id: BRAK_NAPISU,
        tier_name_pl: BRAK_NAPISU,
        tier_name_en: BRAK_NAPISU,
        booth_label: BRAK_NAPISU,
      }),
    ];
    panel();

    expect(within(wiersz()).queryByText("·")).toBeNull();
  });

  it("nazwa poziomu idzie za jezykiem interfejsu, z zapasem w drugim jezyku", () => {
    h.lang = "en";
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR, tier_name_en: "" })];
    panel();

    expect(within(wiersz(0)).getByText("Gold · A12")).toBeTruthy();
    expect(within(wiersz(1)).getByText("Zloty · A12")).toBeTruthy();
  });

  it("rola firmy stoi w wierszu - patron medialny to nie sponsor", () => {
    h.rows = [przypiecie({ role: "media_partner" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.roles.media_partner`)).toBeTruthy();
  });

  it("odznaka mowi, czy firma jest na stronie, czy jeszcze w szkicu", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR, is_published: false })];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.filters.published`)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.filters.draft`)).toBeTruthy();
  });

  it("ROZJAZD Z CRM-EM ma wlasna odznake - odswiezenie jest decyzja, nie automatem", () => {
    h.rows = [przypiecie({ crm_drift: true }), przypiecie({ id: INNY_SPONSOR, crm_drift: false })];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.labels.crmDrift`)).toBeTruthy();
    expect(within(wiersz(1)).queryByText(`${T}.labels.crmDrift`)).toBeNull();
  });

  it("liczniki kontaktow i materialow stoja w wierszu", () => {
    panel();

    expect(within(wiersz()).getByText(`${T}.labels.contacts: 2`)).toBeTruthy();
    expect(within(wiersz()).getByText(`${T}.labels.materials: 3`)).toBeTruthy();
  });
});

describe("filtry i stronicowanie ida do BAZY", () => {
  it("pierwsze zapytanie niesie komplet parametrow i pierwsza strone", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({
      eventId: WYDARZENIE,
      role: "all",
      published: "all",
      tierId: undefined,
      q: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it("szukana fraza jedzie PRZYCIETA, a sama spacja nie jest fraza", () => {
    panel();
    fireEvent.change(screen.getByLabelText(`${T}.filters.search`), {
      target: { value: "  alfa  " },
    });
    expect(ostatnieZapytanie().q).toBe("alfa");

    fireEvent.change(screen.getByLabelText(`${T}.filters.search`), { target: { value: "   " } });
    expect(ostatnieZapytanie().q).toBeUndefined();
  });

  it("filtr roli i filtr publikacji jada do bazy", () => {
    panel();
    fireEvent.change(screen.getByLabelText(`${T}.filters.role`), {
      target: { value: "exhibitor" },
    });
    expect(ostatnieZapytanie().role).toBe("exhibitor");

    fireEvent.change(screen.getByLabelText(`${T}.filters.published`), {
      target: { value: "draft" },
    });
    expect(ostatnieZapytanie().published).toBe("draft");
  });

  it("filtr poziomu bierze opcje z listy poziomow, a „wszystkie” znaczy BRAK filtra", () => {
    h.poziomy = [poziom(), poziom({ id: DRUGI_POZIOM, name_pl: "Srebrny", name_en: "Silver" })];
    panel();

    const droplista = screen.getByLabelText(`${T}.filters.tier`);
    const wartosci = Array.from(droplista.querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual(["all", POZIOM, DRUGI_POZIOM]);

    fireEvent.change(droplista, { target: { value: POZIOM } });
    expect(ostatnieZapytanie().tierId).toBe(POZIOM);

    fireEvent.change(droplista, { target: { value: "all" } });
    expect(ostatnieZapytanie().tierId).toBeUndefined();
  });

  it("nazwy poziomow w filtrze ida za jezykiem interfejsu", () => {
    h.lang = "en";
    h.poziomy = [poziom(), poziom({ id: DRUGI_POZIOM, name_en: "", name_pl: "Srebrny" })];
    panel();

    const droplista = screen.getByLabelText(`${T}.filters.tier`);
    expect(within(droplista).getByText("Gold")).toBeTruthy();
    expect(within(droplista).getByText("Srebrny")).toBeTruthy();
  });

  it("nastepna strona przesuwa OFFSET, a nie filtruje w pamieci", () => {
    panel();
    fireEvent.click(screen.getByTestId("strona-nastepna"));

    expect(ostatnieZapytanie().offset).toBe(20);
    expect(stronicowanie()).toHaveAttribute("data-strona", "2");
  });

  it("zmiana rozmiaru strony wraca na PIERWSZA strone", () => {
    panel();
    fireEvent.click(screen.getByTestId("strona-nastepna"));
    fireEvent.click(screen.getByTestId("rozmiar-50"));

    expect(ostatnieZapytanie()).toMatchObject({ limit: 50, offset: 0 });
  });

  it.each([
    [`${T}.filters.role`, "partner"],
    [`${T}.filters.published`, "published"],
  ])("zmiana filtra %s wraca na pierwsza strone", (etykieta, wartosc) => {
    panel();
    fireEvent.click(screen.getByTestId("strona-nastepna"));
    expect(ostatnieZapytanie().offset).toBe(20);

    fireEvent.change(screen.getByLabelText(etykieta), { target: { value: wartosc } });
    expect(ostatnieZapytanie().offset).toBe(0);
  });

  it("wpisanie frazy tez wraca na pierwsza strone", () => {
    panel();
    fireEvent.click(screen.getByTestId("strona-nastepna"));
    fireEvent.change(screen.getByLabelText(`${T}.filters.search`), { target: { value: "alfa" } });

    expect(ostatnieZapytanie().offset).toBe(0);
  });

  it("licznik stopki bierze `total_count` Z WIERSZA - to baza liczy, nie panel", () => {
    h.rows = [przypiecie({ total_count: 47 }), przypiecie({ id: INNY_SPONSOR, total_count: 47 })];
    panel();

    expect(stronicowanie()).toHaveAttribute("data-lacznie", "47");
  });
});

describe("zaznaczenie i publikacja hurtowa", () => {
  it("bez zaznaczenia nie ma paska akcji hurtowych", () => {
    panel();

    expect(screen.queryByText(`${T}.sponsors.selected(count=1)`)).toBeNull();
    expect(screen.queryByRole("button", { name: `${T}.actions.publish` })).toBeNull();
  });

  it("zaznaczenie pokazuje pasek z LICZBA wybranych firm", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    panel();
    zaznacz(0);
    zaznacz(1);

    expect(screen.getByText(`${T}.sponsors.selected(count=2)`)).toBeTruthy();
  });

  it("odznaczenie zdejmuje firme z zaznaczenia", () => {
    panel();
    zaznacz(0);
    zaznacz(0);

    expect(screen.queryByRole("button", { name: `${T}.actions.publish` })).toBeNull();
  });

  it("publikacja hurtowa idzie JEDNYM zadaniem ze wszystkimi identyfikatorami", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    h.publikacjaLiczba = 2;
    panel();
    zaznacz(0);
    zaznacz(1);
    fireEvent.click(przycisk(`${T}.actions.publish`));

    expect(h.publikacje).toEqual([{ ids: [SPONSOR, INNY_SPONSOR], isPublished: true }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.published(count=2)`);
  });

  it("wycofanie ze strony idzie ta sama droga, z `false`", () => {
    panel();
    zaznacz(0);
    fireEvent.click(przycisk(`${T}.actions.unpublish`));

    expect(h.publikacje).toEqual([{ ids: [SPONSOR], isPublished: false }]);
  });

  it("udana publikacja CZYSCI zaznaczenie - inaczej drugie klikniecie powtarza tamto samo", () => {
    panel();
    zaznacz(0);
    fireEvent.click(przycisk(`${T}.actions.publish`));

    expect(screen.queryByRole("button", { name: `${T}.actions.publish` })).toBeNull();
  });

  it("odmowa bazy konczy sie zdaniem i ZOSTAWIA zaznaczenie do poprawki", () => {
    h.publikacjaBlad = new Error("sponsor_tier_required: brak poziomu");
    panel();
    zaznacz(0);
    fireEvent.click(przycisk(`${T}.actions.publish`));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:sponsor_tier_required: brak poziomu");
    expect(screen.getByRole("button", { name: `${T}.actions.publish` })).toBeTruthy();
  });
});

describe("odswiezanie migawek z CRM", () => {
  it("bez zaznaczenia odswieza CALE wydarzenie i NIE rusza migawek recznych", () => {
    h.odswiezenieLiczba = 5;
    panel();
    fireEvent.click(przycisk(`${T}.actions.refreshSnapshots`));

    expect(h.odswiezenia).toEqual([{ eventId: WYDARZENIE, includeManual: false }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.snapshotsRefreshed(count=5)`);
  });

  it("z zaznaczeniem odswieza WSKAZANE firmy, nie cale wydarzenie", () => {
    panel();
    zaznacz(0);
    fireEvent.click(przycisk(`${T}.actions.refreshSnapshots`));

    expect(h.odswiezenia).toEqual([{ ids: [SPONSOR], includeManual: false }]);
  });

  it("osobny przycisk dopuszcza NADPISANIE migawek wpisanych recznie", () => {
    // Migawka wpisana recznie bywa celowa - jej nadpisanie musi byc osobnym
    // klinieciem, a nie skutkiem ubocznym odswiezenia.
    panel();
    zaznacz(0);
    fireEvent.click(przycisk(`${T}.actions.includeManual`));

    expect(h.odswiezenia).toEqual([{ ids: [SPONSOR], includeManual: true }]);
  });

  it("odswiezanie w toku gasi przycisk w naglowku", () => {
    h.odswiezeniePending = true;
    panel();

    expect(przycisk(`${T}.actions.refreshSnapshots`)).toBeDisabled();
  });

  it("odmowa odswiezenia konczy sie zdaniem", () => {
    h.odswiezenieBlad = new Error("forbidden: brak uprawnien");
    panel();
    fireEvent.click(przycisk(`${T}.actions.refreshSnapshots`));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: brak uprawnien");
  });
});

describe("materialy rozwijane w wierszu", () => {
  it("materialy sa schowane, dopoki organizator ich nie rozwinie", () => {
    panel();

    expect(screen.queryByTestId("materialy")).toBeNull();
  });

  it("rozwiniecie montuje panel materialow TEGO przypiecia", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.labels.materials` }));

    const materialy = screen.getByTestId("materialy");
    expect(materialy).toHaveAttribute("data-sponsor", INNY_SPONSOR);
    expect(materialy).toHaveAttribute("data-wydarzenie", WYDARZENIE);
  });

  it("drugie klikniecie zwija materialy", () => {
    panel();
    const przelacz = () =>
      fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.labels.materials` }));
    przelacz();
    przelacz();

    expect(screen.queryByTestId("materialy")).toBeNull();
  });

  it("rozwiniecie innego wiersza zwija poprzedni - naraz otwarty jest JEDEN", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    panel();
    fireEvent.click(within(wiersz(0)).getByRole("button", { name: `${T}.labels.materials` }));
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.labels.materials` }));

    expect(screen.getAllByTestId("materialy")).toHaveLength(1);
    expect(screen.getByTestId("materialy")).toHaveAttribute("data-sponsor", INNY_SPONSOR);
  });
});

describe("formularz przypiecia - styk z panelem", () => {
  it("„Dodaj firme” otwiera PUSTY formularz z podpowiedziana kolejnoscia i lista poziomow", () => {
    h.rows = [przypiecie({ sort_order: 10 }), przypiecie({ id: INNY_SPONSOR, sort_order: 40 })];
    h.poziomy = [poziom(), poziom({ id: DRUGI_POZIOM })];
    panel();
    fireEvent.click(przycisk(`${T}.actions.addSponsor`));

    expect(formularz()).toHaveAttribute("data-sponsor", "nowy");
    expect(formularz()).toHaveAttribute("data-kolejnosc", "50");
    expect(formularz()).toHaveAttribute("data-poziomy", `${POZIOM}|${DRUGI_POZIOM}`);
  });

  it("olowek otwiera formularz TEGO wiersza", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    panel();
    fireEvent.click(
      within(wiersz(1)).getByRole("button", { name: `${T}.sponsors.dialog.editTitle` }),
    );

    expect(formularz()).toHaveAttribute("data-sponsor", INNY_SPONSOR);
  });

  it("zapis w toku dojezdza do formularza", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${T}.actions.addSponsor`));

    expect(formularz()).toHaveAttribute("data-zapis", "true");
  });

  it("udany zapis zamyka formularz i mowi o tym", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addSponsor`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.zapisy).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-przypiecia" })).toBeNull();
  });

  it("ODMOWA ZAPISU NIE ZAMYKA formularza - wpisana migawka zostaje na ekranie", () => {
    h.zapisBlad = new Error("tier_full: poziom pelny");
    panel();
    fireEvent.click(przycisk(`${T}.actions.addSponsor`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:tier_full: poziom pelny");
    expect(formularz()).toBeTruthy();
  });
});

describe("odpiecie firmy", () => {
  it("kosz nie odpina od razu - najpierw pyta", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.sponsors.deleteConfirm` }));

    expect(okno()).toBeTruthy();
    expect(h.kasowania).toHaveLength(0);
  });

  it("potwierdzenie odpina TEN wiersz, mowi o tym i czysci zaznaczenie", () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR })];
    panel();
    zaznacz(0);
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.sponsors.deleteConfirm` }));
    fireEvent.click(
      within(okno()).getByRole("button", { name: `${T}.sponsors.dialog.saveAction` }),
    );

    expect(h.kasowania).toEqual([INNY_SPONSOR]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.sponsors.toasts.deleted`);
    expect(screen.queryByRole("button", { name: `${T}.actions.publish` })).toBeNull();
  });

  it("odmowa bazy przy odpieciu konczy sie zdaniem i zamyka pytanie", () => {
    h.kasowanieBlad = new Error("not_found: brak przypiecia");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.sponsors.deleteConfirm` }));
    fireEvent.click(
      within(okno()).getByRole("button", { name: `${T}.sponsors.dialog.saveAction` }),
    );

    expect(h.toastError).toHaveBeenCalledWith("odmowa:not_found: brak przypiecia");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rezygnacja z potwierdzenia nie odpina niczego", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.sponsors.deleteConfirm` }));
    fireEvent.click(
      within(okno()).getByRole("button", { name: `${T}.sponsors.dialog.cancelAction` }),
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.kasowania).toHaveLength(0);
  });
});

describe("defekty zaznaczenia i stronicowania", () => {
  // ---------------------------------------------------------------------------
  // DEFEKT: zaznaczenie PRZEZYWA zmiane filtra. `setRole`, `setPublished`,
  // `setTierId` i pole szukania wracaja na pierwsza strone, ale NIE czyszcza
  // `selected`. Organizator zaznacza trzy firmy na liscie wszystkich, zaweza
  // filtr do „patroni medialni" - i klika „Opublikuj" widzac pasek „Wybrano: 3",
  // choc na ekranie nie ma juz ani jednej z tych trzech firm. RPC publikuje
  // WIERSZE, ktorych nie widac. Zaznaczenie powinno znikac razem z lista,
  // ktorej dotyczylo.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: zaznaczenie przezywa zmiane filtra - publikacja hurtowa dotyka firm, ktorych nie ma na ekranie",
    () => {
      panel();
      zaznacz(0);

      fireEvent.change(screen.getByLabelText(`${T}.filters.role`), {
        target: { value: "media_partner" },
      });

      expect(screen.queryByRole("button", { name: `${T}.actions.publish` })).toBeNull();
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT: `total` bierze sie z PIERWSZEGO wiersza odpowiedzi
  // (`rows[0]?.total_count ?? 0`). Pusta strona nie ma wiersza, wiec licznik
  // spada do zera - a `AdminPagination` ukrywa sie przy zerze. Organizator,
  // ktory odpial ostatnia firme ze strony nr 2, widzi zdanie „nie przypieto
  // jeszcze zadnej firmy" i traci stopke, czyli JEDYNA droge powrotu na strone
  // nr 1. Licznik powinien przezyc pusta strone (albo panel powinien sam
  // cofnac sie o strone).
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: pusta strona nr 2 zeruje licznik i zabiera stopke - nie ma jak wrocic na strone nr 1",
    () => {
      h.rows = [przypiecie({ total_count: 25 })];
      panel();
      fireEvent.click(screen.getByTestId("strona-nastepna"));
      expect(stronicowanie()).toHaveAttribute("data-strona", "2");

      // Odpiecie OSTATNIEJ firmy stojacej na stronie nr 2 - lista wraca pusta,
      // ale numer strony zostaje na dwojce. Zadnym filtrem tego nie odtworzymy:
      // kazda zmiana filtra sama cofa panel na pierwsza strone.
      fireEvent.click(
        within(wiersz()).getByRole("button", { name: `${T}.sponsors.deleteConfirm` }),
      );
      h.rows = [];
      fireEvent.click(
        within(okno()).getByRole("button", { name: `${T}.sponsors.dialog.saveAction` }),
      );

      expect(wiersze()).toHaveLength(0);
      expect(Number(stronicowanie().getAttribute("data-lacznie"))).toBeGreaterThan(0);
    },
  );
});

describe("dostepnosc", () => {
  it("lista firm nie ma naruszen axe", async () => {
    h.rows = [przypiecie(), przypiecie({ id: INNY_SPONSOR, crm_drift: true, is_published: false })];
    const { container } = panel();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("pasek akcji hurtowych i rozwiniete materialy tez nie maja naruszen axe", async () => {
    const { container } = panel();
    zaznacz(0);
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.labels.materials` }));

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("stan pusty i stan awarii tez nie maja naruszen axe", async () => {
    h.rows = [];
    const pusty = panel();
    const bezFirm = await axeViolations(pusty.container);
    expect(bezFirm, summarize(bezFirm)).toEqual([]);
    pusty.unmount();

    h.rows = undefined;
    h.listError = new Error("forbidden: brak dostepu");
    const awaria = panel();
    const naruszenia = await axeViolations(awaria.container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("filtry maja nazwy - inaczej czytnik oglasza cztery bezimienne listy", () => {
    panel();

    for (const etykieta of [
      `${T}.filters.search`,
      `${T}.filters.tier`,
      `${T}.filters.role`,
      `${T}.filters.published`,
    ]) {
      expect(screen.getByLabelText(etykieta)).toBeTruthy();
    }
  });
});
