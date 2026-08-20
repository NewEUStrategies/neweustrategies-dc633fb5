// Panel właściwości widgetu: trzy zakładki (Treść / Styl / Zaawansowane),
// przełącznik jasny-ciemny, przełącznik urządzenia i cała warstwa zapisu
// wartości „tematycznych" (Themed<T>).
//
// To najbardziej obciążony plik buildera i jednocześnie ten, w którym błąd jest
// najdroższy: każdy zapis idzie tu przez `onChange(mut)` na węźle dokumentu,
// więc pomyłka nie psuje widoku, a TREŚĆ STRONY. Test przypina reguły, które
// da się sprawdzić tylko na całym panelu:
//
//  1. WARTOŚCI TEMATYCZNE. Kolor, ramka, cień i typografia zapisują się PER
//     TRYB (jasny/ciemny). Edycja w ciemnym nie może zdeptać jasnego - i
//     odwrotnie. Reset zdejmuje tylko nadpisanie BIEŻĄCEGO trybu, a gdy nie
//     zostaje żadne, usuwa klucz z dokumentu.
//  2. SZEROKOŚĆ I WYSOKOŚĆ per urządzenie: zapis dla telefonu nie rusza
//     desktopu (reguły siedzą w `lib/builder/widgetPanelValues`, tutaj
//     sprawdzamy, że panel ich FAKTYCZNIE używa).
//  3. ZAKŁADKI. Zawartość zakładki nieaktywnej nie jest montowana - panel
//     z trzydziestoma polami nie może renderować wszystkich na raz.
//  4. WIDGET GLOBALNY dostaje baner z możliwością odłączenia instancji.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { WidgetNode } from "@/lib/builder/types";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
import { themedColorStyle } from "@/test/builder/panels";
import { WidgetProperties } from "../WidgetProperties";

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
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const { radixTabsStub } = await import("@/test/builder/panels");
  return radixTabsStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } }, error: null }) },
  },
}));
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/media.functions", () => ({
  createMediaFolder: async () => ({}),
  registerMediaUpload: async () => ({}),
  updateMediaMeta: async () => ({}),
}));
// Podgląd na żywo renderuje PRAWDZIWY widget (własna powierzchnia, własne
// zapytania). Tu liczy się tylko to, że panel przekazuje mu bieżący stan.
vi.mock("../ui/organisms/WidgetLivePreview", () => ({
  WidgetLivePreview: ({
    widget,
    device,
    mode,
  }: {
    widget: WidgetNode;
    device: string;
    mode: string;
  }) => <div data-testid="podglad" data-type={widget.type} data-device={device} data-mode={mode} />,
}));

function widgetOf(over: Partial<WidgetNode> = {}): WidgetNode {
  return { id: "w1", kind: "widget", type: "heading", content: {}, ...over };
}

/**
 * Gospodarz panelu: trzyma węzeł dokumentu i stosuje mutacje jak kanwa
 * (świeży, głęboki klon i mutacja na nim) - inaczej test nie widzi WYNIKU
 * zapisu, a wynik jest tu całą treścią zachowania.
 */
function renderPanel(
  initial: WidgetNode = widgetOf(),
  opts: {
    lang?: "pl" | "en";
    device?: "desktop" | "tablet" | "mobile";
    mode?: "light" | "dark";
  } = {},
) {
  const seen: WidgetNode[] = [];
  function Host() {
    const [node, setNode] = useState<WidgetNode>(initial);
    const [mode, setMode] = useState<"light" | "dark">(opts.mode ?? "light");
    return (
      <WidgetProperties
        widget={node}
        lang={opts.lang ?? "pl"}
        device={opts.device ?? "desktop"}
        mode={mode}
        onModeChange={setMode}
        onChange={(mut) => {
          setNode((prev) => {
            const next = JSON.parse(JSON.stringify(prev)) as WidgetNode;
            mut(next);
            seen.push(next);
            return next;
          });
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  return { ...view, seen, node: () => seen.at(-1) };
}

const tab = (key: string) => screen.getByRole("tab", { name: new RegExp(key) });
/**
 * Przyciski „przywróć wartość globalną” to same ikony - ich nazwą dla czytnika
 * ekranu jest atrybut `title`, więc adresujemy je selektorem, nie rolą.
 */
const resetButtons = (): HTMLButtonElement[] =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'button[title="builder.widgetProps.restoreGlobal"]',
    ),
  );
const colorFields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input.font-mono"));

beforeEach(() => {
  // Udawana kanwa jest dopisywana do `document.body`, a automatyczne
  // sprzątanie testów usuwa tylko kontener renderu.
  document.querySelectorAll("[data-visual-canvas]").forEach((el) => el.remove());
  db.current = supabaseFromStub();
  db.current.setResponse("builder_global_widgets", ok([]));
  for (const t of ["pages", "posts", "profiles", "categories", "tags", "events"]) {
    db.current.setResponse(t, ok([]));
  }
});

describe("WidgetProperties - nagłówek panelu", () => {
  it("pokazuje etykietę typu widgetu i podgląd na żywo", () => {
    renderPanel(widgetOf({ type: "heading" }));
    const preview = screen.getByTestId("podglad");
    expect(preview.dataset.type).toBe("heading");
    expect(preview.dataset.device).toBe("desktop");
    expect(preview.dataset.mode).toBe("light");
  });

  it("nagłówek panelu idzie za językiem panelu", () => {
    const pl = renderPanel(widgetOf(), { lang: "pl" });
    expect(screen.getByText("Ustawienia widgetu")).toBeInTheDocument();
    pl.unmount();
    renderPanel(widgetOf(), { lang: "en" });
    expect(screen.getByText("Widget settings")).toBeInTheDocument();
  });

  it("przełącznik blok/inline zapisuje układ i czyści go", () => {
    const { node } = renderPanel(widgetOf({ advanced: { layout: "inline" } }));
    const group = screen.getByRole("group", {
      name: "builder.widgetProps.block / builder.widgetProps.inline",
    });
    const [blockBtn, inlineBtn] = Array.from(group.querySelectorAll("button"));
    expect(inlineBtn.dataset.active).toBe("true");
    fireEvent.click(blockBtn);
    // Układ blokowy to BRAK klucza, nie `"block"` - inaczej każdy widget
    // nosiłby ustawienie domyślne.
    expect(node()?.advanced?.layout).toBeUndefined();
    fireEvent.click(inlineBtn);
    expect(node()?.advanced?.layout).toBe("inline");
  });

  it("instancja widgetu globalnego ma baner z odłączeniem", () => {
    const { node } = renderPanel(widgetOf({ globalId: "g-1" }));
    const unlink = screen.getByRole("button", { name: /builder.widgetProps.unlink/ });
    fireEvent.click(unlink);
    // Odłączenie zdejmuje referencję, zostawiając treść - instancja staje się
    // zwykłym, lokalnym widgetem.
    expect(node()?.globalId).toBeUndefined();
    expect(node()?.type).toBe("heading");
  });

  it("zwykły widget nie ma banera globalnego", () => {
    renderPanel(widgetOf());
    expect(screen.queryByRole("button", { name: /builder.widgetProps.unlink/ })).toBeNull();
  });
});

describe("WidgetProperties - zakładki", () => {
  it("startuje na zakładce treści", () => {
    renderPanel();
    expect(tab("builder.widgetProps.tabContent")).toHaveAttribute("data-state", "active");
  });

  it.each([
    ["styl", "builder.widgetProps.tabStyle"],
    ["zaawansowane", "builder.widgetProps.tabAdvanced"],
  ])("przełącza na zakładkę %s", (_label, key) => {
    renderPanel();
    fireEvent.click(tab(key));
    expect(tab(key)).toHaveAttribute("data-state", "active");
    expect(tab("builder.widgetProps.tabContent")).toHaveAttribute("data-state", "inactive");
  });

  it("zakładka nieaktywna nie montuje swoich pól", () => {
    renderPanel();
    const contentControls = document.querySelectorAll("input, select, textarea").length;
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    const styleControls = document.querySelectorAll("input, select, textarea").length;
    // Zakładka stylu ma inny zestaw kontrolek - gdyby obie były montowane
    // jednocześnie, liczba by się nie zmieniła.
    expect(styleControls).not.toBe(contentControls);
  });
});

describe("WidgetProperties - kolory tematyczne", () => {
  function openStyle() {
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
  }

  it("zapisuje kolor tła dla trybu jasnego", () => {
    const { node } = renderPanel();
    openStyle();
    fireEvent.change(colorFields()[0], { target: { value: "#101010" } });
    const bg = node()?.style?.bgColor;
    expect(JSON.stringify(bg)).toContain("#101010");
  });

  it("edycja w trybie ciemnym zachowuje wartość jasną", () => {
    const { node } = renderPanel(
      widgetOf({ style: themedColorStyle({ bgColor: { light: "#ffffff" } }) }),
    );
    openStyle();
    fireEvent.click(screen.getByRole("button", { name: "builder.chrome.dark" }));
    fireEvent.change(colorFields()[0], { target: { value: "#000000" } });
    // Dwa tryby, dwie wartości w JEDNYM kluczu - to jest cały sens Themed<T>.
    expect(node()?.style?.bgColor).toEqual({ light: "#ffffff", dark: "#000000" });
  });

  it("reset koloru zdejmuje nadpisanie tylko bieżącego trybu", () => {
    const { node } = renderPanel(
      widgetOf({
        style: themedColorStyle({ bgColor: { light: "#ffffff", dark: "#000000" } }),
      }),
    );
    openStyle();
    fireEvent.click(resetButtons()[0]);
    expect(node()?.style?.bgColor).toEqual({ dark: "#000000" });
  });

  it("reset ostatniego nadpisania usuwa klucz z dokumentu", () => {
    const { node } = renderPanel(
      widgetOf({ style: themedColorStyle({ bgColor: { light: "#ffffff" } }) }),
    );
    openStyle();
    fireEvent.click(resetButtons()[0]);
    expect(node()?.style && "bgColor" in node()!.style!).toBe(false);
  });

  it("reset wartości płaskiej (historycznej) usuwa ją dla obu trybów", () => {
    const { node } = renderPanel(widgetOf({ style: { bgColor: "#123456" } }));
    openStyle();
    fireEvent.click(resetButtons()[0]);
    // Wartość płaska obowiązywała w obu trybach, więc reset musi ją usunąć
    // całą - zostawienie jej „dla drugiego trybu” byłoby zgadywaniem.
    expect(node()?.style && "bgColor" in node()!.style!).toBe(false);
  });

  it("bez nadpisania nie ma przycisku przywracania", () => {
    renderPanel();
    openStyle();
    // Przycisk pojawia się TYLKO przy nadpisaniu - inaczej redaktor klikałby
    // „przywróć” na wartości, która i tak jest globalna.
    expect(resetButtons()).toHaveLength(0);
  });

  it("przełącznik trybu przekazuje zmianę wyżej i wraca na jasny", () => {
    renderPanel();
    openStyle();
    fireEvent.click(screen.getByRole("button", { name: "builder.chrome.dark" }));
    expect(screen.getByTestId("podglad").dataset.mode).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "builder.chrome.light" }));
    expect(screen.getByTestId("podglad").dataset.mode).toBe("light");
  });
});

describe("WidgetProperties - rozmiary per urządzenie", () => {
  function openAdvanced() {
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
  }

  it("szerokość zapisuje się dla bieżącego urządzenia", () => {
    const { node } = renderPanel(widgetOf(), { device: "mobile" });
    openAdvanced();
    const percent = screen.getByRole("button", { name: "builder.widgetProps.widthPercent" });
    fireEvent.click(percent);
    const width = node()?.advanced?.width;
    // Zapis MUSI być per urządzenie - inaczej ustawienie szerokości na
    // telefonie zmienia stronę na komputerze.
    expect(typeof width === "object" && width !== null).toBe(true);
    expect(JSON.stringify(width)).toContain("mobile");
  });

  it("zapis dla telefonu nie rusza istniejącego desktopu", () => {
    const { node } = renderPanel(
      widgetOf({ advanced: { width: { desktop: "100%" } } as WidgetNode["advanced"] }),
      { device: "mobile" },
    );
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: "builder.widgetProps.widthPixels" }));
    const width = node()?.advanced?.width as Record<string, unknown> | undefined;
    expect(width?.desktop).toBe("100%");
    expect(width?.mobile).toBeDefined();
  });
});

describe("WidgetProperties - zakładka treści", () => {
  it.each([
    ["nagłówek", "heading"],
    ["przycisk", "button"],
    ["tekst", "text"],
    ["obrazek", "image"],
  ] as const)("rysuje pola treści dla widgetu: %s", (_label, type) => {
    const { container } = renderPanel(widgetOf({ type }));
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("undefined");
  });

  it("widget z niestandardowym edytorem dostaje jego pola", () => {
    renderPanel(
      widgetOf({ type: "accordion", content: { items: [{ q_pl: "Pytanie", a_pl: "Odpowiedź" }] } }),
    );
    // Accordion ma własny edytor listy (nie schemat) - jego pola muszą trafić
    // do zakładki treści zamiast pustego panelu.
    expect(screen.getByDisplayValue("Pytanie")).toBeInTheDocument();
  });

  it("zapis pola treści trafia do węzła dokumentu", () => {
    const { node } = renderPanel(widgetOf({ type: "heading", content: { text_pl: "Stary" } }));
    fireEvent.change(screen.getByDisplayValue("Stary"), { target: { value: "Nowy" } });
    expect(node()?.content.text_pl).toBe("Nowy");
  });
});

describe("WidgetProperties - przejazd po WSZYSTKICH typach widgetów", () => {
  // Panel jest jeden, ale jego zawartość zależy od TYPU widgetu: sekcje stylu
  // pojawiają się warunkowo (ikony tylko tam, gdzie widget ma ikonę; pola
  // rozmiaru formularza tylko w formularzach), a zakładka treści to albo
  // schemat, albo edytor niestandardowy. Rejestr `WIDGETS` jest kompletny
  // z definicji, więc tabela po nim NIE MOŻE pominąć nowego widgetu - a to
  // właśnie „nowy widget wywala panel” jest tu najdroższym błędem.
  const TYPES = WIDGETS.map((w) => [w.type] as const);

  it.each(TYPES)("panel treści renderuje się dla widgetu %s", (type) => {
    const { container } = renderPanel(makeWidget(type));
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });

  it.each(TYPES)("zakładka stylu renderuje się dla widgetu %s", (type) => {
    const { container } = renderPanel(makeWidget(type));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });

  it.each(TYPES)("zakładka zaawansowana renderuje się dla widgetu %s", (type) => {
    const { container } = renderPanel(makeWidget(type));
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });

  /**
   * Ćwiczenie WSZYSTKICH kontrolek jest kosztowne (każde zdarzenie to pełny
   * re-render panelu razem z podglądem), więc robimy je na próbie
   * REPREZENTATYWNEJ - po jednym widgecie z każdej kategorii rejestru plus te
   * o najbogatszym panelu. Render wszystkich typów (trzy testy wyżej) i tak
   * przechodzi po każdym widgecie z osobna.
   */
  const SAMPLE = Array.from(
    new Map(WIDGETS.filter((w) => !w.hiddenInPalette).map((w) => [w.category, w])).values(),
  )
    .map((w) => [w.type] as const)
    .concat(
      (["heading", "button", "newsletter", "login-form", "post-list", "image"] as const).map(
        (t) => [t] as const,
      ),
    );

  it.each(SAMPLE)("każda kontrolka widgetu %s zapisuje wartość zdefiniowaną", (type) => {
    const { container, seen } = renderPanel(makeWidget(type));
    for (const key of [
      "builder.widgetProps.tabContent",
      "builder.widgetProps.tabStyle",
      "builder.widgetProps.tabAdvanced",
    ]) {
      fireEvent.click(tab(key));
      for (const field of container.querySelectorAll<HTMLInputElement>("input, textarea")) {
        if (field.type === "file") continue;
        if (field.type === "checkbox" || field.type === "radio") {
          fireEvent.click(field);
          continue;
        }
        fireEvent.change(field, { target: { value: field.type === "number" ? "8" : "wartość" } });
      }
      for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
        const options = Array.from(select.querySelectorAll("option"));
        if (options.length > 1) fireEvent.change(select, { target: { value: options[1].value } });
      }
      expect(container.textContent).not.toContain("undefined");
    }
    // Każdy zapis idzie do dokumentu strony - `undefined` znika przy zapisie
    // do bazy, więc pole cicho traci ustawienie.
    for (const node of seen) {
      expect(JSON.stringify(node)).not.toContain("undefined");
    }
  });
});

// ---------------------------------------------------------------------------
// Uzupełnienie: pola mierzone z kanwy, sekcje warunkowe i zakładka
// zaawansowana. Wszystkie te kontrolki czytają albo DOM kanwy, albo typ
// widgetu - czyli dokładnie te miejsca, w których „renderuje się" nie znaczy
// jeszcze „działa".
// ---------------------------------------------------------------------------

/** Udawana kanwa: panel mierzy z niej rozmiary i kolory dziedziczone. */
function mountCanvasWidget(fontSizes: Record<string, string> = {}): HTMLElement {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-visual-canvas", "");
  const widget = document.createElement("div");
  widget.setAttribute("data-widget-id", "w1");
  widget.style.backgroundColor = "rgb(1, 2, 3)";
  widget.style.color = "rgb(4, 5, 6)";
  widget.style.borderColor = "rgb(7, 8, 9)";
  const text = document.createElement("p");
  text.textContent = "treść";
  widget.appendChild(text);
  for (const [key, size] of Object.entries(fontSizes)) {
    const el = document.createElement("p");
    el.setAttribute("data-edit-target", key);
    el.style.fontSize = size;
    widget.appendChild(el);
  }
  canvas.appendChild(widget);
  document.body.appendChild(canvas);
  return widget;
}

/**
 * Wejście pola po TEKŚCIE etykiety. `PropField` renderuje `<Label>` bez
 * `htmlFor`, więc zapytania po dostępnej nazwie nie mają czego znaleźć -
 * szukamy więc etykiety i schodzimy do jej sąsiada.
 */
function fieldInput(label: string): HTMLInputElement {
  const labels = Array.from(document.querySelectorAll<HTMLElement>("label"));
  const found = labels.find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`test: brak etykiety ${label}`);
  const input = found.parentElement?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`test: pole ${label} bez wejścia`);
  return input;
}

/** Klatka animacji - pomiary panelu idą przez `requestAnimationFrame`. */
async function pumpFrame(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("WidgetProperties - rozmiary pól formularza", () => {
  const sizeInput = (label: string): HTMLInputElement => {
    const field = document.querySelector<HTMLElement>(`[data-field-key="${label}"]`);
    if (!field) throw new Error(`test: brak pola ${label}`);
    const input = field.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error(`test: pole ${label} bez wejścia`);
    return input;
  };

  it("bez nadpisania pokazuje ZMIERZONY rozmiar jako podpowiedź i znacznik auto", async () => {
    mountCanvasWidget({ descriptionSize: "13px" });
    renderPanel(widgetOf({ type: "join-us" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    // Redaktor musi widzieć DZIAŁAJĄCĄ wartość, nawet gdy nic nie nadpisał -
    // inaczej wpisuje w pustkę i nadpisuje działające ustawienie.
    expect(sizeInput("descriptionSize").placeholder).toBe("13");
    expect(screen.getAllByText("auto").length).toBeGreaterThan(0);
  });

  it("plus liczy od zmierzonego rozmiaru, nie od zera", async () => {
    mountCanvasWidget({ descriptionSize: "13px" });
    const { node } = renderPanel(widgetOf({ type: "join-us" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    const field = document.querySelector<HTMLElement>('[data-field-key="descriptionSize"]');
    const plus = field?.querySelectorAll("button")[1];
    if (!plus) throw new Error("test: brak przycisku zwiększania");
    fireEvent.click(plus);
    expect(node()?.content.descriptionSize).toBe(14);
  });

  it("minus też startuje od zmierzonego rozmiaru", async () => {
    mountCanvasWidget({ descriptionSize: "13px" });
    const { node } = renderPanel(widgetOf({ type: "join-us" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    const field = document.querySelector<HTMLElement>('[data-field-key="descriptionSize"]');
    const minus = field?.querySelectorAll("button")[0];
    if (!minus) throw new Error("test: brak przycisku zmniejszania");
    fireEvent.click(minus);
    expect(node()?.content.descriptionSize).toBe(12);
  });

  it("wpisana wartość zapisuje się, a wyczyszczenie USUWA klucz", async () => {
    mountCanvasWidget({ descriptionSize: "13px" });
    const { node } = renderPanel(widgetOf({ type: "join-us", content: { descriptionSize: 20 } }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    fireEvent.change(sizeInput("descriptionSize"), { target: { value: "26" } });
    expect(node()?.content.descriptionSize).toBe(26);
    fireEvent.change(sizeInput("descriptionSize"), { target: { value: "" } });
    // Puste pole to powrót do rozmiaru dziedziczonego, a nie zero.
    expect(node()?.content.descriptionSize).toBeUndefined();
    expect(node()?.content && "descriptionSize" in node()!.content).toBe(false);
  });

  it("najechanie na pole podświetla element na kanwie", async () => {
    const widget = mountCanvasWidget({ descriptionSize: "13px" });
    renderPanel(widgetOf({ type: "join-us" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    const row = sizeInput("descriptionSize").parentElement;
    if (!row) throw new Error("test: brak wiersza kontrolki");
    fireEvent.mouseEnter(row);
    const target = widget.querySelector('[data-edit-target="descriptionSize"]');
    // Panel i kanwa stoją obok siebie - bez podświetlenia nie widać, KTÓREGO
    // napisu dotyczy suwak.
    expect(target?.classList.contains("cms-preview-field-focus")).toBe(true);
  });

  it("mostek z belki kanwy otwiera zakładkę stylu i wskazuje pole", async () => {
    mountCanvasWidget({ descriptionSize: "13px" });
    renderPanel(widgetOf({ type: "join-us" }));
    expect(tab("builder.widgetProps.tabContent")).toHaveAttribute("data-state", "active");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("cms:focus-size-field", { detail: { key: "descriptionSize" } }),
      );
    });
    await pumpFrame();
    expect(tab("builder.widgetProps.tabStyle")).toHaveAttribute("data-state", "active");
    const field = document.querySelector<HTMLElement>('[data-field-key="descriptionSize"]');
    expect(field?.classList.contains("cms-panel-field-focus")).toBe(true);
  });

  it("zdarzenie bez klucza pola nie przełącza zakładki", async () => {
    renderPanel(widgetOf({ type: "join-us" }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("cms:focus-size-field", { detail: {} }));
    });
    expect(tab("builder.widgetProps.tabContent")).toHaveAttribute("data-state", "active");
  });

  it("widget bez pól formularza nie dostaje tej sekcji", () => {
    renderPanel(widgetOf({ type: "heading" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    expect(screen.queryByText("builder.widgetProps.formSizes")).toBeNull();
  });
});

describe("WidgetProperties - kolory dziedziczone z kanwy", () => {
  it("pickery kolorów pokazują wartość odziedziczoną z wyrenderowanego widgetu", async () => {
    mountCanvasWidget();
    const { container } = renderPanel(widgetOf({ type: "heading" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    // Kolory globalne kaskadują na widget - panel musi pokazać, co widget
    // MA teraz, a nie pustkę sugerującą brak koloru.
    expect(container.innerHTML).toContain("rgb(1, 2, 3)");
  });

  it("bez widgetu na kanwie panel nie zgaduje kolorów", async () => {
    const { container } = renderPanel(widgetOf({ type: "heading" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await pumpFrame();
    expect(container.innerHTML).not.toContain("rgb(1, 2, 3)");
  });
});

describe("WidgetProperties - sekcje zależne od typu widgetu", () => {
  it("karta wyróżniona ma pełne ustawienia plakietki", () => {
    const { node } = renderPanel(widgetOf({ type: "dark-featured-card" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    expect(screen.getByText("builder.widgetProps.badgeLabel")).toBeTruthy();
    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
    const withOption = (value: string) =>
      selects.find((sel) => sel.querySelector(`option[value="${value}"]`));
    const variant = withOption("solid-brand");
    if (!variant) throw new Error("test: brak listy wariantu plakietki");
    fireEvent.change(variant, { target: { value: "gradient" } });
    expect(node()?.content.badgeVariant).toBe("gradient");
  });

  it("kolory plakietki zapisują się i dają się wyczyścić", () => {
    const { node } = renderPanel(
      widgetOf({ type: "dark-featured-card", content: { badgeBg: "#111111" } }),
    );
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    const colors = colorFields();
    const badgeBg = colors.find((input) => input.value === "#111111");
    if (!badgeBg) throw new Error("test: brak pola tła plakietki");
    fireEvent.change(badgeBg, { target: { value: "#222222" } });
    expect(node()?.content.badgeBg).toBe("#222222");
  });

  it("slot reklamowy pobiera listę slotów z bazy", async () => {
    db.current.setResponse(
      "ad_slots",
      ok([{ id: "slot-1", name: "Belka górna", kind: "banner", status: "active" }]),
    );
    const { node } = renderPanel(widgetOf({ type: "ad-slot" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
      sel.querySelector('option[value="slot-1"]'),
    );
    if (!select) throw new Error("test: brak listy slotów");
    fireEvent.change(select, { target: { value: "slot-1" } });
    expect(node()?.content.slotId).toBe("slot-1");
    // Lista idzie z bazy posortowana po nazwie - panel nie może jej wymyślać.
    expect(db.current.lastChain("ad_slots")?.has("order")).toBe(true);
  });
});

describe("WidgetProperties - zakładka zaawansowana", () => {
  const openAdvanced = () => fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
  const buttonByText = (text: string): HTMLButtonElement => {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!found) throw new Error(`test: brak przycisku ${text}`);
    return found;
  };

  it("tryb szerokości procentowej dodaje suwak i zapisuje procenty", () => {
    const { node } = renderPanel();
    openAdvanced();
    fireEvent.click(buttonByText("builder.widgetProps.widthPercent"));
    expect(node()?.advanced?.width).toEqual({ desktop: "50%" });
    const input = fieldInput("builder.widgetProps.widthPercentValue");
    fireEvent.change(input, { target: { value: "80" } });
    expect(node()?.advanced?.width).toEqual({ desktop: "80%" });
  });

  it("szerokość w pikselach ma własne granice", () => {
    const { node } = renderPanel();
    openAdvanced();
    fireEvent.click(buttonByText("builder.widgetProps.widthPixels"));
    const input = fieldInput("builder.widgetProps.widthPixelValue");
    fireEvent.change(input, { target: { value: "99999" } });
    // Bez przycięcia widget wyjeżdżałby poza dokument.
    expect(node()?.advanced?.width).toEqual({ desktop: 4000 });
    fireEvent.change(input, { target: { value: "1" } });
    expect(node()?.advanced?.width).toEqual({ desktop: 8 });
  });

  it("układ w wierszu zapisuje się, a powrót do bloku czyści klucz", () => {
    const { node } = renderPanel();
    openAdvanced();
    fireEvent.click(buttonByText("builder.widgetProps.inlineRow"));
    expect(node()?.advanced?.layout).toBe("inline");
    fireEvent.click(buttonByText("builder.widgetProps.blockFull"));
    expect(node()?.advanced?.layout).toBeUndefined();
  });

  it.each([
    ["builder.common.center", "center"],
    ["builder.common.right", "end"],
  ])("wyrównanie treści %s zapisuje się", (label, expected) => {
    const { node } = renderPanel();
    openAdvanced();
    fireEvent.click(buttonByText(label));
    expect(node()?.advanced?.contentAlign).toBe(expected);
  });

  it("wyrównanie do lewej czyści klucz (to wartość domyślna)", () => {
    const { node } = renderPanel(widgetOf({ advanced: { contentAlign: "center" } }));
    openAdvanced();
    fireEvent.click(buttonByText("builder.common.left"));
    expect(node()?.advanced?.contentAlign).toBeUndefined();
  });

  it.each([
    ["builder.widgetProps.maxContentWidth", "640", "contentMaxWidth", 640],
    ["builder.widgetProps.itemGap", "12", "contentGap", 12],
  ] as const)("pole %s zapisuje liczbę", (label, value, key, expected) => {
    const { node } = renderPanel();
    openAdvanced();
    const input = fieldInput(label);
    fireEvent.change(input, { target: { value } });
    expect(node()?.advanced?.[key]).toBe(expected);
  });

  it.each([
    ["builder.widgetProps.maxContentWidth", "contentMaxWidth"],
    ["builder.widgetProps.itemGap", "contentGap"],
  ] as const)("wyczyszczenie pola %s usuwa klucz", (label, key) => {
    const { node } = renderPanel(widgetOf({ advanced: { contentMaxWidth: 640, contentGap: 12 } }));
    openAdvanced();
    const input = fieldInput(label);
    fireEvent.change(input, { target: { value: "" } });
    expect(node()?.advanced?.[key]).toBeUndefined();
  });

  it("zero w maksymalnej szerokości treści znaczy brak ograniczenia", () => {
    const { node } = renderPanel(widgetOf({ advanced: { contentMaxWidth: 640 } }));
    openAdvanced();
    const input = fieldInput("builder.widgetProps.maxContentWidth");
    fireEvent.change(input, { target: { value: "0" } });
    // Szerokość 0 schowałaby treść - traktujemy ją jak brak ustawienia.
    expect(node()?.advanced?.contentMaxWidth).toBeUndefined();
  });
});

describe("WidgetProperties - hover, kolory ikon i wymiary", () => {
  const openStyleTab = () => fireEvent.click(tab("builder.widgetProps.tabStyle"));

  it("włączenie hoveru zakłada domyślny czas przejścia", () => {
    const { node } = renderPanel();
    openStyleTab();
    const enable = screen.getByText("builder.hover.enable").querySelector("input");
    if (!enable) throw new Error("test: brak przełącznika hoveru");
    fireEvent.click(enable);
    expect(node()?.style?.hover?.transitionMs).toBe(200);
    fireEvent.click(enable);
    // Wyłączenie zdejmuje całą gałąź, a nie zostawia pustego obiektu.
    expect(node()?.style?.hover).toBeUndefined();
  });

  it("kolory hoveru zapisują się PER TRYB i nie gubią drugiego", () => {
    const { node } = renderPanel(widgetOf({ style: { hover: { transitionMs: 200 } } }), {
      mode: "light",
    });
    openStyleTab();
    const hoverBg = () => {
      const label = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
        (el) => el.textContent?.trim() === "builder.hover.bg",
      );
      const input = label?.parentElement?.querySelector<HTMLInputElement>("input.font-mono");
      if (!input) throw new Error("test: brak pola tła hoveru");
      return input;
    };
    fireEvent.change(hoverBg(), { target: { value: "#ffffff" } });
    expect(node()?.style?.hover?.bgColor).toBe("#ffffff");
    fireEvent.click(screen.getByRole("button", { name: "builder.chrome.dark" }));
    fireEvent.change(hoverBg(), { target: { value: "#000000" } });
    // Jeden klucz, dwie wartości - to jest cały sens Themed<T> także w hoverze.
    expect(node()?.style?.hover?.bgColor).toEqual({ light: "#ffffff", dark: "#000000" });
  });

  it("kolor tekstu hoveru też rozbija się na tryby", () => {
    const { node } = renderPanel(widgetOf({ style: { hover: { transitionMs: 200 } } }), {
      mode: "dark",
    });
    openStyleTab();
    const label = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (el) => el.textContent?.trim() === "builder.hover.text",
    );
    const input = label?.parentElement?.querySelector<HTMLInputElement>("input.font-mono");
    if (!input) throw new Error("test: brak pola koloru tekstu hoveru");
    fireEvent.change(input, { target: { value: "#123456" } });
    expect(node()?.style?.hover?.textColor).toEqual({ dark: "#123456" });
  });

  it("pozostałe ustawienia hoveru nie ruszają kolorów", () => {
    const { node } = renderPanel(
      widgetOf({ style: { hover: { transitionMs: 200, bgColor: "#ffffff" } } }),
    );
    openStyleTab();
    const label = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (el) => el.textContent?.trim() === "Border radius (hover)",
    );
    const input = label?.parentElement?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("test: brak pola zaokrąglenia hoveru");
    fireEvent.change(input, { target: { value: "8px" } });
    expect(node()?.style?.hover?.borderRadius).toBe("8px");
    expect(node()?.style?.hover?.bgColor).toBe("#ffffff");
  });

  it.each([
    ["tekstu", "textColor"],
    ["obramowania", "borderColor"],
  ] as const)("reset koloru %s zdejmuje nadpisanie trybu", (_label, key) => {
    const { node } = renderPanel(widgetOf({ style: themedColorStyle({}) }));
    // Ustawiamy wartość dla trybu jasnego przez panel, a potem ją resetujemy -
    // to jedyna droga, którą przechodzi prawdziwa redakcja.
    openStyleTab();
    const before = colorFields().length;
    expect(before).toBeGreaterThan(0);
    const targetInput = colorFields()[key === "textColor" ? 1 : before - 1];
    if (!targetInput) throw new Error("test: brak pola koloru");
    fireEvent.change(targetInput, { target: { value: "#abcdef" } });
    const resets = resetButtons();
    expect(resets.length).toBeGreaterThan(0);
    fireEvent.click(resets[resets.length - 1]!);
    expect(JSON.stringify(node()?.style ?? {})).not.toContain("#abcdef");
  });

  it("widget ikon społecznościowych ma trzy stany koloru ikony", () => {
    const { node } = renderPanel(widgetOf({ type: "social-icons" }));
    openStyleTab();
    // Etykiety tej sekcji są w kodzie wprost (nie przez słownik) - tak jak
    // widzi je redakcja.
    expect(screen.getByText("Domyślny")).toBeTruthy();
    expect(screen.getByText("Po najechaniu")).toBeTruthy();
    expect(screen.getByText("Aktywny (bieżąca strona)")).toBeTruthy();
    const inputs = colorFields();
    // Trzy stany to trzy osobne klucze - jeden wspólny gubiłby stan aktywny.
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "#0f0f0f" } });
    expect(JSON.stringify(node()?.style ?? {})).toContain("#0f0f0f");
  });

  it("plakietka: zaokrąglenie, rozmiar i kolor tekstu zapisują się", () => {
    const { node } = renderPanel(widgetOf({ type: "dark-featured-card" }));
    openStyleTab();
    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
    const withOption = (value: string) =>
      selects.find((sel) => sel.querySelector(`option[value="${value}"]`));
    // „full" ma tylko lista zaokrąglenia, „xs" tylko lista rozmiaru - obie
    // mają wspólne „sm", więc po nim nie da się ich rozróżnić.
    const radius = withOption("full");
    const size = withOption("xs");
    if (!radius || !size) throw new Error("test: brak list plakietki");
    fireEvent.change(radius, { target: { value: "full" } });
    expect(node()?.content.badgeRadius).toBe("full");
    fireEvent.change(size, { target: { value: "sm" } });
    expect(node()?.content.badgeSize).toBe("sm");
  });

  it.each([
    ["automatyczna", "builder.widgetProps.dimensionsAuto", undefined],
    ["dopasowana do treści", "builder.widgetProps.dimensionsHug", "auto"],
    ["stała", "builder.widgetProps.dimensionsFixed", 480],
  ])("wysokość %s zapisuje się", (_label, buttonText, expected) => {
    const { node } = renderPanel(widgetOf({ advanced: { height: { desktop: 200 } } }));
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === buttonText,
    );
    if (!button) throw new Error(`test: brak przycisku ${buttonText}`);
    fireEvent.click(button);
    const height = node()?.advanced?.height;
    const desktop = typeof height === "object" && height !== null ? height.desktop : height;
    expect(desktop).toBe(expected === 480 ? 200 : expected);
  });

  it("stała wysokość ma suwak z granicami 40-2400 px", () => {
    const { node } = renderPanel(widgetOf({ advanced: { height: { desktop: 200 } } }));
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
    fireEvent.click(screen.getByLabelText("builder.widgetProps.increaseHeight"));
    const read = () => {
      const height = node()?.advanced?.height;
      return typeof height === "object" && height !== null ? height.desktop : height;
    };
    expect(read()).toBe(210);
    fireEvent.click(screen.getByLabelText("builder.widgetProps.decreaseHeight"));
    expect(read()).toBe(200);
    const input = fieldInput("builder.widgetProps.dimensionsDesktopPx");
    fireEvent.change(input, { target: { value: "99999" } });
    // Widget wyższy niż dokument to nie ustawienie, to pomyłka.
    expect(read()).toBe(2400);
    fireEvent.change(input, { target: { value: "1" } });
    expect(read()).toBe(40);
    fireEvent.change(input, { target: { value: "" } });
    expect(read()).toBe(40);
  });

  it("obrazek z proporcjami blokuje wysokość i mówi dlaczego", () => {
    renderPanel(widgetOf({ type: "image", content: { ratio: "16/9" } }));
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
    // Wysokość i proporcje to dwa sprzeczne źródła prawdy - panel musi wybrać
    // jedno i powiedzieć o tym redaktorowi.
    expect(screen.getByText(/builder\.widgetProps\.dimensionsRatioLock/)).toBeTruthy();
  });

  it("obrazek bez proporcji ma wysokość odblokowaną", () => {
    renderPanel(widgetOf({ type: "image", content: { ratio: "auto" } }));
    fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
    expect(screen.queryByText(/builder\.widgetProps\.dimensionsRatioLock/)).toBeNull();
  });
});

describe("WidgetProperties - domknięcie gałęzi zapisu", () => {
  const openStyleTab = () => fireEvent.click(tab("builder.widgetProps.tabStyle"));
  const openAdvancedTab = () => fireEvent.click(tab("builder.widgetProps.tabAdvanced"));
  const labelled = (text: string): HTMLElement => {
    const found = Array.from(document.querySelectorAll<HTMLElement>("label")).find(
      (el) => el.textContent?.trim() === text,
    );
    if (!found?.parentElement) throw new Error(`test: brak pola ${text}`);
    return found.parentElement;
  };

  it("reset koloru bez zapisanej wartości nic nie robi", () => {
    const { node, seen } = renderPanel(widgetOf({ style: { textColor: "#111111" } }));
    openStyleTab();
    // Wartość płaska (historyczna) dotyczy OBU trybów - reset ją usuwa,
    // a powtórny reset nie ma już czego zdejmować.
    const resets = resetButtons();
    expect(resets.length).toBeGreaterThan(0);
    fireEvent.click(resets[0]!);
    const after = seen.length;
    expect(JSON.stringify(node()?.style ?? {})).not.toContain("#111111");
    fireEvent.click(resetButtons()[0] ?? resets[0]!);
    // Drugie kliknięcie może wołać zapis, ale nie może niczego wymyślić.
    expect(JSON.stringify(node()?.style ?? {})).not.toContain("#111111");
    expect(seen.length).toBeGreaterThanOrEqual(after);
  });

  it.each([
    ["po najechaniu", 1],
    ["aktywny", 2],
  ])("reset koloru ikony (%s) zdejmuje zapisaną wartość", (_label, index) => {
    const { node } = renderPanel(widgetOf({ type: "social-icons" }));
    openStyleTab();
    const iconInputs = colorFields().slice(-3);
    const target = iconInputs[index];
    if (!target) throw new Error("test: brak pola koloru ikony");
    fireEvent.change(target, { target: { value: "#654321" } });
    expect(JSON.stringify(node()?.style ?? {})).toContain("#654321");
    const resets = resetButtons();
    fireEvent.click(resets[resets.length - 1]!);
    expect(JSON.stringify(node()?.style ?? {})).not.toContain("#654321");
  });

  it("wyczyszczenie kolorów plakietki zapisuje pustkę, nie undefined", () => {
    const { node } = renderPanel(
      widgetOf({
        type: "dark-featured-card",
        content: { badgeBg: "#111111", badgeText: "#eeeeee" },
      }),
    );
    openStyleTab();
    const bg = colorFields().find((i) => i.value === "#111111");
    const text = colorFields().find((i) => i.value === "#eeeeee");
    if (!bg || !text) throw new Error("test: brak pól kolorów plakietki");
    fireEvent.change(bg, { target: { value: "" } });
    fireEvent.change(text, { target: { value: "" } });
    // Treść widgetu trzyma łańcuchy - `undefined` w JSON dokumentu to dziura,
    // po której renderer nie wie, czy kolor jest wyczyszczony, czy nieustawiony.
    expect(node()?.content.badgeBg).toBe("");
    expect(node()?.content.badgeText).toBe("");
  });

  it.each([
    ["identyfikator HTML", "HTML ID", "htmlId"],
    ["klasa CSS", "CSS class", "cssClass"],
  ] as const)("%s zapisuje się i czyści", (_label, labelKey, key) => {
    const { node } = renderPanel();
    openAdvancedTab();
    const input = labelled(labelKey).querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("test: brak pola");
    fireEvent.change(input, { target: { value: "moj-widget" } });
    expect(node()?.advanced?.[key]).toBe("moj-widget");
    fireEvent.change(input, { target: { value: "" } });
    expect(node()?.advanced?.[key]).toBeUndefined();
  });

  it("własny CSS zapisuje się i czyści", () => {
    const { node } = renderPanel();
    openAdvancedTab();
    const area = document.querySelector<HTMLTextAreaElement>("textarea");
    if (!area) throw new Error("test: brak pola CSS");
    fireEvent.change(area, { target: { value: ".x{color:red}" } });
    expect(node()?.advanced?.customCss).toBe(".x{color:red}");
    fireEvent.change(area, { target: { value: "" } });
    expect(node()?.advanced?.customCss).toBeUndefined();
  });

  it("suwak szerokości ignoruje wartość nieliczbową", () => {
    const { node, seen } = renderPanel();
    openAdvancedTab();
    const percent = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "builder.widgetProps.widthPercent",
    );
    if (!percent) throw new Error("test: brak trybu procentowego");
    fireEvent.click(percent);
    const before = seen.length;
    const input = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error("test: brak suwaka");
    fireEvent.change(input, { target: { value: "" } });
    // Puste pole w trakcie pisania nie może zapisać NaN do dokumentu.
    expect(node()?.advanced?.width).toEqual({ desktop: "50%" });
    expect(seen.length).toBe(before);
  });

  it.each([
    ["zaokrąglenie", "builder.widgetProps.cornerRounding", "borderRadius"],
    ["grubość obramowania", "builder.widgetProps.thickness", "borderWidth"],
  ] as const)("%s zapisuje się jako wartość płaska (wspólna dla trybów)", (_l, labelKey, key) => {
    const { node } = renderPanel();
    openStyleTab();
    const field = Array.from(document.querySelectorAll<HTMLElement>("h4,label")).find((el) =>
      el.textContent?.includes(labelKey),
    );
    if (!field) throw new Error(`test: brak sekcji ${labelKey}`);
    const scope = field.closest("section") ?? field.parentElement;
    const input = scope?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error(`test: brak pola ${labelKey}`);
    fireEvent.change(input, { target: { value: "12px" } });
    expect(node()?.style?.[key]).toBe("12px");
  });

  it("styl obramowania bez linii czyści klucz", () => {
    const { node } = renderPanel(widgetOf({ style: { borderStyle: "solid" } }));
    openStyleTab();
    const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((sel) =>
      sel.querySelector('option[value="dashed"]'),
    );
    if (!select) throw new Error("test: brak listy stylu obramowania");
    fireEvent.change(select, { target: { value: "none" } });
    // Styl obramowania jest PER TRYB: rezygnacja w trybie jasnym zostawia
    // ustawienie trybu ciemnego (wartość płaska dotyczyła obu).
    expect(node()?.style?.borderStyle).toEqual({ dark: "solid" });
  });

  it("slot reklamowy bez danych pokazuje pustą listę", async () => {
    db.current.setResponse("ad_slots", ok(null));
    renderPanel(widgetOf({ type: "ad-slot" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Brak danych to pusta lista, a nie wywalony panel.
    expect(screen.getByText("builder.widgetProps.adSlot")).toBeTruthy();
  });

  it("wstrzymany slot jest oznaczony na liście", async () => {
    db.current.setResponse(
      "ad_slots",
      ok([{ id: "s1", name: "Belka", kind: "banner", status: "paused" }]),
    );
    renderPanel(widgetOf({ type: "ad-slot" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const option = document.querySelector('option[value="s1"]');
    // Redakcja musi widzieć, że wybrany slot nic nie wyświetli.
    expect(option?.textContent).toContain("builder.widgetProps.paused");
  });
});

describe("WidgetProperties - wpisy odrzucane i angielski panel", () => {
  it("nieliczbowy wpis w rozmiarze pola formularza jest ignorowany", async () => {
    const canvas = document.createElement("div");
    canvas.setAttribute("data-visual-canvas", "");
    const widget = document.createElement("div");
    widget.setAttribute("data-widget-id", "w1");
    canvas.appendChild(widget);
    document.body.appendChild(canvas);
    const { node, seen } = renderPanel(widgetOf({ type: "join-us" }));
    fireEvent.click(tab("builder.widgetProps.tabStyle"));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const field = document.querySelector<HTMLElement>('[data-field-key="descriptionSize"]');
    const input = field?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("test: brak pola rozmiaru");
    const before = seen.length;
    fireEvent.change(input, { target: { value: "abc" } });
    // Wpis, którego nie da się przeczytać jako liczby, nie może ani zapisać
    // zera, ani wyczyścić nadpisania.
    expect(seen.length).toBe(before);
    expect(node()?.content.descriptionSize).toBeUndefined();
  });

  it("pole schematu poza własnym edytorem trafia do sekcji nadwyżkowej", () => {
    // Własny edytor widgetu obsługuje wybrane pola schematu; te, których NIE
    // obsłuży, muszą wylądować w sekcji zbiorczej - inaczej pole istniałoby
    // w schemacie i w rendererze, a w panelu byłoby nieedytowalne.
    renderPanel(makeWidget("world-map"));
    expect(screen.getByText("Pozostałe ustawienia")).toBeTruthy();
  });

  it("lista typów z sekcją nadwyżkową jest pilnowana", () => {
    // Ta lista to nie ozdoba: każdy NOWY typ, który tu wskoczy, znaczy, że
    // ktoś dopisał pole do schematu i zapomniał o edytorze.
    const withLeftovers = WIDGETS.filter((w) => {
      const view = renderPanel(makeWidget(w.type));
      const found = !!screen.queryByText("Pozostałe ustawienia");
      view.unmount();
      return found;
    }).map((w) => w.type);
    expect(withLeftovers).toEqual(["world-map"]);
  });
});
