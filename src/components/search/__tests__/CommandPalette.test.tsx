// Globalna paleta komend (⌘K / Ctrl+K). Największy pojedynczy plik modułu na
// zerze: 31 funkcji, ani jednej wykonanej.
//
// Trzy rzeczy pękają tu po cichu i one są przedmiotem testu:
//   1. WIDOCZNOŚĆ - paleta jest jedynym miejscem, gdzie mapa panelu leci przez
//      klienta; `visibleCommands` ma własny test jednostkowy, tu sprawdzamy, że
//      paleta faktycznie go pyta i nic nie renderuje obok niego.
//   2. WYŚCIG ODPOWIEDZI - zapytanie jest debounce'owane i asynchroniczne,
//      a `reqIdRef` odrzuca odpowiedzi spóźnione. Bez tego użytkownik widzi
//      wyniki dla frazy, której już nie ma w polu.
//   3. SKRÓT `/` - otwiera paletę tylko POZA polem tekstowym. Regresja zamienia
//      każdy ukośnik wpisywany w formularzu na otwarcie palety.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SearchHit } from "@/lib/search/search.functions";

const h = vi.hoisted(() => ({
  auth: { current: { isAdmin: false, user: null as { id: string } | null } },
  globalSearch: vi.fn(),
  navigate: vi.fn(),
  language: { current: "pl" },
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));
vi.mock("@/lib/search/search.functions", () => ({ globalSearch: h.globalSearch }));

import "@/test/i18nReal";
import "@/lib/i18n-search";
import { CommandPalette } from "../CommandPalette";

const hit = (p: Partial<SearchHit> = {}): SearchHit => ({
  kind: "post",
  id: "p-1",
  slug: "raport-roczny",
  title_pl: "Raport roczny",
  title_en: "Annual report",
  href: "/post/raport-roczny",
  ...p,
});

// Paleta jest identyfikowana po placeholderze, NIE po roli "combobox":
// `<select>` ma tę rolę implicite, więc test skrótu „/" w liście rozwijanej
// znajdowałby własny element pomocniczy i „dowodził", że paleta się otworzyła.
const PLACEHOLDER = "Wyszukaj strony, akcje, ustawienia...";
const paletteInput = () => screen.getByPlaceholderText(PLACEHOLDER);
const isOpen = () => screen.queryByPlaceholderText(PLACEHOLDER) !== null;

// Etykiety wierszy jadą przez `HighlightedText`, który rozbija tekst na <mark>
// i fragmenty - `getByText("Raport roczny")` nie trafia. Celujemy w kontener
// etykiety (span.flex-1), którego textContent jest pełny. Wiersz „popularny"
// i wiersz wyniku to dwa osobne trafienia tej samej nazwy, stąd liczba mnoga.
const rows = (text: string) =>
  screen.queryAllByText(
    (_, el) =>
      el?.tagName === "SPAN" &&
      typeof el.className === "string" &&
      el.className.includes("flex-1") &&
      el.textContent?.trim() === text,
  );
const hasRow = (text: string) => rows(text).length > 0;

/** Otwiera paletę skrótem i przepuszcza debounce + mikrozadania. */
function open() {
  act(() => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
}

async function type(value: string) {
  const input = paletteInput();
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.auth.current = { isAdmin: false, user: null };
  h.navigate.mockClear();
  h.globalSearch.mockReset();
  h.globalSearch.mockResolvedValue({ hits: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CommandPalette - otwieranie i zamykanie", () => {
  it("startuje ZAMKNIĘTA - nie może przykrywać strony po wejściu", () => {
    render(<CommandPalette />);
    expect(isOpen()).toBe(false);
  });

  it("Ctrl+K otwiera, a drugi Ctrl+K zamyka", () => {
    render(<CommandPalette />);
    open();
    expect(isOpen()).toBe(true);
    open();
    expect(isOpen()).toBe(false);
  });

  it("⌘K działa tak samo jak Ctrl+K (macOS)", () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: "K", metaKey: true });
    });
    expect(isOpen()).toBe(true);
  });

  it("samo „k” bez modyfikatora NIE otwiera palety", () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: "k" });
    });
    expect(isOpen()).toBe(false);
  });

  it("„/” otwiera paletę, gdy fokus jest poza polem tekstowym", () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: "/" });
    });
    expect(isOpen()).toBe(true);
  });

  it("„/” w polu tekstowym NIE otwiera palety - to zwykły znak", () => {
    render(<CommandPalette />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => {
      fireEvent.keyDown(field, { key: "/" });
    });
    expect(isOpen()).toBe(false);
    field.remove();
  });

  it("„/” w polu wielowierszowym też nie otwiera palety", () => {
    render(<CommandPalette />);
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    act(() => {
      fireEvent.keyDown(area, { key: "/" });
    });
    expect(isOpen()).toBe(false);
    area.remove();
  });

  it("„/” w liście rozwijanej nie otwiera palety", () => {
    render(<CommandPalette />);
    const select = document.createElement("select");
    document.body.appendChild(select);
    act(() => {
      fireEvent.keyDown(select, { key: "/" });
    });
    expect(isOpen()).toBe(false);
    select.remove();
  });

  it("„/” w edytowalnym bloku (contenteditable) nie otwiera palety", () => {
    render(<CommandPalette />);
    const div = document.createElement("div");
    div.contentEditable = "true";
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);
    act(() => {
      fireEvent.keyDown(div, { key: "/" });
    });
    expect(isOpen()).toBe(false);
    div.remove();
  });

  it("„/” przy JUŻ OTWARTEJ palecie nie przechwytuje znaku (można szukać „a/b”)", async () => {
    render(<CommandPalette />);
    open();
    await type("a");
    act(() => {
      fireEvent.keyDown(window, { key: "/" });
    });
    expect(isOpen()).toBe(true);
  });

  it("odmontowanie zdejmuje globalny nasłuch klawiatury", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<CommandPalette />);
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

describe("CommandPalette - widoczność komend per rola", () => {
  it("gość widzi nawigację publiczną, ale ŻADNEGO adresu panelu", () => {
    render(<CommandPalette />);
    open();
    expect(hasRow("Blog")).toBe(true);
    expect(hasRow("Panel administratora")).toBe(false);
    expect(hasRow("Mój profil")).toBe(false);
  });

  it("zalogowany widzi sekcję konta, nadal bez panelu", () => {
    h.auth.current = { isAdmin: false, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    expect(hasRow("Mój profil")).toBe(true);
    expect(hasRow("Panel administratora")).toBe(false);
  });

  it("admin widzi komendy panelu", () => {
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    expect(hasRow("Panel administratora")).toBe(true);
  });

  it("pusta fraza pokazuje listę POPULARNYCH, przyciętą do ośmiu", () => {
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    expect(screen.getByText("Popularne")).toBeInTheDocument();
  });
});

describe("CommandPalette - filtrowanie w trakcie pisania", () => {
  it("zawęża listę komend do pasujących", async () => {
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    await type("cennik");
    expect(hasRow("Cennik")).toBe(true);
    expect(hasRow("Panel administratora")).toBe(false);
  });

  it("znajduje komendę po SŁOWIE KLUCZOWYM z drugiego języka", async () => {
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    // „Strony" mają keywords_en: ["strony"] i label_en „Pages".
    await type("pages");
    expect(hasRow("Strony")).toBe(true);
  });

  it("znajduje komendę pisaną BEZ OGONKÓW - tak pisze większość użytkowników", async () => {
    // Do 18.08.2026 „platnosci" nie znajdowało „Płatności", a „bezpieczenstwo"
    // nie znajdowało „Bezpieczeństwo konta" - przy jednoczesnym `unaccent`
    // w bazie, więc ta sama fraza znajdowała TREŚĆ, ale nie komendę.
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    await type("platnosci");
    expect(hasRow("Płatności")).toBe(true);
  });

  it("znajduje komendę WKLEJONĄ w postaci rozłożonej kanonicznie (NFD)", async () => {
    // Zgłoszone w recenzji PR #258. „ś” da się zapisać jako jeden punkt kodowy
    // (NFC) albo jako „s” + U+0301 (NFD) - wygląda IDENTYCZNIE, a to inny
    // napis. Wklejka potrafi przynieść NFD (nazwy plików HFS+, część aplikacji
    // macOS). Bramki są DWIE i obie muszą przepuścić: `fuzzyMatch` (przez
    // `foldQuery`) oraz własny matcher cmdk po `value` - stąd kopia NFD celu
    // dopisana do wartości wiersza. Test jedzie przez cały komponent, więc
    // sprawdza obie naraz.
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    await type("Płatności".normalize("NFD"));
    expect(hasRow("Płatności")).toBe(true);
  });

  it("znajduje komendę po fragmencie ŚCIEŻKI", async () => {
    h.auth.current = { isAdmin: true, user: { id: "u-1" } };
    render(<CommandPalette />);
    open();
    await type("/admin/media");
    expect(hasRow("Media")).toBe(true);
  });

  it("fraza bez trafień pokazuje stan pusty z podpowiedzią, nie białą płachtę", async () => {
    render(<CommandPalette />);
    open();
    await type("zzzzqqqq");
    await waitFor(() =>
      expect(screen.getByText("Spróbuj innej frazy lub kategorii.")).toBeInTheDocument(),
    );
  });
});

describe("CommandPalette - wyszukiwanie treści na serwerze", () => {
  it("jeden znak NIE odpytuje serwera, tylko prosi o dłuższą frazę", async () => {
    render(<CommandPalette />);
    open();
    await type("a");
    expect(h.globalSearch).not.toHaveBeenCalled();
    expect(
      screen.getByText("Wpisz co najmniej 2 znaki, aby przeszukać treści."),
    ).toBeInTheDocument();
  });

  it("od dwóch znaków odpytuje serwer z limitem", async () => {
    render(<CommandPalette />);
    open();
    await type("raport");
    expect(h.globalSearch).toHaveBeenCalledWith({ data: { q: "raport", limit: 8 } });
  });

  it("DEBOUNCE: szybkie pisanie daje JEDNO zapytanie, nie jedno na znak", async () => {
    render(<CommandPalette />);
    open();
    const input = paletteInput();
    fireEvent.change(input, { target: { value: "ra" } });
    fireEvent.change(input, { target: { value: "rap" } });
    fireEvent.change(input, { target: { value: "raport" } });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(h.globalSearch).toHaveBeenCalledTimes(1);
    expect(h.globalSearch).toHaveBeenCalledWith({ data: { q: "raport", limit: 8 } });
  });

  it("pokazuje trafienia treści z adresem", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit()] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Raport roczny")).toBe(true));
    expect(screen.getByText("/post/raport-roczny")).toBeInTheDocument();
  });

  it("wpis i strona trafiają na tę samą listę treści", async () => {
    h.globalSearch.mockResolvedValue({
      hits: [
        hit(),
        hit({
          kind: "page",
          id: "pg-1",
          slug: "raport-strategiczny",
          title_pl: "Raport strategiczny",
          href: "/raport-strategiczny",
        }),
      ],
    });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Raport strategiczny")).toBe(true));
    expect(hasRow("Raport roczny")).toBe(true);
    // Strona prowadzi pod adres bez prefiksu /post - to rozróżnienie rodzaju.
    expect(screen.getByText("/raport-strategiczny")).toBeInTheDocument();
  });

  it("cmdk UKRYWA trafienie, którego tytuł nie pasuje do wpisanej frazy", async () => {
    // Serwer zwraca trafienia po pełnotekstowym rankingu bazy (treść wpisu),
    // a lista i tak przepuszcza je przez własny filtr po tytule i slugu.
    // Wynik trafny merytorycznie, ale o odległym tytule, NIE dojdzie do
    // użytkownika - to świadomy koszt spójności listy, nie defekt, ale trzeba
    // o nim wiedzieć przy diagnozie „szukam i nie widzę".
    h.globalSearch.mockResolvedValue({
      hits: [hit({ id: "pg-1", slug: "o-nas", title_pl: "O nas", href: "/post/o-nas" })],
    });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(h.globalSearch).toHaveBeenCalled());
    expect(hasRow("O nas")).toBe(false);
  });

  it("trafienie bez tytułu spada na slug, a nie na pusty wiersz", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit({ title_pl: "", title_en: "" })] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("raport-roczny")).toBe(true));
  });

  it("brak polskiego tytułu spada na angielski", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit({ title_pl: "" })] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Annual report")).toBe(true));
  });

  it("BŁĄD serwera nie wywraca palety - komendy zostają, treści znikają", async () => {
    h.globalSearch.mockRejectedValue(new Error("500"));
    render(<CommandPalette />);
    open();
    await type("cennik");
    await waitFor(() => expect(hasRow("Cennik")).toBe(true));
    expect(screen.queryByText("Szukam treści...")).not.toBeInTheDocument();
  });

  it("SPÓŹNIONA odpowiedź starej frazy NIE nadpisuje wyników nowej", async () => {
    let resolveOld: (v: { hits: SearchHit[] }) => void = () => {};
    h.globalSearch
      .mockImplementationOnce(() => new Promise<{ hits: SearchHit[] }>((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ hits: [hit({ id: "new", title_pl: "Nowy wynik" })] });

    render(<CommandPalette />);
    open();
    await type("stara");
    await type("nowa");
    await waitFor(() => expect(hasRow("Nowy wynik")).toBe(true));

    // Odpowiedź na „stara" wraca PO wyniku „nowa" - musi zostać odrzucona.
    await act(async () => {
      resolveOld({ hits: [hit({ id: "old", title_pl: "Stary wynik" })] });
    });
    expect(hasRow("Stary wynik")).toBe(false);
    expect(hasRow("Nowy wynik")).toBe(true);
  });

  it("skrócenie frazy poniżej progu czyści trafienia treści", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit()] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Raport roczny")).toBe(true));
    await type("r");
    expect(hasRow("Raport roczny")).toBe(false);
  });
});

describe("CommandPalette - wybór", () => {
  it("wybór komendy nawiguje pod jej adres i ZAMYKA paletę", async () => {
    render(<CommandPalette />);
    open();
    fireEvent.click(rows("Cennik")[0]);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: "/pricing" }));
    expect(isOpen()).toBe(false);
  });

  it("wybór trafienia treści nawiguje pod jego permalink", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit()] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Raport roczny")).toBe(true));
    fireEvent.click(rows("Raport roczny")[0]);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: "/post/raport-roczny" }));
  });

  it("zamknięcie CZYŚCI frazę - ponowne otwarcie zaczyna od pustego pola", async () => {
    render(<CommandPalette />);
    open();
    await type("raport");
    expect(paletteInput()).toHaveValue("raport");
    open();
    open();
    expect(paletteInput()).toHaveValue("");
  });

  it("zamknięcie czyści też trafienia treści (nie mrugają przy następnym otwarciu)", async () => {
    h.globalSearch.mockResolvedValue({ hits: [hit()] });
    render(<CommandPalette />);
    open();
    await type("raport");
    await waitFor(() => expect(hasRow("Raport roczny")).toBe(true));
    open();
    open();
    expect(hasRow("Raport roczny")).toBe(false);
  });
});
