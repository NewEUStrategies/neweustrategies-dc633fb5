// SpeakersEditor: ORGANIZACJA prelegenta wpisanego ręcznie w studiu.
//
// Regresja przypięta tutaj: karta widgetu `speakers` pokazywała tytuł eksperta,
// ale nie afiliację, bo MODEL TREŚCI widgetu nie miał dla niej pola w ogóle -
// przy źródle „baza" była do wzięcia z kolumny `company` wiersza RPC, a przy
// wpisie ręcznym nie było jej skąd wziąć. Rozstrzygnięcie z commita `145ed72`
// mówi, że fakty o osobie ujednolicamy (układ już nie), więc pole powstało.
//
// TRZY RZECZY, KTÓRE MUSZĄ TRZYMAĆ SIĘ RAZEM:
//  1. panel ZAPISUJE klucz `organization` przez `setContent("speakers", ...)`,
//  2. paleta widgetu SEEDUJE ten klucz, żeby świeży widget nie miał pozycji
//     bez pola (redaktor nie musi wiedzieć, że pole „się pojawi po wpisaniu"),
//  3. renderer publiczny NAPRAWDĘ rysuje to, co panel zapisał - inaczej
//     mielibyśmy dokładnie defekt, którego pilnuje `settingsFidelity`:
//     panel obiecuje, renderer nie czyta.
//
// JEDNO POLE, NIE PARA `_pl` / `_en` - i to jest asercja, nie przypadek:
// publiczna projekcja prelegentów ma JEDNĄ kolumnę afiliacji, więc druga
// rubryka obiecywałaby rozróżnienie, którego przy źródle „baza" nie ma.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeClock } from "@/test/time";

freezeClock();
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Json, WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { SpeakersEditor } from "../SpeakersEditor";
import { SpeakersWidget } from "@/components/builder/organisms/widget-view/SpeakersWidget";

/**
 * Stan wspólny dla atrap ładowanych PRZED importami (`vi.hoisted`): atrapa
 * bazy oraz uchwyt do `onDragEnd` z `DndContext`. Przeciąganie nie da się
 * odtworzyć zdarzeniami wskaźnika pod happy-dom (dnd-kit mierzy układ), więc
 * kontekst ODDAJE test-owi swój handler - ten sam wzorzec, co
 * `src/routes/__tests__/adminPostsCalendarRoute.test.tsx`.
 */
const harness = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  onDragEnd: null as ((event: unknown) => void) | null,
  dragging: false,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!harness.db) throw new Error("test: atrapa bazy nie została ustawiona");
      return harness.db.from(table);
    },
  },
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children?: unknown;
      onDragEnd?: (event: unknown) => void;
    }) => {
      harness.onDragEnd = onDragEnd ?? null;
      return React.createElement("div", { "data-testid": "dnd" }, children as never);
    },
    useSensor: (sensor: unknown) => sensor,
    useSensors: (...sensors: unknown[]) => sensors,
  };
});
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React = await import("react");
  return {
    ...actual,
    SortableContext: ({ children }: { children?: unknown }) =>
      React.createElement(React.Fragment, null, children as never),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: harness.dragging ? { x: 0, y: 12, scaleX: 1, scaleY: 1 } : null,
      transition: undefined,
      isDragging: harness.dragging,
    }),
  };
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

type Recorded = Array<[string, Json]>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const setContent = vi.fn((key: string, value: Json) => {
    calls.push([key, value]);
  });
  render(<SpeakersEditor c={content} lang={lang} setContent={setContent} />);
  return { calls, setContent };
}

function speakersFrom(calls: Recorded): Array<Record<string, unknown>> {
  const last = calls.filter(([key]) => key === "speakers").at(-1);
  return Array.isArray(last?.[1]) ? (last[1] as Array<Record<string, unknown>>) : [];
}

/** Pole afiliacji poznajemy po ETYKIECIE ze słownika (atrapa `t` oddaje klucz),
 *  a nie po pozycji w formularzu - przestawienie pól nie jest defektem. */
function organizationInput(): HTMLInputElement {
  const label = screen.getByText("builder.speakersEditor.organization");
  const field = label.closest("div");
  const input = field?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("brak pola organizacji");
  return input;
}

describe("SpeakersEditor - organizacja wpisu ręcznego", () => {
  it("pokazuje wpisaną wartość i zapisuje ją pod kluczem `organization`", () => {
    const { calls } = renderEditor({
      speakers: [{ id: "sp-1", name: "Anna Kowalska", organization: "Instytut Alfa" }],
    });
    expect(organizationInput().value).toBe("Instytut Alfa");

    fireEvent.change(organizationInput(), { target: { value: "Szkoła Główna Handlowa" } });
    expect(speakersFrom(calls)[0]).toMatchObject({
      name: "Anna Kowalska",
      organization: "Szkoła Główna Handlowa",
    });
  });

  it("pozycja BEZ afiliacji ma pole puste, a nie `undefined` w interfejsie", () => {
    // Dokumenty sprzed tej zmiany nie mają tego klucza w ogóle - i to jest
    // normalny stan, nie awaria panelu.
    renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    expect(organizationInput().value).toBe("");
    expect(screen.queryByDisplayValue("undefined")).toBeNull();
  });

  it("NIE oferuje osobnych rubryk PL i EN dla jednej afiliacji", () => {
    // Rola, kategoria i opis mają bliźniaki językowe; organizacja nie ma i mieć
    // nie może, bo `get_public_speakers` oddaje jedną kolumnę `company`.
    renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    expect(screen.getAllByText("builder.speakersEditor.organization")).toHaveLength(1);
    expect(screen.getAllByText(/^Rola (PL|EN)$/)).toHaveLength(2);
  });

  it("etykieta i podpowiedź idą ze SŁOWNIKA, nie z bliźniaka w kodzie", () => {
    // `check:i18n-hardcoded` trzyma ten plik w rachetcie, więc nowy napis musi
    // mieć klucz w obu językach - atrapa `t` oddaje klucz, czyli jego obecność
    // w drzewie dowodzi, że napis NIE jest wpisany w kod.
    renderEditor({ speakers: [{ id: "sp-1" }] });
    expect(screen.getByText("builder.speakersEditor.organizationHint")).toBeInTheDocument();
  });

  it("„+ dodaj” seeduje klucz afiliacji, a nie zostawia pozycji bez pola", () => {
    const { calls } = renderEditor({ speakers: [] });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(speakersFrom(calls)[0]).toHaveProperty("organization", "");
  });

  it("paleta widgetu seeduje ten sam klucz w pozycji domyślnej", () => {
    const defaults = WIDGETS.find((widget) => widget.type === "speakers")?.defaults();
    const seeded = defaults?.speakers;
    expect(Array.isArray(seeded)).toBe(true);
    expect((seeded as Array<Record<string, unknown>>)[0]).toHaveProperty("organization", "");
  });

  it("źródło z BAZY chowa listę ręczną razem z tym polem", () => {
    // Przy `directory` / `event` karty pochodzą z RPC, więc rubryka afiliacji
    // w panelu obiecywałaby wpływ na coś, czego nie da się nadpisać.
    renderEditor({ source: "directory", speakers: [{ id: "sp-1", name: "Anna" }] });
    expect(screen.queryByText("builder.speakersEditor.organization")).toBeNull();
  });
});

describe("SpeakersEditor -> renderer: afiliacja przechodzi całą drogę", () => {
  it("to, co panel zapisał, karta publiczna NAPRAWDĘ rysuje", () => {
    // Dowód „panel obiecuje = renderer czyta" prowadzony na TYM SAMYM kształcie
    // pozycji, jaki wychodzi z `setContent` - bez tego zmiana nazwy klucza
    // w jednym z dwóch plików przeszłaby oba testy osobno.
    const { calls } = renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    fireEvent.change(organizationInput(), { target: { value: "Instytut Beta" } });
    const saved = speakersFrom(calls);
    cleanup();

    const node: WidgetNode = {
      id: "w-speakers",
      kind: "widget",
      type: "speakers",
      content: { speakers: saved } as WidgetContent,
    };
    // Renderer trzyma zapytanie o źródło „baza" (tu wyłączone przez tryb
    // ręczny), więc potrzebuje klienta zapytań nawet bez sieci.
    renderWithQueryClient(<SpeakersWidget node={node} lang="pl" />);
    expect(screen.getByText("Instytut Beta")).toBeInTheDocument();
  });
});

// ── DRUGI SZEREG: gałęzie ODMOWY i pola ŹRÓDEŁ spoza listy ręcznej ──────────
//
// Powyżej stoi jedna reguła treści (organizacja). Poniżej idą te części panelu,
// których tabela zbiorcza nie tyka, bo nie umie ani upuścić przeciąganego
// wiersza, ani wejść w tryb, w którym karty pochodzą z CRM:
//   1. `handleDragEnd` ma TRZY gałęzie odmowy (brak celu, cel = źródło, pozycja
//      spoza listy). Każda z nich chroni dokument przed przestawieniem
//      kolejności bez decyzji redaktora - a błąd w nich objawia się dopiero
//      utratą pozycji.
//   2. Pola trybów `directory` / `event` (limit profili, picker wydarzenia,
//      dialog profilu) i tryb doładowywania przy dodatniej paginacji istnieją
//      w DOM dopiero po przestawieniu innego pola.

type FormField = HTMLInputElement | HTMLTextAreaElement;

beforeEach(() => {
  harness.db = supabaseFromStub();
  harness.onDragEnd = null;
  harness.dragging = false;
  for (const table of ["events", "profiles_public", "posts", "categories", "tags"]) {
    harness.db.setResponse(table, ok([]));
  }
});

/** Oprawa z klientem zapytań - tryby CRM montują pickery czytające bazę. */
function renderEditorQ(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const view = renderWithQueryClient(
    <SpeakersEditor
      c={content}
      lang={lang}
      setContent={(key, value) => {
        calls.push([key, value]);
      }}
    />,
  );
  return { ...view, calls, map: () => Object.fromEntries(calls) };
}

/** Pole panelu po DOKŁADNEJ treści etykiety `PropField`. */
function fieldLabelled(container: HTMLElement, label: string): FormField {
  for (const node of Array.from(container.querySelectorAll("label"))) {
    if ((node.textContent ?? "").trim() !== label) continue;
    const field = node.closest("div")?.querySelector<FormField>("input, textarea");
    if (field) return field;
  }
  throw new Error(`test: brak pola o etykiecie „${label}”`);
}

/** Lista wyboru poznawana po ISTNIENIU konkretnej opcji, nie po kolejności. */
function selectWithOption(container: HTMLElement, value: string): HTMLSelectElement {
  const found = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
    sel.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją „${value}”`);
  return found;
}

const TWO_SPEAKERS: WidgetContent = {
  speakers: [
    { id: "sp-1", name: "Anna Kowalska" },
    { id: "sp-2", name: "Barbara Nowak" },
  ],
};

describe("SpeakersEditor - przeciąganie wierszy: gałęzie odmowy", () => {
  const namesAfterDrag = (event: unknown): string[] | null => {
    const { calls } = renderEditorQ(TWO_SPEAKERS);
    if (!harness.onDragEnd) throw new Error("test: DndContext nie oddał handlera");
    harness.onDragEnd(event);
    const saved = speakersFrom(calls);
    return calls.length === 0 ? null : saved.map((s) => String(s.name));
  };

  it("upuszczenie POZA listę (brak celu) nie zapisuje niczego", () => {
    // dnd-kit oddaje `over: null`, gdy kursor puszczono nad niczym. Zapis
    // w tym miejscu przestawiałby kolejność bez decyzji redaktora.
    expect(namesAfterDrag({ active: { id: "sp-1" }, over: null })).toBeNull();
  });

  it("upuszczenie na TEJ SAMEJ pozycji nie zapisuje niczego", () => {
    // Zwykłe kliknięcie uchwytu kończy się „przeciągnięciem" na siebie.
    // Zapis oznaczałby brudny dokument (i autosave) po samym kliknięciu.
    expect(namesAfterDrag({ active: { id: "sp-2" }, over: { id: "sp-2" } })).toBeNull();
  });

  it("upuszczenie ze ŹRÓDŁEM spoza listy nie zapisuje niczego", () => {
    expect(namesAfterDrag({ active: { id: "sp-nieznany" }, over: { id: "sp-2" } })).toBeNull();
  });

  it("upuszczenie na CELU spoza listy nie zapisuje niczego", () => {
    expect(namesAfterDrag({ active: { id: "sp-1" }, over: { id: "sp-nieznany" } })).toBeNull();
  });

  it("upuszczenie na innej pozycji zapisuje NOWĄ kolejność", () => {
    expect(namesAfterDrag({ active: { id: "sp-1" }, over: { id: "sp-2" } })).toEqual([
      "Barbara Nowak",
      "Anna Kowalska",
    ]);
  });

  it("pozycja BEZ identyfikatora dostaje klucz zastępczy po indeksie", () => {
    // Dokumenty z importu nie mają `id` w pozycjach. Bez klucza zastępczego
    // przeciąganie takich wierszy nie miałoby czego szukać w liście.
    const { calls } = renderEditorQ({
      speakers: [{ name: "Anna Kowalska" }, { name: "Barbara Nowak" }],
    });
    harness.onDragEnd?.({ active: { id: "sp-idx-0" }, over: { id: "sp-idx-1" } });
    expect(speakersFrom(calls).map((s) => String(s.name))).toEqual([
      "Barbara Nowak",
      "Anna Kowalska",
    ]);
  });

  it("przeciągany wiersz jest PRZYGASZONY, żeby było widać, co się przenosi", () => {
    harness.dragging = true;
    const { container } = renderEditorQ({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.opacity === "0.5",
    );
    expect(dimmed).toHaveLength(1);
  });
});

describe("SpeakersEditor - tryby CRM i ich pola", () => {
  it("tryb „prelegenci wydarzenia” zapisuje wybrane wydarzenie i pozwala je odpiąć", async () => {
    harness.db?.setResponse(
      "events",
      ok([
        {
          id: "ev-1",
          slug: "kongres",
          title_pl: "Kongres",
          title_en: "Congress",
          starts_at: "2026-10-01T09:00:00Z",
          status: "published",
        },
      ]),
    );
    const { container, map } = renderEditorQ({ source: "event", speakers: [] });
    const picker = selectWithOption(container, "__none__");
    await waitFor(() => expect(picker.querySelector('option[value="ev-1"]')).not.toBeNull());

    fireEvent.change(picker, { target: { value: "ev-1" } });
    expect(map().eventId).toBe("ev-1");

    // „- brak -” to wartownik pickera, a w dokumencie musi wylądować PUSTY
    // łańcuch - inaczej widget szukałby wydarzenia o identyfikatorze „__none__”.
    fireEvent.change(picker, { target: { value: "__none__" } });
    expect(map().eventId).toBe("");
  });

  it("tryb „katalog profili” przycina limit do zakresu 1-200", () => {
    const { container, calls } = renderEditorQ({ source: "directory", limit: 24 });
    const limit = fieldLabelled(container, "Limit profili");

    fireEvent.change(limit, { target: { value: "500" } });
    expect(calls.at(-1)?.[1]).toBe(200);

    fireEvent.change(limit, { target: { value: "-3" } });
    // Ujemna liczba profili to widget, którego nie widać - dolna granica
    // MUSI podnieść taki wpis do 1, a nie zapisać go dosłownie.
    expect(calls.at(-1)?.[1]).toBe(1);
  });

  it("limit profili wpisany nie-liczbą wraca do wartości domyślnej", () => {
    const { container, calls } = renderEditorQ({ source: "directory", limit: 24 });
    fireEvent.change(fieldLabelled(container, "Limit profili"), { target: { value: "" } });
    expect(calls.at(-1)).toEqual(["limit", 24]);
  });

  it("tryby z bazy pozwalają WYŁĄCZYĆ dialog profilu prelegenta", () => {
    const { container, map } = renderEditorQ({ source: "directory" });
    const toggle = fieldLabelled(container, "Dialog profilu prelegenta");
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    expect(map().openProfile).toBe(false);
  });

  it("tryb ręczny NIE pokazuje przełącznika dialogu profilu", () => {
    // W trybie ręcznym nie ma profilu, który dałoby się otworzyć - przełącznik
    // obiecywałby wpływ na coś, czego renderer nie zrobi.
    const { container } = renderEditorQ({ source: "manual" });
    expect(() => fieldLabelled(container, "Dialog profilu prelegenta")).toThrow();
  });
});

describe("SpeakersEditor - paginacja listy prelegentów", () => {
  it("tryb doładowywania pojawia się dopiero przy DODATNIEJ paginacji", () => {
    const off = renderEditorQ({ pageSize: 0 });
    expect(() => selectWithOption(off.container, "scroll")).toThrow();
    off.unmount();

    const on = renderEditorQ({ pageSize: 6 });
    expect(selectWithOption(on.container, "scroll")).toBeInTheDocument();
  });

  it("wybór doładowania przy przewijaniu zapisuje się w dokumencie", () => {
    const { container, map } = renderEditorQ({ pageSize: 6 });
    fireEvent.change(selectWithOption(container, "scroll"), { target: { value: "scroll" } });
    expect(map().pageMode).toBe("scroll");
  });

  it("paginacja ujemna wpisana w pole ląduje w dokumencie jako zero", () => {
    // Ujemna liczba prelegentów na stronę nie istnieje; zero jest UMOWNYM
    // wyłączeniem paginacji, więc dolna granica nie może być 1.
    const { container, calls } = renderEditorQ({ pageSize: 6 });
    fireEvent.change(fieldLabelled(container, "Paginacja (0 = wyłączona)"), {
      target: { value: "-5" },
    });
    expect(calls.at(-1)).toEqual(["pageSize", 0]);
  });
});
