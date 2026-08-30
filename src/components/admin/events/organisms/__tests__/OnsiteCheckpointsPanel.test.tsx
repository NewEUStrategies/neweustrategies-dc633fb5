// Organizm „PUNKTY KONTROLNE" - lista bramek, przy których zapada decyzja
// o wpuszczeniu.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI, a awaria NIE MOŻE mówić „nie ma
//      żadnego punktu": organizator zakłada wtedy DRUGĄ bramkę o tej samej
//      nazwie i rozdziela ruch na dwa liczniki zajętości.
//   2. TRYB KIERUNKU I TRYB DOSTĘPU SĄ WIDOCZNE W WIERSZU. `in_only`,
//      `out_only` i `in_out` to trzy różne bramki, a `track` (liczy, nie
//      odmawia) to jedyna różnica między punktem pilnującym wstępu a punktem
//      zbierającym statystykę. Bez tego z listy nie da się powiedzieć, czy
//      bramka w ogóle kogoś zatrzyma.
//   3. ZAJĘTOŚĆ STOI OBOK POJEMNOŚCI. Punkt bez limitu pokazuje samą zajętość,
//      punkt z limitem - ułamek; to ta liczba decyduje, czy wolno wpuścić
//      kolejną osobę, zanim baza odpowie `denied_capacity`.
//   4. PRZEŁĄCZNIK „AKTYWNY" WYSYŁA CAŁY WIERSZ. Zapis punktu jest UPSERT-em,
//      więc jedno kliknięcie w liście to miejsce, w którym da się po cichu
//      zgubić OKNO DEDUPLIKACJI, POJEMNOŚĆ, tryb kierunku albo powiązanie
//      z sesją. Dowodzimy tego pełnym ładunkiem, a nie pojedynczym polem -
//      i osobno dla granicy `dedupe_window_seconds = 0` (deduplikacja
//      wyłączona), którą łatwo pomylić z „brak wartości, weź domyślne 120".
//   5. KASOWANIE JEST ZA POTWIERDZENIEM i idzie z identyfikatorem TEGO wiersza.
//      Odmowa `checkpoint_in_use` kończy się zdaniem, nie ciszą.
//   6. ODMOWA ZAPISU NIE ZAMYKA FORMULARZA.
//
// SZKIC PUNKTU JEST TU PRAWDZIWY. `checkpointDraftFromRow` i
// `checkpointDraftToInput` mają własne tabele przypadków w
// `lib/events/__tests__/onsiteDraft.test.ts`, ale TUTAJ zostają nietknięte -
// bo przedmiotem dowodu jest właśnie to, że przełącznik przepuszcza przez nie
// CAŁY wiersz i nic po drodze nie ginie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) FORMULARZA punktu - ma własny plik
// `EventCheckpointDialog.test.tsx`; tutaj jest atrapą. (2) Słownika odmów bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import { radixSwitchStub } from "@/test/reactStubs";
import type { CheckpointInput, EventCheckpointRow } from "@/lib/events/onsiteApi";
import type { EventRoomRow, EventSessionRow } from "@/lib/events/sessionsApi";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
}

type SesjaOpcja = Pick<EventSessionRow, "id" | "title_pl" | "title_en">;
type SalaOpcja = Pick<EventRoomRow, "id" | "name">;
type SponsorOpcja = Pick<EventSponsorRow, "id" | "snapshot_name" | "crm_name">;

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  sesje: [] as unknown[] | undefined,
  sale: [] as unknown[] | undefined,
  sponsorzy: [] as unknown[] | undefined,
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

// Radix Switch nie przełącza się pod happy-dom bez pełnego pointer API,
// a przełącznik „aktywny" jest tu główną akcją zapisu.
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
      return (
        <div>
          {/* Radix zgłasza `onOpenChange(true)` przy przechwyceniu fokusa;
              happy-dom tej ścieżki nie wywoła, a to ona decyduje, czy wybrany
              do skasowania punkt przetrwa. */}
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

// Formularz punktu ma WŁASNY plik testowy (nazwy, rodzaj, powiązania, okno
// deduplikacji). Tutaj liczy się STYK: z czym panel go otwiera i co robi
// z ładunkiem.
vi.mock("@/components/admin/events/molecules/EventCheckpointDialog", () => ({
  EventCheckpointDialog: ({
    open,
    onOpenChange,
    eventId,
    checkpoint,
    sessions,
    rooms,
    sponsors,
    isSaving,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventId: string;
    checkpoint: EventCheckpointRow | null;
    sessions: { id: string; label: string }[];
    rooms: { id: string; label: string }[];
    sponsors: { id: string; label: string }[];
    isSaving: boolean;
    onSubmit: (input: CheckpointInput) => void;
  }) =>
    !open ? null : (
      <div
        role="dialog"
        aria-label="formularz-punktu"
        data-punkt={checkpoint === null ? "nowy" : checkpoint.id}
        data-zapis={String(isSaving)}
        data-sesje={sessions.map((item) => `${item.id}:${item.label}`).join("|")}
        data-sale={rooms.map((item) => `${item.id}:${item.label}`).join("|")}
        data-sponsorzy={sponsors.map((item) => `${item.id}:${item.label}`).join("|")}
      >
        <button
          type="button"
          data-testid="formularz-zapisz"
          onClick={() =>
            onSubmit({
              id: checkpoint === null ? undefined : checkpoint.id,
              eventId,
              namePl: "Bramka boczna",
              nameEn: "Side gate",
              kind: "event_entry",
            })
          }
        />
        <button type="button" data-testid="formularz-zamknij" onClick={() => onOpenChange(false)} />
        {/* Radix zgłasza `onOpenChange(true)` przy ponownym przechwyceniu
            fokusa - to ta ścieżka decyduje, czy edytowany punkt przetrwa. */}
        <button type="button" data-testid="formularz-otworz" onClick={() => onOpenChange(true)} />
      </div>
    ),
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useEventSessions: () => ({ data: h.sesje, isLoading: false, error: null }),
  useEventRooms: () => ({ data: h.sale, isLoading: false, error: null }),
}));

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: () => ({ data: h.sponsorzy, isLoading: false, error: null }),
}));

vi.mock("@/lib/events/useEventOnsite", () => ({
  useCheckpoints: () => ({ data: h.rows, isLoading: h.isLoading, error: h.listError }),
  useSaveCheckpoint: () => ({
    mutate: (input: CheckpointInput, wynik: Wynik<string>) => {
      h.zapisy.push(input);
      if (h.zapisBlad === null) wynik.onSuccess?.("ok");
      else wynik.onError?.(h.zapisBlad);
    },
    isPending: h.zapisPending,
  }),
  useDeleteCheckpoint: () => ({
    mutate: (id: string, wynik: Wynik<boolean>) => {
      h.kasowania.push(id);
      if (h.kasowanieBlad === null) wynik.onSuccess?.(true);
      else wynik.onError?.(h.kasowanieBlad);
    },
    isPending: false,
  }),
}));

import { OnsiteCheckpointsPanel } from "@/components/admin/events/organisms/OnsiteCheckpointsPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PUNKT = "22222222-2222-4222-8222-222222222222";
const INNY_PUNKT = "33333333-3333-4333-8333-333333333333";
const SESJA = "44444444-4444-4444-8444-444444444444";
const SALA = "55555555-5555-4555-8555-555555555555";
const SPONSOR = "66666666-6666-4666-8666-666666666666";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_checkpoints_list` oddaje `session_id`, `room_id`, `sponsor_id`
 * i `last_checkin_at` jako NULL (bramka główna nie należy do sesji ani do sali,
 * punkt bez ruchu nie ma ostatniej odprawy), a wygenerowany typ obiecuje
 * `string`. Szkic punktu ma na to jawne warunki (`?? ""`), więc fixtura musi
 * umieć oddać `null`.
 */
const BRAK_NAPISU = null as unknown as string;

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `number`.
 *
 * `capacity` = NULL znaczy „bez limitu pojemności" i jest to WARTOŚĆ, a nie
 * brak danych: `checkpointDraftToInput` odsyła ją do bazy jawnym `null`.
 */
const BEZ_LIMITU = null as unknown as number;

/** Bramka główna: kontrola wstępu, tylko wejście, bez limitu pojemności. */
function punkt(overrides: Partial<EventCheckpointRow> = {}): EventCheckpointRow {
  return {
    access_mode: "control",
    capacity: BEZ_LIMITU,
    created_at: "2026-08-30T09:00:00.000Z",
    dedupe_window_seconds: 120,
    denied_count: 0,
    device_count: 0,
    direction_mode: "in_only",
    event_id: WYDARZENIE,
    granted_count: 0,
    id: PUNKT,
    is_active: true,
    kind: "event_entry",
    last_checkin_at: BRAK_NAPISU,
    name_en: "Main entrance",
    name_pl: "Wejście główne",
    occupancy: 0,
    repeat_count: 0,
    room_id: BRAK_NAPISU,
    room_name: BRAK_NAPISU,
    session_id: BRAK_NAPISU,
    session_title_en: BRAK_NAPISU,
    session_title_pl: BRAK_NAPISU,
    sort_order: 0,
    sponsor_id: BRAK_NAPISU,
    sponsor_name: BRAK_NAPISU,
    updated_at: "2026-08-30T09:00:00.000Z",
    ...overrides,
  };
}

function sesja(overrides: Partial<SesjaOpcja> = {}): SesjaOpcja {
  return { id: SESJA, title_pl: "Panel otwarcia", title_en: "Opening panel", ...overrides };
}

function sala(overrides: Partial<SalaOpcja> = {}): SalaOpcja {
  return { id: SALA, name: "Sala Kopernika", ...overrides };
}

function sponsor(overrides: Partial<SponsorOpcja> = {}): SponsorOpcja {
  return { id: SPONSOR, snapshot_name: "Firma Alfa", crm_name: "Alfa sp. z o.o.", ...overrides };
}

function panel() {
  return render(<OnsiteCheckpointsPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} na liście punktów`);
  return found;
};

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

const przelacznik = (index = 0): HTMLElement => within(wiersz(index)).getByRole("switch");

const formularz = (): HTMLElement => screen.getByRole("dialog", { name: "formularz-punktu" });

const okno = (): HTMLElement => screen.getByRole("alertdialog");

const ostatniZapis = (): CheckpointInput => h.zapisy[h.zapisy.length - 1] as CheckpointInput;

beforeEach(() => {
  h.lang = "pl";
  h.rows = [punkt()];
  h.isLoading = false;
  h.listError = null;
  h.sesje = [sesja()];
  h.sale = [sala()];
  h.sponsorzy = [sponsor()];
  h.zapisy = [];
  h.zapisBlad = null;
  h.zapisPending = false;
  h.kasowania = [];
  h.kasowanieBlad = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany listy punktów", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego punktu", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.checkpoints.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.checkpoints.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że punktów nie ma", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.checkpoints.empty`)).toBeNull();
  });

  it("brak punktów to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.checkpoints.empty`)).toBeTruthy();
  });

  it("brak awarii wyrażony jako `undefined` (nie `null`) też nie jest awarią", () => {
    h.listError = undefined;
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.checkpoints.empty`)).toBeTruthy();
  });
});

describe("wiersz punktu kontrolnego", () => {
  it("mówi nazwę w języku interfejsu", () => {
    panel();

    expect(within(wiersz()).getByText("Wejście główne")).toBeTruthy();
  });

  it("po angielsku nazwa jest angielska, a przy pustej wraca polska", () => {
    h.lang = "en";
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, name_en: "" })];
    panel();

    expect(within(wiersz(0)).getByText("Main entrance")).toBeTruthy();
    expect(within(wiersz(1)).getByText("Wejście główne")).toBeTruthy();
  });

  it("pusta polska nazwa spada na angielską", () => {
    h.rows = [punkt({ name_pl: "" })];
    panel();

    expect(within(wiersz()).getByText("Main entrance")).toBeTruthy();
  });

  it("RODZAJ i TRYB KIERUNKU stoją w wierszu obok siebie", () => {
    h.rows = [punkt({ kind: "session", direction_mode: "in_out" })];
    panel();

    expect(wiersz().textContent).toContain(
      `${T}.checkpointKinds.session · ${T}.directionModes.in_out`,
    );
  });

  it("bramka tylko na wyjście też jest podpisana swoim trybem", () => {
    h.rows = [punkt({ direction_mode: "out_only" })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.directionModes.out_only`);
  });

  it("punkt LICZĄCY (`track`) wygląda inaczej niż punkt KONTROLUJĄCY", () => {
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, access_mode: "track" })];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.accessModes.control`)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.accessModes.track`)).toBeTruthy();
  });

  it("punkt bez limitu pokazuje samą zajętość, bez ułamka", () => {
    h.rows = [punkt({ occupancy: 42, capacity: BEZ_LIMITU })];
    panel();

    expect(within(wiersz()).getByText(`${T}.labels.occupancy: 42`)).toBeTruthy();
  });

  it("punkt z limitem pokazuje zajętość JAKO UŁAMEK pojemności", () => {
    h.rows = [punkt({ occupancy: 118, capacity: 120 })];
    panel();

    expect(within(wiersz()).getByText(`${T}.labels.occupancy: 118 / 120`)).toBeTruthy();
  });

  it("liczba wpuszczeń stoi w wierszu zawsze", () => {
    h.rows = [punkt({ granted_count: 501 })];
    panel();

    expect(within(wiersz()).getByText(`${T}.results.granted: 501`)).toBeTruthy();
  });

  it("zero odmów NIE dostaje odznaki - odznaka ma znaczyć kłopot przy bramce", () => {
    h.rows = [punkt({ denied_count: 0 })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.filters.denied`);
  });

  it("pierwsza odmowa już jest odznaczona liczbą", () => {
    h.rows = [punkt({ denied_count: 1 })];
    panel();

    expect(within(wiersz()).getByText(`${T}.filters.denied: 1`)).toBeTruthy();
  });

  it("punkt bez sparowanego urządzenia nie rysuje licznika urządzeń", () => {
    h.rows = [punkt({ device_count: 0 })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.devices`);
  });

  it("punkt z urządzeniami pokazuje ich liczbę", () => {
    h.rows = [punkt({ device_count: 3 })];
    panel();

    expect(within(wiersz()).getByText(`${T}.labels.devices: 3`)).toBeTruthy();
  });
});

describe("przełącznik „aktywny” wysyła CAŁY wiersz", () => {
  it("wyłączenie punktu zachowuje okno deduplikacji, pojemność i tryby", () => {
    h.rows = [
      punkt({
        capacity: 250,
        dedupe_window_seconds: 900,
        direction_mode: "in_out",
        access_mode: "track",
        kind: "room",
        room_id: SALA,
        sort_order: 7,
      }),
    ];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis()).toEqual({
      id: PUNKT,
      eventId: undefined,
      namePl: "Wejście główne",
      nameEn: "Main entrance",
      kind: "room",
      sessionId: null,
      roomId: SALA,
      sponsorId: null,
      directionMode: "in_out",
      accessMode: "track",
      capacity: 250,
      dedupeWindowSeconds: 900,
      isActive: false,
      sortOrder: 7,
    });
  });

  it("włączenie wyłączonego punktu wysyła `isActive: true`", () => {
    h.rows = [punkt({ is_active: false })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().isActive).toBe(true);
  });

  it("OKNO DEDUPLIKACJI RÓWNE ZERU przeżywa przełączenie - to nie jest „brak wartości”", () => {
    // Zero znaczy „nie scalaj powtórzonych piknięć wcale". Gdyby przełącznik
    // czytał je jako pustkę, zapis podstawiłby domyślne 120 sekund i bramka
    // po cichu zaczęłaby łykać dublety.
    h.rows = [punkt({ dedupe_window_seconds: 0 })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().dedupeWindowSeconds).toBe(0);
  });

  it("BRAK POJEMNOŚCI przeżywa przełączenie jako jawny `null`, a nie zero", () => {
    h.rows = [punkt({ capacity: BEZ_LIMITU })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis().capacity).toBeNull();
  });

  it("punkt sesji zachowuje powiązanie z sesją", () => {
    h.rows = [punkt({ kind: "session", session_id: SESJA })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis()).toMatchObject({ kind: "session", sessionId: SESJA, sponsorId: null });
  });

  it("punkt stoiska zachowuje powiązanie ze sponsorem", () => {
    h.rows = [punkt({ kind: "company_booth", sponsor_id: SPONSOR })];
    panel();
    fireEvent.click(przelacznik());

    expect(ostatniZapis()).toMatchObject({
      kind: "company_booth",
      sponsorId: SPONSOR,
      sessionId: null,
    });
  });

  it("przełącznik działa na TYM wierszu, nie na pierwszym z listy", () => {
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, name_pl: "Bramka boczna" })];
    panel();
    fireEvent.click(przelacznik(1));

    expect(ostatniZapis().id).toBe(INNY_PUNKT);
  });

  it("przełączenie NIE pokazuje potwierdzenia - to jedno kliknięcie przy bramce", () => {
    panel();
    fireEvent.click(przelacznik());

    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa bazy przy przełączaniu kończy się zdaniem", () => {
    h.zapisBlad = new Error("checkpoint_in_use: 12 check-ins recorded");
    panel();
    fireEvent.click(przelacznik());

    expect(h.toastError).toHaveBeenCalledWith("odmowa:checkpoint_in_use: 12 check-ins recorded");
  });
});

describe("formularz punktu", () => {
  it("bez kliknięcia formularza nie ma na ekranie", () => {
    panel();

    expect(screen.queryByRole("dialog", { name: "formularz-punktu" })).toBeNull();
  });

  it("„dodaj” otwiera formularz PUSTY", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-punkt")).toBe("nowy");
  });

  it("ołówek otwiera formularz z TYM wierszem", () => {
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, name_pl: "Bramka boczna" })];
    panel();
    fireEvent.click(
      within(wiersz(1)).getByRole("button", { name: `${T}.checkpoints.dialog.editTitle` }),
    );

    expect(formularz().getAttribute("data-punkt")).toBe(INNY_PUNKT);
  });

  it("po zamknięciu „dodaj” znowu otwiera pusty formularz", () => {
    panel();
    fireEvent.click(
      within(wiersz()).getByRole("button", { name: `${T}.checkpoints.dialog.editTitle` }),
    );
    fireEvent.click(screen.getByTestId("formularz-zamknij"));
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-punkt")).toBe("nowy");
  });

  it("ponowne zgłoszenie otwarcia NIE czyści edytowanego punktu", () => {
    panel();
    fireEvent.click(
      within(wiersz()).getByRole("button", { name: `${T}.checkpoints.dialog.editTitle` }),
    );
    fireEvent.click(screen.getByTestId("formularz-otworz"));

    expect(formularz().getAttribute("data-punkt")).toBe(PUNKT);
  });

  it("formularz dostaje sesje, sale i sponsorów podpisane po ludzku", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-sesje")).toBe(`${SESJA}:Panel otwarcia`);
    expect(formularz().getAttribute("data-sale")).toBe(`${SALA}:Sala Kopernika`);
    expect(formularz().getAttribute("data-sponsorzy")).toBe(`${SPONSOR}:Firma Alfa`);
  });

  it("po angielsku sesje w formularzu są po angielsku", () => {
    h.lang = "en";
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-sesje")).toBe(`${SESJA}:Opening panel`);
  });

  it("sesja bez tytułu w języku interfejsu spada na drugi język", () => {
    h.sesje = [sesja({ title_pl: "" })];
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));
    expect(formularz().getAttribute("data-sesje")).toBe(`${SESJA}:Opening panel`);

    fireEvent.click(screen.getByTestId("formularz-zamknij"));
    h.lang = "en";
    h.sesje = [sesja({ title_en: "" })];
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));
    expect(formularz().getAttribute("data-sesje")).toBe(`${SESJA}:Panel otwarcia`);
  });

  it("sponsor bez migawki spada na CRM, a bez obu - na identyfikator", () => {
    h.sponsorzy = [
      sponsor({ snapshot_name: "" }),
      sponsor({ id: INNY_PUNKT, snapshot_name: "", crm_name: "" }),
    ];
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-sponsorzy")).toBe(
      `${SPONSOR}:Alfa sp. z o.o.|${INNY_PUNKT}:${INNY_PUNKT}`,
    );
  });

  it("nieodczytane listy powiązań jadą do formularza jako PUSTE", () => {
    h.sesje = undefined;
    h.sale = undefined;
    h.sponsorzy = undefined;
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-sesje")).toBe("");
    expect(formularz().getAttribute("data-sale")).toBe("");
    expect(formularz().getAttribute("data-sponsorzy")).toBe("");
  });

  it("zapis w locie jedzie do formularza jako stan „zapisuję”", () => {
    h.zapisPending = true;
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));

    expect(formularz().getAttribute("data-zapis")).toBe("true");
  });

  it("udany zapis potwierdza zdaniem i ZAMYKA formularz", () => {
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.zapisy).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.checkpoints.toasts.saved`);
    expect(screen.queryByRole("dialog", { name: "formularz-punktu" })).toBeNull();
  });

  it("odmowa bazy NIE zamyka formularza", () => {
    h.zapisBlad = new Error("checkpoint_name_taken: name already used");
    panel();
    fireEvent.click(przycisk(`${T}.actions.addCheckpoint`));
    fireEvent.click(screen.getByTestId("formularz-zapisz"));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:checkpoint_name_taken: name already used");
    expect(screen.getByRole("dialog", { name: "formularz-punktu" })).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("kasowanie punktu", () => {
  it("kosz sam z siebie NIC nie kasuje - najpierw pada pytanie", () => {
    panel();
    fireEvent.click(
      within(wiersz()).getByRole("button", { name: `${T}.checkpoints.deleteConfirm` }),
    );

    expect(h.kasowania).toHaveLength(0);
    expect(within(okno()).getByText(`${T}.checkpoints.deleteConfirm`)).toBeTruthy();
  });

  it("potwierdzenie kasuje TEN wiersz, nie pierwszy z listy", () => {
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, name_pl: "Bramka boczna" })];
    panel();
    fireEvent.click(
      within(wiersz(1)).getByRole("button", { name: `${T}.checkpoints.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.kasowania).toEqual([INNY_PUNKT]);
    expect(h.toastSuccess).toHaveBeenCalledWith(`${T}.checkpoints.toasts.deleted`);
  });

  it("anulowanie zamyka pytanie i nie wysyła nic do bazy", () => {
    panel();
    fireEvent.click(
      within(wiersz()).getByRole("button", { name: `${T}.checkpoints.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.cancel` }));

    expect(h.kasowania).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("przechwycenie fokusa przez Radix nie gubi wybranego punktu", () => {
    h.rows = [punkt(), punkt({ id: INNY_PUNKT, name_pl: "Bramka boczna" })];
    panel();
    fireEvent.click(
      within(wiersz(1)).getByRole("button", { name: `${T}.checkpoints.deleteConfirm` }),
    );
    fireEvent.click(screen.getByTestId("okno-otworz"));
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.kasowania).toEqual([INNY_PUNKT]);
  });

  it("odmowa `checkpoint_in_use` kończy się zdaniem i zamyka pytanie", () => {
    h.kasowanieBlad = new Error("checkpoint_in_use: 12 check-ins recorded");
    panel();
    fireEvent.click(
      within(wiersz()).getByRole("button", { name: `${T}.checkpoints.deleteConfirm` }),
    );
    fireEvent.click(within(okno()).getByRole("button", { name: `${T}.actions.save` }));

    expect(h.toastError).toHaveBeenCalledWith("odmowa:checkpoint_in_use: 12 check-ins recorded");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("dostępność", () => {
  it("lista punktów nie ma naruszeń dostępności", async () => {
    h.rows = [
      punkt({ capacity: 120, occupancy: 118, denied_count: 4, device_count: 2 }),
      punkt({ id: INNY_PUNKT, access_mode: "track", is_active: false }),
    ];
    const { container } = panel();
    await screen.findAllByText("Wejście główne");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusta lista też nie ma naruszeń dostępności", async () => {
    h.rows = [];
    const { container } = panel();
    await screen.findByText(`${T}.checkpoints.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
