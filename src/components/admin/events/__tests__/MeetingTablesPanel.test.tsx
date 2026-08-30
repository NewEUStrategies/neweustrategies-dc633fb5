// Organizm „STOLIKI GIEŁDY 1-1" - lista miejsc, przy których odbywają się
// rozmowy, i jedyny ekran, z którego da się je wyłączyć albo skasować.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. TRZY STANY LISTY MAJĄ TRZY WIDOKI. „Nie ma jeszcze stolików" po nieudanym
//     zapytaniu to zaproszenie do założenia ich drugi raz - a duplikat etykiety
//     odbije się dopiero o `table_label_taken` w bazie.
//
//  2. LICZNIK MIEJSC LICZY TYLKO STOLIKI CZYNNE. To jedyna liczba, z której
//     organizator wnioskuje, czy giełda się zmieści; policzenie do niej stolika
//     wyłączonego obiecuje przepustowość, której siatka nie ma.
//
//  3. PRZEŁĄCZNIK „AKTYWNY" WYSYŁA CAŁY WIERSZ. RPC zapisu jest UPSERTEM: pola
//     pominięte w ładunku nie zostają nietknięte, tylko wracają do wartości
//     domyślnych. Wysłanie samej flagi skasowałoby strefę, notatkę i kolejność
//     stolika - po cichu, przy zwykłym kliknięciu w przełącznik.
//
//  4. KOLIZJA „STOLIK JEST W UŻYCIU" MA WŁASNE ZDANIE. Baza nie pozwala skasować
//     stolika, przy którym cokolwiek się odbyło - także spotkań odwołanych
//     i odbytych. Odmowa `table_in_use` musi dojść do organizatora jako zdanie
//     mówiące, co zrobić zamiast tego (wyłączyć), a nie jako cisza.
//
//  5. USUNIĘCIE PRZECHODZI PRZEZ POTWIERDZENIE, WYŁĄCZENIE NIE. Wyłączenie jest
//     odwracalne jednym kliknięciem, usunięcie nie jest odwracalne wcale.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Formularza stolika - ma własny plik
// `MeetingTableDialog.test.tsx`; tutaj jest atrapą, bo przedmiotem dowodu jest
// to, Z CZYM panel go otwiera i co robi z jego wynikiem. (2) Mapowania odmów
// bazy (`adminMeetingErrors.test.ts`). (3) Zachowania hooków
// (`useMeetings.test.tsx`) - hooki są tu PRAWDZIWE, atrapą jest warstwa
// sieciowa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import type { MeetingTableInput, MeetingTableRow } from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  tables: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/lib/events/adminMeetingErrors", () => ({
  adminMeetingFailure: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { key: `adminEventMeetings.errors.${message.split(":")[0]}`, params: {} };
  },
}));

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

const TYTUL_POTWIERDZENIA = "atrapa-potwierdzenie-tytul";

vi.mock("@/components/ui/alert-dialog", async () => {
  const react = await import("react");
  // Radixowe okno potwierdzenia montuje się w portalu i pod happy-dom nie
  // odtwarza mechaniki fokusa. Atrapa zostawia z niego KONTRAKT: zamknięte nie
  // ma w drzewie nic, otwarte jest OPISANE swoim tytułem.
  const Ctx = react.createContext<{ open: boolean; zamknij: () => void }>({
    open: false,
    zamknij: () => undefined,
  });
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open: open === true, zamknij: () => onOpenChange?.(false) }}>
        {children}
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? (
        <div role="alertdialog" aria-labelledby={TYTUL_POTWIERDZENIA}>
          {children}
        </div>
      ) : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => (
      <h3 id={TYTUL_POTWIERDZENIA}>{children}</h3>
    ),
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return (
        <button type="button" onClick={ctx.zamknij}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Formularz stolika ma własny plik testowy. Atrapa wystawia to, co panel do
// niego wysyła (`row`, `isSaving`) i jeden przycisk odsyłający gotowy ładunek.
const LADUNEK_Z_FORMULARZA: MeetingTableInput = {
  id: null,
  eventId: "",
  label: "Stolik 9",
  zone: "Sala B",
  roomId: null,
  capacity: 2,
  note: null,
  sortOrder: 3,
  isActive: true,
};

vi.mock("@/components/admin/events/molecules/MeetingTableDialog", () => ({
  MeetingTableDialog: ({
    open,
    eventId,
    row,
    isSaving,
    onSubmit,
    onOpenChange,
  }: {
    open: boolean;
    eventId: string;
    row: MeetingTableRow | null;
    isSaving: boolean;
    onSubmit: (input: MeetingTableInput) => void;
    onOpenChange: (next: boolean) => void;
  }) =>
    open ? (
      <div data-testid="atrapa-formularz" data-row={row === null ? "nowy" : row.id}>
        <span data-testid="atrapa-zapis-w-toku">{String(isSaving)}</span>
        <button type="button" onClick={() => onSubmit({ ...LADUNEK_Z_FORMULARZA, eventId })}>
          atrapa-zapisz-stolik
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          atrapa-zamknij-formularz
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchMeetingTables: (eventId: string) => h.tables(eventId),
  saveMeetingTable: (input: unknown) => h.save(input),
  deleteMeetingTable: (id: string) => h.remove(id),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MeetingTablesPanel } =
  await import("@/components/admin/events/organisms/MeetingTablesPanel");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const STOLIK = "22222222-2222-4222-8222-222222222222";
const SALA = "33333333-3333-4333-8333-333333333333";
const T = "adminEventMeetings.tables";

/**
 * Nadpisania wiersza DOPUSZCZAJĄ `null`, choć wygenerowany typ `Returns` go nie
 * przewiduje. `admin_event_meeting_tables_list` naprawdę oddaje NULL w `zone`,
 * `note`, `room_id`, `room_name` i `next_meeting_at` (stolik bez strefy, bez
 * przypisanej sali, bez ani jednego spotkania), a organizm ma na to jawne
 * `=== null`.
 */
type NadpisanieWiersza = { [K in keyof MeetingTableRow]?: MeetingTableRow[K] | null };

function stolik(over: NadpisanieWiersza = {}): MeetingTableRow {
  return {
    capacity: 2,
    created_at: "2026-08-01T08:00:00.000Z",
    id: STOLIK,
    is_active: true,
    label: "Stolik 4",
    meetings_count: 3,
    minutes_taken: 60,
    next_meeting_at: "2026-09-10T08:00:00.000Z",
    note: null,
    room_id: SALA,
    room_name: "Sala Kopernika",
    sort_order: 1,
    updated_at: "2026-08-01T08:00:00.000Z",
    zone: "Sala A",
    ...over,
  } as unknown as MeetingTableRow;
}

function panel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MeetingTablesPanel eventId={WYDARZENIE} />
    </QueryClientProvider>,
  );
}

/** Obietnica, która nigdy się nie rozstrzyga - zamraża stan wczytywania/zapisu. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });
const potwierdzenie = (): HTMLElement => screen.getByRole("alertdialog");

/** Przycisk WEWNĄTRZ okna potwierdzenia - te same etykiety stoją też w wierszu. */
function przyciskWPotwierdzeniu(nazwa: string): HTMLElement {
  const znaleziony = Array.from(potwierdzenie().querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === nazwa,
  );
  if (znaleziony === undefined) throw new Error(`brak przycisku ${nazwa} w potwierdzeniu`);
  return znaleziony;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tables.mockResolvedValue([stolik()]);
  h.save.mockResolvedValue(STOLIK);
  h.remove.mockResolvedValue(true);
});

describe("trzy stany listy stolików", () => {
  it("WCZYTYWANIE nie udaje pustki", async () => {
    h.tables.mockReturnValue(nigdy());
    panel();
    expect(await screen.findByText(`${T}.loading`)).toBeInTheDocument();
    expect(screen.queryByText(`${T}.empty`)).not.toBeInTheDocument();
  });

  it("ODMOWA BAZY nie udaje pustki", async () => {
    h.tables.mockRejectedValue(new Error("forbidden: not an editor"));
    panel();
    expect(await screen.findByText("adminEventMeetings.errors.forbidden")).toBeInTheDocument();
    expect(screen.queryByText(`${T}.empty`)).not.toBeInTheDocument();
  });

  it("PUSTKA mówi to wprost", async () => {
    h.tables.mockResolvedValue([]);
    panel();
    expect(await screen.findByText(`${T}.empty`)).toBeInTheDocument();
    expect(screen.getByText(`${T}.seatsSummary(seats=0,tables=0)`)).toBeInTheDocument();
  });
});

describe("licznik miejsc i treść wiersza", () => {
  it("do sumy miejsc wchodzą TYLKO stoliki czynne", async () => {
    // Stolik wyłączony nadal stoi na liście (i nadal ma pojemność), ale giełda
    // nic przy nim nie posadzi - policzenie go obiecywałoby przepustowość,
    // której siatka nie ma.
    h.tables.mockResolvedValue([
      stolik({ id: "t-1", capacity: 2, is_active: true }),
      stolik({ id: "t-2", capacity: 5, is_active: false }),
    ]);
    panel();
    await screen.findAllByRole("listitem");
    expect(screen.getByText(`${T}.seatsSummary(seats=2,tables=2)`)).toBeInTheDocument();
  });

  it("wiersz pokazuje strefę, salę i obciążenie policzone przez bazę", async () => {
    panel();
    const wiersze = await screen.findAllByRole("listitem");
    expect(wiersze[0]?.textContent).toContain("Stolik 4");
    expect(screen.getByText("Sala A")).toBeInTheDocument();
    expect(screen.getByText("Sala Kopernika")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${T}\\.loadValue\\(count=3,minutes=60\\)`)),
    ).toBeInTheDocument();
  });

  it("stolik bez strefy i bez sali nie rysuje pustych odznak", async () => {
    h.tables.mockResolvedValue([stolik({ zone: null, room_id: null, room_name: null })]);
    panel();
    await screen.findAllByRole("listitem");
    expect(screen.queryByText("Sala A")).not.toBeInTheDocument();
    expect(screen.queryByText("Sala Kopernika")).not.toBeInTheDocument();
  });

  it("stolik bez ani jednego spotkania nie pokazuje „najbliższego terminu”", async () => {
    h.tables.mockResolvedValue([stolik({ next_meeting_at: null, meetings_count: 0 })]);
    panel();
    await screen.findAllByRole("listitem");
    expect(screen.queryByText(new RegExp(`${T}\\.nextColumn`))).not.toBeInTheDocument();
  });
});

describe("przełącznik „aktywny” jest UPSERTEM całego wiersza", () => {
  it("wyłączenie wysyła KOMPLET pól, nie samą flagę", async () => {
    // RPC zapisu nadpisuje wiersz w całości: pominięta strefa, notatka albo
    // kolejność wracają do wartości domyślnych. Utrata tych pól przy kliknięciu
    // w przełącznik jest niewidoczna do momentu, w którym ktoś otworzy formularz.
    h.tables.mockResolvedValue([stolik({ note: "Przy oknie" })]);
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("switch", { name: `${T}.activeLabel` }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        id: STOLIK,
        eventId: WYDARZENIE,
        label: "Stolik 4",
        zone: "Sala A",
        roomId: SALA,
        capacity: 2,
        note: "Przy oknie",
        sortOrder: 1,
        isActive: false,
      }),
    );
  });

  it("włączenie wyłączonego stolika wysyła `isActive: true`", async () => {
    h.tables.mockResolvedValue([stolik({ is_active: false })]);
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("switch", { name: `${T}.activeLabel` }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: true })),
    );
  });

  it("odmowa przy przełączaniu kończy się ZDANIEM", async () => {
    h.save.mockRejectedValue(new Error("table_label_taken: duplicate"));
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("switch", { name: `${T}.activeLabel` }));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminEventMeetings.errors.table_label_taken"),
    );
    // Przełącznik w wierszu nie melduje sukcesu - to zmiana jednym kliknięciem,
    // a nie zapis formularza.
    expect(h.success).not.toHaveBeenCalled();
  });
});

describe("formularz stolika: nowy kontra edycja", () => {
  it("„Dodaj” otwiera formularz PUSTY, a nie z ostatnio edytowanym stolikiem", async () => {
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(przycisk(`${T}.editAction`));
    expect(screen.getByTestId("atrapa-formularz")).toHaveAttribute("data-row", STOLIK);
    fireEvent.click(screen.getByRole("button", { name: "atrapa-zamknij-formularz" }));

    fireEvent.click(przycisk(`${T}.addAction`));
    expect(screen.getByTestId("atrapa-formularz")).toHaveAttribute("data-row", "nowy");
  });

  it("zapis z formularza jedzie do bazy, zamyka okno i melduje sukces", async () => {
    panel();
    await screen.findAllByRole("listitem");
    fireEvent.click(przycisk(`${T}.addAction`));

    fireEvent.click(screen.getByRole("button", { name: "atrapa-zapisz-stolik" }));
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({ ...LADUNEK_Z_FORMULARZA, eventId: WYDARZENIE }),
    );
    await waitFor(() => expect(screen.queryByTestId("atrapa-formularz")).not.toBeInTheDocument());
    expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.tableSaved");
  });

  it("nieudany zapis ZOSTAWIA formularz otwarty", async () => {
    // Zamknięte okno po odmowie kasuje całą pracę i nie mówi, czy stolik
    // powstał - a etykieta bywa zajęta przez stolik z sąsiedniej strefy.
    h.save.mockRejectedValue(new Error("table_label_taken: duplicate"));
    panel();
    await screen.findAllByRole("listitem");
    fireEvent.click(przycisk(`${T}.addAction`));

    fireEvent.click(screen.getByRole("button", { name: "atrapa-zapisz-stolik" }));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminEventMeetings.errors.table_label_taken"),
    );
    expect(screen.getByTestId("atrapa-formularz")).toBeInTheDocument();
  });

  it("trwający zapis dociera do formularza jako `isSaving`", async () => {
    h.save.mockReturnValue(nigdy());
    panel();
    await screen.findAllByRole("listitem");
    fireEvent.click(przycisk(`${T}.addAction`));
    expect(screen.getByTestId("atrapa-zapis-w-toku")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "atrapa-zapisz-stolik" }));
    await waitFor(() =>
      expect(screen.getByTestId("atrapa-zapis-w-toku")).toHaveTextContent("true"),
    );
  });
});

describe("KOLIZJA: stolik, przy którym coś się już odbyło", () => {
  it("usunięcie przechodzi przez POTWIERDZENIE - samo kliknięcie nic nie kasuje", async () => {
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(przycisk(`${T}.deleteAction`));
    expect(potwierdzenie()).toBeInTheDocument();
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("odmowa `table_in_use` mówi ZDANIEM, dlaczego stolik zostaje", async () => {
    // Baza broni historii: przy tym stoliku odbyły się (albo zostały odwołane)
    // spotkania, więc skasowanie zabrałoby im miejsce zdarzenia. Wyjściem jest
    // wyłączenie, o czym mówi słownik - ale tylko jeśli komunikat dojdzie.
    h.remove.mockRejectedValue(new Error("table_in_use: table is used by 3 meetings"));
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(przycisk(`${T}.deleteAction`));
    fireEvent.click(przyciskWPotwierdzeniu(`${T}.deleteAction`));

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminEventMeetings.errors.table_in_use"),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.success).not.toHaveBeenCalled();
    // Stolik ZOSTAJE na liście - odmowa nie usuwa go z ekranu.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("udane usunięcie odświeża listę i melduje sukces", async () => {
    panel();
    await screen.findAllByRole("listitem");
    expect(h.tables).toHaveBeenCalledTimes(1);

    fireEvent.click(przycisk(`${T}.deleteAction`));
    fireEvent.click(przyciskWPotwierdzeniu(`${T}.deleteAction`));

    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(STOLIK));
    await waitFor(() => expect(h.tables).toHaveBeenCalledTimes(2));
    expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.tableDeleted");
  });

  it("rezygnacja z potwierdzenia nie kasuje niczego", async () => {
    panel();
    await screen.findAllByRole("listitem");

    fireEvent.click(przycisk(`${T}.deleteAction`));
    fireEvent.click(przyciskWPotwierdzeniu(`${T}.cancelAction`));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.remove).not.toHaveBeenCalled();
  });
});

describe("dostępność", () => {
  it("lista stolików nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findAllByRole("listitem");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarte potwierdzenie usunięcia też nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findAllByRole("listitem");
    fireEvent.click(przycisk(`${T}.deleteAction`));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
