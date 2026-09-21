// METABOX USTAWIEŃ WPISU - ZAKŁADKI I SPIS TREŚCI (`PostSettingsMetabox`,
// `TocTab`, `HeadingCounter`, `PanelHead`, `RowOverride`).
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. ZAKŁADKA DECYDUJE, CO JEST ZAMONTOWANE. Panel dostępu montuje się
//      DOPIERO po wejściu na zakładkę członkostwa (i dostaje identyfikator
//      bytu), a zakładka „Dowiesz się…" nie istnieje bez handlera rodzica.
//      Bez kliknięcia w zakładki dwie trzecie pliku jest nietknięte.
//   2. NADPISANIE JEST TRÓJSTANOWE: `null` (dziedzicz), `true`, `false`.
//      To nie jest przełącznik - „Brak ToC" MUSI dać się odróżnić od
//      „użyj globalnego", bo globalne bywa włączone.
//   3. PUSTE NADPISANIE WRACA DO `null`, NIE DO `{}`. `patch()` sprawdza, czy
//      wszystkie pola są puste, i wtedy oddaje rodzicowi `null` - inaczej wpis
//      trzymałby w bazie obiekt nadpisania, który niczego nie nadpisuje, a
//      panel pokazywałby „nadpisane" bez różnicy wobec globalnych.
//   4. LICZNIK NAGŁÓWKÓW CZYTA TREŚĆ EDYTORA, per język, i PRZEKREŚLA poziomy
//      poza zakresem globalnym (H1 przy `minLevel: 2` nie trafi do ToC).
//   5. WARTOŚCI GLOBALNE POKAZUJĄ SIĘ OBOK KAŻDEGO POLA - to one są
//      alternatywą dla nadpisania, więc muszą pochodzić z `site_settings`,
//      a nie z literałów panelu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `AccessSettingsPane` i `KeyTakeaways` to ATRAPY (mają własne suity);
//     tutaj liczy się KONTRAKT: kiedy się montują i z jakimi propami.
//   - `countPostHeadings` / `TocDefaultsSchema` są PRAWDZIWE - panel dostaje
//     dokument bloków i mapę `site_settings`, dokładnie jak w edytorze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  controlledHost,
  mountSettingsPane,
  selectWithOption,
  switchFor,
  type PropRecorder,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import type { TocOverride } from "@/lib/toc/settings";

/** Propy, które metabox przekazuje panelowi dostępu. */
interface AccessPaneProps {
  entityType: string;
  entityId: string | null;
}

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  access: null as unknown,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

// Cache SSR jest PER IZOLAT (60 s) - bez przezroczystej atrapy drugi test
// w pliku dostałby mapę ustawień pierwszego.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

vi.mock("sonner", async () => {
  const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
  return make().sonner();
});

vi.mock("@/components/admin/AccessSettingsPane", async () => {
  const { childPaneStub: make, propRecorder: rec } =
    await import("@/test/admin/settingsPaneHarness");
  const recorder = rec<AccessPaneProps>();
  stubs.access = recorder;
  return { AccessSettingsPane: make("access-pane", recorder) };
});

vi.mock("@/components/molecules/KeyTakeaways", () => ({
  KeyTakeaways: () => null,
}));

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});

vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});

vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const { radixTabsStub } = await import("@/test/reactStubs");
  return radixTabsStub(react);
});

import { PostSettingsMetabox } from "@/components/admin/PostSettingsMetabox";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const access = () => stubs.access as PropRecorder<AccessPaneProps>;

/** Dokument bloków z nagłówkami PL/EN - wejście `countPostHeadings`. */
const BLOCKS: LocalizedBlocks = {
  pl: {
    version: 1,
    blocks: [
      { id: "b1", type: "heading", data: { level: 1, text: "Tytuł działu" } },
      { id: "b2", type: "heading", data: { level: 2, text: "Kontekst regionalny" } },
      { id: "b3", type: "heading", data: { level: 2, text: "Rekomendacje" } },
      { id: "b4", type: "paragraph", data: { text: "Akapit bez nagłówka" } },
    ],
  },
  en: {
    version: 1,
    blocks: [{ id: "b5", type: "heading", data: { level: 3, text: "Regional context" } }],
  },
};

interface MountOptions {
  override?: TocOverride | null;
  blocks?: LocalizedBlocks | null;
  /** Mapa `site_settings` zasiana PRZED renderem (wartości globalne). */
  settings?: Record<string, unknown>;
  withTakeaways?: boolean;
}

function mountMetabox(options: MountOptions = {}) {
  const host = controlledHost<TocOverride | null>(options.override ?? null, (value, onChange) => (
    <PostSettingsMetabox
      entityType="post"
      entityId="post-42"
      tocOverride={value}
      onTocOverrideChange={onChange}
      postBlocks={options.blocks ?? null}
      onTakeawaysChange={options.withTakeaways ? () => {} : undefined}
    />
  ));
  const view = mountSettingsPane(host.node, {
    seed: [{ queryKey: ["site_settings_public", "all"], data: options.settings ?? {} }],
  });
  return { host, view };
}

const tabButtons = (): HTMLElement[] => [
  ...screen.getByRole("navigation").querySelectorAll<HTMLElement>("button"),
];

const tabButton = (key: string): HTMLElement => {
  const found = tabButtons().find((node) => node.textContent === key);
  if (!found) throw new Error(`test: brak zakładki "${key}"`);
  return found;
};

/** Wiersz `RowOverride` po etykiecie - etykieta nie jest wiązana z kontrolką. */
function overrideRow(container: HTMLElement, label: string): HTMLElement {
  const node = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === label,
  );
  const row = node?.parentElement?.parentElement;
  if (!row) throw new Error(`test: brak wiersza nadpisania "${label}"`);
  return row;
}

const globalValueOf = (container: HTMLElement, label: string): string =>
  overrideRow(container, label).querySelector(".font-mono")?.textContent ?? "";

/**
 * Link „wyczyść nadpisanie" WEWNĄTRZ wiersza etykiety. Szukamy po treści,
 * bo wiersz trybu ToC ma jeszcze trzy przyciski trójstanu - `querySelector`
 * po pierwszym `<button>` brałby je za link czyszczący.
 */
const clearButton = (container: HTMLElement, label: string): HTMLButtonElement | null =>
  [...overrideRow(container, label).querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "wyczyść nadpisanie",
  ) ?? null;

const enabledButton = (container: HTMLElement, text: string): HTMLButtonElement => {
  const node = [...overrideRow(container, "admin.metabox.toc.enabled").querySelectorAll("button")]
    .filter((candidate): candidate is HTMLButtonElement => candidate.textContent === text)
    .at(0);
  if (!node) throw new Error(`test: brak przycisku trybu ToC "${text}"`);
  return node;
};

const columnRadios = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('[role="radio"]'),
];

/** Pole liczbowe pozycji ToC (etykieta niewiązana z kontrolką). */
const positionInput = (container: HTMLElement): HTMLInputElement => {
  const node = overrideRow(container, "admin.metabox.toc.position").querySelector("input");
  if (!node) throw new Error("test: wiersz pozycji ToC bez pola liczbowego");
  return node;
};

beforeEach(() => {
  sb().reset();
  access().reset();
});

afterEach(() => {
  cleanup();
});

describe("PostSettingsMetabox - zakładki", () => {
  it("bez handlera punktów są DWIE zakładki, a otwarta jest zakładka ToC", () => {
    mountMetabox();

    expect(tabButtons().map((node) => node.textContent)).toEqual([
      "admin.metabox.tabs.toc",
      "admin.metabox.tabs.membership",
    ]);
    expect(tabButton("admin.metabox.tabs.toc")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("admin.metabox.toc.title")).toBeInTheDocument();
    expect(screen.queryByTestId("access-pane")).toBeNull();
    expect(screen.getByRole("navigation")).toHaveAttribute("aria-label", "Metabox tabs");
  });

  it("handler punktów dokłada TRZECIĄ zakładkę", () => {
    mountMetabox({ withTakeaways: true });

    expect(tabButtons().map((node) => node.textContent)).toEqual([
      "admin.metabox.tabs.toc",
      "admin.metabox.tabs.membership",
      "admin.metabox.tabs.takeaways",
    ]);
  });

  it("panel dostępu montuje się DOPIERO na swojej zakładce i dostaje identyfikator bytu", () => {
    mountMetabox();

    expect(access().calls).toHaveLength(0);

    fireEvent.click(tabButton("admin.metabox.tabs.membership"));

    expect(screen.getByTestId("access-pane")).toBeInTheDocument();
    expect(access().last()).toEqual({ entityType: "post", entityId: "post-42" });
    // Poprzednia zakładka schodzi z drzewa - to nie jest ukrywanie CSS-em.
    expect(screen.queryByText("admin.metabox.toc.title")).toBeNull();
    expect(tabButton("admin.metabox.tabs.membership")).toHaveAttribute("aria-pressed", "true");
    expect(tabButton("admin.metabox.tabs.toc")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(tabButton("admin.metabox.tabs.toc"));
    expect(screen.getByText("admin.metabox.toc.title")).toBeInTheDocument();
    expect(screen.queryByTestId("access-pane")).toBeNull();
  });

  it("nagłówek metaboxu prowadzi do ustawień globalnych ToC", () => {
    mountMetabox();

    expect(screen.getByText("admin.metabox.title")).toBeInTheDocument();
    expect(screen.getByText("admin.metabox.subtitle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ustawienia globalne/ })).toHaveAttribute(
      "href",
      "/admin/toc",
    );
  });
});

describe("PostSettingsMetabox - licznik nagłówków", () => {
  it("liczy nagłówki per język i przekreśla poziomy poza zakresem globalnym", () => {
    const { view } = mountMetabox({ blocks: BLOCKS });

    // Domyślny zakres to H2-H3, więc H1 jest poza nim.
    expect(screen.getByText("Zakres ToC:").textContent).toContain("H2-H3");
    const cells = [...view.container.querySelectorAll<HTMLElement>(".tabular-nums")];
    // Kolejność: H1 PL, H1 EN, H2 PL, H2 EN, H3 PL, H3 EN.
    expect(cells.map((cell) => cell.textContent)).toEqual(["1", "0", "2", "0", "0", "1"]);
    expect(cells[0].className).toContain("line-through");
    expect(cells[0].getAttribute("title")).toBe("Poziom poza zakresem - nie trafi do ToC");
    expect(cells[2].className).not.toContain("line-through");
    expect(cells[2].getAttribute("title")).toBe("Poziom w zakresie ToC");
    expect(screen.queryByText(/Brak nagłówków w edytorze bloków/)).toBeNull();
  });

  it("zakres globalny z bazy przesuwa granicę przekreślenia", () => {
    const { view } = mountMetabox({
      blocks: BLOCKS,
      settings: { toc_defaults: { minLevel: 1, maxLevel: 2 } },
    });

    expect(screen.getByText("Zakres ToC:").textContent).toContain("H1-H2");
    const cells = [...view.container.querySelectorAll<HTMLElement>(".tabular-nums")];
    expect(cells[0].className).not.toContain("line-through");
    // H3 wypada z zakresu, choć w treści angielskiej jest jeden.
    expect(cells[5].textContent).toBe("1");
    expect(cells[5].className).toContain("line-through");
  });

  it("pusty edytor mówi wprost, że nie ma z czego zbudować ToC", () => {
    const { view } = mountMetabox({ blocks: null });

    expect(screen.getByText(/Brak nagłówków w edytorze bloków/)).toBeInTheDocument();
    const cells = [...view.container.querySelectorAll<HTMLElement>(".tabular-nums")];
    expect(cells.map((cell) => cell.textContent)).toEqual(["0", "0", "0", "0", "0", "0"]);
  });
});

describe("PostSettingsMetabox - nadpisania ToC", () => {
  it("bez nadpisania każde pole pokazuje wartość globalną i nie ma czego czyścić", () => {
    const { view } = mountMetabox({
      settings: {
        toc_defaults: {
          enabled: true,
          layout: "inline",
          columns: "col-2",
          position: 5,
          sticky: true,
          showInBody: true,
        },
      },
    });
    const container = view.container;

    expect(globalValueOf(container, "admin.metabox.toc.enabled")).toBe("włączony");
    expect(globalValueOf(container, "admin.metabox.toc.layout")).toBe("inline");
    expect(globalValueOf(container, "admin.metabox.toc.position")).toBe("5");
    expect(globalValueOf(container, "admin.metabox.toc.sticky")).toBe("włączony");
    expect(globalValueOf(container, "admin.metabox.toc.showInBody")).toBe("widoczny");
    expect(screen.getByText("Kolumny spisu treści")).toBeInTheDocument();
    // „2 kolumny" pada dwa razy: jako wartość globalna i jako etykieta kafla.
    expect(screen.getAllByText("2 kolumny")).toHaveLength(2);
    // Formularz startuje z wartości GLOBALNYCH, nie z zer.
    expect(selectWithOption(container, "inline").value).toBe("inline");
    expect(switchFor(container, "admin.metabox.toc.sticky").checked).toBe(true);
    expect(columnRadios(container)[1].getAttribute("aria-checked")).toBe("true");
    expect(clearButton(container, "admin.metabox.toc.position")).toBeNull();
    expect(screen.queryByText("admin.metabox.toc.resetAll")).toBeNull();
  });

  it("wyłączone globalnie ToC ma własne słowo, a nie pustkę", () => {
    const { view } = mountMetabox({
      settings: { toc_defaults: { enabled: false, sticky: false, showInBody: false } },
    });

    expect(globalValueOf(view.container, "admin.metabox.toc.enabled")).toBe("wyłączony");
    expect(globalValueOf(view.container, "admin.metabox.toc.sticky")).toBe("wyłączony");
    expect(globalValueOf(view.container, "admin.metabox.toc.showInBody")).toBe("tylko sidebar");
  });

  it("trójstan nadpisania: Brak ToC to inna wartość niż Globalny", () => {
    const { host, view } = mountMetabox();

    fireEvent.click(enabledButton(view.container, "Brak ToC"));
    expect(host.current()).toEqual({ enabled: false });
    expect(enabledButton(view.container, "Brak ToC")).toHaveAttribute("aria-pressed", "true");
    expect(enabledButton(view.container, "Globalny")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(enabledButton(view.container, "Włącz"));
    expect(host.current()).toEqual({ enabled: true });

    // Powrót na „Globalny" ZERUJE nadpisanie do null, a nie do `{enabled:null}`.
    fireEvent.click(enabledButton(view.container, "Globalny"));
    expect(host.current()).toBeNull();
    expect(host.changes).toEqual([{ enabled: false }, { enabled: true }, null]);
  });

  it("każde pole nadpisania pisze do WŁASNEGO klucza, nie do sąsiedniego", () => {
    const { host, view } = mountMetabox();
    const container = view.container;

    fireEvent.change(selectWithOption(container, "sticky-sidebar"), {
      target: { value: "sticky-sidebar" },
    });
    expect(host.current()).toEqual({ layout: "sticky-sidebar" });

    fireEvent.click(columnRadios(container)[2]);
    fireEvent.change(positionInput(container), { target: { value: "7" } });
    fireEvent.click(switchFor(container, "admin.metabox.toc.sticky"));
    fireEvent.click(switchFor(container, "admin.metabox.toc.showInBody"));

    expect(host.current()).toEqual({
      layout: "sticky-sidebar",
      columns: "half",
      position: 7,
      sticky: true,
      showInBody: true,
    });
    expect(columnRadios(container)[2].getAttribute("aria-checked")).toBe("true");
  });

  it("wyczyszczone pole liczbowe spada na 0, a nie na NaN", () => {
    const { host, view } = mountMetabox({ override: { position: 4 } });

    fireEvent.change(positionInput(view.container), { target: { value: "" } });

    expect(host.current()).toEqual({ position: 0 });
  });

  it("czyszczenie nadpisania zdejmuje JEDNO pole i wraca do globalnego", () => {
    const { host, view } = mountMetabox({
      override: { layout: "inline", sticky: true },
      settings: { toc_defaults: { layout: "boxed" } },
    });
    const container = view.container;

    const clear = clearButton(container, "admin.metabox.toc.layout");
    expect(clear).not.toBeNull();
    fireEvent.click(clear as HTMLButtonElement);

    expect(host.current()).toEqual({ layout: null, sticky: true });
    expect(selectWithOption(container, "boxed").value).toBe("boxed");
    // Drugie nadpisanie zostaje - czyszczenie jest punktowe.
    expect(clearButton(container, "admin.metabox.toc.sticky")).not.toBeNull();
  });

  it("KAŻDY wiersz ma własny link czyszczący i zdejmuje TYLKO swoje pole", () => {
    const { host, view } = mountMetabox({
      override: { enabled: false, position: 7, sticky: true, showInBody: true },
    });
    const container = view.container;

    const clear = (label: string) => {
      const button = clearButton(container, label);
      if (!button) throw new Error(`test: wiersz "${label}" bez linku czyszczącego`);
      fireEvent.click(button);
    };

    clear("admin.metabox.toc.enabled");
    expect(host.current()).toEqual({
      enabled: null,
      position: 7,
      sticky: true,
      showInBody: true,
    });
    expect(enabledButton(container, "Globalny")).toHaveAttribute("aria-pressed", "true");

    clear("admin.metabox.toc.position");
    expect(host.current()).toMatchObject({ position: null, sticky: true });

    clear("admin.metabox.toc.sticky");
    expect(host.current()).toMatchObject({ sticky: null, showInBody: true });

    // Ostatnie zdjęte pole zwija całe nadpisanie do `null`.
    clear("admin.metabox.toc.showInBody");
    expect(host.current()).toBeNull();
    expect(screen.queryByRole("button", { name: "wyczyść nadpisanie" })).toBeNull();
  });

  it("kolumny mają własny link czyszczący, widoczny tylko przy nadpisaniu", () => {
    const { host, view } = mountMetabox({ override: { columns: "col-2" } });

    const clear = screen.getByRole("button", { name: "wyczyść nadpisanie" });
    fireEvent.click(clear);

    // Ostatnie zdjęte pole zwija CAŁE nadpisanie do `null` (reguła `allEmpty`).
    expect(host.current()).toBeNull();
    expect(screen.queryByRole("button", { name: "wyczyść nadpisanie" })).toBeNull();
    expect(columnRadios(view.container)[0].getAttribute("aria-checked")).toBe("true");
  });

  it("reset całości oddaje rodzicowi `null` jednym kliknięciem", () => {
    const { host } = mountMetabox({
      override: { enabled: true, layout: "inline", position: 2, sticky: true },
    });

    fireEvent.click(screen.getByText("admin.metabox.toc.resetAll"));

    expect(host.current()).toBeNull();
    expect(screen.queryByText("admin.metabox.toc.resetAll")).toBeNull();
  });

  it("nadpisanie z samymi `null` NIE liczy się jako nadpisanie", () => {
    const { view } = mountMetabox({ override: { enabled: null, layout: null } });

    expect(screen.queryByText("admin.metabox.toc.resetAll")).toBeNull();
    expect(screen.queryByRole("button", { name: "wyczyść nadpisanie" })).toBeNull();
    expect(enabledButton(view.container, "Globalny")).toHaveAttribute("aria-pressed", "true");
  });
});
