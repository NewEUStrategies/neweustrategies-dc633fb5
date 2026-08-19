// Okno tworzenia i redakcji wydarzenia klubu (`ClubEventForm`) - 525 linii,
// zero pokrycia do 19.08.2026.
//
// CO TEN PLIK DOWODZI. To najbogatszy formularz modułu i jednocześnie ten,
// którego pomyłka jest najdroższa: wydarzenie ma ADRES, który idzie
// w zaproszeniach, i TERMIN, który po złym przeliczeniu strefy wypada dzień
// obok. Sprawdzamy pięć rzeczy, w tej kolejności ważności:
//
//   1. SLUG. Przy TWORZENIU jedzie w payloadzie (RPC go wymaga), przy REDAKCJI
//      NIE JEDZIE WCALE - patch z nowym adresem zerwałby wszystkie rozesłane
//      linki. Podsumowanie pokazuje go tylko w trybie tworzenia, żeby nie
//      obiecywać kuratorowi zmiany, której nie będzie.
//   2. DWUJĘZYCZNY TYTUŁ. Kurator podaje JEDEN język, baza wymaga OBU (CHECK
//      na długość), więc pusty jest przepisywany z wpisanego. Bez tego zapis
//      odbija się od bazy po utracie formularza.
//   3. TERMIN. Pole niesie czas LOKALNY bez strefy, do bazy jedzie ISO ze
//      strefą, a wydarzenie całodniowe kotwiczy w POŁUDNIE. Presety („dziś”,
//      „jutro”, „za tydzień”) i guziki długości liczą na tym samym czasie
//      lokalnym.
//   4. KSZTAŁT PATCHA. Pusty napis jedzie jako `null` („wyczyść”), limit
//      miejsc równy zero znaczy BEZ LIMITU, a nie zero wolnych miejsc.
//   5. PODWÓJNA WYSYŁKA. Okno nie ma własnej blokady - jedyną jest `pending`
//      z `mutation.isPending`. Test odtwarza to podłączenie (`PendingHarness`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ na czystych funkcjach: `src/lib/clubs/__tests__/workspaceForms.test.ts`
//   ma tabelę dla `clubEventFormInvalid`, `clubEventCapacityValue`,
//   `buildClubEventUpsert`, `clubEventStartPreset`, `clubEventEndFromDuration`,
//   `clubEventDurationLabelKey` i `clubEventRangeLabel`. Tutaj dowodzimy, że
//   okno je WOŁA z właściwym stanem i respektuje wynik.
// - TRANSLITERACJI SLUGA: `src/lib/clubs/eventSlug.test.ts`.
// - OBSŁUGI BŁĘDU RPC: molekuła nie robi I/O. Odmowa bazy wraca do
//   `ClubCalendar`, który pokazuje `toast.error` - i tam leży jej dowód.
//   Jedynym stanem sieci, który to okno zna, jest `pending`.
// - RADIKSA: `Dialog`, `Select` i `Switch` są podmienione na natywne
//   odpowiedniki, bo pod happy-dom nie działają bez pełnego API wskaźnika.
//   Atrapa okna renderuje zawartość PŁASKO, więc przycisk stopki dalej wiąże
//   się z formularzem atrybutem `form` - i to jest wiązanie, na którym stoi
//   wysyłka w produkcji.
//
// DWIE REGUŁY DOWODZONE W WARSTWIE `lib`, A NIE TUTAJ - i to nie jest luka.
// Pola `datetime-local` i `number` mają WŁASNĄ walidację przeglądarki: happy-dom
// (jak każda przeglądarka) czyści wartość, której nie da się sparsować jako
// termin, i blokuje wysyłkę formularza przy liczbie z białymi znakami. Skutek
// jest taki, że przez interfejs NIE DA SIĘ dojechać ani do awaryjnego
// `starts_at` (gałąź `?? nowMs` w `buildClubEventUpsert`), ani do przypadku
// „długość nie do policzenia” (`clubEventEndValue`). Oba mają dowód
// w `src/lib/clubs/__tests__/workspaceForms.test.ts`, gdzie wejście podaje się
// wprost, a nie przez pole formularza.
//
// JEDEN `it.fails` - przełącznik „cały dzień” gubi godzinę przy WYJŚCIU z trybu
// całodniowego (szczegóły przy teście, w sekcji o przełączniku).
import { useState, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  const box = (props: { children?: ReactNode }) => react.createElement("div", null, props.children);
  return {
    Dialog: (props: { open: boolean; children?: ReactNode }) =>
      props.open ? react.createElement("div", { role: "dialog" }, props.children) : null,
    DialogContent: box,
    DialogHeader: box,
    DialogFooter: box,
    DialogTitle: (props: { children?: ReactNode }) =>
      react.createElement("h2", null, props.children),
    DialogDescription: (props: { children?: ReactNode }) =>
      react.createElement("p", null, props.children),
  };
});

import { ClubEventForm } from "@/components/clubs/molecules/ClubEventForm";
import {
  CLUB_EVENT_KINDS,
  CLUB_EVENT_STATUSES,
  type ClubEventRow,
  type ClubEventUpsertInput,
} from "@/lib/clubs/workspaceTypes";
import { isValidClubEventSlug } from "@/lib/clubs/eventSlug";
import { toLocalInputValue } from "@/lib/clubs/workspaceForms";
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";

/**
 * Zegar testowy zbudowany z pól LOKALNYCH, nie z ISO. Presety terminu liczą
 * w czasie lokalnym, więc asercja na dokładny napis („2026-08-18T18:00”) ma być
 * niezależna od strefy maszyny CI - ta jest ustawiona na UTC tylko przypadkiem.
 * Dzień jest ten sam co w `CLUB_BASE_ISO`.
 */
const NOW_LOCAL = new Date(2026, 7, 18, 9, 30, 15, 250);

// --- wiersz wejściowy -------------------------------------------------------

function eventRow(overrides: Partial<ClubEventRow> = {}): ClubEventRow {
  return {
    id: "event-1",
    club_id: CLUB_IDS.club,
    slug: "panel-o-pakiecie-cyfrowym-abcde",
    title_pl: "Panel o pakiecie cyfrowym",
    title_en: "Digital package panel",
    description_pl: null,
    description_en: null,
    kind: "meeting",
    status: "scheduled",
    all_day: false,
    starts_at: CLUB_BASE_ISO,
    ends_at: null,
    location: null,
    meeting_url: null,
    rsvp_enabled: true,
    capacity: null,
    going_count: 0,
    my_rsvp: null,
    can_manage: true,
    group_id: null,
    group_name_pl: null,
    group_name_en: null,
    thread_id: null,
    thread_slug: null,
    anchor_event_id: null,
    created_at: CLUB_BASE_ISO,
    ...overrides,
  };
}

// --- narzędzia --------------------------------------------------------------

/** Pola okna są adresowane przez `id`, bo etykieta pola wymaganego niesie „*”. */
const F = {
  titlePl: "club-event-title-pl",
  titleEn: "club-event-title-en",
  kind: "club-event-kind",
  status: "club-event-status",
  allDay: "club-event-allday",
  start: "club-event-start",
  end: "club-event-end",
  location: "club-event-location",
  url: "club-event-url",
  descPl: "club-event-desc-pl",
  descEn: "club-event-desc-en",
  rsvp: "club-event-rsvp",
  capacity: "club-event-capacity",
} as const;

const K = {
  createTitle: "club.eventForm.createTitle",
  editTitle: "club.eventForm.editTitle",
  lead: "club.eventForm.lead",
  create: "club.eventForm.create",
  save: "club.eventForm.save",
  cancel: "club.eventForm.cancel",
  today: "club.eventForm.today",
  tomorrow: "club.eventForm.tomorrow",
  nextWeek: "club.eventForm.nextWeek",
  duration30: "club.eventForm.duration30",
  duration60: "club.eventForm.duration60",
  duration90: "club.eventForm.duration90",
  duration120: "club.eventForm.duration120",
  durationLabel: "club.eventForm.durationLabel",
  summaryEmpty: "club.eventForm.summaryEmpty",
  slugLabel: "club.eventForm.slugLabel",
  rsvpEnabled: "club.eventForm.rsvpEnabled",
} as const;

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`brak pola o id ${id}`);
  return node;
}

function type(id: string, value: string): void {
  fireEvent.change(byId(id), { target: { value } });
}

function press(nameKey: string): void {
  fireEvent.click(screen.getByRole("button", { name: nameKey }));
}

function button(nameKey: string): HTMLButtonElement {
  const node = screen.getByRole("button", { name: nameKey });
  if (!(node instanceof HTMLButtonElement)) throw new Error("element nie jest guzikiem");
  return node;
}

function formElement(): HTMLFormElement {
  const form = document.querySelector("form");
  if (form === null) throw new Error("brak formularza w drzewie");
  return form;
}

/** Kolumna podsumowania - jedyna `aside` w oknie. */
function summary(): HTMLElement {
  const aside = document.querySelector("aside");
  if (aside === null) throw new Error("brak kolumny podsumowania");
  return aside;
}

function optionValues(id: string): string[] {
  return Array.from(byId(id).querySelectorAll("option")).map((option) => option.value);
}

let sent: ClubEventUpsertInput[];
let openChanges: boolean[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_LOCAL);
  sent = [];
  openChanges = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderForm(initial: ClubEventRow | null, pending = false): void {
  render(
    <ClubEventForm
      open
      initial={initial}
      pending={pending}
      onOpenChange={(next) => openChanges.push(next)}
      onSubmit={(input) => sent.push(input)}
    />,
  );
}

/** Wypełnia minimum wymagane do wysyłki. */
function fillMinimum(): void {
  type(F.titlePl, "Panel o pakiecie cyfrowym");
  type(F.start, "2026-09-14T17:30");
}

/** Odtwarza podłączenie z `ClubCalendar`: `pending` wstaje na pierwszej wysyłce. */
function PendingHarness(): JSX.Element {
  const [pending, setPending] = useState(false);
  return (
    <ClubEventForm
      open
      initial={eventRow()}
      pending={pending}
      onOpenChange={(next) => openChanges.push(next)}
      onSubmit={(input) => {
        setPending(true);
        sent.push(input);
      }}
    />
  );
}

// ===========================================================================

describe("ClubEventForm - tryb tworzenia i redakcji", () => {
  it("nowe wydarzenie ma nagłówek i przycisk TWORZENIA", () => {
    renderForm(null);

    expect(screen.getByRole("heading", { name: K.createTitle })).toBeInTheDocument();
    expect(screen.getByText(K.lead)).toBeInTheDocument();
    expect(button(K.create)).toBeInTheDocument();
  });

  it("redakcja ma nagłówek i przycisk ZAPISU", () => {
    renderForm(eventRow());

    expect(screen.getByRole("heading", { name: K.editTitle })).toBeInTheDocument();
    expect(button(K.save)).toBeInTheDocument();
  });

  it("wiersz z bazy wypełnia pola, w tym limit miejsc jako napis", () => {
    renderForm(
      eventRow({
        title_pl: "Panel PL",
        title_en: "Panel EN",
        description_pl: "Opis PL",
        description_en: "Opis EN",
        location: "Bruksela",
        meeting_url: "https://meet.test/x",
        capacity: 40,
        kind: "workshop",
        status: "done",
        rsvp_enabled: false,
        ends_at: "2026-08-18T12:00:00.000Z",
      }),
    );

    expect(byId(F.titlePl)).toHaveValue("Panel PL");
    expect(byId(F.titleEn)).toHaveValue("Panel EN");
    expect(byId(F.descPl)).toHaveValue("Opis PL");
    expect(byId(F.descEn)).toHaveValue("Opis EN");
    expect(byId(F.location)).toHaveValue("Bruksela");
    expect(byId(F.url)).toHaveValue("https://meet.test/x");
    expect(byId(F.capacity)).toHaveValue(40);
    expect(byId(F.kind)).toHaveValue("workshop");
    expect(byId(F.status)).toHaveValue("done");
    expect(byId(F.rsvp)).not.toBeChecked();
    expect(byId(F.end)).toHaveValue(toLocalInputValue("2026-08-18T12:00:00.000Z", false));
  });

  it("wiersz BEZ pól opcjonalnych nie pokazuje gołego undefined", () => {
    renderForm(eventRow({ capacity: null, description_pl: null, location: null }));

    expect(byId(F.capacity)).toHaveValue(null);
    expect(byId(F.descPl)).toHaveValue("");
    expect(byId(F.location)).toHaveValue("");
    expect(byId(F.end)).toHaveValue("");
  });

  it("nieznany rodzaj i stan z nowszej migracji lądują w bezpiecznej gałęzi", () => {
    // Zawężenie słownikowe ma nie wywrócić okna - droplista pokazuje wtedy
    // wartość domyślną, a nie pustkę.
    renderForm(eventRow({ kind: "z-nowszej-migracji", status: "z-nowszej-migracji" }));

    expect(byId(F.kind)).toHaveValue("other");
    expect(byId(F.status)).toHaveValue("scheduled");
  });
});

describe("ClubEventForm - walidacja odmawia wysyłki", () => {
  it("puste okno ma wyłączony przycisk i nie woła mutacji", () => {
    renderForm(null);

    expect(button(K.create)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(sent).toEqual([]);
  });

  it("jednoznakowy tytuł to nie tytuł, choćby termin był podany", () => {
    renderForm(null);
    type(F.titlePl, "A");
    type(F.start, "2026-09-14T17:30");

    expect(button(K.create)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(sent).toEqual([]);
  });

  it("tytuł bez terminu nie przechodzi", () => {
    renderForm(null);
    type(F.titlePl, "Panel o pakiecie cyfrowym");

    expect(button(K.create)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(sent).toEqual([]);
  });

  it("wystarczy tytuł ANGIELSKI - polski dopisuje się sam", () => {
    renderForm(null);
    type(F.titleEn, "Digital package panel");
    type(F.start, "2026-09-14T17:30");
    press(K.create);

    expect(sent).toHaveLength(1);
    expect(sent[0].title_pl).toBe("Digital package panel");
    expect(sent[0].title_en).toBe("Digital package panel");
  });

  it("wystarczy tytuł POLSKI - angielski dopisuje się sam", () => {
    renderForm(null);
    type(F.titlePl, "  Panel o pakiecie  ");
    type(F.start, "2026-09-14T17:30");
    press(K.create);

    expect(sent[0].title_pl).toBe("Panel o pakiecie");
    expect(sent[0].title_en).toBe("Panel o pakiecie");
  });
});

describe("ClubEventForm - kształt patcha", () => {
  it("TWORZENIE niesie slug wyprowadzony z tytułu i nie niesie id", () => {
    renderForm(null);
    fillMinimum();
    press(K.create);

    const payload = sent[0];
    expect(payload.id).toBeUndefined();
    expect(payload.slug ?? "").toContain("panel-o-pakiecie-cyfrowym");
    expect(isValidClubEventSlug(payload.slug ?? "")).toBe(true);
  });

  it("REDAKCJA niesie id i NIE RUSZA sluga", () => {
    renderForm(eventRow({ id: "event-77" }));
    press(K.save);

    expect(sent[0].id).toBe("event-77");
    expect("slug" in sent[0]).toBe(false);
  });

  it("puste pola opcjonalne jadą jako null, nie jako pusty napis", () => {
    renderForm(null);
    fillMinimum();
    press(K.create);

    const payload = sent[0];
    expect(payload.description_pl).toBeNull();
    expect(payload.description_en).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.meeting_url).toBeNull();
    expect(payload.capacity).toBeNull();
    expect(payload.ends_at).toBeNull();
  });

  it("wypełnione pola opcjonalne jadą OBCIĘTE", () => {
    renderForm(null);
    fillMinimum();
    type(F.end, "2026-09-14T19:00");
    type(F.location, "  Bruksela  ");
    type(F.url, "https://meet.test/x");
    type(F.descPl, "  Opis PL  ");
    type(F.descEn, "  Opis EN  ");
    type(F.capacity, "40");
    press(K.create);

    const payload = sent[0];
    expect(payload.location).toBe("Bruksela");
    expect(payload.meeting_url).toBe("https://meet.test/x");
    expect(payload.description_pl).toBe("Opis PL");
    expect(payload.description_en).toBe("Opis EN");
    expect(payload.capacity).toBe(40);
    expect(toLocalInputValue(payload.ends_at ?? null, false)).toBe("2026-09-14T19:00");
  });

  it("pole limitu nie wypuszcza zera - przeglądarka pilnuje `min`", () => {
    // „Zero miejsc” nie jest limitem, tylko wydarzeniem, na które nikt nie
    // wejdzie. Interfejs zamyka tę drogę atrybutem `min`, a co się dzieje
    // z zerem, które i tak dojedzie, dowodzi `clubEventCapacityValue`.
    renderForm(null);
    fillMinimum();
    type(F.capacity, "0");

    expect(byId(F.capacity)).toHaveAttribute("min", "1");
    expect(byId(F.capacity)).toHaveAttribute("type", "number");
    press(K.create);
    expect(sent).toEqual([]);
  });

  it("wyłączone zapisy jadą jako rsvp_enabled=false", () => {
    renderForm(null);
    fillMinimum();
    fireEvent.click(byId(F.rsvp));
    press(K.create);

    expect(sent[0].rsvp_enabled).toBe(false);
  });

  it("wybrany rodzaj i stan lądują w payloadzie", () => {
    renderForm(null);
    fillMinimum();
    fireEvent.change(byId(F.kind), { target: { value: "consultation" } });
    fireEvent.change(byId(F.status), { target: { value: "cancelled" } });
    press(K.create);

    expect(sent[0].kind).toBe("consultation");
    expect(sent[0].status).toBe("cancelled");
  });

  it("termin godzinowy wraca z payloadu na tę samą godzinę lokalną", () => {
    renderForm(null);
    fillMinimum();
    press(K.create);

    expect(sent[0].all_day).toBe(false);
    expect(toLocalInputValue(sent[0].starts_at ?? null, false)).toBe("2026-09-14T17:30");
  });

  it("wydarzenie CAŁODNIOWE kotwiczy w południe, więc nie ucieka na poprzedni dzień", () => {
    renderForm(null);
    type(F.titlePl, "Panel o pakiecie cyfrowym");
    fireEvent.click(byId(F.allDay));
    type(F.start, "2026-09-14");
    press(K.create);

    expect(sent[0].all_day).toBe(true);
    expect(new Date(sent[0].starts_at ?? "").getHours()).toBe(12);
    expect(toLocalInputValue(sent[0].starts_at ?? null, true)).toBe("2026-09-14");
  });

  it("wartość, której przeglądarka nie uznaje za termin, NIE odblokowuje wysyłki", () => {
    // Pole `datetime-local` czyści taką wartość samo, więc formularz zostaje
    // bez terminu - i słusznie nie wysyła nic. Awaryjny `starts_at` w budowie
    // payloadu ma dowód w warstwie `lib`.
    renderForm(null);
    type(F.titlePl, "Panel o pakiecie cyfrowym");
    type(F.start, "nie-jest-data");

    expect(byId(F.start)).toHaveValue("");
    expect(button(K.create)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(sent).toEqual([]);
  });

  it("REDAKCJA bez dotknięcia terminu nie przesuwa go ani o minutę", () => {
    renderForm(eventRow({ starts_at: CLUB_BASE_ISO }));
    press(K.save);

    expect(sent[0].starts_at).toBe(CLUB_BASE_ISO);
  });
});

describe("ClubEventForm - presety terminu", () => {
  it("„dziś” ustawia dzisiejszą datę o 18:00", () => {
    renderForm(null);
    press(K.today);

    expect(byId(F.start)).toHaveValue("2026-08-18T18:00");
  });

  it("„jutro” przesuwa dzień, nie godzinę", () => {
    renderForm(null);
    press(K.tomorrow);

    expect(byId(F.start)).toHaveValue("2026-08-19T18:00");
  });

  it("„za tydzień” przesuwa o siedem dni", () => {
    renderForm(null);
    press(K.nextWeek);

    expect(byId(F.start)).toHaveValue("2026-08-25T18:00");
  });

  it("w trybie całodniowym preset daje sam dzień, bez godziny", () => {
    renderForm(null);
    fireEvent.click(byId(F.allDay));
    press(K.tomorrow);

    expect(byId(F.start)).toHaveValue("2026-08-19");
  });
});

describe("ClubEventForm - długość spotkania", () => {
  it("guziki długości są wyłączone, dopóki nie ma początku", () => {
    renderForm(null);

    expect(button(K.duration30)).toBeDisabled();
    expect(button(K.duration120)).toBeDisabled();
  });

  const DURATIONS: ReadonlyArray<readonly [string, string]> = [
    [K.duration30, "2026-09-14T18:00"],
    [K.duration60, "2026-09-14T18:30"],
    [K.duration90, "2026-09-14T19:00"],
    [K.duration120, "2026-09-14T19:30"],
  ];

  for (const [labelKey, expected] of DURATIONS) {
    it(`${labelKey} dokłada minuty do początku`, () => {
      renderForm(null);
      type(F.start, "2026-09-14T17:30");
      press(labelKey);

      expect(byId(F.end)).toHaveValue(expected);
    });
  }

  it("tryb całodniowy schowa cały pasek długości", () => {
    renderForm(null);
    expect(screen.getByText(K.durationLabel)).toBeInTheDocument();

    fireEvent.click(byId(F.allDay));

    expect(screen.queryByText(K.durationLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: K.duration60 })).not.toBeInTheDocument();
  });

  it("kolejny klik przelicza koniec od nowa, a nie kumuluje minut", () => {
    renderForm(null);
    type(F.start, "2026-09-14T17:30");
    press(K.duration30);
    press(K.duration120);

    expect(byId(F.end)).toHaveValue("2026-09-14T19:30");
  });
});

describe("ClubEventForm - przełącznik całodniowy", () => {
  it("zmienia TYP obu pól terminu", () => {
    renderForm(null);
    expect(byId(F.start)).toHaveAttribute("type", "datetime-local");
    expect(byId(F.end)).toHaveAttribute("type", "datetime-local");

    fireEvent.click(byId(F.allDay));

    expect(byId(F.start)).toHaveAttribute("type", "date");
    expect(byId(F.end)).toHaveAttribute("type", "date");
  });

  it("przycina wpisane wartości do dnia, zamiast pozwolić je wyczyścić", () => {
    renderForm(null);
    type(F.start, "2026-09-14T17:30");
    type(F.end, "2026-09-16T19:00");
    fireEvent.click(byId(F.allDay));

    expect(byId(F.start)).toHaveValue("2026-09-14");
    expect(byId(F.end)).toHaveValue("2026-09-16");
  });

  it("wyjście z trybu całodniowego zostawia SAMĄ DATĘ w polu godzinowym", () => {
    // Zapis stanu FAKTYCZNEGO, nie pochwała: przycięcie działa tylko w jedną
    // stronę, więc po wyjściu z trybu całodniowego w polu `datetime-local`
    // zostaje wartość bez godziny. Patrz `it.fails` poniżej.
    renderForm(eventRow({ all_day: true, starts_at: "2026-09-14T12:00:00.000Z" }));
    expect(byId(F.allDay)).toBeChecked();

    fireEvent.click(byId(F.allDay));

    expect(byId(F.start)).toHaveAttribute("type", "datetime-local");
    expect(byId(F.start)).toHaveValue(toLocalInputValue("2026-09-14T12:00:00.000Z", true));
  });

  // BŁĄD PRODUKTU, ZGŁOSZONY I NIE NAPRAWIONY W TEJ PRACY.
  //
  // Handler przełącznika przycina wartość WYŁĄCZNIE przy wejściu w tryb
  // całodniowy (`clubAllDayFieldValue`), więc przy wyjściu w polu typu
  // `datetime-local` zostaje "2026-09-14" - wartość, której przeglądarka NIE
  // uznaje za termin i którą czyści po cichu. To jest dokładnie ta awaria,
  // przed którą broni komentarz w tym samym handlerze, tylko w drugą stronę:
  // kurator, który kliknie „cały dzień” dwa razy, traci wpisany termin.
  //
  // `ClubMilestoneForm` ma to zrobione poprawnie - jego `switchAllDay`
  // PRZELICZA wartość przez ISO (`clubModeFieldValue`) i oddaje 12:00.
  // Naprawa jest jednolinijkowa (podmiana `clubAllDayFieldValue` na
  // `clubModeFieldValue`), ale zmienia ZACHOWANIE produkcyjne, więc nie należy
  // do pracy nad pokryciem. Gdy ktoś ją zrobi, ten test przestanie „padać”
  // i vitest o tym powie.
  it.fails("POWINIEN dopełniać godzinę przy wyjściu z trybu całodniowego", () => {
    renderForm(eventRow({ all_day: true, starts_at: "2026-09-14T12:00:00.000Z" }));
    fireEvent.click(byId(F.allDay));

    expect(byId(F.start)).toHaveValue("2026-09-14T12:00");
  });
});

describe("ClubEventForm - podsumowanie", () => {
  it("bez tytułu i terminu pokazuje klucz pustego podsumowania", () => {
    renderForm(null);

    expect(within(summary()).getByText(K.summaryEmpty)).toBeInTheDocument();
  });

  it("tytuł BEZ terminu nadal jest pustym podsumowaniem", () => {
    renderForm(null);
    type(F.titlePl, "Panel o pakiecie cyfrowym");

    expect(within(summary()).getByText(K.summaryEmpty)).toBeInTheDocument();
  });

  it("tytuł z terminem pokazuje tytuł, zakres i ADRES nowego wydarzenia", () => {
    renderForm(null);
    fillMinimum();

    const aside = within(summary());
    expect(aside.getByText("Panel o pakiecie cyfrowym")).toBeInTheDocument();
    expect(aside.getByText("2026-09-14, 17:30")).toBeInTheDocument();
    expect(aside.getByText(/panel-o-pakiecie-cyfrowym/)).toBeInTheDocument();
    expect(aside.getByText(new RegExp(K.slugLabel.replace(/\./g, "\\.")))).toBeInTheDocument();
  });

  it("tytuł tylko po angielsku też trafia do podsumowania", () => {
    renderForm(null);
    type(F.titleEn, "Digital package panel");
    type(F.start, "2026-09-14T17:30");

    expect(within(summary()).getByText("Digital package panel")).toBeInTheDocument();
  });

  it("REDAKCJA nie obiecuje zmiany adresu - sluga tam nie ma", () => {
    renderForm(eventRow());

    expect(within(summary()).queryByText(/slugLabel/)).not.toBeInTheDocument();
  });

  it("zakres z końcem pokazuje oba terminy", () => {
    renderForm(null);
    fillMinimum();
    type(F.end, "2026-09-14T19:00");

    expect(
      within(summary()).getByText("2026-09-14, 17:30 - 2026-09-14, 19:00"),
    ).toBeInTheDocument();
  });

  it("miejsce i link pojawiają się TYLKO wtedy, gdy są wypełnione", () => {
    renderForm(null);
    fillMinimum();
    const aside = within(summary());
    expect(aside.queryByText("Bruksela")).not.toBeInTheDocument();

    type(F.location, "  Bruksela  ");
    type(F.url, "  https://meet.test/x  ");

    expect(within(summary()).getByText("Bruksela")).toBeInTheDocument();
    expect(within(summary()).getByText("https://meet.test/x")).toBeInTheDocument();
  });

  it("same spacje w miejscu i linku nie zapalają wiersza podsumowania", () => {
    renderForm(null);
    fillMinimum();
    type(F.location, "   ");
    type(F.url, "   ");

    expect(within(summary()).queryByText("Bruksela")).not.toBeInTheDocument();
    expect(within(summary()).queryByText(/meet\.test/)).not.toBeInTheDocument();
  });

  it("zapisy włączone bez limitu pokazują sam klucz, z limitem dokładają liczbę", () => {
    renderForm(null);
    fillMinimum();
    expect(within(summary()).getByText(K.rsvpEnabled)).toBeInTheDocument();

    type(F.capacity, " 40 ");

    expect(within(summary()).getByText(`${K.rsvpEnabled} - 40`)).toBeInTheDocument();
  });

  it("zapisy wyłączone pokazują kreskę, a nie klucz i limit", () => {
    renderForm(null);
    fillMinimum();
    type(F.capacity, "40");
    fireEvent.click(byId(F.rsvp));

    const aside = within(summary());
    expect(aside.getByText("-")).toBeInTheDocument();
    expect(aside.queryByText(`${K.rsvpEnabled} - 40`)).not.toBeInTheDocument();
  });
});

describe("ClubEventForm - droplisty, etykiety i akcje", () => {
  it("droplista rodzaju oferuje PEŁNY słownik CHECK-a", () => {
    renderForm(null);
    expect(optionValues(F.kind)).toEqual([...CLUB_EVENT_KINDS]);
  });

  it("droplista stanu oferuje PEŁNY słownik CHECK-a", () => {
    renderForm(null);
    expect(optionValues(F.status)).toEqual([...CLUB_EVENT_STATUSES]);
  });

  it("każde pole ma etykietę powiązaną przez htmlFor", () => {
    renderForm(null);
    for (const id of Object.values(F)) {
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label, `pole ${id} bez etykiety`).not.toBeNull();
    }
  });

  it("pole WYMAGANE nosi gwiazdkę, pozostałe nie", () => {
    renderForm(null);
    const start = document.querySelector(`label[for="${F.start}"]`);
    const end = document.querySelector(`label[for="${F.end}"]`);

    expect(start?.textContent).toContain("*");
    expect(end?.textContent).not.toContain("*");
  });

  it("podpowiedź stoi tylko przy polach, które ją mają", () => {
    renderForm(null);

    expect(screen.getByText("club.eventForm.titleHint")).toBeInTheDocument();
    expect(screen.getByText("club.eventForm.locationHint")).toBeInTheDocument();
    expect(screen.getByText("club.eventForm.capacityHint")).toBeInTheDocument();
    expect(screen.queryByText("club.eventForm.titleEnHint")).not.toBeInTheDocument();
  });

  it("rezygnacja zamyka okno przez onOpenChange(false)", () => {
    renderForm(eventRow());
    press(K.cancel);

    expect(openChanges).toEqual([false]);
    expect(sent).toEqual([]);
  });

  it("trwający zapis wyłącza przycisk wysyłki", () => {
    renderForm(eventRow(), true);
    expect(button(K.save)).toBeDisabled();
  });

  it("przycisk stopki jest wiązany z formularzem atrybutem `form`", () => {
    // To wiązanie jest jedyną drogą wysyłki: przycisk stoi POZA `<form>`.
    renderForm(eventRow());
    expect(button(K.save)).toHaveAttribute("form", "club-event-form");
  });

  it("PODWÓJNE kliknięcie wysyła DOKŁADNIE raz", () => {
    render(<PendingHarness />);
    const submit = button(K.save);
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(sent).toHaveLength(1);
  });
});
