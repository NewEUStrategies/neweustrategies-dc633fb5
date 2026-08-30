// Organizm „URZĄDZENIA SKANUJĄCE" - parowanie telefonów wolontariuszy,
// wstrzymywanie ich i unieważnianie poświadczeń.
//
// CO TEN PLIK DOWODZI.
//   1. TOKEN POKAZUJE SIĘ RAZ. Wydanie poświadczenia otwiera okienko z jawnym
//      tokenem; baza trzyma tylko skrót SHA-256, więc po zamknięciu okienka nie
//      ma go skąd odzyskać. Dowodzimy OBU stron: token pojawia się po udanym
//      wydaniu i ZNIKA po zamknięciu, a lista pokazuje wyłącznie prefiks.
//   2. STAN URZĄDZENIA LICZY BAZA, NIE EKRAN. `state` scala unieważnienie,
//      wygaśnięcie i blokadę po serii nieudanych skanów. Dowodzimy tego
//      wprost wierszem SPRZECZNYM: poświadczenie z datą wygaśnięcia w
//      przeszłości, ale ze stanem `active` z bazy, ma na ekranie stan `active`.
//      Gdyby ekran składał stan z trzech kolumn, rozjechałby się przy pierwszej
//      zmianie progu blokady w migracji.
//   3. WSTRZYMANIE TO NIE UNIEWAŻNIENIE. Wstrzymane wraca do pracy jednym
//      kliknięciem; unieważnione nie ma już ŻADNEGO przycisku - to jest ta
//      różnica, po której operator poznaje, że urządzenia nie da się odzyskać.
//   4. ZAKRES UPRAWNIEŃ JEST WIDOCZNY POJEDYNCZO. Urządzenie z zakresem `lead`
//      NIE MA odznaki `checkin` - i to jest jedyny sposób, w jaki organizator
//      widzi przed wydaniem, że tym telefonem nie da się nikogo odprawić.
//      (Samą odmowę egzekwuje baza, nie ten ekran.)
//   5. LICZNIK NIEUDANYCH SKANÓW POJAWIA SIĘ DOPIERO, GDY JEST CO POKAZAĆ.
//      Zero nieudanych skanów bez odznaki, pierwszy nieudany - z odznaką.
//   6. UNIEWAŻNIENIE JEST ZA POTWIERDZENIEM i idzie z identyfikatorem TEGO
//      urządzenia, nie pierwszego z listy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) FORMULARZA wydania i okienka poświadczenia -
// mają własny plik `ScannerDeviceDialog.test.tsx` (walidacja etykiety, kod QR
// parowania, kopiowanie linku); tutaj są atrapami, bo przedmiotem dowodu jest
// STYK: z czym panel je otwiera i co robi z wynikiem. (2) Słownika odmów bazy.
// (3) Formatu daty wygaśnięcia - `toLocaleString` zależy od wersji ICU maszyny.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type {
  EventCheckpointRow,
  ScannerDeviceCredential,
  ScannerDeviceIssueInput,
  ScannerDeviceRow,
} from "@/lib/events/onsiteApi";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

/** Punkt kontrolny tak, jak czyta go panel - trzy kolumny z sygnatury RPC. */
type PunktOpcja = Pick<EventCheckpointRow, "id" | "name_pl" | "name_en">;

/** Sponsor tak, jak czyta go panel - trzy kolumny z sygnatury RPC. */
type SponsorOpcja = Pick<EventSponsorRow, "id" | "snapshot_name" | "crm_name">;

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  punkty: [] as unknown[] | undefined,
  sponsorzy: [] as unknown[] | undefined,
  wydania: [] as unknown[],
  wydanieWynik: null as unknown,
  wydanieBlad: null as unknown,
  wydaniePending: false,
  uniewaznienia: [] as string[],
  uniewaznienieBlad: null as unknown,
  przelaczenia: [] as unknown[],
  przelaczenieBlad: null as unknown,
  przelaczeniePending: false,
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

// Okno potwierdzenia: treść istnieje TYLKO przy otwartym oknie (Radix nie
// montuje portalu). Bez tego „bez potwierdzenia nic nie leci" byłoby dowodem
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
          {/* Radix zgłasza `onOpenChange(true)` przy przechwyceniu fokusa;
              happy-dom tej ścieżki nie wywoła, a to ona decyduje, czy wybrane
              do unieważnienia urządzenie przetrwa. */}
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

// Formularz wydania i okienko poświadczenia mają WŁASNY plik testowy. Atrapy
// wystawiają wprost to, na czym stoją asercje: listę punktów i sponsorów,
// stan zapisu oraz jawny token, który wolno pokazać dokładnie raz.
vi.mock("@/components/admin/events/molecules/ScannerDeviceDialog", () => ({
  ScannerDeviceDialog: ({
    open,
    onOpenChange,
    eventId,
    checkpoints,
    sponsors,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    checkpoints: { id: string; label: string }[];
    sponsors: { id: string; label: string }[];
    isSaving: boolean;
    onSubmit: (input: ScannerDeviceIssueInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-urzadzenia"
        data-zapis={String(isSaving)}
        data-punkty={checkpoints.map((item) => `${item.id}:${item.label}`).join("|")}
        data-sponsorzy={sponsors.map((item) => `${item.id}:${item.label}`).join("|")}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() => onSubmit({ eventId, label: "Telefon bramka A", scopes: ["checkin"] })}
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
      </div>
    ),
  ScannerCredentialDialog: ({
    credential,
    onClose,
  }: {
    credential: ScannerDeviceCredential | null;
    onClose: () => void;
  }) =>
    credential === null ? null : (
      <div role="dialog" aria-label="poswiadczenie">
        <p>{credential.token}</p>
        <button type="button" data-testid="poswiadczenie-zamknij" onClick={onClose} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: () => ({ data: h.sponsorzy, isLoading: false, error: null }),
}));

vi.mock("@/lib/events/useEventOnsite", () => ({
  useScannerDevices: () => ({ data: h.rows, isLoading: h.isLoading, error: h.listError }),
  useCheckpoints: () => ({ data: h.punkty, isLoading: false, error: null }),
  useIssueScannerDevice: () => ({
    mutate: (input: ScannerDeviceIssueInput, wynik: Wynik<ScannerDeviceCredential>) => {
      h.wydania.push(input);
      if (h.wydanieBlad === null) wynik.onSuccess?.(h.wydanieWynik as ScannerDeviceCredential);
      else wynik.onError?.(h.wydanieBlad);
    },
    isPending: h.wydaniePending,
  }),
  useRevokeScannerDevice: () => ({
    mutate: (id: string, wynik: Wynik<boolean>) => {
      h.uniewaznienia.push(id);
      if (h.uniewaznienieBlad === null) wynik.onSuccess?.(true);
      else wynik.onError?.(h.uniewaznienieBlad);
    },
    isPending: false,
  }),
  useSetScannerDeviceActive: () => ({
    mutate: (input: { deviceId: string; isActive: boolean }, wynik: Wynik<boolean>) => {
      h.przelaczenia.push(input);
      if (h.przelaczenieBlad === null) wynik.onSuccess?.(true);
      else wynik.onError?.(h.przelaczenieBlad);
    },
    isPending: h.przelaczeniePending,
  }),
}));

import { OnsiteDevicesPanel } from "@/components/admin/events/organisms/OnsiteDevicesPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const URZADZENIE = "22222222-2222-4222-8222-222222222222";
const INNE_URZADZENIE = "33333333-3333-4333-8333-333333333333";
const PUNKT = "44444444-4444-4444-8444-444444444444";
const SPONSOR = "55555555-5555-4555-8555-555555555555";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_scanner_devices_list` oddaje `checkpoint_id`, `sponsor_id`,
 * `expires_at`, `revoked_at` czy `locked_until` jako NULL (poświadczenie bez
 * przypisania, bez terminu, nieunieważnione), a wygenerowany typ obiecuje
 * `string`. Organizm ma na to jawne warunki (`=== null`), więc fixtura musi
 * umieć oddać właśnie `null` - na pustym napisie te gałęzie nigdy by nie padły.
 */
const BRAK = null as unknown as string;

/** Czynne poświadczenie odprawy przypisane do bramki głównej. */
function urzadzenie(overrides: Partial<ScannerDeviceRow> = {}): ScannerDeviceRow {
  return {
    checkins_count: 12,
    checkpoint_id: PUNKT,
    checkpoint_name_en: "Main entrance",
    checkpoint_name_pl: "Wejście główne",
    created_at: "2026-08-30T09:00:00.000Z",
    event_id: WYDARZENIE,
    expires_at: BRAK,
    fail_window_count: 0,
    failed_scan_count: 0,
    id: URZADZENIE,
    is_active: true,
    label: "Telefon bramka A",
    last_failed_scan_at: BRAK,
    last_seen_at: "2026-09-01T08:20:00.000Z",
    lead_scans_count: 0,
    locked_until: BRAK,
    revoked_at: BRAK,
    scan_count: 12,
    scopes: ["checkin"],
    sponsor_id: BRAK,
    sponsor_name: BRAK,
    state: "active",
    token_prefix: "sk_a1b2",
    ...overrides,
  };
}

function poswiadczenie(overrides: Partial<ScannerDeviceCredential> = {}): ScannerDeviceCredential {
  return {
    deviceId: URZADZENIE,
    label: "Telefon bramka A",
    token: "sk_a1b2c3d4e5f6g7h8",
    tokenPrefix: "sk_a1b2",
    scopes: ["checkin"],
    expiresAt: null,
    ...overrides,
  };
}

function punkt(overrides: Partial<PunktOpcja> = {}): PunktOpcja {
  return { id: PUNKT, name_pl: "Wejście główne", name_en: "Main entrance", ...overrides };
}

function sponsor(overrides: Partial<SponsorOpcja> = {}): SponsorOpcja {
  return { id: SPONSOR, snapshot_name: "Firma Alfa", crm_name: "Alfa sp. z o.o.", ...overrides };
}

function panel() {
  return render(<OnsiteDevicesPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liście urządzeń`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-urzadzenia" });

const okienkoTokenu = (): HTMLElement => screen.getByRole("dialog", { name: "poswiadczenie" });

const okno = (): HTMLElement => screen.getByRole("alertdialog");

beforeEach(() => {
  h.lang = "pl";
  h.rows = [urzadzenie()];
  h.isLoading = false;
  h.listError = null;
  h.punkty = [punkt()];
  h.sponsorzy = [sponsor()];
  h.wydania = [];
  h.wydanieWynik = poswiadczenie();
  h.wydanieBlad = null;
  h.wydaniePending = false;
  h.uniewaznienia = [];
  h.uniewaznienieBlad = null;
  h.przelaczenia = [];
  h.przelaczenieBlad = null;
  h.przelaczeniePending = false;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy urządzeń", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego urządzenia", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.devices.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.devices.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że urządzeń nie ma", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.devices.empty`)).toBeNull();
  });

  it("brak sparowanych urządzeń to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.devices.empty`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
  });

  it("brak awarii wyrażony jako `undefined` (nie `null`) też nie jest awarią", () => {
    h.listError = undefined;
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.devices.empty`)).toBeTruthy();
  });

  it("przycisk wydania stoi na ekranie także wtedy, gdy nie ma ani jednego urządzenia", () => {
    h.rows = [];
    panel();

    expect(przycisk(`${T}.actions.issueDevice`)).toBeTruthy();
  });
});

describe("wiersz urządzenia", () => {
  it("pokazuje etykietę i PREFIKS tokenu - pełnego baza nie zna, bo trzyma skrót", () => {
    panel();

    expect(within(wiersz()).getByText("Telefon bramka A")).toBeTruthy();
    expect(wiersz().textContent).toContain(`${T}.labels.tokenPrefix: sk_a1b2`);
  });

  it("urządzenie przypisane do bramki niesie jej nazwę w języku interfejsu", () => {
    panel();

    expect(wiersz().textContent).toContain("Wejście główne");
  });

  it("po angielsku bramka w wierszu jest po angielsku", () => {
    h.lang = "en";
    panel();

    expect(wiersz().textContent).toContain("Main entrance");
    expect(wiersz().textContent).not.toContain("Wejście główne");
  });

  it("pusta angielska nazwa bramki spada na polską", () => {
    h.lang = "en";
    h.rows = [urzadzenie({ checkpoint_name_en: "" })];
    panel();

    expect(wiersz().textContent).toContain("Wejście główne");
  });

  it("pusta polska nazwa bramki spada na angielską", () => {
    h.rows = [urzadzenie({ checkpoint_name_pl: "" })];
    panel();

    expect(wiersz().textContent).toContain("Main entrance");
  });

  it("urządzenie bez przypisania do bramki nie rysuje pustego separatora", () => {
    h.rows = [urzadzenie({ checkpoint_id: BRAK, sponsor_name: BRAK })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.tokenPrefix: sk_a1b2`);
    expect(wiersz().textContent).not.toContain("·");
  });

  it("urządzenie sponsora niesie nazwę sponsora", () => {
    h.rows = [urzadzenie({ checkpoint_id: BRAK, sponsor_name: "Firma Alfa", scopes: ["lead"] })];
    panel();

    expect(wiersz().textContent).toContain("Firma Alfa");
  });

  it("licznik skanów stoi w wierszu zawsze", () => {
    h.rows = [urzadzenie({ scan_count: 341 })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.scans: 341`);
  });

  it("zero nieudanych skanów NIE dostaje odznaki - odznaka ma znaczyć kłopot", () => {
    h.rows = [urzadzenie({ failed_scan_count: 0 })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.failedScans`);
  });

  it("pierwszy nieudany skan już jest odznaczony liczbą", () => {
    h.rows = [urzadzenie({ failed_scan_count: 1 })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.failedScans: 1`);
  });

  it("poświadczenie bezterminowe nie rysuje pustej daty wygaśnięcia", () => {
    h.rows = [urzadzenie({ expires_at: BRAK })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.expiresAt`);
  });

  it("poświadczenie z terminem pokazuje datę wygaśnięcia", () => {
    h.rows = [urzadzenie({ expires_at: "2026-09-02T18:00:00.000Z" })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.expiresAt`);
  });
});

describe("stan poświadczenia liczy BAZA", () => {
  it("stan z kolumny `state` trafia na ekran wprost", () => {
    h.rows = [urzadzenie({ state: "locked" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.deviceStates.locked`)).toBeTruthy();
  });

  it("WYGASŁE poświadczenie ma stan `expired` z bazy, a nie wyliczony z daty", () => {
    h.rows = [urzadzenie({ state: "expired", expires_at: "2026-08-31T18:00:00.000Z" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.deviceStates.expired`)).toBeTruthy();
  });

  it("data w przeszłości przy stanie `active` NIE zmienia stanu na ekranie", () => {
    // Wiersz SPRZECZNY: gdyby ekran składał stan z kolumn, pokazałby
    // „wygasłe”. Stan jest jeden i liczy go baza - to jest cała teza.
    h.rows = [urzadzenie({ state: "active", expires_at: "2020-01-01T00:00:00.000Z" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.deviceStates.active`)).toBeTruthy();
    expect(within(wiersz()).queryByText(`${T}.deviceStates.expired`)).toBeNull();
  });

  it("nowy stan z migracji jedzie do słownika WŁASNYM kluczem, z wartością zapasową", () => {
    // Atrapa i18n echuje KLUCZ i zdejmuje `defaultValue`, więc asercja widzi
    // klucz zbudowany z wartości bazy. W produkcji ten sam wywołanie ma
    // `defaultValue: row.state`, czyli nieznany stan renderuje się jako
    // wartość z bazy, a nie jako goły klucz i18n.
    h.rows = [urzadzenie({ state: "nowy_stan_z_migracji" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.deviceStates.nowy_stan_z_migracji`)).toBeTruthy();
  });
});

describe("zakres uprawnień urządzenia", () => {
  it("każdy zakres ma OSOBNĄ odznakę", () => {
    h.rows = [urzadzenie({ scopes: ["checkin", "badge_print"] })];
    panel();

    expect(within(wiersz()).getByText(`${T}.scopes.checkin`)).toBeTruthy();
    expect(within(wiersz()).getByText(`${T}.scopes.badge_print`)).toBeTruthy();
  });

  it("urządzenie SPONSORA (zakres `lead`) nie ma odznaki odprawy", () => {
    // Tym telefonem nie da się nikogo wpuścić - odmowę egzekwuje baza, ale to
    // ta odznaka mówi organizatorowi PRZED wydaniem, co urządzenie potrafi.
    h.rows = [urzadzenie({ scopes: ["lead"], sponsor_name: "Firma Alfa" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.scopes.lead`)).toBeTruthy();
    expect(within(wiersz()).queryByText(`${T}.scopes.checkin`)).toBeNull();
  });

  it("poświadczenie bez ani jednego zakresu nie rysuje pustej odznaki", () => {
    h.rows = [urzadzenie({ scopes: [] })];
    panel();

    expect(within(wiersz()).queryByText(`${T}.scopes.checkin`)).toBeNull();
    expect(within(wiersz()).queryByText(`${T}.scopes.lead`)).toBeNull();
  });

  it("nowy zakres z migracji jedzie do słownika WŁASNYM kluczem, z wartością zapasową", () => {
    h.rows = [urzadzenie({ scopes: ["nowy_zakres"] })];
    panel();

    expect(within(wiersz()).getByText(`${T}.scopes.nowy_zakres`)).toBeTruthy();
  });
});

describe("wstrzymanie i wznowienie", () => {
  it("czynne urządzenie ma przycisk WSTRZYMANIA i wysyła `isActive: false`", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.pauseDevice` }));

    expect(h.przelaczenia).toEqual([{ deviceId: URZADZENIE, isActive: false }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.devices.toasts.paused`);
  });

  it("wstrzymane urządzenie ma przycisk WZNOWIENIA i wysyła `isActive: true`", () => {
    h.rows = [urzadzenie({ is_active: false, state: "paused" })];
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.resumeDevice` }));

    expect(h.przelaczenia).toEqual([{ deviceId: URZADZENIE, isActive: true }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.devices.toasts.resumed`);
  });

  it("przełącznik idzie z identyfikatorem TEGO urządzenia, nie pierwszego z listy", () => {
    h.rows = [urzadzenie(), urzadzenie({ id: INNE_URZADZENIE, label: "Telefon bramka B" })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.actions.pauseDevice` }));

    expect(h.przelaczenia).toEqual([{ deviceId: INNE_URZADZENIE, isActive: false }]);
  });

  it("odmowa bazy przy przełączaniu kończy się zdaniem, a nie ciszą", () => {
    h.przelaczenieBlad = new Error("device_revoked: credential already revoked");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.pauseDevice` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:device_revoked: credential already revoked");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("przełączanie w locie gasi przycisk - dwa kliknięcia to dwa zapisy", () => {
    h.przelaczeniePending = true;
    panel();

    expect(
      within(wiersz()).getByRole("button", { name: `${T}.actions.pauseDevice` }),
    ).toBeDisabled();
  });
});

describe("unieważnienie poświadczenia", () => {
  it("unieważnione urządzenie nie ma JUŻ ŻADNEGO przycisku - to droga bez powrotu", () => {
    h.rows = [urzadzenie({ state: "revoked", revoked_at: "2026-09-01T09:00:00.000Z" })];
    panel();

    expect(within(wiersz()).queryAllByRole("button")).toHaveLength(0);
  });

  it("kliknięcie zakazu samo z siebie NIC nie unieważnia - najpierw pada pytanie", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.revokeDevice` }));

    expect(h.uniewaznienia).toHaveLength(0);
    expect(within(okno()).getByText(`${T}.devices.revokeConfirm`)).toBeTruthy();
  });

  it("potwierdzenie unieważnia TO urządzenie, nie pierwsze z listy", () => {
    h.rows = [urzadzenie(), urzadzenie({ id: INNE_URZADZENIE, label: "Telefon bramka B" })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.actions.revokeDevice` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.revokeDevice` }));

    expect(h.uniewaznienia).toEqual([INNE_URZADZENIE]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.devices.toasts.revoked`);
  });

  it("anulowanie zamyka pytanie i nie wysyła nic do bazy", () => {
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.revokeDevice` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.cancel` }));

    expect(h.uniewaznienia).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("przechwycenie fokusa przez Radix nie gubi wybranego urządzenia", () => {
    h.rows = [urzadzenie(), urzadzenie({ id: INNE_URZADZENIE, label: "Telefon bramka B" })];
    panel();
    fireEvent.click(within(wiersz(1)).getByRole("button", { name: `${T}.actions.revokeDevice` }));
    fireEvent.click(screen.getByTestId("okno-otworz"));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.revokeDevice` }));

    expect(h.uniewaznienia).toEqual([INNE_URZADZENIE]);
  });

  it("odmowa bazy kończy się zdaniem i zamyka pytanie", () => {
    h.uniewaznienieBlad = new Error("device_not_found: unknown credential");
    panel();
    fireEvent.click(within(wiersz()).getByRole("button", { name: `${T}.actions.revokeDevice` }));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.revokeDevice` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:device_not_found: unknown credential");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("wydanie poświadczenia i jednorazowy token", () => {
  it("bez kliknięcia formularza wydania nie ma na ekranie", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "formularz-urzadzenia" })).toBeNull();
  });

  it("formularz dostaje punkty kontrolne podpisane w języku interfejsu", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-punkty")).toBe(`${PUNKT}:Wejście główne`);
  });

  it("po angielsku punkty w formularzu są po angielsku", () => {
    h.lang = "en";
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-punkty")).toBe(`${PUNKT}:Main entrance`);
  });

  it("punkt bez polskiej nazwy spada w formularzu na angielską", () => {
    h.punkty = [punkt({ name_pl: "" })];
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-punkty")).toBe(`${PUNKT}:Main entrance`);
  });

  it("punkt bez angielskiej nazwy spada po angielsku na polską", () => {
    h.lang = "en";
    h.punkty = [punkt({ name_en: "" })];
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-punkty")).toBe(`${PUNKT}:Wejście główne`);
  });

  it("formularz dostaje sponsorów podpisanych nazwą migawki", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-sponsorzy")).toBe(`${SPONSOR}:Firma Alfa`);
  });

  it("sponsor bez migawki spada na nazwę z CRM, a bez obu - na identyfikator", () => {
    h.sponsorzy = [
      sponsor({ snapshot_name: "" }),
      sponsor({ id: INNE_URZADZENIE, snapshot_name: "", crm_name: "" }),
    ];
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-sponsorzy")).toBe(
      `${SPONSOR}:Alfa sp. z o.o.|${INNE_URZADZENIE}:${INNE_URZADZENIE}`,
    );
  });

  it("nieodczytane listy punktów i sponsorów jadą do formularza jako PUSTE", () => {
    h.punkty = undefined;
    h.sponsorzy = undefined;
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-punkty")).toBe("");
    expect(formularz().getAttribute("data-sponsorzy")).toBe("");
  });

  it("wydanie w locie jedzie do formularza jako stan „zapisuję”", () => {
    h.wydaniePending = true;
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));

    expect(formularz().getAttribute("data-zapis")).toBe("true");
  });

  it("udane wydanie zamyka formularz i POKAZUJE jawny token", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.wydania).toEqual([
      { eventId: WYDARZENIE, label: "Telefon bramka A", scopes: ["checkin"] },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.devices.toasts.issued`);
    expect(screen.queryByRole("dialog", { name: "formularz-urzadzenia" })).toBeNull();
    expect(within(okienkoTokenu()).getByText("sk_a1b2c3d4e5f6g7h8")).toBeTruthy();
  });

  it("zamknięcie okienka KASUJE token z ekranu - drugi raz go nie zobaczysz", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));
    fireEvent.click(screen.getByTestId("poswiadczenie-zamknij"));

    expect(screen.queryByRole("dialog", { name: "poswiadczenie" })).toBeNull();
    expect(screen.queryByText("sk_a1b2c3d4e5f6g7h8")).toBeNull();
  });

  it("lista NIGDY nie pokazuje pełnego tokenu, tylko jego prefiks", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));
    fireEvent.click(screen.getByTestId("poswiadczenie-zamknij"));

    expect(wiersz().textContent).toContain("sk_a1b2");
    expect(wiersz().textContent).not.toContain("sk_a1b2c3d4e5f6g7h8");
  });

  it("odmowa bazy NIE zamyka formularza i NIE otwiera okienka tokenu", () => {
    h.wydanieBlad = new Error("scope_invalid: unknown scanner scope");
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:scope_invalid: unknown scanner scope");
    expect(screen.getByRole("dialog", { name: "formularz-urzadzenia" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "poswiadczenie" })).toBeNull();
  });

  it("zamknięcie formularza bez zapisu nie wysyła nic do bazy", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.issueDevice`));
    fireEvent.click(screen.getByTestId("formularz-zamknij"));

    expect(h.wydania).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "formularz-urzadzenia" })).toBeNull();
  });
});

describe("dostępność", () => {
  it("lista urządzeń nie ma naruszeń dostępności", async () => {
    h.rows = [
      urzadzenie({ failed_scan_count: 2, expires_at: "2026-09-02T18:00:00.000Z" }),
      urzadzenie({ id: INNE_URZADZENIE, state: "revoked", label: "Telefon bramka B" }),
    ];
    const { container } = panel();
    await screen.findByText("Telefon bramka A");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusta lista też nie ma naruszeń dostępności", async () => {
    h.rows = [];
    const { container } = panel();
    await screen.findByText(`${T}.devices.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
