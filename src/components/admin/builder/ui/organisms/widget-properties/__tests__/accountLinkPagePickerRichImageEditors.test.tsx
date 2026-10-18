// Edytory i pickery, w których dane przychodzą z bazy albo z zapisu innego
// edytora - i właśnie na tej granicy psuły się po cichu:
//
//  1. MENU KONTA - lista stron: `title_en` bywa NULL-em, a `String(null)`
//     dawał na liście napis „null" zamiast tytułu polskiego (NAPRAWIONE
//     2026-10-18). Do tego: teksty i adresy przycisków logowania, pola
//     rodzajów „strona" / „własny link" / „separator".
//  2. PICKER STRON - pusty tytuł (strona nieprzetłumaczona) zostawiał pusty
//     wiersz listy i puste pole związanej strony, a przecinek albo nawias we
//     frazie rozbijał filtr `.or()` PostgREST-a (NAPRAWIONE 2026-10-18 -
//     wspólne `escapeLike` panelu).
//  3. TEKST SFORMATOWANY - przycisk liczy BLOKI (napis z uszkodzonego zapisu
//     też ma `length`), a zapis edytora bloków wraca jako `doc`.
//  4. OBRAZEK - podgląd jasny/ciemny z zapasem na drugi wariant, wyrównanie.
//
// Granice: Supabase (łańcuch z `@/test/supabaseChain`), atrapy Radix
// Select/Switch, i18n jako echo klucza, tenant i server fny jak w sąsiednich
// testach. Edytor bloków (`PostBlockEditor`, leniwy chunk z własnymi testami)
// jest atrapą - tu liczy się tylko to, co panel mu podaje i co zapisuje.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState, type ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import { AccountLinkEditor } from "../AccountLinkEditor";
import { PagePicker } from "../PagePicker";
import { RichTextEditor } from "../RichTextEditor";
import { ImageEditor } from "../ImageEditor";

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
  supabase: { from: (table: string) => db.current.from(table) },
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
vi.mock("@/components/admin/blocks/PostBlockEditor", () => ({
  PostBlockEditor: ({
    value,
    onChange,
  }: {
    value: LocalizedBlocks;
    onChange: (next: LocalizedBlocks) => void;
  }) => (
    <div data-testid="edytor-blokow">
      <span data-testid="bloki-pl">{value.pl.blocks.length}</span>
      <span data-testid="bloki-en">{value.en.blocks.length}</span>
      <button
        type="button"
        onClick={() =>
          onChange({
            pl: {
              ...value.pl,
              blocks: [{ id: "b1", type: "paragraph", data: { text: "Akapit" } }],
            },
            en: value.en,
          } as LocalizedBlocks)
        }
      >
        dopisz akapit
      </button>
    </div>
  ),
}));

type Editor = (props: {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}) => ReactNode;

function renderStateful(Editor: Editor, initial: WidgetNode["content"], lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <Editor
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
  const last = (key: string) => written.filter(([k]) => k === key).at(-1)?.[1];
  return { ...view, written, last };
}

/** `PropField` nie wiąże etykiety z kontrolką - szukamy w jej opakowaniu. */
function fieldOf(label: string, index = 0): HTMLInputElement {
  const wrapper = screen.getAllByText(label, { selector: "label" })[index]?.parentElement;
  const field = wrapper?.querySelector<HTMLInputElement>("input, textarea, select");
  if (!field) throw new Error(`test: brak kontrolki „${label}"`);
  return field;
}
const hasLabel = (label: string): boolean =>
  screen.queryAllByText(label, { selector: "label" }).length > 0;

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("pages", ok([]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AccountLinkEditor - strony z bazy i pola pozycji", () => {
  const pageItem = { id: "i1", section: "guest", kind: "page", label_pl: "Strona" };
  const pageSelect = (): HTMLSelectElement => {
    const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="kontakt"]'),
    );
    if (!found) throw new Error("test: brak listy stron");
    return found;
  };

  it('NULL w tytule EN opisuje stronę tytułem polskim, a nie napisem „null"', async () => {
    db.current.setResponse(
      "pages",
      ok([
        { slug: "kontakt", title_pl: "Kontakt", title_en: null },
        { slug: "regulamin", title_pl: null, title_en: null },
      ]),
    );
    const { container } = renderStateful(AccountLinkEditor, { items: [pageItem] }, "en");
    await waitFor(() => expect(pageSelect()).toBeTruthy());
    const labels = Array.from(pageSelect().querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Kontakt", "regulamin"]));
    expect(container.textContent).not.toContain("null");
  });

  it("wybór strony zapisuje jej slug w pozycji", async () => {
    db.current.setResponse(
      "pages",
      ok([{ slug: "kontakt", title_pl: "Kontakt", title_en: "Contact" }]),
    );
    const { last } = renderStateful(AccountLinkEditor, { items: [pageItem] });
    await waitFor(() => expect(pageSelect()).toBeTruthy());
    fireEvent.change(pageSelect(), { target: { value: "kontakt" } });
    expect(last("items")).toEqual([{ ...pageItem, pageSlug: "kontakt" }]);
  });

  it("brak opublikowanych stron pokazuje komunikat w liście", () => {
    renderStateful(AccountLinkEditor, { items: [pageItem] });
    expect(screen.getByText("builder.accountLinkEditor.noPages")).toBeInTheDocument();
  });

  it('własny link: adres i „nowa karta" zapisują się w pozycji', () => {
    const item = { id: "i2", section: "guest", kind: "custom", label_pl: "Blog" };
    const { last } = renderStateful(AccountLinkEditor, { items: [item] });
    fireEvent.change(fieldOf("builder.accountLinkEditor.customUrl"), {
      target: { value: "https://blog.test" },
    });
    fireEvent.click(fieldOf("builder.accountLinkEditor.newTab"));
    expect(last("items")).toEqual([{ ...item, customHref: "https://blog.test", external: true }]);
  });

  it("ikona, etykieta i opis piszą klucze języka panelu", () => {
    const item = { id: "i3", section: "guest", kind: "logout", label_pl: "Wyloguj" };
    const { last } = renderStateful(AccountLinkEditor, { items: [item] }, "en");
    fireEvent.change(fieldOf("builder.accountLinkEditor.icon"), { target: { value: "LogOut" } });
    fireEvent.change(fieldOf("builder.accountLinkEditor.label(lang=EN)"), {
      target: { value: "Sign out" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.desc(lang=EN)"), {
      target: { value: "End session" },
    });
    expect(last("items")).toEqual([
      { ...item, icon: "LogOut", label_en: "Sign out", desc_en: "End session" },
    ]);
  });

  it("separator nie ma pól ikony, etykiety ani opisu", () => {
    renderStateful(AccountLinkEditor, {
      items: [{ id: "i4", section: "guest", kind: "separator" }],
    });
    expect(hasLabel("builder.accountLinkEditor.icon")).toBe(false);
    expect(hasLabel("builder.accountLinkEditor.label(lang=PL)")).toBe(false);
  });

  it("teksty i adresy logowania zapisują się pod swoimi kluczami", () => {
    const { written } = renderStateful(AccountLinkEditor, {}, "en");
    expect(fieldOf("builder.accountLinkEditor.signinUrl").value).toBe("/login");
    expect(fieldOf("builder.accountLinkEditor.signupUrl").value).toBe("/login?mode=signup");
    fireEvent.change(fieldOf("builder.accountLinkEditor.signinLabel(lang=EN)"), {
      target: { value: "Sign in" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.signupLabel(lang=EN)"), {
      target: { value: "Join" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.signinUrl"), {
      target: { value: "/auth" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.signupUrl"), {
      target: { value: "/auth?signup=1" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.panelLabel(lang=EN)"), {
      target: { value: "My panel" },
    });
    fireEvent.change(fieldOf("builder.accountLinkEditor.logoutLabel(lang=EN)"), {
      target: { value: "Log out" },
    });
    expect(written).toEqual([
      ["signin_en", "Sign in"],
      ["signup_en", "Join"],
      ["signinHref", "/auth"],
      ["signupHref", "/auth?signup=1"],
      ["panel_en", "My panel"],
      ["logout_en", "Log out"],
    ]);
  });

  it("szerokość i zaokrąglenie panelu zapisują liczby", () => {
    const { written } = renderStateful(AccountLinkEditor, {});
    expect(fieldOf("builder.accountLinkEditor.width").value).toBe("280");
    expect(fieldOf("builder.accountLinkEditor.radius").value).toBe("12");
    fireEvent.change(fieldOf("builder.accountLinkEditor.width"), { target: { value: "320" } });
    fireEvent.change(fieldOf("builder.accountLinkEditor.radius"), { target: { value: "0" } });
    expect(written).toEqual([
      ["panelWidth", 320],
      ["panelRadius", 0],
    ]);
  });

  it("przełączenie sekcji pokazuje tylko jej pozycje", () => {
    renderStateful(AccountLinkEditor, {
      items: [
        { id: "g", section: "guest", kind: "custom", label_pl: "Gość" },
        { id: "a", section: "auth", kind: "custom", label_pl: "Zalogowany" },
      ],
    });
    expect(screen.getByDisplayValue("Gość")).toBeInTheDocument();
    const section = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      s.querySelector('option[value="staff"]'),
    )!;
    fireEvent.change(section, { target: { value: "auth" } });
    expect(screen.getByDisplayValue("Zalogowany")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Gość")).toBeNull();
  });
});

describe("PagePicker - tytuły i fraza wyszukiwania", () => {
  function renderPicker(value?: string, lang: "pl" | "en" = "en") {
    const onChange = vi.fn();
    renderWithQueryClient(<PagePicker value={value} lang={lang} onChange={onChange} />);
    return { onChange, input: () => screen.getByRole("textbox") as HTMLInputElement };
  }

  it("pusty tytuł w języku panelu pokazuje slug w polu związanej strony", async () => {
    db.current.setResponse("pages", (chain) =>
      chain.has("maybeSingle")
        ? ok({ id: "p1", slug: "o-nas", title_pl: "O nas", title_en: "" })
        : ok([]),
    );
    const { input } = renderPicker("/o-nas");
    await waitFor(() => expect(db.current.chainsFor("pages").length).toBeGreaterThan(0));
    await waitFor(() => expect(input().value).toBe("o-nas"));
  });

  it("wiersz listy z pustym tytułem nie jest pusty", async () => {
    db.current.setResponse(
      "pages",
      ok([{ id: "p1", slug: "o-nas", title_pl: "O nas", title_en: "" }]),
    );
    const { input } = renderPicker();
    fireEvent.focus(input());
    const option = await screen.findByRole("option");
    expect(within(option).getAllByText(/o-nas/)[0]?.textContent).toBe("o-nas");
  });

  it("przecinek, nawias i znaki wieloznaczne nie trafiają do filtra `.or()`", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "o,nas)%*" } });
    await waitFor(() =>
      expect(db.current.lastChain("pages")?.argsOf("or")).toEqual([
        "title_pl.ilike.%onas%,title_en.ilike.%onas%,slug.ilike.%onas%",
      ]),
    );
  });

  it("fraza złożona z samych znaków specjalnych nie dokłada filtra", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "%%,," } });
    await waitFor(() => expect(db.current.chainsFor("pages").length).toBeGreaterThan(1));
    expect(db.current.lastChain("pages")?.has("or")).toBe(false);
  });
});

describe("RichTextEditor - dokument bloków", () => {
  const doc = (pl: unknown, en: unknown): Json =>
    ({
      pl: { version: 1, blocks: pl },
      en: { version: 1, blocks: en },
    }) as unknown as Json;

  it("przycisk pokazuje liczbę bloków obu wersji", () => {
    renderStateful(RichTextEditor as Editor, { doc: doc([{}, {}], [{}]) });
    expect(
      screen.getByRole("button", { name: "builder.richTextEditor.edit(en=1,pl=2)" }),
    ).toBeInTheDocument();
  });

  it("napis zamiast listy bloków liczy się jako zero, nie liczba znaków", () => {
    renderStateful(RichTextEditor as Editor, { doc: doc("uszkodzone", null) });
    expect(
      screen.getByRole("button", { name: "builder.richTextEditor.edit(en=0,pl=0)" }),
    ).toBeInTheDocument();
  });

  it("dokument, który nie jest obiektem, otwiera pusty edytor obu wersji", async () => {
    renderStateful(RichTextEditor as Editor, { doc: ["nie", "obiekt"] });
    fireEvent.click(screen.getByRole("button", { name: /builder\.richTextEditor\.edit/ }));
    expect(await screen.findByTestId("edytor-blokow")).toBeInTheDocument();
    expect(screen.getByTestId("bloki-pl").textContent).toBe("0");
    expect(screen.getByTestId("bloki-en").textContent).toBe("0");
  });

  it("zapis edytora bloków wraca do treści widgetu jako `doc`", async () => {
    const { written } = renderStateful(RichTextEditor as Editor, {});
    fireEvent.click(screen.getByRole("button", { name: /builder\.richTextEditor\.edit/ }));
    fireEvent.click(await screen.findByRole("button", { name: "dopisz akapit" }));
    expect(written).toHaveLength(1);
    const [key, value] = written[0]!;
    expect(key).toBe("doc");
    const saved = value as unknown as LocalizedBlocks;
    expect(saved.pl.blocks).toEqual([{ id: "b1", type: "paragraph", data: { text: "Akapit" } }]);
    expect(saved.en.blocks).toEqual([]);
    // Otwarte okno ukrywa resztę strony przed czytnikiem (`aria-hidden`),
    // dlatego przycisk pod spodem szukamy z `hidden: true`.
    expect(
      screen.getByRole("button", { name: "builder.richTextEditor.edit(en=0,pl=1)", hidden: true }),
    ).toBeInTheDocument();
  });
});

describe("ImageEditor - podgląd i wyrównanie", () => {
  /** Obraz w ramce podglądu (sloty niżej mają własne miniatury). */
  const preview = (): HTMLImageElement | null =>
    screen
      .getByText("builder.imageEditor.preview")
      .parentElement?.parentElement?.querySelector("img") ?? null;

  it("podgląd jasny pokazuje obraz jasny, ciemny - wariant ciemny", () => {
    renderStateful(ImageEditor, {
      src: "https://cdn.test/l.png",
      srcDark: "https://cdn.test/d.png",
    });
    expect(preview()?.getAttribute("src")).toBe("https://cdn.test/l.png");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(preview()?.getAttribute("src")).toBe("https://cdn.test/d.png");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(preview()?.getAttribute("src")).toBe("https://cdn.test/l.png");
  });

  it("bez wariantu ciemnego podgląd ciemny pokazuje obraz jasny", () => {
    renderStateful(ImageEditor, { src: "https://cdn.test/l.png" });
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(preview()?.getAttribute("src")).toBe("https://cdn.test/l.png");
  });

  it("bez żadnego obrazu podgląd mówi, że obrazu brak", () => {
    renderStateful(ImageEditor, {});
    expect(screen.getByText("builder.imageEditor.noImage")).toBeInTheDocument();
  });

  it.each([
    ["builder.common.left", "left"],
    ["builder.common.right", "right"],
  ] as const)("przycisk %s zapisuje wyrównanie", (name, saved) => {
    const { written } = renderStateful(ImageEditor, {});
    fireEvent.click(screen.getByRole("button", { name }));
    expect(written).toEqual([["align", saved]]);
  });

  it("suwaki szerokości i wysokości zapisują wartość krokiem z klawiatury", () => {
    const { written } = renderStateful(ImageEditor, { widthPx: 300, heightPx: 100 });
    const [width, height] = screen.getAllByRole("slider");
    fireEvent.keyDown(width!, { key: "ArrowRight" });
    fireEvent.keyDown(height!, { key: "ArrowLeft" });
    expect(written).toEqual([
      ["widthPx", 310],
      ["heightPx", 98],
    ]);
  });
});
