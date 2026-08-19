// Historia wersji elementów buildera (`BuilderVersionsPane`, 0%).
//
// Panel składa trzy różne źródła (widgety globalne, popupy, szablony sekcji)
// w jeden ekran. Trzy rzeczy są tu warte testu:
//
//   1. DWIE CZYSTE FUNKCJE budujące dokument podglądu (`documentForSection`,
//      `documentForWidget`) — to one decydują, czy redaktor zobaczy wersję,
//      którą zaraz przywróci, czy pustą ramkę.
//   2. PRZEŁĄCZENIE ZAKŁADKI MUSI ZEROWAĆ WYBÓR. Zostawiony wybór elementu
//      z poprzedniej zakładki pokazywałby historię widgetu pod nazwą popupu.
//   3. ŚCIEŻKA PRZYWRACANIA ZALEŻY OD TYPU ELEMENTU — i właśnie tutaj siedzi
//      defekt opisany niżej.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  widgets: [] as Array<{ id: string; name: string }>,
  popups: [] as Array<{ id: string; name: string }>,
  templates: [] as Array<{ id: string; name: string }>,
  revisions: [] as unknown[],
  templateRevisions: [] as unknown[],
  restoreEntityTypes: [] as string[],
  restoreMutate: null as unknown,
  toast: null as unknown,
}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

// Renderer buildera ma własne, obszerne testy - tutaj interesuje nas WYŁĄCZNIE
// to, JAKI dokument do niego trafia.
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc }: { doc: unknown }) => (
    <div data-testid="preview">{JSON.stringify(doc)}</div>
  ),
}));

vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/globalWidgets")>();
  return { ...actual, useGlobalWidgets: () => ({ items: h.widgets }) };
});
vi.mock("@/lib/builder/popups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/popups")>();
  return { ...actual, usePopupsAdmin: () => ({ items: h.popups }) };
});
vi.mock("@/lib/builder/templates", () => ({
  useSectionTemplates: () => ({ items: h.templates }),
  useTemplateRevisions: () => ({ items: h.templateRevisions }),
}));

vi.mock("@/lib/builder/revisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/revisions")>();
  const { vi: v } = await import("vitest");
  h.restoreMutate = v.fn(async () => undefined);
  return {
    ...actual,
    useBuilderRevisions: () => ({ data: h.revisions }),
    // Zapisujemy, Z JAKIM typem encji panel tworzy mutację przywracania -
    // to jest sedno testu-świadka niżej.
    useRestoreBuilderRevision: (entityType: string) => {
      h.restoreEntityTypes.push(entityType);
      return { mutateAsync: h.restoreMutate, isPending: false };
    },
  };
});

import {
  BuilderVersionsPane,
  documentForSection,
  documentForWidget,
} from "@/components/admin/versions/organisms/BuilderVersionsPane";

type Mock = ReturnType<typeof vi.fn>;
const toast = () => h.toast as Record<string, Mock>;
const restoreMutate = () => h.restoreMutate as Mock;

beforeEach(() => {
  h.widgets = [{ id: "w1", name: "Stopka newslettera" }];
  h.popups = [{ id: "p1", name: "Popup zapisu" }];
  h.templates = [{ id: "t1", name: "Szablon hero" }];
  h.revisions = [];
  h.templateRevisions = [];
  h.restoreEntityTypes = [];
  restoreMutate().mockReset();
  restoreMutate().mockResolvedValue(undefined);
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Czyste funkcje budujące dokument podglądu
// ---------------------------------------------------------------------------

describe("documentForSection", () => {
  it("owija sekcję w kompletny dokument buildera", () => {
    // Sekcja sama w sobie nie jest dokumentem - renderer wymaga `version`
    // i tablicy `sections`, inaczej podgląd wersji zostaje pusty.
    const section = { id: "s1", kind: "section", children: [] } as never;
    const doc = documentForSection(section);
    expect(doc.version).toBe(1);
    expect(doc.sections).toEqual([section]);
  });
});

describe("documentForWidget", () => {
  it("buduje dokument z JEDNYM widgetem w sekcji i kolumnie", () => {
    // Widget globalny nie ma własnej sekcji ani kolumny - bez tego rusztowania
    // renderer nie ma czego wyświetlić.
    const doc = documentForWidget({ type: "heading", content: { text_pl: "Nagłówek" } });

    expect(doc.version).toBe(1);
    expect(doc.sections).toHaveLength(1);
    const column = doc.sections[0].children[0] as unknown as { children: unknown[] };
    expect(column.children).toHaveLength(1);
    expect(column.children[0]).toMatchObject({ kind: "widget", type: "heading" });
  });

  it("kolumna zajmuje pełną szerokość (podgląd nie ma być ścieśniony)", () => {
    const doc = documentForWidget({ type: "heading" });
    expect(doc.sections[0].children[0]).toMatchObject({ span: 12 });
  });

  it("nadaje ŚWIEŻE identyfikatory przy każdym wywołaniu", () => {
    // Powtórzone id w dokumencie podglądu myliłoby React-a przy przełączaniu
    // wersji (dwa węzły o tym samym kluczu).
    const a = documentForWidget({ type: "heading" });
    const b = documentForWidget({ type: "heading" });
    expect(a.sections[0].id).not.toBe(b.sections[0].id);
  });

  it("przenosi style i ustawienia zaawansowane widgetu", () => {
    const doc = documentForWidget({
      type: "heading",
      content: { text_pl: "x" },
      style: { align: "center" },
      advanced: { anchor: "top" },
    });
    const column = doc.sections[0].children[0] as unknown as {
      children: Record<string, unknown>[];
    };
    expect(column.children[0]).toMatchObject({
      style: { align: "center" },
      advanced: { anchor: "top" },
    });
  });
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

describe("BuilderVersionsPane - wybór elementu", () => {
  it("startuje na widgetach globalnych i wybiera pierwszy element", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.getByText("Stopka newslettera")).toBeInTheDocument();
  });

  it("przełączenie zakładki pokazuje elementy TEGO typu", () => {
    // Zostawiony wybór z poprzedniej zakładki pokazywałby historię widgetu
    // pod nazwą popupu.
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Popupy"));

    expect(screen.getByText("Popup zapisu")).toBeInTheDocument();
    expect(screen.queryByText("Stopka newslettera")).toBeNull();
  });

  it("zakładka szablonów sekcji czyta własne źródło", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Szablony sekcji"));
    expect(screen.getByText("Szablon hero")).toBeInTheDocument();
  });

  it("brak elementów mówi wprost, zamiast zostawić pustą listę", () => {
    h.widgets = [];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.getByText("Brak elementów")).toBeInTheDocument();
  });

  it("brak zapisanych wersji też jest nazwany", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.getByText("Brak zapisanych wersji")).toBeInTheDocument();
  });

  it("interfejs jest dwujęzyczny", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="en" />);
    expect(screen.getByText("Global widgets")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("No saved versions")).toBeInTheDocument();
  });
});

describe("BuilderVersionsPane - podgląd wersji", () => {
  const widgetRevision = {
    id: "rev-1",
    entity_type: "global_widget",
    entity_id: "w1",
    name: "Wersja 1",
    data: { type: "heading", content: { text_pl: "Nagłówek" } },
    note: null,
    created_by: null,
    created_at: "2026-08-18T10:00:00.000Z",
  };

  it("bez wybranej wersji zachęca do wyboru, zamiast pokazywać pustkę", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.getByText("Wybierz wersję, aby zobaczyć podgląd.")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("wybór wersji widgetu renderuje dokument zbudowany z jej migawki", () => {
    h.revisions = [widgetRevision];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Wersja 1"));

    const preview = screen.getByTestId("preview");
    expect(preview.textContent).toContain('"type":"heading"');
    expect(preview.textContent).toContain("Nagłówek");
  });

  it("wersja o USZKODZONEJ migawce nie renderuje podglądu, tylko zachętę", () => {
    // `parseGlobalWidgetRevision` odrzuca payload nieznanego kształtu -
    // podgląd „czegokolwiek" byłby gorszy niż jego brak.
    h.revisions = [{ ...widgetRevision, data: { nie: "widget" } }];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);

    fireEvent.click(screen.getByText("Wersja 1"));

    expect(screen.queryByTestId("preview")).toBeNull();
    expect(screen.getByText("Wybierz wersję, aby zobaczyć podgląd.")).toBeInTheDocument();
  });

  it("data wersji jest sformatowana wg języka panelu", () => {
    h.revisions = [widgetRevision];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    // Polski format: dzień miesiąc rok, bez AM/PM.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/AM|PM/)).toBeNull();
  });

  it("zła data nie wysypuje listy - wraca surowy ISO", () => {
    h.revisions = [{ ...widgetRevision, created_at: "nie-data" }];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.getByText("nie-data")).toBeInTheDocument();
  });
});

describe("BuilderVersionsPane - przywracanie", () => {
  const widgetRevision = {
    id: "rev-1",
    entity_type: "global_widget",
    entity_id: "w1",
    name: "Wersja 1",
    data: { type: "heading", content: {} },
    note: null,
    created_by: null,
    created_at: "2026-08-18T10:00:00.000Z",
  };

  it("przycisk przywracania pojawia się DOPIERO po wybraniu wersji", () => {
    h.revisions = [widgetRevision];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    expect(screen.queryByText("Przywróć tę wersję")).toBeNull();

    fireEvent.click(screen.getByText("Wersja 1"));

    expect(screen.getByText("Przywróć tę wersję")).toBeInTheDocument();
  });

  it("przywrócenie melduje sukces", async () => {
    h.revisions = [widgetRevision];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Wersja 1"));

    fireEvent.click(screen.getByText("Przywróć tę wersję"));

    await waitFor(() => expect(restoreMutate()).toHaveBeenCalledWith(widgetRevision));
    await waitFor(() => expect(toast().success).toHaveBeenCalledWith("Przywrócono wersję"));
  });

  it("nieudane przywrócenie pokazuje BŁĄD, nie sukces", async () => {
    h.revisions = [widgetRevision];
    restoreMutate().mockRejectedValue(new Error("invalid_revision_payload"));
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Wersja 1"));

    fireEvent.click(screen.getByText("Przywróć tę wersję"));

    await waitFor(() => expect(toast().error).toHaveBeenCalledWith("Nie udało się przywrócić"));
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("zakładka szablonów NIE pokazuje przycisku przywracania", () => {
    // Szablony mają własny mechanizm wersjonowania; przycisk buderowy
    // działałby tu na niewłaściwej tabeli.
    h.templateRevisions = [
      { id: "tr-1", name: "Szablon v1", created_at: "2026-08-18T10:00:00.000Z", data: {} },
    ];
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    fireEvent.click(screen.getByText("Szablony sekcji"));

    fireEvent.click(screen.getByText("Szablon v1"));

    expect(screen.queryByText("Przywróć tę wersję")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // ŚWIADEK DEFEKTU: przywracanie wersji POPUPU idzie ścieżką WIDGETU.
  //
  // `BuilderVersionsPane.tsx:97` tworzy mutację jako
  //     useRestoreBuilderRevision(tab === "template" ? "global_widget" : "global_widget")
  // — OBA RAMIONA ternarnego są identyczne, więc dla zakładki „Popupy" typ
  // encji też wychodzi `global_widget`.
  //
  // Skutek dla użytkownika: `useRestoreBuilderRevision` wybiera po tym typie
  // ZARÓWNO parser, JAK I tabelę. Migawka popupu ma kształt
  // `{builder_data, settings}`, którego `parseGlobalWidgetRevision` nie
  // rozpoznaje (brak klucza `type`), więc mutacja rzuca
  // „invalid_revision_payload" ZANIM cokolwiek zapisze. Przywracanie wersji
  // popupu jest więc MARTWE: redaktor za każdym razem dostaje „Nie udało się
  // przywrócić", niezależnie od tego, którą wersję wybierze.
  //
  // Ten test opisuje stan OBECNY. Naprawa idzie osobnym commitem.
  // -------------------------------------------------------------------------
  it("DEFEKT: zakładka popupów tworzy mutację z typem `global_widget`", () => {
    renderWithQueryClient(<BuilderVersionsPane lang="pl" />);
    h.restoreEntityTypes = [];

    fireEvent.click(screen.getByText("Popupy"));

    // Docelowo w tej tablicy ma się pojawić "popup".
    expect(h.restoreEntityTypes.length).toBeGreaterThan(0);
    expect(new Set(h.restoreEntityTypes)).toEqual(new Set(["global_widget"]));
  });
});
