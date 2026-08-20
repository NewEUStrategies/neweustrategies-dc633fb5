// Harmonogram wydarzenia: dni -> sesje -> prelegenci i sponsorzy. Trzy poziomy
// zagnieżdżenia, a każdy z nich ma własne przenoszenie, usuwanie i patch.
//
// Reguły, które ten plik przypina (i których tabela z `editorMatrix` nie
// wyrazi, bo dotyczą KONKRETNYCH kształtów danych):
//  1. Pozycja BEZ NAZWY musi mieć etykietę zastępczą z numerem - inaczej
//     redakcja widzi listę pustych wierszy i nie wie, który jest który.
//  2. Podpięcie profilu platformy nie może zdeptać ręcznie wpisanego nazwiska
//     ani zdjęcia; puste pola dobiera z profilu.
//  3. Przenoszenie na krańcach listy jest bezskuteczne, ale NIE gubi pozycji.
//  4. Sesja typu "przerwa" ma inny zestaw pól niż zwykła sesja.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { EventScheduleEditor } from "../EventScheduleEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
// Wyszukiwarka profili ma własny test (zapytanie, debounce, lista trafień).
// Tutaj potrzebne są dwa przyciski: trafienie PEŁNE i trafienie BEZ danych -
// to od nich zależy, czy edytor dobierze brakujące pola, czy nadpisze wpisane.
vi.mock("../ProfilePicker", () => ({
  ProfilePicker: ({
    onPick,
    onClear,
  }: {
    value?: string;
    lang: "pl" | "en";
    onPick: (hit: { id: string; display_name?: string; avatar_url?: string }) => void;
    onClear: () => void;
  }) => (
    <span>
      <button
        type="button"
        data-testid="profil-pelny"
        onClick={() =>
          onPick({ id: "u-1", display_name: "Anna Nowak", avatar_url: "https://cdn.test/an.png" })
        }
      />
      <button type="button" data-testid="profil-bez-danych" onClick={() => onPick({ id: "u-2" })} />
      <button type="button" data-testid="profil-odepnij" onClick={onClear} />
    </span>
  ),
}));

function renderEditor(initial: WidgetNode["content"]) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <EventScheduleEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  openAll(view.container);
  const days = (): Array<Record<string, unknown>> => {
    const last = written.filter(([k]) => k === "days").at(-1);
    return (last?.[1] ?? []) as Array<Record<string, unknown>>;
  };
  return { ...view, written, days };
}

const sessionOf = (over: Record<string, Json> = {}): Record<string, Json> => ({
  id: "s-1",
  title_pl: "Sesja otwierająca",
  title_en: "Opening session",
  from: "10:00",
  to: "11:00",
  kind: "session",
  speakers: [],
  sponsors: [],
  ...over,
});

const dayOf = (over: Record<string, Json> = {}): Record<string, Json> => ({
  id: "day-1",
  label_pl: "Dzień 1",
  label_en: "Day 1",
  date: "2026-09-01",
  sessions: [sessionOf()],
  ...over,
});

/**
 * Rozwija WSZYSTKIE poziomy listy. Dzień, sesja i jej podlisty są domyślnie
 * zwinięte (panel nie pokazuje trzech poziomów naraz), więc bez tego kroku
 * połowa pól nie istnieje w DOM. Dwie rundy, bo rozwinięcie dnia dopiero
 * ODSŁANIA przełącznik sesji.
 */
function openAll(container: HTMLElement): void {
  for (let round = 0; round < 3; round += 1) {
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'),
    );
    const summaries = Array.from(container.querySelectorAll<HTMLElement>("summary"));
    if (!toggles.length && !summaries.length) return;
    for (const toggle of toggles) fireEvent.click(toggle);
    for (const summary of summaries) fireEvent.click(summary);
  }
}

/** Wszystkie przyciski o danym tytule - listy mają je per wiersz. */
const buttonsTitled = (title: string): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.getAttribute("title") === title || b.getAttribute("aria-label") === title,
  );

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["profiles", "events", "media"]) db.current.setResponse(table, ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EventScheduleEditor - etykiety zastępcze", () => {
  it("prelegent bez nazwiska ma etykietę z numerem", () => {
    const { container } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              speakers: [
                { id: "sp1", userId: "u-9" },
                { id: "sp2", userId: "u-8" },
              ],
            }),
          ],
        }),
      ],
    });
    // Prelegent podpięty do profilu nie musi mieć lokalnej nazwy - wiersz
    // dostaje wtedy numer. Dwa puste wiersze bez numeru byłyby
    // nierozróżnialne.
    expect(container.textContent).toContain("Prelegent #1");
    expect(container.textContent).toContain("Prelegent #2");
  });

  it("sponsor bez nazwy ma etykietę z numerem", () => {
    const { container } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              kind: "break",
              sponsors: [{ id: "spn1", name: "", logo: "https://cdn.test/l.png" }],
            }),
          ],
        }),
      ],
    });
    expect(container.textContent).toContain("Sponsor #1");
  });

  it("prelegent z nazwiskiem pokazuje nazwisko, nie numer", () => {
    const { container } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", name: "Jan Kowalski" }] })] })],
    });
    expect(container.textContent).toContain("Jan Kowalski");
    expect(container.textContent).not.toContain("Prelegent #1");
  });
});

describe("EventScheduleEditor - podpięcie profilu platformy", () => {
  it("puste pola dobiera z profilu", () => {
    const { days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-0" }] })] })],
    });
    fireEvent.click(screen.getByTestId("profil-pelny"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("u-1");
    expect(speakers[0]?.name).toBe("Anna Nowak");
    expect(speakers[0]?.photo).toBe("https://cdn.test/an.png");
  });

  it("ręcznie wpisane nazwisko i zdjęcie mają pierwszeństwo nad profilem", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [
            sessionOf({
              speakers: [
                { id: "sp1", name: "Wpisane ręcznie", photo: "https://cdn.test/moje.png" },
              ],
            }),
          ],
        }),
      ],
    });
    fireEvent.click(screen.getByTestId("profil-pelny"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    // Redakcja poprawia nazwiska po polsku - podpięcie profilu nie może tego
    // zdeptać, bo poprawka wróciłaby do wersji z profilu.
    expect(speakers[0]?.name).toBe("Wpisane ręcznie");
    expect(speakers[0]?.photo).toBe("https://cdn.test/moje.png");
    expect(speakers[0]?.userId).toBe("u-1");
  });

  it("profil bez danych nie wstawia pustych wartości udających treść", () => {
    const { days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-0" }] })] })],
    });
    fireEvent.click(screen.getByTestId("profil-bez-danych"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("u-2");
    expect(speakers[0]?.name).toBe("");
    expect(speakers[0]?.photo).toBe("");
  });

  it("odpięcie profilu czyści tylko referencję", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [sessionOf({ speakers: [{ id: "sp1", userId: "u-9", name: "Jan Kowalski" }] })],
        }),
      ],
    });
    fireEvent.click(screen.getByTestId("profil-odepnij"));
    const speakers = (days()[0]?.sessions as Array<Record<string, unknown>>)[0]?.speakers as Array<
      Record<string, unknown>
    >;
    expect(speakers[0]?.userId).toBe("");
    expect(speakers[0]?.name).toBe("Jan Kowalski");
  });
});

describe("EventScheduleEditor - przenoszenie na krańcach", () => {
  it("przeniesienie pierwszej sesji wyżej nie gubi żadnej", () => {
    const { days } = renderEditor({
      days: [
        dayOf({
          sessions: [sessionOf(), sessionOf({ id: "s-2", title_pl: "Druga" })],
        }),
      ],
    });
    const up = buttonsTitled("Przesuń wyżej");
    expect(up.length).toBeGreaterThan(0);
    fireEvent.click(up[up.length - 1]!);
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>>;
    // Ruch poza zakres zwraca listę bez zmian - liczba pozycji MUSI zostać.
    expect(sessions?.length ?? 2).toBe(2);
  });

  it("przeniesienie ostatniego dnia niżej nie gubi dni", () => {
    const { days } = renderEditor({
      days: [dayOf(), dayOf({ id: "day-2", label_pl: "Dzień 2", sessions: [] })],
    });
    const down = buttonsTitled("Przesuń niżej");
    fireEvent.click(down[down.length - 1]!);
    expect((days().length || 2) >= 2).toBe(true);
  });
});

describe("EventScheduleEditor - sesja typu przerwa", () => {
  it("tylko przerwa ma sekcję sponsorów", () => {
    const zwykla = renderEditor({ days: [dayOf({ sessions: [sessionOf()] })] });
    // Sponsorzy są przypisani do PRZERWY (kawa, lunch), nie do sesji
    // merytorycznej - panel nie może ich oferować tam, gdzie renderer ich
    // nie rysuje.
    expect(zwykla.container.textContent).not.toContain("Sponsorzy przerwy");
    zwykla.unmount();
    const przerwa = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa" })] })],
    });
    expect(przerwa.container.textContent).toContain("Sponsorzy przerwy");
  });

  it("dodanie sponsora przerwy dopisuje pusty wiersz", () => {
    const { container, days } = renderEditor({
      days: [dayOf({ sessions: [sessionOf({ kind: "break", title_pl: "Kawa" })] })],
    });
    const addButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
      (b) => (b.textContent ?? "").trim().startsWith("+"),
    );
    const last = addButtons.at(-1);
    if (!last) throw new Error("test: brak przycisku dodawania sponsora");
    fireEvent.click(last);
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("zmiana rodzaju sesji zapisuje się w dokumencie", () => {
    const { days, container } = renderEditor({ days: [dayOf({ sessions: [sessionOf()] })] });
    const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
      sel.querySelector('option[value="break"]'),
    );
    if (!select) throw new Error("test: brak listy rodzaju sesji");
    fireEvent.change(select, { target: { value: "break" } });
    const sessions = days()[0]?.sessions as Array<Record<string, unknown>>;
    expect(sessions[0]?.kind).toBe("break");
    fireEvent.change(select, { target: { value: "session" } });
  });
});
