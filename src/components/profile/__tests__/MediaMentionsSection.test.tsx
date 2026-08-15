// „Obecność w mediach" - właściciel zarządza własnymi wpisami `media_mentions`.
// Wpisy trafiają na publiczny hub eksperta i (od 2026-08-06) do eksportu RODO,
// więc test pilnuje: odczytu ograniczonego do właściciela, walidacji przed
// zapisem, przycinania pól, rozróżnienia INSERT/UPDATE, przełącznika
// widoczności publicznej oraz tego, że etykiety są POWIĄZANE z polami.
import { describe, expect, it, vi, beforeEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

type SelectCall = { table: string; columns: string; filters: Array<[string, string]> };
type WriteCall = {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: unknown;
  id?: string;
};

const h = vi.hoisted(() => ({
  rows: { current: [] as Array<Record<string, unknown>> },
  selectError: { current: null as { message: string } | null },
  writeError: { current: null as { message: string } | null },
  selects: [] as SelectCall[],
  writes: [] as WriteCall[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    select: (columns: string) => {
      const call: SelectCall = { table, columns, filters: [] };
      h.selects.push(call);
      const builder = {
        eq: (column: string, value: string) => {
          call.filters.push([column, value]);
          return builder;
        },
        order: () => Promise.resolve({ data: h.rows.current, error: h.selectError.current }),
      };
      return builder;
    },
    insert: (payload: unknown) => ({
      select: () => ({
        single: () => {
          h.writes.push({ table, op: "insert", payload });
          return Promise.resolve({
            data: h.writeError.current ? null : { id: "nowe-id" },
            error: h.writeError.current,
          });
        },
      }),
    }),
    update: (payload: unknown) => ({
      eq: (_column: string, id: string) => {
        h.writes.push({ table, op: "update", payload, id });
        return Promise.resolve({ error: h.writeError.current });
      },
    }),
    delete: () => ({
      eq: (_column: string, id: string) => {
        h.writes.push({ table, op: "delete", id });
        return Promise.resolve({ error: h.writeError.current });
      },
    }),
  });
  return { supabase: { from } };
});

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));

// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

import { MediaMentionsSection } from "../MediaMentionsSection";

const USER = "user-a";

const STORED_ROW = {
  id: "m1",
  outlet: "Rzeczpospolita",
  title: "Wywiad o AI Act",
  url: "https://rp.pl/wywiad",
  kind: "interview",
  language: "pl",
  published_on: "2026-05-01",
  is_public: true,
  cover_url: null,
};

beforeEach(() => {
  h.rows.current = [];
  h.selectError.current = null;
  h.writeError.current = null;
  h.selects.length = 0;
  h.writes.length = 0;
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});

describe("odczyt", () => {
  it("czyta WYŁĄCZNIE wiersze właściciela i tylko zadeklarowane kolumny", async () => {
    render(<MediaMentionsSection userId={USER} />);
    await waitFor(() => expect(h.selects).toHaveLength(1));
    expect(h.selects[0].table).toBe("media_mentions");
    expect(h.selects[0].filters).toEqual([["user_id", USER]]);
    expect(h.selects[0].columns).not.toContain("*");
  });

  it("pusta lista pokazuje zachętę zamiast pustego ekranu", async () => {
    render(<MediaMentionsSection userId={USER} />);
    expect(await screen.findByText(/Nie masz jeszcze dodanych wystąpień/)).toBeInTheDocument();
  });

  it("błąd odczytu zgłasza komunikat i kończy ładowanie", async () => {
    h.selectError.current = { message: "permission denied" };
    render(<MediaMentionsSection userId={USER} />);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
    expect(screen.queryByText("Ładowanie...")).not.toBeInTheDocument();
  });

  it("renderuje zapisany wpis w formularzu edycji", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    expect(await screen.findByDisplayValue("Rzeczpospolita")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Wywiad o AI Act")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://rp.pl/wywiad")).toBeInTheDocument();
  });
});

describe("dostępność formularza", () => {
  it("każda etykieta jest powiązana ze swoim polem", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    expect(screen.getByLabelText("Wydawca / stacja / podcast")).toHaveValue("Rzeczpospolita");
    expect(screen.getByLabelText("Tytuł materiału")).toHaveValue("Wywiad o AI Act");
    expect(screen.getByLabelText("Link (URL)")).toHaveValue("https://rp.pl/wywiad");
    expect(screen.getByLabelText("Data publikacji")).toHaveValue("2026-05-01");
    expect(screen.getByLabelText("Język (opcjonalnie)")).toHaveValue("pl");
  });

  it("dwa wiersze mają rozłączne identyfikatory pól", async () => {
    h.rows.current = [STORED_ROW, { ...STORED_ROW, id: "m2", outlet: "TVN24" }];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("TVN24");
    const outlets = screen.getAllByLabelText("Wydawca / stacja / podcast");
    expect(outlets).toHaveLength(2);
    expect(outlets[0].id).not.toBe(outlets[1].id);
  });
});

describe("zapis", () => {
  it("odmawia zapisu bez tytułu i wydawcy", async () => {
    render(<MediaMentionsSection userId={USER} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Dodaj/ })[1]);

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Wypełnij tytuł, wydawcę i datę."),
    );
    expect(h.writes).toHaveLength(0);
  });

  it("nowy wiersz idzie INSERT-em ze stemplem właściciela i przyciętymi polami", async () => {
    render(<MediaMentionsSection userId={USER} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj/ }));

    fireEvent.change(screen.getByLabelText("Wydawca / stacja / podcast"), {
      target: { value: "  Polityka Insight  " },
    });
    fireEvent.change(screen.getByLabelText("Tytuł materiału"), {
      target: { value: "  Komentarz  " },
    });
    fireEvent.change(screen.getByLabelText("Link (URL)"), {
      target: { value: "  https://pi.pl/x  " },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Dodaj/ })[1]);

    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0].op).toBe("insert");
    expect(h.writes[0].payload).toMatchObject({
      user_id: USER,
      outlet: "Polityka Insight",
      title: "Komentarz",
      url: "https://pi.pl/x",
      is_public: true,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("Dodano wpis medialny");
  });

  it("istniejący wiersz idzie UPDATE-em po identyfikatorze", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    fireEvent.change(screen.getByLabelText("Tytuł materiału"), {
      target: { value: "Nowy tytuł" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ op: "update", id: "m1" });
    expect(h.toastSuccess).toHaveBeenCalledWith("Zapisano");
  });

  it("przycisk zapisu jest nieaktywny, dopóki nic się nie zmieniło", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    const save = screen.getByRole("button", { name: /Zapisz/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tytuł materiału"), { target: { value: "X" } });
    expect(save).toBeEnabled();
  });

  it("odmowa bazy nie udaje sukcesu i odblokowuje formularz", async () => {
    h.rows.current = [STORED_ROW];
    h.writeError.current = { message: "row-level security" };
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    fireEvent.change(screen.getByLabelText("Tytuł materiału"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("row-level security"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /Zapisz/ })).toBeEnabled());
  });

  it("pusty link i pusty język zapisują się jako NULL, nie jako pusty tekst", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    fireEvent.change(screen.getByLabelText("Link (URL)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Język (opcjonalnie)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0].payload).toMatchObject({ url: null, language: null });
  });
});

describe("usuwanie", () => {
  it("utrwalony wiersz kasuje się w bazie i znika z listy", async () => {
    h.rows.current = [STORED_ROW];
    render(<MediaMentionsSection userId={USER} />);
    await screen.findByDisplayValue("Rzeczpospolita");

    fireEvent.click(screen.getByRole("button", { name: /Usuń/ }));
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]).toMatchObject({ op: "delete", id: "m1" });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Rzeczpospolita")).not.toBeInTheDocument(),
    );
  });

  it("nieutrwalony wiersz znika bez ruchu do bazy", async () => {
    render(<MediaMentionsSection userId={USER} />);
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj/ }));
    expect(screen.getByLabelText("Tytuł materiału")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Usuń/ }));
    await waitFor(() => expect(screen.queryByLabelText("Tytuł materiału")).not.toBeInTheDocument());
    expect(h.writes).toHaveLength(0);
  });
});
