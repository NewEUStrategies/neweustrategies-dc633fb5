// Uniwersalny picker linku widgetu: adres zewnętrzny, wpis, strona, kategoria,
// tag albo plik z biblioteki. Zapisuje jeden obiekt `WidgetLink`, który renderer
// zamienia na warstwę `<a>` nad widgetem - więc każdy błąd zapisu tutaj to
// martwy albo niewłaściwy link na publicznej stronie.
//
// Test przypina:
//  1. NORMALIZACJĘ ZAPISU. Pusty adres to `undefined` (brak linku), nie obiekt
//     z pustym `url` - inaczej renderer owijałby widget w link nikąd.
//  2. CZYSZCZENIE POWIĄZANIA przy zmianie rodzaju: adres zewnętrzny musi
//     wyrzucić `refId`/`refLabel` po wpisie, inaczej dokument nosi identyfikator
//     wpisu przy linku do obcej domeny.
//  3. PROGI ZAPYTAŃ. Wpisy i strony szukamy dopiero od DWÓCH znaków (fraza
//     jednoznakowa zwraca pół bazy), taksonomie - od razu, bo ich jest mało.
//  4. JĘZYK. `lang` wybiera KOLUMNĘ danych (title_pl/title_en, name_pl/name_en),
//     a nie język interfejsu - to dwie różne rzeczy i łatwo je pomylić.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { WidgetLink } from "@/lib/builder/types";
import { LinkPicker } from "../LinkPicker";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (url: string) => void;
    onOpenChange: (o: boolean) => void;
    accept?: string;
  }) =>
    open ? (
      <button type="button" onClick={() => onPick("https://cdn.test/pliki/raport.pdf")}>
        wybierz plik
      </button>
    ) : null,
}));

const POSTS = [
  { id: "p1", slug: "nowy-raport", title_pl: "Nowy raport", title_en: "New report" },
  { id: "p2", slug: "bez-tytulu", title_pl: null, title_en: null },
];
const PAGES = [{ id: "g1", slug: "o-nas", title_pl: "O nas", title_en: "About us" }];
const CATEGORIES = [
  { id: "c1", slug: "gospodarka", name_pl: "Gospodarka", name_en: "Economy" },
  { id: "c2", slug: "bez-nazwy", name_pl: "", name_en: "" },
];
const TAGS = [
  { id: "t1", slug: "brexit", name: "Brexit" },
  { id: "t2", slug: "bez-nazwy", name: "" },
];

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("posts", ok(POSTS));
  db.current.setResponse("pages", ok(PAGES));
  db.current.setResponse("categories", ok(CATEGORIES));
  db.current.setResponse("tags", ok(TAGS));
});

function renderPicker(initial?: WidgetLink, lang: "pl" | "en" = "pl") {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState<WidgetLink | undefined>(initial);
    return (
      <LinkPicker
        value={value}
        lang={lang}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  renderWithQueryClient(<Host />);
  return { onChange, last: () => onChange.mock.calls.at(-1)?.[0] as WidgetLink | undefined };
}

const tab = (key: string) => screen.getByRole("button", { name: `linkPicker.tabs.${key}` });
const searchBox = (): HTMLInputElement => document.querySelector<HTMLInputElement>("input.pl-8")!;

describe("LinkPicker - zakładki", () => {
  it("startuje na adresie zewnętrznym, gdy nie ma linku", () => {
    renderPicker();
    expect(document.querySelector('input[placeholder="linkPicker.urlPlaceholder"]')).not.toBeNull();
  });

  it.each([
    ["post", "linkPicker.searchPosts"],
    ["page", "linkPicker.searchPages"],
    ["category", "linkPicker.searchCategories"],
    ["tag", "linkPicker.searchTags"],
  ] as const)("startuje na zakładce zapisanego rodzaju: %s", (kind, placeholder) => {
    renderPicker({ url: "/x", kind });
    expect(document.querySelector(`input[placeholder="${placeholder}"]`)).not.toBeNull();
  });

  it("startuje na zakładce pliku dla linku do mediów", () => {
    renderPicker({ url: "https://cdn.test/a.pdf", kind: "media" });
    expect(screen.getByRole("button", { name: /linkPicker.changeFile/ })).toBeInTheDocument();
  });

  it("przełącza zakładki bez ruszania zapisu", () => {
    const { onChange } = renderPicker();
    fireEvent.click(tab("tag"));
    expect(document.querySelector('input[placeholder="linkPicker.searchTags"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wyróżnia aktywną zakładkę", () => {
    renderPicker();
    expect(tab("external").className).toContain("bg-background");
    expect(tab("post").className).toContain("text-muted-foreground");
  });
});

describe("LinkPicker - adres zewnętrzny", () => {
  it("zapisuje wpisany adres", () => {
    const { last } = renderPicker();
    fireEvent.change(document.querySelector('input[placeholder="linkPicker.urlPlaceholder"]')!, {
      target: { value: "https://neweu.test/raport" },
    });
    expect(last()).toEqual({ url: "https://neweu.test/raport", kind: "external" });
  });

  it("wyczyszczenie adresu usuwa cały link", () => {
    const { last } = renderPicker({ url: "https://neweu.test", kind: "external" });
    fireEvent.change(document.querySelector('input[placeholder="linkPicker.urlPlaceholder"]')!, {
      target: { value: "" },
    });
    // `undefined`, nie `{ url: "" }` - renderer nie może owinąć widgetu
    // w link nikąd.
    expect(last()).toBeUndefined();
  });

  it("wpisanie adresu po wybraniu wpisu czyści powiązanie", () => {
    const { last } = renderPicker({
      url: "/post/nowy-raport",
      kind: "post",
      refId: "p1",
      refLabel: "Nowy raport",
    });
    fireEvent.click(tab("external"));
    fireEvent.change(document.querySelector('input[placeholder="linkPicker.urlPlaceholder"]')!, {
      target: { value: "https://obca.test" },
    });
    expect(last()).toEqual({
      url: "https://obca.test",
      kind: "external",
      refId: undefined,
      refLabel: undefined,
    });
  });

  it("pole adresu pokazuje tylko link zewnętrzny", () => {
    renderPicker({ url: "/post/x", kind: "post" });
    fireEvent.click(tab("external"));
    // Link do wpisu nie jest „adresem zewnętrznym” - pole musi być puste,
    // żeby redaktor nie edytował ścieżki wygenerowanej ze slugu.
    expect(
      (document.querySelector('input[placeholder="linkPicker.urlPlaceholder"]') as HTMLInputElement)
        .value,
    ).toBe("");
  });
});

describe("LinkPicker - wpisy i strony", () => {
  it("nie pyta bazy dla frazy krótszej niż dwa znaki", async () => {
    renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "a" } });
    expect(screen.getByText("linkPicker.typeMin")).toBeInTheDocument();
    await waitFor(() => expect(db.current.chainsFor("posts")).toHaveLength(0));
  });

  it("od dwóch znaków szuka po tytułach i slugu, tylko w opublikowanych", async () => {
    renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "rap" } });
    await waitFor(() => expect(db.current.chainsFor("posts")).toHaveLength(1));
    const chain = db.current.lastChain("posts");
    expect(chain?.argsOf("or")).toEqual([
      "title_pl.ilike.%rap%,title_en.ilike.%rap%,slug.ilike.%rap%",
    ]);
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("limit")).toEqual([50]);
  });

  it("wybór wpisu zapisuje ścieżkę, identyfikator i etykietę", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "raport" } });
    const option = await screen.findByRole("button", { name: /Nowy raport/ });
    fireEvent.click(option);
    // `refId` pozwala rendererowi odświeżyć adres po zmianie slugu wpisu -
    // dlatego zapisujemy oba, a nie tylko URL.
    expect(last()).toEqual({
      url: "/post/nowy-raport",
      kind: "post",
      refId: "p1",
      refLabel: "Nowy raport",
    });
  });

  it("wpis bez tytułu pokazuje i zapisuje slug", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "bez" } });
    const option = await screen.findByRole("button", { name: /bez-tytulu/ });
    fireEvent.click(option);
    expect(last()?.refLabel).toBe("bez-tytulu");
  });

  it("etykieta idzie za językiem TREŚCI, nie interfejsu", async () => {
    const { last } = renderPicker(undefined, "en");
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "report" } });
    const option = await screen.findByRole("button", { name: /New report/ });
    fireEvent.click(option);
    expect(last()?.refLabel).toBe("New report");
  });

  it("strona ma ścieżkę bez przedrostka wpisu", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("page"));
    fireEvent.change(searchBox(), { target: { value: "o-nas" } });
    const option = await screen.findByRole("button", { name: /O nas/ });
    fireEvent.click(option);
    expect(last()).toEqual({ url: "/o-nas", kind: "page", refId: "g1", refLabel: "O nas" });
  });

  it("brak trafień pokazuje komunikat", async () => {
    db.current.setResponse("posts", ok([]));
    renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "zzz" } });
    expect(await screen.findByText("linkPicker.noResults")).toBeInTheDocument();
  });

  it("brak danych w odpowiedzi traktujemy jak brak trafień", async () => {
    db.current.setResponse("posts", { data: null, error: null });
    renderPicker();
    fireEvent.click(tab("post"));
    fireEvent.change(searchBox(), { target: { value: "zzz" } });
    expect(await screen.findByText("linkPicker.noResults")).toBeInTheDocument();
  });

  it("wybrany wpis pokazuje etykietę i daje się odpiąć", async () => {
    const { last } = renderPicker({
      url: "/post/nowy-raport",
      kind: "post",
      refId: "p1",
      refLabel: "Nowy raport",
    });
    expect(screen.getByText("Nowy raport")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("linkPicker.remove"));
    expect(last()).toBeUndefined();
  });

  it("wybrany wpis bez etykiety pokazuje adres", () => {
    renderPicker({ url: "/post/nowy-raport", kind: "post", refId: "p1" });
    expect(screen.getByText("/post/nowy-raport")).toBeInTheDocument();
  });

  it("z wybranym wpisem nie pokazuje podpowiedzi o dwóch znakach", () => {
    renderPicker({ url: "/post/x", kind: "post", refLabel: "X" });
    expect(screen.queryByText("linkPicker.typeMin")).toBeNull();
  });
});

describe("LinkPicker - kategorie i tagi", () => {
  it("kategorie czyta od razu, bez progu znaków", async () => {
    renderPicker();
    fireEvent.click(tab("category"));
    await waitFor(() => expect(db.current.chainsFor("categories")).toHaveLength(1));
    // Kategorii jest kilkadziesiąt - lista od razu jest tu użyteczna,
    // w przeciwieństwie do wpisów.
    expect(db.current.lastChain("categories")?.has("or")).toBe(false);
  });

  it("filtruje kategorie po obu nazwach i slugu", async () => {
    renderPicker();
    fireEvent.click(tab("category"));
    fireEvent.change(searchBox(), { target: { value: "gosp" } });
    await waitFor(() =>
      expect(db.current.lastChain("categories")?.argsOf("or")).toEqual([
        "name_pl.ilike.%gosp%,name_en.ilike.%gosp%,slug.ilike.%gosp%",
      ]),
    );
  });

  it("wybór kategorii zapisuje ścieżkę archiwum", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("category"));
    const option = await screen.findByRole("button", { name: /Gospodarka/ });
    fireEvent.click(option);
    expect(last()).toEqual({
      url: "/category/gospodarka",
      kind: "category",
      refId: "c1",
      refLabel: "Gospodarka",
    });
  });

  it("kategoria bez nazwy w języku treści spada na slug", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("category"));
    const option = await screen.findByRole("button", { name: /bez-nazwy/ });
    fireEvent.click(option);
    expect(last()?.refLabel).toBe("bez-nazwy");
  });

  it("kategoria czyta nazwę angielską dla treści angielskiej", async () => {
    renderPicker(undefined, "en");
    fireEvent.click(tab("category"));
    expect(await screen.findByRole("button", { name: /Economy/ })).toBeInTheDocument();
  });

  it("tagi mają jedną nazwę i własny filtr", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("tag"));
    fireEvent.change(searchBox(), { target: { value: "bre" } });
    await waitFor(() =>
      expect(db.current.lastChain("tags")?.argsOf("or")).toEqual([
        "name.ilike.%bre%,slug.ilike.%bre%",
      ]),
    );
    const option = await screen.findByRole("button", { name: /Brexit/ });
    fireEvent.click(option);
    expect(last()).toEqual({ url: "/tag/brexit", kind: "tag", refId: "t1", refLabel: "Brexit" });
  });

  it("tag bez nazwy spada na slug", async () => {
    const { last } = renderPicker();
    fireEvent.click(tab("tag"));
    const option = await screen.findByRole("button", { name: /bez-nazwy/ });
    fireEvent.click(option);
    expect(last()?.refLabel).toBe("bez-nazwy");
  });

  it("pusta lista taksonomii pokazuje komunikat", async () => {
    db.current.setResponse("tags", ok([]));
    renderPicker();
    fireEvent.click(tab("tag"));
    expect(await screen.findByText("linkPicker.noResults")).toBeInTheDocument();
  });

  it("brak danych taksonomii traktujemy jak pustą listę", async () => {
    db.current.setResponse("categories", { data: null, error: null });
    renderPicker();
    fireEvent.click(tab("category"));
    expect(await screen.findByText("linkPicker.noResults")).toBeInTheDocument();
  });

  it("wybrana taksonomia daje się odpiąć", async () => {
    const { last } = renderPicker({
      url: "/tag/brexit",
      kind: "tag",
      refId: "t1",
      refLabel: "Brexit",
    });
    fireEvent.click(screen.getByLabelText("linkPicker.remove"));
    expect(last()).toBeUndefined();
  });

  it("wybrana taksonomia bez etykiety pokazuje adres", () => {
    renderPicker({ url: "/tag/brexit", kind: "tag" });
    expect(screen.getByText("/tag/brexit")).toBeInTheDocument();
  });
});

describe("LinkPicker - plik z biblioteki", () => {
  it("wybór pliku zapisuje adres i nazwę pliku jako etykietę", () => {
    const { last } = renderPicker();
    fireEvent.click(tab("media"));
    fireEvent.click(screen.getByRole("button", { name: /linkPicker.chooseFromLibrary/ }));
    fireEvent.click(screen.getByRole("button", { name: "wybierz plik" }));
    expect(last()).toEqual({
      url: "https://cdn.test/pliki/raport.pdf",
      kind: "media",
      refId: undefined,
      refLabel: "raport.pdf",
    });
  });

  it("z wybranym plikiem przycisk proponuje zmianę", () => {
    renderPicker({ url: "https://cdn.test/a.pdf", kind: "media", refLabel: "a.pdf" });
    expect(screen.getByRole("button", { name: /linkPicker.changeFile/ })).toBeInTheDocument();
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
  });

  it("plik daje się odpiąć", () => {
    const { last } = renderPicker({
      url: "https://cdn.test/a.pdf",
      kind: "media",
      refLabel: "a.pdf",
    });
    fireEvent.click(screen.getByLabelText("linkPicker.remove"));
    expect(last()).toBeUndefined();
  });

  it("plik bez etykiety pokazuje adres", () => {
    renderPicker({ url: "https://cdn.test/a.pdf", kind: "media" });
    expect(screen.getByText("https://cdn.test/a.pdf")).toBeInTheDocument();
  });
});

describe("LinkPicker - ustawienia wspólne linku", () => {
  it("bez linku nie pokazuje ustawień", () => {
    renderPicker();
    expect(screen.queryByText("linkPicker.newTab")).toBeNull();
  });

  it("nowa karta zapisuje się w obie strony", () => {
    const { last } = renderPicker({ url: "https://neweu.test", kind: "external" });
    const newTab = document.getElementById("link-newtab") as HTMLInputElement;
    fireEvent.click(newTab);
    expect(last()?.target).toBe("_blank");
    fireEvent.click(newTab);
    // `_self` jawnie, nie `undefined` - renderer nie ma wtedy wątpliwości.
    expect(last()?.target).toBe("_self");
  });

  it("nofollow zapisuje się w obie strony", () => {
    const { last } = renderPicker({ url: "https://neweu.test", kind: "external" });
    const nofollow = document.getElementById("link-nofollow") as HTMLInputElement;
    fireEvent.click(nofollow);
    expect(last()?.nofollow).toBe(true);
    fireEvent.click(nofollow);
    expect(last()?.nofollow).toBe(false);
  });

  it("etykieta dla czytnika ekranu zapisuje się i czyści", () => {
    const { last } = renderPicker({ url: "https://neweu.test", kind: "external" });
    const aria = document.querySelector<HTMLInputElement>(
      'input[placeholder="linkPicker.ariaOptional"]',
    )!;
    fireEvent.change(aria, { target: { value: "Przejdź do raportu" } });
    expect(last()?.ariaLabel).toBe("Przejdź do raportu");
    fireEvent.change(aria, { target: { value: "" } });
    expect(last()?.ariaLabel).toBeUndefined();
  });

  it("usunięcie linku zdejmuje cały obiekt", () => {
    const { last } = renderPicker({
      url: "https://neweu.test",
      kind: "external",
      target: "_blank",
      nofollow: true,
      ariaLabel: "x",
    });
    fireEvent.click(screen.getByRole("button", { name: /linkPicker.removeLink/ }));
    expect(last()).toBeUndefined();
  });

  it("stan przełączników czyta się z zapisu", () => {
    renderPicker({ url: "https://neweu.test", kind: "external", target: "_blank", nofollow: true });
    expect(document.getElementById("link-newtab")).toBeChecked();
    expect(document.getElementById("link-nofollow")).toBeChecked();
  });
});
