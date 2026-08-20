// Trzy okna pomocnicze buildera, z których każde do tej pory nie miało ani
// jednego testu, a każde trzyma decyzję widoczną dla redakcji:
//
//  1. PICKER PUSTEGO KONTENERA - jedyna droga, żeby wypełnić świeży kontener
//     (albo zakładkę) strukturą kolumn. Musi mówić, CO wypełnia (kontener czy
//     zakładkę) i nie może przepuszczać kliknięć do kanwy, bo klik w kanwę
//     zmienia zaznaczenie i picker zniknąłby pod palcem.
//  2. HISTORIA SZABLONU - rewizje sekcji. Najnowsza jest „bieżąca" i NIE ma
//     przywracania (przywracanie jej do siebie samej tworzyłoby puste
//     rewizje), pozostałe mają oba działania.
//  3. PODGLĄD ŻYWY WIDGETU - miniatura w panelu właściwości. Zwinięcie jest
//     zapamiętywane w `localStorage`, a wymuszony hover działa TYLKO dla
//     widgetów, w których w ogóle da się go pokazać.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";
import type { TemplateRevision } from "@/lib/builder/templates";
import EmptyContainerPickerBox from "../EmptyContainerPickerBox";
import { TemplateHistoryDialog } from "../TemplateHistoryDialog";
import { WidgetLivePreview } from "../WidgetLivePreview";

const revisions = vi.hoisted(() => ({
  current: { items: [] as TemplateRevision[], loading: false },
  askedFor: [] as Array<string | null>,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/builder/templates", () => ({
  useTemplateRevisions: (id: string | null) => {
    revisions.askedFor.push(id);
    return revisions.current;
  },
}));
// Miniatura ma być IDENTYCZNA z kanwą, więc używa prawdziwego `WidgetView`.
// Tu sprawdzamy oprawę (zwijanie, hover, tryb), nie sam widok - stąd atrapa.
vi.mock("@/components/builder/organisms/WidgetView", () => ({
  WidgetView: ({ node, lang }: { node: WidgetNode; lang: string }) => (
    <div data-testid="widok-widgetu">{`${node.type}/${lang}`}</div>
  ),
}));
vi.mock("@/lib/content-model/editorCanvas", () => ({
  BuilderModeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const sec: SectionNode = { id: "s1", kind: "section", children: [] };

const rev = (id: string, name: string, created: string): TemplateRevision => ({
  id,
  template_id: "t1",
  name,
  data: sec,
  note: null,
  created_at: created,
  created_by: null,
});

beforeEach(() => {
  revisions.current = { items: [], loading: false };
  revisions.askedFor = [];
  window.localStorage.clear();
});

describe("EmptyContainerPickerBox", () => {
  it.each([
    ["zakładka", true, "builder.chrome.pickTabStructure"],
    ["kontener", false, "builder.chrome.pickContainerStructure"],
  ])("dla %s pyta o właściwą strukturę", (_label, tabsEnabled, key) => {
    render(<EmptyContainerPickerBox tabsEnabled={tabsEnabled} onPick={vi.fn()} />);
    expect(screen.getByText(key)).toBeTruthy();
  });

  it("wybór struktury oddaje rozpiętości kolumn", () => {
    const onPick = vi.fn();
    render(<EmptyContainerPickerBox tabsEnabled={false} onPick={onPick} />);
    fireEvent.click(screen.getByTitle("builder.chrome.insertSection(label=1/3 · 2/3)"));
    expect(onPick).toHaveBeenCalledWith([4, 8]);
  });

  it("kliknięcia nie wychodzą do kanwy", () => {
    const onCanvasClick = vi.fn();
    render(
      <div onClick={onCanvasClick}>
        <EmptyContainerPickerBox tabsEnabled={false} onPick={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByText("builder.chrome.pickContainerStructure"));
    // Klik w kanwę zmienia zaznaczenie, a zmiana zaznaczenia zabiera picker.
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});

describe("TemplateHistoryDialog", () => {
  const template = { id: "t1", name: "Hero", data: sec, created_at: "", created_by: null };

  function open(over: { onInsert?: () => void; onRestore?: () => void } = {}) {
    return render(
      <TemplateHistoryDialog
        template={template}
        open
        onOpenChange={vi.fn()}
        onInsert={over.onInsert ?? vi.fn()}
        onRestore={over.onRestore ?? vi.fn()}
      />,
    );
  }

  it("zamknięty dialog nie pyta bazy o rewizje", () => {
    render(
      <TemplateHistoryDialog
        template={template}
        open={false}
        onOpenChange={vi.fn()}
        onInsert={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    // Historia to osobne zapytanie - otwieranie panelu szablonów nie może
    // ciągnąć rewizji każdego szablonu z listy.
    expect(revisions.askedFor).toEqual([null]);
  });

  it("otwarty dialog pyta o rewizje wskazanego szablonu", () => {
    open();
    expect(revisions.askedFor).toEqual(["t1"]);
  });

  it("w trakcie pobierania pokazuje stan wczytywania", () => {
    revisions.current = { items: [], loading: true };
    open();
    expect(screen.getByText("builder.templateHistory.loading")).toBeTruthy();
  });

  it("bez rewizji mówi to wprost", () => {
    open();
    expect(screen.getByText("builder.templateHistory.empty")).toBeTruthy();
  });

  it("najnowsza rewizja jest bieżąca i nie da się jej przywrócić", () => {
    revisions.current = {
      items: [
        rev("r3", "Hero v3", "2026-08-01T10:00:00.000Z"),
        rev("r2", "Hero v2", "2026-07-01T10:00:00.000Z"),
        rev("r1", "Hero v1", "2026-06-01T10:00:00.000Z"),
      ],
      loading: false,
    };
    open();
    expect(screen.getByText(/builder\.templateHistory\.current/)).toBeTruthy();
    // Trzy rewizje, numery liczone od najstarszej: 2 i 1 (bieżąca bez numeru).
    expect(screen.getByText(/builder\.templateHistory\.version\(n=2\)/)).toBeTruthy();
    expect(screen.getByText(/builder\.templateHistory\.version\(n=1\)/)).toBeTruthy();
    expect(screen.getAllByTitle("builder.templateHistory.insertTitle")).toHaveLength(3);
    // Przywracanie bieżącej do siebie samej tworzyłoby puste rewizje.
    expect(screen.getAllByTitle("builder.templateHistory.restoreTitle")).toHaveLength(2);
  });

  it("wstawienie i przywrócenie oddają WSKAZANĄ rewizję", () => {
    revisions.current = {
      items: [
        rev("r2", "Hero v2", "2026-07-01T10:00:00.000Z"),
        rev("r1", "Hero v1", "2026-06-01T10:00:00.000Z"),
      ],
      loading: false,
    };
    const onInsert = vi.fn();
    const onRestore = vi.fn();
    open({ onInsert, onRestore });
    fireEvent.click(screen.getAllByTitle("builder.templateHistory.insertTitle")[1]!);
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
    fireEvent.click(screen.getByTitle("builder.templateHistory.restoreTitle"));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  });

  it.fails("BŁĄD: niepoprawna data powinna być pokazana surowo", () => {
    // `fmt()` ma zabezpieczenie: `try { new Date(iso).toLocaleString(...) }
    // catch { return iso }`. Ta straż jest MARTWA - `toLocaleString` na
    // niepoprawnej dacie NIE rzuca, tylko zwraca napis "Invalid Date".
    // Data z bazy bywa nieparsowalna (import, migracja starych rewizji),
    // więc redakcja zobaczy "Invalid Date" zamiast czegokolwiek sensownego.
    // Poprawka jest jednolinijkowa (`Number.isNaN(d.getTime())`), ale to
    // zmiana produkcji - zostaje zgłoszona, nie wprowadzona.
    revisions.current = { items: [rev("r1", "Hero v1", "to nie jest data")], loading: false };
    open();
    expect(screen.getByText("to nie jest data")).toBeTruthy();
  });

  it("kontrola dodatnia: dziś dialog pokazuje w tym miejscu Invalid Date", () => {
    revisions.current = { items: [rev("r1", "Hero v1", "to nie jest data")], loading: false };
    open();
    // Zapis stanu faktycznego - żeby powyższy `it.fails` nie był jedynym
    // śladem i żeby naprawa produkcji od razu wywaliła TEN test.
    expect(screen.getByText("Invalid Date")).toBeTruthy();
  });
});

describe("WidgetLivePreview", () => {
  const widget = (type: WidgetNode["type"] = "text"): WidgetNode => ({
    id: "w1",
    kind: "widget",
    type,
    content: {},
  });

  it("domyślnie jest rozwinięty i pokazuje widok widgetu", () => {
    render(<WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />);
    expect(screen.getByTestId("widok-widgetu").textContent).toBe("text/pl");
  });

  it("zwinięcie zapamiętuje się w pamięci przeglądarki", () => {
    const { unmount } = render(
      <WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByTestId("widok-widgetu")).toBeNull();
    expect(window.localStorage.getItem("builder.widget-live-preview.open")).toBe("0");
    unmount();
    // Kolejne otwarcie panelu ma pamiętać wybór redaktora.
    render(<WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />);
    expect(screen.queryByTestId("widok-widgetu")).toBeNull();
  });

  it("zapisana zgoda przywraca podgląd rozwinięty", () => {
    window.localStorage.setItem("builder.widget-live-preview.open", "1");
    render(<WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />);
    expect(screen.getByTestId("widok-widgetu")).toBeTruthy();
  });

  it("wymuszony hover jest tylko dla widgetów, w których da się go pokazać", () => {
    const { unmount } = render(
      <WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />,
    );
    expect(screen.queryByText("builder.widgetProps.hoverPreview")).toBeNull();
    unmount();
    render(
      <WidgetLivePreview widget={widget("social-icons")} lang="pl" device="mobile" mode="light" />,
    );
    const toggle = screen.getByText("builder.widgetProps.hoverPreview").closest("button");
    if (!toggle) throw new Error("test: brak przełącznika hoveru");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("wymuszony hover znaczy scenę tym samym atrybutem co strona publiczna", () => {
    const { container } = render(
      <WidgetLivePreview widget={widget("social-icons")} lang="en" device="tablet" mode="dark" />,
    );
    fireEvent.click(screen.getByText("builder.widgetProps.hoverPreview"));
    const stage = container.querySelector<HTMLElement>(
      '[data-builder-renderer="widget-props-preview"]',
    );
    expect(stage?.getAttribute("data-device")).toBe("tablet");
    // Ta sama reguła CSS co `:hover` na froncie - podgląd nie może pokazywać
    // czegoś innego niż strona.
    expect(stage?.getAttributeNames().some((n) => n.includes("hover"))).toBe(true);
  });

  it("tryb ciemny maluje scenę ciemnym tłem", () => {
    const { container } = render(
      <WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="dark" />,
    );
    const stage = container.querySelector<HTMLElement>(
      '[data-builder-renderer="widget-props-preview"]',
    );
    expect(stage?.className).toContain("dark");
    expect(stage?.style.background).toContain("#01112F");
  });

  it("niedostępna pamięć przeglądarki nie psuje podglądu", () => {
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage zablokowany");
    });
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage zablokowany");
    });
    render(<WidgetLivePreview widget={widget()} lang="pl" device="desktop" mode="light" />);
    // Tryb prywatny blokuje `localStorage`. Zapamiętanie zwinięcia jest
    // wygodą, a nie warunkiem działania panelu.
    expect(screen.getByTestId("widok-widgetu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByTestId("widok-widgetu")).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("zwinięcie ukrywa też przełącznik hoveru", () => {
    render(
      <WidgetLivePreview widget={widget("social-icons")} lang="pl" device="desktop" mode="light" />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("builder.widgetProps.hoverPreview")).toBeNull();
  });
});
