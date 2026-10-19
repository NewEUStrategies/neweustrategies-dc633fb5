// SliderEditor - lista slajdów RĘCZNYCH (źródło „manual").
//
// Podgląd na żywo ma własny test (`sliderEditorPreviewParity`), katalogi
// wariantów - `variantDrivenEditors`. Tu przypinamy to, czego nie sprawdzał
// nikt: co lista slajdów zapisuje do dokumentu.
//  1. Dodanie dopisuje pusty slajd na końcu, strzałki zamieniają sąsiadów
//     (na krańcach są wyłączone), „×" usuwa wskazany slajd.
//  2. Pola slajdu piszą klucze języka panelu w TYM slajdzie; awatar i slug
//     autora (bez kontrolek, przychodzą z podpiętego wpisu) przeżywają każdą
//     edycję - inaczej podgląd rysował sam inicjał.
//  3. Podpięcie wpisu zapisuje jego IDENTYFIKATOR, a pole obrazu zmienia się
//     w „nadpisanie okładki".
//  4. Źródło „posts" nie pokazuje listy ręcznej wcale.
//
// Granice: Supabase (łańcuch z `@/test/supabaseChain`; wpisy dla podglądu
// i pickera), atrapy Radix Select/Switch, i18n jako echo klucza, tenant
// i server fny jak w sąsiednich testach (slot obrazka wysyła pliki).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { SliderEditor } from "../SliderEditor";

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
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));
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

const SLIDE_A = {
  image: "https://cdn.test/a.jpg",
  title_pl: "Pierwszy",
  title_en: "First",
  author: "Anna Nowak",
  authorAvatar: "https://cdn.test/anna.png",
  authorSlug: "anna-nowak",
};
const SLIDE_B = { image: "https://cdn.test/b.jpg", title_pl: "Drugi", title_en: "Second" };

function renderSlider(initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <SliderEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const items = () =>
    (written.filter(([k]) => k === "items").at(-1)?.[1] ?? []) as Array<Record<string, unknown>>;
  return { ...view, written, items };
}

const manual = (...slides: Array<Record<string, Json>>): WidgetNode["content"] => ({
  source: "manual",
  items: slides,
});

/** Karty slajdów: każda ma nagłówek „builder.sliderEditor.slideTitle(n=…)". */
const slideCard = (n: number): HTMLElement => {
  const heading = screen.getByText(`builder.sliderEditor.slideTitle(n=${n})`);
  const card = heading.closest<HTMLElement>("div.rounded-md");
  if (!card) throw new Error(`test: brak karty slajdu ${n}`);
  return card;
};
/** `PropField` nie wiąże etykiety z kontrolką - szukamy w jej opakowaniu. */
const fieldIn = (card: HTMLElement, label: string): HTMLInputElement => {
  const el = within(card).getByText(label, { selector: "label" }).parentElement;
  const input = el?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`test: brak pola „${label}"`);
  return input;
};

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse(
    "posts",
    ok([{ id: "p-1", slug: "raport", title_pl: "Raport roczny", title_en: "Annual report" }]),
  );
  for (const table of ["categories", "tags", "profiles_public"])
    db.current.setResponse(table, ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SliderEditor - lista slajdów ręcznych", () => {
  it("sam render niczego nie zapisuje", () => {
    const { written } = renderSlider(manual(SLIDE_A, SLIDE_B));
    expect(written).toEqual([]);
  });

  it("dodanie dopisuje pusty slajd na końcu, istniejące zostają", () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B));
    fireEvent.click(screen.getByRole("button", { name: "builder.sliderEditor.addSlide" }));
    expect(items()).toHaveLength(3);
    expect(items()[0]).toMatchObject(SLIDE_A);
    expect(items()[1]).toMatchObject(SLIDE_B);
    expect(items()[2]).toEqual({
      image: "",
      title_pl: "",
      title_en: "",
      subtitle_pl: "",
      subtitle_en: "",
      href: "",
      cta_pl: "",
      cta_en: "",
    });
  });

  it("strzałka w dół zamienia slajd z następnym", () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B));
    fireEvent.click(within(slideCard(1)).getByRole("button", { name: "↓" }));
    expect(items().map((x) => x.title_pl)).toEqual(["Drugi", "Pierwszy"]);
    fireEvent.click(within(slideCard(2)).getByRole("button", { name: "↑" }));
    expect(items().map((x) => x.title_pl)).toEqual(["Pierwszy", "Drugi"]);
  });

  it("na krańcach listy strzałki są wyłączone", () => {
    renderSlider(manual(SLIDE_A, SLIDE_B));
    expect(within(slideCard(1)).getByRole("button", { name: "↑" })).toBeDisabled();
    expect(within(slideCard(2)).getByRole("button", { name: "↓" })).toBeDisabled();
    expect(within(slideCard(1)).getByRole("button", { name: "↓" })).toBeEnabled();
  });

  it('„×" usuwa wskazany slajd, nie pierwszy', () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B));
    fireEvent.click(within(slideCard(2)).getByRole("button", { name: "×" }));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject(SLIDE_A);
  });

  it("pola slajdu w EN piszą klucze EN w tym slajdzie, autor z wpisu przeżywa edycję", () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B), "en");
    const card = slideCard(1);
    fireEvent.change(fieldIn(card, "builder.sliderEditor.title(lang=EN)"), {
      target: { value: "Opening" },
    });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.subtitle(lang=EN)"), {
      target: { value: "Lead" },
    });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.link"), { target: { value: "/post/x" } });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.cta(lang=EN)"), {
      target: { value: "Read" },
    });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.category(lang=EN)"), {
      target: { value: "Energy" },
    });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.author"), {
      target: { value: "Jan Kowalski" },
    });
    fireEvent.change(fieldIn(card, "builder.sliderEditor.readTime"), {
      target: { value: "5 min" },
    });
    expect(items()[0]).toMatchObject({
      ...SLIDE_A,
      title_en: "Opening",
      subtitle_en: "Lead",
      href: "/post/x",
      cta_en: "Read",
      category_en: "Energy",
      author: "Jan Kowalski",
      readTime: "5 min",
      // Bez kontrolek w panelu, ale nie mogą zniknąć przy edycji.
      authorAvatar: "https://cdn.test/anna.png",
      authorSlug: "anna-nowak",
    });
    // Polska wersja i drugi slajd bez zmian.
    expect(items()[0]?.title_pl).toBe("Pierwszy");
    expect(items()[1]).toMatchObject(SLIDE_B);
  });

  it("adres obrazu zapisuje się w slajdzie, a jego wyczyszczenie - pusty napis", () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B));
    const url = within(slideCard(2)).getByPlaceholderText("builder.imageSlot.urlPlaceholder");
    fireEvent.change(url, { target: { value: "https://cdn.test/c.jpg" } });
    expect(items()[1]?.image).toBe("https://cdn.test/c.jpg");
    fireEvent.click(within(slideCard(2)).getByTitle("builder.common.delete"));
    expect(items()[1]?.image).toBe("");
    expect(items()[0]?.image).toBe(SLIDE_A.image);
  });

  it("podpięcie wpisu zapisuje jego identyfikator, a obraz staje się nadpisaniem okładki", async () => {
    const { items } = renderSlider(manual(SLIDE_A, SLIDE_B));
    const card = slideCard(2);
    expect(within(card).getByText("builder.sliderEditor.image")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "builder.picker.bindPost" }));
    fireEvent.change(within(card).getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "rap" },
    });
    fireEvent.click(await within(card).findByRole("button", { name: "Raport roczny" }));
    expect(items()[1]?.postId).toBe("p-1");
    await waitFor(() =>
      expect(
        within(slideCard(2)).getByText("builder.sliderEditor.imageOverride"),
      ).toBeInTheDocument(),
    );
  });

  it("pusta lista ręczna pokazuje komunikat o braku slajdów", () => {
    renderSlider({ source: "manual", items: [] });
    expect(screen.getByText("builder.sliderEditor.noSlides")).toBeInTheDocument();
  });

  it('źródło „posts" nie pokazuje listy ręcznej', () => {
    renderSlider({ source: "posts", items: [SLIDE_A] });
    expect(screen.queryByRole("button", { name: "builder.sliderEditor.addSlide" })).toBeNull();
    expect(screen.queryByText("builder.sliderEditor.slideTitle(n=1)")).toBeNull();
  });

  it("śmieci w liście slajdów (nie-obiekty) nie robią kart", () => {
    renderSlider({ source: "manual", items: ["x", null, SLIDE_B] as Json[] });
    expect(screen.getByText("builder.sliderEditor.slideTitle(n=1)")).toBeInTheDocument();
    expect(screen.queryByText("builder.sliderEditor.slideTitle(n=2)")).toBeNull();
  });
});
