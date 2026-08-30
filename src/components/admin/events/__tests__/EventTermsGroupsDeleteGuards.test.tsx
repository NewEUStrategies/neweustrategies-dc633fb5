// OSLONY USUNIECIA W PANELACH GRUP I ZGOD - to, co ma sie NIE WYDARZYC.
//
// PO CO OSOBNY PLIK. `EventTermsPanel.test.tsx` i `EventGroupsPanel.test.tsx`
// podmieniaja `@/components/ui/alert-dialog` na atrape, ktora rysuje tresc
// pytania WYLACZNIE przy `open === true` - dokladnie tak, jak robi to Radix.
// To wlasciwa atrapa do dowodzenia, co widzi organizator, ale przez nia dwie
// oslony organizmu sa nieosiagalne z zewnatrz:
//
//   * `confirmDelete()` zaczyna sie od `if (target === null) return;` -
//     przycisku potwierdzenia nie ma w drzewie, dopoki nie ma wskazanego
//     wiersza, wiec ta galaz nigdy nie zostala wykonana;
//   * `onOpenChange={(open) => { if (!open) setPendingDelete(null); }}` -
//     polowa dla `open === true` nie jest wolana, bo atrapa nie otwiera
//     pytania sama z siebie.
//
// TO NIE JEST KOSMETYKA POKRYCIA. Obie oslony pilnuja tej samej rzeczy: zeby
// POTWIERDZENIE KASOWALO DOKLADNIE TEN WIERSZ, KTORY WSKAZANO - i nic innego.
// Zgoda jest rejestrem dowodow akceptacji, a grupa niesie uprawnienia
// uczestnikow; skasowanie „czegos z listy" po zagubionym klikniecu jest tu
// szkoda nieodwracalna. Dlatego atrapa w TYM pliku jest odwrotna: rysuje tresc
// pytania ZAWSZE i pozwala wywolac `onOpenChange` w obie strony - a asercje
// mowia, ze organizm mimo to NICZEGO nie kasuje.
//
// CZEGO TEN PLIK NIE DUBLUJE. Calej reszty obu organizmow - stanow listy,
// plakietek, formularzy, dostepnosci. To maja pliki panelowe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EventGroupRow, EventTermRow } from "@/lib/events/termsGroupsApi";

interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  groups: [] as unknown,
  terms: [] as unknown,
  deletedGroups: [] as string[],
  deletedTerms: [] as string[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => "pl"),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/lib/events/adminTermsErrors", () => ({
  adminTermsErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// ATRAPA ODWROTNA NIZ W PLIKACH PANELOWYCH: tresc pytania stoi w drzewie
// ZAWSZE, a dwa przyciski pomocnicze pozwalaja wywolac `onOpenChange` w obie
// strony. Dzieki temu asercja moze klikac potwierdzenie WTEDY, GDY ZADEN
// wiersz nie jest wskazany - czyli w stanie, ktorego Radix nigdy nie pokaze,
// a ktorego organizm i tak ma sie bronic.
vi.mock("@/components/ui/alert-dialog", () => {
  const stan: { onOpenChange: ((next: boolean) => void) | null } = { onOpenChange: null };
  return {
    AlertDialog: ({
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      stan.onOpenChange = onOpenChange;
      return (
        <div>
          <button type="button" onClick={() => stan.onOpenChange?.(true)}>
            atrapa-otworz
          </button>
          <button type="button" onClick={() => stan.onOpenChange?.(false)}>
            atrapa-zamknij
          </button>
          {children}
        </div>
      );
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" onClick={() => stan.onOpenChange?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularze sa osobnymi molekulami z wlasnymi plikami - tutaj tylko zaslepki.
vi.mock("@/components/admin/events/molecules/EventGroupDialog", () => ({
  EventGroupDialog: () => null,
}));
vi.mock("@/components/admin/events/molecules/EventTermDialog", () => ({
  EventTermDialog: () => null,
}));

vi.mock("@/lib/events/useEventTermsGroups", () => ({
  useEventGroups: () => ({ data: h.groups, isLoading: false, error: null }),
  useSaveEventGroup: () => ({ isPending: false, mutate: () => undefined }),
  useDeleteEventGroup: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.deletedGroups.push(id);
      res.onSuccess?.(true);
    },
  }),
  useEventTerms: () => ({ data: h.terms, isLoading: false, error: null }),
  useSaveEventTerm: () => ({ isPending: false, mutate: () => undefined }),
  useDeleteEventTerm: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.deletedTerms.push(id);
      res.onSuccess?.(true);
    },
  }),
}));

const { EventGroupsPanel } = await import("@/components/admin/events/organisms/EventGroupsPanel");
const { EventTermsPanel } = await import("@/components/admin/events/organisms/EventTermsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const G = "adminEventTerms.groups.";
const T = "adminEventTerms.terms.";

function groupRow(overrides: Partial<EventGroupRow> = {}): EventGroupRow {
  return {
    attendee_visibility: "registered",
    can_chat: true,
    can_lead_retrieval: false,
    can_meet: true,
    can_see_attendees: true,
    can_see_recording: true,
    color: "#2563eb",
    created_at: "2026-08-01T09:00:00.000Z",
    description_en: "",
    description_pl: "",
    event_id: EVENT_ID,
    extra_members_count: 0,
    id: "grupa-a",
    is_default: false,
    is_system: false,
    key: "attendees",
    members_count: 0,
    min_tier_rank: 0,
    name_en: "Attendees",
    name_pl: "Uczestnicy",
    primary_members_count: 0,
    sort_order: 10,
    tickets_count: 0,
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function termRow(overrides: Partial<EventTermRow> = {}): EventTermRow {
  return {
    acceptances_current: 0,
    acceptances_total: 0,
    body_en: "Consent body.",
    body_pl: "Tresc zgody.",
    created_at: "2026-08-01T09:00:00.000Z",
    display: "registration",
    event_id: EVENT_ID,
    external_url: "https://example.org/regulamin",
    id: "zgoda-a",
    is_active: true,
    is_required: true,
    key: "rodo",
    label_en: "Data processing consent",
    label_pl: "Zgoda na przetwarzanie danych",
    sort_order: 10,
    updated_at: "2026-08-02T09:00:00.000Z",
    version: 1,
    withdrawn_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  h.groups = [groupRow()];
  h.terms = [termRow()];
  h.deletedGroups = [];
  h.deletedTerms = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("panel grup: potwierdzenie bez wskazanego wiersza", () => {
  // PARA. Polowa pierwsza: potwierdzenie kliknięte, gdy ZADEN wiersz nie zostal
  // wskazany, NIE MA PRAWA skasowac niczego - a najlatwiej byloby tu skasowac
  // „pierwsza z listy". Grupa niesie uprawnienia uczestnikow, wiec taki wypadek
  // odbiera prawa ludziom, ktorych nikt nie ruszal.
  it("bez wskazanego wiersza potwierdzenie NIE woła warstwy danych", () => {
    render(<EventGroupsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByText(`${G}deleteAction`));
    expect(h.deletedGroups).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  // Polowa druga: ze wskazanym wierszem to samo klikniecie DZIALA. Bez niej
  // pierwsza asercja bylaby spelniona takze przez przycisk, ktory nie robi nic.
  it("ze wskazanym wierszem to samo potwierdzenie kasuje TEN wiersz", () => {
    h.groups = [groupRow({ id: "grupa-a" }), groupRow({ id: "grupa-b", name_pl: "Prelegenci" })];
    render(<EventGroupsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getAllByLabelText(`${G}deleteAction`)[1]);
    fireEvent.click(screen.getByText(`${G}deleteAction`));
    expect(h.deletedGroups).toEqual(["grupa-b"]);
  });

  // OTWARCIE PYTANIA NIE KASUJE WSKAZANIA. Polowa `open === true` oslony
  // `onOpenChange` ma byc bezczynna - gdyby czyscila `pendingDelete`, kazde
  // ponowne otwarcie gasilo by wybor i potwierdzenie trafialoby w pustke.
  it("ponowne otwarcie pytania NIE gubi wskazanego wiersza", () => {
    render(<EventGroupsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByLabelText(`${G}deleteAction`));
    fireEvent.click(screen.getByText("atrapa-otworz"));
    fireEvent.click(screen.getByText(`${G}deleteAction`));
    expect(h.deletedGroups).toEqual(["grupa-a"]);
  });

  it("zamkniecie pytania kasuje wskazanie, a potwierdzenie po nim nic nie robi", () => {
    render(<EventGroupsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByLabelText(`${G}deleteAction`));
    fireEvent.click(screen.getByText("atrapa-zamknij"));
    fireEvent.click(screen.getByText(`${G}deleteAction`));
    expect(h.deletedGroups).toEqual([]);
  });
});

describe("panel zgod: potwierdzenie bez wskazanego wiersza", () => {
  // ZGODA JEST DOWODEM. Skasowanie „pierwszej z listy" po zagubionym klikniecu
  // zabiera rejestr akceptacji, ktorego nie da sie odtworzyc.
  it("bez wskazanego wiersza potwierdzenie NIE woła warstwy danych", () => {
    render(<EventTermsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByText(`${T}deleteAction`));
    expect(h.deletedTerms).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ze wskazanym wierszem to samo potwierdzenie kasuje TEN wiersz", () => {
    h.terms = [termRow({ id: "zgoda-a" }), termRow({ id: "zgoda-b", label_pl: "Regulamin" })];
    render(<EventTermsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getAllByLabelText(`${T}deleteAction`)[1]);
    fireEvent.click(screen.getByText(`${T}deleteAction`));
    expect(h.deletedTerms).toEqual(["zgoda-b"]);
  });

  it("ponowne otwarcie pytania NIE gubi wskazanej zgody", () => {
    render(<EventTermsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByLabelText(`${T}deleteAction`));
    fireEvent.click(screen.getByText("atrapa-otworz"));
    fireEvent.click(screen.getByText(`${T}deleteAction`));
    expect(h.deletedTerms).toEqual(["zgoda-a"]);
  });

  it("zamkniecie pytania kasuje wskazanie, a potwierdzenie po nim nic nie robi", () => {
    render(<EventTermsPanel eventId={EVENT_ID} />);
    fireEvent.click(screen.getByLabelText(`${T}deleteAction`));
    fireEvent.click(screen.getByText("atrapa-zamknij"));
    fireEvent.click(screen.getByText(`${T}deleteAction`));
    expect(h.deletedTerms).toEqual([]);
  });
});
