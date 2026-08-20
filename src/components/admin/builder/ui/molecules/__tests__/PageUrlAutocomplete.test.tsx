// Pole adresu z podpowiedziami stron i wpisów serwisu. To ono pozwala związać
// przycisk widgetu ze STRONĄ, a nie z wklejonym adresem - dlatego test pilnuje
// nie tyle wyglądu listy, ile:
//   * co dokładnie leci do bazy (tylko opublikowane, nieusunięte, limit 10,
//     filtr po tytule PL, tytule EN i po slugu),
//   * że lista NIE JEST czytana, dopóki pole nie zostanie otwarte
//     (`enabled: open`) - inaczej każde otwarcie panelu widgetu z polem adresu
//     strzelałoby dwoma zapytaniami,
//   * że wybór pozycji zapisuje ŚCIEŻKĘ (`/slug`, `/post/slug`), nie tytuł,
//   * obsługę klawiatury, bo redakcja wypełnia te pola bez myszy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { PageUrlAutocomplete } from "../PageUrlAutocomplete";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.current.from(table),
  },
}));

const PAGES = [
  { id: "p1", slug: "o-nas", title_pl: "O nas", title_en: "About us" },
  { id: "p2", slug: "/kontakt", title_pl: "Kontakt", title_en: null },
];
const POSTS = [
  { id: "s1", slug: "nowy-raport", title_pl: "Nowy raport", title_en: "New report" },
  // Wpis bez tytułu w żadnym języku - stan realny dla świeżo zaimportowanej
  // treści; lista musi pokazać slug, a nie puste pole.
  { id: "s2", slug: "bez-tytulu", title_pl: null, title_en: null },
];

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("pages", ok(PAGES));
  db.current.setResponse("posts", ok(POSTS));
});

/**
 * Pole jest STEROWANE: fraza wyszukiwania pochodzi z propsa `value`, więc test
 * musi trzymać stan tak, jak trzyma go panel. Bez tego wpisanie tekstu nie
 * zmienia klucza zapytania i filtr nigdy nie jest sprawdzony.
 */
function renderField(initial = "", lang: "pl" | "en" = "pl") {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <PageUrlAutocomplete
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        lang={lang}
        placeholder="/adres"
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  return { ...view, onChange, input: () => screen.getByRole("textbox") as HTMLInputElement };
}

describe("PageUrlAutocomplete - kiedy pyta bazę", () => {
  it("nie czyta bazy, dopóki pole nie zostało otwarte", async () => {
    renderField();
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    // `enabled: open` - panel widgetu z pięcioma polami adresu nie może
    // wystrzelić dziesięciu zapytań przy samym otwarciu.
    expect(db.current.chains).toHaveLength(0);
  });

  it("otwarcie pola czyta strony i wpisy", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("pages")).toHaveLength(1));
    expect(db.current.chainsFor("posts")).toHaveLength(1);
  });

  it("czyta wyłącznie opublikowane i nieusunięte, po dziesięć pozycji", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.lastChain("pages")).toBeDefined());
    const pages = db.current.lastChain("pages");
    expect(pages?.argsOf("eq")).toEqual(["status", "published"]);
    expect(pages?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(pages?.argsOf("limit")).toEqual([10]);
    // Strony sortujemy po tytule (alfabetycznie), wpisy po dacie publikacji.
    expect(pages?.argsOf("order")).toEqual(["title_pl"]);
    const posts = db.current.lastChain("posts");
    expect(posts?.argsOf("order")).toEqual(["published_at", { ascending: false }]);
  });

  it("sortuje strony po tytule w języku panelu", async () => {
    const { input } = renderField("", "en");
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.lastChain("pages")).toBeDefined());
    expect(db.current.lastChain("pages")?.argsOf("order")).toEqual(["title_en"]);
  });

  it("bez wpisanego tekstu nie filtruje", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.lastChain("pages")).toBeDefined());
    expect(db.current.lastChain("pages")?.has("or")).toBe(false);
  });

  it("filtruje po tytule PL, tytule EN i po slugu", async () => {
    const { input } = renderField();
    fireEvent.change(input(), { target: { value: "/rap" } });
    await waitFor(() => expect(db.current.lastChain("posts")).toBeDefined());
    // Wiodące ukośniki i część zapytania po `?`/`#` nie są częścią frazy -
    // inaczej wpisanie „/o-nas?ref=x” nie znajdowałoby niczego.
    expect(db.current.lastChain("posts")?.argsOf("or")).toEqual([
      "title_pl.ilike.%rap%,title_en.ilike.%rap%,slug.ilike.%rap%",
    ]);
  });

  it.each([
    ["wiodące ukośniki", "///o-nas", "o-nas"],
    ["parametry zapytania", "/o-nas?ref=x", "o-nas"],
    ["fragment", "/o-nas#sekcja", "o-nas"],
  ])("wycina z frazy: %s", async (_label, typed, phrase) => {
    const { input } = renderField();
    fireEvent.change(input(), { target: { value: typed } });
    await waitFor(() => expect(db.current.lastChain("pages")).toBeDefined());
    expect(db.current.lastChain("pages")?.argsOf("or")?.[0]).toContain(`%${phrase}%`);
  });
});

describe("PageUrlAutocomplete - lista podpowiedzi", () => {
  it("pokazuje strony i wpisy z właściwymi ścieżkami", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    const options = await waitFor(() => {
      const found = screen.getAllByRole("option");
      expect(found).toHaveLength(4);
      return found;
    });
    expect(options[0].textContent).toContain("O nas");
    expect(options[0].textContent).toContain("/o-nas");
    // Slug zapisany z ukośnikiem nie może dać „//kontakt”.
    expect(options[1].textContent).toContain("/kontakt");
    expect(options[1].textContent).not.toContain("//kontakt");
    expect(options[2].textContent).toContain("/post/nowy-raport");
    // Wpis bez tytułu spada na slug - w obu językach.
    expect(options[3].textContent).toContain("bez-tytulu");
  });

  it("rozróżnia rodzaj pozycji plakietką ze słownika", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    expect(screen.getAllByText("builder.urlSuggest.page")).toHaveLength(2);
    expect(screen.getAllByText("builder.urlSuggest.post")).toHaveLength(2);
  });

  it("spada na slug, gdy tytuł w języku panelu jest pusty", async () => {
    const { input } = renderField("", "en");
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    // Strona „Kontakt” nie ma tytułu EN - lista musi pokazać cokolwiek
    // rozpoznawalnego, a nie puste pole.
    expect(screen.getAllByRole("option")[1].textContent).toContain("/kontakt");
  });

  it("wybór myszą zapisuje ścieżkę i zamyka listę", async () => {
    const { input, onChange } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    fireEvent.mouseDown(screen.getAllByRole("option")[2]);
    expect(onChange).toHaveBeenCalledWith("/post/nowy-raport");
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  });

  it("zaznacza pozycję odpowiadającą aktualnej wartości", async () => {
    const { input } = renderField("/o-nas");
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "false");
  });

  it("najechanie myszą przenosi wyróżnienie", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
    expect(screen.getAllByRole("option")[1].className).toContain("bg-muted");
  });

  it("pusta odpowiedź bazy nie rysuje listy", async () => {
    db.current.setResponse("pages", ok([]));
    db.current.setResponse("posts", ok([]));
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("pages")).toHaveLength(1));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("brak danych w odpowiedzi traktujemy jak pustą listę", async () => {
    db.current.setResponse("pages", { data: null, error: null });
    db.current.setResponse("posts", { data: null, error: null });
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(db.current.chainsFor("posts")).toHaveLength(1));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("klik poza polem zamyka listę", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  });

  it("klik wewnątrz pola listy nie zamyka", async () => {
    const { input } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    fireEvent.mouseDown(input());
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });
});

describe("PageUrlAutocomplete - klawiatura", () => {
  async function openWithHits() {
    const { input, onChange } = renderField();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    return { input, onChange };
  }

  it("strzałka w dół z zamkniętej listy tylko ją otwiera", async () => {
    const { input } = renderField();
    expect(input()).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("Enter z zamkniętej listy ją otwiera, nie wysyła formularza", async () => {
    const { input, onChange } = renderField();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("strzałkami wybieramy pozycję, Enter ją zatwierdza", async () => {
    const { input, onChange } = await openWithHits();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("/kontakt");
  });

  it("strzałka w dół nie wychodzi za koniec listy", async () => {
    const { input, onChange } = await openWithHits();
    for (let i = 0; i < 8; i++) fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    // Ostatnia pozycja listy, a nie „poza listą” - klamp na `hits.length - 1`.
    expect(onChange).toHaveBeenCalledWith("/post/bez-tytulu");
  });

  it("strzałka w górę wraca do stanu bez wyboru", async () => {
    const { input, onChange } = await openWithHits();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    // Bez wyboru Enter nie może nic zapisać - inaczej trafia pierwsza pozycja,
    // której redaktor nie wskazał.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape zamyka listę", async () => {
    const { input } = await openWithHits();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  });

  it("pozostałe klawisze przy zamkniętej liście nic nie robią", () => {
    const { input, onChange } = renderField();
    fireEvent.keyDown(input(), { key: "a" });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pozostałe klawisze nie ruszają listy", async () => {
    const { input, onChange } = await openWithHits();
    fireEvent.keyDown(input(), { key: "a" });
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wpisywanie otwiera listę i przekazuje wartość dalej", async () => {
    const { input, onChange } = renderField();
    fireEvent.change(input(), { target: { value: "/o" } });
    expect(onChange).toHaveBeenCalledWith("/o");
    expect(input()).toHaveAttribute("aria-expanded", "true");
  });

  it("przyjmuje własną klasę", () => {
    const { container } = renderWithQueryClient(
      <PageUrlAutocomplete value="" onChange={vi.fn()} lang="pl" className="w-40" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("w-40");
  });
});
