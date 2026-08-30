// Organizm „DZIENNIK ODPRAW" - jedyny zapis tego, kogo i kiedy wpuszczono.
//
// CO TEN PLIK DOWODZI.
//   1. PUSTY DZIENNIK TO „PUSTO", A NIE „NIE UDAŁO SIĘ". Awaria zapytania
//      pokazująca komunikat pustki mówi organizatorowi nieprawdę o stanie
//      wydarzenia: „nikt jeszcze nie wszedł" po nieudanym odczycie kończy się
//      otwarciem drugiej bramki albo ręcznym wpuszczaniem ludzi, których
//      odprawa JUŻ jest w bazie. Dlatego cztery stany mają cztery widoki,
//      a awaria ma kontrapunkt: napis o pustce nie ma prawa się pojawić.
//   2. FILTRY IDĄ DO BAZY, NIE DO TABLICY W PRZEGLĄDARCE. Każdy z czterech
//      filtrów ma osobny przypadek na to, co ląduje w zapytaniu, a wartość
//      „wszystkie" jedzie jako `undefined` - czyli BRAK warunku, a nie napis
//      `__all__`, którego baza nie zna.
//   3. KAŻDA ZMIANA FILTRA WRACA NA PIERWSZĄ STRONĘ. Filtr zawężający zbiór
//      przy pozostawionym `offset` pokazuje pustą stronę pełnego wyniku -
//      i to jest ten sam ekran, co „nic nie znaleziono".
//   4. `total_count` PRZYCHODZI W WIERSZU. Paginacja czyta liczbę z pierwszego
//      wiersza strony; pusta strona ma zero i to jest prawda, nie brak danych.
//   5. WIERSZ MÓWI, KTO WPUŚCIŁ I CZYM. Punkt kontrolny (w języku interfejsu),
//      urządzenie i operator - a odmowa wygląda INACZEJ niż wpuszczenie.
//   6. DZIENNIKA NIE EDYTUJEMY. W wierszu nie ma ani jednego przycisku: wiersz
//      odprawy jest dowodem wpuszczenia i zmiana go po fakcie unieważnia audyt.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Warstwy danych (`fetchCheckins`, obcinanie
// pustej frazy w `p_q`) - ma własny dom w `lib/events`; tutaj hook jest atrapą
// i notuje ZAPYTANIE, które organizm składa. (2) Słownika odmów bazy - tu jest
// atrapą. (3) Formatu daty - `toLocaleString` zależy od wersji ICU maszyny,
// więc asercje dotyczą wartości, które organizm wybiera, a nie napisu.
//
// OPÓŹNIENIE FRAZY JEST TU TOŻSAMOŚCIĄ (jak w `ClubThreadsTab.test.tsx`):
// przedmiotem dowodu jest to, CO dojedzie do zapytania, a nie po ilu
// milisekundach.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type { CheckinsQuery, EventCheckinRow, EventCheckpointRow } from "@/lib/events/onsiteApi";

/** Punkt kontrolny tak, jak czyta go filtr - trzy kolumny z sygnatury RPC. */
type PunktOpcja = Pick<EventCheckpointRow, "id" | "name_pl" | "name_en">;

const h = vi.hoisted(() => ({
  lang: "pl",
  rows: [] as unknown[] | undefined,
  isLoading: false,
  listError: null as unknown,
  punkty: [] as unknown[] | undefined,
  /** Każde zapytanie dziennika - dowód, że filtr jedzie do bazy. */
  zapytania: [] as unknown[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: (value: string) => value,
}));

// Radix Select nie otwiera listy pod happy-dom. Atrapa jest natywna i przenosi
// z wyzwalacza `id`, `aria-label` ORAZ `aria-labelledby` - to ostatnie jest
// jedyną nazwą dostępną droplist stopki paginacji, więc bez niego asercja
// dostępności zgłaszałaby błąd, którego w produkcji nie ma.
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
  useCheckins: (query: CheckinsQuery) => {
    h.zapytania.push(query);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
  useCheckpoints: () => ({ data: h.punkty, isLoading: false, error: null }),
}));

import { OnsiteLogPanel } from "@/components/admin/events/organisms/OnsiteLogPanel";

const T = "adminEventOnsite";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PUNKT = "22222222-2222-4222-8222-222222222222";

/**
 * Kolumna NULL-owalna, którą GENERATOR typuje jako `string`.
 *
 * `admin_event_checkins_list` oddaje `device_label`, `operator_name` czy
 * `note` jako NULL (odprawa z panelu nie ma urządzenia, odprawa z urządzenia
 * nie ma operatora), a wygenerowany typ obiecuje `string`. Organizm ma na to
 * jawne warunki (`filter((part) => part !== null && part !== "")`), więc
 * fixtura musi umieć oddać właśnie `null` - na pustym napisie ta gałąź
 * nigdy by nie padła.
 */
const BRAK = null as unknown as string;

/** Wpuszczenie przez bramkę główną - najczęstszy wiersz dziennika. */
function wpis(overrides: Partial<EventCheckinRow> = {}): EventCheckinRow {
  return {
    checkpoint_id: PUNKT,
    checkpoint_kind: "event_entry",
    checkpoint_name_en: "Main entrance",
    checkpoint_name_pl: "Wejście główne",
    company: "Instytut Analiz",
    device_id: "33333333-3333-4333-8333-333333333333",
    device_label: "Skaner bramka A",
    device_scanned_at: "2026-09-01T08:30:00.000Z",
    direction: "in",
    first_name: "Anna",
    group_name_en: BRAK,
    group_name_pl: BRAK,
    id: "44444444-4444-4444-8444-444444444444",
    job_title: "Analityczka",
    last_name: "Kowalska",
    note: BRAK,
    occurred_at: "2026-09-01T08:30:05.000Z",
    operator_name: "Obsługa bramki",
    operator_user_id: "55555555-5555-4555-8555-555555555555",
    person_id: "66666666-6666-4666-8666-666666666666",
    registration_id: "77777777-7777-4777-8777-777777777777",
    registration_status: "approved",
    repeat_count: 1,
    result: "granted",
    scanned_at: "2026-09-01T08:30:00.000Z",
    source: "qr_code",
    ticket_name_en: "Standard",
    ticket_name_pl: "Standardowy",
    total_count: 1,
    ...overrides,
  };
}

/** Punkt kontrolny na potrzeby droplisty filtra. */
function punkt(overrides: Partial<PunktOpcja> = {}): PunktOpcja {
  return { id: PUNKT, name_pl: "Wejście główne", name_en: "Main entrance", ...overrides };
}

function panel() {
  return render(<OnsiteLogPanel eventId={WYDARZENIE} />);
}

const wiersze = (): HTMLElement[] => screen.queryAllByRole("listitem");

const wiersz = (index = 0): HTMLElement => {
  const found = wiersze()[index];
  if (found === undefined) throw new Error(`brak wiersza nr ${index} w dzienniku`);
  return found;
};

const filtr = (nazwa: string): HTMLSelectElement =>
  screen.getByRole("combobox", { name: `${T}.filters.${nazwa}` });

const ostatnieZapytanie = (): CheckinsQuery => h.zapytania[h.zapytania.length - 1] as CheckinsQuery;

beforeEach(() => {
  h.lang = "pl";
  h.rows = [wpis()];
  h.isLoading = false;
  h.listError = null;
  h.punkty = [punkt()];
  h.zapytania = [];
});

describe("cztery stany dziennika", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednego wiersza", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(`${T}.log.loading`)).toBeTruthy();
    expect(wiersze()).toHaveLength(0);
    expect(screen.queryByText(`${T}.log.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że dziennik jest pusty", () => {
    h.rows = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.log.empty`)).toBeNull();
    expect(wiersze()).toHaveLength(0);
  });

  it("brak odpraw to „pusto”, a nie awaria", () => {
    h.rows = [];
    panel();

    expect(screen.getByText(`${T}.log.empty`)).toBeTruthy();
    expect(screen.queryByText(`${T}.log.loading`)).toBeNull();
    expect(wiersze()).toHaveLength(0);
  });

  it("wiersze rysują się bez żadnego z trzech komunikatów zastępczych", () => {
    panel();

    expect(wiersze()).toHaveLength(1);
    expect(screen.queryByText(`${T}.log.empty`)).toBeNull();
    expect(screen.queryByText(`${T}.log.loading`)).toBeNull();
  });
});

describe("filtry jadą do bazy", () => {
  it("pierwsze zapytanie nie niesie ŻADNEGO warunku poza wydarzeniem", () => {
    panel();

    expect(ostatnieZapytanie()).toEqual({
      eventId: WYDARZENIE,
      checkpointId: undefined,
      direction: undefined,
      result: undefined,
      q: "",
      limit: 50,
      offset: 0,
    });
  });

  it("wybór punktu kontrolnego jedzie jako identyfikator, a nie jako nazwa", () => {
    panel();
    fireEvent.change(filtr("checkpoint"), { target: { value: PUNKT } });

    expect(ostatnieZapytanie().checkpointId).toBe(PUNKT);
  });

  it("powrót na „wszystkie” ZDEJMUJE warunek, zamiast wysyłać `__all__`", () => {
    panel();
    fireEvent.change(filtr("checkpoint"), { target: { value: PUNKT } });
    fireEvent.change(filtr("checkpoint"), { target: { value: "__all__" } });

    expect(ostatnieZapytanie().checkpointId).toBeUndefined();
  });

  it("kierunek jedzie do bazy wartością ze słownika bazy", () => {
    panel();
    fireEvent.change(filtr("direction"), { target: { value: "out" } });

    expect(ostatnieZapytanie().direction).toBe("out");
  });

  it("wynik odprawy jedzie do bazy pełną nazwą odmowy", () => {
    panel();
    fireEvent.change(filtr("result"), { target: { value: "denied_capacity" } });

    expect(ostatnieZapytanie().result).toBe("denied_capacity");
  });

  it("fraza jedzie do bazy taka, jaką wpisano", () => {
    panel();
    fireEvent.change(screen.getByLabelText(`${T}.filters.search`), {
      target: { value: "Kowalska" },
    });

    expect(ostatnieZapytanie().q).toBe("Kowalska");
  });

  it("droplista wyników oferuje komplet sześciu wartości bazy plus „wszystkie”", () => {
    panel();

    expect(Array.from(filtr("result").options).map((option) => option.value)).toEqual([
      "__all__",
      "granted",
      "denied_not_registered",
      "denied_registration_status",
      "denied_direction",
      "denied_capacity",
      "denied_checkpoint_inactive",
    ]);
  });

  it("droplista kierunków oferuje dokładnie wejście i wyjście", () => {
    panel();

    expect(Array.from(filtr("direction").options).map((option) => option.value)).toEqual([
      "__all__",
      "in",
      "out",
    ]);
  });

  it("po angielsku punkt kontrolny w dropliście jest po angielsku", () => {
    h.lang = "en";
    panel();

    expect(Array.from(filtr("checkpoint").options).map((option) => option.textContent)).toContain(
      "Main entrance",
    );
  });

  it("punkt bez polskiej nazwy spada w dropliście na angielską, a nie na pustkę", () => {
    h.punkty = [punkt({ name_pl: "" })];
    panel();

    expect(Array.from(filtr("checkpoint").options).map((option) => option.textContent)).toContain(
      "Main entrance",
    );
  });

  it("punkt bez angielskiej nazwy spada po angielsku na polską", () => {
    h.lang = "en";
    h.punkty = [punkt({ name_en: "" })];
    panel();

    expect(Array.from(filtr("checkpoint").options).map((option) => option.textContent)).toContain(
      "Wejście główne",
    );
  });

  it("nieodczytana lista punktów zostawia sam wybór „wszystkie”, a nie pustą droplistę", () => {
    h.punkty = undefined;
    panel();

    expect(Array.from(filtr("checkpoint").options).map((option) => option.value)).toEqual([
      "__all__",
    ]);
  });
});

describe("paginacja i licznik", () => {
  it("łączna liczba jest brana Z WIERSZA, a nie z długości strony", () => {
    h.rows = [wpis({ total_count: 120 }), wpis({ id: "inny", total_count: 120 })];
    panel();

    expect(screen.getByText("admin.pagination.range(end=50,start=1,total=120)")).toBeTruthy();
  });

  it("pusta strona ma zero i stopka paginacji w ogóle się nie pokazuje", () => {
    h.rows = [];
    panel();

    expect(screen.queryByText(/admin\.pagination\.range/)).toBeNull();
  });

  it("zmiana strony przesuwa OFFSET o pełną stronę", () => {
    h.rows = [wpis({ total_count: 120 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "3" },
    });

    expect(ostatnieZapytanie().offset).toBe(100);
    expect(ostatnieZapytanie().limit).toBe(50);
  });

  it("zmiana rozmiaru strony wraca na pierwszą stronę i zmienia LIMIT", () => {
    h.rows = [wpis({ total_count: 500 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.perPage" }), {
      target: { value: "200" },
    });

    expect(ostatnieZapytanie()).toMatchObject({ limit: 200, offset: 0 });
  });

  it("zmiana filtra po przewinięciu listy wraca na pierwszą stronę", () => {
    h.rows = [wpis({ total_count: 500 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "5" },
    });
    expect(ostatnieZapytanie().offset).toBe(200);

    fireEvent.change(filtr("direction"), { target: { value: "in" } });
    expect(ostatnieZapytanie().offset).toBe(0);
  });

  it("wpisanie frazy też wraca na pierwszą stronę", () => {
    h.rows = [wpis({ total_count: 500 })];
    panel();
    fireEvent.change(screen.getByRole("combobox", { name: "admin.pagination.page" }), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText(`${T}.filters.search`), {
      target: { value: "Nowak" },
    });

    expect(ostatnieZapytanie().offset).toBe(0);
  });
});

describe("wiersz dziennika", () => {
  it("pokazuje imię i nazwisko, punkt kontrolny, urządzenie i operatora", () => {
    panel();
    const tresc = wiersz().textContent ?? "";

    expect(within(wiersz()).getByText("Anna Kowalska")).toBeTruthy();
    expect(tresc).toContain("Wejście główne");
    expect(tresc).toContain("Skaner bramka A");
    expect(tresc).toContain("Obsługa bramki");
  });

  it("odprawa z panelu nie ma urządzenia - wiersz nie rysuje pustego separatora", () => {
    h.rows = [wpis({ device_label: BRAK, operator_name: "Obsługa bramki" })];
    panel();

    expect(wiersz().textContent).toContain("Wejście główne · Obsługa bramki");
  });

  it("wpuszczenie i odmowa NIE wyglądają tak samo", () => {
    h.rows = [
      wpis(),
      wpis({ id: "odmowa", result: "denied_capacity", first_name: "Piotr", last_name: "Nowak" }),
    ];
    panel();

    expect(within(wiersz(0)).getByText(`${T}.results.granted`)).toBeTruthy();
    expect(within(wiersz(1)).getByText(`${T}.results.denied_capacity`)).toBeTruthy();
  });

  it("kierunek i źródło stoją w wierszu osobno - „wszedł” to nie to samo, co „czym”", () => {
    h.rows = [wpis({ direction: "out", source: "name_search" })];
    panel();

    expect(within(wiersz()).getByText(`${T}.directions.out`)).toBeTruthy();
    expect(within(wiersz()).getByText(`${T}.sources.name_search`)).toBeTruthy();
  });

  it("pierwsze wejście nie ma odznaki powtórzenia", () => {
    h.rows = [wpis({ repeat_count: 1 })];
    panel();

    expect(wiersz().textContent).not.toContain(`${T}.labels.repeatCount`);
  });

  it("drugie piknięcie tej samej osoby jest odznaczone liczbą powtórzeń", () => {
    h.rows = [wpis({ repeat_count: 3 })];
    panel();

    expect(wiersz().textContent).toContain(`${T}.labels.repeatCount: 3`);
  });

  it("po angielsku punkt kontrolny w wierszu jest po angielsku", () => {
    h.lang = "en";
    panel();

    expect(wiersz().textContent).toContain("Main entrance");
    expect(wiersz().textContent).not.toContain("Wejście główne");
  });

  it("pusta angielska nazwa punktu spada na polską, żeby wiersz nie zgubił bramki", () => {
    h.lang = "en";
    h.rows = [wpis({ checkpoint_name_en: "" })];
    panel();

    expect(wiersz().textContent).toContain("Wejście główne");
  });

  it("pusta polska nazwa punktu spada w wierszu na angielską", () => {
    h.rows = [wpis({ checkpoint_name_pl: "" })];
    panel();

    expect(wiersz().textContent).toContain("Main entrance");
  });

  it('strażnik `?? ""` przy nazwisku trzyma - inaczej w dzienniku stanęłoby „null null”', () => {
    // UCZCIWIE: DZIŚ ta sytuacja nie może zajść. `admin_event_checkins_list`
    // łączy się z `event_people` INNER JOIN-em, a `first_name`/`last_name` są
    // tam NOT NULL z CHECK-iem na długość. Wygenerowany typ tego nie wyraża
    // (obiecuje `string`), a organizm i tak ma jawny `?? ""` - ten przypadek
    // pilnuje, żeby przy zamianie złączenia na LEFT JOIN dziennik nie zaczął
    // pokazywać napisu „null null” zamiast pustego wiersza.
    h.rows = [wpis({ first_name: BRAK, last_name: BRAK })];
    panel();

    const nazwa = wiersz().querySelector("p");
    expect(nazwa?.textContent).toBe("");
  });

  it("w wierszu NIE MA żadnego przycisku - dziennika nie edytujemy", () => {
    panel();

    expect(within(wiersz()).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("dostępność", () => {
  it("dziennik z wierszami nie ma naruszeń dostępności", async () => {
    h.rows = [wpis({ total_count: 120 })];
    const { container } = panel();
    await screen.findByText("Anna Kowalska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusty dziennik też nie ma naruszeń dostępności", async () => {
    h.rows = [];
    const { container } = panel();
    await screen.findByText(`${T}.log.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
