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
import { screen, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { WidgetNode } from "@/lib/builder/types";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
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
      widgetOf({ style: { bgColor: { light: "#ffffff" } } as WidgetNode["style"] }),
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
        style: { bgColor: { light: "#ffffff", dark: "#000000" } } as WidgetNode["style"],
      }),
    );
    openStyle();
    fireEvent.click(resetButtons()[0]);
    expect(node()?.style?.bgColor).toEqual({ dark: "#000000" });
  });

  it("reset ostatniego nadpisania usuwa klucz z dokumentu", () => {
    const { node } = renderPanel(
      widgetOf({ style: { bgColor: { light: "#ffffff" } } as WidgetNode["style"] }),
    );
    openStyle();
    fireEvent.click(resetButtons()[0]);
    expect(node()?.style && "bgColor" in node()!.style!).toBe(false);
  });

  it("reset wartości płaskiej (historycznej) usuwa ją dla obu trybów", () => {
    const { node } = renderPanel(
      widgetOf({ style: { bgColor: "#123456" } as unknown as WidgetNode["style"] }),
    );
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
