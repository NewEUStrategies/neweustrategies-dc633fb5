// Pięć pickerów wiążących treść widgetu z ŻYWYMI danymi serwisu: strona, wpis,
// profil, wydarzenie, taksonomia. Wszystkie mają ten sam sens: redaktor wybiera
// byt, a widget zapisuje jego identyfikator (albo ścieżkę), więc tytuł, okładka
// i adres jadą potem z bazy, a nie z kopii wklejonej rok temu.
//
// Test pilnuje trzech rzeczy, które przy takich kontrolkach psują się realnie:
//  1. CO IDZIE DO BAZY. Filtr po tytule PL, tytule EN i slugu; tylko
//     opublikowane i nieusunięte; limity. Zapytanie „na otwarcie” nie może
//     lecieć przy każdym renderze panelu.
//  2. CO ZAPISUJE WYBÓR. `PagePicker` zapisuje ŚCIEŻKĘ, `PostPicker`
//     IDENTYFIKATOR, `TaxonomyPicker` listę slugów po przecinku - pomyłka daje
//     widget wiążący się z niczym.
//  3. JĘZYK. Etykieta idzie za językiem TREŚCI, z zapasem na slug, gdy tytułu
//     w danym języku nie ma.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { PagePicker } from "../PagePicker";
import { PostPicker } from "../PostPicker";
import { ProfilePicker } from "../ProfilePicker";
import { EventPicker } from "../EventPicker";
import { TaxonomyPicker } from "../TaxonomyPicker";

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
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));

const PAGES = [
  { id: "p1", slug: "o-nas", title_pl: "O nas", title_en: "About us" },
  { id: "p2", slug: "bez-tytulu-en", title_pl: "Kontakt", title_en: null },
];
const POSTS = [
  { id: "s1", slug: "nowy-raport", title_pl: "Nowy raport", title_en: "New report" },
  { id: "s2", slug: "bez-tytulu", title_pl: null, title_en: null },
];
const PROFILES = [
  { id: "u1", display_name: "Jan Kowalski", avatar_url: "https://cdn.test/u1.png" },
  { id: "u2", display_name: null, avatar_url: null },
];
const EVENTS = [
  {
    id: "e1",
    slug: "szczyt",
    title_pl: "Szczyt klimatyczny",
    title_en: "Climate summit",
    starts_at: "2026-09-01T08:00:00Z",
    status: "published",
  },
  {
    id: "e2",
    slug: "draft",
    title_pl: null,
    title_en: "Draft event",
    starts_at: "nie-data",
    status: "draft",
  },
];

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("pages", ok(PAGES));
  db.current.setResponse("posts", ok(POSTS));
  db.current.setResponse("profiles_public", ok(PROFILES));
  db.current.setResponse("events", ok(EVENTS));
  db.current.setResponse(
    "categories",
    ok([
      { id: "c1", slug: "gospodarka", name_pl: "Gospodarka" },
      { id: "c2", slug: "energia", name_pl: "Energia" },
    ]),
  );
  db.current.setResponse("tags", ok([{ id: "t1", slug: "brexit", name: "Brexit" }]));
  db.current.setResponse("post_categories", ok([{ category_id: "c1" }, { category_id: "c1" }]));
  db.current.setResponse("post_tags", ok([{ tag_id: "t1" }]));
});

describe("PagePicker", () => {
  function renderPicker(initial?: string, lang: "pl" | "en" = "pl") {
    const onChange = vi.fn();
    function Host() {
      const [value, setValue] = useState<string | undefined>(initial);
      return (
        <PagePicker
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
    return { onChange, input: () => screen.getByRole("textbox") as HTMLInputElement };
  }

  it("nie pyta o listę stron przed otwarciem", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    expect(db.current.chainsFor("pages")).toHaveLength(0);
  });

  it("otwarcie czyta opublikowane strony po dwadzieścia", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("pages")).toHaveLength(1));
    const chain = db.current.lastChain("pages");
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("limit")).toEqual([20]);
    expect(chain?.has("or")).toBe(false);
  });

  it("od dwóch znaków dokłada filtr po tytułach i slugu", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "on" } });
    await waitFor(() =>
      expect(db.current.lastChain("pages")?.argsOf("or")).toEqual([
        "title_pl.ilike.%on%,title_en.ilike.%on%,slug.ilike.%on%",
      ]),
    );
  });

  it("jednoznakowa fraza nie filtruje", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "o" } });
    await waitFor(() => expect(db.current.chainsFor("pages").length).toBeGreaterThan(0));
    expect(db.current.chainsFor("pages").every((c) => !c.has("or"))).toBe(true);
  });

  it("wybór zapisuje ŚCIEŻKĘ, nie identyfikator", async () => {
    const { input, onChange } = renderPicker();
    fireEvent.focus(input());
    const option = await screen.findByRole("option", { name: /O nas/ });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("/o-nas");
  });

  it("wiązanie pokazuje tytuł strony wczytany z bazy", async () => {
    db.current.setResponse("pages", (chain) =>
      chain.has("maybeSingle") ? ok(PAGES[0]) : ok(PAGES),
    );
    const { input } = renderPicker("/o-nas");
    await waitFor(() => expect(input().value).toBe("O nas"));
    // Panel pokazuje tytuł, nie ścieżkę - redaktor wiąże stronę, nie adres.
    expect(db.current.lastChain("pages")?.argsOf("eq")).toEqual(["slug", "o-nas"]);
  });

  it("bez tytułu w języku panelu pokazuje slug", async () => {
    db.current.setResponse("pages", (chain) =>
      chain.has("maybeSingle") ? ok(PAGES[1]) : ok(PAGES),
    );
    const { input } = renderPicker("/bez-tytulu-en", "en");
    await waitFor(() => expect(input().value).toBe("bez-tytulu-en"));
  });

  it("nieznana strona pokazuje sam slug z adresu", async () => {
    db.current.setResponse("pages", (chain) => (chain.has("maybeSingle") ? ok(null) : ok(PAGES)));
    const { input } = renderPicker("/nie-ma?ref=x");
    // Ścieżka jest obcinana o parametry - inaczej pole pokazywałoby „nie-ma?ref=x”.
    await waitFor(() => expect(input().value).toBe("nie-ma"));
  });

  it("odpięcie czyści wartość", async () => {
    const { onChange } = renderPicker("/o-nas");
    fireEvent.click(screen.getByLabelText("builder.picker.unbindPage"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("bez wartości nie ma przycisku odpięcia", () => {
    renderPicker();
    expect(screen.queryByLabelText("builder.picker.unbindPage")).toBeNull();
  });

  it("pusta lista pokazuje komunikat", async () => {
    db.current.setResponse("pages", ok([]));
    const { input } = renderPicker();
    fireEvent.focus(input());
    expect(await screen.findByText("builder.picker.noResults")).toBeInTheDocument();
  });

  it("brak danych w odpowiedzi traktujemy jak pustą listę", async () => {
    db.current.setResponse("pages", { data: null, error: null });
    const { input } = renderPicker();
    fireEvent.focus(input());
    expect(await screen.findByText("builder.picker.noResults")).toBeInTheDocument();
  });

  it("klik poza pickerem zamyka listę", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  });

  it("własna podpowiedź nadpisuje słownikową", () => {
    renderWithQueryClient(
      <PagePicker value={undefined} onChange={vi.fn()} lang="pl" placeholder="wskaż stronę" />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).placeholder).toBe("wskaż stronę");
  });

  describe("klawiatura", () => {
    it("strzałka w dół z zamkniętej listy ją otwiera", () => {
      const { input } = renderPicker();
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      expect(input()).toHaveAttribute("aria-expanded", "true");
    });

    it("Enter z zamkniętej listy ją otwiera", () => {
      const { input, onChange } = renderPicker();
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(input()).toHaveAttribute("aria-expanded", "true");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("strzałkami i Enterem wybieramy pozycję", async () => {
      const { input, onChange } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("/bez-tytulu-en");
    });

    it("strzałka w dół nie wychodzi za koniec listy", async () => {
      const { input, onChange } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      for (let i = 0; i < 5; i++) fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("/bez-tytulu-en");
    });

    it("strzałka w górę wraca do stanu bez wyboru", async () => {
      const { input, onChange } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "ArrowUp" });
      fireEvent.keyDown(input(), { key: "ArrowUp" });
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("Escape zamyka listę", async () => {
      const { input } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      fireEvent.keyDown(input(), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    });

    it("pozostałe klawisze nie ruszają listy", async () => {
      const { input, onChange } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      fireEvent.keyDown(input(), { key: "a" });
      expect(screen.getAllByRole("option")).toHaveLength(2);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("najechanie myszą przenosi wyróżnienie", async () => {
      const { input } = renderPicker();
      fireEvent.focus(input());
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
      fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
      expect(screen.getAllByRole("option")[1].className).toContain("bg-muted");
    });
  });
});

describe("PostPicker", () => {
  function renderPicker(initial?: string, lang: "pl" | "en" = "pl") {
    const onChange = vi.fn();
    function Host() {
      const [value, setValue] = useState<string | undefined>(initial);
      return (
        <PostPicker
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
    return { onChange };
  }

  const openList = () => fireEvent.click(screen.getByRole("button", { name: /builder.picker/ }));

  it("bez wiązania pokazuje zaproszenie do wyboru", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "builder.picker.bindPost" })).toBeInTheDocument();
  });

  it("nie szuka przed wpisaniem dwóch znaków", async () => {
    renderPicker();
    openList();
    const search = screen.getByPlaceholderText("builder.picker.searchPosts");
    expect(screen.getByText("builder.picker.searchHint")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "r" } });
    await waitFor(() => expect(db.current.chainsFor("posts")).toHaveLength(0));
  });

  it("od dwóch znaków szuka wpisów opublikowanych", async () => {
    renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "rap" },
    });
    await waitFor(() => expect(db.current.chainsFor("posts")).toHaveLength(1));
    const chain = db.current.lastChain("posts");
    expect(chain?.argsOf("or")).toEqual([
      "title_pl.ilike.%rap%,title_en.ilike.%rap%,slug.ilike.%rap%",
    ]);
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("limit")).toEqual([12]);
  });

  it("wybór zapisuje IDENTYFIKATOR wpisu", async () => {
    const { onChange } = renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "rap" },
    });
    const option = await screen.findByRole("button", { name: "Nowy raport" });
    fireEvent.click(option);
    // Identyfikator, nie slug: zmiana slugu wpisu nie może zerwać wiązania.
    expect(onChange).toHaveBeenCalledWith("s1");
  });

  it("wpis bez tytułu pokazuje slug", async () => {
    renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "bez" },
    });
    expect(await screen.findByRole("button", { name: "bez-tytulu" })).toBeInTheDocument();
  });

  it("brak trafień pokazuje komunikat", async () => {
    db.current.setResponse("posts", ok([]));
    renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "zzz" },
    });
    expect(await screen.findByText("builder.picker.noResults")).toBeInTheDocument();
  });

  it("brak danych w odpowiedzi traktujemy jak brak trafień", async () => {
    db.current.setResponse("posts", { data: null, error: null });
    renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "zzz" },
    });
    expect(await screen.findByText("builder.picker.noResults")).toBeInTheDocument();
  });

  it("wiązanie pokazuje tytuł wpisu wczytany z bazy", async () => {
    db.current.setResponse("posts", (chain) =>
      chain.has("maybeSingle") ? ok(POSTS[0]) : ok(POSTS),
    );
    renderPicker("s1");
    expect(await screen.findByText(/Nowy raport/)).toBeInTheDocument();
  });

  it("wiązanie bez wczytanego wpisu pokazuje skrócony identyfikator", async () => {
    db.current.setResponse("posts", (chain) => (chain.has("maybeSingle") ? ok(null) : ok(POSTS)));
    renderPicker("abcdefgh-1234");
    expect(await screen.findByText(/abcdefgh/)).toBeInTheDocument();
  });

  it("tytuł idzie za językiem treści", async () => {
    db.current.setResponse("posts", (chain) =>
      chain.has("maybeSingle") ? ok(POSTS[0]) : ok(POSTS),
    );
    renderPicker("s1", "en");
    expect(await screen.findByText(/New report/)).toBeInTheDocument();
  });

  it("odpięcie czyści wartość", () => {
    const { onChange } = renderPicker("s1");
    fireEvent.click(screen.getByLabelText("builder.picker.unbindPost"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("zamknięcie listy czyści frazę", async () => {
    renderPicker();
    openList();
    fireEvent.change(screen.getByPlaceholderText("builder.picker.searchPosts"), {
      target: { value: "rap" },
    });
    openList();
    openList();
    expect(
      (screen.getByPlaceholderText("builder.picker.searchPosts") as HTMLInputElement).value,
    ).toBe("");
  });
});

describe("ProfilePicker", () => {
  function renderPicker(initial = "", lang: "pl" | "en" = "pl") {
    const onPick = vi.fn();
    const onClear = vi.fn();
    renderWithQueryClient(
      <ProfilePicker value={initial} onPick={onPick} onClear={onClear} lang={lang} />,
    );
    return {
      onPick,
      onClear,
      input: () =>
        screen.getByPlaceholderText(lang === "pl" ? "Szukaj profilu…" : "Search profile…"),
    };
  }

  it("nie czyta profili przed otwarciem", async () => {
    renderPicker();
    await waitFor(() => expect(db.current.chainsFor("profiles_public")).toHaveLength(0));
  });

  it("otwarcie czyta dziesięć profili bez filtra", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("profiles_public")).toHaveLength(1));
    const chain = db.current.lastChain("profiles_public");
    expect(chain?.argsOf("limit")).toEqual([10]);
    expect(chain?.has("ilike")).toBe(false);
  });

  it("od dwóch znaków filtruje po nazwie", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "ko" } });
    await waitFor(() =>
      expect(db.current.lastChain("profiles_public")?.argsOf("ilike")).toEqual([
        "display_name",
        "%ko%",
      ]),
    );
  });

  it("wybór oddaje cały profil", async () => {
    const { input, onPick } = renderPicker();
    fireEvent.focus(input());
    const option = await screen.findByRole("button", { name: /Jan Kowalski/ });
    fireEvent.click(option);
    // Rodzic zapisuje snapshot imienia i zdjęcia jako zapas - dlatego picker
    // oddaje CAŁY rekord, nie samo `id`.
    expect(onPick).toHaveBeenCalledWith(PROFILES[0]);
  });

  it("profil bez zdjęcia dostaje zastępczy kwadrat", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(1));
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("wiązanie pokazuje nazwę profilu", async () => {
    db.current.setResponse("profiles_public", (chain) =>
      chain.has("maybeSingle") ? ok(PROFILES[0]) : ok(PROFILES),
    );
    const { input } = renderPicker("u1");
    await waitFor(() => expect((input() as HTMLInputElement).value).toBe("Jan Kowalski"));
  });

  it("wiązanie bez wczytanego profilu pokazuje jego identyfikator", async () => {
    db.current.setResponse("profiles_public", (chain) =>
      chain.has("maybeSingle") ? ok(null) : ok(PROFILES),
    );
    const { input } = renderPicker("u9");
    await waitFor(() => expect((input() as HTMLInputElement).value).toBe("u9"));
  });

  it("odpięcie woła obsługę czyszczenia", () => {
    const { onClear } = renderPicker("u1");
    fireEvent.click(screen.getByLabelText("Odepnij profil"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("angielski panel ma angielskie etykiety", () => {
    renderPicker("u1", "en");
    expect(screen.getByLabelText("Unlink profile")).toBeInTheDocument();
  });

  it("klik poza pickerem zamyka listę", async () => {
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Jan/ })).toBeNull());
  });

  it("wpisywanie otwiera listę", async () => {
    const { input } = renderPicker();
    fireEvent.change(input(), { target: { value: "jan" } });
    await waitFor(() => expect(db.current.chainsFor("profiles_public").length).toBeGreaterThan(0));
  });

  it("profile bez identyfikatora są odsiewane", async () => {
    db.current.setResponse("profiles_public", ok([{ id: "", display_name: "Puste" }]));
    const { input } = renderPicker();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("profiles_public")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /Puste/ })).toBeNull();
  });
});

describe("EventPicker", () => {
  function renderPicker(value = "", lang: "pl" | "en" = "pl") {
    const onChange = vi.fn();
    renderWithQueryClient(<EventPicker value={value} onChange={onChange} lang={lang} />);
    return { onChange, select: () => screen.getByRole("combobox") as HTMLSelectElement };
  }

  it("czyta sto wydarzeń od najnowszego", async () => {
    renderPicker();
    await waitFor(() => expect(db.current.chainsFor("events")).toHaveLength(1));
    const chain = db.current.lastChain("events");
    expect(chain?.argsOf("order")).toEqual(["starts_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([100]);
  });

  it("etykieta niesie tytuł i datę, a szkic dodatkowo status", async () => {
    renderPicker();
    const options = await waitFor(() => {
      const found = screen.getAllByRole("option");
      expect(found).toHaveLength(3);
      return found;
    });
    expect(options[1].textContent).toContain("Szczyt klimatyczny");
    expect(options[1].textContent).toMatch(/\d{2}\.\d{2}\.\d{4}|\d{2}\/\d{2}\/\d{4}/);
    // Wydarzenie nieopublikowane MUSI być oznaczone - inaczej redaktor wiąże
    // widget z czymś, czego czytelnik nie zobaczy.
    expect(options[2].textContent).toContain("[draft]");
  });

  it("niepoprawna data nie wypisuje „Invalid Date”", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(document.body.textContent).not.toContain("Invalid Date");
  });

  it("tytuł spada na drugi język, gdy w pierwszym go nie ma", async () => {
    renderPicker("", "pl");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(screen.getAllByRole("option")[2].textContent).toContain("Draft event");
  });

  it("wybór zapisuje identyfikator, a „brak” pusty napis", async () => {
    const { onChange, select } = renderPicker();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    fireEvent.change(select(), { target: { value: "e1" } });
    expect(onChange).toHaveBeenLastCalledWith("e1");
    fireEvent.change(select(), { target: { value: "__none__" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("puste wiązanie pokazuje opcję braku", async () => {
    const { select } = renderPicker();
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(select().value).toBe("__none__");
  });

  it("błąd bazy nie wywala kontrolki", async () => {
    db.current.setResponse("events", { data: null, error: new Error("padło") });
    const { select } = renderPicker();
    await waitFor(() => expect(select()).toBeInTheDocument());
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});

describe("TaxonomyPicker", () => {
  function renderPicker(mode: "categories" | "tags" = "categories", value = "") {
    const onChange = vi.fn();
    function Host() {
      const [csv, setCsv] = useState(value);
      return (
        <TaxonomyPicker
          mode={mode}
          value={csv}
          onChange={(next) => {
            onChange(next);
            setCsv(next);
          }}
        />
      );
    }
    const view = renderWithQueryClient(<Host />);
    return { ...view, onChange };
  }

  const open = () => fireEvent.click(screen.getAllByRole("button")[0]);

  it("kategorie pokazują liczbę wpisów", async () => {
    renderPicker();
    open();
    expect(await screen.findByText("Gospodarka")).toBeInTheDocument();
    // Licznik jest sumą wierszy `post_categories` - to on mówi redaktorowi,
    // czy wybrana kategoria w ogóle ma treść.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("tagi czytają własną tabelę i własne liczniki", async () => {
    renderPicker("tags");
    open();
    expect(await screen.findByText("Brexit")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(db.current.chainsFor("post_tags")).toHaveLength(1);
  });

  it("zaznaczenie zapisuje slugi po przecinku", async () => {
    const { onChange } = renderPicker();
    open();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith("gospodarka");
    fireEvent.click(boxes[1]);
    // Kolejne zaznaczenie DOKŁADA slug, nie zastępuje - inaczej filtr archiwum
    // umiałby tylko jedną kategorię.
    expect(onChange).toHaveBeenLastCalledWith("gospodarka,energia");
  });

  it("odznaczenie usuwa slug z listy", async () => {
    const { onChange } = renderPicker("categories", "gospodarka");
    open();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("jeden wybór pokazuje jego nazwę, dwa - licznik", async () => {
    const single = renderPicker("categories", "gospodarka");
    // Nazwa pojawia się i na przycisku, i na skrócie pod nim.
    await waitFor(() => expect(screen.getAllByText("Gospodarka").length).toBeGreaterThan(0));
    single.unmount?.();
    document.body.innerHTML = "";

    renderPicker("categories", "gospodarka,energia");
    expect(
      await screen.findByText("builder.taxonomyPicker.countSelected(count=2)"),
    ).toBeInTheDocument();
  });

  it("bez wyboru pokazuje etykietę „wszystkie”", () => {
    renderPicker();
    expect(screen.getByText("builder.taxonomyPicker.all")).toBeInTheDocument();
  });

  it("własna podpowiedź nadpisuje etykietę pustego wyboru", () => {
    renderWithQueryClient(
      <TaxonomyPicker mode="tags" value="" onChange={vi.fn()} placeholder="wszystkie tagi" />,
    );
    expect(screen.getByText("wszystkie tagi")).toBeInTheDocument();
  });

  it("filtr zawęża listę po nazwie i po slugu", async () => {
    renderPicker();
    open();
    const filter = await screen.findByPlaceholderText("builder.taxonomyPicker.searchPh");
    fireEvent.change(filter, { target: { value: "gospo" } });
    expect(screen.getByText("Gospodarka")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.getByText("builder.taxonomyPicker.noResults")).toBeInTheDocument();
  });

  it("czyszczenie zdejmuje wszystkie wybory", async () => {
    const { onChange } = renderPicker("categories", "gospodarka");
    open();
    const clear = await screen.findByText("builder.taxonomyPicker.clear");
    fireEvent.click(clear);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("wybrane pozycje mają skróty z krzyżykiem odejmującym", async () => {
    const { onChange } = renderPicker("categories", "gospodarka");
    const chips = await screen.findAllByText("×");
    fireEvent.click(chips[0]);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("wartości z pustymi wpisami po przecinku są odsiewane", async () => {
    renderPicker("categories", " gospodarka , , ");
    open();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
  });
});
