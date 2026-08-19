// CO DOWODZI TEN PLIK: panel „Historia aktualizacji" dopisuje i usuwa PUBLICZNE
// noty redakcyjne (widoczne czytelnikowi pod analizą), a nie prywatne notatki.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA:
//   * zapytanie MUSI być zawężone do tego wpisu i posortowane malejąco -
//     rozjazd oznacza noty cudzego wpisu w panelu albo najstarszą zmianę na
//     szczycie listy (czytelnik dostaje odwróconą chronologię sprostowań),
//   * po dodaniu noty unieważniamy DWA klucze cache: panel i widok publiczny.
//     Pominięcie klucza publicznego daje najgorszy wariant - redakcja widzi
//     sprostowanie, czytelnik jeszcze nie, i nikt tego nie zauważa,
//   * puste `note_en` musi lecieć jako NULL, nie jako pusty napis: pusty napis
//     to „jest wersja angielska, tylko bez treści" i render pokazałby czytelnikowi
//     puste „EN:",
//   * błąd zapisu/usunięcia MUSI być pokazany. Cicho zjedzony błąd RLS zostawia
//     redaktora w przekonaniu, że sprostowanie zostało opublikowane.
//
// Asercje idą po KLUCZACH i18n (stub), nie po polskim copy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BASE_ISO, EDITOR_IDS } from "@/test/post-editor/fixtures";
import { ok, fail, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as unknown, toast: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: { from: from.from, rpc: vi.fn(async () => ({ data: null, error: null })) },
  };
});

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  stubs.toast = toast;
  return { toast, Toaster: () => null };
});

import { ChangelogCard } from "../ChangelogCard";

const db = stubs.from as SupabaseFromStub;
const toast = () =>
  stubs.toast as ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;

const TABLE = "post_changelog";
const K = {
  hint: "adminPostPanes.changelog.hint",
  date: "adminPostPanes.changelog.dateLabel",
  notePl: "adminPostPanes.changelog.notePlPlaceholder",
  noteEn: "adminPostPanes.changelog.noteEnPlaceholder",
  add: "adminPostPanes.changelog.add",
  del: "adminPostPanes.changelog.delete",
} as const;

interface Row {
  id: string;
  entry_date: string;
  note_pl: string;
  note_en: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "cl-1",
    entry_date: "2026-08-17",
    note_pl: "Uzupełniono dane Eurostatu za 2025 r.",
    note_en: null,
    ...overrides,
  };
}

/**
 * Odpowiedzi planujemy PER OGNIWO: ten sam „stół" obsługuje odczyt, insert
 * i delete, a testy muszą móc obalić dokładnie jedną z tych operacji (np. RLS
 * odrzuca zapis, choć odczyt działa).
 */
function plan(options: {
  select?: SupabaseResult;
  insert?: SupabaseResult;
  remove?: SupabaseResult;
}): void {
  db.setResponse(TABLE, (chain) => {
    if (chain.has("insert")) return options.insert ?? ok(null);
    if (chain.has("delete")) return options.remove ?? ok(null);
    return options.select ?? ok([]);
  });
}

function renderCard(postId = EDITOR_IDS.post) {
  return renderWithQueryClient(<ChangelogCard postId={postId} />);
}

const addButton = () => screen.getByRole("button", { name: K.add });
const notePlInput = () => screen.getByPlaceholderText(K.notePl);
const noteEnInput = () => screen.getByPlaceholderText(K.noteEn);
const dateInput = () => screen.getByLabelText(K.date);

function type(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  db.reset();
  // Datę zamrażamy (bez podmiany timerów - `waitFor` musi dalej tykać
  // realnie), bo domyślna wartość pola to „dziś" i test ma być powtarzalny.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BASE_ISO));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("ChangelogCard - odczyt historii", () => {
  it("czyta noty TYLKO tego wpisu i od najnowszej", async () => {
    plan({ select: ok([row()]) });
    renderCard();
    await screen.findByText(row().note_pl);

    const chain = db.lastChain(TABLE);
    expect(chain?.argsOf("eq")).toEqual(["post_id", EDITOR_IDS.post]);
    // Dwa `order` w tej kolejności: data wpisu maleje, a przy tej samej dacie
    // rozstrzyga czas utworzenia - inaczej dwie noty z jednego dnia skaczą
    // między renderami.
    const orders = chain?.calls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orders).toEqual([
      ["entry_date", { ascending: false }],
      ["created_at", { ascending: false }],
    ]);
  });

  it("wybiera kolumny potrzebne do renderu noty", async () => {
    plan({ select: ok([row()]) });
    renderCard();
    await screen.findByText(row().note_pl);
    expect(db.lastChain(TABLE)?.argsOf("select")).toEqual(["id, entry_date, note_pl, note_en"]);
  });

  it("pokazuje datę i notę PL, a wersję EN dopisuje tylko gdy istnieje", async () => {
    plan({
      select: ok([
        row({ id: "cl-1", note_pl: "Nota bez EN" }),
        row({
          id: "cl-2",
          entry_date: "2026-08-10",
          note_pl: "Nota z EN",
          note_en: "English note",
        }),
      ]),
    });
    renderCard();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("2026-08-17")).toBeInTheDocument();
    expect(within(items[0]).queryByText(/^EN:/)).toBeNull();
    expect(within(items[1]).getByText(/English note/)).toBeInTheDocument();
  });

  it("pusta historia nie renderuje listy (redaktor nie widzi puste ramki)", async () => {
    plan({ select: ok([]) });
    renderCard();
    await screen.findByText(K.hint);
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBe(1));
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("odpowiedź bez wierszy (data = null) nie wywraca panelu", async () => {
    plan({ select: ok(null) });
    renderCard();
    await screen.findByText(K.hint);
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBe(1));
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("błąd odczytu nie blokuje dopisania nowej noty", async () => {
    // Historia nie wczytała się (np. chwilowy błąd sieci), ale formularz musi
    // dalej działać - inaczej pojedynczy błąd odczytu zamyka drogę do
    // opublikowania sprostowania.
    plan({ select: fail("boom") });
    renderCard();
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBeGreaterThan(0));
    type(notePlInput(), "Poprawka literowa");
    expect(addButton()).not.toBeDisabled();
  });
});

describe("ChangelogCard - dopisanie noty", () => {
  it("domyślną datą jest dziś w formacie ISO", async () => {
    // UWAGA (defekt D2 w raporcie): karta liczy „dziś" z `toISOString()`, czyli
    // z daty UTC, a nie z daty LOKALNEJ redaktora. Test zamraża czas na 10:00 UTC,
    // gdzie obie daty są zgodne, więc opisuje zachowanie oczekiwane; między
    // lokalną północą a 01:00/02:00 (CET/CEST) ta sama linia podstawia datę
    // WCZORAJSZĄ i publiczna nota o aktualizacji dostaje złą datę.
    plan({ select: ok([]) });
    renderCard();
    expect(dateInput()).toHaveValue("2026-08-18");
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBe(1));
  });

  it("nie da się dopisać noty bez treści PL (także z samych spacji)", async () => {
    plan({ select: ok([]) });
    renderCard();
    expect(addButton()).toBeDisabled();
    type(notePlInput(), "   ");
    expect(addButton()).toBeDisabled();
    type(notePlInput(), "Sprostowanie");
    expect(addButton()).not.toBeDisabled();
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBe(1));
  });

  it("nie da się dopisać noty bez daty (data jest częścią oświadczenia)", async () => {
    plan({ select: ok([]) });
    renderCard();
    type(notePlInput(), "Sprostowanie");
    type(dateInput(), "");
    expect(addButton()).toBeDisabled();
    await waitFor(() => expect(db.chainsFor(TABLE).length).toBe(1));
  });

  it("zapisuje przyciętą notę PL, wybraną datę i wpis wiąże z tym postem", async () => {
    plan({ select: ok([]) });
    renderCard();
    type(dateInput(), "2026-08-12");
    type(notePlInput(), "  Zaktualizowano tabelę  ");
    fireEvent.click(addButton());

    await waitFor(() => expect(db.chainsFor(TABLE).some((c) => c.has("insert"))).toBe(true));
    const insert = db.chainsFor(TABLE).find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toEqual({
      post_id: EDITOR_IDS.post,
      entry_date: "2026-08-12",
      note_pl: "Zaktualizowano tabelę",
      note_en: null,
    });
  });

  it("puste EN idzie jako NULL, a wypełnione jako przycięty tekst", async () => {
    plan({ select: ok([]) });
    renderCard();
    type(notePlInput(), "Nota PL");
    type(noteEnInput(), "   Note EN   ");
    fireEvent.click(addButton());

    await waitFor(() => expect(db.chainsFor(TABLE).some((c) => c.has("insert"))).toBe(true));
    const insert = db.chainsFor(TABLE).find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({ note_en: "Note EN" });
  });

  it("po zapisie czyści treści, ale ZOSTAWIA datę (kolejna nota z tego samego dnia)", async () => {
    plan({ select: ok([]) });
    renderCard();
    type(dateInput(), "2026-08-12");
    type(notePlInput(), "Nota PL");
    type(noteEnInput(), "Note EN");
    fireEvent.click(addButton());

    await waitFor(() => expect(notePlInput()).toHaveValue(""));
    expect(noteEnInput()).toHaveValue("");
    expect(dateInput()).toHaveValue("2026-08-12");
  });

  it("po zapisie odświeża panel ORAZ widok publiczny wpisu", async () => {
    plan({ select: ok([]) });
    const { queryClient } = renderCard();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    type(notePlInput(), "Nota PL");
    fireEvent.click(addButton());

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ["admin", "post-changelog", EDITOR_IDS.post],
      ["public", "post-changelog", EDITOR_IDS.post],
    ]);
  });

  it("błąd zapisu jest POKAZANY, a wpisana nota nie ginie", async () => {
    plan({ select: ok([]), insert: fail("new row violates row-level security policy") });
    renderCard();
    type(notePlInput(), "Nota PL");
    fireEvent.click(addButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledTimes(1));
    expect(toast().error).toHaveBeenCalledWith("new row violates row-level security policy");
    // Treść zostaje w polu - redaktor może poprawić i spróbować ponownie.
    expect(notePlInput()).toHaveValue("Nota PL");
  });

  it("błąd bez klasy Error jest zamieniany na tekst, nie na „[object Object]”", async () => {
    // Ramię `String(e)` w `onError`. Nie każdy odrzucony wynik jest instancją
    // Error (np. wartość z warstwy transportowej), a komunikat i tak musi być
    // czytelny.
    plan({
      select: ok([]),
      insert: { data: null, error: "transport down" as unknown as null },
    });
    renderCard();
    type(notePlInput(), "Nota PL");
    fireEvent.click(addButton());

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("transport down"));
  });
});

describe("ChangelogCard - usunięcie noty", () => {
  it("usuwa dokładnie wskazaną notę", async () => {
    plan({ select: ok([row({ id: "cl-42" })]) });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: K.del }));

    await waitFor(() => expect(db.chainsFor(TABLE).some((c) => c.has("delete"))).toBe(true));
    const del = db.chainsFor(TABLE).find((c) => c.has("delete"));
    expect(del?.argsOf("eq")).toEqual(["id", "cl-42"]);
  });

  it("po usunięciu odświeża panel ORAZ widok publiczny", async () => {
    plan({ select: ok([row()]) });
    const { queryClient } = renderCard();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: K.del }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual([
      ["admin", "post-changelog", EDITOR_IDS.post],
      ["public", "post-changelog", EDITOR_IDS.post],
    ]);
  });

  it("błąd usunięcia jest POKAZANY (nota nie zniknęła cicho)", async () => {
    plan({ select: ok([row()]), remove: fail("permission denied for table post_changelog") });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: K.del }));

    await waitFor(() =>
      expect(toast().error).toHaveBeenCalledWith("permission denied for table post_changelog"),
    );
    // Wiersz nadal widoczny - stan panelu nie kłamie o wyniku operacji.
    expect(screen.getByText(row().note_pl)).toBeInTheDocument();
  });

  it("błąd usunięcia bez klasy Error też daje czytelny komunikat", async () => {
    plan({
      select: ok([row()]),
      remove: { data: null, error: "socket closed" as unknown as null },
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: K.del }));
    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("socket closed"));
  });

  it("przycisk usuwania ma nazwę dostępną (to ikona bez tekstu)", async () => {
    plan({ select: ok([row()]) });
    renderCard();
    const button = await screen.findByRole("button", { name: K.del });
    expect(button).toHaveAttribute("aria-label", K.del);
  });
});
