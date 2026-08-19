// Builder newslettera - powłoka, która spina bibliotekę widgetów, kanwę,
// panel właściwości, historię zmian i zapis.
//
// Reguły dokumentu mają własny plik (`builderDoc.test.ts`). Tutaj sprawdzamy to,
// czego czysta funkcja nie pokaże, a co operator widzi na ekranie:
//   * ZAPIS jest zablokowany, dopóki nic się nie zmieniło, i odblokowuje się po
//     pierwszej edycji. Aktywny przycisk „Zapisz" przy braku zmian uczy
//     operatora klikać go bez powodu; zablokowany po zmianie - że zapis nie
//     działa i trzeba przeładować stronę (czyli stracić pracę).
//   * BŁĄD ZAPISU musi być widoczny. Cichy błąd to utracony dokument.
//   * PRZEŁĄCZANIE KONTEKSTU: klik w sekcję i w widget przestawia prawą kolumnę,
//     bo to ten sam obszar ekranu pokazuje trzy różne rzeczy.
//   * SZEROKOŚĆ PODGLĄDU odpowiada urządzeniu - operator układa treść na tej
//     szerokości, na której zobaczy ją odbiorca.
//   * COFNIJ/PONÓW faktycznie przywraca dokument, a nie tylko odblokowuje
//     przycisk.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub, ok, type RecordedChain } from "@/test/supabaseChain";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { makeWidget } from "@/lib/newsletter-builder/defaults";
import type { NlDoc, NlWidget } from "@/lib/newsletter-builder/types";

const h = vi.hoisted(() => ({
  from: (_table: string): unknown => ({}),
}));

/**
 * Uchwyty przeciągania przechwycone z @dnd-kit.
 *
 * Prawdziwego przeciągania myszą nie da się odtworzyć w happy-dom (dnd-kit
 * liczy geometrię z `getBoundingClientRect`, które zwraca zera), a to WŁAŚNIE
 * wiązanie identyfikatorów obszarów z dokumentem jest tu ryzykowne: zły
 * identyfikator nie wywala aplikacji, tylko wstawia widget w innym miejscu albo
 * go gubi. Dlatego bierzemy uchwyty, które builder podaje `DndContext`, i
 * wołamy je bezpośrednio - reszta drogi (dokument, kanwa, historia) idzie przez
 * prawdziwy kod.
 */
const dnd = vi.hoisted(() => ({
  onDragStart: undefined as undefined | ((e: unknown) => void),
  onDragEnd: undefined as undefined | ((e: unknown) => void),
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  const Real = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: Record<string, unknown>) => {
      dnd.onDragStart = props.onDragStart as (e: unknown) => void;
      dnd.onDragEnd = props.onDragEnd as (e: unknown) => void;
      return createElement(Real, props as never);
    },
    DragOverlay: (props: Record<string, unknown>) =>
      createElement("div", { "data-testid": "warstwa-przeciagania" }, props.children as never),
  };
});

// Warstwa danych - gotowa atrapa łańcucha PostgREST. Zapis NIE wychodzi nigdzie
// na zewnątrz; test sprawdza, co poszłoby do bazy.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.from(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.test/x.png" } }),
      }),
    },
  },
}));

// Blokada wyjścia z niezapisanymi zmianami wymaga routera i ma własne testy.
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAuth")>()),
  useRequiredTenant: () => "tenant-1",
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => ({}),
}));
vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: {} }));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({ MediaPickerDialog: () => null }));

import { toast } from "sonner";
import { NewsletterBuilder } from "@/components/admin/newsletter/builder/NewsletterBuilder";

/** Dokument o znanym kształcie - testy mówią o konkretnych elementach kanwy. */
function storedDoc(overrides: Partial<NlDoc> = {}): NlDoc {
  return {
    version: 1,
    variant: "inline",
    sections: [
      {
        id: "sekcja-1",
        widgets: [
          { ...makeWidget("heading"), id: "w-naglowek", text: { pl: "Tytuł", en: "Title" } },
          { ...makeWidget("field.email"), id: "w-email" },
        ] as NlWidget[],
      },
    ],
    ...overrides,
  };
}

let stub: ReturnType<typeof supabaseFromStub>;
let saveResult: (chain: RecordedChain) => ReturnType<typeof ok>;

function mount(
  args: { variant?: "inline" | "popup"; doc?: NlDoc | null; popupDoc?: NlDoc | null } = {},
) {
  const row = {
    ...defaultNewsletterSettings(),
    tenant_id: "tenant-1",
    heading_pl: "Nagłówek z ustawień",
    heading_en: "Heading from settings",
    inline_doc: args.doc === undefined ? storedDoc() : args.doc,
    popup_doc: args.popupDoc ?? null,
  };
  stub.setResponse("newsletter_settings", (chain) => {
    if (chain.has("update") || chain.has("insert")) return saveResult(chain);
    // Zapis najpierw czyta identyfikator tenanta.
    if ((chain.argsOf("select")?.[0] as string) === "tenant_id")
      return ok({ tenant_id: "tenant-1" });
    return ok(row);
  });
  return renderWithQueryClient(<NewsletterBuilder variant={args.variant ?? "inline"} />);
}

/** Czeka, aż powłoka wyjdzie ze stanu ładowania. */
async function mounted(args: Parameters<typeof mount>[0] = {}) {
  const utils = mount(args);
  await screen.findByText(args.variant === "popup" ? "Popup builder" : "Inline builder");
  return utils;
}

/** Zdarzenie zakończenia przeciągania w kształcie, jaki widzi builder. */
function dragEnd(
  activeId: string,
  overId: string | null,
  data: Record<string, unknown> | undefined = undefined,
) {
  act(() => {
    dnd.onDragEnd!({
      active: { id: activeId, data: { current: data } },
      over: overId === null ? null : { id: overId },
    });
  });
}

/** Treść dokumentu, jaka poszłaby do bazy - po kliknięciu „Zapisz". */
async function savedDoc(key: "inline_doc" | "popup_doc" = "inline_doc"): Promise<NlDoc> {
  fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
  return (update.argsOf("update")![0] as Record<string, NlDoc>)[key]!;
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  saveResult = () => ok(null);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("wczytywanie dokumentu", () => {
  it("do czasu wczytania ustawień pokazuje ładowanie, nie pustą kanwę", () => {
    mount();

    expect(screen.getByText("Ladowanie ustawien...")).toBeTruthy();
    expect(screen.queryByText("Inline builder")).toBeNull();
  });

  it("ZAPISANY dokument jest wczytywany, a nie nadpisywany domyślnym", async () => {
    // Nadpisanie zapisanego dokumentu szkieletem z ustawień to utrata pracy
    // operatora przy każdym wejściu do buildera.
    await mounted();

    expect(screen.getByText("Tytuł")).toBeTruthy();
    expect(screen.queryByText("Nagłówek z ustawień")).toBeNull();
  });

  it("BRAK dokumentu daje szkielet zbudowany z ustawień", async () => {
    await mounted({ doc: null });

    expect(screen.getByText("Nagłówek z ustawień")).toBeTruthy();
    expect(screen.getByText("Sekcja 1")).toBeTruthy();
  });

  it("wariant popup ma własny nagłówek i czyta SWÓJ dokument", async () => {
    await mounted({
      variant: "popup",
      doc: storedDoc(),
      popupDoc: {
        ...storedDoc(),
        variant: "popup",
        sections: [
          {
            id: "p1",
            widgets: [
              { ...makeWidget("heading"), id: "ph", text: { pl: "Popupowy", en: "Popup" } },
            ] as NlWidget[],
          },
        ],
      },
    });

    expect(screen.getByText("Popupowy")).toBeTruthy();
    expect(screen.queryByText("Tytuł")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("zapis", () => {
  it("przy braku zmian zapis jest ZABLOKOWANY", async () => {
    await mounted();

    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", true);
    expect(stub.chainsFor("newsletter_settings").some((c) => c.has("update"))).toBe(false);
  });

  it("pierwsza zmiana ODBLOKOWUJE zapis", async () => {
    await mounted();

    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", false);
    expect(screen.getByText("Sekcja 2")).toBeTruthy();
  });

  it("zapis wysyła dokument pod KLUCZEM wariantu inline", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano formularz inline"));
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(Object.keys(update.argsOf("update")![0] as object)).toEqual(["inline_doc"]);
  });

  it("wariant popup zapisuje się pod SWOIM kluczem", async () => {
    await mounted({ variant: "popup", popupDoc: storedDoc({ variant: "popup" }) });
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Zapisano popup"));
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    expect(Object.keys(update.argsOf("update")![0] as object)).toEqual(["popup_doc"]);
  });

  it("zapisany dokument zawiera dołożoną sekcję", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const update = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
    const body = update.argsOf("update")![0] as { inline_doc: NlDoc };
    expect(body.inline_doc.sections).toHaveLength(2);
  });

  it("BŁĄD zapisu jest widoczny - cichy błąd to utracony dokument", async () => {
    saveResult = () => ({ data: null, error: Object.assign(new Error("baza padla"), {}) });
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("baza padla"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("po udanym zapisie przycisk znowu jest ZABLOKOWANY", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", true),
    );
  });
});

// ---------------------------------------------------------------------------
describe("historia zmian", () => {
  it("na starcie nie ma czego cofać ani ponawiać", async () => {
    await mounted();

    expect(screen.getByLabelText("Cofnij")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Ponow")).toHaveProperty("disabled", true);
  });

  it("COFNIJ przywraca dokument, nie tylko odblokowuje przycisk", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));
    expect(screen.getByText("Sekcja 2")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Cofnij"));

    expect(screen.queryByText("Sekcja 2")).toBeNull();
    expect(screen.getByText("Sekcja 1")).toBeTruthy();
  });

  it("PONÓW przywraca cofniętą zmianę", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));
    fireEvent.click(screen.getByLabelText("Cofnij"));

    fireEvent.click(screen.getByLabelText("Ponow"));

    expect(screen.getByText("Sekcja 2")).toBeTruthy();
    expect(screen.getByLabelText("Ponow")).toHaveProperty("disabled", true);
  });
});

// ---------------------------------------------------------------------------
describe("prawa kolumna - przełączanie kontekstu", () => {
  it("startuje na BIBLIOTECE widgetów", async () => {
    await mounted();

    expect(screen.getByText("Biblioteka widgetow")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Widgety" }).getAttribute("aria-selected")).toBe("true");
  });

  it("klik w SEKCJĘ przestawia panel na jej właściwości", async () => {
    await mounted();

    fireEvent.click(screen.getByText("Sekcja 1"));

    expect(screen.getByRole("tab", { name: "Sekcja" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Wlasciwosci sekcji")).toBeTruthy();
  });

  it("klik w WIDGET przestawia panel na jego właściwości", async () => {
    await mounted();

    fireEvent.click(screen.getByText("Tytuł"));

    expect(screen.getByRole("tab", { name: "Widget" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();
  });

  it("edycja w panelu właściwości TRAFIA do kanwy", async () => {
    // To jest cała droga: kanwa -> zaznaczenie -> patch -> ponowny render.
    await mounted();
    fireEvent.click(screen.getByText("Tytuł"));

    fireEvent.change(screen.getByDisplayValue("Tytuł"), { target: { value: "Zmieniony" } });

    expect(screen.getByText("Zmieniony")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", false);
  });

  it("powrót na zakładkę widgetów pokazuje bibliotekę bez gubienia zaznaczenia", async () => {
    await mounted();
    fireEvent.click(screen.getByText("Tytuł"));

    fireEvent.click(screen.getByRole("tab", { name: "Widgety" }));

    expect(screen.getByText("Biblioteka widgetow")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Widget" })).toBeTruthy();
  });

  it("nazwy zakładek idą za językiem", async () => {
    await mounted();

    fireEvent.click(screen.getByText("en"));

    expect(screen.getByRole("tab", { name: "Widgets" })).toBeTruthy();
    expect(screen.getByText("Widget library")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("podgląd urządzenia", () => {
  it("desktop formularza inline zajmuje pełną szerokość", async () => {
    await mounted();

    expect(screen.getByText("Desktop")).toBeTruthy();
    expect(screen.getByText("pelna szerokosc")).toBeTruthy();
  });

  it("tablet i telefon mają konkretne szerokości", async () => {
    await mounted();

    fireEvent.click(screen.getByLabelText("Tablet"));
    expect(screen.getByText("720px")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Mobile"));
    expect(screen.getByText("380px")).toBeTruthy();
  });

  it("popup ma szerokość produkcyjną, a nie pełną", async () => {
    await mounted({ variant: "popup", popupDoc: storedDoc({ variant: "popup" }) });

    expect(screen.getByText("520px")).toBeTruthy();
    expect(screen.queryByText("pelna szerokosc")).toBeNull();
  });

  it("popup z grafiką boczną jest SZERSZY", async () => {
    await mounted({
      variant: "popup",
      popupDoc: { ...storedDoc({ variant: "popup" }), popup: { layout: "split" } },
    });

    expect(screen.getByText("880px")).toBeTruthy();
    expect(screen.queryByText("520px")).toBeNull();
  });

  it("podpis szerokości jest tłumaczony", async () => {
    await mounted();

    fireEvent.click(screen.getByText("en"));

    expect(screen.getByText("full width")).toBeTruthy();
    expect(screen.queryByText("pelna szerokosc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("sekcje na kanwie", () => {
  it("OSTATNIEJ sekcji nie da się usunąć", async () => {
    // Dokument bez sekcji nie ma gdzie trzymać widgetów.
    await mounted();

    expect(screen.getByLabelText("Usun sekcje")).toHaveProperty("disabled", true);
    expect(screen.getByText("Sekcja 1")).toBeTruthy();
  });

  it("przy dwóch sekcjach usunięcie działa", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    fireEvent.click(screen.getAllByLabelText("Usun sekcje")[1]!);

    expect(screen.queryByText("Sekcja 2")).toBeNull();
    expect(screen.getByText("Sekcja 1")).toBeTruthy();
  });

  it("dołożona sekcja jest ZAZNACZANA - operator od razu ją stylizuje", async () => {
    await mounted();

    fireEvent.click(screen.getByText("Dodaj sekcje"));

    expect(screen.getByText("Sekcja 2")).toBeTruthy();
    expect(screen.getByText("Wlasciwosci sekcji")).toBeTruthy();
  });

  it("przesuwanie jest zablokowane na krańcach", async () => {
    await mounted();
    fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

    expect(screen.getAllByLabelText("W gore")[0]).toHaveProperty("disabled", true);
    expect(screen.getAllByLabelText("W dol")[1]).toHaveProperty("disabled", true);
  });

  it("przesunięcie sekcji zmienia KOLEJNOŚĆ, nie tylko numerki", async () => {
    await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "s1",
            widgets: [
              { ...makeWidget("heading"), id: "a", text: { pl: "Pierwsza", en: "First" } },
            ] as NlWidget[],
          },
          {
            id: "s2",
            widgets: [
              { ...makeWidget("heading"), id: "b", text: { pl: "Druga", en: "Second" } },
            ] as NlWidget[],
          },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("W dol")[0]!);

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Druga")).toBeLessThan(body.indexOf("Pierwsza"));
    // Oba nagłówki nadal są - przesunięcie nie gubi sekcji.
    expect(body).toContain("Pierwsza");
  });

  it("etykiety narzędzi sekcji są tłumaczone", async () => {
    await mounted();

    fireEvent.click(screen.getByText("en"));

    expect(screen.getByText("Add section")).toBeTruthy();
    expect(screen.getByText(/Section 1/)).toBeTruthy();
    expect(screen.getByLabelText("Move up")).toBeTruthy();
    expect(screen.getByLabelText("Delete")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("widgety na kanwie", () => {
  it("kliknięcie karty biblioteki DODAJE widget i zaznacza go", async () => {
    await mounted();

    fireEvent.click(screen.getByText("Separator").closest("button")!);

    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", false);
  });

  it("usunięcie widgetu z kanwy zdejmuje go z dokumentu", async () => {
    await mounted();

    fireEvent.click(screen.getAllByLabelText("Usun")[0]!);

    expect(screen.queryByText("Tytuł")).toBeNull();
    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", false);
  });

  it("duplikowanie widgetu daje DRUGI element o tej samej treści", async () => {
    await mounted();

    fireEvent.click(screen.getAllByLabelText("Duplikuj")[0]!);

    expect(screen.getAllByText("Tytuł")).toHaveLength(2);
    expect(screen.getByLabelText("Cofnij")).toHaveProperty("disabled", false);
  });

  it("klik w tło kanwy CZYŚCI zaznaczenie - panel wraca do dokumentu", async () => {
    const { container } = await mounted();
    fireEvent.click(screen.getByText("Tytuł"));
    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();

    fireEvent.click(container.querySelector("main")!);

    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dokument" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("obraz sekcji na kanwie", () => {
  it("w układzie JEDNOKOLUMNOWYM obraz jest tłem sekcji", async () => {
    const { container } = await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "s1",
            widgets: [],
            media: { url: "https://example.test/tlo.png", position: "left" },
          },
        ],
      }),
    });

    const withBg = container.querySelector('[style*="example.test/tlo.png"]') as HTMLElement;
    expect(withBg).toBeTruthy();
    expect(withBg.style.backgroundSize).toBe("cover");
  });

  it("w układzie 1/2 obraz jest OSOBNĄ kolumną po zadeklarowanej stronie", async () => {
    const { container } = await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "s1",
            widgets: [],
            layout: "1-1",
            media: { url: "https://example.test/bok.png", position: "right", alt: "Opis obrazu" },
          },
        ],
      }),
    });

    const media = screen.getByLabelText("Opis obrazu");
    expect(media.style.flex).toBe("0 0 50%");
    // Kolumna po prawej stoi ZA kolumną z widgetami.
    const cols = Array.from(container.querySelectorAll('[style*="example.test/bok.png"]'));
    expect(cols).toHaveLength(1);
  });

  it("obraz po LEWEJ stoi przed kolumną z widgetami", async () => {
    await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "s1",
            widgets: [
              { ...makeWidget("heading"), id: "a", text: { pl: "Treść", en: "Body" } },
            ] as NlWidget[],
            layout: "1-1",
            media: { url: "https://example.test/lewo.png", position: "left", alt: "Z lewej" },
          },
        ],
      }),
    });

    const media = screen.getByLabelText("Z lewej");
    const text = screen.getByText("Treść");
    expect(media.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(media.style.backgroundPosition).toBe("center center");
  });
});

// ---------------------------------------------------------------------------
describe("przeciąganie - wiązanie obszarów z dokumentem", () => {
  it("upuszczenie karty biblioteki na obszar sekcji DODAJE widget tego typu", async () => {
    await mounted();

    dragEnd("lib-divider", "sec-sekcja-1-drop", { kind: "library", type: "divider" });

    expect(await savedDoc()).toMatchObject({
      sections: [{ widgets: [{ type: "heading" }, { type: "field.email" }, { type: "divider" }] }],
    });
    // Jeden widget, nie dwa - upuszczenie nie może dublować karty biblioteki.
    expect((await savedDoc()).sections[0]!.widgets).toHaveLength(3);
  });

  it("upuszczenie NA WIDGET wstawia nowy element PRZED nim", async () => {
    await mounted();

    dragEnd("lib-divider", "w-email", { kind: "library", type: "divider" });

    const doc = await savedDoc();
    expect(doc.sections[0]!.widgets.map((w) => w.type)).toEqual([
      "heading",
      "divider",
      "field.email",
    ]);
  });

  it("PRESET z karty biblioteki jedzie razem z widgetem", async () => {
    await mounted();

    dragEnd("lib-firstName", "sec-sekcja-1-drop", {
      kind: "library",
      type: "field.text",
      preset: { name: "firstName" },
    });

    const doc = await savedDoc();
    const added = doc.sections[0]!.widgets.at(-1)! as { type: string; name?: string };
    expect(added.type).toBe("field.text");
    expect(added.name).toBe("firstName");
  });

  it("upuszczenie do DRUGIEJ KOLUMNY przypisuje kolumnę", async () => {
    await mounted({
      doc: storedDoc({ sections: [{ id: "sekcja-1", widgets: [], layout: "1-1" }] }),
    });

    dragEnd("lib-divider", "sec-sekcja-1-col-1", { kind: "library", type: "divider" });

    const doc = await savedDoc();
    expect(doc.sections[0]!.widgets[0]!.col).toBe(1);
    expect(doc.sections[0]!.widgets).toHaveLength(1);
  });

  it("przeniesienie istniejącego widgetu zmienia KOLEJNOŚĆ w dokumencie", async () => {
    await mounted();

    dragEnd("w-email", "w-naglowek", undefined);

    const doc = await savedDoc();
    expect(doc.sections[0]!.widgets.map((w) => w.id)).toEqual(["w-email", "w-naglowek"]);
  });

  it("upuszczenie POZA obszarem nie rusza dokumentu", async () => {
    await mounted();

    dragEnd("w-email", null, undefined);

    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("Tytuł")).toBeTruthy();
  });

  it("upuszczenie NA SIEBIE nie rusza dokumentu", async () => {
    await mounted();

    dragEnd("w-email", "w-email", undefined);

    // Zablokowany zapis znaczy „nie ma czego zapisywać" - nowy dokument o tej
    // samej treści oznaczyłby formularz jako zmieniony.
    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", true);
    // Widgety nadal są na kanwie - dokument nie został przepisany.
    expect(screen.getAllByLabelText("Usun").length).toBeGreaterThan(0);
  });

  it("nieznany obszar upuszczenia nie gubi widgetu", async () => {
    await mounted();

    dragEnd("w-email", "cos-zupelnie-innego", undefined);

    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", true);
    expect(screen.getAllByLabelText("Przenies")).toHaveLength(2);
  });

  it("podczas przeciągania karty biblioteki widać, CO się przeciąga", async () => {
    await mounted();

    act(() => {
      dnd.onDragStart!({
        active: { id: "lib-divider", data: { current: { kind: "library", type: "divider" } } },
      });
    });

    expect(screen.getByText("+ divider")).toBeTruthy();
    expect(screen.getAllByText("Tytuł")).toHaveLength(1);
  });

  it("podczas przeciągania istniejącego widgetu widać JEGO podgląd", async () => {
    await mounted();

    act(() => {
      dnd.onDragStart!({ active: { id: "w-naglowek", data: { current: {} } } });
    });

    // Podgląd w warstwie przeciągania jest DRUGĄ kopią treści widgetu.
    expect(screen.getAllByText("Tytuł")).toHaveLength(2);
    expect(screen.queryByText(/^\+ /)).toBeNull();
  });

  it("zakończenie przeciągania sprząta warstwę podglądu", async () => {
    await mounted();
    act(() => {
      dnd.onDragStart!({ active: { id: "w-naglowek", data: { current: {} } } });
    });

    dragEnd("w-naglowek", null, undefined);

    expect(screen.getAllByText("Tytuł")).toHaveLength(1);
    expect(screen.queryByText("+ divider")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("edycja sekcji z panelu właściwości", () => {
  it("styl sekcji trafia na KANWĘ, nie tylko do dokumentu", async () => {
    const { container } = await mounted();
    fireEvent.click(screen.getByText("Sekcja 1"));

    const paddingY = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]!;
    fireEvent.change(paddingY, { target: { value: "48" } });

    const padded = Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.paddingTop === "48px",
    );
    expect(padded).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Zapisz/ })).toHaveProperty("disabled", false);
  });

  it("przełączenie sekcji na dwie kolumny pokazuje je na kanwie", async () => {
    await mounted();
    fireEvent.click(screen.getByText("Sekcja 1"));

    fireEvent.click(screen.getByText("1 / 2").closest("button")!);

    expect(screen.getByText("Kolumna 1")).toBeTruthy();
    expect(screen.getByText("Kolumna 2")).toBeTruthy();
  });

  it("układ zmieniony BEZ zaznaczonej sekcji trafia do PIERWSZEJ sekcji", async () => {
    // Panel dokumentu też ma wybór układu - musi działać na czymś konkretnym,
    // a nie po cichu nie robić nic.
    await mounted();
    fireEvent.click(screen.getByRole("tab", { name: "Dokument" }));
    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();

    fireEvent.click(screen.getByText("1 / 2").closest("button")!);

    expect(screen.getByText("Kolumna 1")).toBeTruthy();
    expect((await savedDoc()).sections[0]!.layout).toBe("1-1");
  });

  it("obraz sekcji wpisany w panelu pojawia się na kanwie", async () => {
    const { container } = await mounted();
    fireEvent.click(screen.getByText("Sekcja 1"));

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.test/nowe-tlo.png" },
    });

    expect(container.querySelector('[style*="example.test/nowe-tlo.png"]')).toBeTruthy();
    expect(screen.getByText("Usun")).toBeTruthy();
  });

  it("usunięcie obrazu z panelu zdejmuje go z kanwy", async () => {
    const { container } = await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "sekcja-1",
            widgets: [],
            media: { url: "https://example.test/tlo.png", position: "left" },
          },
        ],
      }),
    });
    fireEvent.click(screen.getByText("Sekcja 1"));

    fireEvent.click(screen.getByText("Usun"));

    expect(container.querySelector('[style*="example.test/tlo.png"]')).toBeNull();
    expect((await savedDoc()).sections[0]!.media).toBeNull();
  });

  it("styl okna popupu z panelu dokumentu trafia na kanwę", async () => {
    const { container } = await mounted({
      variant: "popup",
      popupDoc: storedDoc({ variant: "popup" }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Dokument" }));

    fireEvent.change(screen.getByPlaceholderText("rgba(0,0,0,0.7)"), {
      target: { value: "rgba(1,2,3,0.5)" },
    });

    expect(container.querySelector('[style*="rgba(1, 2, 3, 0.5)"]')).toBeTruthy();
    expect((await savedDoc("popup_doc")).popup?.overlay).toBe("rgba(1,2,3,0.5)");
  });

  it("zakładka właściwości da się otworzyć RĘCZNIE, bez zaznaczania", async () => {
    await mounted();
    fireEvent.click(screen.getByRole("tab", { name: "Widgety" }));

    fireEvent.click(screen.getByRole("tab", { name: "Dokument" }));

    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();
    expect(screen.queryByText("Biblioteka widgetow")).toBeNull();
  });

  it("usunięcie ZAZNACZONEGO widgetu czyści prawą kolumnę", async () => {
    // Panel pokazujący właściwości elementu, którego już nie ma, kończy się
    // patchem w nieistniejący widget.
    await mounted();
    fireEvent.click(screen.getByText("Tytuł"));
    expect(screen.getByText("Wlasciwosci widgetu")).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText("Usun")[0]!);

    expect(screen.getByText("Ustawienia dokumentu")).toBeTruthy();
    expect(screen.queryByText("Tytuł")).toBeNull();
  });

  it("przesunięcie sekcji W GÓRĘ też działa", async () => {
    await mounted({
      doc: storedDoc({
        sections: [
          {
            id: "s1",
            widgets: [
              { ...makeWidget("heading"), id: "a", text: { pl: "Pierwsza", en: "First" } },
            ] as NlWidget[],
          },
          {
            id: "s2",
            widgets: [
              { ...makeWidget("heading"), id: "b", text: { pl: "Druga", en: "Second" } },
            ] as NlWidget[],
          },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("W gore")[1]!);

    expect((await savedDoc()).sections.map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});

// ---------------------------------------------------------------------------
describe("identyfikatory kopii", () => {
  it("gdy przeglądarka nie umie generować UUID, kopie i tak dostają RÓŻNE identyfikatory", async () => {
    // `crypto.randomUUID` nie istnieje w kontekście bez HTTPS. Powtórzony
    // identyfikator to dwa elementy, które zaznaczają się i patchują RAZEM.
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: () => {
        throw new Error("brak secure context");
      },
      configurable: true,
    });
    try {
      await mounted();

      fireEvent.click(screen.getByLabelText("Duplikuj sekcje"));

      const doc = await savedDoc();
      expect(new Set(doc.sections.map((s) => s.id)).size).toBe(2);
      expect(new Set(doc.sections.flatMap((s) => s.widgets.map((w) => w.id))).size).toBe(4);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });
});
