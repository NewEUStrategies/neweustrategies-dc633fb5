// Kalendarz publikacji (blok `calendar`) - CalendarView.
//
// Blok rysuje siatkę miesiąca od PONIEDZIAŁKU i linkuje dni, w których coś
// wyszło. Dowodzimy:
//   * miesiąc z ustawień ("YYYY-MM") trafia do zapytania jako {year, month} -
//     ten sam klucz, który rozgrzewa prefetch SSR,
//   * pierwszy dzień miesiąca stoi pod właściwym dniem tygodnia, a miesiąc ma
//     właściwą liczbę dni (luty, rok przestępny),
//   * dzień z publikacją jest odnośnikiem do PIERWSZEGO wpisu tego dnia,
//     pozostałe dni są zwykłym tekstem,
//   * nagłówek miesiąca i dni tygodnia są w języku strony.
//
// Granice: zapytanie (`calendarBlockQueryOptions` -> atrapa z wierszami
// i zapisem wejścia), router przez wspólną atrapę Link. `calendarTarget`
// jest prawdziwy - to on tłumaczy ustawienie bloku na klucz zapytania.
// Godziny publikacji są w południe UTC, żeby dzień nie zależał od strefy
// procesu testowego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ rows: [] as unknown[], inputs: [] as unknown[] }));

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useRouter: () => ({ navigate: () => undefined }) };
});
vi.mock("@/lib/queries/blocks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/blocks")>()),
  calendarBlockQueryOptions: (input: unknown) => {
    h.inputs.push(input);
    return { queryKey: ["calendar", input], queryFn: async () => h.rows, staleTime: 0, gcTime: 0 };
  },
}));

import { CalendarView } from "../CalendarView";

function renderCalendar(month: string, lang: "pl" | "en" = "pl") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarView month={month} lang={lang} />
    </QueryClientProvider>,
  );
}

/** Wiersze tabeli jako tablice tekstów komórek ("" dla komórek przed 1. dniem). */
function grid(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""),
  );
}

beforeEach(() => {
  h.rows = [];
  h.inputs = [];
});

afterEach(() => cleanup());

describe("CalendarView", () => {
  it("miesiąc z ustawień idzie do zapytania jako {year, month}", () => {
    renderCalendar("2026-02");
    expect(h.inputs.at(-1)).toEqual({ year: 2026, month: 2 });
  });

  it("siatka zaczyna się od poniedziałku: 1 lutego 2026 (niedziela) stoi w 7. kolumnie", () => {
    const { container } = renderCalendar("2026-02");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Pn",
      "Wt",
      "Śr",
      "Cz",
      "Pt",
      "So",
      "Nd",
    ]);
    const rows = grid(container);
    expect(rows[0]).toEqual(["", "", "", "", "", "", "1"]);
    expect(rows.at(-1)?.at(-1)).toBe("28");
    expect(rows.flat().filter(Boolean)).toHaveLength(28);
  });

  it("luty roku przestępnego ma 29 dni, a miesiąc od poniedziałku nie ma pustych komórek", () => {
    const leap = renderCalendar("2024-02");
    expect(grid(leap.container).flat().filter(Boolean)).toHaveLength(29);
    cleanup();
    // 1 czerwca 2026 to poniedziałek.
    const june = renderCalendar("2026-06");
    expect(grid(june.container)[0][0]).toBe("1");
  });

  it("dzień z publikacją linkuje do PIERWSZEGO wpisu tego dnia; reszta dni to tekst", async () => {
    h.rows = [
      { slug: "pierwszy", published_at: "2026-02-10T12:00:00.000Z" },
      { slug: "drugi-tego-dnia", published_at: "2026-02-10T13:00:00.000Z" },
      { slug: "inny-dzien", published_at: "2026-02-20T12:00:00.000Z" },
    ];
    renderCalendar("2026-02");
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "10" })).toHaveAttribute("href", "/post/pierwszy");
    expect(screen.getByRole("link", { name: "20" })).toHaveAttribute("href", "/post/inny-dzien");
    expect(screen.queryByRole("link", { name: "11" })).toBeNull();
  });

  it.each([
    ["pl", "luty 2026", "Pn"],
    ["en", "February 2026", "Mon"],
  ] as const)("nagłówek miesiąca i dni tygodnia w języku %s", (lang, label, monday) => {
    const { container } = renderCalendar("2026-02", lang);
    expect(container.querySelector("figcaption")?.textContent).toBe(label);
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent(monday);
  });

  it("puste lub niepoprawne ustawienie miesiąca bierze bieżący miesiąc", () => {
    vi.setSystemTime(new Date(2026, 9, 18, 12));
    try {
      renderCalendar("październik");
      expect(h.inputs.at(-1)).toEqual({ year: 2026, month: 10 });
    } finally {
      vi.useRealTimers();
    }
  });
});
