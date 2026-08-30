// Molekuła „FORMULARZ STOLIKA" - siedem decyzji, z czego dwie zmieniają sposób,
// w jaki baza przydziela miejsca.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. POJEMNOŚĆ PRZYJMOWANA PRZEZ FORMULARZ TO DOKŁADNIE ZAKRES Z BAZY.
//     `event_meeting_tables_capacity_range` dopuszcza `BETWEEN 1 AND 50`.
//     Granice są tu odczytywane Z MIGRACJI, a nie wpisane w test: zakres luźniejszy
//     niż w bazie znaczy odmowę po kliknięciu „Zapisz", ostrzejszy - stolik,
//     którego baza by przyjęła, a formularz nie pozwala założyć. Kolumna jest
//     typu `integer`, więc kompilator tego rozjazdu NIE ZOBACZY.
//
//  2. ETYKIETA JEST WYMAGANA, A WALIDACJA POKAZUJE POWÓD. Przycisk zablokowany
//     bez zdania obok jest nieodróżnialny od zepsutego ekranu.
//
//  3. ŁADUNEK JEST TYM, CO ZOBACZY BAZA. Puste pole opcjonalne jedzie jako
//     `null` (nie jako pusty napis, który przechodzi CHECK długości i zostaje
//     w bazie jako widoczna pusta adnotacja), napisy są przycięte, a sala agendy
//     wraca Z WIERSZA - formularz jej nie zna i nie ma prawa jej wyczyścić.
//
//  4. PONOWNE OTWARCIE CZYŚCI SZKIC. Dialog zamknięty bez zapisu nie może
//     zostawić cudzych danych w polach następnego stolika - a przy UPSERCIE
//     to jest różnica między „nowy stolik" a „nadpisany cudzy".
//
//  5. ZAPIS W TOKU ODCINA PRZYCISK. Drugie kliknięcie to drugi stolik o tej
//     samej etykiecie - albo odmowa `table_label_taken` po udanym zapisie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Panelu listy stolików (`MeetingTablesPanel.test.tsx`)
// - tam dowodzimy, Z CZYM ten dialog jest otwierany i co panel robi z ładunkiem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import type { MeetingTableInput, MeetingTableRow } from "@/lib/events/meetingsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  // Radix montuje okno w portalu i nie odtwarza pod happy-dom pełnej mechaniki
  // wskaźnika. Atrapa zostawia KONTRAKT: przy `open === false` w drzewie nie ma
  // nic (na tym stoi dowód czyszczenia szkicu), a otwarte okno jest OPISANE
  // swoim tytułem.
  const TYTUL = "atrapa-okno-tytul";
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-labelledby={TYTUL}>
          {children}
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      react.createElement("h2", { id: TYTUL }, children),
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { MeetingTableDialog } =
  await import("@/components/admin/events/molecules/MeetingTableDialog");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const STOLIK = "22222222-2222-4222-8222-222222222222";
const SALA = "33333333-3333-4333-8333-333333333333";
const T = "adminEventMeetings.tables";

// ---------------------------------------------------------------------------
// PARYTET Z OGRANICZENIEM `CHECK` - granice czytamy z migracji, nie z pamięci
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Zakres z `CHECK (capacity BETWEEN <dolna> AND <gorna>)` - ostatnia definicja wygrywa. */
function zakresPojemnosci(): { min: number; max: number } {
  const marker = "CONSTRAINT event_meeting_tables_capacity_range";
  let body: string | null = null;
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    let from = sql.indexOf(marker);
    while (from !== -1) {
      body = sql.slice(from, from + 200);
      from = sql.indexOf(marker, from + 1);
    }
  }
  if (body === null) throw new Error("Brak ograniczenia pojemności stolika w migracjach.");
  const match = /BETWEEN\s+(\d+)\s+AND\s+(\d+)/i.exec(body);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Nie umiem odczytać zakresu pojemności z: ${body}`);
  }
  return { min: Number(match[1]), max: Number(match[2]) };
}

const ZAKRES = zakresPojemnosci();

/**
 * Nadpisania wiersza DOPUSZCZAJĄ `null` tam, gdzie wygenerowany typ `Returns`
 * obiecuje napis: `admin_event_meeting_tables_list` oddaje NULL w `zone`,
 * `note`, `room_id` i `room_name`, a dialog ma na to jawne `?? ""`.
 */
type NadpisanieWiersza = { [K in keyof MeetingTableRow]?: MeetingTableRow[K] | null };

function wiersz(over: NadpisanieWiersza = {}): MeetingTableRow {
  return {
    capacity: 2,
    created_at: "2026-08-01T08:00:00.000Z",
    id: STOLIK,
    is_active: true,
    label: "Stolik 4",
    meetings_count: 0,
    minutes_taken: 0,
    next_meeting_at: null,
    note: "Przy oknie",
    room_id: SALA,
    room_name: "Sala Kopernika",
    sort_order: 7,
    updated_at: "2026-08-01T08:00:00.000Z",
    zone: "Sala A",
    ...over,
  } as unknown as MeetingTableRow;
}

const zapisz = vi.fn();
const zmiana = vi.fn();

function dialog(props: { open?: boolean; row?: MeetingTableRow | null; isSaving?: boolean } = {}) {
  return render(
    <MeetingTableDialog
      open={props.open ?? true}
      eventId={WYDARZENIE}
      row={props.row ?? null}
      isSaving={props.isSaving ?? false}
      onSubmit={zapisz}
      onOpenChange={zmiana}
    />,
  );
}

const pole = (klucz: string): HTMLElement => screen.getByLabelText(klucz);
const przyciskZapisu = (): HTMLElement => screen.getByRole("button", { name: `${T}.saveAction` });
const wpisz = (klucz: string, wartosc: string): void => {
  fireEvent.change(pole(klucz), { target: { value: wartosc } });
};

/** Ostatni ładunek, który dialog oddał panelowi. */
function ostatniLadunek(): MeetingTableInput {
  const call = zapisz.mock.calls[zapisz.mock.calls.length - 1];
  if (call === undefined) throw new Error("dialog nie oddał żadnego ładunku");
  return call[0] as MeetingTableInput;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PARYTET: pojemność stolika kontra CHECK bazy", () => {
  it("migracja naprawdę definiuje zakres (test nie jest próżny)", () => {
    expect(ZAKRES.min).toBe(1);
    expect(ZAKRES.max).toBe(50);
  });

  it("dolna granica z bazy jest PRZYJMOWANA przez formularz", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    wpisz(`${T}.capacityLabel`, String(ZAKRES.min));
    expect(przyciskZapisu()).toBeEnabled();
    expect(screen.queryByText("adminEventMeetings.errors.invalidCapacity")).not.toBeInTheDocument();
  });

  it("górna granica z bazy jest PRZYJMOWANA przez formularz", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    wpisz(`${T}.capacityLabel`, String(ZAKRES.max));
    expect(przyciskZapisu()).toBeEnabled();
  });

  it.each([
    ["tuż poniżej dolnej granicy", ZAKRES.min - 1],
    ["tuż powyżej górnej granicy", ZAKRES.max + 1],
  ])("pojemność %s jest ODRZUCANA przez formularz", (_opis, wartosc) => {
    // Wartości liczone z granic bazy, nie wpisane na sztywno - gdy CHECK się
    // zmieni, ten test zmieni się razem z nim albo padnie.
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    wpisz(`${T}.capacityLabel`, String(wartosc));
    expect(przyciskZapisu()).toBeDisabled();
    expect(screen.getByText("adminEventMeetings.errors.invalidCapacity")).toBeInTheDocument();
  });

  it("pojemność, która nie jest liczbą, blokuje zapis zamiast lecieć do bazy", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    wpisz(`${T}.capacityLabel`, "dwa");
    expect(przyciskZapisu()).toBeDisabled();
    expect(screen.getByText("adminEventMeetings.errors.invalidCapacity")).toBeInTheDocument();
  });

  it("ułamek jest OBCINANY do liczby całkowitej, bo kolumna jest `integer`", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    wpisz(`${T}.capacityLabel`, "2.9");
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().capacity).toBe(2);
  });
});

describe("etykieta i pozostała walidacja", () => {
  it("nowy stolik startuje z zablokowanym zapisem i powodem obok pola", () => {
    dialog();
    expect(przyciskZapisu()).toBeDisabled();
    expect(screen.getByText("adminEventMeetings.errors.invalidLabel")).toBeInTheDocument();
  });

  it("etykieta z samych spacji NIE jest etykietą", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "    ");
    expect(przyciskZapisu()).toBeDisabled();
    expect(screen.getByText("adminEventMeetings.errors.invalidLabel")).toBeInTheDocument();
  });

  it("poprawna etykieta zamienia komunikat błędu w podpowiedź", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 1");
    expect(screen.getByText(`${T}.labelHint`)).toBeInTheDocument();
    expect(screen.queryByText("adminEventMeetings.errors.invalidLabel")).not.toBeInTheDocument();
  });

  it("kliknięcie zablokowanego zapisu nic nie wysyła", () => {
    dialog();
    fireEvent.click(przyciskZapisu());
    expect(zapisz).not.toHaveBeenCalled();
  });
});

describe("ładunek jest tym, co zobaczy baza", () => {
  it("nowy stolik jedzie bez identyfikatora i bez sali agendy", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "  Stolik 9  ");
    wpisz(`${T}.zoneLabel`, "  Sala B  ");
    wpisz(`${T}.capacityLabel`, "2");
    wpisz(`${T}.orderLabel`, "3");
    wpisz(`${T}.noteLabel`, "  Przy wejściu  ");
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek()).toEqual({
      id: null,
      eventId: WYDARZENIE,
      label: "Stolik 9",
      zone: "Sala B",
      roomId: null,
      capacity: 2,
      note: "Przy wejściu",
      sortOrder: 3,
      isActive: true,
    });
  });

  it("puste pola opcjonalne jadą jako `null`, a nie jako pusty napis", () => {
    // Pusty napis przechodzi CHECK długości i zostaje w bazie jako widoczna,
    // pusta adnotacja - a strefa `''` psuje grupowanie stolików na mapie sal.
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 9");
    wpisz(`${T}.zoneLabel`, "   ");
    wpisz(`${T}.noteLabel`, "");
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek().zone).toBeNull();
    expect(ostatniLadunek().note).toBeNull();
  });

  it("edycja niesie identyfikator i ZACHOWUJE salę agendy z wiersza", () => {
    // Przepięcie stolika między salami to decyzja agendy, nie giełdy - ten
    // formularz nie ma takiego pola, więc nie ma prawa wyzerować `room_id`.
    dialog({ row: wiersz() });
    fireEvent.click(przyciskZapisu());

    expect(ostatniLadunek()).toEqual({
      id: STOLIK,
      eventId: WYDARZENIE,
      label: "Stolik 4",
      zone: "Sala A",
      roomId: SALA,
      capacity: 2,
      note: "Przy oknie",
      sortOrder: 7,
      isActive: true,
    });
  });

  it("wiersz z pustymi kolumnami otwiera się bez `null` w polach", () => {
    dialog({ row: wiersz({ zone: null, note: null, room_id: null }) });
    expect(pole(`${T}.zoneLabel`)).toHaveValue("");
    expect(pole(`${T}.noteLabel`)).toHaveValue("");
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().roomId).toBeNull();
  });

  it("przełącznik „aktywny” jedzie w ładunku", () => {
    dialog({ row: wiersz() });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().isActive).toBe(false);
  });

  it("kolejność, której nie da się odczytać, degraduje do zera, a nie do NaN", () => {
    dialog();
    wpisz(`${T}.labelLabel`, "Stolik 9");
    wpisz(`${T}.orderLabel`, "gdzieś na końcu");
    fireEvent.click(przyciskZapisu());
    expect(ostatniLadunek().sortOrder).toBe(0);
  });
});

describe("szkic nie przecieka między otwarciami", () => {
  it("tytuł mówi, czy to nowy stolik, czy edycja", () => {
    const { rerender } = dialog();
    expect(screen.getByRole("heading", { name: `${T}.addAction` })).toBeInTheDocument();

    rerender(
      <MeetingTableDialog
        open
        eventId={WYDARZENIE}
        row={wiersz()}
        isSaving={false}
        onSubmit={zapisz}
        onOpenChange={zmiana}
      />,
    );
    expect(screen.getByRole("heading", { name: `${T}.editAction` })).toBeInTheDocument();
  });

  it("ponowne otwarcie po edycji NIE zostawia cudzych danych w polach", () => {
    // Przy UPSERCIE to jest różnica między „nowy stolik" a „nadpisany cudzy":
    // gdyby w polu została etykieta poprzedniego, baza odbiłaby zapis
    // `table_label_taken` albo - gorzej - przyjęłaby go pod jego `id`.
    const { rerender } = dialog({ row: wiersz() });
    expect(pole(`${T}.labelLabel`)).toHaveValue("Stolik 4");

    const okno = (open: boolean, row: MeetingTableRow | null) => (
      <MeetingTableDialog
        open={open}
        eventId={WYDARZENIE}
        row={row}
        isSaving={false}
        onSubmit={zapisz}
        onOpenChange={zmiana}
      />
    );
    rerender(okno(false, wiersz()));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(okno(true, null));
    expect(pole(`${T}.labelLabel`)).toHaveValue("");
    expect(pole(`${T}.zoneLabel`)).toHaveValue("");
    expect(pole(`${T}.capacityLabel`)).toHaveValue("1");
  });

  it("zamknięte okno nie ma w drzewie ani jednego pola", () => {
    dialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${T}.labelLabel`)).not.toBeInTheDocument();
  });

  it("„Anuluj” zamyka okno, nie wysyłając ładunku", () => {
    dialog({ row: wiersz() });
    fireEvent.click(screen.getByRole("button", { name: `${T}.cancelAction` }));
    expect(zmiana).toHaveBeenCalledWith(false);
    expect(zapisz).not.toHaveBeenCalled();
  });
});

describe("zapis w toku", () => {
  it("trwający zapis ODCINA przycisk - drugie kliknięcie nie zakłada drugiego stolika", () => {
    dialog({ row: wiersz(), isSaving: true });
    expect(przyciskZapisu()).toBeDisabled();

    fireEvent.click(przyciskZapisu());
    fireEvent.click(przyciskZapisu());
    expect(zapisz).not.toHaveBeenCalled();
  });
});

describe("dostępność", () => {
  it("formularz nowego stolika nie ma naruszeń dostępności", async () => {
    const { container } = dialog();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("formularz edycji z wypełnionymi polami też nie ma naruszeń dostępności", async () => {
    const { container } = dialog({ row: wiersz() });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
