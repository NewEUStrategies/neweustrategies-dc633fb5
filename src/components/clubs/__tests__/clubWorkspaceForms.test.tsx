// Dwa formularze przestrzeni roboczej WĄTKU: pozycja harmonogramu
// (`ClubMilestoneForm`) i źródło (`ClubDocumentForm`).
//
// CO TEN PLIK DOWODZI. Oba formularze są JEDNYM komponentem na „dodaj”
// i „edytuj”, więc rozjazd między tymi dwoma ścieżkami jest tu najtańszym
// możliwym błędem - i najdroższym w skutkach, bo patch redakcyjny bez `id`
// tworzy duplikat zamiast poprawić wpis. Dlatego każdy przypadek jedzie w obu
// trybach, a asercje stoją na PAYLOADZIE przekazanym do mutacji, nie na DOM-ie:
//
//   1. WALIDACJA ODMAWIA WYSYŁKI. Trzyznakowy tytuł i wymóg adresu dla źródła
//      innego niż notatka to CHECK-i bazy (`..._title_check`,
//      `..._url_required`). Gdyby formularz je przepuścił, Postgres odrzuciłby
//      zapis PO utracie tego, co użytkownik wpisał. Dowód jest dwustopniowy:
//      przycisk jest wyłączony ORAZ bezpośrednia wysyłka formularza nie woła
//      `onSubmit` - bo `disabled` na przycisku nie jest zabezpieczeniem.
//   2. KSZTAŁT PATCHA. Pusty napis jedzie jako `null` („wyczyść”), a klucz
//      NIEOBECNY znaczy „nie ruszaj pola” - na tym stoi cały kontrakt
//      `p_payload ? 'klucz'` w RPC. Osobno pilnowany `is_primary`: bez
//      uprawnienia kuratorskiego nie ma go w payloadzie WCALE.
//   3. TRYB CAŁODNIOWY zmienia TYP pola, nie tylko flagę - i przepisuje
//      wpisaną wartość, zamiast pozwolić przeglądarce wyczyścić ją po cichu.
//   4. PODWÓJNA WYSYŁKA. Formularze nie mają własnej blokady: jedyną jest
//      `pending`, który organizm podaje z `mutation.isPending`. Test odtwarza
//      dokładnie to podłączenie (patrz `PendingHarness`), więc dowodzi reguły
//      produktu, a nie własnego szkieletu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ na czystych funkcjach: `src/lib/clubs/__tests__/workspaceForms.test.ts`
//   ma tabelę przypadków dla `clubMilestoneRangeInvalid`, `clubDocumentUrlMissing`,
//   `buildClubMilestonePayload` i `buildClubDocumentPayload`. Tutaj dowodzimy,
//   że formularz je WOŁA i RESPEKTUJE - nie liczymy ich drugi raz.
// - PRZELICZEŃ CZASU: `toIsoValue`/`toLocalInputValue` mają zakres
//   w `workspaceFormatting.test.ts`.
// - ZAWĘŻEŃ SŁOWNIKOWYCH (`toClubMilestoneKind`, `toClubDocumentKind`): wartość
//   spoza słownika nie dochodzi tu z natywnej droplisty, a jej degradacja ma
//   dowód w testach `threadWorkspaceTypes`.
// - OBSŁUGI BŁĘDU RPC: te molekuły nie robią I/O. Odmowa bazy wraca do
//   organizmów (`ClubThreadSchedulePanel`, `ClubThreadDocumentsPanel`), które
//   pokazują `toast.error(t("club.workspace.error.<kod>"))` - i tam leży jej
//   dowód. Jedynym stanem sieci, który te formularze znają, jest `pending`.
// - RADIKSA: `Select` i `Switch` są podmienione na natywne odpowiedniki, bo pod
//   happy-dom nie otwierają listy ani nie przełączają się bez pełnego API
//   wskaźnika. Podmiana jest wierna w tym, na czym stoją asercje (id, etykieta,
//   pełna lista opcji, wartość w `onValueChange`).
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import { ClubDocumentForm } from "@/components/clubs/molecules/ClubDocumentForm";
import { ClubMilestoneForm } from "@/components/clubs/molecules/ClubMilestoneForm";
import {
  CLUB_MILESTONE_KINDS,
  CLUB_MILESTONE_STATUSES,
  CLUB_THREAD_DOCUMENT_KINDS,
  type ClubThreadDocumentRow,
  type ClubThreadMilestoneRow,
} from "@/lib/clubs/workspaceTypes";
import type { ClubDocumentInput, ClubMilestoneInput } from "@/lib/clubs/workspaceApi";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";

// --- wiersze wejściowe ------------------------------------------------------

function milestoneRow(overrides: Partial<ClubThreadMilestoneRow> = {}): ClubThreadMilestoneRow {
  return {
    id: "milestone-1",
    kind: "deadline",
    status: "planned",
    title: "Deadline konsultacji",
    description: null,
    starts_at: CLUB_BASE_ISO,
    ends_at: null,
    all_day: false,
    location: null,
    url: null,
    sort_order: 0,
    event_id: null,
    event_slug: null,
    owner_id: null,
    owner_name: null,
    owner_slug: null,
    created_at: CLUB_BASE_ISO,
    can_edit: true,
    ...overrides,
  };
}

function documentRow(overrides: Partial<ClubThreadDocumentRow> = {}): ClubThreadDocumentRow {
  return {
    id: "doc-1",
    kind: "document",
    title: "Stanowisko Rady",
    url: "https://example.test/a.pdf",
    description: null,
    source_label: null,
    published_on: null,
    is_primary: false,
    sort_order: 0,
    byte_size: null,
    mime_type: null,
    added_by_id: null,
    added_by_name: null,
    added_by_slug: null,
    created_at: CLUB_BASE_ISO,
    can_edit: true,
    ...overrides,
  };
}

// --- narzędzia -------------------------------------------------------------

/** Formularz jest jedyny na ekranie - `role="form"` bez nazwy nie istnieje. */
function formElement(): HTMLFormElement {
  const form = document.querySelector("form");
  if (form === null) throw new Error("brak formularza w drzewie");
  return form;
}

function field(labelKey: string): HTMLElement {
  return screen.getByLabelText(labelKey);
}

function type(labelKey: string, value: string): void {
  fireEvent.change(field(labelKey), { target: { value } });
}

function choose(labelKey: string, value: string): void {
  fireEvent.change(field(labelKey), { target: { value } });
}

function submitButton(nameKey: string): HTMLButtonElement {
  const button = screen.getByRole("button", { name: nameKey });
  if (!(button instanceof HTMLButtonElement)) throw new Error("przycisk zapisu nie jest guzikiem");
  return button;
}

/** Lista wartości natywnej droplisty - atrapa Radiksa robi z opcji `<option>`. */
function optionValues(labelKey: string): string[] {
  return Array.from(field(labelKey).querySelectorAll("option")).map((option) => option.value);
}

const MS = {
  title: "club.workspace.schedule.titleLabel",
  kind: "club.workspace.schedule.kindLabel",
  status: "club.workspace.schedule.statusLabel",
  allDay: "club.workspace.schedule.allDay",
  start: "club.workspace.schedule.startsLabel",
  end: "club.workspace.schedule.endsLabel",
  location: "club.workspace.schedule.locationLabel",
  url: "club.workspace.schedule.urlLabel",
  description: "club.workspace.schedule.descriptionLabel",
  add: "club.workspace.schedule.add",
  save: "club.workspace.save",
  cancel: "club.workspace.cancel",
  rangeError: "club.workspace.schedule.rangeError",
} as const;

const DOC = {
  title: "club.workspace.documents.titleLabel",
  kind: "club.workspace.documents.kindLabel",
  published: "club.workspace.documents.publishedLabel",
  url: "club.workspace.documents.urlLabel",
  source: "club.workspace.documents.sourceLabel",
  description: "club.workspace.documents.descriptionLabel",
  primary: "club.workspace.documents.primaryLabel",
  add: "club.workspace.documents.add",
  save: "club.workspace.save",
  cancel: "club.workspace.cancel",
  urlError: "club.workspace.error.url_required",
} as const;

let onMilestone: (input: ClubMilestoneInput) => void;
let onDocument: (input: ClubDocumentInput) => void;
let onCancel: () => void;
let milestoneCalls: ClubMilestoneInput[];
let documentCalls: ClubDocumentInput[];
let cancelCalls: number;

beforeEach(() => {
  milestoneCalls = [];
  documentCalls = [];
  cancelCalls = 0;
  onMilestone = (input) => milestoneCalls.push(input);
  onDocument = (input) => documentCalls.push(input);
  onCancel = () => {
    cancelCalls += 1;
  };
});

afterEach(() => {
  cleanup();
});

function renderMilestone(initial: ClubThreadMilestoneRow | null, pending = false): void {
  render(
    <ClubMilestoneForm
      threadId={CLUB_IDS.thread}
      initial={initial}
      pending={pending}
      onCancel={onCancel}
      onSubmit={onMilestone}
    />,
  );
}

function renderDocument(
  initial: ClubThreadDocumentRow | null,
  canCurate = false,
  pending = false,
): void {
  render(
    <ClubDocumentForm
      threadId={CLUB_IDS.thread}
      initial={initial}
      canCurate={canCurate}
      pending={pending}
      onCancel={onCancel}
      onSubmit={onDocument}
    />,
  );
}

/**
 * Odtwarza podłączenie z organizmu: `pending` jest stanem WOŁAJĄCEGO i wstaje
 * na pierwszym `onSubmit`, dokładnie tak jak `mutation.isPending`. Bez tego
 * „podwójna wysyłka” testowałaby szkielet testu, a nie regułę produktu.
 */
function MilestonePendingHarness(): React.JSX.Element {
  const [pending, setPending] = useState(false);
  return (
    <ClubMilestoneForm
      threadId={CLUB_IDS.thread}
      initial={milestoneRow()}
      pending={pending}
      onCancel={onCancel}
      onSubmit={(input) => {
        setPending(true);
        onMilestone(input);
      }}
    />
  );
}

function DocumentPendingHarness(): React.JSX.Element {
  const [pending, setPending] = useState(false);
  return (
    <ClubDocumentForm
      threadId={CLUB_IDS.thread}
      initial={documentRow()}
      canCurate
      pending={pending}
      onCancel={onCancel}
      onSubmit={(input) => {
        setPending(true);
        onDocument(input);
      }}
    />
  );
}

// ===========================================================================
// ClubMilestoneForm
// ===========================================================================

describe("ClubMilestoneForm - walidacja odmawia wysyłki", () => {
  it("pusty formularz ma wyłączony zapis i nie woła mutacji", () => {
    renderMilestone(null);

    expect(submitButton(MS.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(milestoneCalls).toEqual([]);
  });

  it("dwuznakowy tytuł to nie tytuł, choćby termin był podany", () => {
    renderMilestone(null);
    type(MS.title, "Ok");
    type(MS.start, "2026-09-14T17:30");

    expect(submitButton(MS.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(milestoneCalls).toEqual([]);
  });

  it("tytuł bez terminu początkowego nie przechodzi", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");

    expect(submitButton(MS.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(milestoneCalls).toEqual([]);
  });

  it("tytuł z terminem odblokowuje zapis", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");

    expect(submitButton(MS.add)).toBeEnabled();
  });

  it("koniec PRZED początkiem pokazuje klucz błędu, oznacza pole i blokuje zapis", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    type(MS.end, "2026-09-14T09:00");

    expect(screen.getByText(MS.rangeError)).toBeInTheDocument();
    expect(field(MS.end)).toHaveAttribute("aria-invalid", "true");
    expect(field(MS.end)).toHaveAttribute("aria-describedby", "club-ms-end-error");
    expect(submitButton(MS.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(milestoneCalls).toEqual([]);
  });

  it("poprawiony zakres zdejmuje komunikat i opis pola", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    type(MS.end, "2026-09-14T09:00");
    type(MS.end, "2026-09-14T19:00");

    expect(screen.queryByText(MS.rangeError)).not.toBeInTheDocument();
    expect(field(MS.end)).not.toHaveAttribute("aria-describedby");
    expect(submitButton(MS.add)).toBeEnabled();
  });
});

describe("ClubMilestoneForm - kształt patcha", () => {
  it("TWORZENIE wysyła wątek, obcięty tytuł i null w pustych polach", () => {
    renderMilestone(null);
    type(MS.title, "  Deadline konsultacji  ");
    type(MS.start, "2026-09-14T17:30");
    fireEvent.click(submitButton(MS.add));

    expect(milestoneCalls).toHaveLength(1);
    const payload = milestoneCalls[0];
    expect("id" in payload).toBe(false);
    expect(payload.thread_id).toBe(CLUB_IDS.thread);
    expect(payload.title).toBe("Deadline konsultacji");
    expect(payload.description).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.url).toBeNull();
    expect(payload.ends_at).toBeNull();
    expect(payload.all_day).toBe(false);
  });

  it("wszystkie pola opcjonalne wypełnione jadą obcięte", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    type(MS.end, "2026-09-14T19:00");
    type(MS.location, "  Bruksela  ");
    type(MS.url, "  https://example.test/x  ");
    type(MS.description, "  Notatka  ");
    fireEvent.click(submitButton(MS.add));

    const payload = milestoneCalls[0];
    expect(payload.location).toBe("Bruksela");
    expect(payload.url).toBe("https://example.test/x");
    expect(payload.description).toBe("Notatka");
    expect(payload.ends_at).not.toBeNull();
  });

  it("REDAKCJA niesie id pozycji, więc poprawia wpis zamiast tworzyć drugi", () => {
    renderMilestone(milestoneRow({ id: "milestone-42" }));
    fireEvent.click(submitButton(MS.save));

    expect(milestoneCalls[0].id).toBe("milestone-42");
  });

  it("REDAKCJA bez dotknięcia terminu nie przesuwa go ani o minutę", () => {
    // Obieg ISO -> pole lokalne -> ISO jest tu jedyną drogą, więc rozjazd
    // strefy pokazałby się natychmiast jako inny znacznik.
    renderMilestone(milestoneRow({ starts_at: CLUB_BASE_ISO, ends_at: clubIsoOffset(90) }));
    fireEvent.click(submitButton(MS.save));

    expect(milestoneCalls[0].starts_at).toBe(CLUB_BASE_ISO);
    expect(milestoneCalls[0].ends_at).toBe(clubIsoOffset(90));
  });

  it("przycisk nosi klucz `save` w redakcji i `add` przy tworzeniu", () => {
    renderMilestone(milestoneRow());
    expect(screen.getByRole("button", { name: MS.save })).toBeInTheDocument();
    cleanup();

    renderMilestone(null);
    expect(screen.getByRole("button", { name: MS.add })).toBeInTheDocument();
  });
});

describe("ClubMilestoneForm - tryb całodniowy", () => {
  it("przełącznik zmienia TYP pola, nie tylko flagę", () => {
    renderMilestone(null);
    expect(field(MS.start)).toHaveAttribute("type", "datetime-local");
    expect(field(MS.end)).toHaveAttribute("type", "datetime-local");

    fireEvent.click(field(MS.allDay));

    expect(field(MS.start)).toHaveAttribute("type", "date");
    expect(field(MS.end)).toHaveAttribute("type", "date");
  });

  it("wejście w tryb całodniowy przepisuje wpisany termin na dzień", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    type(MS.end, "2026-09-16T19:00");
    fireEvent.click(field(MS.allDay));

    expect(field(MS.start)).toHaveValue("2026-09-14");
    expect(field(MS.end)).toHaveValue("2026-09-16");
  });

  it("powrót do trybu godzinowego daje POŁUDNIE, a nie przypadkową północ", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    fireEvent.click(field(MS.allDay));
    fireEvent.click(field(MS.allDay));

    expect(field(MS.start)).toHaveValue("2026-09-14T12:00");
  });

  it("przełączenie przy pustych polach nie wstawia niczego", () => {
    renderMilestone(null);
    fireEvent.click(field(MS.allDay));

    expect(field(MS.start)).toHaveValue("");
    expect(field(MS.end)).toHaveValue("");
  });

  it("termin całodniowy jedzie z flagą all_day i kotwicą południa", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    fireEvent.click(field(MS.allDay));
    type(MS.start, "2026-09-14");
    fireEvent.click(submitButton(MS.add));

    const payload = milestoneCalls[0];
    expect(payload.all_day).toBe(true);
    expect(new Date(payload.starts_at).getHours()).toBe(12);
  });

  it("pozycja całodniowa z bazy otwiera formularz od razu w tym trybie", () => {
    renderMilestone(milestoneRow({ all_day: true, starts_at: "2026-09-14T12:00:00.000Z" }));

    expect(field(MS.allDay)).toBeChecked();
    expect(field(MS.start)).toHaveAttribute("type", "date");
  });
});

describe("ClubMilestoneForm - słowniki i akcje", () => {
  it("droplista rodzaju oferuje PEŁNY słownik CHECK-a", () => {
    renderMilestone(null);
    expect(optionValues(MS.kind)).toEqual([...CLUB_MILESTONE_KINDS]);
  });

  it("droplista stanu oferuje PEŁNY słownik CHECK-a", () => {
    renderMilestone(null);
    expect(optionValues(MS.status)).toEqual([...CLUB_MILESTONE_STATUSES]);
  });

  it("wybrany rodzaj i stan lądują w payloadzie", () => {
    renderMilestone(null);
    type(MS.title, "Deadline konsultacji");
    type(MS.start, "2026-09-14T17:30");
    choose(MS.kind, "consultation");
    choose(MS.status, "active");
    fireEvent.click(submitButton(MS.add));

    expect(milestoneCalls[0].kind).toBe("consultation");
    expect(milestoneCalls[0].status).toBe("active");
  });

  it("wiersz z bazy wypełnia droplisty jego wartościami", () => {
    renderMilestone(milestoneRow({ kind: "publication", status: "done" }));

    expect(field(MS.kind)).toHaveValue("publication");
    expect(field(MS.status)).toHaveValue("done");
  });

  it("przycisk rezygnacji woła onCancel i nie wysyła niczego", () => {
    renderMilestone(milestoneRow());
    fireEvent.click(screen.getByRole("button", { name: MS.cancel }));

    expect(cancelCalls).toBe(1);
    expect(milestoneCalls).toEqual([]);
  });

  it("trwający zapis wyłącza przycisk", () => {
    renderMilestone(milestoneRow(), true);
    expect(submitButton(MS.save)).toBeDisabled();
  });

  it("PODWÓJNE kliknięcie wysyła DOKŁADNIE raz", () => {
    render(<MilestonePendingHarness />);
    const button = submitButton(MS.save);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(milestoneCalls).toHaveLength(1);
  });
});

describe("ClubMilestoneForm - dane częściowe i pełne", () => {
  it("pozycja BEZ pól opcjonalnych nie pokazuje gołego undefined", () => {
    renderMilestone(milestoneRow({ description: null, location: null, url: null, ends_at: null }));

    expect(field(MS.description)).toHaveValue("");
    expect(field(MS.location)).toHaveValue("");
    expect(field(MS.url)).toHaveValue("");
    expect(field(MS.end)).toHaveValue("");
  });

  it("pozycja z PEŁNYMI danymi wypełnia wszystkie pola", () => {
    renderMilestone(
      milestoneRow({
        title: "Publikacja stanowiska",
        description: "Opis pozycji",
        location: "Bruksela",
        url: "https://example.test/x",
      }),
    );

    expect(field(MS.title)).toHaveValue("Publikacja stanowiska");
    expect(field(MS.description)).toHaveValue("Opis pozycji");
    expect(field(MS.location)).toHaveValue("Bruksela");
    expect(field(MS.url)).toHaveValue("https://example.test/x");
  });
});

// ===========================================================================
// ClubDocumentForm
// ===========================================================================

describe("ClubDocumentForm - wymóg adresu", () => {
  it("rodzaj wymagający adresu bez adresu oznacza pole, pokazuje klucz i blokuje zapis", () => {
    renderDocument(null);
    type(DOC.title, "Stanowisko Rady");

    expect(screen.getByText(DOC.urlError)).toBeInTheDocument();
    expect(field(DOC.url)).toHaveAttribute("aria-invalid", "true");
    expect(field(DOC.url)).toHaveAttribute("aria-describedby", "club-doc-url-error");
    expect(submitButton(DOC.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(documentCalls).toEqual([]);
  });

  it("NOTATKA jest jedynym rodzajem, który wolno zapisać bez adresu", () => {
    renderDocument(null);
    type(DOC.title, "Notatka z sesji");
    choose(DOC.kind, "note");

    expect(screen.queryByText(DOC.urlError)).not.toBeInTheDocument();
    expect(field(DOC.url)).not.toHaveAttribute("aria-describedby");
    fireEvent.click(submitButton(DOC.add));

    expect(documentCalls).toHaveLength(1);
    expect(documentCalls[0].kind).toBe("note");
    expect(documentCalls[0].url).toBeNull();
  });

  it("wpisany adres zdejmuje komunikat i odblokowuje zapis", () => {
    renderDocument(null);
    type(DOC.title, "Stanowisko Rady");
    type(DOC.url, "https://example.test/a.pdf");

    expect(screen.queryByText(DOC.urlError)).not.toBeInTheDocument();
    expect(submitButton(DOC.add)).toBeEnabled();
  });

  it("same spacje w adresie nie są adresem", () => {
    renderDocument(null);
    type(DOC.title, "Stanowisko Rady");
    type(DOC.url, "    ");

    expect(screen.getByText(DOC.urlError)).toBeInTheDocument();
    expect(submitButton(DOC.add)).toBeDisabled();
  });

  it("krótki tytuł blokuje zapis nawet przy poprawnym adresie", () => {
    renderDocument(null);
    type(DOC.title, "Ok");
    type(DOC.url, "https://example.test/a.pdf");

    expect(submitButton(DOC.add)).toBeDisabled();
    fireEvent.submit(formElement());
    expect(documentCalls).toEqual([]);
  });
});

describe("ClubDocumentForm - kształt patcha", () => {
  it("TWORZENIE wysyła wątek, obcięty tytuł i null w pustych polach", () => {
    renderDocument(null);
    type(DOC.title, "  Stanowisko Rady  ");
    type(DOC.url, "  https://example.test/a.pdf  ");
    fireEvent.click(submitButton(DOC.add));

    const payload = documentCalls[0];
    expect("id" in payload).toBe(false);
    expect(payload.thread_id).toBe(CLUB_IDS.thread);
    expect(payload.title).toBe("Stanowisko Rady");
    expect(payload.url).toBe("https://example.test/a.pdf");
    expect(payload.description).toBeNull();
    expect(payload.source_label).toBeNull();
    expect(payload.published_on).toBeNull();
  });

  it("wszystkie pola opcjonalne wypełnione jadą obcięte, data publikacji bez zmian", () => {
    renderDocument(null);
    type(DOC.title, "Stanowisko Rady");
    type(DOC.url, "https://example.test/a.pdf");
    type(DOC.source, "  Rada UE  ");
    type(DOC.description, "  Opis źródła  ");
    type(DOC.published, "2026-05-04");
    choose(DOC.kind, "recording");
    fireEvent.click(submitButton(DOC.add));

    const payload = documentCalls[0];
    expect(payload.source_label).toBe("Rada UE");
    expect(payload.description).toBe("Opis źródła");
    expect(payload.published_on).toBe("2026-05-04");
    expect(payload.kind).toBe("recording");
  });

  it("REDAKCJA niesie id źródła", () => {
    renderDocument(documentRow({ id: "doc-77" }));
    fireEvent.click(submitButton(DOC.save));

    expect(documentCalls[0].id).toBe("doc-77");
  });

  it("BEZ uprawnienia kuratorskiego przełącznika nie ma, a klucz `is_primary` nie jedzie", () => {
    renderDocument(documentRow({ is_primary: true }), false);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(submitButton(DOC.save));
    expect("is_primary" in documentCalls[0]).toBe(false);
  });

  it("Z uprawnieniem kuratorskim wyróżnienie jedzie w payloadzie", () => {
    renderDocument(documentRow({ is_primary: false }), true);
    fireEvent.click(field(DOC.primary));
    fireEvent.click(submitButton(DOC.save));

    expect(documentCalls[0].is_primary).toBe(true);
  });

  it("ZDJĘCIE wyróżnienia jedzie jako false, nie jako brak klucza", () => {
    renderDocument(documentRow({ is_primary: true }), true);
    expect(field(DOC.primary)).toBeChecked();

    fireEvent.click(field(DOC.primary));
    fireEvent.click(submitButton(DOC.save));

    expect(documentCalls[0].is_primary).toBe(false);
  });
});

describe("ClubDocumentForm - słownik i akcje", () => {
  it("droplista rodzaju oferuje PEŁNY słownik CHECK-a", () => {
    renderDocument(null);
    expect(optionValues(DOC.kind)).toEqual([...CLUB_THREAD_DOCUMENT_KINDS]);
  });

  it("przycisk nosi klucz `save` w redakcji i `add` przy tworzeniu", () => {
    renderDocument(documentRow());
    expect(screen.getByRole("button", { name: DOC.save })).toBeInTheDocument();
    cleanup();

    renderDocument(null);
    expect(screen.getByRole("button", { name: DOC.add })).toBeInTheDocument();
  });

  it("przycisk rezygnacji woła onCancel i nie wysyła niczego", () => {
    renderDocument(documentRow());
    fireEvent.click(screen.getByRole("button", { name: DOC.cancel }));

    expect(cancelCalls).toBe(1);
    expect(documentCalls).toEqual([]);
  });

  it("trwający zapis wyłącza przycisk", () => {
    renderDocument(documentRow(), false, true);
    expect(submitButton(DOC.save)).toBeDisabled();
  });

  it("PODWÓJNE kliknięcie wysyła DOKŁADNIE raz", () => {
    render(<DocumentPendingHarness />);
    const button = submitButton(DOC.save);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(documentCalls).toHaveLength(1);
  });
});

describe("ClubDocumentForm - dane częściowe i pełne", () => {
  it("źródło BEZ pól opcjonalnych nie pokazuje gołego undefined", () => {
    renderDocument(
      documentRow({ url: null, description: null, source_label: null, published_on: null }),
      true,
    );

    expect(field(DOC.url)).toHaveValue("");
    expect(field(DOC.description)).toHaveValue("");
    expect(field(DOC.source)).toHaveValue("");
    expect(field(DOC.published)).toHaveValue("");
    expect(field(DOC.primary)).not.toBeChecked();
  });

  it("źródło z PEŁNYMI danymi wypełnia wszystkie pola", () => {
    renderDocument(
      documentRow({
        title: "Nagranie sesji",
        kind: "recording",
        url: "https://example.test/rec",
        description: "Opis nagrania",
        source_label: "Rada UE",
        published_on: "2026-05-04",
        is_primary: true,
      }),
      true,
    );

    expect(field(DOC.title)).toHaveValue("Nagranie sesji");
    expect(field(DOC.kind)).toHaveValue("recording");
    expect(field(DOC.url)).toHaveValue("https://example.test/rec");
    expect(field(DOC.description)).toHaveValue("Opis nagrania");
    expect(field(DOC.source)).toHaveValue("Rada UE");
    expect(field(DOC.published)).toHaveValue("2026-05-04");
    expect(field(DOC.primary)).toBeChecked();
  });
});
