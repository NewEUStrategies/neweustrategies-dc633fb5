// POWŁOKA buildera (`Builder.tsx`): układ dwupanelowy, przełączanie panelu
// właściwości, historia, menu kontekstowe, potwierdzenia usuwania i akcje
// zbiorcze.
//
// Ten plik NIE symuluje przeciągania po kanwie - kanwa ma własne testy
// (`ui/organisms/builder/__tests__`), a tu jest atrapą, która wystawia swoje
// wywołania zwrotne. Powłoka to warstwa DECYZJI: co pokazać w lewym panelu,
// co zrobić z prawym kliknięciem, kiedy zapytać o potwierdzenie i jak jedna
// operacja zbiorcza ma wylądować w JEDNYM kroku historii.
//
// Cztery reguły, które ten test przypina, bo każda z nich już kiedyś była
// źródłem zgłoszenia:
//  1. Panel po lewej pokazuje właściwości ZAZNACZONEGO węzła, a bez
//     zaznaczenia - bibliotekę widgetów. Pomyłka tutaj to edycja nie tego
//     elementu, co redaktor kliknął.
//  2. Cofanie/ponawianie musi najpierw ZGASIĆ żywą typografię, bo wstrzyknięty
//     arkusz przykrywa przywrócone wartości i cofnięcie wygląda jak brak
//     reakcji.
//  3. Usuwanie zawsze przechodzi przez potwierdzenie, a po usunięciu
//     zaznaczenie wraca do pustego (panel nie może wisieć nad nieistniejącym
//     węzłem).
//  4. Operacja zbiorcza to JEDEN krok historii - inaczej cofnięcie
//     zduplikowania dziesięciu widgetów wymagałoby dziesięciu Ctrl+Z.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { BuilderDocument, ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import type { VisualCanvas } from "../ui/organisms/builder";
import { Builder } from "../Builder";

type CanvasProps = ComponentProps<typeof VisualCanvas>;

const canvas = vi.hoisted(() => ({ props: null as unknown }));
const typography = vi.hoisted(() => ({ cleared: 0 }));
const toasts = vi.hoisted(() => ({ messages: [] as string[] }));
const clipboard = vi.hoisted(() => ({ value: null as unknown }));
const theme = vi.hoisted(() => ({ value: "light" }));
const prompts = vi.hoisted(() => ({ answer: null as string | null }));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("sonner", () => ({
  toast: Object.assign(
    (m: string) => {
      toasts.messages.push(m);
    },
    {
      success: (m: string) => toasts.messages.push(m),
      error: (m: string) => toasts.messages.push(m),
    },
  ),
}));
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useNavigate: () => () => undefined };
});
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: theme.value }) }));
vi.mock("@/lib/appDialogs", () => ({
  promptDialog: async () => prompts.answer,
  confirmDialog: async () => true,
  alertDialog: async () => undefined,
}));
vi.mock("@/components/Header", () => ({ Header: () => <div data-testid="naglowek-strony" /> }));
vi.mock("@/components/Footer", () => ({ Footer: () => <div data-testid="stopka-strony" /> }));
vi.mock("@/lib/builder/liveTypography", () => ({
  clearAllLiveWidgetTypography: () => {
    typography.cleared += 1;
  },
}));
vi.mock("@/lib/builder/clipboard", () => ({
  // Schowek buildera siedzi w `localStorage` - tu jest sterowany z testu,
  // bo od jego zawartości zależy dostępność wklejania w menu.
  readClipboard: () => clipboard.value,
  copyToClipboard: (env: unknown) => {
    clipboard.value = env;
  },
}));
// Warstwa danych: powłoka nie odpytuje bazy sama, ale operacje (szablony,
// widgety globalne) importują klienta Supabase, który bez zmiennych
// środowiskowych rzuca już przy imporcie.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("test: powłoka nie powinna sięgać do bazy");
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => undefined,
    }),
    removeChannel: () => undefined,
  },
}));
vi.mock("../ui/hooks/useGlobalWidgetSync", () => ({ useGlobalWidgetSync: () => undefined }));
// Trzy listy z bazy, po które sięgają operacje: szablony sekcji, widgety
// globalne i eksperymenty A/B. Powłoka ich nie wyświetla (biblioteka widgetów
// jest atrapą), a każda z nich ciągnęłaby zapytania do Supabase.
vi.mock("@/lib/builder/templates", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSectionTemplates: () => ({
      items: [],
      loading: false,
      save: async () => "t-nowy",
      remove: vi.fn(),
      reload: vi.fn(),
    }),
  };
});
vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGlobalWidgets: () => ({
      items: [],
      loading: false,
      save: async () => "g-nowy",
      remove: vi.fn(),
      reload: vi.fn(),
    }),
  };
});
vi.mock("@/lib/builder/experiments", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useExperimentsAdmin: () => ({
      items: [],
      loading: false,
      create: async () => "e-nowy",
      setStatus: async () => undefined,
      reload: vi.fn(),
    }),
  };
});
vi.mock("@/lib/onboarding/useOnboardingTour", () => ({
  useOnboardingTour: () => ({ active: false, step: 0, next: () => {}, close: () => {} }),
}));
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({
  CoachmarkTour: () => null,
}));
// Panele właściwości mają własne (obszerne) testy - tu liczy się WYBÓR panelu.
vi.mock("../WidgetProperties", () => ({
  WidgetProperties: ({
    widget,
    onChange,
  }: {
    widget: WidgetNode;
    onChange: (mut: (w: WidgetNode) => void) => void;
  }) => (
    <div data-testid="panel-widgetu">
      {widget.id}
      <button
        type="button"
        data-testid="zapis-z-panelu-widgetu"
        onClick={() =>
          onChange((w) => {
            w.content = { ...w.content, html_pl: "z panelu" };
          })
        }
      />
    </div>
  ),
}));
vi.mock("../SectionProperties", () => ({
  SectionProperties: ({ onChange }: { onChange: (mut: (s: SectionNode) => void) => void }) => (
    <div data-testid="panel-sekcji">
      <button
        type="button"
        data-testid="zapis-z-panelu-sekcji"
        onClick={() =>
          onChange((sec) => {
            sec.layout = { ...(sec.layout ?? {}), marginTop: 24 };
          })
        }
      />
    </div>
  ),
}));
vi.mock("../ColumnProperties", () => ({
  ColumnProperties: ({ onChange }: { onChange: (mut: (c: ColumnNode) => void) => void }) => (
    <div data-testid="panel-kolumny">
      <button
        type="button"
        data-testid="zapis-z-panelu-kolumny"
        onClick={() =>
          onChange((col) => {
            col.span = { ...(col.span ?? {}), desktop: 6 };
          })
        }
      />
    </div>
  ),
}));
vi.mock("../WidgetLibrary", () => ({
  WidgetLibrary: ({ onPickWidget }: { onPickWidget: (t: string) => void }) => (
    <div data-testid="biblioteka">
      <button type="button" data-testid="dodaj-naglowek" onClick={() => onPickWidget("heading")} />
    </div>
  ),
}));
vi.mock("../Navigator", () => ({ Navigator: () => <div data-testid="nawigator" /> }));
vi.mock("../ui/organisms/InlineSizeToolbar", () => ({ InlineSizeToolbar: () => null }));
// Kanwa: atrapa wystawiająca swoje propsy i minimalny DOM do prawego klikania.
vi.mock("../ui/organisms/builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/organisms/builder")>();
  return {
    ...actual,
    VisualCanvas: (props: CanvasProps) => {
      canvas.props = props;
      return (
        <div data-testid="kanwa">
          {props.doc.sections.map((s) => (
            <div key={s.id} data-sec-id={s.id}>
              {(s.children ?? []).map((child) =>
                child.kind === "column" ? (
                  <div key={child.id} data-col-id={child.id}>
                    {(child.children ?? []).map((w) =>
                      w.kind === "widget" ? (
                        <div key={w.id} data-widget-id={w.id}>
                          {w.id}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div key={child.id} data-inner-id={child.id} />
                ),
              )}
            </div>
          ))}
        </div>
      );
    },
  };
});

const canvasProps = (): CanvasProps => {
  if (!canvas.props) throw new Error("test: kanwa jeszcze nie wyrenderowana");
  return canvas.props as CanvasProps;
};

const wgt = (id: string, type: WidgetNode["type"] = "text"): WidgetNode => ({
  id,
  kind: "widget",
  type,
  content: {},
});

function docOf(): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          { id: "c1", kind: "column", span: { desktop: 12 }, children: [wgt("w1"), wgt("w2")] },
        ],
      },
      {
        id: "s2",
        kind: "section",
        children: [{ id: "i1", kind: "inner-section", columns: [] }],
      },
    ],
  };
}

function mount(over: Omit<Partial<ComponentProps<typeof Builder>>, "onChange"> = {}) {
  const onChange = vi.fn<(v: BuilderDocument) => void>();
  const onLangChange = vi.fn();
  // Panele i operacje czytają dane przez react-query (szablony, widgety
  // globalne), więc powłoka bez dostawcy klienta rzuca od razu.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (value: BuilderDocument | null) => (
    <QueryClientProvider client={client}>
      <Builder
        value={value}
        onChange={onChange}
        lang="pl"
        onLangChange={onLangChange}
        hideChrome={over.hideChrome}
        scope={over.scope}
      />
    </QueryClientProvider>
  );
  const view = render(tree(over.value === undefined ? docOf() : over.value));
  const last = (): BuilderDocument | null =>
    (onChange.mock.calls.at(-1)?.[0] as BuilderDocument | undefined) ?? null;
  return {
    ...view,
    onChange,
    onLangChange,
    last,
    rerenderWith: (v: BuilderDocument) => view.rerender(tree(v)),
  };
}

/** Węzeł kanwy - do prawego kliknięcia (menu kontekstowe czyta z DOM). */
const node = (attr: string, id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[${attr}="${id}"]`);
  if (!found) throw new Error(`test: brak elementu [${attr}="${id}"]`);
  return found;
};

const widgetIds = (doc: BuilderDocument | null): string[] => {
  const ids: string[] = [];
  for (const s of doc?.sections ?? []) {
    for (const child of s.children ?? []) {
      if (child.kind !== "column") continue;
      for (const w of child.children ?? []) if (w.kind === "widget") ids.push(w.id);
    }
  }
  return ids;
};

beforeEach(() => {
  canvas.props = null;
  typography.cleared = 0;
  toasts.messages = [];
  clipboard.value = null;
  theme.value = "light";
  prompts.answer = null;
});

describe("Builder - lewy panel", () => {
  it("bez zaznaczenia pokazuje bibliotekę widgetów", () => {
    mount();
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
    expect(screen.queryByTestId("panel-widgetu")).toBeNull();
  });

  it.each([
    ["widget", { kind: "widget", id: "w1" }, "panel-widgetu"],
    ["kolumna", { kind: "column", id: "c1" }, "panel-kolumny"],
    ["sekcja", { kind: "section", id: "s1" }, "panel-sekcji"],
  ] as const)("zaznaczony %s otwiera swój panel", (_label, selection, testId) => {
    mount();
    act(() => canvasProps().setSelection(selection));
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.queryByTestId("biblioteka")).toBeNull();
  });

  it("sekcja wewnętrzna nie ma panelu, tylko podpowiedź", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "inner-section", id: "i1" }));
    // Sekcja wewnętrzna kontenera nie ma jeszcze własnych właściwości -
    // panel musi to powiedzieć, a nie pokazać pustkę.
    expect(screen.queryByTestId("panel-sekcji")).toBeNull();
    expect(screen.getByText("builder.chrome.innerSectionHint")).toBeTruthy();
  });

  it("zamknięcie panelu wraca do biblioteki", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.click(screen.getByTitle("builder.chrome.close"));
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
  });

  it("zwinięcie panelu zostawia tylko pionowy pasek", () => {
    mount();
    fireEvent.click(screen.getByTitle("builder.chrome.collapsePanel"));
    expect(screen.queryByTestId("biblioteka")).toBeNull();
    fireEvent.click(screen.getByTitle("builder.chrome.expandPanel"));
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
  });

  it("nawigator jest domyślnie schowany i rozwija się przyciskiem", () => {
    mount();
    expect(screen.queryByTestId("nawigator")).toBeNull();
    fireEvent.click(screen.getByText("Nawigator"));
    expect(screen.getByTestId("nawigator")).toBeTruthy();
  });

  it("wybór widgetu z biblioteki dopisuje go do dokumentu", () => {
    const { last } = mount();
    fireEvent.click(screen.getByTestId("dodaj-naglowek"));
    expect(widgetIds(last()).length).toBe(3);
  });
});

describe("Builder - historia", () => {
  it("cofnięcie gasi żywą typografię i mówi o tym redaktorowi", () => {
    const { last } = mount();
    fireEvent.click(screen.getByTestId("dodaj-naglowek"));
    expect(widgetIds(last()).length).toBe(3);
    fireEvent.click(screen.getAllByTitle("builder.chrome.undoTitle")[0]!);
    // Wstrzyknięty arkusz żywej typografii przykrywa przywrócone wartości -
    // bez zgaszenia cofnięcie wygląda jak brak reakcji.
    expect(typography.cleared).toBe(1);
    expect(widgetIds(last()).length).toBe(2);
    expect(toasts.messages.length).toBe(1);
  });

  it("ponowienie przywraca zmianę", () => {
    const { last } = mount();
    fireEvent.click(screen.getByTestId("dodaj-naglowek"));
    fireEvent.click(screen.getAllByTitle("builder.chrome.undoTitle")[0]!);
    fireEvent.click(screen.getAllByTitle("builder.chrome.redoTitle")[0]!);
    expect(widgetIds(last()).length).toBe(3);
    expect(typography.cleared).toBe(2);
  });

  it("bez historii cofanie i ponawianie są wyłączone", () => {
    mount();
    expect(screen.getAllByTitle("builder.chrome.undoTitle")[0]!).toBeDisabled();
    expect(screen.getAllByTitle("builder.chrome.redoTitle")[0]!).toBeDisabled();
  });
});

describe("Builder - usuwanie za potwierdzeniem", () => {
  it("usunięcie widgetu pyta, usuwa i czyści zaznaczenie", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.click(screen.getByTitle("builder.chrome.deleteSelTitle"));
    expect(screen.getByText("builder.confirmDelete.widgetTitle")).toBeTruthy();
    fireEvent.click(screen.getByText("builder.common.delete"));
    expect(widgetIds(last())).toEqual(["w2"]);
    // Panel nie może wisieć nad usuniętym węzłem.
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
  });

  it("anulowanie zostawia dokument bez zmian", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.click(screen.getByTitle("builder.chrome.deleteSelTitle"));
    fireEvent.click(screen.getByText("builder.common.cancel"));
    expect(last()).toBeNull();
    expect(screen.queryByText("builder.confirmDelete.widgetTitle")).toBeNull();
  });

  it.each([
    ["sekcja", { kind: "section", id: "s1" }, "builder.confirmDelete.sectionTitle"],
    ["kolumna", { kind: "column", id: "c1" }, "builder.confirmDelete.columnTitle"],
  ] as const)("usunięcie %s ma własne pytanie", (_label, selection, title) => {
    mount();
    act(() => canvasProps().setSelection(selection));
    fireEvent.click(screen.getByTitle("builder.chrome.deleteSelTitle"));
    expect(screen.getByText(title)).toBeTruthy();
  });
});

describe("Builder - menu kontekstowe", () => {
  function openMenu(attr: string, id: string) {
    fireEvent.contextMenu(node(attr, id), { clientX: 40, clientY: 60 });
  }

  it.each([
    ["widget", "data-widget-id", "w1", "builder.contextMenu.kindWidget"],
    ["kolumna", "data-col-id", "c1", "builder.contextMenu.kindColumn"],
    ["sekcja", "data-sec-id", "s2", "builder.contextMenu.kindSection"],
  ] as const)("prawy klik w %s zaznacza go i otwiera menu", (_l, attr, id, heading) => {
    mount();
    openMenu(attr, id);
    expect(screen.getByText(heading)).toBeTruthy();
  });

  it("prawy klik w tło daje menu pustego miejsca", () => {
    mount();
    fireEvent.contextMenu(screen.getByTestId("kanwa"), { clientX: 10, clientY: 10 });
    expect(screen.getByText("builder.contextMenu.kindArea")).toBeTruthy();
  });

  it("zduplikowanie widgetu z menu dopisuje kopię", () => {
    const { last } = mount();
    openMenu("data-widget-id", "w1");
    fireEvent.click(screen.getByText("builder.contextMenu.duplicate"));
    expect(widgetIds(last()).length).toBe(3);
  });

  it("ukrycie sekcji z menu zapisuje ukrycie dla urządzenia", () => {
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.hideOnDevice"));
    expect(last()?.sections[0]?.advanced?.hideOn?.desktop).toBe(true);
  });

  it("wklejanie jest dostępne tylko ze schowkiem", () => {
    clipboard.value = null;
    const bez = mount();
    fireEvent.contextMenu(screen.getByTestId("kanwa"), { clientX: 10, clientY: 10 });
    expect(screen.getByText("builder.contextMenu.paste").closest("button")).toBeDisabled();
    bez.unmount();
    clipboard.value = { kind: "widget", node: wgt("wx") };
    mount();
    fireEvent.contextMenu(screen.getByTestId("kanwa"), { clientX: 10, clientY: 10 });
    expect(screen.getByText("builder.contextMenu.paste").closest("button")).not.toBeDisabled();
  });
});

describe("Builder - zaznaczenie zbiorcze", () => {
  it("pasek akcji zbiorczych pokazuje liczbę zaznaczonych", () => {
    mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1", "w2"]), "replace"));
    const bar = screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" });
    expect(bar.textContent).toContain("2");
  });

  it("tryb dokładania sumuje zbiory, a przełączanie wyrzuca powtórzone", () => {
    mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1"]), "replace"));
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w2"]), "add"));
    expect(
      screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" }).textContent,
    ).toContain("2");
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w2"]), "toggle"));
    expect(
      screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" }).textContent,
    ).toContain("1");
  });

  it("zduplikowanie zbiorcze to JEDEN krok historii", () => {
    const { last } = mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1", "w2"]), "replace"));
    fireEvent.click(screen.getByTitle("builder.bulk.duplicateTitle"));
    expect(widgetIds(last()).length).toBe(4);
    // Jedno cofnięcie musi zdjąć całą operację.
    fireEvent.click(screen.getAllByTitle("builder.chrome.undoTitle")[0]!);
    expect(widgetIds(last()).length).toBe(2);
  });

  it("usunięcie zbiorcze pyta raz i usuwa wszystkie", () => {
    const { last } = mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1", "w2"]), "replace"));
    fireEvent.click(screen.getByTitle("builder.bulk.deleteTitle"));
    // Ten sam napis nosi przycisk w pasku zbiorczym i w oknie potwierdzenia -
    // klikamy ten z okna (`alertdialog`).
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("builder.common.delete"));
    expect(widgetIds(last())).toEqual([]);
    expect(screen.queryByRole("toolbar", { name: "builder.bulk.ariaSelected" })).toBeNull();
  });

  it("wyczyszczenie zbioru schowa pasek", () => {
    mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1"]), "replace"));
    fireEvent.click(screen.getByTitle("builder.bulk.deselectTitle"));
    expect(screen.queryByRole("toolbar", { name: "builder.bulk.ariaSelected" })).toBeNull();
  });

  it("zbiór traci widgety, których już nie ma w dokumencie", () => {
    const { rerenderWith } = mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1", "w2"]), "replace"));
    rerenderWith({ version: 1, sections: [{ id: "s1", kind: "section", children: [] }] });
    // Cofnięcie albo usunięcie zbiorcze zostawiałoby w zbiorze duchy, a pasek
    // liczyłby węzły, których nie da się już ruszyć.
    expect(screen.queryByRole("toolbar", { name: "builder.bulk.ariaSelected" })).toBeNull();
  });
});

describe("Builder - zakres edytora i ramki podglądu", () => {
  it("dla strony pokazuje ramki nagłówka i stopki", () => {
    mount();
    expect(screen.getByTestId("naglowek-strony")).toBeTruthy();
    expect(screen.getByTestId("stopka-strony")).toBeTruthy();
  });

  it("ukrycie chrome zdejmuje ramki", () => {
    mount({ hideChrome: true });
    expect(screen.queryByTestId("naglowek-strony")).toBeNull();
  });

  it.each([
    ["nagłówek", "header", "builder.chrome.scopeHeader"],
    ["stopka", "footer", "builder.chrome.scopeFooter"],
    ["wyskakujące okno", "popup", "builder.chrome.scopePopup"],
    ["menu", "menu", "builder.chrome.scopeMenu"],
  ] as const)("zakres %s ma własny pasek informacyjny", (_l, scope, key) => {
    mount({ scope });
    expect(screen.getByText(new RegExp(key.replace(/\./g, "\\.")))).toBeTruthy();
    // Poza stroną nie ma podglądu chrome - nagłówek strony byłby myląc: to
    // właśnie jego się edytuje.
    expect(screen.queryByTestId("naglowek-strony")).toBeNull();
  });

  it("pusty dokument dostaje stan pusty z tekstem zakresu", () => {
    mount({ value: { version: 1, sections: [] } });
    expect(screen.getByText("builder.scope.page.title")).toBeTruthy();
    expect(screen.getByText("builder.chrome.loadHomeLayout")).toBeTruthy();
  });

  it("poza stroną nie ma skrótu do układu strony głównej", () => {
    mount({ value: { version: 1, sections: [] }, scope: "footer" });
    expect(screen.getByText("builder.scope.footer.title")).toBeTruthy();
    expect(screen.queryByText("builder.chrome.loadHomeLayout")).toBeNull();
  });

  it("brak dokumentu startuje od pustego, a nie od wyjątku", () => {
    mount({ value: null });
    expect(screen.getByTestId("kanwa")).toBeTruthy();
    expect(screen.getByText("builder.scope.page.title")).toBeTruthy();
  });
});

describe("Builder - wiring kanwy", () => {
  it("edycja treści w miejscu zapisuje pole widgetu", () => {
    const { last } = mount();
    act(() => canvasProps().onWidgetContentChange?.("w1", "html_pl", "nowa treść"));
    const w = last()?.sections[0]?.children[0];
    expect(w && w.kind === "column" && w.children[0]?.content.html_pl).toBe("nowa treść");
  });

  it("zmiana rozmiaru zapisuje wysokość PER urządzenie i nie gubi poprzedniej", () => {
    const { last } = mount();
    act(() => canvasProps().onWidgetResize?.("w1", 320, "desktop"));
    act(() => canvasProps().onWidgetResize?.("w1", 180, "mobile"));
    const col = last()?.sections[0]?.children[0];
    const advanced = col && col.kind === "column" ? col.children[0]?.advanced : undefined;
    expect(advanced?.height).toEqual({ desktop: 320, mobile: 180 });
  });

  it("etykiety stref wstawiania idą z zakresu edytora", () => {
    mount({ scope: "header" });
    expect(canvasProps().firstLabel).toBe("builder.scope.header.first");
    expect(canvasProps().lastLabel).toBe("builder.scope.header.last");
  });

  it("zmiana urządzenia w pasku narzędzi jedzie do kanwy", () => {
    mount();
    fireEvent.click(screen.getByTitle("mobile"));
    expect(canvasProps().device).toBe("mobile");
  });
});

describe("Builder - zapis z paneli i skróty klawiszowe", () => {
  const firstColumn = (doc: BuilderDocument | null): ColumnNode | null => {
    const child = doc?.sections[0]?.children[0];
    return child && child.kind === "column" ? child : null;
  };

  it("zapis z panelu widgetu trafia w ten sam widget", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w2" }));
    fireEvent.click(screen.getByTestId("zapis-z-panelu-widgetu"));
    expect(firstColumn(last())?.children[1]?.content.html_pl).toBe("z panelu");
    expect(firstColumn(last())?.children[0]?.content.html_pl).toBeUndefined();
  });

  it("zapis z panelu sekcji trafia w sekcję", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "section", id: "s1" }));
    fireEvent.click(screen.getByTestId("zapis-z-panelu-sekcji"));
    expect(last()?.sections[0]?.layout?.marginTop).toBe(24);
  });

  it("zapis z panelu kolumny trafia w kolumnę", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "column", id: "c1" }));
    fireEvent.click(screen.getByTestId("zapis-z-panelu-kolumny"));
    expect(firstColumn(last())?.span?.desktop).toBe(6);
  });

  it("powrót strzałką w nagłówku panelu wraca do biblioteki", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.click(screen.getByText("builder.chrome.widgets"));
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
  });

  it("zwinięcie panelu działa też przy otwartych właściwościach", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.click(screen.getByTitle("builder.chrome.collapsePanel"));
    expect(screen.queryByTestId("panel-widgetu")).toBeNull();
    expect(screen.getByTitle("builder.chrome.expandPanel")).toBeTruthy();
  });

  it("Ctrl+Z bez historii nie woła cofania na próżno", () => {
    mount();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    // Straż `canUndo` chroni przed komunikatem „cofnięto" bez zmiany.
    expect(typography.cleared).toBe(0);
    expect(toasts.messages).toEqual([]);
  });

  it("Ctrl+Y bez historii nie woła ponawiania", () => {
    mount();
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(toasts.messages).toEqual([]);
  });

  it("Ctrl+X bez zaznaczenia nic nie wycina", () => {
    const { last } = mount();
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(last()).toBeNull();
  });

  it("Ctrl+X z zaznaczonym widgetem pyta o usunięcie", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "w1" }));
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    // Wycięcie to kopia PLUS usunięcie - a usunięcie zawsze przez pytanie.
    expect(screen.getByText("builder.confirmDelete.widgetTitle")).toBeTruthy();
  });

  it("Ctrl+Shift+N przełącza nawigator", () => {
    mount();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("nawigator")).toBeTruthy();
  });

  it("kopiowanie zbiorcze duplikuje zaznaczone widgety", () => {
    const { last } = mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1"]), "replace"));
    fireEvent.click(screen.getByTitle("builder.bulk.copyTitle"));
    // Schowak niesie JEDEN węzeł, więc kopia zbiorcza działa jak duplikowanie
    // na miejscu - i tak wygląda wynik wklejenia.
    expect(widgetIds(last()).length).toBe(3);
  });
});

describe("Builder - działania menu kontekstowego", () => {
  function openMenu(attr: string, id: string) {
    fireEvent.contextMenu(node(attr, id), { clientX: 40, clientY: 60 });
  }

  it("prawy klik w sekcję wewnętrzną otwiera jej menu", () => {
    mount();
    openMenu("data-inner-id", "i1");
    expect(screen.getByText("builder.contextMenu.kindInnerSection")).toBeTruthy();
    fireEvent.click(screen.getByText("builder.contextMenu.properties"));
    expect(screen.getByText("builder.chrome.innerSectionHint")).toBeTruthy();
  });

  it("właściwości z menu otwierają panel zaznaczonego węzła", () => {
    mount();
    openMenu("data-widget-id", "w1");
    fireEvent.click(screen.getByText("builder.contextMenu.properties"));
    expect(screen.getByTestId("panel-widgetu").textContent).toContain("w1");
  });

  it("przesuwanie sekcji w menu zna swoje granice", () => {
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    // Pierwsza sekcja nie ma jak iść wyżej.
    expect(screen.getByText("builder.contextMenu.moveUp").closest("button")).toBeDisabled();
    fireEvent.click(screen.getByText("builder.contextMenu.moveDown"));
    expect(last()?.sections.map((x) => x.id)).toEqual(["s2", "s1"]);
  });

  it("dodanie kolumny i sekcji wewnętrznej z menu zmienia dokument", () => {
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.addColumn"));
    expect(last()?.sections[0]?.children.length).toBe(2);
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.addInnerSection"));
    expect(last()?.sections[0]?.children.some((c) => c.kind === "inner-section")).toBe(true);
  });

  it("usunięcie z menu przechodzi przez pytanie", () => {
    const { last } = mount();
    openMenu("data-widget-id", "w1");
    fireEvent.click(screen.getByText("builder.contextMenu.remove"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("builder.common.delete"));
    expect(widgetIds(last())).toEqual(["w2"]);
  });

  it.each([
    ["kolumna", "data-col-id", "c1"],
    ["widget", "data-widget-id", "w1"],
    ["sekcja wewnętrzna", "data-inner-id", "i1"],
  ])("ukrycie %s z menu zapisuje się per urządzenie", (_label, attr, id) => {
    const { last } = mount();
    openMenu(attr, id);
    fireEvent.click(screen.getByText("builder.contextMenu.hideOnDevice"));
    const doc = last();
    const flat = JSON.stringify(doc);
    // Ukrycie jest per breakpoint - zapis bez urządzenia gasiłby węzeł wszędzie.
    expect(flat).toContain('"hideOn":{"desktop":true}');
    expect(doc).not.toBeNull();
  });

  it("kopiowanie i wycinanie z menu działa na wskazanym węźle", () => {
    mount();
    openMenu("data-widget-id", "w2");
    fireEvent.click(screen.getByText("builder.contextMenu.copy"));
    openMenu("data-widget-id", "w2");
    fireEvent.click(screen.getByText("builder.contextMenu.cut"));
    expect(screen.getByText("builder.confirmDelete.widgetTitle")).toBeTruthy();
  });

  it("zduplikowanie kolumny z menu dokłada kolumnę", () => {
    const { last } = mount();
    openMenu("data-col-id", "c1");
    fireEvent.click(screen.getByText("builder.contextMenu.duplicate"));
    expect(last()?.sections[0]?.children.length).toBe(2);
  });

  it("zamknięcie menu nie zmienia dokumentu", () => {
    const { last } = mount();
    openMenu("data-widget-id", "w1");
    fireEvent.click(screen.getByLabelText("builder.contextMenu.close"));
    expect(screen.queryByText("builder.contextMenu.kindWidget")).toBeNull();
    expect(last()).toBeNull();
  });
});

describe("Builder - pozostałe gałęzie powłoki", () => {
  it("ciemny motyw panelu ustawia ciemny podgląd kanwy", () => {
    theme.value = "dark";
    mount();
    // Podgląd startuje w tym samym trybie co strona - inaczej redakcja
    // dobiera kolory do widoku, którego czytelnik nie zobaczy.
    expect(canvasProps().device).toBe("desktop");
    expect(document.querySelector(".bg-muted\\/30.p-4.dark")).not.toBeNull();
  });

  it.each([
    ["tablet", "max-w-[820px]"],
    ["mobile", "max-w-[390px]"],
  ])("ramka kanwy dla %s ma własną szerokość", (device, cls) => {
    mount();
    fireEvent.click(screen.getByTitle(device));
    expect(document.querySelector(`[data-tour="builder-canvas"]`)?.className).toContain(cls);
  });

  it("zaznaczenie widgetu, którego nie ma, nie otwiera panelu", () => {
    mount();
    act(() => canvasProps().setSelection({ kind: "widget", id: "nie-istnieje" }));
    // Zaznaczenie może przeżyć usunięcie węzła (cofnięcie, zmiana z zewnątrz).
    expect(screen.getByTestId("biblioteka")).toBeTruthy();
  });

  it("przełączanie zbioru dokłada nieobecny identyfikator", () => {
    mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1"]), "replace"));
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w2"]), "toggle"));
    expect(
      screen.getByRole("toolbar", { name: "builder.bulk.ariaSelected" }).textContent,
    ).toContain("2");
  });

  it.each([
    ["sekcja", { kind: "section", id: "s1" }, "builder.confirmDelete.sectionTitle"],
    ["kolumna", { kind: "column", id: "c1" }, "builder.confirmDelete.columnTitle"],
  ] as const)("wycięcie %s pyta o usunięcie", (_label, selection, title) => {
    mount();
    act(() => canvasProps().setSelection(selection));
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("usunięcie kolumny z paska akcji przechodzi przez pytanie", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "column", id: "c1" }));
    fireEvent.click(screen.getByTitle("builder.chrome.deleteSelTitle"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("builder.common.delete"));
    expect(last()?.sections[0]?.children).toEqual([]);
  });

  it("dodanie sekcji z menu pustego miejsca tworzy sekcję", () => {
    const { last } = mount();
    fireEvent.contextMenu(screen.getByTestId("kanwa"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.addSection"));
    expect(last()?.sections.length).toBe(3);
  });

  it("zapis sekcji jako szablonu pyta o nazwę i milczy bez odpowiedzi", async () => {
    const { last } = mount();
    fireEvent.contextMenu(node("data-sec-id", "s1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.saveAsTemplate"));
    await act(async () => {
      await Promise.resolve();
    });
    // Anulowane okno nazwy nie może dopisać szablonu ani ruszyć dokumentu.
    expect(last()).toBeNull();
  });

  it("wklejenie z menu widgetu wstawia węzeł ze schowka", () => {
    clipboard.value = { kind: "widget", node: wgt("wx"), version: 1 };
    const { last } = mount();
    fireEvent.contextMenu(node("data-widget-id", "w1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.paste"));
    expect(widgetIds(last()).length).toBe(3);
  });

  it("widget globalny ma w menu odłączenie, a zwykły zapis jako globalny", () => {
    const globalDoc: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "c1",
              kind: "column",
              span: { desktop: 12 },
              children: [{ ...wgt("w1"), globalId: "g1" }],
            },
          ],
        },
      ],
    };
    const { last } = mount({ value: globalDoc });
    fireEvent.contextMenu(node("data-widget-id", "w1"), { clientX: 5, clientY: 5 });
    expect(screen.queryByText("builder.contextMenu.saveAsGlobal")).toBeNull();
    fireEvent.click(screen.getByText("builder.contextMenu.unlinkGlobal"));
    // Odłączenie zostawia treść, ale zdejmuje referencję do rekordu wspólnego.
    expect(JSON.stringify(last())).not.toContain("globalId");
  });

  it("sekcja w teście A/B ma w menu zakończenie testu, nie start", () => {
    const abDoc: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [],
          advanced: { abTest: { experimentId: "e1", variant: "a" } },
        },
      ],
    };
    mount({ value: abDoc });
    fireEvent.contextMenu(node("data-sec-id", "s1"), { clientX: 5, clientY: 5 });
    expect(screen.queryByText("builder.contextMenu.startAbTest")).toBeNull();
    expect(screen.getByText("builder.contextMenu.endAbKeepA")).toBeTruthy();
    expect(screen.getByText("builder.contextMenu.endAbKeepB")).toBeTruthy();
    expect(screen.getByText("builder.contextMenu.endAbKeepBoth")).toBeTruthy();
  });

  it("kopiowanie z menu sekcji wewnętrznej nie rusza dokumentu", () => {
    const { last } = mount();
    fireEvent.contextMenu(node("data-inner-id", "i1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.copy"));
    expect(last()).toBeNull();
  });

  it.each([
    ["sekcja", "data-sec-id", "s1", "panel-sekcji"],
    ["kolumna", "data-col-id", "c1", "panel-kolumny"],
  ])("właściwości %s z menu otwierają jej panel", (_label, attr, id, testId) => {
    mount();
    fireEvent.contextMenu(node(attr, id), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.properties"));
    expect(screen.getByTestId(testId)).toBeTruthy();
  });

  it.each([
    ["sekcja", "data-sec-id", "s1", "builder.confirmDelete.sectionTitle"],
    ["kolumna", "data-col-id", "c1", "builder.confirmDelete.columnTitle"],
  ])("usunięcie %s z menu pyta", (_label, attr, id, title) => {
    mount();
    fireEvent.contextMenu(node(attr, id), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("builder.contextMenu.remove"));
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("stara, płaska wysokość widgetu jest zamieniana na zapis per urządzenie", () => {
    const legacyDoc: BuilderDocument = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "c1",
              kind: "column",
              span: { desktop: 12 },
              children: [{ ...wgt("w1"), advanced: { height: 240 } }],
            },
          ],
        },
      ],
    };
    const { last } = mount({ value: legacyDoc });
    act(() => canvasProps().onWidgetResize?.("w1", 300, "tablet"));
    const col = last()?.sections[0]?.children[0];
    const advanced = col && col.kind === "column" ? col.children[0]?.advanced : undefined;
    // Zapis nie może próbować rozłożyć liczby na klucze urządzeń.
    expect(advanced?.height).toEqual({ tablet: 300 });
  });
});

describe("Builder - menu kontekstowe: pełne przejście po działaniach", () => {
  const AB_DOC: BuilderDocument = {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          { id: "c1", kind: "column", span: { desktop: 12 }, children: [wgt("w1")] },
          { id: "i1", kind: "inner-section", columns: [] },
        ],
        advanced: { abTest: { experimentId: "e1", variant: "b" } },
      },
      { id: "s2", kind: "section", children: [] },
    ],
  };

  function openMenu(attr: string, id: string) {
    fireEvent.contextMenu(node(attr, id), { clientX: 8, clientY: 12 });
  }

  it.each([
    ["a", "builder.contextMenu.endAbKeepA"],
    ["b", "builder.contextMenu.endAbKeepB"],
    ["oba", "builder.contextMenu.endAbKeepBoth"],
  ])("zakończenie testu A/B z wariantem %s zdejmuje znacznik", (_label, key) => {
    const { last } = mount({ value: AB_DOC });
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText(key));
    // Po zakończeniu testu sekcja przestaje być wariantem eksperymentu.
    expect(JSON.stringify(last())).not.toContain("abTest");
    expect(toasts.messages.length).toBe(1);
  });

  it("wariant testu jest pokazany w nagłówku menu", () => {
    mount({ value: AB_DOC });
    openMenu("data-sec-id", "s1");
    expect(screen.getByText(/builder\.contextMenu\.abVariantHeader/)).toBeTruthy();
  });

  it("start testu A/B po podaniu nazwy oznacza sekcję", async () => {
    prompts.answer = "Nowy test";
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.startAbTest"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.stringify(last())).toContain("abTest");
  });

  it("zapis widgetu jako globalnego po podaniu nazwy podłącza rekord", async () => {
    prompts.answer = "Wspólna stopka";
    const { last } = mount();
    openMenu("data-widget-id", "w1");
    fireEvent.click(screen.getByText("builder.contextMenu.saveAsGlobal"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.stringify(last())).toContain("globalId");
  });

  it("zapis sekcji jako szablonu po podaniu nazwy nie rusza dokumentu", async () => {
    prompts.answer = "Hero";
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.saveAsTemplate"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Szablon to zapis NA BOKU - dokument strony zostaje bez zmian.
    expect(last()).toBeNull();
  });

  it.each([
    ["sekcja", "data-sec-id", "s2"],
    ["kolumna", "data-col-id", "c1"],
    ["sekcja wewnętrzna", "data-inner-id", "i1"],
  ])("wklejenie ze schowka w menu %s dokłada widget", (_label, attr, id) => {
    clipboard.value = { kind: "widget", node: wgt("wx"), version: 1 };
    const { last } = mount({ value: AB_DOC });
    openMenu(attr, id);
    fireEvent.click(screen.getByText("builder.contextMenu.paste"));
    expect(widgetIds(last()).length).toBe(2);
  });

  it("wklejenie w pustym miejscu kanwy dokłada widget", () => {
    clipboard.value = { kind: "widget", node: wgt("wx"), version: 1 };
    const { last } = mount();
    fireEvent.contextMenu(screen.getByTestId("kanwa"), { clientX: 3, clientY: 3 });
    fireEvent.click(screen.getByText("builder.contextMenu.paste"));
    expect(widgetIds(last()).length).toBe(3);
  });

  it.each([
    ["sekcja", "data-sec-id", "s1"],
    ["kolumna", "data-col-id", "c1"],
  ])("kopiowanie %s z menu nie zmienia dokumentu", (_label, attr, id) => {
    const { last } = mount();
    openMenu(attr, id);
    fireEvent.click(screen.getByText("builder.contextMenu.copy"));
    expect(last()).toBeNull();
  });

  it("zduplikowanie sekcji z menu dokłada sekcję", () => {
    const { last } = mount();
    openMenu("data-sec-id", "s1");
    fireEvent.click(screen.getByText("builder.contextMenu.duplicate"));
    expect(last()?.sections.length).toBe(3);
  });

  it("przesunięcie sekcji w górę z menu zmienia kolejność", () => {
    const { last } = mount();
    openMenu("data-sec-id", "s2");
    fireEvent.click(screen.getByText("builder.contextMenu.moveUp"));
    expect(last()?.sections.map((x) => x.id)).toEqual(["s2", "s1"]);
    // Ostatnia sekcja nie ma jak iść niżej.
    openMenu("data-sec-id", "s1");
    expect(screen.getByText("builder.contextMenu.moveDown").closest("button")).toBeDisabled();
  });
});

describe("Builder - domknięcie gałęzi historii i wycinania", () => {
  it.each([
    ["sekcji", "data-sec-id", "s1", "builder.confirmDelete.sectionTitle"],
    ["kolumny", "data-col-id", "c1", "builder.confirmDelete.columnTitle"],
  ])("wycięcie %s z menu pyta o usunięcie", (_label, attr, id, title) => {
    mount();
    fireEvent.contextMenu(node(attr, id), { clientX: 6, clientY: 6 });
    fireEvent.click(screen.getByText("builder.contextMenu.cut"));
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("wycięcie sekcji wewnętrznej nie ma jeszcze usuwania", () => {
    const { last } = mount();
    act(() => canvasProps().setSelection({ kind: "inner-section", id: "i1" }));
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    // Sekcja wewnętrzna nie ma operacji usuwania - wycięcie musi być bez
    // skutku, a nie usuwać sekcji-rodzica.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(last()).toBeNull();
  });

  it("operacja zbiorcza bez etykiety ma własny komunikat cofnięcia", () => {
    const { last } = mount();
    act(() => canvasProps().onMultiSelectionChange?.(new Set(["w1", "w2"]), "replace"));
    fireEvent.click(screen.getByTitle("builder.bulk.duplicateTitle"));
    expect(widgetIds(last()).length).toBe(4);
    fireEvent.click(screen.getAllByTitle("builder.chrome.undoTitle")[0]!);
    // Zduplikowanie zbiorcze leci przez `update` BEZ etykiety, więc komunikat
    // jest ogólny - to inna gałąź niż operacje opisane nazwą.
    expect(toasts.messages).toContain("builder.chrome.undone");
    fireEvent.click(screen.getAllByTitle("builder.chrome.redoTitle")[0]!);
    expect(toasts.messages).toContain("builder.chrome.redone");
    expect(widgetIds(last()).length).toBe(4);
  });
});
