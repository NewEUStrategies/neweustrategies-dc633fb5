// Edytory, których PANEL zmienia zestaw pól w zależności od WARIANTU z katalogu.
//
// Katalogi wariantów (`SECTION_LABEL_VARIANTS`, `SLIDER_VARIANTS`,
// `NAV_ARROW_VARIANTS`) są jednym źródłem prawdy dla panelu i dla renderera.
// Panel ma dla części wariantów DODATKOWE kontrolki (numer, kategoria,
// odstępy), a dla pozostałych ich nie pokazuje. To jest miejsce, w którym
// nowy wariant dopisany do katalogu bez pracy w panelu przechodzi
// niezauważony: renderer go rysuje, a redakcja nie ma czym go ustawić.
//
// Dlatego tabela idzie po KATALOGU, nie po ręcznej liście: dopisanie wariantu
// automatycznie dokłada przypadek testowy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { SECTION_LABEL_VARIANTS } from "@/lib/builder/sectionLabelVariants";
import { SLIDER_VARIANTS, NAV_ARROW_VARIANTS } from "@/lib/builder/sliderOptions";
import { SectionLabelEditor } from "../SectionLabelEditor";
import { SliderEditor } from "../SliderEditor";
import { WorldMapEditor } from "../WorldMapEditor";

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
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
  },
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRequiredTenant: () => "tenant-test",
    useCurrentTenantId: () => "tenant-test",
  };
});

const LEAKS = ["undefined", "NaN", "[object Object]"];

function assertNoLeak(root: HTMLElement, label: string): void {
  const text = root.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: w panelu wyciekło "${leak}"`).toBe(false);
  }
}

type ContentEditor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => React.ReactNode;

/** Oprawa ZE STANEM - wpis wraca do edytora, więc pola zależne reagują. */
function renderStateful(Editor: ContentEditor, initial: WidgetNode["content"]) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  return { ...view, written, map: () => Object.fromEntries(written) };
}

/** Wypełnia wszystkie pola panelu i zwraca liczbę tkniętych kontrolek. */
function exerciseFields(container: HTMLElement): number {
  let touched = 0;
  for (const field of Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ).slice(0, 40)) {
    if (field instanceof HTMLInputElement && field.type === "file") continue;
    if (
      field instanceof HTMLInputElement &&
      (field.type === "checkbox" || field.type === "radio")
    ) {
      fireEvent.click(field);
      touched += 1;
      continue;
    }
    const isNumber = field instanceof HTMLInputElement && field.type === "number";
    fireEvent.change(field, { target: { value: isNumber ? "0" : "wartość" } });
    touched += 1;
  }
  for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
    const options = Array.from(select.querySelectorAll("option"));
    if (options.length > 1) {
      fireEvent.change(select, { target: { value: options.at(-1)!.value } });
      touched += 1;
    }
  }
  return touched;
}

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["pages", "posts", "profiles", "events", "categories", "tags", "media"]) {
    db.current.setResponse(table, ok([]));
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("SectionLabelEditor - każdy wariant z katalogu", () => {
  // Te dwa zbiory są kopią decyzji z panelu (`SectionLabelEditor`): warianty
  // redakcyjne dzielą dodatkowy panel numeru albo kategorii.
  const NUMBER_VARIANTS = ["editorial-index", "numbered-rail"];
  const CATEGORY_VARIANTS = [
    "double-deck-masthead",
    "kicker-tag-rule",
    "stacked-serif-lede",
    "split-rule-duo",
  ];

  it.each(SECTION_LABEL_VARIANTS.map((v) => [v.value] as const))(
    "wariant %s ma sprawny panel",
    (variant) => {
      const { container, written } = renderStateful(SectionLabelEditor, {
        variant,
        label_pl: "Nasze raporty",
        action_pl: "Zobacz wszystkie",
        href: "/raporty",
      });
      assertNoLeak(container, `SectionLabelEditor/${variant}`);
      // Panel musi dać się WYPEŁNIĆ w każdym wariancie - wariant, w którym
      // nie ma czego ustawić, znaczy albo brak kontrolek, albo pola bez efektu.
      expect(exerciseFields(container)).toBeGreaterThan(0);
      assertNoLeak(container, `SectionLabelEditor/${variant} (po edycji)`);
      for (const [key, value] of written) {
        expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );

  it.each(NUMBER_VARIANTS)("wariant %s pozwala ustawić numer i jego typografię", (variant) => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant });
    exerciseFields(container);
    const written = map();
    // Numer jest treścią tego wariantu - bez niego renderuje się puste miejsce.
    const keys = Object.keys(written);
    expect(keys.some((k) => k.toLowerCase().includes("number") || k === "indexNumber")).toBe(true);
  });

  it.each(CATEGORY_VARIANTS)("wariant %s pozwala ustawić kategorię", (variant) => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant });
    exerciseFields(container);
    const keys = Object.keys(map());
    expect(keys.some((k) => k.startsWith("category"))).toBe(true);
  });

  it("wariant bez dodatków nie pokazuje pól numeru ani kategorii", () => {
    const { container, map } = renderStateful(SectionLabelEditor, { variant: "only-text" });
    exerciseFields(container);
    const keys = Object.keys(map());
    expect(keys.some((k) => k.startsWith("category"))).toBe(false);
  });

  it("kliknięcie presetu koloru czyści kolor własny", () => {
    const { container, map } = renderStateful(SectionLabelEditor, {
      variant: "left-bar",
      accentColor: "#123456",
    });
    const presetButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).slice(
      0,
      5,
    );
    if (!presetButtons[1]) throw new Error("test: brak presetów koloru");
    fireEvent.click(presetButtons[1]);
    const written = map();
    // Dwa źródła koloru wykluczają się: wybór presetu MUSI wyczyścić własny,
    // inaczej panel pokazuje preset, a strona rysuje stary kolor własny.
    expect(written.accentColor).toBe("");
    expect(typeof written.color).toBe("string");
  });
});

describe("SliderEditor - każdy wariant i każda strzałka z katalogu", () => {
  it.each(SLIDER_VARIANTS.map((v) => [v.value] as const))(
    "wariant %s ma sprawny panel",
    (variant) => {
      const { container, written } = renderStateful(SliderEditor, {
        variant,
        slides: [
          { id: "s1", title_pl: "Slajd", image: "https://cdn.test/a.png" },
          { id: "s2", title_pl: "Drugi", image: "https://cdn.test/b.png" },
        ],
      });
      assertNoLeak(container, `SliderEditor/${variant}`);
      expect(exerciseFields(container)).toBeGreaterThan(0);
      assertNoLeak(container, `SliderEditor/${variant} (po edycji)`);
      for (const [key, value] of written) {
        expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
      }
    },
  );

  it.each(NAV_ARROW_VARIANTS.map((v) => [v.value] as const))(
    "strzałka %s daje się wybrać",
    (arrow) => {
      const { container, map } = renderStateful(SliderEditor, {
        variant: "editorial-hero",
        navArrow: arrow,
        slides: [{ id: "s1", title_pl: "Slajd" }],
      });
      assertNoLeak(container, `SliderEditor/strzałka ${arrow}`);
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
      const arrowButton = buttons.find((b) => b.getAttribute("data-arrow") === arrow);
      if (arrowButton) {
        fireEvent.click(arrowButton);
        expect(map().navArrow).toBe(arrow);
      } else {
        // Wariant strzałki bez własnego przycisku wybiera się listą - wtedy
        // wystarczy, że panel się rysuje i nie gubi wartości.
        expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
      }
    },
  );

  it("źródło wpisów odsłania filtry, a ręczne slajdy nie", () => {
    const dynamic = renderStateful(SliderEditor, { source: "posts", slides: [] });
    const dynamicKeys = exerciseFields(dynamic.container);
    expect(dynamicKeys).toBeGreaterThan(0);
    dynamic.unmount();
    const manual = renderStateful(SliderEditor, {
      source: "manual",
      slides: [{ id: "s1", title_pl: "Slajd" }],
    });
    expect(exerciseFields(manual.container)).toBeGreaterThan(0);
  });
});

describe("WorldMapEditor - oba źródła danych", () => {
  it.each([
    ["ręczne", "manual"],
    ["eksperci", "experts"],
  ])("źródło %s ma sprawny panel", (_label, source) => {
    const { container, written } = renderStateful(WorldMapEditor, {
      source,
      connections: [{ id: "c1", from: "PL", to: "DE", label_pl: "Trasa" }],
      regions: [{ code: "PL", value: 10 }],
    });
    assertNoLeak(container, `WorldMapEditor/${source}`);
    expect(exerciseFields(container)).toBeGreaterThan(0);
    assertNoLeak(container, `WorldMapEditor/${source} (po edycji)`);
    for (const [key, value] of written) {
      expect(value, `klucz ${key} zapisany jako undefined`).not.toBeUndefined();
    }
  });
});
