// AccordionEditor: kontrolka wariantu (dotąd nieistniejąca, mimo że renderer
// obsługiwał trzy warianty) oraz seedowanie nowej pozycji w OBU językach.
//
// Regresje przypięte tutaj:
//  1. `variant` nie był zapisywany przez nic - ani schemat, ani edytor, ani
//     defaulty palety - więc bordered/separated/minimal było martwym kodem,
//  2. „Dodaj" seedowało wyłącznie aktywny język, więc pozycja dodana w EN
//     renderowała puste pytanie na polskiej wersji strony.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { toJson, type Json, type WidgetContent, type WidgetNode } from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { AccordionEditor } from "../AccordionEditor";
import { renderSimpleWidget } from "@/components/builder/organisms/widget-view/SimpleWidgets";

// Podział kodu (React.lazy) zamieniony na importy statyczne. Bez tego pierwszy
// render widgetu z rejestru pokazuje fallback Suspense, który na stronie
// publicznej jest `null` - test widzi PUSTKĘ i uznaje każde ustawienie za
// martwe. Ten sam mock mają siostrzane pliki (np. `widgetBehavior.test.tsx`);
// tutaj zabrakło go po przeniesieniu widgetów do rejestru leniwego (01253dc).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

type Recorded = Array<[string, Json]>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const setContent = vi.fn((k: string, v: Json) => {
    calls.push([k, v]);
  });
  render(<AccordionEditor c={content} lang={lang} setContent={setContent} />);
  return { calls, setContent };
}

function itemsFrom(calls: Recorded): Array<Record<string, unknown>> {
  const last = calls.filter(([key]) => key === "items").at(-1);
  const value = last?.[1];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function Accordion({ content, lang }: { content: WidgetContent; lang: "pl" | "en" }) {
  const node: WidgetNode = { id: "acc-1", kind: "widget", type: "accordion", content };
  return <>{renderSimpleWidget(node, lang, undefined, false)}</>;
}

describe("AccordionEditor - wariant", () => {
  it("offers exactly the variants the renderer can draw", () => {
    renderEditor({ items: [] });
    const group = screen.getByRole("group");
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toHaveLength(3);
  });

  it("marks the stored variant as active and commits a new one", () => {
    const { calls, setContent } = renderEditor({ items: [], variant: "minimal" });
    const group = screen.getByRole("group");
    const buttons = Array.from(group.querySelectorAll("button"));
    const active = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(active).toHaveLength(1);

    // Klikamy wariant, który nie jest aktywny.
    const other = buttons.find((b) => b.getAttribute("aria-pressed") === "false");
    fireEvent.click(other as HTMLElement);
    expect(setContent).toHaveBeenCalledWith("variant", expect.any(String));
    expect(calls.some(([key]) => key === "variant")).toBe(true);
  });

  it("falls back to the bordered variant for empty or unknown content", () => {
    for (const content of [{}, { variant: "kosmiczny" }] as WidgetContent[]) {
      cleanup();
      renderEditor(content);
      const pressed = Array.from(screen.getByRole("group").querySelectorAll("button")).filter(
        (b) => b.getAttribute("aria-pressed") === "true",
      );
      expect(pressed).toHaveLength(1);
      expect(pressed[0].textContent).toBe(
        Array.from(screen.getByRole("group").querySelectorAll("button"))[0].textContent,
      );
    }
  });

  it("ships a variant default in the palette so a fresh widget is not undefined", () => {
    const defaults = WIDGETS.find((w) => w.type === "accordion")?.defaults();
    expect(defaults?.variant).toBe("bordered");
  });
});

describe("accordion renderer - warianty są realnie rysowane", () => {
  const items = [{ q_pl: "P", a_pl: "<p>O</p>" }];

  it("renders a different container per variant", () => {
    const classes = ["bordered", "separated", "minimal"].map((variant) => {
      cleanup();
      const { container } = render(<Accordion content={{ items, variant }} lang="pl" />);
      return (container.firstElementChild as HTMLElement).className;
    });
    expect(new Set(classes).size).toBe(3);
  });

  it("treats an unknown variant as bordered instead of dropping the frame", () => {
    const { container: unknown } = render(
      <Accordion content={{ items, variant: "kosmiczny" }} lang="pl" />,
    );
    const unknownCls = (unknown.firstElementChild as HTMLElement).className;
    cleanup();
    const { container: bordered } = render(
      <Accordion content={{ items, variant: "bordered" }} lang="pl" />,
    );
    expect(unknownCls).toBe((bordered.firstElementChild as HTMLElement).className);
  });
});

describe("AccordionEditor - nowa pozycja ma oba języki", () => {
  it.each(["pl", "en"] as const)("seeds q_pl/q_en and a_pl/a_en when adding in %s", (lang) => {
    const { calls } = renderEditor({ items: [] }, lang);
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));

    const items = itemsFrom(calls);
    expect(items).toHaveLength(1);
    for (const key of ["q_pl", "q_en", "a_pl", "a_en"]) {
      expect(typeof items[0][key]).toBe("string");
      expect(items[0][key]).not.toBe("");
    }
    // Seed nie jest tym samym napisem w obu językach - inaczej "oba języki"
    // byłoby tylko duplikatem aktywnej lokalizacji.
    expect(items[0].q_pl).not.toBe(items[0].q_en);
  });

  it("renders the freshly added item in both languages", () => {
    const { calls } = renderEditor({ items: [] }, "en");
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    const items = itemsFrom(calls);
    cleanup();

    const { container: plView } = render(
      <Accordion content={{ items: toJson(items) }} lang="pl" />,
    );
    expect(plView.querySelector("summary")?.textContent?.trim()).not.toBe("▾");
    expect(plView.textContent).toContain(String(items[0].q_pl));
    cleanup();

    const { container: enView } = render(
      <Accordion content={{ items: toJson(items) }} lang="en" />,
    );
    expect(enView.textContent).toContain(String(items[0].q_en));
  });

  it("keeps existing items untouched when appending", () => {
    const existing = { q_pl: "Stare", q_en: "Old", a_pl: "A", a_en: "A" };
    const { calls } = renderEditor({ items: [existing] }, "pl");
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    const items = itemsFrom(calls);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(existing);
  });
});
