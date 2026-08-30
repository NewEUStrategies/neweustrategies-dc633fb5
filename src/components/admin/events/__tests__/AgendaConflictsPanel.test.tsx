// Organizm „KOLIZJE AGENDY" - raport sprzeczności, których baza NIE blokuje.
//
// CO TEN PLIK DOWODZI.
//   1. RAPORT POKAZUJE KOLIZJE, A NIE PUSTY GRAFIK. Pusta agenda nie dowodzi,
//      że wykrywanie działa - dowodzi tylko, że nic nie wykryto. Dlatego trzon
//      pliku to CZTERY rodzaje z migracji `20260824084741…` postawione obok
//      siebie: `speaker_overlap`, `outside_event_window`, `capacity_over_room`
//      i `overbooked`. Kolizji SALI tu nie ma - baza jej nie dopuszcza
//      (ograniczenie `event_sessions_room_no_overlap`), więc panel, który by ją
//      pokazywał, mówiłby o stanie niemożliwym.
//   2. TRZY STANY LISTY MAJĄ TRZY WIDOKI, a awaria NIE MOŻE mówić „agenda nie ma
//      kolizji". To najgroźniejsze zdanie w całym module: organizator czyta je
//      jako zgodę na publikację programu, w którym prelegent stoi w dwóch salach.
//   3. NIEZNANY RODZAJ Z BAZY NIE POKAZUJE SUROWEGO KLUCZA i18n. Nowa migracja
//      z piątym rodzajem ma dać czytelny (choćby techniczny) napis, a nie
//      `adminEventAgenda.conflictKinds.room_double_booked`.
//   4. LICZBY POKAZUJĄ SIĘ TYLKO TAM, GDZIE BAZA JE PODAJE. `expected_value`
//      i `actual_value` niosą wyłącznie dwa rodzaje pojemnościowe; dwa pozostałe
//      dostają z RPC `NULL`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Słownika odmów (`adminAgendaErrors.test.ts`).
// (2) Hooków i unieważnień (`useEventSessions.test.ts`). (3) Siatki czasu, która
// pokazuje te same kolizje GRAFICZNIE (`AgendaTimelinePanel.test.tsx`).
//
// RODO: nazwy prelegentów są wymyślone, jak w `runtime_test.d/10_sessions.sql`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import type { AgendaConflictRow } from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as AgendaConflictRow[] | undefined,
  isLoading: false,
  listError: null as Error | null,
  eventIds: [] as (string | null)[],
}));

/**
 * Atrapa i18n, która UMIE ODRÓŻNIĆ klucz istniejący od nieistniejącego.
 *
 * Zapasowa ścieżka `kindLabel` stoi na jedynej rzeczy, jaką i18next mówi
 * o brakującym wpisie: oddaje wtedy SAM KLUCZ. Zwykłe echo klucza (`i18nStub`)
 * modeluje więc słownik CAŁKIEM PUSTY - przy nim każdy z czterech rodzajów
 * z migracji wyglądałby na nieznany i gałąź słownikowa nie byłaby dotknięta.
 * Dlatego cztery klucze, które istnieją w `i18n-admin-event-agenda`, oddają tu
 * napis (z kluczem w środku, żeby asercje dalej czytały KLUCZE), a każdy inny -
 * echo klucza, dokładnie jak i18next bez tłumaczenia.
 */
const SLOWNIK_RODZAJOW = new Set([
  "adminEventAgenda.conflictKinds.speaker_overlap",
  "adminEventAgenda.conflictKinds.outside_event_window",
  "adminEventAgenda.conflictKinds.capacity_over_room",
  "adminEventAgenda.conflictKinds.overbooked",
]);

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const t = (key: string, options?: Record<string, unknown>): string =>
    SLOWNIK_RODZAJOW.has(key) ? `napis:${key}` : translateKey(key, options);
  const i18n = {
    get language() {
      return h.language;
    },
    t,
  };
  return {
    useTranslation: () => ({ t, i18n }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI zdaniem, a nie kodem.
vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useAgendaConflicts: (eventId: string | null) => {
    h.eventIds.push(eventId);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
}));

const { AgendaConflictsPanel } =
  await import("@/components/admin/events/organisms/AgendaConflictsPanel");

const EVENT_ID = "e5000000-0000-4000-8000-0000000000a3";
const SESJA_A = "aa000000-0000-4000-8000-000000000001";
const SESJA_B = "aa000000-0000-4000-8000-000000000002";
const SESJA_C = "aa000000-0000-4000-8000-000000000003";
const SESJA_D = "aa000000-0000-4000-8000-000000000004";
const PRELEGENT = "59000000-0000-4000-8000-0000000000a1";
const SALA = "a6000000-0000-4000-8000-000000000002";

/**
 * Kolumny, które RPC oddaje jako `NULL`, a generator typuje jako `string`
 * / `number`.
 *
 * `admin_event_agenda_conflicts` skleja cztery zapytania przez `UNION ALL`
 * i uzupełnia brakujące kolumny literałami `NULL::uuid`, `NULL::text`,
 * `NULL::integer` - sesja poza oknem wydarzenia nie ma „drugiej sesji",
 * a przekroczony limit zapisów nie ma podmiotu. Wygenerowany typ obiecuje
 * jednak `string` i `number`, bo sygnatura `RETURNS TABLE` nie niesie
 * `NOT NULL`. To jedyne miejsce w tym pliku, w którym rzutujemy - i rzutujemy
 * właśnie po to, żeby fixture mówił PRAWDĘ o odpowiedzi bazy.
 *
 * DLACZEGO RZUTOWANIE JEST TU JEDYNYM WYJŚCIEM. Fixture musi mieć DOKŁADNIE
 * kształt wiersza z generatora - własny, poluzowany typ przestałby pilnować
 * sygnatury RPC, a to właśnie ona ma tu pęknąć, gdy zmieni się kolumna.
 * Wartość zgodna z typem (pusty napis, zero) byłaby KŁAMSTWEM o odpowiedzi
 * bazy i schowałaby dokładnie te przypadki, dla których ten plik istnieje.
 * Dług należy do wygenerowanych typów i znika, gdy generator nauczy się
 * `NOT NULL` (pilnuje tego `check:types-freshness`).
 */
const BRAK_NAPISU = null as unknown as string;
const BRAK_LICZBY = null as unknown as number;

/** Wiersz `admin_event_agenda_conflicts` - pełny kształt sygnatury RPC. */
function konflikt(overrides: Partial<AgendaConflictRow> = {}): AgendaConflictRow {
  return {
    actual_value: BRAK_LICZBY,
    expected_value: BRAK_LICZBY,
    kind: "speaker_overlap",
    other_session_id: BRAK_NAPISU,
    other_title_en: BRAK_NAPISU,
    other_title_pl: BRAK_NAPISU,
    session_id: SESJA_A,
    session_starts_at: "2026-09-05T07:30:00.000Z",
    session_title_en: "Report one",
    session_title_pl: "Raport jeden",
    subject_id: BRAK_NAPISU,
    subject_name: BRAK_NAPISU,
    ...overrides,
  };
}

/** 1. TEN SAM PRELEGENT W DWÓCH SESJACH NARAZ. */
const KOLIZJA_PRELEGENTA = konflikt({
  kind: "speaker_overlap",
  session_id: SESJA_A,
  session_title_pl: "Raport jeden",
  session_title_en: "Report one",
  other_session_id: SESJA_B,
  other_title_pl: "Raport dwa",
  other_title_en: "Report two",
  subject_id: PRELEGENT,
  subject_name: "Prelegent A1",
});

/** 2. SESJA POZA GODZINAMI WYDARZENIA. */
const POZA_OKNEM = konflikt({
  kind: "outside_event_window",
  session_id: SESJA_C,
  session_title_pl: "Sesja po zamknięciu",
  session_title_en: "Session after close",
  subject_id: EVENT_ID,
  subject_name: "Kongres testowy",
});

/** 3. LIMIT MIEJSC SESJI PONAD POJEMNOŚĆ SALI. */
const LIMIT_PONAD_SALE = konflikt({
  kind: "capacity_over_room",
  session_id: SESJA_D,
  session_title_pl: "Za duży limit",
  session_title_en: "Limit too big",
  subject_id: SALA,
  subject_name: "Sala Kraków",
  expected_value: 20,
  actual_value: 100,
});

/** 4. ZAPISY PONAD LIMIT MIEJSC (świadoma furtka `force` organizatora). */
const ZAPISY_PONAD_LIMIT = konflikt({
  kind: "overbooked",
  session_id: SESJA_A,
  session_title_pl: "Raport jeden",
  session_title_en: "Report one",
  expected_value: 1,
  actual_value: 2,
});

const KOMPLET = [KOLIZJA_PRELEGENTA, POZA_OKNEM, LIMIT_PONAD_SALE, ZAPISY_PONAD_LIMIT];

function renderuj() {
  return render(<AgendaConflictsPanel eventId={EVENT_ID} />);
}

/** Punkt raportu po widocznym tytule sesji. */
function punkt(tytul: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(tytul) === true);
  if (li === undefined) throw new Error(`brak punktu „${tytul}” w raporcie`);
  return li;
}

beforeEach(() => {
  h.language = "pl";
  h.rows = [];
  h.isLoading = false;
  h.listError = null;
  h.eventIds = [];
});

describe("trzy stany raportu", () => {
  it("sprawdzanie agendy pokazuje postęp i NIE mówi o braku kolizji", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();

    expect(screen.getByText("adminEventAgenda.conflicts.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.conflicts.empty")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // NAJGROŹNIEJSZE ZDANIE W MODULE. „Agenda nie ma kolizji" po nieudanym
  // zapytaniu to nieprawda o stanie programu, a nie brak wykrytych kolizji -
  // organizator czyta je jako zgodę na publikację.
  it("awaria mówi treścią odmowy i NIE mówi „agenda nie ma kolizji”", () => {
    h.rows = undefined;
    h.listError = new Error("permission denied for function admin_event_agenda_conflicts");
    renderuj();

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_agenda_conflicts"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.conflicts.empty")).toBeNull();
  });

  it("sprawdzanie po nieudanej próbie bije awarię", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("conflicts_failed");
    renderuj();

    expect(screen.getByText("adminEventAgenda.conflicts.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:conflicts_failed")).toBeNull();
  });

  it("brak kolizji mówi to wprost i nie rysuje ani jednego punktu", () => {
    renderuj();

    expect(screen.getByText("adminEventAgenda.conflicts.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("nagłówek stoi także wtedy, gdy raport jest pusty", () => {
    renderuj();

    expect(screen.getByText("adminEventAgenda.conflicts.title")).toBeTruthy();
    expect(screen.getByText("adminEventAgenda.conflicts.subtitle")).toBeTruthy();
  });

  it("raport pyta o TO wydarzenie, a nie o żadne inne", () => {
    renderuj();

    expect(h.eventIds.every((id) => id === EVENT_ID)).toBe(true);
  });
});

describe("cztery rodzaje kolizji z migracji", () => {
  it("komplet czterech kolizji daje cztery punkty raportu", () => {
    h.rows = KOMPLET;
    renderuj();

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("adminEventAgenda.conflicts.empty")).toBeNull();
  });

  // 1. PRELEGENT W DWÓCH SESJACH NARAZ. Baza NIE blokuje przesunięcia godzin
  // obsadzonej sesji (`admin_event_session_save` obsady nie sprawdza), więc ta
  // sprzeczność powstaje po cichu i widzi ją WYŁĄCZNIE ten raport.
  it("kolizja prelegenta nazywa obie sesje i osobę, której dotyczy", () => {
    h.rows = [KOLIZJA_PRELEGENTA];
    renderuj();

    const li = punkt("Raport jeden");
    expect(li.textContent).toContain("napis:adminEventAgenda.conflictKinds.speaker_overlap");
    expect(li.textContent).toContain("Raport dwa");
    expect(li.textContent).toContain("Prelegent A1");
  });

  // 2. SESJA POZA OKNEM WYDARZENIA - powstaje przez ZWĘŻENIE okna po wpisaniu
  // agendy, więc żaden zapis sesji jej nie zauważy.
  it("sesja poza oknem wydarzenia nazywa wydarzenie, z którego wystaje", () => {
    h.rows = [POZA_OKNEM];
    renderuj();

    const li = punkt("Sesja po zamknięciu");
    expect(li.textContent).toContain("napis:adminEventAgenda.conflictKinds.outside_event_window");
    expect(li.textContent).toContain("Kongres testowy");
  });

  // 3. LIMIT MIEJSC PONAD POJEMNOŚĆ SALI - `admin_event_room_save` broni się
  // odmową `capacity_below_sessions`, ale dane mogą dojść inną drogą (zapis
  // wprost na tabelę), i wtedy jedynym świadkiem jest raport.
  it("limit ponad pojemność sali pokazuje DOPUSZCZALNE obok TEGO, CO JEST", () => {
    h.rows = [LIMIT_PONAD_SALE];
    renderuj();

    const li = punkt("Za duży limit");
    expect(li.textContent).toContain("napis:adminEventAgenda.conflictKinds.capacity_over_room");
    expect(li.textContent).toContain("Sala Kraków");
    expect(li.textContent).toContain("adminEventAgenda.conflicts.expected(value=20)");
    expect(li.textContent).toContain("adminEventAgenda.conflicts.actual(value=100)");
  });

  // 4. ZAPISY PONAD LIMIT - jedyna kolizja, którą organizator tworzy ŚWIADOMIE
  // (furtka `force`), więc raport ma ją pokazywać, a nie blokować.
  it("zapisy ponad limit pokazują limit i faktyczną liczbę zapisanych", () => {
    h.rows = [ZAPISY_PONAD_LIMIT];
    renderuj();

    const li = punkt("Raport jeden");
    expect(li.textContent).toContain("napis:adminEventAgenda.conflictKinds.overbooked");
    expect(li.textContent).toContain("adminEventAgenda.conflicts.expected(value=1)");
    expect(li.textContent).toContain("adminEventAgenda.conflicts.actual(value=2)");
  });

  // KOLIZJA SALI JEST NIEMOŻLIWA, więc raport jej nie zna. Ograniczenie
  // wykluczające `event_sessions_room_no_overlap` odrzuca drugą sesję w tej
  // samej sali już przy zapisie (RPC tłumaczy je na `room_conflict`), a panel,
  // który by ją tu rysował, opisywałby stan, którego baza nie przechowa.
  it("raport NIE zna rodzaju „kolizja sali” - baza jej nie dopuszcza", () => {
    h.rows = KOMPLET;
    renderuj();

    expect(screen.queryByText(/room_conflict/)).toBeNull();
    expect(screen.queryByText(/event_sessions_room_no_overlap/)).toBeNull();
  });

  // DWA PUNKTY O TEJ SAMEJ SESJI TO DWIE RÓŻNE SPRZECZNOŚCI. Klucz listy skleja
  // sesję, rodzaj i pozycję - zlanie kluczy gubiłoby jeden z punktów.
  it("dwie różne kolizje TEJ SAMEJ sesji stoją jako dwa osobne punkty", () => {
    h.rows = [KOLIZJA_PRELEGENTA, ZAPISY_PONAD_LIMIT];
    renderuj();

    const punkty = screen.getAllByRole("listitem");
    expect(punkty).toHaveLength(2);
    expect(punkty[0].textContent).toContain("napis:adminEventAgenda.conflictKinds.speaker_overlap");
    expect(punkty[1].textContent).toContain("napis:adminEventAgenda.conflictKinds.overbooked");
  });

  // TA SAMA PARA POWTÓRZONA (baza raportuje parę raz, ale warunek `a.id < b.id`
  // może kiedyś zniknąć) nie może zjeść jednego wiersza przez zdublowany klucz.
  it("dwa identyczne rodzajem punkty tej samej sesji rysują się OBA", () => {
    h.rows = [KOLIZJA_PRELEGENTA, KOLIZJA_PRELEGENTA];
    renderuj();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("rodzaj kolizji i język", () => {
  // NOWA MIGRACJA MOŻE DOŁOŻYĆ PIĄTY RODZAJ. Słownik dowie się o nim później -
  // do tego czasu organizator ma zobaczyć techniczną nazwę, a nie ścieżkę
  // klucza i18n, z której niczego nie wyczyta.
  it("nieznany rodzaj z bazy pokazuje SWOJĄ nazwę, a nie klucz słownika", () => {
    h.rows = [konflikt({ kind: "room_double_booked" })];
    renderuj();

    expect(screen.getByText("room_double_booked")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.conflictKinds.room_double_booked")).toBeNull();
  });

  it("wersja angielska bierze angielskie tytuły sesji", () => {
    h.language = "en";
    h.rows = [KOLIZJA_PRELEGENTA];
    renderuj();

    const li = punkt("Report one");
    expect(li.textContent).toContain("Report two");
    expect(li.textContent).not.toContain("Raport jeden");
  });

  // BRAK TŁUMACZENIA NIE MOŻE ZOSTAWIĆ PUSTEGO WIERSZA - sesja bez tytułu EN
  // pokazuje po angielsku tytuł polski, bo pusty punkt raportu nie mówi nic.
  it("sesja bez tytułu w języku interfejsu spada na drugi język", () => {
    h.language = "en";
    h.rows = [konflikt({ session_title_en: "", other_session_id: SESJA_B, other_title_en: "" })];
    renderuj();

    expect(screen.getByText("Raport jeden")).toBeTruthy();
  });

  it("wersja polska bez tytułu PL spada na angielski", () => {
    h.rows = [konflikt({ session_title_pl: "" })];
    renderuj();

    expect(screen.getByText("Report one")).toBeTruthy();
  });
});

describe("liczby i wiersze poboczne pokazują się tylko wtedy, gdy baza je poda", () => {
  it("kolizja prelegenta NIE pokazuje badge'y - RPC oddaje tam `NULL`", () => {
    h.rows = [KOLIZJA_PRELEGENTA];
    renderuj();

    expect(screen.queryByText(/conflicts\.expected/)).toBeNull();
    expect(screen.queryByText(/conflicts\.actual/)).toBeNull();
  });

  // POJEMNOŚĆ ZERO TO NIE „BRAK POJEMNOŚCI". Sala na zero miejsc nie przyjmie
  // nikogo, ale warunek `expected_value > 0` chowa wtedy obie liczby - i to jest
  // zachowanie umyślne: raport nie ma pokazywać „Dopuszczalne: 0".
  it("dopuszczalna wartość równa zeru chowa OBIE liczby", () => {
    h.rows = [konflikt({ kind: "overbooked", expected_value: 0, actual_value: 3 })];
    renderuj();

    expect(screen.queryByText(/conflicts\.expected/)).toBeNull();
    expect(screen.queryByText(/conflicts\.actual/)).toBeNull();
  });

  it("kolizja prelegenta pokazuje wiersz „druga sesja” z jej tytułem", () => {
    h.rows = [KOLIZJA_PRELEGENTA];
    renderuj();

    expect(screen.getByText(/conflicts\.otherSession/)?.textContent).toContain("Raport dwa");
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: `admin_event_agenda_conflicts` uzupełnia brakujące kolumny
  // literałami `NULL::uuid` / `NULL::text` (trzy z czterech rodzajów nie mają
  // „drugiej sesji"), a panel sprawdza je porównaniem `row.other_session_id === ""`.
  // `null === ""` jest FAŁSZEM, więc warunek nie odcina niczego: sesja poza oknem
  // wydarzenia dostaje wiersz „Druga sesja:" z pustą wartością po dwukropku.
  // Organizator czyta z niego, że kolizja dotyczy drugiej sesji, której nazwy
  // „nie udało się wczytać" - a drugiej sesji po prostu nie ma.
  //
  // NAPRAWA: warunek musiałby brzmieć `row.other_session_id == null || row.other_session_id === ""`
  // (albo RPC musiałaby oddawać `''` zamiast `NULL`).
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: sesja poza oknem wydarzenia rysuje PUSTY wiersz „druga sesja”, bo RPC oddaje tam NULL",
    () => {
      h.rows = [POZA_OKNEM];
      renderuj();

      expect(screen.queryByText(/conflicts\.otherSession/)).toBeNull();
    },
  );

  // ---------------------------------------------------------------------------
  // DEFEKT BLIŹNIACZY: `overbooked` nie ma podmiotu (`NULL::uuid, NULL::text`
  // w czwartej gałęzi `UNION ALL`), a panel odcina go porównaniem
  // `row.subject_name === ""`. Efekt ten sam: wiersz „Dotyczy:" bez wartości.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: zapisy ponad limit rysują PUSTY wiersz „dotyczy”, bo RPC nie podaje podmiotu",
    () => {
      h.rows = [ZAPISY_PONAD_LIMIT];
      renderuj();

      expect(screen.queryByText(/conflicts\.subject/)).toBeNull();
    },
  );

  // Pusty NAPIS baza oddaje tylko tam, gdzie kolumna naprawdę jest pusta -
  // i wtedy warunek panelu działa tak, jak go napisano.
  it("pusty napis w „drugiej sesji” i w „dotyczy” faktycznie chowa oba wiersze", () => {
    h.rows = [konflikt({ other_session_id: "", subject_name: "" })];
    renderuj();

    expect(screen.queryByText(/conflicts\.otherSession/)).toBeNull();
    expect(screen.queryByText(/conflicts\.subject/)).toBeNull();
  });
});

describe("dostępność", () => {
  it("raport z czterema kolizjami nie ma naruszeń dostępności", async () => {
    h.rows = KOMPLET;
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusty raport nie ma naruszeń dostępności", async () => {
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
