// Widget wyszukiwarki (nagłówek/builder): cztery premium kubełki podpowiedzi,
// nawigacja klawiaturą (combobox/aria-activedescendant), ostatnie
// wyszukiwania, stan pusty, stopka składni + link trybów zaawansowanych.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { SearchButtonWidget } from "../SearchButtonWidget";

const rpc = vi.hoisted(() => ({
  rows: [] as Array<Record<string, string | number | null>>,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  /** Wiersze `profiles_public` dla batcha awatarów autorów. */
  avatars: [] as Array<{ id: string; avatar_url: string | null }>,
  avatarQueries: [] as Array<{ table: string; ids: unknown }>,
  /** Symuluje padnięte zapytanie o awatary (offline / brak grantu). */
  failAvatars: false,
  /** RPC odpowiada `data: null` (pusta odpowiedź bez błędu). */
  nullRows: false,
  /** Batch awatarów odpowiada `data: null`. */
  nullAvatars: false,
  /** Opóźnienie odpowiedzi batcha awatarów - pozwala odmontować w trakcie. */
  avatarDelayMs: 0,
  /** Kolejka odpowiedzi RPC: kolejne wywołania dostają kolejne pozycje. */
  rowsQueue: [] as Array<Array<Record<string, string | number | null>>>,
}));
// `absent: true` renderuje widget POZA RouterProviderem (izolowany render,
// SSR bez routera): wtedy `useRouter({warn:false})` zwraca undefined, a widget
// ma degradować do twardego przejścia zamiast nawigacji SPA.
const nav = vi.hoisted(() => ({ navigate: vi.fn(), preloadRoute: vi.fn(), absent: false }));

vi.mock("@/integrations/supabase/client", () => {
  // Widget dociąga awatary autorów przez `from("profiles_public")`. Bez tego
  // mocka zapytanie rzucało w efekcie (nieobsłużone odrzucenie ubijało kod
  // wyjścia Vitesta), a ciało batcha nigdy się nie wykonywało.
  const table = (name: string) => {
    const chain = {
      select: () => chain,
      in: (_column: string, ids: unknown) => {
        rpc.avatarQueries.push({ table: name, ids });
        return chain;
      },
      then: (
        onFulfilled: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        (rpc.failAvatars
          ? Promise.reject(new Error("avatar batch unavailable"))
          : new Promise<{ data: unknown; error: null }>((resolve) => {
              const value = { data: rpc.nullAvatars ? null : rpc.avatars, error: null };
              if (rpc.avatarDelayMs > 0) setTimeout(() => resolve(value), rpc.avatarDelayMs);
              else resolve(value);
            })
        ).then(onFulfilled, onRejected),
    };
    return chain;
  };

  return {
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpc.calls.push({ name, args });
        if (rpc.nullRows) return { data: null, error: null };
        if (rpc.rowsQueue.length > 0) return { data: rpc.rowsQueue.shift(), error: null };
        return { data: name === "search_autosuggest" ? rpc.rows : [], error: null };
      },
      from: (name: string) => table(name),
    },
  };
});

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () =>
      nav.absent
        ? undefined
        : {
            navigate: nav.navigate,
            preloadRoute: () => Promise.resolve(),
          },
  };
});

// ── DYKTOWANIE FRAZY (Web Speech API) ────────────────────────────────────────
// happy-dom nie zna `SpeechRecognition`, więc `useVoiceSearch` raportuje
// `supported: false` i CAŁY klaster mikrofonu (przycisk, stan nagrywania,
// callbacki onText/onFinal, węższy padding pola) jest w testach martwy.
// Sterowalny konstruktor włącza tę ścieżkę i pozwala wstrzyknąć transkrypcję.
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

class ControlledSpeechRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onresult: ((e: { results: ArrayLike<SpeechResultLike> }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    speech.instances.push(this);
  }
  start(): void {}
  stop(): void {
    this.onend?.();
  }
  abort(): void {}
}

const speech = { instances: [] as ControlledSpeechRecognition[] };

function installSpeechRecognition(): void {
  speech.instances = [];
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    writable: true,
    value: ControlledSpeechRecognition,
  });
}

/** Wstrzykuje transkrypcję do ostatnio utworzonego rozpoznawania mowy. */
function emitTranscript(text: string, isFinal: boolean): void {
  const rec = speech.instances[speech.instances.length - 1];
  expect(rec, "brak uruchomionego rozpoznawania mowy").toBeTruthy();
  act(() => {
    rec.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] });
  });
}

const row = (p: Partial<Record<string, string | number | null>>) => ({
  kind: "post",
  id: "id-1",
  slug: "slug-1",
  label_pl: "Etykieta",
  label_en: "Label",
  parent_page_id: null,
  score: 1,
  ...p,
});

const renderWidget = (over: Partial<Parameters<typeof SearchButtonWidget>[0]> = {}) =>
  render(
    <SearchButtonWidget
      label="Szukaj"
      mode="dropdown"
      heading=""
      liveResults
      limit={8}
      lang="pl"
      height={40}
      radius={8}
      fontSize={14}
      {...over}
    />,
  );

describe("SearchButtonWidget", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    rpc.rows = [];
    rpc.calls = [];
    rpc.avatars = [];
    rpc.avatarQueries = [];
    rpc.failAvatars = false;
    rpc.nullRows = false;
    rpc.nullAvatars = false;
    rpc.avatarDelayMs = 0;
    rpc.rowsQueue = [];
    speech.instances = [];
    nav.absent = false;
    nav.navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("grupuje podpowiedzi w cztery premium kubełki (organizacja w Osobach i organizacjach)", async () => {
    rpc.rows = [
      row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" }),
      row({ kind: "pub_type", id: "t1", slug: "raport", label_pl: "Raport" }),
      row({ kind: "topic", id: "top1", slug: "energia", label_pl: "Energia" }),
      row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" }),
      row({ kind: "organization", id: "o1", slug: "nato", label_pl: "NATO" }),
    ];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "en" } });

    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    // Etykiety kubełków występują podwójnie (zakładka megaboxa + nagłówek
    // sekcji) - liczy się obecność, nie pojedynczość.
    expect(screen.getAllByText("Tytuły").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rodzaje treści").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tematyka").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Osoby i organizacje").length).toBeGreaterThan(0);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/post/wpis");
    expect(hrefs).toContain("/search?type=t1");
    expect(hrefs).toContain("/search?org=o1");
    // Autor ma slug ("jan"), wiec podpowiedz linkuje do profilu /author/<slug>
    // (organizacja bez publicznej strony nadal filtruje /search?org=<id>).
    expect(hrefs).toContain("/author/jan");

    // Hover podświetla opcję (aria-selected), klik wyniku zapisuje frazę
    // w ostatnich wyszukiwaniach i zamyka popover.
    const option = screen.getByText("Tytuł wpisu").closest("a")!;
    fireEvent.mouseEnter(option);
    await waitFor(() => {
      expect(option.getAttribute("aria-selected")).toBe("true");
    });
    fireEvent.click(option);
    expect(localStorage.getItem("recent-searches:v1")).toContain("en");
  });

  it("linki stopki (wszystkie wyniki + zaawansowane) zapisują frazę i zamykają popover", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "energia" } });
    await screen.findByText("Tytuł wpisu");

    const seeAll = screen.getByText(/Zobacz wszystkie wyniki dla/).closest("a")!;
    expect(seeAll.getAttribute("href")).toBe("/search?q=energia");
    fireEvent.click(seeAll);
    expect(localStorage.getItem("recent-searches:v1")).toContain("energia");

    fireEvent.focus(input);
    await screen.findByText("Tytuł wpisu");
    fireEvent.click(screen.getByText("Wyszukiwanie zaawansowane").closest("a")!);
    await waitFor(() => {
      expect(screen.queryByText("Tytuł wpisu")).toBeNull();
    });
  });

  it("nawigacja klawiaturą: strzałki wybierają opcję, Enter nawiguje do jej celu", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    await screen.findByText("Tytuł wpisu");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => {
      expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.navigate).toHaveBeenCalledWith({ href: "/post/wpis" });
    // Fraza wylądowała w ostatnich wyszukiwaniach.
    expect(localStorage.getItem("recent-searches:v1")).toContain("ty");
  });

  it("Enter bez wybranej opcji prowadzi do pełnych wyników /search", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "energia" } });
    await screen.findByText("Tytuł wpisu");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // pozostaje -1
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.navigate).toHaveBeenCalledWith({ href: "/search?q=energia" });
  });

  it("stan pusty pokazuje frazę, a stopka linkuje tryby zaawansowane (adv=1)", async () => {
    rpc.rows = [];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyzq" } });
    expect(await screen.findByText(/Brak wyników dla/)).toBeTruthy();
    const adv = screen.getByText("Wyszukiwanie zaawansowane").closest("a")!;
    expect(adv.getAttribute("href")).toBe("/search?q=xyzq&adv=1");
    expect(screen.getByText('"fraza"')).toBeTruthy();
    expect(screen.getByText("-słowo")).toBeTruthy();
  });

  it("ostatnie wyszukiwania: klik przenosi frazę do pola", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["geopolityka"]));
    const { container } = renderWidget();
    const input = container.querySelector("input")! as HTMLInputElement;
    fireEvent.focus(input);
    const recent = await screen.findByText("geopolityka");
    fireEvent.mouseDown(recent);
    expect(input.value).toBe("geopolityka");
  });

  it("przycisk czyszczenia usuwa frazę i wyniki", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")! as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    await screen.findByText("Tytuł wpisu");
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(input.value).toBe("");
    expect(screen.queryByText("Tytuł wpisu")).toBeNull();
  });

  it("Escape zamyka popover", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["nato"]));
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    await screen.findByText("nato");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("nato")).toBeNull();
    });
  });

  it("tryb bez wyników na żywo: wyszukiwanie dopiero po Enterze", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget({ liveResults: false });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ty" } });
    // Debounce nie striggeruje zapytania w trybie off.
    await new Promise((r) => setTimeout(r, 250));
    expect(rpc.calls).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    expect(rpc.calls[0]?.name).toBe("search_autosuggest");
  });

  it("limit wyników jest ograniczany do zakresu RPC (4-24)", async () => {
    rpc.rows = [];
    const { container } = renderWidget({ limit: 20 });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    await waitFor(() => {
      expect(rpc.calls.length).toBeGreaterThan(0);
    });
    expect(rpc.calls[0]?.args._limit).toBe(24);
  });

  it("dociąga awatary autorów jednym batchem i renderuje miniaturę", async () => {
    rpc.rows = [
      row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" }),
      row({ kind: "author", id: "a2", slug: "ewa", label_pl: "Ewa Nowak" }),
      row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" }),
    ];
    rpc.avatars = [
      { id: "a1", avatar_url: "https://cdn.example/a1.webp" },
      { id: "a2", avatar_url: null },
    ];

    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ko" } });

    await waitFor(() => {
      expect(rpc.avatarQueries).toHaveLength(1);
    });
    // Jeden batch na cały zestaw podpowiedzi, wyłącznie autorzy z id.
    expect(rpc.avatarQueries[0]).toEqual({ table: "profiles_public", ids: ["a1", "a2"] });

    const avatar = await waitFor(() => {
      const img = container.querySelector('img[src="https://cdn.example/a1.webp"]');
      expect(img).not.toBeNull();
      return img!;
    });
    expect(avatar.getAttribute("loading")).toBe("lazy");
    // Autor bez awatara zostaje na ikonie-inicjale, nie na pustym <img>.
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("przycisk operatora wstawia go w miejsce karetki, nie na koniec", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "unia rada" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();

    // Karetka między słowami: "unia| rada".
    input.setSelectionRange(4, 4);
    const operators = screen
      .getAllByTitle("Wstaw operator do zapytania")
      .map((b) => [b.textContent, b] as const);
    const and = operators.find(([label]) => label === "AND")![1];
    fireEvent.mouseDown(and);

    expect(input.value).toBe("unia AND  rada");
  });

  it("operator zastępuje zaznaczony fragment frazy", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "unia xx rada" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();

    input.setSelectionRange(5, 7); // zaznaczone "xx"
    const or = screen
      .getAllByTitle("Wstaw operator do zapytania")
      .find((b) => b.textContent === "OR")!;
    fireEvent.mouseDown(or);

    // "unia " + " OR " + " rada" - zaznaczenie zniknęło, operator wszedł na jego miejsce.
    expect(input.value).toBe("unia  OR  rada");
    expect(input.value).not.toContain("xx");
  });

  it("lupa z frazą przechodzi do pełnych wyników i zapisuje historię", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "traktat" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();

    const magnifier = screen.getAllByLabelText("Szukaj").find((el) => el.tagName === "BUTTON")!;
    fireEvent.mouseDown(magnifier);

    expect(nav.navigate).toHaveBeenCalledWith({ href: "/search?q=traktat" });
    // Fraza trafia do historii, więc puste pole pokaże ją jako ostatnie szukanie.
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.focus(input);
    expect(await screen.findByText("traktat")).toBeTruthy();
  });

  it("lupa bez frazy tylko ustawia fokus w polu (bez nawigacji)", async () => {
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    const magnifier = screen.getAllByLabelText("Szukaj").find((el) => el.tagName === "BUTTON")!;

    fireEvent.mouseDown(magnifier);

    expect(nav.navigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("zakładka kubełka zawęża listę do jednej kategorii", async () => {
    rpc.rows = [
      row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" }),
      row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" }),
    ];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "un" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    expect(screen.queryByText("Jan Kowalski")).toBeTruthy();

    const peopleTab = screen
      .getAllByRole("tab")
      .find((el) => el.getAttribute("aria-selected") === "false")!;
    fireEvent.mouseDown(peopleTab);

    // Po przełączeniu kubełka widać już tylko jego pozycje.
    await waitFor(() => {
      expect(peopleTab.getAttribute("aria-selected")).toBe("true");
    });
    const visible = [screen.queryByText("Tytuł wpisu"), screen.queryByText("Jan Kowalski")].filter(
      Boolean,
    );
    expect(visible).toHaveLength(1);
  });

  it("przycisk czyszczenia historii usuwa ostatnie wyszukiwania", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "traktat" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.focus(input);
    expect(await screen.findByText("traktat")).toBeTruthy();

    fireEvent.mouseDown(screen.getByText("Wyczyść historię"));

    await waitFor(() => {
      expect(screen.queryByText("traktat")).toBeNull();
    });
  });

  it("fraza krótsza niż 2 znaki czyści listę bez odpytywania RPC", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "un" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    const callsAfterSearch = rpc.calls.length;

    fireEvent.change(input, { target: { value: "u" } });

    await waitFor(() => {
      expect(screen.queryByText("Tytuł wpisu")).toBeNull();
    });
    expect(rpc.calls).toHaveLength(callsAfterSearch);
  });

  it("porażka batcha awatarów nie wywraca podpowiedzi (zostają ikony)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.rows = [row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" })];
    rpc.failAvatars = true;

    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ja" } });

    expect(await screen.findByText("Jan Kowalski")).toBeTruthy();
    await waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(container.querySelectorAll("img")).toHaveLength(0);
    warn.mockRestore();
  });

  // ── GAŁĘZIE ODMOWY I PRZYPADKI BRZEGOWE ────────────────────────────────────
  // Testy wyżej jadą szczęśliwą ścieżką: jest router, są wiersze, są kolumny.
  // Poniżej są rozgałęzienia, których czytelnik dotyka najczęściej wtedy, gdy
  // coś nie działa - brak routera, spóźniona odpowiedź, puste kolumny, pusta
  // odpowiedź RPC, odmontowanie w trakcie zapytania i dyktowanie głosem.

  it("BEZ routera nawigacja degraduje do twardego przejścia, nie do wyjątku", async () => {
    nav.absent = true;
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});

    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nato" } });
    await screen.findByText("Tytuł wpisu");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(assign).toHaveBeenCalledWith("/search?q=nato");
    expect(nav.navigate).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("Enter z frazą KRÓTSZĄ niż 2 znaki nie odpytuje RPC i czyści listę", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget({ liveResults: false });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "u" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(rpc.calls).toHaveLength(0);
    });
    expect(screen.queryByText("Tytuł wpisu")).toBeNull();
  });

  it("SPÓŹNIONA odpowiedź starszego zapytania nie nadpisuje wyników nowszego", async () => {
    rpc.rowsQueue = [
      [row({ kind: "post", id: "p1", slug: "stare", label_pl: "Stary wynik" })],
      [row({ kind: "post", id: "p2", slug: "nowe", label_pl: "Nowy wynik" })],
    ];
    const { container } = renderWidget({ liveResults: false });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "unia" } });
    // Dwa Entery W TYM SAMYM takcie: oba zapytania startują, zanim
    // którekolwiek wróci - pierwsze wraca jako nieaktualne i musi zostać
    // odrzucone, inaczej użytkownik zobaczy wynik do frazy sprzed chwili.
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Nowy wynik")).toBeTruthy();
    expect(screen.queryByText("Stary wynik")).toBeNull();
    expect(rpc.calls).toHaveLength(2);
  });

  it("RPC bez danych (data: null) pokazuje stan pusty zamiast wywracać widget", async () => {
    rpc.nullRows = true;
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "traktat" } });

    expect(await screen.findByText(/Brak wyników dla/)).toBeTruthy();
    expect(container.textContent).not.toContain("undefined");
  });

  it("wiersz z PUSTYMI kolumnami nie wypisuje wartości zastępczych ani nie gubi klucza", async () => {
    rpc.rows = [
      row({ kind: "topic", id: null, slug: null, label_pl: null, label_en: null, score: null }),
    ];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "energia" } });

    const option = await waitFor(() => {
      const el = container.querySelector('[role="option"]');
      expect(el).not.toBeNull();
      return el!;
    });
    // Brak identyfikatora i sluga -> podpowiedź prowadzi do samego /search.
    expect(option.getAttribute("href")).toBe("/search");
    for (const leak of ["undefined", "null", "NaN"]) {
      expect(container.textContent ?? "").not.toContain(leak);
    }
  });

  it("wersja EN spada na etykietę PL, gdy kolumna angielska jest pusta", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Energia", label_en: "" })];
    const { container } = renderWidget({ lang: "en" });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "en" } });

    expect(await screen.findByText("Energia")).toBeTruthy();
    // Nagłówki kubełków idą ze słownika EN, więc język jest naprawdę przełączony.
    expect(screen.getAllByText("Titles").length).toBeGreaterThan(0);
  });

  it("batch awatarów bez danych (data: null) zostawia ikony, nie puste <img>", async () => {
    rpc.nullAvatars = true;
    rpc.rows = [row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" })];

    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ja" } });

    expect(await screen.findByText("Jan Kowalski")).toBeTruthy();
    await waitFor(() => {
      expect(rpc.avatarQueries).toHaveLength(1);
    });
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("odmontowanie W TRAKCIE batcha awatarów nie dopisuje stanu do martwego drzewa", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.avatarDelayMs = 30;
    rpc.avatars = [{ id: "a1", avatar_url: "https://cdn.example/a1.webp" }];
    rpc.rows = [row({ kind: "author", id: "a1", slug: "jan", label_pl: "Jan Kowalski" })];

    renderWidget();
    const input = document.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ja" } });
    await screen.findByText("Jan Kowalski");
    await waitFor(() => {
      expect(rpc.avatarQueries).toHaveLength(1);
    });

    cleanup();
    await new Promise((r) => setTimeout(r, 60));

    expect(document.querySelector("img")).toBeNull();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("BEZ etykiety podpowiedzią pola zostaje nagłówek widgetu", () => {
    const { container } = renderWidget({ label: "", heading: "Szukaj w serwisie" });
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Szukaj w serwisie");
    expect(container.querySelector("label.user-label")?.textContent).toBe("Szukaj w serwisie");
  });

  it("BEZ etykiety i nagłówka pole bierze napis ze słownika wyszukiwarki", () => {
    const { container } = renderWidget({ label: "", heading: "" });
    // "Szukaj" = `search.widget.search` z `@/lib/i18n-search` (PL).
    expect(container.querySelector("label.user-label")?.textContent).toBe("Szukaj");
    expect(container.querySelector("input")?.getAttribute("aria-label")).toBe("Szukaj");
  });

  it("wysokość 0 z panelu spada na domyślne 36 px zamiast zapadać się do zera", () => {
    const { container } = renderWidget({ height: 0 });
    const input = container.querySelector("input")!;
    expect(input.style.height).toBe("36px");
    expect(input.style.minHeight).toBe("36px");
  });

  it("operator ląduje na KOŃCU frazy, gdy przeglądarka nie raportuje karetki", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "unia" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();

    // Pole bez raportowanej karetki (selectionStart/End === null) - tak
    // zachowują się pola typu search/email w części przeglądarek.
    Object.defineProperty(input, "selectionStart", { configurable: true, get: () => null });
    Object.defineProperty(input, "selectionEnd", { configurable: true, get: () => null });

    const and = screen
      .getAllByTitle("Wstaw operator do zapytania")
      .find((b) => b.textContent === "AND")!;
    fireEvent.mouseDown(and);

    expect(input.value).toBe("unia AND ");
  });

  it("dyktowanie: transkrypcja płynie do pola i otwiera podpowiedzi", async () => {
    installSpeechRecognition();
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")! as HTMLInputElement;

    const mic = await screen.findByRole("button", { name: "Wyszukiwanie głosowe" });
    fireEvent.click(mic);
    await waitFor(() => {
      expect(speech.instances).toHaveLength(1);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Zatrzymaj dyktowanie" }).getAttribute("aria-pressed"),
      ).toBe("true");
    });

    emitTranscript("unia europejska", false);
    expect(input.value).toBe("unia europejska");
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
  });

  it("dyktowanie BEZ wyników na żywo: finalna transkrypcja sama odpala wyszukiwanie", async () => {
    installSpeechRecognition();
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget({ liveResults: false });
    const input = container.querySelector("input")! as HTMLInputElement;

    fireEvent.click(await screen.findByRole("button", { name: "Wyszukiwanie głosowe" }));
    await waitFor(() => {
      expect(speech.instances).toHaveLength(1);
    });

    emitTranscript("traktat lizbonski", true);
    expect(input.value).toBe("traktat lizbonski");
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();
    expect(rpc.calls).toHaveLength(1);
  });

  it("klik POZA widgetem zamyka megabox (handler dokumentu)", async () => {
    rpc.rows = [row({ kind: "post", id: "p1", slug: "wpis", label_pl: "Tytuł wpisu" })];
    const { container } = renderWidget();
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "unia" } });
    expect(await screen.findByText("Tytuł wpisu")).toBeTruthy();

    // Klik w cel spoza `wrapRef` - dokładnie ten warunek zamyka popover.
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      expect(screen.queryByText("Tytuł wpisu")).toBeNull();
    });
    outside.remove();
  });
});
