// Organizm „WEJŚCIA NA ŻYWO" - pulpit, przy którym koordynator decyduje
// w sekundę, czy wpuścić kolejną osobę do sali.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY MAJĄ CZTERY WIDOKI. Pusty pulpit mówi „pusto”, a awaria
//      mówi „odmowa” - i te dwa napisy NIE MOGĄ się zamieniać. Koordynator,
//      który po nieudanym zapytaniu przeczyta „nie ma żadnej sesji”, uzna, że
//      sale są puste, i wpuści ludzi do sali, która jest już pełna.
//   2. ZAJĘTOŚĆ JEST BRANA Z WIERSZA, NIE LICZONA NA EKRANIE. Baza zwraca
//      `inside` (wejścia minus wyjścia); panel pokazuje właśnie tę liczbę,
//      a `grantedIn`/`grantedOut` stoją obok niej jako osobne metryki. Gdyby
//      ekran sumował wejścia, pusta sala po zakończonej sesji nadal
//      pokazywałaby komplet.
//   3. PRZEKROCZENIE POJEMNOŚCI MA TRZY PROGI I KAŻDY JEST OSOBNYM
//      PRZYPADKIEM: pod limitem (bez odznaki), DOKŁADNIE na limicie („pełna”)
//      i ponad limitem („przepełniona”). Granica `inside === capacity` jest
//      miejscem, w którym mylą się wszystkie implementacje tego licznika.
//   4. BRAK POJEMNOŚCI TO NIE ZERO. `capacity === null` (sala bez limitu)
//      i `capacity === 0` (limit nieustawiony w bazie) muszą wyglądać tak samo:
//      sama liczba osób, bez odznaki alarmu. Odznaka „przepełniona” przy sali
//      bez limitu zamyka drzwi bez powodu.
//   5. GODZINA, KTÓREJ NIE MA, JEST MYŚLNIKIEM. `lastCheckinAt === null`
//      i data nie do sparsowania dają „-”, a nie „Invalid Date”.
//   6. OKNO CZASOWE JEDZIE DO ZAPYTANIA JAKO LICZBA MINUT. Droplista oddaje
//      napis; baza dostaje liczbę - to jest miejsce na `Number("60")`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Parsera `parseOnsiteLiveStats` - ma własny
// dom w `lib/events`; tutaj hook jest atrapą i oddaje gotowy kształt.
// (2) Słownika odmów bazy - tu jest atrapą, bo dowodzimy wyłącznie tego, że
// odmowa DOCHODZI zdaniem. (3) Formatu godziny - `toLocaleTimeString` zależy od
// wersji ICU maszyny, więc asercje dotyczą wyłącznie przypadków „nie ma czego
// pokazać”.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { axeViolations, summarize } from "@/test/axe";
import type {
  OnsiteLiveRoomStat,
  OnsiteLiveSessionStat,
  OnsiteLiveStats,
} from "@/lib/events/onsiteApi";

const h = vi.hoisted(() => ({
  lang: "pl",
  data: undefined as unknown,
  isLoading: false,
  listError: null as unknown,
  /** Argumenty KAŻDEGO wywołania hooka - dowód, że okno jedzie do bazy. */
  zapytania: [] as { eventId: string; windowMinutes: number }[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Słownik odmów ciągnie realny i18next i ma własny plik testowy; tutaj liczy
// się wyłącznie to, że odmowa dochodzi ZDANIEM, a nie kodem `42501`.
vi.mock("@/lib/events/adminOnsiteErrors", () => ({
  adminOnsiteErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Select nie otwiera listy pod happy-dom (potrzebuje wskaźnika i pomiarów
// układu), a wybór okna czasowego jest tu całą treścią zachowania. Atrapa jest
// natywna i przenosi z wyzwalacza `id`/`aria-label`/`aria-labelledby`, więc
// pole nadal da się znaleźć etykietą - dokładnie jak w produkcji.
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
  useOnsiteLiveStats: (eventId: string, windowMinutes: number) => {
    h.zapytania.push({ eventId, windowMinutes });
    return { data: h.data, isLoading: h.isLoading, error: h.listError };
  },
}));

import { OnsiteLiveStatsPanel } from "@/components/admin/events/organisms/OnsiteLiveStatsPanel";

const T = "adminEventOnsite.liveStats";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";

/** Sesja z kompletem liczb - pojedyncze pola nadpisujemy w przypadkach. */
function sesja(overrides: Partial<OnsiteLiveSessionStat> = {}): OnsiteLiveSessionStat {
  return {
    sessionId: "aaaaaaaa-1111-4111-8111-111111111111",
    titlePl: "Panel otwarcia",
    titleEn: "Opening panel",
    startsAt: "2026-09-01T08:00:00.000Z",
    endsAt: "2026-09-01T09:00:00.000Z",
    roomId: "bbbbbbbb-1111-4111-8111-111111111111",
    roomName: "Sala Kopernika",
    capacity: 100,
    grantedIn: 40,
    grantedOut: 15,
    denied: 3,
    inside: 25,
    uniquePeople: 38,
    recentIn: 7,
    lastCheckinAt: "2026-09-01T08:31:00.000Z",
    ...overrides,
  };
}

/** Sala z kompletem liczb. */
function sala(overrides: Partial<OnsiteLiveRoomStat> = {}): OnsiteLiveRoomStat {
  return {
    roomId: "bbbbbbbb-2222-4222-8222-222222222222",
    name: "Sala Marii Skłodowskiej",
    floor: "Parter",
    capacity: 60,
    grantedIn: 30,
    grantedOut: 10,
    denied: 1,
    inside: 20,
    uniquePeople: 29,
    recentIn: 4,
    lastCheckinAt: "2026-09-01T08:45:00.000Z",
    ...overrides,
  };
}

function pulpit(
  sessions: OnsiteLiveSessionStat[] = [],
  rooms: OnsiteLiveRoomStat[] = [],
): OnsiteLiveStats {
  return {
    generatedAt: "2026-09-01T08:50:00.000Z",
    windowMinutes: 60,
    sessions,
    rooms,
  };
}

function panel() {
  return render(<OnsiteLiveStatsPanel eventId={WYDARZENIE} />);
}

/** Wartość metryki spod `<dt>` o danym kluczu - `<dd>` jest jego sąsiadem. */
function metryka(klucz: string): string {
  const dt = screen.getByText(`${T}.${klucz}`);
  const dd = dt.nextElementSibling;
  if (dd === null) throw new Error(`metryka ${klucz} nie ma wartości`);
  return dd.textContent ?? "";
}

const oknoCzasowe = (): HTMLSelectElement =>
  screen.getByRole("combobox", { name: `${T}.windowLabel` });

beforeEach(() => {
  h.lang = "pl";
  h.data = pulpit([sesja()], [sala()]);
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
});

describe("cztery stany pulpitu na żywo", () => {
  it("zapytanie w locie mówi „wczytywanie” i nie rysuje ani jednej karty", () => {
    h.isLoading = true;
    h.data = undefined;
    const { container } = panel();

    expect(screen.getByText(`${T}.loading`)).toBeTruthy();
    expect(container.querySelectorAll("dl")).toHaveLength(0);
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
  });

  it("awaria pokazuje odmowę bazy i NIE mówi, że sal nie ma", () => {
    h.data = undefined;
    h.listError = new Error("permission_denied: brak dostępu");
    const { container } = panel();

    expect(screen.getByText("odmowa:permission_denied: brak dostępu")).toBeTruthy();
    expect(screen.queryByText(`${T}.empty`)).toBeNull();
    expect(container.querySelectorAll("dl")).toHaveLength(0);
  });

  it("brak sesji I brak sal to „pusto”, a nie „nie udało się”", () => {
    h.data = pulpit([], []);
    panel();

    expect(screen.getByText(`${T}.empty`)).toBeTruthy();
    expect(screen.queryByText(`${T}.loading`)).toBeNull();
  });

  it("same sale bez sesji to JUŻ nie jest pustka - pulpit rysuje sale", () => {
    h.data = pulpit([], [sala()]);
    panel();

    expect(screen.queryByText(`${T}.empty`)).toBeNull();
    expect(screen.getByText("Sala Marii Skłodowskiej")).toBeTruthy();
  });
});

describe("zajętość sali", () => {
  it("pokazuje LICZBĘ Z WIERSZA (wejścia minus wyjścia), a nie sumę wejść", () => {
    h.data = pulpit([], [sala({ inside: 20, grantedIn: 30, grantedOut: 10 })]);
    panel();

    // 20 to `inside` z bazy; 30 to same wejścia - gdyby ekran sumował sam,
    // w pustej sali po sesji nadal stałaby trzydziestka.
    expect(screen.getByText("20")).toBeTruthy();
    expect(metryka("grantedIn")).toBe("30");
    expect(metryka("grantedOut")).toBe("10");
  });

  it("pod limitem nie ma ani odznaki „pełna”, ani „przepełniona”", () => {
    h.data = pulpit([], [sala({ inside: 59, capacity: 60 })]);
    panel();

    expect(screen.queryByText(`${T}.full`)).toBeNull();
    expect(screen.queryByText(`${T}.overCapacity`)).toBeNull();
  });

  it("DOKŁADNIE na limicie sala jest „pełna” - to jest granica, nie przekroczenie", () => {
    h.data = pulpit([], [sala({ inside: 60, capacity: 60 })]);
    panel();

    expect(screen.getByText(`${T}.full`)).toBeTruthy();
    expect(screen.queryByText(`${T}.overCapacity`)).toBeNull();
  });

  it("jedna osoba ponad limitem to już „przepełniona”", () => {
    h.data = pulpit([], [sala({ inside: 61, capacity: 60 })]);
    panel();

    expect(screen.getByText(`${T}.overCapacity`)).toBeTruthy();
    expect(screen.queryByText(`${T}.full`)).toBeNull();
  });

  it("sala BEZ pojemności pokazuje samą liczbę osób i żadnej odznaki alarmu", () => {
    h.data = pulpit([], [sala({ inside: 200, capacity: null })]);
    panel();

    expect(screen.getByText(`${T}.inside`)).toBeTruthy();
    expect(screen.queryByText(`${T}.full`)).toBeNull();
    expect(screen.queryByText(`${T}.overCapacity`)).toBeNull();
  });

  it("pojemność ZERO znaczy „limit nieustawiony”, a nie „sala na zero osób”", () => {
    h.data = pulpit([], [sala({ inside: 5, capacity: 0 })]);
    panel();

    expect(screen.getByText(`${T}.inside`)).toBeTruthy();
    expect(screen.queryByText(`${T}.overCapacity`)).toBeNull();
  });

  it("pusta sala z limitem to nadal spokój - zero osób nie jest przepełnieniem", () => {
    h.data = pulpit([], [sala({ inside: 0, capacity: 60 })]);
    panel();

    expect(screen.queryByText(`${T}.full`)).toBeNull();
    expect(screen.queryByText(`${T}.overCapacity`)).toBeNull();
  });
});

describe("godziny i opisy", () => {
  it("brak ostatniej odprawy to myślnik, nie pusta wartość", () => {
    h.data = pulpit([], [sala({ lastCheckinAt: null })]);
    panel();

    expect(metryka("lastCheckin")).toBe("-");
  });

  it("data nie do sparsowania też jest myślnikiem, a nie „Invalid Date”", () => {
    h.data = pulpit([], [sala({ lastCheckinAt: "to-nie-jest-data" })]);
    panel();

    expect(metryka("lastCheckin")).toBe("-");
  });

  it("sesja bez sali mówi to wprost", () => {
    h.data = pulpit([sesja({ roomName: null })], []);
    panel();

    expect(screen.getByText(new RegExp(`${T}\\.noRoom`))).toBeTruthy();
  });

  it("sala bez oznaczenia piętra nie rysuje pustego akapitu", () => {
    h.data = pulpit([], [sala({ floor: null })]);
    panel();

    expect(screen.queryByText("Parter")).toBeNull();
  });

  it("po angielsku tytuł sesji jest angielski", () => {
    h.lang = "en";
    h.data = pulpit([sesja()], []);
    panel();

    expect(screen.getByText("Opening panel")).toBeTruthy();
    expect(screen.queryByText("Panel otwarcia")).toBeNull();
  });

  it("pusty tytuł angielski spada na polski, żeby wiersz nie był bezimienny", () => {
    h.lang = "en";
    h.data = pulpit([sesja({ titleEn: "" })], []);
    panel();

    expect(screen.getByText("Panel otwarcia")).toBeTruthy();
  });
});

describe("okno czasowe", () => {
  it("domyślnie pyta bazę o sześćdziesiąt minut", () => {
    panel();

    expect(h.zapytania[0]).toEqual({ eventId: WYDARZENIE, windowMinutes: 60 });
  });

  it("wybór okna jedzie do bazy jako LICZBA minut, nie jako napis z droplisty", () => {
    panel();
    fireEvent.change(oknoCzasowe(), { target: { value: "180" } });

    const ostatnie = h.zapytania[h.zapytania.length - 1];
    expect(ostatnie).toEqual({ eventId: WYDARZENIE, windowMinutes: 180 });
    expect(typeof ostatnie.windowMinutes).toBe("number");
  });

  it("droplista oferuje dokładnie trzy okna: 15, 60 i 180 minut", () => {
    panel();

    const wartosci = Array.from(oknoCzasowe().options).map((option) => option.value);
    expect(wartosci).toEqual(["15", "60", "180"]);
  });
});

describe("dostępność", () => {
  it("pulpit z sesją i salą nie ma naruszeń dostępności", async () => {
    const { container } = panel();
    await screen.findByText("Sala Marii Skłodowskiej");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusty pulpit też nie ma naruszeń dostępności", async () => {
    h.data = pulpit([], []);
    const { container } = panel();
    await screen.findByText(`${T}.empty`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("nagłówki sekcji", () => {
  it("obie kolumny są podpisane - sesje osobno, sale osobno", () => {
    panel();

    const naglowki = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(naglowki).toEqual([`${T}.sessionsTitle`, `${T}.roomsTitle`]);
  });

  it("metryki sesji i sali mają ten sam komplet sześciu pozycji", () => {
    h.data = pulpit([sesja()], []);
    const { container } = panel();

    const definicje = Array.from(container.querySelectorAll("dt")).map((node) => node.textContent);
    expect(definicje).toEqual([
      `${T}.grantedIn`,
      `${T}.grantedOut`,
      `${T}.uniquePeople`,
      `${T}.denied`,
      `${T}.recentIn`,
      `${T}.lastCheckin`,
    ]);
  });

  it("liczba odmów stoi w metrykach - koordynator widzi, ilu ludzi zawrócono", () => {
    h.data = pulpit([], [sala({ denied: 7 })]);
    const { container } = panel();

    const dl = container.querySelector("dl");
    if (dl === null) throw new Error("brak listy metryk");
    expect(within(dl).getByText("7")).toBeTruthy();
  });
});
