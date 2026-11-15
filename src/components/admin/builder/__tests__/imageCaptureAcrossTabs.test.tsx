// Panel właściwości widgetu obrazu: pomiar naturalnego rozmiaru pliku żyje NAD
// zakładkami (`useImageIntrinsicCapture` trzymany przez `WidgetProperties`).
//
// SKĄD TEN PLIK. Edytor obrazu mieszka w zakładce "Treść", a zakładka
// nieaktywna nie jest montowana (Radix `TabsContent` bez `forceMount`). Dopóki
// pomiar i zapis rozmiaru trzymał sam edytor:
//  - przejście na "Styl" albo "Zaawansowane" w trakcie pomiaru odmontowywało
//    edytor i wynik przepadał - treść zostawała z nowym adresem i pustym
//    rozmiarem;
//  - zaznaczenie obrazu przy otwartej zakładce "Styl" niczego nie mierzyło, bo
//    aktywna zakładka to stan panelu, który przeżywa zmianę zaznaczenia.
// Reguły, KIEDY wolno mierzyć i zapisywać (zmiana pliku, zaznaczenie, przełączone
// ustawienie, werdykt "brak proporcji"), ma przypięte
// `imageEditorIntrinsicSize.test.tsx` - tu jest dowód tylko na to, że działają
// niezależnie od zakładki, że zapis idzie przez `onChange` ZAZNACZONEGO widgetu
// i że widgety innych typów nie są ruszane.
//
// Zakładki są PRAWDZIWE (Radix): odmontowanie edytora po przełączeniu zakładki
// to właśnie zachowanie, od którego zależy ten test. `measureIntrinsicSize` jest
// atrapą rozstrzyganą ręcznie; `ImageSlot` jest prawdziwy - atrapa podsłuchuje
// tylko jego propsy, żeby zmienić plik tak, jak robi to pole adresu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

interface SlotProbeProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

const probe = vi.hoisted(() => ({
  /** Adresy, o których pomiar poproszono, w kolejności. */
  calls: [] as string[],
  /** Pomiary w toku - rozstrzyga je test przez `settle`. */
  pending: [] as Array<{ url: string; resolve: (size: string) => void }>,
  /** Ostatnie propsy każdego slotu, po etykiecie. */
  slots: {} as Record<string, SlotProbeProps>,
}));

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("@/lib/media/measureIntrinsicSize", () => ({
  measureIntrinsicSize: (url: string) => {
    probe.calls.push(url);
    // `settle(url, NO_RATIO)` to werdykt "plik bez własnej proporcji"; każdy
    // inny napis to rozmiar (`""` = pomiar nieudany).
    const result = (size: string) =>
      size === "no-ratio" ? { size: "", noRatio: true } : { size, noRatio: false };
    return new Promise<ReturnType<typeof result>>((resolve) => {
      probe.pending.push({ url, resolve: (size) => resolve(result(size)) });
    });
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } }, error: null }) },
  },
}));

vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-test",
  useCurrentTenantId: () => "tenant-test",
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});

vi.mock("@/lib/media.functions", () => ({
  bulkMoveMedia: async () => ({ moved: 0 }),
  bulkDeleteMedia: async () => ({ deleted: 0 }),
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));

// Podgląd na żywo renderuje prawdziwy widget (własne zapytania) - bez znaczenia
// dla pomiaru.
vi.mock("../ui/organisms/WidgetLivePreview", () => ({
  WidgetLivePreview: () => <div data-testid="podglad" />,
}));

vi.mock("../ui/organisms/widget-properties/ImageSlot", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ui/organisms/widget-properties/ImageSlot")>();
  const RealSlot = actual.ImageSlot;
  return {
    ImageSlot: (props: Parameters<typeof RealSlot>[0]) => {
      probe.slots[props.label] = props;
      return <RealSlot {...props} />;
    },
  };
});

import { WidgetProperties } from "../WidgetProperties";

const LIGHT_SLOT = "builder.imageEditor.slotLight";
const NOT_STORED = "builder.imageEditor.sizeNotStored";
const TAB_CONTENT = "builder.widgetProps.tabContent";
const TAB_STYLE = "builder.widgetProps.tabStyle";
const TAB_ADVANCED = "builder.widgetProps.tabAdvanced";
const NO_RATIO = "no-ratio";

const PHOTO = "https://cdn.example.test/panel.jpg";
const NEW_PHOTO = "https://cdn.example.test/nowy.jpg";
const OTHER_PHOTO = "https://cdn.example.test/inny.jpg";
const SHAPELESS = "https://cdn.example.test/bez-proporcji.svg";

const image = (id: string, content: WidgetContent, globalId?: string): WidgetNode => ({
  id,
  kind: "widget",
  type: "image",
  content,
  ...(globalId ? { globalId } : {}),
});
const heading = (id: string, content: WidgetContent = {}): WidgetNode => ({
  id,
  kind: "widget",
  type: "heading",
  content,
});

/**
 * Rodzic jak `Builder.tsx`: dokument z widgetami, JEDEN panel dla zaznaczonego
 * widgetu (ta sama instancja panelu przy przejściu między widgetami,
 * odmontowanie przy odznaczeniu) i `onChange` związany z widgetem zaznaczonym
 * w chwili renderu - `updateWidget(selectedWidget.id, mut)`.
 */
function renderBuilder(nodes: WidgetNode[], selected: string | null) {
  const doc: Record<string, WidgetNode> = Object.fromEntries(nodes.map((node) => [node.id, node]));
  /** Identyfikatory widgetów, przez których `onChange` przeszedł zapis. */
  const changes: string[] = [];
  const control: { select: (id: string | null) => void } = { select: () => {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [current, setCurrent] = useState<string | null>(selected);
    const [, setRevision] = useState(0);
    control.select = setCurrent;
    if (!current) return null;
    return (
      <WidgetProperties
        widget={doc[current]}
        lang="pl"
        device="desktop"
        onChange={(mut) => {
          const next = JSON.parse(JSON.stringify(doc[current])) as WidgetNode;
          mut(next);
          doc[current] = next;
          changes.push(current);
          setRevision((revision) => revision + 1);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return {
    doc,
    changes,
    content: (id: string) => doc[id].content,
    select: (id: string | null) =>
      act(async () => {
        control.select(id);
      }),
  };
}

/** Domyka mikrozadania (rozstrzygnięte pomiary) i wynikające z nich rendery. */
const flush = () => act(async () => {});

const tab = (key: string) => screen.getByRole("tab", { name: new RegExp(key) });

/** Klik zakładki jak redaktor: Radix przełącza na `mousedown` lewym przyciskiem. */
const openTab = async (key: string) => {
  fireEvent.mouseDown(tab(key), { button: 0 });
  await flush();
  expect(tab(key)).toHaveAttribute("data-state", "active");
};

/** Czy edytor obrazu jest zamontowany (jego slot pliku jest na ekranie). */
const editorOnScreen = () => screen.queryByText(LIGHT_SLOT) !== null;

/** Zmiana pliku slotu tak, jak robi to pole adresu / upload / biblioteka. */
const changeSlot = (label: string, value: string) =>
  act(async () => {
    probe.slots[label].onChange(value);
  });

/** Rozstrzyga wstrzymany pomiar adresu. */
const settle = (url: string, size: string) =>
  act(async () => {
    const index = probe.pending.findIndex((entry) => entry.url === url);
    if (index < 0) throw new Error(`Brak wstrzymanego pomiaru dla ${url}`);
    const [entry] = probe.pending.splice(index, 1);
    entry.resolve(size);
  });

const pendingUrls = () => probe.pending.map((entry) => entry.url);

/** PropField nie wiąże etykiety z kontrolką przez htmlFor - szukamy po wrapperze. */
function selectFor(label: string): HTMLElement {
  const control = screen
    .getByText(label)
    .closest("div")
    ?.querySelector<HTMLElement>("[role='combobox']");
  if (!control) throw new Error(`Brak selecta dla pola "${label}"`);
  return control;
}

/** Otwiera selecta Radiksa i klika opcję - jak redaktor w panelu. */
const pickOption = async (label: string, optionLabel: string) => {
  fireEvent.keyDown(selectFor(label), { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByText(optionLabel));
  await flush();
};

beforeEach(() => {
  probe.calls = [];
  probe.pending = [];
  probe.slots = {};
  db.current = supabaseFromStub();
  for (const table of [
    "builder_global_widgets",
    "pages",
    "posts",
    "profiles",
    "categories",
    "tags",
    "events",
  ]) {
    db.current.setResponse(table, ok([]));
  }
});

afterEach(cleanup);

describe("panel obrazu - pomiar w toku przeżywa zmianę zakładki", () => {
  it.each([
    ["Styl", TAB_STYLE],
    ["Zaawansowane", TAB_ADVANCED],
  ])(
    'zmiana pliku, potem zakładka "%s": edytor znika, a rozmiar nowego pliku i tak trafia do treści',
    async (_name, tabKey) => {
      const { content, changes } = renderBuilder(
        [image("w1", { src: PHOTO, srcIntrinsic: "1200x675" })],
        "w1",
      );
      await settle(PHOTO, "1200x675");
      expect(changes).toEqual([]);

      await changeSlot(LIGHT_SLOT, NEW_PHOTO);
      expect(content("w1")).toEqual({ src: NEW_PHOTO, srcIntrinsic: "" });
      expect(pendingUrls()).toEqual([NEW_PHOTO]);

      await openTab(tabKey);
      expect(editorOnScreen()).toBe(false);
      await settle(NEW_PHOTO, "640x480");

      expect(content("w1")).toEqual({ src: NEW_PHOTO, srcIntrinsic: "640x480" });
      // Każdy zapis przeszedł przez `onChange` zaznaczonego widgetu.
      expect(new Set(changes)).toEqual(new Set(["w1"]));
    },
  );

  it('ustawienie "Proporcje" na auto, potem zakładka "Styl": rozmiar zapisany mimo zamkniętej "Treści"', async () => {
    const { content } = renderBuilder([image("w1", { src: PHOTO, ratio: "16/9" })], "w1");
    await flush();
    expect(probe.calls).toEqual([]);

    await pickOption("Proporcje", "auto");
    expect(pendingUrls()).toEqual([PHOTO]);
    await openTab(TAB_STYLE);
    await settle(PHOTO, "1200x675");

    expect(content("w1")).toEqual({ src: PHOTO, ratio: "auto", srcIntrinsic: "1200x675" });
  });

  it('powrót na "Treść" po zapisie: podpowiedź pokazuje rozmiar, a pomiar nie rusza drugi raz', async () => {
    renderBuilder([image("w1", { src: PHOTO })], "w1");
    expect(probe.slots[LIGHT_SLOT].hint).toBe(NOT_STORED);

    await openTab(TAB_STYLE);
    await settle(PHOTO, "1200x675");
    await openTab(TAB_CONTENT);

    expect(editorOnScreen()).toBe(true);
    expect(probe.slots[LIGHT_SLOT].hint).toBe("1200 × 675 px");
    expect(probe.calls).toEqual([PHOTO]);
  });
});

describe("panel obrazu - zaznaczenie mierzy plik bez względu na otwartą zakładkę", () => {
  it.each([
    ["Styl", TAB_STYLE],
    ["Zaawansowane", TAB_ADVANCED],
  ])(
    'obraz zaznaczony przy otwartej zakładce "%s": plik zmierzony, rozmiar zapisany',
    async (_name, tabKey) => {
      const { content, changes, select } = renderBuilder(
        [heading("h1"), image("w2", { src: PHOTO })],
        "h1",
      );
      await openTab(tabKey);
      expect(probe.calls).toEqual([]);

      await select("w2");
      // Zakładka przeżywa zmianę zaznaczenia - edytora obrazu nie ma na ekranie.
      expect(tab(tabKey)).toHaveAttribute("data-state", "active");
      expect(editorOnScreen()).toBe(false);
      expect(pendingUrls()).toEqual([PHOTO]);
      await settle(PHOTO, "1200x675");

      expect(content("w2")).toEqual({ src: PHOTO, srcIntrinsic: "1200x675" });
      expect(changes).toEqual(["w2"]);
    },
  );

  it('obraz z rozmiarem zastępczym pliku bez proporcji, zaznaczony przy "Stylu": rozmiar wyzerowany', async () => {
    const { content, select } = renderBuilder(
      [heading("h1"), image("w2", { src: SHAPELESS, srcIntrinsic: "300x150" })],
      "h1",
    );
    await openTab(TAB_STYLE);

    await select("w2");
    await settle(SHAPELESS, NO_RATIO);

    expect(content("w2")).toEqual({ src: SHAPELESS, srcIntrinsic: "" });
  });

  it('zakładka "Treść" otwarta: JEDEN pomiar na plik - edytor w panelu nie mierzy drugi raz', async () => {
    const { content, changes } = renderBuilder([image("w1", { src: PHOTO })], "w1");

    expect(editorOnScreen()).toBe(true);
    expect(probe.calls).toEqual([PHOTO]);
    await settle(PHOTO, "1200x675");

    expect(content("w1")).toEqual({ src: PHOTO, srcIntrinsic: "1200x675" });
    expect(changes).toEqual(["w1"]);
    expect(probe.calls).toEqual([PHOTO]);
  });

  it("przełączanie zakładek przy tym samym widgecie niczego nie mierzy", async () => {
    renderBuilder([image("w1", { src: PHOTO, srcIntrinsic: "1200x675" })], "w1");
    await settle(PHOTO, "1200x675");

    await openTab(TAB_STYLE);
    await openTab(TAB_ADVANCED);
    await openTab(TAB_CONTENT);

    expect(probe.calls).toEqual([PHOTO]);
  });

  it("instancja widgetu globalnego: zaznaczenie nie mierzy na żadnej zakładce", async () => {
    const { changes, select } = renderBuilder(
      [heading("h1"), image("g1", { src: PHOTO }, "global-1")],
      "h1",
    );
    await openTab(TAB_STYLE);
    await select("g1");
    await openTab(TAB_CONTENT);

    expect(probe.calls).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('obraz w ramce zaznaczony przy "Stylu": renderer rozmiaru nie użyje, więc nic nie jest mierzone', async () => {
    const { changes, select } = renderBuilder(
      [heading("h1"), image("w2", { src: PHOTO, ratio: "16/9" })],
      "h1",
    );
    await openTab(TAB_STYLE);
    await select("w2");
    await flush();

    expect(probe.calls).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe("panel obrazu - zapis zostaje przy zaznaczonym widgecie", () => {
  it("widget innego typu z kluczem `src` w treści: panel niczego nie mierzy ani nie zapisuje", async () => {
    const { changes } = renderBuilder([heading("h1", { src: PHOTO })], "h1");
    await openTab(TAB_STYLE);
    await openTab(TAB_CONTENT);

    expect(probe.calls).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("odznaczenie widgetu przed powrotem pomiaru: wynik przepada (panel odmontowany)", async () => {
    const { content, select } = renderBuilder(
      [image("w1", { src: PHOTO, srcIntrinsic: "1200x675" })],
      "w1",
    );
    await settle(PHOTO, "1200x675");
    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await openTab(TAB_STYLE);

    await select(null);
    await settle(NEW_PHOTO, "640x480");

    expect(content("w1")).toEqual({ src: NEW_PHOTO, srcIntrinsic: "" });
  });

  it("zaznaczenie INNEGO widgetu przed powrotem pomiaru: wynik nie trafia do żadnego widgetu", async () => {
    const { content, changes, select } = renderBuilder(
      [
        image("w1", { src: PHOTO, srcIntrinsic: "1200x675" }),
        image("w2", { src: OTHER_PHOTO, srcIntrinsic: "800x600" }),
        heading("h1"),
      ],
      "w1",
    );
    await settle(PHOTO, "1200x675");
    await changeSlot(LIGHT_SLOT, NEW_PHOTO);
    await openTab(TAB_STYLE);
    const writesBefore = changes.length;

    await select("w2");
    await settle(NEW_PHOTO, "640x480");
    await settle(OTHER_PHOTO, "800x600");
    await select("h1");

    expect(content("w1")).toEqual({ src: NEW_PHOTO, srcIntrinsic: "" });
    expect(content("w2")).toEqual({ src: OTHER_PHOTO, srcIntrinsic: "800x600" });
    expect(content("h1")).toEqual({});
    expect(changes.length).toBe(writesBefore);

    // Powrót do pierwszego obrazu naprawia stan - także przy otwartym "Stylu".
    await select("w1");
    await settle(NEW_PHOTO, "640x480");
    expect(content("w1")).toEqual({ src: NEW_PHOTO, srcIntrinsic: "640x480" });
  });
});
