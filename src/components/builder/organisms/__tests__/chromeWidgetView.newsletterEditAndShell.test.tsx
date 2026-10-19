// DYSPOZYTOR CHROME (`ChromeWidgetView`) - NEWSLETTER W NAGŁÓWKU I POWŁOKA TREŚCI.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Parytet HTML-u z pełnym `WidgetView` pilnuje `chromeWidgetViewParity.test.tsx`
// (renderuje bez edycji). Tu dowodzimy ścieżek, których tamten plik nie dotyka:
// * NEWSLETTER W KANWIE: tytuł wyzwalacza (warianty `minimal` i `icon`) jest
//   edytowalny w miejscu i zapis idzie pod klucz JĘZYKA (`title_pl` /
//   `title_en`) - pomyłka klucza nadpisywałaby drugi język; w kanwie wyzwalacz
//   NIE jest linkiem (klik nie może nawigować po edytorze), publicznie jest
//   kotwicą `#newsletter`, a wariant samej ikony ma nazwę dostępną z tytułu,
// * POWŁOKA TREŚCI ramki (`advanced.contentMaxWidth` / `contentAlign` /
//   `contentGap` i wyrównanie z panelu stylu): wartości z panelu trafiają na
//   opakowanie dzieci, a widgety strukturalne (separator) nie są zwijane do
//   szerokości treści - inaczej ich `width:100%` liczyło się od 0 px.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Rejestr leniwy -> lustro eager, klient Supabase i `react-i18next` jako atrapy
// granic (wzór z `widgetViewEditable.test.tsx`). Powłokę mierzymy stylem
// inline, bo to on JEST kontraktem „wartość z panelu -> układ" (klasy ramki są
// stałe i nie niosą danych).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { ChromeWidgetView } from "@/components/builder/organisms/ChromeWidgetView";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

let n = 0;
function renderWidget(
  node: Partial<WidgetNode> & { type: WidgetNode["type"] },
  opts: { lang?: "pl" | "en"; editable?: boolean } = {},
) {
  const onContentChange = vi.fn();
  const full = { id: `cw-${(n += 1)}`, kind: "widget", content: {}, ...node } as WidgetNode;
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ChromeWidgetView
        node={full}
        lang={opts.lang ?? "pl"}
        device="desktop"
        editable={opts.editable}
        onContentChange={opts.editable ? onContentChange : undefined}
      />
    </QueryClientProvider>,
  );
  return { ...view, onContentChange };
}

const newsletter = (content: WidgetContent) => ({ type: "newsletter" as const, content });

/** Pole edycji w miejscu - od 2026-10-18 `Editable` ma rolę textbox. */
const poleEdycji = () => screen.getByRole("textbox");

describe("newsletter w pasku - edycja tytułu w kanwie", () => {
  it.each<["pl" | "en", string]>([
    ["pl", "title_pl"],
    ["en", "title_en"],
  ])("wariant minimal (%s) zapisuje tytuł pod kluczem %s", (lang, klucz) => {
    const { onContentChange } = renderWidget(
      newsletter({ variant: "minimal", title_pl: "Zapisz się", title_en: "Subscribe" }),
      { lang, editable: true },
    );
    const pole = poleEdycji();
    expect(pole.textContent).toBe(lang === "pl" ? "Zapisz się" : "Subscribe");
    pole.textContent = "Nowy tytuł";
    fireEvent.blur(pole);
    expect(onContentChange).toHaveBeenCalledExactlyOnceWith(klucz, "Nowy tytuł");
  });

  it("wariant icon w kanwie: tytuł obok ikony jest edytowalny, a wyzwalacz nie jest linkiem", () => {
    const { onContentChange } = renderWidget(
      newsletter({ variant: "icon", title_en: "Newsletter EN" }),
      { lang: "en", editable: true },
    );
    expect(screen.queryByRole("link")).toBeNull();
    const pole = poleEdycji();
    pole.textContent = "Join us";
    fireEvent.blur(pole);
    expect(onContentChange).toHaveBeenCalledExactlyOnceWith("title_en", "Join us");
  });

  it("ODMOWA: fokus i blur na tytule bez edycji niczego nie zapisują", () => {
    const { onContentChange } = renderWidget(newsletter({ variant: "minimal", title_pl: "Hej" }), {
      editable: true,
    });
    const pole = poleEdycji();
    pole.focus();
    pole.blur();
    expect(onContentChange).not.toHaveBeenCalled();
  });
});

describe("newsletter w pasku - strona publiczna", () => {
  it("wariant icon jest kotwicą #newsletter z tytułem obok ikony", () => {
    renderWidget(newsletter({ variant: "icon", title_pl: "Biuletyn" }));
    const link = screen.getByRole("link", { name: /Biuletyn/ });
    expect(link.getAttribute("href")).toBe("#newsletter");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("wariant samej ikony ma nazwę dostępną z tytułu - inaczej czytnik ogłasza pusty link", () => {
    renderWidget(newsletter({ variant: "icon-only", title_pl: "Biuletyn" }));
    expect(screen.getByRole("link", { name: "Biuletyn" })).toBeInTheDocument();
  });

  it("pusty tytuł w bazie nie zostawia pustego wyzwalacza - wraca „Newsletter”", () => {
    const { container } = renderWidget(newsletter({ variant: "minimal" }));
    expect(container.textContent).toContain("Newsletter");
  });
});

describe("powłoka treści ramki widgetu", () => {
  /** Bezpośrednie opakowanie treści w ramce `[data-w-id]`. */
  const opakowanie = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-w-id] > div")!;

  it("maksymalna szerokość, wyrównanie i odstęp z panelu trafiają na opakowanie dzieci", () => {
    const { container } = renderWidget({
      type: "heading",
      content: { text_pl: "Tytuł" },
      advanced: { contentMaxWidth: 480, contentAlign: "center", contentGap: "1.5rem" },
    });
    const shell = opakowanie(container);
    expect(shell.style.maxWidth).toBe("480px");
    expect(shell.style.alignItems).toBe("center");
    expect(shell.style.gap).toBe("1.5rem");
    expect(shell.style.marginInline).toBe("auto");
  });

  it.each([
    ["end", "flex-end", "marginLeft"],
    ["start", "flex-start", "marginRight"],
  ] as const)("wyrównanie treści %s dosuwa opakowanie do krawędzi", (align, items, margines) => {
    const { container } = renderWidget({
      type: "heading",
      content: { text_pl: "Tytuł" },
      advanced: { contentMaxWidth: "60%", contentAlign: align },
    });
    const shell = opakowanie(container);
    expect(shell.style.alignItems).toBe(items);
    expect(shell.style[margines]).toBe("auto");
  });

  it("bez wyrównania treści opakowanie bierze wyrównanie z panelu stylu", () => {
    const { container } = renderWidget({
      type: "heading",
      content: { text_pl: "Tytuł" },
      style: { align: { desktop: "right" } } as WidgetNode["style"],
      advanced: { contentGap: 8 },
    });
    expect(opakowanie(container).style.alignItems).toBe("flex-end");
    expect(opakowanie(container).style.gap).toBe("8px");
  });

  it("samo wyrównanie z panelu stylu zwija treść i przesuwa ją w kolumnie", () => {
    const { container } = renderWidget({
      type: "heading",
      content: { text_pl: "Tytuł" },
      style: { align: { desktop: "right" } } as WidgetNode["style"],
    });
    const shell = opakowanie(container);
    expect(shell.style.alignSelf).toBe("flex-end");
    expect(shell.style.width).toBe("auto");
  });

  it("ODMOWA: separator z wyrównaniem nie jest zwijany do szerokości treści", () => {
    const { container } = renderWidget({
      type: "divider",
      content: {},
      style: { align: { desktop: "center" } } as WidgetNode["style"],
    });
    // Brak opakowania zwijającego: `width:auto` dawało separatorowi 0 px.
    const dzieci = [...container.querySelectorAll<HTMLElement>("[data-w-id] > div")];
    expect(dzieci.some((el) => el.style.alignSelf === "center" && el.style.width === "auto")).toBe(
      false,
    );
  });
});
