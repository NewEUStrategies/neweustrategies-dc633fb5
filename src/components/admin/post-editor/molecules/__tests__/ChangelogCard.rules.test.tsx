// Publiczna historia zmian artykułu. Karta stała na 0%, a wpisy, które tu
// powstają, czyta CZYTELNIK na stronie wpisu - to nie jest notatnik redakcji.
import "@/lib/i18n-admin-post-panes";
import i18n from "@/lib/i18n";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const stub = supabaseFromStub();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: vi.fn() },
}));

import { ChangelogCard } from "../ChangelogCard";

const t = i18n.getFixedT("pl");
const POST_ID = "post-1";

beforeEach(() => {
  stub.reset();
  stub.setResponse("post_changelog", ok([]));
  toastError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function dateInput(): HTMLInputElement {
  return screen.getByLabelText(t("adminPostPanes.changelog.dateLabel")) as HTMLInputElement;
}

function notePl(): HTMLInputElement {
  return screen.getByPlaceholderText(
    t("adminPostPanes.changelog.notePlPlaceholder"),
  ) as HTMLInputElement;
}

function noteEn(): HTMLInputElement {
  return screen.getByPlaceholderText(
    t("adminPostPanes.changelog.noteEnPlaceholder"),
  ) as HTMLInputElement;
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(t("adminPostPanes.changelog.add")) });
}

/** Ładunek INSERT-a. Po zapisie leci jeszcze refetch listy, więc `lastChain`
 *  wskazywałby na SELECT, nie na wstawienie. */
function insertedRow(): Record<string, unknown> {
  const chain = stub.chainsFor("post_changelog").find((c) => c.has("insert"));
  expect(chain, "nie zapisano wiersza historii zmian").toBeTruthy();
  return chain!.argsOf("insert")![0] as Record<string, unknown>;
}

describe("ChangelogCard - domyślna data wpisu", () => {
  it("REGRESJA: data jest LOKALNA, nie w UTC", () => {
    // Karta wstawiała `new Date().toISOString().slice(0,10)`. Redaktor
    // pracujący między północą a 01:00/02:00 czasu polskiego dostawał datę
    // WCZORAJSZĄ i zapisywał ją do PUBLICZNEJ historii zmian - czytelnik
    // widział zmianę datowaną na dobę wstecz.
    //
    // 23:30 czasu lokalnego 1 lipca to w UTC już 2 lipca (dla stref na
    // wschód od Greenwich), więc ten moment rozróżnia obie reguły.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1, 23, 30));

    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);
    expect(dateInput().value).toBe("2026-07-01");
  });

  it("data początkowa jest edytowalna - wpis może dotyczyć zmiany sprzed dni", () => {
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);
    fireEvent.change(dateInput(), { target: { value: "2026-05-04" } });
    expect(dateInput().value).toBe("2026-05-04");
  });
});

describe("ChangelogCard - zapis wpisu", () => {
  it("zapisuje notatkę PL wraz z datą i identyfikatorem wpisu", async () => {
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);

    fireEvent.change(notePl(), { target: { value: "  Poprawiono dane liczbowe  " } });
    fireEvent.change(dateInput(), { target: { value: "2026-05-04" } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(stub.chainsFor("post_changelog").some((c) => c.has("insert"))).toBe(true),
    );
    const insert = insertedRow();
    expect(insert.post_id).toBe(POST_ID);
    expect(insert.entry_date).toBe("2026-05-04");
    // Białe znaki obcięte - inaczej notatka czytelnika zaczynałaby się spacją.
    expect(insert.note_pl).toBe("Poprawiono dane liczbowe");
  });

  it("pusta notatka EN zapisuje się jako NULL, nie jako pusty napis", async () => {
    // Publiczny render pyta o obecność wersji EN. Pusty napis wyglądałby jak
    // istniejące, ale puste tłumaczenie i wypchnąłby czytelnikowi pustą sekcję.
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);

    fireEvent.change(notePl(), { target: { value: "Zmiana" } });
    fireEvent.change(noteEn(), { target: { value: "   " } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(stub.chainsFor("post_changelog").some((c) => c.has("insert"))).toBe(true),
    );
    expect(insertedRow().note_en).toBeNull();
  });

  it("błąd zapisu jest zgłaszany, a nie połykany", async () => {
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);
    stub.setResponse("post_changelog", (chain) =>
      chain.has("insert") ? fail("naruszenie RLS") : ok([]),
    );

    fireEvent.change(notePl(), { target: { value: "Zmiana" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("naruszenie RLS"));
  });
});

describe("ChangelogCard - lista wpisów", () => {
  it("czyta historię TEGO wpisu, posortowaną od najnowszej daty", async () => {
    // Historia zmian bez sortowania po dacie czyta się jak lista przypadkowa,
    // a to ona ma odpowiadać na pytanie „co zmieniło się ostatnio".
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);

    await waitFor(() => expect(stub.chainsFor("post_changelog").length).toBeGreaterThan(0));
    const chain = stub.chainsFor("post_changelog")[0];
    expect(chain.argsOf("eq")).toEqual(["post_id", POST_ID]);
    expect(chain.argsOf("order")).toEqual(["entry_date", { ascending: false }]);
  });

  it("pokazuje zapisane notatki", async () => {
    stub.setResponse(
      "post_changelog",
      ok([
        { id: "c1", entry_date: "2026-05-04", note_pl: "Korekta danych", note_en: null },
        { id: "c2", entry_date: "2026-04-01", note_pl: "Aktualizacja źródeł", note_en: "Sources" },
      ]),
    );
    renderWithQueryClient(<ChangelogCard postId={POST_ID} />);

    await waitFor(() => expect(screen.getByText("Korekta danych")).toBeInTheDocument());
    expect(screen.getByText("Aktualizacja źródeł")).toBeInTheDocument();
  });
});
